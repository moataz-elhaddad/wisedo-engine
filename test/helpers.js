// Shared test helpers: load the config and synthetic data, build profiles, build small fixtures.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNeedProfile } from '../src/profile/build.js';
import { DATA_NOW } from '../data/generate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

export const NOW = DATA_NOW;
export const ROOT_DIR = ROOT;
export const mobileConfig = readJson('config/mobile.json');

/** A fresh deep copy of the synthetic snapshot (so a test may mutate it). */
export function syntheticSnapshot() {
  return {
    snapshot_id: 'synthetic-mobile-2026-10-03',
    tenant_id: 'wisedo',
    configs: { mobile: structuredClone(mobileConfig) },
    products: readJson('data/synthetic/products.json'),
    retailers: readJson('data/synthetic/retailers.json'),
    offers: readJson('data/synthetic/offers.json'),
    plans: readJson('data/synthetic/plans.json'),
  };
}

/** Shared, never-mutated snapshot for read-only tests (lets the prepare cache work across calls). */
export const SNAPSHOT = syntheticSnapshot();

/**
 * Build a profile from slot answers, then apply overrides on money/logistics/shops (deep-merged one level).
 * @param {Record<string, any>|any[]} answers
 * @param {any} [over]
 */
export function profile(answers, over = {}) {
  const p = buildNeedProfile(mobileConfig, answers);
  for (const k of ['money', 'logistics', 'shops', 'derived']) if (over[k]) p[k] = { ...p[k], ...over[k] };
  for (const k of Object.keys(over)) if (!['money', 'logistics', 'shops', 'derived'].includes(k)) p[k] = over[k];
  return p;
}

const H = 3600 * 1000;
export const hoursAgo = (h) => new Date(Date.parse(NOW) - h * H).toISOString();

/**
 * A small hand-made catalog for precise assertions. Unspecified fields get sensible defaults.
 * @param {{products: any[], offers: any[], retailers?: any[], plans?: any[], tenant?: string}} spec
 */
export function fixture(spec) {
  const tenant = spec.tenant || 'wisedo';
  const retailers = (spec.retailers || [
    { id: 'shopa', trust: 9, cod: true },
    { id: 'shopb', trust: 8, cod: false },
    { id: 'shopc', trust: 5, cod: true },
  ]).map((r) => ({ tenant_id: tenant, name: r.id.toUpperCase(), return_days: 14, source: 'synthetic', affiliate_tag: null, ...r }));
  const products = spec.products.map((p) => ({
    tenant_id: tenant, category: 'mobile', brand: 'BrandX', name: p.id, ref_price_egp: 10000, popular: false, aliases: [],
    checked_at: hoursAgo(24 * 5), source: 'synthetic', ...p,
    attrs: { perf: 5, camera: 5, battery_mah: 5000, screen: 5, storage_gb: 128, ram_gb: 8, updates_years: 3, service: 6, ease: 6, warranty_months: 12, weight_g: 190, charging_w: 30, os: 'android', has_5g: false, series: 'mid', ...(p.attrs || {}) },
  }));
  for (const p of spec.products) if (p.drop) for (const k of p.drop) delete products.find((x) => x.id === p.id).attrs[k];
  const offers = spec.offers.map((o) => ({
    id: `o-${o.product_id}-${o.retailer_id}`, tenant_id: tenant, url: `https://${o.retailer_id}.example.invalid/${o.product_id}`,
    delivery: { greater_cairo: { fee: 0, days: 2 }, alexandria: { fee: 0, days: 3 }, other: { fee: 0, days: 4 } },
    in_stock: true, official: true, extras: [], checked_at: hoursAgo(2), source: 'synthetic', ...o,
  }));
  const plans = (spec.plans || []).map((pl) => ({
    tenant_id: tenant, provider_name: pl.provider, min_down_share: 0, promo: false, valid_until: null, product_override: null,
    checked_at: hoursAgo(24 * 3), source: 'synthetic', admin_share: 0, monthly_rate: 0, ...pl,
  }));
  return { snapshot_id: 'fixture', tenant_id: tenant, configs: { mobile: mobileConfig }, products, retailers, offers, plans };
}
