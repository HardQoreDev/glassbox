import type { Elements, EngineInterface, RenderElement } from 'claude-code'

export { cell, fit } from './vendor/turns'

// Gli elementi delle due superfici che il pannello disegna.
export type Els = Elements['terminal'] | Elements['desktop']

// Una riga di sezione, creata solo se cade nella finestra visibile.
export type Line = (el: Els) => RenderElement

/** Ridisegna il pannello: l'unico `ui.render` di questo mod. */
export function redraw($: EngineInterface): void {
  $.ui.invalidate('ui.render')
}

export const len = (text: string): number => Array.from(text).length

// Il colore d'accento e il fondo della riga selezionata, come in VS Code.
export const ACCENT = '#59a4f9'
export const SELECTED_BG = 'ansi256(237)'

/** `2h`, `3d`, `Oct 12`: quanto tempo fa, per i commit. */
export const ago = (ms: number, now: number): string => {
  const s = (now - ms) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`
  const d = new Date(ms)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return s < 365 * 86_400 ? `${months[d.getMonth()]} ${d.getDate()}` : String(d.getFullYear())
}

/** `text` a capo in righe di `w` colonne, tra le parole quando si può. */
export function wrapText(text: string, w: number): string[] {
  const chars = Array.from(text)
  const out: string[] = []
  let start = 0
  while (chars.length - start > w) {
    let cut = -1
    for (let k = start + w; k > start; k--) {
      if (chars[k] === ' ') {
        cut = k
        break
      }
    }
    if (cut < 0) {
      out.push(chars.slice(start, start + w).join(''))
      start += w
    } else {
      out.push(chars.slice(start, cut).join(''))
      start = cut + 1
    }
  }
  out.push(chars.slice(start).join(''))
  return out
}
