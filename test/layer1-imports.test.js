// Layer 1 talks to Layer 2 only through match() (simulate while planning, rank for the result). This test greps
// every Layer 1 source file: the only Layer 2 import is `{ match }` from '../layer2/index.js', nothing reaches
// into Layer 2's modules, and the only package import is the Anthropic SDK, loaded lazily inside the adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT_DIR } from './helpers.js';

const L1 = join(ROOT_DIR, 'src/layer1');

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
}

/** Every static import / re-export specifier and every dynamic import() in a file (comments stripped). */
function imports(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = [];
  for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) out.push({ what: m[1].trim(), from: m[2], dynamic: false });
  for (const m of code.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ what: '*', from: m[1], dynamic: true });
  return out;
}

test('layer1 imports Layer 2 only through match()', () => {
  const all = files(L1);
  assert.ok(all.length >= 12);
  let seen = 0;
  for (const f of all) {
    const rel = relative(ROOT_DIR, f);
    for (const imp of imports(readFileSync(f, 'utf8'))) {
      if (imp.from.includes('layer2')) {
        seen++;
        assert.equal(imp.from, '../layer2/index.js', `${rel}: ${imp.from}`);
        assert.equal(imp.what.replace(/\s+/g, ' '), '{ match }', `${rel} imports ${imp.what} from Layer 2`);
      }
    }
    assert.ok(!/\bprepare\s*\(|\bscoreProduct|\bm[0-9]-/.test(readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')), `${rel} reaches into Layer 2 internals`);
  }
  assert.ok(seen >= 1, 'Layer 1 does use match()');
});

test('layer1 has no npm dependency except the lazily imported Anthropic SDK in the live adapter', () => {
  for (const f of files(L1)) {
    const rel = relative(ROOT_DIR, f).replace(/\\/g, '/');
    for (const imp of imports(readFileSync(f, 'utf8'))) {
      if (imp.from.startsWith('.') || imp.from.startsWith('node:')) continue;
      assert.equal(rel, 'src/layer1/llm/anthropic.js', `${rel} imports ${imp.from}`);
      assert.equal(imp.from, '@anthropic-ai/sdk');
      assert.equal(imp.dynamic, true, 'the SDK is imported lazily');
    }
  }
});

test('layer1 reads no environment variable outside the live adapter, and never the clock', () => {
  for (const f of files(L1)) {
    const rel = relative(ROOT_DIR, f).replace(/\\/g, '/');
    const code = readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    if (rel !== 'src/layer1/llm/anthropic.js') assert.ok(!code.includes('process.env'), `${rel} reads process.env`);
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(code), `${rel} reads the clock`);
    assert.ok(!/\bfetch\(/.test(code), `${rel} calls the network`);
  }
});
