import { query } from '../db';
import { CREDITED_EXPR, CONSUMED_EXPR } from './hoursSummary';

/**
 * When a fee reminder is raised, and what it says.
 *
 * The institute's rule, given on 18 November 2026:
 *
 *   hours_left <= 5   →  ask for the next top-up
 *   hours_left <= 0   →  classes on hold
 *   hours_left <= -2  →  they are into an overdraft
 *
 * At most three reminders per cycle, and no more. Nothing fires between 5 and
 * 0, and nothing fires at -3, -4, -5: the institute was clear that an
 * overdraft is ONE conversation, not a new row every hour. Four rows saying
 * the same thing is how a screen stops being read.
 *
 * The test is always "at or beyond", never "landed on". Two consequences the
 * institute asked for by name:
 *
 *   A student on 1 hour has a 3-hour lecture entered, so they go straight to
 *   -2. That crosses the zero step AND the overdraft step in one go. Only ONE
 *   reminder is raised, at the furthest step reached — the overdraft. Telling
 *   the office twice about one lecture is noise.
 *
 *   A student who drops from -1 to -6 without ever sitting at -2 still gets
 *   the overdraft reminder, raised at -6, and the message says six hours,
 *   because six hours is what it is.
 *
 * In both cases the message carries the student's REAL balance, not the step
 * that triggered it.
 *
 * None of those numbers are written here. They live in app_settings, because
 * "chase them at 5 hours" is an institute's policy, not a program's fact — and
 * the week they decide it should be 8, or that two hours of goodwill should be
 * three, nobody should have to wait for a release. The defaults below are only
 * what a database without the migration falls back to.
 *
 * Each step fires ONCE. A student sitting at -4 who takes another hour raises
 * a -5, not a second -4 — otherwise the office opens the screen on Monday to
 * forty rows about the same four families and stops reading it.
 *
 * Paying restarts the chain. That is what `credited_hours` on the last
 * reminder is for: a higher credited total now than when they were last
 * reminded means money came in between, so the next fall to 5 hours is a new
 * conversation, not a repeat of the old one.
 */

export type ReminderConfig = {
  enabled: boolean;
  /** The first warning, when the balance falls to this many hours. */
  firstHours: number;
  /** The overdraft warning, when the balance reaches this OR ANYTHING BEYOND IT. */
  overdraftFrom: number;
  /** An overdraft this deep or worse gets the firmer wording. */
  hardenAt: number;
  textFirst: string;
  textZero: string;
  textOver: string;
  textOverHard: string;
  /** Bank details and sign-off, the same on every fee message the institute sends. */
  signature: string;
};

export const DEFAULTS: ReminderConfig = {
  enabled: true,
  firstHours: 5,
  overdraftFrom: -2,
  hardenAt: -5,
  // Written in the institute's own voice, taken from the fee messages they
  // have actually been sending parents on WhatsApp through 2026 — the
  // "Dear parent, greetings from Stem Vision" opening, "We request you to
  // kindly…", "exceeded {n} hours of lectures", "will be adjusted in this
  // package renewal". Not a tone invented here.
  //
  // The package amount is deliberately not in them: it is AED 4200 for 30
  // hours for some, 2100 for 15, 1900 for 15, 4200 for 35 for one long-
  // standing family. The system does not know which, and a wrong amount in a
  // fee message is worse than no amount, so the office adds it.
  textFirst:
    'Dear parent, greetings from Stem Vision.\n\n' +
    'This is to inform you that {name} has {n} hours remaining in the current package. ' +
    'We request you to kindly renew the package so that the lectures continue without any break.',
  textZero:
    'Dear parent, greetings from Stem Vision.\n\n' +
    'This is to inform you that the package hours for {name} are now complete. ' +
    'We request you to kindly renew the package at the earliest so that the lectures continue without any break.',
  textOver:
    'Dear parent, greetings from Stem Vision.\n\n' +
    'Please note that {name} has exceeded {n} hours of lectures. ' +
    'We request you to kindly renew the package at the earliest. ' +
    'Kindly note that the previous {n} hours will be adjusted in this package renewal.',
  // Deeper, but not harsher. The institute does not threaten parents in any
  // message in that chat, and a system that suddenly does would not sound
  // like them. What it adds is the real consequence they do mention: slots.
  textOverHard:
    'Dear parent, greetings from Stem Vision.\n\n' +
    'Please note that {name} has exceeded {n} hours of lectures. ' +
    'We request you to kindly clear the balance at the earliest so that we can continue to block the lecture slots for {name}. ' +
    'Kindly note that the previous {n} hours will be adjusted in the package renewal.',
  // Exactly the block they paste under every fee message.
  signature:
    'Pls find the bank details for fees transfer: INITIUM EDUCATIONAL SERVICES FZCO\n' +
    'Account Number : 019101766738\n' +
    'IBAN Number : AE340330000019101766738\n' +
    'Currency : AED\n' +
    'BANK NAME: MASHREQ NEOBIZ\n\n' +
    'Kindly let us know once the fees is paid.\n\n' +
    'Thanking you in anticipation.',
};

