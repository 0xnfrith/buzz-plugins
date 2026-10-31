<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/headers/beeper-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="../../assets/headers/beeper-light.svg">
  <img alt="Beeper inbox" src="../../assets/headers/beeper-dark.svg" width="100%">
</picture>

## What it is

Your [Beeper](https://www.beeper.com) chats inside Buzz. A list of chats, each with its network, its time and its unread count; a chat with its recent messages; a box to reply. It works through **Beeper Desktop's local API on the same computer**: nothing else is contacted, and your messages go nowhere but between Buzz and Beeper on this machine.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/chat-dark.png">
  <img alt="The chat list and a chat, in Buzz's light theme" src="screenshots/chat-light.png">
</picture>

Every person, chat and message in the screenshots is made up: they come from the plugin's test fixtures, shown in Buzz's own browser test build.

## Platforms

| macOS | Linux | Windows |
| --- | --- | --- |
| should work, untested | **works, tested** (against a fake Beeper) | should work, untested |

- **Linux:** run by hand in the real Buzz desktop app on Linux, against a fake Beeper Desktop: it installs, connects through the native command runner, lists chats, opens one and sends a reply. **It has not been run against a real Beeper Desktop.** Sources: `NOTES.md`, "What was verified"; "Status" below.
- **macOS:** not run. The install review, the native command runner and `curl` there are unverified, and the Keychain route is tested only against a stand-in `security` program. Sources: `NOTES.md`, "What was not verified"; "Status" below.
- **Windows:** not run. Source: `NOTES.md`, "What was not verified". The token can only be kept in the app's profile there, as plain text, and the settings card says so.


## How to install

### What you need

- **Beeper Desktop** running on this computer, signed in, with its Desktop API turned on: Settings, then Developers, then Beeper Desktop API. (Beeper's own docs: [developers.beeper.com/desktop-api](https://developers.beeper.com/desktop-api/).)
- An **access token** from Beeper: Settings, Developers, Approved connections, press **+** and follow the steps.
- **`curl`** on the computer. macOS, Windows 10 and later and most Linux systems have it. Why this plugin needs it is explained below.
- On a Mac, the `security` program (it comes with macOS): the plugin keeps your token in the Keychain with it.
- The Buzz desktop app (1.0). The browser build cannot install plugins.

### Getting started

1. Install the plugin: Settings, Plugins, Manage plugins, Add, **Browse** to this folder (`plugins/beeper`, the one with `manifest.json` and `plugin.js`), or add this repository as a Git repository. The review will say the plugin can run programs on your computer. It lists two programs, with the arguments each command uses: `curl` (twice: one command makes the request, one asks `curl` for its version) and `security` (three times, for the Keychain: read, save and delete one item, `buzz-beeper`; they are never run off a Mac). See [How it reaches Beeper](#how-it-reaches-beeper).
2. Open Settings, Beeper. Paste the token and press **Save to Keychain** (on a Mac; elsewhere **Save token**). The plugin asks Beeper first, and keeps the token only if Beeper accepts it. The card says "Connected to Beeper Desktop…" and where the token is kept. If macOS asks whether Buzz may use the Keychain item, that is the system asking about the item the plugin made.
3. Open the **Beeper** page in the sidebar.

<details>
<summary>Step-by-step with screenshots</summary>

The screenshots are from the Buzz desktop app on Linux, in the light theme, in a new profile with nothing in it. macOS and Windows look a little different and are not shown. Steps 1 to 4 are the same for every plugin in this repository.

**1. Open Settings, then Plugins, then Manage plugins, and press Add.**

![Settings open on Manage plugins, with the Add button at the top right](../../assets/install/1-manage-plugins.png)

**2. Choose how to load it.** The Add a plugin window has a folder on the left (drop one in, or press **Browse**) and a Git or GitHub repository on the right. The repository is the easier way: there is nothing to download first.

![The Add a plugin window: on the left a drop area with a Browse button for a folder, on the right a box for a Git or GitHub repository with a Find button](../../assets/install/2-add-a-plugin.png)

**3. Type `https://github.com/0xnfrith/buzz-plugins` and press Find.** Leave Branch or tag empty. If you have cloned this repository, use **Browse** instead and choose the folder `plugins/beeper`.

![The repository address typed into the Git or GitHub repository box, with Find ready to press](../../assets/install/3-git-address.png)

**4. Pick Beeper and press Continue.** Buzz lists every plugin in the repository with its folder and id.

![The Choose a plugin window listing Artifacts, Beeper, Key probe, Linear and Vim mode, none picked yet](../../assets/install/4-choose-a-plugin.png)

**5. Read the review and press Install plugin.** Beeper asks to run programs on your computer: `curl` twice and `security` three times. Open a row to see the program and every argument it will always be run with. **Enable plugin** is on, so it is turned on as it is installed.

![The Review plugin access window for Beeper: Computer access, Run curl twice, Run security three times, Enable plugin switched on, and the Install plugin button](screenshots/install/1-review.png)

**6. It is installed and turned on.** Search Manage plugins for it: **Disable** on its row means it is on. It now has a page in the sidebar and a card in Settings.

![Manage plugins searched for beeper: Beeper is listed with a Disable button, which means it is on](screenshots/install/2-installed.png)

**7. Give it your token.** Open Settings, then **Beeper**, paste the access token you made in Beeper Desktop and press the button under it. This computer is Linux, so the button says **Save token** and the card says the token is kept in the app's profile as plain text; on a Mac the button says **Save to Keychain** and the token goes to the Keychain. No token is typed in this shot.

![The Beeper card in Settings: an empty box for the Beeper access token, a Save token button, and what the card says about where the token is kept](screenshots/install/3-settings-card.png)

</details>

### How it reaches Beeper

Beeper Desktop's API speaks plain HTTP on `localhost:23373`. Buzz's two ways for a plugin to reach the network do not allow that: `host.request` accepts only HTTPS, and the page's content security policy blocks `fetch` to anything but a short list of hosts. What Buzz does allow is a program that the plugin's manifest declares in advance, with its arguments fixed there. So the plugin declares `curl` and gives it each request on its standard input, as a curl configuration (the address, the `Authorization` header, the body). Everything about how `curl` runs is fixed in `manifest.json`: no user configuration file (`-q`), plain `http` only (`--proto =http`), no proxy (`--noproxy '*'`), a connect timeout of 2 s and a total of 4 s (Buzz's own limit is 5 s), and the status code written after the reply.

The install review shows these commands, so you can see them before you install. If Block adds loopback HTTP to `host.request` one day, the plugin can drop `curl` altogether.

`NOTES.md` has the details and what was found along the way.

## What it looks like

| | |
| --- | --- |
| ![A chat in dark mode](screenshots/chat-dark.png) | ![A reply on its way: Sending…](screenshots/sending.png) |
| A chat, in dark mode. Colours come from Buzz's theme | A reply as typed, shown as sending until Beeper lists it |
| ![A reply Beeper refused, kept with its reason, Try again and Dismiss](screenshots/send-refused.png) | ![A long list: only the rows in view are drawn](screenshots/long-list.png) |
| A refused reply stays, with the reason | 200 chats: the list draws only the rows in view, so a key costs the same as with 12 |

<details>
<summary><b>All screenshots</b></summary>

### Screenshots

Taken in Buzz's own browser test harness with the plugin's fake Beeper (`test/web/beeper.spec.mjs`; made-up people only).

| | |
| --- | --- |
| ![A chat in dark mode](screenshots/chat-dark.png) | ![A reply on its way: Sending…](screenshots/sending.png) |
| A chat, in dark mode. Colours come from Buzz's theme | A reply as typed, shown as sending until Beeper lists it |
| ![A reply Beeper refused, kept with its reason, Try again and Dismiss](screenshots/send-refused.png) | ![A long list: only the rows in view are drawn](screenshots/long-list.png) |
| A refused reply stays, with the reason | 200 chats: the list draws only the rows in view, so a key costs the same as with 12 |
| ![The chat list marks a chat with a reply that did not go as Not sent](screenshots/not-sent-in-list.png) | ![Connect Beeper: the steps, before a token is saved](screenshots/no-token.png) |
| A reply that failed stays with its chat; the list says which chat | Before a token is saved |
| ![Beeper is not running, or its API is off](screenshots/not-running.png) | ![curl was not found](screenshots/no-curl.png) |
| Beeper closed, or its API off | No `curl` on the computer |
| ![The settings card on a Mac: the token saved in the Keychain](screenshots/keychain-saved.png) | ![The Keychain would not take the token: the one command to run in Terminal](screenshots/keychain-by-hand.png) |
| On a Mac the token goes to the Keychain, and is never shown again | If the Keychain will not take it, nothing is kept and the card shows the command to run in Terminal |
| ![The settings card off a Mac: the token in the profile, said to be plain text](screenshots/settings.png) | |
| Elsewhere the token can only be kept in the profile, and the card says it is plain text | |

</details>

## Details

<details>
<summary><b>Using it, and its keys</b></summary>

### Using it

- **Chat list** (left): newest activity first, pinned chats on top, the 200 most recent (fewer, if Beeper's answer for that many would be more than the 1 MiB Buzz lets a program print: the list then says "Older chats are not listed"). Each row has the network's badge, the chat's name, the network's name, the time of the last message and, when there are unread messages, a count. A filter box and an **Unread** switch narrow the list.
- **Chat** (right): the recent messages, oldest first, with day headings; **Load earlier messages** goes further back. Pictures, voice messages and files are not loaded: they show as a label ("Image: photo.jpg").
- **Reply**: type in the box and press **Enter** (**Shift+Enter** for a new line). The message shows as "Sending…", then "Sent", and gives way to the real message when Beeper lists it. If Beeper refuses it, it stays with its chat, with the reason, and you can try again or dismiss it; the chat list marks a chat with a reply that did not go as "Not sent", even after you have opened another chat. If Beeper does not answer a send at all, the message says it may still have been sent: look in the chat before sending it again. A reply you have not sent stays with its chat when you open another.
- **Opening a chat marks it read in Beeper**, as opening it in Beeper would. A chat that is open and receives a message is marked read too.
- The page asks Beeper every three seconds for the open chat and every nine for the list (every three when no chat is open), **only while the page is on screen and the window is visible**. Leaving the page stops it. If the window was hidden while many messages came, the chat starts again from the newest ones (**Load earlier messages** goes back from there), so it never shows a hole in the middle.

#### Keys

| Key | What it does |
| --- | --- |
| `j` / `↓`, `k` / `↑` | Move the highlight in the chat list |
| `Enter` | Open the highlighted chat and put the cursor in the reply box |
| `Esc` | In the reply box: back to the list. In the list: close the chat |
| `r` | Put the cursor in the reply box of the open chat |
| `/` | Go to the filter (`Esc` clears it) |
| `u` | Show only chats with unread messages, and back |

The keys act only on this page, never while you type in a box, while a dialog is open, or with Ctrl, Cmd, Alt or AltGr held. `Enter` on a button is that button's.

</details>

<details>
<summary><b>Privacy</b></summary>

### Privacy

- **Nothing leaves your computer except the calls to Beeper Desktop on `127.0.0.1`.** The plugin refuses any other address (the *Address* setting accepts only `127.0.0.1`, `localhost` or `[::1]`, over plain `http`, which is what Beeper Desktop speaks). It has no analytics, no logging, and no other way out.
- **The token goes to whatever answers on the configured address on this computer**, which is Beeper Desktop unless something else has taken its port. Beeper's `/v1/info` needs no token, so the plugin asks it first, but cannot tell the real Beeper from a program that answers like it.
- **On a Mac the token is kept in the Keychain** (item `buzz-beeper`, account `beeper`), not in the app's profile. It is written by the `security` program with the token on its standard input, never on a command line, and the plugin reads it back to be sure it is there. It is read once when the plugin starts and held in memory while Buzz runs. If the Keychain will not take the token, nothing is kept, and the card shows the one command to run in Terminal (it asks for the token, so the token is not in the command), with a **Check Keychain** button.
- **The profile copy is an explicit choice, and elsewhere the only one.** On a Mac, **Keep it in this app's profile instead** keeps the token in the app's profile as plain text, and the card says so; **Move to Keychain** moves it. On other systems the token can only be kept there, in plain text, and the card says that too. **Any other plugin you install could read a profile copy**, as could anyone with access to your Buzz profile: install only plugins you trust. The Keychain copy is not out of reach of every plugin either: the item is made by the `security` program, which is then allowed to read it, so another plugin that declares `security` in its manifest could read it too. The difference is that this shows in that plugin's install review ("Run security"), while reading the profile needs no declaration at all.
- The token is never shown again after saving, and never written to a log, an error message or the command line of a program (the process list shows those): it is sent to `curl`, and to `security`, on their input.
- **Messages are not stored by the plugin.** They are held in the page's memory while it is open and are gone when it is closed. Drafts you have not sent are kept in memory only.
- Tests, fixtures and screenshots use made-up people only. No real chat is anywhere in this repository.

</details>

<details>
<summary><b>If something is wrong</b></summary>

### If something is wrong

The page says what, and what to do:

| It says | It means |
| --- | --- |
| Connect Beeper | No token saved yet. The steps are on the page |
| Beeper is not running, or its API is off | Nothing answered at the address. Open Beeper Desktop and turn on Settings, Developers, Beeper Desktop API. If you changed its port, set the address in the plugin's settings |
| curl was not found | The `curl` program is not on this computer (or not on the PATH Buzz uses) |
| Beeper did not accept the token | The token was wrong, or removed in Beeper. Make a new one |
| The token cannot do this | Beeper accepted the token but would not let it read or send chats |
| Beeper is not answering. Showing what was read a moment ago | One poll got no answer; the chats on screen may be old. After a second miss the page gives way to the message above |
| Something went wrong | Beeper answered with something unexpected, or too slowly, or too much at once (replies over 1 MiB are refused by Buzz) |

**Test connection** in the settings card runs the same checks and says which of these it is.

</details>

<details>
<summary><b>What it does not do yet</b></summary>

### What it does not do yet

- No pictures, avatars, voice playback, files or link previews; media shows as a label. (Buzz's content security policy allows only `https:` and `data:` images, and Beeper hands out local file paths.)
- No reactions, edits, deletes, replies-to-a-message, new chats, archiving, muting or search across messages.
- The network's own logo is not shown (Beeper's API gives only the network's name, and the logos belong to the networks): the badge is the name's initials on a colour taken from the name.
- Only the most recent chats are listed (up to 200: the API's page limit); older ones are not fetched, and the list says so.
- A reply that Beeper rewrites on its way out (it turns Markdown into formatted text) may show twice for up to a minute: once as "Sent" and once as the message Beeper lists.
- **Merged chats** (one person across several networks) are listed as the separate chats they are made of, not as one.
- It polls; it does not use Beeper's WebSocket (the page cannot open one, and `curl` cannot hold one for the plugin).
- A message of more than about 60,000 characters (fewer if it is full of quotes, backslashes or line breaks) cannot be sent from here: Buzz lets a program take 64 KiB on its input. The box says so before you try.

</details>

<details>
<summary><b>Status: what has and has not been run</b></summary>

### Status

The Keychain route has **not been run on a Mac** (there was none): it is tested against a stand-in `security` program that behaves as the real one is documented to, so what is proved is what the plugin does with such a program, not that the real one behaves so. If saving does not work for you, the card falls back to the Terminal command.

Built and tested against a **fake** Beeper Desktop that follows the shapes in Beeper's own TypeScript SDK. **It has not been run against a real Beeper Desktop**: there was none where it was built. [`scripts/probe.mjs`](scripts/probe.mjs) is for that: with Beeper running and a token in `BEEPER_ACCESS_TOKEN`, `node scripts/probe.mjs` reads through the same `curl` path and prints status codes, field names and counts, never a message, a name or an id. What it checks, and what was verified here, is in `NOTES.md`.

</details>

<details>
<summary><b>Development</b></summary>

### Development

```sh
cd plugins/beeper
pnpm install
pnpm run typecheck
pnpm test                # unit tests: the curl request, the client against the real curl and a fake Beeper, the store, the formatting
pnpm run build           # writes plugin.js next to manifest.json; commit it, Buzz never builds
test/run.sh /path/to/block/buzz-app/checkout    # the browser tests, in Buzz's own web build (see the header of the script)
node test/fake-beeper/server.mjs                # a fake Beeper Desktop for trying the plugin by hand (PORT, CHATS, MESSAGES)
```

</details>

## License

Apache License 2.0, as the rest of this repository.
