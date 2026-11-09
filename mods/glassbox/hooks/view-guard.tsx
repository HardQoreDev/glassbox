// La vista GUARD della sezione FILES: i file di questa sessione che un'altra
// sessione aperta ha scritto. In cima i contesi, con ▲ rosso: tutte e due le
// sessioni hanno lì dentro lavoro non salvato. Sotto, spenti, quelli già
// risolti da un commit in cui l'altra ha scritto nell'ultimo giorno. Sotto ogni
// file, una riga per sessione: quando l'ha scritto e com'è messo; un clic sul
// nome porta herdr sul suo pane. Un clic sul file lo apre nell'anteprima.
import { contestedPaths, guard, isContested, shownOverlaps } from './guard'
import type { Other, Overlap } from './guard'
import { repo } from './repo'
import { label, sessions, span } from './sessions'
import type { Session } from './sessions'
import { fit, len } from './ui'
import type { Line } from './ui'

/** Il colore della guardia accesa. */
export const GUARD_COLOR = '#f87171'

type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }

/** Quanti file sono contesi adesso. */
export const contestedCount = (): number => contestedPaths().size

/** Il testo accanto al titolo nella vista GUARD. */
export function guardInfo(): Seg[] {
  if (guard.checkedAt === 0) return [{ text: 'checking', dim: true }]
  const n = contestedCount()
  const others = sessions.list.filter(s => s.id !== sessions.selfId).length
  if (n > 0) return [{ text: `${n} ${n === 1 ? 'file' : 'files'} shared`, color: GUARD_COLOR, bold: true }]
  return [{ text: 'clear', dim: true }, { text: ` · ${others} other ${others === 1 ? 'session' : 'sessions'}`, dim: true }]
}

const noteOf = (o: Overlap, x: Other): string => {
  if (x.isPending) return o.git === 'outside' ? 'not in git' : 'uncommitted'
  return o.git === 'outside' ? 'over a day' : 'committed'
}

const relOf = (path: string): string => {
  if (repo.root && path.startsWith(`${repo.root}/`)) return path.slice(repo.root.length + 1)
  return repo.home && path.startsWith(`${repo.home}/`) ? `~${path.slice(repo.home.length)}` : path
}

export function guardLines(width: number, now: number, press: (path: string) => void, jump: (s: Session) => void): Line[] {
  const error = sessions.error ? [(el => <el.Text color={GUARD_COLOR} dimColor>{fit(`bin/sessions.py: ${sessions.error}`, width)}</el.Text>) as Line] : []
  if (guard.checkedAt === 0) return [...error, el => <el.Text dimColor>{fit('Checking the other open sessions…', width)}</el.Text>]
  const shown = shownOverlaps(now)
  if (shown.length === 0) {
    const others = sessions.list.filter(s => s.id !== sessions.selfId).length
    return [
      ...error,
      el => <el.Text dimColor>{fit('No other open session is changing the files of this one.', width)}</el.Text>,
      el => <el.Text dimColor>{fit(`Watching ${others} other ${others === 1 ? 'session' : 'sessions'}: their Edit and Write, not their shell commands.`, width)}</el.Text>,
    ]
  }

  const lines: Line[] = [...error]
  for (const o of shown) {
    const hot = isContested(o)
    const rel = relOf(o.path)
    const cut = rel.lastIndexOf('/')
    const right = `you ${span(now - o.at)} ago`
    const room = Math.max(4, width - 2 - 1 - len(right))
    const name = fit(rel.slice(cut + 1), room)
    const dirRoom = room - len(name)
    const head = rel.slice(0, cut + 1)
    const dir = cut < 0 || dirRoom < 3 ? '' : len(head) <= dirRoom ? head : `…${head.slice(-(dirRoom - 1))}`
    const pad = ' '.repeat(Math.max(1, width - 2 - len(dir) - len(name) - len(right)))
    lines.push(el => (
      <el.Box key={`g:${o.path}`} flexDirection="row" height={1} overflow="hidden">
        <el.Text color={hot ? GUARD_COLOR : undefined} dimColor={!hot} bold={hot}>
          {hot ? '▲ ' : '· '}
        </el.Text>
        <el.Button key={`guard:${o.path}`} plain label={rel} onPress={() => press(o.path)}>
          <el.Text dimColor>{dir}</el.Text>
          <el.Text color={hot ? GUARD_COLOR : undefined} dimColor={!hot} bold={hot}>
            {name}
          </el.Text>
        </el.Button>
        <el.Text>{pad}</el.Text>
        <el.Text dimColor>{right}</el.Text>
      </el.Box>
    ))

    for (const x of o.others) {
      const s = sessions.list.find(v => v.id === x.id)
      const who = s ? label(s) : x.id.slice(0, 8)
      const note = `${span(now - x.at)} ago · ${noteOf(o, x)}`
      const shownWho = fit(who, Math.max(4, width - 4 - 1 - len(note)))
      const gap = ' '.repeat(Math.max(1, width - 4 - len(shownWho) - len(note)))
      const canJump = Boolean(s?.pane && sessions.herdr)
      lines.push(el => (
        <el.Box key={`g:${o.path}:${x.id}`} flexDirection="row" height={1} overflow="hidden">
          <el.Text dimColor>{'  ↳ '}</el.Text>
          {canJump && s ? (
            <el.Button key={`guard-session:${o.path}:${x.id}`} plain label={who} onPress={() => jump(s)}>
              <el.Text color={x.isPending ? GUARD_COLOR : undefined} dimColor={!x.isPending}>
                {shownWho}
              </el.Text>
            </el.Button>
          ) : (
            <el.Text color={x.isPending ? GUARD_COLOR : undefined} dimColor={!x.isPending}>
              {shownWho}
            </el.Text>
          )}
          <el.Text>{gap}</el.Text>
          <el.Text color={x.isPending ? GUARD_COLOR : undefined} dimColor={!x.isPending}>
            {note}
          </el.Text>
        </el.Box>
      ))
    }
  }
  return lines
}
