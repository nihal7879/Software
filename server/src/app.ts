import express from 'express';
import cors from 'cors';
import { config } from './config';
import { notFound, errorHandler } from './middleware/error';
import { requestContext } from './utils/reqContext';

import authRoutes from './routes/auth';
import studentRoutes from './routes/students';
import lectureRoutes from './routes/lectures';
import feeRoutes from './routes/fees';
import teacherRoutes from './routes/teachers';
import analyticsRoutes from './routes/analytics';
import managementRoutes from './routes/management';

const app = express();

// Behind Vercel / a reverse proxy — trust X-Forwarded-* so req.ip is the real client IP.
app.set('trust proxy', true);

// CORS: allow the configured client origin. Set CLIENT_ORIGIN="*" to allow any
// (fine when the frontend reaches the API through a same-origin Vercel rewrite).
app.use(
  cors(
    config.clientOrigin === '*'
      ? { origin: true }
      : { origin: config.clientOrigin, credentials: true }
  )
);
app.use(express.json({ limit: '2mb' }));

// Capture IP + GPS per request so every audit() call records origin.
app.use(requestContext);

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, service: 'classroom', time: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/lectures', lectureRoutes);
app.use('/api/fees', feeRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/management', managementRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
