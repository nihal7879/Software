import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

/**
 * What a failure is allowed to say to the browser.
 *
 * It used to end with `err.message`, whatever that was. A MySQL driver error
 * went straight out to the screen — "Unknown column 'request_note' in 'field
 * list'" was shown to the office for a week — and ER_DUP_ENTRY sent
 * `err.sqlMessage`, which names the table, the column and the key. That is a
 * map of the database handed to anyone with a browser, and it is unreadable
 * to the person it is shown to, who only knows that something broke.
 *
 * So: a message reaches the browser only when it was written for a person.
 * Everything else is logged in full here and answered with one sentence and a
 * reference, which is the thing to search the logs for.
 */

/** A driver or connection failure, as opposed to something we chose to say. */
function isInternal(err: any): boolean {
  if (err?.sqlMessage || err?.sqlState) return true;
  const code = String(err?.code || '');
  return /^(ER_|PROTOCOL_|ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_)/.test(code);
}

/** Short, unique enough to find one line in a day of logs. */
function reference(): string {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    // The first failed rule, in words the form can show as-is ("Password must
    // include at least one number.") — a bare "Validation failed" told nobody
    // what to fix. The full breakdown stays in `details`.
    return res.status(400).json({ error: err.issues[0]?.message || 'Validation failed', details: err.flatten() });
  }

  const ref = reference();
  const status = Number(err?.status) || 500;

  if (err?.code === 'ER_DUP_ENTRY') {
    // The fact of the clash is useful; which index it was is not the caller's
    // business. The detail stays in the log.
    console.error(`[${ref}] ${req.method} ${req.originalUrl} duplicate:`, err?.sqlMessage || err);
    return res.status(409).json({
      error: 'That already exists. Please check the details and try again.',
      ref,
    });
  }

  /**
   * Ours to show: a 4xx that a route raised deliberately, with wording meant
   * for a person. A 500 never is — by the time something is a 500 nobody
   * wrote the sentence.
   */
  const written = typeof err?.message === 'string' && err.message.length > 0 && err.message.length < 300;
  if (!isInternal(err) && status >= 400 && status < 500 && written) {
    return res.status(status).json({ error: err.message });
  }

  console.error(`[${ref}] ${req.method} ${req.originalUrl}`, err);
  res.status(status >= 500 ? status : 500).json({
    error: 'Something went wrong at our end. Please try again, or tell the institute admin.',
    ref,
  });
}

// Wrap async handlers so thrown errors hit errorHandler.
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
