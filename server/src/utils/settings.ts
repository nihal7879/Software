import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../db';

// Institute-wide switches kept in app_settings, changed by an admin from Settings.
//
// student_panel_locked — while on, students can sign in but not see their
// dashboard or data (hours, fees, lectures); profile and password stay open.
// Read on every request to those routes, so it is cached for a few seconds
// rather than costing a database round trip each time; changing it clears the
// cache so the change applies at once.

const CACHE_MS = 10_000;
let cached: { locked: boolean; at: number } | null = null;

export async function isStudentPanelLocked(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.locked;
  const row = await queryOne<any>("SELECT setting_value FROM app_settings WHERE setting_key = 'student_panel_locked'");
  // No row (a database without the migration) means unlocked — the old behaviour.
  const locked = String(row?.setting_value ?? '0') === '1';
  cached = { locked, at: Date.now() };
  return locked;
}

export async function setStudentPanelLocked(locked: boolean, userId: number) {
  await query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES ('student_panel_locked', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [locked ? '1' : '0', userId]
  );
  cached = null;
}

// Refuses a student's request for their dashboard data while the panel is
// locked. Only students: parents, teachers and admins read the same routes and
// are not affected. 423 (Locked) rather than 401/403, so the app neither signs
// the student out nor calls it a permission problem.
export function blockLockedStudents(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'student') return next();
  isStudentPanelLocked()
    .then((locked) =>
      locked
        ? res.status(423).json({ error: 'Your dashboard is locked for now.', code: 'STUDENT_PANEL_LOCKED' })
        : next()
    )
    .catch(next);
}
