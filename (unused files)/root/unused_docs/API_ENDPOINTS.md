# API Endpoints - Grading System
## Microservices Integration

**Your System:** Grading & Academic Records  
**Your IP:** `100.93.66.120` (laptop-pfvh73qk)  
**Your Port:** `3000` (or whatever port you use)

---

## ⚠️ Current Status (Updated: 2026-04-17)

**Team Systems Identified (All on port 3000):**
- ✅ **dev-jegs** (100.120.169.123:3000) = **Enrollment System** - ⚠️ **OFFLINE** (needs to start server)
- ✅ **njgrm** (100.88.55.125:3000) = **Scheduling System** - ⚠️ **OFFLINE** (only database running on 8080)
- ✅ **tfrog** (100.92.245.14:3000) = **Learning Management System** - ⚠️ **OFFLINE** (needs to start server)
- ✅ **You** (100.93.66.120:3000) = **Grading & Academic Records** - Ready to test!

**Critical Need:** 
1. 🔴 **dev-jegs to come online** (you need both enrollments AND student data from them!)
2. 🟡 Other teams (njgrm, tfrog) to start their servers
3. 🟡 Test Tailscale connectivity once servers are up

**Next Action:** Post the Discord message below to get everyone online!

---

## 🔵 APIs YOU PROVIDE (Other teams can call these)

### Admin Dashboard Stats
```
GET /api/admin/dashboard
```

**Purpose:** Returns admin dashboard counters and recent system activity.

**Notes:**
- `stats.totalStudents` is based on EnrollPro-synced enrollment data (`Enrollment` records with `status = ENROLLED`).
- The count prefers the configured current school year, then falls back to the latest synced school year when needed.
- `stats.studentCountSchoolYear` indicates which school year was used for the student count.

### Admin Template Re-index
```
POST /api/admin/templates/reindex
```

**Purpose:** Re-register template files already present on disk into database records so they appear in Admin Template Managers.

**Auth:** Admin only.

**Request Body (optional):**
```json
{
  "target": "all"
}
```

**Allowed `target` values:**
- `all` (default): re-index SF + ECR
- `sf`: re-index SF forms only (`uploads/templates`)
- `ecr`: re-index ECR templates only (`uploads/ecr-templates`)

**Response:**
```json
{
  "message": "Template re-index completed",
  "result": {
    "target": "all",
    "sf": {
      "filesScanned": 0,
      "formsDetected": 0,
      "upserted": 0,
      "skippedNoMatch": 0
    },
    "ecr": {
      "filesScanned": 0,
      "created": 0,
      "skippedExisting": 0
    }
  }
}
```

### 1. Get Student Grades by LRN
```
GET http://100.93.66.120:3000/api/grades/student/:lrn
```

**Purpose:** Get all grades for a specific student

**Parameters:**
- `lrn` - Student's Learner Reference Number (in URL)

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "subject": "Mathematics",
      "subjectCode": "MATH7",
      "quarter": "Q1",
      "schoolYear": "2025-2026",
      "writtenWorkPs": 85.5,
      "perfTaskPs": 88.0,
      "quarterlyAssessPs": 82.0,
      "initialGrade": 85.35,
      "quarterlyGrade": 86,
      "remarks": "Passed"
    },
    {
      "subject": "English",
      "subjectCode": "ENG7",
      "quarter": "Q1",
      "schoolYear": "2025-2026",
      "writtenWorkPs": 90.0,
      "perfTaskPs": 88.5,
      "quarterlyAssessPs": 85.0,
      "initialGrade": 88.15,
      "quarterlyGrade": 89,
      "remarks": "Passed"
    }
  ]
}
```

---

### 2. Get Section Grades
```
GET http://100.93.66.120:3000/api/grades/section/:sectionId?quarter=Q1
```

**Purpose:** Get all student grades for a section

**Parameters:**
- `sectionId` - Section ID (in URL)
- `quarter` - Q1, Q2, Q3, or Q4 (query parameter)

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "sectionId": "section-123",
    "sectionName": "Einstein",
    "gradeLevel": "GRADE_7",
    "quarter": "Q1",
    "students": [
      {
        "lrn": "123456789012",
        "firstName": "Juan",
        "lastName": "Dela Cruz",
        "initialGrade": 85.35,
        "quarterlyGrade": 86,
        "remarks": "Passed"
      },
      {
        "lrn": "123456789013",
        "firstName": "Maria",
        "lastName": "Santos",
        "initialGrade": 90.50,
        "quarterlyGrade": 91,
        "remarks": "Passed"
      }
    ]
  }
}
```

---

### 3. Get Class Record
```
GET http://100.93.66.120:3000/api/class-records/:classAssignmentId
```

**Purpose:** Get complete class record (for printing/reports)

**Parameters:**
- `classAssignmentId` - Class assignment ID (in URL)

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "teacher": "Mr. John Doe",
    "subject": "Mathematics",
    "section": "Einstein - Grade 7",
    "schoolYear": "2025-2026",
    "students": [
      {
        "lrn": "123456789012",
        "name": "Dela Cruz, Juan C.",
        "quarters": {
          "Q1": { "initialGrade": 85.35, "quarterlyGrade": 86 },
          "Q2": { "initialGrade": 87.20, "quarterlyGrade": 88 },
          "Q3": null,
          "Q4": null
        },
        "finalGrade": null
      }
    ]
  }
}
```

---

### 4. Daily Attendance Tracking & Reporting
```
GET http://100.93.66.120:3000/api/attendance/section/:sectionId?date=YYYY-MM-DD
POST http://100.93.66.120:3000/api/attendance/bulk
GET http://100.93.66.120:3000/api/attendance/summary/:sectionId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
GET http://100.93.66.120:3000/api/attendance/student/:studentId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&sectionId=xxx
GET http://100.93.66.120:3000/api/attendance/export/:sectionId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

**Purpose:** Track daily student attendance (Present, Absent, Late, Excused) with reporting and Excel export (SF2 format)

**Note:** SF2 export now supports **template-based generation**! Upload custom SF2 template in Admin → Template Manager.

