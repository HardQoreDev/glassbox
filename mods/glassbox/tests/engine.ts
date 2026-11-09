// Il motore finto sotto il mod, condiviso dai test: un repo in /r con le sue
// cartelle e i suoi branch, due hook nelle impostazioni utente (uno con
// hook-switch), due plugin con i loro hook, un modello che risponde.
import type { Engine } from 'claude-code/testing'
import type { FsEntry, ModelForkResult, On, ProcessRunResult, SessionContextBreakdown } from 'claude-code'

const F = '\x1f'
const R = '\x1e'
const commit = (hash: string, parents: string, refs: string, subject: string) =>
  [hash, hash.slice(0, 7), parents, refs, subject, 'Giulio', '1761700000'].join(F) + R

const LOG = [
  commit('c3', 'c2 c1b', 'HEAD -> main, origin/main', 'Merge feature'),
  commit('c2', 'c1', '', 'Lavoro su main'),
  commit('c1b', 'c1', 'origin/feature', 'Lavoro sul ramo'),
  commit('c1', '', '', 'Primo commit'),
].join('\n')

// I branch come li dà for-each-ref: main segue origin/main; spike non è mai
// stato spinto; wip è aperto in un altro worktree, senza commit suoi; old-fix
// è già unito e il suo remoto è stato cancellato; feature c'è solo sul remoto.
const ref = (...fields: string[]) => fields.join(F) + R + '\n'
export const REFS = [
  ref('refs/heads/main', '', 'c3', '*', 'refs/remotes/origin/main', '', '1761700000', 'c3', 'Giulio', '/r', 'Merge feature'),
  ref('refs/heads/old-fix', '', 'c1', ' ', 'refs/remotes/origin/old-fix', 'gone', '1761000000', 'c1', 'Giulio', '', 'Primo commit'),
  ref('refs/heads/spike', '', 's2', ' ', '', '', '1761800000', 's2', 'Ada', '', 'Prova veloce'),
  ref('refs/heads/wip', '', 'c3', ' ', '', '', '1761700000', 'c3', 'Giulio', '/home/u/r-wip', 'Merge feature'),
  ref('refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'c3', ' ', '', '', '1761700000', 'c3', 'Giulio', '', 'Merge feature'),
  ref('refs/remotes/origin/feature', '', 'c1b', ' ', '', '', '1761600000', 'c1b', 'Giulio', '', 'Lavoro sul ramo'),
  ref('refs/remotes/origin/main', '', 'c3', ' ', '', '', '1761700000', 'c3', 'Giulio', '', 'Merge feature'),
].join('')
// Quanti commit ognuno ha in più e in meno di origin/main.
export const COUNTS = [
  ['refs/heads/main', '0 0'],
  ['refs/heads/old-fix', '0 3'],
  ['refs/heads/spike', '2 1'],
  ['refs/heads/wip', '0 0'],
  ['refs/remotes/origin/HEAD', '0 0'],
  ['refs/remotes/origin/feature', '1 2'],
  ['refs/remotes/origin/main', '0 0'],
  ['refs/tags/v1.1', '0 0'],
  ['refs/tags/exp', '1 2'],
  ['refs/tags/v1.0', '0 3'],
]
  .map(([name, pair]) => `${name}${F}${pair}${R}\n`)
  .join('')

// I tag dal più recente: v1.1 annotato su HEAD, exp annotato sul ramo
// feature, fuori dal principale; v1.0 leggero sul primo commit.
export const TAGS = [
  ref('refs/tags/v1.1', 'tag', 'tag11', 'c3', 'tag11', 'c3', '1761800000', 'Giulio', '', 'Merge feature', 'Release 1.1'),
  ref('refs/tags/exp', 'tag', 'tagexp', 'c1b', 'tagexp', 'c1b', '1761600000', 'Ada', '', 'Lavoro sul ramo', 'Esperimento'),
  ref('refs/tags/v1.0', 'commit', 'c1', '', 'c1', '', '1761000000', '', 'Giulio', '', 'Primo commit'),
].join('')
// I tag sul remoto: v1.1 uguale, exp su un altro oggetto, v1.0 mancante.
export const REMOTE_TAGS = { out: 'tag11\trefs/tags/v1.1\nother\trefs/tags/exp\n', calls: 0 }

// L'ultima voce del reflog dei branch remoti: main spostato da un fetch,
// feature da un push. L'ultimo fetch, dopo, ha visto main dov'è ora e
// feature su un commit vecchio: per main conta il fetch, per feature il push.
const REFLOG: Record<string, string> = {
  'refs/remotes/origin/main': `origin/main@{1761750000}${F}fetch origin: fast-forward\n`,
  'refs/remotes/origin/feature': `origin/feature@{1761650000}${F}update by push\n`,
}
export const FETCH_MS = 1761900000_000
const FETCH_HEAD = "c3\t\tbranch 'main' of example.com:me/r\nc1a\tnot-for-merge\tbranch 'feature' of example.com:me/r\n"

export const STATUS = ['## main...origin/main [ahead 1]', ' M src/app.ts', '?? notes.md', '!! node_modules/', ''].join('\0')
// Quello che `git status` risponde adesso: un comando del test lo cambia.
export const GIT = { status: STATUS }
// I file come sono nei commit, per `git cat-file`: `<commit>:<percorso>`.
export const COMMITTED: Record<string, string> = {}
const NUMSTAT = '3\t1\tsrc/app.ts\0'

const entry = (name: string, kind: 'dir' | 'file'): FsEntry => ({ name, kind, size: 10, mtimeMs: 1, isLink: false })
const DIRS: Record<string, FsEntry[]> = {
  '/r': [entry('src', 'dir'), entry('node_modules', 'dir'), entry('.git', 'dir'), entry('notes.md', 'file')],
  '/r/src': [entry('app.ts', 'file')],
  '/r/node_modules': [],
}

const ok = (stdout: string): { value: ProcessRunResult } => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// ~/.claude/settings.json: l'hook che blocca le scritture fuori dal progetto
// passa da hook-switch, quello di herdr no.
export const USER_SETTINGS = {
  enabledPlugins: { 'codex@openai-codex': true, 'framework@local-dir': true, 'spento@openai-codex': false },
  hooks: {
    PreToolUse: [
      {
        matcher: 'Write|Edit|NotebookEdit',
        hooks: [
          {
            type: 'command',
            command: '/home/u/.claude/hooks/hook-switch blocca-scritture-fuori-progetto /home/u/.claude/hooks/confine-writes.sh',
            timeout: 10,
            statusMessage: 'Controllo confinamento scritture',
          },
        ],
      },
    ],
    SessionStart: [{ matcher: '^(startup|resume)$', hooks: [{ type: 'command', command: "bash '/home/u/.claude/hooks/herdr-agent-state.sh' session" }] }],
  },
}

// I plugin installati: codex da GitHub, nella copia in cache, con un hook
// senza hook-switch; framework da un marketplace `directory`, che gira dalla
// cartella sorgente (la copia in cache, vecchia, non ha hook), con un hook
// che passa da hook-switch. `spento` non è abilitato.
const PLUGIN_FILES: Record<string, unknown> = {
  '/home/u/.claude/plugins/installed_plugins.json': {
    version: 2,
    plugins: {
      'codex@openai-codex': [{ scope: 'user', installPath: '/home/u/.claude/plugins/cache/openai-codex/codex/1.0.6' }],
      'framework@local-dir': [{ scope: 'user', installPath: '/home/u/.claude/plugins/cache/local-dir/framework/1.0.0' }],
      'spento@openai-codex': [{ scope: 'user', installPath: '/home/u/.claude/plugins/cache/openai-codex/spento/1.0.0' }],
    },
  },
  '/home/u/.claude/plugins/known_marketplaces.json': {
    'openai-codex': { source: { source: 'github', repo: 'openai/codex-plugin-cc' } },
    'local-dir': { source: { source: 'directory', path: '/home/u/src/framework' }, installLocation: '/home/u/src/framework' },
  },
  '/home/u/src/framework/.claude-plugin/marketplace.json': { plugins: [{ name: 'framework', source: './' }] },
  '/home/u/src/framework/hooks/hooks.json': {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            {
              type: 'command',
              command: '"${CLAUDE_PLUGIN_ROOT}/hooks/hook-switch" proteggi-scritture-del-framework python3 -I "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py"',
              timeout: 30,
            },
          ],
        },
      ],
    },
  },
  '/home/u/.claude/plugins/cache/openai-codex/codex/1.0.6/hooks/hooks.json': {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs"', timeout: 900 }] }] },
  },
  '/home/u/.claude/plugins/cache/openai-codex/spento/1.0.0/hooks/hooks.json': {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'non-deve-comparire.sh' }] }] },
  },
}

