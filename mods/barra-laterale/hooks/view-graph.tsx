// La sezione in alto, in due viste: il grafo dei branch come in VS Code, una
// riga per commit, o i soli rami, con i nomi dei branch e quanti commit ogni
// nodo riassume. Un clic su un commit apre sotto di lui hash, autore e data.
import type { RenderElement } from 'claude-code'

import type { GraphRow } from './graph'
import { repo } from './repo'
import { ACCENT, SELECTED_BG, ago, fit, len } from './ui'
import type { Els, Line } from './ui'

// I colori delle corsie, nell'ordine in cui le apre il grafo (quelli di VS Code).
export const LANES = ['#59a4f9', '#ffb000', '#dc267f', '#40b0a6', '#b66dff', '#fe6100', '#a4c639', '#e5c07b']
const REMOTE_BG = '#b180d7'
const DARK = '#1e1e1e'

const lane = (i: number): string => LANES[i % LANES.length] ?? ACCENT

export const graph = { selected: '' }

type Badge = { text: string; bg?: string; fg?: string; bold?: boolean; dim?: boolean }

// I nomi dei primi `most` branch del commit, ognuno in `room` colonne.
const badgesOf = (row: GraphRow, room: number, most: number): Badge[] => {
  const refs = row.commit.refs
  const out: Badge[] = refs.slice(0, most).map(r => {
    const name = fit(r.name, room)
    if (r.kind === 'remote') return { text: ` ☁ ${name} `, bg: REMOTE_BG, fg: DARK }
    if (r.kind === 'detached') return { text: ' HEAD ', bg: LANES[7], fg: DARK, bold: true }
    const mark = r.kind === 'current' ? '◎ ' : ''
    return { text: ` ${mark}${name}${r.isSynced ? ' ☁' : ''} `, bg: lane(row.color), fg: DARK, bold: r.kind === 'current' }
  })
  if (refs.length > most) out.push({ text: `+${refs.length - most}`, dim: true })
  return out
}

const badgesW = (badges: readonly Badge[]): number => badges.reduce((w, b) => w + len(b.text) + 1, 0)

// I nomi che entrano in `room` colonne, con `+N` per gli altri: più nomi
// possibile, ognuno di almeno 6 caratteri. Attorno a un nome ci sono fino a 7
// colonne: lo spazio davanti, i margini, `◎ ` e ` ☁`. `isCut` se qualcuno
// non si legge intero.
const badgesIn = (row: GraphRow, room: number): { badges: Badge[]; isCut: boolean } => {
  const refs = row.commit.refs
  for (let most = refs.length; most > 0; most--) {
    const plus = most < refs.length ? len(`+${refs.length - most}`) + 1 : 0
    const each = Math.floor((room - plus) / most) - 7
    if (each < 6) continue
    const isCut = most < refs.length || refs.some(r => len(r.name) > each)
    return { badges: badgesOf(row, each, most), isCut }
  }
  return { badges: refs.length > 0 ? [{ text: `+${refs.length}`, dim: true }] : [], isCut: refs.length > 0 }
}

// Ogni nome con uno spazio davanti; il primo senza quando `lead` è falso.
const badgeEls = (el: Els, badges: readonly Badge[], lead = true): RenderElement[] =>
  badges.map((b, i) => (
    <el.Text>
      {lead || i > 0 ? ' ' : ''}
      <el.Text backgroundColor={b.bg} color={b.fg} bold={b.bold} dimColor={b.dim}>
        {b.text}
      </el.Text>
    </el.Text>
  ))

// I segni delle corsie di una riga, ognuno del colore della sua.
const cellsEl = (el: Els, row: GraphRow): RenderElement => (
  <el.Text>
    {row.cells.map(cell => (
      <el.Text color={lane(cell.glyphColor)}>
        {cell.glyph}
        <el.Text color={lane(cell.fillColor)}>{cell.fill}</el.Text>
      </el.Text>
    ))}
  </el.Text>
)

