# lachs

> lachs (German for "salmon", pronounced /laks/)

Swims upstream from a GitHub pull request to the local Claude Code session that spawned it.

lachs is a browser extension for Brave and Chrome. When Claude Code on your Mac opened a pull request, lachs adds a button to that PR's page on GitHub. One click resumes the session that created it, with its full context, in Terminal.app or Zed.

## Usage

Open a pull request on GitHub. If a Claude Code session on this Mac ran `gh pr create` for it, a Claude mascot button appears on the page. Click it to resume that session in the app you chose (see [Apps](#apps)).

If the session is already running, a macOS notification says so instead of starting a second copy. If something goes wrong, the toolbar icon shows a red "!" and its popup has the error.

## Setup

You need macOS, Brave or Chrome, Node 24 or newer and Claude Code.

The easy way: clone the repo, start Claude in it and say "set this up". The [setup skill](.claude/skills/setup/SKILL.md) installs everything and checks that it works. It's safe to rerun after updates.

By hand:

1. Clone the repo and register the native messaging host. The script prints the extension folder, the extension ID and a Zed init command.

   ```sh
   git clone https://github.com/jnjacobson/lachs.git
   cd lachs
   scripts/install.sh
   ```

2. In `brave://extensions` or `chrome://extensions`, turn on Developer mode, click *Load unpacked* and choose the printed folder. Check that the ID matches. The extension reloads itself after updates.

3. Allow notifications for your browser in System Settings → Notifications.

4. For Zed only:
   - Set `"app": "zed"` in `~/.config/lachs/config.json`.
   - In Zed's settings, set `agent.terminal_init_command` to the printed init command.
   - Bind a key to `agent::NewTerminalThread`. Resuming waits for it.
   - If `claude` is a shell function or alias, set `"shell"` in the config to `fish`, `zsh` or `bash` so it's used. Zed starts terminal threads from `sh`, which would skip it.

## Apps

`app` in `~/.config/lachs/config.json` picks what opens the session:

- `terminal` (default): a new Terminal.app window. The first time, macOS asks whether your browser may control Terminal.
- `zed`: the repo's Zed workspace; a new terminal thread resumes the session.

```json
{ "app": "zed" }
```

### Adding an app

An app is an executable `bin/lachs-<name>`; `app` can also be a path to your own (`~/` works). It's called with:

- `resume <session-id> <cwd> <repo-root>`: start `claude --resume <session-id>` in `<cwd>`.
- `focus <session-id> <cwd> <repo-root> <pid>`: the session already runs as process `<pid>`; bring it to the front if you can.

When the session belongs to another Claude config dir (see below), `CLAUDE_CONFIG_DIR` is set in the app's environment. Pass it on to `claude`.

Whatever it prints to stdout is added to the notification, so print what the user has to do next, if anything. A non-zero exit shows stderr as an error instead. lachs waits up to 5 seconds for it to exit, so print before anything slow. Arguments may grow at the end, so ignore extra ones. Put a `# Setup:` comment at the top saying what setup the app needs; the setup skill follows it.

## Several Claude config dirs

If you use another `CLAUDE_CONFIG_DIR` for some projects, for example a private account, map the project folders to it:

```json
{ "claudeConfigDirs": { "~/projects/private": "~/.claude-private" } }
```

lachs then finds sessions in those dirs too and resumes them with the right `CLAUDE_CONFIG_DIR`. `~/.claude` is always searched. With Zed, a new terminal thread also starts with the dir its folder maps to, or `~/.claude` outside the mapped folders.

## How it works

The extension asks a local helper, registered as a native messaging host, which session created the PR. The helper searches the transcripts in `~/.claude/projects` (and the `projects` folder of each dir in `claudeConfigDirs`) for the PR's URL, using an index in `~/.cache/lachs/index.json` so only new or changed transcripts are read (delete it to rebuild; the first lookup after that takes a second or so), and checks the `sessions` folder next to it to see whether that session is still running. Nothing leaves your Mac.

## Development

```sh
npm test
npm run lint     # Biome and ShellCheck (needs shellcheck installed)
npm run format   # apply Biome's fixes
```

CI runs both on every push and pull request. `node helper/host.js lookup <pr-url>` prints what the extension would get for a PR.
