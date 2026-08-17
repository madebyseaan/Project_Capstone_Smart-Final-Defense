import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'

// Layouts are small and always needed — keep eager
import TeacherLayout from './layouts/TeacherLayout'
import RegistrarLayout from './layouts/RegistrarLayout'
import AdminLayout from './layouts/AdminLayout'

// Login pages
const LoginPage = lazy(() => import('./pages/LoginPage'))
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const RegistrarLoginPage = lazy(() => import('./pages/RegistrarLoginPage'))

// Teacher pages
const TeacherDashboard = lazy(() => import('./pages/teacher/Dashboard'))
const ClassRecordsList = lazy(() => import('./pages/teacher/ClassRecordsList'))
const ClassRecordView = lazy(() => import('./pages/teacher/ClassRecordView'))
const MyAdvisory = lazy(() => import('./pages/teacher/MyAdvisory'))
const StudentGradeProfile = lazy(() => import('./pages/teacher/StudentGradeProfile'))
const Attendance = lazy(() => import('./pages/teacher/Attendance'))
const AttendanceReports = lazy(() => import('./pages/teacher/AttendanceReports'))
const TeacherSchedule = lazy(() => import('./pages/teacher/Schedule'))

// Registrar pages
const RegistrarDashboard = lazy(() => import('./pages/registrar/Dashboard'))
const StudentRecords = lazy(() => import('./pages/registrar/StudentRecords'))
const SchoolForms = lazy(() => import('./pages/registrar/SchoolForms'))
const ApplicationTracker = lazy(() => import('./pages/registrar/ApplicationTracker'))
const BOSYQueue = lazy(() => import('./pages/registrar/BOSYQueue'))
const RemedialTracker = lazy(() => import('./pages/registrar/RemedialTracker'))
const SectionRosterViewer = lazy(() => import('./pages/registrar/SectionRosterViewer'))
const EOSYFinalization = lazy(() => import('./pages/registrar/EOSYFinalization'))
const TeachingLoad = lazy(() => import('./pages/registrar/TeachingLoad'))

// Admin pages
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))
const UserManagement = lazy(() => import('./pages/admin/UserManagement'))
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs'))
const GradingConfig = lazy(() => import('./pages/admin/GradingConfig'))
const SystemSettings = lazy(() => import('./pages/admin/SystemSettings'))
const TemplateManager = lazy(() => import('./pages/admin/TemplateManager'))
const ECRTemplateManager = lazy(() => import('./pages/admin/ECRTemplateManager'))
const ClassAssignments = lazy(() => import('./pages/admin/ClassAssignments'))
const SystemHealth = lazy(() => import('./pages/admin/SystemHealth'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes - Login pages */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/admin" element={<AdminLoginPage />} />
        <Route path="/login/registrar" element={<RegistrarLoginPage />} />
      
      {/* Teacher routes */}
      <Route path="/teacher" element={<TeacherLayout />}>
        <Route index element={<TeacherDashboard />} />
        <Route path="classes" element={<ClassRecordsList />} />
        <Route path="records" element={<ClassRecordsList />} />
        <Route path="records/:classAssignmentId" element={<ClassRecordView />} />
        <Route path="advisory" element={<MyAdvisory />} />
        <Route path="advisory/student/:studentId" element={<StudentGradeProfile />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="attendance-reports" element={<AttendanceReports />} />
        <Route path="schedule" element={<TeacherSchedule />} />
      </Route>

      {/* Registrar routes */}
      <Route path="/registrar" element={<RegistrarLayout />}>
        <Route index element={<RegistrarDashboard />} />
        <Route path="students" element={<StudentRecords />} />
        <Route path="forms" element={<SchoolForms />} />
        <Route path="applications" element={<ApplicationTracker />} />
        <Route path="bosy" element={<BOSYQueue />} />
        <Route path="remedial" element={<RemedialTracker />} />
        <Route path="roster" element={<SectionRosterViewer />} />
        <Route path="eosy" element={<EOSYFinalization />} />
        <Route path="teaching-load" element={<TeachingLoad />} />
      </Route>

      {/* Admin routes */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="logs" element={<AuditLogs />} />
        <Route path="grading" element={<GradingConfig />} />
        <Route path="settings" element={<SystemSettings />} />
        <Route path="health" element={<SystemHealth />} />
        <Route path="templates" element={<TemplateManager />} />
        <Route path="ecr-templates" element={<ECRTemplateManager />} />
        <Route path="assignments" element={<ClassAssignments />} />
      </Route>

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
      </Suspense>
    </ThemeProvider>
  )
}

export default App
