// Config store for the admin panel and the try-out page (browser). One published config version at a time, one
// draft, and a history of published versions that can be rolled back.
//
// Where it lives: the artifact `db` capability when this viewer has it (shared, survives reloads and devices);
// otherwise this browser's localStorage. Both are wrapped in try/catch: a page without storage still works with
// the built-in defaults. Nothing here touches the engine; callers turn overrides into a config with
// applyOverrides() from params.js.
//
// Documents
//   engine/published   {version, overrides, note, at, by}
//   engine/draft       {overrides, at, by}
//   history/v<N>       {version, overrides, note, at, by, changes}   (changes = number of overridden values)

const LS = { published: 'wisedo.published', draft: 'wisedo.draft', history: 'wisedo.history' };

/** @typedef {{version: number, overrides: any, note: string, at: string, by: string, changes: number}} Published */

function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

const countValues = (o) => {
  let n = 0;
  const walk = (x) => { if (x && typeof x === 'object') for (const v of Object.values(x)) walk(v); else if (x !== undefined) n++; };
  walk(o);
  return n;
};

export function createStore() {
  /** @type {any} */ let db = null;
  let who = 'admin';
  let mode = 'browser'; // 'shared' | 'browser'
  /** @type {Published|null} */ let published = null;
  /** @type {{overrides: any, at: string}|null} */ let draft = null;
  /** @type {Published[]} */ let history = [];
  let lastError = null;

  async function init() {
    try {
      const c = window.claude;
      if (c && typeof c.use === 'function') {
        db = await c.use('db').catch(() => null);
        const user = await c.use('user').catch(() => null);
        if (user && typeof user.me === 'function') { try { const m = await user.me(); if (m && m.name) who = m.name; } catch { /* ignore */ } }
      }
    } catch { db = null; }
    mode = db ? 'shared' : 'browser';
    await reload();
    return api;
  }

  async function reload() {
    lastError = null;
    if (db) {
      try {
        const p = await db.doc('engine/published').get();
        published = p.exists ? p.data() : null;
        const d = await db.doc('engine/draft').get();
        draft = d.exists ? d.data() : null;
        const h = await db.collection('history').orderBy('version', 'desc').limit(30).get();
        history = h.docs.map((x) => x.data());
        return;
      } catch (e) {
        lastError = (e && e.code) || 'db_error';
        db = null; mode = 'browser'; // fall through to this browser
      }
    }
    published = lsGet(LS.published);
    draft = lsGet(LS.draft);
    history = lsGet(LS.history) || [];
  }

  async function write(path, key, value) {
    if (db) { await db.doc(path).set(value); return; }
    lsSet(key, value);
  }

  async function saveDraft(overrides) {
    draft = { overrides, at: new Date().toISOString(), by: who };
    if (db) await db.doc('engine/draft').set(draft); else lsSet(LS.draft, draft);
    return draft;
  }

  async function discardDraft() {
    draft = null;
    if (db) { try { await db.doc('engine/draft').delete(); } catch { await db.doc('engine/draft').set({ overrides: {}, at: new Date().toISOString(), by: who }); } } else lsDel(LS.draft);
  }

  /** Publish overrides as the next version. Returns the new published record. */
  async function publish(overrides, note) {
    const next = (history[0] ? history[0].version : published ? published.version : 0) + 1;
    const rec = { version: next, overrides, note: String(note || '').slice(0, 300), at: new Date().toISOString(), by: who, changes: countValues(overrides) };
    if (db) {
      await db.doc(`history/v${next}`).set(rec);
      await db.doc('engine/published').set(rec);
    } else {
      history = [rec, ...history].slice(0, 30);
      lsSet(LS.history, history);
      lsSet(LS.published, rec);
    }
    published = rec;
    history = [rec, ...history.filter((h) => h.version !== rec.version)];
    return rec;
  }

  const api = {
    init, reload, saveDraft, discardDraft, publish,
    get mode() { return mode; },
    get who() { return who; },
    get published() { return published; },
    get draft() { return draft; },
    get history() { return history; },
    get lastError() { return lastError; },
    /** The overrides in force for buyers (published), or {}. */
    get liveOverrides() { return (published && published.overrides) || {}; },
  };
  return api;
}
