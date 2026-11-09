// Le statistiche della tendina `stats` di CONTEXT, in cinque viste pensate per
// il context engineering: health (quanto è pieno, quanto c'è prima della prima
// domanda, quanto si potrebbe togliere, la cache), fill (di cosa è fatto il
// contesto dell'ultima richiesta e cosa pesa di più), waste (risposte vecchie,
// ripetute o fallite, strumenti e skill caricati e mai usati), flow (quanto si
// manda a ogni giro, la cache, le compattazioni, i subagent) e tools (gli
// strumenti più usati e quanto pesano le loro risposte). Dai numeri, i consigli.
import type { SessionContextBreakdown } from 'claude-code'

import { anatomyOf, repeats } from './anatomy'
import type { Item, Kind } from './anatomy'
import type { ApiMessage } from './context'
import { CHARS_PER_TOKEN, contextAfter, fmtTokens, previous } from './vendor/turns'
import type { Ledger } from './vendor/turns'

// Oltre queste soglie un numero diventa un consiglio.
// Il contesto caricato prima della prima domanda: una parte della finestra, o
// questi token, che con una finestra da un milione restano tanti.
export const PRELOAD_SHARE = 0.2
export const PRELOAD_TOKENS = 50_000
// Il contesto in uso, sulla soglia della compattazione automatica o sulla finestra.
export const FULL_SHARE = 0.7
// La parte dell'input letta dalla cache, dopo qualche richiesta.
export const CACHE_SHARE = 0.6
const CACHE_MIN_REQUESTS = 4
// Una richiesta che legge dalla cache meno di questa parte dell'input di quella
// prima ha trovato la cache scaduta o cambiata.
const CACHE_BREAK = 0.5
const CACHE_BREAKS = 2
// Una risposta di uno strumento così grande, o una media così, pesa.
export const BIG_RESULT = 10_000
const HEAVY_AVERAGE = 5_000
// Quello che ogni richiesta si porta dietro: un server MCP, un file di memoria,
// l'elenco degli skill, le descrizioni degli agenti.
export const HEAVY_SOURCE = 5_000
// Dopo tante richieste uno strumento mai chiamato si può dire inutile qui.
const UNUSED_MIN_REQUESTS = 5
// Le chiamate fallite o negate, su almeno qualche chiamata.
export const FAILED_SHARE = 0.2
const FAILED_MIN_CALLS = 5
// Le richieste di un solo prompt.
export const LONG_LOOP = 25
// Una risposta di uno strumento arrivata tante richieste fa è vecchia; tante
// insieme, e una buona parte della conversazione, sono da compattare.
export const STALE_AGE = 10
const STALE_TOKENS = 20_000
const STALE_SHARE = 0.3
// Le copie di risposte uguali.
const REPEAT_TOKENS = 3_000
// I reminder e quello che aggiungono gli hook.
const REMINDER_TOKENS = 5_000
const REMINDER_SHARE = 0.1
// Letture e ricerche che un agente Explore terrebbe nel suo contesto.
const EXPLORE_TOKENS = 30_000
const EXPLORE_TOOLS = new Set(['Read', 'Grep', 'Glob'])
// I resoconti dei subagent.
const AGENT_REPORT = 20_000
const AGENT_TOOLS = new Set(['Agent', 'Task'])
// Le richieste su cui si misura quanto cresce il contesto.
const GROWTH_SPAN = 10
const TOP_TOOLS = 6
const TOP_CATEGORIES = 6
const HEAVIEST = 5

