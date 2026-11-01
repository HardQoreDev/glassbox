// Il riquadro delle finestre che prendono il posto delle sezioni (l'anteprima
// di un file, un pezzo del contesto): in cima il titolo, che riporta indietro,
// le informazioni e gli strumenti; a destra lo scorrimento come nelle sezioni;
// in fondo, quando il testo non entra in larghezza, lo slider.
import type { RenderElement } from 'claude-code'

import { len } from './ui'
import type { Els } from './ui'

export type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type FrameTool = { key: string; label: string; active?: boolean; press: () => void }

export const segsW = (segs: readonly Seg[]): number => segs.reduce((w, s) => w + len(s.text), 0)

export type FrameHead = {
  // Il prefisso delle chiavi delle righe: `preview:head`, `context:rule`.
  id: string
  back: { key: string; label: string; press: () => void }
  // Il titolo nelle colonne che restano, dentro il pulsante che torna indietro.
  title: (room: number) => Seg[]
  right: Seg[]
  tools: FrameTool[]
}

/** La riga del titolo e quella sottile sotto, del colore della finestra. */
export function frameHead(el: Els, width: number, color: string, head: FrameHead): RenderElement[] {
  const lead = '▌ '
  const rightW = segsW(head.right) + head.tools.reduce((w, t) => w + 1 + len(t.label), 0)
  const title = head.title(Math.max(4, width - len(lead) - rightW - 1))
  const pad = ' '.repeat(Math.max(1, width - len(lead) - segsW(title) - rightW))
  return [
    <el.Box key={`${head.id}:head`} flexDirection="row" height={1} overflow="hidden">
      <el.Text color={color}>{lead}</el.Text>
      <el.Button key={head.back.key} plain label={head.back.label} onPress={head.back.press}>
        {title.map(s => (
          <el.Text color={s.color} dimColor={s.dim} bold={s.bold}>
            {s.text}
          </el.Text>
        ))}
      </el.Button>
      <el.Text>{pad}</el.Text>
      {head.right.map(s => (
        <el.Text color={s.color} dimColor={s.dim} bold={s.bold}>
          {s.text}
        </el.Text>
      ))}
      {/* Lo spazio davanti a ogni strumento sta fuori dal pulsante, che il
          motore inverte per intero sotto il puntatore. */}
      {head.tools.flatMap(t => [
        <el.Text> </el.Text>,
        t.active === undefined ? (
          <el.Button key={t.key} plain dimColor label={t.label} onPress={t.press} />
        ) : (
          <el.Button key={t.key} plain label={t.label} onPress={t.press}>
            <el.Text color={t.active ? color : undefined} dimColor={!t.active} bold={t.active} underline={t.active}>
              {t.label}
            </el.Text>
          </el.Button>
        ),
      ])}
    </el.Box>,
    <el.Box key={`${head.id}:rule`} height={1} overflow="hidden">
      <el.Text color={color} dimColor>
        {'▔'.repeat(width)}
      </el.Text>
    </el.Box>,
  ]
}

/**
 * La colonna dello scorrimento, alta `rows`: il cursore lungo quanto la parte
 * mostrata (`shown` di `total`), dove arriva `from` di `max`.
 */
export function scrollbar(el: Els, rows: number, at: { from: number; max: number; shown: number; total: number }, color: string): RenderElement {
  const thumb = Math.min(rows, Math.max(1, Math.round((rows * at.shown) / Math.max(1, at.total))))
  const thumbAt = at.max === 0 ? 0 : Math.round((at.from / at.max) * (rows - thumb))
  return (
    <el.Box flexDirection="column" width={1} height={rows}>
      {Array.from({ length: rows }, (_, i) => {
        const isThumb = i >= thumbAt && i < thumbAt + thumb
        return at.max === 0 ? (
          <el.Text> </el.Text>
        ) : (
          <el.Text color={isThumb ? color : undefined} dimColor={!isThumb}>
            {isThumb ? '┃' : '│'}
          </el.Text>
        )
      })}
    </el.Box>
  )
}

export type SliderAt = {
  // La prima colonna mostrata, fin dove può andare, quante se ne vedono e
  // quante ne ha la riga più lunga.
  left: number
  maxLeft: number
  visible: number
  width: number
}

/**
 * Lo slider: ◂ e ▸ spostano di mezza larghezza, un clic sulla barra porta lì
 * il cursore. Ogni cella è un pulsante, perché un clic non dice la colonna.
 */
export function slider(el: Els, id: string, width: number, color: string, at: SliderAt, slide: (left: number) => void): RenderElement {
  const { left, maxLeft, visible } = at
  const track = Math.max(1, width - 4)
  const knob = Math.min(track, Math.max(1, Math.round((track * visible) / Math.max(1, at.width))))
  const span = track - knob
  const knobAt = span === 0 ? 0 : Math.round((left / maxLeft) * span)
  const leftAt = (i: number) => (span === 0 ? 0 : Math.round((Math.max(0, Math.min(span, i - Math.floor(knob / 2))) / span) * maxLeft))
  const step = Math.max(1, Math.floor(visible / 2))
  return (
    <el.Box key={`${id}:slider`} flexDirection="row" height={1} overflow="hidden">
      <el.Button key={`${id}-left`} plain dimColor={left === 0} label="◂" onPress={() => slide(left - step)} />
      <el.Text> </el.Text>
      {Array.from({ length: track }, (_, i) => {
        const isKnob = i >= knobAt && i < knobAt + knob
        return (
          <el.Button key={`${id}-x:${i}`} plain label={`Column ${leftAt(i) + 1}`} onPress={() => slide(leftAt(i))}>
            <el.Text color={isKnob ? color : undefined} dimColor={!isKnob}>
              {isKnob ? '━' : '─'}
            </el.Text>
          </el.Button>
        )
      })}
      <el.Text> </el.Text>
      <el.Button key={`${id}-right`} plain dimColor={left >= maxLeft} label="▸" onPress={() => slide(left + step)} />
    </el.Box>
  )
}
