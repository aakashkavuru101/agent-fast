import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export async function startMcp(args = []) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), ...args, "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 0;
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr = (stderr + chunk).slice(-4000));
  const rejectAll = (error) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  child.on("error", rejectAll);
  child.stdin.on("error", rejectAll);
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => {
    rejectAll(new Error(`MCP exited ${code ?? signal}: ${stderr}`));
    resolve(code);
  }));
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      item.resolve(message);
    } catch (error) { rejectAll(error); }
  });
  const request = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  };
  const close = async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await exited; }
    finally { clearTimeout(timer); reader.close(); }
  };
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-fast-check", version: "1" } });
    if (initialized.error) throw new Error(JSON.stringify(initialized.error));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return { child, request, close, exited, tool: (name, args = {}) => request("tools/call", { name, arguments: args }) };
  } catch (error) {
    await close();
    throw error;
  }
}
