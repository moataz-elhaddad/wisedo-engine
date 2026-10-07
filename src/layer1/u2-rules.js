// U2 rule-based extractor: the deterministic fallback when no LLM is configured or every LLM failed.
//
// Reads the buyer's text with keyword lists (Egyptian Arabic and English) and returns the same shape as the LLM
// extractor ({slots: [{slot, values, amountText, confidence, evidence}], unmapped: []}), so U3 validates and maps
// it exactly like an LLM answer. It only covers what keywords can catch reliably: amounts (budget, monthly cap,
// down payment), payment method, city, brands (and brands to avoid), main uses, OS, urgency, warranty, storage,
// laptop screen size, AC room size, household size and a few category specifics. Anything else is left for the
// questions. Evidence is always a quote of the normalised text, so U3's evidence guard never fires.

import { normalizeText, numberExpressions } from './u3-normalize.js';

const CONF = 0.8;
const CONF_WEAK = 0.65; // below the pre-fill threshold: shown as a suggestion, not a pre-filled chip

// Keyword lists keyed by "slot.option". A list applies only when the category config has that slot and option.
// Keywords are normalised at load time; a trailing "*" matches any word that starts with it.
// Arabic keywords also match with an attached prefix (و، ب، ل، لل، ال، بال، وال، فال، عال).
/** @type {Record<string, string[]>} */
const LEXICON = {
  // payment
  'pay.cash': ['كاش', 'نقدي', 'نقدا', 'دفعه واحده', 'cash', 'pay in full', 'upfront'],
  'pay.card': ['كريديت*', 'فيزا', 'بطاقه ائتمان', 'كارت ائتمان', 'credit card', 'credit', 'card installments', 'بالكارت'],
  'pay.finance': ['فاليو', 'valu', 'تمويل', 'شركه تمويل', 'finance', 'financing', 'كونتكت', 'contact', 'امان', 'aman', 'سوهولة', 'souhoola', 'premium card'],
  // delivery and buying constraints
  'cod.must': ['لازم الدفع عند الاستلام', 'كاش عند الاستلام بس', 'cash on delivery only', 'cod only'],
  'cod.prefer': ['الدفع عند الاستلام', 'كاش عند الاستلام', 'دفع عند الاستلام', 'cash on delivery', 'cod'],
  'urgentDays.today': ['النهارده', 'انهارده', 'بكره', 'حالا', 'ضروري', 'مستعجل جدا', 'today', 'tomorrow', 'asap', 'urgent', 'urgently'],
  'urgentDays.week': ['خلال اسبوع', 'الاسبوع ده', 'في اسبوع', 'this week', 'within a week'],
  'urgentDays.none': ['مش مستعجل', 'مش مستعجله', 'مفيش استعجال', 'no rush', 'not in a hurry', 'no hurry'],
  'acceptImports.warranty': ['ضمان الوكيل', 'ضمان رسمي', 'ضمان محلي', 'official warranty', 'local warranty'],
  'acceptImports.yes': ['مستورد', 'استيراد', 'imported', 'import', 'grey market'],
  // who it is for
  'who.kid': ['ابني', 'بنتي', 'ابنى', 'عيالي', 'الولاد', 'العيال', 'for my son', 'for my daughter', 'my son', 'my daughter', 'my kid', 'my kids', 'my child'],
  'who.parent': ['ابويا', 'امي', 'والدي', 'والدتي', 'جدي', 'جدتي', 'بابا', 'ماما', 'my dad', 'my mom', 'my father', 'my mother', 'my parents', 'grandma', 'grandpa', 'grandfather', 'grandmother'],
  'who.me': ['ليا', 'لنفسي', 'for me', 'for myself', 'myself'],
  'who.family': ['العيله', 'الاسره', 'البيت كله', 'family', 'household'],
  // OS
  'os.windows': ['ويندوز', 'windows'],
  'os.macos': ['ماك', 'ماك بوك', 'macbook', 'mac', 'macos'],
  'os.ios': ['ايفون', 'iphone', 'ios'],
  'os.android': ['اندرويد', 'android'],
  'os.google_tv': ['جوجل تي في', 'اندرويد', 'google tv', 'android tv', 'android'],
  'os.webos': ['webos', 'ويب او اس'],
  'os.tizen': ['tizen', 'تايزن'],
  'compat.iphone': ['عندي ايفون', 'عندي ايباد', 'ايباد', 'ipad', 'i have an iphone'],
  'compat.mac': ['عندي ماك', 'عندي ايباد', 'i have a mac', 'ipad'],
  'compat.apple_watch': ['ابل واتش', 'apple watch'],
  'compat.galaxy_watch': ['جالاكسي واتش', 'galaxy watch'],
  // laptop and mobile uses
  'use.study': ['مذاكره', 'دراسه', 'جامعه', 'كليه', 'مدرسه', 'اونلاين', 'طالب', 'طالبه', 'study', 'studying', 'university', 'college', 'school', 'student', 'online classes'],
  'use.office': ['شغل مكتب*', 'اكسل', 'ايميل*', 'ميتنج*', 'اجتماعات', 'زوم', 'الشغل', 'شغل', 'office', 'excel', 'email', 'emails', 'meetings', 'zoom', 'work'],
  'use.programming': ['برمجه', 'مبرمج', 'بروجرامنج', 'كودنج', 'programming', 'coding', 'developer', 'software development', 'code'],
  'use.gaming': ['العاب', 'جيمز', 'جيمنج', 'ببجي', 'فري فاير', 'فورتنايت', 'بلايستيشن', 'بلاي ستيشن', 'gaming', 'games', 'game', 'pubg', 'free fire', 'fortnite', 'playstation', 'ps5', 'ps4', 'xbox', 'اكس بوكس'],
  'use.design': ['تصميم', 'فوتوشوب', 'جرافيك', 'اوتوكاد', 'design', 'designer', 'photoshop', 'graphic', 'graphics design', 'autocad', 'illustrator'],
  'use.video': ['مونتاج', 'ايديتنج', 'بريمير', 'video editing', 'editing', 'premiere', 'after effects'],
  'use.basic': ['نت وافلام', 'تصفح', 'browsing', 'just browsing', 'مكالمات وواتساب بس', 'واتساب بس', 'calls only'],
  'use.social': ['سوشيال', 'فيسبوك', 'فيس بوك', 'تيك توك', 'انستجرام', 'انستا', 'يوتيوب', 'social', 'facebook', 'tiktok', 'instagram', 'youtube', 'reels'],
  'use.photo': ['تصوير', 'كاميرا', 'صور', 'سيلفي', 'camera', 'photos', 'photography', 'selfie', 'selfies'],
  'use.work': ['شغل', 'الشغل', 'مكالمات كتير', 'work', 'business calls'],
  // TV uses
  'use.series': ['مسلسلات', 'افلام', 'نتفليكس', 'شاهد', 'series', 'movies', 'films', 'netflix', 'streaming'],
  'use.sports': ['ماتشات', 'كوره', 'ماتش', 'رياضه', 'sports', 'football', 'soccer', 'matches'],
  'use.kids': ['كرتون', 'اطفال', 'cartoons', 'kids'],
  'use.general': ['رسيفر', 'قنوات', 'اخبار', 'receiver', 'satellite', 'channels', 'news'],
  // fridge uses
  'use.bulk': ['لحمه كتير', 'تخزين', 'فريزر كبير', 'مجمد', 'frozen', 'bulk', 'big freezer'],
  'use.cooking': ['طبخ', 'بطبخ', 'cooking', 'cook a lot'],
  'use.cold_drinks': ['مياه ساقعه', 'حاجه ساقعه', 'cold water', 'cold drinks'],
  // gaming level, portability
  'gameLevel.heavy': ['العاب تقيله', 'العاب جديده', 'الترا', 'heavy games', 'aaa', 'ultra', 'high graphics', 'gta', 'cyberpunk', 'call of duty'],
  'gameLevel.light': ['العاب خفيفه', 'فالورانت', 'فيفا', 'light games', 'valorant', 'fifa', 'pes', 'minecraft'],
  'portability.daily': ['بشيله كل يوم', 'هشيله كل يوم', 'خفيف في الشيل', 'وزن خفيف', 'خفيف الوزن', 'lightweight', 'light weight', 'portable', 'carry it every day', 'carry it daily'],
  'portability.desk': ['على المكتب', 'عالمكتب', 'مش هشيله', 'on a desk', 'on my desk', 'desktop replacement'],
  // pains with the current device
  'pain.slow': ['بطيء', 'بطئ', 'بيهنج', 'تهنيج', 'slow', 'lag', 'lags', 'hangs', 'freezes'],
  'pain.battery': ['البطاريه', 'بطاريه', 'شحن', 'battery'],
  'pain.storage': ['المساحه', 'مساحه', 'storage full', 'out of storage'],
  'pain.camera': ['الكاميرا وحشه', 'الصور وحشه', 'bad camera', 'bad photos'],
  'pain.broke': ['بيعطل', 'عطل', 'اتكسر', 'breaks', 'broke', 'broken'],
  'pain.noisy': ['صوته عالي', 'دوشه', 'noisy', 'noise'],
  'pain.sound': ['الصوت ضعيف', 'weak sound'],
  'pain.blurry': ['الكوره مش واضحه', 'blurry'],
  'pain.not_smart': ['مش سمارت', 'not smart'],
  'pain.ice': ['تلج', 'بيعمل تلج', 'ice', 'defrosting'],
  'pain.bills': ['الفاتوره', 'فاتوره', 'استهلاك كهربا', 'bill', 'bills', 'electricity bill'],
  'pain.weak': ['مش بيبرد', 'تبريد ضعيف', 'weak cooling', 'does not cool'],
  // TV specifics
  'console.next_gen': ['ps5', 'بلايستيشن 5', 'بلاي ستيشن 5', 'xbox series', '120 fps', '120 hz', '120hz'],
  'console.casual': ['ps4', 'بلايستيشن 4', 'بلاي ستيشن 4'],
  'panel.oled': ['oled', 'اوليد', 'اوليد*'],
  'panel.qled_mini': ['qled', 'mini led', 'ميني ليد', 'كيو ليد'],
  'wallMount.wall': ['على الحيطه', 'عالحيطه', 'حائط', 'wall mount', 'on the wall'],
  'wallMount.stand': ['على ترابيزه', 'stand', 'on a table'],
  // AC specifics
  'inverterNeed.conventional': ['مش انفرتر', 'غير انفرتر', 'non inverter', 'not inverter'],
  'inverterNeed.inverter': ['انفرتر', 'inverter'],
  'heatNeed.cool_heat': ['بارد ساخن', 'بارد وساخن', 'تدفئه', 'heating', 'hot and cold', 'heat pump', 'cool and heat'],
  'heatNeed.cool': ['بارد بس', 'cooling only', 'cold only'],
  'roomType.bedroom': ['اوضه نوم', 'اوضه النوم', 'غرفه نوم', 'bedroom'],
  'roomType.living': ['ريسبشن', 'صاله', 'الصاله', 'living room', 'reception'],
  'roomType.office': ['مكتب', 'محل', 'office', 'shop', 'store'],
  'roomType.kitchen': ['مطبخ', 'المطبخ', 'kitchen'],
  'smart.yes': ['واي فاي', 'wifi', 'wi fi', 'smart', 'سمارت', 'من الموبايل'],
  // fridge specifics
  'frost.no_frost': ['نو فروست', 'no frost', 'nofrost', 'frost free'],
  'frost.defrost_ok': ['ديفروست', 'defrost'],
  'layout.side_by_side': ['سايد باي سايد', 'side by side'],
  'layout.french_door': ['فرنش دور', 'french door'],
  'layout.bottom_freezer': ['فريزر تحت', 'bottom freezer'],
  'layout.top_freezer': ['فريزر فوق', 'top freezer'],
  'layout.single_door': ['باب واحد', 'single door'],
  'dispenser.nice': ['حنفيه مياه', 'موزع مياه', 'ديسبنسر', 'water dispenser', 'dispenser'],
  'power.cuts': ['الكهربا بتقطع', 'انقطاع الكهربا', 'الكهرباء بتقطع', 'power cuts', 'power outages', 'unstable voltage'],
  'power.bills': ['توفير كهربا', 'موفر', 'energy saving', 'save electricity', 'low consumption'],
};

