# invader agent rules

Read GUIDE.md first. It says what invader is and what is decided.

If $INVADER_KIT is set and you need to know something about me, look there first. If it is there, use it and keep going. If not, ask me.

## For me first

invader is built for me first, and open source for people like me: people building with AI who do not come from engineering. Never design for teams, companies or enterprise. When I say THIS IS FOR ME, it is a correction to your reasoning, not a request to change wording.

## Do not overbuild

This project exists because an agent turned a personal tool into enterprise software. Build the smallest thing that does what I asked. No layers, frameworks, settings or abstractions for needs I have not got.

## A suggestion is not a decision

Nothing is settled because you proposed it, because it appeared in a polished document, or because we discussed it recently. GUIDE.md holds the decisions. If you want to change one, ask. When a piece of work is done, propose what comes next; it counts only after I say yes.

## Do not add structure

No new folders, documents, branches, scripts or process unless it solves a problem I actually have. The project carries four documents: README.md (what it is and how to start it), GUIDE.md, this file, DESIGN.md. It also ships a `LICENSE` (MIT) and a blank `kit/` holding only a README that says how to make your own kit, as decided in GUIDE.md; never put my personal context in it. Files later work needs, like a progress file or a check script, are decided when that work starts. AGENTS.md and CLAUDE.md are one-line pointers to this file, so the rules live in one place; change the rules here, never in them. Keep it that way.

## Plain words

Folder, file, map, box, arrow, terminal. No metaphors. No glossary.

## Safety in the app

- Nothing from the disk is ever run or rendered as HTML. Markdown and maps are drawn from parsed data.
- The terminal runs only what is typed into it. The app types into it in two places only: **Open folder…** types `cd` to that folder and presses Return, and **Build map** pastes a request into the agent already running there without pressing Return. Anything from the disk in that request is flattened to one line first.
- Apart from the terminal, the app runs only `git status` and `git rev-parse` (with `core.fsmonitor` off, hooks pointed at no folder, the repository's own filters blanked out and optional locks off, so a repository cannot make it run a program) and `lsof`, to read what changed and where the shell is.
- The app writes to the disk in one place only: saving a Markdown file I edited by hand in its plain-text view, back to that same file.
- Every path is checked after following symlinks, so nothing leads outside the open folder, except my kit at `~/kit`, which invader keeps in reach. Paths inside the kit are checked the same way, so nothing leads outside it.
- Loosening any of these is a decision in GUIDE.md, as hand-edited Markdown and `kit/` were, and whatever the app does is visible.

## Git, kept simple

- One branch, `main`. No other branches, no stash, no worktrees, until I decide otherwise. The one tag is `v0.1.0`, which keeps the old alabs; add no others.
- One commit at the end of each task I accepted, after you tell me what changed. Never commit half-done work, and never commit without saying so.
- The commit message is one plain sentence saying what changed, for example `Show every folder in the workspace with its README title`. No prefixes, no codes, no body.
- Never rewrite history: no amend, no rebase, no reset, no force. The one exception is the push that replaces alabs's `main` with invader, and I do that myself.
- The remote is `origin`, github.com/dan-sheehan/invader. Pushing is public: ask me first.
- If I cannot explain what a commit did, stop. That is my test for rushing.
- `.gitignore` holds only what is generated: `node_modules/` and build output.
- If I ask what happened, answer with `git log --oneline` and explain it in words.

## Working here

- Inspect before changing. Say what you found, then what you recommend, separately.
- Make the smallest change that does the thing I asked. One change per request.
- Ask before: changing scope, adding a dependency, changing the map file shape, anything hard to reverse.
- Do not ask about reversible implementation details. Do them and report.
- Verify with something observable: run it, show it, or test it.
- Pure logic, like the map checks, has tests that run with `npm test`.
