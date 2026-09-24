# CLASS RECORD — ENTER-KEY FAST ENCODING: LAG + VANISHING SCORES FIX PLAN

**Target:** `src/pages/teacher/ClassRecordView.tsx` + `components/ledger/*` + `components/classRecordActions.ts`
**Author:** Planning agent (investigation complete, zero code changed)
**Status:** Ready for implementation
**Reported symptom:** "Spamming scores using Enter like Excel for fast encoding — super lag, it's bugging, sometimes scores disappeared."

---

## 1. How to use this document

Work phase-by-phase. Each phase is independently shippable and ends with the verification
commands green. Commit once per phase so any regression is a single revert.

Line numbers reference the codebase at time of writing. Findings include anchors
(function/variable names) so they can be relocated if code has moved.

---

## 2. Reproduction (deterministic)

1. Log in as TEACHER, open any class record with ≥10 learners, current term.
2. Click the first WW score cell (row 1), type `10`, press **Enter**, repeat down the column.
3. Observe in DevTools → Network (filter `grades`):
   - 2–4 requests per Enter press (POST + full class-record GET; sometimes duplicated).
   - Increasing lag as more rows are entered; UI visibly stutters.
4. Occasionally: the next typed digits do not appear (focus silently lost), or a previously
   entered score reverts to blank/old value for a moment ("disappeared").
5. Throttle network to Slow 3G → the race becomes near-deterministic within ~5 Enter presses.

---

## 3. Root causes (ranked)

### RC1 — Request storm: every Enter press saves AND refetches the whole class

- `LedgerScoreCell.tsx:70-87` (Enter) and `:62-69` (blur) call `onCommit`.
- `ClassRecordView.tsx:242-266` (`commitScoreInput`) → `:187-190` (`handleScoreUpdate`)
  → `classRecordActions.ts:153-310` (`executeScoreUpdate`).
- `classRecordActions.ts:293-304`: `await gradesApi.saveGrade(...)` then
  `await fetchClassRecord(true)`.
- `ClassRecordView.tsx:123`: `fetchClassRecord` is declared with **no parameters**, so the
  `true` callers pass as "silent" is **ignored** — it is always a full refetch.
- `fetchClassRecord` → `classRecordQuery.refetch()` → `GET /grades/class-record/:id`, which
  server-side runs ~10–12 queries (enrollments, grades, weights, lock state, predecessor
  assignments/grades, rotation siblings, settings) plus `resolveCurrentTerm()`
  (`server/src/routes/grades-sub/classes.ts:123-334`).
- `POST /grades/grade` itself (`classes.ts:337-603`) runs ~10+ queries and **2 extra writes**
  per save (`createGradeSnapshot` + `createAuditLog`).

**Net cost per single-cell commit: 1 POST + 1 full GET.** Fast encoding at 3 presses/sec
sustains ~6 heavy requests/sec against a 300 req/min global limiter.

### RC2 — Blur double-commit (amplifies RC1)

`LedgerScoreCell.tsx`: Enter commits (`:70-78`), then the rAF moves focus to the next row
(`:81-86`), which fires `onBlur` on the old input (`:62-69`) → **commit #2 with the same
value** → second POST + second GET for a no-op. This happens whenever the input is not
remounted in between (see RC3), e.g. re-pressing Enter on an already-saved cell or at the
bottom of a column where focus does not move.

### RC3 — Input remount by value → focus loss ("typing goes nowhere")

`LedgerScoreCell.tsx:40`: `key={`${String(value ?? "")}-${status ?? ""}`}` on the
uncontrolled `<input>` (`defaultValue` at `:43`).

Every time the `value` prop changes (optimistic commit or refetch), React unmounts and
remounts the input. If the remount happens on the focused cell, focus drops to `<body>` and
subsequent keystrokes/Enters are lost. The rAF focus in `:81-86` only covers the
Enter path; a refetch landing ~100–500 ms later remounts cells **after** the user has moved
on, silently discarding focus.

### RC4 — Refetch clobbers optimistic state ("score disappeared")

