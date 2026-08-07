# ECR (Electronic Class Record) System Guide

## 🎯 Overview

The ECR System provides a complete workflow for teachers to manage class records efficiently:
1. **Admin uploads ECR templates** (one per subject)
2. **Teachers download auto-filled ECRs** with student data and grades
3. **Teachers edit grades offline** in Excel
4. **Teachers sync/import updated ECRs** back to the system

---

## 🏗️ Architecture

### Multi-Teacher Support
- ✅ **Shared Templates**: All teachers use the same template per subject (stored in `/uploads/ecr-templates/`)
- ✅ **Isolated Syncs**: Each teacher's filled ECR is stored separately per class (prevents conflicts)
- ✅ **Scoped by ClassAssignment**: Each teacher-subject-section combination is unique
- ✅ **File Organization**: `/uploads/ecr/{teacherId}/{classAssignmentId}/filename.xlsx`

### Data Flow

```
┌──────────────────┐
│  Admin Uploads   │
│  ECR Templates   │  (One per subject: Math, English, Science, etc.)
│  (Bulk Upload)   │
└────────┬─────────┘
         │
         ↓
┌──────────────────────────────────────────────────────────┐
│              Template Storage                             │
│  /uploads/ecr-templates/Mathematics_template.xlsx       │
│  /uploads/ecr-templates/English_template.xlsx           │
│  /uploads/ecr-templates/Science_template.xlsx           │
└────────┬─────────────────────────────────────────────────┘
         │
         ↓ (Teachers request auto-filled ECR)
         │
┌────────┴─────────────────────────────────────────────────┐
│         Teacher Downloads Auto-Filled ECR                 │
│                                                           │
│  1. System fetches class assignment data                 │
│  2. Gets enrolled students (LRN, names)                  │
│  3. Gets current grades from database                    │
│  4. Fills template with:                                 │
│     - School info, teacher name                          │
│     - Subject, grade level, section                      │
│     - Student list with LRN and names                    │
│     - Current grades (WW, PT, QA, Initial, Quarterly)   │
│  5. Generates Excel file for download                    │
└────────┬─────────────────────────────────────────────────┘
         │
         ↓ (Teacher works offline)
         │
┌────────┴─────────────────────────────────────────────────┐
│      Teacher Edits Grades in Excel Offline               │
│  - Adds/updates Written Work scores                      │
│  - Adds/updates Performance Task scores                  │
│  - Adds/updates Quarterly Assessment                     │
│  - System auto-calculates final grades                   │
└────────┬─────────────────────────────────────────────────┘
         │
         ↓ (Teacher uploads filled ECR)
         │
┌────────┴─────────────────────────────────────────────────┐
│       Teacher Syncs/Imports Updated ECR                  │
│                                                           │
│  1. Upload filled ECR file                               │
│  2. System parses Excel and extracts grades              │
│  3. Matches students by name/LRN                         │
│  4. Updates grades in database                           │
│  5. Stores file in teacher-specific folder:              │
│     /uploads/ecr/{teacherId}/{classAssignmentId}/        │
│  6. Records sync timestamp                               │
└────────┬─────────────────────────────────────────────────┘
         │
         ↓
┌────────┴─────────────────────────────────────────────────┐
│              Database Updated                             │
│  - ClassAssignment.ecrLastSyncedAt                       │
│  - ClassAssignment.ecrFileName                           │
│  - Grade records updated for all students                │
│  - Audit log created                                     │
└──────────────────────────────────────────────────────────┘
```

---

## 📋 Admin Workflow

### 1. Upload ECR Templates (Bulk Mode)

**Route:** `Admin → Template Managers → ECR Templates`

**Steps:**
1. Click **"Upload ECR Template"**
2. Switch to **"Bulk Upload (Auto-detect)"** tab
3. Select multiple Excel files (e.g., all 10+ subject templates)
4. Review auto-detected subject names:
   - `GRADE 7-10_MATHEMATICS.xlsx` → "Mathematics"
   - `GRADE 7-10_ENGLISH.xlsx` → "English"
   - `GRADE 7-10_SCIENCE.xlsx` → "Science"
5. Edit subject names if needed
6. Add descriptions (optional)
7. Click **"Upload All"**
8. System uploads each template sequentially

