// SQL helpers for D1.
//
// D1's free plan allows 50 queries per Worker invocation and about 100 bound parameters per statement, so bulk
// writes (reset, CSV import) are sent as a few multi-row INSERT statements with escaped literals instead of one
// bound statement per row. Values are only ever numbers, booleans, null or strings, and strings are escaped by
// doubling single quotes, which is the only escape SQLite string literals have.

const MAX_SQL_CHARS = 80_000; // D1 caps a statement at 100 KB

/** @param {unknown} v */
export function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`sql: non-finite number ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  throw new Error(`sql: unsupported value of type ${typeof v}`);
}

/**
 * Build `INSERT OR REPLACE` statements for many rows, each under the statement size cap.
 * @param {string} table
 * @param {string[]} cols
 * @param {unknown[][]} rows
 * @returns {string[]}
 */
export function bulkUpsert(table, cols, rows) {
  const head = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES `;
  const out = [];
  let parts = [];
  let size = head.length;
  for (const r of rows) {
    if (r.length !== cols.length) throw new Error(`sql: ${table} row has ${r.length} values, expected ${cols.length}`);
    const tuple = `(${r.map(lit).join(', ')})`;
    if (parts.length && size + tuple.length + 1 > MAX_SQL_CHARS) {
      out.push(head + parts.join(','));
      parts = [];
      size = head.length;
    }
    parts.push(tuple);
    size += tuple.length + 1;
  }
  if (parts.length) out.push(head + parts.join(','));
  return out;
}

/**
 * Run statements in one D1 batch (one implicit transaction: all or nothing).
 * @param {any} db D1Database
 * @param {string[]} sqls
 */
export async function runAll(db, sqls) {
  if (!sqls.length) return;
  await db.batch(sqls.map((s) => db.prepare(s)));
}
