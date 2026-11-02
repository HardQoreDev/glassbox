// Quello che entra nel contesto a ogni richiesta, per le finestre che CONTEXT
// apre al posto delle sezioni: system (il prompt di sistema e gli strumenti),
// earlier (la conversazione che la richiesta si porta dietro), new (quello che
// porta di nuovo: il prompt, o le risposte degli strumenti) e output (quello
// che il modello ha risposto). I messaggi si leggono quando la richiesta parte,
// la risposta dal suo flusso; il prompt di sistema si compone al clic.
import type { EngineInterface, On, TurnStepChunk } from 'claude-code'

import { fmtTokens, inputStack } from './vendor/turns'
import type { BlockKind, Ledger, Turn } from './vendor/turns'

export type ApiBlock = { type: string; [field: string]: unknown }
export type ApiMessage = { role: 'user' | 'assistant'; content: readonly ApiBlock[] }

export type Part = 'system' | 'earlier' | 'new' | 'output'

// Com'è disegnata una riga: i titoli dei messaggi per chi li ha scritti, le
// intestazioni dei blocchi, le note del mod; senza, il testo com'è stato mandato.
export type Tone = 'user' | 'assistant' | 'system' | 'block' | 'note'
export type DocLine = { text: string; tone?: Tone }

// I messaggi di più richieste stanno in una sola lista finché ognuna allunga
// quella prima; una compattazione ne apre un'altra. Ne restano poche.
const MAX_EPOCHS = 8
// Un dato in base64 più lungo di così si riassume.
const MAX_DATA = 200

type Epoch = { messages: readonly ApiMessage[] }
// `messages` è la loro lista, tagliata la prima volta che serve.
type Sent = { epoch: Epoch; count: number; messages?: readonly ApiMessage[] }
type OutBlock = { index: number; kind: 'thinking' | 'text' | 'tool_use'; name?: string; id?: string; text: string }
type ToolSeen = { description: string; isDeferred: boolean }

const store = {
  epochs: [] as Epoch[],
  // Per turno: in che lista sono i suoi messaggi, e quanti sono.
  sent: new Map<number, Sent>(),
  output: new Map<number, OutBlock[]>(),
  // Gli strumenti come li vede il modello, e quali aspettano dietro ToolSearch.
  tools: new Map<string, ToolSeen>(),
}

/** La finestra aperta: un pezzo del contesto di un turno, al posto delle sezioni. */
export const doc = {
  isOpen: false,
  n: 0,
  part: 'system' as Part,
  title: '',
  info: '',
  lines: [] as DocLine[],
  // Cresce a ogni apertura: le righe a capo si ricalcolano.
  version: 0,
  offset: 0,
  // La riga a cui portare la finestra al prossimo disegno, poi si dimentica.
  focus: undefined as number | undefined,
  left: 0,
  wrap: true,
}

export function resetContext(): void {
  store.epochs = []
  store.sent.clear()
  store.output.clear()
}

