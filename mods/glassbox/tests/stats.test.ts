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
const row = (s: ReturnType<typeof statsOf>, label: string) => Object.values(s.rows).flat().find(r => r.label === label)

describe('le statistiche di CONTEXT', () => {
  test('prima della prima richiesta non ci sono numeri', () => {
    expect(statsOf(ledger([]), new Map())).toEqual({
      rows: { health: [], fill: [], waste: [], flow: [], tools: [] },
      categories: [],
      tools: [],
      tips: [{ tab: 'health', level: 'info', text: 'No requests yet: the numbers come after the first answer.' }],
    })
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
    expect(statsOf({ ...ledger([turn(1, 'a', 30_000, 0, 500)], 25_000), window: 1_000_000 }, new Map()).tips).toEqual([{ tab: 'health', level: 'good', text: 'Nothing to trim for now.' }])
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
    // Le richieste 2 e 3 leggono dalla cache meno di metà dell'input di quella prima.
    expect(row(s, 'cache')).toEqual({ label: 'cache', value: '29% of the input read from the cache · broke 2× (#2 #3)', level: 'warn' })
    expect(row(s, 'input')?.value).toBe('140k in all · 35.0k a request · 105k uncached')
    expect(row(s, 'output')?.value).toBe('400 · 15% thinking')
    expect(row(s, 'tool calls')).toEqual({ label: 'tool calls', value: '10 · 3 failed or denied', level: 'warn' })
    expect(s.tools).toEqual([
      { name: 'Bash', count: 6, failed: 3, tokens: 300, results: 1 },
      { name: 'Read', count: 4, failed: 0, tokens: 18_000, results: 2 },
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
    // Da 101k a 20k: la compattazione ne ha liberati 81k.
    expect(row(s, 'compacted')?.value).toBe('1 time · freed 81.0k')
    expect(row(s, 'in use')?.value).toBe('26.0k · 13% · +5.0k a request · ~34 to go')
  })
})

// I messaggi di una richiesta: un prompt con un reminder, poi `n` giri in cui
// il modello chiama uno strumento e la sua risposta torna.
type Msg = { role: 'user' | 'assistant'; content: { type: string; [k: string]: unknown }[] }
const loop = (calls: { name: string; input: Record<string, unknown>; result: string; isError?: boolean }[]): Msg[] => [
  { role: 'user', content: [{ type: 'text', text: '<system-reminder>' + 'r'.repeat(396) + '</system-reminder>' }, { type: 'text', text: 'fix the login' }] },
  ...calls.flatMap((c, i): Msg[] => [
    { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: c.name, input: c.input }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: c.result, ...(c.isError ? { is_error: true } : {}) }] },
  ]),
]

