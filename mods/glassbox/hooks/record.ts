// Il registro delle sessioni su disco: ogni richiesta del ciclo principale con
// il contesto che ha portato. Claude Code tiene le trascrizioni da sé, ma le
// cancella dopo 30 giorni (cleanupPeriodDays) e non tiene quello che una
// richiesta ha mandato davvero: i messaggi dopo una compattazione, il prompt di
// sistema e gli strumenti, la composizione di /context, i token di ognuna.
//
// Una cartella per sessione, sotto quella del progetto, nominata come Claude
// Code nomina le sue (`/home/me/app` → `-home-me-app`):
//   session.json        il riassunto, riscritto a ogni richiesta e a ogni turno
//   requests/0001.json  una richiesta: quanti messaggi tiene dalla precedente
//                       (`keep`), poi quelli nuovi, i token e la risposta
//   system/01.json      il prompt di sistema e gli strumenti, quando cambiano
//   analyses/*.md       le analisi chieste con `analyze` in CONTEXT
// Il contesto della richiesta k è quello della k-1 tagliato a `keep`, più i
// suoi `messages`: `replay` lo ricostruisce.
import { host } from './host'
import type { EngineInterface, PluginOptions, SessionContextBreakdown } from 'claude-code'

import type { ApiMessage } from './context'

export const FORMAT = 'glassbox-session/1'

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export type OutputBlock = { index: number; kind: 'thinking' | 'text' | 'tool_use'; name?: string; id?: string; text: string }

export type RequestRecord = {
  format: string
  /** La richiesta nella sessione, da 1. */
  request: number
  /** Il numero che CONTEXT le dà (#n). */
  n: number
  turnId: string
  /** La sua posizione nel turno del prompt, da 0. */
  step: number
  at: string
  model?: string
  effort?: string | number
  stopReason?: string | null
  usage?: Usage
  /** Il file in system/ che era in vigore. */
  system?: number
  /** Quanti messaggi della richiesta prima porta uguali; gli altri sono in `messages`. */
  keep: number
  /** null se non si sono letti: la richiesta dopo li riporta tutti. */
  messages: ApiMessage[] | null
  output?: OutputBlock[]
}

export type SessionRecord = {
  format: string
  sessionId: string
  project: string
  resume: string
  glassbox: string
  startedAt: string
  updatedAt: string
  endedAt?: string
  endReason?: string
  /** Il primo prompt, accorciato. */
  title: string
  models: string[]
  requests: number
  systems: number
  /** I byte scritti in requests/. */
  bytes: number
  window?: number
  /** Il contesto dell'ultima richiesta e il più grande, con la risposta. */
  context: { last: number; peak: number }
  /** In tutte le richieste: input senza cache, letto e scritto in cache, output. */
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number }
  compactions: number
  /** /context dopo l'ultimo turno. */
  breakdown?: { categories: { name: string; tokens: number; kind: string }[]; autoCompactThreshold?: number }
  tools?: Record<string, { count: number; failed: number }>
  subagents?: { count: number; requests: number; input: number; output: number }
  analyses: string[]
}

/** Una richiesta appena finita, come la passa il giro dei turni. */
export type RequestDone = {
  n: number
  turnId: string
  step: number
  prompt: string
  model?: string
  effort?: string | number
  stopReason?: string | null
  usage?: Usage | null
  isCompacted: boolean
  window?: number
  messages: Promise<readonly ApiMessage[] | undefined>
  output?: readonly OutputBlock[]
}

/** Quello che si sa dopo un turno: /context, gli strumenti, i subagent. */
export type TurnDone = {
  breakdown?: SessionContextBreakdown
  calls: ReadonlyMap<string, { count: number; failed: number }>
  agents: ReadonlyMap<string, { requests: number; input: number; output: number }>
}

const TITLE_MAX = 120

