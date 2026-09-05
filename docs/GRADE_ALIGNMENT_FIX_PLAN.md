# FIX PLAN: Grade Display Alignment — SF 10 Double-Transmutation & Related Issues

> **DOCUMENT TYPE:** Execution playbook. Issues are ordered by severity. Issue A is a specified fix; Issues B and C require a user decision or scoped verification before code changes.
> **HARD RULES:**
> 1. Issue A only: execute exactly as specified. Do NOT refactor surrounding code.
> 2. Issues B and C: STOP at the decision point and present findings to the user. Do not implement without an explicit choice.
> 3. Scope is ONE file for Issue A: `src/pages/registrar/SchoolForms.tsx`. Nothing else.
> 4. Gates: root `npm run build` + `npm run lint` clean. No DB changes, no backend changes, no API changes.
> 5. Run this plan BEFORE the quarterly→term rename (see "Execution Order" at bottom).

---

## PART A — PRE-VERIFIED FACTS (verified 2026-08-29; do not re-investigate)

| # | Fact | Evidence |
|---|------|----------|
| F1 | Backend stores the **already-transmuted** grade in `Grade.quarterlyGrade` — computed via `transmute(initialGrade)` from the admin-configurable `TransmutationEntry` table at save time. | `server/src/routes/grades-sub/helpers.ts:315-317` |
| F2 | SF 9 and SF 10 backends send `quarterlyGrade` (transmuted value) to the frontend — no raw initial grades are sent in form payloads. | `server/src/routes/registrar/forms.ts:191-192, 868-870, 1072-1074` |
| F3 | SF 9 frontend displays backend values **directly** (no re-transmutation) — SF 9 is CORRECT. | `SchoolForms.tsx` SF9 renderer (~lines 428-663) |
| F4 | SF 10 frontend defines a local hardcoded transmutation function and applies it to the ALREADY-transmuted values — **6 call sites**: lines 963, 964, 965, 966 (per-term + final) and 990, 993 (general average). | `SchoolForms.tsx:747-791, 963-966, 990, 993` |
| F5 | The hardcoded local table (F4) is ALSO a second problem: it ignores the admin-configurable `TransmutationEntry` table — even where transmutation is legitimate, SF 10 could disagree with a customized table. | `SchoolForms.tsx:746-791` vs `server/src/lib/transmutationCache.ts` |
| F6 | Concrete corruption example: stored `quarterlyGrade = 85` → SF 10 displays `transmuteGrade(85) = 87`. Stored 74 → displays 76. **Every SF 10 grade except exact fixed points is inflated or shifted.** | table at `SchoolForms.tsx:763-774` |
| F7 | `transmuteGrade` in OTHER files is legitimate and MUST NOT be touched: `ClassRecordTable.tsx:35,147` and `classRecordMobileUtils.ts:6,69` transmute the **initial grade** (not yet transmuted) for teacher live preview. | grep verified |
| F8 | SF 9 and SF 10 backends do NOT filter by `Grade.status` — DRAFT (unfinalized) grades are included in both forms. | `forms.ts:84-102, 722-735` (no `status` in `where`) |
| F9 | Promotion/EOSY logic uses ONLY `status === 'FINALIZED'` grades. | `server/src/lib/promotion.ts:245, 372` |
| F10 | SF 10 frontend has its own subject-grouping layer (`SF10_GROUP_MAP`, `buildSF10Areas`, `getAreaDisplayValues`) that groups MAPEH components (MUSIC/ARTS/PE/HEALTH) and averages them, and groups SCI_*/TLE_* codes. Backend separately does rotation merging (`mergeRotationSubjects`) for SCI/TLE rotation subjects. The two layers overlap for SCI/TLE. | `SchoolForms.tsx:692-744` vs `server/src/lib/promotion.ts:68-109` |

---

## ISSUE A — SF 10 double-transmutation (BUG — FIX NOW)

### A1. Root cause
`Grade.quarterlyGrade` is transmuted once at save time (F1). SF 10's renderer transmutes it a second time (F4). SF 9 doesn't (F3). Result: SF 10 ≠ SF 9 ≠ class record for the same student/subject/term.

### A2. Exact fix — `src/pages/registrar/SchoolForms.tsx` ONLY

