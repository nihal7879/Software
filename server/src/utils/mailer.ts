import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { query } from '../db';

// Outgoing email over SMTP, and the record of every attempt (email_log).
//
// Until real SMTP credentials are in server/.env, the placeholders are detected
// and nothing is sent: the email is recorded as 'not_configured', so the flows
// that send email (registration, approval, statements) all work and can be
// checked in email_log today, and start really sending the moment the account
// is filled in — no code change.
//
// Sending never throws into the caller. A registration must not fail because
// the mail server is down; the failure is recorded instead.

export type MailKind =
  | 'registration_admin'
  | 'registration_approved'
  | 'hours_statement'
  // Forgot password: the code, and afterwards the "this happened" notice that
  // lets someone notice a reset they did not ask for.
  | 'password_otp'
  | 'password_changed';
export type MailStatus = 'sent' | 'failed' | 'not_configured';

const PLACEHOLDER = /dummy|example\.com|your[-_.]?(email|password)|changeme/i;

/** Whether real SMTP credentials are set (not missing, not the placeholders). */
export function mailConfigured(): boolean {
  const m = config.mail;
  return !!(m.host && m.user && m.pass && m.from) && !PLACEHOLDER.test(m.user) && !PLACEHOLDER.test(m.pass);
}

let transporter: Transporter | null = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465, // 465 = TLS from the start; 587 upgrades with STARTTLS
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
  }
  return transporter;
};

