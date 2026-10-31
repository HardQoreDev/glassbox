# barra-laterale

A sidebar on the right of Claude Code, in four sections:

- **HOOKS**: the hooks from your settings (`settings.json` for user, project and local), one per row with an `ON` / `OFF` button. `OFF` lasts for this session only and changes no file: the hook does not run until you turn it back on. When a hook fires, its name lights up: yellow while it runs, green when it let things through, red when it blocked, grey when it was skipped because it is off. Hooks managed by your organization are shown but cannot be turned off. The engine runs the hooks of one event together, so a hook that is off still runs when another hook for the same event is on; the row says so.
- **BRANCHES**: the commit graph of every branch, like the Source Control graph in VS Code. Each branch has a coloured lane, merges are `⊙`, the current commit is `○`, and badges show the branches: `◎` for the current one, `☁` for remote ones. Click a commit to see its hash, author and date. The **graph** view shows only the shape of the branches: their tips with their names and the commits where they split, shown by their short hash, with no messages; `⋮ N` is how many commits each node hides, and a click shows its commit.
- **FILES**, in two views. **changed** (the main one): the files this session has changed, most recent first, with the lines it added and removed. Click one to preview it in place of the sections: the whole file as it is now, with the lines added since the session first wrote it in green and the lines removed in red, opened just above the first change; the wheel scrolls it, `tree` shows the file in the tree, `✕` goes back. When a line is wider than the sidebar a slider shows at the bottom: `◂` and `▸` move the text half a width, a click on the bar jumps there, the wheel over it scrolls sideways (the terminal does not pass the sideways wheel or trackpad swipe on to mods). `wrap` wraps long lines instead, and stays on from one file to the next. The preview follows the file as it changes. The `↗` at the end of each row opens the file in the app your system picks for it: in WSL the Windows one, through `explorer.exe`; elsewhere `open`, `xdg-open` or `start`. **tree**: the session's folders like in filetree, with the colour and letter of the git status, `?:N M:N D:N` counts and lines added and removed. Files Claude reads light up purple, files it writes light up orange.
- **TURNS**: every request to the model with its input and output and a bar of the context window, like turn-inspector. Click a turn to open it.

Each section has its own coloured bar left of the title. Click a title to collapse that section and give its room to the others. The mouse wheel scrolls the section under the pointer.

## Commands

- `/sidebar` opens the sidebar.
- `/sidebar close` closes it.

In the terminal the sidebar docks on the right in the fullscreen layout (`/tui fullscreen`) with at least 110 columns; otherwise it shows above the prompt.

Code taken from filetree and from turn-inspector, both MIT licensed, is listed in `THIRD-PARTY.md`.
