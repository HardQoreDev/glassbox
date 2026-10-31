// L'anteprima di un file modificato nella sessione: il file com'è adesso, per
// intero, con le righe aggiunte e in mezzo quelle tolte. Il confronto è con il
// file prima della prima scrittura della sessione, riga per riga (Myers).
import type { EngineInterface } from 'claude-code'

import { readText } from './files'
import { linesOf, touched } from './touched'
import { len } from './ui'

export type Op = ' ' | '+' | '-'
// Una riga dell'anteprima; `old` e `new` sono le righe dei due file venute prima.
export type DiffRow = { op: Op; text: string; old: number; new: number }

export const preview = {
  // Il file in anteprima, '' se l'anteprima è chiusa.
  path: '',
  rows: [] as DiffRow[],
  added: 0,
  removed: 0,
  // Il file non si legge più: tutte le sue righe sono tolte.
  isGone: false,
  // La prima riga mostrata, e la prima colonna: lo slider sposta il testo di lato.
  offset: 0,
  left: 0,
  // Le colonne di ogni riga, e la più lunga.
  widths: [] as number[],
  width: 0,
  // Le righe lunghe vanno a capo invece di passare sotto lo slider; resta
  // com'è da un file all'altro.
  wrap: false,
  // Il testo dell'ultimo confronto: senza cambi non se ne fa un altro.
  text: undefined as string | null | undefined,
}

// Le righe sopra la prima modifica quando l'anteprima si apre.
const ABOVE = 3
// Oltre queste righe aggiunte e tolte il confronto costa troppo: la parte
// cambiata si mostra tutta tolta e poi tutta aggiunta.
const MAX_EDITS = 2_000
// I tab diventano spazi fino alla colonna multipla di questa, così le colonne
// che lo slider conta sono quelle disegnate.
const TAB = 4

/**
 * Le mosse più corte per passare da `a` a `b` (Myers, "An O(ND) Difference
 * Algorithm"); null oltre MAX_EDITS. Di ogni passo si tiene solo la fascia di
 * diagonali che il ritorno legge.
 */
function edits(a: readonly string[], b: readonly string[]): Op[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDITS)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!)
      let x = down ? v[off + k + 1]! : v[off + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const s = trace[d]!
    const at = (k: number) => s[k + d + 1]!
    const k = x - y
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push(' ')
      x--
      y--
    }
    if (d > 0) ops.push(down ? '+' : '-')
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

/** Le righe di `after` con in mezzo quelle di `before` che non ci sono più. */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = linesOf(before)
  const b = linesOf(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const oldMid = a.slice(start, endA)
  const newMid = b.slice(start, endB)
  const mid = edits(oldMid, newMid) ?? [...oldMid.map((): Op => '-'), ...newMid.map((): Op => '+')]
  const ops: Op[] = [...Array<Op>(start).fill(' '), ...mid, ...Array<Op>(a.length - endA).fill(' ')]

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  for (const op of ops) {
    rows.push({ op, text: op === '+' ? b[j]! : a[i]!, old: i, new: j })
    if (op !== '+') i++
    if (op !== '-') j++
  }
  return rows
}

const expandTabs = (text: string): string => {
  if (!text.includes('\t')) return text
  let out = ''
  for (const ch of text) out += ch === '\t' ? ' '.repeat(TAB - (len(out) % TAB)) : ch
  return out
}

// Code non prende caratteri di controllo oltre a tab e a capo: un \r di fine
// riga (file CRLF) se ne va, i tab diventano spazi, gli altri diventano U+FFFD.
const clean = (text: string): string => expandTabs(text.replace(/\r$/, '')).replace(/[\x00-\x1f\x7f-\x9f]/g, '\ufffd')

/**
 * Le righe da `from` a `to` come un blocco di diff unificato, con i numeri di
 * riga giusti; `left` sono le colonne tolte a sinistra di ogni riga.
 */
export function hunkOf(rows: readonly DiffRow[], from: number, to: number, left = 0): string {
  const part = rows.slice(from, to)
  const first = part[0]
  if (!first) return ''
  const olds = part.filter(r => r.op !== '+').length
  const news = part.filter(r => r.op !== '-').length
  const head = `@@ -${olds ? first.old + 1 : first.old},${olds} +${news ? first.new + 1 : first.new},${news} @@`
  const shown = (text: string) => (left > 0 ? Array.from(clean(text)).slice(left).join('') : clean(text))
  return [head, ...part.map(r => r.op + shown(r.text))].join('\n')
}

/**
 * Le righe di schermo della riga `i` a capo in `visible` colonne, parola per
 * parola e spezzando le parole più lunghe della riga. Una stima per eccesso:
 * il disegno è di Code, e così la fine del file resta sempre raggiungibile.
 */
export function rowsOf(i: number, visible: number): number {
  const row = preview.rows[i]
  if (!row || (preview.widths[i] ?? 0) <= visible) return 1
  let rows = 1
  let col = 0
  clean(row.text)
    .split(' ')
    .forEach((word, k) => {
      let w = len(word)
      if (k > 0) {
        if (col + 1 + w <= visible) {
          col += 1 + w
          return
        }
        rows++
      }
      while (w > visible) {
        rows++
        w -= visible
      }
      col = w
    })
  return rows
}

/** Rifà il confronto se il file è cambiato; `true` se l'anteprima è cambiata. */
export async function refreshPreview($: EngineInterface): Promise<boolean> {
  const t = touched.get(preview.path)
  if (!t) return false
  const text = await readText($, t.path)
  if (text === preview.text) return false
  preview.text = text
  preview.isGone = text === null
  preview.rows = diffLines(t.original ?? '', text ?? '')
  preview.added = preview.rows.filter(r => r.op === '+').length
  preview.removed = preview.rows.filter(r => r.op === '-').length
  preview.widths = preview.rows.map(r => len(clean(r.text)))
  preview.width = preview.widths.reduce((w, n) => Math.max(w, n), 0)
  return true
}

/** Apre l'anteprima di `path` poco sopra la prima modifica. */
export async function openPreview($: EngineInterface, path: string): Promise<void> {
  Object.assign(preview, { path, rows: [], added: 0, removed: 0, isGone: false, offset: 0, left: 0, widths: [], width: 0, text: undefined })
  await refreshPreview($)
  const first = preview.rows.findIndex(r => r.op !== ' ')
  preview.offset = Math.max(0, first - ABOVE)
}

export function closePreview(): void {
  Object.assign(preview, { path: '', rows: [], text: undefined })
}
