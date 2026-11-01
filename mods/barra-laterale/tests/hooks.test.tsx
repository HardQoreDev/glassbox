import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ENV, PANE, fakeEngine, start } from './engine'

// Nell'ordine delle righe: herdr (SessionStart); quello che blocca le
// scritture fuori dal progetto e quello del plugin framework (PreToolUse);
// quello di codex (Stop).
const HERDR = 'hook:0'
const CONFINE = 'hook:1'
const GUARD = 'hook:2'
const CODEX = 'hook:3'
const NAME = 'blocca-scritture-fuori-progetto'
const GUARD_NAME = 'proteggi-scritture-del-framework'

const toasts = (on: On): string[] => {
  const seen: string[] = []
  on('ui.toast', (_, e) => {
    seen.push(e.text)
    return { value: undefined }
  })
  return seen
}

describe('la sezione HOOKS', () => {
  test('mostra gli hook della sessione per evento, con il nome dato a hook-switch', async ($, on) => {
    fakeEngine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    // Il nome che dice cosa fa, non lo script né hook-switch.
    expect(await ui.find({ type: 'Text', text: NAME })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /hook-switch/ })).toBeUndefined()
    // Quelli che non si possono spegnere partono nascosti, e si contano.
    expect(await ui.find({ type: 'Text', text: 'herdr-agent-state.sh' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'SessionStart' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: ' · 2 hidden' })).toBeDefined()

    await ui.press({ key: 'hooks-always' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: ' · 2 hidden' })).toBeUndefined()
    for (const event of ['SessionStart', 'PreToolUse']) expect(await ui.find({ type: 'Text', text: event })).toBeDefined()
    // Senza hook-switch resta il nome dello script, e non c'è il pulsante.
    expect(await ui.find({ type: 'Text', text: 'herdr-agent-state.sh' })).toBeDefined()
    expect(await ui.find({ key: HERDR })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: ' ALWAYS ' })).toBeDefined()

    expect((await ui.find({ key: CONFINE }))?.text).toBe(' ON ')
    expect(await ui.find({ type: 'Text', text: ' user ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '4 on' })).toBeDefined()
    await ui.unmount()
  })

  test('mostra gli hook dei plugin abilitati, spegnibili se passano da hook-switch', async ($, on) => {
    fakeEngine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    // framework gira dalla cartella sorgente del suo marketplace `directory`.
    expect(await ui.find({ type: 'Text', text: GUARD_NAME })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' framework ' })).toBeDefined()
    expect((await ui.find({ key: GUARD }))?.text).toBe(' ON ')
    // codex non usa hook-switch: si vede con `always`, senza pulsante.
    expect(await ui.find({ type: 'Text', text: 'stop-review-gate-hook.mjs' })).toBeUndefined()
    await ui.press({ key: 'hooks-always' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'stop-review-gate-hook.mjs' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' codex ' })).toBeDefined()
    expect(await ui.find({ key: CODEX })).toBeUndefined()
    // Un plugin non abilitato non compare.
    expect(await ui.find({ type: 'Text', text: /non-deve-comparire/ })).toBeUndefined()

    await ui.press({ key: GUARD })
    expect(ENV.HOOK_SWITCH_OFF).toBe(GUARD_NAME)
    await ui.press({ key: GUARD })
    expect(ENV.HOOK_SWITCH_OFF).toBeUndefined()
    await ui.unmount()
  })

  test('OFF cambia HOOK_SWITCH_OFF, solo per la sessione', async ($, on) => {
    fakeEngine(on)
    const seen = toasts(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await ui.press({ key: CONFINE })
    await ui.redraw()
    expect(ENV.HOOK_SWITCH_OFF).toBe(NAME)
    expect((await ui.find({ key: CONFINE }))?.text).toBe(' OFF ')
    expect(await ui.find({ type: 'Text', text: ' · 1 off' })).toBeDefined()
    expect(seen).toEqual([`${NAME}: OFF for this session`])

    await ui.press({ key: CONFINE })
    await ui.redraw()
    expect(ENV.HOOK_SWITCH_OFF).toBeUndefined()
    expect((await ui.find({ key: CONFINE }))?.text).toBe(' ON ')
    expect(seen.at(-1)).toBe(`${NAME}: ON for this session`)
    await ui.unmount()
  })

  test('una sessione partita con HOOK_SWITCH_OFF mostra quell’hook spento', async ($, on) => {
    ENV.HOOK_SWITCH_OFF = `altro ${NAME}`
    fakeEngine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    expect((await ui.find({ key: CONFINE }))?.text).toBe(' OFF ')
    await ui.press({ key: CONFINE })
    // Gli altri nomi restano.
    expect(ENV.HOOK_SWITCH_OFF).toBe('altro')
    delete ENV.HOOK_SWITCH_OFF
    await ui.unmount()
  })

  test('un clic sul nome apre comando, provenienza e come si spegne', async ($, on) => {
    fakeEngine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'hooks-always' })

    await ui.press({ key: 'hook-info:1' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /\$ \/home\/u\/\.claude\/hooks\/hook-switch blocca-scritture/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /from ~\/\.claude\/settings\.json/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /timeout 10s · Controllo confinamento scritture/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /OFF skips it in this session only/ })).toBeDefined()

    // Uno alla volta: aprire herdr chiude l'altro.
    await ui.press({ key: 'hook-info:0' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /To switch it: hook-switch <what-it-does> <command>/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /OFF skips it in this session only/ })).toBeUndefined()

    await ui.press({ key: 'hook-info:3' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /from plugin codex@openai-codex$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {5}~\/\.claude\/plugins\/cache\/openai-codex\/codex\/1\.0\.6$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /its plugin writes it with hook-switch/ })).toBeDefined()
    await ui.unmount()
  })
})
