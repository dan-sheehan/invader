# invader design

How it looks and moves. Nothing here decides what it does; that is in [README.md](README.md) and [decisions.md](decisions.md).

## The look

A command center that feels alive, not busy. A flat, dark technical map. Thin lines, dense information, monospace for anything literal (paths, names, counts). No cards, shadows, gradients or decorative icons.

Dark is the reference. Decide everything against the dark window.

The icon is the invader symbol, a rocket carrying the invader, in white on the dark background with a thin grey edge. It is `icon.png`, shown in the dock while the app runs and at the top of the README.

## Colour

Dark background and white text are the base. Colour is added only where it has a job. Neutral dark surfaces, no coloured fills. Colour does its work through outlines, connection lines and small marks.

| Token | Value | Job |
| --- | --- | --- |
| bg | #1a1a1a | Background of the middle, where I read |
| side | #151515 | The top, the tree, the tab row and the terminal: one step darker, so the middle reads as the page without a border around it |
| hover, sel | #222222, #272727 | Hover and selection surfaces |
| line, border, line-strong | #2a2a2a, #363636, #4a4a4a | Hairlines, faint to firm |
| text, strong, muted, dim | #d6d6d6, #ffffff, #8c8c8c, #5f5f5f | Text, emphasis down to detail |
| pos | #4ea1ff | Where you are: the tab shown, the row open, the line being dragged, the terminal's dot while it has the keyboard, the palette row chosen, the line gone to and the place found |
| folder | #9a9a9a | Folders |
| error | #f26b6b | Something failed or did not check out |
| changed | #e2c08d | A file changed since the last commit: the word new, changed or deleted, and a mark on what changed in the last few seconds, including the line under the open file's name |
| part-1 to part-5 | #a896f0, #5cc4d4, #e592b8, #b1cc78, #9fb0c8 | A part of the project: each group on the top map, in order, starting again after the fifth. The group's heading and the rule under it, the left edge of its boxes, the arrows that start from it (faintly), and a small square before each of its files in the tree, on the changes page and on the file's tab. A folder that is not in a box but holds only one part's files gets the square as an outline. A file in no box gets no square. |
| claude, codex | #d97757, #62d0a4 | Who: the agent's name, wherever the window names it (the strip, sessions, the changes page, the replay bar, agent setup) |

One colour, one job. Add a token only for a new job. The part colours are what the window has instead of file-type colours: they say where a file belongs in the project, which is what I lose track of.

## Type

System sans for the interface. Monospace for anything that is a literal from the disk.

Emphasise once. Not size, colour, weight, border and icon on the same thing. The current file and map labels lead; paths, timestamps and routine status support them. Explanations needed to judge what is shown use the normal text colour, never dim.

## Maps

Flat groups, hairline arrows, labels that say what one part does to another. Group headings line up at the top, with a rule under each heading and no border around the group. Boxes lead with their label and count the files and folders they name; the full paths appear when selected. Boxes stay plain while I work; only live work and a replay mark them. Anything that did not check out against the disk is left out or marked, never drawn faintly as if it were true.

A map fits the middle pane, and sits in the middle of it, with the same room on either side. Its group headings line up along the top; under them, each group's boxes sit in the middle of the height the tallest group takes, so a short group does not hug the top. Its columns and the space between them narrow together, then the whole map is drawn smaller, down to 80%. Only a map with more columns than that scrolls sideways, and the line above it says so. That line always offers **show only the map**: the tree, the terminal and what happened here step aside and the map gets the whole window, until **show everything**, Esc, the terminal button, or anything in the middle that is not a map. An arrow's label wraps onto more lines rather than run into the boxes. An arrow that skips columns crosses each one between two boxes or under the group, never behind a box. A loop within one column goes out on the right, or on the left of the first column, where no other arrow is. Each label sits on its own arrow, at the clearest place it can find: covering as few other labels as it can, then groups, then lines, and nearest the middle among places as clear. When there is room it covers none; on a crowded map it may still cover something. Lines are drawn first, so none is drawn over a label.

The map counts and the link to show only the map share a row. Under them, in normal reading text, the check explanation says what was found and what was not checked.

Selecting a box keeps the map open. Its arrows and their other boxes are outlined in the position colour; unrelated arrows recede, while live work stays visible. Arrow labels appear for a selected box or arrow, on hover, with keyboard focus, and for live work. A flat panel at the bottom of the middle pane lists the selected box's files and incoming and outgoing arrows, or a selected arrow's label, source file and exact quote. The panel stays put while the map scrolls, with room at the end to bring every box above it.