const rec = {
  isOn: true,
  // La cartella scelta nelle opzioni; vuota, quella sotto la configurazione.
  root: '',
  version: '',
  sessionId: '',
  dir: '',
  meta: undefined as SessionRecord | undefined,
  // I messaggi dell'ultima richiesta scritta, in JSON: dicono quanti ne tiene la prossima.
  last: [] as string[],
  system: { hash: '', turnId: '' },
  // Il numero di CONTEXT di ogni richiesta scritta → il suo numero nel registro.
  byN: new Map<number, number>(),
  // Le scritture una dopo l'altra, nell'ordine delle richieste.
  queue: Promise.resolve() as Promise<unknown>,
  hasFailed: false,
}

/** Le opzioni del mod: `recordSessions` e `sessionsDir`. */
export function configureRecord(options: PluginOptions, version = ''): void {
  rec.isOn = options.recordSessions !== false
  rec.root = typeof options.sessionsDir === 'string' ? options.sessionsDir.trim() : ''
  rec.version = version
}

export const setRecordVersion = (version: string): void => {
  rec.version = version
}

/** Dove sta il registro di questa sessione, e quanto è grande; undefined se spento o ancora vuoto. */
export function recordInfo(): { dir: string; requests: number; bytes: number } | undefined {
  if (!rec.isOn || !rec.meta) return undefined
  return { dir: rec.dir, requests: rec.meta.requests, bytes: rec.meta.bytes }
}

export const isRecording = (): boolean => rec.isOn

/** Il numero nel registro della richiesta #n di CONTEXT. */
export const recordedAs = (n: number): number | undefined => rec.byN.get(n)

/** Il nome che Claude Code dà alla cartella di un progetto. */
export const projectSlug = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

const pad = (n: number, w: number) => String(n).padStart(w, '0')

