// Il grafo dei commit come lo disegna il pannello Source Control di VS Code:
// una corsia per ramo, un nodo per commit, i rami che si separano e si uniscono
// sulla riga stessa del commit. Qui solo dati: i colori sono indici di corsia.

export type Ref = {
  name: string
  kind: 'current' | 'local' | 'remote' | 'detached'
  // Un locale il cui remoto omonimo sta sullo stesso commit.
  isSynced?: true
}

export type Commit = {
  hash: string
  short: string
  parents: string[]
  refs: Ref[]
  subject: string
  author: string
  // Secondi dall'epoca, come `%ct`.
  time: number
  isHead: boolean
  // Nella vista dei soli rami, i commit nascosti che questo riassume.
  hidden?: number
}

// Una colonna del grafo: il segno della corsia e il carattere che la segue,
// `─` quando un collegamento passa di lì. I colori sono indici di corsia.
export type Cell = { glyph: string; glyphColor: number; fill: string; fillColor: number }

export type GraphRow = {
  commit: Commit
  cells: Cell[]
  lane: number
  color: number
  // Le corsie che proseguono sotto il commit, per le righe di dettaglio.
  below: (number | null)[]
}

const F = '\x1f'
const R = '\x1e'

/** I commit di tutti i branch locali e remoti, dal più recente, con i loro nomi. */
export const LOG_ARGV = [
  'git',
  'log',
  'HEAD',
  '--branches',
  '--remotes',
  '--date-order',
  '--max-count=300',
  '--decorate=short',
  '--decorate-refs=HEAD',
  '--decorate-refs=refs/heads',
  '--decorate-refs=refs/remotes',
  '--decorate-refs-exclude=refs/remotes/*/HEAD',
  `--format=%H${F}%h${F}%P${F}%D${F}%s${F}%an${F}%ct${R}`,
] as const

// Prima il branch attuale, poi gli altri locali, poi i remoti.
const ORDER: Record<Ref['kind'], number> = { current: 0, detached: 0, local: 1, remote: 2 }

// `origin/fix/x` → `fix/x`.
const branchOf = (remote: string): string => remote.slice(remote.indexOf('/') + 1)

export const parseRefs = (decoration: string, remotes: readonly string[]): Ref[] => {
  const refs: Ref[] = decoration
    .split(', ')
    .filter(name => name !== '')
    .map(name => {
      if (name.startsWith('HEAD -> ')) return { name: name.slice(8), kind: 'current' }
      if (name === 'HEAD') return { name: 'HEAD', kind: 'detached' }
      const isRemote = remotes.some(remote => name.startsWith(`${remote}/`))
      return { name, kind: isRemote ? 'remote' : 'local' }
    })

  // Un remoto con il locale omonimo sullo stesso commit diventa la nuvola del locale.
  const locals = new Set(refs.filter(r => r.kind !== 'remote').map(r => r.name))
  const synced = new Set(
    refs.filter(r => r.kind === 'remote').map(r => branchOf(r.name)).filter(b => locals.has(b)),
  )

  return refs
    .filter(r => r.kind !== 'remote' || !synced.has(branchOf(r.name)))
    .map(r => (r.kind !== 'remote' && synced.has(r.name) ? { ...r, isSynced: true as const } : r))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
}

/** I commit dall'uscita di `LOG_ARGV`; `remotes` da `git remote`. */
export const parseLog = (stdout: string, remotes: readonly string[]): Commit[] =>
  stdout
    .split(R)
    .map(record => record.replace(/^\n/, ''))
    .filter(record => record.includes(F))
    .map(record => {
      const [hash = '', short = '', parents = '', decoration = '', subject = '', author = '', time = '0'] = record.split(F)
      const refs = parseRefs(decoration, remotes)
      return {
        hash,
        short,
        parents: parents.split(' ').filter(p => p !== ''),
        refs,
        subject,
        author,
        time: Number(time),
        isHead: refs.some(r => r.kind === 'current' || r.kind === 'detached'),
      }
    })

type Lane = { hash: string; color: number } | null
type Link = { col: number; color: number }

/**
 * Le righe del grafo: per ogni commit la sua corsia e i segni di ogni colonna.
 * Una corsia aspetta il prossimo commit del suo ramo; quando due corsie
 * aspettano lo stesso commit si uniscono lì (`╯`), e il secondo genitore di un
 * merge apre una corsia nuova (`╮`) o raggiunge quella che già lo aspetta (`┤`).
 */
