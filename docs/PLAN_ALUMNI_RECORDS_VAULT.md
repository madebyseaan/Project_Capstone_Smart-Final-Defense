# Plan: Former Students → Records Vault (instant document access)

Status: **IMPLEMENTED — all gates green**
Author: opencode
Date: 2026-09-21

Decisions taken: **Option B** (read-only documents index, no migration) · right-side drawer (portaled to `body`) · row actions = SF10 (opens on SF10 tab) + Files (opens on Overview) · remedial tab links to the Remedial Tracker (no new certificate renderer).

Gate results: typecheck ✅ · client build ✅ · server build ✅ · lint 0 errors / no new warnings ✅ · e2e 5/5 (incl. new `e2e/alumni-records.spec.ts`) ✅ · live registrar run: drawer opens, SF10 renders, tabs fetch 200s, Escape closes, zero console/API errors ✅.

Two implementation findings worth keeping:
1. The drawer is rendered via `createPortal(..., document.body)`. The layout content wrapper (`transition-[padding] will-change-[padding]`) creates a stacking context, so an in-tree overlay can never paint above the fixed sidebar regardless of z-index.
2. `AlumniStudents` action cell now fires no request until the index confirms availability — this is what keeps the `>=400` e2e gate green.

Post-implementation fixes:
3. **SF9 year dropdown appeared broken** — the shared `Select` primitive portals at `z-50`, below the drawer's `z-[60]`, so the options rendered *behind* the drawer. Replaced with inline year pills (no portal, no z-index conflict). Covered by an e2e assertion that switches years.
4. **Overview whitespace** — added an Enrollment History card (years from the index, each with "View SF9"); clicking a year jumps straight to that SF9.

Goal: turn `src/pages/registrar/AlumniStudents.tsx` into a per-student **Records Vault** where the registrar opens any former student's documents (SF10 first) instantly in-page — no redirect, no page reload — and can see everything needed if the learner returns.

---

## 1. Goals / non-goals

**Goals**
- G-A: Clicking a student's document action opens their records **in-page** (drawer), SF10 rendered immediately.
- G-B: Vault surfaces all documents SMART can produce for that learner: SF10, SF9 per school year, prior-school records, remedial certificate, enrollment history.
- G-C: Fast + easy: one row action, prefetch on open, in-memory cache so re-opening is instant.
- G-D: No regression to any existing form/print flow.

**Non-goals (this pass)**
- Uploading/storing physical scans (PDF/JPG) per student — needs a new table + file storage (see §7 Tier 2).
- Editing SF10 inline from the vault (existing editor lives in School Forms; vault is read-only + print).
- Changing how SF1/SF5/SF6 (section-level forms) are generated.

---

## 2. Current state (evidence)

### 2.1 The alumni SF10 handoff is dead code
| Fact | Evidence |
|---|---|
| Button calls `handleViewSF10(student.id)` | `src/pages/registrar/AlumniStudents.tsx:396-406` |
| Writes `sessionStorage.sf10Data` / `sf10StudentId`, then `window.location.href = "/registrar/forms?view=sf10&alumni=1"` | `AlumniStudents.tsx:158-167` |
| **Nothing reads those keys or the query params** | repo-wide grep: only the writes exist; `SchoolForms.tsx` has no `useSearchParams`/`URLSearchParams`; `viewMode` initialised to `"list"` (`SchoolForms.tsx:67`) |
| Only real SF10 loaders | `SchoolForms.handleViewSF10` (`:235-248`, in-page buttons) and `Sf10RecordsPage` (`:157`) |
| Docs still claim it works | `docs/REGISTRAR/TRANSFEREE_PLAN.md:380` |

Net effect today: clicking **SF10** does a full page reload to the School Forms list — nothing is shown.

