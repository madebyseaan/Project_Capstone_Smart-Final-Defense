#!/usr/bin/env python3
"""
SMART System – ERD Word Document Generator (v2 – Updated from real schema.prisma)
Generates a professional ERD .docx with:
  1. Cover page with system title
  2. Visual ERD diagram (matplotlib) split into logical groups
  3. Entity field detail tables (all models from schema.prisma)
  4. Relationships summary table
  5. Enumeration types table
"""

import sys, os, subprocess, math, textwrap

def ensure(pkg, import_name=None):
    name = import_name or pkg.replace("-", "_")
    try:
        __import__(name)
    except ImportError:
        print(f"  Installing {pkg}...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

print("Checking dependencies...")
ensure("matplotlib")
ensure("python-docx", "docx")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch

from docx import Document
from docx.shared import Inches, Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "SMART_ERD.docx")

# Color palette
C_USER   = "#1e4a8c"
C_TEACHER= "#0f5e6e"
C_STUD   = "#1a5c8a"
C_SEC    = "#1a6b3a"
C_SUB    = "#6b2d8b"
C_JUN    = "#7a5100"
C_AUDIT  = "#8b1a1a"
C_ATLAS  = "#3d6b45"
C_CONFIG = "#5c3d1e"

ALL_ENTITIES = {
    "User": {
        "color": C_USER, "group": "Auth & Users",
        "fields": [
            ("PK", "id",                 "String (cuid)"),
            ("",   "username",            "String UNIQUE"),
            ("",   "password",            "String"),
            ("",   "role",                "Role"),
            ("",   "status",              "UserStatus"),
            ("",   "enrollproSubject",    "String? UNIQUE"),
            ("",   "firstName",           "String?"),
            ("",   "lastName",            "String?"),
            ("",   "email",               "String?"),
            ("",   "suspendedAt",         "DateTime?"),
            ("",   "deactivatedAt",       "DateTime?"),
            ("",   "createdAt",           "DateTime"),
            ("",   "updatedAt",           "DateTime"),
        ],
    },
    "Teacher": {
        "color": C_TEACHER, "group": "Auth & Users",
        "fields": [
            ("PK", "id",             "String (cuid)"),
            ("FK", "userId",         "-> User"),
            ("",   "employeeId",     "String UNIQUE"),
            ("",   "specialization", "String?"),
            ("",   "createdAt",      "DateTime"),
            ("",   "updatedAt",      "DateTime"),
        ],
    },
    "RefreshToken": {
        "color": C_USER, "group": "Auth & Users",
        "fields": [
            ("PK", "id",        "String (uuid)"),
            ("",   "token",     "String UNIQUE"),
            ("FK", "userId",    "-> User"),
            ("",   "familyId",  "String"),
            ("",   "expiresAt", "DateTime"),
            ("",   "revokedAt", "DateTime?"),
            ("",   "createdAt", "DateTime"),
        ],
    },
    "CompanionSsoCode": {
        "color": C_USER, "group": "Auth & Users",
        "fields": [
            ("PK", "id",          "String (cuid)"),
            ("",   "codeHash",    "String UNIQUE"),
            ("FK", "userId",      "-> User"),
            ("",   "audience",    "String"),
            ("",   "redirectUri", "String"),
            ("",   "expiresAt",   "DateTime"),
            ("",   "consumedAt",  "DateTime?"),
            ("",   "createdAt",   "DateTime"),
        ],
    },
    "Student": {
        "color": C_STUD, "group": "Students",
        "fields": [
            ("PK", "id",              "String (cuid)"),
            ("",   "lrn",             "String UNIQUE"),
            ("",   "enrollproId",     "Int? UNIQUE"),
            ("",   "firstName",       "String"),
            ("",   "middleName",      "String?"),
            ("",   "lastName",        "String"),
            ("",   "suffix",          "String?"),
            ("",   "birthDate",       "DateTime?"),
            ("",   "gender",          "String?"),
            ("",   "address",         "String?"),
            ("",   "guardianName",    "String?"),
            ("",   "guardianContact", "String?"),
            ("",   "religion",        "String?"),
            ("",   "motherTongue",    "String?"),
            ("",   "ipCommunity",     "Boolean?"),
            ("",   "is4PsBeneficiary","Boolean?"),
            ("",   "disability",      "String?"),
            ("",   "isBalikAral",     "Boolean?"),
            ("",   "previousSchool",  "String?"),
            ("",   "transferCertNo",  "String?"),
            ("",   "hasPsa",          "Boolean?"),
            ("",   "createdAt",       "DateTime"),
            ("",   "updatedAt",       "DateTime"),
        ],
    },
    "ExternalSchoolRecord": {
        "color": C_STUD, "group": "Students",
        "fields": [
            ("PK", "id",              "String (cuid)"),
            ("FK", "studentId",       "-> Student"),
            ("",   "schoolYear",      "String"),
            ("",   "gradeLevel",      "GradeLevel"),
            ("",   "schoolName",      "String"),
            ("",   "generalAverage",  "Float?"),
            ("",   "promotionStatus", "String?"),
            ("",   "formType",        "String"),
            ("",   "source",          "ExternalRecordSource"),
            ("",   "locked",          "Boolean"),
            ("",   "createdAt",       "DateTime"),
            ("",   "updatedAt",       "DateTime"),
        ],
    },
    "ExternalSubjectRecord": {
        "color": C_STUD, "group": "Students",
        "fields": [
            ("PK", "id",              "String (cuid)"),
            ("FK", "recordId",        "-> ExternalSchoolRecord"),
            ("",   "subjectCode",     "String?"),
            ("",   "subjectName",     "String"),
            ("",   "terms",           "Json?"),
            ("",   "finalRating",     "Float?"),
            ("",   "remarks",         "String?"),
            ("",   "isNonPromotional","Boolean"),
        ],
    },
    "Section": {
        "color": C_SEC, "group": "Academic Structure",
        "fields": [
            ("PK", "id",         "String (cuid)"),
            ("",   "name",       "String"),
            ("",   "gradeLevel", "GradeLevel"),
            ("",   "schoolYear", "String"),
            ("FK", "adviserId",  "-> Teacher?"),
            ("",   "program",    "String (REGULAR/SPA/SPS/STE)"),
            ("",   "status",     "String (ACTIVE/ARCHIVED)"),
            ("",   "archivedAt", "DateTime?"),
            ("",   "createdAt",  "DateTime"),
            ("",   "updatedAt",  "DateTime"),
        ],
    },
    "Subject": {
        "color": C_SUB, "group": "Academic Structure",
        "fields": [
            ("PK", "id",                   "String (cuid)"),
            ("",   "code",                 "String UNIQUE"),
            ("",   "name",                 "String"),
            ("",   "displayName",          "String?"),
            ("",   "description",          "String?"),
            ("",   "type",                 "SubjectType"),
            ("",   "writtenWorkWeight",    "Int?"),
            ("",   "perfTaskWeight",       "Int?"),
            ("",   "quarterlyAssessWeight","Int?"),
            ("",   "isNonPromotional",     "Boolean"),
            ("",   "rotationTermGroupId",  "String?"),
            ("",   "rotationTermRank",     "Int?"),
            ("",   "createdAt",            "DateTime"),
            ("",   "updatedAt",            "DateTime"),
        ],
    },
    "Enrollment": {
        "color": C_STUD, "group": "Academic Structure",
        "fields": [
            ("PK", "id",                  "String (cuid)"),
            ("FK", "studentId",           "-> Student"),
            ("FK", "sectionId",           "-> Section"),
            ("",   "schoolYear",          "String"),
            ("",   "status",              "EnrollmentStatus"),
            ("",   "isArchived",          "Boolean"),
            ("",   "dropOutDate",         "DateTime?"),
            ("",   "transferOutDate",     "DateTime?"),
            ("",   "transferInDate",      "DateTime?"),
            ("",   "promotionStatus",     "PromotionStatus?"),
            ("",   "promotedToGradeLevel","GradeLevel?"),
            ("",   "sf9EligibilityStatus","Sf9EligibilityStatus?"),
            ("",   "createdAt",           "DateTime"),
            ("",   "updatedAt",           "DateTime"),
        ],
    },
    "ClassAssignment": {
        "color": C_JUN, "group": "Teaching",
        "fields": [
            ("PK", "id",                 "String (cuid)"),
            ("FK", "teacherId",          "-> Teacher"),
            ("FK", "subjectId",          "-> Subject"),
            ("FK", "sectionId",          "-> Section"),
            ("",   "schoolYear",         "String"),
            ("",   "isActive",           "Boolean"),
            ("",   "source",             "String (SYNC|MANUAL)"),
            ("",   "aimsCourseId",       "String?"),
            ("",   "successorTeacherId", "String?"),
            ("",   "archivedAt",         "DateTime?"),
            ("",   "createdAt",          "DateTime"),
            ("",   "updatedAt",          "DateTime"),
        ],
    },
    "ScheduleEntry": {
        "color": C_TEACHER, "group": "Teaching",
        "fields": [
            ("PK", "id",         "String (cuid)"),
            ("FK", "teacherId",  "-> Teacher"),
            ("FK", "subjectId",  "-> Subject"),
            ("FK", "sectionId",  "-> Section"),
            ("",   "schoolYear", "String"),
            ("",   "termIndex",  "Int?"),
            ("",   "day",        "String"),
            ("",   "startTime",  "String"),
            ("",   "endTime",    "String"),
            ("",   "roomId",     "Int?"),
            ("",   "createdAt",  "DateTime"),
            ("",   "updatedAt",  "DateTime"),
        ],
    },
    "WorkloadEntry": {
        "color": C_TEACHER, "group": "Teaching",
        "fields": [
            ("PK", "id",                "String (cuid)"),
            ("FK", "teacherId",         "-> Teacher"),
            ("FK", "sectionId",         "-> Section?"),
            ("FK", "classAssignmentId", "-> ClassAssignment?"),
            ("",   "schoolYear",        "String"),
            ("",   "type",              "WorkloadType"),
            ("",   "minutes",           "Int"),
            ("",   "createdAt",         "DateTime"),
            ("",   "updatedAt",         "DateTime"),
        ],
    },
    "Grade": {
        "color": C_SUB, "group": "Grades",
        "fields": [
            ("PK", "id",                   "String (cuid)"),
            ("FK", "studentId",            "-> Student"),
            ("FK", "classAssignmentId",    "-> ClassAssignment"),
            ("",   "term",                 "Term"),
            ("",   "writtenWorkScores",    "Json?"),
            ("",   "perfTaskScores",       "Json?"),
            ("",   "examScores",           "Json?"),
            ("",   "quarterlyAssessScore", "Float?"),
            ("",   "writtenWorkPS",        "Float?"),
            ("",   "perfTaskPS",           "Float?"),
            ("",   "initialGrade",         "Float?"),
            ("",   "quarterlyGrade",       "Float?"),
            ("",   "remarks",              "String?"),
            ("",   "status",               "GradeStatus"),
            ("FK", "finalizedBy",          "-> User?"),
            ("",   "finalizedAt",          "DateTime?"),
            ("",   "createdAt",            "DateTime"),
            ("",   "updatedAt",            "DateTime"),
        ],
    },
    "GradeSnapshot": {
        "color": C_SUB, "group": "Grades",
        "fields": [
            ("PK", "id",                "String (cuid)"),
            ("",   "gradeId",           "String?"),
            ("FK", "studentId",         "-> Student (denorm)"),
            ("FK", "classAssignmentId", "-> ClassAssignment (denorm)"),
            ("",   "teacherId",         "String (denorm)"),
            ("",   "subjectCode",       "String"),
            ("",   "sectionId",         "String (denorm)"),
            ("",   "schoolYear",        "String"),
            ("",   "term",              "Term"),
            ("",   "snapshot",          "Json"),
            ("",   "createdAt",         "DateTime"),
        ],
    },
    "AimsScore": {
        "color": C_SUB, "group": "Grades",
        "fields": [
            ("PK", "id",                "String (cuid)"),
            ("FK", "classAssignmentId", "-> ClassAssignment"),
            ("FK", "studentId",         "-> Student"),
            ("",   "term",              "Term"),
            ("",   "assessmentId",      "String"),
            ("",   "type",              "String (QUIZ|TASK)"),
            ("",   "category",          "String (WW|PT)"),
            ("",   "score",             "Float"),
            ("",   "pointsEarned",      "Float"),
            ("",   "maxPoints",         "Float"),
            ("",   "isRemedial",        "Boolean"),
            ("",   "gradedAt",          "DateTime?"),
            ("",   "syncedAt",          "DateTime"),
        ],
    },
    "EcrSync": {
        "color": C_JUN, "group": "Grades",
        "fields": [
            ("PK", "id",                "String (cuid)"),
            ("FK", "classAssignmentId", "-> ClassAssignment"),
            ("",   "term",              "Term"),
            ("",   "lastSyncedAt",      "DateTime"),
            ("",   "createdAt",         "DateTime"),
            ("",   "updatedAt",         "DateTime"),
        ],
    },
    "GradeEditRequest": {
        "color": C_SUB, "group": "Grades",
        "fields": [
            ("PK", "id",                  "String (cuid)"),
            ("FK", "teacherId",           "-> User"),
            ("",   "teacherName",         "String"),
            ("",   "term",                "String"),
            ("",   "schoolYear",          "String"),
            ("",   "section",             "String?"),
            ("",   "subject",             "String?"),
            ("",   "classAssignmentId",   "String?"),
            ("",   "reason",              "String"),
            ("",   "status",              "EditRequestStatus"),
            ("FK", "approvedById",        "-> User?"),
            ("",   "expiresAt",           "DateTime?"),
            ("",   "createdAt",           "DateTime"),
            ("",   "updatedAt",           "DateTime"),
        ],
    },
    "Attendance": {
        "color": C_SEC, "group": "Attendance",
        "fields": [
            ("PK", "id",         "String (cuid)"),
            ("FK", "studentId",  "-> Student"),
            ("FK", "sectionId",  "-> Section"),
            ("",   "date",       "DateTime (Date only)"),
            ("",   "status",     "AttendanceStatus"),
            ("",   "remarks",    "String?"),
            ("",   "recordedBy", "String?"),
            ("",   "createdAt",  "DateTime"),
            ("",   "updatedAt",  "DateTime"),
        ],
    },
    "RemedialClass": {
        "color": C_STUD, "group": "Remedial",
        "fields": [
            ("PK", "id",              "String (cuid)"),
            ("FK", "enrollmentId",    "-> Enrollment"),
            ("",   "schoolYear",      "String"),
            ("",   "gradeLevel",      "GradeLevel"),
            ("",   "subjectCode",     "String"),
            ("",   "subjectName",     "String"),
            ("",   "originalGrade",   "Float"),
            ("",   "remedialMark",    "Float?"),
            ("",   "recomputedGrade", "Float?"),
            ("",   "outcome",         "String?"),
            ("",   "status",          "String (PENDING/PASSED/FAILED)"),
            ("",   "createdAt",       "DateTime"),
            ("",   "updatedAt",       "DateTime"),
        ],
    },
    "SchoolYear": {
        "color": C_AUDIT, "group": "System & Config",
        "fields": [
            ("PK", "id",          "String (cuid)"),
            ("",   "label",       "String UNIQUE"),
            ("",   "externalId",  "Int? UNIQUE"),
            ("",   "status",      "String (DRAFT/ACTIVE/ARCHIVED)"),
            ("",   "termLabelT1", "String"),
            ("",   "termLabelT2", "String"),
            ("",   "termLabelT3", "String"),
            ("",   "startDate",   "DateTime?"),
            ("",   "endDate",     "DateTime?"),
            ("",   "createdAt",   "DateTime"),
            ("",   "updatedAt",   "DateTime"),
        ],
    },
    "YearGradeLock": {
        "color": C_AUDIT, "group": "System & Config",
        "fields": [
            ("PK", "id",           "String (cuid)"),
            ("FK", "schoolYearId", "-> SchoolYear"),
            ("",   "isLocked",     "Boolean"),
            ("",   "lockedBy",     "String?"),
            ("",   "lockedAt",     "DateTime?"),
            ("",   "createdAt",    "DateTime"),
            ("",   "updatedAt",    "DateTime"),
        ],
    },
    "TermGradeLock": {
        "color": C_AUDIT, "group": "System & Config",
        "fields": [
            ("PK", "id",           "String (cuid)"),
            ("FK", "schoolYearId", "-> SchoolYear"),
            ("",   "term",         "Term"),
            ("",   "isLocked",     "Boolean"),
            ("",   "lockedBy",     "String?"),
            ("",   "lockedAt",     "DateTime?"),
            ("",   "createdAt",    "DateTime"),
            ("",   "updatedAt",    "DateTime"),
        ],
    },
    "SystemSettings": {
        "color": C_AUDIT, "group": "System & Config",
        "fields": [
            ("PK", "id",                "String (default: 'main')"),
            ("",   "schoolName",        "String"),
            ("",   "schoolId",          "String"),
            ("",   "division",          "String"),
            ("",   "region",            "String"),
            ("FK", "schoolYearId",      "-> SchoolYear?"),
            ("",   "currentTerm",       "Term"),
            ("",   "gradeLock",         "Boolean"),
            ("",   "transitionLock",    "Boolean"),
            ("",   "enrollproUrl",      "String?"),
            ("",   "t1StartDate",       "DateTime?"),
            ("",   "t1EndDate",         "DateTime?"),
            ("",   "t2StartDate",       "DateTime?"),
            ("",   "t2EndDate",         "DateTime?"),
            ("",   "t3StartDate",       "DateTime?"),
            ("",   "t3EndDate",         "DateTime?"),
            ("",   "createdAt",         "DateTime"),
            ("",   "updatedAt",         "DateTime"),
        ],
    },
    "GradingConfig": {
        "color": C_CONFIG, "group": "System & Config",
        "fields": [
            ("PK", "id",                    "String (cuid)"),
            ("",   "subjectType",           "SubjectType UNIQUE"),
            ("",   "writtenWorkWeight",     "Int"),
            ("",   "performanceTaskWeight", "Int"),
            ("",   "quarterlyAssessWeight", "Int"),
            ("",   "isDepEdDefault",        "Boolean"),
            ("",   "createdAt",             "DateTime"),
            ("",   "updatedAt",             "DateTime"),
        ],
    },
    "TransmutationEntry": {
        "color": C_CONFIG, "group": "System & Config",
        "fields": [
            ("PK", "id",              "String (cuid)"),
            ("",   "minGrade",        "Float"),
            ("",   "maxGrade",        "Float"),
            ("",   "transmutedGrade", "Int"),
            ("",   "isDefault",       "Boolean"),
            ("",   "createdAt",       "DateTime"),
            ("",   "updatedAt",       "DateTime"),
        ],
    },
    "ExcelTemplate": {
        "color": C_CONFIG, "group": "System & Config",
        "fields": [
            ("PK", "id",             "String (cuid)"),
            ("",   "formType",       "FormType UNIQUE"),
            ("",   "formName",       "String"),
            ("",   "description",    "String?"),
            ("",   "filePath",       "String"),
            ("",   "fileName",       "String"),
            ("",   "fileSize",       "Int"),
            ("",   "placeholders",   "Json?"),
            ("",   "isActive",       "Boolean"),
            ("FK", "uploadedBy",     "-> User"),
            ("",   "uploadedByName", "String"),
            ("",   "sheetName",      "String?"),
            ("",   "createdAt",      "DateTime"),
            ("",   "updatedAt",      "DateTime"),
        ],
    },
    "AtlasCrosswalk": {
        "color": C_ATLAS, "group": "Atlas Integration",
        "fields": [
            ("PK", "id",         "String (cuid)"),
            ("",   "kind",       "String (ROOM/SECTION/SUBJECT/FACULTY)"),
            ("",   "atlasId",    "Int"),
            ("",   "schoolYear", "String"),
            ("",   "label",      "String"),
            ("",   "detail",     "String?"),
            ("",   "smartId",    "String?"),
            ("",   "createdAt",  "DateTime"),
            ("",   "updatedAt",  "DateTime"),
        ],
    },
    "AtlasScheduleMeta": {
        "color": C_ATLAS, "group": "Atlas Integration",
        "fields": [
            ("PK", "id",              "Int (autoincrement)"),
            ("",   "schoolYear",      "String UNIQUE"),
            ("",   "source",          "Json?"),
            ("",   "terms",           "Json?"),
            ("",   "specialEvents",   "Json?"),
            ("",   "timeSlots",       "Json?"),
            ("",   "activeTermIndex", "Int?"),
            ("",   "conflict",        "String?"),
            ("",   "syncedAt",        "DateTime"),
            ("",   "createdAt",       "DateTime"),
            ("",   "updatedAt",       "DateTime"),
        ],
    },
    "AuditLog": {
        "color": C_AUDIT, "group": "Audit & Sync",
        "fields": [
            ("PK", "id",            "String (cuid)"),
            ("",   "action",        "AuditAction"),
            ("FK", "userId",        "-> User?"),
            ("",   "userName",      "String"),
            ("",   "userRole",      "String"),
            ("",   "target",        "String"),
            ("",   "targetType",    "String"),
            ("",   "targetId",      "String?"),
            ("",   "details",       "String"),
            ("",   "ipAddress",     "String?"),
            ("",   "severity",      "AuditSeverity"),
            ("",   "userAgent",     "String?"),
            ("",   "browser",       "String?"),
            ("",   "outcome",       "String?"),
            ("",   "createdAt",     "DateTime"),
        ],
    },
    "SyncHistory": {
        "color": C_AUDIT, "group": "Audit & Sync",
        "fields": [
            ("PK", "id",          "String (cuid)"),
            ("",   "source",      "String"),
            ("",   "status",      "String"),
            ("",   "durationMs",  "Int"),
            ("",   "startedAt",   "DateTime"),
            ("",   "completedAt", "DateTime"),
            ("",   "enrollpro",   "Json?"),
            ("",   "atlas",       "Json?"),
            ("",   "branding",    "Boolean"),
            ("",   "error",       "String?"),
            ("",   "metadata",    "Json?"),
            ("",   "createdAt",   "DateTime"),
        ],
    },
}