- Optimistic write: `ClassRecordView.tsx:102-121` (`setClassRecord` → `queryClient.setQueryData`).
- A refetch started before that write (RC1) resolves after it and replaces the entire query
  data with the server snapshot taken *before* the newer edit — the just-typed score
  reverts visually until the next request lands. Out-of-order/interleaved refetches make
  this nondeterministic ("sometimes").
- `useClassRecordQuery` (`hooks/useClassRecord.ts:38-49`) passes no `AbortSignal`, so
  `cancelQueries` cannot truly cancel an in-flight GET.

### RC5 — Whole table re-renders on every keystroke (the "super lag")

`React.memo` on `LedgerRow` (`LedgerRow.tsx:35`) is defeated because props change identity
every render/commit:

| Prop | Cause | Location |
|---|---|---|
| `weights` | object literal rebuilt every render | `ClassRecordTable.tsx:145-149` |
| `onCellFocus` | inline arrow rebuilt every render | `ClassRecordView.tsx:343` |
| `aimsWW/aimsPT/aimsQA` | `.filter()` not memoized | `ClassRecordTable.tsx:152-154` |
| `onScoreCommit` / `getMaxForCell` / `hpsData` | `hpsData` recomputed on every `classRecord` change → `getMaxForCell` → `handleScoreUpdate` → `commitScoreInput` new identities | `ClassRecordView.tsx:161-184`, `:187-190`, `:242-266` |

Also recomputed per keystroke: `tableRows` (`ClassRecordTable.tsx:191-239`),
`stats` (`ClassRecordView.tsx:214-219`), `wwCount/ptCount` (`useAssessmentMeta.ts:38-54`),
`wwColIsAims/ptColIsAims` (`ClassRecordTable.tsx:157-172`), plus `ClassRecordMobileList`
renders all learner cards even on desktop (`lg:hidden` still executes, `ClassRecordMobileList.tsx:38`).

### RC6 — Column meta editor opens on every score-cell focus

`LedgerScoreCell` `onFocus` → `LedgerRow` `onFocus` (`LedgerRow.tsx:191`) → `onCellFocus`
→ `ClassRecordView.tsx:343` → `metaHook.openMetaEditor` (`useAssessmentMeta.ts:99-108`)
which sets `selectedColumn` + `metaEditorDraft`. Every focus during Enter-spam triggers
2 state updates, re-renders the page, mounts the quick meta editor panel
(`AssessmentHeader.tsx:59-117`) and changes sticky-layout heights.
The tour only advertises opening it from **column header clicks** (`ClassRecordTour.tsx:144`).

### RC7 — Stale-snapshot payloads → potential lost updates

`executeScoreUpdate` builds the outgoing arrays from the `classRecord` snapshot captured at
render time (`classRecordActions.ts:264-291`), not from the latest optimistic cache. Two
rapid edits on different cells can race and the later request can overwrite the earlier
cell with an old value. With a write queue (Phase 2) payloads must be built from the latest
cache at flush time.

### RC8 — Enter navigation edge cases

- `document.querySelector` (`LedgerScoreCell.tsx:82-84`) is timing-dependent and only looks
  one row down; at the last row it finds nothing, so focus stays and every further Enter
  re-commits the same cell (currently 2 requests each, see RC2).
- Row indexes are unique across gender sections (shared `rowCounter` in
  `ClassRecordTable.tsx:191-239`) — OK, but the lookup assumes the next row exists.
- Tour text promises Tab/Arrow navigation (`ClassRecordTour.tsx:249`) that does not exist.

---

## 4. Target architecture

**Commit path (per cell):**
`commit → validate → optimistic cache write (instant UI) → enqueue edit (coalesced) →
debounced flush (≤1 request per dirty student per flush) → no per-commit refetch.`

**Focus path:**
`stable input identity (no remount on value change) → commit once (Enter or blur, never
both) → deterministic focus move → refetch can never steal focus or revert typed text.`

**Render path:**
`stable props → only the edited learner's row re-renders; untouched rows bail via memo.`

**Reconciliation:**
`error path refetches; optional single idle refetch per encoding burst; React Query
refetchOnWindowFocus stays as the safety net.`

---

## 5. Phases

### Phase 0 — Baseline & safety net

- [ ] **0.1** Capture baseline: DevTools Network (filter `grades`) request count for
      10 Enter presses down a column; record POST/GET counts and total transferred bytes.
      Keep it in the PR description.
