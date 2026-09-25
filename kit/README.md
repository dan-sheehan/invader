# kit

A kit is optional: invader works the same without one. It holds what you want your coding agent to know about you that it cannot know on its own: how you like to work, what you are building and why, anything you would otherwise explain again.

This folder is blank on purpose. Your own kit lives at `~/kit`, outside every repository, so your personal context never ends up in a project you share.

## Make your own

1. Make a folder named `kit` in your home folder.
2. Drop things into it raw, like a note, a link or a few lines about yourself. There are no set folders or format: the agent takes care of the rest.
3. Switch back to invader: it shows your kit once its window comes to the front. A terminal that was already open does not know where the kit is yet; type `exit` there and press a key for a new one that does.

invader shows `~/kit` under the tree, whichever folder is open, and its files open like any other. The terminal sets `INVADER_KIT` to its path.

## Let your agent use it

Add this line to the agent rules of the project you are working on, like its `CLAUDE.md` or `AGENTS.md`:

```
If $INVADER_KIT is set and you need to know something about me, look there first. If it is there, use it and keep going. If not, ask me.
```
