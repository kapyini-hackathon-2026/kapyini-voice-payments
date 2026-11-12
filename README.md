# KAPYIŊI — voice-first payments on PayPal

*Kapyiŋi* means **tree** in Senoufo. It is the name of our agent.

A voice-first payment assistant for people who are blind, have low vision, or cannot read, and for anyone who would rather talk than type. Built on the **PayPal Sandbox** for the PayPal AI Hackathon 2026.

Kapyiŋi shows what PayPal could feel like with an assistant built in. You touch one big circle and speak: "envoie trente euros à mon frère", "je veux payer ma facture", "qu'est-ce qui s'est passé avec mon dernier paiement ?". Kapyiŋi reads the payment back, asks for your **fingerprint or Face ID** (or, without one, to **say the amount back**), hands you over to PayPal to approve, and tells you the result only once PayPal confirms it. People who prefer the usual screens choose the **classic mode**, and Kapyiŋi stays silent. Everything runs on the Sandbox, with test accounts and play money.

## Two modes, chosen by the user

On first launch Kapyiŋi asks aloud: *"Shall I speak every time you open the app?"*

- **Yes → voice mode.** Kapyiŋi's night-blue stage opens, asks your first name, and turns on the device's **fingerprint / Face ID** (a passkey). On later visits, one touch and Kapyiŋi greets you by name. Keys on a computer: Space to talk, Esc to stop, R to repeat.

- **No → classic mode.** The usual screens (send, payment requests, activity) and Kapyiŋi stays silent.

## Your own space

Every user has their own Kapyiŋi space: their own **contacts**, **history**, **fingerprints** and **settings** (first name, PayPal Sandbox address). Nobody else sees them.

- **No e-mail, no password.** Choosing a mode on first launch creates the space on that device. Turning on the fingerprint lets the user come back to it later, on this device or another one: "I already have a space: use my fingerprint". One fingerprint per device, as many devices as needed.

- **Demo contacts to start.** A new space receives a copy of the demo contacts (Sandbox accounts set up by the team, from `data/contacts.json` or `CONTACTS_JSON`), so it can be tried at once. After that the copy is the user's own: Settings → *Manage my contacts* adds, edits or removes people without touching anyone else's list. Every address must be a PayPal Sandbox account.

- **Payment requests** are looked for at the PayPal Sandbox address set in the user's settings (by default `PAYPAL_PAYER_EMAIL`).

- **Leaving** the space on a device closes its session there. Without a fingerprint, a space cannot be opened again.

The choice of mode is remembered, and a "Voice mode / Classic mode" button on every screen changes it in one touch. Voice mode is for anyone who prefers to talk. Kapyiŋi never guesses who is blind.

## The three locks

| Lock | Who decides | Against | How |

| --- | --- | --- | --- |

| 1. Rules | Kapyiŋi's code, no AI | a tricked AI, odd amounts, duplicates | known contact, per-payment limit, open currency, same payment twice within 2 min needs consent, a prepared request lasts 5 min and works once, `PayPal-Request-Id` on every money call |

| 2. Intent and owner | the user, on their own device | misheard words, a reflex "yes", someone else's voice | read-back first ("oui" only moves on), then **the fingerprint** (WebAuthn passkey with user verification, a challenge bound to that one payment, signature checked by the server). Without a passkey: the amount must be **said back** ("j'envoie trente euros") |

| 3. Authorisation | PayPal | someone else holding the phone | log in and approve on PayPal's own page; Kapyiŋi never acts there |

A bare "oui", "ok" or "je confirme" never sends money. A different amount said at the confirmation stops and asks. A voice payment on a device with a passkey is refused by the server without a valid fingerprint signature for that payment.

**Why a fingerprint and not a voiceprint.** Browsers offer no speaker-verification API, and a voice can be recorded or imitated. A passkey is the web standard (WebAuthn): the fingerprint stays in the phone, the server only checks a signature.

**What still happens on PayPal's page.** Kapyiŋi never logs in to PayPal for the user and never handles PayPal passwords. PayPal approves each payment on its own page. To avoid typing there, PayPal lets account holders log in with a passkey in supported countries (to be checked for the user's country and for the Sandbox). PayPal Vault (saving PayPal for later charges) was studied and set aside: it saves a payment method *for a merchant*, needs vetting and supported countries to go live, and does not fit sending money to friends.

