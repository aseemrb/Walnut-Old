// Page logic: talks to worker.js, renders the transcript and the file browser.
const $ = (id) => document.getElementById(id);
const transcript = $('transcript');
const form = $('form');
const input = $('input');
const runBtn = $('run');
const stopBtn = $('stop');
const status = $('status');
const treeEl = $('tree');
const viewer = $('viewer');

const HISTORY_KEY = 'walnut.history';
const THEME_KEY = 'walnut.theme';
const OPEN_DIRS_KEY = 'walnut.openDirs';

let worker = null;
let ready = false;
let running = null; // { entry, outEl, started, timer }
let nextId = 1;
const pending = new Map(); // id -> resolve
let history = load(HISTORY_KEY, []);
let historyPos = history.length;
let draft = '';
let openDirs = new Set(load(OPEN_DIRS_KEY, ['Result', 'Automata Library']));
let currentFile = null;

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
}

// ---- theme ------------------------------------------------------------------------------------
function applyTheme(t) {
  document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
}
applyTheme(load(THEME_KEY, 'light'));
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  save(THEME_KEY, next);
  applyTheme(next);
});

// ---- worker -----------------------------------------------------------------------------------
function setStatus(state, text) {
  status.dataset.state = state;
  status.textContent = text;
}

function startWorker() {
  ready = false;
  setStatus('loading', 'Loading prover');
  worker = new Worker(`./worker.js${location.search}`, { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    setStatus('error', 'Prover crashed');
    finishRun({ error: e.message || 'The prover stopped unexpectedly.' });
  };
}

function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ type, id, ...payload });
  });
}

function onWorkerMessage(event) {
  const msg = event.data;
  switch (msg.type) {
    case 'ready':
      ready = true;
      setStatus('ready', 'Ready');
      $('version').textContent = `v${msg.version}`;
      renderTree(msg.tree);
      if (msg.restored > 0) addNote(`Restored ${msg.restored} saved file${msg.restored === 1 ? '' : 's'} from this browser.`);
      input.focus();
      break;
    case 'out':
      appendOutput(msg.text);
      break;
    case 'done':
      renderTree(msg.tree);
      finishRun(msg);
      resolvePending(msg);
      break;
    case 'file': case 'written': case 'removed': case 'reset':
      if (msg.tree) renderTree(msg.tree);
      resolvePending(msg);
      break;
    case 'failure':
      if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); p?.reject(new Error(msg.error)); }
      else { setStatus('error', 'Prover failed to start'); addNote(`The prover failed to start: ${msg.error}`, true); }
      break;
  }
}
function resolvePending(msg) {
  const p = pending.get(msg.id);
  if (p) { pending.delete(msg.id); p.resolve(msg); }
}

// ---- transcript -------------------------------------------------------------------------------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function scrollToBottom() { transcript.scrollTop = transcript.scrollHeight; }

function addNote(text, isError = false) {
  const entry = el('div', `entry note${isError ? ' error' : ''}`);
  entry.appendChild(el('p', null, text));
  transcript.appendChild(entry);
  scrollToBottom();
}