const usage = (input: number, cached: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cached,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
})

// Le variabili d'ambiente che il mod legge, e i comandi che lancia oltre a git.
export const ENV: Record<string, string> = { HOME: '/home/u' }
export const RUNS: string[][] = []

// Il contenuto dei file come lo legge $.fs.read, e le scritture in attesa che
// uno strumento applica quando gira.
export const FILES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PLUGIN_FILES).map(([path, json]) => [path, JSON.stringify(json)])),
  '/r/.git/FETCH_HEAD': FETCH_HEAD,
}
export const PENDING: Record<string, string> = {}
// Quello che fa il prossimo comando Bash, come un `sed -i`.
export const SHELL: { run?: () => void } = {}
// I comandi che non partono, come `code` dove VS Code non c'è.
export const MISSING = new Set<string>()

// I messaggi che la prossima richiesta porta, in forma API.
export const MESSAGES: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = []
// Le risposte del modello finto, passo per passo; senza, «Fatto.».
export const REPLIES: { chunks: Record<string, unknown>[]; usage: [number, number, number] }[] = []
// Il contesto per categoria che /context darebbe; senza, nessuno.
export const BREAKDOWN: { value?: Partial<SessionContextBreakdown> } = {}

// Quello che `$.model.fork` risponde, e i prompt che ha ricevuto.
export const FORK: { reply: ModelForkResult; prompts: string[] } = {
  reply: { isAnswered: true, text: '## What the context holds\nIl login.\n### Dettagli\n**Poco** da togliere.', usage: { input_tokens: 10, output_tokens: 1200, cache_read_input_tokens: 14_000, cache_creation_input_tokens: 0 } },
  prompts: [],
}

