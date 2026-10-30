# Agent Skills Highlighter

**MEGATECH.** A `/skill-name` in a Buzz message lights up when it names a skill on this computer. Hover it, or Tab to it, and a small card says what the skill is, where it comes from, and one line of Megatech lore. The message's own text is never changed and never moves.

![A message with two skills highlighted, and the card of one of them, on Buzz's dark theme](screenshots/card-dark.png)

Every skill, message and path in the screenshots is made up.

## What you need

- The Buzz desktop app (1.0). The browser build cannot install plugins.
- **`sh`** on the computer: macOS and Linux have it. Windows does not, and there the plugin finds no skills and says so in Settings. [Why a shell](#why-it-runs-sh), and the whole script, are below.
- Skill files somewhere the plugin looks: [the list](#where-the-skills-come-from).

## Getting started

1. Install the plugin: Settings, Plugins, Manage plugins, Add, **Browse** to this folder (`plugins/agent-skills-highlighter`, the one with `manifest.json` and `plugin.js`), or add this repository as a Git repository. The install review lists the one program the plugin runs; it is `sh`, and the review shows the script.
2. Open Settings, **Agent Skills**. It says how many skill names it found. Nothing to configure unless your skills live somewhere unusual.
3. Open any channel, thread or DM and look for a `/skill-name` that matches one of yours.

## What is highlighted

A `/name` is highlighted only when **all** of these hold:

1. `name` is a skill the plugin found, spelled exactly (capitals count). A skill from a plugin is known as `plugin:skill` and, unless you have a skill of that name yourself, as `skill`.
2. The `/` starts a word: the character before it is not a letter, digit, `_`, `/`, `\`, `.`, `:`, `~`, `@`, `#`, `$`, `%`, `&`, `=`, `+` or `-`. So paths, URLs, hosts and `and/or` are left alone.
3. What follows the name is the end of the text, a space, or one of `, ; ! ? ) ] } ' " … ” ’ » —`. A trailing `.` or `:` is not part of the name (`run /deploy.` highlights `/deploy`). `/deploy/prod`, `/deploy.sh` and `/deploy-now` are not `/deploy`.
4. The text is Markdown prose. Buzz does not offer code, inline code, links, images or HTML to a plugin, so `` `/deploy` `` and `[x](/deploy)` stay as they are.

`test/detect.test.mjs` is the table: 23 texts that match and 39 that do not.

## The card

Hover a highlighted skill for a moment, or Tab to it (every highlight is a tab stop, like a link). The card shows the skill's **name**, its **description** from the skill file, **where it comes from** (your skills folder, the extra folder, or a plugin's name), and a line of lore that changes each time.

| Do this | What happens |
| --- | --- |
| Hover (about 0.15 s) | The card opens under the skill, or above it near the bottom of the window |
| Tab to it | The card opens at once |
| Move the pointer off, onto the card | The card stays while the pointer is on the skill or the card |
| Move the pointer off both | The card closes after a moment |
| `Esc` | The card closes; focus stays on the skill |
| `Enter` or `Space` on the skill | The card opens again |
| Scroll, click elsewhere, Tab away, or leave the window | The card closes |

## Where the skills come from

The plugin reads these files, and nothing else, and only to learn each skill's `name` and `description` (the `---` lines at the top of a `SKILL.md`):

| Path | Called |
| --- | --- |
| `~/.claude/skills/*/SKILL.md` (or `$CLAUDE_CONFIG_DIR/skills/*/SKILL.md` if that is set) | your skills folder |
| `<install>/skills/*/SKILL.md` for each install folder named in `~/.claude/plugins/installed_plugins.json` (or under `$CLAUDE_CONFIG_DIR`), the plugin's name taken from `<install>/.claude-plugin/plugin.json`, else from the folder above the version | the plugin's name |
| `<extra folder>/*/SKILL.md`, for the one folder you may add in Settings | the extra folder |

A skill with no `name` is called by its folder's name, as Claude Code does. At most 400 skill files are read, and a description is cut at 1,000 characters.

The list is read when the plugin starts, when you press **Save** or **Read again** in Settings, and when you return to the window after a minute or more. A skill you add is highlighted after one of those.

## Settings

Settings, **Agent Skills**:

- **How many skills it found**, split by where they came from, or why it found none.
- **Extra folder (optional)**: a full path (`/home/you/skills`) or `~/skills`, with a folder for each skill inside it. Saved on this computer in the app's profile (`localStorage`, under the plugin's id). A path that is not absolute is refused.
- **Read again**: reads the files now.

## Why it runs `sh`

Buzz lets a plugin run only the programs its manifest declares, with arguments fixed in the manifest, and gives a plugin no way to list a folder. Finding every `SKILL.md` under a few folders is a listing, so the manifest declares one program: `sh -c <script>`. The script is below, in full, and `manifest.json` carries exactly the same text (a test checks that). Buzz's own plugin documentation shows a `bash -c` declaration as an example of the same pattern.

What the script is allowed to do, and what tests check about it:

- **It only reads.** It writes no file, makes no network call, runs nothing that it reads, and builds no command from data. The only commands it runs are `read`, `printf`, `grep`, `sed`, `head` and `awk`.
- **The extra folder arrives on standard input**, as one line, and is used only as a path, always quoted. A path that is not absolute is ignored. Names with spaces, `*`, `$(…)` or a leading `-` are just names.
- **It prints only each skill's `name` and `description` lines**, and for each skill where it came from (`user`, `extra` or `plugin`, and the plugin's name). Nothing else of a file leaves it: not the other lines of the frontmatter, not the body. A line of a file can never pose as the header of another skill.
- **It is bounded.** 400 files; a file's output stops at 2,000 bytes (a line is printed whole or left out; it is never cut in the middle of a letter); the whole output stays under the 1 MiB Buzz allows a program to print.
- **Unreadable files are skipped without a word**, and it always ends with exit code 0.

