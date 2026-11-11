// I prompt di Prosa e Sintesi: i default decisi insieme, i parametri che li
// riempiono, e la richiesta che ne esce per Haiku (veloce) o per il fork della
// sessione (profonda). Il testo e i parametri si cambiano dal pannello (✎) e
// tornano qui con ↺.
import { fill, parseSteps, prosaWords, sintesiLines } from './text'
import type { ProsaParams, SintesiParams } from './text'

export type Kind = 'prosa' | 'sintesi'

export type Prompts = {
  prosa: { template: string; params: ProsaParams }
  sintesi: { template: string; params: SintesiParams }
}

export const DEFAULTS: Prompts = {
  prosa: {
    template: [
      'Sei un collega esperto che spiega a voce. Riscrivi il testo in italiano parlato, per chi ci sta lavorando adesso.',
      '– Prosa continua, paragrafi brevi. Niente elenchi, tabelle, titoli, simboli markdown, emoji.',
      '– Srotola: tabelle ed elenchi diventano frasi collegate da un filo logico (prima, poi, quindi, però).',
      '– Percorsi, comandi e codice non si leggono carattere per carattere: di\' a cosa servono ("il file di configurazione di herdr"). Cita un nome solo se è indispensabile.',
      '– Tieni tutti i fatti, numeri, decisioni e domande aperte. Non aggiungere nulla che non ci sia.',
      '– Se il testo chiede una scelta o una risposta, chiudi ricordandola.',
      '– Lunghezza: circa {parole} parole.',
      'Rispondi solo con il testo riscritto.',
    ].join('\n'),
    params: { soglia: 250, tetto: 4 },
  },
  sintesi: {
    template: [
      'Riduci il testo ai suoi punti essenziali, in italiano.',
      '– {righe} righe al massimo, una per punto, ciascuna sotto le {parole_riga} parole. Mai più lunga dell\'originale.',
      '– Telegrafico: parole chiave, pochi verbi, niente giri di frase.',
      '– In ordine di importanza: prima l\'esito o la decisione. Se serve qualcosa da me, l\'ultima riga lo dice.',
      '– Niente simboli markdown, niente percorsi lunghi.',
      '– Non aggiungere nulla che non ci sia.',
      'Rispondi solo con le righe.',
    ].join('\n'),
    params: { gradini: '60:1, 200:3, 500:5, 1000:7, oltre:9', paroleRiga: 12 },
  },
}

// Quello che vale sempre, fuori dall'editor.
export const SYSTEM =
  'Sei Voxbox: riscrivi testi per leggerli sullo schermo e ascoltarli. Scrivi sempre in italiano, anche se il testo è in un\'altra lingua. Rispondi solo con il testo richiesto: niente premesse, niente markdown.'

const SELECTION_NOTE =
  'Il testo è un frammento selezionato da una risposta più lunga, riportata sotto come CONTESTO. Usa il contesto solo per capire il frammento: riscrivi solo il frammento.'

const FORK_NOTE = (isSelection: boolean) =>
  [
    '[Voxbox] Richiesta a parte, non della persona alla conversazione: non usare strumenti e non proseguire il lavoro.',
    isSelection
      ? 'Il testo qui sotto è un frammento preso da questa conversazione: usa quello che sai della conversazione per capirlo, ma riscrivi solo il frammento.'
      : 'Il testo qui sotto è la tua ultima risposta in questa conversazione: usa quello che sai della conversazione per renderla più chiara.',
    'Scrivi sempre in italiano. Rispondi solo con il testo richiesto: niente premesse, niente markdown.',
  ].join('\n')

/** I valori dei segnaposto per un originale di `words` parole al livello dato. */
export function vars(kind: Kind, prompts: Prompts, words: number, level: number): Record<string, number> {
  if (kind === 'prosa') return { parole: prosaWords(words, prompts.prosa.params, level) }
  const p = prompts.sintesi.params
  return { righe: sintesiLines(words, p, level), parole_riga: p.paroleRiga }
}

const block = (label: string, text: string) => `${label}:\n<<<\n${text}\n>>>`

