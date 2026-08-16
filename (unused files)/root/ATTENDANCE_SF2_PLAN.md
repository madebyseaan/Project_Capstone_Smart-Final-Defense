# Attendance SF2 Export — Match Exact DepEd Format

## Your SF2 File Structure

Based on `Automated SF2 (SY 2026-2027) - JUNE.xlsx`:

### Header (Rows 5-6)
```
Row 5: School ID: [ID]  |  School Year: [SY]  |  Report for the Month: [MONTH]
Row 6: Name of School: [NAME]  |  Grade Level: [X]  |  Section: [NAME]
```

### Column Layout (Row 8-10)
```
Col 0 (A): LEARNER'S NAME (Last Name, First Name, Middle Name)
Col 1-5 (B-F): (empty - name continues)
Col 6-30 (G-AE): Days of the month (date numbers + day abbreviations)
  Row 9: Day numbers (8, 9, 10, 11, 12, 15, 16, 17...)
  Row 10: Day letters (M, T, W, TH, F, M, T, W...)
Col 31 (AF): Total for the Month (ABSENT)
Col 32 (AG): Total for the Month (PRESENT)
Col 33 (AH): REMARKS (If NLS, state reason...)
Col 40 (AO): No of School Days
Col 42 (AQ): [Number]
```

### Student Rows (Row 12+)
```
Col 0: Row number (1, 2, 3...)
Col 1: Student name (LAST NAME, FIRST NAME MIDDLE NAME)
Col 6-30: Attendance marks (blank = present, x = absent, / = late, etc.)
Col 31: ABSENT count (formula)
Col 32: PRESENT count (formula)
Col 33: Remarks (for NLS, transferred, etc.)
```

### Summary Section (Row 116+)
```
- Guidelines/legend on left side
- Monthly summary on right side:
  - Month, No. of Days of Class
  - Enrolment as of (M/F/TOTAL)
  - Percentage of Enrolment
  - Average Daily Attendance
  - Percentage of Attendance
  - NLS, Transferred out/in counts
- Signature lines at bottom
```

### Key Format Details
1. **Blank = Present** (not "P") — empty cell means present
2. **x = Absent** (lowercase x)
3. **Day abbreviations**: M, T, W, TH, F (not Mon, Tue, Wed...)
4. **Weekend dates are skipped** (e.g., jumps from 12 to 15)
5. **Student name format**: LAST NAME, FIRST NAME MIDDLE NAME (all caps)
6. **Remarks column** is for特殊情况 (NLS, transferred, etc.)

---

## Implementation Plan

### Backend: `server/src/routes/attendance.ts`

Replace the export endpoint to match this exact format:

```typescript
GET /api/attendance/export/:sectionId?month=6&year=2026
```

**Parameters:**
- `month` — month number (1-12)
- `year` — year number
- `sectionId` — section ID

**Output:** Excel file matching the exact SF2 layout above.

### Key Logic

1. **Get all school days in the month** (exclude weekends)
2. **Get all students in the section**
3. **Get attendance records for the month**
4. **Build the grid:**
   - Row 9: Day numbers (only school days)
   - Row 10: Day letters (M, T, W, TH, F)
   - Student rows: blank for present, x for absent, / for late
5. **Calculate totals:**
   - ABSENT count per student
   - PRESENT count per student
6. **Add summary section** at bottom

### Excel Formatting

| Element | Style |
|---------|-------|
| Header | Bold, centered, merged cells |
| Column headers | Bold, bordered |
| Student rows | Alternating white/light gray |
| Day columns | Narrow (width ~4) |
| Name column | Wide (width ~30) |
| Borders | Thin black borders on all cells |
| Page setup | Landscape, fit to 1 page wide |

---

## Files to Modify

| File | Change |
|------|--------|
| `server/src/routes/attendance.ts` | Rewrite export endpoint to match SF2 format |
| `server/package.json` | Already has `exceljs` via templateService |

---

## Testing Checklist

- [ ] Excel opens without errors
- [ ] Header shows school ID, name, year, month
- [ ] Day numbers match school days (no weekends)
- [ ] Day letters match (M, T, W, TH, F)
- [ ] Student names are LAST, FIRST MIDDLE (caps)
- [ ] Blank = present, x = absent, / = late
- [ ] ABSENT count matches number of x marks
- [ ] PRESENT count matches number of blank cells
- [ ] Summary section at bottom
- [ ] Print layout is landscape
- [ ] Borders visible on all cells
