# Excel Template Guide
## How to Create DepEd School Form Templates

This guide explains how to create Excel templates that work with the SMART Grading System's template engine.

---

## 📋 Overview

The template system allows administrators to upload Excel files with **placeholders** that are automatically filled with real data when generating reports. This means **no code changes** are needed when DepEd updates form formats!

---

## 🎯 Placeholder Syntax

### Simple Placeholders
Replace single values anywhere in your Excel file:

```
{{SCHOOL_NAME}}       → Replaced with actual school name
{{DATE}}              → Current date
{{SECTION_NAME}}      → Section name (e.g., "Einstein")
{{GRADE_LEVEL}}       → Grade level (e.g., "GRADE 7")
{{SCHOOL_YEAR}}       → School year (e.g., "2025-2026")
{{TOTAL_STUDENTS}}    → Total number of students
```

**Example in Excel:**
```
Cell A1:  DAILY ATTENDANCE RECORD (SF2)
Cell A3:  School: {{SCHOOL_NAME}}
Cell B3:  Grade Level: {{GRADE_LEVEL}}
Cell A4:  Section: {{SECTION_NAME}}
Cell B4:  School Year: {{SCHOOL_YEAR}}
```

---

### Loop Placeholders (Repeat Rows)
Use loops to repeat rows for each student, date, etc.

**Syntax:**
```
{{#STUDENTS}}         → Start of loop
...template rows...
{{/STUDENTS}}         → End of loop
```

**Available inside loops:**
- `{{INDEX}}` - Row number (1, 2, 3...)
- `{{LRN}}` - Student LRN
- `{{FIRST_NAME}}` - Student first name
- `{{LAST_NAME}}` - Student last name
- `{{MIDDLE_NAME}}` - Student middle name
- And any other fields provided by the data source

**Example:**
```
Row 5:  {{#STUDENTS}}
Row 6:  {{INDEX}} | {{LRN}} | {{LAST_NAME}} | {{FIRST_NAME}} | {{MIDDLE_NAME}}
Row 7:  {{/STUDENTS}}
```

When filled with 3 students, this becomes:
```
Row 5:  1 | 123456789012 | Dela Cruz | Juan | Santos
Row 6:  2 | 123456789013 | Garcia    | Maria | Reyes
Row 7:  3 | 123456789014 | Lopez     | Pedro | Cruz
```

---

## 📝 Template Examples

### SF2 - Daily Attendance Record

**Header Section:**
```
A1: DAILY ATTENDANCE RECORD (SF2)
A2: (blank)
A3: Section: {{SECTION_NAME}}          B3: Grade Level: {{GRADE_LEVEL}}
A4: School Year: {{SCHOOL_YEAR}}       B4: Period: {{START_DATE}} to {{END_DATE}}
A5: (blank)
```

**Column Headers (Row 6):**
```
A6: No.
B6: LRN
C6: Last Name
D6: First Name
E6: Middle Name
F6: 2026-05-01  (date columns continue...)
...
N6: Present
O6: Absent
P6: Late
Q6: Excused
R6: Total
S6: Attendance %
```

**Student Loop (Rows 7-8):**
```
Row 7: {{#STUDENTS}}
Row 8: {{INDEX}} | {{LRN}} | {{LAST_NAME}} | {{FIRST_NAME}} | {{MIDDLE_NAME}} | {{2026-05-01}} | ... | {{PRESENT}} | {{ABSENT}} | {{LATE}} | {{EXCUSED}} | {{TOTAL}} | {{ATTENDANCE_RATE}}
Row 9: {{/STUDENTS}}
```

---

### SF1 - School Register

**Header:**
```
A1: SCHOOL FORM 1 - SCHOOL REGISTER
A2: (blank)
A3: Section: {{SECTION_NAME}}       B3: Grade Level: {{GRADE_LEVEL}}
A4: School Year: {{SCHOOL_YEAR}}    B4: Adviser: {{ADVISER}}
A5: (blank)
```

**Column Headers (Row 6):**
```
A6: No. | B6: LRN | C6: Last Name | D6: First Name | E6: Middle Name | 
F6: Suffix | G6: Birth Date | H6: Gender | I6: Address | 
J6: Guardian Name | K6: Guardian Contact
```

**Student Loop (Rows 7-8):**
```
Row 7: {{#STUDENTS}}
Row 8: {{INDEX}} | {{LRN}} | {{LAST_NAME}} | {{FIRST_NAME}} | {{MIDDLE_NAME}} | {{SUFFIX}} | {{BIRTH_DATE}} | {{GENDER}} | {{ADDRESS}} | {{GUARDIAN_NAME}} | {{GUARDIAN_CONTACT}}
Row 9: {{/STUDENTS}}
```

