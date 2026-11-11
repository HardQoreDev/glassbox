import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { DEFAULTS, parseParams, paramsText, quickRequest, revive, vars } from '../hooks/prompts'
import { cleanForSpeech, countWords, lastReply, listenTime, prosaWords, sintesiLines, wrap } from '../hooks/text'

describe('la pulizia per la voce', () => {
  test('via codice, link, markdown e grafica del terminale', () => {
    const raw = [
      '## Fatto',
      '● Ho modificato **tre** file:',
      '- `~/.config/herdr/config.toml` → aggiunti i tasti',
      '- vedi [la guida](https://herdr.dev/docs) ⎿ ok ✅',
      '```bash',
      'herdr config check',
      '```',
      '| tasto | azione |',
      '|---|---|',
      '| prefix+a | leggi |',
    ].join('\n')
    expect(cleanForSpeech(raw)).toBe(
      ['Fatto.', 'Ho modificato tre file:', 'config.toml, aggiunti i tasti.', 'vedi la guida ok.', 'tasto, azione.', 'prefix+a, leggi.'].join('\n'),
    )
  })

  test('le lettere accentate e la punteggiatura restano', () => {
    expect(cleanForSpeech('Perché è già così?')).toBe('Perché è già così?')
  })

  test('un blocco di codice mai chiuso non si legge', () => {
    expect(cleanForSpeech('Ecco:\n```\nrm -rf /tmp/x')).toBe('Ecco:')
  })
})

describe('quanto lunghe', () => {
  const prosa = DEFAULTS.prosa.params
  const sintesi = DEFAULTS.sintesi.params

  test('Prosa: uguale fino alla soglia, poi ogni parola in più ne vale mezza', () => {
    expect([100, 250, 500, 1000].map(n => prosaWords(n, prosa, 0))).toEqual([100, 250, 375, 625])
  })

  test('Prosa: ◂ ▸ dimezzano e raddoppiano, fino al tetto ×4', () => {
    expect(prosaWords(100, prosa, 1)).toBe(200)
    expect(prosaWords(100, prosa, 2)).toBe(400)
    expect(prosaWords(100, prosa, 3)).toBe(400)
    expect(prosaWords(100, prosa, -1)).toBe(50)
  })

  test('Sintesi: a gradini, mai più righe di quante ne stiano nell\'originale', () => {
    expect([100, 400, 800, 2000].map(n => sintesiLines(n, sintesi, 0))).toEqual([3, 5, 7, 9])
    expect(sintesiLines(50, sintesi, 0)).toBe(1)
    expect(sintesiLines(30, sintesi, 2)).toBe(2) // 30 parole stanno in 2 righe da 12
    expect(sintesiLines(400, sintesi, 1)).toBe(7)
    expect(sintesiLines(400, sintesi, -1)).toBe(3)
    expect(sintesiLines(400, sintesi, 9)).toBe(9)
  })

  test('la durata di ascolto', () => {
    expect(listenTime(28, 1)).toBe('≈ 10″')
    expect(listenTime(250, 1)).toBe('≈ 1′30″')
    expect(listenTime(168, 1)).toBe('≈ 1′')
  })
})

describe('il testo', () => {
  test('le parole e l\'a capo', () => {
    expect(countWords('  uno due\ntre  ')).toBe(3)
    expect(wrap('uno due tre quattro', 9)).toEqual(['uno due', 'tre', 'quattro'])
    expect(wrap('a\n\nb', 10)).toEqual(['a', '', 'b'])
  })

  test('l\'ultima risposta: il testo di Claude dopo l\'ultimo prompt', () => {
    const m = (role: 'user' | 'assistant', text: string, tool = false) =>
      ({ role, text, toolUses: [], ...(tool ? { toolResults: [{}] } : {}) }) as unknown as SessionMessage
    const messages = [m('user', 'primo'), m('assistant', 'vecchia'), m('user', 'secondo'), m('assistant', 'Controllo.'), m('user', '', true), m('assistant', 'Fatto.')]
    expect(lastReply(messages)).toBe('Controllo.\n\nFatto.')
    expect(lastReply([m('user', 'solo io')])).toBe('')
  })
})

describe('i prompt', () => {
  test('i parametri dall\'editor: quello che non si capisce resta com\'era', () => {
    expect(paramsText('prosa', DEFAULTS)).toBe('soglia=250 tetto=4')
    const ok = parseParams('prosa', 'soglia=300 tetto=2', DEFAULTS)
    expect(ok.prompts.prosa.params).toEqual({ soglia: 300, tetto: 2 })
    expect(ok.errors).toEqual([])
    const bad = parseParams('sintesi', 'gradini=pippo parole_riga=10', DEFAULTS)
    expect(bad.prompts.sintesi.params).toEqual({ gradini: DEFAULTS.sintesi.params.gradini, paroleRiga: 10 })
    expect(bad.errors.length).toBe(1)
  })

  test('quanto salvato male si scarta, il resto si tiene', () => {
    const p = revive({ prosa: { template: 'mio', params: { soglia: 'x' } }, sintesi: 42 })
    expect(p.prosa.template).toBe('mio')
    expect(p.prosa.params.soglia).toBe(250)
    expect(p.sintesi).toEqual(DEFAULTS.sintesi)
  })

  test('la richiesta per Haiku: segnaposto riempiti, testo e contesto', () => {
    const v = vars('sintesi', DEFAULTS, 400, 0)
    expect(v).toEqual({ righe: 5, parole_riga: 12 })
    const r = quickRequest('sintesi', DEFAULTS, v, 'il frammento', 'la risposta intera')
    expect(r.prompt).toContain('5 righe al massimo')
    expect(r.prompt).toContain('TESTO:\n<<<\nil frammento\n>>>')
    expect(r.prompt).toContain('CONTESTO:\n<<<\nla risposta intera\n>>>')
    expect(r.system).toContain('italiano')
  })


})
