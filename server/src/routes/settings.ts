import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { audit } from '../utils/audit';
import {
  panelLocks, setAreaLocked, isAreaLocked, TEACHER_AREAS, type LockArea,
} from '../utils/settings';

const router = Router();
router.use(requireAuth);

const AREAS = ['student', 'parent', 'teacher_dashboard', 'teacher_students', 'teacher_lecture'] as const;
// 'faculty' is the old whole-teacher switch: it sets all three teacher areas
// at once, so an older client still works and the office still has one pull
// for "teachers see nothing".
const PANELS = [...AREAS, 'faculty'] as const;

const LABEL: Record<LockArea, string> = {
  student: 'STUDENT',
  parent: 'PARENT',
  teacher_dashboard: 'TEACHER_DASHBOARD',
  teacher_students: 'TEACHER_STUDENTS',
  teacher_lecture: 'TEACHER_LECTURE',
};

const KEY_NAME: Record<LockArea, string> = {
  student: 'student_panel_locked',
  parent: 'parent_panel_locked',
  teacher_dashboard: 'teacher_dashboard_locked',
  teacher_students: 'teacher_students_locked',
  teacher_lecture: 'teacher_lecture_locked',
};

/**
 * Which dashboards are locked. Any signed-in user may ask: each app needs it
 * to show the locked screen, and the super admin to draw the switches.
 *
 * `locked` and `faculty` are kept in the reply for the apps written against
 * the older switches, so nothing breaks while they are updated.
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
    res.json({ locked: await isAreaLocked('student') });
  })
);

/**
 * Lock or unlock one part of one audience's app — the super admin's switch,
 * so an admin cannot shut a whole group out, or let them back in, on their
 * own.
 *
 * They are independent on purpose. The teacher side especially: the office
 * holds back the hours on a teacher's dashboard while the figures are being
 * corrected, and that must not stop them entering today's class.
 */
router.put(
  '/panel-access',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { panel, locked } = z
      .object({ panel: z.enum(PANELS), locked: z.boolean() })
      .parse(req.body);

    const areas: LockArea[] = panel === 'faculty' ? TEACHER_AREAS : [panel as LockArea];
    for (const area of areas) {
      const before = await isAreaLocked(area);
      if (before === locked) continue;
      await setAreaLocked(area, locked, req.user!.userId);
      await audit(
        req.user!.userId,
        (locked ? 'LOCK_' : 'UNLOCK_') + LABEL[area],
        'app_setting',
        KEY_NAME[area],
        { locked: before },
        { locked }
      );
    }
    res.json(await panelLocks());
  })
);

// The old address, for the student switch only.
router.put(
  '/student-access',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    const before = await isAreaLocked('student');
    await setAreaLocked('student', locked, req.user!.userId);
    await audit(req.user!.userId, locked ? 'LOCK_STUDENT' : 'UNLOCK_STUDENT',
      'app_setting', 'student_panel_locked', { locked: before }, { locked });
    res.json({ locked });
  })
);

export default router;
