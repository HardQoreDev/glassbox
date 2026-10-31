// Lo stato git del repo in cui è aperta la sessione: il grafo per la sezione
// in alto, lo stato dei file per quella in mezzo. Tutto da `git`, rilanciato a
// ogni aggiornamento; il pannello si ridisegna solo se l'uscita è cambiata.
import type { EngineInterface } from 'claude-code'

import { LOG_ARGV, layout, parseLog, simplify } from './graph'
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
  // Le righe della vista dei soli rami.
  simple: GraphRow[]
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
  simple: [],
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

function git($: EngineInterface, args: readonly string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', repo.top, ...args], {
    timeoutMs: 15_000,
    env: { GIT_OPTIONAL_LOCKS: '0' },
  })
}

async function load($: EngineInterface): Promise<boolean> {
  repo.root = repo.root || (await $.session.root())
  const top = await $.process.run(['git', '-C', repo.root, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 })
  if (top.exitCode !== 0) {
    const changed = repo.top !== '' || last !== 'no repo'
    Object.assign(repo, { top: '', prefix: '', rows: [], simple: [], branch: null, git: {}, counts: {}, diff: {}, error: '' })
    last = 'no repo'
    return changed
  }

  repo.top = top.stdout.trim()
  const rel = relative(repo.top, repo.root)
  repo.prefix = rel === '' ? '' : `${rel}/`
  const [remotes, log, status, numstat] = await Promise.all([
    git($, ['remote']),
    git($, LOG_ARGV.slice(1)),
    git($, ['status', '--porcelain=v1', '-z', '-b', '--ignored=matching', '--untracked-files=normal']),
    git($, ['diff', '--numstat', '-z', 'HEAD']),
  ])
  const raw = [remotes.stdout, log.stdout, log.stderr, status.stdout, numstat.stdout].join('\x00\x01')
  if (raw === last) return false
  last = raw

  const names = remotes.stdout.split('\n').filter(name => name !== '')
  const commits = log.exitCode === 0 ? parseLog(log.stdout, names) : []
  repo.rows = layout(commits)
  repo.simple = layout(simplify(commits))
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
