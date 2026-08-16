import axios from "axios";

const API_URL = "/api";

// Export server URL for constructing upload URLs
export const SERVER_URL = "";

// Create axios instance with cookie-based auth
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Send cookies cross-origin
});

// Track refresh state to avoid multiple simultaneous refresh calls
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

// Handle 401 responses — attempt refresh before redirecting to login
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Skip refresh for login/refresh endpoints to avoid loops
    const skipRefreshPaths = ["/auth/login", "/auth/refresh"];
    const isSkipPath = skipRefreshPaths.some((path) => originalRequest.url?.includes(path));

    if (error.response?.status === 401 && !originalRequest._retry && !isSkipPath) {
      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => api(originalRequest));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Refresh token is in httpOnly cookie, sent automatically
        await api.post("/auth/refresh");
        processQueue(null, "refreshed");
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        // Redirect to login on failed refresh
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// Types
export interface User {
  id: string;
  username: string;
  role: "TEACHER" | "ADMIN" | "REGISTRAR";
  firstName?: string;
  lastName?: string;
}

export interface Teacher {
  id: string;
  userId: string;
  employeeId: string;
  specialization?: string;
  user: {
    firstName: string;
    lastName: string;
  };
}

export interface Student {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  type: string;
  writtenWorkWeight: number;
  perfTaskWeight: number;
  quarterlyAssessWeight: number;
  // Atlas rotation metadata — null = non-rotating subject
  rotationTermGroupId?: string | null;
  rotationTermRank?: number | null;
  rotationOutputLabel?: string | null;
}

export interface Section {
  id: string;
  name: string;
  gradeLevel: string;
  schoolYear: string;
  adviser?: string;
  enrollProId?: number | null;
  enrollments?: {
    student: Student;
  }[];
  _count?: {
    enrollments: number;
  };
}

export interface ClassAssignment {
  id: string;
  teacherId: string;
  subjectId: string;
  sectionId: string;
  schoolYear: string;
  teachingMinutes?: number | null;
  isActive?: boolean;
  archivedAt?: string | null;
  archivedReason?: string | null;
  subject: Subject;
  section: Section;
  effectiveWeights?: {
    ww: number;
    pt: number;
    qa: number;
    source: "subject" | "generic-fallback";
    hasExactEcrTemplate: boolean;
  };
  // ECR sync tracking
  ecrLastSyncedAt?: string | null;
  ecrFileName?: string | null;
}

export interface ScoreItem {
  name: string;
  score: number;
  maxScore: number;
  description?: string;
  date?: string;
}

export interface Grade {
  id: string;
  studentId: string;
  classAssignmentId: string;
  term: "T1" | "T2" | "T3";
  writtenWorkScores: ScoreItem[] | null;
  perfTaskScores: ScoreItem[] | null;
  quarterlyAssessScore: number | null;
  quarterlyAssessMax: number | null;
  qaDescription?: string | null;
  qaDate?: string | null;
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  quarterlyAssessPS: number | null;
  initialGrade: number | null;
  quarterlyGrade: number | null;
  qualitativeDescriptor?: string | null;
  remarks?: string;
}

export interface ClassRecord {
  student: Student;
  grades: Grade[];
}

export interface GradeDeadlineInfo {
  termEndDate: string | null;
  daysRemaining: number | null;
  urgencyLevel: 'none' | 'warn' | 'urgent' | 'critical' | 'overdue';
  currentTerm: string;
  hasIncompleteClasses: boolean;
  incompleteCount: number;
  incompleteClasses: { subjectName: string; sectionName: string; gradedCount: number; totalStudents: number }[];
}

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: User; message: string }>("/auth/login", {
      email,
      password,
    }),
  me: () => api.get<User>("/auth/me"),
  logout: () => api.post("/auth/logout"),
  refresh: () => api.post<{ token: string }>("/auth/refresh"),
};

