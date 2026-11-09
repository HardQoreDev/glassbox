import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NO_GIT_MS, candidates, dueAlerts, isPending, shownOverlaps, statusByName } from '../hooks/guard'
import type { Overlap } from '../hooks/guard'
import { readSessions } from '../hooks/sessions'
import type { Session } from '../hooks/sessions'

import { FILES, GUARD, HERDR_FOCUS, PANE, PENDING, SESSIONS, fakeEngine, sessionsOut, settle, start } from './engine'

const NOW = 1_800_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN
const s = (id: string, over: Partial<Session> = {}): Session => ({ id, name: id, cwd: `/p/${id}`, status: 'idle', isCompacted: false, ...over })

// Un pannello alto, perché FILES abbia posto per tutte le righe della guardia.
const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 90 } } }

const toastsOf = (on: On): string[] => {
  const out: string[] = []
  on('ui.toast', (_, e) => {
    out.push(e.text)
    return { value: undefined } as never
  })
  return out
}

// Le sessioni del motore finto, con i file che ognuna ha scritto.
const withWrites = (now: number, writes: Record<string, [string, number][]>): string => {
  const o = JSON.parse(sessionsOut(now)) as { sessions: { id: string; writes?: [string, number][] }[] }
  for (const x of o.sessions) if (writes[x.id]) x.writes = writes[x.id]
  return JSON.stringify(o)
}

const overlap = (path: string, others: { id: string; at: number; isPending: boolean }[]): Overlap => ({
  path,
  at: NOW - 10 * MIN,
  others,
  git: 'dirty',
  committedAt: 0,
})