#### GET Attendance for Section by Date
**Parameters:**
- `sectionId` - Section ID (in URL)
- `date` - Date in YYYY-MM-DD format (query parameter)

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "section": {
      "id": "section-123",
      "name": "Einstein",
      "gradeLevel": "GRADE_7"
    },
    "date": "2026-05-08",
    "attendance": [
      {
        "studentId": "student-abc",
        "lrn": "123456789012",
        "firstName": "Juan",
        "middleName": "Cruz",
        "lastName": "Dela Cruz",
        "status": "PRESENT",
        "remarks": null,
        "attendanceId": "att-xyz-123"
      },
      {
        "studentId": "student-def",
        "lrn": "123456789013",
        "firstName": "Maria",
        "middleName": "Santos",
        "lastName": "Garcia",
        "status": "ABSENT",
        "remarks": "Sick leave",
        "attendanceId": "att-xyz-456"
      }
    ]
  }
}
```

#### POST Bulk Save Attendance
**Request Body:**
```json
{
  "sectionId": "section-123",
  "date": "2026-05-08",
  "attendance": [
    {
      "studentId": "student-abc",
      "status": "PRESENT",
      "remarks": null
    },
    {
      "studentId": "student-def",
      "status": "ABSENT",
      "remarks": "Doctor's appointment"
    },
    {
      "studentId": "student-ghi",
      "status": "LATE",
      "remarks": "Traffic"
    },
    {
      "studentId": "student-jkl",
      "status": "EXCUSED",
      "remarks": "School event"
    }
  ]
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Attendance saved successfully"
}
```

#### GET Attendance Summary (Date Range)
**Parameters:**
- `sectionId` - Section ID (in URL)
- `startDate` - Start date YYYY-MM-DD (query parameter)
- `endDate` - End date YYYY-MM-DD (query parameter)

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "sectionId": "section-123",
    "startDate": "2026-05-01",
    "endDate": "2026-05-08",
    "summary": [
      {
        "studentId": "student-abc",
        "lrn": "123456789012",
        "firstName": "Juan",
        "middleName": "Cruz",
        "lastName": "Dela Cruz",
        "present": 6,
        "absent": 1,
        "late": 1,
        "excused": 0,
        "total": 8
      }
    ]
  }
}
```

#### GET Student Attendance History
**Parameters:**
- `studentId` - Student ID (in URL)
- `startDate` - Optional start date (query parameter)
- `endDate` - Optional end date (query parameter)
- `sectionId` - Optional section filter (query parameter)

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "att-xyz-123",
        "date": "2026-05-08",
        "status": "PRESENT",
        "remarks": null,
        "section": {
          "id": "section-123",
          "name": "Einstein",
          "gradeLevel": "GRADE_7"
        }
      }
    ],
    "summary": {
      "present": 20,
      "absent": 2,
      "late": 1,
      "excused": 1,
      "total": 24
    }
  }
}
```

#### GET Export Attendance to Excel (SF2 Format)
**Purpose:** Download attendance report as Excel file (Daily Attendance Record - School Form 2)

**Parameters:**
- `sectionId` - Section ID (in URL)
- `startDate` - Start date YYYY-MM-DD (query parameter)
- `endDate` - End date YYYY-MM-DD (query parameter)

**Response:** Binary Excel file (.xlsx)

**Excel Format:**
- Header: Daily Attendance Record (SF2)
- Section info: Name, Grade Level, School Year, Date Range
- Columns: No., LRN, Last Name, First Name, Middle Name, [Date columns], Present, Absent, Late, Excused, Total, Attendance %
- Date columns show: P (Present), A (Absent), L (Late), E (Excused)
- Summary statistics per student

**Usage Example:**
```typescript
// Frontend download implementation
const response = await axios.get(
  `${SERVER_URL}/api/attendance/export/${sectionId}`,
  {
    params: { startDate: '2026-05-01', endDate: '2026-05-31' },
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'blob'
  }
);

