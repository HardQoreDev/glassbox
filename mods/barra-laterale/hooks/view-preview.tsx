// L'anteprima di un file al posto delle sezioni: in cima il file con le righe
// aggiunte e tolte e i pulsanti per tornare, sotto le righe che entrano come
// diff unificato, disegnato da Code con i colori di Claude Code, e a destra lo
// scorrimento come nelle sezioni. Quando una riga non entra in larghezza, in
// fondo c'è lo slider che sposta il testo di lato.
import type { RenderElement } from 'claude-code'

import { hunkOf, preview } from './preview'
import { repo } from './repo'
import { fit, len } from './ui'
import type { Els } from './ui'
import { ADD_COLOR, DEL_COLOR, URGENT } from './vendor/filetree'

type Seg = { text: string; color?: string }

// Le colonne che Code mette prima del testo, oltre alle cifre del numero di
// riga: lo spazio, il segno, lo spazio dopo, e una di margine. Una stima: il
// disegno è di Code.
const GUTTER = 4

/** Come si dispone l'anteprima in un corpo di `width` per `bodyRows`. */
export type PreviewLayout = {
  // Le righe del file mostrate.
  rows: number
  // Le colonne di testo mostrate per riga.
  visible: number
  // Fin dove scorrono la prima riga e la prima colonna.
  maxTop: number
  maxLeft: number
  // La riga del corpo dov'è lo slider, -1 se non serve.
  sliderRow: number
}

export function previewLayout(width: number, bodyRows: number): PreviewLayout {
  const visible = Math.max(1, width - 1 - String(preview.rows.length).length - GUTTER)
  const maxLeft = Math.max(0, preview.width - visible)
  const rows = Math.max(1, bodyRows - (maxLeft > 0 ? 3 : 2))
  return { rows, visible, maxTop: Math.max(0, preview.rows.length - rows), maxLeft, sliderRow: maxLeft > 0 ? 2 + rows : -1 }
}

export function previewLines(
  el: Els,
  width: number,
  layout: PreviewLayout,
  color: string,
  back: () => void,
  showInTree: () => void,
  slide: (left: number) => void,
): RenderElement[] {
  const rel = repo.root && preview.path.startsWith(`${repo.root}/`) ? preview.path.slice(repo.root.length + 1) : preview.path
  const cut = rel.lastIndexOf('/')
  const right: Seg[] = [
    { text: ` +${preview.added}`, color: ADD_COLOR },
    { text: ` −${preview.removed}`, color: DEL_COLOR },
    ...(preview.isGone ? [{ text: ' deleted', color: URGENT }] : []),
  ]
  const tools = [
    { key: 'preview-tree', label: ' tree', press: showInTree },
    { key: 'preview-close', label: ' ✕', press: back },
  ]
  const lead = '▌ '
  const rightW = right.reduce((w, s) => w + len(s.text), 0) + tools.reduce((w, t) => w + len(t.label), 0)
  const room = Math.max(4, width - len(lead) - rightW - 1)
  const name = fit(rel.slice(cut + 1), room)
  const dirRoom = room - len(name)
  const dirFull = cut < 0 ? '' : rel.slice(0, cut + 1)
  const dir = dirRoom < 3 ? '' : len(dirFull) <= dirRoom ? dirFull : `…${dirFull.slice(-(dirRoom - 1))}`
  const pad = ' '.repeat(Math.max(1, width - len(lead) - len(dir) - len(name) - rightW))

  const { rows, maxTop: max } = layout
  const from = preview.offset
  const source = hunkOf(preview.rows, from, from + rows, preview.left)
  const thumb = Math.max(1, Math.round((rows * rows) / Math.max(1, preview.rows.length)))
  const thumbAt = max === 0 ? 0 : Math.round((from / max) * (rows - thumb))
  const empty = preview.isGone ? 'The file no longer exists.' : 'The file is empty.'

  const lines = [
    <el.Box key="preview:head" flexDirection="row" height={1} overflow="hidden">
      <el.Button key="preview-back" plain label="Back to the files" onPress={back}>
        <el.Text color={color}>{lead}</el.Text>
        <el.Text dimColor>{dir}</el.Text>
        <el.Text bold>{name}</el.Text>
      </el.Button>
      <el.Text>{pad}</el.Text>
      {right.map(s => (
        <el.Text color={s.color}>{s.text}</el.Text>
      ))}
      {tools.map(t => (
        <el.Button key={t.key} plain dimColor label={t.label} onPress={t.press} />
      ))}
    </el.Box>,
    <el.Box key="preview:rule" height={1} overflow="hidden">
      <el.Text color={color} dimColor>
        {'▔'.repeat(width)}
      </el.Text>
    </el.Box>,
    <el.Box key="preview:body" flexDirection="row" height={rows} overflow="hidden">
      <el.Box width={width - 1} height={rows} overflow="hidden">
        {source ? <el.Code source={source} path={preview.path} format="diff" wrap="truncate-end" /> : <el.Text dimColor>{fit(empty, width - 1)}</el.Text>}
      </el.Box>
      <el.Box flexDirection="column" width={1} height={rows}>
        {Array.from({ length: rows }, (_, i) => {
          const isThumb = i >= thumbAt && i < thumbAt + thumb
          return max === 0 ? (
            <el.Text> </el.Text>
          ) : (
            <el.Text color={isThumb ? color : undefined} dimColor={!isThumb}>
              {isThumb ? '┃' : '│'}
            </el.Text>
          )
        })}
      </el.Box>
    </el.Box>,
  ]
  if (layout.sliderRow < 0) return lines

  // Lo slider: ◂ e ▸ spostano di mezza larghezza, un clic sulla barra porta
  // lì il cursore. Ogni cella è un pulsante, perché un clic non dice la colonna.
  const { maxLeft, visible } = layout
  const track = Math.max(1, width - 4)
  const knob = Math.min(track, Math.max(1, Math.round((track * visible) / Math.max(1, preview.width))))
  const span = track - knob
  const knobAt = span === 0 ? 0 : Math.round((preview.left / maxLeft) * span)
  const leftAt = (i: number) => (span === 0 ? 0 : Math.round((Math.max(0, Math.min(span, i - Math.floor(knob / 2))) / span) * maxLeft))
  const step = Math.max(1, Math.floor(visible / 2))
  lines.push(
    <el.Box key="preview:slider" flexDirection="row" height={1} overflow="hidden">
      <el.Button key="preview-left" plain dimColor={preview.left === 0} label="◂" onPress={() => slide(preview.left - step)} />
      <el.Text> </el.Text>
      {Array.from({ length: track }, (_, i) => {
        const isKnob = i >= knobAt && i < knobAt + knob
        return (
          <el.Button key={`preview-x:${i}`} plain label={`Column ${leftAt(i) + 1}`} onPress={() => slide(leftAt(i))}>
            <el.Text color={isKnob ? color : undefined} dimColor={!isKnob}>
              {isKnob ? '━' : '─'}
            </el.Text>
          </el.Button>
        )
      })}
      <el.Text> </el.Text>
      <el.Button key="preview-right" plain dimColor={preview.left >= maxLeft} label="▸" onPress={() => slide(preview.left + step)} />
    </el.Box>,
  )
  return lines
}
