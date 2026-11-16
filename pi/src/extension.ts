// Glassbox in pi. Glassbox è un mod di Claude Code (mods/glassbox): qui lo
// stesso codice gira dentro pi, senza una seconda copia da tenere allineata.
// Questo file traduce gli eventi di pi in quelli che Glassbox ascolta (la
// sessione, ogni richiesta al modello, ogni strumento) e monta il suo pannello
// a destra; engine.ts gli dà il resto del motore, panel.ts lo disegna.
//
// Il codice di Glassbox arriva da pi/dist/hooks, compilato da pi/build.sh: pi
// non carica JSX.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCurrentSystemPrompt } from '@earendil-works/pi-ai'
import { buildSessionContext, convertToLlm, getAgentDir, getSelectListTheme } from '@earendil-works/pi-coding-agent'
import { HStack, isViewportTUI } from '@earendil-works/pi-tui'

import { host } from '../dist/hooks/host.js'
import { register } from '../dist/hooks/register.js'
import { createEngine } from './engine.ts'
import type { Engine } from './engine.ts'
import { Panel } from './panel.ts'
import { createRegistry } from './registry.ts'
import type { Running } from './registry.ts'

const PANE = 'glassbox'
// Le colonne del pannello, più il bordo; sotto questa larghezza del terminale non si mostra.
const COLUMNS = 65
const MIN_TERMINAL = 110
const SHORTCUT = 'alt+g'

// I nomi degli strumenti come Glassbox li conosce da Claude Code.
const TOOLS: Record<string, string> = { read: 'Read', edit: 'Edit', write: 'Write', bash: 'Bash', grep: 'Grep', find: 'Glob', ls: 'LS' }
const toolName = (name: string): string => TOOLS[name] ?? name

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
      : ''

// Un messaggio di pi nella forma dell'API di Anthropic, quella che Glassbox legge.
function apiMessage(m: any): { role: 'user' | 'assistant'; content: Record<string, unknown>[] } | undefined {
  if (!m || m.role === 'system') return undefined
  if (m.role === 'assistant') {
    const content = (Array.isArray(m.content) ? m.content : []).map((b: any) =>
      b.type === 'thinking'
        ? { type: 'thinking', thinking: String(b.thinking ?? '') }
        : b.type === 'toolCall'
          ? { type: 'tool_use', id: String(b.id ?? ''), name: toolName(String(b.name ?? '')), input: b.arguments ?? {} }
          : { type: 'text', text: String(b.text ?? '') },
    )
    return { role: 'assistant', content }
  }
  if (m.role === 'toolResult') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: String(m.toolCallId ?? ''), content: textOf(m.content), ...(m.isError ? { is_error: true } : {}) }] }
  }
  // user, e i messaggi che pi manda come user: riassunti, messaggi delle estensioni.
  const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.summary ?? '') }]
  return { role: 'user', content: blocks.map((b: any) => (b?.type === 'text' ? { type: 'text', text: String(b.text ?? '') } : { type: String(b?.type ?? 'text'), text: '' })) }
}

const usageOf = (u: any) => ({
  input_tokens: Number(u?.input ?? 0),
  output_tokens: Number(u?.output ?? 0),
  cache_read_input_tokens: Number(u?.cacheRead ?? 0),
  cache_creation_input_tokens: Number(u?.cacheWrite ?? 0),
})

// La risposta di una richiesta come la vede `turn.step`: i pezzi uno alla volta, poi l'esito.
function stepStream() {
  const queue: unknown[] = []
  let wake: (() => void) | undefined
  let isEnded = false
  let settle: (r: unknown) => void = () => undefined
  const result = new Promise<unknown>(r => (settle = r))
  const stream = (async function* () {
    for (;;) {
      while (queue.length > 0) yield queue.shift()
      if (isEnded) break
      await new Promise<void>(r => (wake = r))
    }
    return await result
  })()
  return {
    stream: Object.assign(stream, { result }),
    push(chunk: unknown) {
      queue.push(chunk)
      wake?.()
    },
    end(r: unknown) {
      isEnded = true
      settle(r)
      wake?.()
    },
  }
}

