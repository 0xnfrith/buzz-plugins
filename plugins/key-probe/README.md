# Key probe (measuring only)

A measuring tool, not a feature. For every key it records the time from the `keydown` reaching the window to the next frame on screen. It is a plugin of its own so the vim plugin can be measured with Vim mode on, off, or replaced by a new version, with the same instrument each time.

- **Ctrl+Alt+Shift+D** copies what was recorded, as JSON, to the clipboard.
- **Ctrl+Alt+Shift+X** starts over.

It reads no page content, keeps at most 5,000 keys, and sends and writes nothing. The scripts in [`plugins/vim/test/real-app`](../vim/test/real-app) install it and read it. You do not need it to use any plugin.
