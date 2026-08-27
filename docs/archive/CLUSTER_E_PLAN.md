# Cluster E: EOSY Grade Lock + Term Boundary Enforcement — Planning Document (APPROVED)

**Created:** 2026-08-21
**Status:** APPROVED — ready to implement
**Decisions:** Locked per user confirmation 2026-08-21
**Updated:** Added term-boundary enforcement (past terms read-only)

---

## Critical Finding: Past-Term Grades Are Editable

**Current state:** Teachers CAN edit grades for ANY term (T1, T2, T3) regardless of which term is current. There is ZERO term-boundary validation in the entire codebase.

| Check | Exists? | Blocks past-term edits? |
|---|---|---|
| Auth / role | Yes | N/A |
| Grade lock (admin) | Yes | Only global lock |
| Class assignment ownership | Yes | N/A |
| Archived grade check | Yes | Only for finalized school years |
| **Term boundary check** | **NO** | **NO** |
| Frontend term restriction | **NO** | **NO** — all 3 terms always selectable |
| Backend term validation | **NO** | **NO** — `term` from body is trusted |

**Impact:** A teacher on T3 could accidentally overwrite T1/T2 grades that should be finalized. This must be fixed as part of Cluster E.

---

## Decisions

| Question | Decision |
|---|---|
| Scope | **School-wide** (not per-section) |
| Who can lock | **Registrar** (EOSY flow) + **Admin** (manual override) |
| Who can unlock | **Admin only** |
| Auto-lock trigger | **BOTH** — T3 end date AND EP EOSY phase detection |
| Warning system | **3-level color-coded** — 2 weeks GREEN, 1 week YELLOW, 3 days RED |
| Warning scope | **All terms** — T1, T2, T3 each get warnings based on their end dates |
| **Past-term editing** | **BLOCKED** — teachers cannot edit grades for terms that have ended |
| **Current-term editing** | **ALLOWED** — with warning banners based on time remaining |

---

## Term Dates Data Flow — CORRECTED

**EnrollPro DOES expose term dates. SMART currently ignores them.**

EP endpoints that return date data:
| Endpoint | Returns |
|---|---|
| `GET /settings/public` | "dates" (term start/end dates) |
| `GET /school-years/:id` | Full school year config with dates |
| `PATCH /school-years/:id/dates` | Update dates |
| `GET /school-years/next-defaults` | Suggested next-year dates |
| `calendarPolicyId` | Academic calendar structure |

**Current problem:** SMART's `EnrollProPublicSettings` interface (enrollproClient.ts:694-710) doesn't map the date fields. SMART ignores EP's dates and uses local admin-set dates.

**Fix:** SMART should pull term dates from EP on every sync cycle. Admin doesn't need to set dates manually — they come from EP.

**New data flow:**
```
EP (source of truth for term dates)
  → GET /settings/public (returns dates)
  → SMART syncs dates to SystemSettings
  → grades.ts uses EP-sourced dates for warnings
  → index.ts uses EP-sourced dates for auto-term advance
```

**Admin override:** Admin can still edit dates locally if needed (e.g., EP dates are wrong). But the default is EP-sourced.

---

## Complete Feature Set (5 Features)

### Feature 1: Term Boundary Enforcement (NEW — Critical)

**Rule:** Teachers CANNOT edit grades for past terms. Only the current term is editable.

**Backend change:** Add term validation to `POST /grade` endpoint.

```
Before saving a grade:
  1. Check gradeLock (existing)
  2. Check isArchived (existing)
  3. NEW: Check if req.body.term === sysSettings.currentTerm
     - If term < currentTerm → return 403 "Cannot edit grades for past terms"
     - If term > currentTerm → return 400 "Invalid term"
     - If term === currentTerm → allow (proceed to existing checks)
```

**Term ordering:** T1 < T2 < T3. If currentTerm is T3, T1 and T2 are past. If currentTerm is T2, T1 is past.

**Frontend change:** Disable past-term tabs in ClassRecordView.

