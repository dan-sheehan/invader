// Whose changes: which of the last sessions changed each changed file, so the
// changed list can show them under the session that did it. A file goes under
// the session that last changed it, with its edit tools or a command that
// names it, after since: the last
// commit, or when the folder was opened. A change a session made before then
// was committed, or came before invader looked, so it does not count. The
// rest go last, under no session.

// list: [path, kind] pairs, as the changed list has them. sessions: newest
// first, as the summary has them. since: a time in milliseconds. Returns
// [{ session, list }]: the sessions that changed something, in the order
// given, then the rest with session null.
function whoseChanges(list, sessions, since) {
  const bySession = new Map();
  const rest = [];
  for (const change of list) {
    let who = null;
    for (const s of sessions || []) {
      const t = s.editedAt?.[change[0]];
      if (t >= since && (!who || t > who.editedAt[change[0]])) who = s;
    }
    if (!who) rest.push(change);
    else bySession.set(who, [...(bySession.get(who) || []), change]);
  }
  const groups = (sessions || []).filter((s) => bySession.has(s)).map((s) => ({ session: s, list: bySession.get(s) }));
  if (rest.length) groups.push({ session: null, list: rest });
  return groups;
}

if (typeof module !== 'undefined') module.exports = { whoseChanges };
