// Builds the whole Kapyiŋi server from environment variables.
// Used by `npm start` (src/index.js) and by Vercel (api/index.js).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createPayPalClient } from './paypal.js';
import { createStore } from './store.js';
import { createInterpreter } from './interpret.js';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export function buildServer(env = process.env) {
  const environment = env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
  // This prototype is built and tested for the Sandbox only.
  if (environment === 'live') throw new Error('PAYPAL_ENV=live is not supported by this prototype. Use the Sandbox.');

  const port = Number(env.PORT || 3000);
  const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
  const appUrl = (env.APP_URL || vercelUrl || `http://localhost:${port}`).replace(/\/$/, '');
  const config = {
    environment,
    port,
    appUrl,
    // Passkeys are tied to a web address: list every address the app is opened from.
    origins: [appUrl, ...(env.EXTRA_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean)],
    currencies: (env.CURRENCIES || 'EUR,USD').split(',').map((c) => c.trim().toUpperCase()),
    limitCents: Math.round(Number(env.LIMIT_PER_PAYMENT || 200) * 100),
    payerEmail: env.PAYPAL_PAYER_EMAIL || null,
    trusted: env.TRUSTED_NAME ? { name: env.TRUSTED_NAME, phone: env.TRUSTED_PHONE || null } : null,
    helpUrl: env.HELP_URL || 'https://www.paypal.com/us/cshelp/contact-us',
  };

  // Contacts: CONTACTS_JSON (for Vercel, where data/contacts.json is not deployed), else the files.
  let contacts;
  let contactsFrom;
  if (env.CONTACTS_JSON) {
    contacts = JSON.parse(env.CONTACTS_JSON);
    contactsFrom = 'CONTACTS_JSON';
  } else {
    const file = existsSync(root('data/contacts.json')) ? root('data/contacts.json') : root('data/contacts.example.json');
    contacts = JSON.parse(readFileSync(file, 'utf8'));
    contactsFrom = file.split('/').slice(-2).join('/');
  }

  const paypal = env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET
    ? createPayPalClient({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET, baseUrl: env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com' })
    : null;

  // On Vercel the disk is read-only and memory is not shared between requests: use Redis there.
  // Upstash created from Vercel's Storage tab names its variables KV_REST_API_URL / KV_REST_API_TOKEN.
  const redisUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const redis = redisUrl && redisToken ? { url: redisUrl, token: redisToken } : null;
  const store = createStore({ redis, file: env.VERCEL ? null : root('data/operations.json') });

  const aiModel = env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
  const interpret = createInterpreter({ apiKey: env.ANTHROPIC_API_KEY, model: aiModel });
  const app = createApp({ config, contacts, store, paypal, interpret, aiName: env.ANTHROPIC_API_KEY ? aiModel : null, serveStatic: !env.VERCEL });

  const notes = [
    `Contacts loaded from ${contactsFrom}`,
    env.ANTHROPIC_API_KEY ? `Understanding sentences with ${aiModel}` : 'No ANTHROPIC_API_KEY: sentences are understood with built-in rules',
    paypal ? 'PayPal Sandbox configured' : 'PayPal Sandbox not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET',
    `Storage: ${store.kind}${env.VERCEL && store.kind === 'memory' ? ' (WARNING: on Vercel, set UPSTASH_REDIS_REST_URL and _TOKEN, or confirmations will expire)' : ''}`,
  ];
  return { app, config, notes };
}
