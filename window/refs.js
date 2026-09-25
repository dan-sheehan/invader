// References to files: in a line of terminal output, like src/app.js:12:5,
// and in a Markdown link, like ../README.md#setup. Only reading text here;
// whether a path is really there, and inside the open folder, is asked of
// main (disk.where, disk.readFile), which checks it after following symlinks.

// A path as programs print it: no spaces, at least one / or a name with an
// extension, and not part of a web address.
const PATH_CHARS = "[\\w.~@+\\-/]";
const REF = new RegExp(
  '(?<![\\w.~@+\\-/:])(' + PATH_CHARS + '*[\\w\\-]' + ')' // the path
  + '(?:'
  + ':(\\d+)(?::(\\d+))?' // :12 or :12:5
  + '|\\((\\d+)(?:,\\s?(\\d+))?\\)' // (12) or (12,5)
  + '|#L(\\d+)' // #L12
  + '|",? line (\\d+)' // Python: File "app.py", line 12
  + ')?',
  'g',
);

const URL_AT = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

function looksLikePath(p) {
  if (p.length < 3 || p.length > 1024 || /^\d+(\.\d+)*$/.test(p)) return false;
  if (p.includes('/')) return /[\w\-]/.test(p) && !p.startsWith('//');
  // A name on its own counts only with an extension, like app.js.
  return /^[\w\-.@+]*[\w\-]\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(p);
}

// Every file reference in one line of text: where it is in the line, how
// long, the path, and the line and column it names, if any.
function findRefs(text) {
  text = String(text);
  const urls = [...text.matchAll(URL_AT)].map((u) => [u.index, u.index + u[0].length]);
  const out = [];
  for (const m of text.matchAll(REF)) {
    const start = m.index;
    if (urls.some(([a, b]) => start < b && start + m[0].length > a)) continue;
    let p = m[1];
    const line = Number(m[2] || m[4] || m[6] || m[7]) || null;
    const col = Number(m[3] || m[5]) || null;
    let length = m[0].length;
    // Dots after a path, as at the end of a sentence, are not part of it.
    if (!line) {
      const bare = p.replace(/\.+$/, '');
      length -= p.length - bare.length;
      p = bare;
    }
    if (!looksLikePath(p)) continue;
    out.push({ index: start, length, path: p, line, col });
  }
  return out;
}

// Addresses on this computer in a line of text, like the one a dev server
// prints: http or https to localhost, a name ending .localhost, 127.x.x.x or
// [::1]. Only these are offered to the preview, and main checks each again
// (main/address.js) before loading it. Stops at a space, a quote or a
// bracket, and leaves off punctuation that ends a sentence.
function findLocalUrls(text) {
  const out = [];
  for (const m of String(text).matchAll(/\bhttps?:\/\/[^\s'"<>`]+/gi)) {
    const found = m[0].replace(/[.,;:!?)\]}]+$/, '');
    let url;
    try {
      url = new URL(found);
    } catch {
      continue;
    }
    const h = url.hostname.toLowerCase();
    const local = h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
    if (!local || url.username || url.password) continue;
    out.push({ index: m.index, length: found.length, url: url.href });
  }
  return out;
}

// Where a Markdown link leads, from the document holding it: a path the
// window uses (relative to the open folder, or ~/kit/...), the #section it
// names, and a line when the section is like #L12. null for web and mail
// addresses, a link to nothing but a #section, or one that steps up out of
// the open folder or the kit. root: the open folder's absolute path, so a
// link written as an absolute path inside it still works.
function linkTarget(href, from, root) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const hash = href.indexOf('#');
  let p = (hash === -1 ? href : href.slice(0, hash)).split('?')[0];
  const section = hash === -1 ? null : href.slice(hash + 1) || null;
  if (!p) return null;
  try {
    p = decodeURI(p);
  } catch {
    return null;
  }
  let parts;
  let top = [];
  if (p.startsWith('/')) {
    if (!root || !p.startsWith(root + '/')) return null;
    parts = p.slice(root.length + 1).split('/');
  } else {
    if (from == null) return null;
    const dir = from.split('/').slice(0, -1);
    // A document in the kit links within the kit.
    if (dir[0] === '~' && dir[1] === 'kit') top = dir.splice(0, 2);
    parts = dir.concat(p.split('/'));
  }
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  if (!out.length && !top.length) return null;
  const line = section && /^L\d+$/.test(section) ? Number(section.slice(1)) : null;
  return { path: top.concat(out).join('/'), section: line ? null : section, line };
}

// A reference to put in the terminal or a prompt: the path, and the line or
// lines when there are some, like src/app.js:12 or src/app.js:12-18.
function reference(rel, from, to) {
  if (!from) return rel;
  return rel + ':' + from + (to && to !== from ? '-' + to : '');
}

// Every file or folder a relative path printed in a terminal could mean,
// from the names in the open folder and the kit: the ones whose path is it,
// or ends with it after a folder, like a/notes.md for notes.md. A shell
// knows where it is, but not where every command it ran was: a subshell or a
// script may have printed the path from another folder. null for a path that
// steps up with .., which only the folder it was printed in could settle.
const MAX_CANDIDATES = 50;
function refCandidates(p, files) {
  let norm = String(p);
  while (norm.startsWith('./')) norm = norm.slice(2);
  norm = norm.replace(/\/+$/, '');
  if (!norm || norm.startsWith('/') || norm.startsWith('~') || norm.split('/').some((part) => part === '..' || part === '.' || part === '')) return null;
  const out = [];
  for (const f of files) {
    if (f.path === norm || f.path.endsWith('/' + norm)) out.push(f.path);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { findRefs, findLocalUrls, linkTarget, reference, looksLikePath, refCandidates };
