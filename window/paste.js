// Pasting into the shell. The shell runs each line pasted into it as its own
// command, so a block copied from a chat, with the prompt and what the
// commands printed, turns into a wall of errors. When the shell itself is in
// front, pasting more than one line, or a line that starts with a copied
// prompt, asks first. Pasting into claude, codex or another program is left
// alone.

// A prompt copied along with a command: $, % or ❯ and a space.
const PROMPT = /^\s*(?:\$|%|❯)\s+/;

// What a paste holds, or null when it can go straight in: its lines with
// something on them, how many start with a prompt, those commands without
// the prompt, and the whole paste as copied, blank lines inside it kept (a
// heredoc needs them) and those at either end left off, so nothing runs
// before Return is pressed.
function pasteCheck(text) {
  const all = String(text).replace(/\r\n?/g, '\n');
  const lines = all.split('\n').filter((l) => l.trim());
  const commands = lines.filter((l) => PROMPT.test(l)).map((l) => l.replace(PROMPT, ''));
  if (lines.length < 2 && !commands.length) return null;
  return { lines, commands, text: all.replace(/^(\s*\n)+/, '').replace(/(\n\s*)+$/, '') };
}

if (typeof module !== 'undefined') module.exports = { pasteCheck };