// Brand names (and common spellings) beyond the option labels.
/** @type {Record<string, string[]>} */
const BRAND_ALIASES = {
  apple: ['ابل', 'apple', 'ايفون', 'iphone', 'ماك بوك', 'macbook'],
  samsung: ['سامسونج', 'سامسونغ', 'samsung', 'galaxy', 'جالاكسي'],
  xiaomi: ['شاومي', 'xiaomi', 'redmi', 'ريدمي', 'poco', 'بوكو'],
  oppo: ['اوبو', 'oppo'], realme: ['ريلمي', 'realme'], vivo: ['فيفو', 'vivo'], honor: ['هونر', 'هونور', 'honor'],
  infinix: ['انفينكس', 'infinix'], tecno: ['تكنو', 'tecno'], nokia: ['نوكيا', 'nokia'],
  lenovo: ['لينوفو', 'lenovo', 'thinkpad', 'ideapad', 'legion'], hp: ['hp', 'اتش بي', 'victus', 'omen', 'pavilion'],
  dell: ['ديل', 'dell', 'inspiron', 'xps', 'vostro', 'latitude'], asus: ['اسوس', 'asus', 'vivobook', 'zenbook', 'rog', 'tuf'],
  acer: ['ايسر', 'acer', 'aspire', 'nitro', 'predator'], msi: ['msi', 'ام اس اي'], huawei: ['هواوي', 'huawei', 'matebook'],
  lg: ['ال جي', 'lg'], sony: ['سوني', 'sony'], tcl: ['تي سي ال', 'tcl'], toshiba: ['توشيبا', 'toshiba'], sharp: ['شارب', 'sharp'],
  hisense: ['هايسنس', 'hisense'], unionaire: ['يونيون اير', 'unionaire'], carrier: ['كاريير', 'carrier'],
  tornado: ['تورنيدو', 'tornado'], fresh: ['فريش', 'fresh'], beko: ['بيكو', 'beko'], white_point: ['وايت بوينت', 'white point'],
  kiriazi: ['كريازي', 'kiriazi'], midea: ['ميديا', 'midea'], gree: ['جري', 'gree'],
};
const NEGATION = ['مش', 'بلاش', 'غير', 'من غير', 'ماعدا', 'الا', 'مش عايز', 'مش عاوز', 'no', 'not', 'avoid', 'except', 'without', "don't want", 'dont want', 'never'];