- [ ] **0.2** Add E2E skeleton `e2e/class-record-encoding.spec.ts` (login via existing
      `e2e/fixtures.ts`, open a class record, expose a helper that types N scores with Enter).
      Assertions land in Phase 1/2; the spec may start as `test.skip` until then.
- [ ] **0.3** Confirm green baseline: `pnpm run verify` (root) and `pnpm --prefix server test`.

**Acceptance:** baseline numbers recorded; verify green; no source changes.

---

### Phase 1 — Stop the bleeding (hotfix; no new architecture)

Goal: kill the duplicate requests, the refetch-per-commit, and the focus loss. This phase
alone should remove most of the perceived lag and all "disappearing" symptoms.

- [ ] **1.1** Remove the per-commit refetch.
      In `classRecordActions.ts:304`, delete `await fetchClassRecord(true);` from the
      success path of `executeScoreUpdate`. Keep the error-path refetch at `:308`.
- [ ] **1.2** Commit-once semantics in `LedgerScoreCell.tsx`.
      - In `onKeyDown` Enter and in `onBlur`, only call `onCommit` when
        `e.currentTarget.value !== e.currentTarget.dataset.prev`.
      - Always perform the focus move on Enter, even when the value is unchanged.
      - `commitScoreInput` already writes `inputEl.dataset.prev` after a successful commit
        (`ClassRecordView.tsx:250,263`) and resets on invalid (`:256`), so the guard is
        sufficient.
- [ ] **1.3** Stop remounting inputs by value.
      - Remove the `key` at `LedgerScoreCell.tsx:40`.
      - Add a `ref` on the `<input>` and an effect that syncs `ref.current.value` (and
        `dataset.prev`) from the `value` prop **only when the input is not focused**
        (`document.activeElement !== ref.current`).
      - Keep `defaultValue` for initial mount. Keep all `data-*` attributes and aria labels.
      - This preserves the DOM/tour contract while making refetch updates non-destructive.
- [ ] **1.4** Defense in depth: in `executeScoreUpdate`, compare `newValue` against the
      current value in the query cache and return early if unchanged (no optimistic write,
      no request).
- [ ] **1.5** Make the focus move robust: keep the rAF, but if no next input is found do
      nothing (do not re-commit; covered by 1.2).

**Acceptance:**
- 10 Enter presses with values changed → exactly 10 POSTs, **0 GETs**; unchanged re-press → 0 requests.
- Focus lands on the next learner's input after every Enter; typing immediately after Enter
  always lands in the next row.
- No score reverts while encoding; no request fires when nothing changed.
- `pnpm run typecheck && pnpm run build && pnpm run lint` green for touched files.

**Rollback:** single commit revert; no server changes.

---

### Phase 2 — Coalescing write queue

Goal: one request per dirty student per flush; no lost updates; safe retries; explicit
reconciliation.

- [ ] **2.1** New module `src/pages/teacher/lib/scoreWriteQueue.ts` (pure, framework-free):
      - `enqueue(edit)` keyed `${studentId}:${category}:${index}` — last write wins.
      - `flush()` builds payloads from a **getter callback** (latest cache) and sends.
      - One in-flight flush at a time; edits arriving mid-flight schedule the next flush.
      - `dispose()` clears timers and flushes best-effort.
      - Debounce **500 ms** after the last enqueue (tunable constant).
- [ ] **2.2** Hook it up in `ClassRecordView`:
      - Split `executeScoreUpdate` into `applyOptimisticScoreUpdate` (existing cache write)
        and `flushScoreEdits` (request only).
      - `handleScoreUpdate` = optimistic write + `queue.enqueue(...)`.
      - Payload source: `queryClient.getQueryData(["class-record", classAssignmentId, selectedTerm])`
        at flush time (fixes RC7) — send one `POST /grades/grade` per dirty student with the
        full merged arrays for that student.
      - Keep the existing single-save endpoint (preserves per-save `GradeSnapshot` + audit
        semantics). Decision D-1 in §7 covers the batch alternative.
