// CSV import and export of a category's SKUs (products with their offers), the first form of the B2B upload.
//
// One row per offer. Product columns repeat on every offer row; a product with no offers has one row with the
// offer columns empty. Attribute columns are named `attr:<attribute id>` from the category config.
// Import rules (all or nothing: any error and nothing is written):
//   - product_id empty -> made from category, brand and name; an existing product is merged (empty cells keep the
//     stored value, so a partial sheet only changes what it lists)
//   - an offer row needs retailer_id and price_egp; offer_id empty -> o-<product_id>-<retailer_id>
//   - delivery cells empty -> stored value, else 0 EGP / 3 days; extras and plan links are kept from the stored offer

const ZONE_COLS = [['greater_cairo', 'cairo'], ['alexandria', 'alex'], ['other', 'other']];

export function columnsFor(config) {
  return [
    'product_id', 'brand', 'name', 'ref_price_egp', 'popular', 'aliases',
    ...config.attributes.map((a) => `attr:${a.id}`),
    'offer_id', 'retailer_id', 'price_egp', 'in_stock', 'official', 'url',
    ...ZONE_COLS.flatMap(([, s]) => [`${s}_fee`, `${s}_days`]),
  ];
}

// ---------------------------------------------------------------------------------------------
// CSV text
// ---------------------------------------------------------------------------------------------

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF, leading BOM. Returns rows of strings. */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

export function exportCsv(config, products, offers) {
  const cols = columnsFor(config);
  const byProduct = new Map(products.map((p) => [p.id, []]));
  for (const o of offers) if (byProduct.has(o.product_id)) byProduct.get(o.product_id).push(o);
  const rows = [cols];
  for (const p of products) {
    const base = [p.id, p.brand, p.name, p.ref_price_egp, p.popular ? 'yes' : 'no', (p.aliases || []).join('|'),
      ...config.attributes.map((a) => fmtAttr((p.attrs || {})[a.id]))];
    const list = byProduct.get(p.id);
    if (!list.length) { rows.push([...base, ...new Array(cols.length - base.length).fill('')]); continue; }
    for (const o of list) {
      rows.push([...base, o.id, o.retailer_id, o.price_egp, o.in_stock ? 'yes' : 'no', o.official ? 'yes' : 'no', o.url,
        ...ZONE_COLS.flatMap(([z]) => { const d = (o.delivery || {})[z]; return d ? [d.fee, d.days] : ['', '']; })]);
    }
  }
  return toCsv(rows);
}

const fmtAttr = (v) => (v === true ? 'yes' : v === false ? 'no' : v ?? '');

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function parseBool(s) {
  const v = s.trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(v)) return true;
  if (['no', 'false', '0', 'n'].includes(v)) return false;
  return undefined;
}

