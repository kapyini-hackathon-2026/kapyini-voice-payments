// Vercel entry point: every /api/* and /paypal/* request is handled by the same Express app.
// The interface itself (web/dist) is served by Vercel directly.
import { buildServer } from '../src/server.js';

// If the configuration is wrong (e.g. CONTACTS_JSON is not valid JSON), answer every request
// with a readable message instead of Vercel's bare FUNCTION_INVOCATION_FAILED page.
let handler;
try {
  const { app, notes } = buildServer();
  for (const n of notes) console.log(n);
  handler = app;
} catch (err) {
  console.error('Kapyiŋi could not start:', err);
  handler = (_req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ errors: ['SERVER_NOT_STARTED'], detail: String(err.message || err) }));
  };
}
export default handler;
