# Vim mode

Move through Buzz with vim keys: normal and insert modes, `j` and `k` through messages and channels, `h` and `l` between the channel list, the message list and a thread, `{` and `}` between communities, `gt` between pages, `r` and `m` on a message, and `o`, `q`, `zc`, `>` and `<` for threads. It began as a concept, built to learn what the plugin API reaches. `NOTES.md` has the findings.

## Getting started

1. In the desktop app open Settings, Plugins, Manage plugins, Load from folder, and choose this folder (the one that contains `manifest.json` and `plugin.js`). Install it, and enable **Vim mode** if it is not already on.
2. Open Messages and a channel with some history. A small `-- NORMAL --  main` label appears in the window's bottom-right corner (it says the mode and which pane has the keys), and the sidebar shows a **Vim mode** page with an `N` badge.
3. Work through the checklist below.
4. To stop at any time press Cmd+Shift+E (Ctrl+Shift+E elsewhere), or disable the plugin in Settings.

## Screenshots

Taken in Buzz's own browser test harness with its fixture data (`test/screenshots.spec.mjs`), in light and dark mode.

| Light | Dark |
| --- | --- |
| ![NORMAL, the cursor on a message: its bubble lifted, with a thin accent outline](screenshots/normal-cursor-light.png) | ![The same in dark mode](screenshots/normal-cursor-dark.png) |
| NORMAL: the cursor on a message. The bubble goes up a step in brightness (a step darker in light mode) and gets a thin accent outline | The same in dark mode |
| ![INSERT in the message box: the box has a faint lift and the message above is not lifted](screenshots/insert-light.png) | ![The same in dark mode](screenshots/insert-dark.png) |
| INSERT: the box has the keys, so it takes a much fainter lift and the message above gives up its own | The same in dark mode |
| ![NORMAL in the message box](screenshots/box-normal-light.png) | ![VISUAL mode in the message box](screenshots/box-visual-dark.png) |
| NORMAL inside the message box | VISUAL: a motion grows the highlight |
| ![A thread beside the channel: the pane that has the keys has an accent line under its header](screenshots/thread-pane-light.png) | ![The same in dark mode](screenshots/thread-pane-dark.png) |
| A thread beside the channel: the pane that has the keys has a 2 px accent line under its header | The same in dark mode |
| ![The channel list has the keys](screenshots/channel-list-light.png) | ![The key list, opened with ?](screenshots/help-dark.png) |
| The channel list has the keys: a ring on the current channel | The key list, opened with `?` |

## Try this

