# Glassbox

Claude Code as a glass box rather than a black box. Glassbox is a pane on the right of the session that shows what is going on around the agent: the hooks that run and a switch for each, the git branches in progress, the files the session changed (and whether another open session is changing them too), request by request what goes into the context, word for word, with the numbers and tips that help keep it lean, the sessions open on the machine with the state of their prompt cache, and a text (a selection, or Claude's last reply) to read as it is, as plain spoken prose or as a terse summary, and to hear in a local Italian voice.

```
/plugin install glassbox --marketplace HardQoreDev/glassbox
```

Claude Code 2.1.287 or later.

## The seven sections

- **HOOKS**: the session's hooks, grouped by event: the ones in your settings (user, project, local, `--settings`, your organization's) and the ones of the plugins you enabled. Each row shows a name that says what the hook does, where it comes from and an `ON` / `OFF` button that switches it off for this session only; click a name to see its command, its file and its timeout. The ones that cannot be switched off (`ALWAYS` and `MANAGED`) start hidden and counted next to the title; the `always` button shows and hides them. Hooks written with `hook-switch` can be switched off: see [Switching hooks off](#switching-hooks-off).
- **GIT**: the **active** view (the default) is a simple map of the branches still in progress. The main branch (the one the remote's HEAD points to, else `main` or `master`) is on top, and the branches with commits it lacks hang below it, plus the current branch and any branch open in a worktree. Each row shows `+N −M` (commits ahead of and behind the main branch) and its remote state: `↑` to push and `↓` to pull, then `last sync` with how long ago it last synced (the last push or fetch that moved the remote branch, or the last fetch that saw it where it is), `local` if never pushed, `gone` if deleted on the remote, `remote` if it exists only there. Branches already merged are counted in one row that lists them when clicked. Click a branch to see its last commit and when it was made, the comparison in words, the last sync and the worktree it is open in. The **full** view is the commit graph of every branch, like the Source Control graph in VS Code: a coloured lane per branch, merges are `⊙`, the current commit is `○`, badges show the branches (`◎` for the current one, `☁` for remote ones), and a click on a commit shows its hash, author and date. The **tags** view lists the tags newest first (the latest 200), `◆` for annotated ones and `◇` for lightweight ones, the one on HEAD highlighted. Each row shows how many commits the main branch made after the tag (`N since`: what no release holds yet), `off trunk` when the tag is on a commit the main branch does not have, `local` when the remote does not have it and `moved` when the remote has it on another commit. The remote is asked with `git ls-remote` when the view opens, with `↻`, and after a `git push` Claude runs, never on a timer; it never prompts for credentials. A click on a tag shows its message, its commit, who tagged it and when, the comparison with the main branch, and the command to push it when it is missing. The title shows how many tags there are and how many are not pushed.
- **FILES**, in three views. **changed** (the main one): the files this session has changed, most recent first, with the lines it added and removed. That includes the files a shell command changes (`sed -i`, a redirect, a script): Bash does not say what it writes, so glassbox reads `git status` and the changed files before and after each command and compares them. It misses files git ignores, a change committed in the same command, and what a command left running in the background does later. Click one to preview it in place of the sections: the whole file as it is now, with the lines added since the session first wrote it in green and the lines removed in red, opened just above the first change; the wheel scrolls it, `tree` shows the file in the tree, `✕` goes back. When a line is wider than the pane a slider shows at the bottom: `◂` and `▸` move the text half a width, a click on the bar jumps there, the wheel over it scrolls sideways (the terminal does not pass the sideways wheel or trackpad swipe on to mods). `wrap` wraps long lines instead, and stays on from one file to the next. The preview follows the file as it changes. The `↗` at the end of each row opens the file in VS Code (its `code` command); without it, in the app your system picks: in WSL the Windows one, through `explorer.exe`; elsewhere `open`, `xdg-open` or `start`. **tree**: the session's folders like in filetree, with the colour and letter of the git status, `?:N M:N D:N` counts and lines added and removed. Files Claude reads light up purple, files it writes light up orange. **guard**: the files this session wrote that another open session wrote too; the word `guard` in the title lights up red, with how many, when two sessions are changing the same file. See [Two sessions on the same file](#two-sessions-on-the-same-file).
- **CONTEXT**: every request to the model with its input and output and a bar of the context window, like turn-inspector. See [What goes into the context](#what-goes-into-the-context).
- **SESSIONS**: the Claude Code sessions open on this machine, this one on top, each with its context and the state of its prompt cache. See [Open sessions and the prompt cache](#open-sessions-and-the-prompt-cache).
- **VOX**: a text to read and to listen to: a selection copied after `rec`, or Claude's last reply with `cp`. **raw** shows it as it is, **prose** unrolls it into plain spoken prose, and `▶` reads it aloud. See [VOX and SYNTH](#vox-and-synth-read-and-listen).
- **SYNTH**: the same text cut down to a few terse lines, written when you press `write`, and read aloud with its own `▶`.

VOX and SYNTH start collapsed, open at the first of their commands, and are only as tall as their text: the other sections keep the rest. Each section has its own coloured bar left of the title. Click a title to collapse that section and give its room to the others. The mouse wheel scrolls the section under the pointer.

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

## Two sessions on the same file

With many sessions open on the same repositories, two of them can end up changing the same file: then a commit from one takes the other's half-done work with it, or one session works on a file that is no longer what it read. The **guard** view of FILES watches for it.

Two sessions on the same file is not always trouble: it is when both have work not yet saved in it. A file is **shared** (`▲`, red) when it has uncommitted changes and no commit touched it after the earlier of the two sessions' last writes. A commit in between means the first session's work is saved, and the file is listed as settled (`·`, dim, `committed`). For a file outside git, or one git ignores, nothing says when the work was saved: it counts as shared while both writes are from the last day (`not in git`), settled after (`over a day`). Settled files stay in the list while the other session wrote them in the last day.

```
guard 1                              (the FILES title, lit red)
▲ hooks/register.tsx       you 3m ago
  ↳ Docs migration    2m ago · uncommitted
· README.md                you 4h ago
  ↳ tiny              5h ago · committed
```

Each file shows when this session last wrote it, and below it every other session that wrote it, with when and how it stands; a click on the file opens its preview, a click on a session brings herdr to its pane. A shared file also gets `▲` in the **changed** view, and a toast names it once, the first time it becomes shared with a session (again if it settles and becomes shared later). The guard checks again every minute, with the sessions, and right after each write of this session.

What the other sessions wrote comes from their transcripts: [`bin/sessions.py`](bin/sessions.py) reads the results of their successful `Edit` and `Write` calls, subagents included. It reads each transcript once, then only the lines added since: an index in the temporary folder (`claude-glassbox-writes-<uid>.json`, private) keeps how far it got, and when twenty sessions ask at once one does the work and the others wait for it. The first read of hundreds of megabytes is capped at six seconds per round and goes on at the next. For this session the guard also counts what FILES saw, shell commands included; what a shell command writes in another session is not seen. Whether a file is saved comes from `git status` and the last commit that touched it, in the file's own folder.

## Open sessions and the prompt cache

The prompt cache lasts an hour from a session's last request. After that, the next message writes the whole context into the cache again, and writing a token costs about twenty times reading it: coming back to a 600k session left idle since yesterday costs about as much as twenty messages at warm cache. With many sessions open, each one goes cold while you work on the others. SESSIONS shows which ones are still warm and which ones would reload from scratch:

- `◐ working`: running a turn; its cache stays warm while it runs.
- `◐ 2 agents · 41m left`: waiting for its agents (see below), with its cache time.
- `◆ needs you`: stopped on a question or a permission, with its cache time.
- `● 41m left`: warm, with the minutes left; yellow under ten.
- `○ reload · idle 2d`: cold with 150k or more of context, in red: the next message reloads it all. `○ cold` is cold but light, cheap to reload.
- `◌ compacted`: compacted after its last request, so its context is small.

This session is on top, marked with a `▌` bar and **this** before its name, and stays there while the rest of the section scrolls. Then come the ones working, the ones waiting for you, the warm ones from the closest to expiry, and the cold ones from the heaviest. The title counts them: open, waiting for you, warm, to reload. `↻` reads them again.

When the sessions run in [herdr](https://herdr.dev), each row shows the title of its terminal (what the session is working on) instead of the registry name, and a click on it brings herdr to that session's pane (`herdr agent focus <pane>`). `▸` at the end of the row opens the details below it: the registry name, the folder, the herdr pane, what coming back to it costs, and the `claude --resume` command. For this session, and for one outside herdr, the click on the name opens the details too.

With the pane closed too, a toast says five minutes before a heavy (150k or more) idle cache expires, this session's or another's, once per expiry; not for a session whose agents are working. Glassbox keeps nothing under the prompt: a countdown of this session's cache belongs in your own status line, which gets the transcript path on its input.

The list comes from [`bin/sessions.py`](bin/sessions.py), which needs `python3`. Claude Code keeps a registry of its running sessions in `~/.claude/sessions/<pid>.json`; the script keeps the interactive ones whose process is still the registered one, and reads the tail of each transcript for the time and the context of the last request of the main thread (subagents excluded). If `herdr` is installed (`HERDR_BIN_PATH` or on the `PATH`), `herdr agent list` gives each session's pane and terminal title. Every session with Glassbox runs it once a minute: so that twenty sessions do not repeat the same work, the result is shared for 45 seconds in a private file in the temporary folder (`claude-glassbox-sessions-<uid>.json`). A session counts as warm until an hour after its last request; under usage overage the cache lasts five minutes, which the section does not know.

### Sessions waiting for their agents

A session that launched its own agents (a review, a search) waits for them: its main thread sends no request until they report back, and after an hour its cache expires although the session is anything but idle. The agents do not keep it warm, since they run on a prompt of their own. So while a session has agents working, Glassbox keeps its cache warm: five minutes before it expires it sends one minimal request with `$.model.fork`, which sends the main thread's last request again with one line after it, so the API reads the whole context from the cache and the hour starts over. It costs one cache read of the context, about a twentieth of rewriting it, and it is never sent once the cache is already cold, when it would cost a full rewrite. The details of this session say how many times it was kept warm and how much each one read.

An agent counts as working when the `meta.json` Claude Code keeps beside its transcript (`<session>/subagents/agent-<id>.meta.json`) does not say `finished` yet and it wrote something in the last two hours: an agent left unfinished by a session that was closed or restarted stops counting after that. Each refresh is marked with `bin/sessions.py --warm <session id>`, a file named after the session in a private folder of the temporary directory (`claude-glassbox-warm-<uid>/`), so that the other sessions, a status line or a hook can count it as the session's last request.

## VOX and SYNTH: read and listen

Two sections for the answers that are long, dense or full of tables: instead of asking Claude to "say it better" in the chat, which costs a whole new reply and stays in the context, the text is rewritten **from inside the session** and can be listened to.

```
▌ VOX  last reply · 238 words · ≈ 1′25″          rec 1 cp ▶ ✕
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  raw | prose  ◂ ×1 ▸  fast | deep  prompt  edit  − 1.0× +
  …the text…
▌ SYNTH  3 lines · Haiku 2.4s · ≈ 10″                  ↻ ▶
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  ◂ 3 lines ▸  fast | deep  prompt  edit
  …the summary…
```

**Taking a text**, from the title of VOX:

- `rec` opens the door to copies. Press it, select a text in herdr (which copies it on its own, `copy_on_select`), and the text lands in VOX. After 60 seconds with no copy and no edit it switches itself off; while it is off no process watches the clipboard. The title counts the seconds left.
- `1` / `+` is the mode of `rec`, one button that shows the active one and swaps it. `1`: the copy replaces the text, and `rec` switches off. `+`: every copy is added at the bottom on a new line, and `rec` stays on; if herdr writes the same selection twice in a row, the second is ignored.
- `cp` takes Claude's text after your last message.
- `✕` empties the section.

**Reading it**, in the row under the title, which stays in place while the text scrolls:

- **raw** is the text as it is. **prose** unrolls it: tables and lists become a talk with a thread. It is written the first time you open it, then kept until the text changes.
- `◂ ▸` set the length of the prose: as long as the original up to 250 words, beyond that every extra word counts half; `▸` doubles and goes deeper, `◂` halves, up to ×4 and ×1/4. In SYNTH they move along steps (up to 60 words 1 line, 200 → 3, 500 → 5, 1000 → 7, beyond 9), never longer than the original.
- **fast | deep** choose who writes. fast: Haiku, with `$.model.complete`, sees only the text (and, for a selection, the reply it comes from). deep: a fork of the session itself, with `$.model.fork`, which knows the whole conversation and costs more. `▸` beyond the base length of the prose switches to deep on its own, because going deeper without the context means making things up.
- `prompt` opens, in place of the sections, the prompt of the prose or of the summary and, below, its parameters (`soglia=250 tetto=4`, `gradini=60:1,200:3,500:5,1000:7,oltre:9 parole_riga=12`). **save** applies them, for the next sessions too; **↺ default** puts the starting ones back in the fields; **close** leaves everything as it was. `{parole}`, `{righe}` and `{parole_riga}` are filled in by the formula.
- `edit` opens the text shown in a field, in place of the sections: Enter saves and leaves, `\` + Enter is a new line. The text of VOX is the source: changing it makes prose and summary be written again. Changing the prose or the summary touches only that text.

SYNTH is written only when you press `write`; `↻` writes it again. Prose and summary are always in Italian, whatever the language of the text: the voice is Italian.

**Listening**: `▶` in a title reads what that section shows, and becomes `■` while it reads; `− +` change the speed, and the title shows about how long it takes. Before it is read, the text is cleaned: no code blocks, links, markdown symbols or terminal box characters, and a path becomes its last name.

### The voice

`cp`, prose and SYNTH work everywhere. `▶` and `rec` need the voice: [Piper](https://github.com/OHF-Voice/piper1-gpl) with `it_IT-serena-high`, all local, so no text leaves the machine to be read. For now it needs **WSL on Windows**: the audio comes out on the Windows side through `voxbox-win.exe`, a player of a few lines that also listens to the clipboard for `rec`, built with the `csc.exe` of the .NET Framework every Windows already has. The engine ([`bin/voxbox-tts.py`](bin/voxbox-tts.py)) starts at the first reading and stays loaded; after 10 minutes without readings it quits. The first piece of each reading is short, up to the first comma, so the voice starts in about a second.

It is installed once, with [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh` if it is missing) and no sudo:

```bash
bin/vox-setup.sh
```

Until then VOX says so, with the path of the script in the installed copy of the plugin. The script can be run again and redoes only what is missing:

| What | Where |
|---|---|
| Piper | `~/.local/share/voxbox/venv` |
| the voice (about 114 MB) | `~/.local/share/voxbox/voices` |
| `voxbox-win.exe` | `%LOCALAPPDATA%\voxbox` |
| the paths for the mod | `~/.local/share/voxbox/config.json` |

Another Piper voice: `VOXBOX_VOICE=it_IT-paola-medium bin/vox-setup.sh`. To uninstall: `bin/vox-setup.sh --uninstall`. The edited prompts live in the plugin's store.

## Glassbox in pi

The same code also runs in [pi](https://pi.dev): `pi install git:github.com/HardQoreDev/glassbox`. The adapter in [`pi/`](../../pi) at the root of the repository turns pi's events into the ones Glassbox hooks in Claude Code and draws the pane; [`hooks/host.ts`](hooks/host.ts) holds the few things that differ between the two agents (the command that resumes a session, the sections the agent lacks). In pi there is no HOOKS section, SESSIONS lists the pi sessions that have Glassbox loaded, and `alt+g` moves the keyboard to the pane. The differences are listed in the [README of the repository](../../README.md#glassbox-in-pi).

pi does not load JSX: after a change in `hooks/`, run `pi/build.sh` and commit `pi/dist`.

## Commands

- `/glassbox` opens the pane, and says where the session is recorded.
- `/glassbox sections` opens the checklist of the sections, the same as `≡ sections` under the title: a tick for each section the pane shows. A section taken off leaves the pane with its title row too, and its rows go to the others (collapsing it from its title keeps the row). The choice is saved for the next sessions.
- `/glassbox close` closes it, stops `rec` and shuts the voice engine down.

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
