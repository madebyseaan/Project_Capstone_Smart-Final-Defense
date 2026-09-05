# Teacher Schedule Feature — Implementation Plan

Date: 2026-08-17  
Status: PLANNING

---

## Goal

Add a "Schedule" page to the Teacher Portal showing the teacher's weekly timetable (Monday–Friday) pulled from ATLAS published schedule data. Must always be fresh, never show stale data, and look great.

---

## 1. What ATLAS Gives Us

ATLAS published schedule endpoint:  
`GET /schools/:schoolId/schedules/published/faculty/:facultyId`

Response shape:
```json
{
  "schoolId": 1,
  "termId": 1,
  "publishedAt": "2026-05-11T03:30:00.000Z",
  "entries": [
    {
      "sectionId": 101,
      "facultyId": 7947,
      "roomId": 3,
      "day": "MONDAY",
      "startTime": "07:00",
      "endTime": "08:00",
      "subjectCode": "ENG"
    }
  ]
}
```

Fields per entry: `day`, `startTime`, `endTime`, `subjectCode`, `sectionId`, `facultyId`, `roomId`

Days: Monday–Friday only (ATLAS has no Saturday/Sunday in its data model)

School day: 07:00–17:00, 60-minute periods, lunch 12:00–13:00

---

## 2. Current Problem

ATLAS provides full schedule data (day, time, room) but SMART currently **discards** it:

- `atlasSync.ts` line 422-426: reads `subjectCode` + `sectionId` only, ignores `day`/`startTime`/`endTime`/`roomId`
- `teacherSync.ts` line 460: same — extracts subject+section for `ClassAssignment`, drops time data
- No Prisma model exists for schedule entries (no `ScheduleEntry`, `TimeSlot`, or `Timetable`)
- No API endpoint exposes published schedule data to the frontend
- No frontend page or component exists for viewing a schedule

---

## 3. What We Need to Build

### 3.1 Backend: New Prisma Model

Add `ScheduleEntry` to `server/prisma/schema.prisma`:

```prisma
model ScheduleEntry {
  id              String   @id @default(cuid())
  teacherId       String
  teacher         Teacher  @relation(fields: [teacherId], references: [id])
  subjectId       String
  subject         Subject  @relation(fields: [subjectId], references: [id])
  sectionId       String
  section         Section  @relation(fields: [sectionId], references: [id])
  schoolYear      String
  day             String   // "MONDAY", "TUESDAY", etc.
  startTime       String   // "07:00"
  endTime         String   // "08:00"
  roomId          Int?     // ATLAS room ID
  atlasEntryId    String?  // dedup key from ATLAS
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([teacherId, subjectId, sectionId, schoolYear, day, startTime])
  @@index([teacherId, schoolYear])
}
```

Add relation on `Teacher`:
```prisma
model Teacher {
  // ... existing fields
  scheduleEntries ScheduleEntry[]
}
```

### 3.2 Backend: Sync Schedule Entries

Modify `atlasSync.ts` to persist day/time/room data from published schedule entries.

**Where:** Inside `fetchFacultyAssignment()` (line 279), after fetching `pubEntries`.

**What changes:**
- Extract `day`, `startTime`, `endTime`, `roomId` from each published entry
- Upsert into `ScheduleEntry` table
- Delete stale entries (entries in DB but not in current ATLAS response)

**Sync logic per faculty:**
```
1. Fetch published schedule: /schools/1/schedules/published/faculty/:facultyId
2. For each entry with day + startTime + endTime:
   a. Resolve subjectCode → SMART Subject (existing logic)
   b. Resolve sectionId → SMART Section via EnrollPro (existing logic)
   c. Upsert ScheduleEntry with dedup on (teacherId, subjectId, sectionId, schoolYear, day, startTime)
3. After processing all entries, soft-delete ScheduleEntries for this teacher+schoolYear
   that were NOT in the current ATLAS response (stale cleanup)
```

**Sync trigger:** Same as existing — runs every 5 minutes via `syncCoordinator.ts`.
**Important:** ATLAS does NOT have webhooks. SMART always polls ATLAS. No push mechanism exists.

### 3.3 Backend: API Endpoint

Add new endpoint in `server/src/routes/registrar.ts` or create `server/src/routes/schedule.ts`:

