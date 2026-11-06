# Changelog

## 1.2.0 — 2026-11-06

- **One space per user.** Each user has their own contacts, history, fingerprints and settings. A space is created on first launch (no e-mail, no password) and kept by a session cookie; the fingerprint signs the user back in, on any device ("I already have a space").
- **Passkeys per user**, one per device. A voice payment needs a signature from one of *that* user's passkeys.
- **My contacts**: a new space starts with a copy of the demo contacts; the user adds, edits or removes contacts (name, nicknames, Sandbox address) without touching anyone else's. Saying "ouvre mes contacts" opens the page.
- **Payer address per user** in Settings, for payment requests (default: `PAYPAL_PAYER_EMAIL`).
- The journal keeps the recipient's name at the time of payment, so renaming or removing a contact does not rewrite it.
- Added `.env.example` and `data/contacts.example.json`, which the README asked to copy but were missing.
- 44 automated tests.

**Upgrading:** fingerprints registered with 1.1 belonged to the shared demo user and are no longer used. Turn the fingerprint on again from the welcome screen or Settings.

## 1.1.0 — 2026-11-05

- **New name: KAPYIŊI** ("tree" in Senoufo), for the project and its agent. New tree mark in the logo.
- The voice reads the name with an approximate spelling, set in `web/src/lib/brand.js`, because speech engines do not know the letter ŋ.
- Upstash Redis variables from Vercel's Storage tab (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) are accepted.

## 1.0.0 — 2026-11-04

First complete version for the PayPal AI Hackathon 2026.

- **Modes.** Voice mode or classic mode, chosen aloud on first launch, remembered, switchable from every screen.
- **Voice mode.** Night-blue stage with the waveform disc. One gesture to talk or interrupt; Space, Esc and R on a computer. Greets the user by name.
- **Confirmation.** Read-back first ("oui" only moves on), then fingerprint / Face ID through WebAuthn passkeys, verified by the server for that one payment. Without a passkey, the amount must be said back.
- **Understanding.** Claude Haiku 5.5 with structured outputs, or built-in rules. Names matched by sound, numbered lists ("le deuxième"), nicknames ("mon frère").
- **PayPal Sandbox.** Send money with Orders v2 (create, approve, capture, verify). Payment requests with Invoicing v2 (read aloud, pay on PayPal, check status). Decline test with negative testing.
- **Classic mode.** Home, sending with the keyboard, payment requests, activity, settings.
- **Deployment.** Local Node server, or Vercel with Upstash Redis.
- 32 automated tests.

## 0.3.0 — 2026-11-03
Voice-only navigation, sound-alike names, wider understanding.

## 0.2.0 — 2026-11-02
Spoken read-back and confirmation, payment requests, Tailwind interface.

## 0.1.0 — 2026-11-01
Accessible send-money flow on the PayPal Sandbox; first voice agent; React interface.
