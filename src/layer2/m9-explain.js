// M9 Explainer: strengths, perks, warnings, timing, verdict on the model in mind, why not the popular model,
// other offers with why each lost, and the "how I decided" trace.
//
// Rules (tech-spec 5, technical-design-v4):
//  - A strength is claimed only if the product is above the pool average AND in the top half of the category
//    on that attribute. The pool is the eligible products of this run; the category is every product in scope.
//  - Every number shown traces to an offer/plan/product field or a formula; each number carries a `source`.
import { toMs, round2, cmpNum, cmpStr, lastFridayOfNovember, fmtEgp, DAY_MS } from '../util.js';
import { evalCondition } from '../conditions.js';
import { norm, numeric } from './snapshot.js';
import { extraNeeded } from './m5-afford.js';
import { NOT_LISTED, ENGINE_VERSION } from './constants.js';

const T = (en, ar) => ({ en, ar });

export const OFFER_LOSS_TEXT = {
  out_of_stock: T('Out of stock', 'مش متوفر'),
  stale: T('Price not checked recently enough', 'السعر مش متحدّث'),
  import_not_accepted: T('Imported unit, no agent warranty', 'نسخة مستوردة من غير ضمان الوكيل'),
  avoided_shop: T('A shop you want to avoid', 'محل إنت مش عايز تشتري منه'),
  no_delivery_zone: T('Does not deliver to your area', 'مش بيوصّل لمنطقتك'),
  no_cod: T('No cash on delivery', 'مفيش دفع عند الاستلام'),
  no_plan: T('No installment plan for your payment way', 'مفيش تقسيط بطريقة الدفع بتاعتك'),
  unknown_retailer: T('Unknown shop', 'محل غير معروف'),
  slow: T('Slower than you need', 'التوصيل أبطأ من اللي محتاجه'),
  not_preferred_shop: T('Not one of your preferred shops', 'مش من المحلات اللي بتفضّلها'),
  no_cod_prefer: T('No cash on delivery (you preferred it)', 'مفيش دفع عند الاستلام'),
  over_budget: T('Over your budget or monthly cap', 'أعلى من ميزانيتك أو قسطك'),
  costs_more: T('Costs more for you', 'أغلى عليك'),
  trust_premium: T('Same money, but a less trusted shop', 'نفس التمن تقريباً بس من محل ثقته أقل'),
  tie_break: T('Same cost; a more trusted or faster shop won', 'نفس التكلفة، والأولوية لمحل أوثق أو أسرع'),
};

/**
 * Fill an attribute's explain template.
 * @param {any} attr @param {any} value
 */
function explainText(attr, value) {
  const fill = (s) => s.replace('{value}', typeof value === 'boolean' ? '' : String(value)).trim();
  return { en: fill(attr.explain.en), ar: fill(attr.explain.ar) };
}

/**
 * Top 2 strengths of an item vs the pool.
 * @param {any} prep @param {any} item @param {any[]} pool @param {{attr: any, w: number}[]} weights
 */
export function strengths(prep, item, pool, weights) {
  const out = [];
  for (const { attr, w } of weights) {
    const me = norm(attr, item.product);
    if (!me.known || attr.median === null) continue;
    const avg = pool.reduce((s, o) => s + norm(attr, o.product).n, 0) / pool.length;
    if (!(me.n > avg)) continue;
    const v = numeric(item.product.attrs[attr.id]);
    const topHalf = attr.higherIsBetter === false ? v <= attr.median : v >= attr.median;
    if (!topHalf) continue;
    out.push({ attr, w, d: w * (me.n - avg), value: item.product.attrs[attr.id] });
  }
  out.sort((a, b) => cmpNum(b.d, a.d) || cmpStr(a.attr.id, b.attr.id));
  return out.slice(0, 2).map((x) => ({
    attr: x.attr.id, label: x.attr.label, value: x.value, unit: x.attr.unit || null,
    text: explainText(x.attr, x.value), source: `product.attrs.${x.attr.id}`,
  }));
}

/** "not listed" labels for a product's unknown attributes that matter in this run. */
function notListed(prep, item) {
  const ids = [...new Set([...item.unknown, ...item.unknownMust.map((f) => f.attr), ...item.unknownPrefer.map((f) => f.attr)])].sort();
  return ids.map((id) => {
    const a = prep.attrById.get(id);
    return { attr: id, label: a ? a.label : T(id, id), status: NOT_LISTED };
  });
}

