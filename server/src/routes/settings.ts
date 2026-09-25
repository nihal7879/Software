import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import {
  isStudentPanelLocked, setStudentPanelLocked,
  allPermissions, permissionDetails, setAdminMay, PERMISSIONS, PermissionKey,
} from '../utils/settings';
import { requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// Whether student dashboards are locked. Any signed-in user may ask — the
// student app needs it to show the locked screen; admins to show the switch.
router.get(
  '/student-access',
  wrap(async (_req, res) => {
    res.json({ locked: await isStudentPanelLocked() });
  })
);

// Lock or unlock every student's dashboard — the super admin's switch, so an
// admin cannot shut the students out (or let them back in) on their own.
router.put(
  '/student-access',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    const before = await isStudentPanelLocked();
    await setStudentPanelLocked(locked, req.user!.userId);
    await audit(req.user!.userId, locked ? 'LOCK_STUDENT_PANEL' : 'UNLOCK_STUDENT_PANEL', 'app_setting', 'student_panel_locked', { locked: before }, { locked });
    res.json({ locked });
  })
);

// What the admin has been granted. Readable by any admin, because their own
// pages use it to show or hide the buttons it controls.
router.get(
  '/permissions',
  requireRole('admin'),
  wrap(async (_req, res) => {
    res.json({ permissions: await allPermissions(), details: await permissionDetails(), labels: PERMISSIONS });
  })
);

// Grant or take back one permission — the super admin's switch.
router.put(
  '/permissions/:key',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const key = req.params.key as PermissionKey;
    if (!(key in PERMISSIONS)) return res.status(404).json({ error: 'No such permission' });
    // `until` is the moment it stops by itself: 'YYYY-MM-DD HH:MM' in institute
    // time. Left out or null, it stands until it is switched off by hand.
    const { on, until } = z
      .object({
        on: z.boolean(),
        until: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
      })
      .parse(req.body);

    const end = until ? `${until.replace('T', ' ').slice(0, 16)}:00` : until;
    if (on && end && new Date(end.replace(' ', 'T')).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Pick a time later than now.' });
    }

    const before = (await permissionDetails())[key];
    await setAdminMay(key, on, req.user!.userId, end);
    await audit(req.user!.userId, on ? 'GRANT_PERMISSION' : 'REVOKE_PERMISSION', 'app_setting',
      `perm_${key}`, { on: before?.on, until: before?.until }, { on, until: end ?? null });
    res.json({ permissions: await allPermissions(), details: await permissionDetails() });
  })
);

export default router;