## What works

| You say | Kapyiŋi | PayPal API |

| --- | --- | --- |

| "Envoie cent euros à mon frère" | Finds the contact by nickname, reads back, takes spoken corrections ("non, trente", "l'autre Amine"), asks for the amount said back, opens PayPal approval, captures, announces the verified result | Orders v2: create with `payee`, capture, show |

| "Je veux payer ma facture" | Reads the bill aloud (merchant, amount, due date), asks for the amount said back, opens the bill on PayPal, checks when you come back that it is paid | Invoicing v2: search, show (`recipient_view_url`), status |

| "Qu'est-ce qui s'est passé avec mon dernier paiement ?" / "mes opérations" | Refreshes the status from PayPal and says it | Orders v2 / Invoicing v2: show |

| "Ajoute un contact", "change l'adresse de mon frère", "supprime Eddie", "quels sont mes contacts ?" | Asks the name, the nickname, then the Sandbox address (said with "arobase" and "point", or typed), reads everything back, saves only after "oui" (and the fingerprint when the space has one) | none |

| "Combien ai-je sur mon compte ?" | Says honestly that PayPal does not share the balance with outside apps | none |

| "Je veux parler à un conseiller" | Says it cannot reach PayPal staff; offers to call a trusted person or open PayPal help | none |

| "Répète", "annule", "où en suis-je ?", "parle plus lentement", "parle en anglais" | Works at any step, decided without AI | none |

**Not only for blind users.** People who see the screen get the same journey by touch. A transaction card fills itself in (to whom, how much, check, confirm), every spoken answer is also a big numbered button, there is a "Payment requests" page with a two-step Pay button, and you can send with the keyboard. "Je préfère écrire" is there for noisy places or for people who cannot speak.

**How Kapyiŋi talks.** On first launch Kapyiŋi asks aloud whether you use a screen reader. If you do, it speaks only through VoiceOver or TalkBack (an aria-live region), so you never hear two voices. If you don't, it reads its answers aloud, listens again after each question, gives one reminder after a silence, then pauses. Sounds and vibrations mark listening, a read-back, a confirmation and the result.

## Run it
Requirements
- Node.js 22.12 or later and npm.
- A PayPal Developer account.
- Chrome, Edge or Safari for voice input. In Chrome, speech recognition goes through Google's servers.
- An Anthropic API key is optional. Kapyiŋi can use its built-in rules without it.
1. Clone the repository
git clone https://github.com/kapyini-hackathon-2026/kapyini-voice-payments.git
cd kapyini-voice-payments
Run the remaining commands from the project folder.
2. Create PayPal Sandbox accounts
In PayPal Developer, open Apps & Credentials → Sandbox and copy the app's Client ID and Secret. Make sure the Sandbox app has Invoicing enabled.

Keep a Personal Sandbox account as the payer. Create one or more additional Sandbox accounts to act as recipients.
3. Configure the project
Copy the example environment file and contacts file.

macOS / Linux:
cp .env.example .env
cp data/contacts.example.json data/contacts.json
Windows PowerShell:
Copy-Item .env.example .env
Copy-Item data/contacts.example.json data/contacts.json
Open .env and enter the Sandbox app's Client ID and Secret, plus the email address of the Personal payer account in PAYPAL_PAYER_EMAIL. Add ANTHROPIC_API_KEY only if you want to use Claude; it is optional.

Open data/contacts.json and replace the example recipient addresses with the email addresses of the recipient Sandbox accounts you created. Each contact used for a payment must point to a real PayPal Sandbox account.

Do not commit .env or real credentials to Git.
4. Install and build
npm install
npm run build
5. Start Kapyiŋi
npm start
Open http://localhost:3000, create your space, then try: "envoie cinq euros à mon frère". Approve the payment on PayPal using the Personal payer Sandbox account.
Optional: create a demo invoice
After configuring .env, you can run:
npm run demo:invoice
This sends a fictional 45 € invoice to the configured payer account. It requires valid Sandbox credentials and Invoicing enabled on the Sandbox app.
Notes
- If a capture remains pending, the recipient may not hold the currency used for the payment. Set CURRENCIES to the recipient's primary currency (often USD) and restart the app.
- After paying an invoice on PayPal's page, return to Kapyiŋi with the browser's Back button. The invoice flow does not automatically return to the app.
- Voice input requires localhost or HTTPS. For interface development, run npm run dev and npm run dev:web side by side.
## Deploy on Vercel