function parseNum(s) {
  const v = Number(s.trim().replace(/,/g, ''));
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Turn CSV text into merged product and offer records. Pure: the caller validates and writes.
 * @param {string} text
 * @param {{config: any, tenant: string, now: string, existingProducts: Map<string, any>, existingOffers: Map<string, any>}} ctx
 * @returns {{products: any[], offers: any[], errors: string[], rows: number}}
 */
export function importCsv(text, { config, tenant, now, existingProducts, existingOffers }) {
  const errors = [];
  const table = parseCsv(text);
  if (!table.length) return { products: [], offers: [], errors: ['the file is empty'], rows: 0 };
  const head = table[0].map((h) => h.trim());
  const idx = new Map(head.map((h, i) => [h, i]));
  for (const need of ['brand', 'name']) if (!idx.has(need) && !idx.has('product_id')) errors.push(`missing column "${need}"`);
  const attrDefs = new Map(config.attributes.map((a) => [a.id, a]));
  for (const h of head) {
    if (h.startsWith('attr:') && !attrDefs.has(h.slice(5))) errors.push(`unknown attribute column "${h}" for ${config.id}`);
  }
  if (errors.length) return { products: [], offers: [], errors, rows: table.length - 1 };

  const products = new Map();
  const offers = new Map();
  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const get = (k) => { const i = idx.get(k); return i === undefined ? '' : (table[r][i] ?? '').trim(); };
    const brand = get('brand'), name = get('name');
    let pid = get('product_id');
    if (!pid) {
      if (!brand || !name) { errors.push(`row ${line}: product_id, or brand and name, required`); continue; }
      pid = slug(`${config.id}-${brand}-${name}`);
    }
    const prev = products.get(pid) || existingProducts.get(pid);
    if (prev && prev.category !== config.id) { errors.push(`row ${line}: product ${pid} belongs to ${prev.category}, not ${config.id}`); continue; }
    const p = prev ? structuredClone(prev) : { id: pid, tenant_id: tenant, category: config.id, brand: '', name: '', ref_price_egp: null, popular: false, aliases: [], attrs: {}, source: 'upload' };
    if (brand) p.brand = brand;
    if (name) p.name = name;
    const ref = get('ref_price_egp');
    if (ref) { const n = parseNum(ref); if (n === undefined) errors.push(`row ${line}: ref_price_egp "${ref}" is not a number`); else p.ref_price_egp = n; }
    const pop = get('popular');
    if (pop) { const b = parseBool(pop); if (b === undefined) errors.push(`row ${line}: popular must be yes or no`); else p.popular = b; }
    const al = get('aliases');
    if (al) p.aliases = al.split('|').map((x) => x.trim()).filter(Boolean);
    for (const [id, d] of attrDefs) {
      const raw = get(`attr:${id}`);
      if (!raw) continue;
      if (d.type === 'number') { const n = parseNum(raw); if (n === undefined) errors.push(`row ${line}: ${id} "${raw}" is not a number`); else p.attrs[id] = n; }
      else if (d.type === 'boolean') { const b = parseBool(raw); if (b === undefined) errors.push(`row ${line}: ${id} must be yes or no`); else p.attrs[id] = b; }
      else p.attrs[id] = raw;
    }
    p.tenant_id = tenant;
    p.checked_at = now;
    products.set(pid, p);

    const retailer = get('retailer_id'), price = get('price_egp');
    if (!retailer && !price && !get('offer_id')) continue;
    if (!retailer || !price) { errors.push(`row ${line}: an offer needs retailer_id and price_egp`); continue; }
    const oid = get('offer_id') || `o-${pid}-${retailer}`;
    const prevO = offers.get(oid) || existingOffers.get(oid);
    const o = prevO ? structuredClone(prevO) : { id: oid, tenant_id: tenant, product_id: pid, retailer_id: retailer, url: '', price_egp: 0, delivery: {}, in_stock: true, official: true, extras: [], source: 'upload' };
    if (prevO && prevO.product_id !== pid) { errors.push(`row ${line}: offer ${oid} belongs to product ${prevO.product_id}`); continue; }
    o.retailer_id = retailer;
    const n = parseNum(price);
    if (n === undefined) errors.push(`row ${line}: price_egp "${price}" is not a number`); else o.price_egp = n;
    for (const k of ['in_stock', 'official']) {
      const raw = get(k);
      if (raw) { const b = parseBool(raw); if (b === undefined) errors.push(`row ${line}: ${k} must be yes or no`); else o[k] = b; }
    }
    const url = get('url');
    if (url) o.url = url;
    if (!o.url) errors.push(`row ${line}: url required for a new offer`);
    for (const [z, s] of ZONE_COLS) {
      const fee = get(`${s}_fee`), days = get(`${s}_days`);
      const cur = o.delivery[z] || { fee: 0, days: 3 };
      const nf = fee ? parseNum(fee) : cur.fee, nd = days ? parseNum(days) : cur.days;
      if (nf === undefined || nd === undefined) errors.push(`row ${line}: ${s} delivery fee and days must be numbers`);
      else o.delivery[z] = { fee: nf, days: nd };
    }
    o.tenant_id = tenant;
    o.checked_at = now;
    offers.set(oid, o);
  }
  return { products: [...products.values()], offers: [...offers.values()], errors, rows: table.length - 1 };
}
