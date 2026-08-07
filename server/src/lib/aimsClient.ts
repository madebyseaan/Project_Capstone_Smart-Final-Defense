// Stub file to disable live external ATLAS/AIMS integration and prevent TypeScript errors.

export interface AimsUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'TEACHER' | 'STUDENT' | 'ADMIN';
  emailVerified: boolean;
}

export interface AimsLoginResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  user?: AimsUser;
  error?: string;
}

export interface AimsCourse {
  id: string;
  name: string;
  description?: string;
  code: string;
  subject: string;
  subjectType: string;
  gradeLevel: string;
  schoolYear: string;
  color?: string;
  archived: boolean;
  teacherId: string;
  studentCount: number;
  activeQuizCount: number;
  createdAt: string;
}

export interface AimsStudent {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface AimsAssessment {
  id: string;
  sourceId: string;
  title: string;
  type: 'QUIZ' | 'TASK';
  category: 'WW' | 'PT';
  maxPoints: number;
}

export interface AimsGradebookRow {
  userId: string;
  name: string;
  email: string;
  googlePicture?: string;
  scores: Array<{ assessmentId: string; score: number | null }>;
  categoryAverages: { ww: number | null; pt: number | null };
  initialGrade: number | null;
  quarterlyGrade: number | null;
  average: number | null;
}

export interface AimsGradebook {
  assessments: AimsAssessment[];
  weights: { ww: number; pt: number };
  rows: AimsGradebookRow[];
}

export async function aimsLogin(email: string, password: string): Promise<AimsLoginResult> {
  return { success: false, error: "AIMS integration disabled" };
}

export async function aimsRefreshToken(refreshToken: string): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  return { success: false, error: "AIMS integration disabled" };
}

export async function getAimsCourses(aimsToken: string): Promise<AimsCourse[]> {
  return [];
}

export async function getAimsCourse(courseId: string, aimsToken: string): Promise<AimsCourse | null> {
  return null;
}

export async function getAimsCourseStudents(courseId: string, aimsToken: string): Promise<AimsStudent[]> {
  return [];
}

export async function getAimsGradebook(courseId: string, aimsToken: string): Promise<AimsGradebook | null> {
  return null;
}

export async function getAimsTeacherDashboard(aimsToken: string): Promise<any> {
  return null;
}

export async function checkAimsHealth(): Promise<boolean> {
  return false;
}