**Change 1 — lines 962-966.** Replace the four transmuted locals with the raw display values:

```tsx
// BEFORE
// Transmute grades for display (raw → whole number)
const t1 = transmuteGrade(vals.t1);
const t2 = transmuteGrade(vals.t2);
const t3 = transmuteGrade(vals.t3);
const finalGrade = transmuteGrade(vals.final);

// AFTER
// Backend quarterlyGrade values are already transmuted — display as-is
const t1 = vals.t1;
const t2 = vals.t2;
const t3 = vals.t3;
const finalGrade = vals.final;
```

(Keeping the local names means lines 973-981 JSX need zero edits.)

**Change 2 — line 990.**
```tsx
// BEFORE
{transmuteGrade(record.generalAverage) ?? ''}

// AFTER
{record.generalAverage ?? ''}
```

**Change 3 — line 993.**
```tsx
// BEFORE
{record.generalAverage != null ? (transmuteGrade(record.generalAverage)! >= 75 ? 'Passed' : 'Failed') : ''}

// AFTER
{record.generalAverage != null ? (record.generalAverage >= 75 ? 'Passed' : 'Failed') : ''}
```

**Change 4 — delete the now-dead function** `transmuteGrade` (lines 746-791, the whole `const transmuteGrade = ...` block including its comment line). After Changes 1-3 there are zero remaining call sites in this file (F4 listed all 6). ESLint unused-var will flag it if left — deletion is mandatory, not optional.

**Change 5 — line 939 header text (ride-along, zero risk).** `"Quarterly Rating"` → `"Term Rating"`.
> NOTE: This line also appears in the rename plan's Phase 5. Whichever plan runs second will find it already changed — that is expected; make the edit idempotent (check current text first).