| Step | Keys | Expected |
| --- | --- | --- |
| Click the message box, type `hjkl gg 5` | | The text appears. Label says `INSERT`. Plain keys never act while you type |
| Leave the message box | Esc, then `k` | Esc keeps focus in the box and the label says `NORMAL`; another Esc stays there, as in vim. `k` on the draft's first row goes up into the newest message; the leader key or `h` / `l` at the ends of the draft go to the other pane's box. If a tooltip is showing, the first Esc closes it. With the page's switch for composer editing off, one Esc leaves the box |
| Place a cursor | `k` | The newest visible message's bubble goes up a step in brightness (a step darker in light mode) with a thin outline in your accent colour |
| Move the cursor | `k` `k` `j`, then `3k` | It moves one message at a time, three at once with a count |
| Jump | `g` `g`, then Shift+g | The oldest loaded message, then the newest |
| Scroll | Control+d, Control+u (Control, not Command, on a Mac) | Half a page down and up |
| Focus the channel list | `h` | A ring on the current channel. Label region says `sidebar` |
| Move in the list | `j` `k` | The ring moves between channels |
| Open a channel | `l` | The channel opens, focus goes to its message list, and you stay in normal mode (the message box is not focused) |
| Switch channel from the message list | `]` and `[` | Next and previous channel |
| Switch community | `}` and `{` (hold Shift), then `2{` | Next and previous community, in the switcher's order (Personal space first). Focus lands in the new community's channel list. A count jumps several |
| Pick a community | Shift+c, or `h` twice from a message | The community switcher opens on the current one. `j` and `k` move, Enter picks, Esc closes |
| Reply | Move the cursor with `k`, then `r` | The thread opens on that message and focus is in its reply box (`INSERT`) |
| Message menu | Move the cursor, then `m` | The message menu opens (copy, mark unread, ...). `j` and `k` move, Enter picks, Esc closes |
| Pages | `g` then `t`, `g` then Shift+t | Next and previous page: Messages, Reminders, Agents, Workflows, Inbox, then the rest |
| Jump to a page | `gi` `gm` `ga` `gr` `gw` `gs`, from the message list, the channel list or a message box in NORMAL | Inbox, Messages, Agents, Reminders, Workflows, Settings. Messages opens with the cursor in the message list, not in the message box. The app has Cmd+, (Ctrl+, elsewhere) for Settings too |
| Write | `i` | Focus goes to the message box. Label says `INSERT` |
| Search | `/` | Buzz's search opens (it presses Cmd+F for you) |
| Help | Shift+/ (`?`) | The key list opens over the page, centred on a dimmed backdrop, grouped NORMAL (messages and panes), NORMAL (the message box), INSERT, VISUAL. `j` `k` scroll it, Control+d and Control+u scroll half a page, `gg` and `G` go to the top and bottom, `q`, Esc or `?` close it and you are where you were |
| The switches | `g` then `v` | The Vim mode page opens (it holds the three switches and the same key list) |
| Open a thread | Move the cursor with `k`, then `o` (or Enter) | The thread opens beside the channel and focus is in its message list, in NORMAL. `j` and `k` walk the replies, `i` writes a reply, `h` goes back to the channel |
| Close a thread | `q` | The thread closes and focus is back on the message list. It works from the thread and from the message list |
| Hide the thread pane | `zc`, then `zo` | `zc` hides the pane but keeps the thread open, `zo` shows it again |
| Resize the thread pane | Shift+`.` (`>`) and Shift+`,` (`<`), then `3>`, Shift+`\` (`\|`), `=` | Wider and narrower by 48 px a press, three presses at once with a count, as wide as it goes, and back to the default width |
| Leader | Space (Ctrl-w on a Mac), then `h`, `l`, `q`, `<`, `>`, `\|`, `=` | From anywhere, the message box too: `h` and `l` go to the pane on the left or right (from a message box, to the other pane's box), `q` closes the thread, the others resize it. Change the leader key on the Vim mode page |
| Down into the box | `j` on the newest message | The cursor drops into the message box, in NORMAL. `k` on the draft's first row goes back up to the newest message |
| Across the boxes | With a thread open, in a message box: `l` at the very end of the draft, `h` at the very start | The cursor goes on into the other pane's box, in NORMAL |
| Active pane | Open a thread with `o`, then `h` and `l` | With a thread beside the channel, the pane that has the keys has a thin accent line under its header and a lifted, outlined message bubble; the other pane keeps its own marked message, with a faint outline only. Moving into a pane marks a message there at once. With the channel list focused neither pane has a line |
| Thread | Hover a message, click Reply, then Esc, `k`, `h`, `l`, `i` | Esc makes the reply box normal and does not close the thread. `k` goes up into the thread's newest message, `h` and `l` move between panes, `i` writes the reply. In a message list Esc does nothing: `q` closes the thread |
| Settings by keyboard | `gs`, then `j` `k`, `l` or Enter, `h`, Esc | Settings opens. `j` and `k` move through its sections, `l` or Enter opens one and goes into it (`j` `k` then scroll it), `h` comes back to the list, Esc closes it. A field still types, and every other dialog keeps the keys off |
| Turn off and on | Cmd+Shift+E twice | The label disappears and returns, and keys stop and resume |

**Inside the message box** (on by default; the Vim mode page has a switch to turn it off): Esc keeps focus and gives you `h j k l`, the words `w b e ge` and `W B E gE`, the line `0 ^ $`, the draft `gg G` (`3G` is line 3), finding with `f t F T` and `;` `,`, all with counts, plus `x`, `dd`, `d` with any of those, `u`, and `i` `a` `I` `A` to go back. Esc after a half-typed `d` or `f` only cancels it, and Esc in NORMAL stays in NORMAL.

**Visual mode** in the message box: type a few lines (Shift+Enter makes a new line), press Esc, then `v` and the label says `VISUAL` with the character under the cursor highlighted. every motion above (`e`, `W`, `fx`, `3l`, `G` ...) stretches the highlight, `y` copies it to the clipboard, `d` or `x` deletes it, `c` deletes it and goes to insert mode, and Esc (or `v` again) leaves. `V` does the same by whole lines (`Vd` removes the lines and their newline). Switch between the two with `v` and `V`. There is no `p`: paste with Cmd+V.

## What to report

Which steps behaved differently, and for any that did nothing, whether the label changed. If the app has a developer console, any red errors that mention `megatech.vim-mode`.

## For developers

The source is TypeScript in `src/`, one module per concern (see "Source layout" in `NOTES.md`). The app loads only the built `plugin.js` next to the manifest and never runs a build, so the built file is committed with the source.

- **Build**: `pnpm install --frozen-lockfile`, then `pnpm build` (Node 22 or newer; `npm run build` works too). It type-checks `src/` and bundles it into `plugin.js`, unminified so that what you install is readable.
- **Browser tests**: `test/run.sh PATH_TO_BLOCK_BUZZ_APP_CHECKOUT` runs `test/vim.spec.mjs` against that checkout's browser harness. See `test/run.sh` for the one-time setup.
- **Measuring**: `test/perf.sh`, `test/real-app/` and "Measuring the plugin" in `NOTES.md`.
- **Screenshots**: `SPEC=screenshots.spec.mjs test/perf.sh PATH_TO_BLOCK_BUZZ_APP_CHECKOUT with 1` writes the pictures above into `SHOTS_DIR`.
