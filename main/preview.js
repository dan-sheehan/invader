// The preview: a page served on this computer, like the one a dev server I
// started in the terminal serves, shown in the middle of the window.
//
// The page is not trusted. It runs in a view of its own, apart from the
// window: its own sandboxed process, no Node, no preload and so none of the
// window's bridge to the disk or the terminal, and its own session, kept in
// memory only, so it shares no storage or cookies with the window. Its top
// page may only be an address address.js admits: http or https on this
// computer. Going anywhere else, by a link, a script or a redirect, is
// stopped, and the window offers to open it in the browser instead; nothing
// opens there unless I click. New windows, downloads and permission requests
// are refused. What the page itself fetches, like fonts, scripts or an API,
// goes wherever the page asks, as in any browser: only the page shown is
// kept on this computer.

const { WebContentsView, session, shell: electronShell } = require('electron');
const { admit, forBrowser } = require('./address');

const PARTITION = 'invader-preview'; // no persist: prefix, so kept in memory only
// A load stopped, by me or by a navigation refused here, is not a failure to show.
const STOPPED = new Set([-3, -20]); // ERR_ABORTED, ERR_BLOCKED_BY_CLIENT

let view = null;
let win = null;
let toWindow = () => {};
let placed = null; // where the window last asked for it, in its own pixels
let blocked = null; // the last address refused, offered to the browser
let said = {};
// A certificate the page's server made itself is trusted only when I say so,
// for that address and that certificate, until the app quits: origin ->
// fingerprint. certAsk is the one last refused, which the window can offer.
const trusted = new Map();
let certAsk = null;
let finding = null; // the text last found in the page

function connect(window, send) {
  win = window;
  toWindow = send;
  win.on('closed', () => {
    view = null;
    win = null;
  });
}

let guarded = false;
function guardSession() {
  if (guarded) return;
  guarded = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event, item) => {
    event.preventDefault();
    tell({ note: 'The page tried to download ' + (item.getFilename() || 'a file') + '. The preview does not save downloads; open the page in your browser for that.' });
  });
  // Every top page, however it was asked for, is checked once more here.
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'mainFrame' && !admit(details.url).ok) {
      refuse(details.url);
      return callback({ cancel: true });
    }
    callback({});
  });
}

function create() {
  guardSession();
  view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: false,
      spellcheck: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  view.setVisible(false);
  win.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    refuse(url, 'window');
    return { action: 'deny' };
  });
  const check = (event, url, isMainFrame) => {
    if (isMainFrame === false) return;
    if (admit(url).ok) return;
    event.preventDefault();
    refuse(url);
  };
  wc.on('will-navigate', (event) => check(event, event.url, event.isMainFrame));
  wc.on('will-redirect', (event) => check(event, event.url, event.isMainFrame));
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('did-start-loading', () => tell({ loading: true, error: null }));
  wc.on('did-stop-loading', () => tell({ loading: false }));
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || STOPPED.has(code)) return;
    tell({ loading: false, error: { code, description: description || 'did not load', url } });
    show();
  });
  wc.on('did-navigate', (_e, url) => {
    tell({ url, error: null, crashed: null, certificate: null });
    show();
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && tell({ url }));
  wc.on('page-title-updated', (_e, title) => tell({ title }));
  wc.on('render-process-gone', (_e, details) => {
    tell({ loading: false, crashed: details.reason });
    show();
  });
  // A local page on https usually has a certificate the dev server made
  // itself, which no browser trusts. It is refused, and the window says why
  // and offers to trust that certificate for that address until the app
  // quits, or to open the page in the browser. Nothing else about checking
  // certificates changes, here or anywhere in the app.
  wc.on('certificate-error', (event, url, error, cert, callback) => {
    let origin = null;
    try {
      origin = admit(url).ok ? new URL(url).origin : null;
    } catch {}
    if (origin && trusted.get(origin) === cert.fingerprint) {
      event.preventDefault();
      return callback(true);
    }
    callback(false);
    if (!origin) return;
    certAsk = { origin, fingerprint: cert.fingerprint, url };
    tell({ certificate: { origin, url: String(url).slice(0, 300), error: String(error).slice(0, 100), issuer: String(cert.issuerName || '').slice(0, 200) } });
  });
  wc.on('found-in-page', (_e, r) => tell({ find: { matches: r.matches, at: r.activeMatchOrdinal, final: r.finalUpdate } }));
}

// The window hears what the page is doing: where it is, whether it loads,
// why it did not, and whether it can go back or forward.
function tell(change) {
  said = { ...said, ...change };
  const wc = view?.webContents;
  const history = wc && !wc.isDestroyed() ? wc.navigationHistory : null;
  toWindow('preview:state', {
    live: !!view,
    url: said.url ?? null,
    title: said.title ?? '',
    loading: !!said.loading,
    error: said.error ?? null,
    crashed: said.crashed ?? null,
    note: change.note ?? null,
    certificate: said.certificate ?? null,
    find: change.find ?? null,
    blocked: change.blocked ?? null,
    back: !!history?.canGoBack(),
    forward: !!history?.canGoForward(),
  });
}

