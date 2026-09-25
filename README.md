<img src="icon.png" alt="invader" width="96">

# invader

A workspace for building software with AI coding tools when you don't come from engineering. It shows your real files in plain words, runs a terminal beside them for Claude Code or Codex, marks live which files the agent is changing, and shows what the agent is told: its instructions, permissions, what it runs on its own and what it is connected to.

You give invader access to a folder. Your agent maps what is there, and invader checks that map against the disk and shows you where you are.

## Start it

invader runs on macOS only for now: following the terminal's folder uses `lsof`, which Windows does not have. You need [Node.js](https://nodejs.org) 22.12 or newer, and Git.

Get the code, then run the rest from inside the invader folder it makes. From anywhere else, npm stops with `Could not read package.json`.

```bash
git clone https://github.com/dan-sheehan/invader.git
cd invader
npm install
npm start -- /path/to/a/folder
```

Leave out the folder to open the last one it showed, with the tabs you had open there.

This copy is **next-invader**: it keeps its own memory in `~/Library/Application Support/next-invader/`, apart from invader's, so the two never share recent folders or tabs. `npm install` names the Electron it runs `next-invader`, so the dock and menu say so; if you installed before that, run `npm install` once more, or it still says invader.

The first `npm install` warns that node-pty's install scripts are not approved (`allowScripts`). That is expected, and invader still works: it uses the build node-pty ships for your Mac.

### Open it like any other Mac app

```bash
npm run app
```

builds `dist/next-invader-darwin-arm64/next-invader.app` inside this folder (`-x64` on an Intel Mac). Open it from the Finder, or drag it to the Dock; it needs no terminal behind it and no `npm start`. It holds its own copy of Electron, the app's files and the packages it runs on, so it keeps working while you change the code here; run `npm run app` again to build it from the code as it is now. It uses the same data folder as `npm start`, so both open where you left off. It is signed only for this Mac (ad hoc), not for giving to anyone, and it is not installed or moved anywhere: copy it to Applications yourself if you want it there. Its terminals start your login shell as Terminal does, reading your profile, so `claude`, `node` and the rest are found as they are there.

To run `claude` or `codex` in its terminal, install their command-line tools and sign in to them. The app itself never starts them and never calls a model.

If `claude` is not found after installing it, your shell is not looking in `~/.local/bin`, where it was put. Add that folder once, then open a new terminal:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

## What you see

