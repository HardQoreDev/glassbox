import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage, ToolResultSummary } from 'claude-code'

import { lastPromptIn, replySince } from '../hooks/reply'

const SURFACES = ['terminal', 'desktop'] as const

const user = (text: string, toolResults?: ToolResultSummary[]): SessionMessage =>
  toolResults === undefined ? { role: 'user', text, toolUses: [] } : { role: 'user', text, toolUses: [], toolResults }

const assistant = (text: string, tool?: string): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses: tool === undefined ? [] : [{ tool_use_id: `id-${tool}`, tool, input: {} }],
})

const result = (id: string): ToolResultSummary[] => [{ tool_use_id: id, text: 'esito', isError: false }]

// Un turno con una skill: dopo il risultato dello strumento arriva una riga user
// iniettata (il testo della skill), che non è un prompt della persona.
const TURN: SessionMessage[] = [
  user('primo prompt'),
  assistant('risposta vecchia'),
  user('secondo prompt'),
  assistant('Carico la skill.', 'Skill'),
  user('', result('id-Skill')),
  user('Base directory for this skill: /tmp/skill'),
  assistant('', 'Bash'),
  user('', result('id-Bash')),
  assistant('Fatto: ecco il riepilogo.'),
]

const WHOLE_REPLY = 'Carico la skill.\n\nFatto: ecco il riepilogo.'

describe('replySince', () => {
  test('con il prompt ricordato parte dalla sua riga, oltre la riga iniettata', () => {
    expect(replySince(TURN, 'secondo prompt')).toBe(WHOLE_REPLY)
  })

  test("senza prompt parte dall'ultima riga user senza toolResults", () => {
    expect(replySince(TURN, null)).toBe('Fatto: ecco il riepilogo.')
  })

  test('un prompt ricordato che non si ritrova ricade sulla stessa regola', () => {
    expect(replySince(TURN, 'mai scritto')).toBe('Fatto: ecco il riepilogo.')
  })

  test('salta le righe user che portano toolResults, anche con del testo', () => {
    const rows = [
      user('il prompt'),
      assistant('uno', 'Read'),
      user('testo accanto al risultato', result('id-Read')),
      assistant('due'),
    ]
    expect(replySince(rows, null)).toBe('uno\n\ndue')
    expect(replySince(rows, 'testo accanto')).toBe('uno\n\ndue')
  })

  test('unisce i testi assistant con una riga vuota e scarta quelli vuoti', () => {
    const rows = [user('p'), assistant('  uno  '), assistant(''), assistant('   ', 'Read'), assistant('due')]
    expect(replySince(rows, 'p')).toBe('uno\n\ndue')
  })
})

