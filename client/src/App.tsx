import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, Role } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';

import Login from './pages/Login';
import StudentRegister from './pages/StudentRegister';
import ParentRegister from './pages/ParentRegister';
import TeacherRegister from './pages/TeacherRegister';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminLectureEntry from './pages/admin/AdminLectureEntry';
import ManagementStudents from './pages/admin/ManagementStudents';
import Registrations from './pages/admin/Registrations';
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
import AdminAttendance from './pages/admin/Attendance';
import FacultyAttendance from './pages/faculty/Attendance';
import StudentDashboard from './pages/student/StudentDashboard';
import CheckIn from './pages/student/CheckIn';
import Scan from './pages/Scan';
import { PENDING_SCAN } from './lib/qr';
import { StudentGate } from './components/StudentLock';
import LectureHistory from './pages/student/LectureHistory';
import StudentFees from './pages/student/StudentFees';
import StudentProfile from './pages/student/StudentProfile';
import ParentDashboard from './pages/parent/ParentDashboard';
import ParentProfile from './pages/parent/ParentProfile';
import Tracker from './pages/shared/Tracker';
import Settings from './pages/shared/Settings';

const HOME: Record<Role, string> = {
  admin: '/admin',
  superadmin: '/admin',
  faculty: '/faculty',
  student: '/student',
  parent: '/parent',
};

/**
 * Where signing in lands. Normally the role's own home, but a student who got
 * here by scanning a desk QR goes straight to check-in, with the code waiting.
 */
function homeFor(role: Role) {
  if (role === 'student' && localStorage.getItem(PENDING_SCAN)) return '/student/checkin';
  return HOME[role];
}

function Protected({ roles, children }: { roles: Role[]; children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  // A super admin is an admin with more, so every admin page opens for them too.
  // What an admin may NOT see (Pivots) is guarded separately, below and on the server.
  const allowed = roles.includes(user.role) || (user.role === 'superadmin' && roles.includes('admin'));
  if (!allowed) return <Navigate to={HOME[user.role]} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />
      {/* Where the printed desk QR points. Public: it only parks the code and
          sends the student on to the login they already have. */}
      <Route path="/scan" element={<Scan />} />
      {/* One registration link per role — nobody gets a form asking them to pick
          a role. A student's registration waits for an admin; parents and
          teachers are signed in straight away for now. */}
      <Route path="/register/student" element={user ? <Navigate to={HOME[user.role]} replace /> : <StudentRegister />} />
      <Route path="/register/parent" element={user ? <Navigate to={HOME[user.role]} replace /> : <ParentRegister />} />
      <Route path="/register/teacher" element={user ? <Navigate to={HOME[user.role]} replace /> : <TeacherRegister />} />

      {/* Management (admin role) */}
      <Route path="/admin" element={<Protected roles={['admin']}><AdminDashboard /></Protected>} />
      <Route path="/admin/students" element={<Protected roles={['admin']}><ManagementStudents /></Protected>} />
      <Route path="/admin/registrations" element={<Protected roles={['admin']}><Registrations /></Protected>} />
      <Route path="/admin/student/:id" element={<Protected roles={['admin']}><StudentReport /></Protected>} />
      <Route path="/admin/hours" element={<Protected roles={['admin']}><HoursMonthly /></Protected>} />
      <Route path="/admin/finance" element={<Protected roles={['admin']}><Finance /></Protected>} />
      <Route path="/admin/teachers" element={<Protected roles={['admin']}><Teachers /></Protected>} />
      {/* Logging a class for a teacher — its own page, like the teacher's own. */}
      <Route path="/admin/lecture/:teacherId" element={<Protected roles={['admin']}><AdminLectureEntry /></Protected>} />
      {/* Reports with money in them: the super admin's, not the admin's. */}
      <Route path="/admin/pivots" element={<Protected roles={['superadmin']}><Pivots /></Protected>} />
      {/* Scanned check-ins for any teacher, and the printed desk codes. */}
      <Route path="/admin/attendance" element={<Protected roles={['admin']}><AdminAttendance /></Protected>} />
      <Route path="/admin/settings" element={<Protected roles={['admin']}><Settings /></Protected>} />

      {/* Faculty */}
      <Route path="/faculty" element={<Protected roles={['faculty', 'admin']}><FacultyDashboard /></Protected>} />
      <Route path="/faculty/students" element={<Protected roles={['faculty', 'admin']}><FacultyStudents /></Protected>} />
      <Route path="/faculty/student/:id" element={<Protected roles={['faculty', 'admin']}><FacultyStudentDetail /></Protected>} />
      <Route path="/faculty/lecture" element={<Protected roles={['faculty', 'admin']}><LectureEntry /></Protected>} />
      <Route path="/faculty/attendance" element={<Protected roles={['faculty', 'admin']}><FacultyAttendance /></Protected>} />
      <Route path="/faculty/settings" element={<Protected roles={['faculty', 'admin']}><Settings /></Protected>} />

      {/* Student */}
      {/* Data pages sit behind the student lock (admin Settings → Student access).
          Profile and settings stay open so a locked student can still finish
          their profile and change their password. */}
      <Route path="/student" element={<Protected roles={['student']}><StudentGate><StudentDashboard /></StudentGate></Protected>} />
      <Route path="/student/tracker" element={<Protected roles={['student']}><StudentGate><Tracker /></StudentGate></Protected>} />
      <Route path="/student/lectures" element={<Protected roles={['student']}><StudentGate><LectureHistory /></StudentGate></Protected>} />
      <Route path="/student/hours" element={<Protected roles={['student']}><StudentGate><HoursStatement /></StudentGate></Protected>} />
      <Route path="/student/fees" element={<Protected roles={['student']}><StudentGate><StudentFees /></StudentGate></Protected>} />
      {/* Check-in stays outside the lock, like Profile: a student who owes fees
          still has to be able to record that they attended. */}
      <Route path="/student/checkin" element={<Protected roles={['student']}><CheckIn /></Protected>} />
      <Route path="/student/profile" element={<Protected roles={['student']}><StudentProfile /></Protected>} />
      <Route path="/student/settings" element={<Protected roles={['student']}><Settings /></Protected>} />

      {/* Parent */}
      <Route path="/parent" element={<Protected roles={['parent']}><ParentDashboard /></Protected>} />
      <Route path="/parent/tracker" element={<Protected roles={['parent']}><Tracker /></Protected>} />
      <Route path="/parent/lectures" element={<Protected roles={['parent']}><LectureHistory /></Protected>} />
      <Route path="/parent/hours" element={<Protected roles={['parent']}><HoursStatement /></Protected>} />
      <Route path="/parent/profile" element={<Protected roles={['parent']}><ParentProfile /></Protected>} />

      <Route path="*" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />
    </Routes>
  );
}