### 2.2 EnrollPro-only alumni break document fetches
- `GET /registrar/alumni` synthesises `id = enrollmentId = "ep-<lrn>"` for EnrollPro-only learners (`server/src/routes/registrar/main.ts:1057,1092,1130`).
- `registrarApi.getSF10("ep-...")` → `buildSf10Records` looks up `Student.id` → 404 (`server/src/lib/sf10.ts:62-63`), and `handleViewSF10` only `console.error`s (`AlumniStudents.tsx:164-166`).

### 2.3 Reusable pieces that already exist
| Piece | Path | Notes |
|---|---|---|
| `SF10Form` | `src/pages/registrar/components/SF10Form.tsx:15-23` | **Pure presentational**: `data: SF10Data`, `schoolName?`, `highlightArea?`, `highlightSection?`. No fetch/hooks. Already reused in 3 places. |
| `SF9Form` | `src/pages/registrar/components/SF9Form.tsx:5-9` | `data: SF9Data`, `fullLogoUrl?`, `highlightSubject?`. |
| SF10 builder | `server/src/lib/sf10.ts:60-487` | Returns `{ student, schoolRecords[], schoolSettings }`; `schoolRecords[]` already gives the **year list**. |
| SF9 endpoint | `server/src/routes/registrar/forms.ts:26-70` | `GET /registrar/forms/sf9/:studentId?schoolYear=`; explicitly accepts DROPPED/TRANSFERRED/GRADUATED ("allows historical SF9s"). |
| Prior-school records | `src/pages/registrar/Sf10RecordsPage.tsx` + `registrarApi.getExternalRecords` (`api.ts:1607`) | Full CRUD page already exists at `/registrar/transferees/:studentId/sf10-records`. |
| Remedial certificate | `server/src/routes/registrar/remedial.ts:386-405`, `registrarApi.getRemedialCertificate` (`api.ts:1543`) | API exists but **no renderer anywhere**; `RemedialStudentRow` only calls `window.print()`. |
| Modal/drawer primitives | `src/components/app-modal/index.tsx` (`AppModal`, `RegistrarModal`, sizes sm→xl, `max-h-[90vh]`) | Dialog-based; no shared Sheet/Drawer component. `RightDrawer` is local to `SchoolForms.tsx:42-64`. |
| Print infra | `src/index.css:536-660` (`.print-form`, `@media print`), print helper pattern `SchoolForms.tsx:180-218`, `Sf10RecordsPage.tsx:420-450` | Clone-node + injected `@page` style. |

### 2.4 Test surface that guards us
- `server/src/__tests__/alumniClassifier-lib.test.ts` — pure `isStudentAlumni` predicate.
- `server/src/__tests__/sf10-snapshot.test.ts`, `external-records-api.test.ts`, `external-record-merge.test.ts`, `external-record-validation.test.ts`.
- `e2e/portals.spec.ts:25-34` — registrar smoke includes `/registrar/alumni`.
- **Gate constraint:** `e2e/fixtures.ts:60-70` counts *any* `>=400` API response as a failure. A vault that fires `getSF10` on a student with no records will **404 and fail the gate** → design must avoid speculative 404s (§6).

---

## 3. Target UX

Row action becomes **Records** (folder icon). Clicking opens a right-side **vault drawer** (full-screen on mobile, `~min(1100px, 92vw)` on desktop) with the list still visible behind it. No navigation, no reload.

