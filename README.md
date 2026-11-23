# Paperwise: understand any document, keep your identity

**Paperwise explains confusing bills, notices, lab reports, bank messages and contracts in plain language (English, Telugu, Hindi and more) and tells you exactly what to do.** Your personal details are found and hidden **on your device** with Gemini Nano before anything is sent to the cloud. The cloud model only ever sees placeholders like `[PERSON_1]` or `[AADHAAR_1]`, and your real details are put back into the answer locally.

Built for **#BuildHybridAI 2026** with **Firebase AI Logic hybrid inference** (Web / Chrome, Gemini Nano + Gemini).

> 🔗 Live demo: `https://YOUR_PROJECT.web.app` · 🎬 Video: `YOUTUBE_LINK`

## Why hybrid matters here

Millions of people get documents they can't fully understand: an electricity disconnection notice, a lab report, a "KYC update" SMS that might be a scam, a one-sided rent agreement. The best explanation comes from a large cloud model. But these documents are full of Aadhaar numbers, PANs, account numbers, phone numbers, names and addresses, which people rightly shouldn't paste into a chatbot.

Paperwise splits each task by **what the data is**, not just by whether a model is available:

| Step | What happens | Where it runs | Firebase AI Logic mode |
|---|---|---|---|
| **Read** | Photo → text (OCR + transcription) | Gemini Nano, on-device | `ONLY_ON_DEVICE` (multimodal) |
| **Shield** | Find names, addresses, Aadhaar, PAN, phones, accounts, IDs… | Gemini Nano + deterministic rules, on-device | `ONLY_ON_DEVICE` + JSON `responseConstraint` |
| **Review** | You see side by side what stays and what the cloud will see, and can hide more | Your device | n/a |
| **Explain** | Plain-language summary, urgency, actions with deadlines, key facts, red flags / scam signs, questions to ask, reply draft, in your language | Gemini in the cloud, Nano fallback | `PREFER_IN_CLOUD` + `responseSchema` |
| **Restore** | Placeholders swapped back to your real details | Your device | n/a |
| **Ask** | Follow-up Q&A on the redacted context | Cloud, or Nano in private mode | `PREFER_IN_CLOUD` / `ONLY_ON_DEVICE` |

- **"Never leave this device" switch** and **offline mode**: every step runs on Gemini Nano and nothing is sent.
- **Defense in depth:** rule-based detectors (Aadhaar, PAN, IFSC, phones, emails, cards, account/ID numbers, DOB, PIN codes, names after labels like `Name:`, `S/o`, `Mr.`) always run, so the privacy guarantee doesn't depend on a model. Nano adds what rules miss (addresses, names in free text). A final `leakCheck` blocks the request if any shielded value is still present.
- **Privacy ledger:** every call shows `response.inferenceSource` (ON_DEVICE / IN_CLOUD), latency, and bytes sent. Personal data sent to the cloud is always **0 B**.
- **Hallucination guard:** entities from Nano are only accepted if they literally occur in the document.
- **Accessibility:** "Listen" reads the summary aloud with on-device speech synthesis, in the chosen language.

## Firebase products used
- **Firebase AI Logic** (Gemini Developer API) with **hybrid inference**: `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })`, see [`public/ai.js`](public/ai.js)
- **App Check** with reCAPTCHA Enterprise (debug token on localhost)
- **Remote Config**: `cloud_model` parameter to switch the cloud Gemini model without redeploying
- **Firebase Hosting**

## Run it locally

Requirements: **Chrome Desktop 139+**.

1. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and relaunch Chrome.
2. In the [Firebase console](https://console.firebase.google.com): create a project → **AI Services › AI Logic › Get started** → *Gemini Developer API*. Add a **Web app**.
3. **Security › App Check**: register the web app with reCAPTCHA Enterprise and turn on enforcement for Firebase AI Logic.
4. Copy your web config and site key into [`public/config.js`](public/config.js).
5. Serve the `public` folder:
   ```bash
   npx serve public -l 5000     # or: python3 -m http.server 5000 -d public
   ```
6. Open `http://localhost:5000`. The first time, App Check prints a **debug token** in the DevTools console; add it under **App Check › Apps › Manage debug tokens**.
7. Click the **"Enable on-device AI"** pill once to download Gemini Nano (a few minutes, one time only).

Optional: in **Remote Config** add a string parameter `cloud_model` (for example `gemini-3.5-flash`).

Deploy: `npx firebase-tools deploy --only hosting` (set your project id in `.firebaserc` and add your hosting domain to the reCAPTCHA key).

Tests for the privacy shield (no network needed): `node test/privacy.test.mjs`.

## Project layout
```
public/
  ai.js        Firebase AI Logic hybrid engine (models, schemas, routing)
  privacy.js   Rule detectors, shield/tokenize, restore, leak check (pure functions)
  app.js       UI and pipeline orchestration, privacy ledger
  samples.js   Fictional sample documents
  mock.js      Test double used only for automated UI screenshots (?mock=1)
test/          Unit tests for the privacy shield
```

## License
Apache-2.0
