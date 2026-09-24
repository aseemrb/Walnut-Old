#!/usr/bin/env node
// Bundles Walnut's default library directories into a single JSON file the web app loads on
// first run: { "Automata Library/F.txt": "...", ... }. Paths are relative to the Walnut home.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = process.argv[2] ?? join(root, 'web', 'site', 'library.json');

const DIRS = [
  'Automata Library', 'Word Automata Library', 'Custom Bases', 'Macro Library',
  'Morphism Library', 'Transducer Library', 'Command Files', 'Help Documentation',
];
const TEXT = /\.(txt|md|gv)$/i;

const files = {};
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (TEXT.test(name)) files[relative(root, p).split('\\').join('/')] = readFileSync(p, 'utf8');
  }
}
for (const d of DIRS) walk(join(root, d));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(files));
const bytes = statSync(out).size;
console.log(`${Object.keys(files).length} files, ${(bytes / 1024).toFixed(0)} KB -> ${out}`);