RELATIONSHIPS = [
    ("Teacher",              "userId",           "User",               "1:1",  "A Teacher has one User account"),
    ("RefreshToken",         "userId",           "User",               "N:1",  "Many refresh tokens per user"),
    ("CompanionSsoCode",     "userId",           "User",               "N:1",  "Many SSO codes per user"),
    ("Section",              "adviserId",        "Teacher",            "N:1",  "Section has one adviser (Teacher)"),
    ("ClassAssignment",      "teacherId",        "Teacher",            "N:1",  "Teacher has many class assignments"),
    ("ClassAssignment",      "subjectId",        "Subject",            "N:1",  "Subject has many class assignments"),
    ("ClassAssignment",      "sectionId",        "Section",            "N:1",  "Section has many class assignments"),
    ("Enrollment",           "studentId",        "Student",            "N:1",  "Student has many enrollments"),
    ("Enrollment",           "sectionId",        "Section",            "N:1",  "Section has many enrollments"),
    ("Grade",                "studentId",        "Student",            "N:1",  "Student has many grades"),
    ("Grade",                "classAssignmentId","ClassAssignment",    "N:1",  "ClassAssignment has many grades"),
    ("Grade",                "finalizedBy",      "User",               "N:1",  "User finalizes many grades"),
    ("Attendance",           "studentId",        "Student",            "N:1",  "Student has many attendance records"),
    ("Attendance",           "sectionId",        "Section",            "N:1",  "Section has many attendance records"),
    ("AuditLog",             "userId",           "User",               "N:1",  "User generates many audit logs"),
    ("ExcelTemplate",        "uploadedBy",       "User",               "N:1",  "User uploads many excel templates"),
    ("ScheduleEntry",        "teacherId",        "Teacher",            "N:1",  "Teacher has many schedule entries"),
    ("ScheduleEntry",        "subjectId",        "Subject",            "N:1",  "Subject has many schedule entries"),
    ("ScheduleEntry",        "sectionId",        "Section",            "N:1",  "Section has many schedule entries"),
    ("WorkloadEntry",        "teacherId",        "Teacher",            "N:1",  "Teacher has many workload entries"),
    ("WorkloadEntry",        "sectionId",        "Section",            "N:1",  "Section has many workload entries"),
    ("WorkloadEntry",        "classAssignmentId","ClassAssignment",    "N:1",  "ClassAssignment has many workload entries"),
    ("AimsScore",            "classAssignmentId","ClassAssignment",    "N:1",  "ClassAssignment has many AIMS scores"),
    ("AimsScore",            "studentId",        "Student",            "N:1",  "Student has many AIMS scores"),
    ("EcrSync",              "classAssignmentId","ClassAssignment",    "N:1",  "ClassAssignment has many ECR syncs"),
    ("RemedialClass",        "enrollmentId",     "Enrollment",         "N:1",  "Enrollment has many remedial classes"),
    ("ExternalSchoolRecord", "studentId",        "Student",            "N:1",  "Student has many external records"),
    ("ExternalSubjectRecord","recordId",         "ExternalSchoolRecord","N:1", "External record has many subject records"),
    ("GradeSnapshot",        "classAssignmentId","ClassAssignment",    "N:1",  "ClassAssignment has many grade snapshots"),
    ("YearGradeLock",        "schoolYearId",     "SchoolYear",         "1:1",  "SchoolYear has one year grade lock"),
    ("TermGradeLock",        "schoolYearId",     "SchoolYear",         "N:1",  "SchoolYear has many term grade locks"),
    ("SystemSettings",       "schoolYearId",     "SchoolYear",         "N:1",  "SchoolYear referenced in system settings"),
    ("GradeEditRequest",     "teacherId",        "User",               "N:1",  "Teacher (User) makes many edit requests"),
    ("GradeEditRequest",     "approvedById",     "User",               "N:1",  "Admin (User) approves many edit requests"),
]