describe('le statistiche dai messaggi dell’ultima richiesta', () => {
  test('fill: di cosa è fatto il contesto, e cosa pesa di più', () => {
    const messages = loop([
      { name: 'Read', input: { file_path: '/r/src/login.ts' }, result: 'x'.repeat(8_000) },
      { name: 'Bash', input: { command: 'npm test' }, result: 'y'.repeat(2_000) },
    ])
    // 10.4k caratteri di blocchi sono circa 2.6k token: l'input misurato, meno i 10k di prima, ne dà 2.7k.
    const s = statsOf(ledger([turn(1, 'a', 10_000, 0, 50), turn(2, 'a', 12_700, 10_000, 50)], 10_000), new Map(), undefined, { sent: { n: 2, messages } })
    expect(s.fill?.n).toBe(2)
    expect(s.fill?.isScaled).toBe(true)
    expect(Math.round(s.fill!.total)).toBe(12_700)
    expect(s.fill?.slices.map(x => x.kind)).toEqual(['preloaded', 'results', 'calls', 'prompts', 'reminders'])
    // I più pesanti: la lettura, poi il test; ognuno con il suo posto nella richiesta e la richiesta in cui è entrato.
    expect(s.fill?.heaviest.slice(0, 2).map(x => [x.label, x.kind, x.message, x.block, x.since])).toEqual([
      ['Read login.ts', 'results', 2, 0, 1],
      ['Bash npm test', 'results', 4, 0, 2],
    ])
    expect(row(s, 'reclaimable')).toEqual({ label: 'reclaimable', value: 'nothing stale, repeated or failed', level: 'good' })
  })

  test('waste: risposte vecchie, ripetute e fallite, contate una volta sola', () => {
    const same = { name: 'Read', input: { file_path: '/r/a.ts' }, result: 'a'.repeat(20_000) }
    const messages = loop([
      same,
      same,
      { name: 'Bash', input: { command: 'make' }, result: 'boom', isError: true },
      ...Array.from({ length: 10 }, (_, i) => ({ name: 'Grep', input: { pattern: `p${i}` }, result: `r${i}` })),
    ])
    const s = statsOf(ledger([turn(1, 'a', 30_000, 0, 50)]), new Map(), undefined, { sent: { n: 1, messages } })
    // La prima lettura è vecchia e anche ripetuta: nel totale entra una volta.
    expect(row(s, 'stale')?.value).toBe('~10.0k · 3 tool results from 10+ requests ago')
    expect(row(s, 'repeated')?.value).toBe('~5.0k · 1 extra copy · Read a.ts ×2')
    expect(row(s, 'failed')?.value).toBe('~1 · 1 error result')
    expect(row(s, 'reclaimable')?.value).toMatch(/^~10\.0k · \d+% of the conversation$/)
    expect(s.rows.waste.map(r => r.label)).toEqual(['reclaimable', 'stale', 'repeated', 'failed'])
    expect(tips(s)).toContain('Read a.ts came back 2 times with the same text: ~5.0k of copies that add nothing.')
    // 10k di letture e ricerche non bastano per consigliare un Explore; 40k sì, se non ci sono subagent.
    expect(tips(s).some(t => t.includes('Explore'))).toBe(false)
    const big = loop([{ name: 'Read', input: { file_path: '/r/b.ts' }, result: 'b'.repeat(160_000) }])
    const explore = 'Reads and searches hold ~40.0k of this context: an Explore agent does that in its own context and brings back only what matters.'
    expect(tips(statsOf(ledger([turn(1, 'a', 30_000, 0, 50)]), new Map(), undefined, { sent: { n: 1, messages: big } }))).toContain(explore)
    expect(tips(statsOf(ledger([turn(1, 'a', 30_000, 0, 50)]), new Map(), undefined, { sent: { n: 1, messages: big }, agents: new Map([['x', { requests: 1, peak: 1, input: 1, output: 1 }]]) }))).not.toContain(explore)
  })

  test('reminder pesanti e file scritti per intero', () => {
    const messages: Msg[] = [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>' + 'r'.repeat(30_000) + '</system-reminder>' }, { type: 'text', text: 'go' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'w', name: 'Write', input: { file_path: '/r/big.ts', content: 'w'.repeat(48_000) } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w', content: 'ok' }] },
    ]
    const s = statsOf(ledger([turn(1, 'a', 30_000, 0, 50)]), new Map(), undefined, { sent: { n: 1, messages } })
    expect(tips(s).find(t => t.startsWith('Reminders and hook output take ~7.5k in 1 block'))).toBeDefined()
    expect(tips(s).find(t => t.startsWith('Write calls carry ~12.0k of whole files'))).toBeDefined()
    expect(s.tips.find(t => t.text.startsWith('Write'))?.tab).toBe('tools')
  })

  test('server MCP e skill caricati e mai usati, schemi rimandati a ToolSearch', () => {
    const five = Array.from({ length: 5 }, (_, i) => turn(i + 1, 'a', 50_000, i ? 49_000 : 0, 100))
    const calls = new Map([['c', { count: 2, failed: 0 }]])
    const b = breakdown({
      categories: [
        { name: 'MCP tools', tokens: 31_000, color: '', isDeferred: false, kind: 'used' },
        { name: 'MCP tools (deferred)', tokens: 9_000, color: '', isDeferred: true, kind: 'deferred' },
      ],
      skills: { totalSkills: 3, includedSkills: 3, tokens: 6_000, skillFrontmatter: [{ name: 'a', source: 'plugin', tokens: 2_000 }, { name: 'b', source: 'plugin', tokens: 2_000 }, { name: 'c', source: 'plugin', tokens: 2_000 }] } as never,
    })
    const s = statsOf(ledger(five, 40_000), calls, b, { skills: new Set(['b']) })
    expect(row(s, 'MCP jira')).toEqual({ label: 'MCP jira', value: '0 of 2 tools used · 26.0k a request', level: 'warn' })
    expect(s.rows.waste.some(r => r.label === 'MCP small')).toBe(false)
    expect(row(s, 'skills')?.value).toBe('1 of 3 used · 6.0k a request')
    expect(row(s, 'deferred')).toEqual({ label: 'deferred', value: '9.0k kept out until searched · 1 MCP tool', level: 'good' })
    expect(tips(s)).toContain('The MCP server jira puts 26.0k of tool schemas in every request and none of its 2 tools was called in 5 requests: turn it off where you do not use it (/mcp).')
    expect(tips(s)).toContain('The list of 3 skills takes 6.0k, 1 used in this session: turn off the ones you do not use.')
  })

  test('flow: la cache che si rompe, i subagent e i loro resoconti', () => {
    const turns = Array.from({ length: 8 }, (_, i) => turn(i + 1, 'a', 100_000, i === 0 || i === 3 || i === 6 ? 0 : 99_000, 100, i === 5 ? { results: [['Agent', 24_000]] } : {}))
    const agents = new Map([
      ['a1', { requests: 12, peak: 80_000, input: 600_000, output: 4_000 }],
      ['a2', { requests: 3, peak: 30_000, input: 70_000, output: 1_000 }],
    ])
    const s = statsOf(ledger(turns, 20_000), new Map(), undefined, { agents })
    expect(row(s, 'cache')).toEqual({ label: 'cache', value: '71% of the input read from the cache · broke 2× (#4 #7)', level: 'good' })
    expect(tips(s)).toContain('The prompt cache broke 2 times (#4, #7), and each time the whole context went again at full price: a pause longer than the cache lasts, or a change to the tools or the system prompt, does it.')
    expect(row(s, 'subagents')?.value).toBe('2 · 15 requests · ~110k kept out · 24.0k back')
    expect(tips(s)).toContain('Agent reports weigh 24.0k in this context: ask for a short summary, and for the details in a file.')
  })
})
