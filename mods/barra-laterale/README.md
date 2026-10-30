# barra-laterale

A sidebar on the right of Claude Code, in four sections:

- **HOOKS**: the hooks from your settings (`settings.json` for user, project and local), one per row with an `ON` / `OFF` button. `OFF` lasts for this session only and changes no file: the hook does not run until you turn it back on. When a hook fires, its name lights up: yellow while it runs, green when it let things through, red when it blocked, grey when it was skipped because it is off. Hooks managed by your organization are shown but cannot be turned off. The engine runs the hooks of one event together, so a hook that is off still runs when another hook for the same event is on; the row says so.
- **BRANCHES**: the commit graph of every branch, like the Source Control graph in VS Code. Each branch has a coloured lane, merges are `⊙`, the current commit is `○`, and badges show the branches: `◎` for the current one, `☁` for remote ones. Click a commit to see its hash, author and date.
- **FILES**, in two views. **changed** (the main one): the files this session has changed, most recent first, with the lines it added and removed; click one to show it in the tree. **tree**: the session's folders like in filetree, with the colour and letter of the git status, `?:N M:N D:N` counts and lines added and removed. Files Claude reads light up purple, files it writes light up orange.
- **TURNS**: every request to the model with its input and output and a bar of the context window, like turn-inspector. Click a turn to open it.

Each section has its own coloured bar left of the title. Click a title to collapse that section and give its room to the others. The mouse wheel scrolls the section under the pointer.

## Commands

- `/sidebar` opens the sidebar.
- `/sidebar close` closes it.

In the terminal the sidebar docks on the right in the fullscreen layout (`/tui fullscreen`) with at least 110 columns; otherwise it shows above the prompt.

Code taken from filetree and from turn-inspector, both MIT licensed, is listed in `THIRD-PARTY.md`.