ENUMS = {
    "Role":                 ["TEACHER", "ADMIN", "REGISTRAR"],
    "UserStatus":           ["ACTIVE", "SUSPENDED", "DEACTIVATED"],
    "GradeStatus":          ["DRAFT", "FINALIZED", "LOCKED"],
    "Term":                 ["T1", "T2", "T3"],
    "GradeLevel":           ["GRADE_7", "GRADE_8", "GRADE_9", "GRADE_10"],
    "SubjectType":          ["CORE", "MAPEH", "TLE", "MATH_SCIENCE"],
    "WorkloadType":         ["ADVISORY_ROLE"],
    "AttendanceStatus":     ["PRESENT", "ABSENT", "LATE", "EXCUSED"],
    "EnrollmentStatus":     ["ENROLLED", "PENDING", "DROPPED", "TRANSFERRED"],
    "PromotionStatus":      ["PROMOTED", "CONDITIONALLY_PROMOTED", "RETAINED", "JHS_COMPLETER"],
    "Sf9EligibilityStatus": ["PROMOTED", "CONDITIONALLY_PROMOTED", "RETAINED"],
    "AuditAction":          ["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "CONFIG"],
    "AuditSeverity":        ["INFO", "WARNING", "CRITICAL"],
    "FormType":             ["SF1", "SF2", "SF3", "SF4", "SF5", "SF6", "SF7", "SF8", "SF9", "SF10"],
    "EditRequestStatus":    ["PENDING", "APPROVED", "REJECTED", "EXPIRED"],
    "ExternalRecordSource": ["MANUAL", "SF10_SCAN", "SF9_SCAN", "SF10_XLSX"],
}

GROUP_ORDER = [
    "Auth & Users",
    "Students",
    "Academic Structure",
    "Teaching",
    "Grades",
    "Attendance",
    "Remedial",
    "System & Config",
    "Atlas Integration",
    "Audit & Sync",
]


def draw_entity_box(ax, x, y, name, fields, color, box_w=2.8, row_h=0.22):
    header_h = 0.35
    n_fields  = len(fields)
    body_h    = n_fields * row_h
    total_h   = header_h + body_h + 0.1

    ax.add_patch(FancyBboxPatch((x+0.04, y-total_h-0.04), box_w, total_h,
        boxstyle="round,pad=0.04", linewidth=0, facecolor="#00000033", zorder=1))
    ax.add_patch(FancyBboxPatch((x, y-total_h), box_w, total_h,
        boxstyle="round,pad=0.04", linewidth=1.2,
        edgecolor=color, facecolor="#1a1a2e", zorder=2))
    ax.add_patch(FancyBboxPatch((x, y-header_h), box_w, header_h,
        boxstyle="round,pad=0.04", linewidth=0,
        facecolor=color, zorder=3))

    ax.text(x + box_w/2, y - header_h/2, name,
        ha="center", va="center", fontsize=6.5, fontweight="bold",
        color="white", zorder=4)

    for i, (tag, fname, ftype) in enumerate(fields):
        fy = y - header_h - (i+0.5)*row_h - 0.05
        tag_color = "#ffd700" if tag == "PK" else "#87ceeb" if tag == "FK" else "#cccccc"
        if tag:
            ax.text(x+0.08, fy, tag, fontsize=4, color=tag_color, va="center", zorder=5, fontweight="bold")
        ax.text(x+0.34, fy, fname, fontsize=4.5, color="#e8e8e8", va="center", zorder=5)
        ax.text(x+box_w-0.06, fy, ftype, fontsize=3.8, color="#aaaaaa", va="center",
                ha="right", zorder=5, style="italic")

    return total_h


def generate_group_diagram(group_name, entities_in_group, img_path, cols=3):
    n = len(entities_in_group)
    if n == 0:
        return

    box_w = 2.9
    box_gap_x = 0.45
    box_gap_y = 0.5

    col_count = min(cols, n)
    rows = math.ceil(n / col_count)

    fig_w = col_count * (box_w + box_gap_x) + 0.6
    fig_h = rows * 5.5 + 1.2

    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    ax.set_facecolor("#0d0d1a")
    fig.patch.set_facecolor("#0d0d1a")
    ax.set_xlim(0, fig_w)
    ax.set_ylim(-fig_h + 0.5, 1.0)
    ax.axis("off")

    ax.text(fig_w/2, 0.75, group_name, ha="center", va="center",
            fontsize=10, fontweight="bold", color="white",
            bbox=dict(boxstyle="round,pad=0.35", facecolor="#2a2a4a", edgecolor="#6060cc"))

    for idx, (ename, edef) in enumerate(entities_in_group.items()):
        col = idx % col_count
        row = idx // col_count
        x = 0.3 + col * (box_w + box_gap_x)
        y = -0.3 - row * 5.2

        draw_entity_box(ax, x, y, ename, edef["fields"], edef["color"],
                        box_w=box_w, row_h=0.205)

    plt.tight_layout(pad=0.2)
    plt.savefig(img_path, dpi=150, bbox_inches="tight",
                facecolor="#0d0d1a", edgecolor="none")
    plt.close()
    print(f"    Saved: {img_path}")


def set_cell_bg(cell, hex_color):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color.lstrip("#"))
    tcPr.append(shd)