/** Perks with EGP value or that change the decision (technical-design-v4 explanation rules). */
function perks(item, otherUsable) {
  const q = item.quote;
  const out = [];
  for (const g of q.gifts) out.push({ code: 'gift', text: T(`${g.label} (worth ${fmtEgp(g.value)})`, `${g.label} (قيمته ${fmtEgp(g.value)})`), value: g.value, source: 'offer.extras[].value_egp' });
  if (q.plan && q.plan.monthlyRate === 0 && q.plan.adminShare === 0) {
    const until = q.plan.validUntil ? ` until ${q.plan.validUntil}` : '';
    out.push({ code: 'zero_interest', text: T(`0% installments, no admin fee${until}`, `تقسيط بدون فوايد ولا مصاريف${q.plan.validUntil ? ' لحد ' + q.plan.validUntil : ''}`), validUntil: q.plan.validUntil, source: 'plan.monthly_rate, plan.admin_share, plan.valid_until' });
  }
  if (q.deliveryDays === 0) out.push({ code: 'same_day', text: T('Same-day delivery', 'توصيل في نفس اليوم'), source: 'offer.delivery[zone].days' });
  if (otherUsable.length) {
    const next = Math.min(...otherUsable.map((e) => e.quote.effCost));
    const saving = round2(next - q.effCost);
    if (saving >= 100) out.push({ code: 'saving_vs_next_shop', text: T(`${fmtEgp(saving)} cheaper than the next shop`, `أوفر من تاني أرخص محل بـ ${fmtEgp(saving)}`), value: saving, source: 'effCost(next shop) - effCost(this offer)' });
  }
  return out;
}

/** Warnings attached to one pick. */
function pickWarnings(prep, item, buyer, nowMs) {
  const q = item.quote;
  const w = [];
  if (q.plan && q.plan.financingShare > prep.params.financingWarnShare) {
    const pct = Math.round(q.plan.financingShare * 100);
    w.push({ code: 'financing_over_35', values: { share: q.plan.financingShare, cost: q.plan.financingCost, months: q.plan.months },
      text: T(`Installments over ${q.plan.months} months add ${pct}% (${fmtEgp(q.plan.financingCost)}) to the price.`, `التقسيط على ${q.plan.months} شهر بيزوّد السعر ${pct}% (${fmtEgp(q.plan.financingCost)}).`),
      source: '(plan total - price) / price' });
  }
  if (!q.official) w.push({ code: 'import_offer', text: T(`The best offer is an imported unit from ${q.retailerName}: no agent warranty.`, `أحسن عرض نسخة مستوردة من ${q.retailerName}: من غير ضمان الوكيل.`), source: 'offer.official' });
  if (q.plan && q.plan.promo && q.plan.validUntil) {
    const daysLeft = Math.floor((toMs(q.plan.validUntil) - nowMs) / DAY_MS);
    if (daysLeft <= prep.params.promoWarnDays) w.push({ code: 'promo_ending', values: { validUntil: q.plan.validUntil, daysLeft },
      text: T(`The installment promo ends on ${q.plan.validUntil}.`, `عرض التقسيط بينتهي يوم ${q.plan.validUntil}.`), source: 'plan.valid_until' });
  }
  if (q.plan && !q.plan.fitsCap) w.push({ code: 'over_monthly_cap', values: { monthly: q.plan.monthly, cap: buyer.monthlyCap },
    text: T(`Monthly ${fmtEgp(q.plan.monthly)} is above your ${fmtEgp(buyer.monthlyCap)} cap.`, `القسط ${fmtEgp(q.plan.monthly)} أعلى من ${fmtEgp(buyer.monthlyCap)}.`), source: 'plan monthly vs money.monthlyCap' });
  if (item.afford === 'stretch') {
    for (const x of extraNeeded(q, buyer)) w.push({ code: 'stretch', values: x, text: x.kind === 'monthly'
      ? T(`${fmtEgp(x.amount)} a month over your cap.`, `أعلى من قسطك بـ ${fmtEgp(x.amount)} في الشهر.`)
      : T(`${fmtEgp(x.amount)} over your budget.`, `أعلى من ميزانيتك بـ ${fmtEgp(x.amount)}.`), source: x.kind === 'monthly' ? 'plan.monthly - money.monthlyCap' : 'cashOut - money.budget' });
  }
  if (item.unknown.length || item.unknownMust.length || item.unknownPrefer.length) {
    w.push({ code: 'not_listed', values: { attrs: notListed(prep, item).map((x) => x.attr) },
      text: T('Some specs are not listed by the seller; they were scored as average.', 'في مواصفات مش مذكورة، اتحسبت متوسطة.'), source: 'product.attrs' });
  }
  if (item.unknownMust.length) w.push({ code: 'unknown_must', values: { attrs: item.unknownMust.map((f) => f.attr) },
    text: T('Could not confirm one of your must-haves: it is not listed for this model.', 'مش قادر أتأكد من حاجة إنت طالبها لأنها مش مذكورة للموديل ده.'), source: 'must filter on an unknown attribute' });
  if (q.giftsStale) w.push({ code: 'gifts_not_counted', text: T('Gifts were not counted: they were not re-checked recently.', 'الهدايا متحسبتش لأنها متراجعتش من فترة.'), source: 'offer.extras_checked_at' });
  return w;
}

