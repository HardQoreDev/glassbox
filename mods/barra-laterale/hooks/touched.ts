// I file che la sessione ha modificato, con le righe inserite e cancellate.
// Il conto è della sessione, non di git: il file si legge prima e dopo ogni
// scrittura di Claude, e la differenza tra le due versioni si somma alle altre.

export type Touched = {
  path: string
  added: number
  removed: number
  // Il file non c'era prima della prima scrittura della sessione.
  isNew: boolean
  // L'ultima scrittura, per mettere in cima i file toccati da poco.
  at: number
}

export const touched = new Map<string, Touched>()

// Oltre questa dimensione (righe vecchie per righe nuove) il conto esatto
// costa troppo e si passa a uno approssimato.
const LCS_CELLS = 4_000_000

const linesOf = (text: string): string[] => {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

// La lunghezza della sottosequenza comune più lunga, con due sole righe di tabella.
const lcs = (a: readonly string[], b: readonly string[]): number => {
  let prev = new Array<number>(b.length + 1).fill(0)
  let cur = new Array<number>(b.length + 1).fill(0)
  for (const x of a) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = x === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, cur[j - 1] ?? 0)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length] ?? 0
}

// Quante righe di `a` mancano in `b`, contando le ripetute: il conto approssimato.
const missing = (a: readonly string[], b: readonly string[]): number => {
  const have = new Map<string, number>()
  for (const line of b) have.set(line, (have.get(line) ?? 0) + 1)
  let out = 0
  for (const line of a) {
    const n = have.get(line) ?? 0
    if (n > 0) have.set(line, n - 1)
    else out++
  }
  return out
}

/** Le righe inserite e cancellate passando da `before` ad `after`, come le conta git. */
export const countDiff = (before: string, after: string): [number, number] => {
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
  if (oldMid.length * newMid.length > LCS_CELLS) return [missing(newMid, oldMid), missing(oldMid, newMid)]
  const common = lcs(oldMid, newMid)
  return [newMid.length - common, oldMid.length - common]
}

/** Somma una scrittura della sessione; `before` null se il file non esisteva. */
export const record = (path: string, before: string | null, after: string, at: number): void => {
  const [added, removed] = countDiff(before ?? '', after)
  const prev = touched.get(path)
  touched.set(path, {
    path,
    added: (prev?.added ?? 0) + added,
    removed: (prev?.removed ?? 0) + removed,
    isNew: prev ? prev.isNew : before === null,
    at,
  })
}

/** I file toccati, dal più recente. */
export const touchedList = (): Touched[] => [...touched.values()].sort((x, y) => y.at - x.at)