export type Tab = 'health' | 'fill' | 'waste' | 'flow' | 'tools'
export const TABS: readonly Tab[] = ['health', 'fill', 'waste', 'flow', 'tools']
export type Level = 'warn' | 'info' | 'good'
export type Stat = { label: string; value: string; level?: Level }
export type Share = { name: string; tokens: number; count?: number; failed?: number; results?: number }
export type Tip = { level: Level; text: string; tab: Tab }
/** Una fetta del contesto dell'ultima richiesta: quello che c'è prima della conversazione, o un tipo di blocco. */
export type Slice = { kind: Kind | 'preloaded'; tokens: number }
/** Un blocco tra i più pesanti, con dove sta nella richiesta e la richiesta in cui è entrato. */
export type Heavy = { label: string; kind: Kind; tokens: number; message: number; block: number; since?: number }
export type Fill = { n: number; total: number; slices: Slice[]; heaviest: Heavy[]; isScaled: boolean }
export type Stats = { rows: Record<Tab, Stat[]>; fill?: Fill; categories: Share[]; tools: Share[]; tips: Tip[] }

export type Calls = ReadonlyMap<string, { count: number; failed: number }>
/** Le richieste di un subagent: quante, il contesto più grande, l'input e l'output in tutto. */
export type AgentUse = { requests: number; peak: number; input: number; output: number }
/** Quello che la sessione ha visto oltre al registro: i messaggi dell'ultima richiesta, i subagent, gli skill usati. */
export type Seen = {
  sent?: { n: number; messages: readonly ApiMessage[] }
  agents?: ReadonlyMap<string, AgentUse>
  skills?: ReadonlySet<string>
}

const pct = (part: number, whole: number) => `${whole > 0 ? Math.round((part / whole) * 100) : 0}%`
const k = (n: number) => fmtTokens(Math.round(n))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Come stringere le risposte di uno strumento.
const NARROWER: Record<string, string> = {
  Read: 'read a range with offset and limit, or Grep first',
  Bash: 'cut long output with head, tail or grep',
  Grep: 'narrow the pattern or the path, or ask for file names only',
  Glob: 'narrow the pattern',
  WebFetch: 'ask for the part you need',
  Agent: 'ask the agent for a shorter report',
}

const empty = (): Record<Tab, Stat[]> => ({ health: [], fill: [], waste: [], flow: [], tools: [] })

