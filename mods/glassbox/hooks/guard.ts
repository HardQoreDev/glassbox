// GUARD, una vista della sezione FILES: i file che questa sessione ha scritto
// e che ha scritto anche un'altra sessione aperta. Le scritture delle altre
// arrivano da bin/sessions.py (le risposte di Edit e Write nei loro
// transcript); quelle di questa anche dal conto di FILES, che vede pure i
// comandi di shell.
//
// Due sessioni sullo stesso file non sono per forza un guaio: lo sono quando
// tutte e due hanno lavoro non ancora salvato lì dentro, perché poi un commit
// si porta via anche il lavoro dell'altra, o una delle due lavora su un file
// che non è più quello che ha letto. Quindi un file è conteso quando ha
// modifiche non committate e nessun commit l'ha toccato dopo la prima delle
// due scritture. Fuori da git (o in un file che git ignora) niente dice quando
// il lavoro è stato salvato: conta finché tutte e due le scritture sono
// dell'ultimo giorno.
import type { EngineInterface } from 'claude-code'

import { label, sessions, span } from './sessions'
import type { Session } from './sessions'
import { touchedList } from './touched'

/** Fuori da git le due scritture contano come lavoro in corso per questo tempo. */
export const NO_GIT_MS = 24 * 3_600_000
/** Un file già risolto resta in vista finché l'altra sessione l'ha scritto da meno di così. */
export const SETTLED_MS = 24 * 3_600_000
/** Quanti file si controllano con git a ogni giro, dai toccati più di recente. */
export const MAX_CHECKED = 40
const GIT_MS = 5_000

/** Dove sta il file per git: modifiche non salvate, pulito, o fuori da git (anche ignorato). */
export type GitState = 'dirty' | 'clean' | 'outside'

export type Other = {
  id: string
  // L'ultima volta che l'altra sessione l'ha scritto.
  at: number
  // Ha ancora lavoro non salvato nel file insieme a questa sessione.
  isPending: boolean
}

export type Overlap = {
  path: string
  // L'ultima volta che questa sessione l'ha scritto.
  at: number
  others: Other[]
  git: GitState
  // L'ultimo commit che l'ha toccato, 0 se nessuno.
  committedAt: number
}

export type Candidate = { path: string; at: number; others: { id: string; at: number }[] }

export const guard = {
  overlaps: [] as Overlap[],
  // Quando si è guardato l'ultima volta; 0 finché non si è guardato.
  checkedAt: 0,
}

let isChecking = false
let again = false
// Le coppie file e sessione già segnalate con un avviso, finché restano contese.
const warned = new Set<string>()

/** I file scritti da questa sessione e da almeno un'altra, dal toccato più di recente. */
export function candidates(list: readonly Session[], selfId: string, local: readonly { path: string; at: number }[]): Candidate[] {
  const mine = new Map(list.find(s => s.id === selfId)?.writes ?? [])
  for (const t of local) if (t.at > (mine.get(t.path) ?? 0)) mine.set(t.path, t.at)
  const out: Candidate[] = []
  for (const [path, at] of mine) {
    const others = list
      .filter(s => s.id !== selfId && s.writes?.has(path))
      .map(s => ({ id: s.id, at: s.writes?.get(path) ?? 0 }))
      .sort((a, b) => b.at - a.at)
    if (others.length > 0) out.push({ path, at, others })
  }
  const last = (c: Candidate) => Math.max(c.at, c.others[0]?.at ?? 0)
  return out.sort((a, b) => last(b) - last(a)).slice(0, MAX_CHECKED)
}

/** Se le due sessioni hanno tutte e due lavoro non salvato nel file. */
export function isPending(git: GitState, committedAt: number, mine: number, theirs: number, now: number): boolean {
  if (git === 'clean') return false
  if (git === 'outside') return Math.min(mine, theirs) > now - NO_GIT_MS
  return committedAt < Math.min(mine, theirs)
}

/** Lo stato dei nomi chiesti in `git status --porcelain=v1 -z`, per nome: '!!' ignorato, altro modificato. */
export function statusByName(stdout: string, names: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>()
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i] ?? ''
    if (rec.length < 4 || rec.startsWith('## ')) continue
    const xy = rec.slice(0, 2)
    // Una rinomina o una copia porta dietro il nome di prima.
    if (xy[0] === 'R' || xy[0] === 'C') i++
    const name = rec.slice(3).replace(/\/$/, '').split('/').pop() ?? ''
    if (names.has(name)) out.set(name, xy)
  }
  return out
}

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/'
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

function gitIn($: EngineInterface, dir: string, args: readonly string[]) {
  // Una cartella per volta e i nomi senza la parte prima: vale anche quando
  // il percorso passa da un link e il repo ha un'altra radice.
  return $.process.run(['git', '--no-optional-locks', '--literal-pathspecs', '-C', dir, ...args], {
    timeoutMs: GIT_MS,
    env: { GIT_OPTIONAL_LOCKS: '0' },
  })
}

