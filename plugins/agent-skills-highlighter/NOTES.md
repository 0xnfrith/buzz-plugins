# Notes on the Agent Skills Highlighter

What worked through Buzz's plugin API, what needed more, what was measured, and what was not checked. Written while building it, against block/buzz-app commit `d92bfb2c` (the browser tests) and the installed desktop app `0.0.0-preview.156.1` (the real-app checks).

## What the API gave

**`ctx.conversation.registerInline({ id, title, matches(content), component })`** drew the highlight with no DOM hack at all.

- Documented in `docs/plugin-architecture.md`, "Conversation contributions" (the paragraph that begins "The conversation preview exposes top-level `registerTool`, `registerCompletion` and `registerInline`"); the contract is `InlineRenderer` in `src/features/conversation/contracts.ts`. The bundled Emoji plugin (`src/bundled/emoji/index.tsx`) is the one consumer.
- The host calls `matches` for each plain-text segment of a message's Markdown, and renders `component` for each range returned. Only prose is offered: `isLiteralMarkdownContext` (`src/features/messages/markdown-preparation.ts`) excludes code, inline code, links, images and HTML, so `` `/deploy` `` and `[a](/deploy)` are never matched, which is what we want.
- The same `MessageMarkdown` draws channel messages, thread replies and DMs, so one registration covers all three.
- `matches` is synchronous and `registerInline` returns no disposer. The set of known skills is read asynchronously, so a changed set of names is registered again in a child scope (`ctx.plugin(...)`, ended before the next one starts, with a new contribution id each time). Ending a scope is asynchronous and the host refuses the same id twice.
- The docs call the service "a host-matched preview, not a stable cross-version SDK". If it changes, the plugin shows plain text, as without it; it does not break the message.

What we render is the host's own text in a `<span>` we own: `tabIndex=0` makes a real tab stop and gives real focus events, and we have the full CSS of the span. Nothing of the host's markup is touched.

## What needed the DOM

- **The card.** Buzz has no overlay or tooltip service for plugins (API v1), so the card is one element appended to `<body>`, written with `textContent` only, `role="tooltip"`, `aria-describedby` on the open skill. Everything the plugin adds outside React is made inside `ctx.effect` and removed in its cleanup: one `<style>`, the card, four listeners (`keydown`, `scroll`, `pointerdown`, `blur`) and the focus listener of the re-read. A test disables and enables the plugin and checks that nothing is left.
- **The stylesheet** is one `<style>` element: there is no style service. Every class and variable is named for the plugin.

## Routes that were rejected

- **Wrapping the matched words in the host's DOM** (a `MutationObserver` that splits text nodes). React owns those text nodes; an edit, a streamed message or a re-render would orphan or duplicate the wrapper. The vim plugin's earlier work found the same on the message list.
- **The CSS Custom Highlight API** (`::highlight(name)`), which would need no wrapper at all. It is available in the Chromium of the test build (153), in WebKitGTK 2.52.6 (the Linux app) and in the macOS 14.2+ web view, but a highlight pseudo-element accepts only `color`, `background-color`, `text-decoration` and `text-shadow`: no dither image, no animation, no pseudo-elements, and nothing for keyboard focus. The brief asks for all of those.

## The skill reader

Buzz gives a plugin no way to list a folder (`host.files` reads a file) and runs only declared programs with arguments fixed in the manifest, without a shell. Finding every `*/SKILL.md` under three places is a listing, so the manifest declares one program, `sh -c <script> skills <awk program>`, with the optional extra folder on standard input. The pattern is in Buzz's own docs (a `bash -c` entry under `host.processes`) and Beeper's `curl` plus input is the same shape. The two texts are `reader/main.sh` and `reader/skill.awk`; `reader/build.mjs` writes them into `manifest.json`, and the README prints them. The conditions it keeps, each tested in `test/script.test.mjs` against real folders, by running the manifest's own program:

- it reads only; names are only ever paths; the extra folder is quoted and ignored unless absolute;
- it prints each skill's `name` and `description` lines, and where it came from, and nothing else of the file; a line of a file cannot pose as a header;
- 400 files, 2,000 bytes a file, whole lines only; the worst case is under the 1 MiB output bound; unreadable files are skipped without a word; the exit code is 0.

**A limit that only the real app showed.** The first version was one commented script of 2.7 KB in a single argument. The unit tests and the browser tests passed it, and the installed app (`0.0.0-preview.156.1`) refused it when the folder was loaded: "Invalid host command declaration". The app checks a manifest when it is installed (`crates/plugin-manager`, `valid_program`): at most 16 arguments, each at most 1,024 bytes, no NUL. The browser build runs no such check, so no browser test could see it. The fix: the script has no comments (the README is its commentary) and the one long piece, the `awk` program, is a second argument that the script runs from `$1`. A unit test now applies the same three rules to the manifest, and the install in the real app was repeated after the change.

Things the script cannot know and that are **not verified against a real install**: this VM has no Claude Code skills and no Claude Code plugin installed, so the plugin layout is the one described in Claude Code's documentation and found in its own binary: `installed_plugins.json` (a V1 object per plugin or a V2 list of installs, each with an `installPath`), skills at `<installPath>/skills/<name>/SKILL.md`, the plugin's name in `<installPath>/.claude-plugin/plugin.json`. The tests build that layout and check the script against it; they cannot show that Claude Code's real files look the same.

## Looks, and what it cost

Colours, type and card rules come from the Megatech design tokens (`tokens.css`, dark). They are dark-only, so light takes the plate, text and border from Buzz's tokens (see the README).

A first version drew a slow shimmer on every highlight at rest ("thermoptic cloak"). That was dropped after measuring. The 2,400-message channel (one message in five holding skills), with the plugin off and on: p50 / p95 frame time of scrolling it at half a screen a frame (median of three passes), and the time to load 330,000 px of history. The first three rows are from one earlier, busier session (its own plugin-off run: about 56 s to load, p50 50.9 ms, p95 90 ms); the last two are from a later quiet run of the shipped build, each pair on the same machine in the same run, so compare within a block only:

| Resting highlight | Load | p50 | p95 |
| --- | --- | --- | --- |
| plugin off (earlier session) | about 56 s | 50.9 ms | 90 ms |
| smooth shimmer (`6s ease-in-out infinite`) | 108 s | 74.7 ms | 140.7 ms |
| stepped shimmer (`9s steps(18)`) | 165 s | 66.2 ms | 125.8 ms |
| plugin off (quiet run) | 36.2 s | 31.3 ms | 66.2 ms |
| still tint and dither (shipped) | 37.6 s | 31.7 ms | 62.4 ms |

Run-to-run noise on a 2-CPU machine is about ±10% (the three passes of one run differed by that much), so only the large gaps mean anything. An infinite animation on a hundred highlights that scroll in and out is what a long channel costs; a one-shot decloak on hover costs nothing while nothing is hovered.

The test list is far denser than real talk: every fifth message repeats "/brainstorming … /plan-review" up to nineteen times. It is a worst case, chosen so a cost would show.

## What was and was not checked

See the README's last section. In short: unit tests, the real script, the browser tests and the speed comparison were run; the card and the highlight were looked at in the installed desktop app in a channel and a thread. A DM was checked only in the browser harness (it would have meant sending a message to a person). macOS and Windows were not run.
