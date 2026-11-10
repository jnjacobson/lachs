---
name: setup
description: Install or update lachs on this Mac (native host, Zed init command, browser extension). Use when the user asks to set up, install, update or repair lachs.
---

# Set up lachs

Run every step. All of them are safe to repeat.

1. **Pick the app.** Read `app` from `~/.config/lachs/config.json` (default `zed`). If it is unset, list the apps in `bin/lachs-*` (see "Apps" in README.md) and ask which one should open sessions. Write the choice into the config, even `zed`, so a rerun doesn't ask again: create it with `mkdir -p ~/.config/lachs` if needed, merge into existing JSON and keep other keys.

2. **Check prerequisites.** `node` is on PATH, Brave or Chrome is installed, and the app the script drives exists (e.g. `/Applications/Zed.app` for `zed`). Stop and tell the user what is missing.

3. **Register the native host.** Run `scripts/install.sh`. Note the extension ID and the Zed init command it prints.

Steps 4 and 5 are only for `zed`. For another app, follow the "Setup:" note at the top of its `bin/lachs-<name>` instead.

4. **Point Zed at the wrapper.** In `~/.config/zed/settings.json`, set `agent.terminal_init_command` to the printed init command, e.g. `"/Users/jan/projects/lachs/bin/lachs-zed init"`.
   - Use the Edit tool. The file is JSONC: keep comments and formatting.
   - If the current value is neither `"claude"` nor the wrapper, ask before replacing it.
   - Check `~/.config/zed/keymap.json` for a binding to `agent::NewTerminalThread`. If there is none, tell the user to bind one, because resuming waits for that key press.

5. **Set the shell for `claude`.** Terminal threads start from `sh`, so a `claude` function or alias in the user's shell (for example one that picks the config dir per project) is bypassed unless `shell` is set in `~/.config/lachs/config.json`.
   - Use the login shell, not `$SHELL`: Claude's Bash tool can run in another shell. Get it with `dscl . -read ~ UserShell`, then run `<login shell> -ic 'type claude' 2>&1`. It reports "function" or "alias" when one exists.
   - If `claude` resolves to a function or alias, set `"shell"` to the basename of the login shell (`fish`, `zsh` or `bash`). Skip other shells and tell the user.
   - If it resolves to the plain binary (`~/.local/bin/claude`), leave `shell` unset, and remove a stale `shell` entry only after asking.
   - Create the file with `mkdir -p ~/.config/lachs` if needed. Merge into existing JSON and keep other keys such as `app`. If a different `shell` is already set, ask before replacing it.

6. **Load the extension (manual).** For each browser that step 3 registered, tell the user:
   1. Open `brave://extensions` or `chrome://extensions`.
   2. Turn on Developer mode.
   3. Click "Load unpacked" and choose the printed extension folder.
   4. Check that the ID matches the printed one.

   Skip this step when the extension is already loaded. It reloads itself after updates.

7. **Verify.**
   - Pick a PR this Mac created. Search `~/.claude/projects/*/*.jsonl` for `"prUrl":"`, and remember the rule in CLAUDE.md about the `gh pr create` text.
   - Run `~/.local/share/lachs/native-host lookup <pr-url>`. It must return a session.
   - Ask the user to open that PR in the browser and confirm the Claude mascot button shows up. If the toolbar icon shows a red "!", its popup has the error.
   - Ask the user to click the button. A notification with the salmon icon must appear. If not, they must allow notifications for Brave (or Chrome) in System Settings → Notifications.
