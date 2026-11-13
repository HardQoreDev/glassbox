// Il motore di Claude Code che Glassbox si aspetta, rifatto sopra pi e Node.
//
// Glassbox parla con il suo agente in due modi: registra hook con
// `on(evento, hook)` e chiama `$.cosa.verbo(...)`. Qui `on` li raccoglie,
// `raise` li fa girare quando extension.ts traduce un evento di pi, e `$`
// risponde con il filesystem, i processi e i timer di Node, e con pi per il
// modello, la sessione e il pannello. C'è solo quello che Glassbox usa.
import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { elements } from './jsx.ts'

type Hook = (...args: any[]) => any
type Timer = { cancel: () => void }

/** Quello che extension.ts sa e il motore no: pi, la sessione, il pannello. */
export type Deps = {
  root: string
  storePath: string
  sessionId: () => string
  cwd: () => string
  window: () => number | undefined
  /** I messaggi della sessione come li legge `cp`: chi ha parlato e cosa ha detto. */
  chat: () => { role: 'user' | 'assistant'; text: string; toolUses: never[]; toolResults?: unknown[] }[]
  /** I messaggi dell'ultima richiesta, in forma API. */
  sent: () => unknown[]
  system: () => string
  tools: () => { name: string; description: string; mcp: boolean }[]
  complete: (request: { model?: string; system?: string; prompt: string; maxTokens?: number; timeoutMs?: number }) => Promise<unknown>
  fork: (request: { prompt: string }) => Promise<unknown>
  toast: (text: string) => void
  log: (text: string) => void
  invalidate: () => void
  open: (pane: { focus?: boolean }) => Promise<unknown>
  close: () => Promise<void>
  focus: (key: string) => Promise<unknown>
  /** Le sessioni aperte, come le darebbe bin/sessions.py. */
  sessions: () => string
}

export type Engine = ReturnType<typeof createEngine>

