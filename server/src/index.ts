import express from 'express';
import cors from 'cors';
import { config } from './config';
import { notFound, errorHandler } from './middleware/error';

import authRoutes from './routes/auth';
import studentRoutes from './routes/students';
import lectureRoutes from './routes/lectures';
import feeRoutes from './routes/fees';
import teacherRoutes from './routes/teachers';
import analyticsRoutes from './routes/analytics';
import managementRoutes from './routes/management';

const app = express();

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'tuition-erp', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/lectures', lectureRoutes);
app.use('/api/fees', feeRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/management', managementRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Tuition ERP API on http://localhost:${config.port}`);
});
