// Paperwise hybrid AI engine, built on Firebase AI Logic.
//
// Routing policy (the core idea of the app):
//   READ    image -> text            ONLY_ON_DEVICE   (raw document never leaves the device)
//   SHIELD  find personal details    ONLY_ON_DEVICE   (+ deterministic rules in privacy.js)
//   EXPLAIN redacted text -> guide   PREFER_IN_CLOUD  (bigger model, many languages; falls back to Nano)
//   ASK     follow-up questions      PREFER_IN_CLOUD  (same, on redacted context only)
// In "Never leave this device" mode or when offline, EXPLAIN and ASK switch to ONLY_ON_DEVICE.

import { FIREBASE_VERSION } from './config.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const ENTITY_TYPES = ['PERSON', 'ADDRESS', 'PHONE', 'EMAIL', 'AADHAAR', 'PAN', 'ACCOUNT', 'CARD', 'IFSC', 'ID', 'DOB', 'PINCODE', 'OTHER'];

export async function createEngine(config) {
  const [{ initializeApp }, appCheckMod, aiMod, rcMod] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-app-check.js`),
    import(`${CDN}/firebase-ai.js`),
    import(`${CDN}/firebase-remote-config.js`).catch(() => null),
  ]);
  const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } = aiMod;

  const app = initializeApp(config.firebase);

  // ---- App Check (required by the hackathon; debug token on localhost) ----
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocal) self.FIREBASE_APPCHECK_DEBUG_TOKEN = config.appCheckDebugToken || true;
  const Provider = config.recaptchaProvider === 'v3' ? appCheckMod.ReCaptchaV3Provider : appCheckMod.ReCaptchaEnterpriseProvider;
  appCheckMod.initializeAppCheck(app, {
    provider: new Provider(config.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });

  // ---- Remote Config: lets us switch the cloud model without redeploying ----
  let cloudModel = config.defaultCloudModel;
  if (rcMod) {
    try {
      const rc = rcMod.getRemoteConfig(app);
      rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
      rc.defaultConfig = { cloud_model: config.defaultCloudModel };
      await Promise.race([rcMod.fetchAndActivate(rc), new Promise((r) => setTimeout(r, 2500))]);
      cloudModel = rcMod.getValue(rc, 'cloud_model').asString() || cloudModel;
    } catch (e) {
      console.warn('Remote Config unavailable, using default model', e);
    }
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  // ---- Schemas (shared by cloud responseSchema and on-device responseConstraint) ----
  const piiSchema = Schema.object({
    properties: {
      entities: Schema.array({
        items: Schema.object({
          properties: {
            text: Schema.string({ description: 'exact text copied from the document' }),
            type: Schema.enumString({ enum: ENTITY_TYPES }),
          },
        }),
      }),
    },
  });

  const guideSchema = Schema.object({
    properties: {
      docType: Schema.string({ description: 'short type, e.g. "Electricity disconnection notice"' }),
      summary: Schema.string({ description: '2-4 plain sentences: what this is and what it means for the reader' }),
      urgency: Schema.enumString({ enum: ['low', 'medium', 'high', 'critical'] }),
      urgencyReason: Schema.string(),
      actions: Schema.array({
        items: Schema.object({
          properties: { task: Schema.string(), deadline: Schema.string(), why: Schema.string() },
          optionalProperties: ['deadline', 'why'],
        }),
      }),
      keyFacts: Schema.array({
        items: Schema.object({
          properties: { label: Schema.string(), value: Schema.string(), meaning: Schema.string() },
          optionalProperties: ['meaning'],
        }),
      }),
      redFlags: Schema.array({ items: Schema.string() }),
      questions: Schema.array({ items: Schema.string() }),
      replyDraft: Schema.string(),
    },
    optionalProperties: ['urgencyReason', 'replyDraft'],
  });

  function makeModel(mode, { schema, image = false, temperature = 0.3 } = {}) {
    return getGenerativeModel(ai, {
      mode,
      inCloudParams: {
        model: cloudModel,
        generationConfig: schema
          ? { responseMimeType: 'application/json', responseSchema: schema, temperature }
          : { temperature },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: 'text', languages: ['en'] }, ...(image ? [{ type: 'image' }] : [])],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        },
        ...(schema ? { promptOptions: { responseConstraint: schema } } : {}),
      },
    });
  }

  const models = {
    read: makeModel(InferenceMode.ONLY_ON_DEVICE, { image: true, temperature: 0 }),
    shield: makeModel(InferenceMode.ONLY_ON_DEVICE, { schema: piiSchema, temperature: 0 }),
    explainHybrid: makeModel(InferenceMode.PREFER_IN_CLOUD, { schema: guideSchema }),
    explainLocal: makeModel(InferenceMode.ONLY_ON_DEVICE, { schema: guideSchema }),
    askHybrid: makeModel(InferenceMode.PREFER_IN_CLOUD, {}),
    askLocal: makeModel(InferenceMode.ONLY_ON_DEVICE, {}),
  };

  // Cloud failover: if a model is overloaded (500/503/429) or unavailable (404), try the next one.
  const cloudChain = [...new Set([cloudModel, ...(config.fallbackCloudModels || [])])];
  const cloudCache = new Map();
  function cloudModelFor(name, schema) {
    const key = name + (schema ? ':json' : '');
    if (!cloudCache.has(key)) {
      cloudCache.set(key, getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: name,
          generationConfig: schema ? { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.3 } : { temperature: 0.3 },
        },
      }));
    }
    return cloudCache.get(key);
  }
  async function cloudWithFailover(schema, prompt) {
    let lastErr;
    for (const name of cloudChain) {
      try {
        const r = await run(cloudModelFor(name, schema), prompt);
        // Remember what worked: put this model first for the rest of the session.
        cloudChain.splice(cloudChain.indexOf(name), 1);
        cloudChain.unshift(name);
        return { ...r, model: name };
      } catch (e) {
        lastErr = e;
        console.warn(`Cloud model ${name} failed, trying next`, e.message);
        if (!/\b(500|503|429|404)\b|high demand|overloaded|not found|unavailable|quota/i.test(e.message)) break;
      }
    }
    throw lastErr;
  }

  async function run(model, request) {
    const t0 = performance.now();
    const result = await model.generateContent(request);
    const ms = Math.round(performance.now() - t0);
    const response = result.response;
    return { text: response.text(), source: String(response.inferenceSource || 'UNKNOWN').toUpperCase(), ms };
  }

  function parseJson(text) {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    return JSON.parse(cleaned);
  }

  const expectedIO = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };

  return {
    cloudModel,

    /** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
    async deviceStatus() {
      if (typeof self.LanguageModel === 'undefined') return 'unsupported';
      try {
        return await self.LanguageModel.availability(expectedIO);
      } catch {
        return 'unavailable';
      }
    },

    /** Must be called from a user gesture. Downloads Gemini Nano if needed. */
    async prepareDevice(onProgress) {
      if (typeof self.LanguageModel === 'undefined') throw new Error('Prompt API not available in this browser');
      const session = await self.LanguageModel.create({
        ...expectedIO,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
        },
      });
      session.destroy?.();
    },

    /** On-device OCR + transcription. */
    async readImage(base64, mimeType) {
      const prompt =
        'Transcribe every piece of text in this document image exactly as written, preserving line breaks. ' +
        'Output only the transcription, with no commentary.';
      return run(models.read, [prompt, { inlineData: { data: base64, mimeType } }]);
    },

    /** On-device personal-detail detection with Gemini Nano. */
    async detectEntities(text) {
      const chunks = chunk(text, 3500);
      const all = [];
      let ms = 0;
      let source = 'ON_DEVICE';
      for (const c of chunks) {
        const prompt =
          'Find every piece of personal or identifying information in the document below. ' +
          'Include: people\'s names, postal addresses, phone numbers, emails, Aadhaar numbers, PAN, bank account and card numbers, IFSC codes, ' +
          'customer/consumer/patient/policy/reference IDs, dates of birth and PIN codes. ' +
          'Do NOT include company names, government department names, amounts, dates that are not birth dates, or medical test values. ' +
          'Copy each item exactly as it appears.\n\nDOCUMENT:\n"""\n' + c + '\n"""';
        const r = await run(models.shield, prompt);
        ms += r.ms;
        source = r.source;
        try {
          all.push(...(parseJson(r.text).entities || []));
        } catch (e) {
          console.warn('Could not parse on-device entities', r.text);
        }
      }
      return { entities: all, source, ms };
    },

    /** Explain the redacted document. Cloud first (bigger model, any language); on any cloud
     *  failure we fall back to Gemini Nano and report the reason, so the user always gets an answer. */
    async explain(redacted, language, { deviceOnly }) {
      const local = deviceOnly || !navigator.onLine;
      if (!local) {
        const prompt = guidePrompt(redacted, language);
        try {
          const r = await cloudWithFailover(guideSchema, prompt);
          return { data: parseJson(r.text), source: r.source, ms: r.ms, language, model: r.model, sentBytes: new TextEncoder().encode(prompt).length };
        } catch (e) {
          console.error('Cloud explain failed, falling back to on-device', e);
          const r = await run(models.explainLocal, guidePrompt(redacted, 'English'));
          return { data: parseJson(r.text), source: r.source, ms: r.ms, language: 'English', sentBytes: 0, fallbackReason: e.message };
        }
      }
      const r = await run(models.explainLocal, guidePrompt(redacted, 'English'));
      return { data: parseJson(r.text), source: r.source, ms: r.ms, language: 'English', sentBytes: 0 };
    },

    async ask(redacted, guide, question, language, { deviceOnly }) {
      const local = deviceOnly || !navigator.onLine;
      const lang = local ? 'English' : language;
      const prompt =
        `You are Paperwise, a friendly expert who helps ordinary people understand official documents. ` +
        `Tokens like [PERSON_1] or [ACCOUNT_1] stand in for private details that were removed for privacy - keep them exactly as written and never guess their values. ` +
        `Answer the question directly in ${lang} (no greeting, no introduction), in at most 120 words, simply and concretely. If the document does not say, say so.\n\n` +
        `DOCUMENT (redacted):\n"""\n${redacted}\n"""\n\nEARLIER SUMMARY: ${guide?.summary || ''}\n\nQUESTION: ${question}`;
      const r = await run(local ? models.askLocal : models.askHybrid, prompt);
      return { ...r, sentBytes: local ? 0 : new TextEncoder().encode(prompt).length };
    },
  };
}

function guidePrompt(redacted, language) {
  return (
    `You are Paperwise, a patient, practical guide who explains official, financial, legal and medical documents to ordinary people ` +
    `(many are first-generation readers of such paperwork, often in India).\n` +
    `The document below was privacy-redacted on the user's device: tokens like [PERSON_1], [AADHAAR_1], [ACCOUNT_1] stand in for the real values. ` +
    `When you refer to them, copy the token exactly (with brackets). Never guess or invent their values.\n\n` +
    `Write every text field in ${language}. Use short sentences and everyday words. Keep amounts, dates and tokens exactly as in the document.\n` +
    `- summary: what this document is and what it means for the reader.\n` +
    `- urgency: how soon the reader must act; urgencyReason: one line why.\n` +
    `- actions: concrete steps in order, each with a deadline taken from the document when there is one.\n` +
    `- keyFacts: the important numbers, dates and terms, each with what it means.\n` +
    `- redFlags: anything risky - scam signs (links, OTP or PIN requests, threats, personal numbers), unfair or unusual clauses, ` +
    `or medical values outside the reference range. Do not diagnose; suggest discussing with a doctor. Empty list if none.\n` +
    `- questions: 2-4 smart questions the reader should ask the sender, a doctor, landlord or bank.\n` +
    `- replyDraft: a short, polite reply or complaint the reader could send, if one makes sense; use the tokens for their own details.\n\n` +
    `DOCUMENT:\n"""\n${redacted}\n"""`
  );
}

function chunk(text, size) {
  if (text.length <= size) return [text];
  const out = [];
  const lines = text.split('\n');
  let cur = '';
  for (const l of lines) {
    if ((cur + '\n' + l).length > size && cur) {
      out.push(cur);
      cur = l;
    } else cur = cur ? cur + '\n' + l : l;
  }
  if (cur) out.push(cur);
  return out;
}
