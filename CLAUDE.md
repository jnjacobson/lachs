# lachs

Browser extension plus local helper. On a GitHub PR page it shows a Claude mascot button that resumes the local Claude Code session that created the PR, in a configurable app (a new Terminal.app window by default).

To set it up on a Mac, use the `setup` skill (`.claude/skills/setup/SKILL.md`).

## Layout

- `extension/`: Chromium MV3 extension (Brave, Chrome). `content.js` adds the button, `background.js` talks to the helper and shows the result as a macOS notification.
- `helper/finder.js`: finds the creating session in `~/.claude/projects` and the other config dirs' `projects`. Which PRs each transcript created is cached per file (size and mtime) in `~/.cache/lachs/index.json`; whether a session is running is never cached.
- `helper/config.js`: reads `~/.config/lachs/config.json` and decides `CLAUDE_CONFIG_DIR` for a config dir. `lachs-zed init` calls it as a CLI.
- `helper/host.js`: native messaging host. Looks up sessions, checks the config dir's `sessions` for running ones, starts the configured app with `CLAUDE_CONFIG_DIR` set when the session isn't in `~/.claude`.
- `bin/lachs-<app>`: the apps, all with the interface in README.md ("Apps"). Add an app by adding a script; nothing else needs a list of them.
- `bin/lachs-zed`: `resume` leaves a note and focuses Zed, `focus` only focuses it; `init` is Zed's `agent.terminal_init_command` and resumes the note. If `shell` is set in the config, Claude starts through that shell so the user's `claude` function or alias applies. The note carries the session's config dir; a new thread gets the one `claudeConfigDirs` maps its folder to.
- `bin/lachs-terminal`: opens a Terminal.app window; `focus` selects the tab whose tty runs the Claude pid.
- `scripts/install.sh`: registers the native host for Brave and Chrome.

## Commands

- `npm test`
- `npm run lint`: Biome (JS, JSON, HTML, CSS) and ShellCheck (needs `shellcheck` installed). `npm run format` applies Biome's fixes. CI (`.github/workflows/ci.yml`) runs both.
- `node helper/host.js lookup <pr-url>` prints what the extension would get. `open` actually opens the session.

## Rules

- Bump `version` in `extension/manifest.json` with every extension change. The helper reports that version, and the extension reloads itself when it differs.
- Never put the literal text `gh pr create` in a Bash command, for example when grepping transcripts. Claude Code then links your own session to whatever PR URL the output contains. Use `gh pr creat[e]`.
- `~/.config/lachs/config.json`: `app` (a name from `bin/lachs-<name>` or a path, default `terminal`), `shell` (`fish`, `zsh`, `bash`) for `lachs-zed init`, and `claudeConfigDirs` (project folder → Claude config dir; `~/.claude` is always searched).
- Leave `CLAUDE_CONFIG_DIR` unset for `~/.claude` sessions. Setting it, even to `~/.claude`, makes Claude read `~/.claude/.claude.json` instead of `~/.claude.json`. Go through `claudeEnv` in `helper/config.js`.
- Keep the notification text app-neutral in `extension/background.js`; app-specific advice is what the app prints.
