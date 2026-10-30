// I turni della sessione, raccolti dagli stessi hook di turn-inspector
// (claude-code-templates, hooks/turn-inspector.tsx): ogni richiesta al modello
// è un turno, con il suo input e il suo output. Gli hook osservano soltanto:
// ogni evento passa avanti com'è.
import type { EngineInterface, On, ToolCallInput, ToolCallResult } from 'claude-code'

import { chunk, createLedger, promptStarted, stepEnded, stepStarted, systemTokens, toolAnswered } from './vendor/turns'
import type { Ledger, Turn } from './vendor/turns'
import { redraw } from './ui'

const KEEP = 200
const COLUMNS = 60

export const turns = {
  ledger: createLedger() as Ledger,
  live: undefined as Turn | undefined,
  expanded: new Set<number>(),
  // Segue l'ultimo turno: la sezione resta in fondo finché non la scorri su.
  follow: true,
}

const safeJson = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : (JSON.stringify(v) ?? '')
  } catch {
    return ''
  }
}

/** All'avvio della sessione: un registro vuoto e la finestra di contesto. */
export async function startTurns($: EngineInterface): Promise<void> {
  turns.ledger = createLedger()
  turns.live = undefined
  turns.expanded.clear()
  turns.follow = true
  const usage = await $.session.usage().catch(() => undefined)
  if (usage) turns.ledger.window = usage.context.window
  // il primo turno di una sessione nuova misura quello che ogni richiesta porta con sé
  turns.ledger.isFresh = (await $.session.messages().catch(() => [1])).length === 0
}

/** La risposta di uno strumento è input nuovo per la richiesta dopo. */
export const toolDone = (e: ToolCallInput, r: ToolCallResult): void => {
  if (e.agentId !== undefined) return
  const text = r.deny ?? r.text ?? (r.result === undefined ? '' : safeJson(r.result))
  toolAnswered(turns.ledger, e.tool, text.length, r.deny !== undefined || r.isError === true)
}

export const registerTurns = (on: On): void => {
  on('turn.start', async ($, e, next) => {
    promptStarted(turns.ledger, e.turnId, e.text)
    return next(e)
  })

  // ogni richiesta del ciclo principale è un turno; il suo flusso dà i blocchi di output
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const turn = stepStarted(turns.ledger, e.turnId, e.index, e.model, KEEP)
    turns.live = turn
    redraw($)
    const names = new Map<number, string>()
    const stream = next(e)
    for await (const c of stream) {
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
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const usage = await $.session.usage({ breakdown: 'summary', columns: COLUMNS }).catch(() => undefined)
      const system = systemTokens(usage?.context.breakdown?.categories ?? [])
      if (system !== undefined) turns.ledger.system = system
      redraw($)
    }
    return r
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
