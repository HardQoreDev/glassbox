// Il pannello di Glassbox come componente di pi. Glassbox lo ridisegna con il
// suo hook `ui.render`, che è asincrono; pi chiede le righe in modo sincrono.
// Quindi qui resta l'ultimo albero disegnato: `render` lo impagina, e quando
// la larghezza o l'altezza cambiano ne chiede uno nuovo.
//
// Il mouse (in pi a schermo intero) preme i pulsanti e scorre le sezioni. Con
// la tastiera, una volta che il pannello ha il fuoco: Tab e frecce passano da
// un pulsante all'altro, Invio preme, PagSu e PagGiù scorrono, Esc torna al prompt.
import { Editor, matchesKey } from '@earendil-works/pi-tui'

import type { Child } from './jsx.ts'
import { layout } from './layout.ts'
import type { ColorMode, Field, Line, Region } from './layout.ts'

type Mouse = { type: string; button: string; x: number; y: number; wheelDelta?: number }

export type PanelHost = {
  rows: () => number
  colorMode: () => ColorMode
  /** Chiede a Glassbox un disegno nuovo per queste misure. */
  resize: (columns: number, rows: number) => void
  scroll: (by: number, row: number | undefined) => void
  /** Il pannello prende la tastiera, o la rende al prompt. */
  take: () => void
  release: () => void
  requestRender: () => void
  editorTheme: () => unknown
  tui: () => unknown
}

const BORDER = '\x1b[2m│\x1b[0m'
const BORDER_ON = '│'
// Le righe che un tic della rotella, o PagSu e PagGiù, scorrono.
const WHEEL = 2
const PAGE = 8

type Input = { editor: any; value: string; props: Record<string, any> }

export class Panel {
  focused = false
  tree: Child | undefined
  private lines: Line[] = []
  private size = { columns: 0, rows: 0 }
  // Il pulsante con il fuoco della tastiera, e il campo in cui si scrive.
  private ring = ''
  private typing = ''
  private wanted = ''
  // Il pannello ha preso la tastiera solo per un campo: finito il campo, la rende al prompt.
  private isBorrowed = false
  private inputs = new Map<string, Input>()

  constructor(private host: PanelHost) {}

  /** Glassbox ha ridisegnato. */
  setTree(tree: Child | undefined): void {
    this.tree = tree
    this.host.requestRender()
  }

  /** `$.ui.focus`: il fuoco va su questo elemento appena è disegnato. */
  focusKey(key: string): void {
    this.wanted = key
    this.host.requestRender()
  }

  invalidate(): void {}

  dispose(): void {
    this.inputs.clear()
  }

  render(width: number): string[] {
    const rows = this.host.rows()
    const columns = Math.max(8, width - 1)
    if (columns !== this.size.columns || rows !== this.size.rows) {
      this.size = { columns, rows }
      this.host.resize(columns, rows)
    }
    const drawn = this.tree ? layout(this.tree, columns, this.host.colorMode(), this.focused ? this.ring : '') : []
    const lines: Line[] = []
    const seen = new Set<string>()
    for (const line of drawn) {
      if (!line.field) lines.push(line)
      else {
        seen.add(line.field.key)
        lines.push(...this.fieldLines(line.field))
      }
    }
    for (const key of this.inputs.keys()) if (!seen.has(key)) this.inputs.delete(key)
    if (this.typing && !seen.has(this.typing)) this.typing = ''
    if (this.isBorrowed && this.inputs.size === 0) {
      this.isBorrowed = false
      if (this.focused) queueMicrotask(() => this.host.release())
    }
    this.lines = lines
    this.settleFocus()
    const bar = this.focused ? BORDER_ON : BORDER
    const out: string[] = []
    for (let i = 0; i < rows; i++) out.push(`${bar}${lines[i]?.text ?? ''}`)
    return out
  }