- **Top:** the open folder's name: click it, or press ⌘O, to switch to a folder you opened before, or to open another (⇧⌘O). Then a status strip: what runs in the chosen terminal, like `claude running` or `node running` (nothing while its shell waits at the prompt), what claude or codex just did in this folder, wherever it runs (like `claude read map-view.js`), `not watching` if the folder cannot be watched, the Git branch, how many files changed (click it for the **changes** tab, which lists them; or `cannot be read` when Git cannot say, until it can again), and how many boxes and arrows the top map kept, like `map 14/14 kept` (rest the pointer on it for what was checked, or click it to open the map). Then **Go to file** (⌘P) and **Build map** (or **Update map**).
- **Left:** the folder as a tree, then **agent setup** (see below) and your kit, `~/kit/`, if you keep one there. Click a folder to open it as a map, and it unfolds in the tree; click it again while it is shown to fold it away. Every folder opens as a map: its own `map.json` when it has one, or else one invader draws from the folder, with a box for each folder in it, named by its README title, then its files and its README. Click a box to go in. On a written map, a box that stands for one folder has **open ›** to go in. Going from folder to folder stays in the same tab, and the line at the top, like `home › projects › defiance`, takes you back up. Folders at the top of the open folder show the first two words of their README title; rest the pointer on them to read all of it. A kit is optional; [kit/README.md](kit/README.md) says what it is and how to make one. The kit stays there whichever folder is open, and its files open like any other. It is watched too: what the agent changes there is marked live and an open kit file is read again, but it stays off the changes page. The terminal sets `INVADER_KIT` to its path, so your agent can find it when you tell it to. Finder's `.DS_Store` files are never shown. `.git/`, `node_modules/` and `.gitignore`, kept for Git and npm rather than written by you, are hidden behind a dim row at the end of their folder, like `3 hidden: .git/ node_modules/ .gitignore`; click it to show them.
- **Middle:** tabs, as in a browser. **Overview** is always first (⌘1): the open folder's own page: its map, or its README if it has no map, and under it what happened here (the last three claude and codex sessions, each of which you can replay on the map, the links and paths in its Markdown files that point at nothing, and the last five commits). Each file or folder you click, and **agent setup**, **changes** or **preview**, opens in its own tab after it, and opening one already open goes to its tab; its × closes it, and closing the tab shown goes to the one before it. Markdown is rendered, and a link to another file in the folder opens it here, at the heading a `#section` names, or the line a `#L12` names; a link is read from the document it is in, and one to a file that is not there says so rather than open anything. Every other file is shown with its line numbers: click a number to choose that line, shift-click to choose the lines between. A file over 2 MB, like a log, shows its first 2 MB, to read only. Beside a file's name: the lines chosen, the box on the top map that names it or a folder holding it (click it to see the box on the map), **Show in tree**, which unfolds the tree to it, and **Copy reference**, which copies its path and lines, like `src/app.js:12-18`, for the terminal or a prompt. Nothing is typed into the terminal: you paste it. A `map.json` is drawn as a map; one that cannot be drawn says why and what to do, and the folder is drawn from the disk under it until it is fixed. **show only the map**, on the line above it, gives it the whole window; **show everything** or Esc brings the rest back. A Markdown file's **Edit** view can be edited by hand: **Save** (or ⌘S) writes it back to the file, **Discard** drops the edit. An edit not saved stays with its file while you look at other tabs, and its tab shows a dot; closing that tab asks first. A moment after you stop typing, next-invader also keeps a copy of the edit in its own data folder, never in yours, and beside Save it says `not saved · kept`; until then it says `not saved`, and if it cannot keep one, `not saved · not kept`, with why. So quitting, a crash or switching folder does not lose it: when the folder opens again the edit comes back in its tab, marked **Recovered**, still not saved to the file until you press Save. If the file changes on disk while you are editing, or since the edit was kept, for example because the agent edited it, a bar over the editor says so and nothing is saved until you choose: **Save mine over it** or **Load the disk version**. If the file is moved or deleted, the edit stays for you to copy or discard. A save that fails says why and keeps both the edit and its copy. Discard, **Load the disk version**, or closing its tab, drops the copy too, so it never comes back. Quitting asks once, before anything ends, about unsaved edits and programs running in terminals together: **Save and Quit** saves every edit and quits only if every one was saved, **Quit** quits with the edits kept, and **Cancel** leaves everything as it was. If the terminal changes folder while an edit is not saved, the window stays until you Save or Discard.
- **Right:** terminals, each running your usual shell. The bar over them has a tab for each, named by what runs in it (`claude`, `node`, `shell`), with its own folder after the name when that is not the folder shown; double-click a tab to give it a name of your own, like `server`. **+** (⌘T) opens a new one in the folder shown; it runs nothing until you type. ⌃\` and ⌃⇧\` move between them. Each keeps its own shell, output and scrollback, and switching never restarts or clears one. At the right of the bar, the chosen terminal's folder; its dot turns blue while your typing goes to it. A tab's × closes it; when something runs in it, like a dev server or claude, it asks first, since closing stops it. Quitting asks the same, and nothing that ran in a terminal starts again when you open next-invader: it opens with one new shell. **Hide** (⇧⌘J) folds it to a thin strip so the file or map gets the room; click the strip to bring it back. ⌘J puts the keyboard in the terminal, or back in the middle. What runs in it keeps running, and **Build map** brings it back so you can read the request. While it is hidden, the strip says when the agent in it has gone quiet, for example `claude is waiting`: it has finished or is asking you something.

  The window follows the terminal you have chosen: `cd` in it and that folder is shown. A terminal you have not chosen never moves the window, even when its shell changes folder, and never takes the keyboard. To work in two projects at once, leave a terminal running in one; its tab keeps saying which folder it is in.

  A file named in what a terminal prints, like `src/app.js:12` or `at run (/Users/me/app/src/app.js:12:5)`, is underlined when the pointer is on it, only if it is really there in the open folder or your kit; ⌘-click opens it in the middle at that line, and the keyboard stays in the terminal. A plain click is left to the terminal, for selecting. A full path opens directly. A relative path is read from the folder that terminal's shell was in when it printed it, never another terminal's, but a command can print one from somewhere else, as a subshell `(cd lib && ls)` or a script does. So a relative path opens directly only when it is the one file in the open folder by that name; when there are more, like `notes.md` both here and in `docs/`, ⌘-click asks which one, the one where the shell was first, and opens nothing until you pick. When the shell changed folder while a command ran, like `cd src && ls`, where its paths came from is not known, and ⌘-click asks before opening even one. An address on this computer, like `http://localhost:5173/`, opens in the preview with ⌘-click.

  Pasting more than one line into the shell, or a line copied with its prompt like `$ npm test`, asks first. The shell runs each line as its own command, so a block copied from a chat, with what the commands printed, turns into errors. You can paste only the commands, all of it, or nothing. Nothing runs until you press Return. Pastes into `claude` or `codex` go straight in.

