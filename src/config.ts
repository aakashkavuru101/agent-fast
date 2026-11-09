import { fileURLToPath } from "node:url";

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

export function validateHttpUrl(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("URL must be HTTP(S) and contain no credentials");
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
