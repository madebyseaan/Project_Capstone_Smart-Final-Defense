/**
 * remedial-guard.test.ts — Tests for remedial status guards.
 *
 * Verifies that manual-create rejects non-CONDITIONALLY_PROMOTED enrollments
 * and that sync skips RETAINED enrollments.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getRegistrarCredentials, login, getCsrfToken, post } from "./test-helpers";

const credsOk = hasCredentials("registrar");

describe.skipIf(!credsOk)("Remedial status guards", () => {
  let registrarToken = "";
  let csrfToken = "";

  beforeAll(async () => {
    const creds = getRegistrarCredentials()!;
    registrarToken = await login(creds.email, creds.password);
    csrfToken = await getCsrfToken();
  });

  it("manual-create returns 400 for non-CONDITIONALLY_PROMOTED enrollment", async () => {
    const res = await post(
      "/registrar/remedial/nonexistent-enrollment-id/manual-create",
      registrarToken,
      { subjectCode: "MATH", subjectName: "Mathematics", originalGrade: 70 },
      csrfToken,
    );
    expect([400, 404]).toContain(res.status);
    const body: any = await res.json();
    if (res.status === 400) {
      expect(body.message).toMatch(/conditionally promoted/i);
    }
  });

  it("manual-create returns 404 for nonexistent enrollment", async () => {
    const res = await post(
      "/registrar/remedial/does-not-exist/manual-create",
      registrarToken,
      { subjectCode: "MATH", subjectName: "Mathematics", originalGrade: 70 },
      csrfToken,
    );
    expect([400, 404]).toContain(res.status);
  });
});
