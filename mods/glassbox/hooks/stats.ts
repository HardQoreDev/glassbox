// Le statistiche della tendina `stats` di CONTEXT: quanto contesto c'è già
// prima della prima domanda, quanto ne è in uso e quanto cresce, quanto arriva
// dalla cache, gli strumenti più usati e quanto pesano le loro risposte, il
// contesto per categoria come lo divide /context. Dai numeri, i consigli.
import type { SessionContextBreakdown } from 'claude-code'

import { contextAfter, fmtTokens } from './vendor/turns'
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
// Una risposta di uno strumento così grande, o una media così, pesa.
export const BIG_RESULT = 10_000
const HEAVY_AVERAGE = 5_000
// Quello che ogni richiesta si porta dietro: un server MCP, un file di memoria,
// l'elenco degli skill, le descrizioni degli agenti.
export const HEAVY_SOURCE = 5_000
// Le chiamate fallite o negate, su almeno qualche chiamata.
export const FAILED_SHARE = 0.2
const FAILED_MIN_CALLS = 5
// Le richieste di un solo prompt.
export const LONG_LOOP = 25
// Le richieste su cui si misura quanto cresce il contesto.
const GROWTH_SPAN = 10
const TOP_TOOLS = 6
const TOP_CATEGORIES = 6

