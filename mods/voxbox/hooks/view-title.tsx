// Il titolo in cima al pannello: VOXBOX in lettere a mezzi blocchi, con una
// sfumatura dall'arancio al viola, la riga di sopra più chiara di quella di
// sotto. A destra la versione e il motto; sotto, se Glassbox c'è, lo scambio.
// In un pannello stretto il logo resta una riga sola, e la versione sparisce
// prima del logo.
//
// È la stessa impaginazione del titolo di Glassbox (mods/glassbox/hooks/
// view-title.tsx), copiata apposta: i mod installati non possono importare
// codice l'uno dall'altro. Cambiando una, va cambiata anche l'altra. Qui in
// più c'è la transizione tra i due titoli, che fa tutta Voxbox (morphLines).
import type { Elements, RenderElement } from 'claude-code'

type Els = Elements['terminal'] | Elements['desktop']
export const len = (text: string): number => Array.from(text).length

type Rgb = [number, number, number]
type Look = { logo: [string, string]; word: string; stops: Rgb[] }

export type TitleOf = 'glassbox' | 'voxbox'

// I due titoli, Voxbox e Glassbox (quello di Glassbox serve alla transizione).
const LOOKS: Record<TitleOf, Look> = {
  voxbox: {
    logo: ['█ █ █▀█ ▀▄▀ █▄▄ █▀█ ▀▄▀', '▀▄▀ █▄█ █ █ █▄█ █▄█ █ █'],
    word: 'V O X B O X',
    // Arancio, rosa, viola: la stessa luce di Glassbox, più calda.
    stops: [
      [0xfb, 0xbf, 0x24],
      [0xf4, 0x72, 0xb6],
      [0xa7, 0x8b, 0xfa],
    ],
  },
  glassbox: {
    logo: ['█▀▀ █   ▄▀█ █▀ █▀ █▄▄ █▀█ ▀▄▀', '█▄█ █▄▄ █▀█ ▄█ ▄█ █▄█ █▄█ █ █'],
    word: 'G L A S S B O X',
    // Verde acqua, azzurro, viola, come in mods/glassbox/hooks/view-title.tsx.
    stops: [
      [0x5e, 0xea, 0xd4],
      [0x59, 0xa4, 0xf9],
      [0xa7, 0x8b, 0xfa],
    ],
  },
}
const LOGO = LOOKS.voxbox.logo
const MOTTO = 'hear the agent'
// La riga di sotto ha questa parte della luce di quella di sopra.
const LOWER = 0.78
// A sinistra come il nome delle sezioni, dopo la loro barretta.
const LEFT = '  '

const hex = (c: number[]) => `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`

function rgb(stops: readonly Rgb[], t: number, light: number): number[] {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const a = stops[i]!
  const b = stops[i + 1]!
  return a.map((v, k) => (v + (b[k]! - v) * (x - i)) * light)
}

/** Il colore al punto `t` (da 0 a 1) della sfumatura, con `light` della sua luce. */
export const shade = (t: number, light = 1): string => hex(rgb(LOOKS.voxbox.stops, t, light))

// Una riga di testo colonna per colonna lungo la sfumatura; gli spazi restano spazi.
const gradient = (el: Els, text: string, light: number): RenderElement[] => {
  const chars = Array.from(text)
  return chars.map((ch, i) => (ch === ' ' ? <el.Text> </el.Text> : <el.Text color={shade(i / Math.max(1, chars.length - 1), light)}>{ch}</el.Text>))
}

// Lo scambio con Glassbox, sotto il motto (vedi mods/glassbox/hooks/twin.ts).
const SWAP = '⇄ glassbox'

/**
 * Le righe del titolo, l'ultima vuota a staccarlo dal resto. Con `onSwap`
 * (Glassbox è caricato) quell'ultima riga porta a destra lo scambio, se ci
 * sta, e anche il logo lo fa al clic.
 */
