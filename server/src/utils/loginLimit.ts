import { queryOne, query } from '../db';

/**
 * How many times a sign-in may be got wrong, from one machine, before it
 * stops answering.
 *
 * Without this, `POST /auth/login` will check a password as fast as it is
 * asked to, for ever. The usernames are easy to guess — they are the
 * teachers' own names — so the gap between "has the list" and "is inside" is
 * a script and an afternoon.
 *
 * COUNTED PER MACHINE, NEVER PER ACCOUNT. That is the whole design decision,
 * and it is worth saying why: counting an account means anyone can type a
 * known username with a wrong password eight times and lock that teacher out
 * of her own phone for a quarter of an hour, without ever knowing her
 * password. A lockout must only ever cost the machine doing the guessing.
 *
 * The trade-off, stated plainly: somebody patient, with many addresses, is
 * not stopped by this. For an institute this size the real threat is one
 * laptop and the staff list, and that is what this stops.
 *
 * Counted from the audit trail rather than from memory: the API runs as a
 * serverless function, so a counter in a variable is per-instance and resets
 * whenever the platform recycles it, which is to say it protects nothing.
 */
export const MAX_FAILURES = 8;
export const WINDOW_MINUTES = 15;

/**
 * Which machine, as well as it can be known: the address and the browser it
 * reported. Two teachers sharing the office router are told apart by the
 * second half; the same person on the same laptop is not.
 */
function machine(ip: string | null, device: string | null): string {
  return [ip || 'no-ip', (device || 'no-device').slice(0, 80)].join('|').slice(0, 60);
}

/** Recorded on a failure so the next attempt from that machine is counted. */
export async function noteFailedLogin(identifier: string, ip: string | null, device: string | null) {
  await query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, after_json, ip_address, device)
     VALUES (NULL, 'LOGIN_FAILED', 'auth', ?, ?, ?, ?)`,
    [
      // The MACHINE is the key. The identifier that was tried is kept in the
      // payload — useful when reading the trail, never used for counting.
      machine(ip, device),
      JSON.stringify({ identifier: String(identifier).slice(0, 190) }),
      ip,
      device ? device.slice(0, 120) : null,
    ]
  ).catch((e: any) => {
    // Never let the audit stop the refusal being returned.
    console.error('noteFailedLogin:', e?.code, e?.sqlMessage || e?.message);
  });
}

/**
 * Cleared on a real sign-in — but only for the machine that just succeeded.
 * Clearing every machine would mean one good password anywhere unblocks a
 * laptop that is still guessing.
 */
export async function clearFailedLogins(ip: string | null, device: string | null) {
  await query(
    `DELETE FROM audit_logs
      WHERE action = 'LOGIN_FAILED' AND entity_type = 'auth' AND entity_id = ?`,
    [machine(ip, device)]
  ).catch(() => { /* a stale row only costs that machine one count */ });
}

/** Seconds left to wait, or 0 if this machine may try. */
export async function loginBlocked(ip: string | null, device: string | null): Promise<number> {
  const key = machine(ip, device);
  const row = await queryOne<any>(
    `SELECT COUNT(*) AS failures,
            TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(MIN(created_at), INTERVAL ${WINDOW_MINUTES} MINUTE)) AS wait_s
       FROM audit_logs
      WHERE action = 'LOGIN_FAILED' AND entity_type = 'auth'
        AND entity_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${WINDOW_MINUTES} MINUTE)`,
    [key]
  ).catch(() => null);

  if (!row || Number(row.failures) < MAX_FAILURES) return 0;
  // At least a minute, so "try again shortly" is never a lie.
  return Math.max(60, Number(row.wait_s) || 60);
}