export async function sendMail(opts: {
  kind: MailKind;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
  studentId?: number | null;
  sentBy?: number | null;
}): Promise<{ status: MailStatus; error?: string }> {
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).map((t) => t.trim()).filter(Boolean);
  let status: MailStatus;
  let error: string | undefined;

  if (to.length === 0) {
    status = 'failed';
    error = 'No recipient address';
  } else if (!mailConfigured()) {
    status = 'not_configured';
    error = 'Email is not set up yet (SMTP placeholders in server/.env)';
  } else {
    try {
      await getTransporter().sendMail({
        from: config.mail.from,
        to: to.join(', '),
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        attachments: opts.attachments,
      });
      status = 'sent';
    } catch (e: any) {
      status = 'failed';
      error = String(e?.message || e).slice(0, 500);
    }
  }

  try {
    await query(
      `INSERT INTO email_log (kind, to_address, subject, status, error, attachment, student_id, sent_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [opts.kind, to.join(', ').slice(0, 500) || '(none)', opts.subject.slice(0, 255), status, error ?? null,
        opts.attachments?.map((a) => a.filename).join(', ').slice(0, 255) || null, opts.studentId ?? null, opts.sentBy ?? null]
    );
  } catch (e) {
    console.error('email_log write failed:', e);
  }
  if (status !== 'sent') console.warn(`[mail] ${opts.kind} → ${to.join(', ') || '(none)'}: ${status}${error ? ` — ${error}` : ''}`);
  return { status, error };
}

// ---- the emails themselves ----------------------------------------------------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// One plain, readable layout for every email — no images, so nothing is blocked.
const layout = (title: string, body: string) => `
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <div style="padding:18px 22px;border-bottom:3px solid #f97316">
    <span style="font-size:20px;font-weight:700">STEM <span style="color:#f97316">Vision</span></span>
  </div>
  <div style="padding:22px">
    <h2 style="margin:0 0 14px;font-size:18px">${esc(title)}</h2>
    ${body}
  </div>
  <div style="padding:12px 22px;color:#94a3b8;font-size:12px;border-top:1px solid #e5e7eb">
    This is an automated message from STEM Vision.
  </div>
</div>`;

const row = (label: string, value: unknown) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(label)}</td><td style="padding:4px 0;font-weight:600">${esc(value || '—')}</td></tr>`;

const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#f97316;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${esc(label)}</a></p>`;

/** 1 — to the admin, when a student registers. */
export function registrationAdminEmail(reg: { first_name: string; last_name?: string | null; username?: string | null; email: string; mobile?: string | null }) {
  const name = [reg.first_name, reg.last_name].filter(Boolean).join(' ');
  const link = `${config.mail.appUrl}/admin/registrations`;
  return {
    subject: `New student registration — ${name}`,
    html: layout('A new student has registered', `
      <p>This student is waiting for you to approve them as a Trial or Enrolled student.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Name', name)}${row('Username', reg.username)}${row('Email', reg.email)}${row('Mobile', reg.mobile)}
      </table>
      ${button(link, 'Review registration')}`),
    text: `A new student has registered and is waiting for approval.\n\nName: ${name}\nUsername: ${reg.username || '—'}\nEmail: ${reg.email}\nMobile: ${reg.mobile || '—'}\n\nReview: ${link}`,
  };
}

/** 2 — to the student, when the admin approves them. */
export function registrationApprovedEmail(p: { name: string; username: string; approvedAs: 'Trial' | 'Enrolled'; formNo: string }) {
  const link = `${config.mail.appUrl}/login`;
  const as = p.approvedAs === 'Trial' ? 'a trial student' : 'an enrolled student';
  return {
    subject: 'Your STEM Vision registration is approved',
    html: layout(`Welcome, ${p.name}`, `
      <p>The administrator has verified your registration and added you as ${esc(as)}.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Form No', p.formNo)}${row('Username', p.username)}
      </table>
      <p>Please sign in with your username and the password you chose, and <b>complete your student profile</b>.</p>
      ${button(link, 'Sign in')}`),
    text: `Welcome, ${p.name}.\n\nThe administrator has verified your registration and added you as ${as}.\nForm No: ${p.formNo}\nUsername: ${p.username}\n\nPlease sign in with your username and the password you chose, and complete your student profile:\n${link}`,
  };
}

/** 3 — to a parent, with the hours statement attached. */
export function hoursStatementEmail(p: { studentName: string; formNo: string }) {
  return {
    subject: `Hours statement — ${p.studentName} (Form ${p.formNo})`,
    html: layout('Hours statement', `
      <p>Dear Parent,</p>
      <p>Please find attached the latest hours statement for <b>${esc(p.studentName)}</b> (Form ${esc(p.formNo)}).
      It shows the hours used each month, the fees received and every lecture recorded to date.</p>
      <p>If anything looks wrong, simply reply to this email.</p>`),
    text: `Dear Parent,\n\nPlease find attached the latest hours statement for ${p.studentName} (Form ${p.formNo}). It shows the hours used each month, the fees received and every lecture recorded to date.\n\nIf anything looks wrong, simply reply to this email.`,
  };
}

/**
 * 4 — the code for a forgotten password.
 *
 * The code and nothing else. No password, no sign-in link carrying a token: an
 * old mailbox someone else can open must not be a key to the account. The name
 * is left out too — this email goes to an address that may be shared by a whole
 * family, and it does not need to announce which of them asked.
 */
export function passwordOtpEmail(p: { otp: string; minutes: number }) {
  return {
    subject: `Your STEM Vision code: ${p.otp}`,
    html: layout('Your code', `
      <p>Use this code to set a new password:</p>
      <p style="margin:18px 0;font-size:34px;font-weight:700;letter-spacing:8px;color:#f97316">${esc(p.otp)}</p>
      <p>It works for <b>${p.minutes} minutes</b>, once.</p>
      <p style="color:#64748b">If you did not ask for this, you can ignore this email — nothing has changed on your account.</p>`),
    text: `Use this code to set a new password: ${p.otp}\n\nIt works for ${p.minutes} minutes, once.\n\nIf you did not ask for this, you can ignore this email — nothing has changed on your account.`,
  };
}

/**
 * 5 — sent after a password actually changes.
 *
 * This is the one that lets a family notice a reset they did not ask for, so it
 * goes whether the change came from the reset screen or from Settings.
 */
export function passwordChangedEmail(p: { username: string; when: string }) {
  const link = `${config.mail.appUrl}/login`;
  return {
    subject: 'Your STEM Vision password was changed',
    html: layout('Your password was changed', `
      <p>The password for <b>${esc(p.username)}</b> was changed on ${esc(p.when)}.</p>
      <p>If that was you, there is nothing to do.</p>
      <p><b>If it was not you, please contact the institute straight away</b> — someone else may have used your account.</p>
      ${button(link, 'Sign in')}`),
    text: `The password for ${p.username} was changed on ${p.when}.\n\nIf that was you, there is nothing to do.\n\nIf it was not you, please contact the institute straight away — someone else may have used your account.\n\n${link}`,
  };
}