// Create download
const url = window.URL.createObjectURL(new Blob([response.data]));
const link = document.createElement('a');
link.href = url;
link.setAttribute('download', 'Attendance_Report.xlsx');
document.body.appendChild(link);
link.click();
link.remove();
```

---

### 5. DepEd School Form Templates (SF1-SF10)
```
GET http://100.93.66.120:3000/api/templates
GET http://100.93.66.120:3000/api/templates/:formType
GET http://100.93.66.120:3000/api/templates/:id/preview
GET http://100.93.66.120:3000/api/templates/:id/styled-preview
POST http://100.93.66.120:3000/api/templates/upload
DELETE http://100.93.66.120:3000/api/templates/:id
POST http://100.93.66.120:3000/api/templates/:id/toggle
GET http://100.93.66.120:3000/api/templates/:formType/download
```

**Purpose:** Manage Excel templates for DepEd School Forms (SF1, SF2, SF3, etc.)

**Benefits:**
- ✅ **Zero code changes** when DepEd updates forms
- ✅ Admin uploads templates with placeholders (`{{SCHOOL_NAME}}`, `{{#STUDENTS}}...{{/STUDENTS}}`)
- ✅ System automatically fills templates with real data
- ✅ Perfect formatting preserved (colors, borders, fonts)
- ✅ **NEW: Pixel-perfect HTML rendering** from uploaded Excel templates

**Supported Form Types:**
- SF1 - School Register (Student Master List)
- SF2 - Daily Attendance Record
- SF3 - Individual Learner Monitoring
- SF4 - Quarterly Assessment Report
- SF5 - Promotion/Completion Report
- SF6 - Learner Information System
- SF8 - Learner's Basic Health and Nutrition Report
- SF9 - Progress Report (JHS/SHS)
- SF10 - Learner's Permanent Record

**How It Works:**
1. Admin creates Excel file with placeholders (see [TEMPLATE_GUIDE.md](TEMPLATE_GUIDE.md))
2. Upload via Admin → Template Manager
3. System validates and extracts placeholders
4. When users download reports, system fills template with real data
5. Original formatting preserved!

#### POST Upload Template
**Request:** multipart/form-data
```
file: [Excel file .xlsx/.xls]
formType: "SF1" | "SF2" | "SF3" | ... | "SF10" | "SF1_10_BUNDLE"
uploadMode: "single" | "bundle"
formTypes: ["SF1","SF2",... ] (JSON string, required for bundle mode)
sheetMappings: { "SF1": "Sheet Name", "SF2": "Sheet Name" } (optional JSON string)
formName: "School Form 2 - Daily Attendance Record"
description: "Optional description"
instructions: "Optional usage instructions"
```

**Bundle Mode (All-in-One Workbooks):**
- Upload one file containing multiple sheets (for example, School Forms 1-10 in one workbook)
- Use `formType="SF1_10_BUNDLE"` and `uploadMode="bundle"`
- If `sheetMappings` is not provided, the system auto-detects matching sheets by names like `School Form 1 (SF1)`, `School Form 2 (SF2)`, etc.
- Each form is saved as its own template record, all pointing to the same uploaded workbook file

**Response:**
```json
{
  "success": true,
  "message": "Template uploaded successfully",
  "data": {
    "id": "template-123",
    "formType": "SF2",
    "formName": "School Form 2 - Daily Attendance Record",
    "placeholders": ["SCHOOL_NAME", "SECTION_NAME", "STUDENTS", "DATE", ...],
    "isActive": true
  }
}
```

#### GET Styled Preview (NEW - High-Fidelity Rendering)
```
GET http://100.93.66.120:3000/api/templates/:id/styled-preview?sheet=SheetName
```

**Purpose:** Get template structure with full styling for pixel-perfect HTML rendering

**Parameters:**
- `id` - Template ID (in URL)
- `sheet` - Optional sheet name to filter (query parameter)

**Response:**
```json
{
  "success": true,
  "data": {
    "templateId": "template-123",
    "formType": "SF9",
    "formName": "School Form 9 - Progress Report",
    "fileName": "SF9_Template.xlsx",
    "mappedSheetName": "SF9",
    "parsedStructure": {
      "sheets": [
        {
          "name": "SF9",
          "rowCount": 50,
          "colCount": 15,
          "cells": [
            {
              "row": 1,
              "col": 1,
              "value": "REPORT CARD",
              "type": "string",
              "style": {
                "backgroundColor": "#0070C0",
                "color": "#FFFFFF",
                "fontSize": 14,
                "fontWeight": "bold",
                "textAlign": "center",
                "border": {
                  "top": { "style": "2px solid", "color": "#000000" },
                  "bottom": { "style": "2px solid", "color": "#000000" }
                }
              },
              "mergeInfo": {
                "rowSpan": 1,
                "colSpan": 15,
                "isMaster": true
              }
            }
          ],
          "columnWidths": [50, 120, 80, ...],
          "rowHeights": [25, 20, 20, ...],
          "mergedCells": ["A1:O1", "B5:E5"]
        }
      ],
      "metadata": {
        "creator": "Admin User",
        "created": "2026-04-01T00:00:00.000Z"
      }
    }
  }
}
```

**Use Case:**
This endpoint powers the **Dynamic Template Rendering System**. Frontend can:
1. Fetch template structure with complete styling
2. Render pixel-perfect HTML that matches Excel exactly
3. Support print output that looks identical to original template
4. Enable "no-code maintenance" - admin uploads new template, pages automatically use it

**Example Usage in React:**
```tsx
import ExcelRenderer from '@/components/ExcelRenderer';
import { useTemplate } from '@/lib/useTemplate';

function FormViewer() {
  const { activeSheet, loading } = useTemplate('SF9');
  
  return (
    <>
      {activeSheet && <ExcelRenderer sheet={activeSheet} />}
      <button onClick={() => window.print()}>Print</button>
    </>
  );
}
```

---

### 7. SF1 - School Register Export
```
GET http://100.93.66.120:3000/api/registrar/export/sf1/:sectionId
```

**Purpose:** Generate SF1 School Register (complete student roster for a section)

**Parameters:**
- `sectionId` - Section ID (in URL)

**Response:** Binary Excel file (.xlsx)

**Excel Contents:**
- School and section information
- Complete student roster with:
  - LRN, Name (Last, First, Middle, Suffix)
  - Birth Date, Gender
  - Address
  - Guardian information
- Total student count
- Adviser name

**Template Support:** ✅ Uses SF1 template if uploaded, otherwise uses default format

**Usage Example:**
```typescript
const response = await axios.get(
  `${SERVER_URL}/api/registrar/export/sf1/${sectionId}`,
  {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'blob'
  }
);

const url = window.URL.createObjectURL(new Blob([response.data]));
const link = document.createElement('a');
link.href = url;
link.setAttribute('download', 'SF1_School_Register.xlsx');
document.body.appendChild(link);
link.click();
link.remove();
```

---

### 6. ECR Template Management (Electronic Class Record Templates)
```
GET http://100.93.66.120:3000/api/ecr-templates
GET http://100.93.66.120:3000/api/ecr-templates/:id
GET http://100.93.66.120:3000/api/ecr-templates/:id/download
POST http://100.93.66.120:3000/api/ecr-templates/upload
PUT http://100.93.66.120:3000/api/ecr-templates/:id
DELETE http://100.93.66.120:3000/api/ecr-templates/:id
POST http://100.93.66.120:3000/api/ecr-templates/generate/:classAssignmentId
POST http://100.93.66.120:3000/api/ecr-templates/sync/:classAssignmentId
```

**Purpose:** Manage Electronic Class Record (ECR) templates that auto-fill with student data

**What are ECR Templates?**
ECR Templates are subject-specific Excel files that teachers use for class records. Instead of manually typing student names, LRNs, and class info into blank templates, the system automatically generates completed ECR files with all student data pre-populated. This ensures:
- ✅ **Time Savings:** Teachers don't manually type student names
- ✅ **Standardization:** All teachers use the same format for each subject
- ✅ **Auto-Fill Magic:** Student lists, grades, sections automatically populated
- ✅ **Error Reduction:** No typos in student names or LRNs

**Admin Workflow:**
1. Admin uploads Excel template for each subject (Math, English, Science, etc.)
2. Template contains placeholders: `{{SCHOOL_NAME}}`, `{{TEACHER_NAME}}`, `{{SUBJECT}}`, `{{STUDENT_LIST}}`, etc.
3. System validates and stores template
4. Template becomes available for all teachers teaching that subject

**Teacher Workflow:**
1. Teacher opens their class record page
2. Clicks "Download ECR" button
3. System finds active template for their subject
4. System generates auto-filled Excel with:
   - School info, teacher name, subject, grade, section
   - Complete student roster (LRN, full names)
   - Formatted and ready to use
5. Teacher receives downloadable Excel file

#### GET All ECR Templates
**Endpoint:**
```
GET http://100.93.66.120:3000/api/ecr-templates?subjectName=Mathematics&isActive=true
```

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Query Parameters:**
- `subjectName` (optional) - Filter by subject name
- `isActive` (optional) - Filter by active status (true/false)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "ecr-template-123",
      "subjectName": "Mathematics",
      "description": "Electronic Class Record template for Mathematics",
      "filePath": "/uploads/ecr-templates/1234567890-ECR_Math.xlsx",
      "fileName": "ECR_Math.xlsx",
      "fileSize": 45320,
      "placeholders": [
        "SCHOOL_NAME",
        "TEACHER_NAME",
        "SUBJECT",
        "GRADE_LEVEL",
        "SECTION",
        "SCHOOL_YEAR",
        "STUDENT_LIST"
      ],
      "instructions": "Insert student names at row marked with {{STUDENT_LIST}}",
      "isActive": true,
      "uploadedBy": "admin-user-id",
      "uploadedByName": "Admin User",
      "createdAt": "2026-04-17T10:00:00.000Z",
      "updatedAt": "2026-04-17T10:00:00.000Z"
    }
  ]
}
```

#### GET Single ECR Template
**Endpoint:**
```
GET http://100.93.66.120:3000/api/ecr-templates/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ecr-template-123",
    "subjectName": "English",
    "description": "Electronic Class Record for English subject",
    "fileName": "ECR_English.xlsx",
    "fileSize": 52000,
    "placeholders": ["SCHOOL_NAME", "TEACHER_NAME", "SUBJECT", ...],
    "instructions": "Template includes grading rubrics and student list section",
    "isActive": true,
    "uploadedBy": "admin-user-id",
    "uploadedByName": "Admin User",
    "createdAt": "2026-04-17T10:00:00.000Z",
    "updatedAt": "2026-04-17T10:00:00.000Z"
  }
}
```

#### POST Upload ECR Template
**Endpoint:**
```
POST http://100.93.66.120:3000/api/ecr-templates/upload
```

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: multipart/form-data
```