```
When rendering term tabs:
  - T1 tab: enabled only if currentTerm === "T1"
  - T2 tab: enabled only if currentTerm === "T1" or "T2"
  - T3 tab: enabled only if currentTerm === "T1", "T2", or "T3"
  - Past terms: show as greyed out with "Past term — grades locked" tooltip
```

**Also change:** ClassRecordsList should indicate which terms are past.

**Files:**
- `server/src/routes/grades.ts` — add term boundary check in POST /grade
- `server/src/routes/grades.ts` — add term boundary check in POST /clear-scores
- `src/pages/teacher/ClassRecordView.tsx` — disable past-term tabs
- `src/pages/teacher/components/ClassRecordTable.tsx` — disable past-term columns
- `src/pages/teacher/components/ClassRecordMobileList.tsx` — disable past-term selection

---

### Feature 2: Grade Lock (Existing — Enhancement)

**Rule:** When registrar finalizes EOSY OR admin locks, ALL grade editing is blocked.

**Current state:** Admin toggle works. Registrar lock button missing. Auto-lock missing.

**Changes:**
1. Add "Lock Grades" button to registrar EOSY page
2. Auto-lock when term end date passes
3. Auto-lock when archive-year runs
4. Teacher-facing lock banner

**Files:**
- `src/pages/registrar/EOSYFinalization.tsx` — add lock button
- `server/src/index.ts` — auto-lock on term end
- `server/src/routes/admin.ts` — archive-year sets gradeLock
- `src/components/GradeStatusBanner.tsx` — NEW: shows lock/warning state

---

### Feature 3: Term-End Warning System (NEW)

**Rule:** Teachers see color-coded warnings as term end approaches.

**Warning levels:**
- GREEN (2+ weeks): "Grade Submission Open — X days remaining"
- YELLOW (1 week): "Grade Submission Closing Soon — X days remaining"
- RED (3 days): "Grade Submission Deadline — X days remaining"
- LOCKED: "Grade Editing Locked — contact admin"

**Applied to ALL terms:** T1, T2, T3 — whichever is currently active.

**Files:**
- `src/components/GradeStatusBanner.tsx` — NEW: unified warning component
- `src/pages/teacher/ClassRecordView.tsx` — add banner
- `src/pages/teacher/ClassRecordsList.tsx` — add banner
- `src/pages/teacher/Dashboard.tsx` — add banner
- `server/src/routes/grades.ts` — verify deadline-status returns all needed data

---

### Feature 4: Archive-Year Integration (Enhancement)

**Rule:** When admin runs archive-year, grades auto-lock.

**Current state:** archive-year archives grades/enrollments but does NOT set gradeLock.

**Change:** Add `gradeLock: true` to the settings update in archive-year.

**Files:**
- `server/src/routes/admin.ts` — add gradeLock to archive-year

---

### Feature 5: Admin Unlock Enhancement (Enhancement)

**Rule:** Admin can unlock grades with confirmation.

**Current state:** Toggle works but no confirmation dialog.

**Change:** Add confirmation dialog in admin settings.

**Files:**
- `src/pages/admin/SystemSettings.tsx` — add confirmation dialog

---

## Complete File Change Map

### Backend Changes (5 files)

| File | Changes | Lines |
|---|---|---|
| `server/src/routes/grades.ts` | Term boundary check in POST /grade, POST /clear-scores; verify deadline-status returns term dates | ~30 lines |
| `server/src/lib/enrollproClient.ts` | Update EnrollProPublicSettings interface to include date fields | ~10 lines |
| `server/src/lib/enrollproBrandingSync.ts` | Add term date sync from EP | ~20 lines |
| `server/src/index.ts` | Auto-lock on term end | ~20 lines |
| `server/src/routes/admin.ts` | Archive-year sets gradeLock; verify settings endpoint | ~5 lines |

### Frontend Changes (8 files)

