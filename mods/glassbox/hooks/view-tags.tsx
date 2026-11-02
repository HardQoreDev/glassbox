// La vista tags di GIT: i tag dal più recente, annotati (◆) o leggeri (◇),
// ognuno con quanti commit il principale ha fatto dopo, se il remoto ce l'ha e
// da quanto c'è. Un clic apre sotto il suo messaggio, il commit, il confronto
// con il principale e lo stato sul remoto, che si legge quando la vista si
// apre e con ↻.
import { since } from './branches'
import { remoteTags, repo } from './repo'
import { TAG_LIMIT, tagRemote } from './tags'
import type { Tag, TagRemote } from './tags'
import { ACCENT, SELECTED_BG, fit, len } from './ui'
import type { Line } from './ui'

const OFF = '#ffb000'
const LOCAL = '#ffb000'
const MOVED = '#f87171'

export const tagView = {
  // Il ref del tag di cui si vedono i dettagli.
  selected: '',
}

type Seg = { text: string; color?: string; dim?: boolean }

const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`

// Dove sta rispetto al principale: quanti commit dopo, uguale, o fuori.
const vsOf = (t: Tag): Seg | undefined => {
  if (t.ahead === undefined || t.behind === undefined) return undefined
  if (t.ahead > 0) return { text: 'off trunk', color: OFF }
  return t.behind === 0 ? { text: '=', dim: true } : { text: `${t.behind} since`, dim: true }
}

const remoteOf = (state: TagRemote | undefined): Seg | undefined =>
  state === 'local' ? { text: 'local', color: LOCAL } : state === 'moved' ? { text: 'moved', color: MOVED } : undefined

const agoText = (seconds: number, now: number): string => {
  const t = since(seconds * 1000, now)
  return t === 'now' ? 'just now' : `${t} ago`
}

const vsTexts = (t: Tag, base: string): string[] => {
  if (t.ahead === undefined || t.behind === undefined || !base) return []
  if (t.ahead === 0 && t.behind === 0) return [`same commit as ${base}`]
  const since = t.behind > 0 ? [`${commits(t.behind)} on ${base} since this tag`] : []
  return t.ahead === 0 ? since : [`not in ${base}: ${commits(t.ahead)} only here`, ...since]
}

const remoteText = (t: Tag, state: TagRemote | undefined): string => {
  const r = remoteTags.remote
  if (state === 'pushed') return `on ${r}`
  if (state === 'local') return `not on ${r}: git push ${r} ${t.name}`
  if (state === 'moved') return `${r} has it on another commit`
  if (remoteTags.isChecking) return `checking ${r || 'the remote'}…`
  if (remoteTags.error) return `${r} not reached: ${remoteTags.error}`
  return ''
}

// Sotto il tag scelto: il messaggio, il commit, che tag è, il confronto e il remoto.
const detailTexts = (t: Tag, now: number): string[] => [
  t.subject,
  t.isAnnotated ? `${t.short} · tagged by ${t.who} ${agoText(t.time, now)}` : `${t.short} · ${t.who} · committed ${agoText(t.time, now)}`,
  t.isAnnotated && t.commitSubject && t.commitSubject !== t.subject ? `commit: ${t.commitSubject}` : '',
  t.isAnnotated ? 'annotated tag' : 'lightweight tag: no message, no tagger',
  ...vsTexts(t, repo.branches.baseName),
  remoteText(t, tagRemote(t, remoteTags.tags)),
  t.commit === repo.head ? 'HEAD is here' : '',
].filter(Boolean)

/** Il testo accanto al titolo nella vista tags: quanti, e quanti mancano sul remoto. */
export const tagsInfo = (): Seg[] => {
  if (!repo.top) return [{ text: 'no repo', dim: true }]
  const n = repo.tags.length
  const local = repo.tags.filter(t => tagRemote(t, remoteTags.tags) === 'local').length
  return [
    { text: `${n === TAG_LIMIT ? `${n}+` : n} tag${n === 1 ? '' : 's'}`, dim: true },
    ...(local > 0 ? [{ text: ` · ${local} not pushed`, color: LOCAL }] : []),
  ]
}

export function tagLines(width: number, now: number, select: (ref: string) => void): Line[] {
  if (!repo.top) return [el => <el.Text dimColor>{fit('This session is not in a git repo.', width)}</el.Text>]
  if (repo.tags.length === 0)
    return [el => <el.Text dimColor>{fit('No tags.', width)}</el.Text>, el => <el.Text dimColor>{fit('git tag -a v1.0 -m "…" makes one.', width)}</el.Text>]

  // Le colonne a destra, larghe quanto il loro testo più lungo.
  const states = new Map(repo.tags.map(t => [t.ref, tagRemote(t, remoteTags.tags)]))
  const vsW = Math.max(...repo.tags.map(t => len(vsOf(t)?.text ?? '')))
  const remoteW = Math.max(...repo.tags.map(t => len(remoteOf(states.get(t.ref))?.text ?? '')))
  const timeW = Math.max(...repo.tags.map(t => len(since(t.time * 1000, now))))
  const rightW = (vsW > 0 ? vsW + 1 : 0) + (remoteW > 0 ? remoteW + 1 : 0) + timeW

  const lines: Line[] = []
  for (const t of repo.tags) {
    const isSelected = tagView.selected === t.ref
    const isHead = t.commit !== '' && t.commit === repo.head
    const mark = `${t.isAnnotated ? '◆' : '◇'} `
    const name = fit(t.name, Math.max(4, width - len(mark) - rightW - 1))
    const pad = ' '.repeat(Math.max(1, width - len(mark) - len(name) - rightW))
    const vs = vsOf(t)
    const remote = remoteOf(states.get(t.ref))
    const time = since(t.time * 1000, now)
    const right: Seg[] = [
      ...(vsW > 0 ? [{ text: ' '.repeat(vsW - len(vs?.text ?? '')) }, ...(vs ? [vs] : []), { text: ' ' }] : []),
      ...(remoteW > 0 ? [{ text: ' '.repeat(remoteW - len(remote?.text ?? '')) }, ...(remote ? [remote] : []), { text: ' ' }] : []),
      { text: ' '.repeat(timeW - len(time)) },
      { text: time, dim: true },
    ]
    lines.push(el => (
      <el.Box key={`t:${t.ref}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={isSelected ? SELECTED_BG : undefined}>
        <el.Button key={`tag:${t.ref}`} plain label={t.name} onPress={() => select(t.ref)}>
          <el.Text color={isHead ? ACCENT : undefined} bold={isHead}>
            <el.Text color={isHead ? ACCENT : t.isAnnotated ? '#c4a7ff' : undefined} dimColor={!isHead && !t.isAnnotated}>
              {mark}
            </el.Text>
            {name}
          </el.Text>
        </el.Button>
        <el.Text>{pad}</el.Text>
        {right.map(s => (
          <el.Text color={s.color} dimColor={s.dim}>
            {s.text}
          </el.Text>
        ))}
      </el.Box>
    ))
    if (!isSelected) continue
    detailTexts(t, now).forEach((text, i) => {
      lines.push(el => (
        <el.Box key={`td:${t.ref}:${i}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={SELECTED_BG}>
          <el.Text dimColor>{`  ${fit(text, Math.max(4, width - 2))}`}</el.Text>
        </el.Box>
      ))
    })
  }

  // In fondo: da quando si sa cosa c'è sul remoto, e se la lista è tagliata.
  const foot = [
    repo.tags.length === TAG_LIMIT ? `the newest ${TAG_LIMIT}` : '',
    remoteTags.isChecking ? `checking ${remoteTags.remote || 'the remote'}…` : remoteTags.at > 0 && !remoteTags.error ? `${remoteTags.remote} checked ${agoText(remoteTags.at / 1000, now)}` : '',
    remoteTags.error && !remoteTags.isChecking ? `${remoteTags.remote} not reached` : '',
  ].filter(Boolean)
  if (foot.length > 0) lines.push(el => <el.Text dimColor>{fit(foot.join(' · '), width)}</el.Text>)
  return lines
}
