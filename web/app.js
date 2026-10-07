// Wisedo Playground: a try-out page on the real engine (Layer 1 + Layer 2) and the synthetic mobile catalog.
// The engine runs in this page. Only the free-text reading goes to Claude, through the artifact `sample` capability.
import { step } from './src/layer1/index.js';
import { createStore } from './src/store.js';
import { applyOverrides } from './src/params.js';

const $app = document.getElementById('app');

// ---------- text ----------
const T = {
  en: {
    tagline: "Tell us what you need. We'll tell you what to buy.",
    banner: 'Sample data',
    bannerBody: 'Every phone, price, shop and bank here is invented to test the engine. None of it is a real offer.',
    askTitle: 'What do you need?',
    placeholder: "e.g. A phone for gaming, around 20,000 EGP, I'd like to pay in installments",
    find: 'Find my best option',
    help: 'Help me choose',
    model: 'I have a specific model',
    reading: 'Reading what you need…',
    fresh: 'Sample prices, pinned to 3 Oct 2026',
    tryOne: 'Try one',
    examples: [
      'A phone for gaming, around 20,000 EGP, I would pay in installments',
      'Simple phone for my mother, easy to use, good screen, up to 8000',
      'Best camera under 25000, I will pay cash, Samsung or Xiaomi',
      'A laptop for my son at university, programming, up to 30,000',
      'A 55 inch TV for the living room, mostly football and Netflix',
      'An AC for a 20 square metre bedroom, quiet, and I care about the electricity bill',
      'A fridge for a family of five, no frost, up to 30,000',
    ],
    soon: 'Coming soon',
    categories: 'Category',
    steps: ['Describe', 'Questions', 'Results'],
    qOf: 'Question {i} of {n}',
    understood: 'What I understood',
    notUsed: 'Not used yet',
    assumed: 'assumed',
    prefer: 'Prefer',
    avoid: 'Avoid',
    assumedTitle: 'Assumed until you say otherwise',
    alsoMean: 'Did you also mean?',
    addDetail: 'Add a detail',
    addText: 'Tell me more in words',
    next: 'Next',
    showNow: 'Show results now',
    matchLine: '{n} phones still match',
    leading: 'Leading now: {name}',
    multiHint: 'Pick all that apply',
    typeAmount: 'Or type an exact amount',
    month: '/ month',
    phones: 'phones',
    why: 'Why I ask',
    closePanel: 'Done',
    panelTitle: 'Add a detail',
    panelHint: 'Anything you set here is locked in for this session.',
    sendText: 'Read it',
    moreTextPh: 'Add anything else you care about…',
    best: 'Your best option',
    decisionBy: 'Wisedo decision',
    whyFits: 'Why it fits',
    buyFrom: 'Buy from {shop}',
    others: 'Other good options',
    showRest: 'Show the rest',
    hideRest: 'Hide the rest',
    otherShops: 'Compare all prices',
    fit: 'Fit {n}/100',
    freeDelivery: 'Free delivery',
    delivery: 'Delivery {d} day(s), {fee} EGP',
    cod: 'Cash on delivery',
    official: 'Official warranty',
    checked: 'Checked {h} h ago',
    plan: '{m} EGP/month for {n} months with {p}',
    total: 'Total {t} EGP, financing adds {f} EGP',
    notListed: 'Not listed',
    nothingFits: 'Nothing fits this budget',
    extra: 'You need about {n} EGP more.',
    howDecided: 'How I decided',
    skippedQs: 'Questions I did not ask',
    profileJson: 'Need profile (JSON)',
    startOver: 'Start over',
    sampleNote: 'Sample answer. Prices are illustrative.',
    roles: { best_fit: 'Best match', best_value: 'Best value', premium: 'Premium', cheaper: 'Cheaper option', alternative: 'Alternative' },
    shopsFor: 'Other shops for this phone',
    chosen: 'Chosen',
    fallbackTip: 'I could not read your text, so I switched to questions.',
    fallbackTitle: 'Text reading is off',
    noLlm: 'Reading free text needs Claude. It is not available here, so I used the question flow.',
    errTitle: 'Something went wrong',
    back: 'Back',
    pickCat: 'Pick a category',
    liveNote: 'Free text is read by Claude through this page. It is a stand-in for the production reader.',
    stop: { cap: 'I stopped at the question limit.', show_now: 'You asked for results now.', gain: 'More questions would not change the answer.', confident: 'The answer is clear.' },
    lang: 'عربي',
    egp: 'EGP',
    warnTitle: 'Heads up',
    modelNote: 'Pick the phone you have in mind in the list.',
    admin: 'Admin',
    greet: 'Hi, I am Wisedo. Tell me what you need and I will pick what to buy and where.',
    greetAsk: 'Write it in your own words, or pick:',
    understoodMsg: 'Here is what I got from your message: {list}. You can fix any of it from "What I understood".',
    resultIntro: 'Done. Here is my pick for you:',
    resultUpdated: 'Updated with your change:',
    resultOld: 'Earlier result: {name}',
    composerMore: 'Add a detail…',
    pickCategory: '1. Pick a category',
    howStart: '2. How do you want to start?',
    featHelp: 'Help me choose',
    featHelpSub: 'Answer a few quick questions and I pick for you.',
    featModel: 'I have a specific model',
    featModelSub: 'Tell me the phone and I check if it is the right buy and where.',
    modelSearch: 'Search for a phone',
    suggestTitle: 'Or type your own. Ideas:',
    chatTitle: '3. Chat with Wisedo',
    chatSub: 'Picks what to buy, and where',
    today: 'Today',
    chatWord: '3. Or just write what you need below',
    composerHome: 'Write what you need…',
    send: 'Send',
    listSep: ', ',
    tryit: 'Try it',
    cfgLive: 'Live configuration v{v}',
    cfgDefault: 'Built-in defaults',
    cfgDraft: 'Admin draft',
    cfgTitle: 'Engine configuration',
  },
  ar: {
    tagline: 'قولّي محتاج إيه، وأنا أقولك تشتري إيه ومنين.',
    banner: 'بيانات تجريبية',
    bannerBody: 'كل الموبايلات والأسعار والمحلات والبنوك هنا من اختراعنا لتجربة المحرّك. مفيش أي عرض حقيقي.',
    askTitle: 'محتاج إيه؟',
    placeholder: 'مثلاً: موبايل للألعاب بحوالي 20 ألف جنيه وهقسّطه',
    find: 'هاتلي أحسن اختيار',
    help: 'ساعدني أختار',
    model: 'عندي موديل معين',
    reading: 'بقرأ احتياجك…',
    fresh: 'أسعار تجريبية، ثابتة على 3 أكتوبر 2026',
    tryOne: 'جرّب واحدة',
    examples: [
      'موبايل للألعاب بحوالي 20 ألف جنيه وهقسّطه',
      'موبايل بسيط لوالدتي، سهل وشاشته كويسة، لحد 8000',
      'أحسن كاميرا تحت 25000، كاش، سامسونج أو شاومي',
      'لابتوب لابني في الجامعة، برمجة، لحد 30 ألف',
      'تلفزيون 55 بوصة للريسبشن، كورة ونتفليكس أغلبه',
      'تكييف لأوضة نوم 20 متر، هادي، وفاتورة الكهربا تهمني',
      'تلاجة لأسرة من 5 أفراد، نو فروست، لحد 30 ألف',
    ],
    soon: 'قريباً',
    categories: 'النوع',
    steps: ['وصف', 'أسئلة', 'النتيجة'],
    qOf: 'سؤال {i} من {n}',
    understood: 'اللي فهمته',
    notUsed: 'لسه مش بستخدمه',
    assumed: 'افتراض',
    prefer: 'أفضّل',
    avoid: 'أتجنّب',
    assumedTitle: 'افتراضات لحد ما تقول غير كده',
    alsoMean: 'قصدك كمان؟',
    addDetail: 'ضيف تفصيلة',
    addText: 'قولّي أكتر بالكلام',
    next: 'التالي',
    showNow: 'وريني النتيجة دلوقتي',
    matchLine: '{n} موبايل لسه مناسب',
    leading: 'الأفضل حالياً: {name}',
    multiHint: 'اختار كل اللي ينطبق',
    typeAmount: 'أو اكتب مبلغ بالظبط',
    month: '/ شهر',
    phones: 'موبايل',
    why: 'ليه بسأل',
    closePanel: 'تمام',
    panelTitle: 'ضيف تفصيلة',
    panelHint: 'أي حاجة تحددها هنا بتتثبّت في الجلسة دي.',
    sendText: 'اقرأها',
    moreTextPh: 'ضيف أي حاجة تانية تهمك…',
    best: 'أنسب اختيار ليك',
    decisionBy: 'قرار Wisedo',
    whyFits: 'ليه مناسب',
    buyFrom: 'اشتري من {shop}',
    others: 'اختيارات كويسة تانية',
    showRest: 'اعرض الباقي',
    hideRest: 'اخفي الباقي',
    otherShops: 'قارن كل الأسعار',
    fit: 'التوافق {n}/100',
    freeDelivery: 'توصيل مجاني',
    delivery: 'توصيل {d} يوم، {fee} جنيه',
    cod: 'الدفع عند الاستلام',
    official: 'ضمان رسمي',
    checked: 'اتراجع من {h} ساعة',
    plan: '{m} جنيه/شهر لمدة {n} شهر مع {p}',
    total: 'الإجمالي {t} جنيه، والتقسيط بيزوّد {f} جنيه',
    notListed: 'مش مكتوب',
    nothingFits: 'مفيش حاجة داخلة في الميزانية دي',
    extra: 'محتاج حوالي {n} جنيه زيادة.',
    howDecided: 'إزاي قررت',
    skippedQs: 'أسئلة ماسألتهاش',
    profileJson: 'ملف الاحتياج (JSON)',
    startOver: 'ابدأ من جديد',
    sampleNote: 'إجابة تجريبية. الأسعار للتوضيح فقط.',
    roles: { best_fit: 'الأنسب', best_value: 'الأوفر', premium: 'بريميوم', cheaper: 'أرخص', alternative: 'بديل' },
    shopsFor: 'محلات تانية لنفس الموبايل',
    chosen: 'المختار',
    fallbackTip: 'ماقدرتش أقرأ كلامك، فرجعت للأسئلة.',
    fallbackTitle: 'قراءة النص مش شغالة',
    noLlm: 'قراءة النص الحر محتاجة Claude، ومش متاحة هنا، فاستخدمت الأسئلة.',
    errTitle: 'حصلت مشكلة',
    back: 'رجوع',
    pickCat: 'اختار النوع',
    liveNote: 'النص الحر بيتقرا بواسطة Claude من خلال الصفحة دي. ده بديل مؤقت للقارئ الحقيقي.',
    stop: { cap: 'وقفت عند حد الأسئلة.', show_now: 'طلبت النتيجة دلوقتي.', gain: 'أسئلة زيادة مش هتغيّر الإجابة.', confident: 'الإجابة واضحة.' },
    lang: 'English',
    egp: 'جنيه',
    warnTitle: 'خد بالك',
    modelNote: 'اختار الموبايل اللي في بالك من القايمة.',
    admin: 'الإدارة',
    greet: 'أهلاً، أنا Wisedo. قولّي محتاج إيه وأنا أختارلك تشتري إيه ومنين.',
    greetAsk: 'اكتبلي بكلامك، أو اختار:',
    understoodMsg: 'فهمت من كلامك: {list}. تقدر تعدّل أي حاجة من «اللي فهمته».',
    resultIntro: 'تمام، دي أنسب اختياراتي ليك:',
    resultUpdated: 'حدّثت النتيجة بتعديلك:',
    resultOld: 'نتيجة سابقة: {name}',
    composerMore: 'ضيف أي تفصيلة تانية…',
    pickCategory: '1. اختار النوع',
    howStart: '2. تحب تبدأ إزاي؟',
    featHelp: 'ساعدني أختار',
    featHelpSub: 'جاوب كام سؤال سريع وأنا أختارلك.',
    featModel: 'عندي موديل معين',
    featModelSub: 'قولّي الموبايل وأقولك لو هو الشراء الصح ومنين.',
    modelSearch: 'دوّر على موبايل',
    suggestTitle: 'أو اكتب بكلامك. أفكار:',
    chatTitle: '3. كلّم Wisedo',
    chatSub: 'بختارلك تشتري إيه ومنين',
    today: 'النهارده',
    chatWord: '3. أو اكتب محتاج إيه تحت',
    composerHome: 'اكتب اللي محتاجه…',
    send: 'ابعت',
    listSep: '، ',
    tryit: 'جرّب',
    cfgLive: 'الإعدادات المنشورة v{v}',
    cfgDefault: 'الإعدادات الافتراضية',
    cfgDraft: 'مسودة الإدارة',
    cfgTitle: 'إعدادات المحرّك',
  },
};