/** Dimentica i turni prima di `oldest`, come il registro dei turni. */
export function pruneContext(oldest: number): void {
  for (const n of store.sent.keys()) if (n < oldest) store.sent.delete(n)
  for (const n of store.output.keys()) if (n < oldest) store.output.delete(n)
  const used = new Set([...store.sent.values()].map(s => s.epoch))
  store.epochs = store.epochs.filter((e, i) => used.has(e) || i === store.epochs.length - 1)
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

// `now` continua `old`: è più lunga e comincia e prosegue con gli stessi messaggi.
const continues = (old: readonly ApiMessage[], now: readonly ApiMessage[]): boolean =>
  now.length >= old.length && (old.length === 0 || (same(old[0], now[0]) && same(old.at(-1), now[old.length - 1])))

/** I messaggi che la richiesta del turno `n` porta. */
export function recordSent(n: number, messages: readonly ApiMessage[]): void {
  let epoch = store.epochs.at(-1)
  if (epoch && continues(epoch.messages, messages)) epoch.messages = messages
  else {
    epoch = { messages }
    store.epochs.push(epoch)
    const gone = store.epochs.length > MAX_EPOCHS ? store.epochs.shift() : undefined
    for (const [k, s] of store.sent) if (s.epoch === gone) store.sent.delete(k)
  }
  store.sent.set(n, { epoch, count: messages.length })
}

/** I messaggi che la richiesta del turno `n` ha portato, se si sono visti partire; la stessa lista a ogni chiamata. */
export function sentMessages(n: number): readonly ApiMessage[] | undefined {
  const s = store.sent.get(n)
  if (!s) return undefined
  s.messages ??= s.epoch.messages.slice(0, s.count)
  return s.messages
}

/** Un pezzo della risposta del turno `n`, nel suo blocco. */
export function recordChunk(n: number, c: TurnStepChunk): void {
  if (c.kind !== 'thinking' && c.kind !== 'text' && c.kind !== 'tool' && c.kind !== 'input') return
  let list = store.output.get(n)
  if (!list) store.output.set(n, (list = []))
  let b = list.find(x => x.index === c.index)
  if (!b) {
    b = { index: c.index, kind: c.kind === 'tool' || c.kind === 'input' ? 'tool_use' : c.kind, text: '' }
    list.push(b)
  }
  if (c.kind === 'tool') Object.assign(b, { name: c.name, id: c.id })
  else b.text += c.kind === 'input' ? c.json : c.text
}

/** Osserva come il motore descrive gli strumenti al modello, senza cambiare niente. */
export const registerContext = (on: On): void => {
  on('tool.describe', async ($, e, next) => {
    const r = await next(e)
    store.tools.set(e.tool, { description: r.description, isDeferred: r.isDeferred ?? e.isDeferred === true })
    return r
  }).catch(($, e, next) => next(e))
}

/** Il pezzo di una richiesta a cui appartiene un blocco della sua barra. */
export const partOf = (kind: BlockKind): Part =>
  kind === 'system' ? 'system' : kind === 'history' ? 'earlier' : kind === 'user' || kind === 'tool_result' ? 'new' : 'output'

/** Dove comincia l'input nuovo: dopo l'ultima risposta del modello. */
export function newFrom(messages: readonly ApiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'assistant') return i + 1
  return 0
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const lines = (s: string, tone?: Tone): DocLine[] => s.split('\n').map(t => ({ text: t, ...(tone ? { tone } : {}) }))
const kb = (base64: string) => `${Math.max(1, Math.round((base64.length * 3) / 4 / 1024))} KB`

// Il blocco com'è, con i dati in base64 riassunti.
const scrub = (v: unknown, key = ''): unknown => {
  if (typeof v === 'string') return key === 'data' && v.length > MAX_DATA ? `[${kb(v)} of base64]` : v
  if (Array.isArray(v)) return v.map(x => scrub(x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, k)]))
  return v
}
const json = (v: unknown): string => JSON.stringify(scrub(v), null, 2) ?? ''

const sourceOf = (b: ApiBlock): Record<string, unknown> => (b.source && typeof b.source === 'object' ? (b.source as Record<string, unknown>) : {})
const mediaOf = (b: ApiBlock): string => {
  const s = sourceOf(b)
  if (s.type === 'base64') return `[${text(s.media_type)}, ${kb(text(s.data))}]`
  if (s.type === 'url') return `[${text(s.url)}]`
  return json(s)
}

// Il titolo di un blocco e il suo testo; `names` dà lo strumento di ogni chiamata.
function blockLines(b: ApiBlock, names: ReadonlyMap<string, string>): DocLine[] {
  const head = (t: string): DocLine => ({ text: t, tone: 'block' })
  switch (b.type) {
    case 'text':
      return [head('text'), ...lines(text(b.text))]
    case 'thinking':
      return [head('thinking'), ...lines(text(b.thinking))]
    case 'redacted_thinking':
      return [head('redacted thinking'), { text: `[${text(b.data).length} characters, encrypted]` }]
    case 'tool_use':
      return [head(`tool_use · ${text(b.name)} · ${text(b.id)}`), ...lines(json(b.input))]
    case 'tool_result': {
      const id = text(b.tool_use_id)
      const what = [names.get(id), id, b.is_error === true ? 'error' : ''].filter(Boolean).join(' · ')
      const body = typeof b.content === 'string' ? lines(b.content) : Array.isArray(b.content) ? (b.content as ApiBlock[]).flatMap(c => (c.type === 'text' ? lines(text(c.text)) : c.type === 'image' ? [{ text: mediaOf(c) }] : lines(json(c)))) : []
      return [head(`tool_result · ${what}`), ...body]
    }
    case 'image':
      return [head('image'), { text: mediaOf(b) }]
    case 'document': {
      const s = sourceOf(b)
      const title = [text(b.title), text(s.media_type)].filter(Boolean).join(' · ')
      const body = s.type === 'text' ? lines(text(s.data)) : s.type === 'content' && Array.isArray(s.content) ? (s.content as ApiBlock[]).flatMap(c => lines(text(c.text))) : [{ text: mediaOf(b) }]
      return [head(`document${title ? ` · ${title}` : ''}`), ...body]
    }
    default:
      return [head(b.type), ...lines(json(b))]
  }
}