/** Every offer of a picked product, with why it lost. */
function otherOffers(item, flags) {
  const chosen = item.best;
  const rows = [];
  for (const ev of item.evals) {
    const q = ev.quote;
    const row = {
      offerId: ev.offerId, retailerId: ev.retailerId, retailerName: ev.retailer ? ev.retailer.name : ev.retailerId,
      status: ev === chosen ? 'chosen' : 'lost', reasons: [],
      price: ev.offer.price_egp, effCost: q ? q.effCost : null, monthly: q && q.plan ? q.plan.monthly : null,
      planId: q && q.plan ? q.plan.planId : null, deliveryDays: q ? q.deliveryDays : null, official: ev.offer.official,
      checkedAt: ev.offer.checked_at, url: ev.offer.url,
    };
    if (ev !== chosen) {
      row.reasons.push(...ev.hard);
      if (flags.slow && ev.soft.slow) row.reasons.push('slow');
      if (flags.shop && ev.soft.notPreferredShop) row.reasons.push('not_preferred_shop');
      if (flags.cod && ev.soft.noCodPrefer) row.reasons.push('no_cod_prefer');
      if (!row.reasons.length && q) {
        if (chosen.quote.ratio <= 1 && q.ratio > 1) row.reasons.push('over_budget');
        else if (q.effCost > chosen.quote.effCost) { row.reasons.push('costs_more'); row.costMoreBy = round2(q.effCost - chosen.quote.effCost); }
        else if (q.rankCost > chosen.quote.rankCost) row.reasons.push('trust_premium');
        else row.reasons.push('tie_break');
      }
      row.reasonText = row.reasons.map((r) => OFFER_LOSS_TEXT[r] || T(r, r));
    }
    rows.push(row);
  }
  rows.sort((a, b) => (a.status === 'chosen' ? -1 : b.status === 'chosen' ? 1 : 0) || cmpNum(a.effCost ?? Infinity, b.effCost ?? Infinity) || cmpStr(a.offerId, b.offerId));
  return rows;
}

/**
 * Build the public Pick object.
 * @param {any} prep @param {any} run @param {{role: string, item: any}} pick @param {number} nowMs
 */
export function buildPick(prep, run, pick, nowMs) {
  const it = pick.item;
  const pool = run.eligible.length ? run.eligible : [it];
  const usableOthers = it.evals.filter((e) => e !== it.best && e.quote && !e.hard.length);
  return {
    role: pick.role,
    product: { id: it.product.id, name: it.product.name, brand: it.product.brand, source: it.product.source },
    fit: it.fit,
    score: it.score,
    dealBonus: it.dealBonus,
    brandBonus: it.brandBonus,
    affordability: it.afford,
    verified: it.verified,
    quote: it.quote,
    tco: it.tco,
    reasons: strengths(prep, it, pool, run.weights),
    perks: perks(it, usableOthers),
    notListed: notListed(prep, it),
    warnings: pickWarnings(prep, it, run.buyer, nowMs),
    otherOffers: otherOffers(it, run.flags),
  };
}