**Request Body (FormData):**
- `file` - Excel file (.xlsx, .xls) - **Required**
- `subjectName` - Subject name (e.g., "Mathematics", "English") - **Required**
- `description` - Template description (optional)
- `instructions` - Usage instructions (optional)

**Placeholders Supported:**
- `{{SCHOOL_NAME}}` - Replaced with school name from system settings
- `{{TEACHER_NAME}}` - Replaced with teacher's full name
- `{{SUBJECT}}` - Replaced with subject name
- `{{GRADE_LEVEL}}` - Replaced with grade level (Grade 7, Grade 8, etc.)
- `{{SECTION}}` - Replaced with section name
- `{{SCHOOL_YEAR}}` - Replaced with school year
- `{{STUDENT_LIST}}` - **Special:** Marks where student rows should be inserted

**Response:**
```json
{
  "success": true,
  "message": "ECR template uploaded successfully",
  "data": {
    "id": "ecr-template-123",
    "subjectName": "Science",
    "fileName": "ECR_Science.xlsx",
    "fileSize": 48900,
    "placeholders": ["SCHOOL_NAME", "TEACHER_NAME", "STUDENT_LIST"],
    "isActive": true
  }
}
```

**Validation:**
- Only one active template per subject
- File must be valid Excel (.xlsx or .xls)
- Max file size: 15MB
- Template should contain `{{STUDENT_LIST}}` placeholder for proper student insertion