export const KEYS = {
  enabled: 'reminders_enabled',
  firstHours: 'reminder_first_hours',
  overdraftFrom: 'reminder_overdraft_from',
  hardenAt: 'reminder_harden_at',
  textFirst: 'reminder_text_first',
  textZero: 'reminder_text_0',
  textOver: 'reminder_text_over',
  textOverHard: 'reminder_text_over_5',
  signature: 'reminder_signature',
} as const;

// Read once every few seconds rather than on every student in the scan. A
// change applies within the cache window, the same way the lock switches do.
const CACHE_MS = 10_000;
let cached: { at: number; cfg: ReminderConfig } | null = null;

/** A setting that has been emptied or mistyped falls back rather than breaking the scan. */
const num = (raw: string | undefined, fallback: number) => {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
};
const text = (raw: string | undefined, fallback: string) => {
  const s = String(raw ?? '').trim();
  return s ? s : fallback;
};

export async function reminderConfig(): Promise<ReminderConfig> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.cfg;
  const rows = await query<any>('SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?)', [Object.values(KEYS)]);
  const v: Record<string, string> = {};
  for (const r of rows) v[r.setting_key] = String(r.setting_value ?? '');

  const cfg: ReminderConfig = {
    enabled: (v[KEYS.enabled] ?? '1') === '1',
    firstHours: Math.max(0, num(v[KEYS.firstHours], DEFAULTS.firstHours)),
    // An overdraft step must be at or below zero, or the rule contradicts itself.
    overdraftFrom: Math.min(0, num(v[KEYS.overdraftFrom], DEFAULTS.overdraftFrom)),
    hardenAt: Math.min(0, num(v[KEYS.hardenAt], DEFAULTS.hardenAt)),
    textFirst: text(v[KEYS.textFirst], DEFAULTS.textFirst),
    textZero: text(v[KEYS.textZero], DEFAULTS.textZero),
    textOver: text(v[KEYS.textOver], DEFAULTS.textOver),
    textOverHard: text(v[KEYS.textOverHard], DEFAULTS.textOverHard),
    signature: text(v[KEYS.signature], DEFAULTS.signature),
  };
  cached = { at: Date.now(), cfg };
  return cfg;
}

/** Called after a change so the next scan uses it immediately. */
export const clearReminderCache = () => { cached = null; };

/**
 * What the balance has reached, or null when there is nothing to say.
 *
 * The returned number is what the row stores and the screen shows: the first
 * warning returns `firstHours` (5), zero returns 0, and an overdraft returns
 * how deep it actually is (-2, or -6 if that is where they landed).
 */
export function tierFor(hoursLeft: number, cfg: ReminderConfig): number | null {
  if (hoursLeft > cfg.firstHours) return null;
  if (hoursLeft > 0) return cfg.firstHours;
  if (hoursLeft > cfg.overdraftFrom) return 0;
  // Towards zero, so -2.4 reads "2 hours beyond the package" and not three.
  // The parent is told what they owe, never more than they owe.
  return Math.ceil(hoursLeft);
}

/**
 * Which of the three conversations this is: 1 running low, 2 out of hours,
 * 3 overdrawn. A student only ever moves forward through them, and only once
 * each — going deeper into an overdraft is still conversation 3.
 */
const stageOf = (tier: number) => (tier > 0 ? 1 : tier === 0 ? 2 : 3);

