// L'anteprima di un file al posto delle sezioni: in cima il file con le righe
// aggiunte e tolte e i pulsanti per tornare, sotto le righe che entrano come
// diff unificato, disegnato da Code con i colori di Claude Code, e a destra lo
// scorrimento come nelle sezioni. Quando una riga non entra in larghezza, in
// fondo c'è lo slider che sposta il testo di lato; con `wrap` le righe vanno
// invece a capo.
import type { RenderElement } from 'claude-code'

import { hunkOf, preview, rowsOf } from './preview'
import { repo } from './repo'
import { fit, len } from './ui'
import type { Els } from './ui'
import { ADD_COLOR, DEL_COLOR, URGENT } from './vendor/filetree'
import { frameHead, scrollbar, slider } from './view-frame'
import type { Seg } from './view-frame'

// Le colonne che Code mette prima del testo, oltre alle cifre del numero di
// riga: lo spazio, il segno, lo spazio dopo, e una di margine. Una stima: il
// disegno è di Code.
const GUTTER = 4

/** Come si dispone l'anteprima in un corpo di `width` per `bodyRows`. */
export type PreviewLayout = {
  // Le righe di schermo del file.
  rows: number
  // Le colonne di testo mostrate per riga.
  visible: number
  // Fin dove scorrono la prima riga e la prima colonna.
  maxTop: number
  maxLeft: number
  // La riga del corpo dov'è lo slider, -1 se non serve.
  sliderRow: number
  // Le righe del file da disegnare a partire dalla riga `from`.
  countFrom: (from: number) => number
}

export type PreviewActions = {
  back: () => void
  showInTree: () => void
  slide: (left: number) => void
  toggleWrap: () => void
}

export function previewLayout(width: number, bodyRows: number): PreviewLayout {
  const total = preview.rows.length
  const visible = Math.max(1, width - 1 - String(total).length - GUTTER)
  if (!preview.wrap) {
    const maxLeft = Math.max(0, preview.width - visible)
    const rows = Math.max(1, bodyRows - (maxLeft > 0 ? 3 : 2))
    return { rows, visible, maxTop: Math.max(0, total - rows), maxLeft, sliderRow: maxLeft > 0 ? 2 + rows : -1, countFrom: () => rows }
  }

  // A capo: ogni riga del file prende le sue righe di schermo.
  const rows = Math.max(1, bodyRows - 2)
  const heights = new Map<number, number>()
  const height = (i: number) => {
    const h = heights.get(i) ?? rowsOf(i, visible)
    heights.set(i, h)
    return h
  }
  // La prima riga da cui il resto del file entra tutto; almeno l'ultima.
  let maxTop = total
  let used = 0
  while (maxTop > 0 && used + height(maxTop - 1) <= rows) used += height(--maxTop)
  // L'ultima riga può uscire di sotto: la taglia il riquadro.
  const countFrom = (from: number) => {
    let n = 0
    for (let h = 0; from + n < total && h < rows; n++) h += height(from + n)
    return n
  }
  return { rows, visible, maxTop: Math.min(maxTop, Math.max(0, total - 1)), maxLeft: 0, sliderRow: -1, countFrom }
}

export function previewLines(el: Els, width: number, layout: PreviewLayout, color: string, act: PreviewActions): RenderElement[] {
  const rel = repo.root && preview.path.startsWith(`${repo.root}/`) ? preview.path.slice(repo.root.length + 1) : preview.path
  const cut = rel.lastIndexOf('/')
  const right: Seg[] = [
    { text: ` +${preview.added}`, color: ADD_COLOR },
    { text: ` −${preview.removed}`, color: DEL_COLOR },
    ...(preview.isGone ? [{ text: ' deleted', color: URGENT }] : []),
  ]
  const title = (room: number): Seg[] => {
    const name = fit(rel.slice(cut + 1), room)
    const dirRoom = room - len(name)
    const dirFull = cut < 0 ? '' : rel.slice(0, cut + 1)
    const dir = dirRoom < 3 ? '' : len(dirFull) <= dirRoom ? dirFull : `…${dirFull.slice(-(dirRoom - 1))}`
    return [
      { text: dir, dim: true },
      { text: name, bold: true },
    ]
  }

  const { rows, maxTop: max } = layout
  const from = preview.offset
  const count = layout.countFrom(from)
  const source = hunkOf(preview.rows, from, from + count, preview.wrap ? 0 : preview.left)
  const empty = preview.isGone ? 'The file no longer exists.' : 'The file is empty.'

  const lines = [
    ...frameHead(el, width, color, {
      id: 'preview',
      back: { key: 'preview-back', label: 'Back to the files', press: act.back },
      title,
      right,
      tools: [
        { key: 'preview-wrap', label: 'wrap', active: preview.wrap, press: act.toggleWrap },
        { key: 'preview-tree', label: 'tree', press: act.showInTree },
        { key: 'preview-close', label: '✕', press: act.back },
      ],
    }),
    <el.Box key="preview:body" flexDirection="row" height={rows} overflow="hidden">
      <el.Box width={width - 1} height={rows} overflow="hidden">
        {source ? <el.Code source={source} path={preview.path} format="diff" wrap={preview.wrap ? 'wrap' : 'truncate-end'} /> : <el.Text dimColor>{fit(empty, width - 1)}</el.Text>}
      </el.Box>
      {scrollbar(el, rows, { from, max, shown: count, total: preview.rows.length }, color)}
    </el.Box>,
  ]
  if (layout.sliderRow < 0) return lines
  lines.push(slider(el, 'preview', width, color, { left: preview.left, maxLeft: layout.maxLeft, visible: layout.visible, width: preview.width }, act.slide))
  return lines
}
