<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/headers/key-probe-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../../assets/headers/key-probe-light.svg">
  <img alt="Key probe (measuring only)" src="../../assets/headers/key-probe-dark.svg" width="100%">
</picture>

## What it is

A measuring tool, not a feature. For every key it records the time from the `keydown` reaching the window to the next frame on screen. It is a plugin of its own so the vim plugin can be measured with Vim mode on, off, or replaced by a new version, with the same instrument each time.

- **Ctrl+Alt+Shift+D** copies what was recorded, as JSON, to the clipboard.
- **Ctrl+Alt+Shift+X** starts over.

It reads no page content, keeps at most 5,000 keys, and sends and writes nothing. The scripts in [`plugins/vim/test/real-app`](../vim/test/real-app) install it and read it. You do not need it to use any plugin.

## Platforms

| macOS | Linux | Windows |
| --- | --- | --- |
| should work, untested | **works, tested** | should work, untested |

- **Linux:** the real-app scripts in [`plugins/vim/test/real-app`](../vim/test/real-app) install and read it in the Buzz desktop app on Linux; the timings in the Vim and Beeper notes were taken with it. Sources: `plugins/vim/NOTES.md`, "Measuring the plugin"; `plugins/beeper/NOTES.md`, "Real desktop app".
- **macOS** and **Windows:** not run. The notes do not mention them.


## How to install

You do not need it to use any plugin. To measure by hand, load the folder `plugins/key-probe` as you would any plugin ([`docs/install.md`](../../docs/install.md)).
