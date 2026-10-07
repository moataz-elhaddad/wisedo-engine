// Wisedo admin panel: overview, configurations (priorities, answer effects, ranking, freshness, questions, season),
// impact preview, read-only catalog and version history. Runs inside the try-out page (route #admin).
// The engine is not touched: a configuration is a small set of overrides (src/params.js) that becomes a normal
// category config. A draft is saved as you type; "Publish" makes it the config buyers get in the try-out page.
import { match } from './src/layer2/index.js';
import { buildNeedProfile } from './src/profile/build.js';
import { PARAM_SPECS, PARAM_GROUPS, applyOverrides, listChanges, getPath, setPath, unsetPath, baseValue, paramsOf } from './src/params.js';
import { PERSONAS } from './src/personas.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso || ''; } };

const ADMIN_CSS = `
.adm { display: grid; grid-template-columns: 1fr; gap: 16px; min-width: 0; }
@media (min-width: 900px) { .adm { grid-template-columns: 220px 1fr; align-items: start; } }
.adm-nav { display: flex; gap: 8px; overflow-x: auto; padding-block: 2px; }
@media (min-width: 900px) { .adm-nav { flex-direction: column; overflow: visible; position: sticky; top: 16px; } }
.adm-tab { min-height: 44px; padding-inline: 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; font-weight: 500; white-space: nowrap; text-align: start; display: flex; align-items: center; gap: 8px; }
.adm-tab.on { background: var(--brand); color: var(--on-brand); border-color: var(--brand); }
.adm-tab .badge-n { margin-inline-start: auto; background: var(--value-soft); color: var(--value); border-radius: 999px; padding-inline: 8px; font-size: 12px; font-weight: 600; }
.adm-tab.on .badge-n { background: rgba(255,255,255,.2); color: #fff; }
.adm-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.adm-sub { display: flex; gap: 8px; flex-wrap: wrap; }
.adm-sub button { min-height: 36px; padding-inline: 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-solid); cursor: pointer; font-size: 14px; }
.adm-sub button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat { background: var(--surface-solid); border: 1px solid var(--line); border-radius: 16px; padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
.stat b { font-family: var(--f-display); font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat span { font-size: 13px; color: var(--muted); }
.prm { display: flex; flex-direction: column; gap: 6px; padding-block: 14px; border-top: 1px solid var(--line); }
.prm:first-of-type { border-top: 0; }
.prm-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.prm-top label { font-weight: 600; font-size: 15px; }
.prm .help { margin: 0; font-size: 13px; color: var(--muted); max-width: 62ch; }
.prm-ctl { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.prm-ctl input[type=range] { flex: 1 1 200px; min-width: 120px; accent-color: var(--brand); height: 32px; }
.numbox { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; padding-inline: 12px; border-radius: 12px; background: var(--sunk); border: 1px solid transparent; }
.numbox:focus-within { border-color: var(--text); background: var(--surface-solid); }
.numbox input { width: 72px; border: 0; background: none; outline: none; font-variant-numeric: tabular-nums; text-align: end; font-size: 15px; }
.numbox span { font-size: 13px; color: var(--muted); }
.mod { width: 8px; height: 8px; border-radius: 50%; background: var(--value); display: inline-block; }
.defv { font-size: 12px; color: var(--muted); }
.mini { min-height: 32px; padding-inline: 10px; font-size: 13px; background: none; border: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; color: var(--text); }
.mini[disabled] { opacity: .35; cursor: default; text-decoration: none; }
table.t { width: 100%; border-collapse: collapse; font-size: 14px; }
table.t th { text-align: start; font-size: 12px; color: var(--muted); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
table.t td { padding: 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
table.t tr.chg td { background: var(--value-soft); }
.tscroll { overflow-x: auto; max-width: 100%; }
.opt-row { display: flex; flex-direction: column; gap: 8px; padding-block: 12px; border-top: 1px solid var(--line); }
.opt-row:first-of-type { border-top: 0; }
.wchip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding-inline: 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--sunk); font-size: 13px; }
.wchip.mod { background: var(--value-soft); border-color: transparent; width: auto; height: auto; border-radius: 999px; }
.wchip input { width: 56px; border: 0; background: var(--surface-solid); border-radius: 8px; min-height: 28px; text-align: end; font-size: 14px; font-variant-numeric: tabular-nums; }
.wchip button { border: 0; background: none; cursor: pointer; width: 24px; height: 24px; border-radius: 50%; color: var(--muted); }
.wchip button:hover { background: rgba(23,33,30,.08); }
.status { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 16px; background: var(--surface-solid); border: 1px solid var(--line); }
.status .grow { flex: 1; min-width: 160px; }
.pill { display: inline-flex; align-items: center; min-height: 28px; padding-inline: 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
.pill.live { background: var(--good-soft); color: var(--good); }
.pill.draft { background: var(--value-soft); color: var(--value); }
.pill.def { background: var(--sunk); color: var(--muted); }
.diff-up { color: var(--good); font-weight: 600; }
.note-in { width: 100%; min-height: 72px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-solid); padding: 10px 12px; resize: vertical; }
.cmpcell { font-size: 13px; }
.cmpcell b { display: block; font-weight: 600; font-size: 14px; }
.hist { padding-block: 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.hist:first-of-type { border-top: 0; }
.srch { min-height: 44px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-solid); padding-inline: 14px; width: 100%; max-width: 360px; }
.sel { min-height: 40px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-solid); padding-inline: 10px; max-width: 100%; }
.stale { color: var(--danger); font-weight: 600; }
`;

