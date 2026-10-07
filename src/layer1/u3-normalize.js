// U3 Normalizer and validator (tech-spec 4, component U3). Fully deterministic: no LLM, no clock, no I/O.
//
// - Text helpers shared by Layer 1: Arabic-Indic digits to Western, Arabic letter normalisation, tokenising.
// - Parsers: money in Egyptian Arabic and English ("15 ألف", "١٥٠٠٠", "15k", "حوالي ١٢ الف", "1500 في الشهر",
//   "قسط 1500"), storage ("128 جيجا", "1 تيرا"), screen size ("55 inch", "٦٥ بوصة").
// - normalizeExtraction(): maps the extractor's raw slot values to option ids, numbers, city keys, retailer ids
//   and product ids, and drops any slot or option id that is not in the category config.
//
// Layer 1 reads only the IDENTITY of catalog rows here (product id, brand, name, aliases; retailer id and name)
// to map the buyer's words to ids. It never reads prices or attributes (tech-spec 3: Layer 1 knows nothing
// about prices).

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

/**
 * Arabic-Indic (U+0660..0669) and Extended Arabic-Indic (U+06F0..06F9) digits to Western digits, plus the
 * Arabic decimal and thousands separators.
 * @param {string} s
 * @returns {string}
 */
export function toWesternDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/٬/g, ','); // Arabic thousands separator
}

/**
 * Normalise Arabic spelling variants so keyword and label matching is robust:
 * diacritics and tatweel removed; alef forms to bare alef; alef maqsura to ya; ta marbuta to ha.
 * @param {string} s
 * @returns {string}
 */
export function normalizeArabic(s) {
  return String(s ?? '')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/ی/g, 'ي');
}

/**
 * Full normalisation used for matching: Western digits, Arabic normalised, lower case, punctuation to spaces,
 * digits split from attached letters ("15k" -> "15 k", "ب15" -> "ب 15"), single spaces.
 * Decimal points and thousands commas inside numbers are kept.
 * @param {string} s
 * @returns {string}
 */
