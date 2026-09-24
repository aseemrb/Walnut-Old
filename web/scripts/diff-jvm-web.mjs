#!/usr/bin/env node
// Differential test: runs the same commands through the JVM build and the browser build, then
// compares every automaton and result file they produce. Timing lines in logs are ignored.
// Usage: node web/scripts/diff-jvm-web.mjs [command-file ...]   (defaults to the integration corpus)
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, cpSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corpus = join(root, 'src', 'test', 'resources', 'integrationTests', 'Global');
const work = join(process.env.WALNUT_DIFF_DIR ?? tmpdir(), 'walnut-diff');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// Commands: the same list IntegrationTest uses, plus every command file in the corpus.
const commandFiles = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(join(corpus, 'Command Files')).filter((f) => f.endsWith('.txt'));
const commands = [
  'reg endsIn2Zeros lsd_2 "(0|1)*00";',
  'reg startsWith2Zeros msd_2 "00(0|1)*";',
  'def thueeq "T[x]=T[y]";',
  'def thuefactoreq "Ak (k < n) => T[i+k] = T[j+k]";',
  ...commandFiles.map((f) => `load ${f};`),
];

// ---- JVM ---------------------------------------------------------------------------------------
const jvmHome = join(work, 'jvm');
cpSync(corpus, jvmHome, { recursive: true });
for (const d of ['Result', 'Session']) mkdirSync(join(jvmHome, d), { recursive: true });
const script = commands.join('\n') + '\nexit;\n';
const jar = join(root, 'target', 'Walnut-all.jar');
const t0 = Date.now();
// Some corpus files reference automata that a later file defines, so a few commands fail in both
// builds. Their output is captured (not shown) and the failure counts are compared below.
const jvm = spawnSync('java', ['-jar', jar, `--home-dir=${jvmHome}/`, '--global-session'],
  { input: script, maxBuffer: 1 << 28, encoding: 'utf8' });
if (jvm.status !== 0) { console.log(jvm.stderr); throw new Error(`JVM run failed with status ${jvm.status}`); }
const jvmOutput = jvm.stdout + jvm.stderr;
console.log(`JVM run: ${Date.now() - t0} ms`);
const FAILURE = /Exception|does not exist|Undefined token|operator is missing|expected/i;
const countFailures = (text) => text.split('\n').filter((l) => FAILURE.test(l)).length;

// ---- web ---------------------------------------------------------------------------------------
const W = await import(join(root, 'web', 'app', 'target', 'site', 'walnut.js'));
let webOutput = '';
W.setOutput((text) => { webOutput += text; });
const HOME = W.home();
function seed(dir, rel = '') {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) seed(p, `${rel}${name}/`);
    else if (name.endsWith('.txt')) W.writeFile(HOME + rel + name, readFileSync(p, 'utf8'));
  }
}
seed(corpus);
W.init();
const t1 = Date.now();
for (const c of commands) W.run(c);
console.log(`Web run: ${Date.now() - t1} ms`);
const jvmFailures = countFailures(jvmOutput);
const webFailures = countFailures(webOutput);
console.log(`Failing command lines: JVM ${jvmFailures}, web ${webFailures}`);
if (jvmFailures !== webFailures) {
  const lines = (text) => text.split('\n').filter((l) => FAILURE.test(l)).join('\n');
  writeFileSync(join(work, 'failures.jvm'), lines(jvmOutput));
  writeFileSync(join(work, 'failures.web'), lines(webOutput));
  console.log(`Failure counts differ between builds (see ${join(work, 'failures.jvm')} and .web).`);
  process.exitCode = 1;
}

// ---- compare -----------------------------------------------------------------------------------
const IGNORE = /(\d+ms|Total computation time.*|Applying valid representation.*)/g;
const normalize = (s) => s.replace(IGNORE, '').replace(/\r\n/g, '\n');
let compared = 0; let mismatches = 0;
function walk(dir, rel = '') {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, `${rel}${name}/`); continue; }
    if (!name.endsWith('.txt') && !name.endsWith('.gv')) continue;
    if (name.endsWith('_log.txt') || name === 'global_log.txt') continue;
    const webContent = W.readFile(HOME + rel + name);
    compared++;
    if (webContent === null) { mismatches++; console.log(`MISSING in web: ${rel}${name}`); continue; }
    const a = normalize(readFileSync(p, 'utf8')); const b = normalize(webContent);
    if (a !== b) {
      mismatches++;
      console.log(`DIFFERS: ${rel}${name}`);
      const out = join(work, 'diff', rel);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${name}.jvm`), a);
      writeFileSync(join(out, `${name}.web`), b);
    }
  }
}
for (const d of ['Result', 'Automata Library', 'Word Automata Library', 'Custom Bases', 'Macro Library', 'Morphism Library']) {
  if (existsSync(join(jvmHome, d))) walk(join(jvmHome, d), `${d}/`);
}
console.log(`${compared} files compared, ${mismatches} mismatches${mismatches ? ` (see ${join(work, 'diff')})` : ''}`);
if (mismatches) process.exitCode = 1;
