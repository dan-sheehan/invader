// Which addresses the preview may show, read with the URL parser rather than
// by eye. Only a page on this computer: http or https, to localhost, a name
// ending .localhost, 127.x.x.x or [::1], with no name or password in it.
// Anything else is not shown in the preview; a web address may be offered to
// the browser instead, when I click to open it there.

// A few ways I might type one: a port on its own, like 5173, or an address
// without its http://, like localhost:5173/about.
function typed(input) {
  const text = String(input ?? '').trim();
  if (/^\d{1,5}$/.test(text)) return 'http://localhost:' + text + '/';
  if (/^(localhost|\[::1\]|127(\.\d{1,3}){3}|[\w.-]+\.localhost)(:\d{1,5})?([/?#]|$)/i.test(text)) return 'http://' + text;
  return text;
}

function loopbackHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '[::1]') return true;
  // The parser has already turned forms like 2130706433 or 0x7f.1 into
  // four plain numbers, so this is the address it will connect to.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

// { ok: true, url } with the address written out in full, or { ok: false, why }.
function admit(input) {
  const text = typed(input);
  if (!text) return { ok: false, why: 'Type the address your server printed, like http://localhost:5173.' };
  if (text.length > 2048 || /[\x00-\x1f\x7f]/.test(text)) return { ok: false, why: 'That is not an address.' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, why: 'That is not an address. Type it like http://localhost:5173.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, why: 'Only http and https pages on this computer open in the preview.' };
  if (url.username || url.password) return { ok: false, why: 'An address with a name or password in it does not open in the preview.' };
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]') {
    return { ok: false, why: 'Servers print ' + url.hostname + ' to mean every address. Open http://localhost' + (url.port ? ':' + url.port : '') + url.pathname + ' instead.' };
  }
  if (!loopbackHost(url.hostname)) return { ok: false, why: url.hostname + ' is not on this computer. The preview only shows pages served here, like http://localhost:5173.' };
  return { ok: true, url: url.href };
}

// A web address the browser may be asked to open: http or https, with no
// name or password. The browser, not invader, decides what happens next.
function forBrowser(input) {
  let url;
  try {
    url = new URL(String(input ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

module.exports = { admit, forBrowser, loopbackHost };
