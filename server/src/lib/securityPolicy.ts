import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Security policy that is configured in Admin → System Settings and actually
 * enforced at runtime. Values are cached in memory and refreshed at boot and
 * whenever settings are saved.
 */
export interface SecurityPolicy {
  maxLoginAttempts: number;
  passwordMinLength: number;
  requireSpecialChar: boolean;
}

const DEFAULTS: SecurityPolicy = {
  maxLoginAttempts: 5,
  passwordMinLength: 6,
  requireSpecialChar: false,
};

let cache: SecurityPolicy | null = null;

export async function loadSecurityPolicy(): Promise<SecurityPolicy> {
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "main" },
      select: { maxLoginAttempts: true, passwordMinLength: true, requireSpecialChar: true },
    });
    if (settings) {
      cache = {
        maxLoginAttempts: settings.maxLoginAttempts ?? DEFAULTS.maxLoginAttempts,
        passwordMinLength: settings.passwordMinLength ?? DEFAULTS.passwordMinLength,
        requireSpecialChar: settings.requireSpecialChar ?? DEFAULTS.requireSpecialChar,
      };
    }
  } catch (error) {
    logger.warn("[SecurityPolicy] Failed to load policy — using defaults:", error);
  }
  return cache ?? DEFAULTS;
}

export function getSecurityPolicy(): SecurityPolicy {
  return cache ?? DEFAULTS;
}

export function setSecurityPolicy(patch: Partial<SecurityPolicy>): void {
  cache = { ...(cache ?? DEFAULTS), ...patch };
}

const SPECIAL_CHAR_RE = /[!@#$%^&*(),.?":{}|<>_\-[\]\\/~`+=;']/;

/** Returns an error message when the password fails policy, else null. */
export function validatePasswordPolicy(password: string): string | null {
  const policy = getSecurityPolicy();
  if (password.length < policy.passwordMinLength) {
    return `Password must be at least ${policy.passwordMinLength} characters`;
  }
  if (policy.requireSpecialChar && !SPECIAL_CHAR_RE.test(password)) {
    return "Password must contain at least one special character";
  }
  return null;
}
