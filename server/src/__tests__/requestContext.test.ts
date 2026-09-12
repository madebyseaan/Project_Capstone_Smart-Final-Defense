import { describe, it, expect } from "vitest";
import {
  normalizeIp,
  classifyNetwork,
  parseUserAgent,
} from "../lib/requestContext";

describe("normalizeIp", () => {
  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:192.168.1.5")).toBe("192.168.1.5");
  });

  it("maps IPv6 loopback to 127.0.0.1", () => {
    expect(normalizeIp("::1")).toBe("127.0.0.1");
  });

  it("takes the first hop of an X-Forwarded-For list", () => {
    expect(normalizeIp("203.0.113.9, 10.0.0.1")).toBe("203.0.113.9");
  });

  it("falls back to unknown for empty input", () => {
    expect(normalizeIp(undefined)).toBe("unknown");
    expect(normalizeIp("")).toBe("unknown");
  });
});

describe("classifyNetwork", () => {
  it("classifies Tailscale CGNAT range", () => {
    expect(classifyNetwork("100.64.0.1")).toBe("Tailscale");
    expect(classifyNetwork("100.127.255.255")).toBe("Tailscale");
  });

  it("does not classify outside the Tailscale range", () => {
    expect(classifyNetwork("100.63.0.1")).toBe("Public Internet");
    expect(classifyNetwork("100.128.0.1")).toBe("Public Internet");
  });

  it("classifies School LAN ranges", () => {
    expect(classifyNetwork("10.0.0.5")).toBe("School LAN");
    expect(classifyNetwork("192.168.1.20")).toBe("School LAN");
    expect(classifyNetwork("172.16.4.4")).toBe("School LAN");
    expect(classifyNetwork("172.31.255.1")).toBe("School LAN");
  });

  it("does not classify 172.x outside the private range", () => {
    expect(classifyNetwork("172.15.0.1")).toBe("Public Internet");
    expect(classifyNetwork("172.32.0.1")).toBe("Public Internet");
  });

  it("classifies loopback and public", () => {
    expect(classifyNetwork("127.0.0.1")).toBe("Localhost");
    expect(classifyNetwork("8.8.8.8")).toBe("Public Internet");
  });

  it("classifies unknown", () => {
    expect(classifyNetwork("unknown")).toBe("Unknown");
  });
});

describe("parseUserAgent", () => {
  const chromeWin =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  it("parses Chrome on Windows as Desktop", () => {
    const parsed = parseUserAgent(chromeWin);
    expect(parsed.browser).toBe("Chrome 131");
    expect(parsed.os).toBe("Windows 10/11");
    expect(parsed.deviceType).toBe("Desktop");
  });

  it("prefers Edge over Chrome", () => {
    const edge = chromeWin.replace("Chrome/131.0.0.0", "Edg/131.0.0.0");
    expect(parseUserAgent(edge).browser).toBe("Edge 131");
  });

  it("parses iPhone Safari as Mobile on iOS", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const parsed = parseUserAgent(iphone);
    expect(parsed.os).toBe("iOS");
    expect(parsed.deviceType).toBe("Mobile");
    expect(parsed.browser).toBe("Safari 17");
  });

  it("detects bots", () => {
    expect(parseUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)").deviceType).toBe("Bot");
  });

  it("handles empty user agent", () => {
    expect(parseUserAgent("")).toEqual({ browser: null, os: null, deviceType: "Unknown" });
  });
});