## What changed

What changed since the last commit is listed, marked `new`, `changed` or `deleted`, on the **changes** tab, so the tree and the map stay plain to work in. While the agent works, files touched in the last few seconds get a yellow edge in the tree, the line under the open file's name turns yellow when it changes under you, usually because the agent is writing to it, and on the map the box they are in pulses gently and its arrows brighten, so you can see where the agent is working. What it reads, or names in a shell command, gets a white outline for a few seconds, from the record it keeps of the session, so you see it look around before it changes anything. That works wherever it runs, including the Claude and Codex apps, and counts what Claude Code's helpers read too. Click a file to read it as it is now; on the map, select its box first, then its file. Committing clears the list. In a folder without Git, it notes the names of the files there when the folder is opened, and lists what is new, changed or deleted since then. Folders, and files that came and went, are not listed.

## Agent setup

Much of what makes claude or codex behave the way it does sits in files you never see: instructions in `CLAUDE.md` or `AGENTS.md`, here, in folders above, or in your home folder; settings that say what it may do without asking; hooks it runs on its own; connections to outside services; skills, commands and helper agents, including skills and plugins Claude Code keeps in step with your claude.ai account (marked `synced from claude.ai`). **agent setup**, under the tree, lists all of them for the open folder, in plain words: whose each one is, how far it reaches (you in every folder, a folder above, this folder, only you in this folder) and the file it lives in. The row beside it counts them, like `claude 11 · codex 2`.

At the top of the page, **Read before you type** says how much each agent reads at the start of every session here, in words: its instructions by where they come from (this folder, the folders above, files that reach every folder), including files a `CLAUDE.md` brings in with `@`, and the names and descriptions of its skills, commands and helpers. It all takes room the conversation could use. Connections and plugins add their own tools on top; invader cannot count those without starting them, so it only says how many there are.

Files in the open folder open like any other. Files outside it, like `~/.claude/settings.json`, open read-only, with anything under `env` or `headers` and anything that looks like a key or password hidden. From `~/.claude.json`, which is Claude Code's own record, only the connection you clicked is shown. The page is read again when one of these files changes in the open folder, and whenever the window comes to the front. invader never changes them: ask the agent, or edit the file.

## Last sessions

claude and codex each keep a record of every session on your computer, outside your folders. The open folder's own page lists, under its map or README, the last three sessions that ran in it: when, which agent, the name you gave it with `/rename`, or that **Build map** or **Update map** started it, or else the first line you typed, the files it changed, how many files it changed outside this folder, how many shell commands it ran, and how many commits were made while it ran (rest the pointer on them to read them). Anything in that first line that looks like a key or password is hidden. Files it changed by running a command count too, when the command names the file it writes, like `cat > notes.md`, `sed -i` or a script's `open('game.js', 'w')`. A command that works out a file's name as it runs is not seen, which is why the row says how many commands it ran; if it committed those files, they are in the commits. The **changes** tab shows which of these sessions did what: the files one of them changed after the last commit are listed under a line naming it, with **replay**, and everything else under **other changes**, so before you commit you can see which agent changed what. Without Git, it counts what they changed after the folder was opened. If one of the newest records cannot be read, the list says so, since a session may be missing. invader only reads these records, and nothing of the conversation itself is shown. While a session runs, invader reads the lines added to its record every two seconds, to outline what the agent reads.