export function layout(commits: readonly Commit[]): GraphRow[] {
  const lanes: Lane[] = []
  let colors = 0
  const free = (skip: number) => {
    const i = lanes.findIndex((l, k) => l === null && k !== skip)
    return i === -1 ? Math.max(lanes.length, skip + 1) : i
  }

  return commits.map(c => {
    const before = lanes.slice()
    let lane = lanes.findIndex(l => l?.hash === c.hash)
    if (lane === -1) {
      lane = free(-1)
      lanes[lane] = { hash: c.hash, color: colors++ }
    }
    const color = lanes[lane]?.color ?? 0

    const merging: Link[] = []
    lanes.forEach((l, j) => {
      if (j !== lane && l?.hash === c.hash) {
        merging.push({ col: j, color: l.color })
        lanes[j] = null
      }
    })

    const [first, ...rest] = c.parents
    lanes[lane] = first === undefined ? null : { hash: first, color }
    const forks: (Link & { joins: boolean })[] = []
    for (const parent of rest) {
      const j = lanes.findIndex(l => l?.hash === parent)
      if (j !== -1) {
        forks.push({ col: j, color: lanes[j]?.color ?? 0, joins: true })
      } else {
        const k = free(lane)
        lanes[k] = { hash: parent, color: colors++ }
        forks.push({ col: k, color: lanes[k]?.color ?? 0, joins: false })
      }
    }
    for (let k = 0; k < lanes.length; k++) if (lanes[k] === undefined) lanes[k] = null
    while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop()

    const width = Math.max(before.length, lanes.length, lane + 1)
    const cells: Cell[] = Array.from({ length: width }, (_, k) => {
      const up = before[k]
      const down = lanes[k]
      const passes = up != null && down != null
      const tint = (down ?? up)?.color ?? color
      return { glyph: passes ? '│' : ' ', glyphColor: tint, fill: ' ', fillColor: tint }
    })

    const node = cells[lane]
    if (node) {
      node.glyph = c.isHead ? '○' : c.parents.length > 1 ? '⊙' : '●'
      node.glyphColor = color
    }

    const link = (target: Link, glyph: string) => {
      const cell = cells[target.col]
      if (cell) {
        cell.glyph = glyph
        cell.glyphColor = target.color
      }
      const [from, to] = target.col > lane ? [lane, target.col] : [target.col, lane]
      for (let k = from; k < to; k++) {
        const cur = cells[k]
        if (!cur) continue
        cur.fill = '─'
        cur.fillColor = target.color
        if (k > from && cur.glyph === ' ') {
          cur.glyph = '─'
          cur.glyphColor = target.color
        }
      }
    }
    for (const m of merging) {
      const reopened = forks.some(f => f.col === m.col)
      link(m, reopened ? (m.col > lane ? '┤' : '├') : m.col > lane ? '╯' : '╰')
    }
    for (const f of forks) {
      if (merging.some(m => m.col === f.col)) continue
      link(f, f.joins ? (f.col > lane ? '┤' : '├') : f.col > lane ? '╮' : '╭')
    }

    return { commit: c, cells, lane, color, below: lanes.map(l => l?.color ?? null) }
  })
}

/**
 * I soli rami: restano le punte dei branch e i commit dove si separano, ognuno
 * con per genitori i rimasti più vicini sotto di lui. Un genitore che si
 * raggiunge già da un altro si toglie, e così un punto di separazione rimasto
 * con un figlio solo. `hidden` conta i commit nascosti che ogni rimasto
 * riassume: quelli che raggiunge senza passare da altri rimasti, dati al più
 * vecchio quando sono più d'uno.
 */
export function simplify(commits: readonly Commit[]): Commit[] {
  const n = commits.length
  const at = new Map(commits.map((c, i) => [c.hash, i]))
  // Gli indici dei genitori e dei figli; `--date-order` mette i figli prima.
  const parents = commits.map(c => c.parents.map(p => at.get(p)).filter((i): i is number => i !== undefined))
  const children: number[][] = commits.map(() => [])
  parents.forEach((ps, i) => ps.forEach(p => children[p]?.push(i)))
  const isTip = (i: number) => commits[i]!.refs.length > 0 || commits[i]!.isHead

  // Le punte che arrivano a ogni commit: dove due figli ne hanno di diverse,
  // lì i rami si separano.
  const tips: Set<number>[] = []
  const tipsKey: string[] = []
  for (let i = 0; i < n; i++) {
    const set = new Set(isTip(i) ? [i] : [])
    for (const ch of children[i]!) for (const t of tips[ch]!) set.add(t)
    tips.push(set)
    tipsKey.push([...set].sort((a, b) => a - b).join(' '))
  }
  const kept = new Set<number>()
  for (let i = 0; i < n; i++) if (isTip(i) || new Set(children[i]!.map(ch => tipsKey[ch])).size > 1) kept.add(i)

  // I genitori dei rimasti, dai più vecchi; si ripete finché c'è un punto di
  // separazione da togliere.
  let via: number[][] = []
  for (;;) {
    via = Array.from({ length: n }, () => [])
    const below: Set<number>[] = []
    const kids = new Array<number>(n).fill(0)
    for (let i = n - 1; i >= 0; i--) {
      const reach: number[] = []
      for (const p of parents[i]!) for (const q of kept.has(p) ? [p] : via[p]!) if (!reach.includes(q)) reach.push(q)
      if (!kept.has(i)) {
        via[i] = reach
        continue
      }
      via[i] = reach.filter(q => !reach.some(o => o !== q && below[o]!.has(q)))
      below[i] = new Set(via[i]!.flatMap(q => [q, ...below[q]!]))
      for (const q of via[i]!) kids[q]!++
    }
    const lone = [...kept].filter(i => !isTip(i) && kids[i]! <= 1 && via[i]!.length <= 1)
    if (lone.length === 0) break
    for (const i of lone) kept.delete(i)
  }

  const owner = new Array<number>(n).fill(-1)
  const hidden = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    if (kept.has(i)) {
      owner[i] = i
      continue
    }
    owner[i] = Math.max(-1, ...children[i]!.map(ch => owner[ch]!))
    if (owner[i]! >= 0) hidden[owner[i]!]!++
  }
  return [...kept]
    .sort((a, b) => a - b)
    .map(i => ({ ...commits[i]!, parents: via[i]!.map(q => commits[q]!.hash), hidden: hidden[i] }))
}
