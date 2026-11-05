'use strict';
// Loads the extension's plain browser scripts into an isolated Node `vm` context so the pure logic can be tested
// without a browser. Top-level `const` declarations are read back by name with get().
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// EXT_ROOT points the tests at another copy of the extension, e.g. a deliberately broken one.
const ROOT = process.env.EXT_ROOT ? path.resolve(process.env.EXT_ROOT) : path.resolve(__dirname, '..', '..');

function load(files, globals = {}) {
  const ctx = vm.createContext({ console, URL, URLSearchParams, structuredClone, ...globals });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  return { ctx, get: (name) => vm.runInContext(name, ctx) };
}

module.exports = { load, ROOT };
