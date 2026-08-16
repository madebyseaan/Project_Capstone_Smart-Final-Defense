# Attendance Excel Export — Professional SF2 Design Plan

## Current State

The current Excel export (`/api/attendance/export/:sectionId`) has two paths:
1. **Template-based**: Uses uploaded SF2 template if available
2. **Hardcoded fallback**: Basic `XLSX.utils.aoa_to_sheet()` output

**Problem**: The fallback output looks bare-bones — no styling, no borders, no proper formatting.

## Target: Professional SF2 Excel Sheet

### Official DepEd SF2 Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DAILY ATTENDANCE RECORD (SF2)                            │
│                                                                             │
│  School Name: ___________________    School ID: __________                  │
│  Division: _____________________    Region: ____________                   │
│  Section: ______________________    Grade Level: ________                   │
│  School Year: __________________    Teacher: ____________                   │
│                                                                             │
│  ┌────┬─────────────────────┬─────────────────────────────────┬───────────┐ │
│  │ No.│ Name                │  M  T  W  T  F  M  T  W  T ... │  P  A  L  E│ │
│  ├────┼─────────────────────┼─────────────────────────────────┼───────────┤ │
│  │  1 │ Cruz, Juan          │  P  P  A  P  L  P  P  P  P ... │  8  1  1  0│ │
│  │  2 │ Santos, Maria       │  P  P  P  P  P  P  L  P  P ... │  9  0  1  0│ │
│  └────┴─────────────────────┴─────────────────────────────────┴───────────┘ │
│                                                                             │
│  Daily Total:                   │  45 44 43 45 44 45 44 45 45 ...           │
│  Daily Attendance Rate:         │  90% 88% 86% 90% 88% 90% 88% 90% 90% ... │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Professional Styling Requirements

