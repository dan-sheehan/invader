// Finding a file or folder by typing part of its name, for the palette
// (window/palette.js).

// How well query matches text, like a path: null when its letters do not all
// appear in order. Letters that start a name, follow one another, or fall in
// the last part of the path count for more; a longer path counts for less.
// hits are the places matched, for marking them.
function fuzzy(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, hits: [] };
  const t = text.toLowerCase();
  const base = text.lastIndexOf('/', text.length - 2) + 1;
  // In the last part of the path alone, when it holds them all.
  const inBase = matchFrom(q, t, base);
  const hits = inBase || matchFrom(q, t, 0);
  if (!hits) return null;
  let score = 0;
  for (let i = 0; i < hits.length; i++) {
    const at = hits[i];
    const before = text[at - 1];
    if (at === 0 || before === '/' || before === '-' || before === '_' || before === '.' || before === ' ') score += 8;
    else if (text[at] !== t[at] && before === before?.toLowerCase()) score += 6; // camelCase
    if (i && hits[i - 1] === at - 1) score += 5;
    if (at >= base) score += 2;
  }
  if (inBase) score += 10;
  if (t.slice(base).startsWith(q)) score += 12;
  if (t.slice(base).replace(/\/$/, '') === q || t.slice(base).split('.')[0] === q) score += 20;
  score -= (hits[hits.length - 1] - hits[0]) * 0.5;
  score -= text.length * 0.1;
  return { score, hits };
}

// Where q's letters fall in t from start on, tightened from the end so the
// match is as short as it can be; null when they do not all appear.
function matchFrom(q, t, start) {
  let i = start;
  let end = -1;
  for (const ch of q) {
    i = t.indexOf(ch, i);
    if (i < 0) return null;
    end = i;
    i++;
  }
  const hits = [];
  let j = end;
  for (let k = q.length - 1; k >= 0; k--) {
    j = t.lastIndexOf(q[k], j);
    hits.unshift(j);
    j--;
  }
  return hits;
}

// The best matches for query among items, best first. key gives the text to
// match.
function rank(query, items, key, limit = 60) {
  const out = [];
  for (const item of items) {
    const m = fuzzy(query, key(item));
    if (m) out.push({ item, ...m });
  }
  out.sort((a, b) => b.score - a.score || key(a.item).localeCompare(key(b.item)));
  return out.slice(0, limit);
}

if (typeof module !== 'undefined') module.exports = { fuzzy, rank };
