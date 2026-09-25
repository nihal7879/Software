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

// ---------------------------------------------------------------------------
// Permissions the super admin grants to the admin.
//
// Changing the hours statement moves what a family owes, so it belongs to the
// super admin by default. The switch in Settings hands it to the Institute
// Admin when the office needs it, and takes it back afterwards. The super admin
// can always do it; the admin only while the switch is on.
// ---------------------------------------------------------------------------

/** Settings key -> what it lets the admin do, for the message when it is off. */
export const PERMISSIONS = {
  hours_add: 'add hours to a student statement',
  hours_deduct: 'deduct hours from a student statement',
  hours_edit: 'edit an hours entry already on a statement',
  hours_delete: 'delete an hours entry from a statement',
  ledger_adjust: 'change the credited, pending and discount figures',
} as const;
export type PermissionKey = keyof typeof PERMISSIONS;

// A permission can be given until a moment rather than indefinitely: the end
// time lives beside it as `perm_<key>_until`, holding 'YYYY-MM-DD HH:MM:SS' in
// institute time. Past it the permission simply reads as off, so nothing has to
// run on a schedule to take it back.
const flagCache = new Map<string, { value: string; until: string | null; at: number }>();

/** Has an end time been reached? No end time means it stands until switched off. */
function expired(until: string | null): boolean {
  if (!until) return false;
  const end = new Date(String(until).replace(' ', 'T')).getTime();
  return Number.isFinite(end) && Date.now() > end;
}

async function rawFlag(key: PermissionKey) {
  const hit = flagCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const rows = await query<any>(
    'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)',
    [`perm_${key}`, `perm_${key}_until`]
  );
  // No row means not granted — the admin starts with nothing extra.
  const value = String(rows.find((r) => r.setting_key === `perm_${key}`)?.setting_value ?? '0');
  const untilRaw = rows.find((r) => r.setting_key === `perm_${key}_until`)?.setting_value;
  const until = untilRaw ? String(untilRaw) : null;
  const entry = { value, until, at: Date.now() };
  flagCache.set(key, entry);
  return entry;
}

export async function adminMay(key: PermissionKey): Promise<boolean> {
  const { value, until } = await rawFlag(key);
  // The end time is checked on every read, not cached as a yes or no, so the
  // permission stops the moment it runs out rather than up to a cache later.
  return value === '1' && !expired(until);
}

export async function setAdminMay(key: PermissionKey, on: boolean, userId: number, until?: string | null) {
  await query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [`perm_${key}`, on ? '1' : '0', userId]
  );
  // Switching off clears any end time, so turning it on again does not inherit
  // an old one that has already passed.
  if (!on || until === null || until === '') {
    await query('DELETE FROM app_settings WHERE setting_key = ?', [`perm_${key}_until`]);
  } else if (until) {
    await query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [`perm_${key}_until`, until, userId]
    );
  }
  flagCache.delete(key);
}

/** Every permission at once, as a plain on/off map. */
export async function allPermissions(): Promise<Record<PermissionKey, boolean>> {
  const out: any = {};
  for (const key of Object.keys(PERMISSIONS) as PermissionKey[]) out[key] = await adminMay(key);
  return out;
}

/**
 * The same, with when it was last switched and by whom — so the Permissions
 * screen can say "given to the admin on 25 Sep at 11:19 AM by ...", and a
 * permission left on by mistake is visible rather than silently standing.
 */
export async function permissionDetails() {
  const rows = await query<any>(
    `SELECT s.setting_key, s.setting_value, s.updated_at,
            COALESCE(t.name, u.email) AS changed_by
       FROM app_settings s
       LEFT JOIN users u ON u.id = s.updated_by
       LEFT JOIN teachers t ON t.user_id = u.id
      WHERE s.setting_key LIKE 'perm\_%'`
  );
  const byKey = new Map(rows.map((r) => [String(r.setting_key).replace(/^perm_/, ''), r]));
  const out: Record<string, {
    on: boolean; label: string; changed_at: string | null; changed_by: string | null;
    until: string | null; expired: boolean;
  }> = {};
  for (const key of Object.keys(PERMISSIONS) as PermissionKey[]) {
    const row = byKey.get(key);
    const untilRow = byKey.get(`${key}_until`);
    const until = untilRow?.setting_value ? String(untilRow.setting_value) : null;
    const granted = String(row?.setting_value ?? '0') === '1';
    const hasRunOut = granted && expired(until);
    out[key] = {
      // What it actually is right now, end time included.
      on: granted && !hasRunOut,
      label: PERMISSIONS[key],
      // Never switched at all: nothing to show rather than a made-up date.
      changed_at: row?.updated_at ? String(row.updated_at) : null,
      changed_by: row?.changed_by ?? null,
      until,
      // Given with an end time that has now passed — worth saying so, rather
      // than looking as though it was never given.
      expired: hasRunOut,
    };
  }
  return out;
}

/**
 * Guards a route the super admin may always use and the admin only by
 * permission. Put it after requireRole('admin'), which lets both roles through.
 */
export function requirePermission(key: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role === 'superadmin') return next();
    adminMay(key)
      .then((on) =>
        on
          ? next()
          : res.status(403).json({
              error: `Only the super admin can ${PERMISSIONS[key]}. Ask them to switch this on in Settings.`,
              code: 'PERMISSION_REQUIRED',
              permission: key,
            })
      )
      .catch(next);
  };
}