```
┌─ Records — DELA CRUZ, Juan  [GRADUATED]                     [Print ▾] [×] ─┐
│ LRN 136…  · Last: Grade 10 · SY 2025-2026 · Program: Regular              │
├───────────────────────────────────────────────────────────────────────────┤
│  Overview | SF10 | Report Cards | Prior School | Remedial                 │
│                                                                           │
│  ── SF10 (Permanent Record) ──────────────────────  [Print SF10] [Open ↗] │
│   <SF10Form data={sf10} />           (scrollable, read-only)              │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Overview** — identity, last enrollment, status timeline, availability checklist (SF10 ✓ / report cards: 3 years / prior records: 2 / remedial: —).
- **SF10** — fetched on open, rendered read-only via `SF10Form`, print via existing clone-print pattern.
- **Report Cards** — year dropdown sourced from `sf10.schoolRecords[].schoolYear`; fetch SF9 per year (`getSF9(studentId, year)`), render `SF9Form`, print.
- **Prior School** — list from `getExternalRecords(studentId)` (read-only) + "Manage" → existing `/registrar/transferees/:studentId/sf10-records`.
- **Remedial** — if any remedial rows, render certificate data (new small print view) or link to `/registrar/remedial`.
- **"Open in School Forms ↗"** — optional escape hatch to the full editor, using the existing School Forms SF10 loader (not the dead redirect).

Row-level document badges (SF10 ✓ / 3 yrs / 2 prior) are **only** shown if the availability index (§6 Option B) is implemented; otherwise they're computed lazily on drawer open.

---

## 4. Document catalog (what the vault can show)

| Document | Source | Works for alumni? | Renderer today | Vault action |
|---|---|---|---|---|
| SF10 Permanent Record | `GET /registrar/forms/sf10/:studentId` (`forms.ts:644`) | Yes, by SMART `Student.id` | `SF10Form` (reusable) | Inline + print |
| SF9 Report Card (per SY) | `GET /registrar/forms/sf9/:studentId?schoolYear=` (`forms.ts:26`) | Yes (endpoint explicitly supports DROPPED/TRANSFERRED) | `SF9Form` | Inline + print, year picker |
| Prior-school SF10/SF9 records | `GET /registrar/students/:studentId/external-records` (`externalRecords.ts:79`) | Yes | `Sf10RecordsPage` (full page) | Summary + link |
| Remedial certificate | `GET /registrar/remedial/:enrollmentId/certificate` (`remedial.ts:386`) | Yes (needs `enrollmentId`) | **none** | New lightweight print view (small) |
| Enrollment history / profile | `SF10Data.student` + `schoolRecords[]` | Yes | — | Overview tab |
| SF1 / SF5 / SF6 | section-level endpoints | N/A (class-level) | existing `SchoolForms` | Not in vault (link to School Forms) |
| Uploaded scans | — | — | — | **Tier 2**, needs DB + storage |

---

## 5. Architecture / files

**New**
- `src/pages/registrar/components/StudentRecordsDrawer.tsx` — drawer shell (clone of the `RightDrawer` pattern), tabs, print buttons, fetch orchestration.
- `src/pages/registrar/components/records/OverviewTab.tsx`
- `src/pages/registrar/components/records/Sf10Tab.tsx` — renders `SF10Form` + print.
- `src/pages/registrar/components/records/ReportCardsTab.tsx` — year picker + `SF9Form` + print.
- `src/pages/registrar/components/records/PriorRecordsTab.tsx`
- `src/pages/registrar/components/records/RemedialTab.tsx` (+ small certificate print view)
- `src/pages/registrar/hooks/useStudentRecords.ts` — React Query wrappers with per-student cache (see §6A).
- `src/pages/registrar/components/records/types.ts` — vault-local types.

**Edited**
- `src/pages/registrar/AlumniStudents.tsx` — replace `handleViewSF10` (dead) with `setVaultStudent(row)`; render `<StudentRecordsDrawer>`; keep list query/pagination untouched.
- `server/src/routes/registrar/main.ts` — *(only if §6B)* batched documents index in the alumni response or a new endpoint.
- `src/lib/api.ts` — *(only if §6B)* typed method for the index; optional `getSf10ByLrn`.

**Untouched (regression-sensitive):** `SchoolForms.tsx`, `Sf10RecordsPage.tsx`, `StudentRecords.tsx`, `Transferees.tsx`, `SF10Form.tsx`, `SF9Form.tsx`, `SF10Editor.tsx`.

---

## 6. Two decisions that must be settled before coding

### 6A. Data fetching + the 404/e2e problem
The e2e gate fails on **any** API response `>= 400`. Naively calling `getSF10` on every opened row will 404 for learners with no records and for `ep-<lrn>` rows → red gate.

Recommended design:
1. **Never fetch for synthetic ids.** If `student.id.startsWith("ep-")` → drawer shows a "Not yet synced to SMART — run **Sync from EnrollPro**" state; no API call.
2. **Cache + prefetch.** Use React Query (`queryKey: ['registrar','vault', studentId, 'sf10']`, `staleTime: 60_000`, `retry: 0`). First open fetches once; re-open is instant.
3. **Tabs fetch lazily** (SF9 only when its tab/year is chosen).

### 6B. Availability index — recommended (Option B), with Option A fallback
| | Option A — no backend change | Option B — batched read-only index (recommended) |
|---|---|---|
| Badges / checklist | unknown until each doc is fetched | known from the list payload |
| 404 risk on open | present for students without records | eliminated (only fetch docs flagged available) |
| e2e determinism | must pick a "known-good" student | test can open the first row that reports `sf10: true` |
| Backend cost | none | `POST /registrar/students/documents-index` (registrar-only), batched `groupBy` queries over `Grade`/`GradeSnapshot`, `ExternalSchoolRecord`, `RemedialClass` for the ≤100 ids on the page — 2-3 queries, no schema change |
| Response | — | `{ [studentId]: { sf10: boolean; reportCardYears: string[]; priorRecords: number; remedial: boolean } }` |

Recommendation: **Option B** — it's read-only (no migration), keeps the gate deterministic, and makes the vault feel instant (badges visible before opening).

---

## 7. Tier 2 (deferred): real "file storage"

To store actual scans/files per student (the "storage for their files" ask, beyond generated forms) SMART would need:
- `StudentDocument` model (`studentId`, `type`, `fileName`, `mimeType`, `size`, `schoolYear?`, `uploadedBy`, `createdAt`) + upload/download routes + disk/s3 storage + malware/size guards.
- UI: upload + preview + delete in the vault.
- Court the security skill (`security-review`) for upload handling.

That's a separate plan with its own gates. This plan deliberately stops at **generated documents**, which covers "if they come back" (SF10 + SF9 + prior records + remedial).

---

## 8. Anti-regression analysis

| # | Risk | Guard |
|---|---|---|
| R1 | e2e gate trips on vault 404s | Synthetic-id guard + availability index (§6B); `retry: 0`; only fetch flagged docs |
| R2 | Breaking existing SF10 views | `SF10Form`/`SchoolForms`/`Sf10RecordsPage` untouched; vault imports `SF10Form` read-only |
| R3 | List regression (search/tabs/pagination) | Only the Actions cell changes; `loadAlumni` signature/state untouched |
| R4 | N+1 requests on page load | No per-row fetches; index is one batched call (or nothing until drawer opens) |
| R5 | Print styles leaking | Reuse the clone-node + scoped `@media print` pattern; never global print CSS |
| R6 | Drawer traps focus / blocks list | Use existing Dialog/overlay patterns; Esc + backdrop close; `aria-modal`, focus return |
| R7 | `ep-<lrn>` rows show broken actions | Explicit "not synced" state, action disabled with tooltip |
| R8 | Deep-link/back-button regressions | Optional `?student=&doc=` sync via `useSearchParams` with `replace: true`; no history spam |
| R9 | Removing dead code breaks something | Grep-verified: `sf10Data`/`sf10StudentId` have no readers; remove writes only after `git grep` re-check |
| R10 | Design-system drift | Semantic tokens only; reuse `AppModal`/Dialog/ScrollArea/Tabs; files < 1000 lines |

---

## 9. Gates (each gate requires the previous green)

**G0 — Baseline (mandatory first).**
- `npm run verify` (needs a `*_test` `DATABASE_URL` for server tests) and `npm run test:e2e`.
- Record results. If red, attribute/fix **before** any vault work.
- Also `git grep -n "sf10Data\|sf10StudentId"` to re-confirm dead-code claim.

**G1 — Drawer + instant SF10.**
- Deliver: row action → drawer, SF10 renders read-only (or "not synced" state), print works.
- Remove the dead `sessionStorage` redirect.
- Gate: `npm run typecheck` · `npm run build` · `npm run lint` (0 errors) · `npm run test:e2e` green (incl. `/registrar/alumni`).
- New anti-regression e2e: `e2e/alumni-records.spec.ts` — open vault for an available row, assert SF10 form or explicit empty state, close, and assert `collectProblems` is empty.

**G2 — Report Cards (SF9) tab.**
- Year list from SF10 `schoolRecords`; fetch/render/print SF9.
- Gate: G1 checks + open a year, switch years, print preview; assert no `>=400` responses for years flagged present.

**G3 — Prior School + Remedial + Overview.**
- Prior records summary + link to existing page; remedial certificate view; overview checklist.
- Gate: G1 checks + manual matrix (student with prior records, student with remedial, student with neither).

**G4 — Polish + full sweep.**
- Badges/index wiring (if Option B), deep link, mobile layout, print quality.
- Gate: full `npm run verify` + full `npm run test:e2e` (all 3 roles) + manual matrix + `git diff` review confirming no edits to the untouched files in §5.

**Merge gate:** G0–G4 green · no new lint warnings · diff limited to §5 files (+ index endpoint if Option B) · one commit per gate for clean revert.

---

## 10. Test plan

**Automated**
- New `e2e/alumni-records.spec.ts` (registrar): open vault, tab through, close, zero console/API errors; skip gracefully if no eligible student exists in the env (but never produce a 404).
- New server test if Option B: `documents-index.test.ts` — registrar-only (403 for teacher/admin), batched correctness on seeded ids, no schema writes.
- Re-run: `alumniClassifier-lib`, `sf10-snapshot`, `external-records-api`, `external-record-merge`, `e2e/portals.spec.ts`.

**Manual matrix**
- Student types: graduate w/ full records · transferee w/ prior records · dropped · EnrollPro-only (`ep-`) · no grades.
- Viewports: 375 / 768 / 1440. Tabs, print dialog, Esc/backdrop close, re-open speed (cache).

**Test debt to note (not in scope, but flag):** `sf10-snapshot.test.ts` asserts a top-level `profileSnapshot` while the builder nests it per `schoolRecords[]` (`sf10.ts:397`), and it calls SF8 with a path param while the route reads `req.query.sectionId`. Fix separately.

---

## 11. Rollback
Additive feature: new components + one Actions cell. Reverting the G1–G4 commits restores the current (dead) button behavior with zero schema impact (Option B is a read-only endpoint).

---

## 12. Open questions
1. **Option A vs B** (§6B) — confirm we can add the read-only documents index endpoint, or keep it strictly frontend-only.
2. **Row action shape** — one "Records" button (recommended) or keep a dedicated SF10 button plus a "More" menu?
3. **Drawer vs modal** — right drawer recommended (keeps list context); OK?
4. **Remedial certificate** — build the small print view now, or just deep-link to `/registrar/remedial` in G3?
5. **Tier 2 uploads** — is physical file storage in scope for the defense, or later?

---

## 13. Effort estimate
| Phase | Estimate |
|---|---|
| G0 baseline | ~15 min (plus env setup if test DB missing) |
| G1 drawer + SF10 | ~1 session |
| G2 SF9 tab | ~0.5 session |
| G3 prior + remedial + overview | ~1 session |
| G4 polish + index + full sweep | ~1 session |
| Option B backend index (inside G1) | ~0.5 session |

**~4 sessions** with Option B, ~3.5 without. No DB migration either way.