| File | Changes | Lines |
|---|---|---|
| `src/components/GradeStatusBanner.tsx` | **NEW** — unified lock + warning banner component | ~80 lines |
| `src/pages/teacher/ClassRecordView.tsx` | Add banner; disable past-term tabs; disable save when locked | ~30 lines |
| `src/pages/teacher/components/ClassRecordTable.tsx` | Disable past-term columns | ~15 lines |
| `src/pages/teacher/components/ClassRecordMobileList.tsx` | Disable past-term selection | ~10 lines |
| `src/pages/teacher/ClassRecordsList.tsx` | Add banner | ~10 lines |
| `src/pages/teacher/Dashboard.tsx` | Add banner | ~10 lines |
| `src/pages/registrar/EOSYFinalization.tsx` | Add lock button + confirmation | ~40 lines |
| `src/pages/admin/SystemSettings.tsx` | Add lock/unlock confirmation dialog | ~20 lines |

**Total: 1 NEW file, 12 modified files**

---

## Detailed Implementation Steps

### Step 1: Term Boundary Enforcement — Backend (2 hours)

**File: `server/src/routes/grades.ts`**

Add to POST /grade (after existing checks at line ~440):

```typescript
// Term boundary check — cannot edit past terms
const termOrder = { T1: 1, T2: 2, T3: 3 };
const currentTermNum = termOrder[sysSettings?.currentTerm as keyof typeof termOrder] ?? 0;
const requestTermNum = termOrder[term as keyof typeof termOrder] ?? 0;

if (requestTermNum < currentTermNum) {
  res.status(403).json({ 
    message: `Cannot edit grades for ${term}. The current term is ${sysSettings?.currentTerm}. Past term grades are locked.` 
  });
  return;
}
```

Same check in POST /clear-scores (after gradeLock check).

**Also:** Add `currentTerm` and term end dates to the GET /class-record/:id response (if not already there).

---

### Step 2: Term Boundary Enforcement — Frontend (2 hours)

**File: `src/pages/teacher/ClassRecordView.tsx`**

Modify term selector:
- Read `currentTerm` from class record response
- Disable tabs for terms before currentTerm
- Show tooltip: "Past term — grades are finalized"
- Default to currentTerm on load (already does this)
- If user somehow navigates to past term, show read-only view

**File: `src/pages/teacher/components/ClassRecordTable.tsx`**

- Disable editing on past-term columns
- Visual: greyed out, no click handlers

**File: `src/pages/teacher/components/ClassRecordMobileList.tsx`**

- Disable past-term selection in mobile view

---

### Step 3: Grade Lock — Registrar Button (1 hour)

**File: `src/pages/registrar/EOSYFinalization.tsx`**

Add "Lock Grades for EOSY" button:
- Only visible when gradeLock is false
- Confirmation dialog: "This will prevent all teachers from editing grades. Only admin can unlock."
- Calls `adminApi.toggleGradeLock(true)`
- Shows success toast
- Refreshes page state

---

### Step 4: Pull Term Dates from EP (2 hours)

**NEW:** Add a sync step that pulls term dates from EP and stores them in SystemSettings.

**Implementation:**
1. Update `EnrollProPublicSettings` interface to include date fields from EP
2. In `enrollproBrandingSync.ts`, extract date fields from EP response
3. Map EP's dates to SMART's `t1StartDate`/`t1EndDate`/etc.
4. Store in SystemSettings on every sync cycle
5. If EP dates change, SMART auto-updates
6. Admin can still override locally if needed (fallback)

**EP endpoints to use:**
- `GET /settings/public` — returns "dates" (term start/end dates)
- `GET /school-years/:id` — full school year config with dates
- `calendarPolicyId` — academic calendar structure

**Files:**
- `server/src/lib/enrollproClient.ts` — update `EnrollProPublicSettings` interface to include date fields
- `server/src/lib/enrollproBrandingSync.ts` — add date sync logic
- `server/src/lib/schoolYearResolver.ts` — use EP-sourced dates for term resolution

---

### Step 5: Auto-Lock on Term End (1 hour)

**File: `server/src/index.ts`**

