import dotenv from 'dotenv';
dotenv.config();

// The app's own clock, for the few dates it works out itself (a joining date,
// "this month"). Vercel runs on UTC, which is 4 hours behind the institute, so
// a record created late in the Dubai evening landed on the previous day. Set
// before anything reads a date. On Vercel, set TZ=Asia/Dubai in the project's
// environment variables as well — this line covers local runs and scripts.
process.env.TZ = process.env.TZ || 'Asia/Dubai';

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
  // A student's sign-in lasts far longer than anyone else's, because the only
  // thing most of them open the app for is to scan the QR on a teacher's desk —
  // and being asked for a password at the classroom door, on a phone, every time
  // is the difference between attendance being recorded and not.
  //
  // They see their own attendance and nothing else; an admin on a shared office
  // machine sees every family's fees, which is why that one is left alone.
  //
  // Fifteen days, matching the inactivity limit the app applies (client
  // AuthContext). A token is not reissued as they go, so in practice this is
  // what signs a student out: fifteen days after signing in, or fifteen days of
  // not opening it, whichever comes first.
  jwtExpiresInStudent: process.env.JWT_EXPIRES_IN_STUDENT || '15d',
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
  // Speech to text (AssemblyAI). Empty until the key is set, so anything using
  // it can check first rather than calling with no key.
  assemblyAiKey: process.env.ASSEMBLYAI_API_KEY || '',
  // Web push. The pair identifies this server to every browser's push service:
  // the public half is handed to the browser when it subscribes, the private
  // half signs what we send. Generated once with web-push and then left alone —
  // replacing them silently kills every subscription anyone has already allowed.
  // Empty means push is off, and utils/push.ts records that rather than failing.
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    // A contact the push service can use if our notifications cause trouble.
    subject:
      process.env.VAPID_SUBJECT ||
      (process.env.ADMIN_NOTIFY_EMAIL ? `mailto:${process.env.ADMIN_NOTIFY_EMAIL}` : 'mailto:contact@stemvision.ae'),
  },
};








