/** One row of the "show the rest" list. */
export function listRow(it, rank) {
  return {
    rank, product: { id: it.product.id, name: it.product.name, brand: it.product.brand },
    fit: it.fit, score: it.score, affordability: it.afford, verified: it.verified,
    effCost: it.quote.effCost, monthly: it.quote.plan ? it.quote.plan.monthly : null,
    retailerId: it.quote.retailerId, offerId: it.quote.offerId,
  };
}

/** Normalise a model name for matching ("Galaxy A56" == "galaxy-a56"). */
const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

/**
 * Find the product the buyer had in mind: by id, name, alias, or brand + alias.
 * @param {any} prep @param {string} query
 */
export function findModel(prep, query) {
  const q = normName(query);
  if (!q) return null;
  for (const p of prep.products) {
    const names = [p.id, p.name, ...(p.aliases || []), ...(p.aliases || []).map((a) => p.brand + ' ' + a)];
    if (names.some((n) => normName(n) === q)) return p;
  }
  return null;
}

/** Why `it` did not make it, vs the best fit. */
function whyNotText(prep, run, it, best) {
  if (it.excludedBy === 'no_offer') {
    const codes = [...new Set(it.evals.flatMap((e) => e.hard))].sort();
    return { type: 'no_offer', reasons: codes, text: T('No shop can sell it to you on your terms right now.', 'مفيش محل يقدر يبيعهولك بشروطك دلوقتي.') };
  }
  if (it.excludedBy) {
    const s = run.softs.find((x) => x.id === it.excludedBy);
    return { type: 'excluded_by_preference', text: T(`Left out by your preference: ${s ? s.why.en : ''}`, `اتشال عشان تفضيلك: ${s ? s.why.ar : ''}`) };
  }
  if (it.afford !== 'eligible') {
    const extra = extraNeeded(it.quote, run.buyer);
    const x = extra[0];
    return { type: 'over_budget', extra, text: x
      ? (x.kind === 'monthly' ? T(`Over your monthly cap by ${fmtEgp(x.amount)}.`, `أعلى من قسطك بـ ${fmtEgp(x.amount)} في الشهر.`) : T(`Over your budget by ${fmtEgp(x.amount)}.`, `أعلى من ميزانيتك بـ ${fmtEgp(x.amount)}.`))
      : T('Over your budget.', 'أعلى من ميزانيتك.') };
  }
  if (!best) return { type: 'close', text: T('A close option.', 'اختيار قريب.') };
  let worst = null;
  for (const { attr, w } of run.weights) {
    const gap = w * (norm(attr, best.product).n - norm(attr, it.product).n);
    if (!worst || gap > worst.gap || (gap === worst.gap && attr.id < worst.attr.id)) worst = { attr, gap };
  }
  if (worst && worst.gap > 0) return { type: 'weaker', attr: worst.attr.id, scoreGap: round2(best.score - it.score), text: T(`Weaker in ${worst.attr.label.en.toLowerCase()} for your needs.`, `أضعف في ${worst.attr.label.ar} بالنسبة لاحتياجك.`) };
  return { type: 'close', scoreGap: round2(best.score - it.score), text: T('Close, but scored a little lower overall.', 'قريب، بس سكوره أقل شوية.') };
}

/**
 * Verdict on the model the buyer had in mind (BR-13).
 * @param {any} prep @param {any} run @param {any[]} picks (internal {role,item}) @param {string|null} query
 */
export function modelVerdict(prep, run, picks, query) {
  if (!query) return null;
  const p = findModel(prep, query);
  if (!p) return { query, productId: null, type: 'not_in_catalog', text: T('This model is not in our catalog yet.', 'الموديل ده مش عندنا في الكتالوج لسه.') };
  const base = { query, productId: p.id, name: p.name };
  const pk = picks.find((x) => x.item.product.id === p.id);
  if (pk) return { ...base, type: 'picked', role: pk.role, text: T('Good choice: it is one of the picks.', 'اختيار كويس: موجود في الترشيحات.') };
  const m1 = run.loaded.removed.find((r) => r.productId === p.id);
  if (m1) return { ...base, type: 'unavailable', reason: m1.reason, text: T('No shop has it in stock with a fresh price right now.', 'مش متوفر دلوقتي في أي محل بسعر متحدّث.') };
  const m2 = run.must.removed.find((r) => r.productId === p.id);
  if (m2) return { ...base, type: 'fails_need', why: m2.filter.why || null, text: T(`Not suitable: ${(m2.filter.why && m2.filter.why.en) || m2.filter.attr}.`, `مش مناسب: ${(m2.filter.why && m2.filter.why.ar) || m2.filter.attr}.`) };
  const it = run.items.find((x) => x.product.id === p.id);
  const best = picks[0] ? picks[0].item : null;
  return { ...base, ...whyNotText(prep, run, it, best) };
}

