import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'voxbox',
  component: 'Pane',
  requestId: 'voxbox',
  props: {
    title: 'Voxbox',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const KEYS = ['arm', 'reply', 'mode', 'view-raw', 'view-prosa', 'view-sintesi', 'play', 'stop', 'slower', 'faster']
// Quelli della vista scelta, che in RAW non ci sono, e il cestino, che c'è solo con del testo.
const TOOLS = ['sintesi-less', 'sintesi-more', 'edit-sintesi', 'quick', 'deep', 'clear']
// La matita sta accanto alla vista scelta: in SINTESI la riga delle viste la mostra.

const CONFIG = JSON.stringify({ python: '/v/python', voice: '/v/serena.onnx', win: '/w/voxbox-win.exe' })
const REPLY = 'Ho controllato herdr: il tasto prefix più esse è già occupato. Ti propongo prefix più shift più esse.'

// Quello che sta sotto il mod: ogni hook fa le veci dell'engine.
type Calls = { complete: string[]; fork: string[]; run: string[][]; written: Record<string, string> }
const calls0 = (): Calls => ({ complete: [], fork: [], run: [], written: {} })

function fakeEngine(on: On, calls: Calls = calls0()) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'voxbox' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('store.get', () => ({ value: undefined }) as never)
  on('fs.read', (_, e) => {
    const path = String((e as { path?: string }).path)
    if (path === '/home/me/.local/share/voxbox/config.json') return { value: CONFIG } as never
    if (path.endsWith('/.claude-plugin/plugin.json')) return { value: '{"version":"0.1.0"}' } as never
    throw new Error(`ENOENT: ${path}`)
  })
  on('process.run', (_, e) => {
    calls.run.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.write', (_, e) => {
    calls.written[String((e as { path?: string }).path)] = String((e as { text?: string }).text)
    return { value: undefined } as never
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }) as never)
  on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'controlla herdr', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  }) as never)
  on('model.complete', (_, e) => {
    calls.complete.push(String(e.prompt))
    return { value: { isAnswered: true, text: 'Tasto occupato.\nProposta: prefix+shift+s.', usage: {} } } as never
  })
  on('model.fork', (_, e) => {
    calls.fork.push(e.prompt)
    return { value: { isAnswered: true, text: 'Spiegazione lunga.', usage: {}, effort: 'low' } } as never
  })
}

async function start($: Engine) {
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'voxbox', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
}

test('il pannello: titolo, sorgente, viste e comandi', { timeoutMs: 20_000 }, async ($, on) => {
  fakeEngine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const key of KEYS) expect(await ui.find({ key })).toBeDefined()
    // Da solo, senza Glassbox, non c'è lo scambio.
    expect(await ui.find({ key: 'title:swap' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /REC, poi seleziona un testo/ })).toBeDefined()
    await ui.unmount()
  }
})

test('in un pannello stretto (24 colonne) i comandi vanno a capo, nessuno sparisce', { timeoutMs: 20_000 }, async ($, on) => {
  fakeEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 24 } })
  const missing: string[] = []
  for (const key of KEYS) if ((await ui.find({ key })) === undefined) missing.push(key)
  expect(missing).toEqual([])
  // Il logo grande non entra: il titolo è una riga sola, V O X B O X.
  expect(await ui.find({ key: 'title:0' })).toBeDefined()
  expect(await ui.find({ key: 'title:1' })).toBeUndefined()
  await ui.unmount()
})

test('l\'ultima risposta arriva in RAW, poi SINTESI la scrive Haiku', { timeoutMs: 20_000 }, async ($, on) => {
  const calls = calls0()
  fakeEngine(on, calls)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'reply' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /ultima risposta · 18 parole/ })).toBeDefined()
  // RAW si legge; ✎ accanto al cestino lo rende modificabile nel pannello, di nuovo ✎ torna a leggere.
  expect(await ui.find({ type: 'Text', text: /Ho controllato herdr/ })).toBeDefined()
  expect(await ui.find({ key: 'raw-1' })).toBeUndefined()
  await ui.press({ key: 'edit-raw' })
  await ui.redraw()
  expect(await ui.find({ key: 'raw-1' })).toBeDefined()
  await ui.press({ key: 'edit-raw' })
  await ui.redraw()
  expect(await ui.find({ key: 'raw-1' })).toBeUndefined()

  await ui.press({ key: 'view-sintesi' })
  await ui.redraw()
  expect(calls.complete.length).toBe(1)
  expect(calls.complete[0]).toContain('1 righe al massimo')
  expect(calls.complete[0]).toContain(REPLY)
  expect(await ui.find({ type: 'Text', text: /Proposta: prefix\+shift\+s\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Haiku · / })).toBeDefined()

  // Prosa ▸ approfondisce: passa al fork della sessione.
  await ui.press({ key: 'view-prosa' })
  await ui.redraw()
  await ui.press({ key: 'prosa-more' })
  await ui.redraw()
  expect(calls.fork.length).toBe(1)
  expect(calls.fork[0]).toContain('[Voxbox]')
  expect(await ui.find({ type: 'Text', text: /Spiegazione lunga\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /deep \(auto\)/ })).toBeDefined()
  await ui.unmount()
})

