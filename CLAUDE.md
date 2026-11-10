# lachs

Browser extension plus local helper. On a GitHub PR page it shows a Claude mascot button that resumes the local Claude Code session that created the PR, in a Zed terminal thread.

To set it up on a Mac, use the `setup` skill (`.claude/skills/setup/SKILL.md`).

## Layout

- `extension/`: Chromium MV3 extension (Brave, Chrome). `content.js` adds the button, `background.js` talks to the helper and shows the result as a macOS notification.
- `helper/finder.js`: finds the creating session in `~/.claude/projects`.
- `helper/host.js`: native messaging host. Looks up sessions, checks `~/.claude/sessions` for running ones, starts the open command.
- `bin/lachs-zed`: `resume` leaves a note and focuses Zed, `focus` only focuses it; `init [shell]` is Zed's `agent.terminal_init_command` and resumes the note; a shell (fish, zsh, bash) starts Claude through it so the user's `claude` function or alias applies.
- `scripts/install.sh`: registers the native host for Brave and Chrome.

## Commands

- `npm test`
- `node helper/host.js lookup <pr-url>` prints what the extension would get. `open` actually opens the session.

## Rules

- Bump `version` in `extension/manifest.json` with every extension change. The helper reports that version, and the extension reloads itself when it differs.
- Never put the literal text `gh pr create` in a Bash command, for example when grepping transcripts. Claude Code then links your own session to whatever PR URL the output contains. Use `gh pr creat[e]`.
- Open commands are templates. `~/.config/lachs/config.json` can override `resume` and `focus`, with `{sessionId}`, `{cwd}` and `{repoRoot}` placeholders.
