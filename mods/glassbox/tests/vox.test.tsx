import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { _testing } from '../hooks/vox'
import { CHAT, COMPLETE, FORK, PANE, STORE, fakeEngine, settle, start } from './engine'

// Un pannello alto, perché VOX e SYNTH aperte stiano insieme alle altre sezioni.
const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 80 } } }

const REPLY = 'Ho controllato herdr: il tasto prefix più esse è già occupato. Ti propongo prefix più shift più esse.'

const toastsOf = (on: On): string[] => {
  const out: string[] = []
  on('ui.toast', (_, e) => {
    out.push(e.text)
    return { value: undefined } as never
  })
  return out
}

// Il mod resta caricato da un test all'altro: ognuno riparte da VOX vuota.
function fresh(on: On) {
  _testing.reset()
  CHAT.length = 0
  CHAT.push({ role: 'user', text: 'controlla herdr', toolUses: [] }, { role: 'assistant', text: REPLY, toolUses: [] })
  COMPLETE.prompts.length = 0
  COMPLETE.text = 'Tasto occupato.\nProposta: prefix+shift+s.'
  FORK.prompts.length = 0
  for (const key of Object.keys(STORE)) delete STORE[key]
  fakeEngine(on, [])
}

describe('le sezioni VOX e SYNTH', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`i titoli con i loro comandi, e cp che porta l'ultima risposta in VOX (${surface})`, { timeoutMs: 20_000 }, async ($, on) => {
      fresh(on)
      await start($)
      const ui = await $.ui.mount({ ...TALL, surface })
      for (const key of ['section:vox', 'section:synth', 'vox-rec', 'vox-mode', 'vox-cp', 'vox-play', 'synth-write', 'synth-play']) expect(await ui.find({ key })).toBeDefined()
      // Senza testo non c'è niente da svuotare.
      expect(await ui.find({ key: 'vox-clear' })).toBeUndefined()

      await ui.press({ key: 'vox-cp' })
      await settle()
      await ui.redraw()
      // cp apre la sezione: i comandi sotto il titolo, e il testo.
      for (const key of ['vox-view-raw', 'vox-view-prosa', 'vox-edit', 'vox-slower', 'vox-faster', 'vox-clear']) expect(await ui.find({ key })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Ho controllato herdr/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /last reply · 18 words/ })).toBeDefined()

      await ui.press({ key: 'vox-clear' })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /Ho controllato herdr/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /rec, then select a text/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('rec e il suo modo: 1 sostituisce, + concatena; senza la voce installata lo dice', async ($, on) => {
    fresh(on)
    await start($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    expect((await ui.find({ key: 'vox-mode' }))?.text).toBe('1')
    await ui.press({ key: 'vox-mode' })
    await ui.redraw()
    expect((await ui.find({ key: 'vox-mode' }))?.text).toBe('+')

    await ui.press({ key: 'vox-rec' })
    await settle()
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Voice not installed/ })).toBeDefined()
    await ui.unmount()
  })

  test('SYNTH la scrive Haiku quando lo chiedi; prose ▸ approfondisce con un fork della sessione', { timeoutMs: 20_000 }, async ($, on) => {
    fresh(on)
    await start($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    await ui.press({ key: 'vox-cp' })
    await settle()
    await ui.redraw()
    // Finché non lo chiedi, nessuna richiesta al modello.
    expect(COMPLETE.prompts.length).toBe(0)

    await ui.press({ key: 'synth-write' })
    await settle()
    await ui.redraw()
    expect(COMPLETE.prompts.length).toBe(1)
    expect(COMPLETE.prompts[0]).toContain('1 righe al massimo')
    expect(COMPLETE.prompts[0]).toContain(REPLY)
    expect(await ui.find({ type: 'Text', text: /Proposta: prefix\+shift\+s\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 lines · Haiku/ })).toBeDefined()
    for (const key of ['sintesi-less', 'sintesi-more', 'sintesi-fast', 'sintesi-deep', 'sintesi-prompt', 'synth-edit']) expect(await ui.find({ key })).toBeDefined()

    // La prosa: prima Haiku, poi ▸ raddoppia e passa da sola al fork.
    await ui.press({ key: 'vox-view-prosa' })
    await settle()
    await ui.redraw()
    expect(COMPLETE.prompts.length).toBe(2)
    expect(COMPLETE.prompts[1]).toContain('circa 18 parole')
    FORK.prompts.length = 0
    await ui.press({ key: 'prosa-more' })
    await settle()
    await ui.redraw()
    expect(FORK.prompts.length).toBe(1)
    expect(FORK.prompts[0]).toContain('[Glassbox VOX]')
    expect(FORK.prompts[0]).toContain('circa 36 parole')
    expect(await ui.find({ type: 'Text', text: /Il login\./ })).toBeDefined()

    // raw riporta il testo com'era, senza altre richieste.
    await ui.press({ key: 'vox-view-raw' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Ho controllato herdr/ })).toBeDefined()
    expect(COMPLETE.prompts.length).toBe(2)
    await ui.unmount()
  })

  test('edit: il testo si modifica al posto delle sezioni; Invio salva, un Invio vuoto non cancella', { timeoutMs: 20_000 }, async ($, on) => {
    fresh(on)
    await start($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    await ui.press({ key: 'vox-cp' })
    await settle()
    await ui.redraw()

    await ui.press({ key: 'vox-edit' })
    await ui.redraw()
    // L'editor prende il posto di tutte le sezioni.
    expect(await ui.find({ key: 'section:hooks' })).toBeUndefined()
    const first = (await ui.find({ type: 'Input' }))?.key ?? ''
    await ui.input({ key: first, text: 'Testo corretto da me.', kind: 'change' })
    await ui.input({ key: first, text: 'Testo corretto da me.', kind: 'submit' })
    await ui.redraw()
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    expect(await ui.find({ key: 'section:hooks' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Testo corretto da me\./ })).toBeDefined()

    // La seconda volta il campo è un altro, e un Invio a campo vuoto esce senza cancellare.
    await ui.press({ key: 'vox-edit' })
    await ui.redraw()
    const second = (await ui.find({ type: 'Input' }))?.key ?? ''
    expect(second).not.toBe(first)
    await ui.input({ key: second, text: '', kind: 'submit' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Testo corretto da me\./ })).toBeDefined()

    // La sintesi si ritocca senza toccare il testo di VOX.
    await ui.press({ key: 'synth-write' })
    await settle()
    await ui.redraw()
    await ui.press({ key: 'synth-edit' })
    await ui.redraw()
    const field = (await ui.find({ type: 'Input' }))?.key ?? ''
    await ui.input({ key: field, text: 'Tasto occupato: uso shift.', kind: 'submit' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Tasto occupato: uso shift\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Testo corretto da me\./ })).toBeDefined()
    await ui.unmount()
  })

  test('prompt: il prompt e i suoi parametri nel pannello; ↺ default lo rimette, save lo tiene', { timeoutMs: 20_000 }, async ($, on) => {
    const toasts = toastsOf(on)
    fresh(on)
    await start($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })
    await ui.press({ key: 'section:synth' })
    await ui.redraw()
    await ui.press({ key: 'sintesi-prompt' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /✎ SYNTH prompt/ })).toBeDefined()
    const template = (await ui.findAll({ type: 'Input' })).map(i => i.key)
    expect(template.length).toBe(2)
    await ui.input({ key: template[1] ?? '', text: 'gradini=60:2,oltre:4 parole_riga=10', kind: 'change' })
    await ui.press({ key: 'vox-prompt-save' })
    await settle()
    await ui.redraw()
    expect(toasts).toContain('SYNTH prompt saved.')
    expect((STORE['vox-prompts'] as { sintesi: { params: { gradini: string; paroleRiga: number } } }).sintesi.params).toEqual({ gradini: '60:2, oltre:4', paroleRiga: 10 })
    expect(await ui.find({ type: 'Input' })).toBeUndefined()

    // ↺ default rimette nei campi il prompt di partenza; close lascia tutto com'era.
    await ui.press({ key: 'sintesi-prompt' })
    await ui.redraw()
    const before = (await ui.find({ type: 'Input' }))?.key
    await ui.press({ key: 'vox-prompt-reset' })
    await ui.redraw()
    expect((await ui.find({ type: 'Input' }))?.key).not.toBe(before)
    await ui.press({ key: 'vox-prompt-close' })
    await ui.redraw()
    expect(await ui.find({ key: 'section:synth' })).toBeDefined()
    await ui.unmount()
  })

  test('chiuse non tolgono righe alle altre sezioni; aperte sono alte quanto il loro testo', async ($, on) => {
    fresh(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const rows = async (id: string) => (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith(`${id}:`)).length
    const closed = await rows('sessions')
    await ui.press({ key: 'section:vox' })
    await ui.redraw()
    // VOX vuota: i comandi e la guida, e le altre sezioni perdono poche righe.
    expect(await ui.find({ key: 'vox-view-raw' })).toBeDefined()
    expect(await rows('vox')).toBeLessThanOrEqual(6)
    expect(await rows('sessions')).toBeGreaterThanOrEqual(closed - 2)
    await ui.unmount()
  })
})