export function statsOf(l: Ledger, calls: Calls, breakdown?: SessionContextBreakdown, seen: Seen = {}): Stats {
  const done = l.turns.filter(t => t.input !== undefined)
  const window = breakdown?.rawMaxTokens ?? l.window
  const rows = empty()
  const tips: Tip[] = []
  const tip = (tab: Tab, level: Level, text: string) => tips.push({ tab, level, text })
  if (done.length === 0 && calls.size === 0) return { rows, categories: [], tools: [], tips: [{ tab: 'health', level: 'info', text: 'No requests yet: the numbers come after the first answer.' }] }
  const agentsUsed = (seen.agents?.size ?? 0) > 0 || [...AGENT_TOOLS].some(t => (calls.get(t)?.count ?? 0) > 0)

  // Quanto è pieno ora, quanto cresce a richiesta e quante ne restano.
  const last = done.at(-1)
  const used = last ? contextAfter(last) : undefined
  if (used !== undefined && window) {
    const recent = done.slice(-GROWTH_SPAN - 1)
    const steps = recent.slice(1).map((t, i) => (t.isCompacted ? undefined : (contextAfter(t) ?? 0) - (contextAfter(recent[i]!) ?? 0))).filter((g): g is number => g !== undefined)
    const growth = steps.length ? steps.reduce((s, g) => s + g, 0) / steps.length : 0
    const limit = breakdown?.autoCompactThreshold ?? window
    const left = growth > 0 ? Math.max(0, Math.floor((limit - used) / growth)) : undefined
    const isFull = used > limit * FULL_SHARE
    rows.health.push({
      label: 'in use',
      value: `${k(used)} · ${pct(used, window)}${growth > 0 ? ` · +${k(growth)} a request` : ''}${left !== undefined ? ` · ~${left} to go` : ''}`,
      level: isFull ? 'warn' : undefined,
    })
    if (isFull)
      tip(
        'health',
        'warn',
        `The context is ${pct(used, window)} full${left !== undefined ? `, about ${plural(left, 'request')} from ${breakdown?.autoCompactThreshold ? 'compaction' : 'the limit'}` : ''}: /compact at a good stopping point, or /clear before an unrelated task.`,
      )
  }

  // Quello che c'è prima della prima domanda: misurato sul primo turno, se no stimato da /context.
  const preloaded = l.baseline ?? l.system
  if (preloaded !== undefined) {
    const isHeavy = (window !== undefined && preloaded > window * PRELOAD_SHARE) || preloaded > PRELOAD_TOKENS
    rows.health.push({ label: 'preloaded', value: `${k(preloaded)}${window ? ` · ${pct(preloaded, window)} of ${k(window)}` : ''}`, level: isHeavy ? 'warn' : undefined })
    if (isHeavy) {
      const top = (breakdown?.categories ?? [])
        .filter(c => c.kind === 'used' && c.name !== 'Messages')
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 2)
        .map(c => `${c.name} ${k(c.tokens)}`)
      tip(
        'fill',
        'warn',
        `Before your first message the context already holds ${k(preloaded)}${window ? ` (${pct(preloaded, window)} of the window)` : ''}${top.length ? `, most of it ${top.join(' and ')}` : ''}: trim what loads up front.`,
      )
    }
  }

  // Le fonti che ogni richiesta si porta dietro, una per una, e quanto si usano.
  if (breakdown) {
    const servers = new Map<string, { tokens: number; tools: number; used: number }>()
    for (const t of breakdown.mcpTools) {
      if (!t.isLoaded) continue
      const s = servers.get(t.serverName) ?? { tokens: 0, tools: 0, used: 0 }
      servers.set(t.serverName, { tokens: s.tokens + t.tokens, tools: s.tools + 1, used: s.used + ((calls.get(t.name)?.count ?? 0) > 0 ? 1 : 0) })
    }
    const isLongEnough = done.length >= UNUSED_MIN_REQUESTS
    for (const [name, s] of [...servers].sort((a, b) => b[1].tokens - a[1].tokens)) {
      if (s.used < s.tools) rows.waste.push({ label: `MCP ${name}`, value: `${s.used} of ${plural(s.tools, 'tool')} used · ${k(s.tokens)} a request`, level: s.used === 0 && isLongEnough && s.tokens > HEAVY_SOURCE ? 'warn' : undefined })
      if (s.tokens <= HEAVY_SOURCE) continue
      if (s.used === 0 && isLongEnough)
        tip('waste', 'warn', `The MCP server ${name} puts ${k(s.tokens)} of tool schemas in every request and ${s.tools === 1 ? 'its one tool was' : `none of its ${s.tools} tools was`} called in ${done.length} requests: turn it off where you do not use it (/mcp).`)
      else tip('fill', 'info', `The MCP server ${name} puts ${k(s.tokens)} of tool schemas in every request: turn it off where you do not use it (/mcp).`)
    }
    for (const f of [...breakdown.memoryFiles].sort((a, b) => b.tokens - a.tokens))
      if (f.tokens > HEAVY_SOURCE) tip('fill', 'info', `${f.path} is ${k(f.tokens)} in every request: keep it short and move the details into files read when needed.`)
    const skills = breakdown.skills
    if (skills && skills.tokens > 0) {
      const usedSkills = seen.skills ? skills.skillFrontmatter.filter(x => seen.skills?.has(x.name)).length : undefined
      if (usedSkills !== undefined) rows.waste.push({ label: 'skills', value: `${usedSkills} of ${skills.includedSkills} used · ${k(skills.tokens)} a request` })
      if (skills.tokens > HEAVY_SOURCE)
        tip('fill', 'info', `The list of ${plural(skills.includedSkills, 'skill')} takes ${k(skills.tokens)}${usedSkills !== undefined ? `, ${usedSkills} used in this session` : ''}: turn off the ones you do not use.`)
    }
    const agents = breakdown.agents.reduce((s, a) => s + a.tokens, 0)
    if (agents > HEAVY_SOURCE) tip('fill', 'info', `The descriptions of ${breakdown.agents.length} custom agents take ${k(agents)}: keep them short, or remove the ones you do not use.`)
    // Gli schemi che restano fuori finché ToolSearch non li carica: contesto risparmiato.
    const deferred = breakdown.categories.filter(c => c.kind === 'deferred').reduce((s, c) => s + c.tokens, 0)
    const deferredMcp = breakdown.mcpTools.filter(t => !t.isLoaded).length
    if (deferred > 0) rows.fill.push({ label: 'deferred', value: `${k(deferred)} kept out until searched${deferredMcp ? ` · ${plural(deferredMcp, 'MCP tool')}` : ''}`, level: 'good' })
  }

  // L'ultima richiesta blocco per blocco: di cosa è fatta, cosa pesa, cosa si può togliere.
  const sentTurn = seen.sent ? done.find(t => t.n === seen.sent?.n) : undefined
  if (seen.sent && seen.sent.messages.length > 0) {
    const a = anatomyOf(seen.sent.messages)
    // I caratteri danno solo le proporzioni: il totale vero è l'input meno quello di prima della conversazione.
    const est = a.chars / CHARS_PER_TOKEN
    const measured = sentTurn?.input !== undefined && preloaded !== undefined ? sentTurn.input - preloaded : undefined
    const ratio = measured !== undefined && est > 0 ? measured / est : 1
    const factor = ratio > 1 / 3 && ratio < 3 ? ratio : 1
    const tok = (x: { chars: number }) => (x.chars / CHARS_PER_TOKEN) * factor
    const sum = (list: Iterable<Item>) => [...list].reduce((s, x) => s + tok(x), 0)
    const conversation = sum(a.items)
    const byKind = (kind: Kind) => a.items.filter(x => x.kind === kind)

    const kinds: Kind[] = ['results', 'calls', 'replies', 'thinking', 'prompts', 'reminders']
    const slices: Slice[] = [
      ...(preloaded !== undefined ? [{ kind: 'preloaded' as const, tokens: preloaded }] : []),
      ...kinds.map(kind => ({ kind, tokens: sum(byKind(kind)) })).filter(x => x.tokens > 0),
    ]
    const first = l.turns[0]?.n ?? 1
    const heaviest = [...a.items]
      .sort((x, y) => y.chars - x.chars)
      .slice(0, HEAVIEST)
      .filter(x => x.chars > 0)
      .map((x): Heavy => {
        const since = seen.sent!.n - x.age
        return { label: x.label, kind: x.kind, tokens: tok(x), message: x.message, block: x.block, ...(since >= first ? { since } : {}) }
      })
    const fill: Fill = { n: seen.sent.n, total: slices.reduce((s, x) => s + x.tokens, 0), slices, heaviest, isScaled: factor !== 1 }

    // Quello che si può togliere: vecchio, ripetuto o fallito, contato una volta sola.
    const stale = a.items.filter(x => x.kind === 'results' && x.age >= STALE_AGE)
    const copies = repeats(a.items)
    const failed = a.items.filter(x => x.kind === 'results' && x.isError)
    const reclaim = sum(new Set([...stale, ...copies, ...failed]))
    const reclaimRow: Stat =
      reclaim > 0 ? { label: 'reclaimable', value: `~${k(reclaim)} · ${pct(reclaim, conversation)} of the conversation` } : { label: 'reclaimable', value: 'nothing stale, repeated or failed', level: 'good' }
    rows.health.push(reclaimRow)
    const wasteRows: Stat[] = [reclaimRow]
    if (stale.length) wasteRows.push({ label: 'stale', value: `~${k(sum(stale))} · ${plural(stale.length, 'tool result')} from ${STALE_AGE}+ requests ago` })
    // Le copie per risposta: quella con più peso dà il nome.
    const groups = new Map<string, Item[]>()
    for (const x of copies) groups.set(x.same!, [...(groups.get(x.same!) ?? []), x])
    const worst = [...groups.values()].sort((x, y) => sum(y) - sum(x))[0]
    if (copies.length) wasteRows.push({ label: 'repeated', value: `~${k(sum(copies))} · ${plural(copies.length, 'extra copy', 'extra copies')}${worst ? ` · ${worst[0]!.label} ×${worst.length + 1}` : ''}` })
    if (failed.length) wasteRows.push({ label: 'failed', value: `~${k(sum(failed))} · ${plural(failed.length, 'error result')}` })
    // Prima quello che si può togliere, poi gli strumenti e gli skill mai usati.
    rows.waste.unshift(...wasteRows)

    if (sum(stale) > STALE_TOKENS && sum(stale) > conversation * STALE_SHARE)
      tip('waste', 'info', `Tool results from ${STALE_AGE} or more requests ago hold ~${k(sum(stale))} (${pct(sum(stale), conversation)} of the conversation): if the task has moved on, /compact keeps the gist and drops them.`)
    if (worst && sum(copies) > REPEAT_TOKENS)
      tip('waste', 'info', `${worst[0]!.label} came back ${worst.length + 1} times with the same text: ~${k(sum(worst))} of copies that add nothing.`)

    const reminders = byKind('reminders')
    if (sum(reminders) > REMINDER_TOKENS && sum(reminders) > conversation * REMINDER_SHARE)
      tip('fill', 'info', `Reminders and hook output take ~${k(sum(reminders))} in ${plural(reminders.length, 'block')}: what a hook adds to a prompt is carried by every request after it.`)
    const explored = sum(byKind('results').filter(x => EXPLORE_TOOLS.has(x.tool ?? '')))
    if (!agentsUsed && explored > EXPLORE_TOKENS)
      tip('fill', 'info', `Reads and searches hold ~${k(explored)} of this context: an Explore agent does that in its own context and brings back only what matters.`)
    const writes = sum(byKind('calls').filter(x => x.tool === 'Write'))
    if (writes > BIG_RESULT) tip('tools', 'info', `Write calls carry ~${k(writes)} of whole files in the context: Edit sends only the lines that change.`)

    return finish(fill)
  }
  return finish(undefined)

  function finish(fill: Fill | undefined): Stats {
    // La cache: la prima richiesta la scrive, le altre dovrebbero leggerla.
    const later = done.slice(1)
    const input = later.reduce((s, t) => s + (t.input ?? 0), 0)
    if (later.length > 0 && input > 0) {
      const cached = later.reduce((s, t) => s + (t.cacheRead ?? 0), 0)
      const breaks: number[] = []
      for (let i = 1; i < done.length; i++) {
        const t = done[i]!
        const p = done[i - 1]!
        if (!t.isCompacted && (t.cacheRead ?? 0) < (p.input ?? 0) * CACHE_BREAK) breaks.push(t.n)
      }
      const isLow = later.length >= CACHE_MIN_REQUESTS - 1 && cached / input < CACHE_SHARE
      const broke = breaks.length ? ` · broke ${breaks.length}× (${breaks.slice(-3).map(n => `#${n}`).join(' ')})` : ''
      const row: Stat = { label: 'cache', value: `${pct(cached, input)} of the input read from the cache${broke}`, level: isLow ? 'warn' : 'good' }
      rows.health.push(row)
      rows.flow.push(row)
      if (isLow)
        tip(
          'flow',
          'warn',
          `Only ${pct(cached, input)} of the input came from the prompt cache: a long pause lets it lapse, and a change to the system prompt or the tools (an MCP server reconnecting, /model) sends it all again.`,
        )
      else if (breaks.length >= CACHE_BREAKS)
        tip('flow', 'info', `The prompt cache broke ${breaks.length} times (${breaks.map(n => `#${n}`).join(', ')}), and each time the whole context went again at full price: a pause longer than the cache lasts, or a change to the tools or the system prompt, does it.`)
    }

    // Le richieste, e quante ne ha fatte il prompt più lungo.
    const perPrompt = new Map<string, number>()
    for (const t of l.turns) perPrompt.set(t.turnId, (perPrompt.get(t.turnId) ?? 0) + 1)
    const longest = Math.max(0, ...perPrompt.values())
    rows.flow.unshift({ label: 'requests', value: `${l.turns.length} in ${plural(perPrompt.size, 'prompt')} · up to ${longest} in one` })
    if (longest > LONG_LOOP) tip('flow', 'info', `One prompt took ${longest} requests, each one carrying the whole context: smaller, sharper prompts keep the loop short.`)

    // Quanto si è mandato in tutto: ogni richiesta rimanda il contesto intero.
    const sent = done.reduce((s, t) => s + (t.input ?? 0), 0)
    if (sent > 0) {
      const fresh = done.reduce((s, t) => s + Math.max(0, (t.input ?? 0) - (t.cacheRead ?? 0)), 0)
      rows.flow.splice(1, 0, { label: 'input', value: `${k(sent)} in all · ${k(sent / done.length)} a request · ${k(fresh)} uncached` })
    }

    // L'output, quanto ne è ragionamento e quante risposte sono state tagliate.
    const output = done.reduce((s, t) => s + (t.output ?? 0), 0)
    if (output > 0) {
      const thinking = done.reduce((s, t) => s + t.answer.filter(b => b.kind === 'thinking').reduce((x, b) => x + b.tokens, 0), 0)
      const cut = done.filter(t => t.answer.some(b => b.kind === 'truncated')).length
      rows.flow.push({ label: 'output', value: `${k(output)}${thinking > 0 ? ` · ${pct(thinking, output)} thinking` : ''}${cut ? ` · ${cut} cut off` : ''}`, level: cut ? 'warn' : undefined })
    }
    // Le compattazioni, e quanto hanno liberato.
    const compacted = done.filter(t => t.isCompacted)
    if (compacted.length > 0) {
      const freed = compacted.reduce((s, t) => {
        const p = previous(l, t)
        const before = p ? contextAfter(p) : undefined
        return s + (before !== undefined ? Math.max(0, before - (t.input ?? 0)) : 0)
      }, 0)
      rows.flow.push({ label: 'compacted', value: `${plural(compacted.length, 'time')}${freed > 0 ? ` · freed ${k(freed)}` : ''}` })
    }

    // Gli strumenti: le chiamate e quanto pesano le loro risposte nel contesto.
    const weight = new Map<string, { tokens: number; biggest: number; results: number }>()
    for (const t of l.turns)
      for (const b of t.added) {
        if (b.kind !== 'tool_result') continue
        const name = b.label.replace(/^Tool result · /, '')
        const w = weight.get(name) ?? { tokens: 0, biggest: 0, results: 0 }
        weight.set(name, { tokens: w.tokens + b.tokens, biggest: Math.max(w.biggest, b.tokens), results: w.results + 1 })
      }

    // I subagent: quanto hanno letto nel loro contesto e quanto ne è tornato in questo.
    if (seen.agents && seen.agents.size > 0) {
      const all = [...seen.agents.values()]
      const kept = all.reduce((s, a) => s + a.peak, 0)
      const back = [...AGENT_TOOLS].reduce((s, t) => s + (weight.get(t)?.tokens ?? 0), 0)
      rows.flow.push({ label: 'subagents', value: `${seen.agents.size} · ${plural(all.reduce((s, a) => s + a.requests, 0), 'request')} · ~${k(kept)} kept out · ${k(back)} back` })
      if (back > AGENT_REPORT) tip('flow', 'info', `Agent reports weigh ${k(back)} in this context: ask for a short summary, and for the details in a file.`)
    }

    const tools: Share[] = [...calls]
      .map(([name, c]) => ({ name, count: c.count, failed: c.failed, tokens: weight.get(name)?.tokens ?? 0, results: weight.get(name)?.results ?? 0 }))
      .sort((a, b) => b.count - a.count || b.tokens - a.tokens)
    const total = tools.reduce((s, t) => s + (t.count ?? 0), 0)
    const failed = tools.reduce((s, t) => s + (t.failed ?? 0), 0)
    const isFailing = total >= FAILED_MIN_CALLS && failed / total > FAILED_SHARE
    if (total > 0) rows.tools.push({ label: 'tool calls', value: `${total}${failed > 0 ? ` · ${failed} failed or denied` : ''}`, level: isFailing ? 'warn' : undefined })
    if (isFailing) tip('tools', 'warn', `${failed} of ${total} tool calls failed or were denied: each one is a round trip that stays in the context.`)
    for (const [name, w] of [...weight].sort((a, b) => b[1].tokens - a[1].tokens)) {
      if (w.biggest < BIG_RESULT && (w.results < 2 || w.tokens / w.results < HEAVY_AVERAGE)) continue
      tip('tools', 'info', `${name} results weigh ${k(w.tokens)} in all, the biggest ${k(w.biggest)}: ${NARROWER[name] ?? 'ask for narrower output'}.`)
    }

    // Il contesto per categoria, come /context.
    const categories = (breakdown?.categories ?? [])
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, TOP_CATEGORIES)
      .map(c => ({ name: c.name, tokens: c.tokens }))

    if (tips.length === 0) tip('health', 'good', 'Nothing to trim for now.')
    return { rows, ...(fill ? { fill } : {}), categories, tools: tools.slice(0, TOP_TOOLS), tips }
  }
}

