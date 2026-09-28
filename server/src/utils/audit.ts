import { pool } from '../db';
import { getReqCtx } from './reqContext';

export async function audit(
  userId: number | undefined,
  action: string,
  entityType: string,
  entityId: string | number,
  before: any,
  after: any
) {
  try {
    // IP / GPS / device come from the per-request context (set by requestContext).
    const ctx = getReqCtx();
    const gps = ctx?.lat != null && ctx?.lng != null ? `${ctx.lat},${ctx.lng}` : null;
    await pool.query(
      // actor_role is read in the same statement, so every entry says whether
      // the office or the super admin did it without a join afterwards — and
      // keeps saying so if that person's role changes later.
      `INSERT INTO audit_logs (user_id, actor_role, action, entity_type, entity_id, before_json, after_json, ip_address, gps, device)
       VALUES (?, (SELECT role FROM users WHERE id = ?), ?,?,?,?,?,?,?,?)`,
      [
        userId ?? null,
        userId ?? null,
        action,
        entityType,
        String(entityId),
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        ctx?.ip ?? null,
        gps,
        ctx?.device ?? null,
      ]
    );
  } catch (e) {
    console.error('audit log failed', e);
  }
}



































