// U1 Category detector (tech-spec 4, component U1).
//
// Rules first: keywords in Arabic and English plus model names (the catalog's product aliases). An LLM call is
// made only when the rules are unclear. Given the configured categories' configs, that one call also fills the
// slots of the category it finds ("detect"), so an unclear opener costs one LLM call, not two (founder decision). The five categories Wisedo covers are always detected; only those with
// a category config in the snapshot are "configured" (today only mobile). The others get an honest
// "not configured yet" answer that offers the configured ones; anything else gets "not something we cover".
import { normalizeText, parseSizeInches } from './u3-normalize.js';
import { callLlm, checkExtractionShape, extractionProperties, extractionRules, slotLines } from './u2-extract.js';

/** The five categories of the product (tech-spec 1, BRD). Labels for tiles and messages. */
export const CATEGORIES = [
  { id: 'mobile', label: { ar: 'موبايل', en: 'Mobile phone' }, plural: { ar: 'الموبايلات', en: 'mobile phones' } },
  { id: 'laptop', label: { ar: 'لابتوب', en: 'Laptop' }, plural: { ar: 'اللابتوبات', en: 'laptops' } },
  { id: 'tv', label: { ar: 'تلفزيون', en: 'TV' }, plural: { ar: 'التلفزيونات', en: 'TVs' } },
  { id: 'ac', label: { ar: 'تكييف', en: 'Air conditioner' }, plural: { ar: 'التكييفات', en: 'air conditioners' } },
  { id: 'fridge', label: { ar: 'تلاجة', en: 'Fridge' }, plural: { ar: 'التلاجات', en: 'fridges' } },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

// Keywords are written in normalizeText() form (Arabic normalised: ة->ه, أ->ا, ى->ي; lower case).
// strong = decides the category alone; weak = only adds weight (also used by other categories, e.g. "شاشه").
// `sub` keywords match inside a word (Arabic prefixes/suffixes: "للموبايل", "موبايلي"); the rest match whole words.
const KEYWORDS = {
  mobile: {
    strong: ['موبايل', 'موبيل', 'تليفون', 'تلفون', 'جوال', 'هاتف', 'ايفون', 'اي فون', 'جالاكسي', 'جلاكسي', 'ريدمي', 'phone', 'phones', 'smartphone', 'mobile', 'cellphone', 'iphone', 'galaxy', 'redmi', 'poco', 'pixel', 'oneplus'],
    sub: ['موبايل', 'موبيل', 'تليفون', 'ايفون', 'جوال'],
    weak: ['سامسونج', 'شاومي', 'اوبو', 'ريلمي', 'فيفو', 'oppo', 'realme', 'vivo', 'xiaomi', 'samsung', 'infinix', 'tecno', 'honor', 'motorola', 'سيلفي', 'selfie', 'واتساب', 'whatsapp', 'ببجي', 'pubg', 'فري فاير'],
  },
  laptop: {
    // Series names and laptop parts (real buyers name a series or a GPU and never say "laptop"; Reddit check 2026-10-09).
    strong: ['لابتوب', 'لاب توب', 'لاب', 'laptop', 'laptops', 'notebook', 'macbook', 'ماك بوك', 'ماكبوك', 'thinkpad', 'ideapad', 'vivobook', 'zenbook', 'chromebook', 'كمبيوتر محمول',
      'legion', 'ليجن', 'loq', 'tuf', 'rog', 'zephyrus', 'nitro', 'نيترو', 'predator', 'aspire', 'swift', 'omen', 'victus', 'pavilion', 'envy', 'elitebook', 'probook', 'inspiron', 'vostro', 'latitude', 'xps', 'alienware', 'yoga', 'aero', 'katana', 'rtx', 'gtx', 'ryzen', 'رايزن', 'core i5', 'core i7', 'core i9', 'كارت شاشه'],
    sub: ['لابتوب'],
    weak: ['كمبيوتر', 'computer', 'pc', 'ويندوز', 'windows', 'برمجه', 'coding', 'gpu', 'رامات', 'ram', 'ips'],
  },
  tv: {
    strong: ['تلفزيون', 'تليفزيون', 'تلفاز', 'تي في', 'tv', 'tvs', 'television', 'smart tv', 'شاشه سمارت', 'سمارت تي في', 'qled'],
    sub: ['تلفزيون', 'تليفزيون'],
    // OLED is weak: laptops have OLED screens too ("الشاشة OLED تستاهل فرق السعر عن IPS؟").
    weak: ['شاشه', 'بوصه', 'inch', 'inches', 'سمارت', 'smart', 'نتفليكس', 'netflix', 'بلايستيشن', 'playstation', 'ps5', '4k', 'oled'],
  },
  ac: {
    strong: ['تكييف', 'تكييفات', 'مكيف', 'مكيفات', 'air conditioner', 'air conditioning', 'ac', 'a c', 'btu', 'حصان'],
    sub: ['تكييف', 'مكيف'],
    weak: ['سبليت', 'split', 'تبريد', 'cooling', 'inverter', 'انفرتر'],
  },
  fridge: {
    strong: ['تلاجه', 'ثلاجه', 'تلاجات', 'ثلاجات', 'fridge', 'fridges', 'refrigerator', 'ديب فريزر', 'deep freezer'],
    sub: ['تلاجه', 'ثلاجه'],
    weak: ['فريزر', 'freezer', 'نوفروست', 'نو فروست', 'no frost', 'قدم', 'feet', 'لتر', 'litres', 'liters'],
  },
};

/** Products Wisedo does not cover at all (answered with "not something we cover yet"). */
const UNSUPPORTED = [
  { id: 'washing_machine', words: ['غساله', 'غسالات', 'washing machine', 'washer'], label: { ar: 'غسالة', en: 'washing machines' } },
  { id: 'headphones', words: ['سماعه', 'سماعات', 'headphones', 'earbuds', 'earphones', 'airpods'], label: { ar: 'سماعات', en: 'headphones' } },
  { id: 'tablet', words: ['تابلت', 'tablet', 'ايباد', 'ipad'], label: { ar: 'تابلت', en: 'tablets' } },
  { id: 'smartwatch', words: ['ساعه ذكيه', 'smartwatch', 'smart watch'], label: { ar: 'ساعة ذكية', en: 'smartwatches' } },
  { id: 'cooker', words: ['بوتاجاز', 'cooker', 'oven', 'فرن'], label: { ar: 'بوتاجاز', en: 'cookers' } },
  { id: 'microwave', words: ['ميكروويف', 'microwave'], label: { ar: 'ميكروويف', en: 'microwaves' } },
  { id: 'heater', words: ['سخان', 'water heater', 'heater'], label: { ar: 'سخان', en: 'water heaters' } },
  { id: 'vacuum', words: ['مكنسه', 'vacuum'], label: { ar: 'مكنسة', en: 'vacuum cleaners' } },
  { id: 'console', words: ['بلايستيشن', 'playstation', 'xbox'], label: { ar: 'جهاز ألعاب', en: 'game consoles' } },
];

/** Whole-word or phrase match on normalised text padded with spaces. */
function hasWord(padded, kw) {
  return padded.includes(' ' + kw + ' ');
}

/**
 * @typedef {Object} CategoryDetection
 * @property {'configured'|'not_configured'|'unsupported'|'unclear'} status
 * @property {string|null} category     one of CATEGORY_IDS (configured or not) or null
 * @property {'rules'|'llm'|'tile'|null} by
 * @property {number} confidence
 * @property {string[]} matched         keywords that matched (for logs)
 * @property {string|null} [product]    unsupported product id (washing_machine, ...)
 * @property {string} [llmError]        when an LLM call was made and failed
 * @property {{slots: any[], unmapped: any[]}} [extraction]  combined call: the raw slots for this category
 */

/**
 * Rules-only detection. Model names come from the snapshot's product aliases (identity only).
 * @param {string} text
 * @param {{productsByCategory?: Record<string, {id: string, name: string, aliases?: string[]}[]>}} [opts]
 * @returns {{category: string|null, confidence: number, matched: string[], scores: Record<string, number>, unsupported: any|null}}
 */
export function detectByRules(text, opts = {}) {
  const padded = ' ' + normalizeText(text) + ' ';
  /** @type {Record<string, number>} */
  const scores = {};
  /** @type {Record<string, boolean>} */
  const strong = {};
  /** @type {Record<string, number>} */
  const firstAt = {}; // where the category's first strong word appears
  const at = (cat, w) => { const i = padded.indexOf(' ' + w + ' ') >= 0 ? padded.indexOf(' ' + w + ' ') : padded.indexOf(w); if (i >= 0 && !(firstAt[cat] <= i)) firstAt[cat] = i; };
  const matched = [];
  for (const [cat, kw] of Object.entries(KEYWORDS)) {
    let s = 0;
    for (const w of kw.strong) if (hasWord(padded, w)) { s += 3; strong[cat] = true; matched.push(w); at(cat, w); }
    for (const w of kw.sub || []) if (!hasWord(padded, w) && padded.includes(w)) { s += 3; strong[cat] = true; matched.push(w); at(cat, w); }
    for (const w of kw.weak) if (hasWord(padded, w)) { s += 1; matched.push(w); }
    // Model names from the catalog (e.g. "a56", "redmi note 14", "iphone 15") are strong signals.
    for (const p of (opts.productsByCategory && opts.productsByCategory[cat]) || []) {
      for (const a of [p.name, ...(p.aliases || [])]) {
        const n = normalizeText(a);
        if (n && hasWord(padded, n)) { s += 3; strong[cat] = true; matched.push(n); at(cat, n); break; }
      }
    }
    // "شاشة 55 بوصة" / "a 50 inch screen": a screen of 24 inches or more is a TV in Egyptian usage.
    if (cat === 'tv' && !strong.tv && (hasWord(padded, 'شاشه') || hasWord(padded, 'screen')) && (parseSizeInches(text) || 0) >= 24) {
      s += 3; strong.tv = true; matched.push('screen_size');
    }
    if (s) scores[cat] = s;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const unsupported = UNSUPPORTED.find((u) => u.words.some((w) => hasWord(padded, w) || (w.length >= 5 && /[؀-ۿ]/.test(w) && padded.includes(w)))) || null;
  if (ranked.length && strong[ranked[0][0]] && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
    return { category: ranked[0][0], confidence: 0.95, matched, scores, unsupported: null };
  }
  // A tie between two strong categories: the product named first is the one wanted ("عايز لابتوب ... اتنصب عليّا
  // قبل كده في موبايل"). Lower confidence, still above the pre-fill threshold.
  if (ranked.length >= 2 && ranked[0][1] === ranked[1][1] && (ranked.length === 2 || ranked[2][1] < ranked[0][1])) {
    const [a, b] = [ranked[0][0], ranked[1][0]];
    // Only when the two are far apart (a separate clause); "موبايل ولابتوب" (both at once) stays unclear.
    const wordsBetween = padded.slice(Math.min(firstAt[a], firstAt[b]), Math.max(firstAt[a], firstAt[b])).trim().split(/\s+/).length;
    if (strong[a] && strong[b] && firstAt[a] !== firstAt[b] && wordsBetween >= 4) {
      return { category: firstAt[a] < firstAt[b] ? a : b, confidence: 0.8, matched, scores, unsupported: null };
    }
  }
  return { category: null, confidence: 0, matched, scores, unsupported: ranked.length ? null : unsupported };
}

/** JSON schema for the category LLM call (structured output). */
export const CATEGORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence'],
  properties: {
    category: { type: 'string', enum: [...CATEGORY_IDS, 'other', 'unclear'] },
    confidence: { type: 'number' },
  },
};

/**
 * Build the request for the category LLM call (only used when the rules are unclear).
 * @param {string} text
 */
export function buildCategoryRequest(text) {
  const system = [
    'You classify what product an Egyptian shopper wants to buy. The shopper writes in Egyptian Arabic, English or a mix.',
    `Answer with one category id: ${CATEGORIES.map((c) => `"${c.id}" (${c.label.en})`).join(', ')}, "other" for any other product, or "unclear" when the text does not say what they want to buy.`,
    'confidence is 0 to 1: 0.9 or more when the text names the product, 0.7 to 0.9 when it clearly implies it, below 0.7 when you are guessing.',
    'Return only the JSON object the schema describes.',
  ].join('\n');
  return { kind: 'category', text, system, user: `<buyer_text>\n${text}\n</buyer_text>`, schema: CATEGORY_SCHEMA, maxTokens: 256 };
}

/**
 * Build the combined request: the category, and for a configured category the extraction too, in one call.
 * @param {string} text
 * @param {any[]} configs   the configured categories' configs
 * @param {{retailers?: {id: string, name: string}[]}} [ctx]
 */
export function buildDetectRequest(text, configs, ctx = {}) {
  const lines = [
    'You read what an Egyptian shopper wrote. The text may be Egyptian Arabic, English or a mix, with Arabic-Indic or Western digits. Do two things.',
    '',
    `1. category: what product they want to buy. One id: ${CATEGORIES.map((c) => `"${c.id}" (${c.label.en})`).join(', ')}, "other" for any other product, or "unclear" when the text does not say what they want to buy.`,
    'confidence is 0 to 1: 0.9 or more when the text names the product, 0.7 to 0.9 when it clearly implies it, below 0.7 when you are guessing.',
    '',
    `2. slots and unmapped: only when the category is one of ${configs.map((c) => `"${c.id}"`).join(', ')}, fill that category's slots from the lists below. For any other answer, slots and unmapped are empty lists.`,
    '',
    ...extractionRules(),
  ];
  for (const c of configs) {
    lines.push('', `Slots for "${c.id}" (id: meaning. Options):`, ...slotLines(c, ctx));
  }
  lines.push('', 'Return only the JSON object the schema describes.');
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'confidence', 'slots', 'unmapped'],
    properties: { ...CATEGORY_SCHEMA.properties, ...extractionProperties(configs) },
  };
  return { kind: 'detect', categories: configs.map((c) => c.id), text, system: lines.join('\n'), user: `<buyer_text>\n${text}\n</buyer_text>`, schema, maxTokens: 2048 };
}

