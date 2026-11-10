import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostExplicitlyAllowed, hostMatches, isPrivateAddress, normalizeHost, stateDirectory } from "./config.js";

// Every browser request passes through this proxy, so the allowlist and the
// private-address block apply after DNS resolution, to redirects, subresources,
// and iframes, and the checked address is the one actually connected to.

const sidecarPath = (session: string): string => join(stateDirectory(), `${session}.proxy.json`);
export const blockedLogPath = (session: string): string => join(stateDirectory(), `${session}.blocked.log`);

/** Connects to the first reachable address; a name such as localhost can resolve to several. */
function connectAny(addresses: string[], port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const attempt = (index: number): void => {
      const socket = connect(port, addresses[index]!);
      socket.setTimeout(15_000, () => socket.destroy(new Error("connect timed out")));
      socket.once("connect", () => { socket.setTimeout(0); socket.removeAllListeners("error"); resolve(socket); });
      socket.once("error", (error) => {
        socket.destroy();
        if (index + 1 < addresses.length) attempt(index + 1);
        else reject(error);
      });
    };
    attempt(0);
  });
}

export async function resolveAllowed(hostname: string, allowedDomains: string[]): Promise<string[]> {
  const host = normalizeHost(hostname);
  if (allowedDomains.length > 0 && !hostMatches(host, allowedDomains)) throw new Error("not in the allowed domains");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0) throw new Error("did not resolve");
  if (!hostExplicitlyAllowed(host, allowedDomains) && addresses.some(isPrivateAddress)) {
    throw new Error("resolves to a private or loopback address");
  }
  return addresses;
}

