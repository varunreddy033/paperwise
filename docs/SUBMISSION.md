# Devpost submission text

**Project name (≤60):** Paperwise: Understand Any Document, Privately

**Elevator pitch (≤200):** Snap a bill, notice, lab report or contract. Gemini Nano hides your personal details on-device, Gemini in the cloud explains it in your language, and your details are restored locally.

**Platform:** Web (Chrome) with Gemini Nano

---

## Inspiration
My family regularly gets documents they can't fully understand: electricity disconnection notices, lab reports full of abbreviations, rent agreements with one-sided clauses, and "your KYC is blocked" messages that are really scams. A large cloud model explains these well. But these documents carry Aadhaar numbers, PANs, bank accounts, phone numbers, names and home addresses, which nobody should paste into a chatbot. Hybrid AI let us stop choosing between a good answer and privacy.

## What it does
Paperwise turns any document into a clear action plan, **without the cloud ever learning who you are**:
1. **Read (on-device):** take a photo; Gemini Nano transcribes it locally. The image is never uploaded.
2. **Shield (on-device):** Gemini Nano plus deterministic rules find names, addresses, Aadhaar, PAN, phone, email, bank/card/IFSC, customer/patient IDs, DOB and PIN codes. Each is replaced with a placeholder like `[PERSON_1]`.
3. **Review:** a side-by-side view shows *your document* vs *what the cloud will see*. Tap to unhide, or hide anything else.
4. **Explain (cloud, Nano fallback):** Gemini returns a structured guide in English, Telugu, Hindi, Tamil and more: summary, urgency, step-by-step actions with deadlines, key numbers, **red flags** (scam signs, unfair clauses, out-of-range lab values), questions to ask, and a ready-to-send reply.
5. **Restore (on-device):** placeholders are swapped back to your real details locally, so the reply draft says your real name and connection number.
6. **Ask follow-ups** on the redacted context. "What the cloud saw" toggles to the exact tokenized version.

Flip **"Never leave this device"** (or go offline) and the whole pipeline runs on Gemini Nano. A live **Privacy ledger** shows where every step ran (from `inferenceSource`), latency, and bytes sent. *Personal data sent to cloud* always reads **0 B**.

## How we built it: Firebase AI Logic
- Web app on **Firebase AI Logic JS SDK (v13)** via `firebase/ai`, Gemini Developer API backend.
- **Routing by data sensitivity**, not just availability:
  - Read & Shield: `InferenceMode.ONLY_ON_DEVICE`. Shield uses a JSON schema passed as `onDeviceParams.promptOptions.responseConstraint` so Nano returns typed entities.
  - Explain & Ask: `InferenceMode.PREFER_IN_CLOUD` with `inCloudParams.generationConfig.responseSchema`, the **same `Schema`** also given to Nano as `responseConstraint`, so the cloud and on-device paths return identical structures and the UI never cares which one answered.
  - Private/offline mode switches to `ONLY_ON_DEVICE` models.
- `response.inferenceSource` drives the ledger and pipeline badges.
- **App Check** (reCAPTCHA Enterprise; debug provider on localhost) protects AI Logic.
- **Remote Config** `cloud_model` switches the cloud Gemini model live.
- **Firebase Hosting** for the live demo.
- Privacy engineering: rules always run (the guarantee doesn't depend on the model), Nano entities are accepted only if they literally occur in the text (hallucination guard), longest-first stable tokenization, and a final `leakCheck` blocks any request where a shielded value is still present. Unit-tested.

## Challenges
- Getting a small on-device model to return reliable structured output: solved with schema-constrained decoding, chunking, and a literal-match filter.
- Making restoration robust when the cloud reformats tokens (`PERSON_1` vs `[PERSON_1]`).
- Designing a UI that makes an invisible guarantee (what left the device) visible and checkable.

## Accomplishments
- The cloud model produces personalized replies ("I am Lakshmi Prasanna, holder of service connection 1102-45-873…") without ever receiving those details.
- Works fully offline with the same UX.

## What we learned
Hybrid isn't only a fallback. The interesting design question is *which data each model should see*.

## What's next
- Android app with Gemini Nano using the same pipeline, and a Chrome extension (right-click any text → "Explain privately").
- Saved document history kept only on the device, with deadline reminders.
- More Indian languages and voice input for low-literacy users.

## Built with
firebase-ai-logic, gemini-nano, gemini, chrome-prompt-api, app-check, remote-config, firebase-hosting, javascript, html, css
