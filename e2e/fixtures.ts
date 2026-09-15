import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export interface Account {
  id: string;
  pw: string;
  login: string;
}

type Role = "admin" | "teacher" | "registrar";

const LOGIN_PATH: Record<Role, string> = {
  admin: "/login/admin",
  teacher: "/login",
  registrar: "/login/registrar",
};

/**
 * Accounts: env vars win (CI), otherwise the gitignored local file
 * tests/playwright-accounts.json. Credentials are NEVER committed.
 */
function fromJson(): Record<string, { id?: string; password?: string; login?: string }> | null {
  try {
    const p = path.join(process.cwd(), "tests", "playwright-accounts.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function account(role: Role): Account {
  const env: Partial<Record<Role, { id?: string; pw?: string }>> = {
    admin: { id: process.env.SMART_TEST_ADMIN_EMAIL, pw: process.env.SMART_TEST_ADMIN_PASSWORD },
    teacher: { id: process.env.SMART_TEST_TEACHER_EMAIL, pw: process.env.SMART_TEST_TEACHER_PASSWORD },
    registrar: { id: process.env.SMART_TEST_REGISTRAR_EMAIL, pw: process.env.SMART_TEST_REGISTRAR_PASSWORD },
  };
  const e = env[role];
  if (e?.id && e?.pw) return { id: e.id, pw: e.pw, login: LOGIN_PATH[role] };

  const json = fromJson();
  const j = json?.[role];
  if (j?.id && j?.password) return { id: j.id, pw: j.password, login: j.login ?? LOGIN_PATH[role] };

  throw new Error(
    `[e2e] No credentials for "${role}". Set SMART_TEST_${role.toUpperCase()}_EMAIL/PASSWORD or create tests/playwright-accounts.json.`,
  );
}

export async function login(page: Page, role: Role): Promise<void> {
  const cred = account(role);
  await page.goto(cred.login, { waitUntil: "domcontentloaded" });
  await page.locator("input").nth(0).fill(cred.id);
  await page.locator("input").nth(1).fill(cred.pw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30_000 });
}

/** Collects console errors and API responses >= 400 for a page session. */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) {
      problems.push(`api ${r.status()}: ${r.url().replace("http://localhost:5173", "")}`);
    }
  });
  return problems;
}