- [ ] **2.3** Flush triggers (all call `flush()` before proceeding):
      - term change (`onTermChange` wrapper) and `classAssignmentId` change;
      - component unmount (`useEffect` cleanup);
      - `visibilitychange` → hidden;
      - before `executeHpsUpdate`, `executeRemoveTask`, `saveMetaToAllStudents`,
        `saveColumnMeta`, `handleClearScores` (these build payloads from a full-class
        snapshot and would otherwise clobber pending edits).
- [ ] **2.4** Failure handling: retry up to 3× with backoff (1 s / 3 s / 8 s). On final
      failure: toast error, drop the batch, `refetch` to reconcile to server truth.
      Skipped students from the server response → toast (existing pattern).
- [ ] **2.5** Optional idle reconcile: 2–3 s after the queue empties and no flush is in
      flight, issue **one** class-record refetch for the burst; cancel it if a new edit is
      enqueued. Add `signal` support to `useClassRecordQuery`'s `queryFn`
      (`hooks/useClassRecord.ts:38-49`) and pass it to axios so cancellation is real.
- [ ] **2.6** Remove now-dead per-save refetch calls from the score path and delete unused
      `useSaveScore` mutation if nothing references it (`hooks/useClassRecord.ts:74-132`).

**Acceptance:**
- Typing 10 scores within a burst (≥2/sec) → ≤ 2 POSTs and ≤ 1 GET total.
- Values persist after a hard refresh; no reverts; ordering independent of latency.
- Kill the server mid-burst → toast appears, UI reconciles to last known server state.
- Navigating away within the debounce window still persists (unmount flush).
- No regression in HPS edit, add/remove task, meta apply, clear scores.

---

### Phase 3 — Render performance hardening

Goal: only the edited learner's row re-renders; commit-to-paint stays flat as class size grows.

- [ ] **3.1** `ClassRecordTable.tsx`: `weights` → `useMemo` (`:145-149`);
      `aimsWW/aimsPT/aimsQA` → `useMemo` (`:152-154`).
- [ ] **3.2** `ClassRecordView.tsx:343`: replace the inline `onCellFocus` with a
      `useCallback`; make `openMetaEditor` stable/dedupe in `useAssessmentMeta.ts:99-108`
      (functional `setSelectedColumn` that returns the previous object when the same column
      is already selected) — kills RC6's per-focus re-render.
- [ ] **3.3** Stabilize `getMaxForCell` by reading `hpsData` from a ref (`hpsDataRef`) so
      `handleScoreUpdate` / `commitScoreInput` identities stop churning on every data change
      (`ClassRecordView.tsx:178-190, 242-266`).
- [ ] **3.4** Gate `ClassRecordMobileList` behind a `useMediaQuery("(min-width: 1024px)")`
      check so it does not render 50 cards on desktop (optional, low risk).
- [ ] **3.5** Verify with React DevTools Profiler: a single score commit re-renders exactly
      one `LedgerRow` (plus the page shell), not the whole table.
- [ ] **3.6** Note (do not fix now): `hpsData` and `stats` are O(learners) recomputations per
      data change (`ClassRecordView.tsx:161-176, 214-219`); measure after 3.1–3.5 and only
      optimize if profiling still shows them.

**Acceptance:** profiler shows 1 row re-render per commit; no new memo-defeating props;
`pnpm run verify` green.

---

### Phase 4 — Navigation polish (Excel feel)

- [ ] **4.1** Enter at the last learner: keep focus in place (no-op, no request — Phase 1
      guarantees this). Optional product choice: wrap to the first learner of the next score
      category (WW → PT → EX).
- [ ] **4.2** Optional: implement ArrowUp/ArrowDown (same column) and Tab/ArrowRight
      (next category cell in the same row) to match the tour text
      (`ClassRecordTour.tsx:249`). Keep the existing `data-row-index`/`data-cat`/`data-col`
      lookup contract.
- [ ] **4.3** Keep `tutorial-*` ids and data attributes intact (`tutorial-cell-example`,
      `tutorial-hps-cell`, `tutorial-ledger-scores`, `tutorial-hps-row`).

**Acceptance:** tour still passes; navigation never fires requests by itself; no focus traps.

---

### Phase 5 — Server hardening (only if metrics still demand)

