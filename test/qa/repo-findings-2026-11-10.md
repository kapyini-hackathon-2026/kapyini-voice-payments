# Gueriatou QA findings — 10 November 2026

Base: `main` at `d484e5a`, already containing Wahon's `feat/voix` through `2e12dba`.
Work branch: `feat/tests`. Changes cover tests, QA/video documents and English strings.

## Implemented and verified locally

- Added English brief prompts equivalent to the French brief map, preserving payee, currency, full amount and spoken fallback instruction.
- Aligned the English first-visit question with Wahon's automatic listening flow.
- Translated device verification and interruption settings marked `TODO(Gueriatou)`.
- Described English passkey actions as device verification, allowing biometrics or a device unlock code.
- Added real English conversation tests and actual voice detection tests with simulated audio energy.
- Activated both formerly skipped English regressions from the starter kit.

Environment: Windows, Node `24.17.0`, npm `11.6.2`. `npm ci` completed with the existing lockfile. No dependency changes.

| Check | Result | Limit |
|---|---|---|
| `npm test` | 78 total: 77 passed, 0 ordinary failures, 0 skipped, **1 TODO for QA-01** | Successful exit does not resolve the known decimal defect |
| `npm run build` | PASS, production bundle generated | Does not validate live services |
| `node test/qa/validate-submission.mjs` | 0 failures, 1 manual-check warning | Metadata/filename preflight, not a secrets-content audit |
| Chromium 149.0.7827.55, 412 × 915 | English welcome rendered; existing-space typed request → real local API → full amount review → cancel; device and interruption settings in English; API responses 200, no page errors | Fictional contact, memory storage, speech simulated; no acoustic or live payment validation |
| Live Sandbox, physical passkey, microphone, VoiceOver/TalkBack | NOT RUN | Needs team access and real devices |

## QA-01 — numeric decimals lose cents in rules interpretation

**Priority:** P1, incorrect money details; resolve before release. **Owner:** Wahon (interpreter/agent).

Reproduced in real Node modules, English, rules fallback without a Claude API key, against base `d484e5a` and this branch. No external requests.

Run from repository root:

```bash
node --input-type=module -e "import { interpretWithRules } from './src/interpret.js'; console.log(interpretWithRules({text:'Send 30.50 euros to Fatou'}).amount)"
```

Expected: `30.50`. Actual: `30`.

With a dummy Fatou contact the real conversation reads `thirty euros for Fatou`, losing fifty cents. This does not automatically send money: review and confirmation still apply. Numeric transcripts nevertheless produce incorrect payment details.

Cause: `src/interpret.js` calls `plain(text)`, removing dots/commas before numeric extraction. Preserve amounts from the original normalized input while keeping command punctuation normalization separate. Gueriatou did not change this implementation file.

Regression: `KNOWN BUG QA-01` in `test/english-journey.test.js` executes with a Node `todo` annotation and currently fails its expected-value assertion. It is an acknowledged failing regression, not PASS. Remove `todo` after the fix; retest `30,50`, dollar cents and corrections as well.

Verified narrower path: `Send thirty euros and fifty cents to Fatou` → `yes` → `I send thirty euros and fifty cents` passes the conversation test. This is a supported case, not a fix for numeric input.

## Remaining checks

| Priority | Owner | Next step |
|---|---|---|
| P1 manual | Gueriatou + Wahon | Test speaker/headset interruption on real phones. iPhone defaults it off; screen reader mode requires touch to resume listening. |
| P1 manual | Gueriatou + Eddie | Test production origin with real Sandbox accounts; verify COMPLETED vs PENDING before filming. |
| P2 metadata | Eddie | Package description/author still name Sésame. Update with README/deployment work. |
| P2 | Wahon | `countSuccess` only deduplicates the last operation; A after B increments again. Brief-mode activation still works. |
| P2 copy | Wahon | Some French messages still promise fingerprint. English device copy is updated; review French separately. |

## Prepared team messages — not sent

To Wahon:

> English brief/greeting/device strings and QA tests are ready on feat/tests, based on your work already merged into main.
> QA-01: numeric 30.50 becomes 30 in src/interpret.js; reproduction and an executable TODO regression are included.
> Please fix that case and activate the regression; speaker/headset and real passkey tests still need a phone.

To Eddie:

> QA/English changes, manual checklist and demo script are ready on feat/tests.
> 77 tests pass with one known decimal TODO; build and metadata preflight pass. Live Sandbox/device checks remain NOT RUN.
> Please confirm production URL, currency, accounts and invoice before recording; package metadata still names Sésame.
