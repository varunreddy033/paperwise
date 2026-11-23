// Paperwise privacy shield.
// Pure functions (no Firebase, no DOM) so they can be unit-tested and so the
// privacy guarantee never depends on a model being available.
//
// Layer 1: deterministic detectors (this file) - always on, works offline, no model.
// Layer 2: Gemini Nano on-device entity detection (see ai.js) - catches names,
//          addresses and anything the rules miss.
// Both layers feed buildShield(), which swaps every sensitive value for a token
// like [PERSON_1]. Only the tokenized text is ever sent to the cloud, and
// restore() swaps the real values back in locally.

export const ENTITY_TYPES = [
  'PERSON', 'ADDRESS', 'PHONE', 'EMAIL', 'AADHAAR', 'PAN', 'ACCOUNT', 'CARD',
  'IFSC', 'ID', 'DOB', 'PINCODE', 'OTHER',
];

const NAME_STOPWORDS = new Set([
  'customer', 'sir', 'madam', 'sir/madam', 'patient', 'user', 'member', 'tenant',
  'landlord', 'consumer', 'applicant', 'valued', 'account', 'holder', 'team',
  'doctor', 'dr', 'the', 'of', 'and', 'details', 'name', 'friend', 'late', 'ref', 'by',
  'age', 'sex', 'mr', 'mrs', 'ms', 'shri', 'smt', 'sri', 'kumari', 'dear', 'mobile', 'address', 'regards', 'yours', 'faithfully',
]);

// Case-insensitive keyword alternation while keeping the name capture case-sensitive.
function ci(alternation) {
  return alternation.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
}

// Each rule: type, regex, and which capture group holds the sensitive value (0 = whole match).
const RULES = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, g: 0 },
  { type: 'CARD', re: /\b(?:\d{4}[ -]?){3}\d{4}\b/g, g: 0 },
  { type: 'AADHAAR', re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, g: 0 },
  { type: 'PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, g: 0 },
  { type: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, g: 0 },
  { type: 'PHONE', re: /(?:\+91[ -]?|\b0)?(?<!\d)[6-9]\d{4}[ -]?\d{5}\b/g, g: 0 },
  { type: 'PHONE', re: /\b0\d{2,4}[ -]?\d{6,8}\b/g, g: 0 },
  { type: 'PHONE', re: /\+\d{1,3}[ -]?\(?\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}\b/g, g: 0 },
  {
    type: 'ACCOUNT',
    re: /\b(?:a\/c|acct|account|loan|card)\s*(?:no\.?|number|num|#)?\s*(?:ending\s*(?:in|with)?\s*)?[:.\-]?\s*([X*x\d][X*x\d -]{3,22}\d)/gi,
    g: 1,
  },
  {
    type: 'ID',
    re: /\b(?:consumer|customer|cust|policy|patient|uhid|mrn|reg(?:istration)?|ref(?:erence)?|service|connection|ticket|application|employee|emp|voter|passport|licen[cs]e)\.?\s*(?:id|no\.?|number|num|#)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\/-]{3,})/gi,
    g: 1,
  },
  { type: 'ID', re: /\b(?:uhid|mrn|crn|cif|upi id)\s*[:.\-]\s*([A-Za-z0-9@.\/-]{4,})/gi, g: 1 },
  {
    type: 'DOB',
    re: /\b(?:d\.?o\.?b\.?|date of birth|born on)\s*[:.\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:19|20)?\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+(?:19|20)\d{2})/gi,
    g: 1,
  },
  { type: 'PINCODE', re: /\b(?:pin(?:\s*code)?|postal code)\s*[:.\-]?\s*([1-9]\d{2}\s?\d{3})\b/gi, g: 1 },
  {
    type: 'PERSON',
    re: new RegExp(
      `\\b(?:${ci('patient name|customer name|consumer name|account holder|name|patient|tenant|landlord|lessor|lessee|applicant|beneficiary|insured|nominee')}|Dear|Mrs?|MRS?|Ms|MS|Shri|SHRI|Smt|SMT|Sri|Kumari|Dr|DR)\\.?\\s*[:\\-]?\\s*((?:[A-Z][a-zA-Z'.]+|[A-Z]\\.)(?:[ \\t]+(?:[A-Z][a-zA-Z'.]+|[A-Z]\\.)){0,3})`,
      'g',
    ),
    g: 1,
  },
  // "S/o", "D/o", "W/o", "C/o" relation names common on Indian documents
  { type: 'PERSON', re: /\b[SDWC]\/[Oo]\.?\s*(?:Late\s+)?((?:[A-Z][a-zA-Z.]+)(?:[ \t]+[A-Z][a-zA-Z.]+){0,3})/g, g: 1 },
];

/** Deterministic detection. Returns [{text, type, source:'rules'}]. */
export function detectWithRules(text) {
  const found = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      let value = (m[rule.g] || '').trim().replace(/[.,;:]+$/, '');
      if (!value) continue;
      if (rule.type === 'PERSON') value = cleanName(value);
      if (!value) continue;
      found.push({ text: value, type: rule.type, source: 'rules' });
      if (rule.type === 'PERSON') rule.re.lastIndex = m.index + 1; // allow overlapping name matches
    }
  }
  return dedupe(found);
}

