# FLEXIBLE TERM SYSTEM — REFACTOR PLAN (POSTPONED)

> **STATUS: ON HOLD — do not implement yet.**
> Planned execution: AFTER rollover testing completes.
> Decided: 2026-08-29 session. Owner: Sean + AI assistant.
> Trigger to start: rollover (EOSY → new SY) verified working end-to-end.

---

## 1. WHY THIS EXISTS

EnrollPro supports BOTH a **3-Term system** AND a **4-Quarter system**.
DepEd is unpredictable — we could be on 3 Terms this year and 4 Quarters
next year. SMART is currently welded to **exactly 3 periods** in ~15 places.
If DepEd flips, everything breaks.

**Goal:** make term COUNT a config value, not code. 3 terms this year,
4 quarters next year — same code, only settings change.

---

## 2. THE CORE INSIGHT

The `quarterlyGrade` / `quarterlyAssessWeight` **naming is NOT the problem**.
Those fields mean "grade for one assessment period" — name is irrelevant.

**The real problem: everything hardcodes "exactly 3".**

Inventory of hardcoded spots (verified 2026-08-29):

| # | Layer | Location | What's hardcoded |
|---|---|---|---|
| 1 | Prisma enum | `schema.prisma` — `Term` | `T1\|T2\|T3` — no T4 can exist |
| 2 | SystemSettings | `schema.prisma` | `t1StartDate`…`t3EndDate` — 6 flat columns |
| 3 | SchoolYear | `schema.prisma` | `termLabelT1/T2/T3` (added 2026-08-29 — note: MORE hardcoding, migrate away) |
| 4 | Scheduler | grade-lock scheduler | Locks year on **T3 end** specifically |
| 5 | grades-sub API | `classes.ts` deadline payload | `t1EndDate/t2EndDate/t3EndDate` flat shape |
| 6 | Frontend | 8+ files | Ternaries like `currentTerm === "T1" ? t1EndDate : currentTerm === "T2" ? ...` |
| 7 | SF9/SF10 | `SchoolForms.tsx` + `forms.ts` | Exactly 3 term columns rendered |
| 8 | Rotation subjects | `Subject.rotationTermRank` | Rank 1–3 only |
| 9 | Promotion/EOSY | `promotion.ts` | `T1/T2/T3` fields on subject map |
| 10 | GradeStatusBanner | `src/components/GradeStatusBanner.tsx` | `TERM_ORDER = {T1:1,T2:2,T3:3}` |
| 11 | Term labels API | `admin-sub/system.ts` | `termLabelT1/T2/T3` shape |
| 12 | Admin SystemSettings UI | date pickers ×3 pairs | No 4th pair possible |

---

## 3. TARGET ARCHITECTURE

### New table
```prisma
model TermConfig {
  id           String    @id @default(cuid())
  schoolYearId String
  termNumber   Int       // 1, 2, 3, or 4
  label        String    // "Quarterly 1" / "Term 1" — whatever DepEd calls it
  startDate    DateTime?
  endDate      DateTime?
  schoolYear   SchoolYear @relation(...)
  @@unique([schoolYearId, termNumber])
}
```

### Changes
- Add `T4` to `Term` enum (harmless, do early)
- New API `GET /api/terms?schoolYear=` → returns **array**:
  `[{ number: 1, label, startDate, endDate, isLocked }, ...]`
- Keep old flat fields (`t1EndDate` etc.) as **compat aliases** during migration,
  remove after frontend fully switched
- Frontend: replace ALL term ternaries with loops over the array
- Scheduler: lock year on **last term's** end date, not "T3"
- SF9/SF10: render N term columns from array (layout work still needed per
  DepEd's official form that year — unavoidable, one-time)

### Naming (decided)
- `quarterlyGrade` → rename to `termGrade` happens **free** during Phase 1
  since we touch everything anyway
- **Never** rename DB columns standalone — zero user value, high risk

---

## 4. PHASED PLAN

| Phase | Work | Estimate | Risk |
|---|---|---|---|
| **1. Foundation** | Add `T4` enum, `TermConfig` table, backfill from flat columns, array API (old fields stay) | 2–4 days | Low — additive only |
| **2. Genericize** | Frontend ternaries→loops, scheduler reads "last term", labels from array | 3–5 days | Medium |
| **3. Flip year** | Activate 4 terms + rebuild SF9/SF10 against DepEd's NEW official forms | 1–2 weeks | One-time, whenever DepEd flips |

**Rule: never mix with feature work. Standalone task, full backup first.**

---

## 5. DANGER ZONES (read before starting)

1. **SF10 snapshot JSON** — `studentSnapshot.ts` stores grade data as JSON
   blobs with `quarterlyGrade` keys embedded. A rename that misses snapshot
   reading/writing = prior-year SF10 forms silently show BLANKS. Any
   Phase 1 rename MUST include a snapshot JSON backfill script + verify
   archived-year forms still render.

2. **GradeLock precedence** — archived → year lock → term lock → legacy
   gradeLock (AGENTS.md rule). Term lock logic must iterate TermConfig rows,
   not T1/T2/T3.

3. **EnrollPro sync** — `resolveCurrentTerm()` writes currentTerm. Check
   whether EnrollPro API exposes term COUNT per school year. If yes →
   store it on SchoolYear, let sync drive term count automatically.
   **TODO during rollover testing: inspect EnrollPro payload.**

4. **isActive/isArchived rule** — historical queries filter by schoolYear
   string ONLY. TermConfig lookups for past years must not assume active
   year's config.

---

## 6. WHAT WE ALREADY SHIPPED (2026-08-29) — context

The term-labels feature (editable T1/T2/T3 display names) is live:
- `SchoolYear.termLabelT1/T2/T3` columns + migration
- `GET/PUT /api/admin/term-labels` + labels in settings/dashboard/grading-config
- GradeStatusBanner + teacher pages + GradingConfig editor use them

This feature is **count-hardcoded by design** for now. Phase 1 absorbs it:
`termLabelT1/T2/T3` columns → migrate into `TermConfig.label` rows.

---

## 7. ADVICE FOR THE INTERIM (before this refactor starts)

1. **During rollover testing, take notes for THIS plan:**
   - Anything term-related that breaks or looks wrong → log it here
   - Inspect EnrollPro's payload: does it expose term count per SY?
   - Watch how term lock scheduler behaves at year boundary
2. **Don't build new features on T1/T2/T3 ternaries.** If new code needs
   term data, fetch from `termLabels`/settings and keep it loop-friendly.
3. **Full DB backup before Phase 1 starts.** Non-negotiable.
4. **Phase 1 first, alone.** Additive changes, verify, THEN genericize.
5. Session context: Sean is keeping the AI session alive across rollover
   testing — resume there if possible, else this doc is the source of truth.
