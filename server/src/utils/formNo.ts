// Form numbers.
//
// A trial is a prospect, not an enrolment, so they must not eat an enrolment
// number — the client hands those out in one unbroken sequence, and a trial who
// never joins would leave a permanent hole in it. Trials are therefore numbered
// T1, T2, T3 … on their own counter, and are renumbered into the enrolment
// sequence at the moment they convert. That is the only time a student's form
// number ever changes.
//
// Neither counter reuses a number: both take MAX + 1 over every student row,
// soft-deleted ones included, so an archived student's number is never handed
// to somebody else.
import { pool } from '../db';

// Anything with .query — the pool, or a PoolConnection inside a transaction.
type Queryable = { query: (sql: string, params?: any[]) => Promise<any> };

export type StudentType = 'Trial' | 'Enrolled';

const maxOf = async (conn: Queryable, expr: string, pattern: string) => {
  const [rows]: any = await conn.query(
    `SELECT MAX(CAST(${expr} AS UNSIGNED)) AS mx FROM students WHERE form_no REGEXP ?`,
    [pattern]
  );
  return Number(rows[0]?.mx || 0);
};

// 177 enrolled students -> the next one is 178.
export async function nextEnrolledFormNo(conn: Queryable = pool): Promise<string> {
  return String((await maxOf(conn, 'form_no', '^[0-9]+$')) + 1);
}

// T1, T2, T3 … counted independently of the enrolment numbers.
export async function nextTrialFormNo(conn: Queryable = pool): Promise<string> {
  return `T${(await maxOf(conn, 'SUBSTRING(form_no,2)', '^T[0-9]+$')) + 1}`;
}

// Give a student row its form number. Used on create, and again on conversion
// when a trial trades its T-number for a real one.
export async function claimFormNo(
  studentId: number | string,
  studentType: StudentType,
  conn: Queryable = pool
): Promise<string> {
  // Two admins adding a student at the same instant read the same MAX. form_no
  // is UNIQUE, so the loser's UPDATE fails instead of duplicating — take the
  // next number and try again rather than handing out a clash.
  for (let attempt = 0; ; attempt++) {
    const formNo =
      studentType === 'Trial' ? await nextTrialFormNo(conn) : await nextEnrolledFormNo(conn);
    try {
      await conn.query('UPDATE students SET form_no = ? WHERE id = ?', [formNo, studentId]);
      return formNo;
    } catch (e: any) {
      if (e?.code !== 'ER_DUP_ENTRY' || attempt >= 4) throw e;
    }
  }
}

// Enrolment numbers in numeric order, then the trials by their T-number.
// Plain CAST would read every 'T3' as 0 and pile the trials on top of form 1.
export const formNoOrder = (col = 'form_no') =>
  `CASE WHEN ${col} REGEXP '^[0-9]+$' THEN 0 ELSE 1 END, ` +
  `CAST(REGEXP_REPLACE(${col},'[^0-9]','') AS UNSIGNED), ${col}`;
