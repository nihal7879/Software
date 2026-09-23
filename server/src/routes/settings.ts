import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import { isStudentPanelLocked, setStudentPanelLocked } from '../utils/settings';

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

export default router;