const CITY_ALIASES = {
  cairo: ['القاهره', 'قاهره', 'مصر الجديده', 'مدينه نصر', 'المعادي', 'التجمع', 'cairo', 'nasr city', 'maadi', 'heliopolis', 'new cairo'],
  giza: ['الجيزه', 'جيزه', 'اكتوبر', '6 اكتوبر', 'الشيخ زايد', 'الهرم', 'المهندسين', 'الدقي', 'giza', 'october', 'sheikh zayed', 'zayed', 'mohandessin', 'dokki'],
  alexandria: ['اسكندريه', 'الاسكندريه', 'اسكندرية', 'alexandria', 'alex'],
  qalyubia: ['القليوبيه', 'بنها', 'شبرا الخيمه', 'qalyubia', 'banha'],
  dakahlia: ['الدقهليه', 'المنصوره', 'dakahlia', 'mansoura'],
  gharbia: ['الغربيه', 'طنطا', 'المحله', 'gharbia', 'tanta'],
  sharqia: ['الشرقيه', 'الزقازيق', 'sharqia', 'zagazig'],
  port_said: ['بورسعيد', 'port said'], suez: ['السويس', 'suez'], ismailia: ['الاسماعيليه', 'ismailia'],
};

const AR_PREFIX = '(?:و|ب|ل|لل|ال|بال|وال|فال|عال|ف)?';
const isArabic = (s) => /[؀-ۿ]/.test(s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @type {Map<string, RegExp>} */
const reCache = new Map();
/** Regex for one keyword over normalised text (word bounded; Arabic allows an attached prefix). */
function keywordRe(kw) {
  let re = reCache.get(kw);
  if (re) return re;
  const star = kw.endsWith('*');
  const body = esc(normalizeText(star ? kw.slice(0, -1) : kw));
  const tail = star ? '[^ ]*' : '';
  re = new RegExp(`(?:^| )(${isArabic(kw) ? AR_PREFIX : ''}${body}${tail})(?= |$)`);
  reCache.set(kw, re);
  return re;
}

/** First match of any keyword in the text: {index, text} of the matched words, or null. */
function findAny(t, kws) {
  let best = null;
  for (const kw of kws) {
    const m = keywordRe(kw).exec(t);
    if (!m) continue;
    const index = m.index + m[0].indexOf(m[1]);
    if (!best || m[1].length > best.text.length) best = { index, text: m[1] };
  }
  return best;
}

/** Words of a label that make a usable keyword ("Nile Bank (sample)" -> "nile bank"). */
function labelKeywords(o) {
  const out = [];
  for (const l of [o.label && o.label.en, o.label && o.label.ar]) {
    if (!l) continue;
    const clean = l.replace(/\(.*?\)/g, '').trim();
    if (clean && clean.split(/\s+/).length <= 3) out.push(clean);
  }
  return out;
}

/** The normalised text split into clauses (punctuation, line breaks, "بس" / "but"), with their offsets. */
function clauses(t) {
  const out = [];
  const marked = t
    .replace(/ (بس|but|however|لكن) /g, ' ; ')
    .replace(/ و ?(مقدم|قسط|دفعه|الباقي)/g, ' ; $1')
    .replace(/ and (down|monthly|installments?)/g, ' ; $1');
  for (const piece of marked.split(/(?<!\d)[,.]|[,.](?!\d)|[;\n]/)) {
    const c = piece.trim();
    if (c) out.push(c);
  }
  return out;
}

const MONEY_CUE = /ميزاني|بادجت|budget|جنيه|جنية|ج م|egp|le\b|pounds?|حدود|لحد|تحت|اقل من|مش اكتر من|max|under|below|up to|سعر|price|في حدود|بحوالي|حوالي|around|about|مقدم|قسط|اقساط|في الشهر|شهري|a month|per month|monthly|down/;

/**
 * Money amounts in the text, one per clause, as amountText for U3 (which parses and routes them: an amount
 * per month goes to the monthly cap, a down payment to the down slot).
 */
function moneyItems(t, slotIds) {
  const out = [];
  for (const c of clauses(t)) {
    const exprs = numberExpressions(c);
    if (!exprs.length) continue;
    const big = exprs.some((e) => e.hadMultiplier || e.value >= 1000);
    if (!big && !MONEY_CUE.test(c)) continue;
    const isDown = /مقدم|دفعه اولي|down ?payment|upfront|deposit/.test(c);
    const isMonthly = /في الشهر|ف الشهر|بالشهر|كل شهر|شهريا|شهري|قسط|a month|per month|monthly|each month/.test(c);
    const slot = isDown ? 'down' : isMonthly ? 'monthlyCap' : 'budget';
    if (!slotIds.has(slot)) continue;
    if (out.some((x) => x.slot === slot)) continue;
    out.push({ slot, values: [], amountText: c, confidence: big ? CONF : CONF_WEAK, evidence: c });
  }
  return out;
}

/**
 * Extract slot values from the buyer's text with keyword rules.
 * @param {any} config
 * @param {string} text
 * @param {{retailers?: any[]}} [ctx]
 * @returns {{slots: {slot: string, values: any[], amountText: string|null, confidence: number, evidence: string}[], unmapped: any[]}}
 */
export function extractByRules(config, text, ctx = {}) {
  const t = normalizeText(text);
  /** @type {any[]} */
  const slots = [];
  if (!t) return { slots, unmapped: [] };
  const byId = new Map(config.slots.map((s) => [s.id, s]));
  const has = (slot, opt) => { const s = byId.get(slot); return !!(s && s.options && s.options.some((o) => o.id === opt)); };
  const add = (slot, values, evidence, confidence = CONF) => {
    const prev = slots.find((x) => x.slot === slot);
    if (prev) {
      if (byId.get(slot).multi) { for (const v of values) if (!prev.values.includes(v)) prev.values.push(v); }
      return;
    }
    slots.push({ slot, values: [...values], amountText: null, confidence, evidence });
  };

  // 1. Money.
  for (const m of moneyItems(t, new Set(byId.keys()))) slots.push(m);

  // 2. Brands, with negation ("مش عايز لينوفو", "no Lenovo") going to brandAvoid.
  const brandSlot = byId.get('brand');
  if (brandSlot) {
    for (const o of brandSlot.options || []) {
      const hit = findAny(t, [...labelKeywords(o), ...(BRAND_ALIASES[o.id] || [])]);
      if (!hit) continue;
      const before = t.slice(Math.max(0, hit.index - 14), hit.index);
      const negated = NEGATION.some((n) => new RegExp(`(?:^| )${esc(normalizeText(n))} ?$`).test(before) || new RegExp(`(?:^| )${esc(normalizeText(n))} [^ ]+ $`).test(before));
      if (negated) { if (has('brandAvoid', o.id)) add('brandAvoid', [o.id], normalizeText(`${before.trim().split(' ').pop()} ${hit.text}`).trim()); }
      else add('brand', [o.id], hit.text);
    }
  }

  // 3. City.
  const citySlot = byId.get('city');
  if (citySlot) {
    for (const o of citySlot.options || []) {
      const hit = findAny(t, [...labelKeywords(o), ...(CITY_ALIASES[o.id] || [])]);
      if (hit) { add('city', [o.id], hit.text); break; }
    }
  }

  // 4. Financing provider by name.
  const provSlot = byId.get('provider');
  if (provSlot) {
    for (const o of provSlot.options || []) {
      const hit = findAny(t, labelKeywords(o));
      if (hit) { add('provider', [o.id], hit.text); break; }
    }
  }

  // 5. Keyword lists. Within a single-choice slot the longest match wins (so "مش انفرتر" beats "انفرتر").
  /** @type {Map<string, {opt: string, hit: {index: number, text: string}}[]>} */
  const found = new Map();
  for (const [key, kws] of Object.entries(LEXICON)) {
    const [slot, opt] = key.split('.');
    if (!has(slot, opt)) continue;
    const hit = findAny(t, kws);
    if (!hit) continue;
    if (!found.has(slot)) found.set(slot, []);
    /** @type {any} */ (found.get(slot)).push({ opt, hit });
  }
  for (const [slot, hits] of found) {
    const s = byId.get(slot);
    if (s.multi) {
      // Drop a hit whose words sit inside a longer hit of the same slot ("نت وافلام" vs "افلام").
      const keep = hits.filter((h) => !hits.some((o) => o !== h && o.hit.text.length > h.hit.text.length && o.hit.index <= h.hit.index && o.hit.index + o.hit.text.length >= h.hit.index + h.hit.text.length));
      add(slot, keep.map((h) => h.opt), keep[0].hit.text);
    } else {
      const best = hits.reduce((a, b) => (b.hit.text.length > a.hit.text.length ? b : a));
      add(slot, [best.opt], best.hit.text);
    }
  }
  // "Official warranty" in a category without a separate "warranty" option means "no imports".
  if (!found.has('acceptImports') && has('acceptImports', 'no') && !has('acceptImports', 'warranty')) {
    const hit = findAny(t, LEXICON['acceptImports.warranty']);
    if (hit) add('acceptImports', ['no'], hit.text);
  }
  // The pay method follows from a monthly amount only when the text names no method: leave it to the question.

  // 6. Storage ("512 جيجا", "1 تيرا") for any slot that filters on storage.
  const storageSlot = byId.get('storageNeed') || config.slots.find((s) => !s.multi && (s.options || []).some((o) => ((o.effects && o.effects.must) || []).some((m) => m.attr === 'storage_gb')));
  if (storageSlot) {
    const m = t.match(/(?:\d+(?:\.\d+)?|نص) ?(?:جيجا|gb|تيرا|tb)(?= |$)/);
    if (m) slots.push({ slot: storageSlot.id, values: [], amountText: m[0], confidence: CONF, evidence: m[0] });
  }

  // 7. Laptop screen size in inches.
  if (has('screenSize', 'small')) {
    const m = t.match(/(\d+(?:\.\d+)?) ?(?:بوصه|انش|inch|inches|in)(?= |$)/);
    if (m) {
      const n = Number(m[1]);
      const opt = n <= 14.5 ? 'small' : n < 16 ? 'medium' : 'large';
      if (n >= 10 && n <= 19) add('screenSize', [opt], m[0]);
    }
  }

  // 8. AC room area in square metres, with "hot" hints (sun, top floor, kitchen).
  const room = byId.get('room');
  if (room && has('room', 'r16')) {
    const m = t.match(/(\d+(?:\.\d+)?) ?(?:متر مربع|متر|م ?2|m2|sqm|square meters?|meters?)(?= |$)/);
    if (m) {
      const area = Number(m[1]);
      const hot = /شمس|دور اخير|اخر دور|السطوح|مطبخ|sunny|sun|top floor|kitchen/.test(t);
      const sizes = [16, 24, 32, 42, 55];
      const size = sizes.find((x) => area <= x) || 55;
      let opt = `r${size}${hot ? '_hot' : ''}`;
      if (!has('room', opt)) opt = has('room', `r${size}_hot`) ? `r${size}_hot` : `r${size}`;
      if (area >= 5 && area <= 120 && has('room', opt)) add('room', [opt], m[0]);
    }
  }

  // 9. Fridge household size ("احنا 4", "5 افراد", "family of 4").
  if (has('household', 'h2')) {
    const m = t.match(/(?:احنا|we are|family of) (\d+)|(\d+) (?:افراد|اشخاص|نفر|people|persons)(?= |$)/);
    if (m) {
      const n = Number(m[1] || m[2]);
      const opt = n <= 2 ? 'h2' : n <= 4 ? 'h4' : n <= 6 ? 'h6' : 'h7';
      if (n >= 1 && n <= 20) add('household', [opt], m[0]);
    }
  }

  void ctx;
  return { slots, unmapped: [] };
}