def add_table_header_row(table, headers, bg="1e3a5f"):
    row = table.rows[0]
    for i, hdr in enumerate(headers):
        if i >= len(row.cells):
            break
        cell = row.cells[i]
        cell.text = hdr
        set_cell_bg(cell, bg)
        for para in cell.paragraphs:
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in para.runs:
                run.bold = True
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                run.font.size = Pt(9)


def add_entity_table(doc, entity_name, fields):
    doc.add_paragraph()
    h = doc.add_paragraph()
    h.style = "Heading 3"
    if not h.runs:
        h.add_run(f"{entity_name}")
    else:
        h.runs[0].text = f"{entity_name}"

    tbl = doc.add_table(rows=1 + len(fields), cols=4)
    tbl.style = "Table Grid"

    add_table_header_row(tbl, ["Key", "Field Name", "Type / Constraint", "Notes"], bg="1e3a5f")

    for i, (tag, fname, ftype) in enumerate(fields):
        row = tbl.rows[i+1]
        row.cells[0].text = tag
        row.cells[1].text = fname
        row.cells[2].text = ftype
        row.cells[3].text = "Primary Key" if tag == "PK" else "Foreign Key" if tag == "FK" else ""

        row_bg = "f2f6fc" if i % 2 == 0 else "ffffff"
        for c in row.cells:
            set_cell_bg(c, row_bg)
            for para in c.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(8.5)

        tag_color_map = {"PK": RGBColor(0xB8, 0x86, 0x00), "FK": RGBColor(0x00, 0x5A, 0x9C)}
        if tag in tag_color_map:
            for run in row.cells[0].paragraphs[0].runs:
                run.font.color.rgb = tag_color_map[tag]
                run.bold = True