// Sotto il commit scelto: le corsie che proseguono, poi i suoi dati.
const detailLines = (row: GraphRow, width: number, texts: readonly string[]): Line[] => {
  const c = row.commit
  const rail = row.below.map(color => (color === null ? '  ' : '│ '))
  const railW = rail.length * 2
  return texts.map((text, i) => el => (
    <el.Box key={`d:${c.hash}:${i}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={SELECTED_BG}>
      <el.Text>
        {row.below.map((color, k) => (
          <el.Text color={color === null ? undefined : lane(color)}>{rail[k]}</el.Text>
        ))}
      </el.Text>
      <el.Text dimColor>{fit(text, Math.max(4, width - railW))}</el.Text>
    </el.Box>
  ))
}

// Fuori da un repo, con un errore o senza commit: una riga che lo dice.
const emptyLines = (width: number): Line[] | undefined => {
  if (!repo.top) return [el => <el.Text dimColor>{fit('This session is not in a git repo.', width)}</el.Text>]
  if (repo.error) return [el => <el.Text color="red">{fit(repo.error, width)}</el.Text>]
  if (repo.rows.length === 0) return [el => <el.Text dimColor>No commits.</el.Text>]
  return undefined
}

/** Il testo accanto al titolo: il branch attuale e quanto è avanti o indietro. */
export const graphInfo = (): { text: string; color?: string; dim?: boolean }[] => {
  const b = repo.branch
  if (!repo.top) return [{ text: 'no repo', dim: true }]
  if (!b) return []
  return [
    { text: b.head, color: ACCENT },
    ...(b.ahead > 0 ? [{ text: ` ↑${b.ahead}`, color: '#40b0a6' }] : []),
    ...(b.behind > 0 ? [{ text: ` ↓${b.behind}`, color: '#59a4f9' }] : []),
  ]
}

export function graphLines(width: number, now: number, select: (hash: string) => void): Line[] {
  const empty = emptyLines(width)
  if (empty) return empty

  const lines: Line[] = []
  for (const row of repo.rows) {
    const c = row.commit
    const isSelected = graph.selected === c.hash
    const badges = badgesOf(row, Math.max(6, Math.floor(width * 0.3)), 2)
    const graphW = row.cells.length * 2
    const subjectW = Math.max(4, width - graphW - badgesW(badges))
    const subject = fit(c.subject, subjectW)
    const pad = ' '.repeat(Math.max(0, width - graphW - len(subject) - badgesW(badges)))

    lines.push(el => (
      <el.Box key={`g:${c.hash}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={isSelected ? SELECTED_BG : undefined}>
        {cellsEl(el, row)}
        <el.Button key={`commit:${c.hash}`} plain label={subject} onPress={() => select(c.hash)}>
          <el.Text bold={c.isHead}>{subject}</el.Text>
        </el.Button>
        <el.Text>{pad}</el.Text>
        {badgeEls(el, badges)}
      </el.Box>
    ))

    if (!isSelected) continue
    lines.push(
      ...detailLines(row, width, [
        `${c.short} · ${c.author} · ${ago(c.time * 1000, now)}`,
        ...(c.refs.length > 2 ? [c.refs.map(r => r.name).join('  ')] : []),
      ]),
    )
  }
  return lines
}

/**
 * I soli rami: le corsie e i nomi dei branch, senza messaggi; a destra quanti
 * commit nasconde ogni nodo. Un clic apre il messaggio dell'ultimo commit.
 */
export function branchLines(width: number, now: number, select: (hash: string) => void): Line[] {
  const empty = emptyLines(width)
  if (empty) return empty

  const lines: Line[] = []
  for (const row of repo.simple) {
    const c = row.commit
    const isSelected = graph.selected === c.hash
    const count = c.hidden ? `⋮ ${c.hidden}` : ''
    const graphW = row.cells.length * 2
    // Lo spazio dopo le corsie prende il posto di quello davanti al primo nome.
    const { badges, isCut } = badgesIn(row, Math.max(4, width - graphW - len(count)))
    const pad = ' '.repeat(Math.max(1, width - graphW - Math.max(0, badgesW(badges) - 1) - len(count)))
    const names = c.refs.map(r => r.name)

    lines.push(el => (
      <el.Box key={`s:${c.hash}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={isSelected ? SELECTED_BG : undefined}>
        <el.Button key={`branch:${c.hash}`} plain label={names.length > 0 ? names.join(', ') : c.short} onPress={() => select(c.hash)}>
          {cellsEl(el, row)}
          {badgeEls(el, badges, false)}
        </el.Button>
        <el.Text>{pad}</el.Text>
        <el.Text dimColor>{count}</el.Text>
      </el.Box>
    ))

    if (!isSelected) continue
    lines.push(
      ...detailLines(row, width, [
        c.subject,
        `${c.short} · ${c.author} · ${ago(c.time * 1000, now)}`,
        ...(isCut ? [names.join('  ')] : []),
      ]),
    )
  }
  return lines
}
