import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { KEEP_BEFORE_MS, PING, isDue } from '../hooks/keepwarm'
import { CACHE_TTL_MS, cacheOf, dueWarnings, readSessions } from '../hooks/sessions'
import type { Session } from '../hooks/sessions'

import { FORK, PANE, SESSIONS, WARMED, fakeEngine, sessionsOut, settle, start } from './engine'

const NOW = 1_800_000_000_000
const MIN = 60_000
const s = (id: string, over: Partial<Session> = {}): Session => ({ id, name: id, cwd: `/p/${id}`, status: 'idle', isCompacted: false, ...over })

const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 90 } } }

const toastsOf = (on: On): string[] => {
  const out: string[] = []
  on('ui.toast', (_, e) => {
    out.push(e.text)
    return { value: undefined } as never
  })
  return out
}

// Le sessioni del motore finto, con qualche campo cambiato.
const withSessions = (now: number, over: Record<string, Record<string, unknown>>): string => {
  const o = JSON.parse(sessionsOut(now)) as { sessions: { id: string }[] }
  o.sessions = o.sessions.map(x => ({ ...x, ...(over[x.id] ?? {}) }))
  return JSON.stringify(o)
}

describe('la cache tenuta calda mentre gli agenti lavorano', () => {
  test('lo script dice quanti agenti lavorano e quando la cache è stata tenuta calda', () => {
    const r = readSessions(JSON.stringify({ sessions: [{ id: 'a', agents: 2, warmMs: 7 }, { id: 'b', agents: 0, warmMs: 'ieri' }] }))
    expect([r.list[0]?.agents, r.list[0]?.warmMs]).toEqual([2, 7])
    expect([r.list[1]?.agents, r.list[1]?.warmMs]).toEqual([undefined, undefined])
  })

  test('un rinfresco conta come l’ultima richiesta', () => {
    const kept = s('a', { lastMs: NOW - 2 * CACHE_TTL_MS, warmMs: NOW - 10 * MIN })
    expect(cacheOf(kept, NOW)).toEqual({ kind: 'warm', leftMs: 50 * MIN })
    // Un rinfresco più vecchio dell'ultima richiesta non conta.
    expect(cacheOf(s('b', { lastMs: NOW - 10 * MIN, warmMs: NOW - 30 * MIN }), NOW)).toEqual({ kind: 'warm', leftMs: 50 * MIN })
  })

  test('quando rinfrescarla: agenti al lavoro e cinque minuti alla scadenza, mai a cache già fredda', () => {
    const at = (left: number, over: Partial<Session> = {}) => s('io', { agents: 1, lastMs: NOW + left - CACHE_TTL_MS, ...over })
    expect(isDue(at(4 * MIN), NOW)).toBe(true)
    expect(isDue(at(KEEP_BEFORE_MS + MIN), NOW)).toBe(false)
    // Senza agenti la sessione è ferma per scelta tua: la cache si lascia scadere.
    expect(isDue(at(4 * MIN, { agents: 0 }), NOW)).toBe(false)
    // Troppo vicino alla scadenza, o già scaduta: rinfrescarla vorrebbe dire riscriverla.
    expect(isDue(at(10_000), NOW)).toBe(false)
    expect(isDue(at(-MIN), NOW)).toBe(false)
    expect(isDue(at(4 * MIN, { isCompacted: true }), NOW)).toBe(false)
    // Anche mentre il thread principale aspetta un agente in primo piano.
    expect(isDue(at(4 * MIN, { status: 'busy' }), NOW)).toBe(true)
    // Un rinfresco recente sposta la scadenza.
    expect(isDue(at(4 * MIN, { warmMs: NOW - MIN }), NOW)).toBe(false)
    expect(isDue(undefined, NOW)).toBe(false)
  })

  test('niente avviso di scadenza per chi ha agenti al lavoro', () => {
    const list = [s('io', { lastMs: NOW - 56 * MIN, ctx: 312_000, agents: 1 }), s('altra', { name: 'docs', lastMs: NOW - 57 * MIN, ctx: 220_000, agents: 2 })]
    expect(dueWarnings(list, NOW, 'io', new Set())).toBeUndefined()
  })

  test('nel pannello: la rinfresca, lo segna per l’hook e la status line, e lo mostra', { timeoutMs: 20_000 }, async ($, on) => {
    const toasts = toastsOf(on)
    const now = Date.now()
    const saved = SESSIONS.out
    FORK.prompts.length = 0
    WARMED.length = 0
    // Questa ha un agente al lavoro e la cache a 4 minuti dalla scadenza; docs-soon anche, ma è un'altra sessione.
    SESSIONS.out = withSessions(now, { s1: { lastMs: now - 56 * MIN, ctx: 312_000, agents: 1 }, soon1: { agents: 1 } })
    try {
      fakeEngine(on, [])
      await start($)
      await settle()
      await settle()

      expect(FORK.prompts).toEqual([PING])
      expect(WARMED).toEqual(['s1'])
      // Niente avviso: la cache di questa l'ha appena rinfrescata, quella dell'altra è affar suo.
      expect(toasts).toEqual([])

      const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
      expect(await ui.find({ type: 'Text', text: /^1 agent · 60m left$/ })).toBeDefined()
      await ui.press({ key: 'session:s1' })
      await ui.redraw()
      // Il dettaglio va a capo: la prima riga dice quante volte, quando e quanto ha letto.
      expect(await ui.find({ type: 'Text', text: /Kept warm 1 time, last at \d\d:\d\d: 14k read/ })).toBeDefined()
      await ui.unmount()
    } finally {
      SESSIONS.out = saved
    }
  })

  test('senza agenti non manda niente', { timeoutMs: 20_000 }, async ($, on) => {
    const now = Date.now()
    const saved = SESSIONS.out
    FORK.prompts.length = 0
    WARMED.length = 0
    SESSIONS.out = withSessions(now, { s1: { lastMs: now - 56 * MIN, ctx: 312_000 } })
    try {
      fakeEngine(on, [])
      await start($)
      await settle()
      await settle()
      expect(FORK.prompts).toEqual([])
      expect(WARMED).toEqual([])
    } finally {
      SESSIONS.out = saved
    }
  })
})
