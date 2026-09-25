// A small TOML reader for Codex's config.toml, from cockpit-v2. It reads
// tables, keys, strings, numbers, booleans and one-line arrays and inline
// tables; lines it cannot read are counted, never shown.

const record = () => Object.create(null);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Split only outside quoted strings and containers; also remove comments.
function parts(text, separator) {
  const result = [];
  let part = '', quote = null, escaped = false, depth = 0;
  for (const ch of text) {
    if (quote) {
      part += ch;
      if (escaped) escaped = false;
      else if (quote === '"' && ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") { quote = ch; part += ch; }
    else if (ch === '#') break;
    else if (ch === '[' || ch === '{') { depth++; part += ch; }
    else if (ch === ']' || ch === '}') { depth--; part += ch; }
    else if (ch === separator && depth === 0) { result.push(part.trim()); part = ''; }
    else part += ch;
  }
  result.push(part.trim());
  return { result, open: depth > 0, invalid: quote !== null || depth < 0 };
}
function string(text) {
  if (text[0] === '"') return JSON.parse(text);
  if (/^'[^'\r\n]*'$/.test(text)) return text.slice(1, -1);
  throw new Error();
}
function keys(text) {
  const split = parts(text, '.');
  if (split.invalid || split.open) throw new Error();
  return split.result.map(key => {
    if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
    const value = string(key);
    if (typeof value !== 'string') throw new Error();
    return value;
  });
}
function value(text, inline = false) {
  text = text.trim();
  if (!text) throw new Error();
  if (text[0] === '"' || text[0] === "'") return string(text);
  if (/^(true|false)$/.test(text)) return text === 'true';
  if (/^[+-]?(?:\d+(?:_\d+)*(?:\.\d+(?:_\d+)*)?)(?:[eE][+-]?\d+(?:_\d+)*)?$/.test(text)) {
    const number = Number(text.replaceAll('_', ''));
    if (!Number.isFinite(number)) throw new Error();
    return number;
  }
  if (text[0] === '[' && text.endsWith(']')) {
    const body = text.slice(1, -1).trim();
    if (!body) return [];
    const split = parts(body, ',');
    if (split.invalid || split.open) throw new Error();
    if (split.result.at(-1) === '') split.result.pop();
    return split.result.map(part => {
      const parsed = value(part, true);
      if (typeof parsed === 'object') throw new Error();
      return parsed;
    });
  }
  if (!inline && text[0] === '{' && text.endsWith('}')) {
    const data = record(), body = text.slice(1, -1).trim();
    if (!body) return data;
    const split = parts(body, ',');
    if (split.invalid || split.open) throw new Error();
    for (const part of split.result) assign(data, part, true);
    return data;
  }
  throw new Error();
}
function descend(data, key) {
  if (!Object.hasOwn(data, key)) data[key] = record();
  let next = data[key];
  if (Array.isArray(next)) next = next.at(-1);
  if (!isRecord(next)) throw new Error();
  return next;
}
function assign(data, text, inline = false) {
  const split = parts(text, '=');
  if (split.invalid || split.open || split.result.length !== 2) throw new Error();
  const path = keys(split.result[0]), parsed = value(split.result[1], inline);
  for (const key of path.slice(0, -1)) data = descend(data, key);
  const key = path.at(-1);
  if (Object.hasOwn(data, key)) throw new Error();
  data[key] = parsed;
}
function parseToml(input) {
  const data = record(), errors = [];
  let current = data;
  const lines = String(input ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    let text = parts(lines[i], '\0').result[0];
    if (!text) continue;
    try {
      // Unsupported multiline strings are consumed as a unit, not as TOML keys.
      const assignment = parts(text, '=').result;
      const delimiter = assignment[1]?.match(/^("""|''')/)?.[0];
      if (delimiter) {
        if (!assignment[1].slice(3).includes(delimiter)) {
          while (i + 1 < lines.length) { i++; if (lines[i].includes(delimiter)) break; }
        }
        throw new Error();
      }
      if (text.startsWith('[')) {
        const array = text.startsWith('[['), end = array ? ']]' : ']';
        if (!text.endsWith(end)) throw new Error();
        const path = keys(text.slice(array ? 2 : 1, -end.length));
        let table = data;
        for (const key of path.slice(0, -1)) table = descend(table, key);
        const key = path.at(-1);
        if (array) {
          if (!Object.hasOwn(table, key)) table[key] = [];
          if (!Array.isArray(table[key])) throw new Error();
          current = record(); table[key].push(current);
        } else current = descend(table, key);
      } else {
        // Arrays can span lines. Stop before a new assignment/table on recovery.
        while (parts(text, '=').open && i + 1 < lines.length) {
          const next = parts(lines[i + 1], '\0').result[0];
          if (/^\[\[?\s*[A-Za-z_"']/.test(next) || parts(next, '=').result.length > 1) break;
          text += ' ' + next; i++;
        }
        assign(current, text);
      }
    } catch { errors.push({ line, message: 'Unsupported or invalid TOML syntax.' }); }
  }
  return { data, errors };
}

module.exports = { parseToml };
