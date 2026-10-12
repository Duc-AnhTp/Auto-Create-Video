import { describe, it, expect } from "vitest";
import { isLoopbackPeer } from "./http-safety.js";

describe("isLoopbackPeer RFC 1122 & IPv6 Loopback Verification", () => {
  it("should recognize standard IPv4 127.0.0.0/8 loopback addresses", () => {
    expect(isLoopbackPeer("127.0.0.1")).toBe(true);
    expect(isLoopbackPeer("127.0.0.2")).toBe(true);
    expect(isLoopbackPeer("127.12.34.56")).toBe(true);
    expect(isLoopbackPeer("127.255.255.254")).toBe(true);
  });

  it("should recognize IPv6 loopback variants", () => {
    expect(isLoopbackPeer("::1")).toBe(true);
    expect(isLoopbackPeer("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackPeer("0000:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
  });

  it("should recognize IPv4-mapped IPv6 loopback variants", () => {
    expect(isLoopbackPeer("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackPeer("::ffff:127.0.0.2")).toBe(true);
    expect(isLoopbackPeer("::ffff:7f00:1")).toBe(true);
    expect(isLoopbackPeer("0:0:0:0:0:ffff:127.0.0.1")).toBe(true);
  });

  it("should reject non-loopback IP addresses", () => {
    expect(isLoopbackPeer("192.168.1.1")).toBe(false);
    expect(isLoopbackPeer("10.0.0.1")).toBe(false);
    expect(isLoopbackPeer("172.16.0.1")).toBe(false);
    expect(isLoopbackPeer("8.8.8.8")).toBe(false);
    expect(isLoopbackPeer("::2")).toBe(false);
    expect(isLoopbackPeer("fe80::1")).toBe(false);
    expect(isLoopbackPeer(undefined)).toBe(false);
    expect(isLoopbackPeer("")).toBe(false);
  });
});