/**
 * Detect the category of a buyer's text. Rules first; LLM only if unclear and an `llm` is given.
 * With `configs` (the configured categories' configs) the LLM call is the combined one: a configured category
 * comes back with its `extraction`, so the session does not make a second call.
 * @param {string} text
 * @param {{configured: string[], productsByCategory?: Record<string, any[]>, llm?: Function, timeoutMs?: number, configs?: any[], retailers?: any[]}} opts
 * @returns {Promise<CategoryDetection>}
 */
export async function detectCategory(text, opts) {
  const configured = new Set(opts.configured || []);
  const r = detectByRules(text, opts);
  const status = (cat) => (configured.has(cat) ? 'configured' : 'not_configured');
  if (r.category) return { status: status(r.category), category: r.category, by: 'rules', confidence: r.confidence, matched: r.matched };
  if (r.unsupported) return { status: 'unsupported', category: null, product: r.unsupported.id, by: 'rules', confidence: 0.9, matched: r.matched };
  if (!opts.llm) return { status: 'unclear', category: null, by: null, confidence: 0, matched: r.matched };

  const combined = Array.isArray(opts.configs) && opts.configs.length > 0;
  const req = combined ? buildDetectRequest(text, /** @type {any[]} */ (opts.configs), { retailers: opts.retailers }) : buildCategoryRequest(text);
  const res = await callLlm(opts.llm, req, opts.timeoutMs);
  if (!res.ok) return { status: 'unclear', category: null, by: 'llm', confidence: 0, matched: r.matched, llmError: res.error };
  const out = res.output;
  const cat = out && typeof out.category === 'string' ? out.category : 'unclear';
  const conf = out && typeof out.confidence === 'number' ? Math.max(0, Math.min(1, out.confidence)) : 0;
  if (CATEGORY_IDS.includes(cat)) {
    /** @type {CategoryDetection} */
    const det = { status: status(cat), category: cat, by: 'llm', confidence: conf, matched: r.matched };
    // The slots of the combined call; a bad shape just means the session reads the text on its own.
    if (combined && configured.has(cat) && checkExtractionShape(out) === null) det.extraction = { slots: out.slots, unmapped: out.unmapped || [] };
    return det;
  }
  if (cat === 'other' && conf >= 0.7) return { status: 'unsupported', category: null, product: null, by: 'llm', confidence: conf, matched: r.matched };
  return { status: 'unclear', category: null, by: 'llm', confidence: conf, matched: r.matched };
}

