// I turni della sessione, raccolti dagli stessi hook di turn-inspector
// (claude-code-templates, hooks/turn-inspector.tsx): ogni richiesta al modello
// è un turno, con il suo input e il suo output. Gli hook osservano soltanto:
// ogni evento passa avanti com'è.
import type { EngineInterface, On, SessionContextBreakdown, ToolCallInput, ToolCallResult } from 'claude-code'

import { outputOf, pruneContext, recordChunk, recordSent, registerContext, resetContext, sentMessages, toolsSeen } from './context'
import type { ApiMessage } from './context'
import { endRecord, recordRequest, recordTurn } from './record'
import { chunk, createLedger, promptStarted, stepEnded, stepStarted, systemTokens, toolAnswered } from './vendor/turns'
import type { Ledger, Turn } from './vendor/turns'
import type { AgentUse, Seen, Tab } from './stats'
import { redraw } from './ui'

const KEEP = 200
const COLUMNS = 60

export const turns = {
  ledger: createLedger() as Ledger,
  live: undefined as Turn | undefined,
  expanded: new Set<number>(),
  // Segue l'ultimo turno: la sezione resta in fondo finché non la scorri su.
  follow: true,
  // La tendina delle statistiche in cima alla sezione, e la sua vista.
  showStats: false,
  statsTab: 'health' as Tab,
  // Il contesto per categoria come lo divide /context, dopo l'ultimo turno.
  breakdown: undefined as SessionContextBreakdown | undefined,
  // Le chiamate agli strumenti della sessione, riuscite e fallite.
  calls: new Map<string, { count: number; failed: number }>(),
  // Le richieste dei subagent, per agente: il loro contesto resta fuori da questo.
  agents: new Map<string, AgentUse>(),
  // Gli skill caricati nella sessione.
  skills: new Set<string>(),
}

const safeJson = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : (JSON.stringify(v) ?? '')
  } catch {
    return ''
  }
}

/** L'ultima richiesta con la risposta arrivata. */
export const lastDone = (): Turn | undefined => [...turns.ledger.turns].reverse().find(t => t.input !== undefined)

/** Quello che la tendina sa oltre al registro: i messaggi dell'ultima richiesta vista partire, i subagent, gli skill. */
export function seenNow(): Seen {
  const last = lastDone()
  const messages = last ? sentMessages(last.n) : undefined
  return { ...(last && messages ? { sent: { n: last.n, messages } } : {}), agents: turns.agents, skills: turns.skills }
}

/** All'avvio della sessione: un registro vuoto e la finestra di contesto. */
export async function startTurns($: EngineInterface): Promise<void> {
  turns.ledger = createLedger()
  turns.live = undefined
  turns.expanded.clear()
  turns.follow = true
  turns.breakdown = undefined
  turns.calls.clear()
  turns.agents.clear()
  turns.skills.clear()
  resetContext()
  const usage = await $.session.usage().catch(() => undefined)
  if (usage) turns.ledger.window = usage.context.window
  // il primo turno di una sessione nuova misura quello che ogni richiesta porta con sé
  turns.ledger.isFresh = (await $.session.messages().catch(() => [1])).length === 0
}

