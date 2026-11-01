// Lo stato git del repo in cui è aperta la sessione: il grafo e i branch per
// la sezione in alto, lo stato dei file per quella in mezzo. Tutto da `git`, rilanciato a
// ogni aggiornamento; il pannello si ridisegna solo se l'uscita è cambiata.
import type { EngineInterface } from 'claude-code'

import { NO_BRANCHES, REFS_ARGV, baseOf, branchesOf, countArgv, readFetchHead, readReflog, readRefs, reflogArgv, syncTimes } from './branches'
import type { Branches, RawRef, SyncTime } from './branches'
import { LOG_ARGV, layout, parseLog } from './graph'
import type { GraphRow } from './graph'
import { parseGit, parseNumstat, relative, rollCounts, rollUp } from './vendor/filetree'
import type { Branch } from './vendor/filetree'

export type Repo = {
  // La cartella da cui parte il file tree: la radice della sessione.
  root: string
  // La radice del repo git, '' fuori da un repo.
  top: string
  // `root` relativa a `top`, con la barra finale; '' quando coincidono.
  prefix: string
  rows: GraphRow[]
  // Il principale e i branch attivi, per la vista semplice.
  branches: Branches
  // La cartella di casa, per mostrare i percorsi con ~.
  home: string
  branch: Branch | null
  git: Record<string, string>
  ignored: Set<string>
  untracked: Set<string>
  counts: Record<string, [number, number, number]>
  diff: Record<string, [number, number]>
  error: string
}

export const repo: Repo = {
  root: '',
  top: '',
  prefix: '',
  rows: [],
  branches: NO_BRANCHES,
  home: '',
  branch: null,
  git: {},
  ignored: new Set(),
  untracked: new Set(),
  counts: {},
  diff: {},
  error: '',
}

// L'uscita grezza dell'ultimo giro: se non cambia non si ridisegna niente.
let last = ''
let running: Promise<boolean> | null = null
let again = false
// L'ultima voce del reflog di ogni branch remoto, con il commit su cui stava
// allora: cambia solo quando il branch si sposta, e solo allora si richiede.
const reflogs = new Map<string, { hash: string; entry?: SyncTime }>()
let reflogsTop = ''
// FETCH_HEAD com'era all'ultima lettura: si rilegge quando cambia l'ora.
let fetchHead = { path: '', mtimeMs: 0, text: '' }

function git($: EngineInterface, args: readonly string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', repo.top, ...args], {
    timeoutMs: 15_000,
    env: { GIT_OPTIONAL_LOCKS: '0' },
  })
}

