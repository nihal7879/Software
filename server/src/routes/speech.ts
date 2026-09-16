import { Router } from 'express';
import { config } from '../config';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../middleware/error';

/**
 * Speak a lecture remark instead of typing it.
 *
 * The browser streams the microphone straight to AssemblyAI (Universal-Streaming,
 * English) over a WebSocket, so the words appear while the teacher is still
 * talking — there is no clip to upload and wait for after they stop.
 *
 * The API key never leaves the server: the browser asks here for a short-lived
 * token, which is only good for opening one streaming session.
 */
const router = Router();
router.use(requireAuth, requireRole('admin', 'faculty'));

const TOKEN_URL = 'https://streaming.assemblyai.com/v3/token';
// Long enough to open the connection, short enough to be worth little if it
// leaks. It only gates starting a session, not how long one may run.
const TOKEN_TTL_SECONDS = 60;

router.get(
  '/token',
  wrap(async (_req, res) => {
    if (!config.assemblyAiKey) {
      return res.status(503).json({ error: 'Speech to text is not set up on the server.' });
    }
    const r = await fetch(`${TOKEN_URL}?expires_in_seconds=${TOKEN_TTL_SECONDS}`, {
      headers: { authorization: config.assemblyAiKey },
    });
    const j: any = await r.json();
    if (!r.ok || !j?.token) {
      return res.status(502).json({ error: j?.error || 'Could not start speech to text.' });
    }
    res.json({ token: j.token, expires_in: TOKEN_TTL_SECONDS });
  })
);

export default router;