```sh
# Agent Skills Highlighter: reads the skill files on this computer. The manifest runs this text as `sh -c`; it is the one program the plugin declares.
# It only reads: it writes no file, makes no network call and runs nothing that it reads. File and folder names are only ever used as paths.
# Standard input: one line, the optional extra folder (a full path, or ~/...).
# Standard output, for each SKILL.md: a line "@@@", a tab, the kind (user, extra or plugin), a tab, the plugin's name (plugin only), a tab and
# the skill's folder name; then the `name` and `description` lines of its frontmatter, and nothing else of the file.
# Limits: 400 files, and reading a file stops at the first line that would take its output past 2,000 bytes (a line is printed whole or not at all).
# Anything unreadable is skipped without a word.
IFS= read -r extra || :
case $extra in "~/"*) extra=$HOME/${extra#"~/"} ;; esac
case $extra in /*) ;; *) extra= ;; esac
base=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
case $base in /*) ;; *) exit 0 ;; esac
count=0
nl='
'
# read_dir KIND PLUGIN DIR: the SKILL.md of every folder in DIR
read_dir() {
  for file in "$3"/*/SKILL.md; do
    [ -f "$file" ] && [ -r "$file" ] || continue
    [ "$count" -lt 400 ] || return 0
    count=$((count + 1))
    folder=${file%/SKILL.md}
    printf '@@@\t%s\t%s\t%s\n' "$1" "$2" "${folder##*/}"
    LC_ALL=C awk '
      function out(line) { total += length(line) + 1; if (total > 2000) exit; print line }
      { sub(/\r$/, "") }
      NR == 1 { if ($0 !~ /^---[ \t]*$/) exit; next }
      NR > 80 || /^---[ \t]*$/ { exit }
      /^[A-Za-z0-9_-]+:/ { keep = ($0 ~ /^(name|description):/); if (keep) out($0); next }
      keep && (/^[ \t]/ || $0 == "") { out($0) }
    ' "$file" 2>/dev/null
  done
}
read_dir user "" "$base/skills"
if [ -n "$extra" ]; then read_dir extra "" "$extra"; fi
# The installed Claude Code plugins: each install's folder is named in installed_plugins.json, and its skills are in skills/ there.
list=$base/plugins/installed_plugins.json
roots=
if [ -r "$list" ]; then
  roots=$(grep -o '"installPath"[[:space:]]*:[[:space:]]*"[^"]*"' "$list" 2>/dev/null | sed 's/^[^:]*:[[:space:]]*"//; s/"$//')
fi
seen=$nl
while IFS= read -r root; do
  case $root in /*) ;; *) continue ;; esac
  case $seen in *"$nl$root$nl"*) continue ;; esac
  seen=$seen$root$nl
  plugin=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[A-Za-z0-9._-]*"' "$root/.claude-plugin/plugin.json" 2>/dev/null | head -n 1 | sed 's/^[^:]*:[[:space:]]*"//; s/"$//')
  if [ -z "$plugin" ]; then
    plugin=${root%/}
    plugin=${plugin%/*}
    plugin=${plugin##*/}
  fi
  read_dir plugin "$plugin" "$root/skills"
done <<EOF
$roots
EOF
exit 0
```