// An address the page tried to reach that the preview does not show. The
// window says so, and offers the browser when it is a web address.
function refuse(url, how = 'page') {
  const web = forBrowser(url);
  blocked = web;
  tell({ blocked: { url: String(url).slice(0, 300), how, browser: !!web, local: admit(url).ok } });
}

// Shown only while the window has a place for it and nothing lies over it,
// and not while it has nothing to show but an error, which the window draws.
function show() {
  if (!view) return;
  const visible = !!placed && !said.error && !said.crashed;
  if (visible) {
    const zoom = win.webContents.getZoomFactor();
    const r = (n) => Math.round(n * zoom);
    view.setBounds({ x: r(placed.x), y: r(placed.y), width: r(placed.width), height: r(placed.height) });
  }
  view.setVisible(visible);
}

function place(rect) {
  const n = (v) => typeof v === 'number' && Number.isFinite(v);
  placed = rect && n(rect.x) && n(rect.y) && n(rect.width) && n(rect.height) && rect.width > 0 && rect.height > 0 ? rect : null;
  show();
}

// Load an address I typed or clicked. Returns the address written out, or throws why not.
function open(input) {
  const res = admit(input);
  if (!res.ok) throw new Error(res.why);
  if (!win || win.isDestroyed()) throw new Error('No window');
  if (!view) create();
  said = { url: res.url };
  finding = null;
  tell({ loading: true, error: null, crashed: null, certificate: null });
  view.webContents.loadURL(res.url).catch(() => {}); // failures arrive as did-fail-load
  show();
  return res.url;
}

function go(what) {
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (what === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (what === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  else if (what === 'stop') wc.stop();
  else if (what === 'reload') {
    // After an error or a crash, loading the address again is the retry.
    if (said.error || said.crashed || said.certificate) return open(said.error?.url || said.url);
    tell({ error: null });
    wc.reload();
  }
}

// Open in the browser: the page shown, or the address last refused. Only
// these two, and only web addresses; the window cannot name any other.
function external(which) {
  // After a failed load the page shown is an error page; the address is what was asked for.
  const shown = said.error ? said.error.url || said.url : view?.webContents.getURL() || said.url;
  const url = which === 'blocked' ? blocked : forBrowser(shown);
  if (!url) throw new Error('Nothing to open in the browser');
  return electronShell.openExternal(url);
}

// Trust the certificate last refused, for its address only, until the app
// quits, and load the page again. The window cannot name a certificate.
function trust() {
  if (!certAsk || !view) throw new Error('No certificate to trust');
  trusted.set(certAsk.origin, certAsk.fingerprint);
  const url = certAsk.url;
  certAsk = null;
  return open(url);
}

// Find text in the page, with the page's own find, as a browser does. step:
// 0 for new text, 1 or -1 for the next or previous place. Empty text stops.
function find(text, step = 0, matchCase = false) {
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return false;
  if (typeof text !== 'string' || !text || text.length > 1000) {
    stopFind();
    return false;
  }
  const again = step !== 0 && finding === text;
  finding = text;
  wc.findInPage(text, { forward: step >= 0, findNext: !again, matchCase: matchCase === true });
  return true;
}
function stopFind() {
  finding = null;
  const wc = view?.webContents;
  if (wc && !wc.isDestroyed()) wc.stopFindInPage('keepSelection');
}

// Give the page the keyboard, as when a palette opened over it closes.
function focus() {
  const wc = view?.webContents;
  if (wc && !wc.isDestroyed() && view.getVisible()) wc.focus();
}

// Close the page. Whatever it was doing stops; the server it came from is
// not touched.
function close() {
  if (!view) return;
  const v = view;
  view = null;
  placed = null;
  said = {};
  blocked = null;
  certAsk = null;
  finding = null;
  if (win && !win.isDestroyed()) win.contentView.removeChildView(v);
  if (!v.webContents.isDestroyed()) v.webContents.close();
  toWindow('preview:state', { live: false, url: null, title: '', loading: false, error: null, crashed: null, note: null, blocked: null, back: false, forward: false, certificate: null, find: null });
}

// Whether the page has the keyboard, so keys meant for the terminal are not
// taken from it.
const focused = () => !!view && !view.webContents.isDestroyed() && view.webContents.isFocused();

// The page as it is drawn, for a test to look at.
const contents = () => view?.webContents ?? null;

module.exports = { connect, place, open, go, external, close, focused, contents, trust, find, stopFind, focus, PARTITION };
