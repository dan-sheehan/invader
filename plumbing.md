# invader plumbing

How invader is put together: its processes, what goes between them, where its state lives, and what it reads, writes and runs. This page describes the code as it is. How it is used is in [README.md](README.md), what is decided and why in [decisions.md](decisions.md), how it looks in [design.md](design.md), and how an agent works here in [HARNESS.md](HARNESS.md).

## The shape

invader is an Electron app with no build step. `package.json` starts `main/main.js`; the window loads `window/index.html`, which loads the files in `window/` as plain scripts, in order, sharing globals from `window/state.js`.

```
 main process (Node)                         window (no Node, sandboxed)
 main/main.js ── disk, changes, shell,  ◄──►  main/preload.js  ◄──►  window/*.js
   preview, setup, sessions, links,          the only bridge         index.html, style.css
   search, memory, drafts, map
      │                     │
      │ node-pty            └── a view of its own for the preview page
      ▼                         (own sandboxed process, own session in memory)
 one login shell per terminal
```

- **Main** (`main/`) does everything that touches the disk, Git, the shells and the preview. It holds the open folder, `root`, in `main/main.js`, and every call from the window is answered against it.
- **The window** (`window/`) draws what main sends and asks main for everything else. It has no Node, runs sandboxed with context isolation, and its page allows only its own scripts (`window/index.html`). Everything from the disk is put on the page as text, never as HTML: Markdown arrives as tokens made by `marked` in main and is built node by node in `window/markdown.js`, which drops HTML.
- **The bridge** (`main/preload.js`) is the only way between them. It gives the window `window.disk`, `window.drafts`, `window.memory`, `window.menu`, `window.terminal` and `window.preview`. Requests go through `ipcMain.handle` in `main/main.js`, which answers `{ ok: true, value }` or `{ ok: false, error }`. The window names files by paths relative to the open folder, or `~/kit/...`, never by full path. It can switch only to a recent folder (`folder:open`) or one picked in the Open folder dialog.
- **The shells** are started by `main/shell.js` with node-pty: one login shell (`$SHELL -l`, or the user's shell from the system) per terminal, at most 12. Each has an id, and every call names it.
- **The preview** (`main/preview.js`) is a `WebContentsView` laid over the middle of the window, with its own sandboxed process, no preload, devtools off, and a session kept in memory only (`invader-preview`). The window only says where it goes and what to load.

## The open folder

`root` in `main/main.js` is the folder the window shows. It starts as the folder given to `npm start -- <folder>`, else the last one in `state.json`, else the home folder. After that it follows the chosen terminal. When I press Return in it, `main/shell.js` asks `lsof` where its shell is, a moment later and again a little after. If the shell moved, `followShell` calls `setRoot`. While an edit is not saved, the window stays and says where the terminal went, and follows once the edit is saved or discarded. ⌘O and Open Folder… type `cd` into the chosen terminal (`shell.moveTo`), and the window follows when the shell gets there. With no terminal open, the folder just opens.

`setRoot` stops a running search, closes the preview when the folder is a different one, puts the folder first in the recent list, tells the window (`folder:changed`) and watches the new folder (`changes.watch`). Everything the window shows is about the open folder: a `cd` into `main/` makes `main/` the open folder, with its own changes, map and sessions.

## Files

`main/`:

| File | What it does |
| --- | --- |
| `main/main.js` | Starts the app, the window and the menu; holds the open folder; passes the window's requests to the files below; asks before quitting. |
| `main/preload.js` | The only bridge between the window and main. |
| `main/disk.js` | Reads the open folder and the kit, lists names for ⌘P, saves a Markdown file edited by hand, and finds where a path printed in a terminal leads. |
| `main/map.js` | Checks a `map.json` against the disk. `locate` is the path check the rest of main uses: a path leads inside a folder only when its real path does, after following symlinks. |
| `main/changes.js` | Watches the open folder and the kit, and asks Git what changed and what the last commits were. |
| `main/status.js` | Works out the status strip from plain data: which agent runs, how much of the map held, changes without Git. |
| `main/shell.js` | The terminals: their shells, what runs in each, which folder each is in, and moving one with `cd`. |
| `main/preview.js`, `main/address.js` | The preview, and which addresses it may show. |
| `main/search.js` | Find in Folder. |
| `main/setup.js`, `main/toml.js`, `main/redact.js` | Agent setup: what claude and codex are told in the open folder, Codex's `config.toml`, and hiding secrets in what is shown. |
| `main/sessions.js` | The last claude and codex sessions in the open folder, the steps of one to replay, and the newest steps of one running now. |
| `main/links.js` | Links and paths in the open folder's Markdown that point at nothing. |
| `main/memory.js` | `state.json`: what the app remembers between runs, checked when read back. |
| `main/drafts.js` | Unsaved Markdown edits kept for recovery, and the question quitting asks. |
| `main/drive.js`, `main/drive-scenarios.js` | Drive the real app for `main/app.test.js`. Never packaged. |

`window/`:

| File | What it does |
| --- | --- |
| `window/index.html`, `window/style.css` | The page, the order its scripts load, and its look. The colour tokens are at the top of `style.css`. |
| `window/state.js` | What the window keeps track of, and small helpers the other files share. |
| `window/start.js` | Loaded last: connects main's news and the menu to the rest, and reloads setup, sessions and links when the window comes to the front. |
| `window/tree.js` | The tree, and the agent setup and kit rows under it. |
| `window/file.js` | Tabs, the file in the middle, editing Markdown by hand, and links between files. |
| `window/markdown.js` | Draws Markdown from tokens. |
| `window/code.js` | A file shown by its lines: going to a line, choosing lines, Copy Reference. |
| `window/find.js` | Find in File, in the preview's page, and Find in Folder. |
| `window/history.js` | Back and forward, each tab's place, Show in Tree and Show on Map. |
| `window/refs.js` | Reading file references in terminal output and Markdown links. |
| `window/map-view.js` | Draws a checked map, a folder's drawn map, and builds the Build map request. |
| `window/setup-view.js` | The agent setup page. |
| `window/home.js` | What happened here: last sessions, links to nothing, last commits. |
| `window/replay.js` | Replaying a session on the map or the tree. |
| `window/changes.js` | The status strip, the changes page, the live marks and the agent's trail, polled every 2 seconds. |
| `window/whose.js` | Which session changed each changed file. |
| `window/terminal.js`, `window/paste.js` | The terminals and their tabs, typing the Build map request, opening the files they print; whether a paste asks first. |
| `window/preview.js` | The preview tab: its address and where the page goes in the window. |
| `window/palette.js`, `window/fuzzy.js` | ⌘P and ⌘O, and how names are matched. |
| `window/layout.js` | Pane widths, and telling main the layout and the open tabs to remember. |

At the top: `pack.js` builds the Mac app, `bench/` holds the model benchmarks, `kit/` is a blank kit, and `map.json` is invader's own map, which invader checks like any other.

## Where state lives

| What | Where | Kept |
| --- | --- | --- |
| The files | The open folder and `~/kit` | They are the truth. Everything shown is read from them again. |
| A map | `map.json` in the folder it describes | Checked against the disk every time it is read (`main/map.js`); the result is never stored. The shape is in [README.md](README.md#the-map-file). |
| What changed, the last commits, the branch | Git, asked by `main/changes.js`; without Git, the names present when the folder opened | In memory, while the folder is open. |
| Recent folders, window, layout, each folder's tabs, places, unfolded folders, preview address | `state.json` in the app's data folder (`main/memory.js`) | Written to `state.json.tmp` and moved into place. Everything is checked when read back; a tab is only a name. |
| Unsaved Markdown edits | `drafts/` in the app's data folder, one file per edit (`main/drafts.js`) | Written whole, flushed, then moved into place. Deleted on save or discard. At most 100 edits and 64 MB; a new edit is refused when full, and none is dropped. |
| What Electron keeps for itself | Caches and storage Chromium writes in the same data folder | Not used by invader's code. |
| Terminals, their output and folders | The shells, and `main/shell.js` | Gone when the app quits. None is started again. |
| The preview page, its cookies, a trusted certificate | The preview's session in memory | Gone when the app quits. |
| Agent setup found, sessions listed, live read positions, links found | Caches in `main/setup.js`, `main/sessions.js`, `main/links.js` | In memory only. Only what the last scan or list found can be opened or replayed. |
| Back and forward, each tab's place while open | `window/history.js` | In the window only. |

The data folder is Electron's `userData`, named after `productName` in `package.json`: `next-invader`, so this copy never shares memory with invader. The tests set their own.

## What it reads, writes and runs

These are the boundaries every change keeps ([HARNESS.md](HARNESS.md#what-must-hold) lists them with their tests). Loosening one is a decision in [decisions.md](decisions.md).

**Runs.** Only these:
- A login shell per terminal (`main/shell.js`). Nothing is typed into a shell except what I type, and two things the app types:
  - `cd` to a folder, for ⌘O and Open Folder…, only while the shell waits at its prompt, and never a path holding a control character.
  - The Build map request, typed into claude or codex a few characters at a time, without Return. Anything in it from the disk is flattened to one line (`oneLine` in `window/map-view.js`).
- `git status`, `git log`, `git rev-parse` and `git config` (`main/changes.js`), set so a repository cannot make them run a program:
  - `core.fsmonitor` off and hooks pointed at `/dev/null`.
  - `GIT_OPTIONAL_LOCKS=0`, so Git does not write its index.
  - The filters the repository sets itself blanked out; `git config` only reads their names.
  - Signature checks off.
- `lsof`, to read where a shell is (`main/shell.js`).
- The page the preview loads runs its own scripts, apart from the window.

**The shell's environment.**
- Variables starting `ELECTRON_` or `CLAUDE` are dropped, except `CLAUDE_CONFIG_DIR`, so claude started there does not think it runs inside another session (`dropped` in `main/shell.js`).
- `TERM_PROGRAM=invader` is set.
- `INVADER_KIT` is set when `~/kit` exists.
- A UTF-8 `LANG` is set when none is.

**Writes.**
- Into the folders it shows, only one thing: a Markdown file I edited by hand, saved back to itself (`disk.saveMarkdown`). It is saved only if the file still holds the text the edit started from. The file must be under 2 MB and inside the open folder or the kit.
- Everything else goes in the data folder: `state.json` and `drafts/`.
- The clipboard gets one line with no control characters, for Copy Reference (`clip:write`).

**Reads, inside the open folder and the kit.** Every path is checked after following symlinks (`locate` in `main/map.js`), so nothing leads outside:
- The tree and files. Files over 2 MB show their first 2 MB, and binary files are not shown.
- The names for ⌘P. This leaves out `.git` and `node_modules` and never follows a symlink.
- Find in Folder, only when I search. It skips tool folders, binary files, files over 2 MB and links leading outside, and says so.
- A path a terminal printed is accepted only when `disk.where` finds it there. A relative one is read from the folder that terminal was in, and only a folder main saw that terminal in (`shell.wasIn`).

**Reads, outside them.** Only these, and only reads:
- **The agent setup** (`main/setup.js`):
  - `~/.claude` or `CLAUDE_CONFIG_DIR`, `~/.claude.json`, `~/.codex` or `CODEX_HOME`, and `~/.agents/skills`.
  - `CLAUDE.md` and `CLAUDE.local.md` in every folder above.
  - `AGENTS.md`, `AGENTS.override.md` and `.agents/skills` in the folders from the repository's top down.
  - The managed settings in `/Library/Application Support/ClaudeCode`.
  - Files a `CLAUDE.md` brings in with `@`, only to count their words.
  - What is shown from outside the open folder has secrets hidden (`main/redact.js`). The window can open only a source the last scan found.
- **The claude and codex session records** (`main/sessions.js`):
  - `projects/<the folder>/` under the claude folder, including helpers' records, and `sessions/` under the codex folder.
  - Only sessions that ran in the open folder are kept.
  - The window gets times, file names in the open folder, counts, and a name or first line with secrets hidden. It never gets the conversation, the commands or what the agent said.
- **Whether a path exists**, for each path the open folder's Markdown names (`main/links.js`). It never reads what is there.
- **Git's own files.** `git status` reads the whole repository, and `main/changes.js` watches its `.git` folder when that sits above the open folder, so a commit is seen.
- **Its own data folder, whether each recent folder is still there, and the real path of a full path a terminal printed.**

**Never.** It never:
- starts claude, codex or a server;
- calls a model;
- follows a link or redirect out of the preview;
- opens anything in the browser except when I click (`shell.openExternal` for a plain web address, `main/preview.js`);
- downloads anything;
- sends anything anywhere: no accounts, cloud or telemetry.

## How things move

- **Changes.** `fs.watch` on the open folder and the kit reports touched paths. After 150 ms `main/changes.js` asks Git, checks the top map again, and sends one `changes` message: the list, branch, touched paths, map status and last commits. The window marks what was touched for a few seconds and lists the rest on the changes page. Without Git, what changed is worked out against the names listed when the folder opened (`changeWithoutGit` in `main/status.js`).
- **The agent's trail.** Every 2 seconds while the window shows, `window/changes.js` calls `sessions:live`. `liveSteps` reads only the lines added to records written in the last 10 seconds and returns each step: when, which agent, read or changed, and the files in the open folder.
- **Sessions and replay.**
  - `sessions:last` lists the last three sessions.
  - `sessions:steps` returns the steps of one of those sessions only, for `window/replay.js`.
  - Files a shell command writes or names are read from its words, never by running it (`writtenPaths`, `namedPaths`).
- **Agent setup and links** are read again when the window comes to the front, and when the watcher sees a file they depend on change.
- **Build map.**
  - `mapRequest` in `window/map-view.js` builds the request. With a map already there, the request includes what was dropped and why.
  - `typeIntoTerminal` in `window/terminal.js` types it into the chosen terminal when claude or codex runs there, else the one terminal where one does. Otherwise it asks which.
  - The same text is relied on in two more places. `bench/bench.js` reads it from the button's code, and `bench.test.js` checks the two agree. `MAP_REQUEST` in `main/sessions.js` recognises its opening words to name a session after the button; `sessions.test.js` checks it against sample wording, not the button's, so it is kept matching by hand.
- **Preview.**
  - `preview:open` loads an address `admit` in `main/address.js` accepts.
  - Every top-level navigation and redirect is checked again.
  - Permission requests, new windows and downloads are refused.
  - An https certificate that does not check is refused. The window may then trust that one fingerprint for that origin until the app quits.
- **Quitting.** `confirmQuit` in `main/main.js` first asks the window to keep each unsaved edit (`quit:flush`). Then it asks one question about the edits and the programs running (`drafts.quitQuestion`). **Save and Quit** saves every edit (`quit:save`) and quits only if all were saved. On `will-quit`, the preview closes, the watchers stop, every shell is sent a hangup, and any change to `state.json` not yet written is written.

## Limits

Files are shown, saved and kept as drafts up to 2 MB. Find in Folder stops at 500 lines found and 20,000 files. ⌘P lists up to 20,000 names. Up to 12 terminals and 12 recent folders. Session records over 64 MB are skipped, a replay passes up to 2,000 steps, and up to 400 Codex records are looked at to find this folder's. The links check reads up to 2,000 Markdown files of up to 1 MB and lists up to 200 targets. Agent setup lists up to 600 items. Each limit is a constant at the top of its file.

## Tests

- **Unit tests.** `node --test` finds every `*.test.js`. Each unit test sits beside the file it tests, in `main/`, `window/` and `bench/`, and uses only `node:test`, on plain data or made-up folders in the system's temporary folder. `main/terminals.test.js` starts real shells through node-pty. `window/fuzzy.js`, `paste.js`, `refs.js` and `whose.js` can be tested in Node because they end with a `module.exports` guarded for Node.
- **App tests.** `main/app.test.js` starts Electron with `main/drive.js` in place of `main/main.js`. Each test gets:
  - a made-up home (`HOME`, `DRIVE_HOME`), with the app's data in `DRIVE_DATA`;
  - a made-up project, and a scenario from `main/drive-scenarios.js`.

  `drive.js` replaces opening the browser, files and Finder, the clipboard and dialogs before `main.js` loads. It fails the scenario on any call the scenario did not expect, and stops before the app starts if a replacement does not hold. Scenarios drive the real window with key events and `executeJavaScript`, and print `DRIVE {...}` lines that the test reads.
- **What the app tests need.** They run on macOS only. `INVADER_APP_TESTS=0` leaves them out. Most scenarios serve their pages with Node's own `http` and `https`. Three need a tool from the system:
  - `buildMap` builds a stand-in `claude` with `/usr/bin/cc`, and is skipped without it;
  - `tour` serves a page with `python3 -m http.server` on 127.0.0.1:8765, typed into a terminal, and is skipped without Python;
  - `preview` makes certificates with `/usr/bin/openssl`, and fails without it rather than being skipped.
- **The built-app test.** It runs `dist/next-invader-darwin-*/next-invader.app` only when it exists and its `main.js`, `shell.js`, `terminal.js` and `file.js` match the code. Otherwise it is skipped with the reason.
- **Opt-in experiment.** With `INVADER_JEV_TESTS=1` and `TYPESAFE_API_KEY` set, two app tests also send dialog text to TypeSafe's API to score how clearly it reads. It never fails a test. Nothing else in the tests reaches the network.
- **What no test draws or checks:** how maps are laid out, what the pages look like, replay's drawing and the live marks' motion. Check those by running the app.

## Building the Mac app

`npm run app` runs `pack.js`, which builds `dist/next-invader-darwin-<arch>/next-invader.app` with `@electron/packager`:
- It includes only `package.json`, `main/`, `window/`, `icon.png`, `LICENSE` and the packages the app runs on.
- It leaves out the tests, `drive.js`, `drive-scenarios.js`, `bench/` and `kit/`.
- It checks what must be there, and signs the app ad hoc for this Mac.

`npm install`'s `postinstall` makes node-pty's `spawn-helper` runnable and renames the Electron it runs to next-invader, with macOS's `PlistBuddy`, so the dock and menu say so.
