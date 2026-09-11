import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    // The first failed rule, in words the form can show as-is ("Password must
    // include at least one number.") — a bare "Validation failed" told nobody
    // what to fix. The full breakdown stays in `details`.
    return res.status(400).json({ error: err.issues[0]?.message || 'Validation failed', details: err.flatten() });
  }
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Duplicate entry', detail: err.sqlMessage });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
}

// Wrap async handlers so thrown errors hit errorHandler.
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
