# AIMS Phase 3 — "Connect AIMS" Button on Class Records — Implementation Handoff

> **STATUS: GREEN-LIT — IMPLEMENT THIS DOCUMENT.**
> Lead decisions on all open questions are locked in the "Decisions" section at the bottom.
> Read `aims.md` (repo root), `HANDOFF_AIMS_REPORT.md` (Phase 1), and
> `HANDOFF_AIMS_REPORT_PHASE2.md` (Phase 2) first — all complete and verified. Build on them.

## Context — why this exists

The lead tried the AIMS flow on the Class Records page and found the entry point confusing:
the only way to connect a class is a tiny 10px text link ("Link AIMS Course") in the class
record hero (visible only after opening a record), or the "Link AIMS Course" button buried in
the AIMS panel further down the page. The lead wants an obvious **"Connect" button on the
Class Records list page itself**, with consistent "Connect" terminology across the flow.

**Important:** the empty course picker / manual Course ID prompt the lead hit was NOT a bug —
it is correct fail-soft behavior while the AIMS API key is missing (ops item, OOB sharing
pending). That is resolved by ops, not by this task.

## Key discovery (makes this cheap)

The backend `/grades/my-classes` route (`server/src/routes/grades-sub/classes.ts:46-77`) uses
`include` without a field `select` — so **`aimsCourseId` is already returned on every class**
in the teacher's list. **No backend changes are needed.** This is a frontend-only task.

---

## Task A — Frontend type (1 line)

**`src/lib/api.ts`** — `ClassAssignment` interface (~line 210): add

```ts
aimsCourseId?: string | null;
```

(Backend already sends it; this just types it.)

## Task B — "Connect AIMS" button on Class Records list page

**`src/pages/teacher/ClassRecordsList.tsx`**

### B1. Card view (`AssignmentCard`, ~line 80)

For **active, non-archived** classes where `!assignment.aimsCourseId`:

- Add a compact **"Connect AIMS"** pill button in the card footer area (near the
  "Active Record" badge row, ~lines 186-193), with a `Link2` (or `Plug`) lucide icon.
- ⚠️ The entire card is wrapped in `<Link to={/teacher/records/${id}}>` — the button MUST
  `e.preventDefault()` + `e.stopPropagation()` (see the delete button at ~line 197 for the
  exact pattern) and then navigate to `/teacher/records/${assignment.id}?connect=aims`.
- Suggested style: small outline pill using the AIMS token colors
  (`text-[var(--ledger-aims)]`, `border-[var(--ledger-aims)]/30`, `bg-[var(--ledger-aims-bg)]`)
  to match the established AIMS identity elsewhere; keep it subtle enough not to fight the
  card's primary "open record" action. Follow the surrounding card's sizing conventions
  (10px uppercase bold tracking-widest pattern used by sibling badges).

For classes where `aimsCourseId` IS set: show a small **"AIMS ✓"** status chip (same token
colors, non-interactive, `title` tooltip "AIMS course connected") so teachers can see which
classes are already connected at a glance. **(Lead decision: YES — chip is wanted.)**

**Archived / transferred cards: no connect button, no chip.** **(Lead decision: active cards
only — linking archived classes is pointless since the import route already blocks them.)**

### B2. List view mode

The page has `viewMode: "grid" | "list"` (~line 223). Find the list/table row rendering and
add the same two states there (compact chip column or inline action). If the list view is a
plain table, a small "Connect" / "AIMS ✓" cell at the end of each active row works. Match the
DataTable token rules if it uses the DataTable system.

### B3. Behavior

- Clicking Connect → navigate to the record with `?connect=aims` → record view auto-opens
  the link dialog (Task C). One click, no hunting.
- The picker dialog itself is unchanged (Phase 1/2 behavior: employee-number match → email →
  school-wide → manual ID).

## Task C — Auto-open the link dialog from the query param

**`src/pages/teacher/ClassRecordView.tsx`**