#### PUT Update ECR Template
**Endpoint:**
```
PUT http://100.93.66.120:3000/api/ecr-templates/:id
```

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "description": "Updated description",
  "instructions": "Updated usage instructions",
  "isActive": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "ECR template updated successfully",
  "data": {
    "id": "ecr-template-123",
    "subjectName": "Mathematics",
    "description": "Updated description",
    "instructions": "Updated usage instructions",
    "isActive": true
  }
}
```

#### GET Download ECR Template (Blank)
**Endpoint:**
```
GET http://100.93.66.120:3000/api/ecr-templates/:id/download
```

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response:** Binary Excel file (.xlsx)

**Purpose:** Download the blank template (without auto-fill) for review or manual editing

**Filename:** `ECR_{SubjectName}_{timestamp}.xlsx`

#### DELETE ECR Template
**Endpoint:**
```
DELETE http://100.93.66.120:3000/api/ecr-templates/:id
```

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Response:**
```json
{
  "success": true,
  "message": "ECR template deleted successfully"
}
```

**Note:** File is only deleted if no other templates reference it (reference-counted deletion)

#### POST Generate Auto-Filled ECR (⭐ Main Feature)
**Endpoint:**
```
POST http://100.93.66.120:3000/api/ecr-templates/generate/:classAssignmentId
```

**Headers:**
```
Authorization: Bearer {jwt_token}
```

**Parameters:**
- `classAssignmentId` - The teacher's class assignment ID (in URL)

**What It Does:**
1. Fetches class assignment with teacher, subject, section, enrolled students
2. Finds active ECR template for the subject
3. Loads template Excel file with ExcelJS
4. Replaces all placeholders with real data:
   - `{{SCHOOL_NAME}}` → "Sample High School"
   - `{{TEACHER_NAME}}` → "Ms. Jane Doe"
   - `{{SUBJECT}}` → "Mathematics"
   - `{{GRADE_LEVEL}}` → "Grade 7"
   - `{{SECTION}}` → "Einstein"
   - `{{SCHOOL_YEAR}}` → "2025-2026"
5. Finds `{{STUDENT_LIST}}` placeholder row
6. Inserts student rows with:
   - Row number (1, 2, 3, ...)
   - LRN
   - Full name (Last Name, First Name Middle Name)
7. Generates output Excel file
8. Returns file for download

**Response:** Binary Excel file (.xlsx)

**Filename:** `ECR_{SubjectName}_{GradeLevel}_{Section}_{timestamp}.xlsx`

**Example:**
- Filename: `ECR_Mathematics_Grade_7_Einstein_1713353200000.xlsx`
- Contains: Complete student roster auto-filled with names and LRNs
- Ready to use: Teacher just needs to add grades

**Error Responses:**
```json
{
  "error": "Class assignment not found or access denied"
}
```

```json
{
  "error": "No active ECR template found for subject: Mathematics"
}
```

```json
{
  "error": "Template file not found on server"
}
```

**Usage Example (React/TypeScript):**
```typescript
const downloadECR = async (classAssignmentId: string) => {
  const token = sessionStorage.getItem('token');
  const response = await fetch(
    `${SERVER_URL}/api/ecr-templates/generate/${classAssignmentId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `ECR_${Date.now()}.xlsx`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};
```

**Benefits:**
- ✅ **Zero manual data entry** - All student info auto-populated
- ✅ **Consistent formatting** - All teachers use same template
- ✅ **Fast setup** - Download takes seconds, not hours
- ✅ **Error-free** - No typos in student names or LRNs
- ✅ **Easy updates** - Admin can update templates without code changes

#### POST Sync Grades from ECR (⭐ Upload & Import)
**Endpoint:**
```
POST http://100.93.66.120:3000/api/ecr-templates/sync/:classAssignmentId
```

**Headers:**
```
Authorization: Bearer {jwt_token}
Content-Type: multipart/form-data
```

**Parameters:**
- `classAssignmentId` - The teacher's class assignment ID (in URL)

**Request Body (FormData):**
- `file` - Excel file (.xlsx, .xls) with grades - **Required**
- `quarter` - Quarter to sync (Q1, Q2, Q3, Q4) - **Required**

**What It Does:**
1. Teacher downloads ECR → enters grades in Excel → uploads edited file
2. System loads uploaded Excel and finds quarter sheet
3. Parses student names and scores:
   - Columns 6-15: Written Work (WW) scores
   - Columns 19-28: Performance Task (PT) scores
   - Column 32: Quarterly Assessment (QA) score
4. Matches students by full name (Last, First M.)
5. Updates/creates Grade records in database with parsed scores
6. Returns sync stats (updated/created/not found)

**Response:**
```json
{
  "success": true,
  "message": "Grades synced successfully",
  "stats": {
    "updated": 28,
    "created": 2,
    "notFound": 0
  }
}
```

**Error Responses:**
```json
{
  "success": false,
  "error": "No file uploaded"
}
```

```json
{
  "success": false,
  "error": "No Q1 sheet found in uploaded file"
}
```

```json
{
  "success": false,
  "error": "Class not found"
}
```

**Student Matching:**
- System matches by full name: `LastName, FirstName MiddleInitial.`
- Names not matching any enrolled student are logged as `notFound`
- Case-insensitive matching

**Usage Example:**
```typescript
const syncGrades = async (classAssignmentId: string, quarter: string, file: File) => {
  const token = sessionStorage.getItem('token');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('quarter', quarter);

  const response = await fetch(
    `${SERVER_URL}/api/ecr-templates/sync/${classAssignmentId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    }
  );

  const result = await response.json();
  if (result.success) {
    console.log(`Synced ${result.stats.updated + result.stats.created} grades`);
  }
};
```

**Workflow:**
1. Download ECR → `POST /generate/:classAssignmentId`
2. Teacher fills in grades offline in Excel
3. Upload edited ECR → `POST /sync/:classAssignmentId` with `quarter=Q1`
4. Grades imported into database automatically

---

## 🟢 APIs YOU NEED (What you will call from other teams)

### Team Member IPs (from Tailscale):
- **dev-jegs** (100.120.169.123:3000) - System: `Enrollment` ⚠️ OFFLINE (server not started)
- **njgrm** (100.88.55.125:3000) - System: `Scheduling` ⚠️ OFFLINE (API not started, only database on 8080)
- **tfrog** (100.92.245.14:3000) - System: `Learning Management System` ⚠️ OFFLINE (server not started)

**Assumption:** All teams using port **3000** (standard Node.js dev port)

**Status:** ❌ No API servers are running yet - teams need to start their servers!

**What to do:**
1. Ask in Discord: "Can everyone start their servers? I'm trying to test Tailscale connectivity."
2. Test command: `Invoke-WebRequest -Uri "http://100.120.169.123:3000" -UseBasicParsing`

---

### 1. Get Students/Learners (FROM: dev-jegs - Enrollment System) 🎯 PRIORITY

**Team:** dev-jegs (100.120.169.123:3000) - **Currently OFFLINE**

✅ **CONFIRMED:** dev-jegs has the student/learner master data!

**Ask dev-jegs when they're back online:**
1. Can you start your server? (npm run dev)
2. What endpoint gives me student/learner data? (/api/learners? /api/students?)
3. What fields do you have available?

```
GET http://100.120.169.123:3000/api/learners
```

**What you need:**
```json
[
  {
    "lrn": "123456789012",
    "firstName": "Juan",
    "middleName": "Cruz",
    "lastName": "Dela Cruz",
    "suffix": null,
    "birthDate": "2010-05-15",
    "gender": "Male",
    "address": "123 Main St, City",
    "guardianName": "Maria Dela Cruz",
    "guardianContact": "09171234567"
  }
]
```

**Optional parameters:**
- `?updatedSince=2026-04-17T00:00:00Z` - Get only recently updated students

---

### 2. Get Enrollments (FROM: dev-jegs - Enrollment System) 🎯 PRIORITY

**Team:** dev-jegs (100.120.169.123:3000) - **Currently OFFLINE**

**Ask dev-jegs when they're back online:**
1. Can you start your server? (npm run dev)
2. What endpoint gives me enrollments? (/api/enrollments?)
3. Do you also have student/learner data, or just enrollments?

```
GET http://100.120.169.123:3000/api/enrollments?schoolYear=2025-2026
```

**What you need:**
```json
[
  {
    "lrn": "123456789012",
    "sectionId": "section-abc-123",
    "sectionName": "Einstein",
    "gradeLevel": "GRADE_7",
    "schoolYear": "2025-2026",
    "status": "ENROLLED"
  }
]
```

**Why you need this:**
- To know which students are in which sections
- To link students to your class assignments for grading

---

### 3. Get Sections (FROM: njgrm or tfrog?)

**Which team has this?** ⚠️ **NEED TO ASK**
- njgrm = Scheduling System (likely has sections/schedules!)
- tfrog = Learning Management System (might also have sections)

**Ask njgrm:** "Do you have sections/grade levels data? What endpoint?"

```
GET http://100.88.55.125:3000/api/sections?schoolYear=2025-2026
```

**What you need:**
```json
[
  {
    "id": "section-abc-123",
    "name": "Einstein",
    "gradeLevel": "GRADE_7",
    "schoolYear": "2025-2026",
    "adviserId": "teacher-xyz-456",
    "adviserName": "Mr. John Doe"
  }
]
```

**Why you need this:**
- To display section names in your grading interface
- To link class assignments to sections

---

## 📋 Questions to Ask Other Teams (Copy to Discord)

```
Hey team! 👋

I've mapped out who has what system. Can everyone start their servers so we can test Tailscale?

**Systems Identified (All on port 3000):**
- dev-jegs (100.120.169.123:3000) = Enrollment System ⚠️ OFFLINE
- njgrm (100.88.55.125:3000) = Scheduling System ⚠️ OFFLINE
- tfrog (100.92.245.14:3000) = Learning Management System ⚠️ OFFLINE
- Me (100.93.66.120:3000) = Grading & Academic Records ✅ READY

**Can everyone please:**
1. Start your server (cd server && npm run dev)
2. Reply when it's running so I can test
3. Share your main API endpoints

**Specific questions:**

**@dev-jegs (Enrollment + Student Data):** 🔥 PRIORITY!
- Endpoint for students/learners? (GET /api/learners? /api/students?)
- Endpoint for enrollments? (GET /api/enrollments?)
- You have BOTH the data we need most!

**@njgrm (Scheduling):**
- Endpoint for sections? (GET /api/sections?)
- What grade levels and school years do you manage?

**@tfrog (Learning Management):**
- What endpoints do you have?
- What data can you share?

