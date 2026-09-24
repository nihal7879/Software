import { randomInt } from 'crypto';
import { query, queryOne } from '../db';

/**
 * The code printed on a teacher's desk.
 *
 * Twelve characters from an alphabet with no 0/O or 1/I/L in it, so a code read
 * off a printed sheet or typed by hand cannot be mistaken. It identifies the
 * teacher and nothing else: it is not a password and carries no rights, because
 * scanning only records attendance for the student who is already signed in,
 * and nothing counts until the teacher confirms it.
 *
 * Fixed, not rotating — the client accepted that a photograph of it could be
 * used from elsewhere, with the teacher's confirmation as the check.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

function newCode() {
  let out = '';
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** The teacher's code, made the first time it is asked for. */
export async function qrCodeFor(teacherId: number): Promise<string | null> {
  const t = await queryOne<any>('SELECT id, qr_code FROM teachers WHERE id = ? AND is_deleted = FALSE', [teacherId]);
  if (!t) return null;
  if (t.qr_code) return t.qr_code;

  // Unique in the table, so a clash cannot point two desks at one teacher.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const taken = await queryOne<any>('SELECT id FROM teachers WHERE qr_code = ?', [code]);
    if (taken) continue;
    await query('UPDATE teachers SET qr_code = ? WHERE id = ?', [code, teacherId]);
    return code;
  }
  throw new Error('Could not allocate a QR code for this teacher.');
}

/** Whose code is this? Null when it belongs to nobody. */
export async function teacherByCode(code: string) {
  return queryOne<any>(
    'SELECT id, name, is_active FROM teachers WHERE qr_code = ? AND is_deleted = FALSE',
    [String(code || '').trim().toUpperCase()]
  );
}