The plugin's own code then reads those lines (`parseSkillOutput` in `plugin.js`).

## The look

Cloaked at rest, charged on contact.

- **At rest** a skill has a still, dim cyan tint with an ordered (Bayer) dither and a thin underline, behind the letters. Nothing moves. (A shimmer at rest was tried and dropped: on a long channel, with a skill in one message in five, it slowed scrolling too much. See `NOTES.md`.)
- **On hover or focus** it decloaks for 0.4 seconds: a scan beam crosses the highlight and a thin cyan and magenta split flickers at its edges. Then it stays brighter while the card is open. The card arrives with the same split on its edge.
- **The letters never glitch.** Only what is behind and beside them changes; the message's own text keeps its font, size, colour and place, and a test compares the position and size of every word before and after.
- **The card** is the Megatech design system's: a gunmetal plate, ink text, a hair border, a dithered frame, square corners; the name in capitals in the display face; a status line that starts `SYS::` in cyan-dim. The fonts are not downloaded (a plugin cannot): the display and mono faces are named first and the system's sans and mono faces follow, so on a computer without Chakra Petch and Share Tech Mono it reads in the system's.
- **Magenta** (`#ff2bd6`) appears only as the thin split edge, never as a fill, a border or text. A test checks where it is used.

| Token (dark) | Value | Used for |
| --- | --- | --- |
| cyan | `#00d4ff` | the highlight, the card's name, its edge |
| cyan-bright | `#4aeaff` | the charged state: the underline and the scan beam |
| cyan-dim | `#0099cc` | the status line |
| magenta | `#ff2bd6` | the split edge, only |
| gunmetal-deep | `#12161c` | the card's plate |
| ink, muted | `#e9eef4`, `#a7b2be` | the card's text, and its source line |

**Light theme.** The tokens above are dark-only. In light the card's plate, text and border are Buzz's own (`--surface-popover`, `--text-standard`, `--text-subtle`, `--border-standard`), so the card matches whatever theme and accent you chose, there is no glow, and the cyan is darkened to `#00708f` (5.6:1 on white; the bright cyan is 1.8:1) wherever it carries text or a line. Magenta stays, as an edge that nothing depends on.

**Contrast.** The message's own words stay at 4.5:1 or better on the highlight even in its brightest frame (the base, the darkest cell of the dither and the middle of the beam, all at once): 5.8:1 on dark and 4.7:1 on light, in the worst frame. Every line of the card is checked against its plate in both themes (a browser test reads the computed colours).

**Reduced motion.** With *prefers-reduced-motion* the highlight does not animate on hover, and the card simply appears. Both stay highlighted and dithered.

## Speed

Highlighting must not slow the message list, so it was measured: a channel of 2,400 messages, one in five holding two skills a few times over (a far denser mix than real talk), loaded and scrolled in Buzz's own browser build with the plugin off and on.

| Same list, same machine, same run | Plugin off | Plugin on |
| --- | --- | --- |
| Time to load the whole history (335,000 px) | 36.2 s | 37.6 s |
| Frame time while scrolling it, half a screen a frame: median | 31.3 ms | 31.7 ms |
| Frame time, 95th percentile | 66.2 ms | 62.4 ms |

That is the middle value of three passes each, on a 2-CPU machine where run-to-run noise is about ±10%: no measurable difference. A spec (`test/web/perf.spec.mjs`) asserts that the load time and the median and 95th-percentile frame times stay within a fifth, plus a small allowance, of the same list without the plugin. The frames are slow in both columns because the test machine is small and the rows are tall; the point is the pair.

