import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { matches } from '../hooks/settings-hooks'
import { PANE, fakeEngine, start } from './engine'

// Sotto i mod, dove il motore esegue gli hook delle impostazioni: qui
// confine-writes.sh, che rifiuta le scritture fuori dalla cartella.
const confineWrites = (on: On, ran: string[]) =>
  on('classic.PreToolUse', (_, e) => {
    ran.push(e.tool)
    return { deny: 'fuori dalla cartella della sessione' }
  })

const write = { tool: 'Write', file_path: '/altrove/nota.md', content: 'ciao' } as never

describe('matches', () => {
  test('parole esatte, espressioni regolari, vuoto e asterisco', () => {
    expect(matches('Write|Edit|NotebookEdit', 'Edit')).toBe(true)
    expect(matches('Write|Edit|NotebookEdit', 'Read')).toBe(false)
    expect(matches('^(startup|resume)$', 'resume')).toBe(true)
    expect(matches('^(startup|resume)$', 'clear')).toBe(false)
    expect(matches('', 'Bash')).toBe(true)
    expect(matches('*', 'Bash')).toBe(true)
  })
})

describe('la sezione HOOK', () => {
  test('mostra gli hook delle impostazioni, ciascuno con il suo pulsante', async ($, on) => {
    fakeEngine(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: /confine-writes\.sh/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /herdr-agent-state\.sh/ })).toBeDefined()
    // a 60 colonne il matcher si accorcia con …
    expect(await ui.find({ type: 'Text', text: /PreToolUse · Write\|Edit/ })).toBeDefined()
    expect((await ui.find({ key: 'hook:0' }))?.text).toBe('  ON ')
    expect(await ui.find({ type: 'Text', text: /2 on/ })).toBeDefined()
    await ui.unmount()
  })

  test('acceso, lo script gira, blocca e la riga lo dice', async ($, on) => {
    const ran: string[] = []
    fakeEngine(on)
    confineWrites(on, ran)
    await start($)

    const done = await $.tool.call(write)
    expect(ran).toEqual(['Write'])
    expect(done.isError).toBe(true)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: / blocked/ })).toBeDefined()
    await ui.unmount()
  })

  test('spento, lo script non parte e la scrittura passa', async ($, on) => {
    const ran: string[] = []
    const toasts: string[] = []
    fakeEngine(on)
    confineWrites(on, ran)
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    await start($)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'hook:0' })
    await ui.redraw()
    expect((await ui.find({ key: 'hook:0' }))?.text).toBe(' OFF ')
    expect(await ui.find({ type: 'Text', text: /1 off/ })).toBeDefined()
    expect(toasts).toEqual(['confine-writes.sh: OFF for this session'])

    const done = await $.tool.call(write)
    expect(ran).toEqual([])
    expect(done.isError).not.toBe(true)
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: / skipped/ })).toBeDefined()

    // Riacceso, torna a girare.
    await ui.press({ key: 'hook:0' })
    await $.tool.call(write)
    expect(ran).toEqual(['Write'])
    await ui.unmount()
  })

  test('uno strumento che il matcher non prende non accende niente', async ($, on) => {
    const ran: string[] = []
    fakeEngine(on)
    on('classic.PreToolUse', (_, e) => {
      ran.push(e.tool)
      return {}
    })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: '/r/notes.md' } as never)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: / ok| blocked| skipped/ })).toBeUndefined()
    await ui.unmount()
  })
})
