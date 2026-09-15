/**
 * companion-sso-reverse.test.ts
 *
 * Direct-function tests for the reverse SSO service (SMART → EnrollPro).
 * Seeds a throwaway SMART account + codes and cleans up afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import {
  exchangeReverseCode,
  issueAuthorizationCode,
  getReverseSsoConfig,
} from "../services/enrollproReverseSsoService";
import { CompanionSsoError } from "../lib/companionSso";

const TEST_SECRET = "test-reverse-secret-1234567890abcdef";
const TEST_CALLBACK = "http://localhost:5003/api/auth/companion-sso/smart/reverse/callback";

const originalEnv = {
  reverseSecret: process.env.SMART_SSO_REVERSE_CLIENT_SECRET,
  legacyReverseSecret: process.env.ENROLLPRO_REVERSE_CLIENT_SECRET,
  callback: process.env.ENROLLPRO_SSO_CALLBACK_URL,
};

let userId = "";

async function issueValidCode(state = "test-state"): Promise<string> {
  const { redirectUrl } = await issueAuthorizationCode(userId, {
    responseType: "code",
    clientId: "enrollpro",
    redirectUri: TEST_CALLBACK,
    state,
  });
  const url = new URL(redirectUrl);
  return url.searchParams.get("code")!;
}

beforeAll(async () => {
  process.env.SMART_SSO_REVERSE_CLIENT_SECRET = TEST_SECRET;
  delete process.env.ENROLLPRO_REVERSE_CLIENT_SECRET;
  process.env.ENROLLPRO_SSO_CALLBACK_URL = TEST_CALLBACK;

  const user = await prisma.user.create({
    data: {
      username: `sso-test-${Date.now()}`,
      password: "hashed",
      role: "ADMIN",
      status: "ACTIVE",
      firstName: "Sso",
      lastName: "Test",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.companionSsoCode.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });

  if (originalEnv.reverseSecret === undefined) delete process.env.SMART_SSO_REVERSE_CLIENT_SECRET;
  else process.env.SMART_SSO_REVERSE_CLIENT_SECRET = originalEnv.reverseSecret;

  if (originalEnv.legacyReverseSecret === undefined) delete process.env.ENROLLPRO_REVERSE_CLIENT_SECRET;
  else process.env.ENROLLPRO_REVERSE_CLIENT_SECRET = originalEnv.legacyReverseSecret;

  if (originalEnv.callback === undefined) delete process.env.ENROLLPRO_SSO_CALLBACK_URL;
  else process.env.ENROLLPRO_SSO_CALLBACK_URL = originalEnv.callback;
});

describe("reverse SSO — authorization", () => {
  it("reports configured when both the secret and callback are set", () => {
    const config = getReverseSsoConfig();
    expect(config.configured).toBe(true);
    expect(config.callback).toBe(TEST_CALLBACK);
  });

  it("issues a 43-char single-use code and echoes state unchanged", async () => {
    const { redirectUrl } = await issueAuthorizationCode(userId, {
      responseType: "code",
      clientId: "enrollpro",
      redirectUri: TEST_CALLBACK,
      state: "opaque-state-123",
    });
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(TEST_CALLBACK);
    expect(url.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBe("opaque-state-123");
  });

  it("accepts the deployed EnrollPro client_id alias end to end", async () => {
    const { redirectUrl } = await issueAuthorizationCode(userId, {
      responseType: "code",
      clientId: "enrollpro_client_id",
      redirectUri: TEST_CALLBACK,
      state: "alias-state",
    });
    const code = new URL(redirectUrl).searchParams.get("code")!;
    const result = await exchangeReverseCode({
      bearer: TEST_SECRET,
      code,
      clientId: "enrollpro_client_id",
      redirectUri: TEST_CALLBACK,
    });
    expect(result.success).toBe(true);
    expect(result.issuer).toBe("SMART");
  });

  it("rejects unknown clients, unregistered redirect URIs, and missing state", async () => {
    await expect(issueAuthorizationCode(userId, {
      responseType: "code",
      clientId: "somebody-else",
      redirectUri: TEST_CALLBACK,
      state: "s",
    })).rejects.toThrowError(CompanionSsoError);

    await expect(issueAuthorizationCode(userId, {
      responseType: "code",
      clientId: "enrollpro",
      redirectUri: "https://evil.example/callback",
      state: "s",
    })).rejects.toThrowError(CompanionSsoError);

    await expect(issueAuthorizationCode(userId, {
      responseType: "code",
      clientId: "enrollpro",
      redirectUri: TEST_CALLBACK,
      state: "",
    })).rejects.toThrowError(CompanionSsoError);
  });
});

describe("reverse SSO — exchange", () => {
  it("returns the SMART identity assertion for a valid code", async () => {
    const code = await issueValidCode("state-a");
    const result = await exchangeReverseCode({
      bearer: TEST_SECRET,
      code,
      clientId: "enrollpro",
      redirectUri: TEST_CALLBACK,
    });

    expect(result.success).toBe(true);
    expect(result.issuer).toBe("SMART");
    expect(result.identity.subject).toBe(`SMART_USER:${userId}`);
    expect(result.identity.employeeId).toBeTruthy();
    expect(result.identity.roles).toContain("SYSTEM_ADMIN");
    expect(result.activeSchoolYear.id).toBeTypeOf("number");
    expect(result.activeSchoolYear.yearLabel).toMatch(/^\d{4}-\d{4}$/);
  });

  it("consumes the code exactly once (replay rejected)", async () => {
    const code = await issueValidCode("state-b");
    await exchangeReverseCode({ bearer: TEST_SECRET, code, clientId: "enrollpro", redirectUri: TEST_CALLBACK });
    await expect(exchangeReverseCode({
      bearer: TEST_SECRET,
      code,
      clientId: "enrollpro",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CODE_INVALID" });
  });

  it("rejects a wrong bearer secret", async () => {
    const code = await issueValidCode("state-c");
    await expect(exchangeReverseCode({
      bearer: "wrong-secret",
      code,
      clientId: "enrollpro",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CLIENT_INVALID" });
  });

  it("rejects a mismatched redirect URI or client id", async () => {
    const code = await issueValidCode("state-d");
    await expect(exchangeReverseCode({
      bearer: TEST_SECRET,
      code,
      clientId: "enrollpro",
      redirectUri: "https://evil.example/callback",
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CODE_INVALID" });
  });

  it("rejects expired codes", async () => {
    const code = await issueValidCode("state-e");
    await prisma.companionSsoCode.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(exchangeReverseCode({
      bearer: TEST_SECRET,
      code,
      clientId: "enrollpro",
      redirectUri: TEST_CALLBACK,
    })).rejects.toMatchObject({ code: "COMPANION_SSO_CODE_INVALID" });
  });

  it("rejects inactive accounts", async () => {
    const code = await issueValidCode("state-f");
    await prisma.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
    try {
      await expect(exchangeReverseCode({
        bearer: TEST_SECRET,
        code,
        clientId: "enrollpro",
        redirectUri: TEST_CALLBACK,
      })).rejects.toMatchObject({ code: "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE" });
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    }
  });
});