The matcher is checked on its own too: `node test/bench.mjs` (about 2 to 3 microseconds per message that holds a slash, against a set of 300 names). Messages with no `/` cost one `includes` call.

## How it works

| What | How |
| --- | --- |
| Drawing a skill in a message | `conversation.registerInline`, Buzz's inline-renderer service (the one its Emoji plugin uses): the host calls `matches(text)` for each piece of prose and renders our component for each range. The text is the host's own, in a span we own, so no host markup is touched and a message edited or streamed in places itself correctly |
| A new list of skills | `matches` is synchronous, so a changed set of names is registered again in a child scope (the old one is ended first) |
| The card | **[DOM]** Buzz has no overlay service, so the card is one element on `<body>`, written with `textContent` only, `role="tooltip"`, linked to its skill by `aria-describedby`. Everything the plugin adds outside React (one `<style>`, the card, four listeners) is removed when it is disabled |
| The skill files | `ctx.host.runCommand("skills", folder)`, the one declared program |
| Settings | `settingsCards`; the extra folder is kept in `localStorage` under the plugin's id |

Not used, and why: wrapping the words in the host's DOM (React owns those text nodes, so an edit would orphan the wrapper), and the CSS Custom Highlight API (it allows no dither image, no animation and no focus, only a colour).

`NOTES.md` has the details and what was found along the way.

## Tests

```sh
# from a clone of this repository, with no package.json above the plugin's folder:
node --test plugins/agent-skills-highlighter/test/*.test.mjs                   # 115 unit tests: detection, parsing, the store, the real script on made-up folders, the look
node plugins/agent-skills-highlighter/test/bench.mjs                           # the matcher's speed
plugins/agent-skills-highlighter/test/run.sh /path/to/block/buzz-app/checkout  # the browser tests, in Buzz's own web build
SKILLS_PERF=1 plugins/agent-skills-highlighter/test/run.sh /path/to/block/buzz-app/checkout -g "2,400 messages|highlighter's cost"   # the speed comparison (minutes)
```

The browser tests run the production web build, a fixture relay and headless Chromium, with the plugin registered through the same code path as a bundled one. The web build cannot run a program, so the tests give the plugin a stand-in for `ctx.host.runCommand`; the script itself is tested by the node tests, against real folders. `.github/workflows/agent-skills-highlighter-tests.yml` runs both on every change to this folder.

## What was and was not checked

Checked:

- **Node tests (115):** detection (the table above), parsing a `SKILL.md` (plain, quoted, folded and literal values), the store and the settings, and **the real script** run as the manifest declares it (`sh -c`) against made-up folders: what it prints, that it prints nothing else, the caps, quiet skips, names with spaces and `$(…)`, an extra folder that is not absolute, and that every file it read is unchanged afterwards.
- **Browser tests (12)**, in Buzz's own production web build (commit `d92bfb2c` of block/buzz-app, headless Chromium): a skill is drawn in a channel, a thread and a DM, and a path, a URL, code and an unknown name are left alone; hover opens the card, mouse-out and the card itself; keyboard (tab stops, Esc); scrolling and clicking away; the text and its box do not move; reduced motion; contrast in both themes; the card's tokens (dark) and the host's plate and text (light), square corners; Settings (the extra folder, a failed read keeps the last list); reading again; disabling and enabling leaves nothing behind. The DM is checked in the browser build only: sending a message to a real person to see one was not worth it.
- **Speed** (above), in the browser build.
- **The skill reader on Linux**, against fixture folders.

Not checked:

- **macOS and Windows.** The plugin runs on whichever web view Buzz uses; the shell script uses only `sh`, `read`, `printf`, `grep`, `sed`, `head` and `awk`, and has been run here only with Linux's (dash, GNU grep, sed and awk).
- **A real Claude Code plugin install.** The folder layout read from `installed_plugins.json` is the one Claude Code's documentation and binary describe (V1 and V2 files, `installPath`, `skills/<name>/SKILL.md`, `.claude-plugin/plugin.json`). The tests build that layout; they cannot show that a real install has the same files.
- **The Chakra Petch and Share Tech Mono faces.** The card was looked at with the system faces only.

## License

Apache License 2.0, as the rest of this repository.