- [ ] **5.1** Cache `getGradeLockState` per school year (TTL 5–10 s, invalidated on
      admin lock/unlock) — `server/src/lib/gradeLocks.ts:37-68`.
- [ ] **5.2** Cache `resolveEffectiveWeightsForClassAssignment` per class assignment
      (TTL 60 s) — `server/src/routes/grades-sub/helpers.ts:220-280`.
- [ ] **5.3** Optional dedicated incremental endpoint (e.g. `PATCH /grades/grade/cell`)
      that applies one cell delta server-side (fewer reads, same snapshot + audit), if flush
      latency is still high under load.
- [ ] **5.4** Never weaken lock precedence or audit behavior to gain speed.

---

## 6. Test & verification plan

**Automated**
- `e2e/class-record-encoding.spec.ts`:
  1. Enter 10 scores down a column with `press("Enter")` between them.
  2. Assert `page.on("request")` counts: POST `/api/grades/grade` ≤ 2, GET
     `/api/grades/class-record/*` ≤ 1 for the burst.
  3. Assert focus stays on `[data-row-index="n+1"][data-cat="WW"][data-col="0"]`.
  4. Reload → assert all 10 values persisted.
  5. Kill/abort one request via route interception → assert toast + reconciled UI.
- `pnpm run verify` (typecheck + build + server build + lint + server tests) every phase.

**Manual regression matrix**
| Area | Check |
|---|---|
| Grade math | PS/WS/Initial/Term Grade identical to pre-change (spot-check 5 learners) |
| Locks | Past term, archived class, finalized grade → still read-only / 403 |
| Inherited grades | Editing an inherited stub still creates a real grade |
| AIMS columns | Imported cells render; Enter nav skips them; HPS row shows `—` |
| HPS / add / remove task | Still class-wide, single batch request, values persist |
| Meta editor | Header click opens editor; Apply persists; focus no longer opens it (Phase 3) |
| Mobile | `GradeEditModal` unaffected |
| Tour | `ClassRecordTour` steps all still highlight correctly |
| Clear scores | Confirm timer + clear still works after flushing pending edits |
| Offline | Server down mid-encoding → toast, retry, reconcile, no stuck UI |

---

## 7. Decisions to confirm

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Flush transport: single `/grades/grade` per dirty student (snapshot + audit per save) vs `/grades/grade/batch` (1 request, 1 audit, **no** per-edit snapshots) | Keep single-save for MVP; revisit batch only if flush volume is still too high |
| D-2 | Debounce interval | 500 ms (flush also on unmount/visibility/term change) |
| D-3 | Idle reconcile refetch after a burst | Yes, one per burst, cancellable; fallback is `refetchOnWindowFocus` |
| D-4 | Should focusing a score cell open the column meta editor? | No — header click only (matches tour); dedupe regardless |
| D-5 | Enter at last learner | Stay in place; optional wrap to next category |
| D-6 | Failed save UX | Toast + drop + reconcile; no permanent dirty markers in MVP |

---

## 8. Invariants (do not break)

1. Grade math semantics and rounding unchanged; server remains authoritative.
2. Grade lock precedence unchanged: archived → year → term (approved edit request) → system.
3. DOM/tour contract: `data-row-index`/`data-cat`/`data-col` and all `tutorial-*` ids.
4. Backend contracts unchanged in Phases 0–4 (no schema changes, no new required fields).
5. Do not touch `.env*`, EnrollPro/ATLAS write paths, or unrelated pages.
6. File size ≤ 1000 lines; `scoreWriteQueue.ts` must stay framework-free and small.
7. Optimistic UI must never show a value the server rejected without an error toast +
   reconcile.

---

## 9. Exit criteria

- Encoding a full column of ~40 learners with Enter: **0 visible lag**, no focus loss, no
  value reverts, and ≤ 3 total `grades` requests (vs ~80–160 today).
- Same behavior at Slow 3G (no reverts, no lost keystrokes; only save latency).
- All §6 checks pass; `pnpm run verify` green; no regression in the manual matrix.

---

## 10. Regression risk & safety analysis

There is no zero-risk change, but this plan is ordered so the risky parts are isolated and
each phase is a single revert. The failure modes that matter, and how they are prevented:

### 10.1 What must never break, and the guard for each

