import { isIP } from "node:net";
import { Agent as HttpAgent, type AgentOptions } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import axios, { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from "axios";

export interface UrlValidationResult {
  safe: boolean;
  reason?: string;
}

export interface UrlSecurityOptions {
  httpsOnly?: boolean;
  allowLocalhost?: boolean;
  timeoutMs?: number;
}

/**
 * Checks if an IPv4 address is in a private, loopback, or link-local range.
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP treated as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8 - Current network
  if (a === 0) return true;

  // 10.0.0.0/8 - Private-Use
  if (a === 10) return true;

  // 127.0.0.0/8 - Loopback
  if (a === 127) return true;

  // 169.254.0.0/16 - Link-Local / Cloud Metadata (169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 - Private-Use (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 - Private-Use
  if (a === 192 && b === 168) return true;

  // Special-use and benchmarking ranges are not valid public fetch targets.
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 192 && b === 88 && parts[2] === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 100.64.0.0/10 - Shared Address Space
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 224.0.0.0/4 - Multicast
  if (a >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address is private, loopback, or link-local.
 */
function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0];

  // Loopback ::1
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

  // Unspecified ::
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 addresses can be written in dotted or hexadecimal form.
  if (normalized.startsWith("::ffff:")) {
    const tail = normalized.replace("::ffff:", "");
    let ipv4Part = tail;
    if (isIP(tail) !== 4) {
      const words = tail.split(":");
      if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
        const high = Number.parseInt(words[0], 16);
        const low = Number.parseInt(words[1], 16);
        ipv4Part = [high >> 8, high & 255, low >> 8, low & 255].join(".");
      }
    }
    if (isIP(ipv4Part) === 4) {
      return isPrivateIpv4(ipv4Part);
    }
    return true;
  }

  // Unique local addresses fc00::/7 (fc00:: - fdff::)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // Link-local unicast fe80::/10 (fe80:: - febf::)
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

/**
 * Validates that an external URL does not target private network services,
 * loopback, or cloud instance metadata (SSRF protection).
 * Supports { allowLocalhost: true } for controlled mock local testing servers.
 */
