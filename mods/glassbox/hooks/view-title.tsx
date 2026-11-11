// Il titolo in cima alla barra: GLASSBOX in lettere a mezzi blocchi, con una
// sfumatura dal verde acqua al viola come la luce dentro un vetro, la riga di
// sopra più chiara di quella di sotto. A destra la versione e il motto. In un
// pannello stretto resta una riga sola.
import type { RenderElement } from 'claude-code'

import { len } from './ui'
import type { Els } from './ui'

const LOGO = ['█▀▀ █   ▄▀█ █▀ █▀ █▄▄ █▀█ ▀▄▀', '█▄█ █▄▄ █▀█ ▄█ ▄█ █▄█ █▄█ █ █']
const MOTTO = 'see inside the agent'
// Verde acqua, azzurro, viola.
const STOPS: [number, number, number][] = [
  [0x5e, 0xea, 0xd4],
  [0x59, 0xa4, 0xf9],
  [0xa7, 0x8b, 0xfa],
]
// La riga di sotto ha questa parte della luce di quella di sopra.
const LOWER = 0.78
// A sinistra come il nome delle sezioni, dopo la loro barretta.
const LEFT = '  '

const hex = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** Il colore al punto `t` (da 0 a 1) della sfumatura, con `light` della sua luce. */
export function shade(t: number, light = 1): string {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const a = STOPS[i]!
  const b = STOPS[i + 1]!
  return hex(a.map((v, k) => (v + (b[k]! - v) * (x - i)) * light))
}

// Una riga di testo colonna per colonna lungo la sfumatura; gli spazi restano spazi.
const gradient = (el: Els, text: string, light: number): RenderElement[] => {
  const chars = Array.from(text)
  return chars.map((ch, i) => (ch === ' ' ? <el.Text> </el.Text> : <el.Text color={shade(i / Math.max(1, chars.length - 1), light)}>{ch}</el.Text>))
}

// Lo scambio con Voxbox, sotto il motto (vedi twin.ts).
const SWAP = '⇄ voxbox'

/**
 * Le righe del titolo, l'ultima vuota a staccarlo dalle sezioni. Con `onSwap`
 * (Voxbox è caricato) quell'ultima riga porta a destra lo scambio, se ci sta,
 * e anche il logo lo fa al clic.
 */
export function titleLines(el: Els, width: number, version: string, onSwap?: () => void): RenderElement[] {
  const tag = version ? `v${version}` : ''
  const logoW = len(LEFT) + len(LOGO[0]!)
  const row = (key: string, left: RenderElement[], leftW: number, right: string, italic: boolean) => (
    <el.Box key={key} flexDirection="row" height={1} overflow="hidden">
      <el.Text>{LEFT}</el.Text>
      {onSwap ? (
        // Anche il logo passa a Voxbox; `inverse: false` gli toglie l'inversione sotto il puntatore.
        <el.Button key={`${key}:logo`} plain hover={{ scope: 'glassbox-logo', inverse: false }} onPress={onSwap}>
          {left}
        </el.Button>
      ) : (
        left
      )}
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
    const word = 'G L A S S B O X'
    return [row('title:0', gradient(el, word, 1), len(LEFT) + len(word), tag, false), blank]
  }
  return [
    row('title:0', gradient(el, LOGO[0]!, 1), logoW, tag, false),
    row('title:1', gradient(el, LOGO[1]!, LOWER), logoW, MOTTO, true),
    blank,
  ]
}
