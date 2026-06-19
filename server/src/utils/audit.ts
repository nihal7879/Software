import { pool } from '../db';

export async function audit(
  userId: number | undefined,
  action: string,
  entityType: string,
  entityId: string | number,
  before: any,
  after: any
) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
       VALUES (?,?,?,?,?,?)`,
      [
        userId ?? null,
        action,
        entityType,
        String(entityId),
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
      ]
    );
  } catch (e) {
    console.error('audit log failed', e);
  }
}
