import { isIP } from "node:net";

export interface UrlValidationResult {
  safe: boolean;
  reason?: string;
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
  const normalized = ip.toLowerCase();

  // Loopback ::1
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

  // Unspecified ::
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.replace("::ffff:", "");
    if (isIP(ipv4Part) === 4) {
      return isPrivateIpv4(ipv4Part);
    }
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
 */
export function validateSafePublicUrl(urlStr: string): UrlValidationResult {
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
  const cleanHost = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  // Direct localhost checks
  if (
    cleanHost === "localhost" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost === "metadata.google.internal" ||
    cleanHost === "instance-data"
  ) {
    return { safe: false, reason: `Private or internal hostname rejected: ${hostname}` };
  }

  // Check IP addresses
  const ipType = isIP(cleanHost);
  if (ipType === 4) {
    if (isPrivateIpv4(cleanHost)) {
      return { safe: false, reason: `Private IPv4 address rejected: ${cleanHost}` };
    }
  } else if (ipType === 6) {
    if (isPrivateIpv6(cleanHost)) {
      return { safe: false, reason: `Private IPv6 address rejected: ${cleanHost}` };
    }
  }

  return { safe: true };
}