- On mount (and when the param appears), read the URL search param `connect` (react-router
  `useSearchParams`).
- If `connect === 'aims'` **and** the record is not yet linked (`!aimsData?.linked`):
  fire the existing `setLinkDialogSignal(s => s + 1)` mechanism (it already opens the AIMS
  link dialog — see how `ClassRecordHero`'s `onOpenAimsLink` uses it).
- After firing, remove the param (`setSearchParams({}, { replace: true })`) so a page refresh
  doesn't re-open the dialog.
- If already linked: just clear the param, do nothing.

## Task D — Hero CTA upgrade (terminology + prominence)

**`src/pages/teacher/components/ClassRecordHero.tsx` (~lines 68-79)**

- Replace the current 10px plain-text "Link AIMS Course" button with a visible compact
  **"Connect AIMS"** pill button (icon + label, same AIMS token colors as Task B, hover
  state). Keep it in the same badge-row position.
- Keep the existing `AIMS · {code}` badge for connected records (unchanged).
- Behavior unchanged: calls `onOpenAimsLink()`.

## Task E — Terminology consistency (small, required)

The lead's mental model is **"Connect"**. Standardize the one-time linking action:

- `AimsPanel.tsx` unlinked-state button: "Link AIMS Course" → **"Connect AIMS Course"**
- Link dialog title (`AimsPanel.tsx`): "Link AIMS Course" → **"Connect AIMS Course"**
- Success toasts: "linked" → "connected" ("AIMS course connected successfully", etc.)
- **Do NOT rename code identifiers** (routes `/aims-link`, `linkAims`, `aimsLinkSchema` stay
  as-is — backend/API contract unchanged). Words on screen only.
- **Rename "Unlink" → "Disconnect"** (lead decision: yes, match the Connect terminology) —
  the `AimsPanel.tsx` button label, its hover styles, and the "unlinked" toast wording
  ("AIMS course disconnected"). Code identifiers (`unlinkAims`, `DELETE /aims-link/...`)
  stay unchanged.

---

## Out of scope (do not do)

- Any backend/API changes (aimsCourseId already flows; routes stay `/aims-link/*`)
- Any change to the picker logic, sync logic, or import flow (Phases 1-2, verified)
- Admin/registrar pages
- Any writes to AIMS

## Verification (required)

- `npm run build` (root) + `npm run lint` (zero new warnings)
- `npm --prefix server run test` — expect 144 passed / 57 skipped (should be untouched)
- Manual pass: card view + list view show Connect/AIMS✓ correctly; click Connect → record
  opens → dialog auto-opens; param cleared on refresh; archived cards show nothing;
  "Disconnect" wording live on the panel
- The empty course picker (manual-ID fallback) is EXPECTED until the AIMS API key is
  shared OOB — do not "fix" it, do not block on it

## Report back

When implementation is complete, write **`HANDOFF_AIMS_REPORT_PHASE3.md`** (repo root)
containing:

1. **Files changed** — with line references for every change
2. **Build/lint/test results** — actual output (or honest summary)
3. **Deviations** — anywhere you diverged from this doc and why
4. **Discoveries** — anything found that this doc missed
5. **Open items** — anything left for the lead

The lead (or their checker agent) will verify the report against this doc.

---

## Decisions (locked by lead — do not re-litigate)

1. **Connected chip: YES** — cards show "Connect AIMS" when not linked AND an "AIMS ✓"
   chip when linked.
2. **"Unlink" → "Disconnect": YES** — on-screen label only; code identifiers unchanged.
3. **Archived cards: ACTIVE ONLY** — no Connect button, no chip on archived/transferred cards.
4. **Timing: implement now** — the AIMS API key is NOT needed for this task; the UI is
   testable offline (empty picker is expected fail-soft until the key arrives).

**Ops reminder (no code):** AIMS API key still pending OOB sharing from the AIMS dev —
after it lands in `server/.env` as `AIMS_API_KEY`, restart the backend and the picker
goes live with no further code changes.
