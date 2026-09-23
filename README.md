<img src="icon.png" alt="invader" width="96">

# invader

A workspace for building software with AI coding tools when you don't come from engineering. It shows your real files in plain words, runs a terminal beside them for Claude Code or Codex, and marks live which files the agent is changing.

You give invader access to a folder. Your agent maps what is there, and invader checks that map against the disk and shows you where you are.

## Start it

invader runs on macOS only for now. You need [Node.js](https://nodejs.org) 22.12 or newer, and Git.

Get the code, then run the rest from inside the invader folder it makes. From anywhere else, npm stops with `Could not read package.json`.

```bash
git clone https://github.com/dan-sheehan/invader.git
cd invader
npm install
npm start -- /path/to/a/folder
```

Leave out the folder to open the last one it showed.

`npm install` also renames the copy of Electron that `npm start` runs to invader, so the dock says invader rather than Electron.

The first `npm install` warns that node-pty's install scripts are not approved (`allowScripts`). That is expected, and invader still works.

To run `claude` or `codex` in its terminal, install their command-line tools and sign in to them. The app itself never starts them and never calls a model.

If `claude` is not found after installing it, your shell is not looking in `~/.local/bin`, where it was put. Add that folder once, then open a new terminal:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

## What you see

- **Top:** the open folder's name (rest the pointer on it for the full path) and a status strip: the agent running in the terminal (`claude`, `codex` or none), whether the folder is being watched, the Git branch, how many files changed, and how much of the top map checked out (click it to open the map). Then **Build map** (or **Update map**), **Open folder…** and **Hide terminal**.
- **Left:** what changed since the last commit, then your kit, `~/kit/`, if you keep one there, and the folder as a tree. Folders at the top of the open folder show the first two words of their README title; rest the pointer on them to read all of it. A kit is optional; [kit/README.md](kit/README.md) says what it is and how to make one. The kit stays there whichever folder is open, and its files open like any other. It is watched too: what the agent changes there is marked live and an open kit file is read again, but it stays out of the list of what changed. The terminal sets `INVADER_KIT` to its path, so your agent can find it when you tell it to. `.git/` and `node_modules/`, kept by Git and npm rather than by you, are hidden behind a dim row at the end of their folder, like `2 hidden: .git/ node_modules/`; click it to show them.
- **Middle:** the file you clicked. Markdown is rendered, and a link to another file in the folder opens it here, at the heading a `#section` names. A `map.json` is drawn as a map; if it is wider than the pane, the line above it offers to hide the terminal. A Markdown file's **Plain text** view can be edited by hand: **Save** (or ⌘S) writes it back to the file, **Discard** drops the edit. If the file changed on disk while you were editing, for example because the agent edited it, nothing is saved and it says so. Quitting with an unsaved edit asks first, and if the terminal changes folder meanwhile, the window stays until you Save or Discard.
- **Right:** a terminal running your usual shell in the open folder. **Hide terminal** folds it to a thin strip so the file or map gets the room; click the strip or **Show terminal** to bring it back. What runs in it keeps running, and **Build map** brings it back so you can read the request. While it is hidden, the strip says when the agent in it has gone quiet, for example `claude is waiting`: it has finished or is asking you something.

The window follows the terminal: `cd` somewhere and that folder is shown. **Open folder…** moves the terminal there too.

While the agent works, the files it changes are marked `new`, `changed` or `deleted` in the tree, on the map and in the list. Files touched in the last few seconds get an extra mark, and on the map the box they are in pulses gently and its arrows brighten, so you can see where the agent is working. Click one to read it as it is now. Committing clears the marks. In a folder without Git, it notes the names of the files there when the folder is opened, and marks what is new, changed or deleted since then. Folders, and files that came and went, are not listed.

## Maps

A `map.json` in a folder describes how its parts connect: boxes that point to real files, and arrows that quote real text in a real file. invader checks every box and arrow against the disk. It draws only what holds and lists what didn't, with the reason. You or your agent write the map; invader never does. **Build map** (or **Update map**) types a ready-made request into whatever program is running in the terminal, including anything that didn't check out, so start `claude` or `codex` there first. You read it and press Enter. The format is in [GUIDE.md](GUIDE.md#the-map-file).

## What it will not do

- Run anything in your folders by opening or reading them. Only what you type in the terminal runs.
- Write to your folders, except a Markdown file you edited by hand and saved. Everything else is written by the agent in the terminal.
- Start an agent or send it anything by itself. **Build map** only types the request; you press Enter.
- Use accounts, the cloud or telemetry.

## This folder

| File | What it does |
| --- | --- |
| `main.js` | Reads the open folder, saves a Markdown file edited by hand, runs the shell, watches for changes and asks Git what changed. |
| `preload.js` | The only bridge between the window and `main.js`. |
| `renderer.js` | The window: tree, changed list, files, Markdown and editing it, maps and the Build map request. |
| `terminal.js` | The terminal pane, and pasting the Build map request into it. |
| `map.js` | Checks a `map.json` against the disk. |
| `status.js` | Works out what the status strip says: which agent is running and how much of the map checked out. |
| `map.test.js`, `status.test.js` | Tests for the map checks and the status strip. Run with `npm test`. |
| `index.html`, `style.css` | The page and its look. |
| `icon.png` | The dock icon, also shown at the top of this README. |
| `kit/` | Blank apart from a README saying what a kit is and how to make your own at `~/kit`. A kit is optional. |
| `LICENSE` | MIT: anyone may use, change and share invader. |

The documents:

- [GUIDE.md](GUIDE.md): what invader is and what is decided.
- [HARNESS.md](HARNESS.md): rules for coding agents working here. `AGENTS.md` (read by Codex) and `CLAUDE.md` (read by Claude Code) only point to it.
- [DESIGN.md](DESIGN.md): how it looks.

## Where it has been tried

Only on macOS so far. Following the terminal's folder uses `lsof`, which Windows does not have.