// Un riassunto del testo, per vedere se il prompt di sistema è cambiato.
const digest = (s: string): string => {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  return `${s.length}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

async function rootOf($: EngineInterface): Promise<string> {
  const home = ((await $.env.get('HOME').catch(() => undefined)) ?? '').replace(/\/$/, '')
  if (rec.root) return rec.root.replace(/^~(?=\/|$)/, home).replace(/\/$/, '')
  const config = ((await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? '').replace(/\/$/, '')
  return `${config || `${home}/.claude`}/glassbox/sessions`
}

const fresh = (sessionId: string, project: string, now: string): SessionRecord => ({
  format: FORMAT,
  sessionId,
  project,
  resume: host.resume(sessionId),
  glassbox: rec.version,
  startedAt: now,
  updatedAt: now,
  title: '',
  models: [],
  requests: 0,
  systems: 0,
  bytes: 0,
  context: { last: 0, peak: 0 },
  tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  compactions: 0,
  analyses: [],
})

// La cartella della sessione: nuova, o quella di prima per una sessione ripresa.
async function openSession($: EngineInterface, sessionId: string): Promise<void> {
  const project = await $.session.root().catch(() => $.session.cwd())
  const dir = `${await rootOf($)}/${projectSlug(project)}/${sessionId}`
  const before = await $.fs
    .read(`${dir}/session.json`)
    .then(t => JSON.parse(t) as SessionRecord)
    .catch(() => undefined)
  Object.assign(rec, {
    sessionId,
    dir,
    meta: before?.format === FORMAT ? { ...before, endedAt: undefined, endReason: undefined } : fresh(sessionId, project, new Date().toISOString()),
    last: [],
    system: { hash: '', turnId: '' },
  })
  rec.byN.clear()
}

// Il prompt di sistema e gli strumenti come il motore li compone ora: un file
// nuovo solo quando sono cambiati.
async function snapshotSystem($: EngineInterface, model: string | undefined, tools: ToolsSeen): Promise<void> {
  const composed = await $.prompt.compose(model ? { model } : {}).catch(() => undefined)
  const list = await $.tool.list().catch(() => [])
  const system = {
    sections: (composed?.sections ?? []).map(s => ({ id: s.id, scope: s.scope, text: s.text })),
    tools: list.map(t => {
      const seen = tools.get(t.name)
      return { name: t.name, description: seen?.description ?? t.description, ...(seen?.isDeferred ? { isDeferred: true } : {}), ...(t.mcp ? { mcp: true } : {}) }
    }),
  }
  const hash = digest(JSON.stringify(system))
  if (hash === rec.system.hash || !rec.meta) return
  rec.system.hash = hash
  rec.meta.systems += 1
  const note = 'The system prompt and the tools as the engine composed them when the request went out; input schemas are not readable from a mod.'
  await $.fs.write(`${rec.dir}/system/${pad(rec.meta.systems, 2)}.json`, JSON.stringify({ format: FORMAT, at: new Date().toISOString(), model, note, ...system }, null, 1))
}

type ToolsSeen = ReadonlyMap<string, { description: string; isDeferred: boolean }>

function writeMeta($: EngineInterface): Promise<void> {
  if (!rec.meta) return Promise.resolve()
  rec.meta.updatedAt = new Date().toISOString()
  return $.fs.write(`${rec.dir}/session.json`, JSON.stringify(rec.meta, null, 1))
}

// Un errore si dice una volta sola: il registro non deve disturbare il lavoro.
function enqueue($: EngineInterface, job: () => Promise<void>): Promise<void> {
  const run = rec.queue.then(job).catch(err => {
    if (rec.hasFailed) return
    rec.hasFailed = true
    $.ui.log(`glassbox: session not recorded: ${err instanceof Error ? err.message : err}`)
  })
  rec.queue = run
  return run
}

const cleanTitle = (prompt: string) =>
  prompt
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX)

/** Scrive una richiesta finita con il contesto che ha portato. */
export function recordRequest($: EngineInterface, r: RequestDone, tools: ToolsSeen): Promise<void> {
  if (!rec.isOn) return Promise.resolve()
  return enqueue($, async () => {
    const sessionId = await $.session.id()
    if (sessionId !== rec.sessionId || !rec.meta) await openSession($, sessionId)
    const meta = rec.meta!
    if (rec.system.turnId !== r.turnId) {
      rec.system.turnId = r.turnId
      await snapshotSystem($, r.model, tools).catch(() => undefined)
    }
    const messages = await r.messages.catch(() => undefined)
    const strs = messages?.map(m => JSON.stringify(m))
    let keep = 0
    if (strs) while (keep < strs.length && keep < rec.last.length && strs[keep] === rec.last[keep]) keep++
    rec.last = strs ?? []

    meta.requests += 1
    rec.byN.set(r.n, meta.requests)
    const u = r.usage ?? undefined
    const record: RequestRecord = {
      format: FORMAT,
      request: meta.requests,
      n: r.n,
      turnId: r.turnId,
      step: r.step,
      at: new Date().toISOString(),
      ...(r.model ? { model: r.model } : {}),
      ...(r.effort !== undefined ? { effort: r.effort } : {}),
      ...(r.stopReason !== undefined ? { stopReason: r.stopReason } : {}),
      ...(u ? { usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens } } : {}),
      ...(meta.systems > 0 ? { system: meta.systems } : {}),
      keep,
      messages: messages ? messages.slice(keep) : null,
      ...(r.output && r.output.length ? { output: [...r.output].sort((a, b) => a.index - b.index) } : {}),
    }
    const text = JSON.stringify(record)
    await $.fs.write(`${rec.dir}/requests/${pad(meta.requests, 4)}.json`, text)

    meta.bytes += text.length
    if (!meta.title && r.step === 0 && r.prompt.trim()) meta.title = cleanTitle(r.prompt)
    if (r.model && !meta.models.includes(r.model)) meta.models.push(r.model)
    if (r.window) meta.window = r.window
    if (r.isCompacted) meta.compactions += 1
    if (u) {
      const context = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      meta.context = { last: context, peak: Math.max(meta.context.peak, context) }
      meta.tokens = {
        input: meta.tokens.input + u.input_tokens,
        cacheRead: meta.tokens.cacheRead + u.cache_read_input_tokens,
        cacheWrite: meta.tokens.cacheWrite + u.cache_creation_input_tokens,
        output: meta.tokens.output + u.output_tokens,
      }
    }
    await writeMeta($)
  })
}

/** Dopo un turno: /context, le chiamate agli strumenti e i subagent nel riassunto. */
export function recordTurn($: EngineInterface, t: TurnDone): Promise<void> {
  if (!rec.isOn) return Promise.resolve()
  return enqueue($, async () => {
    const meta = rec.meta
    if (!meta || (await $.session.id()) !== rec.sessionId) return
    if (t.breakdown)
      meta.breakdown = {
        categories: t.breakdown.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
        ...(t.breakdown.autoCompactThreshold !== undefined ? { autoCompactThreshold: t.breakdown.autoCompactThreshold } : {}),
      }
    if (t.calls.size) meta.tools = Object.fromEntries(t.calls)
    if (t.agents.size) {
      const all = [...t.agents.values()]
      meta.subagents = {
        count: all.length,
        requests: all.reduce((s, a) => s + a.requests, 0),
        input: all.reduce((s, a) => s + a.input, 0),
        output: all.reduce((s, a) => s + a.output, 0),
      }
    }
    await writeMeta($)
  })
}

/** La fine della sessione, con il perché, nel riassunto. */
export function endRecord($: EngineInterface, sessionId: string, reason: string): Promise<void> {
  if (!rec.isOn) return Promise.resolve()
  return enqueue($, async () => {
    if (!rec.meta || sessionId !== rec.sessionId) return
    rec.meta.endedAt = new Date().toISOString()
    rec.meta.endReason = reason
    await writeMeta($)
    // Dopo un /clear la sessione che segue è un'altra: si riparte da capo.
    Object.assign(rec, { sessionId: '', meta: undefined, last: [] })
  })
}

/** Salva un'analisi accanto alle richieste e ne dà il percorso; '' se il registro è spento. */
export function saveAnalysis($: EngineInterface, n: number, body: string): Promise<string> {
  if (!rec.isOn) return Promise.resolve('')
  let path = ''
  return enqueue($, async () => {
    const sessionId = await $.session.id()
    if (sessionId !== rec.sessionId || !rec.meta) await openSession($, sessionId)
    const meta = rec.meta!
    const at = new Date()
    const name = `${pad(rec.byN.get(n) ?? meta.requests, 4)}-${pad(at.getHours(), 2)}${pad(at.getMinutes(), 2)}${pad(at.getSeconds(), 2)}.md`
    path = `${rec.dir}/analyses/${name}`
    await $.fs.write(path, body)
    meta.analyses.push(`analyses/${name}`)
    await writeMeta($)
  }).then(() => path)
}

/** Il contesto di ogni richiesta, dalle richieste lette in ordine. */
export function replay(requests: readonly Pick<RequestRecord, 'keep' | 'messages'>[]): ApiMessage[][] {
  const out: ApiMessage[][] = []
  let now: ApiMessage[] = []
  for (const r of requests) {
    now = [...now.slice(0, r.keep), ...(r.messages ?? [])]
    out.push(now)
  }
  return out
}

/** Per i test: dimentica la sessione aperta. */
export function resetRecord(): void {
  Object.assign(rec, { isOn: true, root: '', sessionId: '', dir: '', meta: undefined, last: [], system: { hash: '', turnId: '' }, queue: Promise.resolve(), hasFailed: false })
  rec.byN.clear()
}

/** Aspetta che le scritture in coda siano finite. */
export const recordSettled = (): Promise<unknown> => rec.queue
