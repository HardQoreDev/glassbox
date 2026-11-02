// I tag del repo, per la vista tags di GIT: dal più recente, annotati o
// leggeri, ognuno con il commit a cui punta, quanti commit il principale ha
// fatto dopo (quello che non è ancora in un rilascio) e se il remoto ce l'ha.
// Qui solo dati: da `git for-each-ref` e, quando si chiede, da `git ls-remote`.

const F = '\x1f'
const R = '\x1e'

// Se ne leggono al più tanti, i più recenti.
export const TAG_LIMIT = 200

/** I tag dal più recente: nome, tipo, oggetto, commit, data, chi, messaggio e soggetto del commit. */
export const TAGS_ARGV = [
  'for-each-ref',
  '--sort=-creatordate',
  `--count=${TAG_LIMIT}`,
  `--format=${['%(refname)', '%(objecttype)', '%(objectname)', '%(*objectname)', '%(objectname:short)', '%(*objectname:short)', '%(creatordate:unix)', '%(taggername)', '%(authorname)', '%(*subject)', '%(subject)'].join(F)}${R}`,
  'refs/tags',
] as const

/** I tag sul remoto, senza le righe `^{}` dei tag annotati. */
export const lsRemoteArgv = (remote: string): string[] => ['ls-remote', '--tags', '--refs', remote]

export type Tag = {
  ref: string
  name: string
  // Annotato: un oggetto suo, con chi l'ha messo, quando e un messaggio.
  isAnnotated: boolean
  // L'oggetto del ref: il tag annotato, o il commit.
  object: string
  commit: string
  short: string
  // Secondi dall'epoca: quando è stato messo, o il commit per uno leggero.
  time: number
  // Chi l'ha messo, o l'autore del commit per uno leggero.
  who: string
  // Il messaggio del tag annotato, o il soggetto del commit.
  subject: string
  commitSubject: string
  // I commit in più e in meno del principale; undefined se git non li ha contati.
  ahead?: number
  behind?: number
}

/** I tag dall'uscita di `TAGS_ARGV`, con i conti di `countArgv` per ognuno. */
export function readTags(stdout: string, counted: ReadonlyMap<string, { ahead: number; behind: number }> = new Map()): Tag[] {
  return stdout
    .split(R)
    .map(record => record.replace(/^\n/, ''))
    .filter(record => record.includes(F))
    .map(record => {
      const [ref = '', type = '', object = '', peeled = '', short = '', peeledShort = '', time = '0', tagger = '', author = '', commitSubject = '', ...subject] = record.split(F)
      const isAnnotated = type === 'tag'
      const c = counted.get(ref)
      const message = subject.join(F)
      return {
        ref,
        name: ref.replace(/^refs\/tags\//, ''),
        isAnnotated,
        object,
        commit: isAnnotated ? peeled : object,
        short: isAnnotated ? peeledShort : short,
        time: Number(time),
        who: isAnnotated ? tagger : author,
        subject: message,
        commitSubject: isAnnotated ? commitSubject : message,
        ...(c ? { ahead: c.ahead, behind: c.behind } : {}),
      }
    })
}

/** L'uscita di `lsRemoteArgv`: per nome, l'oggetto a cui punta il tag sul remoto. */
export function readRemoteTags(stdout: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const [hash = '', ref = ''] = line.split('\t')
    if (hash && ref.startsWith('refs/tags/') && !ref.endsWith('^{}')) out.set(ref.slice('refs/tags/'.length), hash)
  }
  return out
}

// Com'è messo sul remoto: c'è, non c'è, o c'è ma su un altro oggetto.
export type TagRemote = 'pushed' | 'local' | 'moved'

export function tagRemote(t: Tag, remote: ReadonlyMap<string, string> | undefined): TagRemote | undefined {
  if (!remote) return undefined
  const there = remote.get(t.name)
  if (there === undefined) return 'local'
  return there === t.object ? 'pushed' : 'moved'
}
