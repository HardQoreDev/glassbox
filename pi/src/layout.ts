// Dall'albero di nodi alle righe del terminale. Glassbox disegna una colonna
// di righe alte uno: testi colorati, pulsanti, e ogni tanto un campo di testo.
// Qui ogni riga diventa una stringa ANSI larga al più `width`, con le zone che
// si possono cliccare (i pulsanti) e i campi che contiene.
import { backgroundAnsi, foregroundAnsi, parseColor, visibleWidth } from '@earendil-works/pi-tui'

import type { Child, El } from './jsx.ts'

type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean }
type Seg = { text: string; style: Style; button?: ButtonRef; input?: El }

export type ButtonRef = { key: string; press: () => void }
export type Region = { x0: number; x1: number; button: ButtonRef }
/** Un campo di testo trovato nel disegno: dove sta e quanto è largo. */
export type Field = { key: string; props: Record<string, any>; x: number; width: number; prefix: string }
export type Line = { text: string; regions: Region[]; w: number; field?: Field }

export type ColorMode = 'truecolor' | '256color'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const colorCache = new Map<string, string>()
// `#rrggbb` o `ansi256(n)`, come li scrive Glassbox.
function ansiOf(color: string, isBg: boolean, mode: ColorMode): string {
  const id = `${isBg ? 'b' : 'f'}:${mode}:${color}`
  let out = colorCache.get(id)
  if (out === undefined) {
    try {
      const m = color.match(/^ansi256\((\d+)\)$/)
      const parsed = parseColor(m ? Number(m[1]) : color)
      out = isBg ? backgroundAnsi(parsed, mode) : foregroundAnsi(parsed, mode)
    } catch {
      out = ''
    }
    colorCache.set(id, out)
  }
  return out
}

function paint(text: string, s: Style, mode: ColorMode, isFocused: boolean): string {
  let open = ''
  if (s.fg) open += ansiOf(s.fg, false, mode)
  if (s.bg) open += ansiOf(s.bg, true, mode)
  if (s.bold) open += '\x1b[1m'
  if (s.dim) open += '\x1b[2m'
  if (s.italic) open += '\x1b[3m'
  if (s.underline) open += '\x1b[4m'
  if (s.inverse !== isFocused) open += '\x1b[7m'
  return open === '' ? text : `${open}${text}\x1b[0m`
}

const styleOf = (p: Record<string, any>, base: Style): Style => ({
  ...base,
  ...(p.color ? { fg: p.color } : {}),
  ...(p.backgroundColor ? { bg: p.backgroundColor } : {}),
  ...(p.bold ? { bold: true } : {}),
  ...(p.dimColor ? { dim: true } : {}),
  ...(p.italic ? { italic: true } : {}),
  ...(p.underline ? { underline: true } : {}),
  ...(p.inverse ? { inverse: true } : {}),
})

const widthOf = (segs: Seg[]): number => segs.reduce((n, s) => n + visibleWidth(s.text), 0)

// Taglia i segmenti a `width` colonne, grafema per grafema.
function clip(segs: Seg[], width: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const seg of segs) {
    const w = visibleWidth(seg.text)
    if (used + w <= width) {
      out.push(seg)
      used += w
      continue
    }
    let text = ''
    for (const { segment } of segmenter.segment(seg.text)) {
      const gw = visibleWidth(segment)
      if (used + gw > width) break
      text += segment
      used += gw
    }
    if (text !== '') out.push({ ...seg, text })
    break
  }
  return out
}

let anonymous = 0

// I figli di una riga, uno dopo l'altro.
function inline(node: Child, style: Style, button: ButtonRef | undefined, out: Seg[]): void {
  if (typeof node === 'string') {
    if (node !== '') out.push({ text: node, style, button })
    return
  }
  const p = node.props
  if (node.type === 'Input') {
    out.push({ text: '', style, input: node })
    return
  }
  if (node.type === 'Code') {
    out.push({ text: String(p.source ?? '').split('\n')[0] ?? '', style })
    return
  }
  if (node.type === 'Button') {
    const ref: ButtonRef = { key: String(p.key ?? `button:${anonymous++}`), press: typeof p.onPress === 'function' ? p.onPress : () => undefined }
    const s = styleOf(p, style)
    if (!p.plain) out.push({ text: '[ ', style: s, button: ref })
    if (node.children.length > 0) for (const c of node.children) inline(c, s, ref, out)
    else if (p.label) out.push({ text: String(p.label), style: s, button: ref })
    if (!p.plain) out.push({ text: ' ]', style: s, button: ref })
    return
  }
  if (node.type === 'Box') {
    const s = styleOf({ backgroundColor: p.backgroundColor }, style)
    const inner: Seg[] = []
    for (const c of node.children) inline(c, s, button, inner)
    if (typeof p.width === 'number') {
      const cut = clip(inner, p.width)
      const pad = p.width - widthOf(cut)
      out.push(...cut)
      if (pad > 0) out.push({ text: ' '.repeat(pad), style: s, button })
    } else out.push(...inner)
    return
  }
  // Text, Fragment e il resto: lo stile, poi i figli.
  const s = node.type === 'Text' ? styleOf(p, style) : style
  for (const c of node.children) inline(c, s, button, out)
}