| Element | Style |
|---------|-------|
| **Header** | Bold, centered, 14pt, merged cells |
| **School info** | 11pt, left-aligned, key-value pairs |
| **Table header** | Bold, centered, light blue background (#D6EAF8), all borders |
| **Student rows** | 10pt, alternating white/#F8F9FA background, all borders |
| **Status marks** | Centered, colored: P=green, A=red, L=orange, E=blue |
| **Summary columns** | Bold, right-aligned, light yellow background (#FEF9E7) |
| **Daily totals row** | Bold, light green background (#D5F5E3) |
| **Daily rate row** | Bold, light purple background (#E8DAEF) |
| **Column widths** | Auto-fit with minimums: No=5, Name=25, Dates=4, Summary=6 |
| **Borders** | Thin black borders on all cells, thick borders on header/footer |
| **Page setup** | Landscape orientation, fit to 1 page wide, print titles (header rows) |

### Color Coding for Status Marks

```
P (Present) → #27AE60 (green)  with light green background
A (Absent)  → #E74C3C (red)    with light red background
L (Late)    → #F39C12 (orange) with light orange background
E (Excused) → #3498DB (blue)   with light blue background
```

## Implementation Plan

### Backend Changes

**File:** `server/src/routes/attendance.ts`

Replace the hardcoded fallback (lines 411-492) with professional styling:

```typescript
// Professional SF2 Excel generation
import ExcelJS from 'exceljs';

async function generateProfessionalSF2(
  section: any,
  attendanceRecords: any[],
  dates: string[],
  schoolSettings: any,
  startDate: string,
  endDate: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SMART Attendance System';
  workbook.created = new Date();
  
  const sheet = workbook.addWorksheet('SF2 - Daily Attendance', {
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9, // A4
    },
    properties: {
      defaultRowHeight: 18,
    },
  });

  // 1. Header section
  // 2. School info section
  // 3. Table with data
  // 4. Summary rows
  // 5. Styling
  
  return workbook.xlsx.writeBuffer() as Promise<Buffer>;
}
```

### Key Changes

1. **Switch from `xlsx` to `exceljs`** — `exceljs` supports cell styling, borders, colors, merged cells
2. **Add proper headers** with school metadata
3. **Color-code status marks** (P/A/L/E)
4. **Add summary rows** (Daily Total, Daily Attendance Rate)
5. **Auto-fit column widths**
6. **Page setup** for printing

### Package Installation

```bash
npm install exceljs
npm install --save-dev @types/exceljs
```

### Frontend Changes

**File:** `src/pages/teacher/Attendance.tsx`

Add a collapsible "SF2 Preview" section:

```tsx
{/* SF2 Quick Preview */}
{attendanceData && (
  <Card>
    <CardHeader>
      <CardTitle>SF2 Quick Preview</CardTitle>
    </CardHeader>
    <CardContent>
      {/* Mini grid showing current day's attendance */}
      {/* Download Excel button */}
      {/* View Full Report link */}
    </CardContent>
  </Card>
)}
```

**File:** `src/pages/teacher/AttendanceReports.tsx`

Update `downloadExcel()` to use the new professional endpoint.

**File:** `src/pages/registrar/SchoolForms.tsx`

Add "Download SF2" button to the SF2 view section.

## Excel Output Example

### Before (Current)
```
DAILY ATTENDANCE RECORD (SF2)

Section: Rizal    Grade Level: GRADE 7
School Year: 2026-2027    Period: 2026-08-01 to 2026-08-31

No.  LRN  Last Name  First Name  Middle Name  ...dates  P  A  L  E  Total  %
1    001  Cruz       Juan        M             P P A P   8  1  1  0  10    80%
```

### After (Professional)
```
╔══════════════════════════════════════════════════════════════════════════════╗
║                   DAILY ATTENDANCE RECORD (SF2)                            ║
║                                                                              ║
║  School: DepEd Senior High School    School ID: 123456                      ║
║  Division: City Division             Region: Region IV-A                    ║
║  Section: Rizal                      Grade Level: Grade 7                   ║
║  School Year: 2026-2027              Teacher: Juan Dela Cruz                ║
╠══════╦══════════════════════╦═══════════════════════════╦═══════════════════╣
║  No. ║ Name                 ║  1  2  3  4  5  6  7 ... ║  P  A  L  E  Tot ║
╠══════╬══════════════════════╬═══════════════════════════╬═══════════════════╣
║    1 ║ Cruz, Juan           ║  P  P  A  P  L  P  P ... ║  8  1  1  0  10  ║
║    2 ║ Santos, Maria        ║  P  P  P  P  P  P  L ... ║  9  0  1  0  10  ║
║    3 ║ Reyes, Ana           ║  L  P  P  P  P  P  P ... ║  9  0  1  0  10  ║
╠══════╩══════════════════════╬═══════════════════════════╬═══════════════════╣
║  DAILY TOTAL                ║  45 44 43 45 44 45 44 ...║  Total: 450       ║
║  DAILY ATTENDANCE RATE      ║  90% 88% 86% 90% 88% ... ║  Rate: 88.5%      ║
╚════════════════════════════╩═══════════════════════════╩═══════════════════╝
```

## Files to Modify

| File | Change |
|------|--------|
| `server/src/routes/attendance.ts` | Replace hardcoded export with professional ExcelJS generation |
| `server/package.json` | Add `exceljs` dependency |
| `src/pages/teacher/Attendance.tsx` | Add SF2 quick preview + download button |
| `src/pages/teacher/AttendanceReports.tsx` | Update download to use new endpoint |
| `src/pages/registrar/SchoolForms.tsx` | Add download button to SF2 view |

## Testing Checklist

- [ ] Excel file opens without errors in Excel/Google Sheets
- [ ] Header section shows school metadata
- [ ] Student names are correct and sorted
- [ ] Status marks are color-coded (P=green, A=red, L=orange, E=blue)
- [ ] Date columns show day-of-week abbreviations
- [ ] Summary columns (P/A/L/E/Total) are correct
- [ ] Daily totals row shows correct counts
- [ ] Daily attendance rate row shows correct percentages
- [ ] Print preview shows landscape orientation
- [ ] Column widths auto-fit properly
- [ ] Borders are visible on all cells
- [ ] Alternating row colors for readability