describe('il pulsante [CP]', () => {
  test('copia tutta la risposta, su terminale e desktop', async ($, on) => {
    const copied: { text: string; surface: string | undefined }[] = []
    const toasts: string[] = []
    on('session.messages', () => ({ value: TURN }))
    on('ui.copy', (_, e) => {
      copied.push({ text: e.text, surface: e.surface })
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('prompt.submit', (_, e) => ({ text: e.text }))

    await $.prompt.submit({ text: 'secondo prompt', wait: false, origin: { kind: 'composer' } })
    // Una notifica non è la persona: non prende il posto del prompt ricordato.
    await $.prompt.submit({
      text: 'Base directory for this skill',
      wait: false,
      origin: { kind: 'task-notification' },
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'copia-risposta', surface, component: 'SessionMode', props: { modes: [] } })
      expect((await ui.find({ key: 'copia' }))?.text).toBe('[CP]')
      await ui.press({ key: 'copia' })
      expect(copied.at(-1)).toEqual({ text: WHOLE_REPLY, surface })
      await ui.unmount()
    }

    expect(toasts).toEqual([
      `Risposta copiata: ${WHOLE_REPLY.length} caratteri`,
      `Risposta copiata: ${WHOLE_REPLY.length} caratteri`,
    ])
  })

  test('lascia visibili le etichette di modalità del motore', async $ => {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'copia-risposta',
        surface,
        component: 'SessionMode',
        props: { modes: ['focus', 'memory paused'] },
      })
      expect(await ui.find({ type: 'Text', text: 'focus & memory paused' })).toBeDefined()
      expect(await ui.find({ key: 'copia' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('senza testo di Claude non copia e lo dice', async ($, on) => {
    const copied: string[] = []
    const toasts: string[] = []
    on('session.messages', () => ({ value: [user('un prompt'), assistant('', 'Bash')] }))
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    const ui = await $.ui.mount({ plugin: 'copia-risposta', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    await ui.press({ key: 'copia' })

    expect(copied).toEqual([])
    expect(toasts).toEqual(['Nessuna risposta di Claude da copiare'])
  })
})

const FOOTER = { plugin: 'copia-risposta', component: 'SessionMode', props: { modes: [] } } as const

const CHIP_DRAFT = 'guarda qui [Pasted text #1 +3 lines] e dimmi'
const EXPANDED = 'guarda qui uno\ndue\ntre\nquattro e dimmi'

describe('lastPromptIn', () => {
  test("l'ultima riga user con testo e senza toolResults", () => {
    const rows = [user('primo'), assistant('a', 'Read'), user('', result('id-Read')), user('secondo'), assistant('b')]
    expect(lastPromptIn(rows)).toBe('secondo')
    expect(lastPromptIn([assistant('solo Claude')])).toBe('')
  })
})

describe('il pulsante [IN]', () => {
  test("copia l'ultimo prompt inviato, con gli incollati già espansi", async ($, on) => {
    const copied: string[] = []
    on('session.messages', () => ({ value: TURN }))
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('prompt.submit', (_, e) => ({ text: e.text }))

    await $.prompt.submit({ text: EXPANDED, wait: false, origin: { kind: 'composer' } })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...FOOTER, surface })
      expect((await ui.find({ key: 'copia-input' }))?.text).toBe('[IN]')
      await ui.press({ key: 'copia-input' })
      await ui.unmount()
    }
    expect(copied).toEqual([EXPANDED, EXPANDED])
  })

  test("senza un invio ricordato prende l'ultimo prompt della sessione", async ($, on) => {
    const copied: string[] = []
    on('session.messages', () => ({ value: [user('il prompt di prima'), assistant('risposta')] }))
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))

    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
    await ui.press({ key: 'copia-input' })

    expect(copied).toEqual(['il prompt di prima'])
  })
})

describe('il pulsante [BZ]', () => {
  test('una bozza senza segnaposto si copia subito', async ($, on) => {
    const copied: string[] = []
    const toasts: string[] = []
    on('prompt.read', () => ({ value: { text: 'bozza breve', cursor: 0 } }))
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
    expect((await ui.find({ key: 'copia-bozza' }))?.text).toBe('[BZ]')
    await ui.press({ key: 'copia-bozza' })

    expect(copied).toEqual(['bozza breve'])
    expect(toasts).toEqual(['Bozza copiata: 11 caratteri'])
  })

  test("con un incollato compresso arma l'Invio: copia espanso, non invia, rimette la bozza", async ($, on) => {
    let box = CHIP_DRAFT
    const copied: string[] = []
    const toasts: string[] = []
    const sent: string[] = []
    let onFill: (text: string) => void = () => {}
    const refilled = new Promise<string>(resolve => {
      onFill = resolve
    })
    on('clock.now', () => ({ value: 1_000 }))
    on('clock.after', () => ({ value: undefined }))
    on('prompt.read', () => ({ value: { text: box, cursor: 0 } }))
    on('prompt.fill', (_, e) => {
      onFill(e.text)
      return { isFilled: true, text: e.text, cursor: e.text.length }
    })
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('prompt.submit', (_, e) => {
      sent.push(e.text)
      return { text: e.text }
    })

    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
    await ui.press({ key: 'copia-bozza' })
    expect(copied).toEqual([])
    expect(toasts).toEqual(['Premi Invio entro 30 s: copio la bozza intera, senza inviarla'])

    // L'Invio della persona: il motore toglie la bozza dal prompt e la passa espansa.
    box = ''
    const first = await $.prompt.submit({ text: EXPANDED, wait: false, origin: { kind: 'composer' } })
    expect(first).toEqual({ drop: `Bozza copiata: ${EXPANDED.length} caratteri. Non è stata inviata.` })
    expect(copied).toEqual([EXPANDED])
    expect(sent).toEqual([])
    // Il timer del ripristino: lo stub di clock.after lo fa scattare subito.
    expect(await refilled).toBe(EXPANDED)

    // L'Invio dopo non è più armato: parte.
    await $.prompt.submit({ text: EXPANDED, wait: false, origin: { kind: 'composer' } })
    expect(sent).toEqual([EXPANDED])
    await ui.unmount()
  })

  test("dopo 30 secondi l'Invio torna a inviare", async ($, on) => {
    let now = 1_000
    const sent: string[] = []
    on('clock.now', () => ({ value: now }))
    on('prompt.read', () => ({ value: { text: CHIP_DRAFT, cursor: 0 } }))
    on('ui.toast', () => ({ value: undefined }))
    on('prompt.submit', (_, e) => {
      sent.push(e.text)
      return { text: e.text }
    })

    const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
    await ui.press({ key: 'copia-bozza' })
    now += 30_001
    await $.prompt.submit({ text: EXPANDED, wait: false, origin: { kind: 'composer' } })

    expect(sent).toEqual([EXPANDED])
    await ui.unmount()
  })
})