/** "Why not the popular model": the best-fitting popular product that was not picked, within reach. */
export function whyNotPopular(prep, run, picks, modelProductId) {
  const chosen = new Set(picks.map((x) => x.item.product.id));
  const cands = run.items.filter((it) => it.product.popular && !chosen.has(it.product.id) && it.product.id !== modelProductId && it.quote && it.quote.ratio <= prep.params.popularMaxRatio);
  cands.sort((a, b) => cmpNum(b.fit, a.fit) || cmpStr(a.product.id, b.product.id));
  const it = cands[0];
  if (!it) return null;
  return { productId: it.product.id, name: it.product.name, ...whyNotText(prep, run, it, picks[0] ? picks[0].item : null) };
}

/** Timing advice: sale events from config.season (technical-design-v4 timing rules). */
export function timingAdvice(prep, run, best, nowMs) {
  const out = [];
  for (const ev of (prep.config.season && prep.config.season.saleEvents) || []) {
    if (ev.rule !== 'last_friday_of_november') continue;
    const year = new Date(nowMs).getUTCFullYear();
    let d = lastFridayOfNovember(year);
    if (d.getTime() + DAY_MS <= nowMs) d = lastFridayOfNovember(year + 1);
    const days = Math.ceil((d.getTime() - nowMs) / DAY_MS);
    const weeks = Math.ceil(days / 7);
    const urgent = run.buyer.urgentDays;
    if (weeks < ev.windowWeeks[0] || weeks > ev.windowWeeks[1]) continue;
    if (urgent != null && urgent < days) continue;
    const date = d.toISOString().slice(0, 10);
    const advice = { code: ev.id, date, weeks, text: T(`${ev.label.en} is on ${date}, about ${weeks} weeks away.`, `${ev.label.ar} يوم ${date}، بعد حوالي ${weeks} أسابيع.`) };
    if (best) {
      advice.savingLow = Math.round(best.quote.effCost * ev.savingShare[0]);
      advice.savingHigh = Math.round(best.quote.effCost * ev.savingShare[1]);
      advice.source = `effCost * ${ev.savingShare[0]}..${ev.savingShare[1]} (assumption)`;
      advice.text = T(`Not in a hurry? ${ev.label.en} is on ${date} (about ${weeks} weeks). Prices often drop then; on the top pick that could save ${fmtEgp(advice.savingLow)} to ${fmtEgp(advice.savingHigh)} (estimate).`,
        `مش مستعجل؟ ${ev.label.ar} يوم ${date} (بعد حوالي ${weeks} أسابيع). الأسعار عادة بتنزل، وعلى الترشيح الأول ممكن توفّر من ${fmtEgp(advice.savingLow)} لـ ${fmtEgp(advice.savingHigh)} (تقدير).`);
    }
    out.push(advice);
  }
  return out;
}

/** Global warnings: assumptions, config checks, and the best fit's offer risks. */
export function globalWarnings(prep, run, profile, bestPick) {
  const w = [];
  if (run.buyer.payAssumed) w.push({ code: 'pay_assumed', text: T('Payment way not given: prices are quoted for cash.', 'طريقة الدفع مش محددة: الأسعار محسوبة كاش.') });
  if (run.buyer.zoneAssumed && run.buyer.zone) {
    const zl = (prep.config.zones.labels || {})[run.buyer.zone] || { en: run.buyer.zone, ar: run.buyer.zone };
    w.push({ code: 'city_assumed', text: T(`City not given: assumed ${zl.en}, using its delivery fees and times.`, `المحافظة مش محددة: افترضت ${zl.ar}، بمصاريف ومدة التوصيل بتاعتها.`) });
  } else if (run.buyer.zoneAssumed) w.push({ code: 'city_assumed', text: T('City not given: assumed nationwide, using the highest delivery fee and slowest delivery of each shop.', 'المحافظة مش محددة: افترضت أي مكان في مصر، بأعلى مصاريف شحن وأبطأ توصيل لكل محل.') });
  for (const ch of prep.config.checks || []) {
    if (evalCondition(ch.when, { profile })) w.push({ code: 'check:' + ch.id, text: ch.message });
  }
  if (bestPick) {
    for (const x of bestPick.warnings) if (x.code === 'financing_over_35' || x.code === 'import_offer') w.push({ ...x, productId: bestPick.product.id });
  }
  return w;
}