**What I need for grading:**
🎯 Student/learner data (LRN, firstName, lastName) ← FROM dev-jegs ✅
🎯 Enrollments (which students in which sections) ← FROM dev-jegs ✅
🎯 Sections (section names, grade levels) ← FROM njgrm (probably)

**What I provide:**
✅ Student grades by LRN: GET /api/grades/student/:lrn
✅ Class records by section: GET /api/grades/section/:sectionId

Let's test Tailscale once everyone's servers are running! 🚀
```

---

## 🔧 How to Test APIs

### ⚡ Quick Test (Run the script):
```powershell
# Just run this script to test all servers at once
.\test-tailscale-servers.ps1
```

---

## 🔗 Integration Routes (`/api/integration`)

Routes that proxy data from EnrollPro, ATLAS, and AIMS into SMART.  
Base URL: `http://localhost:5003`  
All routes require `Authorization: Bearer <SMART_JWT>`.

---

### Health Check

#### `GET /api/integration/status`
Checks live connectivity to all 3 external systems.

**Auth:** Any authenticated SMART user  
**Response:**
```json
{
  "success": true,
  "data": {
    "enrollpro": { "online": true },
    "atlas": { "online": true },
    "aims": { "online": true },
    "checkedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### EnrollPro Integration

#### `GET /api/integration/enrollpro/my-advisory`
Returns the logged-in teacher's advisory section and full student roster from EnrollPro.  
Matched by teacher email. Uses `SY9` (2025–2026) data.

**Auth:** `TEACHER` role  
**Response:**
```json
{
  "success": true,
  "data": {
    "teacher": { "enrollproId": 12, "name": "Juan Dela Cruz", "email": "juan@deped.edu.ph" },
    "advisory": {
      "enrollproSectionId": 5,
      "sectionName": "7-Sampaguita",
      "gradeLevel": "Grade 7",
      "schoolYear": "2025-2026",
      "studentCount": 45,
      "students": [
        { "enrollproId": 1, "lrn": "122564000001", "firstName": "Maria", "lastName": "Santos", "sex": "F", "status": "ENROLLED" }
      ]
    }
  }
}
```

---

#### `GET /api/integration/enrollpro/sections`
Returns all sections from EnrollPro with adviser info.

**Auth:** Any authenticated user  
**Response:** `{ "success": true, "data": [ ...EnrollPro sections... ] }`

---

#### `GET /api/integration/enrollpro/section-roster/:enrollproSectionId`
Returns the student roster for a specific EnrollPro section.

**Auth:** Any authenticated user  
**Params:** `enrollproSectionId` — numeric EnrollPro section ID  
**Response:** `{ "success": true, "data": { "learners": [...] } }`

---

#### `GET /api/integration/enrollpro/faculty`
Returns all faculty from EnrollPro with advisory assignments.

**Auth:** `ADMIN` or `REGISTRAR` role  
**Response:** `{ "success": true, "data": [ ...EnrollPro faculty... ] }`

---

### ATLAS Integration

#### `GET /api/integration/atlas/my-teaching-load`
Returns the logged-in teacher's class assignments from the SMART local DB (synced from ATLAS every 30 min). Homeroom Guidance (`HG`) is included as a regular subject assignment.

**Auth:** `TEACHER` role  
**Response:**
```json
{
  "success": true,
  "data": {
    "assignments": [
      {
        "id": "ca_123",
        "subject": {
          "id": "subj_123",
          "code": "HG7",
          "name": "Homeroom Guidance",
          "type": "CORE"
        },
        "section": {
          "id": "sec_123",
          "name": "7-Sampaguita",
          "gradeLevel": "GRADE_7",
          "schoolYear": "2026-2027",
          "studentCount": 42
        },
        "teachingMinutes": 60
      }
    ]
  }
}
```

### Teacher Dashboard Stitch (Login-Time Composer)

This is the read-only merge SMART should use after teacher login to build the unified Class Records view.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher
    participant SMART as SMART Auth API
    participant EP as EnrollPro API
    participant ATLAS as ATLAS API

    Teacher->>SMART: POST /api/auth/login
    SMART->>SMART: Validate credentials and issue SMART JWT
    SMART->>SMART: Fire-and-forget syncTeacherOnLogin()

    SMART->>EP: GET /teachers (resolve teacher profile)
    EP-->>SMART: Teacher profile + employeeId + internal teacherId

    SMART->>EP: GET /sections (resolve advisory section)
    EP-->>SMART: Sections with advisingTeacher + grade level

    SMART->>EP: GET /students?sectionId=:advisorySectionId&schoolYearId=:sy
    EP-->>SMART: Advisory roster

    SMART->>ATLAS: GET /faculty?schoolId=1
    ATLAS-->>SMART: Faculty list with externalId

    SMART->>ATLAS: GET /faculty-assignments/:atlasFacultyId?schoolYearId=8
    ATLAS-->>SMART: Teaching load by subject + section

    SMART->>EP: GET /students?sectionId=:sectionId&schoolYearId=:sy
    EP-->>SMART: Class roster for each matched subject-section

    SMART-->>Teacher: Unified class-record payload
```

#### Recommended stitched response

```json
{
  "success": true,
  "data": {
    "teacher": {
      "smartTeacherId": "t_123",
      "employeeId": "3179586",
      "name": "Juan Dela Cruz",
      "email": "juan@deped.edu.ph"
    },
    "sourceMeta": {
      "schoolYearLabel": "2026-2027",
      "enrollproSchoolYearId": 28,
      "atlasSchoolYearId": 8,
      "generatedAt": "2026-05-14T08:00:00.000Z"
    },
    "advisory": {
      "section": {
        "id": 5,
        "name": "7-Sampaguita",
        "gradeLevel": "GRADE_7"
      },
      "students": [
        {
          "lrn": "122564000001",
          "firstName": "Maria",
          "lastName": "Santos",
          "status": "ENROLLED"
        }
      ]
    },
    "classRecords": [
      {
        "recordKey": "ca_123",
        "source": {
          "atlasFacultyId": 19,
          "atlasAssignmentId": "f1a8c5b7",
          "enrollproSectionId": 5
        },
        "subject": {
          "code": "MATH7",
          "name": "Mathematics",
          "type": "CORE"
        },
        "section": {
          "id": 5,
          "name": "7-Sampaguita",
          "gradeLevel": "GRADE_7",
          "schoolYear": "2026-2027"
        },
        "students": [
          {
            "lrn": "122564000001",
            "firstName": "Maria",
            "lastName": "Santos"
          }
        ]
      }
    ],
    "warnings": []
  }
}
```

#### Node.js boilerplate