**Template Requirements:**
- Must be Excel (.xlsx or .xls)
- Can contain placeholders:
  - `{{SCHOOL_NAME}}` - Replaced with school name
  - `{{TEACHER_NAME}}` - Replaced with teacher's full name
  - `{{SUBJECT}}` - Replaced with subject name
  - `{{GRADE_LEVEL}}` - Replaced with grade level (e.g., "Grade 7")
  - `{{SECTION}}` - Replaced with section name
  - `{{SCHOOL_YEAR}}` - Replaced with school year
  - `{{STUDENT_LIST}}` - Special marker where student rows are inserted

**Backend:**
- Endpoint: `POST /api/ecr-templates/upload`
- Storage: `/uploads/ecr-templates/{timestamp}-{filename}.xlsx`
- Database: `ECRTemplate` table with subject name as key

---

## 👨‍🏫 Teacher Workflow

### 2. Download Auto-Filled ECR

**Route:** `Teacher → My Classes → Select Class → Download ECR`

**What Happens:**
1. Teacher opens class record page
2. Clicks **"Download ECR"** button
3. System generates auto-filled Excel file:
   - **School Info**: Name, ID, division, region
   - **Class Info**: Teacher name, subject, grade, section, school year
   - **Student List**: All enrolled students with:
     - Row number (1, 2, 3, ...)
     - LRN
     - Full name (Last, First Middle)
     - **Current grades** from database:
       - Written Work PS
       - Performance Task PS
       - Quarterly Assessment PS
       - Initial Grade
       - Quarterly Grade
4. File downloads: `ECR_Mathematics_Grade_7_Einstein_{timestamp}.xlsx`
5. Teacher opens file, reviews/edits grades offline

**Backend:**
- Endpoint: `POST /api/ecr-templates/generate/:classAssignmentId`
- Fetches:
  - ClassAssignment (teacher, subject, section)
  - Enrolled students (from Enrollment table)
  - ClassRecord with grades (from Grade table)
- Fills template with ExcelJS
- Returns Excel file for download

**Key Features:**
- ✅ **Pre-filled with current grades** - No need to re-enter existing data
- ✅ **Always up-to-date** - Pulls latest grades from database
- ✅ **Separate files per teacher** - No conflicts between teachers teaching same subject

---

### 3. Sync/Import Updated ECR

**Route:** `Teacher → My Classes → Select Class → Import ECR / Sync ECR`

**Steps:**
1. Teacher clicks **"Import ECR"** (first time) or **"Sync ECR"** (subsequent times)
2. ECR preview dialog appears
3. Teacher uploads filled Excel file
4. System shows preview:
   - Matched students
   - Quarters detected
   - Grades to be imported
5. Teacher confirms import
6. System:
   - Parses Excel file
   - Matches students by name (fuzzy matching)
   - Extracts grades for all quarters found
   - Updates Grade records in database
   - Stores file in teacher-specific folder
   - Records sync timestamp
7. Success message: "Successfully imported X grades from ECR"
8. Class record auto-refreshes with new grades

**Backend:**
- Endpoint: `POST /grades/ecr/import`
- File Storage: `/uploads/ecr/{teacherId}/{classAssignmentId}/filename.xlsx`
- Parses Excel with `parseECRFile()` function
- Updates:
  - `Grade` table (all quarters)
  - `ClassAssignment.ecrLastSyncedAt`
  - `ClassAssignment.ecrFileName`
- Creates audit log

**Multi-Teacher Safety:**
- Each teacher's files stored in separate folders: `/uploads/ecr/{teacherId}/`
- Each class has separate folder: `/{classAssignmentId}/`
- Files never conflict even if two teachers teach same subject
- Example:
  - Teacher A (English, Grade 7-A): `/uploads/ecr/teacher-a-id/class-123/`
  - Teacher B (English, Grade 7-B): `/uploads/ecr/teacher-b-id/class-456/`

---

## 🔄 Complete Workflow Example

### Scenario: Two English Teachers

**Setup (Monday Morning):**
1. Admin uploads **English ECR Template** (one shared template)
2. System stores: `/uploads/ecr-templates/English_template.xlsx`

**Teacher A (Ms. Santos - English Grade 7-Einstein):**
1. Opens class record for English 7-Einstein
2. Clicks **"Download ECR"**
3. Gets: `ECR_English_Grade_7_Einstein_1234567890.xlsx`
   - Pre-filled with 35 students
   - Pre-filled with current Q1 grades
4. Edits grades offline (adds Q2 grades)
5. Clicks **"Sync ECR"** and uploads file
6. System stores: `/uploads/ecr/ms-santos-id/class-english-7-einstein/ECR_English_1234567890.xlsx`
7. Grades updated in database
8. Status shows: "Synced 2 hours ago"