export function titleLines(el: Els, width: number, version: string, onSwap?: () => void): RenderElement[] {
  const tag = version ? `v${version}` : ''
  const logoW = len(LEFT) + len(LOGO[0])
  // Il logo come pulsante: prova se `inverse: false` ferma l'inversione sotto il puntatore.
  const logo = (key: string, letters: RenderElement[]) =>
    onSwap ? (
      <el.Button key={`${key}:logo`} plain hover={{ scope: 'voxbox-logo', inverse: false }} onPress={onSwap}>
        {letters}
      </el.Button>
    ) : (
      letters
    )
  const row = (key: string, left: RenderElement[], leftW: number, right: string, italic: boolean) => (
    <el.Box key={key} flexDirection="row" height={1} overflow="hidden">
      <el.Text>{LEFT}</el.Text>
      {logo(key, left)}
      {right && width - leftW - len(right) >= 2 ? (
        <el.Text dimColor italic={italic}>{`${' '.repeat(width - leftW - len(right))}${right}`}</el.Text>
      ) : (
        <el.Text> </el.Text>
      )}
    </el.Box>
  )
  const blank =
    onSwap && width - len(SWAP) >= len(LEFT) ? (
      <el.Box key="title:gap" flexDirection="row" height={1} overflow="hidden">
        <el.Text>{' '.repeat(width - len(SWAP))}</el.Text>
        <el.Button key="title:swap" plain onPress={onSwap}>
          <el.Text color={shade(1)}>{SWAP}</el.Text>
        </el.Button>
      </el.Box>
    ) : (
      <el.Box key="title:gap" height={1}>
        <el.Text> </el.Text>
      </el.Box>
    )
  if (width < logoW + 1) {
    const word = LOOKS.voxbox.word
    return [row('title:0', gradient(el, word, 1), len(LEFT) + len(word), tag, false), blank]
  }
  return [row('title:0', gradient(el, LOGO[0], 1), logoW, tag, false), row('title:1', gradient(el, LOGO[1], LOWER), logoW, MOTTO, true), blank]
}

// ---- la transizione ---------------------------------------------------------

export const MORPH_FRAMES = 6
export const MORPH_MS = 55

// Un numero fisso tra 0 e 1 per ogni colonna (e fotogramma): l'ordine in cui
// le lettere cambiano sembra a caso ma è sempre lo stesso.
const noise = (i: number, salt: number) => (((Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0) % 1000) / 1000
const GLITCH_BLOCKS = Array.from('▀▄█▌▐▖▗▘▝▚▞')
const GLITCH_LETTERS = Array.from('AXOBSGLV')
const ease = (p: number) => p * p * (3 - 2 * p)

/**
 * Il titolo a metà tra Glassbox e Voxbox, al punto `p` (da 0 a 1): le lettere
 * passano da un logo all'altro colonna per colonna, con un attimo di disturbo,
 * e la luce scorre da una sfumatura all'altra. Niente versione né motto mentre
 * cambia: tornano al fotogramma finale.
 */
export function morphLines(el: Els, width: number, from: TitleOf, to: TitleOf, p: number, frame: number): RenderElement[] {
  const a = LOOKS[from]
  const b = LOOKS[to]
  const isLarge = width >= len(LEFT) + Math.max(len(a.logo[0]), len(b.logo[0])) + 1
  const rows: [string, string][] = isLarge ? [0, 1].map(r => [a.logo[r as 0 | 1], b.logo[r as 0 | 1]]) : [[a.word, b.word]]
  const glitch = isLarge ? GLITCH_BLOCKS : GLITCH_LETTERS
  const lines = rows.map(([src, dst], r) => {
    const s = Array.from(src)
    const d = Array.from(dst)
    const w = Math.max(s.length, d.length)
    const light = r === 1 ? LOWER : 1
    const cells: RenderElement[] = []
    for (let i = 0; i < w; i++) {
      const th = noise(i, r) * 0.7
      const ch = p < th ? (s[i] ?? ' ') : p < th + 0.3 ? glitch[Math.floor(noise(i, frame * 3 + r) * glitch.length)]! : (d[i] ?? ' ')
      const t = i / Math.max(1, w - 1)
      const mix = ease(p)
      const color = hex(rgb(a.stops, t, light).map((v, k) => v + (rgb(b.stops, t, light)[k]! - v) * mix))
      cells.push(ch === ' ' ? <el.Text> </el.Text> : <el.Text color={color}>{ch}</el.Text>)
    }
    return (
      <el.Box key={`title:${r}`} flexDirection="row" height={1} overflow="hidden">
        <el.Text>{LEFT}</el.Text>
        {cells}
      </el.Box>
    )
  })
  return [
    ...lines,
    <el.Box key="title:gap" height={1}>
      <el.Text> </el.Text>
    </el.Box>,
  ]
}