**replay**, at the end of a session's row, plays that session back step by step, on the map, which gets the whole window while it plays, or on the tree when the folder has no map. Each step lights what it worked on in this folder: a box or row it changed, with its edit tools or a command that writes it, gets the changed colour, one it read or only named in a shell command a white outline, and what it changed so far stays marked. Each step shows for under a second, so most sessions play back in under half a minute. The bar above says when each step happened and what it did; **back**, **pause**, **next** and **stop**, or ←, the space bar, → and Esc, move through it. Under the bar, a line of ticks shows every step, the tall ones in the changed colour where it changed files, so you can see where the work happened; click or drag along it to go to any step. It works for sessions run anywhere, including the Claude and Codex apps, in folders without Git, and long after the live marks have faded. A file written by a command, like `cat > game.js`, shows as changed.

## Links to nothing

Folders get renamed and moved, and the links and paths written in your notes go stale without a sound. The open folder's own page says in one line how many files point at nothing; click it to list them, one row per file, and click the heading to fold the list away. What counts is anything in its Markdown files that points at nothing: links to files that are not there, paths written out in full, starting with `~/` or `/Users/`, that are not on this computer, and files a `CLAUDE.md` brings in with `@` that are not there. Rest the pointer on a row to read each one; click the file to open it with the first one marked. A path written out under the agents' own folders (`~/.claude`, `~/.codex`, `~/.agents`), like `~/.codex/requirements.toml` in a plan, is left out: files there are optional, so a note naming one usually describes it rather than points at it. Agent setup shows what is really there. A link into those folders still counts.

## Preview

When your project has a web page, you can use it beside its files. Start its dev server yourself in a terminal, for example `npm run dev` in a second terminal (⌘T), then open **preview** (⌥⌘P, or View › Preview) and type the address the server printed, like `http://localhost:5173` or just `5173`, and press Return. Or ⌘-click the address where the terminal printed it. The page works as in a browser: its scripts, forms, scrolling, routes and the dev server's own live reload. Going to a file and back to the preview leaves the page as it was; it is not loaded again.

Over the page: ‹ and › go back and forward in it, ↻ (or ⌘R, only while the preview is shown) loads it again, and **Open in browser** opens it in your web browser. ⌘F finds text in the page, with the page's own find, as a browser does: Return or ⌘G goes to the next place, ⇧⌘G the one before, and Esc gives the keyboard back to the page. A server on https usually makes its own certificate, which nothing trusts; the preview does not load that page, says why, and offers **Trust it until I quit**, for that address and that certificate only, remembered nowhere, or **Open in browser**. When nothing answers, because the server is not running or is on another port, it says so, with **Try again**. Closing its tab closes the page. The address is remembered with the folder's tabs; when you come back, it waits for you to press **Load**, since the server may not be running, and nothing is ever started for it.

Only pages on this computer open there: http or https to `localhost`, a name ending `.localhost`, `127.0.0.1` (or any `127.x.x.x`) or `[::1]`. The page is not trusted: it runs apart from the window, with no access to your files, the terminals or anything of invader's, and with its own storage, forgotten when the app quits. A link or redirect to anywhere else is stopped, and a bar offers to open it in your browser. New windows, downloads, and requests for the camera, location, notifications and the like are refused. What the page loads by itself, like fonts, scripts or an API on the internet, is fetched as any browser would. There are no devtools in the preview: open it in your browser for those. A project with no web page needs none of this.

## Getting around

**Find in Folder** (⇧⌘F) finds text as written, ignoring case unless you turn on **Match case** (⌥C), in the open folder's files, not your kit. Each file found is listed with its lines, the text found marked; pick one to open the file at that line, with the find bar holding the text so ⌘G goes on to the next place in the file. It says what it did not look in: folders tools make (`.git/`, `node_modules/`, `dist/`, `build/` and the like), binary files, files over 2 MB and links leading outside the folder. It stops at 500 lines found, and says so. Opening it again brings back the last search, run again. A new search, or switching folder, stops the one running. Nothing is kept or indexed: it reads the files when you search.

Switching folder with ⌘O moves the chosen terminal there too, by typing `cd` into its shell, so it works only while that shell waits at its prompt; while claude or a dev server runs in it, it says so and moves nothing: choose another terminal, or open a new one, and switch again.

