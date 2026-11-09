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
] as const) privateAddresses.addSubnet(address, prefix, "ipv6");

function isPrivateHost(host: string): boolean {
  if (!host.includes(".") && !host.includes(":")) return true;
  if (["localhost", "local", "internal"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  const version = isIP(host);
  return version !== 0 && privateAddresses.check(host, version === 4 ? "ipv4" : "ipv6");
}

export const DEFAULT_MODEL = "qwen3:4b";
export const DEFAULT_MODEL_URL = "http://127.0.0.1:11434/v1/chat/completions";

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
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  // shortcut: hostname checks cannot stop DNS rebinding or page requests; enforce egress outside the engine.
  if (isPrivateHost(host) && !allowedDomains.some((domain) => domain.toLowerCase() === host)) {
    throw new Error("private/loopback URL is blocked; explicitly allow its exact host with --allowed-domains");
  }
  return url.toString();
}

export function validateDomains(value: string | undefined): string[] {
  if (!value) return [];
  const domains = value.split(",").map((domain) => domain.trim()).filter(Boolean);
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