const GROUP_LIST = [
  { id: 'priorities', label: 'Priorities' },
  { id: 'needs', label: 'What answers add' },
  ...PARAM_GROUPS.map((g) => ({ id: g.id, label: g.label })),
  { id: 'impact', label: 'Impact preview' },
];

// ---------- engine helpers ----------
function snapshotFor(env, config) {
  return { snapshot_id: env.data.manifest.snapshot_id, tenant_id: env.data.manifest.tenant_id, configs: { mobile: config }, products: env.data.products, retailers: env.data.retailers, offers: env.data.offers, plans: env.data.plans };
}

function personaProfile(config, answers, over) {
  const p = buildNeedProfile(config, answers);
  for (const k of ['money', 'logistics', 'shops', 'derived']) if (over && over[k]) p[k] = { ...p[k], ...over[k] };
  for (const k of Object.keys(over || {})) if (!['money', 'logistics', 'shops', 'derived'].includes(k)) p[k] = over[k];
  return p;
}

function runPersonas(env, overrides) {
  const { config } = applyOverrides(env.baseConfig, overrides);
  const snap = snapshotFor(env, config);
  return PERSONAS.map(([title, answers, over]) => {
    try {
      const r = match(personaProfile(config, answers, over), snap, env.data.manifest.now, 'rank');
      return { title, picks: r.picks, nothing: r.status !== 'ok' && !r.picks.length, nothingFits: r.nothingFits, status: r.status };
    } catch (e) { return { title, error: String(e.message || e), picks: [] }; }
  });
}