export type Level = 'warn' | 'info' | 'good'
export type Stat = { label: string; value: string; level?: Level }
export type Share = { name: string; tokens: number; count?: number; failed?: number }
export type Tip = { level: Level; text: string }
export type Stats = { rows: Stat[]; categories: Share[]; tools: Share[]; tips: Tip[] }

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`
const k = (n: number) => fmtTokens(Math.round(n))

// Come stringere le risposte di uno strumento.
const NARROWER: Record<string, string> = {
  Read: 'read a range with offset and limit, or Grep first',
  Bash: 'cut long output with head, tail or grep',
  Grep: 'narrow the pattern or the path, or ask for file names only',
  Glob: 'narrow the pattern',
  WebFetch: 'ask for the part you need',
  Agent: 'ask the agent for a shorter report',
}

export type Calls = ReadonlyMap<string, { count: number; failed: number }>

export function statsOf(l: Ledger, calls: Calls, breakdown?: SessionContextBreakdown): Stats {
  const done = l.turns.filter(t => t.input !== undefined)
  const window = breakdown?.rawMaxTokens ?? l.window
  const rows: Stat[] = []
  const tips: Tip[] = []
  if (done.length === 0 && calls.size === 0) return { rows, categories: [], tools: [], tips: [{ level: 'info', text: 'No requests yet: the numbers come after the first answer.' }] }

  // Le richieste, e quante ne ha fatte il prompt più lungo.
  const perPrompt = new Map<string, number>()
  for (const t of l.turns) perPrompt.set(t.turnId, (perPrompt.get(t.turnId) ?? 0) + 1)
  const longest = Math.max(0, ...perPrompt.values())
  rows.push({ label: 'requests', value: `${l.turns.length} in ${perPrompt.size} ${perPrompt.size === 1 ? 'prompt' : 'prompts'} · up to ${longest} in one` })
  if (longest > LONG_LOOP) tips.push({ level: 'info', text: `One prompt took ${longest} requests, each one carrying the whole context: smaller, sharper prompts keep the loop short.` })

  // Quello che c'è prima della prima domanda: misurato sul primo turno, se no stimato da /context.
  const preloaded = l.baseline ?? l.system
  if (preloaded !== undefined) {
    const isHeavy = (window !== undefined && preloaded > window * PRELOAD_SHARE) || preloaded > PRELOAD_TOKENS
    rows.push({ label: 'preloaded', value: `${k(preloaded)}${window ? ` · ${pct(preloaded, window)} of ${k(window)}` : ''}`, level: isHeavy ? 'warn' : undefined })
    if (isHeavy) {
      const top = (breakdown?.categories ?? [])
        .filter(c => c.kind === 'used' && c.name !== 'Messages')
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 2)
        .map(c => `${c.name} ${k(c.tokens)}`)
      tips.push({
        level: 'warn',
        text: `Before your first message the context already holds ${k(preloaded)}${window ? ` (${pct(preloaded, window)} of the window)` : ''}${top.length ? `, most of it ${top.join(' and ')}` : ''}: trim what loads up front.`,
      })
    }
  }

  // Le fonti che ogni richiesta si porta dietro, una per una.
  if (breakdown) {
    const servers = new Map<string, number>()
    for (const t of breakdown.mcpTools) if (t.isLoaded) servers.set(t.serverName, (servers.get(t.serverName) ?? 0) + t.tokens)
    for (const [name, tokens] of [...servers].sort((a, b) => b[1] - a[1]))
      if (tokens > HEAVY_SOURCE) tips.push({ level: 'info', text: `The MCP server ${name} puts ${k(tokens)} of tool schemas in every request: turn it off where you do not use it (/mcp).` })
    for (const f of [...breakdown.memoryFiles].sort((a, b) => b.tokens - a.tokens))
      if (f.tokens > HEAVY_SOURCE) tips.push({ level: 'info', text: `${f.path} is ${k(f.tokens)} in every request: keep it short and move the details into files read when needed.` })
    if ((breakdown.skills?.tokens ?? 0) > HEAVY_SOURCE) tips.push({ level: 'info', text: `The list of skills takes ${k(breakdown.skills?.tokens ?? 0)}: turn off the ones you do not use.` })
    const agents = breakdown.agents.reduce((s, a) => s + a.tokens, 0)
    if (agents > HEAVY_SOURCE) tips.push({ level: 'info', text: `The descriptions of ${breakdown.agents.length} custom agents take ${k(agents)}: keep them short, or remove the ones you do not use.` })
  }

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
    rows.push({
      label: 'in use',
      value: `${k(used)} · ${pct(used, window)}${growth > 0 ? ` · +${k(growth)} a request` : ''}${left !== undefined ? ` · ~${left} to go` : ''}`,
      level: isFull ? 'warn' : undefined,
    })
    if (isFull)
      tips.push({
        level: 'warn',
        text: `The context is ${pct(used, window)} full${left !== undefined ? `, about ${left} ${left === 1 ? 'request' : 'requests'} from ${breakdown?.autoCompactThreshold ? 'compaction' : 'the limit'}` : ''}: /compact at a good stopping point, or /clear before an unrelated task.`,
      })
  }

  // La cache: la prima richiesta la scrive, le altre dovrebbero leggerla.
  const later = done.slice(1)
  const input = later.reduce((s, t) => s + (t.input ?? 0), 0)
  if (later.length > 0 && input > 0) {
    const cached = later.reduce((s, t) => s + (t.cacheRead ?? 0), 0)
    const isLow = later.length >= CACHE_MIN_REQUESTS - 1 && cached / input < CACHE_SHARE
    rows.push({ label: 'cache', value: `${pct(cached, input)} of the input read from the cache`, level: isLow ? 'warn' : 'good' })
    if (isLow)
      tips.push({
        level: 'warn',
        text: `Only ${pct(cached, input)} of the input came from the prompt cache: a long pause lets it lapse, and a change to the system prompt or the tools (an MCP server reconnecting, /model) sends it all again.`,
      })
  }

  // L'output, e quanto ne è ragionamento.
  const output = done.reduce((s, t) => s + (t.output ?? 0), 0)
  if (output > 0) {
    const thinking = done.reduce((s, t) => s + t.answer.filter(b => b.kind === 'thinking').reduce((x, b) => x + b.tokens, 0), 0)
    rows.push({ label: 'output', value: `${k(output)}${thinking > 0 ? ` · ${pct(thinking, output)} thinking` : ''}` })
  }
  const compactions = done.filter(t => t.isCompacted).length
  if (compactions > 0) rows.push({ label: 'compacted', value: `${compactions} ${compactions === 1 ? 'time' : 'times'}` })

  // Gli strumenti: le chiamate e quanto pesano le loro risposte nel contesto.
  const weight = new Map<string, { tokens: number; biggest: number; results: number }>()
  for (const t of l.turns)
    for (const b of t.added) {
      if (b.kind !== 'tool_result') continue
      const name = b.label.replace(/^Tool result · /, '')
      const w = weight.get(name) ?? { tokens: 0, biggest: 0, results: 0 }
      weight.set(name, { tokens: w.tokens + b.tokens, biggest: Math.max(w.biggest, b.tokens), results: w.results + 1 })
    }
  const tools: Share[] = [...calls]
    .map(([name, c]) => ({ name, count: c.count, failed: c.failed, tokens: weight.get(name)?.tokens ?? 0 }))
    .sort((a, b) => b.count - a.count || b.tokens - a.tokens)
  const total = tools.reduce((s, t) => s + (t.count ?? 0), 0)
  const failed = tools.reduce((s, t) => s + (t.failed ?? 0), 0)
  if (total > 0) rows.push({ label: 'tool calls', value: `${total}${failed > 0 ? ` · ${failed} failed or denied` : ''}`, level: total >= FAILED_MIN_CALLS && failed / total > FAILED_SHARE ? 'warn' : undefined })
  if (total >= FAILED_MIN_CALLS && failed / total > FAILED_SHARE)
    tips.push({ level: 'warn', text: `${failed} of ${total} tool calls failed or were denied: each one is a round trip that stays in the context.` })
  for (const [name, w] of [...weight].sort((a, b) => b[1].tokens - a[1].tokens)) {
    if (w.biggest < BIG_RESULT && (w.results < 2 || w.tokens / w.results < HEAVY_AVERAGE)) continue
    tips.push({ level: 'info', text: `${name} results weigh ${k(w.tokens)} in all, the biggest ${k(w.biggest)}: ${NARROWER[name] ?? 'ask for narrower output'}.` })
  }

  // Il contesto per categoria, come /context.
  const categories = (breakdown?.categories ?? [])
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP_CATEGORIES)
    .map(c => ({ name: c.name, tokens: c.tokens }))

  if (tips.length === 0) tips.push({ level: 'good', text: 'Nothing to trim for now.' })
  return { rows, categories, tools: tools.slice(0, TOP_TOOLS), tips }
}
