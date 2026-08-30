/**
 * test-helpers.ts — Shared test utilities.
 * Credentials come from env vars; tests skip visibly when not set.
 */

export const BASE = "http://localhost:5003/api";

export function getAdminCredentials(): { email: string; password: string } | null {
  const email = process.env.SMART_TEST_ADMIN_EMAIL;
  const password = process.env.SMART_TEST_ADMIN_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export function getTeacherCredentials(): { email: string; password: string } | null {
  const email = process.env.SMART_TEST_TEACHER_EMAIL;
  const password = process.env.SMART_TEST_TEACHER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export function getRegistrarCredentials(): { email: string; password: string } | null {
  const email = process.env.SMART_TEST_REGISTRAR_EMAIL;
  const password = process.env.SMART_TEST_REGISTRAR_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export function hasCredentials(...roles: Array<"admin" | "teacher" | "registrar">): boolean {
  for (const role of roles) {
    if (role === "admin" && !getAdminCredentials()) return false;
    if (role === "teacher" && !getTeacherCredentials()) return false;
    if (role === "registrar" && !getRegistrarCredentials()) return false;
  }
  return true;
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data: any = await res.json();
  return data.token;
}

export async function getCsrfToken(): Promise<string> {
  const seed = await fetch(`${BASE}/health`);
  const cookies = (seed.headers.getSetCookie?.() ?? []) as string[];
  return cookies
    .find((c: string) => c.startsWith("x-csrf-token="))
    ?.split(";")[0]
    ?.split("=")[1] ?? "";
}

export function post(url: string, token: string, body: unknown, csrfToken: string) {
  return fetch(`${BASE}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });
}