1. Create a free **Upstash Redis** database (Vercel → Storage → Marketplace, or upstash.com) and copy its REST URL and token. Without it, state is lost between requests and confirmations expire.

2. Import the GitHub repository in Vercel. `vercel.json` already sets the build (`npm run build`), the output (`web/dist`) and routes `/api/*` and `/paypal/*` to the Express app in `api/index.js`.

3. Environment variables: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PAYER_EMAIL`, `APP_URL` (the production address, e.g. `https://kapyini-xxx.vercel.app`, used for PayPal's return and for passkeys), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CONTACTS_JSON`, optional `ANTHROPIC_API_KEY`.

4. Passkeys only work on the address in `APP_URL` (and `EXTRA_ORIGINS`). Preview URLs will not accept the fingerprint registered on production.

Each visitor of the public link gets their own space (contacts, journal, passkeys). They all use the same PayPal app (your Client ID), and pay with a Personal Sandbox account on PayPal's page.

For interface work, run `npm run dev` and `npm run dev:web` side by side. The microphone only works on `localhost` or HTTPS.

## Tests

```bash

npm test

```

50 tests cover:

- the safety rules;

- amounts spoken in words in French and English ("quatre-vingt-dix", "douze euros cinquante");

- nicknames;

- the whole conversation: read-back, spoken correction, "oui" refused at the confirmation, a different amount refused, a negation refused, "l'autre", cancel, repeat and settings;

- a compromised AI that tries to send 9,999 €;

- the bill journey;

- the fingerprint: a voice payment is refused without a valid signature, the keyboard path is not affected;

- contacts by voice: spoken addresses ("arobase", "point"), add / change / remove with a read-back, nothing saved before "oui", a fingerprint needed when the space has one, a contact change never usable as a payment;

- the spaces: no access without a session, each space starts with its own copy of the demo contacts, contacts are checked and can be changed without touching another space, one user can neither see nor confirm another user's payments, passkeys and the payer address belong to one space, an unknown passkey opens nothing;

- both storage back-ends (memory and Redis);

- the honest answers;

- the send flow and the invoice flow against a **fake** PayPal server (idempotency, forged return, decline, cancel, a bill cannot be paid twice).

Fakes prove our logic, not PayPal's or Claude's behaviour. Check the real Sandbox and the real Claude API by hand.

## How it is built

```

phone browser (web/, React + Tailwind)  →  Kapyiŋi server (src/)  →  PayPal Sandbox API

  ring, voice, card, live region              agent, rules, journal      orders, invoices,

                                                    │                    approval pages

                                                    └→ Claude API (understands one sentence, nothing else)

```

- `src/agent.js`: the conversation stages (collect → review → confirm, and the bill stages). Stateless: the draft is re-checked on every turn.

- `src/spoken.js`: amounts said in digits or words → cents. This is what compares the amount said back.

- `src/interpret.js`: sentence → `{ action, contact_name, amount, currency }` with Claude (JSON schema) or with rules; also the conversation words (repeat, cancel, yes, no).

- `src/contacts.js`: name or nickname → contact (accents, one typo).

- `src/accounts.js`: spaces, sessions (an HttpOnly cookie; only a hash of the token is stored), each user's contacts and settings. `src/passkey.js`: each space's passkeys, signing in with the finger, confirming one payment.

- `src/rules.js`, `src/store.js`, `src/paypal.js`, `src/app.js`: checks, journal, PayPal client (Orders v2, Invoicing v2), routes.

- `web/`: React + Vite + Tailwind CSS v4. Atkinson Hyperlegible typeface, light and dark modes, French and English.

## AI tools used

- **At runtime:** Claude Haiku 5.5 (Anthropic API, `claude-haiku-5-5`) turns one transcribed sentence into a structured intent with structured outputs. It receives the sentence and the contacts' names and nicknames only (no e-mails, no PayPal data). It has no tool, and it plays no part in confirming a payment. Speech recognition and synthesis use the browser's Web Speech API.

- **To build it:** Claude (Anthropic) was used as a coding and design assistant.

## License

MIT, see [LICENSE](LICENSE).