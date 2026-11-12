import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

// The engine's command client is a thin process that forwards one JSON line to
// its session daemon. Sending that line ourselves removes a process spawn per
// action and any command-line parsing of page-derived values. The daemon still
// enforces the action policy and launch settings it was started with.
// shortcut: message shapes match agent-browser 0.41.2 (pinned in package.json); re-verify them when upgrading.

const directory = (): string => join(homedir(), ".agent-browser");

export function daemonPid(session: string): string | null {
  try {
    return readFileSync(join(directory(), `${session}.pid`), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Translates one of our fixed-shape engine commands into the daemon's message, or null to use the command client. */
export function wireFor(command: string[]): Record<string, unknown> | null {
  const [name, a, b, c, d] = command;
  switch (name) {
    case "open": return a === undefined ? null : { action: "navigate", url: a };
    case "snapshot": {
      // ["snapshot"] or ["snapshot", "-i"], optionally scoped with "-s", <selector>.
      const scope = command.slice(a === "-i" ? 2 : 1);
      if (scope.length !== 0 && (scope.length !== 2 || scope[0] !== "-s")) return null;
      return { action: "snapshot", ...(a === "-i" ? { interactive: true } : {}), ...(scope[1] === undefined ? {} : { selector: scope[1] }) };
    }
    case "get":
      if (a === "title" || a === "url") return command.length === 2 ? { action: a } : null;
      if (a === "attr") return command.length === 4 ? { action: "getattribute", selector: b, attribute: c } : null;
      if (a === "box") return command.length === 3 ? { action: "boundingbox", selector: b } : null;
      if (command.length !== 3) return null;
      if (a === "text") return { action: "gettext", selector: b };
      if (a === "html") return { action: "innerhtml", selector: b };
      if (a === "value") return { action: "inputvalue", selector: b };
      if (a === "count") return { action: "count", selector: b };
      return null;
    case "back": case "forward": case "reload":
      return command.length === 1 ? { action: name } : null;
    case "tab":
      if (a === "new") return { action: "tab_new", ...(b === undefined ? {} : { url: b }) };
      if (a === "list") return { action: "tab_list" };
      if (a === "close") return { action: "tab_close", ...(b === undefined ? {} : { tabId: b }) };
      return a !== undefined && command.length === 2 ? { action: "tab_switch", tabId: a } : null;
    case "scroll": return { action: "scroll", direction: a, amount: Number(b) };
    case "wait": {
      // Positions are fixed by commandForTool, so a value that looks like a flag is still a value.
      if (command.length === 2) return /^[0-9]+$/.test(a ?? "") ? { action: "wait", timeout: Number(a) } : null;
      if (a === "--text" || a === "--url" || a === "--load") {
        if (command.length !== 5 || c !== "--timeout") return null;
        const timeout = Number(d);
        return a === "--text" ? { action: "wait", text: b, timeout }
          : a === "--url" ? { action: "waitforurl", url: b, timeout } : { action: "waitforloadstate", state: b, timeout };
      }
      if (command.length !== 6 || b !== "--state" || d !== "--timeout") return null;
      return { action: "wait", selector: a, state: c, timeout: Number(command[5]) };
    }
    case "frame": return a === "main" ? { action: "mainframe" } : { action: "frame", selector: a };
    case "click": case "dblclick": case "hover": case "focus": case "check": case "uncheck": case "scrollintoview":
      return command.length === 2 ? { action: name, selector: a } : null;
    case "fill": return command.length === 3 ? { action: "fill", selector: a, value: b } : null;
    case "type": return command.length === 3 ? { action: "type", selector: a, text: b } : null;
    case "press": return { action: "press", key: a };
    case "select": return command.length === 3 ? { action: "select", selector: a, values: b } : null;
    case "drag": return command.length === 3 ? { action: "drag", source: a, target: b } : null;
    case "mouse":
      if (a === "move" && command.length === 4) return { action: "mousemove", x: Number(b), y: Number(c) };
      return (a === "down" || a === "up") && command.length === 2 ? { action: `mouse${a}`, button: "left" } : null;
    case "keyboard": return a === "type" && command.length === 3 ? { action: "keyboard", subaction: "type", text: b } : null;
    case "find":
      if (a === "text" && c === "click" && d === "--exact") return { action: "getbytext", text: b, exact: true, subaction: "click" };
      if (a === "label" && c === "fill" && command.length === 5) return { action: "getbylabel", label: b, exact: false, subaction: "fill", value: d };
      return null;
    case "dialog":
      if (a !== "accept" && a !== "dismiss" && a !== "status") return null;
      return { action: "dialog", response: a, ...(b === undefined ? {} : { promptText: b }) };
    case "console": case "errors": return command.length === 1 ? { action: name, clear: false } : null;
    case "network":
      if (a !== "requests" || (command.length !== 2 && (command.length !== 4 || b !== "--filter"))) return null;
      return { action: "requests", clear: false, ...(command.length === 4 ? { filter: c } : {}) };
    case "screenshot": {
      const full = a === "--full";
      const path = full ? b : a;
      return path === undefined ? null : { action: "screenshot", annotate: false, fullPage: full, path, selector: null };
    }
    case "upload": return command.length >= 3 ? { action: "upload", selector: a, files: command.slice(2) } : null;
    case "download": return command.length === 3 ? { action: "download", selector: a, path: b } : null;
    case "record":
      if (a === "start" && b !== undefined) return { action: "recording_start", path: b };
      return a === "stop" ? { action: "recording_stop" } : null;
    default: return null;
  }
}

let counter = 0;

/** Sends one message to the session daemon. Rejects with `notSent: true` when nothing reached the daemon. */
export function daemonRequest(
  session: string, message: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal,
): Promise<{ success: boolean; data?: unknown; error?: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = connect(join(directory(), `${session}.sock`));
    let sent = false;
    let buffer = "";
    let settled = false;
    const finish = (error?: Error, value?: { success: boolean }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error) reject(Object.assign(error, { notSent: !sent }));
      else resolve(value!);
    };
    const onAbort = (): void => finish(new Error("engine command cancelled; completion is unknown"));
    const timer = setTimeout(() => finish(new Error(`engine command timed out after ${timeoutMs} ms; completion is unknown`)), timeoutMs);
    timer.unref();
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      sent = true;
      socket.write(`${JSON.stringify({ ...message, id: `af${process.pid}_${++counter}`, plugins: [] })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // A busy portal's request log runs to tens of megabytes; tools trim it before anyone reads it.
      if (buffer.length > 64_000_000) { finish(new Error("engine response exceeded output limit; completion is unknown")); return; }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const parsed = JSON.parse(buffer.slice(0, newline)) as { success?: unknown };
        if (typeof parsed.success !== "boolean") throw new Error("invalid");
        finish(undefined, parsed as { success: boolean });
      } catch {
        finish(new Error("engine returned an invalid response; completion is unknown"));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("engine connection closed; completion is unknown")));
  });
}
