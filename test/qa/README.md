# Gueriatou — start here

Wahon's voice work is already merged into `main` (`d484e5a`). This checkout is on `feat/tests`, with QA, video preparation and English-only changes.

## Ready now

- `test/voice-quality.test.js`: English commands, amounts, onboarding, brief prompts and device copy.
- `test/voice-interruption.test.js`: real VAD with simulated audio and resource handling.
- `test/english-journey.test.js`: real conversation logic with rules interpretation and a fake invoice.
- `web/src/lib/voice-strings.js`: English brief prompts, welcome, passkey and interruption explanations.
- [Acceptance checklist](acceptance-checklist.md): manual device/Sandbox cases, all still NOT RUN.
- [Video script](../../video/english-demo-script.md) and recording checklist: ready for rehearsal.

## Run from the repository root

Use Node.js >=22.12:

```bash
npm ci
npm test
npm run build
node test/qa/validate-submission.mjs
git status --short
```

This Windows workspace also has a temporary npm wrapper outside Git, using an existing Node runtime. If npm is missing from your PATH:

```powershell
..\.tools\npm.cmd test
..\.tools\npm.cmd run build
```

Latest result: **77 passed, 1 known TODO, 0 ordinary failures**. The TODO reproduces a defect: numeric decimal `30.50` becomes `30` in rules interpretation. See [findings and reproduction](repo-findings-2026-11-10.md). Successful test exit is not release approval. Fake services/simulated audio do not validate real PayPal, physical passkeys, microphone or screen readers.

The English interface was also checked in Chromium at phone width: typed request, amount review, cancellation and translated settings passed against the real local API, with a fictional contact and simulated speech.

## Your next actions

1. Review the changes and prepared team messages. Ask Wahon to fix QA-01; his behavior implementation files are unchanged here.
2. Obtain the production URL, supported currency and throwaway Sandbox account access from Eddie. Keep credentials outside Git and video footage.
3. Run the acceptance checklist on the recording device. Start with cancellation, corrections, passkeys and actual PayPal status. Record the tested commit and evidence.
4. Rehearse the English script, then record working behavior. Send the final public YouTube URL to Eddie.

To share your branch when ready:

```bash
git push -u origin feat/tests
```

Eddie coordinates merging and deployment. This implementation did not deploy code, make a live Sandbox payment or publish a video.

## Submission reference

The [official rules](https://paypalaihackathon.devpost.com/rules), checked 10 November 2026, list the deadline as 12 November at 12:00 PST (20:00 UTC / 21:00 Morocco), a public licensed repo, a functional build or hosted demo, English materials or translations, and a public YouTube video under three minutes. Keep access working through judging on 15 December. Submission remains the team's responsibility.
