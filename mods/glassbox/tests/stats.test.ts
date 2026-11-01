import { describe, expect, test } from 'claude-code/testing'
import type { SessionContextBreakdown } from 'claude-code'

import { statsOf } from '../hooks/stats'
import { createLedger } from '../hooks/vendor/turns'
import type { Block, Ledger, Turn } from '../hooks/vendor/turns'

// Un turno finito: quanto ha mandato, quanto dalla cache, quanto ha risposto,
// le risposte degli strumenti che portava e il ragionamento della risposta.
const turn = (n: number, prompt: string, input: number, cached: number, output: number, extra: { results?: [string, number][]; thinking?: number; compacted?: boolean } = {}): Turn => ({
  n,
  turnId: prompt,
  step: 0,
  prompt,
  status: 'done',
  input,
  cacheRead: cached,
  cacheWrite: 0,
  output,
  added: (extra.results ?? []).map(([tool, tokens]): Block => ({ kind: 'tool_result', label: `Tool result · ${tool}`, tokens, chars: tokens * 4, isEstimate: true })),
  answer: extra.thinking ? [{ kind: 'thinking', label: 'Thinking', tokens: extra.thinking, chars: 0, isEstimate: true }] : [],
  isCompacted: extra.compacted ?? false,
  isFirst: n === 1,
})

const ledger = (turns: Turn[], baseline?: number): Ledger => ({ ...createLedger(), turns, window: 200_000, ...(baseline !== undefined ? { baseline } : {}) })

const breakdown = (over: Partial<SessionContextBreakdown> = {}): SessionContextBreakdown =>
  ({
    rawMaxTokens: 200_000,
    categories: [
      { name: 'System prompt', tokens: 8_000, color: '', isDeferred: false, kind: 'used' },
      { name: 'MCP tools', tokens: 31_000, color: '', isDeferred: false, kind: 'used' },
      { name: 'Memory files', tokens: 12_000, color: '', isDeferred: false, kind: 'used' },
      { name: 'Messages', tokens: 40_000, color: '', isDeferred: false, kind: 'used' },
      { name: 'Free space', tokens: 100_000, color: '', isDeferred: false, kind: 'free' },
    ],
    mcpTools: [
      { name: 'a', serverName: 'jira', tokens: 20_000, isLoaded: true, path: '' },
      { name: 'b', serverName: 'jira', tokens: 6_000, isLoaded: true, path: '' },
      { name: 'c', serverName: 'small', tokens: 5_000, isLoaded: true, path: '' },
      { name: 'd', serverName: 'later', tokens: 9_000, isLoaded: false, path: '' },
    ],
    memoryFiles: [
      { path: '/r/CLAUDE.md', type: 'Project', tokens: 9_000 },
      { path: '/home/u/.claude/CLAUDE.md', type: 'User', tokens: 3_000 },
    ],
    agents: [],
    ...over,
  }) as never

const tips = (s: ReturnType<typeof statsOf>) => s.tips.map(t => t.text)
const row = (s: ReturnType<typeof statsOf>, label: string) => s.rows.find(r => r.label === label)

