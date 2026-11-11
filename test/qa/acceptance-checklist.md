# Kapyiŋi — QA acceptance checklist

Owner: Gueriatou | Branch: `feat/tests` | Test window: 10–11 November 2026

## Rules

- Run `npm test` after merging code and **record the command result**; don't assume it tests real PayPal.
- Use only PayPal Sandbox test accounts. Never paste credentials, API keys, passkey assertions, or `.env` into a bug report.
- For every failure capture device, OS/browser, app commit SHA, reproduction steps, expected/actual result, and sanitized evidence.
- Gueriatou owns tests, video preparation and English language entries. Wahon owns voice behavior, other `web/` changes, agent and passkey code; Eddie owns PayPal, README and deployment.
- `PASS` means personally verified. Use `NOT RUN` until a case is exercised; do not mark a scripted or mocked flow as live validation.
- Repeat on the production origin when available: passkeys are origin-bound.

## Environment to record

| Field | Value |
|---|---|
| Date / time | TBD |
| Commit SHA | TBD |
| Production/demo URL | TBD |
| Device & OS | TBD |
| Browser & version | TBD |
| Audio setup | Speaker / headset |
| Screen reader | Off / VoiceOver / TalkBack |
| Sandbox account type | Personal payer + intended merchant/payee |
| Currency | TBD |
| Test reporter | Gueriatou |

## Priority P0: payment authorization and safety

| ID | Scenario / steps | Expected result | Status |
|---|---|---|---|
| P0-01 | Ask to pay a saved contact, then deliberately change amount before confirmation | Correct contact, amount and currency are read back; no PayPal approval without a new explicit confirmation | NOT RUN |
| P0-02 | Say **Cancel** at the transaction confirmation | No order capture; clear cancellation feedback | NOT RUN |
| P0-03 | Start a transaction, then remain silent | No automatic approval/capture on timeout or silence | NOT RUN |
| P0-04 | Authenticate a payment using a supported passkey | User verification is requested; server checks the response; transaction is bound to the confirmed details | NOT RUN |
| P0-05 | Reject or cancel the passkey prompt | Payment is not authorized; recovery is announced | NOT RUN |
| P0-06 | Open a preview URL and then the configured production origin | Record whether passkey works only for the intended origin; no misleading generic success message | NOT RUN |
| P0-07 | On a device without passkey user verification, follow the configured fallback | Fallback is described accurately; it must **not** silently override a server-side authorization requirement | NOT RUN |
| P0-08 | Complete a real PayPal Sandbox Checkout with test payer | Check actual PayPal state: COMPLETED vs PENDING vs failed; voice/status matches backend | NOT RUN |
| P0-09 | Test network failure or expired checkout session | No false success message and no duplicate payment upon retry | NOT RUN |
| P0-10 | Trigger the same confirmation twice (double tap / repeated voice) | No unintentional duplicate order capture | NOT RUN |

## Priority P1: voice, UX and English

| ID | Scenario / steps | Expected result | Status |
|---|---|---|---|
| P1-01 | Launch as a first-time visitor with fresh local app state | One welcome and help prompt; no duplicate greeting | NOT RUN |
| P1-02 | Relaunch as returning visitor | Short greeting; first-use instructions not replayed | NOT RUN |
| P1-03 | Complete a first transaction then start a second | No unnecessary introductory instructions repeated | NOT RUN |
| P1-04 | Interrupt the agent while it is reading contacts (speaker) | Agent stops quickly; recognizes the user's intent, without self-triggering | NOT RUN |
| P1-05 | Repeat P1-04 using headphones | Same correct behavior; no response loop | NOT RUN |
| P1-06 | Interrupt during amount confirmation | Speaking does not implicitly authorize payment; changed amount is re-confirmed | NOT RUN |
| P1-07 | Switch from voice mode to classic mode and back | Both modes remain usable; transaction data is not lost unexpectedly | NOT RUN |
| P1-08 | Switch to English and complete first visit → contacts → payment → status | UI, spoken amount, currency, confirmation, error and success messages are in English | NOT RUN |
| P1-09 | Read an existing PayPal Invoicing v2 invoice aloud | At least invoice identification, amount, currency and relevant details are accurate; no imaginary camera scan | NOT RUN |
| P1-10 | Return to the app after PayPal invoice/Checkout approval | Document actual back/return behavior; the user receives clear navigation instructions | NOT RUN |
| P1-11 | With rules fallback, request `Send 30.50 euros to Fatou` and `Send 30,50 euros to Fatou`, then test the same amount in words | Exact cents retained. Known QA-01: numeric input currently loses cents; retest after Wahon's fix | NOT RUN |

## Priority P1: accessibility

| ID | Scenario / steps | Expected result | Status |
|---|---|---|---|
| A11Y-01 | Navigate all key actions using keyboard alone | Focus visible, controls reachable, no keyboard trap | NOT RUN |
| A11Y-02 | Navigate with VoiceOver on iPhone/iPad, if available | Semantic labels read correctly; buttons and confirmations operable | NOT RUN |
| A11Y-03 | Navigate with TalkBack on Android, if available | Semantic labels read correctly; buttons and confirmations operable | NOT RUN |
| A11Y-04 | Deny microphone permission, then use classic mode | App remains functional and explains voice limitation | NOT RUN |
| A11Y-05 | Disable audio playback and use screen text | Critical amount, payee and status remain available in text | NOT RUN |

## Release gate — do not film a success flow unless

- [ ] Sandbox approval and result verified manually on target device
- [ ] English narration and UI tested end-to-end
- [ ] Passkey user verification behavior observed (not assumed biometric-only)
- [ ] No false `COMPLETED` claim for a `PENDING` capture
- [ ] No accidental payment on cancel, interruption or silence
- [ ] `npm test` result recorded and failing tests triaged
- [ ] QA-01 decimal TODO resolved and its regression active before release
- [ ] Demo URL and production `APP_URL` checked with Eddie
- [ ] VoiceOver/TalkBack observations reported accurately, without claiming a user study

## Reporting a failure

Copy `test/qa/bug-report-template.md`, fill it and message the relevant file owner: Wahon (voice/passkey/agent) or Eddie (PayPal/deployment). Do not patch their file yourself.

## Automated evidence, separate from manual rows

Base `d484e5a` plus `feat/tests` changes, Node 24.17.0: `npm test` reports 78 total, 77 passed, 1 acknowledged failing TODO (QA-01), no skips. Production build succeeds. Static preflight reports 0 failures and 1 manual-check warning. These results do not change manual rows to PASS; see the findings for limitations.
