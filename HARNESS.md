# invader agent rules

For any coding agent working on invader. `CLAUDE.md` brings this file in, and `AGENTS.md` points here. It says how to work here and where to look; it does not describe the app. Follow the links for that.

Before changing anything, read [decisions.md](decisions.md) for what is decided. Then find your change in [Where to look](#where-to-look) and read its code, its tests and the section it names.

If $INVADER_KIT is set and you need to know something about me, look there first. If it is there, use it and keep going. If not, ask me.

## What invader is

A Mac app, built with Electron, that puts one window around a folder of real files for building software with AI coding tools when you don't come from engineering: the tree and a checked map, terminals where I run claude or codex myself, live marks on what the agent does, what the agent is told, and a preview of a page served on this computer. It is not an editor, except for Markdown by hand, and not an agent: it never starts one or calls a model. [README.md](README.md) says how it is used.

This copy is **next-invader**. It runs under that name, with its own data folder apart from invader's.

## For me first

invader is built for me first, and open source for people like me: people building with AI who do not come from engineering. Never design for teams, companies or enterprise. When I say THIS IS FOR ME, it is a correction to your reasoning, not a request to change wording.

## Do not overbuild

This project exists because an agent turned a personal tool into enterprise software. Build the smallest thing that does what I asked. No layers, frameworks, settings or abstractions for needs I have not got.

## A suggestion is not a decision

Nothing is settled because you proposed it, because it appeared in a polished document, or because we discussed it recently. decisions.md holds the decisions. If you want to change one, ask. When a piece of work is done, propose what comes next; it counts only after I say yes.

## Do not add structure

- No new folders, documents, branches, scripts or process unless it solves a problem I actually have.
- A file that later work needs, like a progress file or a check script, is decided when that work starts.
- AGENTS.md and CLAUDE.md only point to this file, so the rules live in one place: change the rules here, never there.
- Never put my personal context in `kit/`.

## Documents

Each fact has one home. Put it where its row says, and link to it from anywhere else. A short summary elsewhere is fine; a second full explanation is not. Names in capitals are for someone else to read, people using invader or agents like you; lowercase names are what I keep about the project for myself, and you read and update them too.

| Document | Owns |
| --- | --- |
| [README.md](README.md) | What invader is, how to start it, and how to use it: every surface and key, as someone using it sees them, and the `map.json` format. |
| [HARNESS.md](HARNESS.md), this file | How an agent works here. |
| [kit/README.md](kit/README.md) | What a kit is and how to make one. |
| [decisions.md](decisions.md) | What invader is for, what must stay true, and what is decided and why. |
| [plumbing.md](plumbing.md) | How it is built: processes, the bridge, each file's job, where state lives, what it reads, writes and runs, and how the tests work. |
| [design.md](design.md) | How it looks and moves. |

`CLAUDE.md` brings this file in with `@`, so all of it is loaded into every Claude Code session here, and invader's own agent setup page counts it. Keep here only what an agent needs to work; facts about the app go in the documents above.

## Plain words

Folder, file, map, box, arrow, terminal. No metaphors. No glossary.

## Commands

```bash
npm install                  # once; also names the Electron it runs next-invader
npm start -- /path/to/folder # run it; leave out the folder to open the last one
npm test                     # every test, about 2.5 minutes, the real app included
INVADER_APP_TESTS=0 npm test # only the tests that do not start the app, about 10 seconds
npm run app                  # build dist/next-invader-darwin-<arch>/next-invader.app
npm run bench -- <agent:model> # model benchmarks, by hand only: see README.md
```

- It needs macOS, Node.js 22.12 or newer, and Git.
- There is no linter, formatter, type check or CI.
- `npm start` and the app tests use the real Electron. The app tests start it in a made-up home, and nothing reaches the real one.
- `npm start` uses the real data folder, with my recent folders, tabs and unsaved edits. To try something without touching it, start it with `HOME` and `CFFIXED_USER_HOME` pointed at a scratch folder, as the built-app test in `main/app.test.js` does.

## Where to look

Read the code; don't work out what it does from names or from the docs alone. Each file in `main/` and `window/` starts with a comment saying what it does, and often what it must not do. plumbing.md has a line for each file.

| Changing | Code | Tests | Keep true |
| --- | --- | --- | --- |
| Reading the folder, the kit, a path from a terminal, saving Markdown | `main/disk.js`, `main/map.js` (`locate`), `window/refs.js`, `window/file.js` | `disk`, `map`, `refs`, app `links` | [plumbing](plumbing.md#what-it-reads-writes-and-runs) |
| Maps: checking, drawing, Build map | `main/map.js`, `main/status.js`, `window/map-view.js`, `window/terminal.js` | `map`, `status`, `bench`, app `buildMap` | [README](README.md#the-map-file), [design](design.md#maps) |
| Terminals, following the shell's folder, pasting | `main/shell.js`, `window/terminal.js`, `window/paste.js` | `terminals`, `shell`, `paste`, app `paste`, `switching` | [plumbing](plumbing.md#the-open-folder) |
| What changed, Git, the changes page, live marks | `main/changes.js`, `main/status.js`, `window/changes.js`, `window/whose.js` | `status`, `whose` | [plumbing](plumbing.md#how-things-move) |
| Last sessions, replay, the agent's trail | `main/sessions.js`, `window/home.js`, `window/replay.js`, `window/changes.js`, `window/whose.js` | `sessions`, `whose` | [plumbing](plumbing.md#what-it-reads-writes-and-runs) |
| Agent setup | `main/setup.js`, `main/redact.js`, `main/toml.js`, `window/setup-view.js` | `setup` | [plumbing](plumbing.md#what-it-reads-writes-and-runs) |
| Links to nothing | `main/links.js`, `window/home.js` | `links` | [README](README.md#links-to-nothing) |
| Preview | `main/preview.js`, `main/address.js`, `window/preview.js` | `address`, app `preview` (find, keyboard, certificates), app `tour` | [plumbing](plumbing.md#what-it-reads-writes-and-runs) |
| Find in Folder, ⌘P, ⌘O | `main/search.js`, `main/disk.js`, `window/find.js`, `window/palette.js`, `window/fuzzy.js` | `search`, `fuzzy`, app `keys` | [README](README.md#getting-around) |
| Remembering, unsaved edits, quitting | `main/memory.js`, `main/drafts.js`, `main/main.js`, `window/layout.js`, `window/history.js` | `memory`, `drafts`, app `draftEdit`, `draftRecover`, `draftAfterCrash` | [plumbing](plumbing.md#where-state-lives) |
| Menu, keys, where the keyboard goes | `main/main.js` (`buildMenu`), `window/start.js` | app `keys` | [README](README.md#getting-around) |
| The look | `window/style.css`, the drawing in `window/` | none: run it | [design](design.md) |
| Packaging | `pack.js`, `package.json` | app: the built-app test | [plumbing](plumbing.md#building-the-mac-app) |
| Benchmarks | `bench/bench.js` | `bench` | [README](README.md#model-benchmarks) |

In the Tests column, `disk` means `disk.test.js`, beside the file it tests in `main/`, `window/` or `bench/`. `terminals.test.js` tests `main/shell.js` with real shells. `app <scenario>` means the test in `main/app.test.js` that runs that scenario from `main/drive-scenarios.js`.

## What must hold

Every change keeps these. The exact files, folders and commands are in plumbing.md's [What it reads, writes and runs](plumbing.md#what-it-reads-writes-and-runs). Loosening any of them is a decision in decisions.md, as hand-edited Markdown and the kit were, and whatever the app does is visible.

- **Content is data.** Nothing from the disk is run, or put in the window as HTML. Markdown and maps are drawn from parsed data. (`disk`, `map`)
- **The window reaches the disk only through main.** `main/preload.js` is the only bridge. The window names files relative to the open folder or `~/kit`, and main checks every path after following symlinks, so nothing leads outside. (`disk`, `map`, `memory`)
- **Only what I type runs.** The app types into a terminal only `cd` and Return for ⌘O and Open Folder…, while the shell waits at its prompt, and the Build map request, without Return. A terminal I did not choose never moves the window. (`terminals`, `shell`, app `buildMap`, app `links`)
- **Apart from the shells, the app runs only** `git status`, `git log`, `git rev-parse`, `git config` and `lsof`, set so a repository cannot make them run a program. No test checks those Git settings: read `git` and `ownFilters` in `main/changes.js` before touching them.
- **It writes into my folders only a Markdown file I edited and saved,** and only if the file has not changed under the edit. Everything else goes in its own data folder. (`disk`, `drafts`, `memory`)
- **Outside the open folder and the kit, it only reads,** and only the agent setup, the session records, whether a path exists, and its own data. What it shows from there hides secrets. The window never gets a session's conversation or commands. (`setup`, `sessions`, `links`)
- **The preview shows only pages on this computer,** in a view of its own with none of the window's bridge. It opens nothing in the browser unless I click. (`address`, app `preview`)
- **Nothing is started again** after quitting, and nothing is loaded for a remembered preview address until I press Load. (`memory`, app `draftEdit`)
- **Local.** No accounts, cloud or telemetry. The app never starts an agent or calls a model.

## Two kinds of agents

You are a repository agent: you work *on* invader's code. invader also deals with agents at runtime, and that is product behaviour, not rules for you:
- the claude or codex I run in its terminals;
- the Build map request it types into them (`mapRequest` in `window/map-view.js`);
- the setup and session records it reads;
- the agents `bench/bench.js` runs with nobody at the keyboard.

Changing any of these is a product change: ask first. The Build map request is relied on in three places, one of them kept matching only by hand; plumbing.md's [How things move](plumbing.md#how-things-move) names them.

## Validation

- Run `npm test`. Every test must pass. At the `next-invader` checkpoint it was 172 tests, 172 pass, none skipped. The built-app test is skipped with a reason unless `dist/` holds an app built from the code as it is; that is fine unless you touched packaging.
- New pure logic gets a test beside its file, run by `npm test`. A change to how the window behaves gets an app scenario when it touches keys, terminals, the preview, saving or quitting.
- What no test checks, like how a map is laid out or what a page looks like, you check by running it. Say what you looked at.
- If you changed behaviour, change the one document that owns it (the table under [Documents](#documents)) in the same piece of work.

## When the docs and the code disagree

The code is what runs. Say where they disagree, and fix the document when that is part of the task. Never change the code to match a document without asking me: the document may be the one that is right, and decisions.md's decisions are mine. When neither the code, the tests nor the documents settle a question, ask; don't guess.

## Git, kept simple

- Work on the branch that is checked out. No new branches, stashes, worktrees or tags until I ask.
- One commit at the end of each task I accepted, after you tell me what changed. Never commit half-done work, and never commit without saying so.
- The commit message is one plain sentence saying what changed, for example `Show every folder in the workspace with its README title`. No prefixes, no codes, no body.
- Never rewrite history: no amend, no rebase, no reset, no force.
- Never push without asking me. The public invader is github.com/dan-sheehan/invader, and pushing there is public. This copy's `origin` is whatever `git remote -v` says.
- If I cannot explain what a commit did, stop. That is my test for rushing.
- `.gitignore` holds only what is made, not written: `node_modules/`, `dist/`, `bench/results.md` and `.DS_Store`.
- If I ask what happened, answer with `git log --oneline` and explain it in words.

## Working here

- Inspect before changing. Say what you found, then what you recommend, separately.
- Make the smallest change that does the thing I asked. One change per request.
- Ask before: changing scope, adding a dependency, changing the map file shape, anything hard to reverse.
- Do not ask about reversible implementation details. Do them and report.
- Verify with something observable: run it, show it, or test it.
