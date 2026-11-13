// I tag del repo, per la vista tags di GIT: dal più recente, annotati o
// leggeri, ognuno con il commit a cui punta, quanti commit il principale ha
// fatto dopo (quello che non è ancora in un rilascio) e se il remoto ce l'ha.
// Qui solo dati: da `git for-each-ref` e, quando si chiede, da `git ls-remote`.
const F = '\x1f';
const R = '\x1e';
// Se ne leggono al più tanti, i più recenti.
export const TAG_LIMIT = 200;
/** I tag dal più recente: nome, tipo, oggetto, commit, data, chi, messaggio e soggetto del commit. */
export const TAGS_ARGV = [
    'for-each-ref',
    '--sort=-creatordate',
    `--count=${TAG_LIMIT}`,
    `--format=${['%(refname)', '%(objecttype)', '%(objectname)', '%(*objectname)', '%(objectname:short)', '%(*objectname:short)', '%(creatordate:unix)', '%(taggername)', '%(authorname)', '%(*subject)', '%(subject)'].join(F)}${R}`,
    'refs/tags',
];
/** I tag sul remoto, senza le righe `^{}` dei tag annotati. */
export const lsRemoteArgv = (remote) => ['ls-remote', '--tags', '--refs', remote];
/** I tag dall'uscita di `TAGS_ARGV`, con i conti di `countArgv` per ognuno. */
export function readTags(stdout, counted = new Map()) {
    return stdout
        .split(R)
        .map(record => record.replace(/^\n/, ''))
        .filter(record => record.includes(F))
        .map(record => {
        const [ref = '', type = '', object = '', peeled = '', short = '', peeledShort = '', time = '0', tagger = '', author = '', commitSubject = '', ...subject] = record.split(F);
        const isAnnotated = type === 'tag';
        const c = counted.get(ref);
        const message = subject.join(F);
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
        };
    });
}
/** L'uscita di `lsRemoteArgv`: per nome, l'oggetto a cui punta il tag sul remoto. */
export function readRemoteTags(stdout) {
    const out = new Map();
    for (const line of stdout.split('\n')) {
        const [hash = '', ref = ''] = line.split('\t');
        if (hash && ref.startsWith('refs/tags/') && !ref.endsWith('^{}'))
            out.set(ref.slice('refs/tags/'.length), hash);
    }
    return out;
}
export function tagRemote(t, remote) {
    if (!remote)
        return undefined;
    const there = remote.get(t.name);
    if (there === undefined)
        return 'local';
    return there === t.object ? 'pushed' : 'moved';
}