  // Un campo di testo: un editor di pi per ogni chiave, che resta finché Glassbox lo disegna.
  private fieldLines(field: Field): Line[] {
    let input = this.inputs.get(field.key)
    const value = typeof field.props.value === 'string' ? field.props.value : ''
    if (!input) {
      const editor = new (Editor as any)(this.host.tui(), this.host.editorTheme(), { paddingX: 0 })
      editor.setText(value)
      input = { editor, value, props: field.props }
      const self = input
      editor.onChange = (text: string) => self.props.onInput?.(text)
      editor.onSubmit = (text: string) => {
        self.props.onSubmit?.(text)
        if (this.typing === field.key) this.typing = ''
      }
      this.inputs.set(field.key, input)
      if (field.props.autoFocus && !this.wanted) this.wanted = field.key
    } else if (value !== input.value) {
      // Glassbox ha cambiato il testo da fuori: il campo riparte da lì.
      input.value = value
      input.editor.setText(value)
    }
    input.props = field.props
    input.editor.focused = this.focused && this.typing === field.key
    const label = field.props.label ? `${field.props.label} ` : ''
    const body: string[] = input.editor.render(Math.max(4, field.width - label.length))
    const pad = ' '.repeat(field.x + label.length)
    return body.map((text, i) => ({ text: `${i === 0 ? `${field.prefix}${label}` : pad}${text}`, regions: [], w: 0, field }))
  }

  // Il fuoco chiesto da Glassbox arriva quando l'elemento esiste; quello di prima resta se c'è ancora.
  private settleFocus(): void {
    if (this.wanted) {
      if (this.inputs.has(this.wanted)) {
        this.typing = this.wanted
        this.wanted = ''
        this.borrow()
      } else if (this.buttons().some(b => b.button.key === this.wanted)) {
        this.ring = this.wanted
        this.wanted = ''
      }
    }
  }

  private borrow(): void {
    if (this.focused) return this.host.requestRender()
    this.isBorrowed = true
    this.host.take()
  }

  private buttons(): (Region & { row: number })[] {
    return this.lines.flatMap((line, row) => line.regions.map(r => ({ ...r, row })))
  }

  handleInput(data: string): void {
    const input = this.typing ? this.inputs.get(this.typing) : undefined
    if (input) {
      // Esc esce dal campo; tutto il resto è suo.
      if (matchesKey(data, 'escape')) this.typing = ''
      else input.editor.handleInput(data)
      this.host.requestRender()
      return
    }
    const buttons = this.buttons()
    const at = buttons.findIndex(b => b.button.key === this.ring)
    const move = (to: number) => {
      const b = buttons[(to + buttons.length) % buttons.length]
      if (b) this.ring = b.button.key
    }
    if (matchesKey(data, 'escape') || matchesKey(data, 'alt+g')) this.host.release()
    else if (matchesKey(data, 'tab') || matchesKey(data, 'right')) move(at + 1)
    else if (matchesKey(data, 'shift+tab') || matchesKey(data, 'left')) move(at === -1 ? buttons.length - 1 : at - 1)
    else if (matchesKey(data, 'down') || matchesKey(data, 'up')) {
      // Il primo pulsante della riga sotto, o l'ultimo di quella sopra.
      const row = buttons[at]?.row ?? (matchesKey(data, 'down') ? -1 : this.lines.length)
      const next = matchesKey(data, 'down') ? buttons.find(b => b.row > row) : buttons.findLast(b => b.row < row)
      if (next) this.ring = next.button.key
    } else if (matchesKey(data, 'enter') || matchesKey(data, 'space')) buttons[at]?.button.press()
    else if (matchesKey(data, 'pageDown')) this.host.scroll(PAGE, buttons[at]?.row)
    else if (matchesKey(data, 'pageUp')) this.host.scroll(-PAGE, buttons[at]?.row)
    this.host.requestRender()
  }

  handleMouse(e: Mouse): { handled: boolean; focus?: boolean; render?: boolean } {
    const row = e.y
    const x = e.x - 1
    if (e.type === 'wheel') {
      this.host.scroll(Math.sign(e.wheelDelta ?? 0) * WHEEL, row)
      return { handled: true }
    }
    if (e.type !== 'press' || e.button !== 'left') return { handled: true }
    const line = this.lines[row]
    if (line?.field) {
      // Un clic nel campo: ci si scrive.
      this.typing = line.field.key
      this.borrow()
      return { handled: true, render: true }
    }
    const hit = line?.regions.find(r => x >= r.x0 && x < r.x1)
    if (hit) {
      this.ring = hit.button.key
      this.typing = ''
      hit.button.press()
    }
    return { handled: true, render: true }
  }
}
