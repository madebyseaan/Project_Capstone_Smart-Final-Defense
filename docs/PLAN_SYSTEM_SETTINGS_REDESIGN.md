# PLAN — System Settings Redesign (UX + source-of-truth clarity)

> Status: IMPLEMENTED — decisions locked (§9). See “Implementation status” at the bottom.
> Goal: remove redundancy and dead controls **without removing working functions**, make
> EnrollPro-vs-SMART ownership obvious, and make grade locks understandable.

---

## 1. Why

Admin → System Settings currently has 6 tabs (School, Academic, Branding, Grade Locks, Security,
Advanced) that overlap and, in several places, lie to the user:

- Copy says school identity "cannot be edited" but some fields **are** editable and get overwritten by EnrollPro.
- Editable term dates **cannot actually be saved** (silently dropped by the API schema).
- Two unrelated lock systems sit side-by-side with no shared mental model.
- Four security controls are stored but **never enforced**.
- A demo seeding tool lives in the production admin surface.
- The settings GET endpoint is unauthenticated and leaks EnrollPro credentials.

---

## 2. Source of truth (answering the School tab question)

**Yes — for school identity, EnrollPro is the source of truth.** But not every field on the School tab
comes from EnrollPro. There are three ownership classes:

### A. EnrollPro-owned (SMART must show read-only + "Synced" provenance)

Written every ~60 min by `enrollproBrandingSync.ts:118-260` (cadence `syncCoordinator.ts:38`):

| Field | Sync writer |
|---|---|
| `schoolName` | `enrollproBrandingSync.ts:125` |
| `schoolHeadName` | `:126` |
| `email` (EP `depedEmail`) | `:129` |
| `logoUrl` | `:127` |
| `primaryColor` / `secondaryColor` / `accentColor` | `:119-122` |
| `currentSchoolYear`, `schoolYearId` | `:128`, `schoolYearResolver.ts:151-155` |
| `currentTerm` (cache) | `:226`; live from EnrollPro via `helpers.ts:66` |
| `t1StartDate` … `t3EndDate`, `termDatesDerived` | `:143-153, 177-190, 204-213` |

### B. SMART-local (EnrollPro has **no** such fields in its public payload — `enrollproClient.ts:903-929`)

`schoolId`, `division`, `region`, `address`, `contactNumber`, plus `district` (currently hardcoded `""`).

**Problem:** these are rendered **disabled** with the "synced" banner (`SchoolInformationSection.tsx:32-50`)
even though nothing ever syncs them. On a fresh install they stay at schema defaults
(`schema.prisma:429-433`: `"123456"`, `"Division of Sample City"`, `"Region IV-A CALABARZON"`).
**They must be editable local fields.**

### C. Derived / operational (never edited in System Settings)

Job title/labels (per school year), locks, retention, transition lock, developer tools.

---

## 3. Redundancy & dead-control inventory

| Item | Where | Verdict |
|---|---|---|
| Legacy `SystemSettings.gradeLock` vs `YearGradeLock`/`TermGradeLock` | `gradeLocks.ts:117-122` vs `:99-115` | **Keep both**, but present as one model (see §6) |
| `autoAdvanceTerm` toggle + copy | `AcademicSection.tsx:133-140, 180-187` | **Dead** — scheduler never advances (`index.ts:280-282`). Remove from UI |
| `sessionTimeout`, `maxLoginAttempts`, `passwordMinLength`, `requireSpecialChar` | `SecuritySection.tsx:36-77`; schema/route only | Stored, **never enforced**. Implement or hide (§9) |
| Editable-looking term dates | `AcademicSection.tsx:145-177` | **Cannot save** — stripped by `schemas/admin.ts:53-78`; `patch()` skips `onChange` (`:76-77`). Make read-only (EnrollPro-owned) |
| `contactNumber` | `ContactSection.tsx:39-47` | Write-only; no reader. Decide: surface on forms or remove |
| `address` | `ContactSection.tsx:29-37` | Snapshotted (`schoolSettingsSnapshot.ts:43`) but no form prints it. Decide: use on SF forms or remove |
| `email` | `ContactSection.tsx:49-58` | EnrollPro-owned, editable in SMART → conflict. Make read-only |
| `termLabels` from `GET /settings` | `api.ts:1676` | Ignored; real labels live in `SchoolYear` and are edited in `GradingConfig.tsx:211`. Consolidate (link or move) |
| Branding tab read-only vs orphan `uploadLogo` / `updateColors` APIs | `api.ts:1716-1728`; `system.ts:240,294` | Keep read-only (EnrollPro owns); **retire or keep dormant** the APIs |
| `currentSchoolYear` string vs `schoolYearId` FK + `SchoolYear.label` | `schoolYearResolver.ts:50-68` | DB stays; UI shows one "Active year" source |
| Demo seed/clear tools | `DeveloperToolsCard.tsx` | Gate to dev-only, out of normal admin path |
| Duplicate `POST /archive-year` | `system.ts:518` (live) vs `classAssignments.ts:597` (shadowed) | Delete shadowed handler |
| `transitionNote` | API accepts, UI never sends/shows (`system.ts:362`) | Wire a note field or drop param |
| `lockedBy/lockedAt/unlockedBy/unlockedAt` | fetched, never rendered (`system.ts:577-601`) | Surface in Grade Locks |
| `lastEnrollProSync` | shown in Branding only | Surface next to every synced group |