```
GET /api/teacher/schedule
  → Returns logged-in teacher's schedule entries for current school year
  → Grouped by day for easy frontend rendering
  → Uses existing auth middleware

Response:
{
  "schoolYear": "2026-2027",
  "publishedAt": "2026-05-11T03:30:00.000Z",
  "entries": [
    {
      "id": "...",
      "day": "MONDAY",
      "startTime": "07:00",
      "endTime": "08:00",
      "subject": { "code": "ENG7", "name": "English 7" },
      "section": { "name": "7-Rizal", "gradeLevel": "GRADE_7" },
      "room": "Room 101"
    }
  ],
  "byDay": {
    "MONDAY": [ ... ],
    "TUESDAY": [ ... ],
    ...
  }
}
```

### 3.4 Backend: Freshness Guard

To avoid stale schedule display:

1. **Include `publishedAt`** from ATLAS in the response — frontend shows "Last updated: ..." timestamp
2. **Add `scheduleLastSyncedAt`** field to response — when the last successful ATLAS sync ran
3. **On-demand refresh**: Add `POST /api/teacher/schedule/refresh` that triggers an immediate sync and returns fresh data (with loading state)

### 3.5 Frontend: New Page

**File:** `src/pages/teacher/Schedule.tsx`

**Route:** `/teacher/schedule`  
**Sidebar:** OPERATIONS section, after Dashboard

#### UI Design: Weekly Timetable Grid

