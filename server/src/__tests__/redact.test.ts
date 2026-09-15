/**
 * redact.test.ts — P1-9 pure tests for log redaction helpers.
 */
import { describe, it, expect } from "vitest";
import { maskId, maskEmail } from "../lib/redact";

describe("P1-9 — maskId", () => {
  it("keeps only the last N characters", () => {
    expect(maskId("123456789012")).toBe("********9012");
  });
  it("fully masks short values and handles empty input", () => {
    expect(maskId("12")).toBe("**");
    expect(maskId("")).toBe("(none)");
    expect(maskId(null)).toBe("(none)");
    expect(maskId(undefined)).toBe("(none)");
  });
});

describe("P1-9 — maskEmail", () => {
  it("reveals only the first two local characters and the domain", () => {
    expect(maskEmail("1000001@deped.gov.ph")).toBe("10*****@deped.gov.ph");
  });
  it("falls back to maskId for non-email values", () => {
    expect(maskEmail("1000001")).toBe("***0001");
    expect(maskEmail("")).toBe("(none)");
  });
});
