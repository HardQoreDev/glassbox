import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { docText, messageLines, newFrom, outputLines, partOf, systemLines } from '../hooks/context'
import { wrapText } from '../hooks/ui'

import { BREAKDOWN, FILES, MESSAGES, PANE, REPLIES, RUNS, fakeEngine, settle, start } from './engine'

// Un pannello alto, perché le finestre del contesto entrino intere.
const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 60 } } }

// Un prompt in due richieste: la prima chiede di leggere un file, la seconda,
// con la risposta dello strumento, chiude.
async function twoSteps($: Engine) {
  MESSAGES.length = 0
  MESSAGES.push({ role: 'user', content: [{ type: 'text', text: 'leggi le note' }] })
  REPLIES.push(
    {
      chunks: [
        { kind: 'tool', index: 0, id: 'toolu_1', name: 'Read' },
        { kind: 'input', index: 0, json: '{"file_path":' },
        { kind: 'input', index: 0, json: '"/r/notes.md"}' },
      ],
      usage: [800, 14_000, 30],
    },
    { chunks: [{ kind: 'text', index: 0, text: 'Fatto.' }], usage: [100, 14_800, 20] },
  )
  await $.turn.start({ text: 'leggi le note', turnId: 't1' })
  const first = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for (;;) if ((await first.next()).done) break
  await $.tool.call({ tool: 'Read', file_path: '/r/notes.md' } as never)
  MESSAGES.push(
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/r/notes.md' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'contenuto' }] },
  )
  const second = $.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 3 })
  for (;;) if ((await second.next()).done) break
  await $.turn.complete({ answer: 'Fatto.', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()
}

describe('quello che entra nel contesto', () => {
  // Una ventina di ridisegni: più dei 5 secondi di partenza.
  test('le voci della legenda aprono system, earlier, new e output dell’ultima richiesta', { timeoutMs: 20_000 }, async ($, on) => {
    fakeEngine(on)
    await start($)
    await $.tool.describe({ tool: 'mcp__docs__search', description: 'Searches the docs.', isDeferred: true, provider: { plugin: 'engine', tier: 'core' } } as never)
    await twoSteps($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    const open = async (key: string) => {
      await ui.press({ key })
      await settle()
      await ui.redraw()
    }
    const has = async (text: string | RegExp) => expect(await ui.find({ type: 'Text', text })).toBeDefined()

    // new: la risposta dello strumento, al posto delle sezioni.
    await open('context:new')
    expect(await ui.find({ key: 'section:turns' })).toBeUndefined()
    await has('#2 new')
    await has(/1 message$/)
    await has(/^── 3 · user ─+$/)
    await has('▸ tool_result · Read · toolu_1')
    await has('contenuto')
    await open('context-back')
    expect(await ui.find({ key: 'section:turns' })).toBeDefined()

    // earlier: il prompt e la chiamata allo strumento, com'erano nella richiesta.
    await open('context:earlier')
    await has('#2 earlier')
    await has(/2 messages$/)
    await has(/^── 1 · user ─+$/)
    await has('leggi le note')
    await has(/^── 2 · assistant ─+$/)
    await has('▸ tool_use · Read · toolu_1')
    await has('  "file_path": "/r/notes.md"')
    await open('context-close')

    // output: quello che il modello ha risposto.
    await open('context:output')
    await has('#2 output')
    await has('▸ text')
    await has('Fatto.')
    await open('context-back')

    // system: il prompt di sistema a sezioni, gli strumenti, quelli dietro ToolSearch per nome.
    await open('context:system')
    await has('#2 system')
    await has(/^── system prompt · 2 sections ─+$/)
    await has('▸ intro · shared')
    await has('You are Claude Code.')
    await has('# CLAUDE.md')
    await has(/^── tools · 1 ─+$/)
    await has('▸ Read')
    await has(/^── behind ToolSearch · 1 ─+$/)
    await has('mcp__docs__search')

    // ↗ lo scrive in un file e lo apre in VS Code.
    RUNS.length = 0
    await open('context-open')
    const path = '/tmp/glassbox/s1/turn-2-system.md'
    expect(RUNS).toEqual([['code', path]])
    expect(FILES[path]).toStartWith('# #2 system\n\n> The system prompt as the engine composes it now for claude-opus-5-5')
    expect(FILES[path]).toContain('\n## system prompt · 2 sections\n### intro · shared\nYou are Claude Code.\n')
    await open('context-back')

    // I blocchi di un turno aperto aprono il loro pezzo di quel turno.
    await open('turn:1')
    await open('chip:1:out:0')
    await has('#1 output')
    await has('▸ tool_use · Read · toolu_1')
    await has('  "file_path": "/r/notes.md"')
    await ui.unmount()
  })

  test('senza wrap le righe lunghe si leggono con lo slider', async ($, on) => {
    fakeEngine(on)
    await start($)
    await twoSteps($)
    MESSAGES.push({ role: 'assistant', content: [{ type: 'text', text: 'Fatto.' }] }, { role: 'user', content: [{ type: 'text', text: 'x'.repeat(200) }] })
    await $.turn.start({ text: 'x'.repeat(200), turnId: 't2' })
    const s = $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', messageCount: 5 })
    for (;;) if ((await s.next()).done) break
    await settle()
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    await ui.press({ key: 'context:new' })
    await settle()
    await ui.redraw()
    // A capo: tre righe da 59, niente slider.
    expect(await ui.findAll({ type: 'Text', text: /^x{59}$/ })).toHaveLength(3)
    expect(await ui.find({ key: 'context-right' })).toBeUndefined()

    await ui.press({ key: 'context-wrap' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /^x{58}…$/ })).toBeDefined()
    await ui.press({ key: 'context-right' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /^x{58}…$/ })).toBeDefined()
    await ui.press({ key: `context-x:${55}` })
    await ui.redraw()
    // In fondo: le ultime 59 colonne, intere.
    expect(await ui.find({ type: 'Text', text: /^x{59}$/ })).toBeDefined()
    await ui.unmount()
  })

  test('la tendina stats: cinque viste, i numeri e i consigli', { timeoutMs: 20_000 }, async ($, on) => {
    fakeEngine(on)
    BREAKDOWN.value = {
      rawMaxTokens: 200_000,
      categories: [
        { name: 'System prompt', tokens: 4_000, color: '', isDeferred: false, kind: 'used' },
        { name: 'MCP tools', tokens: 9_000, color: '', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 2_000, color: '', isDeferred: false, kind: 'used' },
      ],
      mcpTools: [{ name: 'mcp__docs__search', serverName: 'docs', tokens: 9_000, isLoaded: true }],
      memoryFiles: [],
      agents: [],
    } as never
    await start($)
    await twoSteps($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    // Le altre sezioni chiuse, perché la tendina entri intera.
    for (const key of ['section:hooks', 'section:graph', 'section:files']) await ui.press({ key })
    const tab = async (key: string) => {
      await ui.press({ key })
      await settle()
      await ui.redraw()
    }
    const has = async (...texts: (string | RegExp)[]) => {
      for (const text of texts) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await tab('turns-stats')
    // health, la vista di partenza: i numeri che contano e tutti i consigli.
    await has('health', 'fill', 'waste', 'flow', 'tools', /^in use/, /^preloaded/, /^reclaimable/, /^cache/, 'tips')
    await has(/^The MCP server docs puts 9\.0k of tool schemas in every/)
    await tab('stats-tab:flow')
    await has(/^requests {4}$/, '2 in 1 prompt · up to 2 in one', /^input {7}$/)
    await tab('stats-tab:tools')
    await has(/^tool calls/, 'most used · calls · results in context', /^Read/)
    await tab('stats-tab:waste')
    await has(/^MCP docs/, '0 of 1 tool used · 9.0k a request')
    // fill: di cosa è fatta l'ultima richiesta, e i blocchi più pesanti che si aprono.
    await tab('stats-tab:fill')
    await has(/^what fills #2 · /, 'heaviest · click to open', /^⚒ Read notes\.md/, 'by category · as /context counts it')
    await tab('stats-heavy:0')
    await has('#2 earlier')
    BREAKDOWN.value = undefined
    await ui.unmount()
  })

  test('un blocco tra i più pesanti apre la richiesta al suo titolo', { timeoutMs: 20_000 }, async ($, on) => {
    fakeEngine(on)
    await start($)
    const prompt = Array.from({ length: 300 }, (_, i) => `riga ${i}`).join('\n')
    const input = { file_path: '/r/big.ts', content: 'w'.repeat(6_000) }
    MESSAGES.length = 0
    MESSAGES.push({ role: 'user', content: [{ type: 'text', text: prompt }] })
    REPLIES.push(
      {
        chunks: [
          { kind: 'tool', index: 0, id: 'toolu_1', name: 'Write' },
          { kind: 'input', index: 0, json: JSON.stringify(input) },
        ],
        usage: [800, 14_000, 30],
      },
      { chunks: [{ kind: 'text', index: 0, text: 'Fatto.' }], usage: [100, 14_800, 20] },
    )
    await $.turn.start({ text: prompt, turnId: 't1' })
    const first = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for (;;) if ((await first.next()).done) break
    MESSAGES.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] })
    const second = $.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', messageCount: 3 })
    for (;;) if ((await second.next()).done) break
    await $.turn.complete({ answer: 'Fatto.', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer' })
    await settle()

    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    for (const key of ['section:hooks', 'section:graph', 'section:files', 'turns-stats', 'stats-tab:fill']) {
      await ui.press({ key })
      await ui.redraw()
    }
    expect(await ui.find({ type: 'Text', text: /^⚒ Write big\.ts/ })).toBeDefined()
    await ui.press({ key: 'stats-heavy:0' })
    await settle()
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: '#2 earlier' })).toBeDefined()
    // Il titolo della chiamata è la prima riga: il prompt lungo è sopra, fuori vista.
    expect(await ui.find({ type: 'Text', text: '▸ tool_use · Write · toolu_1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'riga 299' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^── 1 · user/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('i pezzi del contesto come testo', () => {
  const MSGS = [
    { role: 'user' as const, content: [{ type: 'text', text: 'ciao\ncome va' }] },
    { role: 'assistant' as const, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
    {
      role: 'user' as const,
      content: [
        { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'no' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(4096) } }] },
        { type: 'text', text: '<system-reminder>x</system-reminder>' },
      ],
    },
  ]

  test('il nuovo comincia dopo l’ultima risposta del modello', () => {
    expect(newFrom(MSGS)).toBe(2)
    expect(newFrom(MSGS.slice(0, 1))).toBe(0)
    expect(['system', 'history', 'user', 'tool_result', 'thinking', 'text', 'tool_use', 'truncated'].map(k => partOf(k as never))).toEqual([
      'system',
      'earlier',
      'new',
      'new',
      'output',
      'output',
      'output',
      'output',
    ])
  })

  test('ogni messaggio con il suo numero, ogni blocco con il suo titolo, i dati riassunti', () => {
    expect(messageLines(MSGS, 0, 3)).toEqual([
      { text: '1 · user', tone: 'user' },
      { text: 'text', tone: 'block' },
      { text: 'ciao' },
      { text: 'come va' },
      { text: '' },
      { text: '2 · assistant', tone: 'assistant' },
      { text: 'tool_use · Bash · t1', tone: 'block' },
      { text: '{' },
      { text: '  "command": "ls"' },
      { text: '}' },
      { text: '' },
      { text: '3 · user', tone: 'user' },
      { text: 'tool_result · Bash · t1 · error', tone: 'block' },
      { text: 'no' },
      { text: '[image/png, 3 KB]' },
      { text: '' },
      { text: 'text', tone: 'block' },
      { text: '<system-reminder>x</system-reminder>' },
      { text: '' },
    ])
  })

  test('la risposta per blocchi, con gli argomenti in JSON anche se arrivano a pezzi rotti', () => {
    const out = outputLines([
      { index: 1, kind: 'tool_use', name: 'Read', id: 'x', text: '{"a":1}' },
      { index: 0, kind: 'thinking', text: 'penso' },
      { index: 2, kind: 'tool_use', name: 'Bash', id: 'y', text: '{"rotto' },
    ])
    expect(out.map(l => l.text)).toEqual(['thinking', 'penso', '', 'tool_use · Read · x', '{', '  "a": 1', '}', '', 'tool_use · Bash · y', '{"rotto', ''])
  })

  test('il prompt di sistema e gli strumenti; senza sapere quali sono dietro ToolSearch lo dice', () => {
    const lines = systemLines([{ id: 'intro', text: 'Ciao.', scope: 'shared' }], [{ name: 'Read', description: 'Legge.' }], new Map())
    expect(lines.map(l => l.text)).toEqual([
      'system prompt · 1 section',
      'intro · shared',
      'Ciao.',
      '',
      'tools · 1',
      'Which tools wait behind ToolSearch is not known: Glassbox has not seen them described yet.',
      'Read',
      'Legge.',
      '',
    ])
  })

  test('il file markdown: titoli con #, note con >, il resto com’è', () => {
    expect(docText('#1 new', [{ text: 'nota', tone: 'note' }, { text: '1 · user', tone: 'user' }, { text: 'text', tone: 'block' }, { text: '# non un titolo' }])).toBe(
      '# #1 new\n\n> nota\n## 1 · user\n### text\n# non un titolo\n',
    )
  })

  test('a capo tra le parole, spezzando quelle troppo lunghe', () => {
    expect(wrapText('uno due tre quattro', 7)).toEqual(['uno due', 'tre', 'quattro'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapText('', 4)).toEqual([''])
  })
})