// ---------- the admin app ----------
export function mountAdmin(root, env) {
  const { store, baseConfig, data } = env;
  const attrs = baseConfig.attributes.filter((a) => a.id in baseConfig.baseWeights);
  const attrLabel = (id) => (baseConfig.attributes.find((a) => a.id === id) || { label: { en: id } }).label.en;
  const retailerName = (id) => (data.retailers.find((r) => r.id === id) || {}).name || id;
  const effSlots = baseConfig.slots.filter((s) => (s.options || []).some((o) => o.effects && o.effects.weights));

  // working copy of the overrides: the draft if there is one, else what is published
  const start = store.draft && store.draft.overrides ? store.draft.overrides : store.published ? store.published.overrides : {};
  const A = {
    tab: 'overview', cfgTab: 'priorities', ov: structuredClone(start || {}), needSlot: effSlots[0] ? effSlots[0].id : null,
    review: false, note: '', msg: null, saving: null, catQuery: '', openProduct: null, impactBase: 'published', histOpen: null, error: null,
  };
  if (!document.getElementById('adm-css')) { const st = document.createElement('style'); st.id = 'adm-css'; st.textContent = ADMIN_CSS; document.head.appendChild(st); }

  // --- derived views
  const clean = (ov) => applyOverrides(baseConfig, ov);
  const draftClean = () => clean(A.ov).overrides;
  const publishedClean = () => clean(store.liveOverrides).overrides;
  const countChanges = (ov) => listChanges(ov, baseConfig).length;
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isDirty = () => !sameJson(draftClean(), publishedClean());

  /** Changes of the draft against what is published: {label, from, to}. */
  function diffAgainstPublished() {
    const d = new Map(listChanges(draftClean(), baseConfig).map((r) => [r.key, r]));
    const p = new Map(listChanges(publishedClean(), baseConfig).map((r) => [r.key, r]));
    const rows = [];
    for (const key of new Set([...d.keys(), ...p.keys()])) {
      const dr = d.get(key), pr = p.get(key);
      const to = dr ? dr.to : pr.from;
      const from = pr ? pr.to : dr.from;
      if (to !== from) rows.push({ key, label: (dr || pr).label, from, to });
    }
    return rows;
  }

  // --- display helpers
  const specFor = (path) => PARAM_SPECS.find((s) => s.path === path);
  const curVal = (spec) => { const v = getPath(A.ov, spec.path); return v === undefined ? baseValue(spec, baseConfig) : v; };
  const isMod = (spec) => { const v = getPath(A.ov, spec.path); return v !== undefined && v !== baseValue(spec, baseConfig); };
  const toUi = (spec, v) => (spec.kind === 'share' ? Math.round(v * 10000) / 100 : v);
  const fromUi = (spec, u) => (spec.kind === 'share' ? Math.round(u * 100) / 10000 : u);
  const unitOf = (spec) => ({ share: '%', hours: 'h', days: 'days', points: 'pts' }[spec.kind] || '');
  const showVal = (spec, v) => `${nf.format(toUi(spec, v))}${unitOf(spec) === '%' ? '%' : unitOf(spec) ? ' ' + unitOf(spec) : ''}`;
  const uiStep = (spec) => (spec.kind === 'share' ? Math.max(0.5, Math.round(spec.step * 10000) / 100) : spec.step);

  let saveTimer = null;
  function scheduleSave() {
    A.saving = 'Saving draft…';
    refreshStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await store.saveDraft(draftClean()); A.saving = `Draft saved ${store.mode === 'shared' ? '(shared)' : '(this browser only)'}`; }
      catch (e) { A.saving = `Could not save the draft (${(e && e.code) || 'error'}). It stays on this page until you leave.`; }
      refreshStatus();
    }, 700);
  }

  // --- render
  function nav() {
    const tabs = [['overview', 'Overview'], ['config', 'Configurations'], ['catalog', 'Catalog'], ['history', 'History']];
    const n = countChanges(draftClean());
    return `<nav class="adm-nav" aria-label="Admin">${tabs.map(([id, l]) => `<button class="adm-tab ${A.tab === id ? 'on' : ''}" data-a="tab" data-id="${id}">${l}${id === 'config' && isDirty() ? '<span class="badge-n">draft</span>' : id === 'config' && n ? `<span class="badge-n">${n}</span>` : ''}</button>`).join('')}</nav>`;
  }

  function statusBar() {
    const pub = store.published;
    const dirty = isDirty();
    const n = diffAgainstPublished().length;
    return `<div class="status" id="adm-status">
      <span class="pill ${pub ? 'live' : 'def'}">${pub ? `Live: version ${pub.version}` : 'Live: built-in defaults'}</span>
      ${dirty ? `<span class="pill draft">Draft: ${n} unpublished change${n === 1 ? '' : 's'}</span>` : '<span class="meta">No unpublished changes</span>'}
      <span class="meta grow" id="adm-saving">${esc(A.saving || '')}</span>
      <button class="btn secondary" data-a="trydraft" ${dirty ? '' : 'disabled'}>Try the draft</button>
      <button class="btn secondary" data-a="discard" ${dirty ? '' : 'disabled'}>Discard changes</button>
      <button class="btn" data-a="review" ${dirty ? '' : 'disabled'}>Review and publish</button>
    </div>`;
  }

  function refreshStatus() {
    const el = document.getElementById('adm-status');
    if (el) { const tmp = document.createElement('div'); tmp.innerHTML = statusBar(); el.replaceWith(tmp.firstElementChild); }
    const navEl = root.querySelector('.adm-nav');
    if (navEl) { const tmp = document.createElement('div'); tmp.innerHTML = nav(); navEl.replaceWith(tmp.firstElementChild); }
  }

  function render() {
    root.innerHTML = `<div class="adm">${nav()}<div class="adm-main">${A.msg ? `<div class="tip ${A.msg.kind || 'good'}" role="status"><div><b>${esc(A.msg.title)}</b>${A.msg.text ? `<p>${esc(A.msg.text)}</p>` : ''}</div></div>` : ''}${page()}</div></div>`;
  }

  function page() {
    switch (A.tab) {
      case 'config': return configPage();
      case 'catalog': return catalogPage();
      case 'history': return historyPage();
      default: return overviewPage();
    }
  }

  // ----- overview
  function overviewPage() {
    const now = Date.parse(data.manifest.now);
    const fr = paramsOf(applyOverrides(baseConfig, store.liveOverrides).config);
    const cfg = applyOverrides(baseConfig, store.liveOverrides).config;
    const staleOffers = data.offers.filter((o) => now - Date.parse(o.checked_at) > cfg.freshness.priceStockHours * 3600e3).length;
    const outOfStock = data.offers.filter((o) => o.in_stock === false).length;
    const stalePlans = data.plans.filter((p) => now - Date.parse(p.checked_at) > cfg.freshness.plansDays * 86400e3).length;
    const pub = store.published;
    const recent = store.history.slice(0, 5);
    return `<section class="card"><h1 class="h-section">Overview</h1>
      <div class="stats">
        <div class="stat"><b>${data.products.length}</b><span>Phones</span></div>
        <div class="stat"><b>${data.retailers.length}</b><span>Shops</span></div>
        <div class="stat"><b>${data.offers.length}</b><span>Offers</span></div>
        <div class="stat"><b>${data.plans.length}</b><span>Installment plans</span></div>
      </div>
      <div class="tip note"><div><b>Sample data</b><p>${esc(data.manifest.note)}</p></div></div>
    </section>
    <section class="card"><h2 class="h-section">Engine configuration</h2>
      ${statusBar()}
      <p class="meta" style="margin:0">${pub ? `Version ${pub.version} was published ${esc(fmtDate(pub.at))} by ${esc(pub.by)}${pub.note ? `: "${esc(pub.note)}"` : ''}. ${pub.changes} value${pub.changes === 1 ? '' : 's'} differ from the built-in defaults.` : 'Nothing has been published yet, so buyers get the built-in defaults.'}</p>
      <p class="meta" style="margin:0">Stored in: ${store.mode === 'shared' ? 'the shared page database (everyone with access sees the same live configuration)' : 'this browser only (the shared database is not available to this viewer)'}.</p>
      <div class="row"><button class="btn" data-a="tab" data-id="config">Open configurations</button></div>
    </section>
    <section class="card"><h2 class="h-section">Data health</h2>
      <div class="stats">
        <div class="stat"><b class="${staleOffers ? 'stale' : ''}">${staleOffers}</b><span>Offers older than ${cfg.freshness.priceStockHours} h (ignored)</span></div>
        <div class="stat"><b>${outOfStock}</b><span>Offers out of stock</span></div>
        <div class="stat"><b class="${stalePlans ? 'stale' : ''}">${stalePlans}</b><span>Plans older than ${cfg.freshness.plansDays} days (skipped)</span></div>
        <div class="stat"><b>${fr.maxPicks}</b><span>Picks shown per buyer</span></div>
      </div>
      <p class="meta" style="margin:0">Counted against the live freshness limits, as of ${esc(fmtDate(data.manifest.now))}.</p>
    </section>
    <section class="card"><h2 class="h-section">Recent changes</h2>
      ${recent.length ? recent.map((h) => `<div class="hist"><div class="row"><b>Version ${h.version}</b><span class="meta">${esc(fmtDate(h.at))} by ${esc(h.by)}</span></div>${h.note ? `<span>${esc(h.note)}</span>` : ''}</div>`).join('') : '<p class="meta" style="margin:0">No published versions yet.</p>'}
    </section>`;
  }

  // ----- configurations
  function configPage() {
    const subs = GROUP_LIST.map((g) => `<button class="${A.cfgTab === g.id ? 'on' : ''}" data-a="cfgtab" data-id="${g.id}">${esc(g.label)}</button>`).join('');
    let body = '';
    if (A.cfgTab === 'priorities') body = prioritiesBody();
    else if (A.cfgTab === 'needs') body = needsBody();
    else if (A.cfgTab === 'impact') body = impactBody();
    else body = groupBody(A.cfgTab);
    return `<section class="card"><h1 class="h-section">Configurations</h1>
      <p class="meta" style="margin:0">Change how the engine ranks, what it asks and how fresh data must be. Changes are saved as a draft as you type and reach buyers only when you publish. Every control shows its built-in default.</p>
      ${statusBar()}
      ${A.review ? reviewPanel() : ''}
      <div class="adm-sub" role="tablist">${subs}</div>
      <div id="cfg-body">${body}</div>
    </section>`;
  }

  function slider(spec) {
    const v = curVal(spec);
    const mod = isMod(spec);
    return `<div class="prm" data-path="${esc(spec.path)}">
      <div class="prm-top"><label for="n-${esc(spec.path)}">${esc(spec.label)}</label>${mod ? '<span class="mod" title="Changed from the default"></span>' : '<span class="mod" hidden></span>'}<span class="grow"></span><button class="mini" data-a="resetp" data-path="${esc(spec.path)}" ${mod ? '' : 'disabled'}>Reset</button></div>
      <p class="help">${esc(spec.help)}</p>
      <div class="prm-ctl">
        <input type="range" data-a="range" data-path="${esc(spec.path)}" min="${toUi(spec, spec.min)}" max="${toUi(spec, spec.max)}" step="${uiStep(spec)}" value="${toUi(spec, v)}" aria-label="${esc(spec.label)}">
        <span class="numbox"><input id="n-${esc(spec.path)}" type="number" inputmode="decimal" data-a="num" data-path="${esc(spec.path)}" min="${toUi(spec, spec.min)}" max="${toUi(spec, spec.max)}" step="${uiStep(spec)}" value="${toUi(spec, v)}"><span>${unitOf(spec)}</span></span>
        <span class="defv">Default ${esc(showVal(spec, baseValue(spec, baseConfig)))}</span>
      </div></div>`;
  }

  function groupBody(id) {
    const g = PARAM_GROUPS.find((x) => x.id === id);
    const specs = PARAM_SPECS.filter((s) => s.group === id);
    return `<p class="meta" style="margin:0">${esc(g ? g.help : '')}</p>${specs.map(slider).join('')}`;
  }

  function weightRow(attrId) {
    const base = baseConfig.baseWeights[attrId];
    const raw = getPath(A.ov, `baseWeights.${attrId}`);
    const v = raw === undefined ? base : raw;
    const mod = v !== base;
    return `<div class="prm" data-wattr="${esc(attrId)}">
      <div class="prm-top"><label for="w-${esc(attrId)}">${esc(attrLabel(attrId))}</label>${mod ? '<span class="mod"></span>' : '<span class="mod" hidden></span>'}<span class="grow"></span><button class="mini" data-a="resetw" data-attr="${esc(attrId)}" ${mod ? '' : 'disabled'}>Reset</button></div>
      <div class="prm-ctl">
        <input type="range" data-a="wrange" data-attr="${esc(attrId)}" min="0" max="3" step="0.1" value="${v}" aria-label="${esc(attrLabel(attrId))}">
        <span class="numbox"><input id="w-${esc(attrId)}" type="number" inputmode="decimal" data-a="wnum" data-attr="${esc(attrId)}" min="0" max="3" step="0.1" value="${v}"></span>
        <span class="defv">Default ${base}</span>
      </div></div>`;
  }

  function prioritiesBody() {
    return `<p class="meta" style="margin:0">Every buyer starts with these weights. A higher weight makes that spec count for more when phones are compared. A weight of 0 ignores it. The buyer's answers then add to these (see "What answers add").</p>
      ${attrs.map((a) => weightRow(a.id)).join('')}`;
  }

  function optWeights(slotId, opt) {
    const raw = getPath(A.ov, `effects.${slotId}.${opt.id}`);
    return raw !== undefined ? raw : ((opt.effects && opt.effects.weights) || {});
  }

  function needsBody() {
    const slot = baseConfig.slots.find((s) => s.id === A.needSlot) || effSlots[0];
    const picker = `<label class="meta" for="need-slot">Question</label><select class="sel" id="need-slot" data-a="needslot">${effSlots.map((s) => `<option value="${esc(s.id)}" ${s.id === slot.id ? 'selected' : ''}>${esc(s.label.en)}</option>`).join('')}</select>`;
    const rows = slot.options.map((o) => {
      const w = optWeights(slot.id, o);
      const baseW = (o.effects && o.effects.weights) || {};
      const changed = JSON.stringify(Object.entries(w).filter(([, v]) => v !== 0).sort()) !== JSON.stringify(Object.entries(baseW).sort());
      const free = attrs.filter((a) => !(a.id in w));
      return `<div class="opt-row" data-slot="${esc(slot.id)}" data-opt="${esc(o.id)}">
        <div class="prm-top"><label>${esc(o.label.en)}</label>${changed ? '<span class="mod"></span>' : ''}<span class="grow"></span><button class="mini" data-a="resetopt" data-slot="${esc(slot.id)}" data-opt="${esc(o.id)}" ${changed ? '' : 'disabled'}>Reset</button></div>
        <div class="row">${Object.entries(w).map(([a, v]) => `<span class="wchip ${(baseW[a] || 0) !== v ? 'mod' : ''}">${esc(attrLabel(a))}<input type="number" step="0.1" min="-3" max="3" value="${v}" data-a="effnum" data-slot="${esc(slot.id)}" data-opt="${esc(o.id)}" data-attr="${esc(a)}" aria-label="${esc(attrLabel(a))} weight"><button data-a="effdel" data-slot="${esc(slot.id)}" data-opt="${esc(o.id)}" data-attr="${esc(a)}" aria-label="Remove">×</button></span>`).join('') || '<span class="meta">Adds nothing</span>'}
        ${free.length ? `<select class="sel" data-a="effadd" data-slot="${esc(slot.id)}" data-opt="${esc(o.id)}" aria-label="Add a priority"><option value="">+ add</option>${free.map((a) => `<option value="${esc(a.id)}">${esc(a.label.en)}</option>`).join('')}</select>` : ''}</div>
      </div>`;
    }).join('');
    return `<p class="meta" style="margin:0">When a buyer picks an answer, these amounts are added to the base priorities. Example: choosing "Gaming" adds +1 to Performance. Negative numbers lower a priority.</p>
      <div class="row">${picker}</div>${rows}`;
  }

  // ----- impact preview
  function cellFor(r) {
    if (!r) return '';
    if (r.error) return `<span class="stale">${esc(r.error)}</span>`;
    const p = r.picks[0];
    if (!p) return `<div class="cmpcell"><b>Nothing fits</b>${r.nothingFits ? esc(r.nothingFits.product.name) : ''}</div>`;
    const more = r.picks.slice(1).map((x) => x.product.name).join(' · ');
    return `<div class="cmpcell"><b>${esc(p.product.name)}</b>${esc(p.quote.retailerName)} · ${nf.format(p.quote.price)} EGP${more ? `<br><span class="meta">${esc(more)}</span>` : ''}</div>`;
  }

  function impactBody() {
    const before = runPersonas(env, A.impactBase === 'default' ? {} : store.liveOverrides);
    const after = runPersonas(env, A.ov);
    const key = (r) => (r.picks[0] ? `${r.picks[0].product.id}@${r.picks[0].quote.retailerId}` : 'none');
    const topKey = (r) => (r.picks[0] ? r.picks[0].product.id : 'none');
    const listKey = (r) => r.picks.map((p) => p.product.id).join(',');
    let changedTop = 0, changedList = 0;
    const rows = before.map((b, i) => {
      const a = after[i];
      const topChanged = topKey(b) !== topKey(a);
      const anyChanged = listKey(b) !== listKey(a) || key(b) !== key(a);
      if (topChanged) changedTop++;
      if (anyChanged) changedList++;
      return `<tr class="${anyChanged ? 'chg' : ''}"><td>${esc(b.title)}</td><td>${cellFor(b)}</td><td>${cellFor(a)}</td><td>${topChanged ? '<b>New best match</b>' : anyChanged ? 'Shop or other picks changed' : 'Same'}</td></tr>`;
    }).join('');
    return `<p class="meta" style="margin:0">Runs ${PERSONAS.length} sample buyers through the engine with your draft and compares with ${A.impactBase === 'default' ? 'the built-in defaults' : 'the live configuration'}. Use it before publishing: if a change moves many buyers, that is a big change.</p>
      <div class="row"><label class="meta" for="imp-base">Compare with</label><select class="sel" id="imp-base" data-a="impbase"><option value="published" ${A.impactBase === 'published' ? 'selected' : ''}>Live configuration</option><option value="default" ${A.impactBase === 'default' ? 'selected' : ''}>Built-in defaults</option></select></div>
      <div class="stats"><div class="stat"><b>${changedTop}</b><span>of ${PERSONAS.length} buyers get a new best match</span></div><div class="stat"><b>${changedList}</b><span>of ${PERSONAS.length} see any difference</span></div></div>
      <div class="tscroll"><table class="t"><thead><tr><th>Buyer</th><th>Before</th><th>After (your draft)</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ----- review and publish
  function reviewPanel() {
    const rows = diffAgainstPublished();
    const { problems } = clean(A.ov);
    const specLookup = new Map(PARAM_SPECS.map((s) => [s.path, s]));
    const fmt = (key, v) => { const s = specLookup.get(key); return s ? showVal(s, v) : String(v); };
    return `<div class="card inner" style="gap:12px" id="review">
      <h2 class="h-section">Review before publishing</h2>
      ${problems.length ? `<div class="tip warn"><div><b>Adjusted</b>${problems.map((p) => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}
      ${rows.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Setting</th><th>Live now</th><th>New</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(fmt(r.key, r.from))}</td><td class="diff-up">${esc(fmt(r.key, r.to))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="meta">Nothing differs from the live configuration.</p>'}
      <label class="meta" for="pub-note">What changed and why (kept in the history)</label>
      <textarea id="pub-note" class="note-in" maxlength="300" data-a="note" placeholder="e.g. Camera matters more for photo buyers after reviewer feedback">${esc(A.note)}</textarea>
      <div class="row"><button class="btn" data-a="publish" ${rows.length ? '' : 'disabled'}>Publish as version ${((store.history[0] && store.history[0].version) || (store.published && store.published.version) || 0) + 1}</button><button class="btn secondary" data-a="cancelreview">Cancel</button><button class="link" data-a="cfgtab" data-id="impact">See impact on sample buyers</button></div>
    </div>`;
  }

  // ----- catalog
  function catalogPage() {
    const q = A.catQuery.trim().toLowerCase();
    const now = Date.parse(data.manifest.now);
    const cfg = applyOverrides(baseConfig, store.liveOverrides).config;
    const offersBy = new Map();
    for (const o of data.offers) { if (!offersBy.has(o.product_id)) offersBy.set(o.product_id, []); offersBy.get(o.product_id).push(o); }
    const prods = data.products.filter((p) => !q || `${p.name} ${p.brand} ${p.id}`.toLowerCase().includes(q));
    const rows = prods.map((p) => {
      const os = offersBy.get(p.id) || [];
      const best = os.filter((o) => o.in_stock !== false).reduce((m, o) => (m === null || o.price_egp < m ? o.price_egp : m), null);
      const open = A.openProduct === p.id;
      const detail = open ? `<tr><td colspan="6"><div class="tscroll"><table class="t"><thead><tr><th>Shop</th><th>Price</th><th>Stock</th><th>Warranty</th><th>Checked</th></tr></thead><tbody>${os.map((o) => {
        const age = Math.round((now - Date.parse(o.checked_at)) / 3600e3);
        const stale = age > cfg.freshness.priceStockHours;
        return `<tr><td>${esc(retailerName(o.retailer_id))}</td><td>${nf.format(o.price_egp)} EGP</td><td>${o.in_stock === false ? '<span class="stale">Out</span>' : 'In stock'}</td><td>${o.official ? 'Official' : 'Imported'}</td><td class="${stale ? 'stale' : ''}">${age} h ago${stale ? ' (ignored)' : ''}</td></tr>`;
      }).join('')}</tbody></table></div></td></tr>` : '';
      return `<tr><td><button class="mini" style="text-align:start" data-a="openprod" data-id="${esc(p.id)}">${esc(p.name)}</button></td><td>${esc(p.brand)}</td><td>${nf.format(p.ref_price_egp)}</td><td>${os.length}</td><td>${best == null ? '-' : nf.format(best)}</td><td>${p.popular ? 'Popular' : ''}</td></tr>${detail}`;
    }).join('');
    return `<section class="card"><h1 class="h-section">Catalog</h1>
      <p class="meta" style="margin:0">Read only for now. The catalog is sample data; editing and importing a real catalog comes with the ingestion step.</p>
      <input class="srch" type="search" placeholder="Search phones" value="${esc(A.catQuery)}" data-a="catq" aria-label="Search phones">
      <div class="tscroll"><table class="t"><thead><tr><th>Phone</th><th>Brand</th><th>Reference price (EGP)</th><th>Offers</th><th>Best in-stock price</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="meta">No phones match.</td></tr>'}</tbody></table></div>
      <h2 class="h-section">Shops</h2>
      <div class="tscroll"><table class="t"><thead><tr><th>Shop</th><th>Trust (1 to 10)</th><th>Returns (days)</th><th>Cash on delivery</th></tr></thead><tbody>${data.retailers.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.trust}</td><td>${r.return_days}</td><td>${r.cod ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  }

  // ----- history
  function historyPage() {
    const list = store.history;
    return `<section class="card"><h1 class="h-section">History</h1>
      <p class="meta" style="margin:0">Every published version. "Use as draft" loads an older version into the draft so you can review it and publish it again.</p>
      ${list.length ? list.map((h) => {
        const open = A.histOpen === h.version;
        const rows = open ? listChanges(h.overrides, baseConfig) : [];
        const isLive = store.published && store.published.version === h.version;
        return `<div class="hist"><div class="row"><b>Version ${h.version}</b>${isLive ? '<span class="pill live">Live</span>' : ''}<span class="meta">${esc(fmtDate(h.at))} by ${esc(h.by)} · ${h.changes} value${h.changes === 1 ? '' : 's'} changed from defaults</span></div>
          ${h.note ? `<span>${esc(h.note)}</span>` : ''}
          <div class="row"><button class="mini" data-a="histopen" data-v="${h.version}">${open ? 'Hide values' : 'Show values'}</button><button class="mini" data-a="usedraft" data-v="${h.version}">Use as draft</button></div>
          ${open ? `<div class="tscroll"><table class="t"><thead><tr><th>Setting</th><th>Default</th><th>Value</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.from)}</td><td>${esc(r.to)}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">All defaults</td></tr>'}</tbody></table></div>` : ''}</div>`;
      }).join('') : '<p class="meta" style="margin:0">Nothing has been published yet.</p>'}
      <div class="row"><button class="btn secondary" data-a="loaddefaults">Start a draft from the built-in defaults</button></div>
    </section>`;
  }

  // ---------- events
  function setParam(path, uiVal) {
    const spec = specFor(path);
    if (!spec || !Number.isFinite(uiVal)) return;
    const v = Math.max(spec.min, Math.min(spec.max, fromUi(spec, uiVal)));
    setPath(A.ov, path, v);
  }
  function syncParamRow(path) {
    const row = root.querySelector(`.prm[data-path="${CSS.escape(path)}"]`);
    if (!row) return;
    const spec = specFor(path);
    const v = curVal(spec);
    const rg = row.querySelector('input[type=range]'), nm = row.querySelector('input[type=number]');
    if (rg && document.activeElement !== rg) rg.value = toUi(spec, v);
    if (nm && document.activeElement !== nm) nm.value = toUi(spec, v);
    row.querySelector('.mod').hidden = !isMod(spec);
    const rs = row.querySelector('[data-a="resetp"]'); if (rs) rs.disabled = !isMod(spec);
  }
  function setWeight(attr, v) {
    if (!Number.isFinite(v)) return;
    setPath(A.ov, `baseWeights.${attr}`, Math.max(0, Math.min(3, Math.round(v * 100) / 100)));
  }
  function syncWeightRow(attr) {
    const row = root.querySelector(`.prm[data-wattr="${CSS.escape(attr)}"]`);
    if (!row) return;
    const base = baseConfig.baseWeights[attr];
    const raw = getPath(A.ov, `baseWeights.${attr}`);
    const v = raw === undefined ? base : raw;
    const rg = row.querySelector('input[type=range]'), nm = row.querySelector('input[type=number]');
    if (rg && document.activeElement !== rg) rg.value = v;
    if (nm && document.activeElement !== nm) nm.value = v;
    row.querySelector('.mod').hidden = v === base;
    const rs = row.querySelector('[data-a="resetw"]'); if (rs) rs.disabled = v === base;
  }
  function setEffect(slotId, optId, weights) {
    setPath(A.ov, `effects.${slotId}.${optId}`, weights);
  }
  const slotOpt = (slotId, optId) => baseConfig.slots.find((s) => s.id === slotId).options.find((o) => o.id === optId);

  root.addEventListener('input', (e) => {
    const el = e.target; const a = el.dataset && el.dataset.a;
    if (!a) return;
    if (a === 'range' || a === 'num') { setParam(el.dataset.path, Number(el.value)); syncParamRow(el.dataset.path); scheduleSave(); }
    else if (a === 'wrange' || a === 'wnum') { setWeight(el.dataset.attr, Number(el.value)); syncWeightRow(el.dataset.attr); scheduleSave(); }
    else if (a === 'note') A.note = el.value;
    else if (a === 'catq') { A.catQuery = el.value; const pos = el.selectionStart; render(); const n = root.querySelector('[data-a="catq"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });

  root.addEventListener('change', (e) => {
    const el = e.target; const a = el.dataset && el.dataset.a;
    if (!a) return;
    if (a === 'needslot') { A.needSlot = el.value; render(); }
    else if (a === 'impbase') { A.impactBase = el.value; render(); }
    else if (a === 'effnum') {
      const { slot, opt, attr } = el.dataset;
      const w = { ...optWeights(slot, slotOpt(slot, opt)) };
      const v = Number(el.value);
      if (Number.isFinite(v)) { w[attr] = Math.max(-3, Math.min(3, Math.round(v * 100) / 100)); setEffect(slot, opt, w); scheduleSave(); render(); }
    } else if (a === 'effadd' && el.value) {
      const { slot, opt } = el.dataset;
      const w = { ...optWeights(slot, slotOpt(slot, opt)), [el.value]: 0.5 };
      setEffect(slot, opt, w); scheduleSave(); render();
    }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    const a = b.dataset.a; const d = b.dataset;
    if (['range', 'num', 'wrange', 'wnum', 'note', 'catq', 'needslot', 'impbase', 'effnum', 'effadd'].includes(a)) return;
    A.msg = null;
    switch (a) {
      case 'tab': A.tab = d.id; A.review = false; render(); break;
      case 'cfgtab': A.tab = 'config'; A.cfgTab = d.id; render(); break;
      case 'resetp': unsetPath(A.ov, d.path); scheduleSave(); render(); break;
      case 'resetw': unsetPath(A.ov, `baseWeights.${d.attr}`); scheduleSave(); render(); break;
      case 'resetopt': unsetPath(A.ov, `effects.${d.slot}.${d.opt}`); scheduleSave(); render(); break;
      case 'effdel': {
        const w = { ...optWeights(d.slot, slotOpt(d.slot, d.opt)) }; delete w[d.attr];
        setEffect(d.slot, d.opt, w); scheduleSave(); render(); break;
      }
      case 'review': A.review = true; A.tab = 'config'; render(); document.getElementById('review')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); break;
      case 'cancelreview': A.review = false; render(); break;
      case 'discard': {
        clearTimeout(saveTimer);
        A.ov = structuredClone(store.liveOverrides); A.review = false;
        try { await store.discardDraft(); } catch { /* ignore */ }
        A.saving = 'Draft discarded'; A.msg = { kind: 'note', title: 'Draft discarded', text: 'Back to the live configuration.' }; render(); break;
      }
      case 'publish': {
        clearTimeout(saveTimer);
        try {
          const rec = await store.publish(draftClean(), A.note);
          A.ov = structuredClone(rec.overrides); A.note = ''; A.review = false;
          try { await store.discardDraft(); } catch { /* ignore */ }
          A.saving = '';
          A.msg = { kind: 'good', title: `Version ${rec.version} is live`, text: 'Buyers in the try-out page now get this configuration.' };
        } catch (err) {
          A.msg = { kind: 'bad', title: 'Could not publish', text: `${(err && err.code) || 'error'}: ${(err && err.message) || ''} Your draft is still here.` };
        }
        render(); break;
      }
      case 'trydraft': env.onTry && env.onTry(draftClean()); break;
      case 'openprod': A.openProduct = A.openProduct === d.id ? null : d.id; render(); break;
      case 'histopen': A.histOpen = A.histOpen === Number(d.v) ? null : Number(d.v); render(); break;
      case 'usedraft': {
        const h = store.history.find((x) => x.version === Number(d.v));
        if (h) { A.ov = structuredClone(h.overrides); scheduleSave(); A.tab = 'config'; A.cfgTab = 'priorities'; A.msg = { kind: 'note', title: `Version ${h.version} loaded as a draft`, text: 'Review it and publish to make it live again.' }; render(); }
        break;
      }
      case 'loaddefaults': A.ov = {}; scheduleSave(); A.tab = 'config'; A.msg = { kind: 'note', title: 'Draft reset to the built-in defaults', text: 'Publish it to make the defaults live again.' }; render(); break;
      default: break;
    }
  });

  render();
  return { destroy() { clearTimeout(saveTimer); root.replaceChildren(); }, currentDraft: () => draftClean(), flush: () => store.saveDraft(draftClean()) };
}
