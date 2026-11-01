import { describe, expect, test } from 'claude-code/testing'

import { baseOf, branchesOf, readFetchHead, readReflog, readRefs, since, syncTimes } from '../hooks/branches'

import { COUNTS, REFS } from './engine'

const F = '\x1f'
const R = '\x1e'
// Un ref come lo scrive REFS_ARGV: nome, symref, hash, HEAD, upstream, track, data.
const ref = (name: string, opts: { symref?: string; head?: boolean; upstream?: string; track?: string; time?: number; worktree?: string } = {}) =>
  [name, opts.symref ?? '', 'h', opts.head ? '*' : ' ', opts.upstream ?? '', opts.track ?? '', String(opts.time ?? 0), 'h', 'Ada', opts.worktree ?? '', 'Soggetto'].join(F) + R + '\n'
const counts = (pairs: Record<string, string>) =>
  Object.entries(pairs)
    .map(([name, pair]) => `${name}${F}${pair}${R}\n`)
    .join('')

const schema = (refsOut: string, countsOut: string, remotes = ['origin']) => {
  const refs = readRefs(refsOut)
  return branchesOf(refs, countsOut, baseOf(refs), remotes)
}
const names = (list: { name: string }[]) => list.map(b => b.name)

describe('i branch attivi', () => {
  test('quelli del repo finto: main in alto, tre attivi, uno unito', () => {
    const b = schema(REFS, COUNTS)
    expect(b.baseName).toBe('origin/main')
    expect(b.trunk).toMatchObject({ name: 'main', isCurrent: true, sync: { kind: 'synced' }, remote: 'origin/main' })
    expect(names(b.active)).toEqual(['spike', 'wip', 'feature'])
    expect(b.active[0]).toMatchObject({ ahead: 2, behind: 1, sync: { kind: 'local' } })
    expect(b.active[2]).toMatchObject({ remote: 'origin/feature', sync: { kind: 'remote' } })
    expect(b.merged).toMatchObject([{ name: 'old-fix', sync: { kind: 'gone' }, remote: 'origin/old-fix' }])
  })

  test('senza HEAD del remoto il principale è origin/main, poi main, poi master', () => {
    const local = ref('refs/heads/master') + ref('refs/heads/main') + ref('refs/heads/x', { head: true })
    expect(baseOf(readRefs(local))?.ref).toBe('refs/heads/main')
    expect(baseOf(readRefs(local + ref('refs/remotes/origin/main')))?.ref).toBe('refs/remotes/origin/main')
    expect(baseOf(readRefs(ref('refs/heads/master') + ref('refs/heads/x', { head: true })))?.ref).toBe('refs/heads/master')
    // Nessuno dei soliti nomi: il branch attuale.
    expect(baseOf(readRefs(ref('refs/heads/a') + ref('refs/heads/b', { head: true })))?.ref).toBe('refs/heads/b')
  })

  test('il locale che segue il principale è la sua riga, con quanto è indietro', () => {
    const refsOut =
      ref('refs/heads/master', { upstream: 'refs/remotes/origin/master', track: 'behind 18' }) +
      ref('refs/heads/preprod', { head: true, upstream: 'refs/remotes/origin/preprod' }) +
      ref('refs/remotes/origin/HEAD', { symref: 'refs/remotes/origin/master' }) +
      ref('refs/remotes/origin/master') +
      ref('refs/remotes/origin/preprod')
    const b = schema(refsOut, counts({ 'refs/heads/master': '0 18', 'refs/heads/preprod': '25 16', 'refs/remotes/origin/preprod': '25 16' }))
    expect(b.trunk).toMatchObject({ name: 'master', sync: { kind: 'diverged', ahead: 0, behind: 18 } })
    // origin/preprod è l'upstream di preprod: non una riga sua.
    expect(names(b.active)).toEqual(['preprod'])
  })

  test('senza un locale che lo segua, il principale è il branch remoto', () => {
    const refsOut = ref('refs/heads/x', { head: true }) + ref('refs/remotes/origin/HEAD', { symref: 'refs/remotes/origin/main' }) + ref('refs/remotes/origin/main')
    const b = schema(refsOut, counts({ 'refs/heads/x': '1 0' }))
    expect(b.trunk).toMatchObject({ name: 'main', remote: 'origin/main', sync: { kind: 'remote' } })
    expect(names(b.active)).toEqual(['x'])
  })

  test('un remoto con il nome di un locale è quel locale; i remoti con la barra si leggono interi', () => {
    const refsOut =
      ref('refs/heads/main', { head: true }) +
      ref('refs/heads/feat', { time: 2 }) +
      ref('refs/remotes/my/fork/feat') +
      ref('refs/remotes/my/fork/other', { time: 1 })
    const b = schema(refsOut, counts({ 'refs/heads/feat': '1 0', 'refs/remotes/my/fork/feat': '1 0', 'refs/remotes/my/fork/other': '3 0' }), ['my/fork'])
    expect(b.active.map(x => [x.name, x.remote])).toEqual([
      ['feat', ''],
      ['other', 'my/fork/other'],
    ])
  })

  test('se git non conta i commit, ogni branch resta attivo', () => {
    const b = schema(REFS, '')
    expect(names(b.active)).toEqual(['spike', 'wip', 'feature', 'old-fix'])
    expect(b.active[0]?.ahead).toBeUndefined()
    expect(b.merged).toEqual([])
  })

  test('senza branch non c’è niente da mostrare', () => {
    expect(schema('', '').trunk).toBeNull()
  })
})

