// Entry point for `node --test test/`.
//
// Node 22's test runner treats a directory argument as a module path, so `node --test test/` loads this file
// instead of globbing the folder. This file then imports every *.test.js here (sorted, so the order is stable).
// When the runner discovers files itself (plain `node --test`, or a glob), each test file already runs on
// its own and this file is also loaded directly; in that case it does nothing, so nothing runs twice.
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);
const dir = dirname(self);
const entry = process.argv[1] ? resolve(process.argv[1]) : '';

if (entry === dir) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.js')).sort()) {
    await import(pathToFileURL(join(dir, f)).href);
  }
}
