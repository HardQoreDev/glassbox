# Glassbox

Claude Code as a glass box rather than a black box. Glassbox is a pane on the right of the session that shows what is going on around the agent: the hooks that run and a switch for each, the git branches in progress, the files the session changed and, request by request, what goes into the context, word for word, with the numbers and tips that help keep it lean.

```
/plugin install glassbox --marketplace HardQoreDev/glassbox
```

The repository is private: you need access to the HardQoreDev organization on GitHub and git set up on your machine (SSH or `gh auth login`). Claude Code 2.1.287 or later.

## The four sections

- **HOOKS**: the session's hooks, grouped by event: the ones in your settings (user, project, local, `--settings`, your organization's) and the ones of the plugins you enabled. Each row shows a name that says what the hook does, where it comes from and an `ON` / `OFF` button that switches it off for this session only; click a name to see its command, its file and its timeout. The ones that cannot be switched off (`ALWAYS` and `MANAGED`) start hidden and counted next to the title; the `always` button shows and hides them. Hooks written with `hook-switch` can be switched off: see [Switching hooks off](#switching-hooks-off).
- **GIT**: the **active** view (the default) is a simple map of the branches still in progress. The main branch (the one the remote's HEAD points to, else `main` or `master`) is on top, and the branches with commits it lacks hang below it, plus the current branch and any branch open in a worktree. Each row shows `+N −M` (commits ahead of and behind the main branch) and its remote state: `↑` to push and `↓` to pull, then `last sync` with how long ago it last synced (the last push or fetch that moved the remote branch, or the last fetch that saw it where it is), `local` if never pushed, `gone` if deleted on the remote, `remote` if it exists only there. Branches already merged are counted in one row that lists them when clicked. Click a branch to see its last commit and when it was made, the comparison in words, the last sync and the worktree it is open in. The **full** view is the commit graph of every branch, like the Source Control graph in VS Code: a coloured lane per branch, merges are `⊙`, the current commit is `○`, badges show the branches (`◎` for the current one, `☁` for remote ones), and a click on a commit shows its hash, author and date. The **tags** view lists the tags newest first (the latest 200), `◆` for annotated ones and `◇` for lightweight ones, the one on HEAD highlighted. Each row shows how many commits the main branch made after the tag (`N since`: what no release holds yet), `off trunk` when the tag is on a commit the main branch does not have, `local` when the remote does not have it and `moved` when the remote has it on another commit. The remote is asked with `git ls-remote` when the view opens, with `↻`, and after a `git push` Claude runs, never on a timer; it never prompts for credentials. A click on a tag shows its message, its commit, who tagged it and when, the comparison with the main branch, and the command to push it when it is missing. The title shows how many tags there are and how many are not pushed.
- **FILES**, in two views. **changed** (the main one): the files this session has changed, most recent first, with the lines it added and removed. That includes the files a shell command changes (`sed -i`, a redirect, a script): Bash does not say what it writes, so glassbox reads `git status` and the changed files before and after each command and compares them. It misses files git ignores, a change committed in the same command, and what a command left running in the background does later. Click one to preview it in place of the sections: the whole file as it is now, with the lines added since the session first wrote it in green and the lines removed in red, opened just above the first change; the wheel scrolls it, `tree` shows the file in the tree, `✕` goes back. When a line is wider than the pane a slider shows at the bottom: `◂` and `▸` move the text half a width, a click on the bar jumps there, the wheel over it scrolls sideways (the terminal does not pass the sideways wheel or trackpad swipe on to mods). `wrap` wraps long lines instead, and stays on from one file to the next. The preview follows the file as it changes. The `↗` at the end of each row opens the file in VS Code (its `code` command); without it, in the app your system picks: in WSL the Windows one, through `explorer.exe`; elsewhere `open`, `xdg-open` or `start`. **tree**: the session's folders like in filetree, with the colour and letter of the git status, `?:N M:N D:N` counts and lines added and removed. Files Claude reads light up purple, files it writes light up orange.
- **CONTEXT**: every request to the model with its input and output and a bar of the context window, like turn-inspector. See [What goes into the context](#what-goes-into-the-context).

Each section has its own coloured bar left of the title. Click a title to collapse that section and give its room to the others. The mouse wheel scrolls the section under the pointer.

## What goes into the context

The legend under the context bar, `■ system  ■ earlier  ■ new  ■ output`, is clickable: each word opens, in place of the sections, that part of the last request (the one the bar shows, `#N` on the right):

- **system**: the system prompt section by section (`intro`, `memory`, ...), then the tools the model is offered with their descriptions, and by name only the ones waiting behind ToolSearch. It is composed when you click, for the request's model.
- **earlier**: the conversation the request carried before its new input, message by message, each block with its title (`text`, `tool_use · Bash · toolu_…`, `tool_result · Read · …`, `thinking`), the text exactly as sent; images and other base64 data are summarized.
- **new**: what the request added: your prompt with the reminders attached to it, or the results of the tools the previous answer called.
- **output**: what the model answered, block by block, as it streamed; tool arguments as JSON.

Open a turn with a click and each of its blocks opens the same way, for that turn. In the window the wheel scrolls, `wrap` turns wrapping off (then a slider moves the text sideways), `↗` writes the text to a Markdown file in your temporary folder and opens it in VS Code, `✕` or the title goes back.

The messages are read as each request goes out, so a request sent before Glassbox loaded has none. Two things never reach a mod and are not shown: the tools' input schemas, and what the engine adds while sending (cache marks, reminders sent as system turns).

### stats

The `stats` button next to the CONTEXT title opens a dropdown at the top of the section, in five views (a dot marks the ones with a warning). They are meant for context engineering: keeping in the window the fewest tokens that still carry what the task needs.

- **health**, the view it opens on: the context **in use**, how much it grows per request and about how many requests are left before compaction or the limit; what is **preloaded** before your first word (system prompt, tools, MCP schemas, CLAUDE.md, skills), measured on the first request; how much is **reclaimable** (see waste); the **cache**. Then every tip, warnings first.
- **fill**: what the last request is made of, from the messages it actually sent: preloaded, tool results, tool calls, replies, thinking, your prompts, reminders (hook output included), each as a share and in tokens, in one bar. Then the five **heaviest** blocks in the context, each with the request it came in with: a click opens that request on that block. Then the schemas ToolSearch keeps out until searched, and the context **by category** as `/context` counts it.
- **waste**: what takes room for little: tool results from 10 or more requests ago (**stale**), results that came back identical to a later one, same tool, same arguments, same text (**repeated**), **failed** results; counted once in **reclaimable**. Then each MCP server with tools never called in the session, and how many of the listed skills were used.
- **flow**: the **requests**, in how many prompts and the most a prompt took; the **input** sent in all (every request sends the whole context again), per request and how much of it did not come from the cache; the **cache** share and the requests where it **broke** (one that reads from the cache less than half of what the request before sent); the **output** and how much was thinking, the answers cut off; the **compactions** and how much they freed; the **subagents**, how many requests they made in their own context, how much they kept out of this one (the largest context each reached) and how much came back.
- **tools**: the **tool calls** and how many failed or were denied; the most used tools with their calls, the tokens their results added and the average per result.

The numbers per kind and per block come from the characters of the messages, scaled so they add up to the input the API reported, and are marked `~`. The tips come from thresholds you can read in [`hooks/stats.ts`](hooks/stats.ts):

- more than 20% of the window (or 50k tokens) loaded before the first question; an MCP server, a memory file, the skill list or the agents' descriptions above 5k tokens in every request; an MCP server above 5k whose tools were never called in 5 or more requests;
- the context above 70% of its limit;
- tool results from 10 or more requests ago that hold more than 20k and 30% of the conversation; identical results whose copies weigh more than 3k; reminders and hook output above 5k and 10% of the conversation; reads and searches above 30k with no subagent at work; `Write` calls that carry more than 10k of whole files;
- less than 60% of the input from the cache, or the cache broken twice or more; a prompt that took more than 25 requests; subagent reports above 20k;
- a tool whose results weigh 10k at once (with how to narrow them); more than 20% of the tool calls failed.

### analyze

The `analyze` button next to `stats` asks Claude to read its own context as the last request sent it, with the numbers of the dropdown, and to judge it as a context engineer, in five parts: what the context holds, the dead weight item by item, what to do now (`/compact` with the instructions already written, `/clear` and a fresh start, a rule to move into CLAUDE.md or memory, an MCP server or a skill to switch off, exploration to hand to a subagent), habits to change, and a brief of at most 12 lines to restart from in a new session. The answer opens in the context window; `↻` asks again, `↗` opens the saved file. Pressing `analyze` again on the same request shows the same answer.

It runs through `$.model.fork`: the main thread's last request again, its model, system prompt, tools and messages, with the question after it and every tool denied. While the prompt cache is warm the context is billed as a cache read; once it has lapsed it is paid in full. The cost is shown next to the title (`1.2k out · 140k cached`, plus `uncached` when it counts).

## Session records

Claude Code keeps each session's transcript in `~/.claude/projects/<project>/<id>.jsonl`, but deletes it after 30 days (`cleanupPeriodDays`) and does not keep what each request actually sent. Glassbox writes every request of the main thread to `~/.claude/glassbox/sessions/<project>/<session id>/`, the project folder named as Claude Code names its own (`/home/me/app` → `-home-me-app`):

- `session.json`: the summary, rewritten at every request: the first prompt, the models, the requests, the tokens (uncached input, cache read and written, output), the last and the largest context, the compactions, `/context` after the last turn, the tool calls, the subagents, the analyses, and the `claude --resume` command that returns to it;
- `requests/0001.json`, one per request: the usage, the stop reason, the reply as it streamed, and the messages. Each request says how many messages it carries unchanged from the one before (`keep`) and holds only the rest, so the context of request k is request k−1's cut to `keep` plus its `messages` (`replay` in [`hooks/record.ts`](hooks/record.ts) rebuilds them). After a compaction `keep` is 0;
- `system/01.json`: the system prompt and the tools as the engine composed them (no input schemas, which a mod cannot read); a new file only when they change;
- `analyses/*.md`: the analyses asked for with `analyze`.

A resumed session goes on in the same folder; after `/clear` the next session gets its own. The **flow** view of `stats` shows how many requests are recorded and their size on disk. A record holds everything that went through the context, files read included: treat it as you treat the transcripts.

Two options, in `/config` or in the settings under `pluginConfigs` → the plugin → `options`:

- `recordSessions` (default `true`): `false` records nothing;
- `sessionsDir` (default empty, meaning `~/.claude/glassbox/sessions`): another folder, `~` allowed.

## Commands

- `/glassbox` opens the pane, and says where the session is recorded.
- `/glassbox close` closes it.

In the terminal Glassbox docks on the right in the fullscreen layout (`/tui fullscreen`) with at least 110 columns; otherwise it shows above the prompt.

## Switching hooks off

On a Team or Enterprise account, Claude Code seats a security plugin of its own in front of every other one, and it does not pass hook events on to mods: a mod cannot stop a hook. So hooks are written to switch themselves off:

```json
{ "type": "command",
  "command": "~/.claude/hooks/hook-switch block-writes-outside-project ~/.claude/hooks/confine-writes.sh" }
```

`hook-switch <name> <command>` runs the command with the same input and the same exit code, unless `<name>` is in the `HOOK_SWITCH_OFF` variable (names separated by spaces): then it exits and does nothing. The name is one hyphenated word that says what the hook does (`block-writes-outside-project`, `report-session-to-herdr`): Glassbox uses it as the row's title. The `OFF` button changes that variable in the session where you press it, at once; other sessions do not see it. A session can also start with a hook already off: `HOOK_SWITCH_OFF="report-session-to-herdr" claude`.

The script is [`bin/hook-switch`](bin/hook-switch) and needs `sh` (Linux, macOS, WSL). From this folder:

```bash
install -m 755 bin/hook-switch ~/.claude/hooks/hook-switch
```

- A hook written without `hook-switch` shows its script's name and `ALWAYS` instead of the button.
- Hooks managed by your organization (`MANAGED`) cannot be switched off.
- Plugins' hooks show with the plugin's name. They can be switched off only if the plugin writes them with `hook-switch`, shipping its own copy of the script: `"${CLAUDE_PLUGIN_ROOT}/hooks/hook-switch" <name> <command>`.
- Plugins are found where Claude Code installs them today (`~/.claude/plugins`); a plugin loaded with `--plugin-dir` is not listed.
- A tool that rewrites its own hook in your settings (herdr when it updates, for one) may drop `hook-switch`: the row goes back to `ALWAYS`.
- Nothing switches a hook off for good through a file, since Claude could write that file too. Only Glassbox changes the session's variable: the commands Claude runs have an environment of their own.

Code taken from filetree and from turn-inspector, both MIT licensed, is listed in `THIRD-PARTY.md`.
