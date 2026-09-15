import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tuition_erp',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  // Outgoing email (SMTP). Placeholders in .env until the real account is set;
  // utils/mailer.ts treats those as "not set up" and records instead of sending.
  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
    adminNotify: process.env.ADMIN_NOTIFY_EMAIL || '',
    appUrl: (process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
  },
};








