test('l\'editor dei prompt nel pannello: ↺ default lo rimette, salva lo tiene', { timeoutMs: 20_000 }, async ($, on) => {
  fakeEngine(on)
  const stored: unknown[] = []
  on('store.set', (_, e) => {
    stored.push(e.value)
    return { value: undefined }
  })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view-sintesi' })
  await ui.redraw()
  await ui.press({ key: 'edit-sintesi' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /✎ prompt SYNTH/ })).toBeDefined()
  expect(await ui.find({ key: 'edit-template-1' })).toBeDefined()
  expect(await ui.find({ key: 'edit-params-1' })).toBeDefined()
  await ui.press({ key: 'edit-reset' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Default reinserito/ })).toBeDefined()
  await ui.press({ key: 'edit-save' })
  await ui.redraw()
  expect(stored.length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /Prompt SYNTH salvato\./ })).toBeDefined()
  await ui.unmount()
})

test('solidità: da 14 a 90 colonne nessuna riga esce dal pannello', { timeoutMs: 60_000 }, async ($, on) => {
  fakeEngine(on)
  await start($)
  const cols = (text: string) => Array.from(text).reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0)
  const rows = ['title:0', 'title:1', 'title:gap', 'summary', 'trash-row']
  for (const flow of ['source', 'views', 'tools', 'controls']) for (let i = 0; i < 4; i++) rows.push(`${flow}:${i}`)
  const wide: string[] = []
  // Prima vuoto in RAW, poi con l'ultima risposta in SINTESI (i comandi della vista e il cestino).
  for (const pass of ['vuoto', 'sintesi']) {
    for (let width = 14; width <= 90; width++) {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: width } })
      if (width === 14 && pass === 'sintesi') {
        await ui.press({ key: 'reply' })
        await ui.press({ key: 'view-sintesi' })
        await ui.redraw()
      }
      for (const key of rows) {
        const text = (await ui.find({ key }))?.text
        if (text !== undefined && cols(text) > width) wide.push(`${pass} ${width} ${key}: ${cols(text)} «${text}»`)
      }
      await ui.unmount()
    }
  }
  expect(wide).toEqual([])
})

test('REC e il suo modo: 1 = sostituisci, + = concatena; CP a destra', { timeoutMs: 20_000 }, async ($, on) => {
  fakeEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'mode' }))?.text).toContain('1')
  expect(await ui.find({ type: 'Text', text: /1 = sostituisci/ })).toBeDefined()
  await ui.press({ key: 'mode' })
  await ui.redraw()
  expect((await ui.find({ key: 'mode' }))?.text).toContain('+')
  expect(await ui.find({ type: 'Text', text: /\+ = concatena/ })).toBeDefined()
  // A pannello largo REC, il modo e CP stanno in una riga.
  expect((await ui.find({ key: 'source:0' }))?.text).toMatch(/REC.*\+.*CP/)
  await ui.unmount()
})

test('le viste: RAW | PROSA | SINTESI, in colonna se non ci stanno; sotto i comandi della scelta', { timeoutMs: 20_000 }, async ($, on) => {
  fakeEngine(on)
  await start($)
  const wide = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 70 } })
  expect((await wide.find({ key: 'views:0' }))?.text).toContain('RAW | VOX | SYNTH')
  expect(await wide.find({ key: 'views:1' })).toBeUndefined()
  // In RAW niente comandi della vista, e senza testo niente cestino.
  for (const key of TOOLS) expect(await wide.find({ key })).toBeUndefined()
  await wide.press({ key: 'reply' })
  await wide.press({ key: 'view-sintesi' })
  await wide.redraw()
  for (const key of TOOLS) expect(await wide.find({ key })).toBeDefined()
  expect((await wide.find({ key: 'views:0' }))?.text).toContain('SYNTH✎')
  await wide.unmount()
  const narrow = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 20 } })
  for (const key of ['views:0', 'views:1', 'views:2']) expect(await narrow.find({ key })).toBeDefined()
  await narrow.unmount()
})

test('RAW in modifica: Invio salva ed esce; la seconda volta il campo è nuovo, e un Invio vuoto non cancella', { timeoutMs: 20_000 }, async ($, on) => {
  fakeEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reply' })
  await ui.redraw()
  // Prima volta: scrivo e Invio.
  await ui.press({ key: 'edit-raw' })
  await ui.redraw()
  const first = (await ui.find({ type: 'Input' }))?.key ?? ''
  await ui.input({ key: first, text: 'Testo corretto da me.', kind: 'change' })
  await ui.input({ key: first, text: 'Testo corretto da me.', kind: 'submit' })
  await ui.redraw()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Testo corretto da me\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Testo salvato: 4 parole/ })).toBeDefined()
  // Seconda volta: un campo con un altro nome, e un Invio a campo vuoto esce senza cancellare.
  await ui.press({ key: 'edit-raw' })
  await ui.redraw()
  const second = (await ui.find({ type: 'Input' }))?.key ?? ''
  expect(second).not.toBe(first)
  await ui.input({ key: second, text: '', kind: 'submit' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Testo corretto da me\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Uscito senza modifiche/ })).toBeDefined()
  await ui.unmount()
})

test('✎ anche in SYNTH: modifica il testo generato, RAW resta il master', { timeoutMs: 20_000 }, async ($, on) => {
  fakeEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reply' })
  await ui.redraw()
  await ui.press({ key: 'view-sintesi' })
  await ui.redraw()
  await ui.press({ key: 'edit-raw' })
  await ui.redraw()
  const field = (await ui.find({ type: 'Input' }))?.key ?? ''
  await ui.input({ key: field, text: 'Tasto occupato: uso shift.', kind: 'submit' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Tasto occupato: uso shift\./ })).toBeDefined()
  // RAW non è cambiato.
  await ui.press({ key: 'view-raw' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Ho controllato herdr/ })).toBeDefined()
  await ui.unmount()
})
