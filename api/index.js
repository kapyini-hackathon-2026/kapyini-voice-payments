// Vercel entry point: every /api/* and /paypal/* request is handled by the same Express app.
// The interface itself (web/dist) is served by Vercel directly.
import { buildServer } from '../src/server.js';

const { app, notes } = buildServer();
for (const n of notes) console.log(n);
export default app;