export function validateSafePublicUrl(
  urlStr: string,
  options?: UrlSecurityOptions
): UrlValidationResult {
  if (!urlStr || typeof urlStr !== "string") {
    return { safe: false, reason: "Empty or invalid URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { safe: false, reason: "Malformed URL" };
  }

  // Only allow HTTP and HTTPS
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `Disallowed URL protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // Strip brackets from IPv6 hostnames
  const cleanHost = (hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname).replace(/\.+$/, "");

  const allowLocal = options?.allowLocalhost ?? false;

  // Direct localhost checks
  if (
    cleanHost === "localhost" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost === "metadata.google.internal" ||
    cleanHost === "instance-data"
  ) {
    if (allowLocal && (cleanHost === "localhost" || cleanHost.endsWith(".localhost"))) {
      return { safe: true };
    }
    return { safe: false, reason: `Private or internal hostname rejected: ${hostname}` };
  }

  // Check IP addresses
  const ipType = isIP(cleanHost);
  if (ipType === 4) {
    if (isPrivateIpv4(cleanHost)) {
      if (allowLocal && (cleanHost === "127.0.0.1" || cleanHost.startsWith("127."))) {
        return { safe: true };
      }
      return { safe: false, reason: `Private IPv4 address rejected: ${cleanHost}` };
    }
  } else if (ipType === 6) {
    if (isPrivateIpv6(cleanHost)) {
      if (allowLocal && (cleanHost === "::1" || cleanHost === "0:0:0:0:0:0:0:1")) {
        return { safe: true };
      }
      return { safe: false, reason: `Private IPv6 address rejected: ${cleanHost}` };
    }
  }

  return { safe: true };
}

/**
 * Performs connection-level DNS pre-resolution checks to prevent DNS-rebinding attacks.
 * Resolves all A and AAAA records for the hostname and ensures none point to private IP spaces.
 */
export async function validateSafePublicUrlWithDns(
  urlStr: string,
  options?: UrlSecurityOptions
): Promise<UrlValidationResult> {
  const basic = validateSafePublicUrl(urlStr, options);
  if (!basic.safe) return basic;

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { safe: false, reason: "Malformed URL" };
  }

  const hostname = parsed.hostname.toLowerCase().trim();
  const cleanHost = (hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname).replace(/\.+$/, "");

  // Direct IP addresses already verified by validateSafePublicUrl
  if (isIP(cleanHost)) {
    return basic;
  }

  const allowLocal = options?.allowLocalhost ?? false;
  if (allowLocal && (cleanHost === "localhost" || cleanHost.endsWith(".localhost"))) {
    return { safe: true };
  }

  try {
    const addresses = await lookup(cleanHost, { all: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, reason: `DNS resolution failed for hostname: ${cleanHost}` };
    }

    for (const record of addresses) {
      const ip = record.address;
      const family = record.family;
      if (family === 4 && isPrivateIpv4(ip)) {
        if (allowLocal && (ip === "127.0.0.1" || ip.startsWith("127."))) {
          continue;
        }
        return {
          safe: false,
          reason: `DNS resolution for ${cleanHost} returned private IPv4: ${ip}`,
        };
      }
      if (family === 6 && isPrivateIpv6(ip)) {
        if (allowLocal && (ip === "::1" || ip === "0:0:0:0:0:0:0:1")) {
          continue;
        }
        return {
          safe: false,
          reason: `DNS resolution for ${cleanHost} returned private IPv6: ${ip}`,
        };
      }
    }

    return { safe: true };
  } catch (err: any) {
    return {
      safe: false,
      reason: `DNS lookup error for ${cleanHost}: ${err.message}`,
    };
  }
}

/**
 * Creates per-request agents that validate and pin DNS results at socket lookup time.
 * This closes the gap between a DNS pre-check and the later connection, and validates
 * each redirect host because follow-redirects reuses the agent for every hop.
 */
export function createSafeHttpAgents(options?: UrlSecurityOptions): {
  httpAgent: HttpAgent;
  httpsAgent: HttpsAgent;
  destroy: () => void;
} {
  const allowLocal = options?.allowLocalhost ?? false;
  const safeLookup: NonNullable<AgentOptions["lookup"]> = (hostname, lookupOptions, callback) => {
    const cleanHost = hostname.toLowerCase().trim().replace(/\.+$/, "");
    dnsLookup(cleanHost, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }

      const localName = cleanHost === "localhost" || cleanHost.endsWith(".localhost");
      const unsafe = addresses.find(({ address, family }) => {
        const privateAddress = family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
        const loopback = family === 4
          ? address.startsWith("127.")
          : address.toLowerCase() === "::1" || address.toLowerCase() === "0:0:0:0:0:0:0:1";
        return privateAddress && !(allowLocal && localName && loopback);
      });
      if (unsafe) {
        const denied = Object.assign(new Error(`Private DNS target rejected: ${cleanHost} -> ${unsafe.address}`), { code: "EPERM" }) as NodeJS.ErrnoException;
        callback(denied, "", 0);
        return;
      }

      const family = typeof lookupOptions === "number"
        ? lookupOptions
        : lookupOptions.family === "IPv4" ? 4 : lookupOptions.family === "IPv6" ? 6 : lookupOptions.family ?? 0;
      const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
      if (candidates.length === 0) {
        callback(Object.assign(new Error(`No public DNS address for ${cleanHost}`), { code: "EAI_NONAME" }) as NodeJS.ErrnoException, "", 0);
        return;
      }

      if (typeof lookupOptions !== "number" && lookupOptions.all) {
        callback(null, candidates);
      } else {
        callback(null, candidates[0].address, candidates[0].family);
      }
    });
  };

  const httpAgent = new HttpAgent({ keepAlive: false, lookup: safeLookup });
  const httpsAgent = new HttpsAgent({ keepAlive: false, lookup: safeLookup });
  return { httpAgent, httpsAgent, destroy: () => { httpAgent.destroy(); httpsAgent.destroy(); } };
}

/** Makes GET requests while validating each redirect before opening its socket. */
export async function safeHttpGet<T = unknown>(
  initialUrl: string,
  config: AxiosRequestConfig,
  agents: ReturnType<typeof createSafeHttpAgents>,
  options?: UrlSecurityOptions,
): Promise<AxiosResponse<T>> {
  let currentUrl = initialUrl;
  let requestConfig: AxiosRequestConfig = { ...config };
  const redirectStatuses = new Set([301, 302, 303, 307, 308]);
  for (let redirects = 0; ; redirects++) {
    if(options?.httpsOnly && new URL(currentUrl).protocol !== "https:") throw new Error("HTTPS_DOWNLOAD_REQUIRED");
    const check = validateSafePublicUrl(currentUrl, options);
    if (!check.safe) throw new Error(`SSRF redirect rejected: ${check.reason}`);
    const response = await axios.get<T>(currentUrl, {
      ...requestConfig,
      maxRedirects: 0,
      validateStatus: (status) => status < 400,
      proxy: false,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    });
    if (!redirectStatuses.has(response.status)) return response;
    const location = response.headers.location;
    (response.data as { destroy?: () => void } | undefined)?.destroy?.();
    if (!location) throw new Error(`Redirect response ${response.status} has no Location header`);
    if (redirects >= 5) throw new Error("Too many redirects");
    try {
      const previous = new URL(currentUrl);
      const next = new URL(location, previous);
      if (next.origin !== previous.origin) {
        const headers = AxiosHeaders.from(requestConfig.headers as Parameters<typeof AxiosHeaders.from>[0]);
        headers.delete("Authorization");
        headers.delete("Cookie");
        headers.delete("Proxy-Authorization");
        requestConfig = { ...requestConfig, headers, auth: undefined };
      }
      currentUrl = next.toString();
    } catch {
      throw new Error("Malformed redirect URL target");
    }
  }
}

/**
 * Validates redirect target URLs during HTTP requests to prevent SSRF via 301/302 redirects.
 */
export async function validateRedirectUrl(
  initialUrl: string,
  redirectUrl: string,
  options?: UrlSecurityOptions
): Promise<UrlValidationResult> {
  let targetUrl: string;
  try {
    targetUrl = new URL(redirectUrl, initialUrl).toString();
  } catch {
    return { safe: false, reason: "Malformed redirect URL target" };
  }

  return validateSafePublicUrlWithDns(targetUrl, options);
}