Use the shared helper in [server/src/lib/teacherDashboardComposer.ts](server/src/lib/teacherDashboardComposer.ts) to keep the route thin and avoid duplicating the EnrollPro/ATLAS fetch logic.

---

### Admin Teaching Load Summary

#### `GET /api/admin/class-assignments`
Returns class assignments and workload summary lines for admin load review.

**Auth:** `ADMIN` role

**Response (excerpt):**
```json
{
  "assignments": [
    {
      "id": "ca_123",
      "schoolYear": "2026-2027",
      "teachingMinutes": 60,
      "subject": { "code": "HG7", "name": "Homeroom Guidance" }
    }
  ],
  "workloadSummary": [
    {
      "teacherId": "t_1",
      "teacherName": "Dela Cruz, Juan",
      "sectionId": "sec_123",
      "sectionName": "7-Sampaguita",
      "gradeLevel": "GRADE_7",
      "hgMinutes": 60,
      "advisoryRoleMinutes": 60,
      "otherSubjectMinutes": 180,
      "totalMinutes": 300
    }
  ]
}
```

### Grade Entry Rules (HG)

- `POST /api/grades/grade` accepts `qualitativeDescriptor` for HG classes.
- Allowed HG descriptors: `No Improvement`, `Needs Improvement`, `Developing`, `Sufficiently Developed`.
- Numeric fields are ignored for HG; HG grade records are stored as qualitative entries.
- ECR endpoints (`/api/grades/ecr/preview`, `/api/grades/ecr/import`, `/api/grades/ecr/status/:classAssignmentId`) return `400` for HG classes.

---

### AIMS Integration

#### `POST /api/integration/aims/auth`
Authenticates the logged-in teacher against AIMS using their DepEd email and AIMS-specific password.  
Returns an `aimsToken` to use in subsequent AIMS requests via `X-Aims-Token` header.

**Auth:** `TEACHER` role  
**Request body:**
```json
{ "aimsPassword": "teacher_aims_password" }
```
**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 900
  }
}
```

---

#### `POST /api/integration/aims/refresh`
Refreshes an expired AIMS access token using a refresh token.

**Auth:** `TEACHER` role  
**Request body:** `{ "refreshToken": "..." }`  
**Response:** `{ "success": true, "data": { "accessToken": "...", "expiresIn": 900 } }`

---

#### `GET /api/integration/aims/courses`
Returns the teacher's courses (section–subject combos) from AIMS.

**Auth:** `TEACHER` role  
**Headers:** `X-Aims-Token: <aimsToken>`  
**Response:** `{ "success": true, "data": [ ...AIMS courses... ] }`

---

#### `GET /api/integration/aims/gradebook/:courseId`
Returns the full DepEd-format gradebook for an AIMS course (WW/PT categories, quarterly grades).

**Auth:** `TEACHER` role  
**Headers:** `X-Aims-Token: <aimsToken>`  
**Params:** `courseId` — AIMS course ID  
**Response:** `{ "success": true, "data": { ...gradebook... } }`

---

#### `GET /api/integration/aims/students/:courseId`
Returns students enrolled in an AIMS course.

**Auth:** `TEACHER` role  
**Headers:** `X-Aims-Token: <aimsToken>`  
**Params:** `courseId` — AIMS course ID  
**Response:** `{ "success": true, "data": [ ...students... ] }`

---

#### `GET /api/integration/aims/dashboard`
Returns an overview of the teacher's dashboard stats from AIMS.

**Auth:** `TEACHER` role  
**Headers:** `X-Aims-Token: <aimsToken>`  
**Response:** `{ "success": true, "data": { ...dashboard stats... } }`

---

### External System Credentials (Setup)

These are configured in `server/.env` and are not exposed to the frontend:

| Variable | Purpose |
|---|---|
| `ENROLLPRO_BASE_URL` | `https://dev-jegs.buru-degree.ts.net/api` |
| `ENROLLPRO_ACCOUNT_NAME` | Admin account ID (e.g. `1000001`) — used as `accountName` in login |
| `ENROLLPRO_PASSWORD` | Admin account password |
| `ENROLLPRO_SCHOOL_YEAR_ID` | `28` (2025–2026, has real advisory data; `29` = 2026–2027 active/empty) |
| `AIMS_BASE_URL` | `http://100.92.245.14:5000/api/v1` |
| `ATLAS_SYSTEM_TOKEN` | Long-lived ATLAS SYSTEM_ADMIN JWT |

> **EnrollPro API v2 notes (updated May 2026):**
> - Auth: `POST /auth/login` with `{accountName, password}` — **no longer accepts `email`**
> - Faculty teachers log in with their `employeeId` as `accountName`
> - `/integration/v1/*` endpoints are **removed** — replaced by `/teachers`, `/sections`, `/students`
> - Sections are returned grouped under `{gradeLevels: [{gradeLevelId, gradeLevelName, sections: [...]}]}`
> - Advisory teacher per section is `section.advisingTeacher: {id, name}` — match via `/teachers` to get `employeeId`
> - Students: `GET /students?sectionId=:id&schoolYearId=:sy` → `{students: [...], pagination: {...}}`

### Manual test - Check if all team servers are running:
```powershell
# Test all teams at once (port 3000)
$teams = @(
    @{name="dev-jegs"; ip="100.120.169.123"},
    @{name="njgrm"; ip="100.88.55.125"},
    @{name="tfrog"; ip="100.92.245.14"}
)

foreach($team in $teams) {
    Write-Host "`nTesting $($team.name)..."
    try {
        $response = Invoke-WebRequest -Uri "http://$($team.ip):3000" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        Write-Host "✅ $($team.name) is ONLINE!" -ForegroundColor Green
    } catch {
        Write-Host "❌ $($team.name) is OFFLINE" -ForegroundColor Red
    }
}
```

### Test a specific team's API endpoint:
```powershell
# Once servers are running, test their actual endpoints
# Example: Test dev-jegs enrollment endpoint
Invoke-WebRequest -Uri "http://100.120.169.123:3000/api/enrollments" -UseBasicParsing | Select-Object -Expand Content

# Or get formatted JSON
$response = Invoke-WebRequest -Uri "http://100.120.169.123:3000/api/enrollments" -UseBasicParsing
$response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
```

### Test YOUR API (so others can test calling you):
```powershell
# Make sure your server is running first
# cd server
# npm run dev

# Then from another PowerShell window:
Invoke-WebRequest -Uri "http://100.93.66.120:3000/api/grades/student/123456789012" -UseBasicParsing