// Grades API
export const gradesApi = {
  getDashboard: () =>
    api.get<{
      teacher: Teacher & { name: string };
      stats: {
        totalClasses: number;
        totalStudents: number;
        subjects: string[];
        archivedClassesCount?: number;
      };
      classAssignments: ClassAssignment[];
      archivedClassesCount?: number;
      currentTerm: string;
      gradeDeadline?: GradeDeadlineInfo | null;
    }>("/grades/dashboard"),

  getDashboardStats: () =>
    api.get<{
      classStats: {
        id: string;
        subjectName: string;
        sectionName: string;
        gradeLevel: string;
        totalStudents: number;
        gradedCount: number;
        avgGrade: number | null;
        passingRate: number;
        studentsAtRisk: { id: string; name: string; grade: number; class: string }[];
        honorsStudents: { id: string; name: string; grade: number; honor: string }[];
        withHonorsStudents: { id: string; name: string; grade: number; honor: string }[];
      }[];
      summary: {
        totalClasses: number;
        totalStudents: number;
        totalGraded: number;
        gradeSubmissionRate: number;
        overallPassingRate: number;
        studentsAtRisk: { id: string; name: string; grade: number; class: string }[];
        studentsAtRiskCount: number;
      };
      archivedClassesCount?: number;
      gradeDeadline?: GradeDeadlineInfo | null;
    }>("/grades/dashboard-stats"),

  getMyClasses: () => api.get<ClassAssignment[]>("/grades/my-classes"),

  getClassRecord: (classAssignmentId: string, term?: string) =>
    api.get<{
      classAssignment: ClassAssignment;
      classRecord: ClassRecord[];
      currentTerm?: "T1" | "T2" | "T3";
      effectiveWeights?: {
        ww: number;
        pt: number;
        qa: number;
        source: "subject" | "generic-fallback";
        hasExactEcrTemplate: boolean;
      };
    }>(`/grades/class-record/${classAssignmentId}`, {
      params: term ? { term } : {},
    }),

  saveGrade: (data: {
    studentId: string;
    classAssignmentId: string;
    term: string;
    writtenWorkScores?: ScoreItem[];
    perfTaskScores?: ScoreItem[];
    quarterlyAssessScore?: number;
    quarterlyAssessMax?: number;
    qaDescription?: string;
    qaDate?: string;
    qualitativeDescriptor?: string;
  }) => api.post<Grade>("/grades/grade", data),

  deleteGrade: (gradeId: string) => api.delete(`/grades/grade/${gradeId}`),

  clearScores: (classAssignmentId: string, term: string) =>
    api.post<{ message: string; count: number }>("/grades/clear-scores", {
      classAssignmentId,
      term,
    }),

  getMasteryDistribution: (gradeLevel?: string, sectionId?: string) =>
    api.get<{
      distribution: {
        outstanding: number;
        verySatisfactory: number;
        satisfactory: number;
        fairlySatisfactory: number;
        didNotMeet: number;
      };
      totalStudents: number;
      filters: {
        gradeLevels: string[];
        sections: { id: string; name: string; gradeLevel: string }[];
      };
    }>("/grades/mastery-distribution", {
      params: { gradeLevel, sectionId },
    }),

  getAdvisoryHonors: (term?: string) =>
    api.get<{
      advisoryHonors: { id: string; name: string; grade: number; honor: string; class: string }[];
      withHonors: { id: string; name: string; grade: number; honor: string; class: string }[];
      hasAdvisory: boolean;
    }>("/grades/advisory-honors", { params: { term } }),

  // ECR (E-Class Record) Import
  getEcrStatus: (classAssignmentId: string) =>
    api.get<{
      hasSynced: boolean;
      ecrLastSyncedAt: string | null;
      ecrFileName: string | null;
    }>(`/grades/ecr/status/${classAssignmentId}`),

  previewEcr: (classAssignmentId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('classAssignmentId', classAssignmentId);
    return api.post<{
      fileName: string;
      metadata: {
        gradeSection?: string;
        teacher?: string;
        subject?: string;
      };
      quarters: {
        term: string;
        maxScores: {
          writtenWork: number[];
          perfTask: number[];
          quarterlyAssess: number;
        };
        students: {
          name: string;
          writtenWorkScores: number[];
          writtenWorkTotal: number;
          writtenWorkPS: number;
          perfTaskScores: number[];
          perfTaskTotal: number;
          perfTaskPS: number;
          quarterlyAssessScore: number;
          quarterlyAssessPS: number;
          initialGrade: number;
          quarterlyGrade: number;
          matchedStudentId: string | null;
          matchedStudent: Student | null;
        }[];
      }[];
      stats: {
        totalStudents: number;
        matchedStudents: number;
        unmatchedStudents: number;
      };
      classAssignment: {
        id: string;
        subject: string;
        section: string;
        ecrLastSyncedAt: string | null;
        ecrFileName: string | null;
      };
    }>("/grades/ecr/preview", formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  importEcr: (classAssignmentId: string, file: File, selectedTerms?: string[]) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('classAssignmentId', classAssignmentId);
    if (selectedTerms) {
      formData.append('selectedQuarters', JSON.stringify(selectedTerms));
    }
    return api.post<{
      success: boolean;
      importedGrades: number;
      skippedStudents: number;
      quartersImported: string[];
      ecrLastSyncedAt: string;
      ecrFileName: string;
    }>("/grades/ecr/import", formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  deleteClassAssignment: (id: string) =>
    api.delete<{ message: string }>(`/grades/class-assignment/${id}`),

  deleteAllArchivedClassAssignments: () =>
    api.delete<{ message: string; count: number }>("/grades/class-assignments/archived/all"),

  getDeadlineStatus: () =>
    api.get<{ gradeDeadline: GradeDeadlineInfo | null }>("/grades/deadline-status"),
};

// Advisory API
export interface AdvisoryStudent {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  guardianName?: string;
  guardianContact?: string;
  rank?: number;
}

export interface AdvisorySubject {
  id: string;
  code: string;
  name: string;
  type: string;
  teacher: string;
}

export interface AdvisoryData {
  hasAdvisory: boolean;
  message?: string;
  teacher: {
    id: string;
    name: string;
    employeeId: string;
  };
  section?: {
    id: string;
    name: string;
    gradeLevel: string;
    schoolYear: string;
  };
  students?: AdvisoryStudent[];
  stats?: {
    totalStudents: number;
    maleCount: number;
    femaleCount: number;
  };
  subjects?: AdvisorySubject[];
}

export interface QuarterGrade {
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  quarterlyAssessPS: number | null;
  initialGrade: number | null;
  quarterlyGrade: number | null;
  qualitativeDescriptor?: string | null;
}

export interface SubjectGrade {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectType: string;
  teacher: string;
  grades: {
    T1: QuarterGrade | null;
    T2: QuarterGrade | null;
    T3: QuarterGrade | null;
  };
  finalGrade: number | null;
  remarks: string | null;
}

export interface StudentGradeProfile {
  student: {
    id: string;
    lrn: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    suffix?: string;
    gender?: string;
    birthDate?: string;
    address?: string;
    guardianName?: string;
    guardianContact?: string;
  };
  enrollment: {
    sectionName: string;
    gradeLevel: string;
    schoolYear: string;
    status: string;
  };
  subjectGrades: SubjectGrade[];
  summary: {
    generalAverage: number | null;
    honors: string | null;
    promotionStatus: string | null;
    totalSubjects: number;
    completedSubjects: number;
  };
}

export interface AdvisorySummary {
  hasAdvisory: boolean;
  section?: {
    id: string;
    name: string;
    gradeLevel: string;
    schoolYear: string;
  };
  rankings?: {
    studentId: string;
    name: string;
    lrn: string;
    gender?: string;
    average: number | null;
    gradedSubjects: number;
    totalSubjects: number;
    rank: number | null;
    honors: string | null;
  }[];
  stats?: {
    totalStudents: number;
    gradedStudents: number;
    withHonors: number;
    passingRate: number;
  };
}

export const advisoryApi = {
  getMyAdvisory: () => api.get<AdvisoryData>("/advisory/my-advisory"),
  syncFromEnrollPro: () => api.post("/advisory/sync"),


  getStudentGrades: (studentId: string, schoolYear?: string) =>
    api.get<StudentGradeProfile>(`/advisory/student/${studentId}/grades`, {
      params: schoolYear ? { schoolYear } : {},
    }),

  getAdvisorySummary: () => api.get<AdvisorySummary>("/advisory/summary"),
};

// Registrar API Types
export interface RegistrarDashboard {
  currentSchoolYear: string;
  stats: {
    totalStudents: number;
    totalStudentsSource: "enrollpro-realtime" | "smart-db-fallback";
    localTotalStudents: number;
    totalSections: number;
    maleCount: number;
    femaleCount: number;
    gradeStats: {
      GRADE_7: number;
      GRADE_8: number;
      GRADE_9: number;
      GRADE_10: number;
    };
  };
  sections: {
    id: string;
    name: string;
    gradeLevel: string;
    studentCount: number;
    adviser: string | null;
  }[];
  sync: {
    running: boolean;
    lastSyncedAt: string | null;
    minutesSinceLastSync: number | null;
    isStale: boolean;
    status: "fresh" | "stale" | "never";
  };
  dataCompleteness: {
    missingBirthDate: number;
    missingLrn: number;
    totalIssues: number;
  };
}

export interface SchoolYear {
  id: string;
  year: string;
  isCurrent: boolean;
}

export interface RegistrarStudent {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  guardianName?: string;
  guardianContact?: string;
  gradeLevel: string;
  sectionId: string;
  sectionName: string;
  schoolYear: string;
  status: string;
  adviser?: string | null;
}

export interface RegistrarSyncStatus {
  running: boolean;
  lastSyncedAt: string | null;
  minutesSinceLastSync: number | null;
  isStale: boolean;
  status: "fresh" | "stale" | "never";
  cycleCount?: number;
}

export interface SF8Data {
  section: {
    id: string;
    name: string;
    gradeLevel: string;
    schoolYear: string;
    adviser?: string;
  };
  students: {
    id: string;
    lrn: string;
    name: string;
    gender: string;
    birthDate?: string;
    subjectGrades: {
      subjectCode: string;
      subjectName: string;
      T1?: number;
      T2?: number;
      T3?: number;
      final?: number;
      remarks?: string;
    }[];
    generalAverage?: number;
    honors?: string;
    promotionStatus?: string;
  }[];
}

export interface SF9Data {
  student: {
    id: string;
    lrn: string;
    name: string;
    gender: string;
    birthDate?: string;
    address?: string;
    section: string;
    gradeLevel: string;
    schoolYear: string;
    adviser?: string;
  };
  subjectGrades: {
    subjectCode: string;
    subjectName: string;
    teacher?: string;
    T1?: number;
    T2?: number;
    T3?: number;
    final?: number;
    remarks?: string;
  }[];
  attendance: {
    T1?: { present: number; absent: number; tardy: number };
    T2?: { present: number; absent: number; tardy: number };
    T3?: { present: number; absent: number; tardy: number };
  };
  values: {
    mpiDescription: string;
    T1?: string;
    T2?: string;
    T3?: string;
  }[];
  generalAverage?: number;
  honors?: string;
  promotionStatus?: string;
}

export interface SF10Data {
  student: {
    id: string;
    lrn: string;
    name: string;
    gender: string;
    birthDate?: string;
    address?: string;
    guardianName?: string;
    guardianContact?: string;
  };
  schoolRecords: {
    schoolYear: string;
    gradeLevel: string;
    section: string;
    school?: string;
    subjectGrades: {
      subjectCode: string;
      subjectName: string;
      T1?: number;
      T2?: number;
      T3?: number;
      final?: number;
      remarks?: string;
    }[];
    generalAverage?: number;
    honors?: string;
    promotionStatus?: string;
  }[];
}

export const registrarApi = {
  getDashboard: () => api.get<RegistrarDashboard>("/registrar/dashboard"),

  getSyncStatus: () => api.get<RegistrarSyncStatus>("/registrar/sync/status"),

  runSync: () => api.post<{ message: string }>("/registrar/sync/run", {}),

  getSchoolYears: () => api.get<{ schoolYears: string[] }>("/registrar/school-years"),

  getStudents: (params?: { schoolYear?: string; gradeLevel?: string; sectionId?: string; search?: string }) =>
    api.get<{
      students: RegistrarStudent[];
      sections: Section[];
      stats: {
        total: number;
        byGrade: Record<string, number>;
        byGender: { male: number; female: number };
        dataCompleteness: { missingBirthDate: number; missingLrn: number; totalIssues: number };
      };
      schoolYear: string;
      source?: "smart-db-fallback";
    }>("/registrar/students", { params }),

  getStudent: (studentId: string) =>
    api.get<{ student: RegistrarStudent }>(`/registrar/student/${studentId}`),

  getSF8: (sectionId: string, schoolYear: string) =>
    api.get<SF8Data>("/registrar/forms/sf8", { params: { sectionId, schoolYear } }),

  getSF9: (studentId: string, schoolYear: string) =>
    api.get<SF9Data>(`/registrar/forms/sf9/${studentId}`, { params: { schoolYear } }),

  getSF10: (studentId: string) =>
    api.get<SF10Data>(`/registrar/forms/sf10/${studentId}`),

  getSF5: (sectionId: string, schoolYear?: string) =>
    api.get(`/registrar/forms/sf5/${sectionId}`, { params: { schoolYear } }),

  getSF1: (sectionId: string, schoolYear?: string) =>
    api.get(`/registrar/forms/sf1/${sectionId}`, { params: { schoolYear } }),

  getAttendanceSummary: (sectionId: string, startDate?: string, endDate?: string) =>
    api.get(`/attendance/summary/${sectionId}`, { params: { startDate, endDate } }),

  getSections: (params?: { schoolYear?: string; gradeLevel?: string }) =>
    api.get<Section[]>("/registrar/sections", { params }),

  // Applications (Phase 1)
  getApplications: (params?: { status?: string; gradeLevel?: string; page?: number; limit?: number; search?: string }) =>
    api.get("/registrar/applications", { params }),

  // BOSY (Phase 1)
  getBosyQueue: (params?: { page?: number; limit?: number; search?: string; gradeLevel?: string }) =>
    api.get("/registrar/bosy/queue", { params }),

  getBosyExpectedQueue: (params?: { priorSchoolYearId?: number; page?: number; limit?: number; search?: string; gradeLevel?: string }) =>
    api.get("/registrar/bosy/expected-queue", { params }),

  // Remedial (Phase 1)
  getRemedialPending: (params?: { page?: number; limit?: number; search?: string; gradeLevel?: string }) =>
    api.get("/registrar/remedial/pending", { params }),

  // Section Roster (Phase 1)
  getSectionRoster: (sectionId: number) =>
    api.get(`/registrar/section-roster/${sectionId}`),

  // EOSY (Phase 2)
  getEosySchoolYears: () =>
    api.get("/registrar/eosy/school-years"),

  getEosySections: (schoolYearId?: number) =>
    api.get("/registrar/eosy/sections", { params: schoolYearId ? { schoolYearId } : {} }),

  getEosySectionRecords: (sectionId: number) =>
    api.get(`/registrar/eosy/sections/${sectionId}/records`),

  getEosySF5: (sectionId: number) =>
    api.get(`/registrar/eosy/sections/${sectionId}/sf5`),

  getEosySF6: (schoolYearId?: number) =>
    api.get("/registrar/eosy/sf6", { params: schoolYearId ? { schoolYearId } : {} }),

  // ATLAS (Phase 3)
  getAtlasTeachingLoads: (atlasSchoolYearId?: number) =>
    api.get("/registrar/atlas/teaching-loads", {
      params: atlasSchoolYearId ? { atlasSchoolYearId } : {},
    }),

  getAtlasSubjectCoverage: () =>
    api.get("/registrar/atlas/subject-coverage"),
};

// ============================================
// ADMIN API
// ============================================

export interface AdminDashboardStats {
  totalUsers: number;
  totalTeachers: number;
  totalStudents: number;
  studentCountSchoolYear?: string | null;
  totalAdmins: number;
  totalRegistrars: number;
  activeUsers: number;
  todayLogins: number;
}

export interface AdminAuditLog {
  id: string;
  action: "create" | "update" | "delete" | "login" | "logout" | "config";
  user: string;
  userRole: string;
  target: string;
  targetType: string;
  details: string;
  ipAddress?: string;
  severity: "info" | "warning" | "critical";
  timestamp: string;
  date: string;
  createdAt?: string;
}

export interface AdminDashboard {
  stats: AdminDashboardStats;
  recentLogs: AdminAuditLog[];
  systemStatus: {
    database: string;
    lastBackup: string;
    uptime: string;
  };
  settings?: {
    schoolName: string;
    currentSchoolYear: string;
    currentTerm: string;
  };
}

export interface AdminUser {
  id: string;
  username: string;
  role: "TEACHER" | "ADMIN" | "REGISTRAR";
  firstName?: string;
  lastName?: string;
  email?: string;
  status: string;
  lastActive: string;
  createdAt: string;
  teacher?: {
    employeeId: string;
    specialization?: string;
  };
}

export interface AuditLogResponse {
  logs: AdminAuditLog[];
  total: number;
  counts: {
    total: number;
    creates: number;
    updates: number;
    deletes: number;
    logins: number;
    critical: number;
  };
}

export interface SystemSettings {
  id: string;
  schoolName: string;
  schoolId: string;
  division: string;
  region: string;
  address?: string;
  contactNumber?: string;
  email?: string;
  currentSchoolYear: string;
  currentTerm: string;
  // Academic calendar dates
  t1StartDate?: string;
  t1EndDate?: string;
  t2StartDate?: string;
  t2EndDate?: string;
  t3StartDate?: string;
  t3EndDate?: string;
  autoAdvanceTerm?: boolean;
  // Theming
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  sessionTimeout: number;
  maxLoginAttempts: number;
  passwordMinLength: number;
  requireSpecialChar: boolean;
  lastEnrollProSync?: string;
}

export interface GradingConfig {
  id: string;
  subjectType: string;
  writtenWorkWeight: number;
  performanceTaskWeight: number;
  quarterlyAssessWeight: number;
  isDepEdDefault: boolean;
}

export interface ExternalServiceHealth {
  name: string;
  url: string;
  online: boolean;
  httpStatus: number | null;
  latencyMs: number;
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  error?: string;
}

export interface SyncHistoryItem {
  id: string;
  source: string;
  status: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  error?: string | null;
  createdAt: string;
}

export interface AdminSystemHealth {
  status: "HEALTHY" | "DEGRADED";
  timestamp: string;
  responseTimeMs: number;
  local: {
    uptimeSeconds: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    database: {
      online: boolean;
      latencyMs: number;
      error?: string;
    };
  };
  external: {
    enrollpro: ExternalServiceHealth;
    atlas: ExternalServiceHealth;
    aims: ExternalServiceHealth;
  };
  sync: {
    coordinator: {
      running: boolean;
      cycleCount: number;
      lastSyncAt: string | null;
      config: {
        intervalMinutes: number;
        brandingEveryNCycles: number;
        circuitBreakerFailureThreshold: number;
        circuitBreakerCooldownMs: number;
      };
    };
    circuitBreaker: {
      open: boolean;
      openedAt: string | null;
      reason: string | null;
      consecutiveCriticalFailures: number;
      failureThreshold: number;
      cooldownMs: number;
    };
    recentHistory: SyncHistoryItem[];
  };
}

export const adminApi = {
  // Dashboard
  getDashboard: () => api.get<AdminDashboard>("/admin/dashboard"),

  // User Management
  getUsers: (params?: { search?: string; role?: string; status?: string }) =>
    api.get<{ users: AdminUser[] }>("/admin/users", { params }),

  createUser: (data: {
    username: string;
    password: string;
    role: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    employeeId?: string;
    specialization?: string;
  }) => api.post<{ message: string; user: AdminUser }>("/admin/users", data),

  updateUser: (
    id: string,
    data: {
      username?: string;
      password?: string;
      role?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      employeeId?: string;
      specialization?: string;
    }
  ) => api.put<{ message: string; user: AdminUser }>(`/admin/users/${id}`, data),

  deleteUser: (id: string) => api.delete<{ message: string }>(`/admin/users/${id}`),

  // Audit Logs
  getLogs: (params?: { action?: string; severity?: string; search?: string; limit?: number; offset?: number }) =>
    api.get<AuditLogResponse>("/admin/logs", { params }),

  exportLogs: () => api.get("/admin/logs/export", { responseType: "blob" }),

  // System Settings
  getSettings: () => api.get<{ settings: SystemSettings }>("/admin/settings"),

  updateSettings: (data: Partial<SystemSettings>) =>
    api.put<{ message: string; settings: SystemSettings }>("/admin/settings", data),

  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append("logo", file);
    return api.post<{ message: string; logoUrl: string }>("/admin/settings/logo", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  updateColors: (colors: { primaryColor: string; secondaryColor: string; accentColor: string }) =>
    api.put<{ message: string; colors: { primaryColor: string; secondaryColor: string; accentColor: string } }>(
      "/admin/settings/colors",
      colors
    ),

  syncFromEnrollPro: () =>
    api.post<{ message: string; settings: SystemSettings }>("/admin/settings/sync-enrollpro", {}),

  // System Health & Diagnostics
  getSystemHealth: () => api.get<AdminSystemHealth>("/admin/system/health"),

  getSyncHistory: (limit = 25) =>
    api.get<{ history: SyncHistoryItem[]; count: number }>("/admin/system/sync-history", { params: { limit } }),

  runSystemSync: () =>
    api.post<{ message: string; result: any }>("/admin/system/sync/run", {}),

  // Grading Config
  getGradingConfig: () => api.get<{ configs: GradingConfig[] }>("/admin/grading-config"),

  updateGradingConfig: (
    subjectType: string,
    data: { writtenWorkWeight: number; performanceTaskWeight: number; quarterlyAssessWeight: number }
  ) => api.put<{ message: string; config: GradingConfig }>(`/admin/grading-config/${subjectType}`, data),

  resetGradingConfig: () => api.post<{ message: string; configs: GradingConfig[] }>("/admin/grading-config/reset"),

  // Class Assignments (Teaching Load)
  getClassAssignmentOptions: (schoolYear?: string) =>
    api.get<{ teachers: any[]; subjects: any[]; sections: any[] }>("/admin/class-assignments/options", {
      params: schoolYear ? { schoolYear } : {},
    }),

  getClassAssignments: (schoolYear?: string) =>
    api.get<{
      assignments: any[];
      workloadSummary?: Array<{
        teacherId: string;
        teacherName: string;
        sectionId: string;
        sectionName: string;
        gradeLevel: string;
        hgMinutes: number;
        advisoryRoleMinutes: number;
        otherSubjectMinutes: number;
        totalMinutes: number;
      }>;
    }>("/admin/class-assignments", {
      params: schoolYear ? { schoolYear } : {},
    }),

  createClassAssignment: (data: { teacherId: string; subjectId: string; sectionId: string; schoolYear: string }) =>
    api.post<{ message: string; assignment: any }>("/admin/class-assignments", data),

  deleteClassAssignment: (id: string) =>
    api.delete<{ message: string }>(`/admin/class-assignments/${id}`),
};

export default api;