/** Per ogni file, dove sta per git e l'ultimo commit che l'ha toccato. */
async function gitStates($: EngineInterface, paths: readonly string[]): Promise<Map<string, { git: GitState; committedAt: number }>> {
  const byDir = new Map<string, string[]>()
  for (const p of paths) byDir.set(dirOf(p), [...(byDir.get(dirOf(p)) ?? []), nameOf(p)])
  const out = new Map<string, { git: GitState; committedAt: number }>()
  await Promise.all(
    [...byDir].map(async ([dir, names]) => {
      const status = await gitIn($, dir, ['status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=all', '--', ...names]).catch(() => undefined)
      const join = (name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`)
      if (!status || status.exitCode !== 0 || status.isStdoutTruncated) {
        for (const name of names) out.set(join(name), { git: 'outside', committedAt: 0 })
        return
      }
      const found = statusByName(status.stdout, new Set(names))
      await Promise.all(
        names.map(async name => {
          const xy = found.get(name)
          if (xy === undefined) return void out.set(join(name), { git: 'clean', committedAt: 0 })
          if (xy === '!!') return void out.set(join(name), { git: 'outside', committedAt: 0 })
          const log = await gitIn($, dir, ['log', '-1', '--format=%ct', '--', name]).catch(() => undefined)
          const seconds = Number(log?.exitCode === 0 ? log.stdout.trim() : '')
          out.set(join(name), { git: 'dirty', committedAt: Number.isFinite(seconds) ? seconds * 1000 : 0 })
        }),
      )
    }),
  )
  return out
}

/** Gli avvisi da dare: le coppie file e sessione diventate contese da poco. Una volta sola finché restano contese. */
export function dueAlerts(overlaps: readonly Overlap[], list: readonly Session[], now: number, given: Set<string> = warned): string | undefined {
  const parts: string[] = []
  const still = new Set<string>()
  for (const o of overlaps) {
    const fresh: string[] = []
    for (const other of o.others) {
      if (!other.isPending) continue
      const key = `${o.path}\n${other.id}`
      still.add(key)
      if (given.has(key)) continue
      given.add(key)
      const s = list.find(x => x.id === other.id)
      fresh.push(`${s ? label(s) : other.id.slice(0, 8)}, ${span(now - other.at)} ago`)
    }
    if (fresh.length > 0) parts.push(`${nameOf(o.path)} (${fresh.join('; ')})`)
  }
  // Una coppia tornata in pari si potrà segnalare di nuovo.
  for (const key of given) if (!still.has(key)) given.delete(key)
  if (parts.length === 0) return undefined
  return parts.length === 1
    ? `Guard: another open session is also changing ${parts[0]}.`
    : `Guard: other open sessions are also changing ${parts.join(', ')}.`
}

// Quello che la vista mostra, in una stringa: se non cambia, non si ridisegna.
const signature = (overlaps: readonly Overlap[]): string =>
  JSON.stringify(overlaps.map(o => [o.path, o.at, o.git, o.others.map(x => [x.id, x.at, x.isPending])]))

async function checkOnce($: EngineInterface, now: number): Promise<{ text?: string; isChanged: boolean }> {
  // Prima che bin/sessions.py abbia risposto non si sa cosa scrivono le altre.
  if (sessions.at === 0) return { isChanged: false }
  const list = sessions.list
  const found = candidates(list, sessions.selfId, touchedList())
  const states = found.length > 0 ? await gitStates($, found.map(c => c.path)) : new Map()
  const before = guard.checkedAt === 0 ? undefined : signature(guard.overlaps)
  guard.overlaps = found.map(c => {
    const { git, committedAt } = states.get(c.path) ?? { git: 'outside' as const, committedAt: 0 }
    return { ...c, git, committedAt, others: c.others.map(o => ({ ...o, isPending: isPending(git, committedAt, c.at, o.at, now) })) }
  })
  guard.checkedAt = now
  return { text: dueAlerts(guard.overlaps, list, now), isChanged: before !== signature(guard.overlaps) }
}

/**
 * Riguarda le sovrapposizioni: il testo dell'avviso, se ce n'è uno nuovo, e
 * se la vista è cambiata. Chi chiama mentre un giro è in corso riceve niente,
 * e il giro in corso ne fa un altro alla fine: così una scrittura appena
 * fatta non resta fuori.
 */
export async function refreshGuard($: EngineInterface, clock: () => number = Date.now): Promise<{ text?: string; isChanged: boolean }> {
  if (isChecking) {
    again = true
    return { isChanged: false }
  }
  isChecking = true
  try {
    const texts: string[] = []
    let isChanged = false
    do {
      again = false
      const round = await checkOnce($, clock())
      if (round.text) texts.push(round.text)
      isChanged = isChanged || round.isChanged
    } while (again)
    return { ...(texts.length > 0 ? { text: texts.join(' ') } : {}), isChanged }
  } finally {
    isChecking = false
  }
}

export const isContested = (o: Overlap): boolean => o.others.some(x => x.isPending)

/** I file contesi adesso. */
export const contestedPaths = (): Set<string> => new Set(guard.overlaps.filter(isContested).map(o => o.path))

/** Quello che la vista mostra: i contesi, poi quelli risolti in cui l'altra sessione ha scritto nell'ultimo giorno. */
export function shownOverlaps(now: number, overlaps: readonly Overlap[] = guard.overlaps): Overlap[] {
  const contested = overlaps.filter(isContested)
  const settled = overlaps.filter(o => !isContested(o) && o.others.some(x => x.at > now - SETTLED_MS))
  return [...contested, ...settled]
}
