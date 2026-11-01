# barra-laterale

A sidebar on the right of Claude Code, in four sections:

- **HOOKS**: the session's hooks, grouped by event: the ones in your settings (user, project, local, `--settings`, your organization's) and the ones of the plugins you enabled. Each row shows a name that says what the hook does, where it comes from and an `ON` / `OFF` button that switches it off for this session only; click a name to see its command, its file and its timeout. The ones that cannot be switched off (`ALWAYS` and `MANAGED`) start hidden and counted next to the title; the `always` button shows and hides them. Hooks written with `hook-switch` can be switched off: see [Switching hooks off](#switching-hooks-off).
- **GIT**: the **active** view (the default) is a simple map of the branches still in progress. The main branch (the one the remote's HEAD points to, else `main` or `master`) is on top, and the branches with commits it lacks hang below it, plus the current branch and any branch open in a worktree. Each row shows `+N −M` (commits ahead of and behind the main branch) and its remote state: `↑` to push and `↓` to pull, then `last sync` with how long ago it last synced (the last push or fetch that moved the remote branch, or the last fetch that saw it where it is), `local` if never pushed, `gone` if deleted on the remote, `remote` if it exists only there. Branches already merged are counted in one row that lists them when clicked. Click a branch to see its last commit and when it was made, the comparison in words, the last sync and the worktree it is open in. The **full** view is the commit graph of every branch, like the Source Control graph in VS Code: a coloured lane per branch, merges are `⊙`, the current commit is `○`, badges show the branches (`◎` for the current one, `☁` for remote ones), and a click on a commit shows its hash, author and date.
- **FILES**, in two views. **changed** (the main one): the files this session has changed, most recent first, with the lines it added and removed. Click one to preview it in place of the sections: the whole file as it is now, with the lines added since the session first wrote it in green and the lines removed in red, opened just above the first change; the wheel scrolls it, `tree` shows the file in the tree, `✕` goes back. When a line is wider than the sidebar a slider shows at the bottom: `◂` and `▸` move the text half a width, a click on the bar jumps there, the wheel over it scrolls sideways (the terminal does not pass the sideways wheel or trackpad swipe on to mods). `wrap` wraps long lines instead, and stays on from one file to the next. The preview follows the file as it changes. The `↗` at the end of each row opens the file in the app your system picks for it: in WSL the Windows one, through `explorer.exe`; elsewhere `open`, `xdg-open` or `start`. **tree**: the session's folders like in filetree, with the colour and letter of the git status, `?:N M:N D:N` counts and lines added and removed. Files Claude reads light up purple, files it writes light up orange.
- **CONTEXT**: every request to the model with its input and output and a bar of the context window, like turn-inspector. Click a turn to open it.

Each section has its own coloured bar left of the title. Click a title to collapse that section and give its room to the others. The mouse wheel scrolls the section under the pointer.

## Commands

- `/sidebar` opens the sidebar.
- `/sidebar close` closes it.

In the terminal the sidebar docks on the right in the fullscreen layout (`/tui fullscreen`) with at least 110 columns; otherwise it shows above the prompt.

## Switching hooks off

On a Team or Enterprise account, Claude Code seats a security plugin of its own in front of every other one, and it does not pass hook events on to mods: a mod cannot stop a hook. So hooks are written to switch themselves off:

```json
{ "type": "command",
  "command": "~/.claude/hooks/hook-switch block-writes-outside-project ~/.claude/hooks/confine-writes.sh" }
```

`hook-switch <name> <command>` runs the command with the same input and the same exit code, unless `<name>` is in the `HOOK_SWITCH_OFF` variable (names separated by spaces): then it exits and does nothing. The name is one hyphenated word that says what the hook does (`block-writes-outside-project`, `report-session-to-herdr`): the sidebar uses it as the row's title. The `OFF` button changes that variable in the session where you press it, at once; other sessions do not see it. A session can also start with a hook already off: `HOOK_SWITCH_OFF="report-session-to-herdr" claude`.

The script is [`bin/hook-switch`](bin/hook-switch) and needs `sh` (Linux, macOS, WSL). From this folder:

```bash
install -m 755 bin/hook-switch ~/.claude/hooks/hook-switch
```

- A hook written without `hook-switch` shows its script's name and `ALWAYS` instead of the button.
- Hooks managed by your organization (`MANAGED`) cannot be switched off.
- Plugins' hooks show with the plugin's name. They can be switched off only if the plugin writes them with `hook-switch`, shipping its own copy of the script: `"${CLAUDE_PLUGIN_ROOT}/hooks/hook-switch" <name> <command>`.
- Plugins are found where Claude Code installs them today (`~/.claude/plugins`); a plugin loaded with `--plugin-dir` is not listed.
- A tool that rewrites its own hook in your settings (herdr when it updates, for one) may drop `hook-switch`: the row goes back to `ALWAYS`.
- Nothing switches a hook off for good through a file, since Claude could write that file too. Only the sidebar changes the session's variable: the commands Claude runs have an environment of their own.

Code taken from filetree and from turn-inspector, both MIT licensed, is listed in `THIRD-PARTY.md`.