/** La richiesta per Haiku: il prompt riempito, il testo e, per una selezione, il contesto. */
export function quickRequest(kind: Kind, prompts: Prompts, values: Record<string, number>, text: string, context?: string) {
  const parts = [fill(prompts[kind].template, values)]
  if (context) parts.push(SELECTION_NOTE)
  parts.push(block('TESTO', text))
  if (context) parts.push(block('CONTESTO', context))
  // Un italiano scritto prende circa due token per parola, più margine.
  const words = kind === 'prosa' ? values.parole! : values.righe! * values.parole_riga!
  return { system: SYSTEM, prompt: parts.join('\n\n'), maxTokens: Math.min(8000, Math.round(words * 2.5) + 300) }
}

/** La domanda al fork della sessione: sa già tutto, gli serve solo il compito e il testo. */
export function forkPrompt(kind: Kind, prompts: Prompts, values: Record<string, number>, text: string, isSelection: boolean): string {
  return [FORK_NOTE(isSelection), fill(prompts[kind].template, values), block('TESTO', text)].join('\n\n')
}

// ---- i parametri come riga di testo, per l'editor ----

export function paramsText(kind: Kind, prompts: Prompts): string {
  if (kind === 'prosa') {
    const p = prompts.prosa.params
    return `soglia=${p.soglia} tetto=${p.tetto}`
  }
  const p = prompts.sintesi.params
  return `gradini=${p.gradini.replace(/\s+/g, '')} parole_riga=${p.paroleRiga}`
}

/** La riga dei parametri riletta; quello che non si capisce resta com'era. Con gli errori trovati. */
export function parseParams(kind: Kind, text: string, before: Prompts): { prompts: Prompts; errors: string[] } {
  const got = Object.fromEntries(
    Array.from(text.matchAll(/(\w+)\s*=\s*(\S+)/g), m => [m[1]!.toLowerCase(), m[2]!] as const),
  )
  const errors: string[] = []
  const num = (key: string, fallback: number, min: number) => {
    if (got[key] === undefined) return fallback
    const n = Number(got[key])
    if (Number.isFinite(n) && n >= min) return n
    errors.push(`${key} non valido`)
    return fallback
  }
  if (kind === 'prosa') {
    const p = before.prosa.params
    return { prompts: { ...before, prosa: { ...before.prosa, params: { soglia: num('soglia', p.soglia, 10), tetto: num('tetto', p.tetto, 1) } } }, errors }
  }
  const p = before.sintesi.params
  let gradini = p.gradini
  if (got.gradini !== undefined) {
    const steps = parseSteps(got.gradini)
    if (steps.length > 0 && steps.at(-1)!.upTo === null) gradini = steps.map(s => `${s.upTo ?? 'oltre'}:${s.lines}`).join(', ')
    else errors.push('gradini non validi: es. 60:1,200:3,oltre:9')
  }
  return { prompts: { ...before, sintesi: { ...before.sintesi, params: { gradini, paroleRiga: num('parole_riga', p.paroleRiga, 3) } } }, errors }
}

/** Quanto salvato in `$.store` con una versione precedente: si prende solo ciò che ha la forma giusta. */
export function revive(stored: unknown): Prompts {
  const s = (stored ?? {}) as Partial<Record<Kind, { template?: unknown; params?: Record<string, unknown> }>>
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() !== '' ? v : d)
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    prosa: {
      template: str(s.prosa?.template, DEFAULTS.prosa.template),
      params: { soglia: num(s.prosa?.params?.soglia, DEFAULTS.prosa.params.soglia), tetto: num(s.prosa?.params?.tetto, DEFAULTS.prosa.params.tetto) },
    },
    sintesi: {
      template: str(s.sintesi?.template, DEFAULTS.sintesi.template),
      params: {
        gradini: str(s.sintesi?.params?.gradini, DEFAULTS.sintesi.params.gradini),
        paroleRiga: num(s.sintesi?.params?.paroleRiga, DEFAULTS.sintesi.params.paroleRiga),
      },
    },
  }
}
