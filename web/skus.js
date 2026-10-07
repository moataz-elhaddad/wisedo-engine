// SKU catalog page: list, edit, add and delete the tenant's products and offers; CSV import and export.
// Talks to the Worker API (worker/index.js). Reads are public; writes need the admin token, kept in this tab only.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('en-US');
const money = (n) => (n === null || n === undefined ? '—' : `${nf.format(Math.round(n))} EGP`);

const S = {
  token: '',
  admin: false,
  cats: [],
  cat: 'laptop',
  rows: [],
  counts: {},
  retailers: [],
  q: '',
  edit: null, // {product, offers, isNew}
};

function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }
function ssSet(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* ignore */ } }
function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

class ApiError extends Error {
  constructor(status, body) { super((body && body.error) || `HTTP ${status}`); this.status = status; this.body = body; }
}

async function api(method, path, body, { csv = false } = {}) {
  const headers = {};
  if (S.token) headers.authorization = `Bearer ${S.token}`;
  if (body !== undefined) headers['content-type'] = csv ? 'text/csv' : 'application/json';
  const res = await fetch(`api/${path}`, { method, headers, body: body === undefined ? undefined : csv ? body : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3000);
}

function errorBox(e) {
  const list = e && e.body && Array.isArray(e.body.details) ? e.body.details : e && e.body && Array.isArray(e.body.errors) ? e.body.errors : [];
  return `<div class="errors"><strong>${esc(e.message)}</strong>${list.length ? `<ul>${list.slice(0, 30).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
}

const catDef = () => S.cats.find((c) => c.id === S.cat);

// ---------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------

function renderAuth() {
  const f = $('#auth');
  if (S.admin) {
    f.innerHTML = `<span class="pill good">Admin</span><button class="btn ghost small" type="button" id="logout">Sign out</button>`;
    $('#logout').onclick = () => { S.token = ''; S.admin = false; ssSet('wisedo.adminToken', ''); renderAuth(); renderAdminState(); };
  } else {
    f.innerHTML = `<input type="password" id="tok" placeholder="Admin token" aria-label="Admin token" autocomplete="off"><button class="btn small" type="submit">Sign in</button>`;
  }
}

async function signIn(token) {
  S.token = token.trim();
  try {
    await api('GET', 'admin/check');
    S.admin = true;
    ssSet('wisedo.adminToken', S.token);
  } catch (e) {
    S.admin = false;
    S.token = '';
    if (token) toast(e.status === 401 ? 'Wrong admin token' : e.message, true);
  }
  renderAuth();
  renderAdminState();
}

function renderAdminState() {
  for (const el of document.querySelectorAll('[data-admin]')) {
    el.disabled = !S.admin;
    el.title = S.admin ? '' : 'Sign in with the admin token to edit';
  }
  if (S.edit) renderDrawer();
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

function renderTabs() {
  $('#tabs').innerHTML = S.cats.map((c) => `<button class="tab" role="tab" aria-selected="${c.id === S.cat}" data-cat="${c.id}">${esc(c.label.en)}<span class="n">${S.counts[c.id] ?? ''}</span></button>`).join('');
  $('#export').href = `api/export.csv?category=${S.cat}`;
}

function keySpecs(p) {
  const defs = catDef().attributes;
  const pick = defs.filter((a) => ['ram_gb', 'storage_gb', 'screen_inches', 'size_inches', 'capacity_l', 'hp', 'cpu', 'os', 'resolution', 'panel', 'inverter', 'layout', 'type'].includes(a.id)).slice(0, 4);
  return pick.map((a) => {
    const v = (p.attrs || {})[a.id];
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? a.label.en : null;
    return `${a.label.en}: ${v}${a.unit && a.unit !== '/10' ? ` ${a.unit}` : a.unit === '/10' ? '/10' : ''}`;
  }).filter(Boolean).join(' · ');
}

function renderRows() {
  const q = S.q.toLowerCase();
  const rows = S.rows.filter((p) => !q || `${p.name} ${p.brand} ${p.id}`.toLowerCase().includes(q));
  const tb = $('#rows');
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="5" class="empty">${S.rows.length ? 'No SKU matches the search.' : 'No SKUs in this category yet.'}</td></tr>`; return; }
  tb.innerHTML = rows.map((p) => `
    <tr data-id="${esc(p.id)}">
      <td><div class="pname">${esc(p.name)}</div><div class="sub">${esc(p.brand)} · ${esc(p.id)}${p.popular ? ' · <span class="pill">popular</span>' : ''}</div></td>
      <td class="hide-sm sub">${esc(keySpecs(p))}</td>
      <td class="num hide-sm">${money(p.ref_price_egp)}</td>
      <td class="num">${money(p.min_price_egp)}</td>
      <td class="num">${p.offer_count ? `<span class="pill ${p.in_stock_offers ? 'good' : 'bad'}">${p.in_stock_offers}/${p.offer_count} in stock</span>` : '<span class="pill bad">none</span>'}</td>
    </tr>`).join('');
}

async function loadList() {
  try {
    S.rows = await api('GET', `skus?category=${S.cat}`);
    S.counts[S.cat] = S.rows.length;
    renderTabs();
    renderRows();
  } catch (e) {
    $('#rows').innerHTML = `<tr><td colspan="5">${errorBox(e)}</td></tr>`;
  }
}

async function loadCounts() {
  const all = await api('GET', 'skus');
  S.counts = {};
  for (const p of all) S.counts[p.category] = (S.counts[p.category] || 0) + 1;
  renderTabs();
}

// ---------------------------------------------------------------------------------------------
// Editor drawer
// ---------------------------------------------------------------------------------------------

async function openSku(id) {
  try {
    const d = await api('GET', `skus/${encodeURIComponent(id)}`);
    S.edit = { product: d.product, offers: d.offers, isNew: false, error: null, offerErrors: {} };
    renderDrawer();
    document.body.classList.add('open');
  } catch (e) { toast(e.message, true); }
}

function newSku() {
  S.edit = { product: { category: S.cat, brand: '', name: '', ref_price_egp: null, popular: false, aliases: [], attrs: {} }, offers: [], isNew: true, error: null, offerErrors: {} };
  renderDrawer();
  document.body.classList.add('open');
}

function closeDrawer() {
  document.body.classList.remove('open');
  S.edit = null;
}

function attrInput(a, v) {
  const name = `attr:${a.id}`;
  const dis = S.admin ? '' : 'disabled';
  if (a.type === 'boolean') {
    const val = v === true ? 'yes' : v === false ? 'no' : '';
    return `<select name="${name}" ${dis}><option value="" ${val === '' ? 'selected' : ''}>Unknown</option><option value="yes" ${val === 'yes' ? 'selected' : ''}>Yes</option><option value="no" ${val === 'no' ? 'selected' : ''}>No</option></select>`;
  }
  if (a.type === 'category' && a.values) {
    return `<select name="${name}" ${dis}><option value="">Unknown</option>${a.values.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  }
  if (a.type === 'number') {
    const range = a.basis ? `placeholder="${a.basis.min}–${a.basis.max}"` : '';
    return `<input type="number" step="any" name="${name}" value="${v ?? ''}" ${range} ${dis}>`;
  }
  return `<input type="text" name="${name}" value="${esc(v ?? '')}" ${dis}>`;
}

function offerCard(o, i) {
  const dis = S.admin ? '' : 'disabled';
  const zones = catDef().zones;
  const zl = { greater_cairo: 'Cairo', alexandria: 'Alex', other: 'Other' };
  const err = S.edit.offerErrors[i];
  return `
  <form class="offer" data-offer="${i}">
    ${err ? errorBox(err) : ''}
    <div class="grid">
      <label class="f">Retailer<select name="retailer_id" ${o.id && !o._new ? 'disabled' : dis}>${S.retailers.map((r) => `<option value="${esc(r.id)}" ${r.id === o.retailer_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <label class="f">Price (EGP)<input type="number" name="price_egp" min="1" step="any" value="${o.price_egp ?? ''}" ${dis} required></label>
      <label class="f">Link<input type="url" name="url" value="${esc(o.url || '')}" ${dis} required></label>
      <label class="check"><input type="checkbox" name="in_stock" ${o.in_stock ? 'checked' : ''} ${dis}> In stock</label>
      <label class="check"><input type="checkbox" name="official" ${o.official ? 'checked' : ''} ${dis}> Official warranty</label>
    </div>
    <div class="grid">
      ${zones.map((z) => `<label class="f">Delivery ${zl[z] || z} (fee / days)<span style="display:flex;gap:6px"><input type="number" min="0" name="fee:${z}" value="${(o.delivery && o.delivery[z] && o.delivery[z].fee) ?? 0}" ${dis} aria-label="${z} fee"><input type="number" min="0" name="days:${z}" value="${(o.delivery && o.delivery[z] && o.delivery[z].days) ?? 3}" ${dis} aria-label="${z} days"></span></label>`).join('')}
    </div>
    ${(o.extras || []).length ? `<div class="sub">Extras: ${o.extras.map((x) => `${esc(x.label || x.type)} (${money(x.value_egp)})`).join(', ')}</div>` : ''}
    <div class="row">
      <span class="sub" style="margin-right:auto">${o._new ? 'New offer' : esc(o.id)}</span>
      ${o._new ? '' : `<button type="button" class="btn danger small" data-del-offer="${i}" ${dis}>Delete</button>`}
      <button type="submit" class="btn small" ${dis}>${o._new ? 'Add offer' : 'Save offer'}</button>
    </div>
  </form>`;
}

function renderDrawer() {
  const e = S.edit;
  if (!e) return;
  const p = e.product;
  const dis = S.admin ? '' : 'disabled';
  const c = catDef();
  $('#drawer').innerHTML = `
    <div class="dhead">
      <h2>${e.isNew ? `New ${esc(c.label.en)} SKU` : esc(p.name)}</h2>
      <button class="btn ghost small" data-close>Close</button>
    </div>
    <div class="dbody">
      ${S.admin ? '' : '<div class="note">Read only. Sign in with the admin token to edit.</div>'}
      <form class="card section" id="pform">
        <h3>Product ${e.isNew ? '' : `<span class="sub">${esc(p.id)}</span>`}</h3>
        ${e.error ? errorBox(e.error) : ''}
        <div class="grid">
          <label class="f">Brand<input type="text" name="brand" value="${esc(p.brand)}" required ${dis}></label>
          <label class="f" style="grid-column: span 2">Name<input type="text" name="name" value="${esc(p.name)}" required ${dis}></label>
          <label class="f">Reference price (EGP)<input type="number" name="ref_price_egp" min="1" step="any" value="${p.ref_price_egp ?? ''}" ${dis}></label>
          <label class="f" style="grid-column: span 2">Other names (comma separated)<input type="text" name="aliases" value="${esc((p.aliases || []).join(', '))}" ${dis}></label>
          <label class="check"><input type="checkbox" name="popular" ${p.popular ? 'checked' : ''} ${dis}> Popular</label>
        </div>
        <h3 style="margin-top:16px">Specs <span class="sub">empty = unknown (shown to buyers as "not listed")</span></h3>
        <div class="grid">
          ${c.attributes.map((a) => `<label class="f"><span>${esc(a.label.en)}${a.unit ? ` <span class="u">(${esc(a.unit)})</span>` : ''}</span>${attrInput(a, (p.attrs || {})[a.id])}</label>`).join('')}
        </div>
        <div class="row" style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          ${e.isNew ? '' : `<button type="button" class="btn danger small" id="delSku" ${dis}>Delete SKU</button>`}
          <button type="submit" class="btn small" ${dis}>${e.isNew ? 'Create SKU' : 'Save product'}</button>
        </div>
      </form>
      ${e.isNew ? '' : `
      <div class="card section">
        <h3>Offers <span class="sub">${e.offers.length} retailer${e.offers.length === 1 ? '' : 's'}</span><span class="spacer"></span><button class="btn soft small" id="addOffer" ${dis}>Add offer</button></h3>
        ${e.offers.length ? e.offers.map(offerCard).join('') : '<p class="muted">No offers yet. A SKU without offers is never recommended.</p>'}
      </div>`}
    </div>`;
}

function readProductForm(form) {
  const fd = new FormData(form);
  const c = catDef();
  const attrs = {};
  for (const a of c.attributes) {
    const raw = String(fd.get(`attr:${a.id}`) ?? '').trim();
    if (raw === '') continue;
    if (a.type === 'number') attrs[a.id] = Number(raw);
    else if (a.type === 'boolean') attrs[a.id] = raw === 'yes';
    else attrs[a.id] = raw;
  }
  const ref = String(fd.get('ref_price_egp') || '').trim();
  return {
    category: S.cat,
    brand: String(fd.get('brand') || '').trim(),
    name: String(fd.get('name') || '').trim(),
    ref_price_egp: ref ? Number(ref) : null,
    popular: fd.get('popular') === 'on',
    aliases: String(fd.get('aliases') || '').split(',').map((x) => x.trim()).filter(Boolean),
    attrs,
  };
}

function readOfferForm(form, prev) {
  const fd = new FormData(form);
  const delivery = {};
  for (const z of catDef().zones) delivery[z] = { fee: Number(fd.get(`fee:${z}`) || 0), days: Number(fd.get(`days:${z}`) || 0) };
  const o = {
    price_egp: Number(fd.get('price_egp')),
    url: String(fd.get('url') || '').trim(),
    in_stock: fd.get('in_stock') === 'on',
    official: fd.get('official') === 'on',
    delivery,
  };
  if (prev._new) { o.product_id = S.edit.product.id; o.retailer_id = String(fd.get('retailer_id')); }
  return o;
}

async function saveProduct(form) {
  const e = S.edit;
  const body = readProductForm(form);
  try {
    const p = e.isNew ? await api('POST', 'skus', body) : await api('PUT', `skus/${encodeURIComponent(e.product.id)}`, body);
    toast(e.isNew ? 'SKU created. Add at least one offer so it can be recommended.' : 'Product saved');
    S.edit = { product: p, offers: e.offers, isNew: false, error: null, offerErrors: {} };
    renderDrawer();
    loadList();
  } catch (err) { e.error = err; renderDrawer(); }
}

async function saveOffer(form, i) {
  const e = S.edit;
  const prev = e.offers[i];
  const body = readOfferForm(form, prev);
  try {
    const o = prev._new ? await api('POST', 'offers', body) : await api('PUT', `offers/${encodeURIComponent(prev.id)}`, body);
    e.offers[i] = o;
    delete e.offerErrors[i];
    toast(prev._new ? 'Offer added' : 'Offer saved');
    renderDrawer();
    loadList();
  } catch (err) { e.offerErrors[i] = err; renderDrawer(); }
}

// ---------------------------------------------------------------------------------------------
// Dialogs: confirm, import
// ---------------------------------------------------------------------------------------------

function confirmDlg(title, text, okLabel = 'Confirm', danger = true) {
  const d = $('#dlg');
  d.innerHTML = `<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" value="cancel">Cancel</button><button class="btn ${danger ? 'danger' : ''}" value="ok">${esc(okLabel)}</button></div>`;
  return new Promise((resolve) => {
    d.onclick = (ev) => { const b = ev.target.closest('button'); if (b) { d.close(); resolve(b.value === 'ok'); } };
    d.oncancel = () => resolve(false);
    d.showModal();
  });
}

async function importFile(file) {
  const text = await file.text();
  const d = $('#dlg');
  const show = (html) => { d.innerHTML = html; if (!d.open) d.showModal(); };
  show(`<h3>Import ${esc(file.name)}</h3><p class="muted">Checking the file…</p>`);
  let res;
  try { res = await api('POST', `import?category=${S.cat}&dry_run=1`, text, { csv: true }); }
  catch (e) {
    show(`<h3>Import ${esc(file.name)}</h3>${errorBox({ message: e.body && e.body.error_count ? `${e.body.error_count} problem(s) found. Nothing was imported.` : e.message, body: e.body })}<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn" value="x">Close</button></div>`);
    d.onclick = (ev) => { if (ev.target.closest('button')) d.close(); };
    return;
  }
  show(`<h3>Import ${esc(file.name)}</h3>
    <p>${res.rows} rows checked for ${esc(catDef().label.en)}.</p>
    <ul><li>Products: ${res.products.created} new, ${res.products.updated} updated</li><li>Offers: ${res.offers.created} new, ${res.offers.updated} updated</li></ul>
    <p class="muted">Rows not in the file stay as they are.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" value="cancel">Cancel</button><button class="btn" value="ok">Import</button></div>`);
  d.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.value !== 'ok') { d.close(); return; }
    b.disabled = true;
    try {
      const r = await api('POST', `import?category=${S.cat}`, text, { csv: true });
      d.close();
      toast(`Imported: ${r.products.created + r.products.updated} products, ${r.offers.created + r.offers.updated} offers`);
      await loadCounts();
      loadList();
    } catch (e) { d.close(); toast(e.message, true); }
  };
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

document.addEventListener('click', async (ev) => {
  const t = ev.target;
  const tab = t.closest('[data-cat]');
  if (tab) { S.cat = tab.dataset.cat; lsSet('wisedo.skuCat', S.cat); renderTabs(); $('#rows').innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>'; loadList(); return; }
  const row = t.closest('tbody tr[data-id]');
  if (row) { openSku(row.dataset.id); return; }
  if (t.closest('[data-close]')) { closeDrawer(); return; }
  if (t.closest('#add')) { newSku(); return; }
  if (t.closest('#importBtn')) { $('#file').click(); return; }
  if (t.closest('#reset')) {
    if (await confirmDlg('Reset to sample data?', 'Every SKU, offer, retailer and plan of this tenant is replaced with the original sample data. Your edits are lost.', 'Reset')) {
      try { const r = await api('POST', 'admin/reset'); toast(`Reset: ${r.loaded.products} SKUs, ${r.loaded.offers} offers`); await loadCounts(); loadList(); }
      catch (e) { toast(e.message, true); }
    }
    return;
  }
  if (t.closest('#addOffer')) {
    const used = new Set(S.edit.offers.map((o) => o.retailer_id));
    const r = S.retailers.find((x) => !used.has(x.id)) || S.retailers[0];
    S.edit.offers.push({ _new: true, retailer_id: r && r.id, price_egp: S.edit.product.ref_price_egp, url: r && r.base_url ? `${r.base_url}/p/${S.edit.product.id}` : '', in_stock: true, official: true, extras: [] });
    renderDrawer();
    return;
  }
  if (t.closest('#delSku')) {
    const p = S.edit.product;
    if (await confirmDlg(`Delete ${p.name}?`, `The SKU and its ${S.edit.offers.length} offer(s) are removed. This cannot be undone (except by resetting to sample data).`, 'Delete')) {
      try { await api('DELETE', `skus/${encodeURIComponent(p.id)}`); toast('SKU deleted'); closeDrawer(); await loadCounts(); loadList(); }
      catch (e) { toast(e.message, true); }
    }
    return;
  }
  const delO = t.closest('[data-del-offer]');
  if (delO) {
    const i = Number(delO.dataset.delOffer);
    const o = S.edit.offers[i];
    if (await confirmDlg('Delete this offer?', `${o.id} is removed.`, 'Delete')) {
      try { await api('DELETE', `offers/${encodeURIComponent(o.id)}`); S.edit.offers.splice(i, 1); S.edit.offerErrors = {}; toast('Offer deleted'); renderDrawer(); loadList(); }
      catch (e) { toast(e.message, true); }
    }
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === 'auth') { const tok = $('#tok', f); signIn(tok ? tok.value : ''); return; }
  if (f.id === 'pform') { saveProduct(f); return; }
  if (f.dataset.offer !== undefined) saveOffer(f, Number(f.dataset.offer));
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'q') { S.q = ev.target.value; renderRows(); }
  const f = ev.target.closest && ev.target.closest('form.offer');
  if (f) f.classList.add('dirty');
});

document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.edit && !$('#dlg').open) closeDrawer(); });

$('#file').addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (f) importFile(f);
});

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

(async function init() {
  renderAuth();
  try {
    const [cats, retailers, health] = await Promise.all([api('GET', 'categories'), api('GET', 'retailers'), api('GET', 'health')]);
    S.cats = cats;
    S.retailers = retailers;
    $('#tenant').textContent = `SKU catalog · ${health.tenant}`;
    const saved = lsGet('wisedo.skuCat');
    if (cats.some((c) => c.id === saved)) S.cat = saved;
    renderTabs();
    await loadCounts();
    loadList();
  } catch (e) {
    $('#rows').innerHTML = `<tr><td colspan="5">${errorBox(e)}</td></tr>`;
  }
  const tok = ssGet('wisedo.adminToken');
  if (tok) signIn(tok); else renderAdminState();
})();
