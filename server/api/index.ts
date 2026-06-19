// Vercel serverless entry point.
// An Express app is itself a (req, res) handler, so Vercel can invoke it
// directly. All requests are routed here via server/vercel.json, and Express
// does its own internal routing (/api/auth, /api/students, ...).
import app from '../src/app';

export default app;