describe('la guardia di FILES', () => {
  test('legge i file scritti da ogni sessione: assoluti, con un numero, l’ultima volta', () => {
    const r = readSessions(
      JSON.stringify({
        sessions: [
          { id: 'a', writes: [['/x/a.ts', 5], ['relativo.ts', 6], ['/x/b.ts', 'ieri'], 'rotto', ['/x/a.ts', 9]] },
          { id: 'b', writes: [] },
        ],
      }),
    )
    expect([...(r.list[0]?.writes ?? [])]).toEqual([['/x/a.ts', 9]])
    expect(r.list[1]?.writes).toBeUndefined()
  })

  test('i candidati: i file di questa scritti anche da un’altra, dal toccato più di recente', () => {
    const list = [
      s('io', { writes: new Map([['/r/a.ts', NOW - 10 * MIN], ['/r/b.ts', NOW - HOUR], ['/r/solo.ts', NOW]]) }),
      s('x', { writes: new Map([['/r/a.ts', NOW - 5 * MIN], ['/r/c.ts', NOW]]) }),
      s('y', { writes: new Map([['/r/a.ts', NOW - MIN], ['/r/b.ts', NOW - 2 * MIN]]) }),
    ]
    // Le scritture viste da FILES: c.ts solo da qui, a.ts più vecchia di quella nel transcript.
    const local = [
      { path: '/r/c.ts', at: NOW - 3 * MIN },
      { path: '/r/a.ts', at: NOW - 20 * MIN },
    ]
    expect(candidates(list, 'io', local)).toEqual([
      { path: '/r/c.ts', at: NOW - 3 * MIN, others: [{ id: 'x', at: NOW }] },
      {
        path: '/r/a.ts',
        at: NOW - 10 * MIN,
        others: [
          { id: 'y', at: NOW - MIN },
          { id: 'x', at: NOW - 5 * MIN },
        ],
      },
      { path: '/r/b.ts', at: NOW - HOUR, others: [{ id: 'y', at: NOW - 2 * MIN }] },
    ])
    // Senza questa nel registro restano le scritture viste da FILES.
    expect(candidates(list.slice(1), 'io', local).map(c => c.path)).toEqual(['/r/c.ts', '/r/a.ts'])
  })

  test('conteso: lavoro non salvato di tutte e due, o fuori da git nell’ultimo giorno', () => {
    const mine = NOW - 10 * MIN
    const theirs = NOW - 5 * MIN
    // Committato e pulito: niente in sospeso.
    expect(isPending('clean', 0, mine, theirs, NOW)).toBe(false)
    // Modificato, mai committato o committato prima di tutte e due: conteso.
    expect(isPending('dirty', 0, mine, theirs, NOW)).toBe(true)
    expect(isPending('dirty', NOW - HOUR, mine, theirs, NOW)).toBe(true)
    // Un commit dopo la prima scrittura ha salvato il lavoro di quella sessione.
    expect(isPending('dirty', NOW - 7 * MIN, mine, theirs, NOW)).toBe(false)
    // Fuori da git: conta finché tutte e due sono dell'ultimo giorno.
    expect(isPending('outside', 0, mine, theirs, NOW)).toBe(true)
    expect(isPending('outside', 0, NOW - NO_GIT_MS - MIN, theirs, NOW)).toBe(false)
  })

  test('git status: lo stato dei nomi chiesti, la rinomina con il nome nuovo, gli ignorati', () => {
    const out = [' M src/app.ts', 'R  src/nuovo.ts', 'src/vecchio.ts', '!! src/gen.ts', '?? src/altro.md', ''].join('\0')
    const found = statusByName(out, new Set(['app.ts', 'nuovo.ts', 'vecchio.ts', 'gen.ts', 'pulito.ts']))
    expect([...found]).toEqual([
      ['app.ts', ' M'],
      ['nuovo.ts', 'R '],
      ['gen.ts', '!!'],
    ])
  })

  test('un avviso per file e sessione, uno solo finché restano contesi', () => {
    const given = new Set<string>()
    const list = [s('x', { title: 'Docs migration' }), s('y')]
    const both = [
      overlap('/r/src/app.ts', [{ id: 'x', at: NOW - 2 * MIN, isPending: true }]),
      overlap('/r/notes.md', [
        { id: 'y', at: NOW - 3 * HOUR, isPending: true },
        { id: 'x', at: NOW - MIN, isPending: false },
      ]),
    ]
    expect(dueAlerts(both, list, NOW, given)).toBe('Guard: other open sessions are also changing app.ts (Docs migration, 2m ago), notes.md (y, 3h ago).')
    expect(dueAlerts(both, list, NOW, given)).toBeUndefined()
    // app.ts torna in pari: un nuovo contrasto più avanti si segnala di nuovo.
    const settled = [overlap('/r/src/app.ts', [{ id: 'x', at: NOW - 2 * MIN, isPending: false }]), both[1] as Overlap]
    expect(dueAlerts(settled, list, NOW, given)).toBeUndefined()
    expect(dueAlerts(both, list, NOW, given)).toBe('Guard: another open session is also changing app.ts (Docs migration, 2m ago).')
  })

  test('in vista: prima i contesi, poi i risolti dove l’altra ha scritto nell’ultimo giorno', () => {
    const shown = shownOverlaps(NOW, [
      overlap('/r/vecchio.md', [{ id: 'x', at: NOW - 2 * 24 * HOUR, isPending: false }]),
      overlap('/r/risolto.md', [{ id: 'x', at: NOW - 3 * HOUR, isPending: false }]),
      overlap('/r/conteso.md', [{ id: 'y', at: NOW - 3 * 24 * HOUR, isPending: true }]),
    ])
    expect(shown.map(o => o.path)).toEqual(['/r/conteso.md', '/r/risolto.md'])
  })

  test('nel pannello: guard si accende, mostra il file e chi lo sta cambiando; una scrittura di qui si vede subito', { timeoutMs: 20_000 }, async ($, on) => {
    const toasts = toastsOf(on)
    const now = Date.now()
    const saved = SESSIONS.out
    HERDR_FOCUS.length = 0
    // app.ts: questa e Docs migration, dopo l'ultimo commit di un'ora fa. README:
    // anche tiny, ma è pulito in git. notes.md: solo Docs release, per ora.
    SESSIONS.out = withWrites(now, {
      s1: [
        ['/r/src/app.ts', now - 3 * MIN],
        ['/r/README.md', now - 4 * HOUR],
      ],
      busy1: [['/r/src/app.ts', now - 2 * MIN]],
      cold2: [['/r/README.md', now - 5 * HOUR]],
      soon1: [['/r/notes.md', now - MIN]],
    })
    GUARD.commits['app.ts'] = String(Math.floor((now - HOUR) / 1000))
    try {
      fakeEngine(on, [])
      await start($)
      await settle()
      await settle()
      const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })

      // Accesa anche senza aprirla, con quanti file sono contesi; e un avviso.
      expect(await ui.find({ type: 'Text', text: /^guard 1$/ })).toBeDefined()
      expect(toasts).toEqual(['Guard: another open session is also changing app.ts (Docs migration, 2m ago).'])

      await ui.press({ key: 'files-view-guard' })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /^1 file shared$/ })).toBeDefined()
      expect(await ui.find({ key: 'guard:/r/src/app.ts' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^2m ago · uncommitted$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^you 3m ago$/ })).toBeDefined()
      // README è risolto: resta, spento, perché tiny l'ha scritto nell'ultimo giorno.
      expect(await ui.find({ key: 'guard:/r/README.md' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^5h ago · committed$/ })).toBeDefined()
      expect(await ui.find({ key: 'guard:/r/notes.md' })).toBeUndefined()

      // Un clic sulla sessione porta herdr sul suo pane.
      await ui.press({ key: 'guard-session:/r/src/app.ts:busy1' })
      await settle()
      expect(HERDR_FOCUS).toEqual(['w2:p1'])

      // Questa scrive notes.md, che Docs release sta cambiando: conteso subito.
      FILES['/r/notes.md'] = 'a\n'
      PENDING['/r/notes.md'] = 'b\n'
      await $.tool.call({ tool: 'Edit', file_path: '/r/notes.md', old_string: 'a', new_string: 'b' } as never)
      await settle()
      await settle()
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /^guard 2$/ })).toBeDefined()
      expect(await ui.find({ key: 'guard:/r/notes.md' })).toBeDefined()
      expect(toasts.at(-1)).toBe('Guard: another open session is also changing notes.md (Docs release, 1m ago).')

      // Nella vista dei file cambiati, notes.md ha il segno della guardia.
      await ui.press({ key: 'files-view-touched' })
      await ui.redraw()
      expect(await ui.find({ key: 'touched:/r/notes.md' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^▲ $/ })).toBeDefined()
      await ui.unmount()
    } finally {
      SESSIONS.out = saved
      delete GUARD.commits['app.ts']
      delete FILES['/r/notes.md']
    }
  })

  test('un commit dopo le due scritture la spegne; fuori da git conta l’ultimo giorno', { timeoutMs: 20_000 }, async ($, on) => {
    const toasts = toastsOf(on)
    const now = Date.now()
    const saved = SESSIONS.out
    SESSIONS.out = withWrites(now, {
      s1: [
        ['/r/src/app.ts', now - 30 * MIN],
        ['/fuori/appunti.md', now - 2 * HOUR],
        ['/fuori/vecchi.md', now - 3 * 24 * HOUR],
      ],
      busy1: [['/r/src/app.ts', now - 20 * MIN]],
      cold2: [
        ['/fuori/appunti.md', now - HOUR],
        ['/fuori/vecchi.md', now - 2 * HOUR],
      ],
    })
    GUARD.outside.add('/fuori')
    try {
      fakeEngine(on, [])
      await start($)
      await settle()
      await settle()
      const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
      await ui.press({ key: 'files-view-guard' })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /^guard 2$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^1h ago · not in git$/ })).toBeDefined()
      // Questa l'ha scritto tre giorni fa: fuori da git non conta più.
      expect(await ui.find({ type: 'Text', text: /^2h ago · over a day$/ })).toBeDefined()
      expect(toasts).toHaveLength(1)

      // Il commit arriva dopo tutte e due le scritture di app.ts.
      GUARD.commits['app.ts'] = String(Math.floor((now - MIN) / 1000))
      await ui.press({ key: 'files-refresh' })
      await settle()
      await settle()
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /^guard 1$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^20m ago · committed$/ })).toBeDefined()
      expect(toasts).toHaveLength(1)
      await ui.unmount()
    } finally {
      SESSIONS.out = saved
      GUARD.outside.delete('/fuori')
      delete GUARD.commits['app.ts']
    }
  })

  test('nessuna sovrapposizione: la guardia è spenta e dice cosa guarda', { timeoutMs: 20_000 }, async ($, on) => {
    fakeEngine(on, [])
    await start($)
    await settle()
    await settle()
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /^guard$/ })).toBeDefined()
    await ui.press({ key: 'files-view-guard' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /No other open session is changing the files of this one/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Watching 4 other sessions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^clear$/ })).toBeDefined()
    await ui.unmount()
  })
})
