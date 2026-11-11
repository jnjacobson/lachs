# lachs

Browser extension plus local helper. On a GitHub PR page it shows a Claude mascot button that resumes the local Claude Code session that created the PR, in a configurable app (a new Terminal.app window by default).

To set it up on a Mac, use the `setup` skill (`.claude/skills/setup/SKILL.md`).

## Layout

- `extension/`: Chromium MV3 extension (Brave, Chrome). `content.js` adds the button, `ask.js` adds *Ask Claude* to GitHub's comment forms on the Files changed tab and shows the answers, `background.js` talks to the helper and shows the result as a macOS notification.
- `helper/finder.js`: finds the creating session in `~/.claude/projects`. Which PRs each transcript created is cached per file (size and mtime) in `~/.cache/lachs/index.json`; whether a session is running is never cached.
- `helper/host.js`: native messaging host. Looks up sessions, checks `~/.claude/sessions` for running ones, starts the configured app, answers questions.
- `helper/ask.js`: answers a question with `claude -p --resume <id> --fork-session --no-session-persistence`, read-only tools only. `helper/answers.js` keeps the answers, one file each, in `~/.local/state/lachs/answers/<owner>/<repo>/<number>/`.
- `bin/lachs-<app>`: the apps, all with the interface in README.md ("Apps"). Add an app by adding a script; nothing else needs a list of them.
- `bin/lachs-zed`: `resume` leaves a note and focuses Zed, `focus` only focuses it; `init` is Zed's `agent.terminal_init_command` and resumes the note. If `shell` is set in the config, Claude starts through that shell so the user's `claude` function or alias applies.
- `bin/lachs-terminal`: opens a Terminal.app window; `focus` selects the tab whose tty runs the Claude pid.
- `scripts/install.sh`: registers the native host for Brave and Chrome.

## Commands

- `npm test`
- `npm run lint`: Biome (JS, JSON, HTML, CSS) and ShellCheck (needs `shellcheck` installed). `npm run format` applies Biome's fixes. CI (`.github/workflows/ci.yml`) runs both.
- `node helper/host.js lookup <pr-url>` prints what the extension would get. `open` actually opens the session. `ask <pr-url> <file> <lines>|file <question>` asks the session for real.

## Rules

- Bump `version` in `extension/manifest.json` with every extension change, also between edits while testing: without a new version the loaded extension keeps running the old files. The helper reports that version, and the extension reloads itself when it differs.
- GitHub's diff DOM has no stable API. `extension/ask.js` relies on `[class*="diffTargetable"]` file containers, `td.diff-text-cell[data-diff-side][data-line-number]`, `[data-file-path]`, the form headings ("Add a comment on lines R9 to R11", "Add comment on file") and the "Cancel" button. Check those first when *Ask Claude* stops showing up.
- Never put the literal text `gh pr create` in a Bash command, for example when grepping transcripts. Claude Code then links your own session to whatever PR URL the output contains. Use `gh pr creat[e]`.
- `~/.config/lachs/config.json`: `app` (a name from `bin/lachs-<name>` or a path, default `terminal`) and `shell` (`fish`, `zsh`, `bash`) for `lachs-zed init`.
- Keep the notification text app-neutral in `extension/background.js`; app-specific advice is what the app prints.