## Pages

The center pane gets most of the width, with a narrower file tree and terminal beside it. The lines between them can be dragged; a line being dragged or pointed at shows in pos. When the window is too narrow for the widths chosen, the terminal gives way first, then the tree, so the middle keeps at least 360 pixels. Routine status has no border around each cell; changed files, failures and live work carry the emphasis.

The middle pane holds one thing at a time: a file, a map, or a page invader builds, like agent setup. A page is plain text in sections, each with a heading and one dim line saying what the section is, then items split by hairlines. An item leads with whose it is (`claude`, `codex`) in monospace, its name in strong text and its reach on the right; details follow as short monospace lines, and its file last, as a link. Something turned off or not read is drawn muted, never hidden, except a Claude plugin that is turned off, which is left out. A long section shows eight items and `and N more`.

The top reads left to right: the folder's name in strong text with a small chevron, which opens the folder switcher; the status strip; a note when there is one; then **Go to file** with its key, quiet, and **Build map**.

Before the tabs, a hairline apart, ‹ and › go back and forward, dim when there is nowhere to go. Tabs sit over the middle, one row of them: **Overview** first, with no ×, then each file (in monospace) or page opened, in the order opened. The tab shown has strong text and a 2 pixel line under it in pos; the others are muted. A tab's × shows on hover and on the tab shown. A file with an edit not saved shows a dot in place of its ×, until the pointer is on it.

The editor says `editing` in dim text, or, with a dot, `not saved`, then `not saved · kept` once a copy is kept for recovery (`not saved · not kept` in error when it cannot be), beside **Discard** and **Save** (Save outlined in pos); its tooltip says what each means. When the file changes on disk under an edit, or an edit comes back **Recovered**, a bar sits over the editor, faintly tinted with changed and ruled in it, saying so in strong text with its choices; a save that fails, or a file gone from under its edit, gets the same bar in error.

A file that is not rendered is shown by its lines, each with its number before it in dim monospace, right-aligned; long lines wrap under themselves, so the pane never scrolls sideways. The lines chosen are tinted sel, their numbers in text colour. A line gone to, from search, a link, the terminal or ⌘L, gets a pos edge and tint that fade over a second, and the text found on it is tinted pos. Beside the file's name, quiet: the lines chosen in dim monospace, the box on the map that names it with its part's square, **Show in tree** and **Copy reference**. When the head is short of room the trail keeps it and these give way, the ones the Go menu also has first.

The find bar (⌘F) sits under the file's name, on side: an input, `3 of 12` in dim monospace, ↑ ↓, **Aa** for match case, and × at the right. Every place found is tinted a light grey; the one gone to is tinted pos. In the editor, which cannot be tinted, the one gone to is outlined in pos. An input with nothing found gets an error-tinted edge.

The palette (⌘P, ⌘O) is the one thing that sits over the window: a box near the top on a dimmed window, a large input, rows of names in monospace with their folder muted after them and the letters matched in pos, the row chosen tinted with pos, and a dim line at the foot saying the keys. Its rows carry their part's square, like the tree. Find in Folder (⇧⌘F) uses the same box, wider: each file as a row in text colour with its part's square and how many lines on the right, then each line under it, its number dim and right-aligned, its text in monospace with what was found in pos. The foot says, in one line that wraps, what was searched and what was not, after **Match case**; while it searches, the rows dim and the foot says `Searching…`.

A file named in the terminal is underlined while the pointer is on it, and a small box under the pointer, like the palette's, says `⌘-click to open src/app.js, line 12`.

The terminals share a thin bar: a dot, then a tab for each terminal, in monospace: what runs in it (the agent in its colour) or the name I gave it, and, dim and smaller, its own folder when that is not the folder shown. The chosen tab is strong text over a 2 pixel line, line-strong, turning pos while it has the keyboard; the others are muted, and a tab's × shows on hover and on the chosen one. Then a quiet **+**, the chosen terminal's folder in dim monospace pushed right, and **Hide**. A name I gave is cut short at 18 characters. In a narrow pane the folder steps aside, **Hide** becomes ›, and the tabs scroll with the chosen one kept in view. The dot is pos while a terminal has the keyboard, so I always know where my typing goes. Their colours are tuned to the window, and their text is 13 pixels.