/**
 * I messaggi da `from` a `to`, numerati nella richiesta; ogni blocco con il suo
 * titolo. `marks`, se c'è, riceve la riga del titolo di ogni blocco, per
 * `messaggio:blocco`.
 */
export function messageLines(messages: readonly ApiMessage[], from: number, to: number, marks?: Map<string, number>): DocLine[] {
  const names = new Map<string, string>()
  for (const m of messages) for (const b of m.content) if (b.type === 'tool_use') names.set(text(b.id), text(b.name))
  const out: DocLine[] = []
  messages.slice(from, to).forEach((m, k) => {
    out.push({ text: `${from + k + 1} · ${m.role}`, tone: m.role })
    m.content.forEach((b, bi) => {
      marks?.set(`${from + k}:${bi}`, out.length)
      out.push(...blockLines(b, names), { text: '' })
    })
  })
  return out
}

/** La risposta di un turno com'è arrivata, blocco per blocco. */
export function outputLines(blocks: readonly OutBlock[]): DocLine[] {
  return [...blocks]
    .sort((a, b) => a.index - b.index)
    .flatMap(b => {
      if (b.kind !== 'tool_use') return [{ text: b.kind, tone: 'block' as const }, ...lines(b.text), { text: '' }]
      let input = b.text
      try {
        input = JSON.stringify(JSON.parse(b.text || '{}'), null, 2)
      } catch {
        // Gli argomenti non sono JSON intero: si mostrano come sono arrivati.
      }
      return [{ text: `tool_use · ${b.name ?? 'tool'} · ${b.id ?? ''}`, tone: 'block' as const }, ...lines(input), { text: '' }]
    })
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

type Section = { id: string; text: string; scope: string }
type ToolListed = { name: string; description: string }

/** Il prompt di sistema a sezioni, poi gli strumenti; quelli dietro ToolSearch solo per nome. */
export function systemLines(sections: readonly Section[], tools: readonly ToolListed[], seen: ReadonlyMap<string, ToolSeen>): DocLine[] {
  const shown = tools.filter(t => seen.get(t.name)?.isDeferred !== true)
  const deferred = tools.filter(t => seen.get(t.name)?.isDeferred === true)
  return [
    { text: `system prompt · ${plural(sections.length, 'section')}`, tone: 'system' },
    ...sections.flatMap(s => [{ text: `${s.id} · ${s.scope}`, tone: 'block' as const }, ...lines(s.text), { text: '' }]),
    { text: `tools · ${shown.length}`, tone: 'system' },
    ...(seen.size === 0 ? [{ text: 'Which tools wait behind ToolSearch is not known: Glassbox has not seen them described yet.', tone: 'note' as const }] : []),
    ...shown.flatMap(t => [{ text: t.name, tone: 'block' as const }, ...lines(seen.get(t.name)?.description ?? t.description), { text: '' }]),
    ...(deferred.length > 0
      ? [
          { text: `behind ToolSearch · ${deferred.length}`, tone: 'system' as const },
          { text: 'Only their names reach the model, in a reminder; ToolSearch loads a schema when asked.', tone: 'note' as const },
          ...deferred.map(t => ({ text: t.name })),
        ]
      : []),
  ]
}

// I token di un pezzo come li dà la barra: `~` quando sono una stima.
function tokensOf(l: Ledger, t: Turn, part: Part): string {
  if (part === 'output') return t.output === undefined ? '' : `+${fmtTokens(t.output)}`
  const kinds: BlockKind[] = part === 'system' ? ['system'] : part === 'earlier' ? ['history'] : ['user', 'tool_result']
  const blocks = inputStack(l, t).filter(b => kinds.includes(b.kind))
  if (blocks.length === 0) return ''
  return `${blocks.some(b => b.isEstimate) ? '~' : ''}${fmtTokens(blocks.reduce((s, b) => s + b.tokens, 0))}`
}

const NOT_SEEN = 'Glassbox did not see this request go out: it reads what a request carries as it is sent.'

/** Un blocco di una richiesta: il messaggio e la sua posizione nel messaggio. */
export type Focus = { message: number; block: number }

/** Il pezzo di una richiesta in cui sta il messaggio `message`. */
export function partAt(messages: readonly ApiMessage[], message: number): Part {
  return message >= newFrom(messages) ? 'new' : 'earlier'
}

async function partLines($: EngineInterface, t: Turn, part: Part, focus?: Focus): Promise<{ lines: DocLine[]; count: string; at?: number }> {
  if (part === 'system') {
    const model = t.model ?? ''
    const composed = await $.prompt.compose(model ? { model } : {}).catch(() => $.prompt.compose())
    const tools = await $.tool.list().catch(() => [])
    return {
      lines: [
        { text: `The system prompt as the engine composes it now${model ? ` for ${model}` : ''}, then the tools it offers; their input schemas are not readable from a mod.`, tone: 'note' },
        { text: '' },
        ...systemLines(composed.sections, tools, store.tools),
      ],
      count: plural(tools.length, 'tool'),
    }
  }
  if (part === 'output') {
    const blocks = store.output.get(t.n)
    const stop = t.stopReason ? ` It stopped on ${t.stopReason}.` : ''
    if (!blocks) return { lines: [{ text: NOT_SEEN, tone: 'note' }], count: '' }
    return {
      lines: [{ text: `What the model answered to this request, as it streamed.${stop}`, tone: 'note' }, { text: '' }, ...outputLines(blocks)],
      count: plural(blocks.length, 'block'),
    }
  }
  const sent = store.sent.get(t.n)
  if (!sent) return { lines: [{ text: NOT_SEEN, tone: 'note' }], count: '' }
  const messages = sent.epoch.messages.slice(0, sent.count)
  const at = newFrom(messages)
  const [from, to] = part === 'earlier' ? [0, at] : [at, messages.length]
  const note =
    part === 'earlier'
      ? to === 0
        ? 'Nothing before: this request opens the conversation.'
        : `The conversation this request carried before its new input, after the engine's normalization.`
      : 'What this request added: the prompt, or the results of the tools the last answer called.'
  const head: DocLine[] = [{ text: note, tone: 'note' }, { text: 'Cache marks and the reminders a request sends as system turns are not in the messages.', tone: 'note' }, { text: '' }]
  const marks = new Map<string, number>()
  const body = messageLines(messages, from, to, marks)
  const mark = focus ? marks.get(`${focus.message}:${focus.block}`) : undefined
  return { lines: [...head, ...body], count: plural(to - from, 'message'), ...(mark !== undefined ? { at: head.length + mark } : {}) }
}

/** Apre la finestra su un pezzo del contesto del turno `t`; con `focus`, sul titolo di quel blocco. */
export async function openContext($: EngineInterface, l: Ledger, t: Turn, part: Part, focus?: Focus): Promise<void> {
  const { lines: docLines, count, at } = await partLines($, t, part, focus)
  Object.assign(doc, {
    isOpen: true,
    n: t.n,
    part,
    title: `#${t.n} ${part}`,
    info: [tokensOf(l, t, part), count].filter(Boolean).join(' · '),
    lines: docLines,
    version: doc.version + 1,
    offset: 0,
    left: 0,
    focus: at,
  })
}

export function closeContext(): void {
  Object.assign(doc, { isOpen: false, lines: [] })
}

/** Il testo della finestra come file markdown: i titoli con #, le note con >. */
export function docText(title: string, docLines: readonly DocLine[]): string {
  const md = (l: DocLine): string =>
    l.tone === 'user' || l.tone === 'assistant' || l.tone === 'system' ? `## ${l.text}` : l.tone === 'block' ? `### ${l.text}` : l.tone === 'note' ? `> ${l.text}` : l.text
  return `${[`# ${title}`, '', ...docLines.map(md)].join('\n')}\n`
}

/** Scrive la finestra aperta in un file temporaneo e ne dà il percorso. */
export async function writeDoc($: EngineInterface): Promise<string> {
  const tmp = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/$/, '')
  const session = await $.session.id().catch(() => 'session')
  const path = `${tmp}/glassbox/${session}/turn-${doc.n}-${doc.part}.md`
  await $.fs.write(path, docText(doc.title, doc.lines))
  return path
}
