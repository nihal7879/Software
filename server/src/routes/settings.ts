import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { panelLocks, setPanelLocked, isPanelLocked, type LockedRole } from '../utils/settings';

const router = Router();
router.use(requireAuth);

const ROLES = ['student', 'parent', 'faculty'] as const;
const LABEL: Record<LockedRole, string> = { student: 'STUDENT', parent: 'PARENT', faculty: 'TEACHER' };

/**
 * Which dashboards are locked. Any signed-in user may ask: each app needs it
 * to show the locked screen, and the super admin to draw the switches.
 *
 * `locked` is kept in the reply for the apps written against the old single
 * switch, so nothing breaks while they are updated.
 */
router.get(
  '/panel-access',
  wrap(async (_req, res) => {
    const locks = await panelLocks();
    res.json({ ...locks, locked: locks.student });
  })
);

// The old address, answering the same way.
router.get(
  '/student-access',
  wrap(async (_req, res) => {
    res.json({ locked: await isPanelLocked('student') });
  })
);

/**
 * Lock or unlock one audience — the super admin's switch, so an admin cannot
 * shut a whole group out, or let them back in, on their own.
 *
 * The three are independent on purpose: the office sometimes wants parents
 * held back while the figures are corrected but teachers still working.
 */
router.put(
  '/panel-access',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { panel, locked } = z
      .object({ panel: z.enum(ROLES), locked: z.boolean() })
      .parse(req.body);
    const before = await isPanelLocked(panel);
    await setPanelLocked(panel, locked, req.user!.userId);
    await audit(
      req.user!.userId,
      (locked ? 'LOCK_' : 'UNLOCK_') + LABEL[panel] + '_PANEL',
      'app_setting',
      panel + '_panel_locked',
      { locked: before },
      { locked }
    );
    res.json(await panelLocks());
  })
);

// The old address, for the student switch only.
router.put(
  '/student-access',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    const before = await isPanelLocked('student');
    await setPanelLocked('student', locked, req.user!.userId);
    await audit(req.user!.userId, locked ? 'LOCK_STUDENT_PANEL' : 'UNLOCK_STUDENT_PANEL',
      'app_setting', 'student_panel_locked', { locked: before }, { locked });
    res.json({ locked });
  })
);

export default router;