The preview is a tab like any other, named `preview`. Its head is one line: quiet ‹ › and ↻, the address in a monospace field on side with a hairline border, turning pos while I type in it, a dim word for what the page is doing (`loading`, `not loaded`, or `not reachable` in error; nothing while it shows), and a quiet **Open in browser**, which becomes ↗ when the middle is narrow. Find in the page uses the same find bar as a file. A certificate not trusted says so in the middle, like a page that did not load, with **Trust it until I quit** outlined and **Open in browser**. Under it the page fills the rest of the middle, drawn by the page itself, light or dark as it likes. When it has nothing to show, the middle says why in plain text, like any page, with one outlined button to go on: **Load**, **Try again**. A navigation stopped, or a download refused, is a flat bar on side above the page, ruled under in line-strong, with its one action and ×. The palette hides the page while it is open, since nothing may be drawn over it.

The left side is the folder as a tree, then **agent setup** and `~/kit/` under a hairline. Clicking a folder opens it in the middle and unfolds it, without moving the tree; clicking it again while it is shown folds it. Only the top folders show their README title in the tree.

A folder with no `map.json` is drawn in the map's look: its counts and one line saying it was drawn from the folder, then a grid of boxes, one per folder in it, each led by its README title (else its name) with its name in monospace under it and its part's colour on the left edge, then `Files here` as rows like the tree's, then its README under a hairline. A box on a written map that stands for one folder has a muted **open ›** at its bottom right.

The top of every file and folder is a trail: the open folder's name and each folder on the way in muted monospace links, split by a dim `›`, and the last one in strong text. A `map.json` ends in `map`. The tree shows no changed words or counts, so it reads as the folder.

The list of what changed, on the changes page, is one row per file. When one of the last sessions changed some of them, each group of files sits under a muted line: the agent in monospace, when it ended, what it was asked in text colour, cut to fit, and **replay**. The rest follow under a dim `other changes`. With no session to name, there are no lines and the list is as it always was.

The open folder's own page starts with its map or README, so it opens as a place to work. What happened here follows under it, after a hairline: the last sessions, each with a muted line under it on what it changed, ending with **replay**, then one line saying how many files point at something that is not there, which opens into one row per file with the targets in the error colour, then the last commits. Sessions and commits sit side by side when the center pane is wide enough, and stack when it is narrow. The branch and how much changed are left to the status strip, and what the agent is told to the **agent setup** row, so nothing is said twice.

While a session is replayed, a bar sits above the file or map: `Replaying`, the agent and what it was asked on one line, with **back · pause · next · stop** on the right; under it, when the step happened, what it did (the word `changed` in the changed colour) and its files in monospace, and `step 5 of 14` dimmed, all on one line, the files cut short first. Under that, the timeline: a hairline with one tick per step, evenly apart and 1 to 3 pixels wide, full height in the changed colour where a step changed files and half height in dim where it read them or named them in a command, so where the work happened shows at a glance. The step shown is a 2 pixel mark in pos, a little taller than the ticks. Clicking or dragging along the line goes to the step there and pauses; resting the pointer on it says which step is there.

## Motion

Alive, not busy. Something moves only when something real happens: the map box the agent is working in pulses and its arrows brighten, and marks fade in and out as files change. Everything else stays still. No decorative motion. The terminal moves as fast as the agent does; the rest of the window stays calm around it.

- A mark fades in over 0.4 s when it appears and out over 1 s when it goes, where it was. A mark already on screen stays still when the tree or map around it is drawn again.
- The box the agent is working in, one with a file that changed in the last 8 seconds, gets an outline in the changed colour that brightens and dims on a 2.4 s beat. Its arrows go from line-strong to text. Each file's recent mark ends on its own time, so the pulse follows the agent from box to box.
- The open file, while it changed in the last 8 seconds, gets the line under its name in the changed colour, so I can see what I am reading change under me, usually because the agent is writing to it; my own Save marks it too. Its row in the tree is drawn as the open file, which hides the tree's own mark.
- A file the agent read or named in a command, from its record, gets the replay's steady outline in the text colour on its box and the left edge of its row, fading in over 0.4 s and out over 1 s, 8 seconds after the step. A box that pulses keeps its pulse. The status strip holds one more cell while it works, its newest step, like `claude read map-view.js`; its words change where they are, and a long file name is cut short.
- The open file and map are drawn again only when what they show changed.
- A replay shows each step for 20 seconds divided by the number of steps, kept between 0.15 and 0.8 seconds. The box the step shown works in holds a steady outline instead of the pulse: in the changed colour when it changed a file there, in the text colour when it only read one or named one in a command. In the tree the row's left edge does the same. What it changed so far keeps its changed border and count. Marks come and go within 150 ms, so they keep up.
- With Reduce motion set in the system, marks change at once and the pulse holds still.

## Words

Plain, short, factual. Say what happened and what to do. One name per thing.