def add_relationships_table(doc):
    doc.add_paragraph()
    tbl = doc.add_table(rows=1 + len(RELATIONSHIPS), cols=5)
    tbl.style = "Table Grid"
    add_table_header_row(tbl, ["From Entity", "FK Field", "To Entity", "Cardinality", "Description"], bg="1a3d1a")

    for i, (frm, fld, to, card, desc) in enumerate(RELATIONSHIPS):
        row = tbl.rows[i+1]
        row.cells[0].text = frm
        row.cells[1].text = fld
        row.cells[2].text = to
        row.cells[3].text = card
        row.cells[4].text = desc
        row_bg = "f0f8f0" if i % 2 == 0 else "ffffff"
        for c in row.cells:
            set_cell_bg(c, row_bg)
            for para in c.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(8.5)


def add_enums_table(doc):
    doc.add_paragraph()
    rows_data = list(ENUMS.items())
    tbl = doc.add_table(rows=1 + len(rows_data), cols=2)
    tbl.style = "Table Grid"
    add_table_header_row(tbl, ["Enum Name", "Allowed Values"], bg="3d1a5c")

    for i, (name, vals) in enumerate(rows_data):
        row = tbl.rows[i+1]
        row.cells[0].text = name
        row.cells[1].text = ", ".join(vals)
        row_bg = "f8f2fc" if i % 2 == 0 else "ffffff"
        for c in row.cells:
            set_cell_bg(c, row_bg)
            for para in c.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(8.5)
        row.cells[0].paragraphs[0].runs[0].bold = True


