import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BlockList, isIP } from "node:net";

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
  // Prefixes that embed an IPv4 address (NAT64, 6to4, Teredo) can reach private IPv4 hosts.
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16], ["2001::", 32], ["::ffff:0:0:0", 96], ["fec0::", 10],
] as const) privateAddresses.addSubnet(address, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  return version !== 0 && privateAddresses.check(address, version === 4 ? "ipv4" : "ipv6");
}

export function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function isPrivateHost(host: string): boolean {
  if (!host.includes(".") && !host.includes(":")) return true;
  if (["localhost", "local", "internal"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  return isPrivateAddress(host);
}

export function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((domain) => {
    const pattern = domain.toLowerCase();
    // "*.example.com" covers example.com and every subdomain.
    return pattern.startsWith("*.") ? host === pattern.slice(2) || host.endsWith(pattern.slice(1)) : host === pattern;
  });
}

// An exact allowlist entry is the explicit opt-in for a private or loopback host.
export function hostExplicitlyAllowed(host: string, domains: string[]): boolean {
  // "*" is a legal URL host character, so a wildcard entry must never count as an exact match.
  return domains.some((domain) => !domain.startsWith("*.") && domain.toLowerCase() === host);
}

// Sign-in, portal, API, and static-asset hosts used by Microsoft 365 and Azure.
export const DOMAIN_PRESETS: Record<string, string[]> = {
  microsoft: [
    "*.microsoft.com", "*.microsoftonline.com", "*.microsoftonline-p.com", "*.msauth.net", "*.msftauth.net",
    "*.msauthimages.net", "*.msftauthimages.net", "*.live.com", "*.live.net", "*.office.com", "*.office.net",
    "*.office365.com", "*.cloud.microsoft", "*.static.microsoft", "*.powerapps.com", "*.powerautomate.com",
    "*.powerplatform.com", "*.powerplatformusercontent.com", "*.dynamics.com", "*.sharepoint.com",
    "*.sharepointonline.com", "*.azure.com", "*.azure.net", "*.azureedge.net", "*.azurefd.net",
    "*.azure-apim.net", "*.azure-apihub.net", "*.windows.net", "*.windows.com", "*.msecnd.net", "*.msocdn.com", "*.svc.ms",
    "*.gfx.ms", "*.akamaized.net", "*.onmicrosoft.com", "*.microsoftazuread-sso.com", "*.powerbi.com",
    "*.visualstudio.com", "*.msedge.net", "*.bing.com",
  ],
};

/** Agent-fast's own state: proxy sidecars, verification markers, and artifacts. */
let directory: string | undefined;
export function stateDirectory(): string {
  if (!directory) {
    directory = join(homedir(), ".agent-fast");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return directory;
}

/** Installed Chromium-based browsers, most common first. Chrome for Testing stays the engine's own fallback. */
export function browserCandidates(): string[] {
  if (process.platform === "darwin") {
    const apps = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Brave Browser.app/Contents/MacOS/Brave Browser",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Chromium.app/Contents/MacOS/Chromium"];
    return apps.flatMap((app) => [join("/Applications", app), join(homedir(), "Applications", app)]);
  }
  if (process.platform === "win32") {
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter((root): root is string => Boolean(root));
    const apps = ["Google\\Chrome\\Application\\chrome.exe", "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Microsoft\\Edge\\Application\\msedge.exe", "Chromium\\Application\\chrome.exe"];
    return apps.flatMap((app) => roots.map((root) => join(root, app)));
  }
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return ["google-chrome", "google-chrome-stable", "brave-browser", "microsoft-edge", "chromium", "chromium-browser"]
    .flatMap((name) => directories.map((directory) => join(directory, name)));
}

export function findBrowser(candidates = browserCandidates()): string | undefined {
  return candidates.find((path) => existsSync(path));
}

export const DEFAULT_MODEL = "qwen3:4b";
export const DEFAULT_MODEL_URL = "http://127.0.0.1:11434/v1/chat/completions";

/** Where a model lives when no URL is given: the vendor by name, otherwise a local Ollama. */
export function defaultModelUrl(model: string): string {
  if (/^claude-/.test(model)) return "https://api.anthropic.com";
  if (/^(gpt-|o[1-9])/.test(model)) return "https://api.openai.com/v1/chat/completions";
  if (/^gemini-/.test(model)) return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  return DEFAULT_MODEL_URL;
}

/** The vendor's key, only when the request goes to that vendor's own API. */
export function defaultApiKey(model: string, endpoint: string): string | undefined {
  if (process.env.AGENT_FAST_API_KEY) return process.env.AGENT_FAST_API_KEY;
  if (endpoint !== defaultModelUrl(model)) return undefined;
  if (/^claude-/.test(model)) return process.env.ANTHROPIC_API_KEY;
  if (/^gemini-/.test(model)) return process.env.GEMINI_API_KEY;
  if (/^(gpt-|o[1-9])/.test(model)) return process.env.OPENAI_API_KEY;
  return undefined;
}

export function parsePositiveInteger(value: string, name: string, maximum: number): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

export function validateSession(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error("session must contain only letters, numbers, underscores, and hyphens");
  }
  return value;
}

export function validateHttpUrl(value: string, allowedDomains: string[] = []): string {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("URL must be HTTP(S) and contain no credentials");
  }
  const host = normalizeHost(url.hostname);
  // An early, readable error only: the egress proxy enforces the same rules on every request after DNS resolution.
  if (isPrivateHost(host) && !hostExplicitlyAllowed(host, allowedDomains)) {
    throw new Error("private/loopback URL is blocked; explicitly allow its exact host with --allowed-domains");
  }
  if (allowedDomains.length > 0 && !hostMatches(host, allowedDomains)) {
    throw new Error(`${host} is not in the allowed domains`);
  }
  return url.toString();
}

export function validateDomains(value: string | undefined, presets: string[] = []): string[] {
  const preset = presets.flatMap((name) => {
    const entries = DOMAIN_PRESETS[name];
    if (!entries) throw new Error(`unknown --allow-preset: ${name} (available: ${Object.keys(DOMAIN_PRESETS).join(", ")})`);
    return entries;
  });
  if (!value) return preset;
  const domains = [...preset, ...value.split(",").map((domain) => domain.trim()).filter(Boolean)];
  if (domains.length === 0) throw new Error("allowed-domains cannot be empty");
  for (const domain of domains) {
    const hostname = domain.startsWith("*.") ? domain.slice(2) : domain;
    if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname)) {
      throw new Error(`invalid domain pattern: ${domain}`);
    }
  }
  return [...new Set(domains)];
}

export function modelEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("model URL must use HTTPS, except on loopback HTTP");
  }
  if (url.username || url.password) throw new Error("model URL must not contain credentials");
  if (url.pathname.endsWith("/v1") || url.pathname.endsWith("/v1/")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  }
  return url.toString();
}

export function policyPath(mode: "read-only" | "act"): string {
  return fileURLToPath(new URL(`../policy/${mode}.json`, import.meta.url));
}