async function load($: EngineInterface): Promise<boolean> {
  repo.root = repo.root || (await $.session.root())
  repo.home = repo.home || ((await $.env.get('HOME').catch(() => undefined)) ?? '')
  const top = await $.process.run(['git', '-C', repo.root, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 })
  if (top.exitCode !== 0) {
    const changed = repo.top !== '' || last !== 'no repo'
    Object.assign(repo, { top: '', prefix: '', rows: [], branches: NO_BRANCHES, branch: null, git: {}, counts: {}, diff: {}, error: '' })
    last = 'no repo'
    return changed
  }

  repo.top = top.stdout.trim()
  const rel = relative(repo.top, repo.root)
  repo.prefix = rel === '' ? '' : `${rel}/`
  const [remotes, log, status, numstat, refs, commonDir] = await Promise.all([
    git($, ['remote', '-v']),
    git($, LOG_ARGV.slice(1)),
    git($, ['status', '--porcelain=v1', '-z', '-b', '--ignored=matching', '--untracked-files=normal']),
    git($, ['diff', '--numstat', '-z', 'HEAD']),
    git($, REFS_ARGV),
    git($, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  // Quanti commit ogni branch ha in più e in meno del principale: si chiede
  // dopo, perché serve sapere qual è; un git vecchio non lo sa dire.
  const refList = refs.exitCode === 0 ? readRefs(refs.stdout) : []
  const base = baseOf(refList)
  const counts = base ? await git($, countArgv(base.hash)) : undefined
  const countsOut = counts?.exitCode === 0 ? counts.stdout : ''
  // `origin\t<url> (fetch)`: i nomi dei remoti e i loro url.
  const remoteList = [
    ...new Map(
      remotes.stdout
        .split('\n')
        .map(line => line.split('\t'))
        .filter(([name]) => name)
        .map(([name = '', rest = '']) => [name, rest.replace(/ \((fetch|push)\)$/, '')] as const),
    ),
  ].map(([name, url]) => ({ name, url }))
  const names = remoteList.map(r => r.name)
  const syncs = await lastSyncs($, refList, commonDir.exitCode === 0 ? commonDir.stdout.trim() : '', remoteList)
  const raw = [remotes.stdout, log.stdout, log.stderr, status.stdout, numstat.stdout, refs.stdout, countsOut, JSON.stringify([...syncs])].join('\x00\x01')
  if (raw === last) return false
  last = raw

  const commits = log.exitCode === 0 ? parseLog(log.stdout, names) : []
  repo.rows = layout(commits)
  repo.branches = branchesOf(refList, countsOut, base, names, syncs)
  repo.error = log.exitCode === 0 ? '' : log.stderr.trim().split('\n')[0] ?? ''
  const parsed = parseGit(status.stdout, repo.root, repo.prefix)
  repo.branch = parsed.branch
  repo.git = parsed.git
  repo.ignored = new Set(parsed.ignored)
  repo.untracked = new Set(parsed.untrackedDirs)
  repo.counts = rollCounts(parsed.files, repo.root)
  const diff: Record<string, [number, number]> = {}
  parseNumstat(numstat.stdout, repo.root, repo.prefix, diff)
  repo.diff = rollUp(diff, repo.root)
  return true
}

// L'ultima sincronizzazione di ogni branch remoto, dal suo reflog e da
// FETCH_HEAD nella cartella comune del repo (quella dei worktree compresi).
async function lastSyncs(
  $: EngineInterface,
  refs: readonly RawRef[],
  commonDir: string,
  remotes: readonly { name: string; url: string }[],
): Promise<Map<string, SyncTime>> {
  if (reflogsTop !== repo.top) {
    reflogs.clear()
    reflogsTop = repo.top
  }
  const remoteRefs = refs.filter(r => r.symref === '' && r.ref.startsWith('refs/remotes/'))
  const present = new Set(remoteRefs.map(r => r.ref))
  for (const ref of reflogs.keys()) if (!present.has(ref)) reflogs.delete(ref)
  await Promise.all(
    remoteRefs
      .filter(r => reflogs.get(r.ref)?.hash !== r.hash)
      .map(async r => {
        const out = await git($, reflogArgv(r.ref)).catch(() => undefined)
        const entry = out?.exitCode === 0 ? readReflog(out.stdout) : undefined
        reflogs.set(r.ref, { hash: r.hash, ...(entry ? { entry } : {}) })
      }),
  )

  const path = commonDir ? `${commonDir}/FETCH_HEAD` : ''
  const stat = path ? await $.fs.stat(path).catch(() => undefined) : undefined
  if (!stat) fetchHead = { path: '', mtimeMs: 0, text: '' }
  else if (path !== fetchHead.path || stat.mtimeMs !== fetchHead.mtimeMs) {
    fetchHead = { path, mtimeMs: stat.mtimeMs, text: (await $.fs.read(path).catch(() => undefined)) ?? '' }
  }

  const logged = new Map([...reflogs].flatMap(([ref, v]) => (v.entry ? [[ref, v.entry] as const] : [])))
  return syncTimes(refs, logged, readFetchHead(fetchHead.text, remotes), Math.floor(fetchHead.mtimeMs / 1000))
}

/**
 * Rilegge il repo; `true` se qualcosa è cambiato. Una richiesta che arriva
 * mentre un giro è in corso ne fa partire un altro alla fine, non un secondo
 * in parallelo.
 */
export async function refreshRepo($: EngineInterface): Promise<boolean> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    let changed = false
    do {
      again = false
      changed = (await load($).catch(() => false)) || changed
    } while (again)
    return changed
  })()
  try {
    return await running
  } finally {
    running = null
  }
}