def build_document():
    doc = Document()

    for section in doc.sections:
        section.page_width  = Cm(29.7)
        section.page_height = Cm(21.0)
        section.left_margin   = Cm(1.8)
        section.right_margin  = Cm(1.8)
        section.top_margin    = Cm(2.0)
        section.bottom_margin = Cm(2.0)

    # Cover page
    doc.add_paragraph()
    doc.add_paragraph()
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run("SMART School Management System")
    run.bold = True
    run.font.size = Pt(28)
    run.font.color.rgb = RGBColor(0x1e, 0x4a, 0x8c)

    doc.add_paragraph()
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run2 = sub.add_run("Entity Relationship Diagram (ERD)\nTechnical Documentation")
    run2.font.size = Pt(18)
    run2.font.color.rgb = RGBColor(0x44, 0x44, 0x88)

    doc.add_paragraph()
    doc.add_paragraph()
    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run3 = meta.add_run(
        "Database: PostgreSQL  |  ORM: Prisma\n"
        "Source: server/prisma/schema.prisma\n"
        "Total Entities: 29  |  Total Relationships: 34  |  Enumerations: 16\n"
        "Modules: 10 (Auth, Students, Academic, Teaching, Grades, Attendance,\n"
        "           Remedial, System Config, Atlas Integration, Audit & Sync)"
    )
    run3.font.size = Pt(11)
    run3.font.color.rgb = RGBColor(0x55, 0x55, 0x88)

    doc.add_page_break()

    # TOC
    h = doc.add_paragraph()
    h.style = "Heading 1"
    h.add_run("Table of Contents")
    toc_items = [
        "1. System Overview",
        "2. ERD Diagrams by Module",
        "3. Entity Field Definitions",
        "4. Relationships Summary",
        "5. Enumeration Types",
    ]
    for item in toc_items:
        p = doc.add_paragraph(item)
        p.runs[0].font.size = Pt(11)

    doc.add_page_break()

    # Section 1
    h1 = doc.add_paragraph()
    h1.style = "Heading 1"
    h1.add_run("1. System Overview")

    intro = doc.add_paragraph(
        "The SMART School Management System is a DepEd-aligned secondary education records platform "
        "built on PostgreSQL (via Prisma ORM). It handles student records, academic structure, "
        "grading, attendance, scheduling, and integration with companion systems (EnrollPro and Atlas)."
    )
    intro.runs[0].font.size = Pt(10)

    modules = [
        ("Auth & Users",        "Role-based user accounts (Admin, Teacher, Registrar) with refresh token rotation "
                                 "and reverse SSO to EnrollPro via CompanionSsoCode."),
        ("Students",            "Student master records with extended DepEd profile fields, "
                                 "transferee tracking, and prior-school academic records (ExternalSchoolRecord)."),
        ("Academic Structure",  "Sections, subjects, and enrollments. Tracks promotion, retention, "
                                 "and enrollment lifecycle (dropped, transferred, archived)."),
        ("Teaching",            "ClassAssignment links Teacher+Subject+Section per school year. "
                                 "ScheduleEntry stores Atlas-synced timetables. WorkloadEntry tracks advisory load."),
        ("Grades",              "Term-based (T1/T2/T3) grading with written work, performance tasks, QA. "
                                 "GradeSnapshot for history. AimsScore ingests AIMS quiz/task data. "
                                 "GradeEditRequest enables admin-controlled unlock workflow."),
        ("Attendance",          "Daily per-student-per-section attendance with PRESENT/ABSENT/LATE/EXCUSED statuses."),
        ("Remedial",            "RemedialClass records for EOSY remedial interventions per enrollment."),
        ("System & Config",     "SchoolYear management with YearGradeLock and TermGradeLock. "
                                 "SystemSettings (singleton). GradingConfig weights. TransmutationEntry table. "
                                 "ExcelTemplate for SF form uploads."),
        ("Atlas Integration",   "AtlasCrosswalk maps Atlas surrogate IDs to SMART entities. "
                                 "AtlasScheduleMeta caches published schedule provenance per school year."),
        ("Audit & Sync",        "AuditLog captures every user action with device/network metadata. "
                                 "SyncHistory records EnrollPro and Atlas sync runs."),
    ]

    for mod, desc in modules:
        p = doc.add_paragraph(style="List Bullet")
        rb = p.add_run(f"{mod}: ")
        rb.bold = True
        rb.font.size = Pt(10)
        rd = p.add_run(desc)
        rd.font.size = Pt(10)

    doc.add_page_break()

    # Section 2: Diagrams
    h2 = doc.add_paragraph()
    h2.style = "Heading 1"
    h2.add_run("2. ERD Diagrams by Module")

    tmp_dir = os.path.join(SCRIPT_DIR, "_erd_tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    for gi, group_name in enumerate(GROUP_ORDER):
        group_entities = {k: v for k, v in ALL_ENTITIES.items() if v.get("group") == group_name}
        if not group_entities:
            continue

        img_path = os.path.join(tmp_dir, f"erd_{gi:02d}_{group_name.replace(' & ', '_').replace(' ', '_')}.png")
        print(f"  Generating: {group_name} ({len(group_entities)} entities)...")
        cols = 4 if len(group_entities) >= 4 else len(group_entities)
        generate_group_diagram(group_name, group_entities, img_path, cols=cols)

        sub_h = doc.add_paragraph()
        sub_h.style = "Heading 2"
        sub_h.add_run(f"2.{gi+1} {group_name}")

        if os.path.exists(img_path):
            doc.add_picture(img_path, width=Inches(9.2))
            doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_paragraph()

    doc.add_page_break()

    # Section 3: Field Definitions
    h3 = doc.add_paragraph()
    h3.style = "Heading 1"
    h3.add_run("3. Entity Field Definitions")
    p_intro = doc.add_paragraph(
        "Every entity (database table) and its fields are listed below. "
        "PK = Primary Key, FK = Foreign Key. Field types follow Prisma schema conventions."
    )
    p_intro.runs[0].font.size = Pt(10)

    for group_name in GROUP_ORDER:
        group_entities = {k: v for k, v in ALL_ENTITIES.items() if v.get("group") == group_name}
        if not group_entities:
            continue
        gh = doc.add_paragraph()
        gh.style = "Heading 2"
        gh.add_run(group_name)
        for ename, edef in group_entities.items():
            add_entity_table(doc, ename, edef["fields"])

    doc.add_page_break()

    # Section 4: Relationships
    h4 = doc.add_paragraph()
    h4.style = "Heading 1"
    h4.add_run("4. Relationships Summary")
    p_rel = doc.add_paragraph(
        "This table summarizes all foreign key relationships in the SMART database schema. "
        "Cardinality: 1:1 = one-to-one, N:1 = many-to-one (many on the left, one on the right)."
    )
    p_rel.runs[0].font.size = Pt(10)
    add_relationships_table(doc)

    doc.add_page_break()

    # Section 5: Enums
    h5 = doc.add_paragraph()
    h5.style = "Heading 1"
    h5.add_run("5. Enumeration Types")
    p_enum = doc.add_paragraph(
        "Enumerations define the fixed set of allowed values for specific fields, "
        "enforced at the PostgreSQL database level through Prisma."
    )
    p_enum.runs[0].font.size = Pt(10)
    add_enums_table(doc)

    # Footer
    doc.add_paragraph()
    footer = doc.add_paragraph()
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fr = footer.add_run(
        "End of SMART ERD Technical Document\n"
        "Source: server/prisma/schema.prisma | PostgreSQL + Prisma ORM"
    )
    fr.font.size = Pt(8)
    fr.font.color.rgb = RGBColor(0x88, 0x88, 0xAA)
    fr.italic = True

    doc.save(OUTPUT_PATH)
    print(f"\nDocument saved: {OUTPUT_PATH}")

    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    print("=" * 60)
    print("  SMART ERD Document Generator v2")
    print("  Covers 29 entities from schema.prisma")
    print("=" * 60)
    build_document()