**Back** (⌘[, or ‹ beside the tabs, or the mouse's back button) goes to where you were before, at the place you were reading; **Forward** (⌘]) comes back. Each tab also keeps its place while the window is open, so going back to it finds you where you left off. An edit not saved stays with its file however you move around.

Drag the line between two panes to resize them; double-click it to put it back. next-invader remembers, in its own data folder and never in yours: the window's size and place, the pane widths, whether the terminal is hidden, how big the text is, up to twelve recent folders, and for each of them the tabs you had open, where you were reading in each (how far down, the first line in view, the editor's cursor) and the folders unfolded in the tree. Only the view comes back: what the tabs show is read from the disk again, a place past the end of a file that got shorter goes to its end, and the terminal starts fresh in the folder. A tab whose file has gone says so. Unsaved edits come back too, as above; nothing else you did, typed or ran is kept.

| Keys | What they do |
| --- | --- |
| ⌘P | Go to any file or folder here by typing part of its name; `app.js:12` goes to line 12 |
| ⇧⌘F | Find text in the open folder's files, and open a line found |
| ⌘F, ⌘G, ⇧⌘G | Find in what the middle shows, or in the preview's page; next; previous |
| ⌘L | Go to a line of the file open |
| ⌘[ ⌘] | Back and forward through what you opened, each where you were in it |
| ⌥⌘C | Copy a reference to the file open, with its lines |
| ⌘O, ⇧⌘O | Switch to a recent folder; open another |
| ⌘1 … ⌘9 | Go to the Overview, or the nth tab |
| ⇧⌘] ⇧⌘[ or ⌃Tab ⌃⇧Tab | Next and previous tab |
| ⌘W | Close the tab in the middle (not while the keyboard is in the terminal) |
| ⌘S | Save the Markdown you are editing |
| ⌘J, ⇧⌘J | Keyboard to the terminal and back; hide or show the terminals |
| ⌘T, ⌃\` ⌃⇧\` | New terminal; next and previous terminal |
| ⌘K | Clear the terminal, while it has the keyboard |
| ⌘A | Select all in what has the keyboard: the terminal's output, the box you type in, or the middle |
| ⌥⌘P, ⌘R | The preview; load its page again |
| ⇧⌘C, ⇧⌘A | The changes tab; agent setup |
| ⇧⌘M, Esc | Show only the map; everything again |
| ⌘= ⌘- ⌘0 | Text bigger, smaller, as it was |

No key reloads the window, so nothing wipes it by accident; ⌘R reloads only the page in the preview. Keys act on what has the keyboard: ⌘W, ⌘K and ⌘A never reach past the terminal to the middle or the other way, and a palette (⌘P, ⌘O, ⇧⌘F, ⌘L) closed with Esc gives the keyboard back where it was, the preview's page included. Every other key, ⌃C and the rest, goes to the terminal as it is.

## Maps

A `map.json` in a folder describes how its parts connect: boxes that point to real files, and arrows that quote real text in a real file. You or your agent write the map; invader never does. It checks the map against the disk every time it reads it, draws only the boxes and arrows it kept, and lists under the map each one it dropped and why, in the error colour. The line above the map and the status tooltip say what was checked: the named files and folders exist in the open folder, and each quote occurs in its file. Labels are not checked, and important parts may be missing. The status strip counts the boxes and arrows kept. Dropped parts usually mean the disk changed after the map was written; the list is what to hand the agent.

**Build map** (or **Update map**) types a ready-made request, including anything invader dropped and why, into the chosen terminal when `claude` or `codex` runs there, or else into the one terminal where one of them runs, so start `claude` or `codex` first. When they run in more than one terminal, or in none but some other program runs, it asks which terminal, and Esc types nothing: it never picks a dev server by a guess. You read the request and press Enter.

Each group on the map has its own colour, and its files carry it as a small square in the tree, on the changes page and on their tabs, so you can see which part of the project a file belongs to; rest the pointer on a file in the tree to read its box. claude and codex each have a colour too, wherever they are named. Boxes show their labels and count the files and folders they name. Select one to highlight its connections and see its full file list in a panel below. Select an incoming or outgoing arrow there, or an arrow on the map, to read its label and exact quote; click the source file to open it with the quote marked. Arrow labels appear for the selection, on hover or keyboard focus, and for live work. **Clear selection** returns to the overview. You can also use Tab and Enter to select boxes and arrows.

### The map file

One file named `map.json` inside the folder it describes. A project's map sits at its top; any folder inside it can have its own. Its shape is small: groups, boxes, arrows. A box lists the real paths it stands for. An arrow names two boxes, a label, and one file plus a short piece of text that must occur in that file. invader draws the arrows itself as hairlines from the checked data; nothing drawn comes from the file.

```json
{
  "groups": [
    { "label": "Rules", "boxes": [
      { "id": "harness", "label": "Workspace rules", "paths": ["HARNESS.md"] },
      { "id": "pointers", "label": "Agent pointers", "paths": ["AGENTS.md", "CLAUDE.md"] }
    ]},
    { "label": "Areas", "boxes": [
      { "id": "projects", "label": "Projects", "paths": ["projects/"] },
      { "id": "zgarbage", "label": "Trash", "paths": ["zgarbage/"] }
    ]}
  ],
  "arrows": [
    { "from": "pointers", "to": "harness", "label": "send agents to",
      "file": "AGENTS.md", "text": "Read and follow [HARNESS.md]" },
    { "from": "harness", "to": "zgarbage", "label": "sends deletions to",
      "file": "HARNESS.md", "text": "move it to `zgarbage/` instead" }
  ]
}
```

- Groups hold their boxes. A box has an `id`, a `label` and `paths`.
- Every path is relative to the folder the map sits in, and may be a file or a folder. A path ending in `/` must be a folder.
- An arrow has `from` and `to` (box ids), a `label`, a `file` and a `text` that occurs in that file exactly as written.
- `groups` is required. `arrows` may be left out, and the map then has no arrows.
- A box id used twice is a shape error, not a dropped box.
- A box is dropped when any of its paths does not exist, is outside the open folder, or ends in `/` and is not a folder. An arrow is dropped when either box is missing, its file does not exist or is outside the open folder, or its text does not occur in the file. Paths are checked after following symlinks.
- A file that is not valid JSON or not this shape is refused whole: it shows why, and no map.

## What it will not do

- Run anything in your folders by opening or reading them. Only what you type in a terminal runs, and the page your own server serves, when you open it in the preview.
- Start a server, look for one, or open an address by itself. The preview shows only an address you type or ⌘-click.
- Write to your folders, except a Markdown file you edited by hand and saved. Everything else is written by the agent in the terminal.
- Look inside your files before you ask: Find in Folder reads them only when you search, and keeps nothing.
- Read outside the open folder, except your kit, the agent's own setup files and the records claude and codex keep of their sessions, which it only reads. To find links and paths that point at nothing, it asks whether each path a Markdown file names exists, and nothing more.
- Start an agent or send it anything by itself. **Build map** only types the request; you press Enter.
- Use accounts, the cloud or telemetry.

## Model benchmarks

New models come out every week. Before trusting one with your work, see how it does invader's own work: `npm run bench -- <agent:model>` runs `claude`, `codex` or `opencode` with that model, with nobody at the keyboard, on three tasks in a throwaway copy of invader:

- **map:** the request **Build map** types. invader checks the map it writes, and nothing else may change.
- **find:** four questions about the code, each with one right answer, written to a file.
- **fix:** a bug planted so `npm test` fails. It passes when the tests pass again and no test was changed.

```bash
npm run bench -- claude:sonnet codex opencode:opencode/space-bunny-free
npm run bench -- claude:haiku --task find
```

A task still running after 5 minutes is stopped, with everything it started, and fails. A task ends as soon as the agent does: anything it left running is stopped then, so a quick agent is timed as quick. Each result, with how long it took, is added to `bench/results.md`, which is not committed. The copies and what each agent printed stay in the folder it names, in the system's temporary folder. The app never runs the benchmarks. They use your own logins for claude, codex and opencode, and send only the copy of invader's own code.

## This folder

The app is two parts: `main/` reads the disk and runs the shells, and `window/` is what you see. They talk only through `main/preload.js`. `icon.png` is the dock icon, also shown at the top of this README. `kit/` is blank apart from [kit/README.md](kit/README.md), and `LICENSE` is MIT: anyone may use, change and share invader.

The documents:

- [decisions.md](decisions.md): what invader is for, what must stay true, and what is decided and why.
- [plumbing.md](plumbing.md): how it is built, file by file, where its state lives, and what it reads, writes and runs.
- [design.md](design.md): how it looks and moves.
- [HARNESS.md](HARNESS.md): how coding agents work here. `CLAUDE.md` (read by Claude Code) brings it in, and `AGENTS.md` (read by Codex) points to it.
