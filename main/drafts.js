// Unsaved edits kept for recovery: the Markdown I typed in the app and have
// not saved, written to the app's own data folder, never to the folder open,
// so it comes back after a quit, a crash or a folder switch. Recovering one
// only puts it back in the editor as an unsaved edit: nothing is written to
// the file until I press Save.
//
// Each edit is one small file, named from its folder and path, holding the
// folder, the path, what I typed, and the file's text when I started
// editing, to tell whether the file changed since. It is written whole to a
// file beside it, flushed to the disk, then moved into place, so a crash
// leaves the old copy or the new one, never half.
//
// Nothing is ever dropped to make room. When the limits are reached, a new
// edit is refused and the window says it is not kept, until I save or
// discard others. An edit goes only when I save it, discard it, or undo my
// way back to the file as it is.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_TEXT = 2 * 1024 * 1024; // as saving: a Markdown file up to 2 MB
const MAX_KEPT = 100;
const MAX_TOTAL = 64 * 1024 * 1024;
const CONTROL = /[\x00-\x1f\x7f]/;
// The kit is not inside any folder; its edits are kept apart from them and
// come back in every folder.
const KIT = '~/kit';

// A path as the window names it: relative, no step up, a Markdown file.
function isDraftPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 4096 || CONTROL.test(rel) || rel.startsWith('/')) return false;
  if (!/\.md$/i.test(rel)) return false;
  return rel.split('/').every((part, i) => part && part !== '..' && part !== '.' && (part !== '~' || (i === 0 && rel.startsWith(KIT + '/'))));
}

const owner = (root, rel) => (rel.startsWith(KIT + '/') ? KIT : root);
const nameOf = (root, rel) => crypto.createHash('sha256').update(owner(root, rel) + '\0' + rel).digest('hex').slice(0, 40) + '.json';

function check(record) {
  if (!record || typeof record !== 'object' || record.v !== 1) return null;
  const { root, rel, text, from, at } = record;
  if (typeof root !== 'string' || !(root === KIT || path.isAbsolute(root)) || CONTROL.test(root)) return null;
  if (!isDraftPath(rel) || owner(root, rel) !== root) return null;
  if (typeof text !== 'string' || typeof from !== 'string' || text.length > MAX_TEXT || from.length > MAX_TEXT) return null;
  return { root, rel, text, from, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 };
}

function store(dir) {
  // Writes to one file never overlap: each waits for the one before.
  const queue = new Map();
  const inOrder = (name, fn) => {
    const next = (queue.get(name) || Promise.resolve()).then(fn, fn);
    queue.set(name, next.catch(() => {}));
    return next;
  };

  async function all() {
    let names;
    try {
      names = (await fs.readdir(dir)).filter((n) => /^[0-9a-f]{40}\.json$/.test(n));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const name of names) {
      try {
        const file = path.join(dir, name);
        const [raw, info] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
        const record = check(JSON.parse(raw));
        if (record && nameOf(record.root, record.rel) === name) out.push({ ...record, name, bytes: info.size });
      } catch {}
    }
    return out;
  }

  // The edits kept for a folder, and those in the kit.
  async function list(root) {
    return (await all()).filter((r) => r.root === root || r.root === KIT).map(({ rel, text, from, at }) => ({ rel, text, from, at }));
  }

  // How many edits each folder has kept, for the recent list.
  async function counts() {
    const out = {};
    for (const r of await all()) if (r.root !== KIT) out[r.root] = (out[r.root] || 0) + 1;
    return out;
  }

  // Keep an edit. Returns the time it was kept, or throws why it was not.
  async function keep(root, rel, text, from) {
    if (!isDraftPath(rel)) throw new Error('Only a Markdown file\'s edit is kept');
    if (typeof text !== 'string' || typeof from !== 'string') throw new Error('Not text');
    if (text.length > MAX_TEXT || from.length > MAX_TEXT) throw new Error('Larger than 2 MB, so it is not kept for recovery');
    const name = nameOf(root, rel);
    return inOrder(name, async () => {
      const others = (await all()).filter((r) => r.name !== name);
      const body = JSON.stringify({ v: 1, root: owner(root, rel), rel, text, from, at: Date.now() });
      if (others.length >= MAX_KEPT || others.reduce((n, r) => n + r.bytes, 0) + Buffer.byteLength(body) > MAX_TOTAL) {
        throw new Error('The space for unsaved edits is full, so this one is not kept for recovery. Save or discard other unsaved edits.');
      }
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, name);
      const tmp = file + '.tmp';
      const handle = await fs.open(tmp, 'w', 0o600);
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, file);
      return JSON.parse(body).at;
    });
  }

  // Forget an edit: saved, discarded, or back to the file as it is.
  function drop(root, rel) {
    if (!isDraftPath(rel)) return Promise.resolve(false);
    const name = nameOf(root, rel);
    return inOrder(name, async () => {
      try {
        await fs.unlink(path.join(dir, name));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    });
  }

  return { list, counts, keep, drop, all };
}

// What quitting asks, from the unsaved edits ([{ rel, kept, error }]) and
// the programs running in terminals (their names). null when nothing would
// be lost or ended, so it quits without asking. One question covers both,
// asked before anything is ended, so Cancel leaves everything as it was.
function quitQuestion(edits, running) {
  if (!edits.length && !running.length) return null;
  const names = (list) => (list.length <= 3 ? list.join(', ') : list.slice(0, 3).join(', ') + ' and ' + (list.length - 3) + ' more');
  const lines = [];
  const keptOnes = edits.filter((d) => d.kept).map((d) => d.rel);
  const lost = edits.filter((d) => !d.kept);
  if (keptOnes.length) {
    lines.push('Unsaved ' + (keptOnes.length === 1 ? 'edit to ' : 'edits to ') + names(keptOnes) + (keptOnes.length === 1 ? ' is' : ' are')
      + ' kept by next-invader and ' + (keptOnes.length === 1 ? 'comes' : 'come') + ' back when you open this folder again. '
      + (keptOnes.length === 1 ? 'It is' : 'They are') + ' not in the ' + (keptOnes.length === 1 ? 'file' : 'files') + ' until you save.');
  }
  if (lost.length) {
    const why = lost.find((d) => d.error)?.error;
    lines.push('Your unsaved ' + (lost.length === 1 ? 'edit to ' : 'edits to ') + names(lost.map((d) => d.rel)) + (lost.length === 1 ? ' is' : ' are')
      + ' not kept for recovery' + (why ? ' (' + why.replace(/\.$/, '') + ')' : '') + ', and ' + (lost.length === 1 ? 'is' : 'are') + ' lost if you quit without saving.');
  }
  if (running.length) {
    const uniq = [...new Set(running)];
    lines.push('Quitting ends ' + names(uniq) + ' running in ' + (running.length === 1 ? 'a terminal' : running.length + ' terminals') + '. Nothing is started again when you open next-invader next time.');
  }
  const buttons = edits.length ? ['Save and Quit', 'Quit', 'Cancel'] : ['Quit', 'Cancel'];
  return {
    message: edits.length ? 'Quit next-invader with unsaved edits?' : 'Quit next-invader?',
    detail: lines.join('\n\n'),
    buttons,
    defaultId: edits.length ? 0 : 1,
    cancelId: buttons.length - 1,
  };
}

module.exports = { quitQuestion, store, isDraftPath, MAX_KEPT, MAX_TEXT, MAX_TOTAL, KIT };