---

## 4. Defects to fix while redesigning

1. **Credential leak / auth gap** — `GET /api/admin/settings` has no `authenticateToken`
   (`system.ts:91`) and returns the raw row incl. `enrollproPassword` + `enrollproIntegrationKey`
   (`system.ts:110`). SSE also broadcasts the full row (`system.ts:231`).
   → Split into a public **sanitized** payload (theme need only) and an authenticated admin payload
   that never includes secrets. Also audit the SSE DTO.
2. **Save breaks on empty/null optional fields** — Zod uses `.optional()` not `.nullable()`; `email`
   uses `.email()` which rejects `""` (`schemas/admin.ts:59-62`). A blank field → 400, shown only as
   "Failed to save settings".
   → Make optional fields nullable + allow empty; field-level error messages.
3. **Sync clobbers unsaved edits** — SSE `setSettings(updatedSettings)` (`SystemSettings.tsx:75`),
   manual sync (`:163`), auto-sync on load (`:104-127`).
   → Never replace state while `hasChanges`; show "Updated in EnrollPro — review changes".
4. **Lock UI cross-talk** — `GradeLockSection` sets the page `saving` flag (`:23,31`), disabling the
   header Save; destructive semantics inverted (unlock button red, lock confirm destructive).
5. **No confirmations/tooltips** on per-term/year lock icon buttons (`GradeLocksPanel.tsx:108-150`),
   raw enum `Status` badge shown (`:105-107`).
6. **`Test Connection` button has no `onClick`**; "Database Status: Connected" hardcoded
   (`SecuritySection.tsx:120-133`).
7. **Rate-limiter path exemption likely never matches** — `req.path` inside `app.use("/api", …)` is
   relative (`/admin/settings`), so `startsWith("/api/admin/settings")` doesn't fire
   (`rateLimiter.ts:15`). Verify and fix while touching settings.

---

## 5. Proposed information architecture

Reduce 6 tabs → **5**, each with one job:

| Tab | Sections | Save model |
|---|---|---|
| **School** | 1. **Synced from EnrollPro** — name, school head, email, logo, colors (merged Branding). Read-only + "Last synced" + Sync now. 2. **Local school information** — School ID, Division, Region, Address, Contact number. Editable | Saved |
| **Academic** | 1. Active year + current term (read-only, synced) + term labels. 2. Term dates table (read-only, synced) with "auto-locks on end date" note. 3. Remove auto-advance toggle | Saved (labels only) |
| **Grade Locks** | Redesigned single model (§6) | Immediate (with confirms) |
| **Security & Retention** | Retention (working) + policy controls (implement or hide) + real DB status | Saved |
| **Advanced** | Diagnostics links (System Health), EnrollPro connection (credentials), developer tools (dev-gated) | Mixed |

**Two-zone rule (page-level):** everything under "Saved settings" obeys Save/Discard + dirty badge;
everything that takes effect instantly (locks, sync, dev tools) lives behind a clearly marked
"Applies immediately" divider with confirmation dialogs. No shared `saving` state between zones.

---

## 6. Grade Locks redesign (the confusing part)

### One mental model: “Who can edit grades, and why?”

Show the actual enforcement chain from `gradeLocks.ts:84-125` as a visible precedence ladder:

