// The terminal pane: the shell from the main process, drawn by xterm.js.
// What is typed goes to the shell; what the shell prints comes back here.

const term = new Terminal({
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: 12,
  lineHeight: 1.15,
  cursorBlink: true,
  macOptionIsMeta: true,
  scrollback: 10000,
  theme: {
    background: '#1b1b1b',
    foreground: '#d6d6d6',
    cursor: '#d6d6d6',
    cursorAccent: '#1b1b1b',
    selectionBackground: '#4a4a4a',
  },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));
fit.fit();

let ended = false;
window.terminal.onData((data) => {
  term.write(data);
  watchQuiet();
});
window.terminal.onExit(() => {
  ended = true;
  term.write('\r\n\x1b[2m[The shell ended. Press any key to start a new one.]\x1b[0m\r\n');
});

term.onData((data) => {
  if (ended) {
    ended = false;
    term.reset();
    window.terminal.start(term.cols, term.rows);
    return;
  }
  window.terminal.input(data);
});
term.onResize(({ cols, rows }) => window.terminal.resize(cols, rows));
// While hidden the terminal keeps its size, so what runs in it is not squeezed.
new ResizeObserver(() => {
  if (document.getElementById('term').clientWidth > 0) fit.fit();
}).observe(document.getElementById('term'));

window.terminal.start(term.cols, term.rows);
term.focus();

// Hide the terminal to give the file and map the room, or show it again.
// The shell and whatever runs in it keep running while it is hidden.
const terminalHidden = () => document.querySelector('main').classList.contains('term-hidden');
function showTerminal(show) {
  document.querySelector('main').classList.toggle('term-hidden', !show);
  document.getElementById('term-toggle').textContent = show ? 'Hide terminal' : 'Show terminal';
  watchQuiet();
  if (show) term.focus();
}

// While it is hidden, the strip says when the agent in it has gone quiet for
// a moment: it has finished, or it is asking something.
// A short burst of output, like a redraw, is not the agent working again:
// the mark clears once output has kept coming for a second.
const QUIET_MS = 2000;
let quietTimer = null;
let lastOutput = 0;
let busySince = 0;
function watchQuiet() {
  const now = Date.now();
  if (now - lastOutput > 300) busySince = now;
  lastOutput = now;
  clearTimeout(quietTimer);
  if (!terminalHidden()) return markWaiting(null);
  if (now - busySince >= 1000) markWaiting(null);
  quietTimer = setTimeout(() => {
    if (terminalHidden() && state.running?.agent) markWaiting(state.running.agent);
  }, QUIET_MS);
}
function markWaiting(agent) {
  const strip = document.getElementById('term-open');
  strip.classList.toggle('waiting', !!agent);
  strip.textContent = agent ? 'Terminal · ' + agent + ' is waiting' : 'Terminal';
}
document.getElementById('term-toggle').addEventListener('click', () => {
  showTerminal(document.querySelector('main').classList.contains('term-hidden'));
});
document.getElementById('term-open').addEventListener('click', () => showTerminal(true));

// Put text on the line as if pasted, without pressing Return. The terminal
// is shown, so the text can be read before Return is pressed.
function pasteIntoTerminal(text) {
  showTerminal(true);
  term.paste(text);
  term.focus();
}
