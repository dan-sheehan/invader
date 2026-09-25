// Checks a map.json against the disk. The file is data: it is parsed, never
// run, and nothing drawn in the window comes from it except checked text.
//
// A file that is not JSON or not the shape in README.md is refused whole.
// A box whose paths do not all exist is dropped, and so is an arrow whose
// boxes, file or text do not hold. Every drop is listed with its reason.

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_FILE_BYTES = 2 * 1024 * 1024;

class ShapeError extends Error {}

function need(ok, message) {
  if (!ok) throw new ShapeError(message);
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';

// The parsed file, checked against the shape. Throws ShapeError.
function shape(data) {
  need(data && typeof data === 'object' && !Array.isArray(data), 'The file is not a JSON object.');
  need(Array.isArray(data.groups), '"groups" must be a list.');
  need(data.arrows === undefined || Array.isArray(data.arrows), '"arrows" must be a list.');
  const ids = new Set();
  const groups = data.groups.map((g, gi) => {
    const where = 'group ' + (gi + 1);
    need(g && typeof g === 'object', where + ' is not an object.');
    need(isText(g.label), where + ' needs a "label".');
    need(Array.isArray(g.boxes), where + ' ("' + g.label + '") needs a "boxes" list.');
    return {
      label: g.label,
      boxes: g.boxes.map((b, bi) => {
        const at = 'box ' + (bi + 1) + ' in group "' + g.label + '"';
        need(b && typeof b === 'object', at + ' is not an object.');
        need(isText(b.id), at + ' needs an "id".');
        need(!ids.has(b.id), 'Box id "' + b.id + '" is used twice.');
        ids.add(b.id);
        need(isText(b.label), 'Box "' + b.id + '" needs a "label".');
        need(Array.isArray(b.paths) && b.paths.length > 0 && b.paths.every(isText),
          'Box "' + b.id + '" needs "paths", a list of one or more paths.');
        return { id: b.id, label: b.label, paths: b.paths };
      }),
    };
  });
  const arrows = (data.arrows || []).map((a, ai) => {
    const at = 'arrow ' + (ai + 1);
    need(a && typeof a === 'object', at + ' is not an object.');
    for (const key of ['from', 'to', 'label', 'file', 'text']) {
      need(isText(a[key]), at + ' needs a "' + key + '".');
    }
    return { from: a.from, to: a.to, label: a.label, file: a.file, text: a.text };
  });
  return { groups, arrows };
}

// Where a path leads. from and p are relative to root. Symlinks are followed,
// so a link inside root that points outside it counts as outside.
// Returns { rel, real, dir } when it holds, else { problem: 'outside' | 'missing' }.
async function locate(root, from, p) {
  const abs = path.resolve(root, from, p);
  if (abs !== root && !abs.startsWith(root + path.sep)) return { problem: 'outside' };
  let real;
  let realRoot;
  try {
    real = await fs.realpath(abs);
    realRoot = await fs.realpath(root);
  } catch {
    return { problem: 'missing' };
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return { problem: 'outside' };
  let info;
  try {
    info = await fs.stat(real);
  } catch {
    return { problem: 'missing' };
  }
  if (!info.isDirectory() && !info.isFile()) return { problem: 'missing' };
  return { rel: path.relative(root, abs), real, dir: info.isDirectory() };
}

// Why a box path does not hold, or null when it does.
function pathProblem(found, p) {
  if (found.problem === 'outside') return p + ' is outside the open folder';
  if (found.problem === 'missing') return p + ' does not exist';
  if (p.endsWith('/') && !found.dir) return p + ' is not a folder';
  return null;
}

// root: the open folder. mapRel: the map.json's path inside it. text: its contents.
async function checkMap(root, mapRel, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: 'Not valid JSON: ' + err.message };
  }
  let map;
  try {
    map = shape(data);
  } catch (err) {
    if (err instanceof ShapeError) return { error: err.message };
    throw err;
  }

  const mapDir = path.dirname(mapRel);
  const dropped = [];
  const kept = new Map();
  const groups = [];
  for (const g of map.groups) {
    const boxes = [];
    for (const b of g.boxes) {
      const paths = [];
      let problem = null;
      for (const p of b.paths) {
        const found = await locate(root, mapDir, p);
        problem = pathProblem(found, p);
        if (problem) break;
        paths.push({ path: p, rel: found.rel, dir: found.dir });
      }
      if (problem) {
        dropped.push({ what: 'box', name: b.id, label: b.label, reason: problem });
        continue;
      }
      const box = { id: b.id, label: b.label, paths };
      kept.set(b.id, box);
      boxes.push(box);
    }
    groups.push({ label: g.label, boxes });
  }

  const texts = new Map();
  async function readText(real) {
    if (!texts.has(real)) {
      let text = null;
      try {
        if ((await fs.stat(real)).size <= MAX_FILE_BYTES) text = await fs.readFile(real, 'utf8');
      } catch {
        text = null;
      }
      texts.set(real, text);
    }
    return texts.get(real);
  }

  const known = new Set(map.groups.flatMap((g) => g.boxes.map((b) => b.id)));
  const arrows = [];
  for (const a of map.arrows) {
    const name = a.from + ' → ' + a.to;
    const drop = (reason) => dropped.push({ what: 'arrow', name, label: a.label, reason });
    const missing = [a.from, a.to].find((id) => !kept.has(id));
    if (missing) {
      drop(known.has(missing) ? 'box "' + missing + '" was dropped' : 'no box has id "' + missing + '"');
      continue;
    }
    const found = await locate(root, mapDir, a.file);
    if (found.problem === 'outside') {
      drop(a.file + ' is outside the open folder');
      continue;
    }
    if (found.problem || found.dir) {
      drop(a.file + ' does not exist');
      continue;
    }
    const text = await readText(found.real);
    if (text === null) {
      drop(a.file + ' could not be read');
      continue;
    }
    if (!text.includes(a.text)) {
      drop('text not found in ' + a.file);
      continue;
    }
    arrows.push({ ...a, rel: found.rel });
  }

  return { groups, arrows, dropped };
}

module.exports = { checkMap, locate };
