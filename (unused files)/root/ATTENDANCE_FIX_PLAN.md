# Teacher Attendance Fix Plan

## Current Issues

### 1. Timezone Bug (Critical)
**Location**: `src/pages/teacher/Attendance.tsx:61`
```tsx
const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
```

**Problem**: `toISOString()` uses UTC, not local time. In Philippines (UTC+8):
- After 8:00 PM local → shows **tomorrow's** date
- Before 8:00 AM UTC (4:00 PM local) → shows **today's** date

**Fix**: Use local date formatting:
```tsx
function getLocalDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
```

Same fix needed in `AttendanceReports.tsx:61`.

### 2. No Auto-Advance After Save
**Problem**: After saving attendance, date stays the same. Teacher must manually change to next day.

**Fix**: Add "Save & Next Day" button that:
1. Saves attendance
2. Advances date to next day
3. Skips weekends (Saturday/Sunday)

### 3. Too Many Clicks
**Current flow**: Open page → Select section → Mark each student → Click save

**Better flow**: Open page → Auto-select advisory → Auto-load today → Mark → Save & Next

### 4. No Keyboard Shortcuts
Teachers should be able to:
- Press `1-4` to set status for focused row
- Press `Enter` to move to next student
- Press `Ctrl+S` to save

### 5. No Confirmation Before Save
Accidental clicks can overwrite attendance records.

---

## Proposed Changes

### Frontend: `src/pages/teacher/Attendance.tsx`

#### Fix 1: Local Date Helper
Add at top of file:
```tsx
function getLocalDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getNextSchoolDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  // Skip weekends
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

#### Fix 2: Replace all `new Date().toISOString().split("T")[0]` with `getLocalDateStr()`

#### Fix 3: Add "Save & Next Day" Button
```tsx
<Button onClick={saveAndNextDay}>
  <Save className="w-4 h-4 mr-2" />
  SAVE & NEXT DAY
</Button>
```

New function:
```tsx
const saveAndNextDay = async () => {
  await saveAttendance();
  setSelectedDate(getNextSchoolDay(selectedDate));
};
```

#### Fix 4: Keyboard Navigation
Add `onKeyDown` handler to table rows:
- `1` = PRESENT, `2` = ABSENT, `3` = LATE, `4` = EXCUSED
- `Enter` = move to next student
- `Ctrl+S` = save

#### Fix 5: Confirmation Dialog
Before saving, show confirmation if any students are marked ABSENT:
```tsx
const absentCount = attendanceData.attendance.filter(s => s.status === "ABSENT").length;
if (absentCount > 0) {
  // Show confirmation
}
```

### Frontend: `src/pages/teacher/AttendanceReports.tsx`

#### Fix 1: Same local date helper
Replace `new Date().toISOString().split("T")[0]` with `getLocalDateStr()`.

---

## UI Improvements (Less Clicking)

### Before (Current)
```
[Section: Grade 7 - Rizal ▼] [Date: 2026-08-15]
[MARK ALL PRESENT] [COMMIT CHANGES]

LRN    | Name           | Status         | Remarks
001    | Cruz, Juan     | [•][X][/][E]   | [________]
002    | Santos, Maria  | [•][X][/][E]   | [________]
...
```

### After (Proposed)
```
[Advisory: Grade 7 - Rizal]  [Today: Aug 15, 2026 (Fri)]

[✓ MARK ALL] [SAVE & NEXT DAY ▶] [SAVE]

LRN    | Name           | P | A | L | E | Remarks
001    | Cruz, Juan     | ● |   |   |   | [________]
002    | Santos, Maria  |   | ● |   |   | [________]
...
```

Changes:
1. **Simplified status buttons**: Single letter columns (P/A/L/E) with radio-style selection
2. **"Save & Next Day"** button — one click to save and advance to Monday
3. **Keyboard shortcuts** — press 1-4 to set status, Enter to move down
4. **Auto-load advisory section** on page load

---

## Implementation Steps

1. Add `getLocalDateStr()` and `getNextSchoolDay()` helpers
2. Fix timezone bug in Attendance.tsx and AttendanceReports.tsx
3. Add "Save & Next Day" button and logic
4. Add keyboard navigation
5. Add confirmation dialog for absences
6. Simplify status button layout

---

## Testing Checklist

- [ ] Page loads with today's correct date (verify after 8 PM local time)
- [ ] Advisory section auto-selected
- [ ] Mark all present works
- [ ] Save works
- [ ] Save & Next Day advances to next school day (skips weekends)
- [ ] Keyboard shortcuts work (1-4 for status, Enter for next row, Ctrl+S for save)
- [ ] Confirmation appears when saving absences
- [ ] Monthly stats update after save
- [ ] Date picker prevents future dates
- [ ] Date picker allows past dates
