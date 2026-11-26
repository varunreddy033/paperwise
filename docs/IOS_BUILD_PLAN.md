# Paperwise for iOS: build plan

Goal: a native iOS (SwiftUI) version of Paperwise, so the #BuildHybridAI entry is multi-platform (Web + iOS).
Same idea as the web app: **read -> shield -> explain -> restore**, with personal data never leaving the device.
Deadline for the whole hackathon: Mon 30 Nov 2026, 2:00 PM PT. Keep scope tight; polish beats features.

## Where it lives
- In the existing repo: `paperwise/ios/` (one repo, two platforms; judges see both).
- Firebase project: `paperwise-e1219` (same one as the web app). Register an iOS app with bundle ID
  `com.varunreddy.paperwise` and put `GoogleService-Info.plist` in `ios/Paperwise/`.
- `GoogleService-Info.plist` must NOT be committed: add it to .gitignore and ship a `GoogleService-Info.example.plist`
  with placeholder values plus README instructions.

## Requirements (from Firebase docs, hybrid on Apple platforms)
- Firebase iOS SDK via **Swift Package Manager only** (hybrid is SPM-only), products `FirebaseAILogic` and `FirebaseAppCheck`,
  SDK >= 12.13.0 (use the latest release).
- Apple Intelligence enabled on the device or on the Mac running the simulator. The app cannot trigger the model download.
- On-device (Apple Foundation Models) is **text only**, max ~4096 tokens per request, foreground only.
- Hybrid API: `HybridModel(primary:secondary:)`, `FirebaseAI.SystemLanguageModel.default` for on-device,
  `ai.geminiModel(name:)` for cloud, `firebaseAI.generativeModelSession(model:)`, `session.respond(to:)`.
  A session keeps chat history, so create a NEW session per request. The SDK reports which model answered; find
  the exact property in the SDK source (do not guess) and surface it as ON_DEVICE / IN_CLOUD.
- App Check: `AppCheckDebugProviderFactory` in DEBUG builds (register the token printed in the Xcode console);
  `AppAttestProvider` for non-debug builds.

## Pipeline (mirror the web app: public/ai.js and public/privacy.js are the reference)
1. **Read (on-device):** photo from camera or Photos picker -> Apple **Vision** `VNRecognizeTextRequest` (accurate mode,
   language correction on). No AI model, nothing uploaded. Also allow pasted text and the 4 built-in samples
   (copy the text from public/samples.js exactly).
2. **Shield (on-device only):** 
   - Port `public/privacy.js` to `Privacy.swift`: rule detectors (EMAIL, CARD, AADHAAR, PAN, IFSC, PHONE, ACCOUNT, ID, DOB,
     PINCODE, PERSON with case-insensitive labels), `sanitizeModelEntities` (literal-match hallucination guard,
     false-positive filter for amounts/OTHER/non-birth dates), `mergeEntities`, `buildShield` (longest-first, stable tokens
     like [PERSON_1]), `restore`, `leakCheck`.
   - On-device entity detection: a HybridModel with ONLY the system model (so it never falls back to cloud). Prompt it
     to return JSON `{"entities":[{"text":..., "type":...}]}`; structured output docs are "coming soon", so parse
     defensively (strip code fences, find the first {...}). If the on-device model is unavailable, continue with rules only
     and say so in the ledger.
   - Port the unit tests from `test/privacy.test.mjs` to XCTest, using the same samples. They must pass.
3. **Review screen:** chips for each detected item (tap to keep visible), "hide something else" field, and a two-tab view:
   "Your document" (highlighted) vs "What the cloud will see" (tokens).
4. **Explain:** HybridModel(primary: cloud `gemini-3.5-flash-lite`, secondary: system model). Same prompt as
   `guidePrompt()` in public/ai.js, asking for the same JSON fields (docType, summary, urgency, urgencyReason, actions,
   keyFacts, redFlags, questions, replyDraft). On-device fallback answers in English. 20-second timeout on the cloud
   attempt. Run `leakCheck` before sending; if anything leaks, block the request.
   - "Never leave this device" toggle: use a HybridModel with only the system model.
5. **Restore (on-device):** swap tokens back with `restore`; show a "What the cloud saw" toggle.
6. **Ask a follow-up:** same as web, redacted context, cloud first with on-device fallback.
7. **Privacy ledger** (a sheet or bottom panel): every step, where it ran (ON-DEVICE / CLOUD / RULES / VISION), ms,
   bytes sent, and the headline "Personal data sent to cloud: 0 B".

## UI
SwiftUI, iOS 26+ target. Match the web look: warm paper background (#F6F1E7), cards (#FFFDF8), deep green accent
(#0F5F55), highlighter yellow for personal data (#FFE680), blue tokens (#2856A6 on #E4ECFA). Serif titles (New York),
system body. Screens: Home -> Review -> Result, with the ledger reachable from every screen. Dynamic Type and VoiceOver
labels on the main controls. "Listen" button using AVSpeechSynthesizer with the chosen language.

## Done means
- Builds with `xcodebuild` for the iOS Simulator with zero warnings in our own code; XCTest passes.
- In the simulator (Mac with Apple Intelligence on): the electricity sample shows on-device detections, a CLOUD explain,
  restored real name in the reply draft, and 0 B personal data in the ledger. "Never leave this device" makes every step
  ON-DEVICE. A photo of a printed document goes through Vision OCR.
- README gets an "iOS app" section (requirements, setup, how to run) and the top line says "Web + iOS".