/** La risposta di uno strumento è input nuovo per la richiesta dopo. */
export const toolDone = (e: ToolCallInput, r: ToolCallResult): void => {
  if (e.agentId !== undefined) return
  const text = r.deny ?? r.text ?? (r.result === undefined ? '' : safeJson(r.result))
  const isFailed = r.deny !== undefined || r.isError === true
  toolAnswered(turns.ledger, e.tool, text.length, isFailed)
  const c = turns.calls.get(e.tool) ?? { count: 0, failed: 0 }
  turns.calls.set(e.tool, { count: c.count + 1, failed: c.failed + (isFailed ? 1 : 0) })
  const skill = (e as unknown as { skill?: unknown }).skill
  if (e.tool === 'Skill' && typeof skill === 'string' && !isFailed) turns.skills.add(skill.replace(/^\//, ''))
}

type StepUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** Una richiesta di un subagent: quanto ha mandato e quanto ha risposto, nel suo contesto. */
export function agentStep(id: string, usage: StepUsage | null | undefined): void {
  if (!usage) return
  const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const a = turns.agents.get(id) ?? { requests: 0, peak: 0, input: 0, output: 0 }
  turns.agents.set(id, { requests: a.requests + 1, peak: Math.max(a.peak, input + usage.output_tokens), input: a.input + input, output: a.output + usage.output_tokens })
}

export const registerTurns = (on: On): void => {
  registerContext(on)

  on('turn.start', async ($, e, next) => {
    promptStarted(turns.ledger, e.turnId, e.text)
    return next(e)
  })

  // ogni richiesta del ciclo principale è un turno; il suo flusso dà i blocchi di output
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      const r = yield* next(e)
      agentStep(e.agentId, r.usage)
      return r
    }
    const turn = stepStarted(turns.ledger, e.turnId, e.index, e.model, KEEP)
    turns.live = turn
    pruneContext(turns.ledger.turns[0]?.n ?? turn.n)
    // I messaggi che la richiesta porta, letti mentre parte: la lettura non la
    // ritarda, e quelli in più (la risposta, se arriva prima) restano fuori.
    const sent: Promise<readonly ApiMessage[] | undefined> = $.session
      .messages({ as: 'api' })
      .then(m => {
        const list = e.messageCount > 0 && m.length > e.messageCount ? m.slice(0, e.messageCount) : m
        recordSent(turn.n, list)
        return list
      })
      .catch(() => undefined)
    redraw($)
    const names = new Map<number, string>()
    const stream = next(e)
    for await (const c of stream) {
      recordChunk(turn.n, c)
      let isNew = false
      if (c.kind === 'thinking') isNew = chunk(turn, c.index, 'thinking', c.text)
      else if (c.kind === 'text') isNew = chunk(turn, c.index, 'text', c.text)
      else if (c.kind === 'tool') {
        names.set(c.index, c.name)
        isNew = chunk(turn, c.index, 'tool_use', c.name, c.name)
      } else if (c.kind === 'input') isNew = chunk(turn, c.index, 'tool_use', c.json, names.get(c.index))
      if (isNew) redraw($)
      yield c
    }
    const r = await stream.result
    stepEnded(turns.ledger, turn, r.usage, r.stopReason)
    if (turns.live === turn) turns.live = undefined
    redraw($)
    // Su disco, fuori dal giro: la richiesta con il contesto che ha portato.
    void recordRequest(
      $,
      {
        n: turn.n,
        turnId: turn.turnId,
        step: turn.step,
        prompt: turn.prompt,
        model: e.model,
        effort: e.effort,
        stopReason: r.stopReason,
        usage: r.usage,
        isCompacted: turn.isCompacted,
        window: turns.ledger.window,
        messages: sent,
        output: outputOf(turn.n),
      },
      toolsSeen(),
    )
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const usage = await $.session.usage({ breakdown: 'summary', columns: COLUMNS }).catch(() => undefined)
      const system = systemTokens(usage?.context.breakdown?.categories ?? [])
      if (system !== undefined) turns.ledger.system = system
      if (usage?.context.breakdown) turns.breakdown = usage.context.breakdown
      redraw($)
      void recordTurn($, { breakdown: usage?.context.breakdown, calls: turns.calls, agents: turns.agents })
    }
    return r
  })

  // La fine della sessione, o un /clear, chiude il suo registro.
  on('session.end', async ($, e, next) => {
    await endRecord($, e.sessionId, e.reason).catch(() => undefined)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if (e.context.window !== turns.ledger.window) {
      turns.ledger.window = e.context.window
      redraw($)
    }
    return r
  })
}
