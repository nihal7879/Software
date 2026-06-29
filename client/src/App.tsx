import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, Role } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';

import Login from './pages/Login';
import Register from './pages/Register';
import AdminDashboard from './pages/admin/AdminDashboard';
import ManagementStudents from './pages/admin/ManagementStudents';
import StudentReport from './pages/admin/StudentReport';
import HoursMonthly from './pages/admin/HoursMonthly';
import HoursStatement from './pages/shared/HoursStatement';
import Finance from './pages/admin/Finance';
import Teachers from './pages/admin/Teachers';
import Pivots from './pages/admin/Pivots';
import FacultyDashboard from './pages/faculty/FacultyDashboard';
import FacultyStudents from './pages/faculty/FacultyStudents';
import FacultyStudentDetail from './pages/faculty/FacultyStudentDetail';
import LectureEntry from './pages/faculty/LectureEntry';
import StudentDashboard from './pages/student/StudentDashboard';
import LectureHistory from './pages/student/LectureHistory';
import StudentFees from './pages/student/StudentFees';
import StudentProfile from './pages/student/StudentProfile';
import ParentDashboard from './pages/parent/ParentDashboard';
import Tracker from './pages/shared/Tracker';
import Settings from './pages/shared/Settings';

const HOME: Record<Role, string> = {
  admin: '/admin',
  faculty: '/faculty',
  student: '/student',
  parent: '/parent',
};

function Protected({ roles, children }: { roles: Role[]; children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={HOME[user.role]} replace /> : <Register />} />

      {/* Management (admin role) */}
      <Route path="/admin" element={<Protected roles={['admin']}><AdminDashboard /></Protected>} />
      <Route path="/admin/students" element={<Protected roles={['admin']}><ManagementStudents /></Protected>} />
      <Route path="/admin/student/:id" element={<Protected roles={['admin']}><StudentReport /></Protected>} />
      <Route path="/admin/hours" element={<Protected roles={['admin']}><HoursMonthly /></Protected>} />
      <Route path="/admin/finance" element={<Protected roles={['admin']}><Finance /></Protected>} />
      <Route path="/admin/teachers" element={<Protected roles={['admin']}><Teachers /></Protected>} />
      <Route path="/admin/pivots" element={<Protected roles={['admin']}><Pivots /></Protected>} />
      <Route path="/admin/settings" element={<Protected roles={['admin']}><Settings /></Protected>} />

      {/* Faculty */}
      <Route path="/faculty" element={<Protected roles={['faculty', 'admin']}><FacultyDashboard /></Protected>} />
      <Route path="/faculty/students" element={<Protected roles={['faculty', 'admin']}><FacultyStudents /></Protected>} />
      <Route path="/faculty/student/:id" element={<Protected roles={['faculty', 'admin']}><FacultyStudentDetail /></Protected>} />
      <Route path="/faculty/lecture" element={<Protected roles={['faculty', 'admin']}><LectureEntry /></Protected>} />
      <Route path="/faculty/settings" element={<Protected roles={['faculty', 'admin']}><Settings /></Protected>} />

      {/* Student */}
      <Route path="/student" element={<Protected roles={['student']}><StudentDashboard /></Protected>} />
      <Route path="/student/tracker" element={<Protected roles={['student']}><Tracker /></Protected>} />
      <Route path="/student/lectures" element={<Protected roles={['student']}><LectureHistory /></Protected>} />
      <Route path="/student/hours" element={<Protected roles={['student']}><HoursStatement /></Protected>} />
      <Route path="/student/fees" element={<Protected roles={['student']}><StudentFees /></Protected>} />
      <Route path="/student/profile" element={<Protected roles={['student']}><StudentProfile /></Protected>} />
      <Route path="/student/settings" element={<Protected roles={['student']}><Settings /></Protected>} />

      {/* Parent */}
      <Route path="/parent" element={<Protected roles={['parent']}><ParentDashboard /></Protected>} />
      <Route path="/parent/tracker" element={<Protected roles={['parent']}><Tracker /></Protected>} />
      <Route path="/parent/lectures" element={<Protected roles={['parent']}><LectureHistory /></Protected>} />
      <Route path="/parent/hours" element={<Protected roles={['parent']}><HoursStatement /></Protected>} />
      <Route path="/parent/fees" element={<Protected roles={['parent']}><StudentFees /></Protected>} />
      <Route path="/parent/settings" element={<Protected roles={['parent']}><Settings /></Protected>} />

      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}
