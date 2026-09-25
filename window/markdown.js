// Markdown. Built node by node with textContent. HTML tokens are dropped,
// images are shown as their alt text, and nothing is fetched.

// The document being drawn, whose links lead from where it is: its path in
// the open folder or the kit, or null for one outside both, whose relative
// links lead nowhere.
let mdFrom = null;

// from: given for a whole document. Its links then lead from it, and each
// paragraph, heading or other block says the line it starts on, so a line
// can be gone to in the rendered page.
function blocks(tokens, parent, from) {
  if (from === undefined) {
    for (const t of tokens || []) {
      const node = block(t);
      if (node) parent.append(node);
    }
    return parent;
  }
  const was = mdFrom;
  mdFrom = from;
  try {
    if (from) parent.dataset.from = from;
    let line = 1;
    for (const t of tokens || []) {
      const node = block(t);
      if (node?.nodeType === 1) node.dataset.line = line;
      if (node) parent.append(node);
      line += (t.raw?.match(/\n/g) || []).length;
    }
    return parent;
  } finally {
    mdFrom = was;
  }
}

function block(t) {
  switch (t.type) {
    case 'heading': {
      const h = inline(t.tokens, el('h' + t.depth));
      h.dataset.slug = slug(h.textContent);
      return h;
    }
    case 'paragraph':
      return inline(t.tokens, el('p'));
    case 'text':
      return t.tokens ? inline(t.tokens, el('span')) : document.createTextNode(decode(t.text));
    case 'code': {
      const pre = el('pre', 'mono');
      pre.append(el('code', null, t.text));
      return pre;
    }
    case 'blockquote':
      return blocks(t.tokens, el('blockquote'));
    case 'list': {
      const list = el(t.ordered ? 'ol' : 'ul');
      if (t.ordered && typeof t.start === 'number') list.start = t.start;
      for (const item of t.items) list.append(blocks(item.tokens, el('li', item.task ? 'task' : '')));
      return list;
    }
    case 'checkbox':
      return checkbox(t);
    case 'table':
      return table(t);
    case 'hr':
      return el('hr');
    case 'html':
    case 'space':
    case 'def':
      return null;
    default:
      return t.raw ? el('p', null, t.raw) : null;
  }
}

function inline(tokens, parent) {
  for (const t of tokens || []) {
    const node = inlineNode(t);
    if (node) parent.append(node);
  }
  return parent;
}

function inlineNode(t) {
  switch (t.type) {
    case 'text':
      return t.tokens ? inline(t.tokens, document.createDocumentFragment()) : document.createTextNode(decode(t.text));
    case 'escape':
      return document.createTextNode(t.text);
    case 'strong':
    case 'em':
    case 'del':
      return inline(t.tokens, el(t.type));
    case 'codespan':
      return el('code', 'mono', t.text);
    case 'br':
      return el('br');
    case 'link':
      return link(t);
    case 'image':
      return el('span', 'dim', t.text ? '[image: ' + t.text + ']' : '[image]');
    case 'checkbox':
      return checkbox(t);
    case 'html':
      return null;
    default:
      return t.raw ? document.createTextNode(t.raw) : null;
  }
}

function link(t) {
  const target = linkTarget(t.href, mdFrom, state.root);
  const section = t.href?.includes('#') ? t.href.slice(t.href.indexOf('#') + 1) : null;
  if (target) {
    const a = inline(t.tokens, el('span', 'link'));
    a.title = target.path + (target.line ? ':' + target.line : section ? '#' + section : '');
    a.addEventListener('click', () => openLinked(target.path, null, target.section, target.line ? { line: target.line } : null, { ifThere: true }));
    return a;
  }
  if (t.href?.startsWith('#') && section) {
    const a = inline(t.tokens, el('span', 'link'));
    a.title = t.href;
    a.addEventListener('click', () => goToSection(section));
    return a;
  }
  const span = inline(t.tokens, el('span'));
  if (t.href && t.href !== t.text) span.append(el('span', 'mono dim', ' <' + t.href + '>'));
  return span;
}

function checkbox(t) {
  return el('span', 'mono muted', t.checked ? '[x] ' : '[ ] ');
}

function table(t) {
  const tbl = el('table');
  const cell = (c, tag, i) => {
    const node = inline(c.tokens, el(tag));
    if (t.align[i]) node.style.textAlign = t.align[i];
    return node;
  };
  const head = el('tr');
  t.header.forEach((c, i) => head.append(cell(c, 'th', i)));
  tbl.append(head);
  for (const row of t.rows) {
    const tr = el('tr');
    row.forEach((c, i) => tr.append(cell(c, 'td', i)));
    tbl.append(tr);
  }
  return tbl;
}

// Markdown text keeps entities like &amp; as written; show the character.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', mdash: '—', ndash: '–', hellip: '…' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