export function createEngine(deps: Deps) {
  const hooks = new Map<string, Hook[]>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  const children = new Set<ChildProcess>()

  /** `on(evento, hook)` o `on(evento, filtro, hook)`: il filtro qui non serve, ogni evento ha un solo pannello. */
  const on = (event: string, a: unknown, b?: unknown) => {
    const hook = (typeof a === 'function' ? a : b) as Hook
    const list = hooks.get(event) ?? []
    list.push(hook)
    hooks.set(event, list)
    return { catch: () => undefined }
  }

  /** Fa girare gli hook di un evento; `bottom` è quello che il motore farebbe da solo. */
  const raise = (event: string, e: unknown, bottom: (e: any) => any): any => {
    const list = hooks.get(event) ?? []
    const run = (i: number) => (ev: unknown) => (i < list.length ? list[i]!($, ev, run(i + 1)) : bottom(ev))
    return run(0)(e)
  }

  const run = (argv: readonly string[], options: { timeoutMs?: number; env?: Record<string, string>; cwd?: string } = {}) => {
    // Le sessioni aperte: in Claude Code le legge uno script Python dal suo registro, qui le sa extension.ts.
    if (argv[0] === 'python3' && String(argv[2] ?? '').endsWith('/bin/sessions.py')) {
      return Promise.resolve({ exitCode: 0, stdout: argv[3] === '--warm' ? '' : deps.sessions(), stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
    }
    return new Promise((resolve, reject) => {
      execFile(
        argv[0]!,
        argv.slice(1),
        { timeout: options.timeoutMs ?? 30_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', cwd: options.cwd ?? deps.cwd(), env: { ...process.env, ...options.env } },
        (err, stdout, stderr) => {
          const code = (err as { code?: unknown } | null)?.code
          if (err && typeof code !== 'number') reject(err)
          else resolve({ exitCode: typeof code === 'number' ? code : 0, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })
        },
      )
    })
  }

  // Un processo che resta vivo: i suoi pezzi di output uno alla volta, e l'esito alla fine.
  const spawnStream = ({ argv }: { argv: readonly string[] }) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], cwd: deps.cwd() })
    children.add(child)
    const queue: { stream: 'stdout' | 'stderr'; text: string }[] = []
    let wake: (() => void) | undefined
    let ended = false
    let failure: Error | undefined
    const push = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      queue.push({ stream, text: data.toString('utf8') })
      wake?.()
    }
    child.stdout!.on('data', push('stdout'))
    child.stderr!.on('data', push('stderr'))
    const result = new Promise<{ code: number }>(resolve => {
      const end = (code: number) => {
        ended = true
        children.delete(child)
        wake?.()
        resolve({ code })
      }
      child.on('error', err => {
        failure = err
        end(127)
      })
      child.on('close', code => end(code ?? 1))
    })
    const it = {
      result,
      [Symbol.asyncIterator]: () => it,
      async next(): Promise<IteratorResult<{ stream: 'stdout' | 'stderr'; text: string }>> {
        for (;;) {
          const chunk = queue.shift()
          if (chunk) return { done: false, value: chunk }
          if (failure) throw failure
          if (ended) return { done: true, value: undefined }
          await new Promise<void>(r => (wake = r))
          wake = undefined
        }
      },
      async return() {
        child.kill()
        return { done: true as const, value: undefined }
      },
    }
    return it
  }

  const kindOf = (s: { isDirectory(): boolean; isFile(): boolean }) => (s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other')
  const statOf = async (path: string) => {
    const link = await lstat(path)
    const real = link.isSymbolicLink() ? await stat(path).catch(() => link) : link
    return { kind: kindOf(real), size: real.size, mtimeMs: real.mtimeMs, isLink: link.isSymbolicLink() }
  }

  const readStore = async (): Promise<Record<string, unknown>> => {
    try {
      return JSON.parse(await readFile(deps.storePath, 'utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  const timer = (id: ReturnType<typeof setInterval>): Timer => {
    // Un timer di Glassbox non tiene vivo pi quando ha finito.
    id.unref?.()
    timers.add(id)
    return {
      cancel: () => {
        clearInterval(id)
        timers.delete(id)
      },
    }
  }

  const $: any = {
    plugin: { root: deps.root },
    process: { run, spawn: spawnStream },
    fs: {
      read: (path: string) => readFile(path, 'utf8'),
      write: async (path: string, text: string) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text)
      },
      list: async (dir: string) => {
        const names = await readdir(dir)
        const out = await Promise.all(names.map(name => statOf(join(dir, name)).then(s => ({ name, ...s })).catch(() => undefined)))
        return out.filter(Boolean)
      },
      stat: statOf,
    },
    env: {
      get: async (name: string) => process.env[name],
      set: async (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
        return {}
      },
    },
    clock: {
      every: (ms: number, fn: () => void) => timer(setInterval(fn, ms)),
      after: (ms: number, fn: () => void) => timer(setTimeout(fn, ms)),
    },
    store: {
      get: async (key: string) => (await readStore())[key],
      set: async (key: string, value: unknown) => {
        const all = await readStore()
        all[key] = value
        await mkdir(dirname(deps.storePath), { recursive: true })
        await writeFile(deps.storePath, JSON.stringify(all, null, 1))
      },
    },
    session: {
      id: async () => deps.sessionId(),
      root: async () => deps.cwd(),
      cwd: async () => deps.cwd(),
      messages: async (options?: { as?: string }) => (options?.as === 'api' ? deps.sent() : deps.chat()),
      usage: async () => {
        const window = deps.window()
        if (window === undefined) throw new Error('no model yet')
        return { startedAt: 0, context: { window }, rateLimits: [] }
      },
    },
    model: { complete: deps.complete, fork: deps.fork },
    prompt: { compose: async () => ({ sections: [{ id: 'system', text: deps.system(), scope: 'session' }] }) },
    tool: { list: async () => deps.tools() },
    // In pi non ci sono impostazioni con gli hook da leggere.
    settings: { read: async () => ({}) },
    command: { register: async () => ({}) },
    ui: {
      resolve: () => elements,
      invalidate: () => deps.invalidate(),
      toast: (text: string) => deps.toast(text),
      log: (text: string) => deps.log(text),
      status: () => undefined,
      open: (pane: { focus?: boolean }) => deps.open(pane),
      close: () => deps.close(),
      focus: ({ key }: { key: string }) => deps.focus(key),
    },
  }

  /** Alla fine della sessione: niente timer né processi lasciati indietro. */
  const dispose = () => {
    for (const id of timers) clearInterval(id)
    timers.clear()
    for (const child of children) child.kill()
    children.clear()
  }

  return { $, on, raise, dispose }
}