1. **Archived** — permanent; registrar/admin only (no UI toggle).
2. **Year lock** — whole school year; no bypass.
3. **Term lock** — that term only; an **approved Grade Edit Request** bypasses it.
4. **Emergency lock (legacy system-wide)** — all years; no bypass.

Adjacent guards to explain, not duplicate: `Grade.status = FINALIZED` (registrar unfinalize),
archived class assignment, and the current-term editing window.

### Proposed layout

```
Grade Locks
├─ Status card (Active SY 2026–2027 · ACTIVE)
│   T1 [Open|Locked]  T2 [...]  T3 [...]   Whole Year [Open|Locked]
│   each tile: state, reason (Auto — end date passed · Manual — <user>, <date>),
│              Lock/Unlock action, confirm dialog, optional note
├─ "How locks work" collapsible
│   precedence ladder + edit-request bypass + what unlocks what
├─ Pending edit requests: N pending · link → Edit Requests
├─ Other school years (collapsed table)
│   Year · Status · T1 · T2 · T3 · Whole Year — text-labelled buttons, tooltips,
│   lockedBy/lockedAt shown, archived years read-only
└─ Emergency: Lock all grade editing (all school years)
    legacy gradeLock, strong warning + typed/confirm, explains precedence
```

### Rules

- **Every lock/unlock gets a confirm dialog** with consequence copy (“Teachers will not be able to
  edit T1 grades until unlocked or an approved edit request exists.”).
- **Show provenance** (`lockedBy` / `lockedAt` / `unlockedAt`) — already returned by the API.
- **Kill the raw enum badge**; derive a human status (`Active`, `Archived`) — or drop it.
- **Destructive color semantics**: lock = warning/destructive action; unlock = safe. Fix inverted
  variants in `GradeLockSection.tsx:60,108`.
- **Never disable the header Save** while toggling a lock (remove shared `saving`).
- Replace the legacy toggle copy (“Lock grades during EOSY processing…”) with its real scope.
- Show term dates + auto-lock schedule read-only so "why did T1 lock?" is answerable in the UI.

---

## 7. Field-by-field disposition

| Field | Today | Plan |
|---|---|---|
| schoolName | synced, disabled | Read-only, synced group |
| schoolHeadName | editable, overwritten | Read-only, synced group |
| email | editable, overwritten | Read-only, synced group |
| schoolId / division / region | disabled, never synced | **Editable local** |
| address | editable, unused | Editable local; optionally print on SF forms |
| contactNumber | editable, unused | Editable local; optionally print on SF forms |
| logoUrl / colors | read-only | Read-only synced (merge Branding tab) |
| currentSchoolYear / currentTerm | disabled | Read-only synced, one "Active year" card |
| term dates | editable, unsavable | Read-only synced + schedule explainer |
| autoAdvanceTerm | toggle | **Remove** (dead) |
| termLabels | ignored in settings | Surface here or link to Grading Config |
| gradeLock | toggle | Keep as "Emergency (all years)", clearly scoped |
| transitionLock / note | toggle only | Keep + note field |
| sessionTimeout | stored | Implement or hide |
| maxLoginAttempts | stored | Enforce in login limiter or hide |
| passwordMinLength / requireSpecialChar | stored | Enforce in user schemas or hide |
| retention ×3 | working | Keep, inline "what it deletes" hints |
| enrollpro credentials | API only | Move to Advanced/Connections, never returned to client |
| dev seed/clear | Advanced tab | Dev-only gate + typed confirm |

---

## 8. Phased implementation

**P0 — Safety & API foundation**
- Authenticate `GET /settings`; create sanitized DTOs (public theme subset vs admin full-minus-secrets);
  stop leaking `enrollproPassword`/`enrollproIntegrationKey` in JSON and SSE.
- Fix `settingsUpdateSchema` (nullable/empty, term-date fields if kept), field-level errors.
- Dirty-state guard against SSE/sync clobber; verify/fix rate-limiter exemption.

**P1 — IA restructure**
- New 5-tab layout; School tab split into Synced vs Local; merge Branding into School.
- Make `schoolId/division/region/address/contactNumber` editable.
- Surface `lastEnrollProSync` + "Synced" chips; fix empty/null save.

**P2 — Grade Locks redesign**
- Status card + precedence explainer + confirmations + provenance + emergency section.
- Delete shadowed archive handler; fix destructive semantics; remove shared `saving`.