**Teacher B (Mr. Cruz - English Grade 7-Newton):**
1. Opens class record for English 7-Newton
2. Clicks **"Download ECR"**
3. Gets: `ECR_English_Grade_7_Newton_9876543210.xlsx`
   - Pre-filled with 38 students (different students!)
   - Pre-filled with current Q1 grades
4. Edits grades offline
5. Clicks **"Sync ECR"** and uploads file
6. System stores: `/uploads/ecr/mr-cruz-id/class-english-7-newton/ECR_English_9876543210.xlsx`
7. Grades updated in database (completely separate from Teacher A)

**No Conflicts:**
- Both teachers use the same **template** (shared)
- Both teachers have separate **filled files** (isolated)
- Both teachers update separate **database records** (scoped by ClassAssignment)

---

## 🛠️ Technical Implementation

### Database Schema

```prisma
model ECRTemplate {
  id              String   @id @default(cuid())
  subjectName     String   // "Mathematics", "English", "Science"
  description     String?
  filePath        String   // /uploads/ecr-templates/Math_template.xlsx
  fileName        String
  fileSize        Int
  placeholders    Json?
  instructions    String?
  isActive        Boolean  @default(true)
  uploadedBy      String
  uploadedByName  String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([subjectName])
  @@index([isActive])
}

model ClassAssignment {
  id                String    @id @default(cuid())
  teacherId         String
  subjectId         String
  sectionId         String
  schoolYear        String
  ecrLastSyncedAt   DateTime? // When teacher last synced ECR
  ecrFileName       String?   // Name of last synced file
  // ... other fields
}

model Grade {
  id                 String   @id @default(cuid())
  studentId          String
  classAssignmentId  String
  quarter            Quarter  // Q1, Q2, Q3, Q4
  writtenWorkScores  Json[]
  perfTaskScores     Json[]
  quarterlyAssessScore Float?
  writtenWorkPS      Float?
  perfTaskPS         Float?
  quarterlyAssessPS  Float?
  initialGrade       Float?
  quarterlyGrade     Int?
  // ... other fields
  
  @@unique([studentId, classAssignmentId, quarter])
}
```

### API Endpoints

#### Admin - Template Management
```typescript
// List all ECR templates
GET /api/ecr-templates
GET /api/ecr-templates?subjectName=Mathematics&isActive=true

// Upload template (single or bulk)
POST /api/ecr-templates/upload
FormData: { file, subjectName, description?, instructions? }

// Get template details
GET /api/ecr-templates/:id

// Download blank template
GET /api/ecr-templates/:id/download

// Update template
PUT /api/ecr-templates/:id
Body: { description?, instructions?, isActive? }

// Delete template
DELETE /api/ecr-templates/:id
```

#### Teacher - ECR Generation & Sync
```typescript
// Generate auto-filled ECR for download
POST /api/ecr-templates/generate/:classAssignmentId
Returns: Excel file (auto-filled with students + grades)

// Preview ECR before import
POST /grades/ecr/preview
FormData: { file, classAssignmentId }
Returns: { students, quarters, matchedCount, unmatchedCount }

// Import/sync ECR grades
POST /grades/ecr/import
FormData: { file, classAssignmentId, selectedQuarters? }
Returns: { importedGrades, skippedStudents, ecrLastSyncedAt }

// Get ECR sync status
GET /grades/ecr/status/:classAssignmentId
Returns: { hasSynced, ecrLastSyncedAt, ecrFileName }
```

### File Organization

```
server/
  uploads/
    ecr-templates/           # Shared templates (admin uploads)
      1234567890-Math.xlsx
      1234567891-English.xlsx
      1234567892-Science.xlsx
    
    ecr/                     # Teacher-specific filled ECRs
      teacher-id-123/        # Teacher A
        class-abc-456/       # English 7-Einstein
          ECR_English_1234567890.xlsx
          ECR_English_1234567999.xlsx (re-sync)
        class-def-789/       # Math 7-Einstein
          ECR_Math_9876543210.xlsx
      
      teacher-id-456/        # Teacher B
        class-ghi-012/       # English 7-Newton
          ECR_English_5555555555.xlsx
        class-jkl-345/       # Science 7-Newton
          ECR_Science_6666666666.xlsx
    
    generated/               # Temporary generated files (cleaned after download)
      ECR_temp_1234567890.xlsx
```