export function createProxy(allowedDomains: string[], onBlocked: (host: string, reason: string) => void = () => {}): Server {
  const check = async (hostname: string): Promise<string[] | null> => {
    try {
      return await resolveAllowed(hostname, allowedDomains);
    } catch (error) {
      onBlocked(normalizeHost(hostname), error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const server = createServer(async (request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "");
      if (url.protocol !== "http:") throw new Error("unsupported");
    } catch {
      // Not a proxy request: this is the health probe used to recognise a live proxy.
      response.writeHead(request.url === "/__agent_fast" ? 200 : 400).end("agent-fast-proxy");
      return;
    }
    const addresses = await check(url.hostname);
    const socket = addresses && await connectAny(addresses, Number(url.port || 80)).catch(() => null);
    if (!socket) {
      response.writeHead(addresses ? 502 : 403, { "content-type": "text/plain" })
        .end(addresses ? `agent-fast could not reach ${url.hostname}` : `agent-fast blocked ${url.hostname}`);
      return;
    }
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = httpRequest({
      createConnection: () => socket, path: url.pathname + url.search, method: request.method, headers,
    }, (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => response.destroy());
    response.on("close", () => { upstream.destroy(); socket.destroy(); });
    request.pipe(upstream);
  });
  server.on("connect", async (request, client, head) => {
    client.on("error", () => {});
    const target = /^(.+):([0-9]{1,5})$/.exec(request.url ?? "");
    const addresses = target ? await check(target[1]!) : null;
    const upstream = target && addresses ? await connectAny(addresses, Number(target[2])).catch(() => null) : null;
    if (!upstream) {
      client.end(`HTTP/1.1 ${addresses ? "502 Bad Gateway" : "403 Forbidden"}\r\n\r\n`);
      return;
    }
    // The browser may have given up while the host was being resolved and connected.
    if (client.destroyed) { upstream.destroy(); return; }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}

interface Sidecar { pid: number; port: number; domains: string[] }

function readSidecar(session: string): Sidecar | null {
  try {
    const parsed = JSON.parse(readFileSync(sidecarPath(session), "utf8")) as Sidecar;
    return Number.isSafeInteger(parsed.pid) && Number.isSafeInteger(parsed.port) && Array.isArray(parsed.domains) ? parsed : null;
  } catch {
    return null;
  }
}

async function alive(port: number): Promise<boolean> {
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/__agent_fast`, { signal: AbortSignal.timeout(1000) });
    return (await reply.text()) === "agent-fast-proxy";
  } catch {
    return false;
  }
}

function running(pid: number): boolean {
  try { return process.kill(pid, 0); } catch { return false; }
}

const sameDomains = (left: string[], right: string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

const ready = new Map<string, Promise<number>>();

/** Returns the port of this session's egress proxy, starting a detached one when none is running. */
export async function ensureProxy(session: string, allowedDomains: string[]): Promise<number> {
  const key = `${session}\n${[...allowedDomains].sort().join(",")}`;
  let pending = ready.get(key);
  if (pending) {
    // The proxy removes its sidecar when it exits, so a cached port is only trusted while that file names it.
    const port = await pending.catch(() => null);
    if (port !== null && readSidecar(session)?.port === port) return port;
    ready.delete(key);
    pending = undefined;
  }
  if (!pending) {
    pending = startProxy(session, allowedDomains);
    ready.set(key, pending);
    pending.catch(() => ready.delete(key));
  }
  return pending;
}

async function startProxy(session: string, allowedDomains: string[]): Promise<number> {
  const existing = readSidecar(session);
  // The health probe guards against a stale sidecar whose pid now belongs to another process.
  if (existing && running(existing.pid) && await alive(existing.port)) {
    if (sameDomains(existing.domains, allowedDomains)) return existing.port;
    throw new Error(`session ${session} is already running with a different domain allowlist; close it first`);
  }
  rmSync(sidecarPath(session), { force: true });
  spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "__proxy", session, JSON.stringify(allowedDomains)], {
    detached: true, stdio: "ignore", windowsHide: true,
  }).unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const sidecar = readSidecar(session);
    if (sidecar && await alive(sidecar.port)) {
      // Another command may have started this session's proxy first, with its own allowlist.
      if (sameDomains(sidecar.domains, allowedDomains)) return sidecar.port;
      throw new Error(`session ${session} is already running with a different domain allowlist; close it first`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("egress proxy did not start");
}

export async function stopProxy(session: string): Promise<void> {
  const sidecar = readSidecar(session);
  for (const key of ready.keys()) if (key.startsWith(`${session}\n`)) ready.delete(key);
  rmSync(blockedLogPath(session), { force: true });
  if (!sidecar) return;
  if (await alive(sidecar.port)) {
    try { process.kill(sidecar.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  rmSync(sidecarPath(session), { force: true });
}

/** Body of the detached `__proxy` process. */
export async function runProxy(session: string, allowedDomains: string[]): Promise<void> {
  // One malformed exchange must not take the session's network path down with it.
  process.on("uncaughtException", () => {});
  process.on("unhandledRejection", () => {});
  const seen = new Set<string>();
  const log = blockedLogPath(session);
  rmSync(log, { force: true });
  let lastUse = Date.now();
  const server = createProxy(allowedDomains, (host, reason) => {
    if (seen.has(host) || seen.size >= 500) return;
    seen.add(host);
    try { appendFileSync(log, `${host}\t${reason}\n`, { mode: 0o600 }); } catch { /* diagnostics only */ }
  });
  server.on("connection", () => { lastUse = Date.now(); });
  // A stable port per session lets a restarted proxy serve a browser that is still running.
  let hash = 2166136261;
  for (const character of session) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const listen = (port: number): Promise<boolean> => new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  if (!await listen(20_000 + hash % 40_000) && !await listen(0)) throw new Error("egress proxy could not listen");
  const port = (server.address() as { port: number }).port;
  const sidecar = sidecarPath(session);
  writeFileSync(`${sidecar}.${process.pid}.tmp`, JSON.stringify({ pid: process.pid, port, domains: allowedDomains }), { mode: 0o600 });
  renameSync(`${sidecar}.${process.pid}.tmp`, sidecar);
  const stop = (): void => {
    if (readSidecar(session)?.pid === process.pid) rmSync(sidecar, { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  // Exit with the engine daemon; where its pid file is never visible, exit after an idle hour instead.
  const daemonPid = join(homedir(), ".agent-browser", `${session}.pid`);
  let sawDaemon = false;
  let missing = 0;
  setInterval(() => {
    if (readSidecar(session)?.pid !== process.pid) process.exit(0);
    if (existsSync(daemonPid)) { sawDaemon = true; missing = 0; return; }
    if (sawDaemon ? ++missing >= 3 : Date.now() - lastUse > 3_600_000) stop();
  }, 3000);
}
