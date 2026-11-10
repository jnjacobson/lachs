# lachs

Swims upstream from a GitHub pull request to the local Claude Code session that spawned it.

On a PR page, a Claude mascot button appears if this Mac has the session that ran `gh pr create`. Clicking it resumes that session in the configured app (see [Apps](#apps)); by default a new Terminal.app window resumes it. If the session is already running, a macOS notification says so instead of starting a second copy.

Setup: clone the repo, start Claude in it and say "set this up".

## Apps

`app` in `~/.config/lachs/config.json` picks what opens the session:

- `terminal` (default): a new Terminal.app window. The first time, macOS asks whether your browser may control Terminal.
- `zed`: the repo's Zed workspace; a new terminal thread resumes the session.

```json
{ "app": "zed" }
```

An app is an executable `bin/lachs-<name>`; `app` can also be a path to your own (`~/` works). To add one, write a script that takes:

- `resume <session-id> <cwd> <repo-root>`: start `claude --resume <session-id>` in `<cwd>`.
- `focus <session-id> <cwd> <repo-root> <pid>`: the session already runs as process `<pid>`; bring it to the front if you can.

Whatever it prints to stdout is added to the notification, so print what the user has to do next, if anything. A non-zero exit shows stderr as an error instead. lachs waits up to 5 seconds for it to exit, so print before anything slow. Arguments may grow at the end, so ignore extra ones. Put a `# Setup:` comment at the top saying what setup the app needs; the setup skill follows it.