function row(node: Child, width: number, mode: ColorMode, focusedKey: string): Line {
  const segs: Seg[] = []
  inline(node, {}, undefined, segs)
  const at = segs.findIndex(s => s.input)
  if (at !== -1) {
    // Un campo: quello che lo precede resta davanti, lui prende il resto della riga.
    const before = clip(segs.slice(0, at), width)
    const x = widthOf(before)
    const input = segs[at]!.input!
    return {
      text: '',
      regions: [],
      w: 0,
      field: { key: String(input.props.key ?? 'input'), props: input.props, x, width: Math.max(4, width - x), prefix: before.map(s => paint(s.text, s.style, mode, false)).join('') },
    }
  }
  const cut = clip(segs, width)
  const bg = typeof node !== 'string' && node.type === 'Box' ? node.props.backgroundColor : undefined
  const pad = width - widthOf(cut)
  if (bg && pad > 0) cut.push({ text: ' '.repeat(pad), style: { bg } })
  const regions: Region[] = []
  let text = ''
  let x = 0
  for (const seg of cut) {
    const w = visibleWidth(seg.text)
    if (seg.button) {
      const last = regions.at(-1)
      if (last && last.button === seg.button && last.x1 === x) last.x1 = x + w
      else regions.push({ x0: x, x1: x + w, button: seg.button })
    }
    text += paint(seg.text, seg.style, mode, seg.button !== undefined && seg.button.key === focusedKey)
    x += w
  }
  return { text, regions, w: x }
}

const blank = (): Line => ({ text: '', regions: [], w: 0 })

// Il codice di un file, o il suo diff: le righe aggiunte verdi, le tolte rosse.
function code(p: Record<string, any>, width: number, mode: ColorMode): Line[] {
  const out: Line[] = []
  for (const raw of String(p.source ?? '').split('\n')) {
    const text = raw.replace(/\t/g, '  ')
    const style: Style =
      p.format !== 'diff' ? {} : text.startsWith('@@') ? { fg: '#22d3ee', dim: true } : text.startsWith('+') ? { fg: '#4ade80' } : text.startsWith('-') ? { fg: '#f87171' } : {}
    let rest: Seg[] = [{ text, style }]
    do {
      const cut = clip(rest, width)
      const taken = cut.map(c => c.text).join('')
      out.push({ text: cut.map(c => paint(c.text, c.style, mode, false)).join(''), regions: [], w: widthOf(cut) })
      rest = p.wrap === 'wrap' && taken.length > 0 && taken.length < rest[0]!.text.length ? [{ text: rest[0]!.text.slice(taken.length), style }] : []
    } while (rest.length > 0)
  }
  return out
}

const isBlock = (c: Child): boolean =>
  typeof c !== 'string' && (c.type === 'Code' || (c.type === 'Box' && (c.props.flexDirection === 'column' || (typeof c.props.height === 'number' && c.props.height > 1))))

// Un nodo come blocco di righe: una colonna mette i figli in fila, una riga
// alta più di uno li mette fianco a fianco, tutto il resto è una riga sola.
function block(node: Child, width: number, mode: ColorMode, focusedKey: string): Line[] {
  if (typeof node === 'string') return [row(node, width, mode, focusedKey)]
  if (node.type === 'Fragment') return node.children.flatMap(c => block(c, width, mode, focusedKey))
  if (node.type === 'Code') return code(node.props, width, mode)
  if (node.type !== 'Box') return [row(node, width, mode, focusedKey)]
  const p = node.props
  const w = typeof p.width === 'number' ? Math.min(width, p.width) : width
  let lines: Line[]
  if (p.flexDirection === 'column') lines = node.children.flatMap(c => block(c, w, mode, focusedKey))
  else if (node.children.some(isBlock)) {
    // Colonne: chi dice quanto è largo lo è, gli altri si dividono il resto.
    const fixed = node.children.map(c => (typeof c !== 'string' && typeof c.props.width === 'number' ? c.props.width : undefined))
    const free = Math.max(0, w - fixed.reduce<number>((n, f) => n + (f ?? 0), 0))
    const flexible = Math.max(1, fixed.filter(f => f === undefined).length)
    const widths = fixed.map(f => f ?? Math.floor(free / flexible))
    const columns = node.children.map((c, i) => block(c, widths[i]!, mode, focusedKey))
    const height = Math.max(0, ...columns.map(c => c.length))
    lines = []
    for (let y = 0; y < height; y++) {
      const line: Line = { text: '', regions: [], w: 0 }
      columns.forEach((column, i) => {
        const part = column[y] ?? blank()
        for (const r of part.regions) line.regions.push({ ...r, x0: r.x0 + line.w, x1: r.x1 + line.w })
        line.text += part.text + ' '.repeat(Math.max(0, widths[i]! - part.w))
        line.w += widths[i]!
      })
      lines.push(line)
    }
  } else lines = [row(node, w, mode, focusedKey)]
  if (typeof p.height === 'number' && p.height > 1) {
    lines = lines.slice(0, p.height)
    while (lines.length < p.height) lines.push(blank())
  }
  return lines
}

/** Le righe dell'albero, larghe al più `width`. */
export function layout(tree: Child, width: number, mode: ColorMode, focusedKey = ''): Line[] {
  anonymous = 0
  return block(tree, width, mode, focusedKey)
}
