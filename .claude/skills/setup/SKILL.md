---
name: setup
description: Install or update lachs on this Mac (native host, Zed init command, browser extension). Use when the user asks to set up, install, update or repair lachs.
---

# Set up lachs

Run every step. All of them are safe to repeat.

1. **Check prerequisites.** `node` is on PATH, `/Applications/Zed.app` exists, and Brave or Chrome is installed. Stop and tell the user what is missing.

2. **Register the native host.** Run `scripts/install.sh`. Note the extension ID and the Zed init command it prints.

3. **Point Zed at the wrapper.** In `~/.config/zed/settings.json`, set `agent.terminal_init_command` to the printed init command, e.g. `"/Users/jan/projects/lachs/bin/lachs-zed init"`.
   - Use the Edit tool. The file is JSONC: keep comments and formatting.
   - If the current value is neither `"claude"` nor the wrapper, ask before replacing it.
   - Check `~/.config/zed/keymap.json` for a binding to `agent::NewTerminalThread`. If there is none, tell the user to bind one, because resuming waits for that key press.

4. **Load the extension (manual).** For each browser that step 2 registered, tell the user:
   1. Open `brave://extensions` or `chrome://extensions`.
   2. Turn on Developer mode.
   3. Click "Load unpacked" and choose the printed extension folder.
   4. Check that the ID matches the printed one.

   Skip this step when the extension is already loaded. It reloads itself after updates.

5. **Verify.**
   - Pick a PR this Mac created. Search `~/.claude/projects/*/*.jsonl` for `"prUrl":"`, and remember the rule in CLAUDE.md about the `gh pr create` text.
   - Run `~/.local/share/lachs/native-host lookup <pr-url>`. It must return a session.
   - Ask the user to open that PR in the browser and confirm the Claude mascot button shows up. If the toolbar icon shows a red "!", its popup has the error.
   - Ask the user to click the button. A notification with the salmon icon must appear. If not, they must allow notifications for Brave (or Chrome) in System Settings → Notifications.
