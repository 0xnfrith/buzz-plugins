# Installing a plugin

Plugins load in the Buzz **desktop** app. The browser build cannot install plugins.

Every installable plugin here is a folder with a built `manifest.json` and `plugin.js` (and sometimes a `README.md`). Buzz never runs a build or an install script, so it only offers folders that already hold those two files.

## From a folder on your computer

1. Get the files: clone this repository, or download it.
2. In Buzz open **Settings → Plugins → Manage plugins**.
3. Press **Add**, choose to load a **folder**, and pick the plugin's own folder, for example `plugins/vim`.
4. Review what the plugin asks for, check the **Enable** switch in the review, and install.

Buzz remembers the folder. When the files in it change, the plugin's details show **Update**; press it to install the new version. An enabled plugin stays enabled, and the old version is disposed before the new one starts.

## From a Git repository

1. In **Settings → Plugins → Manage plugins**, press **Add**.
2. In the **Git or GitHub repository** field, enter the repository: an HTTPS or SSH URL, or a GitHub `owner/repository`. For this one: `https://github.com/0xnfrith/buzz-plugins`.
3. Optionally fill **Branch or tag** below it. Leave it empty for the default branch.
4. Press **Find**. **Choose a plugin** lists one row for each folder that has a built `plugin.js` beside its `manifest.json`, with the plugin's name, the repository and path, and its manifest id.
5. Pick one and press **Continue**. **Review plugin access** shows what the plugin asks for. Press **Install plugin**.

Notes:

- In this repository the list shows the folders under `plugins/`: `plugins/vim` (Vim mode), `plugins/beeper` (the Beeper inbox) and `plugins/key-probe` (a measuring tool used by the vim tests; you do not need it).
- Folders with a `manifest.json` but no built `plugin.js` are listed under **Folders skipped** ("No built plugin.js beside manifest.json; build the plugin first").
- Do not paste a GitHub `tree/...` URL (a link to a folder on a branch). Buzz rejects it before cloning. Give the repository, and the branch or tag in its own field.
- Each plugin installs and updates on its own. Its details pane shows its source (repository, branch or tag, and path) and a **Check for updates** button. Git is only checked when you press it; Buzz does not follow the repository by itself.
- Picking a plugin whose manifest id is already installed says **Already installed**. To switch a plugin to another source, delete it and add it again.
- Private repositories over HTTPS are not supported by Buzz's importer; SSH uses your running SSH agent.

## Turning a plugin off

Disable it in **Settings → Plugins**, or delete it there. Some plugins also have their own switch: Vim mode turns its keys off and on with Cmd+Shift+E (Ctrl+Shift+E on Windows and Linux).

If a plugin ever freezes the app at startup, start Buzz with `BUZZODZ_SAFE_MODE=1` to skip installed plugins for that launch.

## Trust

Plugins run as trusted code inside the app, not in a sandbox. Install only plugins whose code you have read or whose author you trust. Everything here is plain JavaScript you can read before installing.