Modify `startAutoTermScheduler()`:
- On every run, check if current term's end date has passed
- Uses EP-sourced dates (from Step 4)
- If now > tXEndDate AND gradeLock is false → auto-set gradeLock=true
- Broadcast via SSE
- Log: "[Scheduler] Auto-locked grades for term {currentTerm} (end date passed)"

---

### Step 5: Warning Banner Component (1 hour)

**File: `src/components/GradeStatusBanner.tsx` (NEW)**

```typescript
interface GradeStatusBannerProps {
  currentTerm: string;
  termEndDate?: string;
  gradeLock: boolean;
  colors: { primary: string };
}

// Returns color-coded banner:
// - locked: red border, lock icon, "Grade editing is locked"
// - red (≤3 days): red border, alert icon, "X days remaining"
// - yellow (≤7 days): yellow border, clock icon, "X days remaining"
// - green (≤14 days): green border, check icon, "X days remaining"
// - none (>14 days or no date): no banner shown
```

**Files using it:**
- `ClassRecordView.tsx` — above the grade table
- `ClassRecordsList.tsx` — above the class list
- `Dashboard.tsx` — in the stats section

---

### Step 6: Admin Confirmation + Archive Integration (30 min)

**File: `src/pages/admin/SystemSettings.tsx`**
- Add confirmation dialog for grade lock toggle
- "Are you sure you want to lock/unlock grades?"

**File: `server/src/routes/admin.ts`**
- In archive-year endpoint, add `gradeLock: true` to settings update

---

## Term Boundary Logic — Complete Rules

```
IF gradeLock = true:
  → ALL terms locked (no editing)
  → Show: "Grade editing is locked"

ELSE IF term < currentTerm:
  → Past term — locked
  → Show: "Past term — grades are finalized"
  → Backend: return 403 on save attempt

ELSE IF term = currentTerm:
  → Current term — editing allowed
  → Check deadline warnings (GREEN/YELLOW/RED)
  → Show appropriate banner

ELSE IF term > currentTerm:
  → Future term — not yet available
  → Show: "Not yet available"
  → Backend: return 400 on save attempt
```

---

## Testing Checklist

### Term Boundary
- [ ] Teacher on T3 tries to edit T1 grade → blocked (403)
- [ ] Teacher on T3 tries to edit T2 grade → blocked (403)
- [ ] Teacher on T3 edits T3 grade → allowed
- [ ] Teacher on T2 tries to edit T1 grade → blocked (403)
- [ ] Teacher on T2 edits T2 grade → allowed
- [ ] Teacher on T1 edits T1 grade → allowed
- [ ] T1 tab greyed out when currentTerm is T2 or T3
- [ ] T2 tab greyed out when currentTerm is T3

### Grade Lock
- [ ] Registrar clicks "Lock Grades" → teachers cannot edit ANY term
- [ ] Admin clicks "Unlock" → teachers can edit again
- [ ] Auto-lock engages when term end date passes
- [ ] Archive-year auto-sets gradeLock

### Warnings
- [ ] 2+ weeks before term end → GREEN banner
- [ ] 1 week before term end → YELLOW banner
- [ ] 3 days before term end → RED banner
- [ ] After term end → LOCKED banner
- [ ] No term dates set → no banner (graceful degradation)

### Connected Flows
- [ ] clear-scores blocked for past terms
- [ ] Grade save blocked for past terms
- [ ] Grade save blocked when locked
- [ ] SSE broadcasts lock state changes
- [ ] Teacher dashboard shows correct banner
- [ ] Class records list shows correct banner

---

## Effort Estimate

| Step | Effort | Risk |
|---|---|---|
| Step 1: Term boundary — backend | 2 hours | MEDIUM |
| Step 2: Term boundary — frontend | 2 hours | MEDIUM |
| Step 3: Registrar lock button | 1 hour | LOW |
| Step 4: Pull term dates from EP | 2 hours | MEDIUM |
| Step 5: Auto-lock on term end | 1 hour | MEDIUM |
| Step 6: Warning banner component | 1 hour | LOW |
| Step 7: Admin confirmation + archive | 30 min | LOW |
| **Total** | **9.5 hours** | |

---

*Ready to implement on your go.*
