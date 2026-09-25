// Preview: a page served on this computer, like the one my dev server serves,
// shown in the middle as a tab. I start the server myself in a terminal and
// type its address here; nothing is started, found or guessed for me.
//
// The page is not drawn by this window. Main shows it in a view of its own,
// with no way to the disk or the terminals (main/preview.js), and this page
// only says where the view goes: over the empty box in the middle while the
// Preview tab is shown and nothing lies over it, and nowhere otherwise. Going
// to another tab hides it without reloading it.

// url: the address shown last or typed, remembered with the folder's tabs.
// live: whether a page is loaded now. The rest is what main last said.
function resetPreview(url = null) {
  state.preview = { url, live: false, loading: false, error: null, crashed: null, title: '', back: false, forward: false, blocked: null, note: null, problem: null, certificate: null };
}
resetPreview();

async function showPreview() {
  if (!leaveEdit()) return;
  noteLeaving();
  nextTurn();
  state.page = 'preview';
  state.home = false;
  state.openFile = null;
  state.file = null;
  markOpenFile();
  drawFile();
  if (!state.preview.live) $('preview-address')?.focus();
}

// Load an address, typed or ⌘-clicked in a terminal. Main checks it again.
async function openPreview(input) {
  const res = await window.preview.open(input);
  const p = state.preview;
  if (res.ok) {
    Object.assign(p, { url: res.value, live: true, error: null, crashed: null, problem: null, blocked: null, note: null });
    saveWorkspaceSoon();
  } else {
    p.problem = res.error;
  }
  if (currentTab() !== 'preview') await showPreview();
  else drawPreviewState();
  placePreviewSoon();
}

window.preview.onState((s) => {
  const p = state.preview;
  const moved = s.url && s.url !== p.url;
  Object.assign(p, { live: s.live, loading: s.loading, error: s.error, crashed: s.crashed, title: s.title, back: s.back, forward: s.forward });
  if (s.url) p.url = s.url;
  if (s.blocked) p.blocked = s.blocked;
  if (s.note) p.note = s.note;
  p.certificate = s.certificate;
  if (s.find) pageFound(s.find);
  if (moved) saveWorkspaceSoon();
  if (currentTab() === 'preview') drawPreviewState();
});

const small = (label, title, fn, id) => {
  const b = el('button', 'quiet', label);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title.split(' (')[0]);
  if (id) b.id = id;
  b.addEventListener('click', fn);
  return b;
};

// A button with a long label and a short one for a narrow pane.
function labelled(button, long, short) {
  button.replaceChildren(el('span', 'long-label', long), el('span', 'short-label', short));
  return button;
}

// The line over the page: back, forward, reload, the address, what is
// happening, and Open in browser.
function drawPreviewPage(head, body) {
  const address = el('input', 'mono');
  address.id = 'preview-address';
  address.type = 'text';
  address.spellcheck = false;
  address.autocomplete = 'off';
  address.placeholder = 'http://localhost:5173';
  address.setAttribute('aria-label', 'Address of a page served on this computer');
  address.value = state.preview.url || '';
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      openPreview(address.value);
    } else if (e.key === 'Escape') {
      address.value = state.preview.url || '';
      state.preview.problem = null;
      drawPreviewState();
    }
  });
  head.classList.add('preview-head');
  head.append(
    small('‹', 'Back in the page', () => window.preview.go('back'), 'preview-back'),
    small('›', 'Forward in the page', () => window.preview.go('forward'), 'preview-forward'),
    small('↻', 'Load the page again (⌘R)', () => (state.preview.loading ? window.preview.go('stop') : reloadPreview()), 'preview-reload'),
    address,
    el('span', 'preview-status mono'),
    labelled(small('', 'Open this page in your web browser', () => window.preview.external('current').then((r) => !r.ok && say(r.error, { fade: true })), 'preview-external'), 'Open in browser', '↗'),
  );
  body.classList.add('preview-body');
  drawPreviewState();
}

async function trustCertificate() {
  const res = await window.preview.trust();
  if (!res.ok) say(res.error, { fade: true });
}

function reloadPreview() {
  const p = state.preview;
  if (p.live) window.preview.go('reload');
  else if (p.url) openPreview(p.url);
}

