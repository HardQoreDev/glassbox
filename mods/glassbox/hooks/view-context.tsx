// La finestra di CONTEXT al posto delle sezioni: un pezzo di quello che entra
// nel contesto di un turno (system, earlier, new, output), con i messaggi
// divisi da una riga del colore di chi li ha scritti e i blocchi con il loro
// titolo. Le righe vanno a capo; senza `wrap` lo slider sposta il testo di
// lato. `↗` lo apre in VS Code.
import type { RenderElement } from 'claude-code'

import { doc } from './context'
import type { Tone } from './context'
import { clean } from './preview'
import { fit, len, wrapText } from './ui'
import type { Els } from './ui'
import { frameHead, scrollbar, slider } from './view-frame'
import { INPUT_RAIL } from './view-turns'

const TONE_COLOR = { user: INPUT_RAIL, assistant: '#c9c9c9', system: '#d8c8f0' }

type Row = { text: string; tone?: Tone }

// Le righe di schermo dell'ultimo disegno: si rifanno solo quando cambiano il
// testo, la larghezza o `wrap`.
let cache: { version: number; visible: number; wrap: boolean; rows: Row[]; width: number } | undefined

function screen(visible: number): { rows: Row[]; width: number } {
  if (cache && cache.version === doc.version && cache.visible === visible && cache.wrap === doc.wrap) return cache
  const rows: Row[] = []
  let width = 0
  for (const l of doc.lines) {
    // I titoli stanno in una riga; le note vanno sempre a capo.
    if (l.tone !== undefined && l.tone !== 'note') rows.push(l)
    else if (l.tone === undefined && !doc.wrap) {
      const text = clean(l.text)
      rows.push({ text })
      width = Math.max(width, len(text))
    } else for (const text of wrapText(clean(l.text), visible)) rows.push({ text, ...(l.tone ? { tone: l.tone } : {}) })
  }
  cache = { version: doc.version, visible, wrap: doc.wrap, rows, width }
  return cache
}

/** Come si dispone la finestra in un corpo di `width` per `bodyRows`. */
export type ContextLayout = { rows: number; visible: number; maxTop: number; maxLeft: number; sliderRow: number }

export function contextLayout(width: number, bodyRows: number): ContextLayout {
  const visible = Math.max(1, width - 1)
  const s = screen(visible)
  const maxLeft = doc.wrap ? 0 : Math.max(0, s.width - visible)
  const rows = Math.max(1, bodyRows - (maxLeft > 0 ? 3 : 2))
  return { rows, visible, maxTop: Math.max(0, s.rows.length - rows), maxLeft, sliderRow: maxLeft > 0 ? 2 + rows : -1 }
}

export type ContextActions = {
  back: () => void
  open: () => void
  slide: (left: number) => void
  toggleWrap: () => void
}

export function contextLines(el: Els, width: number, layout: ContextLayout, color: string, act: ContextActions): RenderElement[] {
  const { rows, visible, maxTop } = layout
  const s = screen(visible)
  const from = doc.offset

  const row = (r: Row): RenderElement => {
    if (r.tone === 'user' || r.tone === 'assistant' || r.tone === 'system') {
      const label = fit(`── ${r.text} `, visible)
      return (
        <el.Text color={TONE_COLOR[r.tone]} bold>
          {label + '─'.repeat(Math.max(0, visible - len(label)))}
        </el.Text>
      )
    }
    if (r.tone === 'block')
      return (
        <el.Text dimColor bold>
          {fit(`▸ ${r.text}`, visible)}
        </el.Text>
      )
    if (r.tone === 'note')
      return (
        <el.Text dimColor italic>
          {r.text || ' '}
        </el.Text>
      )
    const text = doc.wrap || doc.left === 0 ? r.text : Array.from(r.text).slice(doc.left).join('')
    return <el.Text>{fit(text, visible) || ' '}</el.Text>
  }

  const lines = [
    ...frameHead(el, width, color, {
      id: 'context',
      back: { key: 'context-back', label: 'Back to the sections', press: act.back },
      title: room => [{ text: fit(doc.title, room), bold: true }],
      right: doc.info ? [{ text: doc.info, dim: true }] : [],
      tools: [
        { key: 'context-wrap', label: 'wrap', active: doc.wrap, press: act.toggleWrap },
        { key: 'context-open', label: '↗', press: act.open },
        { key: 'context-close', label: '✕', press: act.back },
      ],
    }),
    <el.Box key="context:body" flexDirection="row" height={rows} overflow="hidden">
      <el.Box flexDirection="column" width={width - 1} height={rows} overflow="hidden">
        {s.rows.slice(from, from + rows).map((r, i) => (
          <el.Box key={`context:${from + i}`} height={1} overflow="hidden">
            {row(r)}
          </el.Box>
        ))}
      </el.Box>
      {scrollbar(el, rows, { from, max: maxTop, shown: rows, total: s.rows.length }, color)}
    </el.Box>,
  ]
  if (layout.sliderRow < 0) return lines
  lines.push(slider(el, 'context', width, color, { left: doc.left, maxLeft: layout.maxLeft, visible, width: s.width }, act.slide))
  return lines
}