# Or test from browser:
# http://100.93.66.120:3000/api/grades/student/123456789012
```

---

## 📝 Integration Checklist

### ✅ Done:
- [x] Set up Tailscale connection
- [x] Found team member IPs
- [x] Identified team systems:
  - dev-jegs = Enrollment System
  - njgrm = Scheduling System
  - tfrog = Learning Management System
- [x] Created API documentation
- [x] Confirmed all teams using port 3000

### 🔄 In Progress (BLOCKED - Waiting for teams to start servers):
- [ ] **CRITICAL:** dev-jegs to start their server (you need BOTH students AND enrollments from them!)
- [ ] **WAITING:** njgrm to start their server (for sections data)
- [ ] **WAITING:** tfrog to start their server
- [x] ✅ Confirmed dev-jegs has student/learner master data!

### ⏳ To Do (Once servers are up):
- [ ] Run the test PowerShell script to check all servers
- [ ] Test calling dev-jegs: GET /api/learners (or /api/students)
- [ ] Test calling dev-jegs: GET /api/enrollments
- [ ] Test calling njgrm: GET /api/sections
- [ ] Get sample JSON responses from each system
- [ ] Build integration code to fetch students from dev-jegs
- [ ] Build integration code to fetch enrollments from dev-jegs
- [ ] Build integration code to fetch sections from njgrm
- [ ] Set up scheduled sync jobs (every 10-30 minutes)
- [ ] Let other teams test calling your grade APIs
- [ ] Document the final working endpoints

---

## 💡 Simple Example Code

### Calling dev-jegs API (fetch students AND enrollments):

**Fetch Students:**
```typescript
// In your code (server/src/services)
import axios from 'axios';

async function fetchStudentsFromDevJegs() {
  try {
    const response = await axios.get('http://100.120.169.123:3000/api/learners');
    const students = response.data;
    
    // Save to your database
    for (const student of students) {
      await prisma.student.upsert({
        where: { lrn: student.lrn },
        update: {
          firstName: student.firstName,
          middleName: student.middleName,
          lastName: student.lastName,
          suffix: student.suffix,
          birthDate: student.birthDate ? new Date(student.birthDate) : null,
          gender: student.gender,
          address: student.address,
          guardianName: student.guardianName,
          guardianContact: student.guardianContact
        },
        create: {
          lrn: student.lrn,
          firstName: student.firstName,
          middleName: student.middleName,
          lastName: student.lastName,
          suffix: student.suffix,
          birthDate: student.birthDate ? new Date(student.birthDate) : null,
          gender: student.gender,
          address: student.address,
          guardianName: student.guardianName,
          guardianContact: student.guardianContact
        }
      });
    }
    
    console.log(`✅ Synced ${students.length} students from dev-jegs`);
  } catch (error) {
    console.error('❌ Failed to fetch students:', error.message);
  }
}
```

**Fetch Enrollments:**
```typescript
async function fetchEnrollmentsFromDevJegs(schoolYear: string) {
  try {
    const response = await axios.get(
      `http://100.120.169.123:3000/api/enrollments`,
      { params: { schoolYear } }
    );
    const enrollments = response.data;
    
    // Save to your database
    for (const enrollment of enrollments) {
      await prisma.enrollment.upsert({
        where: {
          studentId_sectionId_schoolYear: {
            studentId: enrollment.studentId,
            sectionId: enrollment.sectionId,
            schoolYear: schoolYear
          }
        },
        update: {
          status: enrollment.status
        },
        create: {
          studentId: enrollment.studentId,
          sectionId: enrollment.sectionId,
          schoolYear: schoolYear,
          status: enrollment.status
        }
      });
    }
    
    console.log(`✅ Synced ${enrollments.length} enrollments`);
  } catch (error) {
    console.error('❌ Failed to fetch enrollments:', error.message);
  }
}

// Sync both from dev-jegs
async function syncFromDevJegs() {
  await fetchStudentsFromDevJegs();
  await fetchEnrollmentsFromDevJegs('2025-2026');
}

syncFromDevJegs();
```

---

## 🎯 Summary

**Your System:** Grading & Academic Records (100.93.66.120:3000)

**You provide (others call you):**
- ✅ GET /api/grades/student/:lrn - Student grades by LRN
- ✅ GET /api/grades/section/:sectionId?quarter=Q1 - Section grades
- ✅ GET /api/class-records/:classAssignmentId - Class records

**You need (you call others) - All on port 3000:**
- 🎯 **Student/Learner data** → FROM dev-jegs (100.120.169.123:3000) ⚠️ OFFLINE - **CONFIRMED!**
- 🎯 **Enrollments** → FROM dev-jegs (100.120.169.123:3000) ⚠️ OFFLINE - **CONFIRMED!**
- 🎯 **Sections** → FROM njgrm (100.88.55.125:3000) ⚠️ OFFLINE (likely)

**Immediate next steps:**
1. ✉️ Post the Discord message above asking everyone to start servers
2. ⏰ **PRIORITY:** Wait for dev-jegs to come online (you need their student + enrollment data!)
3. 🧪 Run the PowerShell test script to check connectivity
4. 📝 Get dev-jegs' exact endpoint names (/api/learners? /api/students? /api/enrollments?)
5. 📝 Get njgrm's sections endpoint
6. 🔗 Once confirmed, build the integration code to sync from dev-jegs

---

## EnrollPro Branding Sync

### POST /api/admin/settings/sync-enrollpro

**Auth:** Admin JWT required (Authorization: Bearer <token>)

**Purpose:** Fetches school branding (name, logo, colors) from EnrollPro's public settings and saves them to SMART's local database. Also downloads the logo file locally.

**Request Body:** None (empty POST)

**Response (200 OK):**
```json
{
  "message": "Settings synced from EnrollPro",
  "settings": {
    "id": 1,
    "schoolName": "Hinigaran National High School",
    "logoUrl": "/uploads/logo-enrollpro-sync.png",
    "primaryColor": "#4b0000",
    "secondaryColor": "#8a2020",
    "accentColor": "#c13030",
    "currentSchoolYear": "2026-2027",
    "contactEmail": "302651@deped.gov.ph",
    "lastEnrollProSync": "2026-05-15T10:30:00.000Z"
  }
}
```

**Notes:**
- Colors are extracted from EnrollPro's colorScheme.palette (filters luminance 30�210, picks top 3 as primary/secondary/accent)
- Logo is downloaded from https://dev-jegs.buru-degree.ts.net + EnrollPro's logoUrl and saved as uploads/logo-enrollpro-sync.png
- A SMART audit log entry is created on each sync
- An SSE broadcast (settings_updated) is sent to all connected clients
- lastEnrollProSync records when the last sync occurred