/** The "how I decided" trace (rank mode only). */
export function buildTrace(prep, run, picks, profile) {
  const steps = [];
  const cat = prep.config.id;
  steps.push({ step: 'M1', count: run.loaded.candidates.length,
    text: `Loaded ${prep.products.length} ${cat} products for tenant ${prep.tenant}; ${run.loaded.removed.length} had no fresh, in-stock offer.`,
    removed: run.loaded.removed });
  const byFilter = new Map();
  for (const r of run.must.removed) {
    const key = JSON.stringify([r.filter.attr, r.filter.op, r.filter.value]);
    if (!byFilter.has(key)) byFilter.set(key, { filter: r.filter, products: [] });
    byFilter.get(key).products.push(r.productId);
  }
  for (const { filter, products } of byFilter.values()) {
    steps.push({ step: 'M2', count: products.length, text: `Removed ${products.length}: ${(filter.why && filter.why.en) || `${filter.attr} ${filter.op} ${JSON.stringify(filter.value)}`}.`, removed: products.map((id) => ({ productId: id, reason: 'must' })) });
  }
  const unknownKept = run.items.filter((i) => i.unknownMust.length).map((i) => i.product.id);
  if (unknownKept.length) steps.push({ step: 'M2', count: unknownKept.length, text: `Kept ${unknownKept.length} whose must-have spec is not listed (labelled "not listed").`, kept: unknownKept });
  const nOffers = run.items.reduce((s, i) => s + i.evals.length, 0);
  const shops = new Set(run.items.flatMap((i) => i.evals.map((e) => e.retailerId)));
  const noOffer = run.excluded.filter((i) => i.excludedBy === 'no_offer');
  steps.push({ step: 'M4', count: run.items.length - noOffer.length,
    text: `Compared ${nOffers} offers from ${shops.size} shops for ${run.buyer.pay}${run.buyer.payAssumed ? ' (assumed)' : ''}${run.buyer.providers ? ' via ' + run.buyer.providers.join(', ') : ''}; ${noOffer.length} products had no usable offer for you.`,
    removed: noOffer.map((i) => ({ productId: i.product.id, reason: 'no_offer', offerReasons: [...new Set(i.evals.flatMap((e) => e.hard))].sort() })) });
  const prefOut = run.excluded.filter((i) => i.excludedBy && i.excludedBy !== 'no_offer');
  if (prefOut.length) steps.push({ step: 'M6', count: prefOut.length, text: `Left out ${prefOut.length} by your preferences.`, removed: prefOut.map((i) => ({ productId: i.product.id, reason: i.excludedBy })) });
  steps.push({ step: 'M6', count: run.gaveUp.length, text: run.gaveUp.length ? `Nothing fitted, so I gave up: ${run.gaveUp.map((s) => s.why.en).join('; ')}.` : 'No preference had to be given up.' });
  steps.push({ step: 'M5', count: run.eligible.length, text: `Affordability: ${run.eligible.length} within budget, ${run.stretch.length} slightly over (up to 15%), ${run.over.length} over.` });
  steps.push({ step: 'M7', text: 'Ranked by need fit (0-100) + deal bonus (up to +/-5 vs reference price) + brand bonus; ties by product id. Costs are effective costs for you: paid + delivery + install - gifts, with a (9 - trust)% risk premium for choosing the shop.' });
  steps.push({ step: 'M8', count: picks.length, text: picks.length ? `Roles: ${picks.map((p) => `${p.role} = ${p.item.product.id}`).join(', ')}.` : 'No pick.' });
  steps.push({ step: 'meta', text: `engine ${ENGINE_VERSION}, snapshot ${prep.snapshot.snapshot_id}, config ${prep.config.id}@${prep.config.version}` });
  return steps;
}