const KIND_NAME: Record<Slice['kind'], string> = {
  preloaded: 'preloaded (system prompt, tools, memory)',
  results: 'tool results',
  calls: 'tool calls',
  replies: 'replies',
  thinking: 'thinking',
  prompts: 'prompts',
  reminders: 'reminders and hook output',
}

/** Le statistiche in testo semplice, vista per vista: i numeri che l'analisi dà al modello. */
export function statsText(s: Stats): string {
  const out: string[] = []
  const rows = (list: readonly Stat[]) => list.forEach(r => out.push(`- ${r.label}: ${r.value}${r.level === 'warn' ? ' (warning)' : ''}`))
  for (const tab of TABS) {
    const list = s.rows[tab]
    const isFill = tab === 'fill' && s.fill
    if (list.length === 0 && !isFill && !(tab === 'tools' && s.tools.length)) continue
    out.push('', `## ${tab}`)
    if (tab === 'fill' && s.fill) {
      const f = s.fill
      out.push(`What request #${f.n} carried, ${f.isScaled ? 'from characters scaled to the measured input' : 'estimated from characters'}:`)
      for (const x of f.slices) out.push(`- ${KIND_NAME[x.kind]}: ~${k(x.tokens)} · ${pct(x.tokens, f.total)}`)
      out.push('Heaviest blocks:')
      for (const x of f.heaviest) out.push(`- ${x.label} (${x.kind}): ~${k(x.tokens)}${x.since !== undefined ? ` · since #${x.since}` : ''}`)
      if (s.categories.length) {
        out.push('By category, as /context counts it:')
        for (const c of s.categories) out.push(`- ${c.name}: ${k(c.tokens)}`)
      }
    }
    rows(list)
    if (tab === 'tools')
      for (const t of s.tools) out.push(`- ${t.name}: ${plural(t.count ?? 0, 'call')}${t.failed ? ` (${t.failed} failed)` : ''} · ${k(t.tokens)} of results in the context`)
  }
  if (s.tips.length) {
    out.push('', '## tips')
    for (const t of s.tips) out.push(`- ${t.level}: ${t.text}`)
  }
  return out.join('\n').trim()
}
