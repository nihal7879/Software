import { Request, Response, NextFunction } from 'express';
import { query } from '../db';

/**
 * Institute-wide switches kept in app_settings, thrown by the super admin.
 *
 * Students and parents have one switch each: their screens are all figures,
 * and there is nothing left to show once the figures are held back.
 *
 * A teacher is different. Their app is also how the institute records what
 * happened — a class entered, a desk scan confirmed. Holding back the hours
 * on their dashboard while they carry on teaching is a normal week here, so
 * the teacher side is split into the three things they actually do:
 *
 *   teacher_dashboard  the home screen: their recent classes and hours
 *   teacher_students   My Students, and one student's detail
 *   teacher_lecture    Lecture Entry: entering a class, confirming scans
 *
 * Each is independent. Locking the dashboard leaves Lecture Entry working,
 * which is the whole point — the institute asked for exactly that on
 * 5 November 2026, after one switch took all nine teachers' screens away.
 *
 * Locked means the dashboard and its data are refused. Signing in, the
 * profile and changing a password stay open, so nobody is shut out of their
 * own account — they simply cannot see figures that are mid-correction.
 *
 * Read on every request to those routes, so the value is cached for a few
 * seconds rather than costing a round trip each time; setting one clears the
 * cache, so a change applies at once.
 */

/** An audience, as the old single-switch API named them. */
export type LockedRole = 'student' | 'parent' | 'faculty';

/** What can actually be locked. The teacher has three; the others have one. */
export type LockArea = 'student' | 'parent' | 'teacher_dashboard' | 'teacher_students' | 'teacher_lecture';

export const TEACHER_AREAS: LockArea[] = ['teacher_dashboard', 'teacher_students', 'teacher_lecture'];

const KEY: Record<LockArea, string> = {
  student: 'student_panel_locked',
  parent: 'parent_panel_locked',
  teacher_dashboard: 'teacher_dashboard_locked',
  teacher_students: 'teacher_students_locked',
  teacher_lecture: 'teacher_lecture_locked',
};

/**
 * The switch the teacher side used before it was split in three. A database
 * that has not had the November migration still holds only this one, so it
 * stands in for all three areas rather than silently opening them.
 */
const LEGACY_TEACHER_KEY = 'teacher_panel_locked';

const CACHE_MS = 10_000;
let cached: { at: number; locked: Record<LockArea, boolean> } | null = null;

async function allLocks(): Promise<Record<LockArea, boolean>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.locked;
  const rows = await query<any>(
    'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?)',
    [[...Object.values(KEY), LEGACY_TEACHER_KEY]]
  );
  const raw = new Map<string, boolean>();
  for (const r of rows) raw.set(r.setting_key, String(r.setting_value ?? '0') === '1');

  // A key with no row — a database without the migration — means unlocked,
  // which is the behaviour before any of this existed. The exception is a
  // teacher area, which falls back to the one switch it was split out of.
  const legacy = raw.get(LEGACY_TEACHER_KEY) === true;
  const locked = {} as Record<LockArea, boolean>;
  for (const area of Object.keys(KEY) as LockArea[]) {
    const own = raw.get(KEY[area]);
    locked[area] = own === undefined
      ? (TEACHER_AREAS.includes(area) ? legacy : false)
      : own;
  }
  cached = { at: Date.now(), locked };
  return locked;
}

export async function isAreaLocked(area: LockArea): Promise<boolean> {
  return (await allLocks())[area] === true;
}

/** Every switch, for the super admin's page and for the apps to read. */
export async function panelLocks(): Promise<Record<LockArea, boolean> & { faculty: boolean }> {
  const l = await allLocks();
  return {
    ...l,
    // For anything written against the single teacher switch: it is "locked"
    // only when the teacher has nothing left at all.
    faculty: TEACHER_AREAS.every((a) => l[a]),
  };
}

export async function setAreaLocked(area: LockArea, locked: boolean, userId: number) {
  await query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [KEY[area], locked ? '1' : '0', userId]
  );
  cached = null;
}

/** Kept for the callers that still ask by audience. */
export async function isPanelLocked(role: LockedRole): Promise<boolean> {
  if (role === 'faculty') return (await panelLocks()).faculty;
  return isAreaLocked(role);
}

export async function isStudentPanelLocked(): Promise<boolean> {
  return isAreaLocked('student');
}

/**
 * 423 (Locked) rather than 401/403, so the app neither signs the person out
 * nor calls it a permission problem.
 */
function refuse(res: Response, area: LockArea) {
  const says: Record<LockArea, string> = {
    student: 'Your dashboard is locked for now.',
    parent: "Your child's dashboard is locked for now.",
    teacher_dashboard: 'Your dashboard is locked for now.',
    teacher_students: 'My Students is locked for now.',
    teacher_lecture: 'Lecture Entry is locked for now.',
  };
  res.status(423).json({ error: says[area], code: 'PANEL_LOCKED', panel: area });
}

/**
 * Refuses a student's or parent's dashboard request while that audience is
 * locked. Admins and the super admin are never caught by it — somebody has to
 * be able to see the figures in order to correct them. Teachers are not caught
 * by it either: their routes carry their own area guard below.
 */
export function blockLockedStudents(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== 'student' && role !== 'parent') return next();
  isAreaLocked(role)
    .then((locked) => (locked ? refuse(res, role) : next()))
    .catch(next);
}

/**
 * Refuses one part of the teacher app while that part is locked. Only a
 * faculty login is caught — an admin opening the same route is doing the
 * office's work on a teacher's behalf.
 */
export function blockLockedTeachers(area: LockArea) {
  return function guard(req: Request, res: Response, next: NextFunction) {
    if (req.user?.role !== 'faculty') return next();
    isAreaLocked(area)
      .then((locked) => (locked ? refuse(res, area) : next()))
      .catch(next);
  };
}

/**
 * The roster, which two screens share: My Students lists it, and Lecture
 * Entry picks from it with `?for=lecture`. One lock must not take the other's
 * screen away, so which switch applies depends on who is asking for it.
 */
export function blockLockedTeacherRoster(req: Request, res: Response, next: NextFunction) {
  const area: LockArea = req.query.for === 'lecture' ? 'teacher_lecture' : 'teacher_students';
  return blockLockedTeachers(area)(req, res, next);
}