| Invariant | Realistic failure mode | Guard |
|---|---|---|
| Grade values persist | Phase 1 removes the success-path refetch; a save could fail silently | Optimistic UI + explicit error path keeps refetch (`classRecordActions.ts:308`); Phase 2 adds retry + toast + reconcile; reload test in E2E |
| Grade math (PS/WS/Initial/Term Grade) | Client/server divergence once server-derived fields stay `null` in cache | Ledger already computes all four client-side (`LedgerRow.tsx:85-117`); E2E/manual spot-check compares before/after; server remains authoritative in DB |
| Lock precedence | Faster save path bypassing locks | **No server change in Phases 0–4**; server keeps `checkGradeEditLocks` on every request |
| Audit / GradeSnapshot trail | Queue changes which endpoint is used | D-1 recommends keeping `POST /grades/grade` (snapshot + audit per save); batch endpoint is opt-in only |
| Optimistic writes never clobbered | Queue payload built from stale render snapshot (RC7) | Phase 2 builds payloads from latest React Query cache at flush time |
| HPS / meta / remove-task integrity | Pending cell edits clobbered by a class-wide save | Phase 2.3: flush pending edits before any class-wide action |
| Focus / keyboard workflow | Input remount or blur double-commit returns | Phase 1.2–1.3 with E2E focus assertions; tour ids untouched |
| Mobile, tour, forms, other pages | Touching shared components | Phases 0–4 touch only the ledger family; `ClassRecordMobileList`/`GradeEditModal` behavior unchanged; `pnpm run verify` |

### 10.2 Phase risk ranking (lowest → highest)

1. **Phase 1 (hotfix)** — low. Deletes one `await`, adds guards, removes a React `key`.
   Failure mode is "score not saved on some path", caught by the reload assertion and by
   the preserved error refetch. **Ship this alone first and observe.**
2. **Phase 3 (memoization)** — low. Pure render behavior; no request/semantics change.
3. **Phase 4 (navigation)** — low. Optional keys only.
4. **Phase 2 (queue)** — medium. Introduces deferred writes. Mitigated by: keeping the
   existing save endpoint and payload shape; flush on unmount/visibility/term change;
   `beforeunload` warning when the queue is non-empty (add in 2.3); retry + reconcile;
   optional kill switch (10.3).
5. **Phase 5 (server caching)** — medium. Only attempted if metrics demand it; TTLs are
   short and invalidation points are explicit; otherwise skipped entirely.

### 10.3 Recommended rollout controls

- **One phase per commit** (already in §1) — worst case is `git revert <sha>`.
- **Kill switch for the queue:** module-level constant or `localStorage` flag
  (`smart:scoreQueue=off`) that makes `handleScoreUpdate` fall back to the legacy
  save-then-refetch path. Keep it for one release, then delete.
- **Ship Phase 1 alone, watch for a day**, then proceed. If Phase 1 alone is enough
  (likely for the reported pain), Phase 2 can be postponed indefinitely.
- **`beforeunload` guard** while the queue has unsaved edits ("You have unsaved scores")
  so closing the tab inside the 500 ms debounce can never lose data silently.
- **No server deploy required** for Phases 0–4 — frontend-only, so rollback is instant and
  cannot leave the DB in a partial state.

### 10.4 What we are explicitly NOT changing (Phases 0–4)

- No Prisma schema changes, no migrations, no `.env`.
- No changes to `POST /grades/grade`, `GET /grades/class-record`, lock logic, grade math,
  audit, or snapshots.
- No changes to other pages, layouts, auth, or session keys.
- No behavior change for view-only/past-term/archived classes.

### 10.5 Honest residual risks

- Removing the per-commit refetch means the cache can hold client-computed derived values
  until the next natural refetch; a spot-check is included, but any hidden consumer of
  server-derived fields must be verified (grep for `writtenWorkPS`/`initialGrade` usage).
- Deferred writes widen the window where a browser crash loses ≤ 500 ms of edits; the
  `beforeunload` guard plus unmount/visibility flush bounds it, but not to zero.
- Phase 3.2 changes when the meta editor opens (header click only). Confirm D-4 with the
  product owner before shipping; the dedupe fallback is behavior-preserving.
