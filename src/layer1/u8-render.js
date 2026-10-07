// U8 Question renderer (tech-spec 4, component U8; tech-spec 8a "Next-question response"). Deterministic.
//
// One question at a time: Arabic and English labels from the config, answer tiles with match counts from
// simulate, zero-match answers hidden (money answers never are, so a too-low budget still gets an honest
// answer), and skip = the slot's default ("doesn't matter").
import { valueLabel } from './u4-confirm.js';

/**
 * @param {any} config
 * @param {import('./u7-planner.js').PlanResult} plan
 * @param {{index: number, of: number}} step
 * @returns {any}  the question payload
 */
export function renderQuestion(config, plan, step) {
  const slot = config.slots.find((s) => s.id === plan.slot);
  const evals = new Map((plan.evaluation ? plan.evaluation.options : []).map((o) => [o.id, o]));
  /** @type {any[]} */
  const options = [];
  for (const o of slot.options) {
    if (plan.onlyOptions && !plan.onlyOptions.includes(o.id)) continue;
    // The city question is simulated per zone: every city takes its zone's count.
    const ev = evals.get(o.id) || [...evals.values()].find((x) => x.cities && x.cities.includes(o.id));
    if (plan.evaluation && !ev) continue; // not offered (e.g. a card bank to a finance-company buyer)
    if (ev && !ev.visible) continue;
    const opt = { id: o.id, label: o.label, matches: ev ? ev.matches : null };
    if (o.value !== undefined) opt.value = o.value;
    options.push(opt);
  }
  const hasDefault = slot.default !== undefined && slot.default !== null;
  return {
    slot: slot.id,
    label: slot.question,
    title: slot.label,
    multi: !!slot.multi,
    numeric: slot.numeric ? { unit: slot.numeric.unit, min: slot.numeric.min, max: slot.numeric.max } : null,
    options,
    skippable: true,
    skip: hasDefault
      ? { means: slot.default, label: { en: `Doesn't matter (${valueLabel(slot, slot.default).en})`, ar: `مش فارقة (${valueLabel(slot, slot.default).ar})` } }
      : { means: null, label: { en: "Doesn't matter, skip", ar: 'مش فارقة، عدّي' } },
    step,
    why: whyAsked(plan),
  };
}

/** A short reason for the "how I decided" trace; never shown as a pick. */
function whyAsked(plan) {
  switch (plan.phase) {
    case 'always': return { code: 'core', en: 'A core question for this category.', ar: 'سؤال أساسي للنوع ده.' };
    case 'money': return { code: 'money', en: 'Needed to price offers for you.', ar: 'محتاجه عشان أحسب العروض ليك.' };
    case 'tiebreak': return { code: 'tiebreak', en: 'The top picks are very close.', ar: 'الترشيحات قريبة جداً من بعض.' };
    default: return { code: 'gain', en: 'Your answer changes the best pick or where to buy it.', ar: 'إجابتك بتغيّر أحسن ترشيح أو مكان الشراء.' };
  }
}

/**
 * The clarifying question payload (U6). Options carry no action (the session keeps those).
 * @param {import('./u6-consistency.js').Clarify} c
 * @param {{index: number, of: number}} step
 */
export function renderClarify(c, step) {
  return { id: c.id, type: c.type, label: c.question, options: c.options.map((o) => ({ id: o.id, label: o.label })), skippable: false, step };
}

/**
 * "Add a detail": every slot of the category, with its current value, so the buyer can set any factor that
 * was never asked (tech-spec 4.1). Manual slots (cod, shops, model in mind, ...) live only here and in text.
 * @param {any} config
 * @param {import('./state.js').SessionState} state
 * @param {{products?: any[], retailers?: any[]}} identity
 */
export function renderAddDetail(config, state, identity) {
  return {
    slots: config.slots.map((s) => {
      const v = state.values[s.id];
      let options;
      if (s.valueShape === 'shops') options = (identity.retailers || []).map((r) => ({ id: r.id, label: { en: r.name, ar: r.name } }));
      else if (s.valueShape === 'product') options = (identity.products || []).map((p) => ({ id: p.id, label: { en: p.name, ar: p.name } }));
      else options = s.options.map((o) => ({ id: o.id, label: o.label }));
      return {
        slot: s.id,
        group: s.group,
        label: s.label,
        question: s.question,
        multi: !!s.multi,
        numeric: s.numeric ? { unit: s.numeric.unit, min: s.numeric.min, max: s.numeric.max } : null,
        valueShape: s.valueShape || null,
        options,
        value: v ? v.value : null,
        source: v ? v.source : null,
        neverAsked: !!s.manual,
      };
    }),
  };
}
