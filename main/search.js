// Finding text in the open folder's files, when I ask (⇧⌘F). Plain text,
// found as written: no index, nothing kept between searches, nothing read
// until I search.
//
// It reads only files inside the open folder, after following symlinks, and
// never follows a symlinked folder. What it does not look in is said, never
// hidden: folders tools make (.git, node_modules and the build folders
// below), binary files, files over 2 MB, links leading outside, and anything
// past the limits. A new search stops the one before it, and so does
// switching folder, so a slow search never answers for the wrong folder.

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_MATCHES = 500;
const MAX_PER_FILE = 50;
const MAX_QUERY = 200;
const PREVIEW = 160;

// Folders tools make and keep, never written by hand. Their names are listed
// with the results when the folder has them.
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const BUILT_DIRS = new Set(['dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output', '.turbo', '.cache',
  '.parcel-cache', 'coverage', 'target', '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache']);

let current = 0;

// Stop the search running now, if any.
function stop() {
  current++;
}

// One line around where it matches, cut to about PREVIEW characters, with
// where each match falls in what is shown.
function preview(line, starts, length) {
  let from = 0;
  let to = line.length;
  if (line.length > PREVIEW) {
    from = Math.max(0, starts[0] - 50);
    to = Math.min(line.length, from + PREVIEW);
  }
  const cut = from > 0;
  // Leading spaces are not shown; the match stays where it is in the text.
  while (from < to && (line[from] === ' ' || line[from] === '\t') && from < starts[0]) from++;
  const text = (cut ? '…' : '') + line.slice(from, to) + (to < line.length ? '…' : '');
  const shift = (cut ? 1 : 0) - from;
  const hits = starts.filter((s) => s >= from && s + length <= to).map((s) => [s + shift, s + shift + length]);
  return { text, hits };
}

// The matches in one file's text: one per line, with every place on it.
// more: how many lines past MAX_PER_FILE also match.
function matchText(text, query, matchCase) {
  const needle = matchCase ? query : query.toLowerCase();
  if (!(matchCase ? text : text.toLowerCase()).includes(needle)) return { matches: [], more: 0 };
  const matches = [];
  let more = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const hay = matchCase ? line : line.toLowerCase();
    let s = hay.indexOf(needle);
    if (s === -1) continue;
    if (matches.length >= MAX_PER_FILE) {
      more++;
      continue;
    }
    const starts = [];
    for (; s !== -1; s = hay.indexOf(needle, s + needle.length)) starts.push(s);
    matches.push({ line: i + 1, col: starts[0] + 1, ...preview(line, starts, needle.length) });
  }
  return { matches, more };
}

// root: the open folder's real path. query: the text to find, as written.
async function searchText(root, query, { matchCase = false } = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Type something to find');
  if (query.length > MAX_QUERY) throw new Error('That is longer than ' + MAX_QUERY + ' characters');
  if (/[\r\n]/.test(query)) throw new Error('Search finds text on one line');
  const me = ++current;
  const realRoot = await fs.realpath(root);
  const result = {
    root,
    query,
    matchCase: !!matchCase,
    files: [],
    total: 0,
    searched: 0,
    skipped: { dirs: [], binary: 0, large: [], outside: 0, unreadable: 0 },
    stopped: false, // stopped at MAX_MATCHES or MAX_FILES
    cancelled: false,
  };
  const folders = [''];
  let seen = 0;
  while (folders.length) {
    const rel = folders.shift();
    let entries;
    try {
      entries = await fs.readdir(path.join(realRoot, rel), { withFileTypes: true });
    } catch {
      result.skipped.unreadable++;
      continue;
    }
    if (me !== current) return { root, query, cancelled: true };
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.name === '.DS_Store') continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || BUILT_DIRS.has(e.name)) result.skipped.dirs.push(p + '/');
        else folders.push(p);
        continue;
      }
      if (!e.isFile() && !e.isSymbolicLink()) continue;
      if (++seen > MAX_FILES || result.total >= MAX_MATCHES) {
        result.stopped = true;
        break;
      }
      let real = path.join(realRoot, p);
      try {
        if (e.isSymbolicLink()) {
          real = await fs.realpath(real);
          if (!real.startsWith(realRoot + path.sep)) {
            result.skipped.outside++;
            continue;
          }
        }
        const info = await fs.stat(real);
        if (!info.isFile()) continue;
        if (info.size > MAX_FILE_BYTES) {
          result.skipped.large.push(p);
          continue;
        }
        const buffer = await fs.readFile(real);
        if (me !== current) return { root, query, cancelled: true };
        if (buffer.subarray(0, 8000).includes(0)) {
          result.skipped.binary++;
          continue;
        }
        result.searched++;
        const { matches, more } = matchText(buffer.toString('utf8'), query, matchCase);
        if (!matches.length) continue;
        const room = MAX_MATCHES - result.total;
        const kept = matches.slice(0, room);
        if (kept.length < matches.length) result.stopped = true;
        result.total += kept.length;
        result.files.push({ path: p, matches: kept, more: more + matches.length - kept.length });
      } catch {
        result.skipped.unreadable++;
      }
    }
    if (result.stopped) break;
  }
  if (me !== current) return { root, query, cancelled: true };
  return result;
}

module.exports = { searchText, stop, matchText, preview, MAX_MATCHES, MAX_PER_FILE, MAX_FILE_BYTES, BUILT_DIRS };
