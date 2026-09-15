/**
 * archive-year-route.test.ts — RL-9a regression guard.
 *
 * The old codebase had TWO POST /api/admin/archive-year handlers (system.ts live,
 * classAssignments.ts dead). These tests fail if a duplicate handler is ever
 * reintroduced, and verify the live handler's body schema.
 */
import { describe, it, expect } from "vitest";
import { Router } from "express";
import systemRoutes from "../routes/admin-sub/system";
import classAssignmentsRoutes from "../routes/admin-sub/classAssignments";
import { archiveYearIdSchema } from "../schemas/admin";

describe("RL-9a — exactly one /archive-year handler", () => {
  it("registers a single POST /archive-year across admin sub-routers", () => {
    const router = Router();
    systemRoutes(router);
    classAssignmentsRoutes(router);

    const hits = router.stack.filter(
      (layer: any) => layer.route?.path === "/archive-year" && layer.route?.methods?.post,
    );
    expect(hits).toHaveLength(1);
  });
});

describe("RL-9a — archive-year body schema", () => {
  it("accepts an explicit schoolYearId", () => {
    expect(archiveYearIdSchema.safeParse({ body: { schoolYearId: "abc123" } }).success).toBe(true);
  });

  it("accepts an empty body (handler falls back to the linked school year)", () => {
    expect(archiveYearIdSchema.safeParse({ body: {} }).success).toBe(true);
  });

  it("strips unknown keys", () => {
    const parsed = archiveYearIdSchema.safeParse({ body: { schoolYearId: "abc", junk: 1 } });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data.body as Record<string, unknown>).junk).toBeUndefined();
    }
  });

  it("rejects an empty schoolYearId string", () => {
    expect(archiveYearIdSchema.safeParse({ body: { schoolYearId: "" } }).success).toBe(false);
  });
});