### A3. What NOT to touch (critical)
- `transmuteGrade` in `ClassRecordTable.tsx` and `classRecordMobileUtils.ts` (F7 — those transmute initial grades legitimately).
- Backend transmutation, `TransmutationEntry` table, `transmutationCache.ts` — all correct.
- `getAreaDisplayValues` averaging math (that's Issue C territory).
- SF 9 renderer — already correct.

### A4. Verification (Definition of Done for Issue A)
1. Root: `npm run build` → clean. `npm run lint` → clean.
2. `rg -n "transmuteGrade" src/pages/registrar/SchoolForms.tsx` → **zero matches**.
3. Manual smoke (dev server + DB): open SF 10 for a student with grades. For 3 sample subjects, SF 10 term grades must EQUAL SF 9 term grades and the class record's `quarterlyGrade` for the same student/subject/term. Pre-fix they differ (e.g., 85 vs 87); post-fix they match exactly.
4. General Average in SF 10 must equal SF 9's general average for the same student/year.
5. Print preview (PrintCenter) renders the corrected numbers — same component tree, but confirm no cached/stale render.

---

## ISSUE B — SF 9 / SF 10 render DRAFT (unfinalized) grades (DECISION REQUIRED)

### B1. Current behavior
Both form backends include grades regardless of `status` (F8). A teacher's unsaved-finalization DRAFT grade appears on official-looking forms today.

### B2. Why it's not automatically a bug
- SF 9/SF 10 in SMART are registrar-facing working documents, not teacher-facing. Registrars may *want* full visibility including drafts (e.g., during EOSY reconciliation they can see what's still pending).
- Grade-lock precedence (AGENTS.md) already prevents *editing*; this is display-only.
- Blocking drafts entirely could make forms show BLANKS mid-quarter, which may look more broken than useful.

### B3. Options (present to user; default = Option 1)

| Option | Behavior | Effort |
|---|---|---|
| **1. Keep as-is + surface status (RECOMMENDED)** | Forms keep showing all grades; add a small "includes unfinalized grades" warning chip in SF 9/SF 10 UI when any included grade has `status !== 'FINALIZED'`. Backend already returns `status`? — if not, add it to the two form payloads (small additive change, no contract break). | Low |
| 2. Filter to FINALIZED only | Forms show only finalized grades; blanks elsewhere. Changes `forms.ts` grade queries (SF9 ~line 84-102, SF10 ~line 722-735) to add `status: 'FINALIZED'`. Risk: forms go blank for actively-graded students; snapshot fallback path (S1-style) must be handled consistently. | Medium |
| 3. Config flag | Admin setting toggles Option 1 vs 2 behavior. | High |

**Do NOT implement until user picks.** Record the choice in this file before coding.

---

## ISSUE C — SF 10 frontend re-grouping vs backend rotation merging (VERIFY, then decide)

### C1. Current behavior (two overlapping layers)
- **Backend** (`forms.ts` SF10 + `promotion.ts:mergeRotationSubjects`): merges rotation subjects (e.g., SCI_BIO→T1, SCI_CHEM→T2, SCI_ES→T3) into single rows with per-term slots.
- **Frontend** (`SchoolForms.tsx:692-744`): independently groups SCI_*/TLE_* into one row AND groups MAPEH components (MUSIC/ARTS/PE/HEALTH) then **averages** them per term (`getAreaDisplayValues`).

### C2. Why verification is required, not blind deletion
- MAPEH averaging is **correct DepEd SF10 semantics** (MAPEH final = average of 4 components) and may be the ONLY place it happens — deleting the frontend layer could break MAPEH.
- For SCI/TLE the layers may double-handle: if backend already emits one merged SCI row, the frontend grouping is a no-op pass-through (harmless). If backend emits separate SCI_BIO/CHEM/ES rows AND rotation-merged them elsewhere, frontend averaging could *average across terms* — wrong.
- Correctness depends on the exact shape the SF10 endpoint emits for rotation subjects vs MAPEH components.

### C3. Verification procedure (read-only, ~30 min)
1. Call `GET /api/registrar/forms/sf10/:studentId` for a student with (a) SCI rotation subjects, (b) MAPEH components, (c) plain subject. Capture the `subjectGrades` array shape.
2. For each case, trace through `buildSF10Areas` + `getAreaDisplayValues` by hand: which rows are produced, which subCodes feed each, does averaging fire?
3. Compare against DepEd SF10-JHS expected layout:
   - SCI rotation → ONE row, T1/T2/T3 = each rotation phase's grade (NOT averaged).
   - MAPEH → ONE row, per-term = average of MUSIC/ARTS/PE/HEALTH that term, final = average of finals.
   - Everything else → one row per subject.
4. Document actual behavior per case in this file.

### C4. Decision matrix after verification

| Finding | Action |
|---|---|
| MAPEH averaging only happens frontend | KEEP frontend grouping for MAPEH (or move to backend as a follow-up hardening task — user decision) |
| SCI/TLE: backend emits merged row, frontend grouping is pass-through | Harmless; optionally simplify later. No action required. |
| SCI/TLE: backend emits separate rows AND frontend averages them across rotation phases | BUG — SF10 shows averaged rotation grades instead of per-term. Fix: exclude SCI_*/TLE_* from `getAreaDisplayValues` averaging when backend rows are per-rotation (or trust backend merged rows directly). Present exact diff to user before applying. |

---

## EXECUTION ORDER — this plan vs the quarterly→term rename

**Run THIS plan first.** Then `QUARTERLY_TO_TERM_RENAME_PLAN.md`. Reasons:

1. **Severity:** Issue A corrupts displayed grades on SF 10 — a permanent-record document — today. Terminology is cosmetic; wrong numbers are not.
2. **Size/risk:** Issue A is a ~15-line, one-file, zero-backend change. Ship and verify it fast. The rename is a ~210-occurrence, DB-migration-bearing refactor.
3. **Decoupling:** Issue A's fix does not rename any identifiers, so the rename plan's line anchors and snippets remain valid afterward. The reverse order would leave this plan referencing stale `quarterlyGrade` names in SchoolForms.tsx.
4. **Shared file:** Both plans touch `SchoolForms.tsx`. Fix-first gives the rename a tiny stable base to rebase over. (Line 939 "Quarterly Rating" is handled idempotently in both — see A2 Change 5.)

If the user insists rename-first: execute this plan AFTER rename Phase 6, and mentally substitute `quarterlyGrade`→`termGrade` / shifted line numbers when applying A2.

## ROLLBACK
Single branch `fix/sf10-double-transmutation`. Revert = single commit revert. No DB, no API, no backend changes. Issues B/C may produce follow-up commits on separate branches per decision.
