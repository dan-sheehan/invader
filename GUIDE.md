# invader

This page says what invader is and what is decided. When a question comes up, this page answers it. Changing a decision here is a deliberate act, not a side effect of a task.

## What it is

**North star:** invader puts any folder of your real files, a checked map of how they connect, and your coding agent's terminal in one window, with your kit on hand for you and the agent. The agent does the understanding and the writing; invader checks its map against the disk, shows live where it is working, and lets you edit Markdown by hand. It is for me first, and open source for people like me. It stays small enough that I can explain every commit.

The workspace I could not find. I build software with AI coding tools and I do not come from engineering. VS Code is built for engineers and assumes I know what I am looking at. The simple tools hide the real files. invader sits between them: my real files, shown in plain words, with the coding agent working in the same window, so I can see, understand, navigate and work in what I am building without getting lost.

It is for me first, and for people like me. I build faster than I understand, and I lose track of what exists, how it connects and what the agent just did.

alabs was the first attempt. It is inspiration, not a spec. It is not pulled: it becomes invader.

## What must stay true

- **The files are the truth.** No private formats. Anything that matters, maps included, is a file I can open without the app.
- **Maps are checked against the disk.** Every box points to real files, and every arrow is backed by real text in a real file. Missing information beats false certainty.
- **Content is data.** Opening, reading or drawing a project never runs it. The only thing that runs is what is typed into the terminal.
- **Local.** No accounts, cloud, telemetry or hosted backend.
- **Connect, don't rebuild.** Git keeps history, the terminal runs commands, Claude Code and Codex write code. invader shows what they do and makes it understandable.
- **Fast, and nothing behind my back.** Normal use never waits. Anything the app does on its own, like watching the folder, is visible.

## The daily loop

1. I open invader. It shows the folder its terminal is in.
2. In the terminal I run `claude` or `codex` and ask for a change.
3. While the agent works, the files it is changing are marked in the tree and on the map. I click one and read it as it is now.
4. When I lose track of how it fits together, I press **Build map** or **Update map**, read the request and press Enter. The agent writes the map; invader checks it.
5. I read, understand and decide. Where a Markdown file needs a small fix, I make it by hand; anything else I ask the agent for. I commit in the terminal, or ask the agent to.

## Decisions

| Question | Decision |
| --- | --- |
| Name | invader, everywhere, including `package.json` and the dock name `npm install` sets. The rocket icon fits it. |
| Stack | Electron. |
| What it shows | The folder the terminal is in, and it follows when the terminal moves. Any folder can be opened, and any folder of files works, not only repositories. It aims at the popular stacks that people like me, building with AI without an engineering background, actually use. |
| The coding tool | A real terminal inside the window (node-pty and xterm.js). `claude` or `codex` run there as they would anywhere. No model is built into the app. |
| Changed files | Marked live in the tree, on the map and in a list, from the open folder's Git status plus a watcher. Clicking one opens it as it is now. No line-by-line diffs. |
| Editing | I edit raw Markdown by hand in the app: the plain-text view of a Markdown file is editable and saves to the real file. Everything else is the agent's job. This is a deliberate change, made 2026-09-23; until then the app wrote nothing into the folders it shows. |
| kit | Optional: invader works the same without one. A kit is what I want the agent to know about me that it cannot know on its own. I drop things in raw, with no set folders or format, and the agent takes care of the rest. When the agent needs to know something about me, it looks in the kit first: if it is there, it keeps going; if not, it asks me. The invader repository ships a blank `kit/` holding only a README that says what a kit is and how to make your own. My own kit lives at `~/kit`, outside every repository, and invader keeps it in reach from whichever folder is open: it sits above the tree, apart from the open folder. The place is fixed, with no setting; decided 2026-09-23. The terminal sets `INVADER_KIT` to its path. Without a `~/kit`, nothing shows above the tree and `INVADER_KIT` is not set. invader affects an agent only when the agent is pointed at it: a line in the agent rules of the project I am working on sends it to the kit, and nothing outside invader is changed to do it. The agent's own instructions may overrule that; that is accepted. My personal context never goes into the invader repository. |
| Outside the open folder | Nothing leads outside the open folder, except my kit at `~/kit`. Keeping it in reach is a deliberate loosening of that rule, made 2026-09-23. |
| Git | Read to mark changes. Commits happen in the terminal. |
| Building maps | A **Build map** / **Update map** button types a ready-made request into the `claude` or `codex` already running in the terminal, with what did not check out. I press Enter and the agent writes `map.json`. invader never starts an agent, calls a model or writes a map. |
| Who it is for | Me first, and people like me who build with AI without an engineering background. Never teams, companies or enterprise. |
| Going public | Decided 2026-09-23: invader goes public now as the new version of alabs, open source on GitHub under my name at `dan-sheehan/invader`. alabs is not pulled: the repository is renamed from alabs to invader, which keeps its stars and redirects old links, and its `main` is replaced by one fresh commit signed with my GitHub no-reply address. The old alabs stays at its `v0.1.0` tag. The public copy lives in its own folder; the earlier copies stay frozen as private records. Pushing is public, so the agent asks me first. |
| Success | I work in it every day instead of beside it. |

## The map file

One file named `map.json` inside the folder it describes. A project's map sits at its top; any folder inside it can have its own. The agent writes it when I ask, by hand or with the Build map button; invader never does.

Its shape is small: groups, boxes, arrows. A box lists the real file paths it stands for. An arrow names two boxes, a label, and one file plus a short piece of text that must occur in that file. invader drops any box whose paths do not exist and any arrow whose text does not occur, and lists what it dropped and why. invader draws the arrows itself as hairlines from the checked data; nothing drawn comes from the file.

The shape, settled 2026-09-22:

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

A map that fails checks is drawn with what holds, and under it a list of each dropped box and arrow and why, in the error colour. Failures usually mean the disk changed after the map was written; the list is what to hand the agent. A file that is not valid JSON or not this shape shows the error and no map.

## Not now

These come in when I notice I need them: editing anything but Markdown, search, a plain-words note on what a file or folder is for (`package.json`, `node_modules/`, `.gitignore`), several terminals. Outside connections, and a safe version with a playground to try changes in, come later. A live activity feed was tried in a mockup and left out as too busy.

## What alabs taught

Keep: checked maps, the dark thin-line look, content is data, files are the truth.

Drop: the second runtime, the glossary and metaphor words, the creature framework, the pile of rule documents.
