# 🎯 TEMPLATE SYSTEM QUICK START

## What Was Built

A complete **template-based Excel generation system** for DepEd School Forms (SF1-SF10). Admins can upload Excel templates with placeholders, and the system automatically fills them with real data - **no code changes needed when forms update!**

---

## 🚀 Getting Started

### 1. Restart Backend Server (Required!)

The database schema was updated. Restart your server:

```powershell
# In the server terminal:
# Press Ctrl+C to stop the current server

# Then restart:
npm run dev
```

### 2. Access Template Manager

1. Login as **Admin**
2. Navigate to **Admin → Template Manager**
3. You'll see the upload interface

### 3. Upload Your First Template

**Option A: Test with Simple Template**
1. Create a new Excel file in Excel/Google Sheets
2. Add placeholders like:
   - Cell A1: `DAILY ATTENDANCE RECORD (SF2)`
   - Cell A3: `School: {{SCHOOL_NAME}}`
   - Cell A4: `Section: {{SECTION_NAME}}`
3. Save as `.xlsx`
4. Upload via Template Manager

**Option B: Use the SF2 Template You Sent**
1. Click "Upload Template" button
2. Select form type: **SF2**
3. Name: "School Form 2 - Daily Attendance Record"
4. Upload your Excel file
5. System validates and shows available placeholders

---

## 📊 How Reports Work Now

### SF2 - Daily Attendance Export
**Location:** Teacher → Attendance Reports → Download Excel

- ✅ **With template:** Uses your uploaded SF2 template (exact format you want!)
- ✅ **Without template:** Falls back to default hardcoded format
- System checks for template automatically

### SF1 - School Register Export
**Location:** Registrar → (need to add button to Student Records page)

- Endpoint ready: `GET /api/registrar/export/sf1/:sectionId`
- Same template logic: uses SF1 template if uploaded, else default

---

## 📝 Creating Templates

See **[TEMPLATE_GUIDE.md](TEMPLATE_GUIDE.md)** for complete guide!

### Quick Example - SF2 Template Structure:

```
Row 1:  DAILY ATTENDANCE RECORD (SF2)
Row 2:  [blank]
Row 3:  School: {{SCHOOL_NAME}}          | Grade: {{GRADE_LEVEL}}
Row 4:  Section: {{SECTION_NAME}}        | School Year: {{SCHOOL_YEAR}}
Row 5:  [blank]
Row 6:  No. | LRN | Last Name | First Name | Middle Name | [Date Columns] | Present | Absent | Late | Excused | Total | Attendance %
Row 7:  {{#STUDENTS}}  ← Loop starts here
Row 8:  {{INDEX}} | {{LRN}} | {{LAST_NAME}} | {{FIRST_NAME}} | {{MIDDLE_NAME}} | [date data] | {{PRESENT}} | {{ABSENT}} | {{LATE}} | {{EXCUSED}} | {{TOTAL}} | {{ATTENDANCE_RATE}}
Row 9:  {{/STUDENTS}}  ← Loop ends here
```

### Available Placeholders:

**SF2 Attendance:**
- Global: `SCHOOL_NAME`, `SECTION_NAME`, `GRADE_LEVEL`, `SCHOOL_YEAR`, `START_DATE`, `END_DATE`
- Loop: `STUDENTS` (with `INDEX`, `LRN`, `FIRST_NAME`, `LAST_NAME`, `MIDDLE_NAME`, `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`, `TOTAL`, `ATTENDANCE_RATE`)
- Dynamic date columns like `2026-05-01`, `2026-05-02`, etc.

**SF1 School Register:**
- Global: `SCHOOL_NAME`, `SECTION_NAME`, `GRADE_LEVEL`, `SCHOOL_YEAR`, `ADVISER`, `TOTAL_STUDENTS`, `DATE_GENERATED`
- Loop: `STUDENTS` (with `INDEX`, `LRN`, `FIRST_NAME`, `LAST_NAME`, `MIDDLE_NAME`, `SUFFIX`, `BIRTH_DATE`, `GENDER`, `ADDRESS`, `GUARDIAN_NAME`, `GUARDIAN_CONTACT`)