**Footer:**
```
Row 10: (blank after loop ends)
Row 11: Total Students: {{TOTAL_STUDENTS}}
Row 12: Date Generated: {{DATE_GENERATED}}
```

---

## 📥 How to Upload Templates

1. **Create your Excel file** with placeholders
2. **Save as .xlsx format**
3. **Go to Admin → Template Manager**
4. **Click "Upload Template"**
5. **Select form type** (SF1, SF2, etc.)
6. **Fill in details:**
   - Template Name: e.g., "School Form 2 - Daily Attendance Record"
   - Description: Brief description
   - Instructions: How to use (optional)
7. **Upload your Excel file**
8. **System validates** the template and extracts placeholders
9. **Done!** The template is now active

### Uploading an All-in-One Workbook (SF1-SF7 in one file)

If your school uses one Excel workbook containing multiple sheets for SF1 to SF7:

1. Click **Upload Template**
2. Select **SF1-SF7 Bundle (All-in-One Workbook)**
3. Upload the single workbook file (`.xls` or `.xlsx`)
4. The system auto-maps sheets to forms based on names (for example, `School Form 1 (SF1)`, `School Form 2 (SF2)`)
5. A separate template record is created for each form type (SF1, SF2, ..., SF7)

**Recommended sheet names for auto-mapping:**
- `School Form 1 (SF1)`
- `School Form 2 (SF2)`
- `School Form 3 (SF3)`
- `School Form 4 (SF4)`
- `School Form 5 (SF5)`
- `School Form 6 (SF6)`
- `School Form 7 (SF7)`

---

## 🔄 Available Data Fields

### SF2 - Daily Attendance
**Global placeholders:**
- `SCHOOL_NAME`, `SECTION_NAME`, `GRADE_LEVEL`, `SCHOOL_YEAR`
- `START_DATE`, `END_DATE`, `DATE_RANGE`

**Student loop fields:**
- `INDEX`, `LRN`, `LAST_NAME`, `FIRST_NAME`, `MIDDLE_NAME`
- `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`, `TOTAL`, `ATTENDANCE_RATE`
- Dynamic date columns (e.g., `2026-05-01`, `2026-05-02`...)

### SF1 - School Register
**Global placeholders:**
- `SCHOOL_NAME`, `SECTION_NAME`, `GRADE_LEVEL`, `SCHOOL_YEAR`
- `ADVISER`, `TOTAL_STUDENTS`, `DATE_GENERATED`

**Student loop fields:**
- `INDEX`, `LRN`, `LAST_NAME`, `FIRST_NAME`, `MIDDLE_NAME`, `SUFFIX`
- `BIRTH_DATE`, `GENDER`, `ADDRESS`, `GUARDIAN_NAME`, `GUARDIAN_CONTACT`

---

## ✅ Best Practices

1. **Keep formatting simple** - Bold headers, borders, basic styles
2. **Test with sample data** - Use placeholder names as test data first
3. **Use descriptive names** - Clear column headers help users understand
4. **Include legends** - Add notes explaining P/A/L/E codes
5. **Match DepEd formats** - Follow official form layouts closely
6. **Version control** - Name files like "SF2_v2.0_2026.xlsx"

---

## 🚨 Common Mistakes to Avoid

❌ **Unbalanced loops**
```
{{#STUDENTS}}    ← Started loop
(forgot to close)
```

✅ **Correct:**
```
{{#STUDENTS}}
template rows
{{/STUDENTS}}
```

---

❌ **Typos in placeholders**
```
{{SCHOL_NAME}}   ← Typo!
{{SCECTION}}     ← Typo!
```

✅ **Use exact names** (check available fields list)

---

❌ **Nested loops** (not supported yet)
```
{{#SECTIONS}}
  {{#STUDENTS}}  ← Can't nest loops
  {{/STUDENTS}}
{{/SECTIONS}}
```

---

## 📞 Need Help?

- Check the **Template Info** button in Template Manager to see available placeholders
- System validates templates on upload and shows errors
- Test downloads immediately after uploading

---

## 🔮 Future Features (Coming Soon)

- Conditional sections: `{{#IF condition}}...{{/IF}}`
- Math operations: `{{SUM(field)}}`
- Date formatting: `{{DATE|format}}`
- Multi-sheet templates
- Template versioning with rollback

---

**Remember:** Upload once, use forever! No code changes needed for form updates. 🎉