describe('le statistiche di CONTEXT', () => {
  test('prima della prima richiesta non ci sono numeri', () => {
    expect(statsOf(ledger([]), new Map())).toEqual({ rows: [], categories: [], tools: [], tips: [{ level: 'info', text: 'No requests yet: the numbers come after the first answer.' }] })
  })

  test('troppo contesto prima della prima domanda: quanto, e da dove viene', () => {
    const s = statsOf(ledger([turn(1, 'a', 60_000, 0, 500)], 59_000), new Map(), breakdown())
    expect(row(s, 'preloaded')).toEqual({ label: 'preloaded', value: '59.0k · 30% of 200k', level: 'warn' })
    expect(tips(s)).toContain('Before your first message the context already holds 59.0k (30% of the window), most of it MCP tools 31.0k and Memory files 12.0k: trim what loads up front.')
    // Ogni fonte pesante a parte: il server con più schemi, il CLAUDE.md lungo; non quelli piccoli o non caricati.
    expect(tips(s)).toContain('The MCP server jira puts 26.0k of tool schemas in every request: turn it off where you do not use it (/mcp).')
    expect(tips(s)).toContain('/r/CLAUDE.md is 9.0k in every request: keep it short and move the details into files read when needed.')
    expect(tips(s).some(t => t.includes('small') || t.includes('later') || t.includes('.claude/CLAUDE.md'))).toBe(false)
    // Per categoria, come /context: solo quelle in uso, dalla più grande.
    expect(s.categories.map(c => c.name)).toEqual(['Messages', 'MCP tools', 'Memory files', 'System prompt'])
  })

  test('con una finestra grande contano anche i token', () => {
    const s = statsOf({ ...ledger([turn(1, 'a', 70_000, 0, 500)], 65_000), window: 1_000_000 }, new Map())
    expect(row(s, 'preloaded')?.level).toBe('warn')
    expect(statsOf({ ...ledger([turn(1, 'a', 30_000, 0, 500)], 25_000), window: 1_000_000 }, new Map()).tips).toEqual([{ level: 'good', text: 'Nothing to trim for now.' }])
  })

  test('contesto quasi pieno: quanto cresce a richiesta e quante ne restano', () => {
    const turns = [turn(1, 'a', 120_000, 0, 1_000), turn(2, 'a', 125_000, 120_000, 1_000), turn(3, 'a', 140_000, 125_000, 1_000)]
    const s = statsOf(ledger(turns, 20_000), new Map())
    // Da 121k a 141k in due richieste: 10k a richiesta, 5 per arrivare a 200k.
    expect(row(s, 'in use')).toEqual({ label: 'in use', value: '141k · 71% · +10.0k a request · ~5 to go', level: 'warn' })
    expect(tips(s)).toContain('The context is 71% full, about 5 requests from the limit: /compact at a good stopping point, or /clear before an unrelated task.')
    // Con la compattazione automatica la soglia è la sua.
    const auto = statsOf(ledger(turns, 20_000), new Map(), breakdown({ autoCompactThreshold: 160_000, mcpTools: [], memoryFiles: [] }))
    expect(tips(auto)).toContain('The context is 71% full, about 1 request from compaction: /compact at a good stopping point, or /clear before an unrelated task.')
  })

  test('cache che non regge, risposte pesanti, chiamate fallite, prompt lunghi', () => {
    const turns = [
      turn(1, 'a', 20_000, 0, 100),
      turn(2, 'a', 30_000, 5_000, 100, { results: [['Read', 12_000]] }),
      turn(3, 'a', 40_000, 10_000, 100, { results: [['Read', 6_000], ['Bash', 300]] }),
      turn(4, 'a', 50_000, 20_000, 100, { thinking: 60 }),
    ]
    const calls = new Map([
      ['Read', { count: 4, failed: 0 }],
      ['Bash', { count: 6, failed: 3 }],
    ])
    const s = statsOf(ledger(turns, 15_000), calls)
    expect(row(s, 'cache')).toEqual({ label: 'cache', value: '29% of the input read from the cache', level: 'warn' })
    expect(row(s, 'output')?.value).toBe('400 · 15% thinking')
    expect(row(s, 'tool calls')).toEqual({ label: 'tool calls', value: '10 · 3 failed or denied', level: 'warn' })
    expect(s.tools).toEqual([
      { name: 'Bash', count: 6, failed: 3, tokens: 300 },
      { name: 'Read', count: 4, failed: 0, tokens: 18_000 },
    ])
    expect(tips(s)).toEqual([
      'Only 29% of the input came from the prompt cache: a long pause lets it lapse, and a change to the system prompt or the tools (an MCP server reconnecting, /model) sends it all again.',
      '3 of 10 tool calls failed or were denied: each one is a round trip that stays in the context.',
      'Read results weigh 18.0k in all, the biggest 12.0k: read a range with offset and limit, or Grep first.',
    ])

    const loop = Array.from({ length: 26 }, (_, i) => turn(i + 1, 'lungo', 10_000 + i * 100, i === 0 ? 0 : 10_000, 50))
    expect(tips(statsOf(ledger(loop, 9_000), new Map()))).toContain('One prompt took 26 requests, each one carrying the whole context: smaller, sharper prompts keep the loop short.')
  })

  test('le compattazioni si contano, e la crescita non le scambia per un calo', () => {
    const s = statsOf(ledger([turn(1, 'a', 100_000, 0, 1_000), turn(2, 'a', 20_000, 0, 1_000, { compacted: true }), turn(3, 'a', 25_000, 20_000, 1_000)], 10_000), new Map())
    expect(row(s, 'compacted')?.value).toBe('1 time')
    expect(row(s, 'in use')?.value).toBe('26.0k · 13% · +5.0k a request · ~34 to go')
  })
})
