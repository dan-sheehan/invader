// What the status strip and the changed marks say, worked out from plain data
// so it can be tested. The main process uses it and sends the results to the
// window.

// The agent running in the terminal, from the name of the program in front:
// 'claude', 'codex', or null for anything else. Claude Code runs under its
// version number, such as 2.1.280.
function agentName(program) {
  if (!program) return null;
  if (/^claude$/i.test(program) || /^\d+\.\d+\.\d+$/.test(program)) return 'claude';
  if (/^codex$/i.test(program)) return 'codex';
  return null;
}

// How much of a checked map held, from checkMap's result, or null when there
// is no map. state is 'none', 'error', 'dropped' or 'ok'.
function mapStatus(checked) {
  if (!checked) return { state: 'none', detail: 'No map.json at the top of this folder.' };
  if (checked.error) return { state: 'error', detail: 'map.json cannot be drawn. ' + checked.error };
  const boxes = checked.groups.reduce((n, g) => n + g.boxes.length, 0);
  const arrows = checked.arrows.length;
  const droppedBoxes = checked.dropped.filter((d) => d.what === 'box').length;
  const droppedArrows = checked.dropped.length - droppedBoxes;
  return {
    state: checked.dropped.length ? 'dropped' : 'ok',
    checked: boxes + arrows,
    total: boxes + arrows + checked.dropped.length,
    detail: 'Boxes ' + boxes + ' of ' + (boxes + droppedBoxes) + ' and arrows ' + arrows + ' of '
      + (arrows + droppedArrows) + ' in map.json check out against the disk.',
  };
}

// In a folder without Git: what a path the watcher saw counts as. was is what
// it was when the folder was opened ('file', 'folder' or undefined when it was
// not there), now is what it is now ('file', 'folder' or null when it is gone),
// and complete says whether everything there at the start was listed. Returns
// 'new', 'changed' or 'deleted', or null when it is not listed: folders, and
// files that came and went.
function changeWithoutGit(was, now, complete) {
  if (now === 'folder' || (!now && was === 'folder')) return null;
  if (!now) return was || !complete ? 'deleted' : null;
  return was || !complete ? 'changed' : 'new';
}

module.exports = { agentName, mapStatus, changeWithoutGit };
