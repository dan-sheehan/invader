// Hiding secrets in agent setup files shown from outside the open folder.
// The patterns come from cockpit-v2. They catch what looks like a key, token
// or password; values under env and headers are hidden whatever they look
// like, by the code that shows those files.

const HIDDEN = '[hidden]';

function redact(text) {
  return String(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, HIDDEN)
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer ' + HIDDEN)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1' + HIDDEN + '@')
    .replace(/(--?(?:token|api[-_]?key|secret|password|passwd|passphrase|credential|authorization))([=\s]+)(?:"[^"\n]*"|'[^'\n]*'|[^\s"',]+)/gi, '$1$2' + HIDDEN)
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, HIDDEN)
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, HIDDEN)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|glpat-[A-Za-z0-9_-]+|xox[abprs]-[A-Za-z0-9-]+|npm_[A-Za-z0-9]{36}|pypi-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}|shpat_[a-f0-9]{32})/g, HIDDEN)
    .replace(/\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/g, HIDDEN)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, HIDDEN);
}

// A command's arguments with the value after a secret-sounding flag hidden,
// as in ["--api-key", "abc"].
function redactArgs(args) {
  return args.map((a, i) => (i > 0 && /^--?(token|api[-_]?key|secret|password|passwd|passphrase|credential|authorization)$/i.test(args[i - 1]) ? HIDDEN : redact(a)));
}

// Keys whose values are always hidden, wherever they sit in a JSON file.
const SECRET_KEYS = /^(env|headers|http_headers|env_http_headers)$/i;

// A parsed JSON value with the values under SECRET_KEYS hidden, a command's
// args as redactArgs leaves them, and the rest passed through redact.
function redactJson(value, hideAll = false, key = '') {
  if (Array.isArray(value)) {
    if (!hideAll && key === 'args' && value.every((v) => typeof v === 'string')) return redactArgs(value);
    return value.map((v) => redactJson(v, hideAll));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactJson(v, hideAll || SECRET_KEYS.test(k), k)]));
  }
  if (hideAll) return HIDDEN;
  return typeof value === 'string' ? redact(value) : value;
}

// A TOML key, or a table's name, with env or headers anywhere in it, like
// mcp_servers.x.env, 'env' or env.KEY.
const secretKey = (key) => key.replace(/["']/g, '').split('.').some((part) => SECRET_KEYS.test(part.trim()));

// What a piece of a TOML line leaves open at its end: a string in three
// quotes, and how many brackets and braces. The lines after it belong to the
// same value until they close.
function leftOpen(text, quotes = null, depth = 0) {
  let i = 0;
  while (i < text.length) {
    if (quotes) {
      const end = text.indexOf(quotes, i);
      if (end < 0) return { quotes, depth };
      i = end + 3;
      quotes = null;
    } else if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      quotes = text.slice(i, i + 3);
      i += 3;
    } else if (text[i] === '"') {
      const string = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i));
      i += string ? string[0].length : text.length;
    } else if (text[i] === "'") {
      const end = text.indexOf("'", i + 1);
      i = end < 0 ? text.length : end + 1;
    } else if (text[i] === '#') {
      break;
    } else {
      if (text[i] === '[' || text[i] === '{') depth++;
      if (text[i] === ']' || text[i] === '}') depth--;
      i++;
    }
  }
  return { quotes, depth: Math.max(0, depth) };
}

// TOML text with the values in env and header tables hidden, line by line:
// [x.env] tables, env = { ... }, env.KEY = ..., and every line of such a
// value that runs on over several lines. Where it cannot tell, it hides.
function redactToml(text) {
  let table = false;                     // the lines are in an env or headers table
  let open = { quotes: null, depth: 0 }; // what the value so far leaves open
  let hiding = false;                    // the value running on is hidden
  return text.split('\n').map((line) => {
    const within = !!open.quotes || open.depth > 0;
    // Inside a string, or a value being hidden, until it closes.
    if (within && (hiding || open.quotes)) {
      open = leftOpen(line, open.quotes, open.depth);
      const out = hiding ? HIDDEN : redact(line);
      if (!open.quotes && open.depth === 0) hiding = false;
      return out;
    }
    if (!within) {
      const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
      if (header) {
        table = secretKey(header[1]);
        return line;
      }
    }
    const eq = line.indexOf('=');
    const comment = /^\s*#/.test(line);
    const secret = eq > 0 && ((!within && table) || (!comment && secretKey(line.slice(0, eq))));
    const value = eq > 0 && !comment ? line.slice(eq + 1) : line;
    open = leftOpen(value, null, open.depth);
    if (!secret) return redact(line);
    hiding = !!open.quotes || open.depth > 0;
    if (!within && !table && /^\s*\{/.test(value)) return line.slice(0, eq + 1) + /^\s*/.exec(value)[0] + '{ ' + HIDDEN + ' }';
    return line.slice(0, eq) + '= "' + HIDDEN + '"';
  }).join('\n');
}

module.exports = { redact, redactArgs, redactJson, redactToml };