// ---------- icons (Lucide outline) ----------
const ICON = {
  mobile: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
  ac: '<path d="M6 12H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 8h12"/><path d="M18.3 17.7a2.5 2.5 0 0 1-3.16 3.83 2.53 2.53 0 0 1-1.14-2V12"/><path d="M6.6 15.6A2 2 0 1 0 10 17v-5"/>',
  fridge: '<path d="M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"/><path d="M5 10h14"/><path d="M15 7v6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};
const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
// The Wisedo mark: a ring with a dot (a selected option), the final "o" of the logo. Colour comes from currentColor.
const MARK = (cls) => `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="10"/><circle cx="32" cy="32" r="9" fill="currentColor"/></svg>`;
// App icon: the mark in white on an indigo rounded square (corner radius a quarter of the side). Used as Wisedo's chat avatar.
const APPICON = `<svg class="appicon" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="currentColor"/><circle cx="32" cy="32" r="14.5" fill="none" stroke="#fff" stroke-width="6"/><circle cx="32" cy="32" r="5.5" fill="#fff"/></svg>`;
const LOGO = `<span class="logo" role="img" aria-label="Wisedo"><span aria-hidden="true">Wised</span>${MARK('')}</span>`;

// ---------- helpers ----------
const S = {
  lang: 'ar',
  greetAt: Date.now(), // time shown under the first message
  ready: false,
  loadError: null,
  text: '',
  busy: null, // label while waiting
  session: null, // engine state
  ui: null, // last ui from the engine (not the add-detail one)
  panel: null, // add-detail payload, when open
  multi: new Set(),
  amount: '',
  moreText: '',
  showRest: false,
  note: null, // {kind, text}
  ctx: null,
  lib: { products: new Map(), retailers: new Map() },
  llmState: 'unknown', // unknown | on | off
  route: 'try', // try | admin
  base: null, // {config, data} as shipped
  store: createStore(),
  cfgMode: 'published', // published | draft | default: which engine configuration the try-out uses
  draftOv: null,
  admin: null,
  modelPicker: false,
  modelQ: '',
  chat: [], // transcript of the conversation: {id, role: 'user'|'bot', kind, ...}
  activeId: null, // the question message that is waiting for an answer
  latestResultId: null,
  focusId: null,
  scroll: false,
};
const t = () => T[S.lang];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = (o) => {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  if (typeof o === 'number') return String(o);
  if (Array.isArray(o)) return o.map(L).join(', ');
  return o[S.lang] ?? o.en ?? o.ar ?? '';
};
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const nf = new Intl.NumberFormat('en-US');
const num = (n) => `<bdi class="num">${nf.format(Math.round(n))}</bdi>`;
const numT = (n) => nf.format(Math.round(n));
const money = (n) => `${num(n)} ${esc(t().egp)}`;
const productName = (id) => (S.lib.products.get(id) || {}).name || id;
/** The category icon of a product (the engine's pick carries only id, name and brand). */
const productIcon = (id) => ((cats.find((c) => c.id === (S.lib.products.get(id) || {}).category) || cats[0]).icon);
const retailerName = (id) => (S.lib.retailers.get(id) || {}).name || id;
const cats = [
  { id: 'mobile', icon: 'mobile', label: { en: 'Phone', ar: 'موبايل' }, on: true },
  { id: 'laptop', icon: 'laptop', label: { en: 'Laptop', ar: 'لابتوب' } },
  { id: 'tv', icon: 'tv', label: { en: 'TV', ar: 'تلفزيون' } },
  { id: 'ac', icon: 'ac', label: { en: 'AC', ar: 'تكييف' } },
  { id: 'fridge', icon: 'fridge', label: { en: 'Fridge', ar: 'تلاجة' } },
];

// ---------- engine plumbing ----------
async function loadData() {
  const j = async (p) => {
    const r = await fetch(p);
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };
  const [config, products, retailers, offers, plans, manifest] = await Promise.all([
    j('config/mobile.json'), j('data/synthetic/products.json'), j('data/synthetic/retailers.json'),
    j('data/synthetic/offers.json'), j('data/synthetic/plans.json'), j('data/synthetic/manifest.json'),
  ]);
  // The other categories are optional: a category appears once its config and data files are published.
  const extra = { configs: {}, products: [], offers: [] };
  await Promise.all(cats.filter((c) => c.id !== 'mobile').map(async (c) => {
    try {
      const [cfg, ps, os] = await Promise.all([j(`config/${c.id}.json`), j(`data/synthetic/${c.id}/products.json`), j(`data/synthetic/${c.id}/offers.json`)]);
      extra.configs[c.id] = cfg; extra.products.push(...ps); extra.offers.push(...os); c.on = true;
    } catch { c.on = false; }
  }));
  S.base = { config, data: { products, retailers, offers, plans, manifest }, extra };
  S.lib.products = new Map([...products, ...extra.products].map((p) => [p.id, p]));
  S.lib.retailers = new Map(retailers.map((r) => [r.id, r]));
  await S.store.init();
  rebuildCtx();
}

/** The overrides the try-out runs with, by mode. Published = what buyers get; draft = what the admin is editing. */
function activeOverrides() {
  if (S.cfgMode === 'default') return {};
  if (S.cfgMode === 'draft') return S.draftOv || (S.store.draft && S.store.draft.overrides) || S.store.liveOverrides;
  return S.store.liveOverrides;
}

function rebuildCtx() {
  const { data } = S.base;
  const { config } = applyOverrides(S.base.config, activeOverrides());
  const { extra } = S.base;
  const snapshot = { snapshot_id: data.manifest.snapshot_id, tenant_id: data.manifest.tenant_id, configs: { mobile: config, ...extra.configs }, products: [...data.products, ...extra.products], retailers: data.retailers, offers: [...data.offers, ...extra.offers], plans: data.plans };
  S.ctx = { snapshot, now: data.manifest.now, llm, llmTimeoutMs: 60000 };
}

function cfgLabel() {
  if (S.cfgMode === 'default') return t().cfgDefault;
  if (S.cfgMode === 'draft') return t().cfgDraft;
  return S.store.published ? fill(t().cfgLive, { v: S.store.published.version }) : t().cfgDefault;
}

let samplePromise = null;
function getSample() {
  if (!samplePromise) {
    samplePromise = (async () => {
      try {
        if (!window.claude || typeof window.claude.use !== 'function') return null;
        return await window.claude.use('sample');
      } catch { return null; }
    })();
  }
  return samplePromise;
}

// The page's LLM adapter: the engine's request, answered by Claude through the artifact `sample` capability.
async function llm(req) {
  const sample = await getSample();
  if (!sample) { S.llmState = 'off'; throw new Error('sample_unavailable'); }
  const prompt = [
    req.system,
    '',
    req.user,
    '',
    'Reply with ONLY one JSON object that matches this JSON schema. No prose, no code fence.',
    JSON.stringify(req.schema),
  ].join('\n');
  try {
    const out = await sample.json(prompt, { modelTier: 'quick', cache: false });
    S.llmState = 'on';
    return { stopReason: 'end_turn', output: out, model: 'claude (sample)' };
  } catch (e) {
    if (e && (e.code === 'not_granted')) S.llmState = 'off';
    throw new Error((e && e.code) || 'sample_error');
  }
}

async function run(event, busyLabel) {
  S.busy = busyLabel || null;
  render();
  try {
    const wasResult = !!(S.ui && S.ui.screen === 'result');
    let out = await step(S.session, event, S.ctx);
    // An edit made on the result reopens the question flow in the engine; here the buyer just wants the new result.
    if (wasResult && (event.type === 'edit' || event.type === 'addText') && out.ui.screen === 'question') {
      out = await step(out.state, { type: 'showNow' }, S.ctx);
    }
    S.session = out.state;
    if (out.ui.screen !== 'add_detail') ingest(out.ui, event, wasResult);
    if (out.ui.screen === 'add_detail') {
      S.panel = out.ui.addDetail;
      // keep the question or result underneath; only refresh chips from this ui
      if (S.ui) { S.ui = { ...S.ui, chips: out.ui.chips, notUsed: out.ui.notUsed, suggestions: out.ui.suggestions }; }
    } else {
      S.ui = out.ui;
      S.multi = new Set();
      S.amount = '';
      S.showRest = false;
      // keep the panel fresh if it is open
      if (S.panel) await refreshPanel();
    }
  } catch (e) {
    S.ui = { screen: 'error', message: String((e && e.message) || e) };
    push({ role: 'bot', kind: 'error', text: S.ui.message });
  } finally {
    S.busy = null;
    render();
  }
}

async function refreshPanel() {
  const out = await step(S.session, { type: 'addDetail' }, S.ctx);
  S.session = out.state;
  S.panel = out.ui.addDetail;
}

// ---------- render pieces ----------
function header() {
  return `<header class="top">
    <div class="brand-row">${LOGO}</div>
    <div class="top-actions">
      <button class="pill-btn" data-act="route" data-to="admin">${esc(t().admin)}</button>
      <button class="pill-btn" data-act="lang" aria-label="Language">${ico('globe')}${esc(t().lang)}</button>
    </div>
  </header>`;
}

function banner() {
  return `<div class="tip note" role="note">${ico('info')}<div><b>${esc(t().banner)}</b><p>${esc(t().bannerBody)}</p></div></div>`;
}

function catRow(activeId) {
  return `<div class="cats" role="group" aria-label="${esc(t().categories)}">
    ${cats.map((c) => `<button class="cat ${c.id === activeId ? 'on' : ''}" ${c.on ? `data-act="cat" data-id="${c.id}"` : 'disabled'} aria-pressed="${c.id === activeId}">
      <span class="disc">${ico(c.icon)}</span><span>${esc(L(c.label))}</span>${c.on ? '' : `<small>${esc(t().soon)}</small>`}
    </button>`).join('')}
  </div>`;
}

function chipsBlock(ui, bare = false) {
  const chips = ui.chips || [];
  const notUsed = ui.notUsed || [];
  const sugg = ui.suggestions || [];
  if (!chips.length && !notUsed.length && !sugg.length) return '';
  const vals = chips.filter((c) => c.kind === 'value').map((c) => {
    const cls = c.source === 'text' ? 'parsed' : '';
    return `<span class="chip ${cls}" title="${esc(c.evidence || '')}"><button class="chip-btn" data-act="openpanel" data-slot="${esc(c.slot)}"><span class="meta">${esc(L(c.label))}</span> <b>${esc(L(c.valueLabel))}</b></button>${c.editable === false ? '' : `<button class="x" data-act="clear" data-slot="${esc(c.slot)}" aria-label="Remove">${ico('x')}</button>`}</span>`;
  }).join('');
  const assumedList = chips.filter((c) => c.kind === 'assumed');
  const assumed = assumedList.length ? `<details class="dd" style="flex-basis:100%"><summary>${esc(t().assumedTitle)} (${assumedList.length})</summary><div class="chips" style="margin-top:8px">${assumedList.map((c) =>
    `<span class="chip assumed"><button class="chip-btn" data-act="openpanel" data-slot="${esc(c.slot)}"><span>${esc(L(c.label))}: ${esc(L(c.valueLabel))}</span></button></span>`).join('')}</div></details>` : '';
  const nu = notUsed.map((n) => `<span class="chip unused" title="${esc(L(n.reasonLabel))}">${esc(n.text)} <span class="tag">${esc(t().notUsed)}</span></span>`).join('');
  const sg = sugg.length ? `<div class="stack"><span class="meta">${esc(t().alsoMean)}</span><div class="chips">${sugg.map((s) =>
    `<button class="chip suggest" data-act="accept" data-slot="${esc(s.slot)}" data-value="${esc(JSON.stringify(s.value))}">${ico('plus')} ${esc(L(s.valueLabel))}</button>`).join('')}</div></div>` : '';
  const inner = `<div class="chips">${vals}${assumed}${nu}</div>${sg}
    <div class="row"><button class="link" data-act="openpanel">${esc(t().addDetail)}</button></div>`;
  if (bare) return `<div class="stack">${inner}</div>`;
  return `<section class="card" aria-label="${esc(t().understood)}"><div class="eyebrow">${esc(t().understood)}</div>${inner}</section>`;
}

function noteBlock() {
  if (!S.note) return '';
  return `<div class="tip warn" role="status">${ico('warn')}<div><b>${esc(S.note.title)}</b><p>${esc(S.note.text)}</p></div></div>`;
}

function draftDiffers() {
  const d = S.draftOv || (S.store.draft && S.store.draft.overrides);
  return !!d && JSON.stringify(applyOverrides(S.base.config, d).overrides) !== JSON.stringify(applyOverrides(S.base.config, S.store.liveOverrides).overrides);
}

function cfgSwitch() {
  if (!S.store.published && !draftDiffers() && S.cfgMode === 'published') return '';
  const opts = [['published', S.store.published ? fill(t().cfgLive, { v: S.store.published.version }) : t().cfgDefault], ['default', t().cfgDefault]];
  if (draftDiffers()) opts.push(['draft', t().cfgDraft]);
  return `<div class="row"><span class="meta">${esc(t().cfgTitle)}</span><select class="small-in" style="flex:0 1 auto;min-width:180px" data-act="cfgmode" aria-label="${esc(t().cfgTitle)}">${opts.map(([v, l]) => `<option value="${v}" ${S.cfgMode === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
}


// ---------- chat ----------
let nextMsgId = 0;
function push(m) {
  const msg = { id: ++nextMsgId, at: Date.now(), ...m };
  S.chat.push(msg);
  return msg;
}
const sayUser = (text) => { push({ role: 'user', kind: 'text', text }); S.scroll = true; };
const sayBot = (text, extra = {}) => push({ role: 'bot', kind: 'text', text, ...extra });

/** Turn what the engine returned into chat messages. */
function ingest(ui, event, wasResult) {
  S.activeId = null;
  S.focusId = null;
  const mark = (m) => { if (!S.focusId) S.focusId = m.id; return m; };
  const textEvent = event.type === 'start' && event.text !== undefined || event.type === 'addText';
  if (textEvent && ui.fallback) mark(push({ role: 'bot', kind: 'note', title: t().fallbackTitle, text: S.llmState === 'off' ? t().noLlm : t().fallbackTip }));
  if (textEvent) {
    const vals = (ui.chips || []).filter((c) => c.kind === 'value' && c.source === 'text');
    if (vals.length) mark(sayBot(fill(t().understoodMsg, { list: vals.map((c) => L(c.valueLabel)).join(t().listSep) })));
  }
  switch (ui.screen) {
    case 'question': {
      const last = S.chat[S.chat.length - 1];
      // an edit that leaves the same question open refreshes it in place instead of asking twice
      if (event.type === 'edit' && last && last.kind === 'question' && last.ui.question.slot === ui.question.slot) { last.ui = ui; S.activeId = last.id; break; }
      const m = mark(push({ role: 'bot', kind: 'question', ui }));
      S.activeId = m.id;
      break;
    }
    case 'clarify': { const m = mark(push({ role: 'bot', kind: 'clarify', ui })); S.activeId = m.id; break; }
    case 'result': {
      mark(sayBot(wasResult ? t().resultUpdated : t().resultIntro));
      const m = push({ role: 'bot', kind: 'result', ui });
      S.latestResultId = m.id;
      break;
    }
    case 'tiles': case 'not_configured': case 'unsupported': mark(push({ role: 'bot', kind: 'tiles', message: ui.message })); break;
    case 'error': mark(push({ role: 'bot', kind: 'error', text: ui.message })); break;
    default: break;
  }
}

// A message sits in a run of messages from the same side: g = {first, last}. The avatar, the tail and the time show on the last one.
const clocks = {};
/** Clock time of a message, with Western digits in both languages. */
function clock(ms) {
  try {
    const f = clocks[S.lang] || (clocks[S.lang] = new Intl.DateTimeFormat(S.lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { hour: 'numeric', minute: '2-digit' }));
    return f.format(ms);
  } catch { return ''; }
}
const stamp = (at) => (at ? `<time class="stamp" datetime="${new Date(at).toISOString()}">${esc(clock(at))}</time>` : '');
const pos = (g) => `${g.first ? ' first' : ''}${g.last ? ' last' : ''}`;
const ALONE = { first: true, last: true };
const botBubble = (inner, cls = '', id = '', g = ALONE, at = 0) => `<div class="msg bot ${cls}${pos(g)}" data-mid="${id}"><span class="av">${APPICON}</span><div class="bub">${inner}${g.last ? stamp(at) : ''}</div></div>`;
const userBubble = (text, id = '', g = ALONE, at = 0) => `<div class="msg user${pos(g)}" data-mid="${id}"><div class="bub">${esc(text)}${g.last ? stamp(at) : ''}</div></div>`;

/** Models for the picker: matches of the search box, or two popular ones per category when it is empty. */
function modelChoices() {
  const all = [...S.lib.products.values()];
  const q = S.modelQ.toLowerCase();
  if (q) return all.filter((p) => `${p.name} ${p.brand}`.toLowerCase().includes(q)).slice(0, 8);
  return cats.flatMap((c) => all.filter((p) => p.category === c.id).sort((a, b) => Number(!!b.popular) - Number(!!a.popular)).slice(0, 2));
}

function catPills() {
  return `<div class="qrow" role="group" aria-label="${esc(t().categories)}">${cats.map((c) => c.on
    ? `<button class="qp" data-act="cat" data-id="${c.id}">${ico(c.icon)}${esc(L(c.label))}</button>`
    : `<button class="qp" disabled>${ico(c.icon)}${esc(L(c.label))} <small>${esc(t().soon)}</small></button>`).join('')}</div>`;
}

function greeting(g) {
  return botBubble(`<div class="qtext">${esc(t().greet)}</div>${S.session || S.chat.length ? `<div class="meta">${ico('info')} ${esc(t().bannerBody)}</div>` : ''}`, '', 'g1', g, S.greetAt);
}

/** Before the conversation starts: the category and the two ways to begin are their own sections above the chat. */
function entrySections() {
  const picker = S.modelPicker ? `<div class="stack" style="margin-top:4px"><input class="srch" id="modelq" type="search" placeholder="${esc(t().modelSearch)}" value="${esc(S.modelQ)}" aria-label="${esc(t().modelSearch)}">
    <div class="qrow">${modelChoices().map((p) => `<button class="qp" data-act="pickmodel" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div></div>` : '';
  return `<section class="card sect"><div class="eyebrow">${esc(t().pickCategory)}</div>${catPills()}</section>
  <section class="card sect"><div class="eyebrow">${esc(t().howStart)}</div>
    <div class="feats">
      <button class="feat" data-act="cat" data-id="" data-say="help"><span class="fi">${ico('check')}</span><span class="tl"><b>${esc(t().featHelp)}</b><span>${esc(t().featHelpSub)}</span></span></button>
      <button class="feat ${S.modelPicker ? 'on' : ''}" data-act="modelstart"><span class="fi">${ico('mobile')}</span><span class="tl"><b>${esc(t().featModel)}</b><span>${esc(t().featModelSub)}</span></span></button>
    </div>${picker}
  </section>`;
}

function liveLine(ui) {
  if (!ui.live) return '';
  const top = (ui.live.top || [])[0];
  return `<div class="meta">${esc(fill(t().matchLine, { n: ui.live.matching }))}${top ? ` · ${esc(fill(t().leading, { name: productName(top) }))}` : ''}</div>`;
}

function questionBody(m) {
  const ui = m.ui;
  const q = ui.question;
  const active = m.id === S.activeId && S.ui && S.ui.screen === 'question';
  const head = `<div class="qtext">${esc(L(q.label))}</div>${q.multi && active ? `<div class="meta">${esc(t().multiHint)}</div>` : ''}`;
  if (!active) return head;
  const pills = q.options.map((o) => {
    const sel = q.multi && S.multi.has(o.id);
    return `<button class="qp ${sel ? 'sel' : ''}" data-act="opt" data-id="${esc(o.id)}" aria-pressed="${sel}">${sel ? ico('check') : ''}${esc(L(o.label))}${o.matches != null ? ` <small>${nf.format(o.matches)}</small>` : ''}</button>`;
  }).join('');
  const numeric = q.numeric ? `<label class="amount"><span>${esc(t().egp)}</span><input id="amt" inputmode="numeric" value="${esc(S.amount)}" placeholder="${esc(t().typeAmount)}" aria-label="${esc(L(q.title))}">${q.numeric.unit && /month/i.test(q.numeric.unit) ? `<span>${esc(t().month)}</span>` : ''}</label>` : '';
  const needsNext = q.multi || q.numeric;
  const canNext = q.multi ? S.multi.size > 0 : q.numeric ? Number(S.amount) > 0 || S.multi.size > 0 : false;
  return `${head}<div class="qrow">${pills}</div>${numeric}
    <div class="qrow">${needsNext ? `<button class="qp go" data-act="next" ${canNext ? '' : 'disabled'}>${esc(t().next)} ${ico('arrow', 'flip')}</button>` : ''}
      <button class="qp ghost" data-act="skip">${esc(L(q.skip.label))}</button><button class="qp ghost" data-act="shownow">${esc(t().showNow)}</button></div>
    ${liveLine(ui)}`;
}

function clarifyBody(m) {
  const c = m.ui.clarify || m.ui.question;
  const active = m.id === S.activeId;
  return `<div class="qtext">${esc(L(c.label))}</div>${active ? `<div class="qrow">${(c.options || []).map((o) => `<button class="qp" data-act="clarify" data-id="${esc(o.id)}">${esc(L(o.label))}</button>`).join('')}</div>` : ''}`;
}

/** Which side of the conversation a message is on: the latest result is a full-width block, not a bubble. */
const sideOf = (m) => (m.role === 'user' ? 'user' : m.kind === 'result' && m.id === S.latestResultId ? 'block' : 'bot');

function renderMsg(m, g) {
  if (m.role === 'user') return userBubble(m.text, m.id, g, m.at);
  const B = (inner, cls = '') => botBubble(inner, cls, m.id, g, m.at);
  switch (m.kind) {
    case 'question': return B(questionBody(m));
    case 'clarify': return B(clarifyBody(m));
    case 'note': return B(`<div class="tip warn" style="padding:8px 12px">${ico('warn')}<div><b>${esc(m.title)}</b><p>${esc(m.text)}</p></div></div>`);
    case 'tiles': return B(`<div class="qtext">${esc(L(m.message))}</div>${catPills()}`);
    case 'error': return B(`<div class="tip bad" style="padding:8px 12px">${ico('warn')}<div><b>${esc(t().errTitle)}</b><p>${esc(m.text)}</p></div></div>`);
    case 'result': {
      if (m.id !== S.latestResultId) {
        const p = m.ui.result.picks[0];
        return B(`<div class="meta">${esc(fill(t().resultOld, { name: p ? p.product.name : t().nothingFits }))}</div>`);
      }
      return `<div class="resblock" data-mid="${m.id}">${resultBlocks(m.ui)}</div>`;
    }
    default: return B(`<div class="qtext">${esc(m.text)}</div>`);
  }
}

function undBar() {
  const ui = S.ui;
  if (!S.session || !ui || !ui.chips) return '';
  const n = (ui.chips || []).filter((c) => c.kind === 'value').length;
  if (!n && !(ui.notUsed || []).length && !(ui.suggestions || []).length) return '';
  return `<details class="und"><summary>${esc(t().understood)} <span class="cnt">${n}</span></summary>${chipsBlock(ui, true)}</details>`;
}

/** Messenger-style input bar: quick replies above it before the conversation starts, a "+" for more detail once it has. */
function composer() {
  const hasCat = !!(S.session && S.session.category); // details can be added once a category is chosen
  const quick = S.session || S.chat.length ? '' : `<div class="srow" role="group" aria-label="${esc(t().suggestTitle)}">${t().examples.map((e, i) => `<button type="button" class="qp ex" data-act="example" data-i="${i}">${esc(e)}</button>`).join('')}</div>`;
  return `<form class="composer" id="composer" autocomplete="off">
    ${quick}
    <div class="inbar">
      ${hasCat ? `<button type="button" class="round" data-act="openpanel" aria-label="${esc(t().addDetail)}" title="${esc(t().addDetail)}">${ico('plus')}</button>` : ''}
      <div class="cin"><textarea id="ask" rows="1" placeholder="${esc(hasCat ? t().composerMore : t().composerHome)}" aria-label="${esc(t().askTitle)}">${esc(S.text)}</textarea></div>
      <button type="submit" class="send" data-act="send" aria-label="${esc(t().send)}" ${S.busy ? 'disabled' : ''}>${ico('arrow', 'flip')}</button>
    </div>
  </form>`;
}

function chatHead() {
  return `<div class="chat-head"><span class="av">${APPICON}</span><div class="who"><b>Wisedo</b><span>${esc(t().chatSub)}</span></div>${S.session ? `<button type="button" class="pill-btn" data-act="restart">${esc(t().startOver)}</button>` : ''}</div>`;
}

/** Section 3: a chat window. Head with the avatar, a chat-coloured message area, and the input bar docked at the bottom. */
function chatView() {
  const live = !!S.session || S.chat.length > 0;
  const feed = [{ side: 'bot', html: (g) => greeting(g) }];
  S.chat.forEach((m) => feed.push({ side: sideOf(m), html: (g) => renderMsg(m, g) }));
  if (S.busy) feed.push({ side: 'bot', html: (g) => botBubble(`<span class="dots" aria-label="${esc(S.busy)}"><i></i><i></i><i></i></span>`, 'typing', '', g) });
  const msgs = feed.map((it, i) => it.html({ first: !feed[i - 1] || feed[i - 1].side !== it.side, last: !feed[i + 1] || feed[i + 1].side !== it.side })).join('');
  return `${header()}${cfgSwitch()}${live ? '' : entrySections()}
  <div class="chatwrap">${live ? '' : `<div class="eyebrow">${esc(t().chatTitle)}</div>`}
    <section class="chatwin ${live ? 'live' : ''}" aria-label="Wisedo">
      <div class="chat-top">${chatHead()}${undBar()}</div>
      <div class="chat" id="chat" aria-live="polite"><div class="daychip"><span>${esc(t().today)}</span></div>${msgs}</div>
      ${composer()}
    </section>
  </div>`;
}

// ---------- result ----------
function extrasChips(q) {
  const out = [];
  if (q.deliveryFee === 0) out.push(`<span class="xchip">${ico('truck')}${esc(t().freeDelivery)}</span>`);
  else out.push(`<span class="xchip">${ico('truck')}${esc(fill(t().delivery, { d: q.deliveryDays, fee: numT(q.deliveryFee || 0) }))}</span>`);
  if (q.cod) out.push(`<span class="xchip">${ico('card')}${esc(t().cod)}</span>`);
  if (q.official) out.push(`<span class="xchip">${ico('shield')}${esc(t().official)}</span>`);
  for (const g of q.gifts || []) out.push(`<span class="xchip">${ico('gift')}${esc(L(g.label || g.name || g.text || g))}</span>`);
  return out.join('');
}

function priceBlock(pick) {
  const q = pick.quote;
  const plan = q.plan;
  return `<div class="price-row">
    <span class="price">${num(q.price)} <small>${esc(t().egp)}</small></span>
    ${plan ? `<span class="meta">${esc(fill(t().plan, { m: numT(plan.monthly), n: plan.months, p: plan.providerName }))}</span>
    <span class="meta">${esc(fill(t().total, { t: numT(plan.total), f: numT(plan.financingCost) }))}</span>` : ''}
  </div>`;
}

function whyChips(pick) {
  const rs = (pick.reasons || []).map((r) => `<span class="why">${ico('check')}${esc(L(r.text))}</span>`);
  const nl = (pick.notListed || []).map((n) => `<span class="why" style="color:var(--muted)">${esc(L(n.label || n))}: ${esc(t().notListed)}</span>`);
  return rs.concat(nl).join('');
}

function warningsBlock(items) {
  return (items || []).map((w) => `<div class="tip warn" role="note">${ico('warn')}<div><b>${esc(t().warnTitle)}</b><p>${esc(L(w.text))}</p></div></div>`).join('');
}

function offersTable(pick) {
  const list = pick.otherOffers || [];
  if (list.length < 2) return '';
  return `<details class="dd"><summary>${esc(t().otherShops)} (${list.length})</summary><div class="offers" style="margin-top:8px">${list.map((o) => `
    <div class="offer ${o.status === 'chosen' ? 'chosen' : ''}">
      <div><b>${esc(o.retailerName)}</b> ${o.status === 'chosen' ? `<span class="badge best_fit">${esc(t().chosen)}</span>` : ''}</div>
      <div>${money(o.price)}${o.monthly ? ` · <bdi class="num">${numT(o.monthly)}</bdi> ${esc(t().month)}` : ''}</div>
      ${o.reasonText && o.reasonText.length ? `<div class="why-lost">${esc(o.reasonText.map(L).join(', '))}</div>` : ''}
    </div>`).join('')}</div></details>`;
}

function decisionCard(pick) {
  const q = pick.quote;
  return `<article class="card" aria-label="${esc(pick.product.name)}">
    <div class="dc-head">${MARK('wm')}<b>${esc(t().decisionBy)}</b><span class="grow"></span><span class="badge ${esc(pick.role)}">${esc(t().roles[pick.role] || pick.role)}</span></div>
    <div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:12px">
      <div class="photo">${ico(productIcon(pick.product.id))}</div>
      <div class="stack grow"><span class="pname">${esc(pick.product.name)}</span>
        <div class="meter"><div class="bar"><i style="width:${Math.max(4, Math.min(100, pick.fit))}%"></i></div><span class="lab">${esc(fill(t().fit, { n: nf.format(Math.round(pick.fit)) }))}</span></div></div>
    </div>
    ${priceBlock(pick)}
    <div class="row"><span class="xchip">${ico('store')}${esc(q.retailerName)}</span>${extrasChips(q)}<span class="fresh">${ico('clock')}${esc(fill(t().checked, { h: Math.round(q.ageHours ?? 0) }))}</span></div>
    ${whyChips(pick) ? `<div class="stack"><span class="eyebrow">${esc(t().whyFits)}</span><div class="chips">${whyChips(pick)}</div></div>` : ''}
    ${warningsBlock(pick.warnings)}
    <a class="btn buy block" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer" data-act="buy">${esc(fill(t().buyFrom, { shop: q.retailerName }))} ${ico('ext')}</a>
    ${offersTable(pick)}
    <div class="meta footnote">${esc(t().sampleNote)}</div>
  </article>`;
}

function compactCard(pick) {
  const q = pick.quote;
  return `<article class="card compact" aria-label="${esc(pick.product.name)}">
    <div class="photo">${ico(productIcon(pick.product.id))}</div>
    <span class="badge ${esc(pick.role)}" style="align-self:flex-start">${esc(t().roles[pick.role] || pick.role)}</span>
    <span class="pname">${esc(pick.product.name)}</span>
    <span class="price">${num(q.price)} <small>${esc(t().egp)}</small></span>
    ${q.plan ? `<span class="meta">${esc(fill(t().plan, { m: numT(q.plan.monthly), n: q.plan.months, p: q.plan.providerName }))}</span>` : ''}
    <div class="meter"><div class="bar"><i style="width:${Math.max(4, Math.min(100, pick.fit))}%"></i></div><span class="lab">${esc(fill(t().fit, { n: nf.format(Math.round(pick.fit)) }))}</span></div>
    <span class="meta">${ico('store')} ${esc(q.retailerName)}</span>
    ${warningsBlock(pick.warnings)}
    <a class="btn secondary block" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">${esc(fill(t().buyFrom, { shop: q.retailerName }))}</a>
  </article>`;
}

function resultBlocks(ui) {
  const r = ui.result;
  const out = [];
  const mv = r.modelVerdict;
  if (mv) out.push(`<div class="tip ${mv.type === 'picked' ? 'note' : 'warn'}" role="note">${ico(mv.type === 'picked' ? 'check' : 'info')}<div><b>${esc(mv.name || mv.query)}</b><p>${esc(L(mv.text))}</p></div></div>`);
  if (r.status === 'nothing_fits' || (r.nothingFits && !r.picks.length)) {
    const nf2 = r.nothingFits;
    out.push(`<section class="card"><div class="tip warn">${ico('warn')}<div><b>${esc(t().nothingFits)}</b><p>${esc(L(nf2.text))}</p></div></div>
      <div class="stack"><span class="pname">${esc(nf2.product.name)}</span><span class="price">${num(nf2.quote.price)} <small>${esc(t().egp)}</small></span>
      ${(nf2.extraNeeded || []).map((e) => `<span class="meta">${esc(fill(t().extra, { n: numT(e.amount) }))}</span>`).join('')}
      <span class="meta">${ico('store')} ${esc(nf2.quote.retailerName)}</span></div></section>`);
  } else if (!r.picks.length) {
    out.push(`<div class="tip warn">${ico('warn')}<div><b>${esc(t().nothingFits)}</b><p>${esc(r.status || '')}</p></div></div>`);
  } else {
    out.push(decisionCard(r.picks[0]));
    const rest = r.picks.slice(1);
    if (rest.length) {
      out.push(`<h2 class="h-section">${esc(t().others)}</h2><div class="grid2">${rest.map(compactCard).join('')}</div>`);
    }
    for (const w of r.warnings || []) {
      if (!r.picks.some((p) => (p.warnings || []).some((x) => x.code === w.code && L(x.text) === L(w.text)))) out.push(warningsBlock([w]));
    }
    const others = r.others || [];
    if (others.length) {
      out.push(`<section class="card"><button class="btn secondary" data-act="rest" aria-expanded="${S.showRest}">${esc(S.showRest ? t().hideRest : `${t().showRest} (${others.length})`)}</button>
        ${S.showRest ? `<div>${others.map((o) => `<div class="rest"><span class="rk">${o.rank}</span><div class="stack" style="gap:0"><b>${esc(o.product.name)}</b><span class="meta">${esc(retailerName(o.retailerId))} · ${esc(fill(t().fit, { n: nf.format(Math.round(o.fit)) }))}</span></div><span>${money(o.effCost)}</span></div>`).join('')}</div>` : ''}</section>`);
    }
  }
  // how I decided
  const trace = (r.trace || []).map((x) => `<li>${esc(x.text)}</li>`).join('');
  const skipped = (ui.skippedQuestions || []).map((s) => `<li><b>${esc(L(s.label))}</b>: ${esc(L(s.why))}</li>`).join('');
  const stop = ui.stopReason && t().stop[ui.stopReason] ? `<p class="meta" style="margin:0">${esc(t().stop[ui.stopReason])}</p>` : '';
  out.push(`<section class="card">
    <details class="dd" open><summary>${esc(t().howDecided)}</summary>${stop}<ol class="trace" dir="auto">${trace}</ol></details>
    ${skipped ? `<details class="dd"><summary>${esc(t().skippedQs)} (${(ui.skippedQuestions || []).length})</summary><ul class="trace">${skipped}</ul></details>` : ''}
    <details class="dd"><summary>${esc(t().profileJson)}</summary><pre>${esc(JSON.stringify(ui.profile, null, 2))}</pre></details>
  </section>
  <div class="qrow"><button class="qp" data-act="openpanel">${esc(t().addDetail)}</button><button class="qp ghost" data-act="restart">${esc(t().startOver)}</button></div>`);
  return out.join('');
}

// ---------- add-detail panel ----------
function panelView() {
  const p = S.panel;
  if (!p) return '';
  const groups = new Map();
  for (const s of p.slots) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push(s);
  }
  const sel = (s, id) => (Array.isArray(s.value) ? s.value.includes(id) : s.value === id);
  const slotHtml = (s) => {
    let body = '';
    if (s.valueShape === 'shops') {
      const v = s.value || { prefer: [], avoid: [] };
      body = ['prefer', 'avoid'].map((side) => `<div class="stack"><span class="meta">${side === 'prefer' ? t().prefer : t().avoid}</span><div class="opts">${s.options.map((o) => {
        const on = (v[side] || []).includes(o.id);
        return `<button class="opt ${on ? 'sel' : ''}" data-act="shop" data-slot="${esc(s.slot)}" data-side="${side}" data-id="${esc(o.id)}">${esc(L(o.label))}</button>`;
      }).join('')}</div></div>`).join('');
    } else if (s.valueShape === 'product') {
      body = `<select class="small-in" data-act="prodsel" data-slot="${esc(s.slot)}"><option value="">—</option>${s.options.map((o) => `<option value="${esc(o.id)}" ${s.value === o.id ? 'selected' : ''}>${esc(L(o.label))}</option>`).join('')}</select>`;
    } else {
      body = `<div class="opts">${s.options.map((o) => `<button class="opt ${sel(s, o.id) ? 'sel' : ''}" data-act="setopt" data-slot="${esc(s.slot)}" data-id="${esc(o.id)}" data-multi="${s.multi ? 1 : 0}">${esc(L(o.label))}</button>`).join('')}</div>`;
      if (s.numeric) {
        const cur = typeof s.value === 'number' ? s.value : '';
        body += `<div class="row"><label class="amount grow"><span>${esc(t().egp)}</span><input inputmode="numeric" data-numslot="${esc(s.slot)}" value="${esc(cur)}" aria-label="${esc(L(s.label))}"></label><button class="btn secondary" data-act="setnum" data-slot="${esc(s.slot)}">${esc(t().next)}</button></div>`;
      }
    }
    const from = s.source ? `<span class="meta">${esc(s.source)}</span>` : '';
    return `<div class="slotbox" id="slot-${esc(s.slot)}"><div class="row"><span class="lab">${esc(L(s.label))}</span>${from}</div><span class="meta">${esc(L(s.question))}</span>${body}</div>`;
  };
  return `<div class="sheet-back" data-act="closepanel"></div><section class="sheet" id="panel" role="dialog" aria-label="${esc(t().panelTitle)}">
    <div class="row"><h2 class="h-section grow">${esc(t().panelTitle)}</h2><button class="btn secondary" data-act="closepanel">${esc(t().closePanel)}</button></div>
    <span class="meta">${esc(t().panelHint)}</span>
    <div class="stack"><textarea id="moretext" class="small-in" rows="2" placeholder="${esc(t().moreTextPh)}" style="padding:10px 12px">${esc(S.moreText)}</textarea>
      <button class="btn secondary" data-act="sendtext" ${S.busy ? 'disabled' : ''}>${S.busy ? `<span class="spin" style="border-color:rgba(0,0,0,.2);border-top-color:#000"></span>${esc(S.busy)}` : esc(t().sendText)}</button></div>
    ${[...groups.values()].map((g) => g.map(slotHtml).join('')).join('')}
  </section>`;
}

function renderAdmin() {
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  if (S.admin) return; // already mounted: it keeps its own state
  $app.classList.add('wide');
  $app.innerHTML = `<header class="top"><div class="brand-row">${LOGO}<span class="meta">admin</span></div><div class="top-actions"><button class="pill-btn" data-act="route" data-to="try">Back to try-it</button></div></header><div id="admin-root"></div>`;
  S.admin = { pending: true };
  import('./admin.js').then((m) => {
    const rootEl = document.getElementById('admin-root');
    if (!rootEl || S.route !== 'admin') { S.admin = null; return; }
    S.admin = m.mountAdmin(rootEl, {
      store: S.store, baseConfig: S.base.config, data: S.base.data,
      onTry: (ov) => { S.draftOv = ov; S.cfgMode = 'draft'; rebuildCtx(); goRoute('try'); },
    });
  }).catch((e) => { S.admin = null; $app.insertAdjacentHTML('beforeend', `<div class="tip bad"><div><b>${esc(t().errTitle)}</b><p>${esc(e && e.message || e)}</p></div></div>`); });
}

async function goRoute(to) {
  if (S.admin && S.admin.flush) { try { await S.admin.flush(); } catch { /* the draft is saved on the next edit */ } }
  if (S.admin && S.admin.destroy) S.admin.destroy();
  S.admin = null;
  S.route = to;
  $app.classList.toggle('wide', to === 'admin');
  try { history.replaceState(null, '', to === 'admin' ? '#admin' : location.pathname + location.search); } catch { /* the frame may refuse; the route is kept in state */ }
  if (to === 'try') { rebuildCtx(); startOver(); } else render();
}

function render() {
  if (S.route === 'admin' && S.ready) { renderAdmin(); return; }
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  if (S.loadError) { $app.innerHTML = `${header()}<div class="tip bad">${ico('warn')}<div><b>${esc(t().errTitle)}</b><p>${esc(S.loadError)}</p></div></div>`; return; }
  if (!S.ready) { $app.innerHTML = `${header()}<p class="tagline">${esc(t().reading)}</p>`; return; }
  $app.innerHTML = chatView() + (S.panel ? panelView() : '');
  if (S.busy) $app.querySelectorAll('.qp[data-act], .send').forEach((b) => { b.disabled = true; });
  const focus = S.focusId && $app.querySelector(`[data-mid="${S.focusId}"]`);
  if (focus) { S.focusId = null; S.scroll = false; requestAnimationFrame(() => focus.scrollIntoView({ block: 'start', behavior: 'smooth' })); }
  else if (S.scroll) { S.scroll = false; requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })); }
}

// ---------- events ----------
function startOver() {
  S.session = null; S.ui = null; S.panel = null; S.note = null; S.multi = new Set(); S.amount = ''; S.moreText = '';
  S.chat = []; S.activeId = null; S.latestResultId = null; S.focusId = null; S.text = ''; S.greetAt = Date.now();
  render();
}

async function openPanel(slot, withText) {
  await refreshPanel();
  render();
  const el = document.getElementById(withText ? 'moretext' : slot ? `slot-${slot}` : 'panel');
  if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (withText) el.focus(); }
}

async function submitAnswer(v) { await run({ type: 'answer', value: v }, t().reading); }

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'ask') { S.text = el.value; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }
  else if (el.id === 'moretext') S.moreText = el.value;
  else if (el.id === 'modelq') { S.modelQ = el.value; const pos = el.selectionStart; render(); const q = document.getElementById('modelq'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
  else if (el.id === 'amt') { S.amount = el.value.replace(/[^\d]/g, ''); S.multi = new Set(); const nxt = $app.querySelector('[data-act="next"]'); if (nxt) nxt.disabled = !(Number(S.amount) > 0); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.act === 'cfgmode') { S.cfgMode = el.value; rebuildCtx(); startOver(); return; }
  if (el.dataset && el.dataset.act === 'prodsel') {
    await run({ type: 'edit', slot: el.dataset.slot, value: el.value || null });
    await refreshPanel(); render();
  }
});

/** Send what is in the composer (or a given text): the first message starts the session, later ones add detail. */
async function sendText(text) {
  const msg = String(text ?? S.text ?? '').trim();
  if (!msg || S.busy) return;
  S.text = '';
  sayUser(msg);
  if (!S.session) { S.panel = null; await run({ type: 'start', text: msg }, t().reading); }
  else await run({ type: 'addText', text: msg }, t().reading);
}

document.addEventListener('submit', (e) => { e.preventDefault(); sendText(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'amt')) { e.preventDefault(); const nxt = $app.querySelector('[data-act="next"]'); if (nxt && !nxt.disabled) nxt.click(); }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.id === 'ask') { e.preventDefault(); sendText(); }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const d = btn.dataset;
  switch (act) {
    case 'lang': S.lang = S.lang === 'ar' ? 'en' : 'ar'; render(); break;
    case 'route': await goRoute(d.to); break;
    case 'restart': startOver(); break;
    case 'cat': {
      const c = cats.find((x) => x.id === d.id);
      sayUser(d.say === 'help' || !c ? t().help : L(c.label));
      S.session = null; S.panel = null;
      // "Help me choose" has no category yet: an empty start shows the category tiles in the chat.
      await run(c ? { type: 'start', tile: d.id } : { type: 'start', text: '' }, t().reading);
      break;
    }
    case 'modelstart': S.modelPicker = !S.modelPicker; render(); { const q = document.getElementById('modelq'); if (q) q.focus(); } break;
    case 'pickmodel': {
      const pr = S.lib.products.get(d.id);
      S.modelPicker = false; S.modelQ = '';
      sayUser(pr ? pr.name : d.id);
      S.session = null; S.panel = null;
      await run({ type: 'start', tile: (pr && pr.category) || 'mobile' }, t().reading);
      S.chat.pop(); // the category question is not needed when the model is known
      await run({ type: 'edit', slot: 'modelInMind', value: d.id }, t().reading);
      await run({ type: 'showNow' }, t().reading);
      break;
    }
    case 'example': await sendText(t().examples[Number(d.i)]); break;
    case 'opt': {
      const q = S.ui && S.ui.question;
      if (!q) break;
      if (q.multi) { S.multi.has(d.id) ? S.multi.delete(d.id) : S.multi.add(d.id); S.amount = ''; render(); }
      else { const o = q.options.find((x) => x.id === d.id); sayUser(o ? L(o.label) : d.id); await submitAnswer(d.id); }
      break;
    }
    case 'next': {
      const q = S.ui && S.ui.question;
      if (!q) break;
      if (q.multi) { sayUser(q.options.filter((o) => S.multi.has(o.id)).map((o) => L(o.label)).join(t().listSep)); await submitAnswer([...S.multi]); }
      else if (q.numeric && Number(S.amount) > 0) { sayUser(`${numT(Number(S.amount))} ${t().egp}`); await submitAnswer(Number(S.amount)); }
      break;
    }
    case 'skip': { const q = S.ui && S.ui.question; sayUser(q ? L(q.skip.label) : ''); await run({ type: 'skip' }, t().reading); break; }
    case 'shownow': sayUser(t().showNow); await run({ type: 'showNow' }, t().reading); break;
    case 'clarify': {
      const c = S.ui && (S.ui.clarify || S.ui.question);
      const o = c && (c.options || []).find((x) => x.id === d.id);
      sayUser(o ? L(o.label) : d.id);
      await run({ type: 'answer', option: d.id }, t().reading);
      break;
    }
    case 'openpanel': await openPanel(d.slot, !!d.text); break;
    case 'closepanel': S.panel = null; render(); break;
    case 'clear': await run({ type: 'edit', slot: d.slot, value: null }); break;
    case 'accept': { let v; try { v = JSON.parse(d.value); } catch { v = d.value; } await run({ type: 'edit', slot: d.slot, value: v }); break; }
    case 'setopt': {
      const slot = S.panel && S.panel.slots.find((s) => s.slot === d.slot);
      if (!slot) break;
      let v;
      if (d.multi === '1') {
        const cur = Array.isArray(slot.value) ? slot.value.slice() : [];
        v = cur.includes(d.id) ? cur.filter((x) => x !== d.id) : cur.concat(d.id);
        if (!v.length) v = null;
      } else v = slot.value === d.id ? null : d.id;
      await run({ type: 'edit', slot: d.slot, value: v });
      await refreshPanel(); render();
      break;
    }
    case 'setnum': {
      const inp = $app.querySelector(`[data-numslot="${CSS.escape(d.slot)}"]`);
      const n = inp ? Number(String(inp.value).replace(/[^\d.]/g, '')) : NaN;
      if (n > 0) { await run({ type: 'edit', slot: d.slot, value: n }); await refreshPanel(); render(); }
      break;
    }
    case 'shop': {
      const slot = S.panel && S.panel.slots.find((s) => s.slot === d.slot);
      if (!slot) break;
      const cur = slot.value || { prefer: [], avoid: [] };
      const next = { prefer: (cur.prefer || []).filter((x) => x !== d.id), avoid: (cur.avoid || []).filter((x) => x !== d.id) };
      if (!(cur[d.side] || []).includes(d.id)) next[d.side].push(d.id);
      await run({ type: 'edit', slot: d.slot, value: next.prefer.length || next.avoid.length ? next : null });
      await refreshPanel(); render();
      break;
    }
    case 'sendtext': {
      const text = (S.moreText || '').trim();
      if (!text) break;
      S.moreText = '';
      await run({ type: 'addText', text }, t().reading);
      await refreshPanel(); render();
      break;
    }
    case 'rest': S.showRest = !S.showRest; render(); break;
    default: break;
  }
});

// ---------- boot ----------
render();
loadData().then(() => { S.ready = true; if (location.hash === '#admin') S.route = 'admin'; $app.classList.toggle('wide', S.route === 'admin'); render(); }).catch((e) => { S.loadError = String(e && e.message || e); render(); });
