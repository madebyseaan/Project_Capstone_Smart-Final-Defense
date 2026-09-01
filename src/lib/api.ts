import axios from "axios";

const API_URL = "/api";

// Export server URL for constructing upload URLs
export const SERVER_URL = "";

// ─── Multi-session helpers ────────────────────────────────────────
// Each portal (admin/teacher/registrar) gets its own storage keys
// so multiple users can be logged in simultaneously.
export type PortalRole = "admin" | "teacher" | "registrar";

export function getPortalRole(): PortalRole {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/registrar")) return "registrar";
  return "teacher";
}

export function getTokenKey(role?: PortalRole): string {
  return `token_${role || getPortalRole()}`;
}

export function getUserKey(role?: PortalRole): string {
  return `user_${role || getPortalRole()}`;
}

export function getPortalToken(): string | null {
  return sessionStorage.getItem(getTokenKey());
}

export function getRefreshTokenKey(role?: PortalRole): string {
  return `refreshToken_${role || getPortalRole()}`;
}

export function getPortalRefreshToken(): string | null {
  return sessionStorage.getItem(getRefreshTokenKey());
}

export function getPortalUser(): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(getUserKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Create axios instance with cookie-based auth
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Send cookies cross-origin
});

// Attach role-specific token as Authorization header (multi-session support)
api.interceptors.request.use((config) => {
  const token = getPortalToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

// CSRF: read x-csrf-token cookie and send as header on every request
api.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase();
  if (method && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = document.cookie
      .split("; ")
      .find((row) => row.startsWith("x-csrf-token="))
      ?.split("=")[1];
    if (csrfToken) {
      config.headers.set("x-csrf-token", csrfToken);
    }
  }
  return config;
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
        // Send role-specific refresh token via header
        const refreshToken = getPortalRefreshToken();
        const refreshResponse = await api.post("/auth/refresh", {}, {
          headers: refreshToken ? { "x-refresh-token": refreshToken } : undefined,
        });
        // Store new tokens per role
        if (refreshResponse.data?.token) {
          sessionStorage.setItem(getTokenKey(), refreshResponse.data.token);
        }
        if (refreshResponse.data?.refreshToken) {
          sessionStorage.setItem(getRefreshTokenKey(), refreshResponse.data.refreshToken);
        }
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

    // Retry once on 429 (rate limited)
    if (error.response?.status === 429 && !originalRequest._retry429) {
      originalRequest._retry429 = true;
      const retryAfter = parseInt(error.response.headers?.["retry-after"] ?? "2", 10) || 2;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return api(originalRequest);
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
  program?: string;
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
    source: "subject-override" | "subject-type" | "generic-fallback";
  };
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
        source: "subject-override" | "subject-type" | "generic-fallback";
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

  deleteClassAssignment: (id: string) =>
    api.delete<{ message: string }>(`/grades/class-assignment/${id}`),

  deleteAllArchivedClassAssignments: () =>
    api.delete<{ message: string; count: number }>("/grades/class-assignments/archived/all"),

  getDeadlineStatus: () =>
    api.get<{ gradeDeadline: GradeDeadlineInfo | null }>("/grades/deadline-status"),

  getTransmutationTable: () =>
    api.get<Array<{ id: string; minGrade: number; maxGrade: number; transmutedGrade: number }>>("/grades/transmutation-table"),

  // Edit request methods
  createEditRequest: (data: { term: string; reason: string; classAssignmentId?: string; gradeLevel?: string; section?: string; subject?: string }) =>
    api.post<{ message: string; request: any }>("/grades/edit-request", data),

  getMyEditRequests: () =>
    api.get<{ requests: any[] }>("/grades/edit-requests"),

  getAdminEditRequests: (status?: string) =>
    api.get<{ requests: any[] }>("/grades/admin/edit-requests", { params: status ? { status } : {} }),

  approveEditRequest: (id: string, hours?: number) =>
    api.post<{ message: string; request: any }>(`/grades/admin/edit-requests/${id}/approve`, { hours }),

  rejectEditRequest: (id: string, reason?: string) =>
    api.post<{ message: string; request: any }>(`/grades/admin/edit-requests/${id}/reject`, { reason }),

  revokeEditRequest: (id: string) =>
    api.post<{ message: string; request: any }>(`/grades/admin/edit-requests/${id}/revoke`),
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
  fatherName?: string;
  motherName?: string;
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
    religion?: string;
    motherTongue?: string;
    barangay?: string;
    city?: string;
    province?: string;
    fatherName?: string;
    fatherContact?: string;
    motherName?: string;
    motherContact?: string;
    ipCommunity?: boolean;
    is4PsBeneficiary?: boolean;
    disability?: string;
    isBalikAral?: boolean;
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
    activeStudents: number;
    droppedStudents: number;
    transferredStudents: number;
    pendingStudents: number;
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
  gradePerformance: {
    overallPassingRate: number;
    overallAvgGrade: number;
    totalGraded: number;
    totalPassing: number;
    totalFailing: number;
    failingStudents: Array<{
      studentName: string;
      sectionName: string;
      gradeLevel: string;
      average: number;
    }>;
    bySection: Array<{
      sectionId: string;
      sectionName: string;
      gradeLevel: string;
      avgGrade: number | null;
      passingRate: number;
      totalStudents: number;
      failingCount: number;
      failingStudents: Array<{ studentName: string; average: number }>;
    }>;
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
    firstName?: string;
    lastName?: string;
    middleName?: string;
    nameExtension?: string;
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
    schoolId?: string;
    district?: string;
    division?: string;
    region?: string;
    adviserName?: string;
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
    remedialClasses?: {
      learningAreas: string;
      finalRating: string;
      conductedFrom?: string;
      remedialClassMark?: string;
    }[];
  }[];
  schoolSettings?: {
    schoolName?: string;
    schoolId?: string;
    division?: string;
    region?: string;
  };
}

export interface SF5SubjectDetail {
  subjectCode: string;
  subjectName: string;
  finalGrade: number | null;
  termGrades: Record<string, number | null>;
}

export interface SF5Student {
  lrn: string;
  name: string;
  firstName: string;
  lastName: string;
  middleName: string;
  gender: string;
  subjectDetails: SF5SubjectDetail[];
  generalAverage: number | null;
  descriptor: "O" | "VS" | "S" | "FS" | "DNME" | null;
  promotionStatus: "Promoted" | "Conditional" | "Retained" | "No Grades";
  failingSubjects: string[];
  incompleteSubjects: { prevSY: string[]; currentSY: string[] };
  attendance: { present: number; absent: number; late: number; excused: number; total: number };
}

export interface SF5Data {
  section: {
    id: string;
    name: string;
    gradeLevel: string;
    program: string;
    schoolYear: string;
    adviser: string | null;
  };
  students: SF5Student[];
  summary: {
    totalStudents: number;
    promoted: number;
    conditional: number;
    retained: number;
    noGrades: number;
    male: { promoted: number; conditional: number; retained: number; noGrades: number };
    female: { promoted: number; conditional: number; retained: number; noGrades: number };
    descriptors: Record<"O" | "VS" | "S" | "FS" | "DNME", { male: number; female: number; total: number }>;
  };
  schoolSettings: {
    schoolName: string;
    schoolId: string;
    division: string;
    region: string;
    district: string;
  };
}

export interface SF1Student {
  index: number;
  lrn: string;
  lastName: string;
  firstName: string;
  middleName?: string;
  suffix?: string;
  birthDate?: string;
  ageAsOfJune?: number;
  gender: string;
  birthPlace?: string;
  motherTongue?: string;
  ipCommunity?: string;
  religion?: string;
  address: {
    houseStreet?: string;
    barangay?: string;
    municipality?: string;
    province?: string;
  };
  fatherName?: string;
  motherName?: string;
  guardianName?: string;
  guardianRelationship?: string;
  guardianContact?: string;
  remarks?: string[];
}

export interface SF1Data {
  section: {
    id: string;
    name: string;
    gradeLevel: string;
    schoolYear: string;
    adviserName?: string;
  };
  schoolSettings?: {
    schoolName?: string;
    schoolId?: string;
    division?: string;
    region?: string;
    district?: string;
  };
  students: SF1Student[];
  summary: {
    maleCount: number;
    femaleCount: number;
    totalCount: number;
  };
  source: string;
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

  getAlumni: (params?: { search?: string; gradeLevel?: string; status?: string; limit?: number; offset?: number }) =>
    api.get<{
      students: Array<{
        id: string;
        enrollmentId: string;
        lrn: string;
        firstName: string;
        middleName: string | null;
        lastName: string;
        suffix: string | null;
        gender: string | null;
        lastGradeLevel: string;
        lastSection: string;
        lastSchoolYear: string;
        lastProgram: string;
        enrollmentStatus: string;
      }>;
      total: number;
    }>("/registrar/alumni", { params }),

  updateEnrollmentStatus: (enrollmentId: string, status: string) =>
    api.put<{ enrollment: any }>(`/registrar/enrollment/${enrollmentId}/status`, { status }),

  getSF8: (sectionId: string, schoolYear: string) =>
    api.get<SF8Data>("/registrar/forms/sf8", { params: { sectionId, schoolYear } }),

  getSF9: (studentId: string, schoolYear: string) =>
    api.get<SF9Data>(`/registrar/forms/sf9/${studentId}`, { params: { schoolYear } }),

  getSF10: (studentId: string) =>
    api.get<SF10Data>(`/registrar/forms/sf10/${studentId}`),

  getSF5: (sectionId: string, schoolYear?: string) =>
    api.get<SF5Data>(`/registrar/forms/sf5/${sectionId}`, { params: { schoolYear } }),

  exportSF5: (sectionId: string, schoolYear?: string) =>
    api.get(`/registrar/export/sf5/${sectionId}`, {
      params: { schoolYear },
      responseType: "blob",
    }),

  getSF1Data: (sectionId: string, schoolYear: string) =>
    api.get(`/registrar/forms/sf1/${sectionId}`, { params: { schoolYear } }),

  exportSF1: (sectionId: string, schoolYear: string) =>
    api.get(`/registrar/export/sf1/${sectionId}`, { params: { schoolYear }, responseType: "blob" }),

  getSF6: (schoolYear?: string) =>
    api.get<{
      schoolYear: string;
      sections: Array<{
        sectionId: string;
        sectionName: string;
        gradeLevel: string;
        program: string;
        adviser: string | null;
        totalStudents: number;
        promoted: number;
        retained: number;
        dropped: number;
        transferred: number;
        promotionRate: number;
      }>;
      summary: {
        totalStudents: number;
        promoted: number;
        retained: number;
        dropped: number;
        transferred: number;
        overallPromotionRate: number;
      };
      byGradeLevel: Record<string, { total: number; promoted: number; retained: number; dropped: number; transferred: number }>;
    }>("/registrar/forms/sf6", { params: { schoolYear } }),

  getSF1: (sectionId: string, schoolYear?: string) =>
    api.get<SF1Data>(`/registrar/forms/sf1/${sectionId}`, { params: { schoolYear } }),

  getAttendanceSummary: (sectionId: string, startDate?: string, endDate?: string) =>
    api.get(`/attendance/summary/${sectionId}`, { params: { startDate, endDate } }),

  getSections: (params?: { schoolYear?: string; gradeLevel?: string }) =>
    api.get<Section[]>("/registrar/sections", { params }),

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

  getEosyPromotionStatus: (sectionId: string, schoolYear: string) =>
    api.get(`/registrar/eosy/promotion-status/${sectionId}`, { params: { schoolYear } }),

  finalizeEosySection: (sectionId: string, schoolYear: string) =>
    api.post("/registrar/eosy/finalize", { sectionId, schoolYear }),

  finalizeGrades: (sectionId: string, term: string, subjectId: string) =>
    api.post<{ message: string; finalizedCount: number; sectionId: string; term: string; subjectId: string }>(
      "/registrar/finalize-grades",
      { sectionId, term, subjectId },
    ),

  unfinalizeGrades: (sectionId: string, term: string, subjectId: string) =>
    api.post<{ message: string; unfinalizedCount: number }>(
      "/registrar/unfinalize-grades",
      { sectionId, term, subjectId },
    ),

  getEosyUnfinalizedSections: (schoolYear: string) =>
    api.get("/registrar/eosy/unfinalized-sections", { params: { schoolYear } }),

  exportYearBackup: (schoolYear: string) =>
    api.get("/registrar/export/year-backup", { params: { schoolYear }, responseType: "blob" }),

  triggerSync: () =>
    api.post<{ message: string }>("/registrar/sync-enrollpro"),

  syncInactiveStudents: () =>
    api.post<{ message: string; fetched: number; inactive: number; upserted: number }>("/registrar/sync-inactive-students"),

  // ATLAS (Phase 3)
  getAtlasTeachingLoads: (atlasSchoolYearId?: number) =>
    api.get("/registrar/atlas/teaching-loads", {
      params: atlasSchoolYearId ? { atlasSchoolYearId } : {},
    }),

  getAtlasSubjectCoverage: () =>
    api.get("/registrar/atlas/subject-coverage"),
};

// ============================================
// SCHEDULE API
// ============================================
export const scheduleApi = {
  getMySchedule: () => api.get("/integration/schedule"),
  refreshSchedule: () => api.post("/integration/schedule/refresh"),
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
  termLabels: TermLabels;
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
  gradeLock?: boolean;
  transitionLock?: boolean;
  transitionNote?: string;
  auditLogRetentionDays?: number;
  syncHistoryRetentionDays?: number;
  gradeSnapshotRetentionDays?: number;
}

export interface GradingConfig {
  id: string;
  subjectType: string;
  writtenWorkWeight: number;
  performanceTaskWeight: number;
  quarterlyAssessWeight: number;
  isDepEdDefault: boolean;
}

export interface TermLabels {
  T1: string;
  T2: string;
  T3: string;
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

  toggleGradeLock: (locked: boolean) =>
    api.post<{ message: string; gradeLock: boolean }>("/admin/settings/grade-lock", { locked }),

  toggleTransitionLock: (locked: boolean, note?: string) =>
    api.post<{ message: string; transitionLock: boolean }>("/admin/settings/transition-lock", { locked, note }),

  getYearLocks: () =>
    api.get<{
      locks: Array<{
        schoolYearId: string;
        label: string;
        status: string;
        yearLock: { isLocked: boolean; lockedBy: string | null; lockedAt: string | null; unlockedBy: string | null; unlockedAt: string | null };
        termLocks: Array<{ term: "T1" | "T2" | "T3"; isLocked: boolean; lockedBy: string | null; lockedAt: string | null; unlockedBy: string | null; unlockedAt: string | null }>;
      }>;
    }>("/admin/year-locks"),

  toggleYearLock: (schoolYearId: string, locked: boolean) =>
    api.post<{ message: string; schoolYearId: string; locked: boolean }>(`/admin/year-locks/${schoolYearId}`, { locked }),

  toggleTermLock: (schoolYearId: string, term: "T1" | "T2" | "T3", locked: boolean) =>
    api.post<{ message: string; schoolYearId: string; term: string; locked: boolean }>(`/admin/term-locks/${schoolYearId}/${term}`, { locked }),

  getRolloverStatus: () =>
    api.get<{
      currentSY: { id: string; label: string; status: string } | null;
      previousYear: { id: string; label: string; status: string } | null;
      unfinalizedCount: number;
      unfinalizedSections: Array<{ sectionId: string; sectionName: string; gradeLevel: string; draftBlockerCount: number }>;
      canArchive: boolean;
    }>("/admin/rollover-status"),

  archiveYear: (schoolYearId: string) =>
    api.post<{ message: string; schoolYearId: string }>("/admin/archive-year", { schoolYearId }),

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
  getGradingConfig: () => api.get<{ configs: GradingConfig[]; termLabels: TermLabels }>("/admin/grading-config"),

  updateGradingConfig: (
    subjectType: string,
    data: { writtenWorkWeight: number; performanceTaskWeight: number; quarterlyAssessWeight: number }
  ) => api.put<{ message: string; config: GradingConfig }>(`/admin/grading-config/${subjectType}`, data),

  resetGradingConfig: () => api.post<{ message: string; configs: GradingConfig[]; termLabels: TermLabels }>("/admin/grading-config/reset"),

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

  // ─── Transmutation Table ─────────────────────────────────────────────────
  getTransmutationTable: () =>
    api.get<Array<{ id: string; minGrade: number; maxGrade: number; transmutedGrade: number; isDefault: boolean }>>("/admin/transmutation-table"),

  updateTransmutationTable: (entries: Array<{ minGrade: number; maxGrade: number; transmutedGrade: number }>) =>
    api.put<Array<{ id: string; minGrade: number; maxGrade: number; transmutedGrade: number; isDefault: boolean }>>("/admin/transmutation-table", { entries }),

  addTransmutationRow: (entry: { minGrade: number; maxGrade: number; transmutedGrade: number }) =>
    api.post<{ id: string; minGrade: number; maxGrade: number; transmutedGrade: number; isDefault: boolean }>("/admin/transmutation-table/rows", entry),

  updateTransmutationRow: (id: string, entry: { minGrade: number; maxGrade: number; transmutedGrade: number }) =>
    api.put<{ id: string; minGrade: number; maxGrade: number; transmutedGrade: number }>(`/admin/transmutation-table/${id}`, entry),

  deleteTransmutationRow: (id: string) =>
    api.delete<{ message: string }>(`/admin/transmutation-table/${id}`),

  resetTransmutationTable: () =>
    api.post<Array<{ id: string; minGrade: number; maxGrade: number; transmutedGrade: number; isDefault: boolean }>>("/admin/transmutation-table/reset"),

  // ─── Per-Subject Weight Overrides ────────────────────────────────────────
  getSubjectWeights: () =>
    api.get<Array<{ id: string; code: string; name: string; type: string; writtenWorkWeight: number | null; perfTaskWeight: number | null; quarterlyAssessWeight: number | null; hasOverride: boolean }>>("/admin/subject-weights"),

  updateSubjectWeight: (subjectId: string, weights: { writtenWorkWeight: number; perfTaskWeight: number; quarterlyAssessWeight: number }) =>
    api.put<{ id: string }>(`/admin/subject-weights/${subjectId}`, weights),

  clearSubjectWeightOverride: (subjectId: string) =>
    api.delete<{ id: string }>(`/admin/subject-weights/${subjectId}`),

  bulkUpdateSubjectWeights: (updates: Array<{ subjectId: string; writtenWorkWeight?: number | null; perfTaskWeight?: number | null; quarterlyAssessWeight?: number | null }>) =>
    api.post<{ message: string }>("/admin/subject-weights/bulk", { updates }),

  // ─── School Years ────────────────────────────────────────────────────────
  getSchoolYears: () =>
    api.get<{ schoolYears: Array<{ id: string; label: string; status: string; startDate: string | null; endDate: string | null; archivedAt: string | null; createdAt: string }> }>("/admin/school-years"),

  createSchoolYear: (data: { label: string; startDate?: string; endDate?: string }) =>
    api.post<{ id: string; label: string; status: string }>("/admin/school-years", data),

  updateSchoolYear: (id: string, data: { status?: string; startDate?: string; endDate?: string }) =>
    api.patch<{ id: string; status: string; archivedAt: string | null }>(`/admin/school-years/${id}`, data),

  deleteSchoolYear: (id: string) =>
    api.delete<{ message: string }>(`/admin/school-years/${id}`),

  // ─── Term Display Labels ──────────────────────────────────────────────────
  getTermLabels: () =>
    api.get<{ termLabels: TermLabels }>("/admin/term-labels"),

  updateTermLabels: (data: { termLabelT1?: string; termLabelT2?: string; termLabelT3?: string }) =>
    api.put<{ message: string; termLabels: TermLabels }>("/admin/term-labels", data),
};

export default api;
