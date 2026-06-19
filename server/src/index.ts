import app from './app';
import { config } from './config';

// Local development only. On Vercel the app is served as a serverless
// function (see server/api/index.ts), where app.listen() is not used.
app.listen(config.port, () => {
  console.log(`🚀 Classroom API on http://localhost:${config.port}`);
});
