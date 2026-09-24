// Runs the Walnut prover off the main thread. The compiled prover (walnut.js, produced by TeaVM)
// keeps its files in memory; this worker seeds it with the default libraries on startup, overlays
// whatever the user saved earlier, and persists files the prover writes to IndexedDB.
import * as W from './walnut.js';

const DB_NAME = 'walnut';
const STORE = 'files';
const HOME = W.home();
const LIBRARY_DIRS = [
  'Automata Library', 'Word Automata Library', 'Custom Bases', 'Macro Library',
  'Morphism Library', 'Transducer Library', 'Command Files', 'Result',
];

let db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, work) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = work(t.objectStore(STORE));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function readAllSaved() {
  return new Promise((resolve, reject) => {
    const files = {};
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(files);
      files[cursor.key] = cursor.value;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

function relative(absPath) {
  return absPath.startsWith(HOME) ? absPath.slice(HOME.length) : absPath;
}

async function persist() {
  const dirty = W.drainDirtyPaths();
  const deleted = W.drainDeletedPaths();
  if (dirty.length === 0 && deleted.length === 0) return { dirty: [], deleted: [] };
  const changes = dirty.map((p) => [relative(p), W.readFile(p)]).filter(([, c]) => c !== null);
  const removals = deleted.map(relative);
  try {
    await tx('readwrite', (store) => {
      for (const [key, content] of changes) store.put(content, key);
      for (const key of removals) store.delete(key);
    });
  } catch (e) {
    postMessage({ type: 'out', text: `Could not save files to browser storage: ${e.message}\n` });
  }
  return { dirty: changes.map(([k]) => k), deleted: removals };
}

function tree() {
  const out = {};
  for (const dir of LIBRARY_DIRS) {
    out[dir] = W.listDirectory(HOME + dir).filter((n) => !n.endsWith('/'));
  }
  return out;
}

async function start() {
  W.setOutput((text) => postMessage({ type: 'out', text }));
  const lib = await (await fetch('./library.json', { cache: 'no-cache' })).json();
  for (const [path, content] of Object.entries(lib)) W.writeFile(HOME + path, content);
  let saved = {};
  try {
    db = await openDb();
    saved = await readAllSaved();
  } catch (e) {
    postMessage({ type: 'out', text: `Browser storage is unavailable (${e.message}); files will not persist.\n` });
  }
  for (const [path, content] of Object.entries(saved)) W.writeFile(HOME + path, content);
  const memlimit = Number(new URLSearchParams(self.location.search).get('memlimit'));
  if (memlimit > 0) W.setMemoryLimitFraction(memlimit);
  W.init();
  W.drainDirtyPaths();
  W.drainDeletedPaths();
  postMessage({ type: 'ready', version: W.version(), restored: Object.keys(saved).length, tree: tree() });
}

const handlers = {
  async run({ id, text }) {
    const started = performance.now();
    let exited = false;
    let error = null;
    try {
      exited = !W.run(text);
    } catch (e) {
      error = String(e && e.message ? e.message : e);
    }
    W.flushOutput();
    const changes = await persist();
    postMessage({ type: 'done', id, ms: performance.now() - started, exited, error, changes, tree: tree() });
  },
  read({ id, path }) {
    postMessage({ type: 'file', id, path, content: W.readFile(HOME + path) });
  },
  async write({ id, path, content }) {
    W.writeFile(HOME + path, content);
    await persist();
    postMessage({ type: 'written', id, path, tree: tree() });
  },
  async remove({ id, path }) {
    W.deleteFile(HOME + path);
    await persist();
    postMessage({ type: 'removed', id, path, tree: tree() });
  },
  async reset({ id }) {
    if (db) await tx('readwrite', (store) => store.clear());
    postMessage({ type: 'reset', id });
  },
};

onmessage = async (event) => {
  const msg = event.data;
  const handler = handlers[msg.type];
  if (!handler) return;
  try {
    await handler(msg);
  } catch (e) {
    postMessage({ type: 'failure', id: msg.id, error: String(e && e.stack ? e.stack : e) });
  }
};

start().catch((e) => postMessage({ type: 'failure', error: String(e && e.stack ? e.stack : e) }));
