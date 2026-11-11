import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { getActiveSchoolYear } from "../lib/schoolYearResolver";
import {
  SSO_CODE_TTL_MS,
  generateAuthorizationCode,
  hashCode,
  isValidCodeShape,
  secretsMatch,
} from "../lib/companionSso";

const DEFAULT_AIMS_BASE = "http://100.92.245.14:5000/api/v1";
const AIMS_REVERSE_AUDIENCE = "aims";

export class AimsReverseSsoError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AimsReverseSsoError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AimsReverseIdentity {
  id: string | null;
  role: "TEACHER" | "ADMIN";
  firstName: string;
  lastName: string;
  email: string | null;
  username: string;
  lrn: null;
}

export interface AimsReverseExchangeResponse {
  success: true;
  data: {
    identity: AimsReverseIdentity;
    context: {
      school: { id: string };
      term: { schoolYear: string; termIndex: number };
      class: null;
    };
  };
}

function aimsBaseUrl(): string {
  const configured = (process.env.AIMS_URL ?? process.env.AIMS_BASE_URL ?? DEFAULT_AIMS_BASE).trim();
  return configured.replace(/\/+$/, "");
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getAimsReverseConfig(): {
  callbackUrl: string | null;
  clientId: string;
  clientSecret: string | null;
  schoolId: string | null;
  configured: boolean;
} {
  const explicitCallback = (process.env.AIMS_SSO_REVERSE_CALLBACK_URL ?? "").trim();
  const callbackCandidate = explicitCallback || `${aimsBaseUrl()}/auth/smart/callback`;
  const callbackUrl = callbackCandidate && isValidUrl(callbackCandidate) ? callbackCandidate : null;
  const clientId = (process.env.AIMS_SSO_REVERSE_CLIENT_ID ?? "aims").trim() || "aims";
  const clientSecret = (process.env.AIMS_SSO_REVERSE_CLIENT_SECRET ?? "").trim() || null;
  const schoolId = (process.env.AIMS_SSO_SCHOOL_ID ?? "").trim() || null;
  return {
    callbackUrl,
    clientId,
    clientSecret,
    schoolId,
    configured: Boolean(callbackUrl && clientSecret),
  };
}

export async function issueAimsReverseCode(userId: string): Promise<{ launchUrl: string }> {
  const { callbackUrl, clientSecret, configured } = getAimsReverseConfig();
  if (!configured || !callbackUrl || !clientSecret) {
    throw new AimsReverseSsoError(503, "SSO_NOT_CONFIGURED", "AIMS reverse SSO is not configured.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new AimsReverseSsoError(403, "ACCOUNT_UNAVAILABLE", "The SMART account is not active.");
  }
  if (user.role !== "ADMIN" && user.role !== "TEACHER") {
    throw new AimsReverseSsoError(403, "ROLE_UNSUPPORTED", "AIMS sign-in is available to teachers and administrators only.");
  }

  const code = generateAuthorizationCode();
  await prisma.companionSsoCode.create({
    data: {
      codeHash: hashCode(code),
      userId,
      audience: AIMS_REVERSE_AUDIENCE,
      redirectUri: callbackUrl,
      expiresAt: new Date(Date.now() + SSO_CODE_TTL_MS),
    },
  });

  const launchUrl = new URL(callbackUrl);
  launchUrl.searchParams.set("code", code);
  return { launchUrl: launchUrl.toString() };
}

export async function exchangeAimsReverseCode(input: {
  clientId: string;
  clientSecret: string;
  code: unknown;
}): Promise<AimsReverseExchangeResponse & { userId: string }> {
  const { callbackUrl, clientId, clientSecret, schoolId, configured } = getAimsReverseConfig();
  if (!configured || !callbackUrl || !clientSecret) {
    throw new AimsReverseSsoError(503, "SSO_NOT_CONFIGURED", "AIMS reverse SSO is not configured.");
  }

  if (input.clientId !== clientId || !secretsMatch(input.clientSecret, clientSecret)) {
    throw new AimsReverseSsoError(401, "INVALID_CLIENT", "Invalid AIMS SSO client credentials.");
  }

  if (!isValidCodeShape(input.code)) {
    throw new AimsReverseSsoError(400, "INVALID_CODE", "A valid sign-in code is required.");
  }

  const codeHash = hashCode(input.code);
  const now = new Date();

  const record = await prisma.companionSsoCode.findUnique({ where: { codeHash } });
  if (!record || record.audience !== AIMS_REVERSE_AUDIENCE || record.redirectUri !== callbackUrl) {
    throw new AimsReverseSsoError(400, "INVALID_CODE", "The sign-in code is invalid.");
  }
  if (record.consumedAt) {
    throw new AimsReverseSsoError(409, "CODE_ALREADY_USED", "The sign-in code was already used.");
  }
  if (record.expiresAt <= now) {
    throw new AimsReverseSsoError(410, "CODE_EXPIRED", "The sign-in code has expired.");
  }

  const claimed = await prisma.companionSsoCode.updateMany({
    where: {
      id: record.id,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  if (claimed.count !== 1) {
    const latest = await prisma.companionSsoCode.findUnique({ where: { id: record.id } });
    if (latest?.consumedAt) {
      throw new AimsReverseSsoError(409, "CODE_ALREADY_USED", "The sign-in code was already used.");
    }
    throw new AimsReverseSsoError(410, "CODE_EXPIRED", "The sign-in code has expired.");
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    include: { teacher: true },
  });

  if (!user) {
    throw new AimsReverseSsoError(403, "ACCOUNT_UNAVAILABLE", "The SMART account no longer exists.");
  }
  if (user.status !== "ACTIVE") {
    throw new AimsReverseSsoError(403, "ACCOUNT_UNAVAILABLE", "The SMART account is not active.");
  }
  if (user.role !== "ADMIN" && user.role !== "TEACHER") {
    throw new AimsReverseSsoError(403, "ROLE_UNSUPPORTED", "AIMS sign-in is available to teachers and administrators only.");
  }

  const activeYear = await getActiveSchoolYear();
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
    select: { schoolId: true, currentTerm: true },
  });

  const termIndex = settings?.currentTerm === "T2" ? 2 : settings?.currentTerm === "T3" ? 3 : 1;

  const identity: AimsReverseIdentity = {
    id: user.aimsUserId ?? null,
    role: user.role,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    email: user.email ?? null,
    username: user.teacher?.employeeId ?? user.username,
    lrn: null,
  };

  logger.info(`[AimsReverseSSO] Issued identity assertion for SMART user ${user.id} (${identity.role}).`);

  return {
    success: true,
    userId: user.id,
    data: {
      identity,
      context: {
        school: { id: schoolId ?? settings?.schoolId ?? "" },
        term: {
          schoolYear: activeYear.label,
          termIndex,
        },
        class: null,
      },
    },
  };
}
