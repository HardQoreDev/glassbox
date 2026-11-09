import { describe, expect, test } from 'claude-code/testing'

import { analysisPrompt, markdownLines, usageText } from '../hooks/analysis'

import { FILES, FORK, MESSAGES, PANE, fakeEngine, oneTurn, settle, start } from './engine'

const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 60 } } }
const DIR = '/home/u/.claude/glassbox/sessions/-r/s1'
const ANSWER = FORK.reply

describe("l'analisi del contesto", () => {
  test('il prompt porta i numeri di Glassbox; il markdown diventa righe della finestra', () => {
    const prompt = analysisPrompt(7, '## health\n- in use: 140k · 14%')
    expect(prompt).toContain('request #7')
    expect(prompt).toContain('<glassbox-measures>\n## health\n- in use: 140k · 14%\n</glassbox-measures>')
    expect(prompt).toContain('## Brief to restart')
    expect(markdownLines('## Dead weight\n### Read app.ts\n- **due** letture')).toEqual([
      { text: 'Dead weight', tone: 'system' },
      { text: 'Read app.ts', tone: 'block' },
      { text: '- due letture' },
    ])
    expect(usageText({ input_tokens: 10, output_tokens: 1200, cache_read_input_tokens: 14_000, cache_creation_input_tokens: 0 })).toBe('1.2k out · 14.0k cached')
    // La cache scaduta: il contesto si paga per intero, e si dice.
    expect(usageText({ input_tokens: 2_000, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 140_000 })).toBe('900 out · 142k uncached')
  })

  test('analyze in CONTEXT chiede a Claude di leggere il suo contesto e apre la risposta, salvata nel registro', { timeoutMs: 30_000 }, async ($, on) => {
    for (const k of Object.keys(FILES)) if (k.includes('/glassbox/sessions/')) delete FILES[k]
    FORK.prompts.length = 0
    FORK.reply = ANSWER
    fakeEngine(on)
    await start($)
    MESSAGES.length = 0
    MESSAGES.push({ role: 'user', content: [{ type: 'text', text: 'sistema il login' }] })
    await oneTurn($)
    await settle()
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    const press = async (key: string) => {
      await ui.press({ key })
      for (let i = 0; i < 5; i++) await settle()
      await ui.redraw()
    }
    const has = async (text: string | RegExp) => {
      if (!(await ui.find({ type: 'Text', text }))) throw new Error(`not drawn: ${text}\n${JSON.stringify(await ui.findAll({ type: 'Text' }).then(l => l.map(x => x.text)))}`)
    }

    await press('turns-analyze')
    expect(FORK.prompts).toHaveLength(1)
    expect(FORK.prompts[0]).toContain('request #1')
    expect(FORK.prompts[0]).toMatch(/- in use: /)
    await has('#1 analysis')
    await has('1.2k out · 14.0k cached')
    await has(/^── What the context holds ─+$/)
    await has('Il login.')
    await has('▸ Dettagli')
    await has('Poco da togliere.')

    // Salvata accanto alle richieste, e nominata nel riassunto.
    let saved: string | undefined
    for (let i = 0; i < 60 && !saved; i++) {
      saved = Object.keys(FILES).find(k => k.startsWith(`${DIR}/analyses/0001-`))
      if (!saved) await settle()
    }
    expect(saved).toBeDefined()
    expect(FILES[saved!]).toContain('# Context analysis · request #1')
    expect(FILES[saved!]).toContain('Il login.')
    expect(FILES[`${DIR}/session.json`]).toContain('analyses/0001-')

    // ↻ chiede di nuovo; chiusa e riaperta sulla stessa richiesta, non richiede.
    await press('context-rerun')
    expect(FORK.prompts).toHaveLength(2)
    await press('context-close')
    expect(await ui.find({ key: 'section:turns' })).toBeDefined()
    await press('turns-analyze')
    expect(FORK.prompts).toHaveLength(2)
    await has('#1 analysis')

    // Senza niente da leggere lo dice, e ↻ resta per riprovare.
    FORK.reply = { isAnswered: false, reason: 'nothing-to-fork' }
    await press('context-rerun')
    await has(/^Nothing to analyze yet: the first answer has to come back/)
    expect(await ui.find({ key: 'context-rerun' })).toBeDefined()
    FORK.reply = ANSWER
  })
})
