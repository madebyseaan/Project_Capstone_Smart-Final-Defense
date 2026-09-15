import { describe, it, expect } from "vitest";
import {
  CompanionSsoError,
  SMART_SYSTEM,
  generateAuthorizationCode,
  hashCode,
  isValidCodeShape,
  secretsMatch,
} from "../lib/companionSso";
import {
  hasAllowedEnrollProRole,
  validateExchangeResponse,
} from "../services/enrollproSsoService";

const VALID_CODE = "A".repeat(43);

function validExchangeBody(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    companion: "SMART",
    identity: {
      subject: "ENROLLPRO_USER:1",
      userId: 1,
      employeeId: "1234501",
      lrn: null,
      firstName: "Jose",
      middleName: null,
      lastName: "Rizal",
      roles: ["SYSTEM_ADMIN"],
    },
    activeSchoolYear: { id: 1, yearLabel: "2029-2030" },
    authenticatedAt: "2026-09-07T10:00:15.000Z",
    ...overrides,
  };
}

describe("companionSso crypto helpers", () => {
  it("generates 43-character base64url codes", () => {
    const code = generateAuthorizationCode();
    expect(code).toHaveLength(43);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates unique codes", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateAuthorizationCode()));
    expect(codes.size).toBe(50);
  });

  it("validates only 43-character base64url code shapes", () => {
    expect(isValidCodeShape(VALID_CODE)).toBe(true);
    expect(isValidCodeShape("short")).toBe(false);
    expect(isValidCodeShape("A".repeat(44))).toBe(false);
    expect(isValidCodeShape("A".repeat(42) + "!")).toBe(false);
    expect(isValidCodeShape(undefined)).toBe(false);
    expect(isValidCodeShape(12345)).toBe(false);
  });

  it("hashes codes with SHA-256 without storing the plaintext", () => {
    const hash = hashCode(VALID_CODE);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(VALID_CODE);
    expect(hashCode(VALID_CODE)).toBe(hash);
    expect(hashCode("B".repeat(43))).not.toBe(hash);
  });

  it("compares secrets in constant time and rejects length mismatches", () => {
    expect(secretsMatch("secret-value-123", "secret-value-123")).toBe(true);
    expect(secretsMatch("secret-value-123", "secret-value-124")).toBe(false);
    expect(secretsMatch("short", "much-longer-secret")).toBe(false);
    expect(secretsMatch(null, "secret")).toBe(false);
    expect(secretsMatch("secret", null)).toBe(false);
  });
});

describe("EnrollPro exchange validation (Flow A)", () => {
  it("accepts a well-formed SMART assertion", () => {
    const result = validateExchangeResponse(validExchangeBody());
    expect(result.identity.subject).toBe("ENROLLPRO_USER:1");
    expect(result.activeSchoolYear).toEqual({ id: 1, yearLabel: "2029-2030" });
  });

  it("rejects an assertion for another companion", () => {
    expect(() => validateExchangeResponse(validExchangeBody({ companion: "AIMS" })))
      .toThrowError(CompanionSsoError);
  });

  it("rejects a response without success", () => {
    expect(() => validateExchangeResponse(validExchangeBody({ success: false })))
      .toThrowError(CompanionSsoError);
  });

  it("rejects a missing identity subject", () => {
    const body = validExchangeBody();
    (body.identity as Record<string, unknown>).subject = "";
    expect(() => validateExchangeResponse(body)).toThrowError(/IDENTITY_INCOMPLETE|incomplete/);
  });

  it("rejects missing roles and unknown-only roles", () => {
    const noRoles = validExchangeBody();
    (noRoles.identity as Record<string, unknown>).roles = [];
    expect(() => validateExchangeResponse(noRoles)).toThrowError(/ROLE_DENIED|role/);

    const learnerRole = validExchangeBody();
    (learnerRole.identity as Record<string, unknown>).roles = ["LEARNER"];
    expect(() => validateExchangeResponse(learnerRole)).toThrowError(/ROLE_DENIED|role/);
  });

  it("rejects a missing active school year", () => {
    expect(() => validateExchangeResponse(validExchangeBody({ activeSchoolYear: null })))
      .toThrowError(/ACTIVE_SCHOOL_YEAR_REQUIRED|school year/);
  });

  it("requires the companion name to be SMART", () => {
    expect(SMART_SYSTEM).toBe("SMART");
  });
});

describe("EnrollPro role gating", () => {
  it("allows staff-workspace roles", () => {
    expect(hasAllowedEnrollProRole(["SYSTEM_ADMIN"])).toBe(true);
    expect(hasAllowedEnrollProRole(["HEAD_REGISTRAR"])).toBe(true);
    expect(hasAllowedEnrollProRole(["TEACHER"])).toBe(true);
    expect(hasAllowedEnrollProRole(["CLASS_ADVISER"])).toBe(true);
  });

  it("denies learner-only or unknown roles", () => {
    expect(hasAllowedEnrollProRole(["LEARNER"])).toBe(false);
    expect(hasAllowedEnrollProRole([])).toBe(false);
    expect(hasAllowedEnrollProRole(undefined)).toBe(false);
  });
});
