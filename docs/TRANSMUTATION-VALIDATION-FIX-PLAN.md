# Transmutation Table Validation Fix — Implementation Plan

> **Status:** Implemented (2026-08-18)
> **Author:** Mimo (opencode investigation)
> **Created:** 2026-08-18

## Background

An admin edited the transmutation table in the admin UI for testing. After editing, some
initial grades transmuted to `60` incorrectly (e.g., an initial grade of `76.30` showed as
`60` when it should show `78`).

The table itself was later restored to the DepEd defaults and is currently correct in the
database. This plan addresses the **root cause** so the bug cannot happen again.

---

## Root Cause

The `transmute()` function does a linear scan of the table and falls back to `60` when no
range matches:

```ts
// server/src/routes/grades.ts:1322-1331
async function transmute(initialGrade: number): Promise<number> {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  const table = await getTransmutationTable();
  for (const entry of table) {
    if (roundedGrade >= entry.minGrade && roundedGrade <= entry.maxGrade) {
      return entry.transmutedGrade;
    }
  }
  return 60; // Minimum grade   <-- silent fallback
}
```

When the admin edited a range (e.g., changed a `maxGrade` from `76.99` to `76.29`), it left
a **gap** in the ranges. A grade like `76.30` fell into that gap, matched no entry, and
silently returned `60`.

### Why it's easy to break

1. **No server-side validation.** `PUT /api/admin/transmutation-table` does
   `deleteMany({})` then `createMany({})` with zero validation of the submitted ranges
   (`server/src/routes/admin.ts:1637-1673`).
2. **No client-side validation.** `TransmutationTable.tsx` uses inline `<Input>` fields and
   no gap/overlap detection before saving (`src/pages/admin/TransmutationTable.tsx`).
3. **Silent fallback.** `transmute()` returns `60` on no-match instead of flagging the
   invalid state.

---

## Files Involved

| Path | Role |
|---|---|
| `server/src/routes/admin.ts` | Server endpoints: PUT /transmutation-table (bulk replace, ~line 1637), POST /rows, PUT /:id, DELETE /:id, POST /reset |
| `server/src/routes/grades.ts` | `transmute()` function (lines 1322-1331), `calculateGrades()`, `GET /api/grades/transmutation-table` |
| `server/src/lib/transmutationCache.ts` | `getTransmutationTable()`, `invalidateTransmutationCache()` |
| `server/prisma/schema.prisma` | `TransmutationEntry` model (lines 346-356) |
| `src/pages/admin/TransmutationTable.tsx` | Admin UI (inline editing, save, reset) |
| `src/pages/teacher/components/ClassRecordTable.tsx` | Teacher-facing read-only transmutation display + fallback |

---

## Proposed Changes

### 1. Frontend validation in `handleSave` (primary fix)

Add a validation function in `src/pages/admin/TransmutationTable.tsx` that runs before the
API call in `handleSave` (line 132). Block save and show an error message if any of the
following fail:

- **Contiguity:** no gaps between consecutive ranges (next entry's `minGrade` must be
  `current.maxGrade + 0.01`, or within a small epsilon).
- **No overlap:** ranges must not overlap (`current.maxGrade < next.minGrade`).
- **Ordering:** each entry must satisfy `minGrade <= maxGrade`.
- **Bounds:** grades should stay within `0 <= minGrade <= maxGrade <= 100`.
- **Coverage:** the full span (0 to 100) should be covered (no orphaned gaps).

Sort entries by `minGrade` before validating. On failure, display a clear message in the
existing message banner (line 60, 214) describing the offending range, e.g.:
`Gap detected between 76.29 and 77.00 — grade 76.30 would transmute to 60.`

### 2. Server-side validation in `PUT /api/admin/transmutation-table` (safety net)

In `server/src/routes/admin.ts` (~line 1637), before the transaction, validate the incoming
`entries` array with the same rules:

- Array non-empty (already checked).
- Each entry has numeric `minGrade`, `maxGrade`, `transmutedGrade`.
- `minGrade <= maxGrade` per entry.
- Ranges sorted by `minGrade`, non-overlapping, and contiguous (next `minGrade ===`
  `current.maxGrade + 0.01`).
- Bounds within `[0, 100]`.

Return `400` with a descriptive error message if invalid. Do NOT delete/recreate the table
when validation fails.

### 3. (Optional) Apply the same validation to the row-level endpoints

`POST /transmutation-table/rows`, `PUT /transmutation-table/:id` should also validate that
the new/updated row does not create a gap or overlap with existing rows.

### 4. (Optional) Add a shared validation helper

Extract the range-validation logic into a shared utility (e.g.,
`server/src/lib/transmutationValidation.ts` or a `src/lib/` frontend util) so server and
client stay consistent.

### 5. (Optional) Hardening `transmute()`

Consider logging a warning when `transmute()` hits the `return 60` fallback so silent
misconfigurations are visible in server logs.

---

## Acceptance Criteria

1. Editing a range in the admin UI so it creates a gap produces a visible error message and
   does NOT save.
2. The same invalid payload sent directly to `PUT /api/admin/transmutation-table` returns
   `400` with a clear message.
3. Valid custom tables (including intentional gaps for testing, if supported) still save
   successfully — **confirm with the team whether partial/gapped tables are ever intended**.
4. `76.30` (and any in-range grade) transmutes correctly once the table is valid.
5. Existing teacher-facing transmutation display still works after the change.

---

## Open Questions / Decisions Needed

- **Should gapped tables ever be allowed?** The current fallback (60) exists by design. If
  intentional gaps are a feature, the fix may instead be to surface a warning rather than
  block the save.
- **Epsilon tolerance:** transmutation uses 2-decimal rounding
  (`Math.round(initialGrade * 100) / 100`). Validation should use the same precision.
- **Duplicate ranges:** the schema has no unique constraint on `minGrade`/`maxGrade`
  (`schema.prisma:346-356`). Decide whether to add `@@unique([minGrade])` as part of this
  fix or leave it.

---

## Testing Notes

- No `test` script exists in the server's `package.json` — verification is manual or via the
  running app.
- Manual test path: open `/admin/transmutation`, edit a `maxGrade` to create a gap, click
  "Save Changes", confirm error + no DB change; verify with `prisma studio` or a DB query.
