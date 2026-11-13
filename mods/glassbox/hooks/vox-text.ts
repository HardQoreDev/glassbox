// Il testo di VOX e SYNTH, senza engine: da dove viene (l'ultima risposta), come si
// pulisce per la voce, quanto si conta e quanto devono essere lunghe Prosa e
// Sintesi. Tutto puro, così i test lo provano da solo.
import type { SessionMessage } from 'claude-code'

// ---- l'ultima risposta ----------------------------------------------------

// Una riga user che è un prompt: ha testo e non porta risultati di strumenti.
// Come in copia-risposta (mods/copia-risposta/hooks/reply.ts).
const isPrompt = (m: SessionMessage): boolean =>
  m.role === 'user' && (m.toolResults?.length ?? 0) === 0 && m.text.trim() !== ''

/** Il testo di Claude dopo l'ultimo prompt della persona; `''` se non ce n'è. */
export function lastReply(messages: readonly SessionMessage[]): string {
  const start = messages.findLastIndex(isPrompt)
  return messages
    .slice(start + 1)
    .filter(m => m.role === 'assistant')
    .map(m => m.text.trim())
    .filter(text => text !== '')
    .join('\n\n')
}

// ---- contare ----------------------------------------------------------------

/** Le parole di un testo, contate sugli spazi. */
export const countWords = (text: string): number => (text.match(/\S+/g) ?? []).length

// serena-high a velocità 1 legge circa 2,8 parole al secondo.
const WORDS_PER_SECOND = 2.8

/** Quanto dura l'ascolto, in parole leggibili: `≈ 35″`, `≈ 1′30″`. */
export function listenTime(words: number, speed: number): string {
  const s = Math.max(1, Math.round(words / (WORDS_PER_SECOND * speed)))
  if (s < 60) return `≈ ${s}″`
  const m = Math.floor(s / 60)
  const rest = Math.round((s % 60) / 5) * 5
  return rest === 0 || rest === 60 ? `≈ ${rest === 60 ? m + 1 : m}′` : `≈ ${m}′${String(rest).padStart(2, '0')}″`
}

// ---- pulire per la voce --------------------------------------------------

const BOX = /[─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰▌▐█▀▄⎿⏺●○◎◆◇■□▪▫]/g
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu

/**
 * Il testo come la voce deve leggerlo: via il codice, i link, i simboli del
 * markdown e i caratteri grafici del terminale; le tabelle diventano elenchi
 * di parole, i percorsi il loro ultimo nome, ogni riga chiusa da un punto
 * così la voce fa una pausa.
 */
export function cleanForSpeech(text: string): string {
  let t = text.replace(/\r/g, '')
  t = t.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, ' ')
  t = t.replace(/^[ \t]*(```|~~~)[\s\S]*$/m, ' ') // un blocco aperto e mai chiuso
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  t = t.replace(/\bhttps?:\/\/\S+/g, 'link')
  t = t.replace(/`([^`\n]*)`/g, '$1')
  // ~/.config/herdr/config.toml → config.toml; /mnt/c/x → x
  t = t.replace(/(?:~|\.{1,2})?(?:\/[\w.@+-]+){2,}\/?/g, p => p.replace(/\/$/, '').split('/').pop() ?? '')
  t = t.replace(/^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*\|?[ \t]*$/gm, '')
  t = t.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm,(_, row: string) => row.split('|').map(c => c.trim()).filter(Boolean).join(', '))
  t = t.replace(BOX, ' ').replace(EMOJI, ' ')
  t = t.replace(/\s*(?:→|⇒|->|=>)\s*/g, ', ').replace(/\s*(?:←|<-)\s*/g, ', ')
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
  t = t.replace(/\*\*|__|\*|(?<=\s|^)_|_(?=\s|$)|~~/gm, '')
  t = t.replace(/[<>{}[\]|#^\\]/g, ' ')
  const lines = t
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .filter(l => /[\p{L}\p{N}]/u.test(l))
    .map(l => (/[.!?:;,…]$/.test(l) ? l : `${l}.`))
  return lines.join('\n')
}

// ---- quanto lunghe -------------------------------------------------------

export type ProsaParams = { soglia: number; tetto: number }
export type SintesiParams = { gradini: string; paroleRiga: number }
export type Step = { upTo: number | null; lines: number }

/** I livelli di ◂ ▸ della Prosa: ogni passo raddoppia o dimezza, fino al tetto. */
export function prosaLevels(p: ProsaParams): { min: number; max: number } {
  const max = Math.max(0, Math.floor(Math.log2(Math.max(1, p.tetto))))
  return { min: -max, max }
}

/**
 * Le parole che la Prosa deve avere: uguali all'originale fino alla soglia,
 * oltre ogni parola in più ne vale mezza; poi ×2 o ×½ per ogni passo di ◂ ▸.
 */
export function prosaWords(n: number, p: ProsaParams, level: number): number {
  const base = n <= p.soglia ? n : p.soglia + (n - p.soglia) / 2
  const { min, max } = prosaLevels(p)
  const step = Math.min(max, Math.max(min, level))
  return Math.max(15, Math.round(base * 2 ** step))
}

/** `60:1, 200:3, oltre:9` → i gradini, l'ultimo senza limite. Male scritto: `[]`. */
export function parseSteps(text: string): Step[] {
  const steps: Step[] = []
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d+|oltre)\s*:\s*(\d+)$/i)
    if (!m) continue
    steps.push({ upTo: m[1]!.toLowerCase() === 'oltre' ? null : Number(m[1]), lines: Number(m[2]) })
  }
  return steps.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
}

/** Il gradino dell'originale, prima di ◂ ▸. */
export function baseStep(n: number, steps: readonly Step[]): number {
  const at = steps.findIndex(s => s.upTo === null || n <= s.upTo)
  return at === -1 ? steps.length - 1 : at
}

/**
 * Le righe della Sintesi: il gradino dell'originale spostato da ◂ ▸, mai più
 * di quante ne stiano nelle parole dell'originale.
 */
export function sintesiLines(n: number, p: SintesiParams, level: number): number {
  const steps = parseSteps(p.gradini)
  if (steps.length === 0) return 5
  const at = Math.min(steps.length - 1, Math.max(0, baseStep(n, steps) + level))
  const cap = Math.max(1, Math.floor(n / Math.max(1, p.paroleRiga)))
  return Math.max(1, Math.min(steps[at]!.lines, cap))
}

// ---- impaginare ------------------------------------------------------------

/** Il testo a capo sulle parole, entro `width` colonne; le righe vuote restano. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(8, width)
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para.trim() === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      for (let piece = word; piece.length > 0; ) {
        const room = line === '' ? w : w - line.length - 1
        if (Array.from(piece).length <= room) {
          line = line === '' ? piece : `${line} ${piece}`
          piece = ''
        } else if (line !== '') {
          out.push(line)
          line = ''
        } else {
          const chars = Array.from(piece)
          out.push(chars.slice(0, w).join(''))
          piece = chars.slice(w).join('')
        }
      }
    }
    out.push(line)
  }
  return out
}

/** Riempie `{nome}` con i valori; i segnaposto sconosciuti restano come sono. */
export const fill = (template: string, vars: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))