// The clear/cls command prints the terminal escape sequence for "erase screen"; emulate it.
const CLEAR_SCREEN = /\x1b\[H|\x1b\[2J/g;
function clearTranscript() {
  for (const child of [...transcript.children]) {
    if (!running || child !== running.entry) child.remove();
  }
  if (running) running.outEl.textContent = '';
}

function appendOutput(text) {
  if (text.includes('\x1b[2J')) {
    clearTranscript();
    text = text.replace(CLEAR_SCREEN, '');
    if (!text.trim()) return;
  }
  if (!running) { addNote(text); return; }
  // The prover echoes the command as its first line; the transcript already shows it.
  if (!running.echoStripped) {
    running.echoStripped = true;
    const firstLine = text.split('\n', 1)[0];
    if (running.command.split('\n').join('') === firstLine || running.command.startsWith(firstLine)) {
      text = text.slice(firstLine.length).replace(/^\n/, '');
      if (!text) return;
    }
  }
  running.outEl.textContent += text;
  const isNearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
  if (isNearBottom) scrollToBottom();
}

function beginRun(command) {
  const entry = el('div', 'entry');
  entry.appendChild(el('div', 'cmd', command));
  const outEl = el('pre', 'out');
  entry.appendChild(outEl);
  transcript.appendChild(entry);
  scrollToBottom();
  running = { entry, outEl, command, started: performance.now(), echoStripped: false };
  running.timer = setInterval(() => {
    setStatus('busy', `Running, ${((performance.now() - running.started) / 1000).toFixed(0)} s`);
  }, 1000);
  setStatus('busy', 'Running');
  runBtn.disabled = true;
  stopBtn.hidden = false;
  input.disabled = true;
}

function finishRun(msg) {
  if (!running) return;
  clearInterval(running.timer);
  const { entry, outEl } = running;
  const ms = msg.ms ?? (performance.now() - running.started);
  if (!outEl.textContent) outEl.remove();
  if (msg.error) entry.appendChild(el('pre', 'err', msg.error));
  const meta = el('div', 'meta', ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
  entry.appendChild(meta);
  const changed = msg.changes ? msg.changes.dirty.filter((p) => !p.endsWith('_log.txt') && p !== 'Result/global_log.txt') : [];
  if (changed.length) {
    const line = el('div', 'files-changed');
    line.append('Wrote ');
    changed.forEach((p, i) => {
      if (i) line.append(', ');
      const b = el('button', null, p);
      b.type = 'button';
      b.addEventListener('click', () => openFile(p));
      line.appendChild(b);
    });
    entry.appendChild(line);
  }
  running = null;
  runBtn.disabled = false;
  stopBtn.hidden = true;
  input.disabled = false;
  setStatus(ready ? 'ready' : 'error', ready ? 'Ready' : 'Prover stopped');
  scrollToBottom();
  if (msg.exited) addNote('Session ended with exit. Reload the page to start again, your files are kept.');
  else input.focus();
}

// ---- input ------------------------------------------------------------------------------------
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`;
}
input.addEventListener('input', autosize);

function isComplete(text) {
  const t = text.trim();
  return t.endsWith(';') || t.endsWith(':');
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (isComplete(input.value)) { e.preventDefault(); form.requestSubmit(); }
    return;
  }
  const single = !input.value.includes('\n');
  if (e.key === 'ArrowUp' && single && historyPos > 0) {
    e.preventDefault();
    if (historyPos === history.length) draft = input.value;
    historyPos--;
    input.value = history[historyPos];
    autosize();
  } else if (e.key === 'ArrowDown' && single && historyPos < history.length) {
    e.preventDefault();
    historyPos++;
    input.value = historyPos === history.length ? draft : history[historyPos];
    autosize();
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !ready || running) return;
  if (!isComplete(text)) { addNote('Commands must end with ; or :', true); return; }
  if (history[history.length - 1] !== text) { history.push(text); history = history.slice(-200); save(HISTORY_KEY, history); }
  historyPos = history.length;
  draft = '';
  input.value = '';
  autosize();
  beginRun(text);
  worker.postMessage({ type: 'run', id: nextId++, text });
});

stopBtn.addEventListener('click', () => {
  if (!running) return;
  worker.terminate();
  finishRun({ error: 'Stopped. Files written by this command were not saved.' });
  addNote('Restarting the prover.');
  startWorker();
});

// ---- files ------------------------------------------------------------------------------------
function renderTree(tree) {
  treeEl.replaceChildren();
  for (const [dir, files] of Object.entries(tree)) {
    const details = el('details');
    details.open = openDirs.has(dir);
    details.addEventListener('toggle', () => {
      if (details.open) openDirs.add(dir); else openDirs.delete(dir);
      save(OPEN_DIRS_KEY, [...openDirs]);
    });
    const summary = el('summary');
    summary.append(el('span', null, dir), el('span', 'count', String(files.length)));
    details.appendChild(summary);
    const ul = el('ul');
    if (files.length === 0) ul.appendChild(el('li', 'empty', 'Empty'));
    for (const f of files) {
      const li = el('li');
      const b = el('button', null, f);
      b.type = 'button';
      b.addEventListener('click', () => openFile(`${dir}/${f}`));
      li.appendChild(b);
      ul.appendChild(li);
    }
    details.appendChild(ul);
    treeEl.appendChild(details);
  }
}

async function openFile(path) {
  const { content } = await call('read', { path });
  if (content === null) { addNote(`${path} does not exist.`, true); return; }
  currentFile = { path, content };
  $('viewer-name').textContent = path;
  $('viewer-text').textContent = content;
  treeEl.hidden = true;
  viewer.hidden = false;
  const graph = $('viewer-graph');
  graph.hidden = true;
  graph.replaceChildren();
  if (path.endsWith('.gv')) renderGraph(content, graph);
}

$('viewer-back').addEventListener('click', () => { viewer.hidden = true; treeEl.hidden = false; currentFile = null; });

$('viewer-download').addEventListener('click', () => {
  if (!currentFile) return;
  const blob = new Blob([currentFile.content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentFile.path.split('/').pop();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('viewer-delete').addEventListener('click', async () => {
  if (!currentFile) return;
  if (!(await confirm(`Delete ${currentFile.path}? This cannot be undone.`, 'Delete'))) return;
  await call('remove', { path: currentFile.path });
  $('viewer-back').click();
});

$('import').addEventListener('click', () => $('import-input').click());
$('import-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const dir = await chooseDirectory();
  if (!dir) return;
  for (const f of files) {
    const content = await f.text();
    await call('write', { path: `${dir}/${f.name}`, content });
  }
  addNote(`Added ${files.length} file${files.length === 1 ? '' : 's'} to ${dir}.`);
});

$('reset').addEventListener('click', async () => {
  if (!(await confirm('Remove every file you created or changed and restore the default libraries? Your command history is kept.', 'Reset'))) return;
  if (running) worker.terminate();
  await call('reset').catch(() => {});
  worker.terminate();
  transcript.replaceChildren();
  addNote('Reset to the default libraries.');
  startWorker();
});

function confirm(text, okLabel) {
  const dialog = $('confirm');
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
  });
}

function chooseDirectory() {
  const dirs = [...treeEl.querySelectorAll('details > summary > span:first-child')].map((s) => s.textContent);
  const choice = window.prompt(`Add to which folder?\n${dirs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`, '1');
  if (choice === null) return null;
  const idx = Number(choice) - 1;
  return dirs[idx] ?? null;
}

// Graphviz rendering for .gv files, loaded on demand.
let vizPromise = null;
async function renderGraph(dot, container) {
  container.hidden = false;
  container.appendChild(el('p', 'note', 'Rendering graph'));
  try {
    if (!vizPromise) {
      vizPromise = import('https://cdn.jsdelivr.net/npm/@viz-js/viz@3.11.0/lib/viz-standalone.mjs').then((m) => m.instance());
    }
    const viz = await vizPromise;
    const svg = viz.renderSVGElement(dot);
    themeGraph(svg);
    container.replaceChildren(svg);
  } catch (e) {
    container.replaceChildren(el('p', 'note', `Graph could not be rendered (${e.message}). The source is shown below.`));
  }
}

// Graphviz hard-codes black strokes and a white background; make them follow the page theme.
function themeGraph(svg) {
  svg.style.color = 'var(--fg)';
  for (const node of svg.querySelectorAll('*')) {
    if (node.getAttribute('stroke') === 'black') node.setAttribute('stroke', 'currentColor');
    if (node.getAttribute('fill') === 'black') node.setAttribute('fill', 'currentColor');
    if (node.getAttribute('fill') === 'white') node.setAttribute('fill', 'none');
    if (node.tagName === 'text' && !node.hasAttribute('fill')) node.setAttribute('fill', 'currentColor');
  }
}

startWorker();
autosize();