/** Lascia finire il lavoro che il mod fa fuori dal giro degli strumenti. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}

export function fakeEngine(on: On, opened: string[] = []) {
  // Le impostazioni utente, da sole o come base dell'unione di tutte.
  on('settings.read', (_, e) => {
    const source = (e as { source?: string }).source
    return { value: source === 'user' || source === undefined ? USER_SETTINGS : {} } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/r' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.messages', (_, e) => ({ value: (e as { as?: string }).as === 'api' ? [...MESSAGES] : [] }) as never)
  on('session.usage', (_, e) => {
    const breakdown = (e as { breakdown?: string }).breakdown && BREAKDOWN.value ? { breakdown: BREAKDOWN.value } : {}
    return { value: { startedAt: 0, context: { window: 200_000, ...breakdown }, rateLimits: [] } } as never
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const },
      { id: 'memory', text: '# CLAUDE.md\nRispondi in italiano.', scope: 'session' as const },
    ],
  }))
  on('tool.list', () => ({
    value: [
      { name: 'Read', description: 'Reads a file.', mcp: false },
      { name: 'mcp__docs__search', description: 'Searches the docs.', mcp: true },
    ],
  }))
  on('tool.describe', (_, e) => ({ description: e.description, ...(e.isDeferred ? { isDeferred: true } : {}) }))
  on('fs.write', (_, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    FILES[path] = text
    return { value: undefined } as never
  })
  on('model.fork', (_, e) => {
    FORK.prompts.push(e.prompt)
    return { value: FORK.reply }
  })
  on('command.register', () => ({ value: { command: 'glassbox' } }))
  on('clock.every', () => ({ value: undefined }) as never)
  on('clock.after', () => ({ value: undefined }) as never)
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', (_, e) => ({ value: DIRS[String((e as { path?: string }).path)] ?? [] }) as never)
  on('env.get', (_, e) => ({ value: ENV[e.name] }) as never)
  on('env.set', (_, e) => {
    if (e.value === undefined) delete ENV[e.name]
    else ENV[e.name] = e.value
    return { value: {} }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] !== 'git') RUNS.push([...e.argv])
    if (MISSING.has(String(e.argv[0]))) throw new Error(`${e.argv[0]}: command not found`)
    if (e.argv[0] === 'wslpath') return ok(`\\\\wsl.localhost\\Ubuntu${String(e.argv[2]).replaceAll('/', '\\')}\n`)
    if (e.argv[0] === 'uname') return ok('Linux\n')
    const args = e.argv.join(' ')
    if (args.includes('for-each-ref')) return ok(args.includes('ahead-behind') ? COUNTS : args.includes('refs/tags') ? TAGS : REFS)
    if (args.includes(' ls-remote ')) {
      REMOTE_TAGS.calls += 1
      return ok(REMOTE_TAGS.out)
    }
    if (args.includes('rev-parse --verify')) return ok('c3\n')
    if (args.includes(' reflog ')) return ok(REFLOG[String(e.argv.at(-2))] ?? '')
    if (args.includes('--git-common-dir')) return ok('/r/.git\n')
    if (args.includes('rev-parse')) return ok('/r\n')
    if (args.includes(' remote')) return ok('origin\tgit@example.com:me/r.git (fetch)\norigin\tgit@example.com:me/r.git (push)\n')
    if (args.includes(' log ')) return ok(LOG)
    if (args.includes(' status ')) return ok(GIT.status)
    if (args.includes(' cat-file ')) {
      const spec = String(e.argv.at(-1))
      if (spec in COMMITTED) return ok(COMMITTED[spec] ?? '')
      return { value: { exitCode: 128, stdout: '', stderr: `fatal: path '${spec}' does not exist`, isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (args.includes(' diff ')) return ok(NUMSTAT)
    return ok('')
  })
  on('fs.stat', (_, e) => {
    const path = String((e as { path?: string }).path)
    if (path in FILES && path !== '/r/.git/FETCH_HEAD') return { value: { kind: 'file', size: FILES[path]?.length ?? 0, mtimeMs: 1, isLink: false } } as never
    if (path !== '/r/.git/FETCH_HEAD') throw new Error(`ENOENT: ${path}`)
    return { value: { kind: 'file', size: FETCH_HEAD.length, mtimeMs: FETCH_MS } } as never
  })
  on('fs.read', (_, e) => {
    const path = String((e as { path?: string }).path)
    if (!(path in FILES)) throw new Error(`ENOENT: ${path}`)
    return { value: FILES[path] } as never
  })
  // Lo strumento scrive quello che il test ha messo in PENDING per quel file;
  // un comando Bash fa quello che il test ha messo in SHELL.
  on('tool.call', async (_, e) => {
    if (e.tool === 'Bash') {
      const run = SHELL.run
      delete SHELL.run
      run?.()
    }
    const path = (e as { file_path?: string }).file_path
    if (path !== undefined && path in PENDING) {
      FILES[path] = PENDING[path] ?? ''
      delete PENDING[path]
    }
    return { result: 'contenuto', text: 'contenuto' } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    const reply = REPLIES.shift()
    if (!reply) {
      yield { kind: 'text' as const, index: 0, text: 'Fatto.' }
      return { turnId: e.turnId, index: e.index, answer: 'Fatto.', toolUses: [], stopReason: 'end_turn' as const, usage: usage(500, 14_000, 40) }
    }
    for (const c of reply.chunks) yield c as never
    const answer = reply.chunks.map(c => (c.kind === 'text' ? String(c.text) : '')).join('')
    const isTool = reply.chunks.some(c => c.kind === 'tool')
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: isTool ? ('tool_use' as const) : ('end_turn' as const), usage: usage(...reply.usage) }
  })
}

export const PANE = {
  plugin: 'glassbox',
  component: 'Pane',
  requestId: 'glassbox',
  props: {
    title: 'Barra',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Il repo si legge dopo l'avvio, fuori dal suo giro: /glassbox aspetta quella lettura.
export async function start($: Engine) {
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'glassbox', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
}

export async function oneTurn($: Engine) {
  await $.turn.start({ text: 'sistema il login', turnId: 't1' })
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for (;;) if ((await s.next()).done) break
  await $.turn.complete({ answer: 'Fatto.', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer' })
}
