/**
 * audit-enrichment.test.ts — Verifies that the request-scoped audit context
 * (IP / network / device / route) is persisted by createAuditLog(). Inserts
 * test rows and removes them afterwards.
 */
import { describe, it, expect, afterAll } from "vitest";
import type { Request } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { buildAuditContext, runWithAuditContext } from "../lib/requestContext";
import { createAuditLog } from "../lib/audit";

const TARGET = `AUDIT-ENRICH-${Date.now()}`;
const TARGET_FAIL = `${TARGET}-FAIL`;
const createdIds: string[] = [];

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function fakeReq(headers: Record<string, string>, ip: string): Request {
  return {
    headers,
    ip,
    method: "POST",
    originalUrl: "/api/grades/classes/123?foo=bar",
    url: "/api/grades/classes/123?foo=bar",
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

describe("audit enrichment", () => {
  afterAll(async () => {
    if (createdIds.length) {
      await prisma.auditLog.deleteMany({ where: { id: { in: createdIds } } });
    }
  });

  it("persists network + device context from the request", async () => {
    const req = fakeReq(
      { "user-agent": CHROME_UA, "x-forwarded-for": "100.64.0.9, 10.0.0.1" },
      "10.0.0.1"
    );

    await runWithAuditContext(buildAuditContext(req), async () => {
      await createAuditLog(
        AuditAction.CONFIG,
        { firstName: "Smoke", lastName: "Test", role: "ADMIN" },
        TARGET,
        "Config",
        "audit enrichment smoke test",
        undefined,
        AuditSeverity.INFO,
        undefined,
        undefined,
        "success"
      );
    });

    const log = await prisma.auditLog.findFirst({
      where: { target: TARGET },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();
    if (!log) return;
    createdIds.push(log.id);

    expect(log.network).toBe("Tailscale");
    expect(log.ipAddress).toBe("100.64.0.9");
    expect(log.browser).toBe("Chrome 131");
    expect(log.os).toBe("Windows 10/11");
    expect(log.deviceType).toBe("Desktop");
    expect(log.outcome).toBe("success");
    expect(log.requestMethod).toBe("POST");
    expect(log.requestPath).toBe("/api/grades/classes/123");
    expect(log.requestPath).not.toContain("?");
  });

  it("records failures and LAN sources", async () => {
    const req = fakeReq({ "user-agent": "curl/8.0" }, "192.168.1.50");

    await runWithAuditContext(buildAuditContext(req), async () => {
      await createAuditLog(
        AuditAction.LOGIN,
        { firstName: "bad", lastName: "actor", role: "UNKNOWN" },
        TARGET_FAIL,
        "Auth",
        "failed smoke",
        undefined,
        AuditSeverity.WARNING,
        undefined,
        undefined,
        "failure"
      );
    });

    const log = await prisma.auditLog.findFirst({ where: { target: TARGET_FAIL } });
    expect(log).toBeTruthy();
    if (!log) return;
    createdIds.push(log.id);

    expect(log.outcome).toBe("failure");
    expect(log.network).toBe("School LAN");
  });

  it("never throws when the audit write fails", async () => {
    await expect(
      createAuditLog(
        "NOT_A_REAL_ACTION" as unknown as AuditAction,
        { firstName: "x", lastName: "y", role: "ADMIN" },
        "AUDIT-FAILSAFE",
        "Config",
        "this write should be swallowed"
      )
    ).resolves.toBeUndefined();
  });
});
