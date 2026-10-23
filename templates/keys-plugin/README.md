# Keys plugin template (coming)

A starting point for plugins that change how the keyboard and the page behave, the way [`plugins/vim`](../../plugins/vim) does.

**Not written yet.** It will be cut from the vim plugin once that plugin is refactored, so that it starts from code that has been measured and tested rather than from a guess.

What it will hold:

- A prebuilt `plugin.js` skeleton: keys through `ctx.shortcuts.register` (bare keys, `when`, `allowInEditable`), a mode that follows focus, and pending-key state for counts and two-key sequences, since the shortcut service has neither.
- The one place where a capture-phase `keydown` listener is justified (keys the host handles before any plugin, such as Escape in a side pane), with its cleanup in `ctx.effect`.
- A mode label drawn with the host's theme tokens.
- The built-in measuring hooks (key to paint, event-loop lag) and a Playwright spec wired to Buzz's own web build, as in `plugins/vim/test/`.

Until then, read [`plugins/vim/NOTES.md`](../../plugins/vim/NOTES.md) and [`docs/building.md`](../../docs/building.md).