/**
 * The honest answer for a category we know but have not configured, or a product we do not cover.
 * Always offers the configured categories as tiles.
 * @param {CategoryDetection} det
 * @param {string[]} configured
 */
export function categoryMessage(det, configured) {
  const ready = CATEGORIES.filter((c) => configured.includes(c.id));
  const readyEn = ready.map((c) => c.plural.en).join(', ') || 'nothing yet';
  const readyAr = ready.map((c) => c.plural.ar).join('، ') || 'مفيش لسه';
  const tiles = CATEGORIES.map((c) => ({ id: c.id, label: c.label, configured: configured.includes(c.id) }));
  if (det.status === 'not_configured') {
    const c = CATEGORIES.find((x) => x.id === det.category);
    return {
      tiles,
      message: {
        en: `I can't help with ${c.plural.en} yet: that category isn't set up. Right now I can help you choose: ${readyEn}.`,
        ar: `لسه مش جاهز أساعدك في ${c.plural.ar}. دلوقتي أقدر أساعدك تختار: ${readyAr}.`,
      },
    };
  }
  if (det.status === 'unsupported') {
    const u = UNSUPPORTED.find((x) => x.id === det.product);
    const what = u ? u.label : { en: 'that', ar: 'ده' };
    return {
      tiles,
      message: {
        en: `Wisedo doesn't cover ${what.en} yet. We cover ${CATEGORIES.map((c) => c.plural.en).join(', ')}; ready now: ${readyEn}.`,
        ar: `Wisedo لسه مش بيغطي ${what.ar}. بنغطي ${CATEGORIES.map((c) => c.plural.ar).join('، ')}؛ الجاهز دلوقتي: ${readyAr}.`,
      },
    };
  }
  return {
    tiles,
    message: { en: 'What would you like to buy? Pick a category.', ar: 'عايز تشتري إيه؟ اختار نوع المنتج.' },
  };
}