export function normalizeText(s) {
  let t = normalizeArabic(toWesternDigits(s)).toLowerCase();
  t = t.replace(/[،؛؟!?;:()[\]{}"'«»“”‘’`|\\*_#=+<>~^]/g, ' ');
  t = t.replace(/(\d)[,.](?!\d)/g, '$1 ').replace(/(^|[^\d])[,.]/g, '$1 ');
  t = t.replace(/(\d)([a-z؀-ۿ])/g, '$1 $2').replace(/([a-z؀-ۿ])(\d)/g, '$1 $2');
  t = t.replace(/[/\-–—]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Compact form for id and alias matching: normalised, then only letters and digits. */
export function compact(s) {
  return normalizeText(s).replace(/[^a-z0-9؀-ۿ]/g, '');
}

// ---------------------------------------------------------------------------------------------
// Number words (Egyptian Arabic and English). Keys are in normalizeArabic() form.
// ---------------------------------------------------------------------------------------------

/** @type {Record<string, number>} */
const NUM_WORDS = {
  // Arabic units, teens, tens, hundreds (Egyptian and MSA spellings)
  'واحد': 1, 'اتنين': 2, 'اثنين': 2, 'تلاته': 3, 'ثلاثه': 3, 'تلات': 3, 'اربعه': 4, 'اربع': 4, 'خمسه': 5, 'خمس': 5,
  'سته': 6, 'ست': 6, 'سبعه': 7, 'سبع': 7, 'تمانيه': 8, 'ثمانيه': 8, 'تمن': 8, 'تسعه': 9, 'تسع': 9, 'عشره': 10, 'عشر': 10,
  'حداشر': 11, 'اتناشر': 12, 'تلتاشر': 13, 'تلاتاشر': 13, 'اربعتاشر': 14, 'اربعطاشر': 14, 'خمستاشر': 15, 'خمسطاشر': 15,
  'ستاشر': 16, 'سطاشر': 16, 'سبعتاشر': 17, 'سبعطاشر': 17, 'تمنتاشر': 18, 'تمنطاشر': 18, 'تسعتاشر': 19, 'تسعطاشر': 19,
  'عشرين': 20, 'تلاتين': 30, 'ثلاثين': 30, 'اربعين': 40, 'خمسين': 50, 'ستين': 60, 'سبعين': 70, 'تمانين': 80, 'ثمانين': 80, 'تسعين': 90,
  'ميه': 100, 'مائه': 100, 'ميت': 100, 'ميتين': 200, 'مائتين': 200, 'تلتميه': 300, 'تلاتميه': 300, 'ربعميه': 400, 'اربعميه': 400,
  'خمسميه': 500, 'ستميه': 600, 'سبعميه': 700, 'تمنميه': 800, 'تسعميه': 900,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const THOUSAND_WORDS = new Set(['الف', 'الاف', 'تلاف', 'k', 'thousand', 'thousands', 'grand']);
const MILLION_WORDS = new Set(['مليون', 'ملايين', 'million', 'm']);
const HUNDRED_WORDS = new Set(['hundred']);
const HALF_WORDS = new Set(['ونص', 'نص', 'half']);
const CONNECTORS = new Set(['و', 'and', 'a']);
// A number followed by one of these is a duration, a size or a share, not money.
const NOT_MONEY_AFTER = new Set(['شهر', 'شهور', 'اشهر', 'month', 'months', 'mo', 'سنه', 'سنين', 'سنتين', 'year', 'years', 'يوم', 'ايام', 'days', 'day',
  'جيجا', 'gb', 'g', 'تيرا', 'tb', 'mah', 'ملي', 'بوصه', 'inch', 'inches', 'w', 'وات', '%', 'hz', 'mp', 'ميجا', 'قدم']);

/** @param {string} tok */
function tokenNumber(tok) {
  if (/^\d+(?:,\d{3})+(?:\.\d+)?$/.test(tok)) return Number(tok.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})+$/.test(tok)) return Number(tok.replace(/\./g, '')); // "15.000" = 15,000 (Egyptian usage)
  if (/^\d+(?:[.,]\d+)?$/.test(tok)) return Number(tok.replace(',', '.'));
  if (tok in NUM_WORDS) return NUM_WORDS[tok];
  // "وخمسميه": conjunction attached to a number word
  if (tok.length > 1 && tok.startsWith('و') && tok.slice(1) in NUM_WORDS) return NUM_WORDS[tok.slice(1)];
  return null;
}

/**
 * Find every number expression in a text ("15 الف ونص", "الف وخمسميه", "15k", "twenty thousand").
 * Expressions followed by a duration or unit word ("12 شهر", "128 جيجا") are dropped.
 * @param {string} text
 * @returns {{value: number, hadMultiplier: boolean}[]}
 */
export function numberExpressions(text) {
  const toks = normalizeText(text).split(' ').filter(Boolean);
  /** @type {{value: number, hadMultiplier: boolean}[]} */
  const out = [];
  let i = 0;
  while (i < toks.length) {
    const start = i;
    let total = 0, cur = 0, any = false, mult = false, lastMult = 0, prevNum = false;
    while (i < toks.length) {
      const tok = toks[i];
      const n = tokenNumber(tok);
      if (n !== null) {
        const attachedAnd = tok.startsWith('و') && !(tok in NUM_WORDS); // "خمسه وعشرين" = 5 + 20
        if (prevNum && !attachedAnd) break; // two numbers in a row ("12 15000"): separate expressions
        cur += n; any = true; prevNum = true; i++; continue;
      }
      if (any && THOUSAND_WORDS.has(tok)) {
        total += (cur || 1) * 1000; cur = 0; mult = true; lastMult = 1000; prevNum = false; i++; continue;
      }
      if (tok === 'الفين' || (!any && tok === 'الف')) { // "ألفين" = 2,000; a bare "ألف" = 1,000
        if (prevNum) break;
        total += tok === 'الفين' ? 2000 : 1000; any = true; mult = true; lastMult = 1000; prevNum = false; i++; continue;
      }
      if (any && MILLION_WORDS.has(tok)) { total += (cur || 1) * 1e6; cur = 0; mult = true; lastMult = 1e6; prevNum = false; i++; continue; }
      if (any && HUNDRED_WORDS.has(tok)) { cur = (cur || 1) * 100; prevNum = false; i++; continue; }
      if (any && HALF_WORDS.has(tok) && lastMult) { total += lastMult / 2; lastMult = 0; prevNum = false; i++; continue; }
      if (any && CONNECTORS.has(tok) && i + 1 < toks.length) {
        const next = toks[i + 1];
        if (tokenNumber(next) !== null || HALF_WORDS.has(next)) { prevNum = false; i++; continue; }
        if (next === 'a' && toks[i + 2] === 'half') { prevNum = false; i += 2; continue; } // "and a half"
      }
      break;
    }
    if (any) {
      const next = toks[i];
      const value = total + cur;
      if (!(next && NOT_MONEY_AFTER.has(next)) && value > 0) out.push({ value, hadMultiplier: mult });
    }
    if (i === start) i++;
  }
  return out;
}

const PER_MONTH_RE = /(في|ف|بال|كل|علي|على)\s*(ال)?شهر|شهريا|شهري\b|قسط|اقساط|تقسيط شهري|a month|per month|each month|every month|monthly|\bmonth\b|\bmo\b|\/\s*m\b|\bpm\b|installment of/;
const APPROX_RE = /حوالي|حوالى|تقريبا|في حدود|فى حدود|يجي|ييجي|around|about|approx|roughly|~|or so|ish\b/;
const DOWN_RE = /مقدم|دفعه اولي|دفعه اولى|down ?payment|upfront|up front|\bdown\b|deposit/;

/**
 * @typedef {Object} MoneyParse
 * @property {number} amount            EGP
 * @property {boolean} perMonth         "1500 في الشهر", "قسط 1500", "1500 a month"
 * @property {boolean} approx           "حوالي", "about"
 * @property {boolean} down             "مقدم 5000", "5k down payment"
 * @property {boolean} assumedThousands a bare small number ("ميزانيتي 15") read as thousands
 */

/**
 * Parse an amount of money in Egyptian Arabic or English. Returns null when no amount is found.
 * When several amounts appear ("من 10 لـ 15 ألف") the largest is returned (budgets are upper bounds).
 * @param {string} text
 * @returns {MoneyParse|null}
 */
export function parseMoney(text) {
  const t = normalizeText(text);
  if (!t) return null;
  const exprs = numberExpressions(t);
  if (!exprs.length) return null;
  // Range written "10 لـ 15 ألف" / "10 to 15k": the multiplier applies to both ends; the max is the upper end anyway.
  const best = exprs.reduce((a, b) => (b.value > a.value ? b : a));
  const perMonth = PER_MONTH_RE.test(t);
  let amount = best.value;
  let assumedThousands = false;
  if (!best.hadMultiplier && !perMonth && amount < 1000 && amount >= 1) { amount *= 1000; assumedThousands = true; }
  return { amount: Math.round(amount), perMonth, approx: APPROX_RE.test(t), down: DOWN_RE.test(t), assumedThousands };
}

/**
 * Parse a storage amount in GB: "128 جيجا", "256GB", "نص تيرا", "1 تيرا", "1TB", "٥١٢".
 * @param {string} text
 * @returns {number|null}
 */
export function parseStorageGb(text) {
  const t = normalizeText(text);
  const tb = t.match(/(\d+(?:\.\d+)?)?\s*(تيرا|tb|terabyte)/);
  if (tb) return Math.round((tb[1] ? Number(tb[1]) : /نص|half/.test(t) ? 0.5 : 1) * 1024);
  if (/(نص|half)\s*(تيرا|tb)/.test(t)) return 512;
  const gb = t.match(/(\d+)\s*(جيجا|جيجابايت|جيجا بايت|gb|g|giga)?/);
  return gb ? Number(gb[1]) : null;
}

/**
 * Parse a screen size in inches: "55 inch", "٦٥ بوصة", '6.7"'.
 * @param {string} text
 * @returns {number|null}
 */
export function parseSizeInches(text) {
  const raw = toWesternDigits(text);
  const q = raw.match(/(\d+(?:\.\d+)?)\s*(?:"|''|”)/);
  if (q) return Number(q[1]);
  const t = normalizeText(raw);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(بوصه|انش|inch|inches|in\b)/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------------------------
// Unmapped ("Not used") topics: factor -> reason. tech-spec 4.1.
// ---------------------------------------------------------------------------------------------

/** Factor ids an unmapped item may carry, the reason shown on its "Not used" chip, and the eval topic name. */
export const UNMAPPED_FACTORS = {
  look_colour: { reason: 'no_data', topic: 'colour' },
  trade_in: { reason: 'not_supported', topic: 'trade-in' },
  fakes_used: { reason: 'not_supported', topic: 'condition' }, // new vs used or open box
  timing_launch_currency: { reason: 'not_supported', topic: 'wait-for-sale' }, // waiting for a better sale or a launch
  family_opinion: { reason: 'not_supported', topic: 'social' },
  reviews: { reason: 'no_data', topic: 'reviews' },
  known_defects: { reason: 'no_data', topic: 'defects' },
  spare_parts: { reason: 'no_data', topic: 'spare-parts' },
  branch_pickup: { reason: 'no_data', topic: 'pickup' },
  other: { reason: 'not_supported', topic: 'other' },
};

export const REASON_LABELS = {
  not_supported: { en: 'Not supported yet', ar: 'لسه مش مدعوم' },
  no_data: { en: 'No data yet', ar: 'مفيش بيانات عنه لسه' },
};

// ---------------------------------------------------------------------------------------------
// Identity lookups (product and retailer ids from the buyer's words)
// ---------------------------------------------------------------------------------------------

/** Arabic brand and model words the buyer may type, mapped to the catalog's Latin spelling. */
const AR_MODEL_WORDS = [
  ['ايفون', 'iphone'], ['اي فون', 'iphone'], ['جالاكسي', 'galaxy'], ['جلاكسي', 'galaxy'], ['سامسونج', 'samsung'], ['سامسونح', 'samsung'],
  ['شاومي', 'xiaomi'], ['ريدمي', 'redmi'], ['بوكو', 'poco'], ['اوبو', 'oppo'], ['رينو', 'reno'], ['ريلمي', 'realme'], ['هونر', 'honor'],
  ['انفينكس', 'infinix'], ['تكنو', 'tecno'], ['فيفو', 'vivo'], ['موتورولا', 'motorola'], ['موتو', 'moto'], ['نوت', 'note'],
  ['برو', 'pro'], ['ماكس', 'max'], ['الترا', 'ultra'], ['بلس', 'plus'], ['لايت', 'lite'], ['نيو', 'neo'], ['ماجيك', 'magic'],
];

/**
 * Resolve a model name the buyer wrote to a product id: matches id, name, alias, or brand + alias
 * (case, spaces and punctuation ignored; common Arabic spellings transliterated). Exact matches only.
 * @param {string} raw
 * @param {{id: string, brand: string, name: string, aliases?: string[]}[]} products
 * @returns {string|null}
 */
export function resolveProductId(raw, products) {
  if (!raw) return null;
  let t = normalizeText(raw);
  for (const [ar, en] of AR_MODEL_WORDS) t = t.split(ar).join(' ' + en + ' ');
  const q = compact(t);
  if (!q) return null;
  for (const p of products || []) {
    const keys = [p.id, p.name, ...(p.aliases || []).flatMap((a) => [a, `${p.brand} ${a}`])];
    if (keys.some((k) => compact(k) === q)) return p.id;
  }
  return null;
}

/**
 * Resolve a shop the buyer named to a retailer id (id, full name, or the first word of the name).
 * @param {string} raw
 * @param {{id: string, name: string}[]} retailers
 * @returns {string|null}
 */
export function resolveRetailerId(raw, retailers) {
  const q = compact(raw);
  if (!q) return null;
  for (const r of retailers || []) {
    const first = compact(String(r.name || '').split(/\s+/)[0]);
    if (q === compact(r.id) || q === compact(r.name) || (first && q === first)) return r.id;
  }
  return null;
}

/**
 * Map a value the extractor gave (an option id or a label in either language) to an option id of the slot.
 * @param {any} slot
 * @param {any} value
 * @returns {string|null}
 */
export function optionIdFor(slot, value) {
  if (value == null) return null;
  const s = String(value);
  if (slot.options.some((o) => o.id === s)) return s;
  const q = compact(s);
  for (const o of slot.options) {
    if (!o.label) continue;
    if (compact(o.label.en) === q || compact(o.label.ar) === q) return o.id;
  }
  return null;
}

/** City key for a city name in Arabic or English (option id, label), or null. */
function cityKeyFor(slot, value) {
  return optionIdFor(slot, value);
}

/**
 * Smallest preset option of a numeric slot whose value is >= the amount (budgets and caps are upper bounds:
 * presets are only used for labels; the profile keeps the exact typed number).
 */
function storageOption(slot, gb) {
  const presets = slot.options
    .map((o) => ({ id: o.id, min: ((o.effects && o.effects.must) || []).find((m) => m.attr === 'storage_gb' && m.op === '>=') }))
    .map((x) => ({ id: x.id, min: x.min ? x.min.value : 0 }))
    .sort((a, b) => a.min - b.min);
  if (!presets.length) return null;
  // The weakest option that still guarantees what was asked: e.g. "200 GB" -> 256 or more.
  const atLeast = presets.find((p) => p.min >= gb);
  if (gb <= (presets[0].min || 0) || gb <= 64) return presets[0].id;
  return (atLeast || presets[presets.length - 1]).id;
}

/** True when the slot's options carry a must on storage_gb (the storage-need slot of any category). */
function isStorageSlot(slot) {
  return slot.options.some((o) => ((o.effects && o.effects.must) || []).some((m) => m.attr === 'storage_gb'));
}

// ---------------------------------------------------------------------------------------------
// normalizeExtraction
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} RawSlot     One slot as the extractor (LLM) returned it.
 * @property {string} slot
 * @property {any[]} [values]
 * @property {string|null} [amountText]
 * @property {number} [confidence]
 * @property {string} [evidence]
 */

/**
 * @typedef {Object} NormalizedAnswer
 * @property {string} slot
 * @property {any} value           option id, option ids (multi), number (numeric slot), {prefer, avoid} (shops), product id or name
 * @property {number} confidence   0..1 after U3's guards
 * @property {string} evidence
 * @property {string} [raw]        the buyer's own words for the value (model in mind, amounts)
 * @property {string[]} [flags]    why confidence was lowered (evidence_not_found, no_evidence, assumed_thousands, out_of_range)
 */

/**
 * @typedef {Object} NormalizedExtraction
 * @property {NormalizedAnswer[]} answers
 * @property {{text: string, reason: 'not_supported'|'no_data', factor: string}[]} unmapped
 * @property {{slot: string, value?: any, why: string}[]} dropped   what U3 removed and why (for logs and evals)
 */

/**
 * Normalise and validate the extractor's output against the category config. Deterministic.
 * Drops unknown slots and option ids; parses amounts; maps cities, shops, brands and models to ids.
 * Applies two guards: evidence that is not a quote of the buyer's text caps confidence at 0.5; missing
 * evidence caps it at 0.6 (so neither becomes a pre-filled chip).
 * @param {any} config
 * @param {{slots?: RawSlot[], unmapped?: any[]}} extraction
 * @param {{text?: string, products?: any[], retailers?: any[]}} [ctx]
 * @returns {NormalizedExtraction}
 */
export function normalizeExtraction(config, extraction, ctx = {}) {
  const slotById = new Map(config.slots.map((s) => [s.id, s]));
  const buyer = normalizeText(ctx.text || '');
  /** @type {NormalizedAnswer[]} */
  const answers = [];
  /** @type {{slot: string, value?: any, why: string}[]} */
  const dropped = [];
  const raw = Array.isArray(extraction && extraction.slots) ? extraction.slots : [];

  /** @param {NormalizedAnswer} a */
  const push = (a) => {
    const prev = answers.findIndex((x) => x.slot === a.slot);
    if (prev >= 0) {
      const p = answers[prev];
      const slot = slotById.get(a.slot);
      if (slot.multi && Array.isArray(p.value) && Array.isArray(a.value)) {
        p.value = [...new Set([...p.value, ...a.value])];
        p.confidence = Math.min(p.confidence, a.confidence);
        return;
      }
      if (a.confidence <= p.confidence) return;
      answers.splice(prev, 1);
    }
    answers.push(a);
  };

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const slot = slotById.get(item.slot);
    if (!slot) { dropped.push({ slot: String(item.slot), why: 'unknown_slot' }); continue; }
    const values = Array.isArray(item.values) ? item.values : item.values == null ? [] : [item.values];
    const amountText = typeof item.amountText === 'string' && item.amountText.trim() ? item.amountText : null;
    let confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : 0;
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim() : '';
    /** @type {string[]} */
    const flags = [];
    if (!evidence) { confidence = Math.min(confidence, 0.6); flags.push('no_evidence'); }
    else if (buyer && !buyer.includes(normalizeText(evidence))) { confidence = Math.min(confidence, 0.5); flags.push('evidence_not_found'); }

    const base = { slot: slot.id, confidence, evidence };

    // Numeric money slots: the buyer's words for the amount, parsed here (never by the LLM).
    if (slot.numeric) {
      const money = amountText ? parseMoney(amountText) : null;
      if (money) {
        let target = slot;
        // "1500 في الشهر" read into the budget slot belongs to the monthly cap; "مقدم 5000" to the down payment.
        if (money.down && slot.id !== 'down' && slotById.has('down')) target = slotById.get('down');
        else if (money.perMonth && slot.id === 'budget' && slotById.has('monthlyCap')) target = slotById.get('monthlyCap');
        const { min, max } = target.numeric;
        if (money.amount < min || money.amount > max) { dropped.push({ slot: target.id, value: money.amount, why: 'out_of_range' }); continue; }
        const f = money.assumedThousands ? [...flags, 'assumed_thousands'] : flags;
        push({ ...base, slot: target.id, value: money.amount, raw: amountText, confidence: money.assumedThousands ? Math.min(confidence, 0.6) : confidence, flags: f });
        continue;
      }
      const opt = values.map((v) => optionIdFor(slot, v)).find(Boolean);
      if (opt) { push({ ...base, value: opt, flags }); continue; }
      const num = values.find((v) => typeof v === 'number' && Number.isFinite(v));
      if (num !== undefined && num >= slot.numeric.min && num <= slot.numeric.max) { push({ ...base, value: num, flags }); continue; }
      dropped.push({ slot: slot.id, value: amountText ?? values, why: 'no_amount' });
      continue;
    }

    if (slot.valueShape === 'shops') {
      const shops = { prefer: [], avoid: [] };
      for (const v of values) {
        const m = String(v).match(/^\s*(prefer|avoid)\s*:\s*(.+)$/i);
        if (!m) { dropped.push({ slot: slot.id, value: v, why: 'bad_shop_value' }); continue; }
        const id = resolveRetailerId(m[2], ctx.retailers);
        if (!id) { dropped.push({ slot: slot.id, value: v, why: 'unknown_shop' }); continue; }
        const list = shops[/** @type {'prefer'|'avoid'} */ (m[1].toLowerCase())];
        if (!list.includes(id)) list.push(id);
      }
      if (shops.prefer.length || shops.avoid.length) push({ ...base, value: shops, flags });
      continue;
    }

    if (slot.valueShape === 'product') {
      const name = values.map((v) => (v == null ? '' : String(v).trim())).find(Boolean);
      if (!name) { dropped.push({ slot: slot.id, why: 'empty' }); continue; }
      const id = resolveProductId(name, ctx.products);
      push({ ...base, value: id || name, raw: name, flags: id ? flags : [...flags, 'not_in_catalog'] });
      continue;
    }

    // Option slots (including city, whose option ids are the zone city keys; and storage need, which may come as an amount).
    /** @type {string[]} */
    const ids = [];
    for (const v of values) {
      const id = slot.id === 'city' ? cityKeyFor(slot, v) : optionIdFor(slot, v);
      if (id) { if (!ids.includes(id)) ids.push(id); } else dropped.push({ slot: slot.id, value: v, why: 'unknown_option' });
    }
    if (!ids.length && amountText && isStorageSlot(slot)) {
      const gb = parseStorageGb(amountText);
      const id = gb ? storageOption(slot, gb) : null;
      if (id) ids.push(id);
    }
    if (!ids.length) { if (!values.length) dropped.push({ slot: slot.id, why: 'empty' }); continue; }
    push({ ...base, value: slot.multi ? ids : ids[0], flags });
  }

  // Unmapped ("Not used") items: the reason is decided here from the factor, not by the LLM.
  const unmapped = [];
  for (const u of Array.isArray(extraction && extraction.unmapped) ? extraction.unmapped : []) {
    if (!u || typeof u !== 'object') continue;
    const text = String(u.text ?? u.quote ?? '').trim();
    if (!text) continue;
    const factor = Object.prototype.hasOwnProperty.call(UNMAPPED_FACTORS, u.factor) ? u.factor : 'other';
    if (!unmapped.some((x) => x.text === text)) unmapped.push({ text, reason: UNMAPPED_FACTORS[factor].reason, factor, topic: UNMAPPED_FACTORS[factor].topic });
  }
  return { answers, unmapped, dropped };
}

/**
 * Validate and normalise one value the buyer gave through a tile, a typed amount or an edit.
 * Returns {ok, value} or {ok: false, error}.
 * @param {any} config
 * @param {string} slotId
 * @param {any} value
 * @param {{products?: any[], retailers?: any[]}} [ctx]
 * @returns {{ok: true, value: any} | {ok: false, error: string}}
 */
export function normalizeAnswer(config, slotId, value, ctx = {}) {
  const slot = config.slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, error: `unknown slot "${slotId}"` };
  if (value === null) return { ok: true, value: null }; // clearing a value (edit)
  if (slot.numeric) {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= slot.numeric.min && value <= slot.numeric.max
        ? { ok: true, value } : { ok: false, error: `amount out of range ${slot.numeric.min}..${slot.numeric.max}` };
    }
    const opt = optionIdFor(slot, value);
    if (opt) return { ok: true, value: opt };
    const m = parseMoney(String(value));
    if (m && m.amount >= slot.numeric.min && m.amount <= slot.numeric.max) return { ok: true, value: m.amount };
    return { ok: false, error: 'not an amount' };
  }
  if (slot.valueShape === 'shops') {
    const v = value && typeof value === 'object' ? value : {};
    const map = (list) => (Array.isArray(list) ? list : []).map((x) => resolveRetailerId(x, ctx.retailers));
    const prefer = map(v.prefer), avoid = map(v.avoid);
    if ([...prefer, ...avoid].some((x) => !x)) return { ok: false, error: 'unknown shop' };
    return { ok: true, value: { prefer: [...new Set(prefer)], avoid: [...new Set(avoid)] } };
  }
  if (slot.valueShape === 'product') {
    const s = String(value).trim();
    if (!s) return { ok: false, error: 'empty model' };
    return { ok: true, value: resolveProductId(s, ctx.products) || s };
  }
  const list = Array.isArray(value) ? value : [value];
  const ids = list.map((v) => optionIdFor(slot, v));
  if (!ids.length || ids.some((x) => !x)) return { ok: false, error: `not an option of "${slotId}"` };
  if (!slot.multi && ids.length > 1) return { ok: false, error: `"${slotId}" takes one answer` };
  return { ok: true, value: slot.multi ? [...new Set(ids)] : ids[0] };
}
