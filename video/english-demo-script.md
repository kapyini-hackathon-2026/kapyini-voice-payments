# Kapyiŋi — 2m40s demo video script (English)

**Recording target:** under 3 minutes; recommended edit **2:35–2:45**.
**All on-screen demo footage must be real**, on the actual supported device. The samples below are dialogue cues: adapt wording to actual working behavior. Use demo contacts and sandbox accounts only. No third-party copyrighted music or unlicensed marks. Avoid recording passwords, tokens or personal data.

## 00:00–00:18 | Problem and introduction

**Visual:** Product name, then the real app opening on target phone/device.

**Narration:**
> Digital payments can be difficult when an interface depends on small buttons and complex navigation. Meet Kapyiŋi, a voice-first payment experience built with accessibility in mind, powered by PayPal and AI.

## 00:18–00:35 | Choice and welcome

**Visual:** Real first-visit welcome and the two modes; select voice mode.

**Narration:**
> Kapyiŋi gives people a choice between voice interaction and a classic interface. Here is the voice experience, in English.

**On-device dialogue (only if supported):**
> App: Hello! How can I help you?

## 00:35–01:28 | Contact and payment — live Sandbox

**Visual:** Voice request, displayed contacts, payee and amount review, user confirmation, passkey prompt where supported, PayPal Sandbox approval and real result.

**User voice cue (use your tested command, not necessarily this exact sentence):**
> I want to pay Alex ten US dollars.

**Rules-fallback example verified in Node:** “Send thirty euros and fifty cents to Fatou” → “yes” → “I send thirty euros and fifty cents”. Use Eddie's real Sandbox contact and supported currency for filming and rehearse on-device. Numeric decimal input currently has QA-01; resolve it before release.

**Narration over the actual flow:**
> The AI helps interpret the request. Deterministic checks validate the transaction details. The person reviews and confirms the payment. Device verification uses a passkey, which may ask for a fingerprint, face, or unlock code. PayPal processes the checkout in its Sandbox environment.

Without a configured Claude key, say “Built-in rules interpret this request.” Without a configured passkey, show and describe the spoken-amount fallback. Narrate only verification steps present in the footage.

**Do not say:** "The payment succeeded" unless the real capture is `COMPLETED`. If `PENDING`, state that it is pending. If the implementation uses merchant Checkout, do not describe it as universal person-to-person transfers.

## 01:28–02:07 | PayPal invoice read aloud

**Visual:** Open an existing PayPal Invoicing v2 invoice and listen to actual spoken details.

**Narration:**
> Kapyiŋi can also read an existing PayPal invoice aloud, including the important payment details. This is an integration with PayPal Invoicing, not a camera scan.

**If available:** Show the actual payment/return path and explain how to return using the browser's back action. Never stage a non-working feature.

## 02:07–02:32 | Why this design is different

**Visual:** Simple text overlay using your own typography, followed by the app's actual confirmation state.

**Narration:**
> Our approach separates natural language from financial authorization: the AI proposes, deterministic rules check, the user confirms, and PayPal authorizes. The final decision stays with the user.

## 02:32–02:43 | Closing

**Visual:** App + Kapyiŋi name + optional repo/demo text (no personal details).

**Narration:**
> Kapyiŋi: a more approachable way to interact with payments, one confirmed step at a time.

---

## Editing notes

- Keep the live transaction and confirmation as the central scene; edit only out waiting and unrelated taps, without misrepresenting the result.
- Prefer readable captions and phone screen zoom over fancy transitions.
- Record a clean English audio track, with app audio still audible for the relevant scenes.
- If the flow does not work on the recording device, **fix it before filming** or show only the narrower function that does work; never replace it with a fake success screen.
- Do not claim Kapyiŋi was tested with blind participants if no such study occurred.
- Publish as a **public YouTube video**, not private/unlisted if the platform's public visibility rule is interpreted strictly.