**P3 — Academic & dead controls**
- Term dates read-only + auto-lock schedule; remove `autoAdvanceTerm`.
- Decide + implement security enforcement (or hide); wire/remove Test Connection.
- Term-labels consolidation.

**P4 — Advanced cleanup**
- Dev-tools gate; EnrollPro connection card; retire or document orphan APIs.
- `transitionNote` UI or drop; remove redundant `currentSchoolYear` writes only if safe.

Every phase: `npm run build`, `npm run lint`, backend tests. No behavior change to grade-lock
enforcement without a test.

---

## 9. Decisions (LOCKED)

| # | Decision | Resolution |
|---|---|---|
| D1 | School ID / Division / Region / Address / Contact | **Editable local fields** (EnrollPro has no such fields) |
| D2 | School Head / Email | **Read-only, synced** — edit only in EnrollPro |
| D3 | Security policy controls | **Implement enforcement**: `maxLoginAttempts` in login limiter, `passwordMinLength` + `requireSpecialChar` in user schemas; `sessionTimeout` deferred until token work, hidden until then |
| D4 | Legacy system-wide lock | **Keep as “Emergency: lock all school years”**; retire in a later release if unused |
| D5 | Branding tab | **Merge into School** under “Synced from EnrollPro” |
| D6 | Orphan APIs (`uploadLogo`, `updateColors`) | **Delete** — conflicts with EnrollPro SoT. Keep `reset-term-dates` only if surfaced in the UI |
| D7 | `address` / `contactNumber` | **Print on SF5/SF1 header** if DepEd-compliant; otherwise remove the fields |

These resolve §3/§7: the “Synced” group is read-only, the “Local” group is editable, dead controls
are removed or implemented (never left displayed-but-inert), and grade locks use one visual model.

---

## 10. Out of scope

- EnrollPro-side changes (we can only consume what its public API exposes).
- Re-architecting term/date storage (SchoolYear vs SystemSettings split) — note only.
- School-year snapshot system (already implemented: `PLAN-school-settings-snapshot.md`).
- Teacher/registrar settings surfaces, backend scheduler timing changes.

---

## Implementation status (done)

**P0 — Safety & API**
- `GET /settings` now requires `authenticateToken + requireAdmin`; response sanitized.
- New public `GET /settings/public` (theme subset only) — `ThemeContext` switched to it.
- All settings responses + SSE broadcasts pass through `sanitizeSettings()`, so
  `enrollproPassword` / `enrollproIntegrationKey` never leave the server.
- `settingsUpdateSchema` now allows blank/null optional text and empty email
  (`optionalText`, `optionalEmail`); route normalizes empty → null.
- Rate limiter skip uses `originalUrl` and is method-aware (public + admin GET only).
- Unsaved-edit guard: SSE/auto-sync never clobber dirty state; shows a notice instead.

**P1 — IA restructure**
- Tabs: School · Academic · Grade Locks · Security & Retention · Advanced.
- `SchoolInformationSection` rewritten: “Synced from EnrollPro” (read-only name/head/email/logo/colors)
  + “Local School Information” (editable ID/division/region/address/contact).
- `BrandingSection` + `ContactSection` removed (merged).

**P2 — Grade Locks**
- `GradeLockSection` rewritten: precedence ladder, per-year/term matrix, emergency all-years lock
  (legacy `gradeLock`), transition lock with note, impact confirmations.
- `GradeLocksPanel` rewritten: text-labelled Locked/Open buttons, provenance in tooltips,
  archived years read-only, human status, confirm dialogs.

**P3 — Academic & controls**
- `AcademicSection` rewritten: read-only synced year/term/dates + auto-lock schedule explainer;
  `autoAdvanceTerm` toggle removed.
- `SecuritySection` rewritten: policy controls now enforced — `maxLoginAttempts` → login limiter,
  `passwordMinLength` + `requireSpecialChar` → user create/update (`lib/securityPolicy.ts`);
  `sessionTimeout` hidden; retention kept with hints; fake DB status replaced with System Health link.

**Tests:** `settings-schema.test.ts` (6) + existing suites — 221 passed, 0 failed.

**Not done (left intentionally):**
- D6 orphan APIs (`uploadLogo`, `updateColors`) still present but unused (dormant).
- D7 `address`/`contactNumber` not yet printed on SF forms.
- `transitionNote` UI added; `transitionNote` dropped on unlock (unchanged behavior).
- Developer tools kept under Advanced with the existing warning + confirm dialog (not env-gated).

