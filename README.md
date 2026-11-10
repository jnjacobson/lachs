# lachs

> lachs (German for "salmon", pronounced /laks/)

Swims upstream from a GitHub pull request to the local Claude Code session that spawned it.

On a PR page, a Claude mascot button appears if this Mac has the session that ran `gh pr create`. Clicking it brings the repo's Zed workspace to the front. Open a new terminal thread and it resumes that session. If the session is already running, a macOS notification says so instead of starting a second copy.

Setup: clone the repo, start Claude in it and say "set this up".