```
┌─────────────────────────────────────────────────────────────────┐
│  TEACHER PORTAL                                                 │
│  My Schedule                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  📅 WEEKLY SCHEDULE                          S.Y. 2026-2027│  │
│  │  Your classes this week                      Last sync: 2m │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────┬─────────┬─────────┬─────────┬─────────┬─────────┐     │
│  │TIME │ MONDAY  │ TUESDAY │WEDNESDAY│ THURSDAY│ FRIDAY  │     │
│  ├─────┼─────────┼─────────┼─────────┼─────────┼─────────┤     │
│  │07:00│ English │  Math   │ Science │ English │  Math   │     │
│  │-    │ 7-Rizal │ 8-Nora  │ 9-Rizal │ 7-Rizal │ 8-Nora  │     │
│  │08:00│ Rm 101  │ Rm 203  │ Rm 105  │ Rm 101  │ Rm 203  │     │
│  ├─────┼─────────┼─────────┼─────────┼─────────┼─────────┤     │
│  │08:00│  Math   │ Science │ English │  Math   │ Science │     │
│  │-    │ 7-Rizal │ 7-Rizal │ 8-Nora  │ 7-Rizal │ 7-Rizal │     │
│  │09:00│ Rm 102  │ Rm 105  │ Rm 203  │ Rm 102  │ Rm 105  │     │
│  ├─────┼─────────┼─────────┼─────────┼─────────┼─────────┤     │
│  │ ... │  ...    │  ...    │  ...    │  ...    │  ...    │     │
│  └─────┴─────────┴─────────┴─────────┴─────────┴─────────┘     │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  TODAY'S CLASSES                                          │  │
│  │                                                           │  │
│  │  07:00 – 08:00  English 7  ·  7-Rizal  ·  Rm 101        │  │
│  │  08:00 – 09:00  Math 7     ·  7-Rizal  ·  Rm 102        │  │
│  │  09:00 – 10:00  Science 7  ·  7-Rizal  ·  Rm 105        │  │
│  │  ...                                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UI Sections

1. **Header card** — Page title, school year badge, last sync timestamp
2. **Weekly timetable grid** — 5-column grid (Mon–Fri), rows by time period, cells colored by subject
3. **Today's classes list** — Filtered view of just today's schedule, sorted by time
4. **Empty state** — "No schedule published yet" with helpful message

#### Design System (matching existing teacher pages)

- Page wrapper: `<div className="space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">`
- Cards: `border-0 shadow-2xl shadow-slate-200/40 rounded-[2.5rem] overflow-hidden bg-white`
- Section headers: Icon in `p-2 rounded-xl bg-slate-900 text-white` + title + subtitle
- Typography: `text-4xl font-black` page title, `text-[10px] font-black uppercase tracking-widest` labels
- Subject cells: Color-coded by subject type (use `colors.primary` for primary subject, indigo for math, emerald for science, etc.)
- Loading spinner: Existing pattern with animated border + icon
- Empty state: Existing pattern with dashed border + icon + message

#### Data Fetching

Follow existing pattern (no React Query — use raw `useEffect` + `useState`):

```tsx
const { syncVersion } = useSyncStream();
const [schedule, setSchedule] = useState<ScheduleData | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const fetchSchedule = async () => {
    try {
      const res = await scheduleApi.getMySchedule();
      setSchedule(res.data);
    } catch (err) {
      setError("Failed to load schedule");
    } finally {
      setLoading(false);
    }
  };
  fetchSchedule();
}, [syncVersion]);
```

This ensures auto-refresh when ATLAS sync completes (via SSE → `syncVersion` increment).

### 3.6 Frontend: API Client

Add to `src/lib/api.ts`:

```ts
export const scheduleApi = {
  getMySchedule: () => api.get<ScheduleResponse>("/teacher/schedule"),
  refreshSchedule: () => api.post<ScheduleResponse>("/teacher/schedule/refresh"),
};
```

### 3.7 Frontend: Sidebar Navigation

**File:** `src/layouts/TeacherLayout.tsx`

Add to `navigationGroups[0].items` (OPERATIONS section, after Dashboard):

```ts
{
  name: "Schedule",
  href: "/teacher/schedule",
  icon: CalendarDays,  // from lucide-react
}
```

Add route to `src/App.tsx`:
```tsx
<Route path="schedule" element={<TeacherSchedule />} />
```

---

## 4. Sync Freshness Strategy

### Reality: No Webhooks Exist

**ATLAS, EnrollPro, and AIMS have NO webhook/push/callback capability.** SMART created webhook endpoints speculatively (`integration.ts` lines 68-123), but no external system ever calls them. Every sync is initiated by SMART polling.

ATLAS is purely request/response REST API. EnrollPro's docs explicitly say "companion systems should use their own scheduled or event-driven synchronization."

### Actual Sync Triggers (all internal to SMART)

| Trigger | Source | Timing |
|---|---|---|
| Background timer | `syncCoordinator.ts` | Every 5 minutes (configurable via `SYNC_INTERVAL_MS`) |
| Teacher login | `auth.ts` line 144 | `triggerImmediateSync('login')` fires on every teacher login |
| Registrar page load | `registrar.ts` line 99 | Fires when data is stale (>10 min) |
| Registrar manual button | `registrar.ts` line 296 | Admin clicks "Force Sync" |
| Admin manual button | `admin.ts` lines 1345, 1360 | Admin triggers ATLAS or EnrollPro sync |

### Freshness for Schedule Feature

| Layer | Mechanism | Timing |
|---|---|---|
| 1. Background sync | `syncCoordinator.ts` 5-min cycle | Automatic, always running |
| 2. Teacher login trigger | `triggerImmediateSync('login')` on auth | Every login |
| 3. SSE auto-refresh | `useSyncStream` hook → `syncVersion` → re-fetch | On every `SYNC_COMPLETE` |
| 4. Manual refresh button | Teacher clicks "Refresh" → `POST /teacher/schedule/refresh` → immediate sync | On-demand |
| 5. Stale detection | If `lastSyncAt` > 10 min, show warning banner + auto-trigger sync | Proactive |

### Freshness Guarantee
- **Normal case:** 5-minute sync cycle → SSE → frontend refresh
- **Login case:** Immediate sync fires → data refreshes within seconds
- **Worst case:** ~5 minutes (timer just missed + next cycle pending)
- **Manual override:** Refresh button for immediate update

### Stale Data UI
If `lastSyncAt` is older than 10 minutes, show a subtle warning:
```
⚠ Schedule data may be outdated. Last synced: 15 minutes ago. [Refresh Now]
```

### Why 5 Minutes Is Fine for Schedules
- ATLAS published schedules change rarely (once per school year, occasional room/period swaps)
- The primary use case is daily reference — a 5-min delay on schedule data is imperceptible
- Teacher login triggers an immediate sync, so the first load of each session is fresh
- Manual refresh button covers edge cases (e.g., admin just updated a room assignment)

---

## 5. Implementation Steps (Ordered)

### Phase 0: Fix useSyncStream 403 Bug (PREREQUISITE)
1. Fix `useSyncStream.ts` — handle 403 with token refresh + reconnect
2. Fix `api.ts` interceptor — update `sessionStorage` on token refresh
3. Test: Login → wait 15+ min → verify SSE reconnects without 403 loop

### Phase 1: Database + Sync (Backend)
1. Add `ScheduleEntry` model to Prisma schema
2. Add relation to `Teacher` model
3. Run `prisma migrate dev` to create migration
4. Modify `atlasSync.ts` to persist published schedule entries (day, startTime, endTime, roomId)
5. Add stale entry cleanup logic in sync
6. Test: Run sync, verify `ScheduleEntry` table populated with ATLAS data

### Phase 2: API (Backend)
7. Add `GET /api/teacher/schedule` endpoint
8. Add `POST /api/teacher/schedule/refresh` endpoint (triggers immediate sync via `triggerImmediateSync`)
9. Add `publishedAt` and `lastSyncedAt` to response
10. Test: Hit endpoint with curl, verify response shape

### Phase 3: Frontend - Navigation
11. Add "Schedule" to `TeacherLayout.tsx` OPERATIONS section
12. Add route to `App.tsx`
13. Test: Verify sidebar link appears and navigates correctly

### Phase 4: Frontend - Schedule Page
14. Create `src/pages/teacher/Schedule.tsx` with weekly grid layout
15. Add `scheduleApi` to `src/lib/api.ts`
16. Implement data fetching with `useSyncStream` pattern
17. Build weekly timetable grid component
18. Build today's classes list component
19. Add loading, error, and empty states
20. Add subject color coding
21. Add last-synced timestamp display
22. Add manual refresh button
23. Add stale data warning banner

### Phase 5: Polish + Testing
24. Responsive design (mobile: stack days vertically)
25. Empty state for "no schedule published"
26. Edge case: teacher with no ATLAS data
27. Edge case: partial schedule (some days empty)
28. Test full flow: login → sidebar → schedule page → auto-refresh on sync

---

## 7. Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `src/hooks/useSyncStream.ts` | Modify | Fix 403 loop — handle token refresh on expired token |
| `src/lib/api.ts` | Modify | Update sessionStorage on token refresh + add `scheduleApi` methods |
| `server/prisma/schema.prisma` | Modify | Add `ScheduleEntry` model + Teacher relation |
| `server/prisma/migrations/...` | Create | DB migration |
| `server/src/lib/atlasSync.ts` | Modify | Extract + persist day/time/room from published entries |
| `server/src/routes/registrar.ts` or new `schedule.ts` | Create/Modify | Add API endpoints |
| `src/pages/teacher/Schedule.tsx` | Create | New schedule page |
| `src/layouts/TeacherLayout.tsx` | Modify | Add sidebar link |
| `src/App.tsx` | Modify | Add route |

---

## 8. Subject Color Mapping

For the timetable grid cells, assign colors by subject family:

| Subject Family | Color | Tailwind |
|---|---|---|
| English (ENG) | Blue | `bg-blue-50 text-blue-700 border-blue-200` |
| Math (MATH) | Indigo | `bg-indigo-50 text-indigo-700 border-indigo-200` |
| Science (SCI) | Emerald | `bg-emerald-50 text-emerald-700 border-emerald-200` |
| Filipino (FIL) | Rose | `bg-rose-50 text-rose-700 border-rose-200` |
| Araling Panlipunan (AP) | Amber | `bg-amber-50 text-amber-700 border-amber-200` |
| ESP | Purple | `bg-purple-50 text-purple-700 border-purple-200` |
| TLE | Teal | `bg-teal-50 text-teal-700 border-teal-200` |
| MAPEH | Orange | `bg-orange-50 text-orange-700 border-orange-200` |
| Homeroom Guidance (HG) | Slate | `bg-slate-50 text-slate-700 border-slate-200` |
| Others | Primary theme color | `bg-primary/10 text-primary border-primary/20` |

---

## 9. Risks + Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ATLAS published schedule empty | Teacher sees no schedule | Show "No schedule published yet" empty state + fallback to ClassAssignment list |
| ATLAS API slow/down | Delayed schedule load | Show last-known schedule from DB + "Schedule may be outdated" banner |
| Section ID mismatch (ATLAS vs EnrollPro) | Entries not displayed | Use existing name-based fallback matching |
| Schedule changes mid-week | Teacher sees old data | Login-triggered sync + manual refresh button available; 5-min auto-sync catches changes |
| Many schedule entries (slow query) | Page loads slowly | Index on `(teacherId, schoolYear)` + cache response for 30s |

---

## 9. useSyncStream 403 Bug — Fix Required Before Schedule Feature

### Problem

The SSE connection fails with 403 every ~30 seconds in an infinite loop. This affects ALL pages that use `useSyncStream` (Dashboard, Class Records, My Advisory, and the new Schedule page).

### Root Cause

Access token expires in **15 minutes** (`tokens.ts:9`), but `useSyncStream` reads the token from `sessionStorage` once and never refreshes it:

```
1. Teacher logs in → sessionStorage.setItem("token", ...)  (LoginPage.tsx:62)
2. useSyncStream reads token from sessionStorage             (useSyncStream.ts:80)
3. 15 minutes pass → token expires
4. SSE reconnect → sends expired token → 403
5. Retry every 30s → same expired token → infinite 403 loop
```

**Why it never recovers:**
- Refresh endpoint returns new token (`auth.ts:324`: `res.json({ token: newAccessTokenFinal })`)
- But nobody stores it in `sessionStorage` — only login pages do `sessionStorage.setItem("token", ...)`
- Axios interceptor calls refresh for normal API calls (`api.ts:52`) but doesn't update `sessionStorage`
- SSE hook uses raw `fetch()`, not axios — no interceptor, no refresh logic

### Fix: Two Changes Needed

#### Fix 1: `useSyncStream.ts` — Handle 403 with token refresh

On 403 response, trigger a refresh and reconnect with the new token:

```typescript
// In the connect() function, after response check:
if (response.status === 403) {
  // Token expired — try refresh
  try {
    const refreshRes = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include', // sends refreshToken cookie
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      if (data.token) {
        sessionStorage.setItem('token', data.token); // update stored token
        // Retry connection immediately with new token
        backoffRef.current = INITIAL_BACKOFF_MS;
        connect();
        return;
      }
    }
    // Refresh failed — redirect to login
    window.location.href = '/login';
    return;
  } catch {
    window.location.href = '/login';
    return;
  }
}
```

#### Fix 2: `api.ts` interceptor — Update sessionStorage on refresh

When axios refreshes the token, store it in `sessionStorage` so SSE hook picks it up:

```typescript
// In the axios interceptor, after successful refresh (line 52-54):
try {
  const refreshResponse = await api.post("/auth/refresh");
  // Store new token in sessionStorage for SSE hook
  if (refreshResponse.data?.token) {
    sessionStorage.setItem("token", refreshResponse.data.token);
  }
  processQueue(null, "refreshed");
  return api(originalRequest);
} catch (refreshError) {
```

### Why Both Fixes Are Needed

| Fix | Purpose |
|---|---|
| Fix 1 (useSyncStream) | SSE hook can self-recover when token expires mid-connection |
| Fix 2 (api.ts interceptor) | Keeps sessionStorage in sync so SSE hook always has a fresh token |

Without Fix 1: SSE loop continues even if axios refreshes the token (SSE doesn't know).
Without Fix 2: SSE hook gets a fresh token from Fix 1, but next reconnect (15 min later) fails again because sessionStorage is stale.

### Impact on Schedule Feature

The schedule page will use `useSyncStream` for auto-refresh. If the 403 bug isn't fixed:
- Schedule page won't auto-refresh on sync completion
- Console fills with 403 warnings every 30 seconds
- Teacher sees stale schedule data

**This fix must be completed before or alongside the schedule feature.**

### Testing Checklist for This Fix

- [ ] Login → wait 15+ minutes → verify SSE reconnects without 403
- [ ] Verify `sessionStorage.getItem('token')` updates after refresh
- [ ] Verify no 403 loops in console after token expiry
- [ ] Verify SSE still receives `SYNC_COMPLETE` events after token refresh
- [ ] Verify redirect to login when refresh token is also expired

---

## 10. Testing Checklist

- [ ] Prisma migration runs without errors
- [ ] ATLAS sync populates `ScheduleEntry` table
- [ ] Stale entries are cleaned up on sync
- [ ] `GET /api/teacher/schedule` returns correct response shape
- [ ] `POST /api/teacher/schedule/refresh` triggers sync + returns fresh data
- [ ] Sidebar shows "Schedule" under OPERATIONS
- [ ] Schedule page loads with weekly grid
- [ ] Today's classes list shows correct day
- [ ] Loading state displays while fetching
- [ ] Empty state shows when no schedule exists
- [ ] Auto-refresh works when sync completes (test by triggering manual sync)
- [ ] Manual refresh button triggers sync and updates view
- [ ] Stale warning appears when lastSyncAt > 10 minutes
- [ ] Subject colors are consistent across cells
- [ ] Responsive: mobile shows stacked day columns
- [ ] Teacher with no ATLAS data sees appropriate empty state
- [ ] Page works when ATLAS is temporarily unreachable (shows last-known data)
