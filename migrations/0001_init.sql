-- Wisedo engine demo store: one tenant's own catalog (B2B style), kept in the engine's snapshot shape.
-- Each row keeps the full contract record as JSON in `data`; the other columns are copies for listing and joins.
CREATE TABLE IF NOT EXISTS products (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  ref_price_egp REAL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS products_by_category ON products (tenant_id, category);

CREATE TABLE IF NOT EXISTS offers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  retailer_id TEXT NOT NULL,
  price_egp REAL NOT NULL,
  in_stock INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS offers_by_product ON offers (tenant_id, product_id);

CREATE TABLE IF NOT EXISTS retailers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS plans (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Per-tenant settings, e.g. the demo clock (data_now).
CREATE TABLE IF NOT EXISTS meta (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