/** 3 → "3", 1.5 → "1.5", 2.82 → "2.82". No trailing zeros in a sentence. */
export function hoursWord(n: number): string {
  const r = Math.round(Math.abs(n) * 100) / 100;
  return String(r).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/**
 * Fill a template. Unknown placeholders are left alone rather than blanked.
 *
 * `{n}` is the student's ACTUAL balance, never the threshold. This was wrong
 * at first: a student with one hour left was told "you have 5 hours left",
 * because 5 is where the rule fires, not where they are. A parent reading
 * that would believe they had four more hours than they do, and the one
 * person it would be embarrassing in front of is the one being asked to pay.
 */
export function renderMessage(
  tier: number,
  hoursLeft: number,
  student: { full_name: string; form_no: string },
  cfg: ReminderConfig
): string {
  const raw =
    tier > 0 ? cfg.textFirst
      : tier === 0 ? cfg.textZero
        : tier <= cfg.hardenAt ? cfg.textOverHard
          : cfg.textOver;
  return raw
    .replace(/\{name\}/g, student.full_name || `Form ${student.form_no}`)
    .replace(/\{form_no\}/g, student.form_no || '')
    .replace(/\{n\}/g, hoursWord(hoursLeft))
    // "has 1 hours left" is the sort of thing a parent notices and an office
    // gets blamed for. Done here rather than in the template so the institute
    // can reword freely without having to think about it.
    .replace(/\b1 hours\b/g, '1 hour');
}

type Candidate = {
  id: number;
  full_name: string;
  form_no: string;
  hours_left: string | number;
  credited: string | number;
  last_tier: number | null;
  last_credited: string | number | null;
};

/**
 * Raise whatever is now due. Safe to call as often as you like: it only ever
 * inserts a step a student has not already been told about since they last
 * paid, so calling it twice in a second writes nothing the second time.
 *
 * Trial students are left out — they have no package to top up, and a trial
 * running to zero is the trial ending, not an unpaid bill.
 *
 * So is anyone who has never had a single hour credited. Checked against the
 * live database on 18 November 2026, five active students would otherwise have
 * been chased on the first run:
 *
 *   Form 12  Shenon Dsouza        0 credited, 386.53 consumed  →  "-386 hours"
 *   Form 13  Praney Rajiv Thakur  0 credited, 304.04 consumed  →  "-304 hours"
 *   Form 146 Arya Anand Awasthi   0 credited, 167.85 consumed
 *   Form 160 Ashmitha Parthiban   0 credited, 109.75 consumed
 *   Form 205 Aanya Saincher       no package at all, joined 2 Nov
 *
 * The first four have active fee packages carrying zero hours — somebody
 * recorded the payment and never recorded what it bought. The fifth is simply
 * new. None of them owe the institute 386 hours, and telling a parent so would
 * be worse than telling them nothing. A balance with nothing ever credited is
 * a bookkeeping gap, and the fix for it is in Finance, not a phone call.
 *
 * Returns how many rows were written, for the log.
 */
export async function raiseDueReminders(): Promise<number> {
  const cfg = await reminderConfig();
  if (!cfg.enabled) return 0;

  // Wrapped in a subquery rather than filtered with HAVING: sql_mode here
  // includes ONLY_FULL_GROUP_BY, and a HAVING with no GROUP BY is the kind of
  // thing that works on one server and is refused on the next.
  const rows = await query<Candidate>(
    `SELECT * FROM (
       SELECT s.id, s.full_name, s.form_no,
              ${CREDITED_EXPR} - ${CONSUMED_EXPR} AS hours_left,
              ${CREDITED_EXPR}                    AS credited,
              (SELECT r.tier           FROM reminders r WHERE r.student_id = s.id AND r.is_deleted = FALSE ORDER BY r.id DESC LIMIT 1) AS last_tier,
              (SELECT r.credited_hours FROM reminders r WHERE r.student_id = s.id AND r.is_deleted = FALSE ORDER BY r.id DESC LIMIT 1) AS last_credited
         FROM students s
        WHERE s.is_deleted = FALSE
          AND s.is_active = TRUE
          AND s.status = 'Active'
          AND s.student_type <> 'Trial'
     ) t
     WHERE t.hours_left <= ?
       AND t.credited > 0`,
    [cfg.firstHours]
  );

  let written = 0;
  for (const r of rows) {
    const left = Number(r.hours_left);
    const credited = Number(r.credited);
    const tier = tierFor(left, cfg);
    if (tier === null) continue;

    // A top-up since the last reminder starts the conversation again.
    // The tolerance is for DECIMAL round-tripping, not for small payments.
    const paidSince = r.last_credited != null && credited > Number(r.last_credited) + 0.001;
    // Only ever forward, and only once each. A student already reminded about
    // their overdraft at -2 who sinks to -6 raises nothing: it is the same
    // conversation, and the office asked not to be told about it four times.
    if (r.last_tier != null && !paidSince && stageOf(tier) <= stageOf(Number(r.last_tier))) continue;

    await query(
      `INSERT INTO reminders (student_id, tier, hours_left, credited_hours, message, raised_at)
       VALUES (?,?,?,?,?,NOW())`,
      [r.id, tier, left.toFixed(2), credited.toFixed(2), renderMessage(tier, left, r, cfg)]
    );
    written++;
  }
  return written;
}
