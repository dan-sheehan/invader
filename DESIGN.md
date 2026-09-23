# invader design

How it looks. Nothing here decides what it does.

## The look

A command center that feels alive, not busy. A flat, dark technical map. Thin lines, dense information, monospace for anything literal (paths, names, counts). No cards, shadows, gradients or decorative icons.

Dark is the reference. Decide everything against the dark window.

The icon is the invader symbol, a rocket carrying the invader, in white on the dark background with a thin grey edge. It is `icon.png`, shown in the dock while the app runs and at the top of the README.

## Colour

Dark background and white text are the base. Colour is added only where it has a job. Neutral dark surfaces, no coloured fills. Colour does its work through outlines, connection lines and small marks.

| Token | Value | Job |
| --- | --- | --- |
| bg | #1b1b1b | Background |
| hover, sel | #222222, #232323 | Hover and selection surfaces |
| line, border, line-strong | #2c2c2c, #363636, #4a4a4a | Hairlines, faint to firm |
| text, strong, muted, dim | #d6d6d6, #ffffff, #8c8c8c, #5f5f5f | Text, emphasis down to detail |
| pos | #4ea1ff | Where you are |
| folder | #9a9a9a | Folders |
| error | #f48771 | Something failed or did not check out |
| changed | #e2c08d | A file changed since the last commit: the word new, changed or deleted, and a mark on what changed in the last few seconds |

One colour, one job. Add a token only for a new job.

## Type

System sans for the interface. Monospace for anything that is a literal from the disk.

Emphasise once. Not size, colour, weight, border and icon on the same thing.

## Maps

Flat groups, hairline arrows, labels that say what one part does to another. A box whose files changed gets a border and a count in the changed colour. Anything that did not check out against the disk is left out or marked, never drawn faintly as if it were true.

A map fits the middle pane. Its columns and the space between them narrow together, then the whole map is drawn smaller, down to 80%. Only a map with more columns than that scrolls sideways, and while the terminal is shown, the line above it offers to hide the terminal. An arrow's label wraps onto more lines rather than run into the boxes. An arrow that skips columns crosses each one between two boxes or under the group, never behind a box. A loop within one column goes out on the right, or on the left of the first column, where no other arrow is. Each label sits on its own arrow, at the place nearest the middle that covers no other label, group or line; lines are drawn first, so none is drawn over a label.

## Motion

Alive, not busy. Something moves only when something real happens: the map box the agent is working in pulses and its arrows brighten, and marks fade in and out as files change. Everything else stays still. No decorative motion. The terminal moves as fast as the agent does; the rest of the window stays calm around it.

- A mark fades in over 0.4 s when it appears and out over 1 s when it goes, where it was. A mark already on screen stays still when the tree or map around it is drawn again.
- The box the agent is working in, one with a file that changed in the last 8 seconds, gets an outline in the changed colour that brightens and dims on a 2.4 s beat. Its arrows go from line-strong to text. Each file's recent mark ends on its own time, so the pulse follows the agent from box to box.
- The open file and map are drawn again only when what they show changed.
- With Reduce motion set in the system, marks change at once and the pulse holds still.

## Words

Plain, short, factual. Say what happened and what to do. One name per thing.
