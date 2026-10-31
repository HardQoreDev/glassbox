// Il motore finto sotto il mod, condiviso dai test: un repo in /r con le sue
// cartelle, due hook nelle impostazioni utente, un modello che risponde.
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, ProcessRunResult } from 'claude-code'

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

const STATUS = ['## main...origin/main [ahead 1]', ' M src/app.ts', '?? notes.md', '!! node_modules/', ''].join('\0')
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

// Gli hook di ~/.claude/settings.json, come li ha la persona.
export const USER_SETTINGS = {
  hooks: {
    PreToolUse: [{ matcher: 'Write|Edit|NotebookEdit', hooks: [{ type: 'command', command: '/home/u/.claude/hooks/confine-writes.sh' }] }],
    SessionStart: [{ matcher: '^(startup|resume)$', hooks: [{ type: 'command', command: "bash '/home/u/.claude/hooks/herdr-agent-state.sh' session" }] }],
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
export const ENV: Record<string, string> = {}
export const RUNS: string[][] = []

// Il contenuto dei file come lo legge $.fs.read, e le scritture in attesa che
// uno strumento applica quando gira.
export const FILES: Record<string, string> = {}
export const PENDING: Record<string, string> = {}

/** Lascia finire il lavoro che il mod fa fuori dal giro degli strumenti. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}

export function fakeEngine(on: On, opened: string[] = []) {
  on('settings.read', (_, e) => ({ value: (e as { source?: string }).source === 'user' ? USER_SETTINGS : {} }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/r' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('session.messages', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }) as never)
  on('command.register', () => ({ value: { command: 'sidebar' } }))
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
  on('process.run', (_, e) => {
    if (e.argv[0] !== 'git') RUNS.push([...e.argv])
    if (e.argv[0] === 'wslpath') return ok(`\\\\wsl.localhost\\Ubuntu${String(e.argv[2]).replaceAll('/', '\\')}\n`)
    if (e.argv[0] === 'uname') return ok('Linux\n')
    const args = e.argv.join(' ')
    if (args.includes('rev-parse')) return ok('/r\n')
    if (args.includes(' remote')) return ok('origin\n')
    if (args.includes(' log ')) return ok(LOG)
    if (args.includes(' status ')) return ok(STATUS)
    if (args.includes(' diff ')) return ok(NUMSTAT)
    return ok('')
  })
  on('fs.read', (_, e) => {
    const path = String((e as { path?: string }).path)
    if (!(path in FILES)) throw new Error(`ENOENT: ${path}`)
    return { value: FILES[path] } as never
  })
  // Lo strumento scrive quello che il test ha messo in PENDING per quel file.
  on('tool.call', async (_, e) => {
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
    yield { kind: 'text' as const, index: 0, text: 'Fatto.' }
    return { turnId: e.turnId, index: e.index, answer: 'Fatto.', toolUses: [], stopReason: 'end_turn' as const, usage: usage(500, 14_000, 40) }
  })
}

export const PANE = {
  plugin: 'barra-laterale',
  component: 'Pane',
  requestId: 'barra-laterale',
  props: {
    title: 'Barra',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Il repo si legge dopo l'avvio, fuori dal suo giro: /sidebar aspetta quella lettura.
export async function start($: Engine) {
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'sidebar', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
}

export async function oneTurn($: Engine) {
  await $.turn.start({ text: 'sistema il login', turnId: 't1' })
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for (;;) if ((await s.next()).done) break
  await $.turn.complete({ answer: 'Fatto.', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer' })
}