---

## 🎨 UI Components

### Admin - ECR Template Manager
- **Upload Modes:**
  - Single Upload: One template at a time with manual subject name entry
  - Bulk Upload: Multiple templates with auto-detected subject names
- **Template Table:**
  - Search by subject, filename, uploader
  - Filter by status (active/inactive)
  - Actions: View details, Download, Toggle active, Delete
- **Auto-Detection:**
  - Strips grade prefixes: `GRADE 7-10_`, `GRADE_X_`
  - Converts to title case: `MATHEMATICS` → "Mathematics"
  - Handles underscores/hyphens: `ARALING_PANLIPUNAN` → "Araling Panlipunan"

### Teacher - Class Record View
- **Download ECR Button:**
  - Always available
  - Downloads auto-filled Excel with current grades
  - Loading spinner during generation
- **Import/Sync ECR Button:**
  - Changes text based on sync status:
    - "Import ECR" (first time, green)
    - "Sync ECR" (subsequent, primary color)
  - Shows sync indicator: "Synced 2 hours ago"
- **ECR Preview Dialog:**
  - Shows matched students
  - Shows quarters detected
  - Allows quarter selection
  - Preview grades before import

---

## ✅ Benefits

### For Admin:
- ✅ **One-time setup**: Upload templates once, teachers use forever
- ✅ **Bulk upload**: Upload 10+ templates in seconds with auto-detection
- ✅ **Easy updates**: Replace templates without code changes
- ✅ **Audit trail**: Track who uploaded/synced what and when

### For Teachers:
- ✅ **Zero manual typing**: Student names and LRNs auto-filled
- ✅ **Current grades pre-loaded**: Start with latest data from system
- ✅ **Work offline**: Edit grades in Excel without internet
- ✅ **One-click sync**: Upload and update all grades instantly
- ✅ **No conflicts**: Each teacher has isolated files
- ✅ **Audit-safe**: Every sync recorded with timestamp

### For Students/Parents:
- ✅ **Accurate data**: Grades synced from official teacher records
- ✅ **Up-to-date**: Teachers can update anytime
- ✅ **Consistent format**: All teachers use same template structure

---

## 🔒 Security & Permissions

### Authorization:
- **Admin** can:
  - Upload/edit/delete ECR templates
  - View all templates
  - Generate ECR for any class (for testing)
  
- **Teacher** can:
  - Generate ECR for their assigned classes only
  - Import/sync ECR for their assigned classes only
  - View ECR templates (read-only)

### File Security:
- All files stored outside public directory
- Files served through authenticated endpoints
- Teacher-specific folders prevent cross-access
- Temporary files cleaned after download

---

## 🐛 Troubleshooting

### "No ECR template found for subject: X"
- **Cause**: Admin hasn't uploaded template for that subject
- **Fix**: Admin uploads ECR template with exact subject name

### "Failed to download ECR"
- **Cause**: Template file missing from disk
- **Fix**: Re-upload template, check file permissions

### "X students could not be matched"
- **Cause**: Student names in Excel don't match database
- **Fix**: Teacher manually matches in preview dialog, or adjusts names in Excel

### Download button error overlaps
- **Fix**: Now has close button (X) and higher z-index (z-[9999])
- **Fix**: Error auto-dismisses after 5 seconds

---

## 🚀 Next Steps

### Planned Enhancements:
1. **Quarter Selection**: Allow teachers to generate ECR for specific quarter (Q1, Q2, Q3, Q4)
2. **Multi-Quarter Templates**: Support templates with multiple quarter sheets
3. **Grade History**: Track all syncs with version history
4. **Batch Operations**: Allow admin to update multiple templates at once
5. **Template Preview**: Show pixel-perfect preview before download

---

## 📝 Changelog

### Version 1.0 (Current)
- ✅ ECR Template bulk upload with auto-detection
- ✅ Auto-fill generation with student names + current grades
- ✅ Import/sync with fuzzy student matching
- ✅ Multi-teacher isolation (separate file storage)
- ✅ Sync status tracking with timestamps
- ✅ Audit logging for all operations
- ✅ Dropdown sidebar navigation
- ✅ Error message improvements (close button, higher z-index)

---

## 🤝 Support

For issues or questions:
1. Check this guide first
2. Review API_ENDPOINTS.md for endpoint details
3. Check TEMPLATE_GUIDE.md for template creation
4. Contact system administrator for template-related issues
