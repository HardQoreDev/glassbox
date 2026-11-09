import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CACHE_TTL_MS, cacheOf, counts, dueWarnings, ordered, readSessions, span, tokens } from '../hooks/sessions'
import type { Session } from '../hooks/sessions'

import { HERDR_FOCUS, PANE, SESSIONS, STATUS_LINES, fakeEngine, sessionsOut, settle, start } from './engine'

const NOW = 1_800_000_000_000
const MIN = 60_000
const s = (id: string, over: Partial<Session> = {}): Session => ({ id, name: id, cwd: `/p/${id}`, status: 'idle', isCompacted: false, ...over })

// Un pannello alto, perché la sezione abbia posto per tutte le sessioni.
const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 90 } } }

const toastsOf = (on: On): string[] => {
  const out: string[] = []
  on('ui.toast', (_, e) => {
    out.push(e.text)
    return { value: undefined } as never
  })
  return out
}

describe('la sezione SESSIONS', () => {
  test('legge lo script: tiene le voci con un id, il pane e il titolo di herdr, riporta il suo errore', () => {
    const r = readSessions(
      JSON.stringify({
        herdr: '/usr/bin/herdr',
        sessions: [
          { id: 'a', name: 'alfa', cwd: '/a', status: 'busy', lastMs: 5, ctx: 9, compacted: false, pane: 'w3:p8', title: 'Migrazione' },
          { name: 'senza id' },
          { id: 'b', compacted: true, pane: 'w1:p1; rm -rf /' },
        ],
        error: 'registro illeggibile',
      }),
    )
    expect(r.list).toEqual([
      { id: 'a', name: 'alfa', cwd: '/a', status: 'busy', lastMs: 5, ctx: 9, isCompacted: false, pane: 'w3:p8', title: 'Migrazione' },
      // Un pane che non ha la forma di un pane non arriva a herdr.
      { id: 'b', name: 'b', cwd: '', status: '', lastMs: undefined, ctx: undefined, isCompacted: true },
    ])
    expect(r.error).toBe('registro illeggibile')
    expect(r.herdr).toBe('/usr/bin/herdr')
    expect(readSessions('non json').error).toMatch(/unreadable/)
  })

  test('la cache: lavora, calda con il tempo che resta, fredda, compattata, senza dati', () => {
    expect(cacheOf(s('a', { status: 'busy', lastMs: NOW - 2 * CACHE_TTL_MS }), NOW)).toEqual({ kind: 'busy' })
    expect(cacheOf(s('a', { lastMs: NOW - 20 * MIN }), NOW)).toEqual({ kind: 'warm', leftMs: 40 * MIN })
    expect(cacheOf(s('a', { lastMs: NOW - 90 * MIN }), NOW)).toEqual({ kind: 'cold', sinceMs: 30 * MIN })
    expect(cacheOf(s('a', { lastMs: NOW, isCompacted: true }), NOW)).toEqual({ kind: 'compacted' })
    expect(cacheOf(s('a'), NOW)).toEqual({ kind: 'unknown' })
  })

  test('in ordine: questa, chi lavora, le calde dalla scadenza più vicina, le fredde dalla più pesante', () => {
    const list = [
      s('freddaLeggera', { lastMs: NOW - 5 * CACHE_TTL_MS, ctx: 10_000 }),
      s('caldaTardi', { lastMs: NOW - 5 * MIN }),
      s('io', { lastMs: NOW - 2 * CACHE_TTL_MS }),
      s('freddaPesante', { lastMs: NOW - 5 * CACHE_TTL_MS, ctx: 600_000 }),
      s('caldaPresto', { lastMs: NOW - 50 * MIN }),
      s('lavora', { status: 'busy' }),
      s('nessuno'),
      s('aspetta', { status: 'waiting', lastMs: NOW - 5 * CACHE_TTL_MS }),
    ]
    expect(ordered(list, NOW, 'io').map(x => x.id)).toEqual(['io', 'lavora', 'aspetta', 'caldaPresto', 'caldaTardi', 'freddaPesante', 'freddaLeggera', 'nessuno'])
  })

  test('i conti accanto al titolo: aperte, chi aspetta te, calde (chi lavora compreso), pesanti da ricaricare', () => {
    const list = [
      s('a', { status: 'busy' }),
      s('b', { lastMs: NOW - MIN }),
      s('c', { lastMs: NOW - 2 * CACHE_TTL_MS, ctx: 400_000 }),
      s('d', { lastMs: NOW - 2 * CACHE_TTL_MS, ctx: 1_000 }),
      s('e', { status: 'waiting', lastMs: NOW - MIN }),
    ]
    expect(counts(list, NOW)).toEqual({ open: 5, waiting: 1, warm: 3, reload: 1 })
  })

  test('gli avvisi: cache pesanti e ferme a cinque minuti dalla scadenza, una volta per scadenza', () => {
    const given = new Set<string>()
    const list = [
      s('io', { name: 'qui', lastMs: NOW - 56 * MIN, ctx: 312_000 }),
      s('altra', { name: 'docs-7e', lastMs: NOW - 57 * MIN, ctx: 220_000 }),
      s('leggera', { lastMs: NOW - 57 * MIN, ctx: 20_000 }),
      s('lontana', { lastMs: NOW - 30 * MIN, ctx: 900_000 }),
      s('lavora', { status: 'busy', lastMs: NOW - 58 * MIN, ctx: 900_000 }),
      s('scaduta', { lastMs: NOW - 61 * MIN, ctx: 900_000 }),
    ]
    expect(dueWarnings(list, NOW, 'io', given)).toBe(
      "This session's cache expires in 4 min (312k): /compact now if you are stepping away. Cache expiring: docs-7e 3m (220k).",
    )
    expect(dueWarnings(list, NOW + MIN, 'io', given)).toBeUndefined()
    // Una nuova richiesta è una nuova scadenza: quando torna vicina, un nuovo avviso.
    const again = list.map(x => (x.id === 'io' ? { ...x, lastMs: NOW + 5 * MIN } : x))
    expect(dueWarnings(again, NOW + 61 * MIN, 'io', given)).toMatch(/^This session's cache expires in 4 min/)
  })

  test('numeri e durate a grana grossa', () => {
    expect([tokens(undefined), tokens(999), tokens(312_400), tokens(999_600), tokens(1_234_000)]).toEqual(['', '1k', '312k', '1.0M', '1.2M'])
    expect([span(30_000), span(40 * MIN), span(14 * 60 * MIN), span(7 * 24 * 60 * MIN)]).toEqual(['1m', '40m', '14h', '7d'])
  })

  test('nel pannello: le sessioni in ordine, questa segnata in cima, i dettagli al clic, l’avviso', async ($, on) => {
    const toasts = toastsOf(on)
    const saved = SESSIONS.out
    // docs-soon a 4 minuti dalla scadenza: questa volta l'avviso parte.
    SESSIONS.out = sessionsOut(Date.now(), 56)
    STATUS_LINES.length = 0
    fakeEngine(on, [])
    await start($)
    await settle()
    SESSIONS.out = saved
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })

    expect(await ui.find({ key: 'section:sessions' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5 open/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 warm/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 to reload/ })).toBeDefined()
    for (const id of ['s1', 'busy1', 'soon1', 'cold1', 'cold2']) expect(await ui.find({ key: `session:${id}` })).toBeDefined()
    // Il titolo del terminale in herdr al posto del nome; fuori da herdr, il nome del registro.
    // Questa ha «this» prima del titolo, così un titolo lungo non lo taglia.
    expect(await ui.find({ type: 'Text', text: /^● this · Fixing the login$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Docs migration/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /reload · idle 2d/ })).toBeDefined()

    // book-old non è in herdr: il clic sul nome apre i dettagli.
    await ui.press({ key: 'session:cold1' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /rewrites 605k into the cache/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /claude --resume cold1/ })).toBeDefined()
    expect(HERDR_FOCUS).toEqual([])

    // L'avviso nomina quella che sta per scadere. Sotto il prompt Glassbox non tiene
    // niente: toglie solo la riga che una versione precedente ci aveva lasciato.
    expect(toasts).toEqual(['Cache expiring: Docs release 4m (220k).'])
    expect(STATUS_LINES).toEqual([undefined])
    await ui.unmount()
  })

  test('questa resta in cima quando la sezione scorre', async ($, on) => {
    fakeEngine(on, [])
    await start($)
    await settle()
    // Un pannello basso, con solo SESSIONS aperta: quattro righe per cinque sessioni.
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 10 } } })
    for (const id of ['hooks', 'graph', 'files', 'turns']) await ui.press({ key: `section:${id}` })
    await ui.redraw()
    expect(await ui.find({ key: 'session:busy1' })).toBeDefined()
    expect(await ui.find({ key: 'session:cold2' })).toBeUndefined()

    await $.ui.scroll({ component: 'Pane', requestId: 'glassbox', offset: 0, by: 1, bodyRows: 10, contentRows: 10, origin: { kind: 'person' } })
    await ui.redraw()
    // Scorre il resto: busy1 esce, cold2 entra; questa resta lì.
    expect(await ui.find({ key: 'session:s1' })).toBeDefined()
    expect(await ui.find({ key: 'session:busy1' })).toBeUndefined()
    expect(await ui.find({ key: 'session:cold2' })).toBeDefined()
    await ui.unmount()
  })

  test('un clic sul nome porta herdr sul pane della sessione; ▸ apre i dettagli', async ($, on) => {
    const toasts = toastsOf(on)
    HERDR_FOCUS.length = 0
    fakeEngine(on, [])
    await start($)
    await settle()
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })

    await ui.press({ key: 'session:busy1' })
    await settle()
    expect(HERDR_FOCUS).toEqual(['w2:p1'])
    expect(toasts).toEqual([])
    // Nessun dettaglio aperto: il clic ha solo spostato herdr.
    expect(await ui.find({ type: 'Text', text: /claude --resume busy1/ })).toBeUndefined()

    // herdr non trova più il pane: lo dice un avviso.
    await ui.press({ key: 'session:soon1' })
    await settle()
    expect(HERDR_FOCUS).toEqual(['w2:p1', 'w9:p9'])
    expect(toasts).toEqual(['Docs release: not opened in herdr: agent target w9:p9 not found'])

    // Questa sessione: il clic apre i dettagli, herdr resta dov'è.
    await ui.press({ key: 'session:s1' })
    await ui.redraw()
    expect(HERDR_FOCUS).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: /claude --resume s1/ })).toBeDefined()

    // ▸ apre i dettagli di un'altra, con il nome del registro e il pane.
    await ui.press({ key: 'session-more:busy1' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /docs-busy · \/d · herdr w2:p1/ })).toBeDefined()
    expect(HERDR_FOCUS).toHaveLength(2)
    await ui.unmount()
  })

  test('senza python3 la sezione lo dice, e il resto del pannello funziona', async ($, on) => {
    const saved = SESSIONS.out
    SESSIONS.out = '{"sessions": [], "error": "registry not readable"}'
    try {
      fakeEngine(on, [])
      await start($)
      await settle()
      const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
      expect(await ui.find({ type: 'Text', text: /not read/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /registry not readable/ })).toBeDefined()
      expect(await ui.find({ key: 'section:files' })).toBeDefined()
      await ui.unmount()
    } finally {
      SESSIONS.out = saved
    }
  })
})
