import { describe, expect, test } from 'claude-code/testing'

import { PANE, STORE, fakeEngine, settle, start } from './engine'

const SECTIONS = ['hooks', 'graph', 'files', 'turns', 'sessions', 'vox', 'synth']

describe('il menù delle sezioni', () => {
  test('≡ sections apre le spunte: una sezione tolta sparisce dal pannello, e la scelta resta salvata', { timeoutMs: 20_000 }, async ($, on) => {
    delete STORE.sections
    fakeEngine(on, [])
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    for (const id of SECTIONS) expect(await ui.find({ key: `section:${id}` })).toBeDefined()

    await ui.press({ key: 'title:menu' })
    await ui.redraw()
    // Il menù prende il posto del pannello: una riga con la spunta per ogni sezione.
    expect(await ui.find({ key: 'section:graph' })).toBeUndefined()
    for (const id of SECTIONS) expect((await ui.find({ key: `menu-${id}` }))?.text).toContain('[x]')
    expect(await ui.find({ type: 'Text', text: /branches, commits and tags/ })).toBeDefined()

    await ui.press({ key: 'menu-graph' })
    await ui.press({ key: 'menu-sessions' })
    await settle()
    await ui.redraw()
    expect((await ui.find({ key: 'menu-graph' }))?.text).toContain('[ ] GIT')
    expect(STORE.sections).toEqual({ off: ['graph', 'sessions'] })

    await ui.press({ key: 'menu-done' })
    await ui.redraw()
    expect(await ui.find({ key: 'section:graph' })).toBeUndefined()
    expect(await ui.find({ key: 'section:sessions' })).toBeUndefined()
    for (const id of ['hooks', 'files', 'turns', 'vox', 'synth']) expect(await ui.find({ key: `section:${id}` })).toBeDefined()
    await ui.unmount()
  })

  test('una sessione nuova riparte dalla scelta salvata; /glassbox sections riapre il menù', async ($, on) => {
    STORE.sections = { off: ['hooks', 'graph', 'files', 'turns', 'sessions', 'vox', 'synth'] }
    fakeEngine(on, [])
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    for (const id of SECTIONS) expect(await ui.find({ key: `section:${id}` })).toBeUndefined()
    // Senza sezioni il pannello dice come riaverle.
    expect(await ui.find({ type: 'Text', text: /No section shown/ })).toBeDefined()

    await $.command.run({ command: 'glassbox', args: 'sections', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    await ui.redraw()
    expect((await ui.find({ key: 'menu-files' }))?.text).toContain('[ ] FILES')
    await ui.press({ key: 'menu-files' })
    await settle()
    await ui.press({ key: 'menu-back' })
    await ui.redraw()
    expect(await ui.find({ key: 'section:files' })).toBeDefined()
    expect(await ui.find({ key: 'section:graph' })).toBeUndefined()
    delete STORE.sections
    await ui.unmount()
  })
})