---

## 🎨 Template Features

✅ **Placeholders:** `{{VARIABLE_NAME}}`  
✅ **Loops:** `{{#ARRAY}}...{{/ARRAY}}`  
✅ **Nested Fields:** `{{SECTION.NAME}}`  
✅ **Index Counter:** `{{INDEX}}` in loops  
✅ **Format Preservation:** Colors, borders, fonts all kept!  
✅ **Validation:** System validates on upload  

---

## 🔧 Admin Features

### Template Manager UI
- **View All Templates:** See all uploaded SF forms
- **Upload New:** Drag-drop Excel files
- **Download:** Download template to edit
- **Activate/Deactivate:** Toggle which template is active
- **Delete:** Remove old templates
- **View Info:** See placeholders, file size, upload date

### Template Validation
System automatically:
- ✅ Checks file format (.xlsx, .xls)
- ✅ Validates balanced loop markers
- ✅ Extracts available placeholders
- ✅ Shows errors if template is invalid
- ✅ Prevents duplicate form types (updates existing)

---

## 📋 Supported Form Types

- **SF1** - School Register (Student Master List) ✅ Backend ready
- **SF2** - Daily Attendance Record ✅ Fully integrated
- **SF3** - Individual Learner Monitoring
- **SF4** - Quarterly Assessment Report
- **SF5** - Promotion/Completion Report
- **SF6** - Learner Information System
- **SF8** - Progress Report (Elementary)
- **SF9** - Progress Report (JHS/SHS)
- **SF10** - Learner's Permanent Record

To add more forms, just:
1. Create export endpoint that uses `templateService.fillTemplate()`
2. Upload template for that form type
3. Done!

---

## 🛠 Technical Details

### Database
- New `ExcelTemplate` model in Prisma
- `FormType` enum (SF1-SF10)
- Stores file path, placeholders, metadata

### Backend
- **Template Service:** `server/src/services/templateService.ts`
  - Reads Excel files with ExcelJS
  - Replaces placeholders
  - Handles loops (array expansion)
  - Preserves formatting
  
- **Template API:** `server/src/routes/templates.ts`
  - Upload, list, delete, toggle, download
  - File validation
  - Multer for file uploads
  
- **Updated Exports:**
  - `attendance.ts` - SF2 export checks for template
  - `registrar.ts` - SF1 export with template support

### Frontend
- **Admin Page:** `src/pages/admin/TemplateManager.tsx`
  - Complete CRUD interface
  - File upload with validation
  - Template info display

---

## 🎯 Benefits

1. **Zero Code Changes:** Update forms without touching code
2. **Exact Formatting:** Upload once, matches perfectly
3. **Easy Maintenance:** Any admin can upload new templates
4. **Flexible:** Works with any Excel structure
5. **Fallback Safe:** If no template, uses default format
6. **Audit Trail:** Tracks who uploaded, when

---

## 📞 Troubleshooting

**Q: "Property 'excelTemplate' does not exist"**  
A: Restart the server after schema changes. Prisma Client needs to regenerate.

**Q: Template upload fails with "Invalid template"**  
A: Check for unbalanced loop markers (`{{#ARRAY}}` needs `{{/ARRAY}}`)

**Q: Downloaded file doesn't match template**  
A: Check placeholder names match available fields (case-sensitive!)

**Q: Loop not repeating**  
A: Ensure loop markers on separate rows, with template row(s) between them

---

## 🚀 Next Steps

1. **Upload SF2 template** from the file you sent me
2. **Test download** from Attendance Reports
3. **Create SF1 template** for School Register
4. **Add more forms** as needed (SF3, SF4, SF9, etc.)
5. **Customize placeholders** for your school's needs

---

**Remember:** The template system is now live! Upload once, use forever. When DepEd updates forms, just upload new template - no code changes! 🎉