// What the page is doing, drawn into the line and the box under it. The box
// holding the page is kept while it stays up, so the view is not moved about.
function drawPreviewState() {
  const head = $('file-head');
  const body = $('file-body');
  if (!head.classList.contains('preview-head')) return;
  const p = state.preview;
  const address = $('preview-address');
  if (address && document.activeElement !== address && p.url) address.value = p.url;
  $('preview-back').disabled = !p.live || !p.back;
  $('preview-forward').disabled = !p.live || !p.forward;
  const reload = $('preview-reload');
  reload.textContent = p.loading ? '×' : '↻';
  reload.title = p.loading ? 'Stop loading' : 'Load the page again (⌘R)';
  reload.disabled = !p.live && !p.url;
  $('preview-external').disabled = !p.live || (!!p.error && !p.certificate);
  const status = head.querySelector('.preview-status');
  status.className = 'preview-status mono ' + (p.error || p.crashed ? 'error' : 'dim');
  status.textContent = p.loading ? 'loading' : p.error && p.certificate ? 'certificate not trusted' : p.error ? (noAnswer(p.error) ? 'not reachable' : 'did not load') : p.crashed ? 'stopped' : p.live ? '' : p.url ? 'not loaded' : '';
  status.title = p.live && p.title ? p.title : '';

  const bars = [];
  if (p.problem) bars.push(bar(p.problem, 'error'));
  if (p.blocked) {
    const b = p.blocked;
    const what = b.how === 'window' ? 'open a new window at ' : 'go to ';
    const why = b.local ? '' : b.browser ? ', which is not on this computer' : ', which the preview does not open';
    const actions = [];
    if (b.local && b.how === 'window') actions.push(['Open here', () => openPreview(b.url)]);
    else if (b.browser) actions.push(['Open in browser', () => window.preview.external('blocked')]);
    bars.push(bar('The page tried to ' + what + b.url + why + '. The preview stayed where it was.', null, actions, () => {
      p.blocked = null;
      drawPreviewState();
    }));
  }
  // Part of a page that loaded came from an address whose certificate is not trusted.
  if (p.certificate && !p.error) {
    bars.push(bar('Part of this page from ' + p.certificate.origin + ' was refused: its certificate is not trusted.', 'error', [['Trust it until I quit', trustCertificate]]));
  }
  if (p.note) bars.push(bar(p.note, null, [], () => {
    p.note = null;
    drawPreviewState();
  }));

  let main;
  if (p.live && !p.error && !p.crashed) {
    main = $('preview-slot') || el('div');
    main.id = 'preview-slot';
  } else {
    main = el('div', 'preview-empty');
    if (p.live && p.error && p.certificate) {
      const c = p.certificate;
      main.append(
        el('p', 'preview-said', c.origin + ' has a certificate this computer does not trust.'),
        el('p', 'muted', 'A dev server serving https often makes its own certificate' + (c.issuer ? ' (this one is from ' + c.issuer + ')' : '') + '. The reason given was ' + c.error.replace(/^net::/, '') + '. '
          + 'If you started this server, you can trust this certificate for ' + c.origin + ' until next-invader quits. Nothing is remembered, and no other address or certificate is trusted.'),
        buttons([['Trust it until I quit', trustCertificate, 'primary'], ['Open in browser', () => window.preview.external('current').then((r) => !r.ok && say(r.error, { fade: true }))]]),
      );
    } else if (p.live && p.error) {
      const why = p.error.description.replace(/^net::/, '');
      main.append(...(noAnswer(p.error) ? [
        el('p', 'preview-said', 'Nothing answered at ' + p.error.url),
        el('p', 'muted', why + '. This usually means the server is not running, or is on another port. Start it in a terminal, then try again.'),
      ] : [
        el('p', 'preview-said', p.error.url + ' did not load.'),
        el('p', 'muted', 'The reason given was ' + why + '.'),
      ]), buttons([['Try again', reloadPreview, 'primary'], ...(p.back ? [['Back', () => window.preview.go('back')]] : [])]));
    } else if (p.live && p.crashed) {
      main.append(el('p', 'preview-said', 'The page stopped (' + p.crashed + ').'), buttons([['Load it again', reloadPreview, 'primary']]));
    } else if (p.url) {
      main.append(
        el('p', 'preview-said', 'Last time, this folder showed ' + p.url),
        el('p', 'muted', 'It is not loaded until you ask, and nothing has been started: if its server is not running, start it in a terminal first.'),
        buttons([['Load', () => openPreview(p.url), 'primary']]),
      );
    } else {
      main.append(
        el('p', 'preview-said', 'See the page your project serves, beside its files.'),
        el('p', 'muted', 'Start its server in a terminal, for example with npm run dev, then type the address it prints above, like http://localhost:5173, and press Return. Only pages on this computer open here. ⌘-click an address like that in a terminal to open it here too.'),
      );
    }
  }
  const want = [...bars, main];
  if (want.length !== body.children.length || want.some((n, i) => body.children[i] !== n)) body.replaceChildren(...want);
  placePreviewSoon();
}

// Errors that mean no server answered at that address: refused, reset,
// closed, unreachable, timed out or empty.
const NO_ANSWER = new Set([-100, -101, -102, -104, -105, -106, -109, -118, -324]);
const noAnswer = (error) => NO_ANSWER.has(error.code);

function bar(text, kind, actions = [], dismiss = null) {
  const b = el('div', 'preview-bar' + (kind ? ' ' + kind : ''));
  b.append(el('span', null, text));
  for (const [label, fn] of actions) {
    const button = el('button', null, label);
    button.type = 'button';
    button.addEventListener('click', fn);
    b.append(button);
  }
  if (dismiss) b.append(small('×', 'Dismiss', dismiss));
  return b;
}

function buttons(list) {
  const row = el('div', 'preview-buttons');
  for (const [label, fn, cls] of list) {
    const b = el('button', cls || null, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    row.append(b);
  }
  return row;
}

// Where the page goes: over the box, in the window's own pixels. Nowhere
// while another tab is shown, the palette is open over it, or the window is
// hidden. Looked at every frame while a page is loaded, so dragging a pane
// or hiding the terminal moves it with the box.
let lastPlace = 'null';
let placing = false;
function placePreview() {
  const p = state.preview;
  const slot = p.live && currentTab() === 'preview' ? $('preview-slot') : null;
  let rect = null;
  if (slot && !palette && !document.hidden) {
    const r = slot.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rect = { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  const key = JSON.stringify(rect);
  if (key !== lastPlace) {
    lastPlace = key;
    window.preview.place(rect);
  }
  placing = p.live;
  if (placing) requestAnimationFrame(placePreview);
}
function placePreviewSoon() {
  if (!placing) placePreview();
}

// Closing the Preview tab closes the page; its address stays remembered.
function closePreviewPage() {
  window.preview.close();
  state.preview.live = false;
  state.preview.blocked = null;
  state.preview.note = null;
}