describe('l’ultima sincronizzazione', () => {
  test('dal reflog: quando, e se con un push o un fetch', () => {
    expect(readReflog(`origin/x@{1793392413}${F}update by push\n`)).toEqual({ time: 1793392413, by: 'push' })
    expect(readReflog(`origin/x@{1793392413}${F}fetch --prune origin: fast-forward`)).toEqual({ time: 1793392413, by: 'fetch' })
    expect(readReflog(`origin/x@{1793392413}${F}pull: fast-forward`)).toEqual({ time: 1793392413, by: 'fetch' })
    expect(readReflog(`origin/x@{1793392413}${F}clone: from git@x:r.git`)).toEqual({ time: 1793392413 })
    expect(readReflog('')).toBeUndefined()
  })

  test('da FETCH_HEAD: i branch che l’ultimo fetch ha visto, con il remoto giusto', () => {
    const text = "aa\t\tbranch 'main' of example.com:me/r\nbb\tnot-for-merge\tbranch 'fix/x' of example.com:me/r\ncc\t\tbranch 'main' of other.com:you/r\n"
    expect([...readFetchHead(text, [{ name: 'origin', url: 'git@example.com:me/r.git' }])]).toEqual([
      ['refs/remotes/origin/main', 'cc'],
      ['refs/remotes/origin/fix/x', 'bb'],
    ])
    const two = [
      { name: 'origin', url: 'git@example.com:me/r.git' },
      { name: 'up', url: 'https://other.com:you/r' },
    ]
    expect([...readFetchHead(text, two)]).toEqual([
      ['refs/remotes/origin/main', 'aa'],
      ['refs/remotes/origin/fix/x', 'bb'],
      ['refs/remotes/up/main', 'cc'],
    ])
  })

  test('vince la più recente tra reflog e fetch, e il fetch conta solo sullo stesso commit', () => {
    const refsOut = ref('refs/heads/main', { upstream: 'refs/remotes/origin/main' }) + ref('refs/remotes/origin/main') + ref('refs/remotes/origin/b')
    const refs = readRefs(refsOut)
    const reflogs = new Map([
      ['refs/remotes/origin/main', { time: 100, by: 'push' as const }],
      ['refs/remotes/origin/b', { time: 300, by: 'push' as const }],
    ])
    // Tutti i ref finti stanno sul commit `h`.
    expect([...syncTimes(refs, reflogs, new Map([['refs/remotes/origin/main', 'h'], ['refs/remotes/origin/b', 'h']]), 200)]).toEqual([
      ['refs/remotes/origin/main', { time: 200, by: 'fetch' }],
      ['refs/remotes/origin/b', { time: 300, by: 'push' }],
    ])
    // Il fetch ha visto main su un altro commit: resta il push.
    expect(syncTimes(refs, reflogs, new Map([['refs/remotes/origin/main', 'vecchio']]), 200).get('refs/remotes/origin/main')).toEqual({ time: 100, by: 'push' })
    // Il locale prende l'ora del suo upstream.
    const b = branchesOf(refs, '', baseOf(refs), ['origin'], syncTimes(refs, reflogs, new Map(), 0))
    expect(b.trunk?.synced).toEqual({ time: 100, by: 'push' })
  })
})

describe('since', () => {
  test('da quanto c’è l’ultimo commit, in poche lettere', () => {
    const now = Date.UTC(2026, 10, 1)
    const ago = (s: number) => since(now - s * 1000, now)
    expect([ago(5), ago(300), ago(7200), ago(3 * 86_400), ago(15 * 86_400), ago(100 * 86_400), ago(364 * 86_400), ago(800 * 86_400)]).toEqual([
      'now',
      '5m',
      '2h',
      '3d',
      '2w',
      '3mo',
      '11mo',
      '2y',
    ])
  })
})