export default function glassbox(pi: any) {
  // Dove Glassbox tiene le sue cose in pi; GLASSBOX_DIR la sposta, per i test.
  const agentDir = process.env.GLASSBOX_DIR || join(getAgentDir(), 'glassbox')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mods', 'glassbox')
  const registry = createRegistry(join(agentDir, 'running'))

  // Tutto quello che vale per la sessione in corso; pi ricarica il modulo a ogni sessione nuova.
  let engine: Engine | undefined
  let ctx: any
  let tui: any
  let theme: any
  let panel: Panel | undefined
  let mounted: { base?: unknown; handle?: any } | undefined
  let back: unknown
  let size: { columns: number; rows: number } | undefined
  let lastContext: any[] | undefined
  let sent: unknown[] = []
  let turn = { n: 0, id: '', index: 0, answer: '' }
  let step: ReturnType<typeof stepStream> | undefined
  const calls = new Map<string, (r: unknown) => void>()
  const running: Running = { pid: process.pid, id: '', name: '', cwd: '', status: 'idle', writes: [] }

  const log = (text: string) => {
    try {
      mkdirSync(agentDir, { recursive: true })
      appendFileSync(join(agentDir, 'debug.log'), `${new Date().toISOString()} ${text}\n`)
    } catch {
      // Niente log.
    }
  }
  const raise = (event: string, e: unknown, bottom: (e: any) => any): Promise<any> =>
    engine ? Promise.resolve().then(() => engine!.raise(event, e, bottom)) : Promise.resolve(undefined)
  const guarded = (what: string, p: Promise<unknown>) => void p.catch(err => log(`${what}: ${err instanceof Error ? (err.stack ?? err.message) : err}`))

  const beat = (change: Partial<Running> = {}) => {
    Object.assign(running, change)
    if (running.id) registry.write(running)
  }

  // ---- il pannello ---------------------------------------------------------

  let isRendering = false
  let isDirty = false
  async function rerender(): Promise<void> {
    if (!size || !panel) return
    if (isRendering) {
      isDirty = true
      return
    }
    isRendering = true
    try {
      do {
        isDirty = false
        const e = {
          surface: 'terminal',
          component: 'Pane',
          requestId: PANE,
          props: { title: 'Glassbox', isFocused: panel.focused, bodyColumns: size.columns, placement: 'dock', scroll: { offset: 0, bodyRows: size.rows }, view: {} },
        }
        panel.setTree(await raise('ui.render', e, () => undefined))
      } while (isDirty)
    } catch (err) {
      log(`render: ${err instanceof Error ? (err.stack ?? err.message) : err}`)
    } finally {
      isRendering = false
    }
  }

  const take = () => {
    if (!tui || !panel || !mounted || panel.focused) return
    back = tui.getFocusedComponent?.() ?? back
    if (mounted.handle) mounted.handle.focus()
    else tui.setFocus(panel)
    tui.requestRender()
  }
  const release = () => {
    if (!tui || !mounted) return
    if (mounted.handle) mounted.handle.unfocus(back ? { target: back } : undefined)
    else tui.setFocus(back ?? null)
    tui.requestRender()
  }

  // pi dà il suo TUI solo a chi apre un componente: se ne apre uno vuoto e lo si chiude subito.
  async function grabTui(): Promise<void> {
    if (tui) return
    await ctx.ui.custom(
      (t: unknown, th: unknown, _keys: unknown, done: (r: undefined) => void) => {
        tui = t
        theme = th
        queueMicrotask(() => done(undefined))
        return { render: () => [], invalidate: () => undefined }
      },
      { overlay: true, overlayOptions: { nonCapturing: true, anchor: 'top-right', width: 1 } },
    )
  }

  async function mount(focus: boolean): Promise<{ isPlaced: boolean; reason?: string }> {
    if (!ctx || ctx.mode !== 'tui') return { isPlaced: false, reason: 'no terminal UI' }
    await grabTui()
    if (!tui) return { isPlaced: false, reason: 'no terminal UI' }
    if (!panel) {
      panel = new Panel({
        rows: () => tui.terminal.rows,
        colorMode: () => (theme?.getColorMode?.() === '256color' ? '256color' : 'truecolor'),
        resize: (columns, rows) => {
          size = { columns, rows }
          void rerender()
        },
        scroll: (by, row) => guarded('scroll', raise('ui.scroll', { component: 'Pane', requestId: PANE, by, offset: 0, ...(row === undefined ? {} : { pointer: { row } }) }, () => ({}))),
        take,
        release,
        requestRender: () => tui.requestRender(),
        editorTheme: () => ({ borderColor: (s: string) => theme.fg('borderMuted', s), selectList: getSelectListTheme() }),
        tui: () => tui,
      })
    }
    if (!mounted) {
      const base = isViewportTUI(tui) ? (tui as any).layoutRoot : undefined
      if (base) {
        // A schermo intero il pannello sta accanto alla chat, che si stringe.
        tui.setLayoutRoot(
          new (HStack as any)([
            { component: base, basis: 0, grow: 1, shrink: 1, minSize: 40 },
            { component: panel, basis: COLUMNS, grow: 0, shrink: 0, visible: (vp: { width: number }) => vp.width >= MIN_TERMINAL },
          ]),
        )
        mounted = { base }
      } else {
        // Altrimenti le sta sopra, sul lato destro.
        mounted = {
          handle: tui.showOverlay(panel, { anchor: 'top-right', width: COLUMNS, maxHeight: '100%', nonCapturing: true, visible: (w: number) => w >= MIN_TERMINAL }),
        }
      }
      tui.requestRender()
    }
    if (focus) take()
    return { isPlaced: true }
  }

  async function unmount(): Promise<void> {
    if (!mounted || !tui) return
    if (panel?.focused) release()
    if (mounted.handle) mounted.handle.hide()
    else if (isViewportTUI(tui)) tui.setLayoutRoot(mounted.base)
    mounted = undefined
    tui.requestRender()
  }

  // ---- il modello ----------------------------------------------------------

  // Il modello piccolo per prosa e sintesi: un Haiku con le credenziali, se no quello della sessione.
  const fastModel = () => {
    const list: any[] = ctx?.modelRegistry?.getAvailable?.() ?? []
    const haiku = list.filter(m => /haiku/i.test(m.id))
    return haiku.find(m => m.provider === ctx?.model?.provider) ?? haiku[0] ?? ctx?.model
  }

  const ask = async (model: any, context: { systemPrompt?: string; messages: unknown[] }, options: { maxTokens?: number; timeoutMs?: number }) => {
    if (!model) return { isAnswered: false, reason: 'no-model' }
    const r = await ctx.modelRegistry.complete(model, context, {
      ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    })
    if (r.stopReason === 'error' || r.stopReason === 'aborted') return { isAnswered: false, reason: r.errorMessage || r.stopReason }
    return { isAnswered: true, text: textOf(r.content), usage: usageOf(r.usage) }
  }
  const question = (text: string) => ({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() })

  // ---- la sessione ---------------------------------------------------------

  const chat = () => {
    const out: { role: 'user' | 'assistant'; text: string; toolUses: never[]; toolResults?: unknown[] }[] = []
    for (const entry of ctx?.sessionManager?.getBranch?.() ?? []) {
      const m = entry?.type === 'message' ? entry.message : undefined
      if (m?.role === 'user') out.push({ role: 'user', text: textOf(m.content), toolUses: [] })
      else if (m?.role === 'assistant') out.push({ role: 'assistant', text: textOf(m.content), toolUses: [] })
      else if (m?.role === 'toolResult') out.push({ role: 'user', text: '', toolUses: [], toolResults: [{}] })
    }
    return out
  }

  async function start(): Promise<void> {
    const sm = ctx.sessionManager
    host.resume = (id: string) => `pi --session ${id}`
    host.hidden = ['hooks']
    // La versione di Glassbox in pi è quella del pacchetto (package.json), non quella del mod di Claude Code.
    try {
      host.version = String(JSON.parse(readFileSync(join(root, '..', '..', 'package.json'), 'utf8')).version ?? '')
    } catch {
      host.version = undefined
    }
    const fast = fastModel()
    host.fast = fast ? (/haiku/i.test(fast.id) ? 'Haiku' : String(fast.name ?? fast.id)) : 'The model'
    engine = createEngine({
      root,
      storePath: join(agentDir, 'store.json'),
      sessionId: () => sm.getSessionId(),
      cwd: () => ctx.cwd,
      window: () => ctx.getContextUsage?.()?.contextWindow ?? ctx.model?.contextWindow,
      chat,
      sent: () => sent,
      system: () => (lastContext ? getCurrentSystemPrompt(lastContext as never) : (ctx.getSystemPrompt?.() ?? '')),
      tools: () => (pi.getAllTools() as any[]).map(t => ({ name: toolName(t.name), description: String(t.description ?? ''), mcp: String(t.name).startsWith('mcp__') })),
      complete: r => ask(fastModel(), { ...(r.system ? { systemPrompt: r.system } : {}), messages: [question(r.prompt)] }, r),
      fork: async r => {
        // Il contesto dell'ultima richiesta, con una domanda in più: niente entra nella sessione.
        const messages = lastContext ?? buildSessionContext(sm.getEntries(), sm.getLeafId()).messages
        if (!messages.some((m: any) => m.role === 'user' || m.role === 'assistant')) return { isAnswered: false, reason: 'nothing-to-fork' }
        return ask(ctx.model, { messages: [...convertToLlm(messages as never), question(r.prompt)] }, {})
      },
      toast: text => ctx.ui.notify(text, 'info'),
      log,
      invalidate: () => void rerender(),
      open: pane => mount(pane.focus === true),
      close: unmount,
      focus: async key => {
        panel?.focusKey(key)
        return {}
      },
      sessions: () => registry.read(),
    })
    register(engine.on as never, { recordSessions: process.env.GLASSBOX_RECORD !== '0', sessionsDir: join(agentDir, 'sessions') } as never)
    beat({ id: sm.getSessionId(), name: pi.getSessionName?.() || basename(ctx.cwd), cwd: ctx.cwd, status: 'idle' })
    for (const t of pi.getAllTools() as any[]) {
      await raise('tool.describe', { tool: toolName(t.name), description: String(t.description ?? ''), isDeferred: t.exposure === 'deferred' }, e => ({ description: e.description }))
    }
    await raise('session.start', { cwd: ctx.cwd, surface: 'terminal', isInteractive: true }, e => ({ cwd: e.cwd }))
  }

  pi.on('session_start', async (_e: unknown, c: any) => {
    ctx = c
    // Il pannello vive nel terminale: in print, json e rpc Glassbox resta spento
    // (GLASSBOX_HEADLESS=1 lo accende senza pannello: lo usa pi/test.sh).
    if (c.mode !== 'tui' && process.env.GLASSBOX_HEADLESS !== '1') return
    await start().catch(err => log(`start: ${err instanceof Error ? (err.stack ?? err.message) : err}`))
  })

  pi.on('session_shutdown', async (e: any) => {
    if (!engine) return
    await raise('session.end', { sessionId: running.id, reason: e?.reason === 'quit' ? 'exit' : 'clear' }, ev => ({ sessionId: ev.sessionId })).catch(() => undefined)
    await unmount().catch(() => undefined)
    engine.dispose()
    engine = undefined
    registry.remove()
  })

  // Ogni prompt della persona è un turno.
  pi.on('before_agent_start', async (e: any, c: any) => {
    ctx = c
    turn = { n: turn.n + 1, id: `t${turn.n + 1}`, index: 0, answer: '' }
    beat({ status: 'busy', name: pi.getSessionName?.() || running.name })
    await raise('turn.start', { turnId: turn.id, text: String(e?.prompt ?? '') }, ev => ({ turnId: ev.turnId })).catch(err => log(`turn.start: ${err}`))
  })

  // Ogni richiesta al modello è un passo del turno: parte qui, con i messaggi che porta.
  pi.on('context_with_system', (e: any, c: any) => {
    ctx = c
    if (!engine) return
    step?.end({ usage: usageOf(undefined), stopReason: 'end_turn' })
    lastContext = e.messages
    sent = (e.messages as unknown[]).map(apiMessage).filter(Boolean)
    const s = stepStream()
    step = s
    const args = { turnId: turn.id || 't0', index: turn.index++, model: String(c.model?.id ?? ''), messageCount: sent.length }
    guarded(
      'turn.step',
      raise('turn.step', args, () => s.stream).then(async gen => {
        // Il passo di Glassbox è un generatore: va percorso fino in fondo.
        if (gen && typeof gen[Symbol.asyncIterator] === 'function') for await (const _ of gen) void _
      }),
    )
  })

  pi.on('message_end', async (e: any, c: any) => {
    ctx = c
    const m = e?.message
    if (!engine || m?.role !== 'assistant' || !step) return
    const s = step
    step = undefined
    ;(Array.isArray(m.content) ? m.content : []).forEach((b: any, index: number) => {
      if (b.type === 'thinking') s.push({ kind: 'thinking', index, text: String(b.thinking ?? '') })
      else if (b.type === 'toolCall') {
        s.push({ kind: 'tool', index, name: toolName(String(b.name ?? '')), id: String(b.id ?? '') })
        s.push({ kind: 'input', index, json: JSON.stringify(b.arguments ?? {}) })
      } else if (b.type === 'text') s.push({ kind: 'text', index, text: String(b.text ?? '') })
    })
    const usage = usageOf(m.usage)
    turn.answer = textOf(m.content) || turn.answer
    s.end({ usage, stopReason: m.stopReason === 'toolUse' ? 'tool_use' : m.stopReason === 'length' ? 'max_tokens' : 'end_turn' })
    beat({ lastMs: Date.now(), ctx: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens, compacted: false })
    const window = c.getContextUsage?.()?.contextWindow ?? c.model?.contextWindow
    if (window) await raise('session.measure', { context: { window } }, () => ({})).catch(() => undefined)
  })

  pi.on('agent_end', async (_e: unknown, c: any) => {
    ctx = c
    if (!engine) return
    beat({ status: 'idle' })
    await raise('turn.complete', { answer: turn.answer, turnId: turn.id, durationMs: 0, isAborted: false, reason: 'answer' }, ev => ({ text: ev.answer })).catch(err => log(`turn.complete: ${err}`))
  })

  pi.on('session_compact', () => beat({ compacted: true }))

  // Uno strumento: Glassbox guarda il file prima e dopo, quindi pi aspetta che
  // abbia finito di guardare prima di farlo partire.
  pi.on('tool_call', async (e: any, c: any) => {
    ctx = c
    if (!engine) return
    const input = (e.input ?? {}) as Record<string, unknown>
    const call = { ...input, tool: toolName(e.toolName), ...(typeof input.path === 'string' ? { file_path: input.path } : {}) }
    let reached: () => void = () => undefined
    const atNext = new Promise<void>(r => (reached = r))
    const result = new Promise(r => calls.set(e.toolCallId, r))
    const done = raise('tool.call', call, () => {
      reached()
      return result
    }).catch(err => log(`tool.call: ${err}`))
    await Promise.race([atNext, done])
  })

  const toolEnded = (id: string, r: { text: string; isError: boolean }) => {
    const settle = calls.get(id)
    if (!settle) return
    calls.delete(id)
    settle({ text: r.text, result: r.text, ...(r.isError ? { isError: true } : {}) })
  }

  pi.on('tool_result', (e: any) => {
    const path = e?.input?.path
    if (!e.isError && (e.toolName === 'edit' || e.toolName === 'write') && typeof path === 'string') {
      const abs = isAbsolute(path) ? path : join(running.cwd, path)
      beat({ writes: [...running.writes.filter(w => w[0] !== abs), [abs, Date.now()]] })
    }
    toolEnded(e.toolCallId, { text: textOf(e.content), isError: e.isError === true })
  })
  // Una chiamata bloccata non ha un risultato: finisce qui.
  pi.on('tool_execution_end', (e: any) => toolEnded(e.toolCallId, { text: '', isError: e.isError === true }))

  pi.registerCommand('glassbox', {
    description: 'Opens Glassbox on the right: git, files, what goes into the context, the open sessions, VOX and SYNTH (close, sections)',
    handler: async (args: string, c: any) => {
      ctx = c
      if (!engine) return c.ui.notify('Glassbox needs the terminal UI.', 'warning')
      const e = { command: 'glassbox', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: tui?.terminal?.columns ?? 200 } }
      const r = await raise('command.run', e, () => ({}))
      if (r?.text) c.ui.notify(`${r.text} ${SHORTCUT} moves the keyboard to the panel.`, 'info')
    },
  })

  pi.registerShortcut(SHORTCUT, {
    description: 'Glassbox: move the keyboard to the panel (Esc gives it back)',
    handler: () => {
      if (panel?.focused) release()
      else take()
    },
  })
}
