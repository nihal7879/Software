import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../db';

/**
 * Institute-wide switches kept in app_settings, thrown by the super admin.
 *
 * One per audience, and INDEPENDENT of each other — student, parent, teacher.
 * They started as a single student switch, which left a hole worth naming: a
 * parent dashboard shows the same hours, fees and attendance for the same
 * child, so locking students while the figures were being corrected left the
 * one audience most likely to ask about them still reading the old numbers.
 *
 * Locked means the dashboard and its data are refused. Signing in, the
 * profile and changing a password stay open, so nobody is shut out of their
 * own account — they simply cannot see figures that are mid-correction.
 *
 * Read on every request to those routes, so the value is cached for a few
 * seconds rather than costing a round trip each time; setting one clears the
 * cache, so a change applies at once.
 */

export type LockedRole = 'student' | 'parent' | 'faculty';

const KEY: Record<LockedRole, string> = {
  student: 'student_panel_locked',
  parent: 'parent_panel_locked',
  faculty: 'teacher_panel_locked',
};

const CACHE_MS = 10_000;
let cached: { at: number; locked: Record<string, boolean> } | null = null;

async function allLocks(): Promise<Record<string, boolean>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.locked;
  const rows = await query<any>(
    'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?)',
    [Object.values(KEY)]
  );
  const locked: Record<string, boolean> = {};
  // A key with no row — a database without the migration — means unlocked,
  // which is the behaviour before any of this existed.
  for (const k of Object.values(KEY)) locked[k] = false;
  for (const r of rows) locked[r.setting_key] = String(r.setting_value ?? '0') === '1';
  cached = { at: Date.now(), locked };
  return locked;
}

export async function isPanelLocked(role: LockedRole): Promise<boolean> {
  return (await allLocks())[KEY[role]] === true;
}

/** All three, for the super admin's switches and for the apps to read. */
export async function panelLocks(): Promise<{ student: boolean; parent: boolean; faculty: boolean }> {
  const l = await allLocks();
  return { student: l[KEY.student], parent: l[KEY.parent], faculty: l[KEY.faculty] };
}

export async function setPanelLocked(role: LockedRole, locked: boolean, userId: number) {
  await query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [KEY[role], locked ? '1' : '0', userId]
  );
  cached = null;
}

/** Kept for the routes that still read the student switch by name. */
export async function isStudentPanelLocked(): Promise<boolean> {
  return isPanelLocked('student');
}

/**
 * Refuses a dashboard request from an audience that is locked.
 *
 * Admins and the super admin are never caught by it — somebody has to be able
 * to see the figures in order to correct them. 423 (Locked) rather than
 * 401/403, so the app neither signs the person out nor calls it a permission
 * problem.
 */
export function blockLockedStudents(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== 'student' && role !== 'parent' && role !== 'faculty') return next();
  isPanelLocked(role)
    .then((locked) => {
      if (!locked) return next();
      const says: Record<LockedRole, string> = {
        student: 'Your dashboard is locked for now.',
        parent: "Your child's dashboard is locked for now.",
        faculty: 'Your dashboard is locked for now.',
      };
      res.status(423).json({ error: says[role], code: 'PANEL_LOCKED', panel: role });
    })
    .catch(next);
}