function cleanName(value) {
  const words = value.split(/\s+/).filter(Boolean);
  // Drop trailing words that are clearly not part of a name.
  while (words.length && NAME_STOPWORDS.has(words[words.length - 1].toLowerCase().replace(/[.,]/g, ''))) words.pop();
  while (words.length && NAME_STOPWORDS.has(words[0].toLowerCase().replace(/[.,]/g, ''))) words.shift();
  const name = words.join(' ');
  if (name.replace(/[^A-Za-z]/g, '').length < 3) return '';
  return name;
}

/** Normalise model-produced entities and keep only ones literally present in the text. */
export function sanitizeModelEntities(text, entities) {
  if (!Array.isArray(entities)) return [];
  const lower = text.toLowerCase();
  const out = [];
  for (const e of entities) {
    if (!e || typeof e.text !== 'string') continue;
    const value = e.text.trim().replace(/^["'`]+|["'`]+$/g, '');
    if (value.length < 3) continue;
    if (!lower.includes(value.toLowerCase())) continue; // drop hallucinations
    if (NAME_STOPWORDS.has(value.toLowerCase())) continue;
    let type = String(e.type || 'OTHER').toUpperCase().replace(/[^A-Z]/g, '');
    if (!ENTITY_TYPES.includes(type)) type = mapLooseType(type);
    if (isLikelyFalsePositive(value, type, text)) continue;
    out.push({ text: findOriginalCase(text, value), type, source: 'on-device' });
  }
  return dedupe(out);
}

const NUMERIC_TYPES = new Set(['PHONE', 'AADHAAR', 'ACCOUNT', 'CARD', 'ID', 'PINCODE']);
function isLikelyFalsePositive(value, type, text) {
  // Money amounts and plain numbers (Rs. 150.00, 4,862) are facts the explanation needs.
  if (/^(?:rs\.?|inr|₹|\$)?\s*[\d,]+(?:\.\d+)?\s*(?:\/-)?$/i.test(value) && !NUMERIC_TYPES.has(type)) return true;
  if (/(?:rs\.?|inr|₹)\s*$/i.test(text.slice(0, text.toLowerCase().indexOf(value.toLowerCase())).slice(-6))) return true;
  // Model "OTHER" guesses are too noisy; users can hide extra items manually.
  if (type === 'OTHER') return true;
  // A date is only a DOB if it's labelled as one or is clearly in the past (>10 years).
  if (type === 'DOB') {
    const y = (value.match(/(19|20)\d{2}/) || [])[0];
    const i = text.toLowerCase().indexOf(value.toLowerCase());
    const before = text.slice(Math.max(0, i - 25), i).toLowerCase();
    const labelled = /d\.?o\.?b|birth|born/.test(before);
    if (!labelled && (!y || Number(y) > new Date().getFullYear() - 10)) return true;
  }
  return false;
}

function mapLooseType(t) {
  if (/NAME|PERSON|PEOPLE/.test(t)) return 'PERSON';
  if (/ADDR|LOCATION|STREET|CITY/.test(t)) return 'ADDRESS';
  if (/PHONE|MOBILE|TEL/.test(t)) return 'PHONE';
  if (/MAIL/.test(t)) return 'EMAIL';
  if (/ACC|BANK/.test(t)) return 'ACCOUNT';
  if (/BIRTH|DOB/.test(t)) return 'DOB';
  if (/ID|NUMBER/.test(t)) return 'ID';
  return 'OTHER';
}

function findOriginalCase(text, value) {
  const i = text.toLowerCase().indexOf(value.toLowerCase());
  return i >= 0 ? text.slice(i, i + value.length) : value;
}

function dedupe(list) {
  const seen = new Map();
  for (const e of list) {
    const key = e.text.toLowerCase();
    if (!seen.has(key)) seen.set(key, { ...e });
    else {
      const prev = seen.get(key);
      if (prev.source !== e.source) prev.source = 'both';
      if (prev.type === 'OTHER' && e.type !== 'OTHER') prev.type = e.type;
    }
  }
  // If a value is fully contained in a longer value of the same type, keep the longer one
  // (but keep both if types differ, e.g. a name inside an address).
  const arr = [...seen.values()];
  return arr.filter((e) => !arr.some((o) => o !== e && o.type === e.type && o.text.length > e.text.length && o.text.toLowerCase().includes(e.text.toLowerCase())));
}

/** Merge rule + model entities. Rules win on type for structured identifiers. */
export function mergeEntities(...lists) {
  return dedupe(lists.flat());
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the shield: replace every enabled entity with a stable token.
 * Returns { redacted, vault: {token: value}, items: [{token,text,type,source,count}] }
 */
export function buildShield(text, entities) {
  const counters = {};
  const vault = {};
  const items = [];
  let redacted = text;
  // Longest first so "Ravi Kumar Reddy" is replaced before "Ravi".
  const sorted = [...entities].filter((e) => e.enabled !== false).sort((a, b) => b.text.length - a.text.length);
  for (const e of sorted) {
    const re = new RegExp(escapeRe(e.text).replace(/\\? /g, '\\s+'), 'gi');
    const matches = redacted.match(re);
    if (!matches) continue;
    counters[e.type] = (counters[e.type] || 0) + 1;
    const token = `[${e.type}_${counters[e.type]}]`;
    vault[token] = e.text;
    redacted = redacted.replace(re, token);
    items.push({ token, text: e.text, type: e.type, source: e.source, count: matches.length });
  }
  return { redacted, vault, items };
}

/** Put real values back into any string, array or object returned by the cloud. */
export function restore(value, vault) {
  if (typeof value === 'string') {
    return value.replace(/\[?\b([A-Z]+_\d+)\b\]?/g, (m, inner) => {
      const token = `[${inner}]`;
      return Object.prototype.hasOwnProperty.call(vault, token) ? vault[token] : m;
    });
  }
  if (Array.isArray(value)) return value.map((v) => restore(v, vault));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = restore(v, vault);
    return out;
  }
  return value;
}

/** Final safety check before anything leaves the device: no vault value may appear. */
export function leakCheck(outgoing, vault) {
  const lower = outgoing.toLowerCase();
  return Object.values(vault).filter((v) => lower.includes(v.toLowerCase()));
}

export function byteLength(s) {
  return new TextEncoder().encode(s || '').length;
}

/** Split text into segments for highlighting: [{text, entity?}] */
export function segment(text, items, useTokens) {
  const needles = items.map((i) => ({ needle: useTokens ? i.token : i.text, item: i }))
    .sort((a, b) => b.needle.length - a.needle.length);
  if (!needles.length) return [{ text }];
  const re = new RegExp(needles.map((n) => escapeRe(n.needle).replace(/\\? /g, '\\s+')).join('|'), 'gi');
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const hit = needles.find((n) => n.needle.toLowerCase().replace(/\s+/g, ' ') === m[0].toLowerCase().replace(/\s+/g, ' '));
    out.push({ text: m[0], item: hit ? hit.item : null });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
