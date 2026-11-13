// I branch attivi, in uno schema: il principale (quello a cui punta HEAD del
// remoto, o main, o master) e sotto i branch che hanno commit che lui non ha,
// ognuno con quanti commit ha in più e in meno di lui, com'è messo sul remoto
// e quando si è sincronizzato l'ultima volta. Quelli già uniti si contano a
// parte. Qui solo dati: da `git for-each-ref`, dal reflog dei branch remoti e
// da FETCH_HEAD.
const F = '\x1f';
const R = '\x1e';
/** Tutti i branch locali e remoti, con il loro upstream e il worktree in cui sono aperti. */
export const REFS_ARGV = [
    'for-each-ref',
    `--format=${['%(refname)', '%(symref)', '%(objectname)', '%(HEAD)', '%(upstream)', '%(upstream:track,nobracket)', '%(committerdate:unix)', '%(objectname:short)', '%(authorname)', '%(worktreepath)', '%(subject)'].join(F)}${R}`,
    'refs/heads',
    'refs/remotes',
];
/** Per ogni branch e ogni tag quanti commit ha in più e in meno di `hash`, il commit del principale. */
export const countArgv = (hash) => ['for-each-ref', `--format=%(refname)${F}%(ahead-behind:${hash})${R}`, 'refs/heads', 'refs/remotes', 'refs/tags'];
/** L'uscita di `countArgv`: per ref, i commit in più e in meno. */
export const readCounts = (counts) => new Map(counts
    .split(R)
    .map(record => record.replace(/^\n/, '').split(F))
    .filter((parts) => parts.length === 2)
    .map(([ref, pair]) => {
    const [ahead = NaN, behind = NaN] = pair.split(' ').map(Number);
    return [ref, { ahead, behind }];
})
    .filter(([, c]) => Number.isFinite(c.ahead) && Number.isFinite(c.behind)));
export const NO_BRANCHES = { baseName: '', trunk: null, active: [], merged: [] };
/** I ref dall'uscita di `REFS_ARGV`. */
export const readRefs = (stdout) => stdout
    .split(R)
    .map(record => record.replace(/^\n/, ''))
    .filter(record => record.includes(F))
    .map(record => {
    const [ref = '', symref = '', hash = '', head = '', upstream = '', track = '', time = '0', short = '', author = '', worktree = '', ...subject] = record.split(F);
    return { ref, symref, hash, isHead: head === '*', upstream, track, time: Number(time), short, author, worktree, subject: subject.join(F) };
});
/**
 * Il principale: quello a cui punta HEAD del remoto (origin prima degli
 * altri); senza, il primo tra origin/main, main, origin/master e master; se no
 * il branch attuale.
 */
export function baseOf(refs) {
    const byRef = new Map(refs.map(r => [r.ref, r]));
    const heads = refs.filter(r => r.symref !== '' && /^refs\/remotes\/[^/]+\/HEAD$/.test(r.ref));
    const head = heads.find(r => r.ref === 'refs/remotes/origin/HEAD') ?? heads[0];
    const pointed = head ? byRef.get(head.symref) : undefined;
    if (pointed)
        return pointed;
    for (const ref of ['refs/remotes/origin/main', 'refs/heads/main', 'refs/remotes/origin/master', 'refs/heads/master']) {
        const found = byRef.get(ref);
        if (found)
            return found;
    }
    return refs.find(r => r.isHead && r.ref.startsWith('refs/heads/'));
}
// `refs/remotes/origin/fix/x` → ['origin', 'fix/x'], con i remoti noti; il primo pezzo se nessuno torna.
const splitRemote = (ref, remotes) => {
    const rest = ref.slice('refs/remotes/'.length);
    const remote = [...remotes].sort((a, b) => b.length - a.length).find(r => rest.startsWith(`${r}/`)) ?? rest.split('/')[0] ?? '';
    return [remote, rest.slice(remote.length + 1)];
};
const shortOf = (ref) => ref.replace(/^refs\/(heads|remotes)\//, '');
const syncOf = (r) => {
    if (r.ref.startsWith('refs/remotes/'))
        return { kind: 'remote' };
    if (r.upstream === '')
        return { kind: 'local' };
    if (r.track === 'gone')
        return { kind: 'gone' };
    const ahead = Number(/ahead (\d+)/.exec(r.track)?.[1] ?? 0);
    const behind = Number(/behind (\d+)/.exec(r.track)?.[1] ?? 0);
    return ahead === 0 && behind === 0 ? { kind: 'synced' } : { kind: 'diverged', ahead, behind };
};
/**
 * Lo schema dei branch. `counts` è l'uscita di `countArgv`, vuota se git non
 * la sa dare: allora ogni branch conta come attivo. Un branch remoto che è
 * l'upstream di un locale, o ha il nome di un locale, è quel locale. Un
 * branch è attivo se ha commit che il principale non ha, o se è aperto: è il
 * branch attuale o sta in un worktree.
 */
export function branchesOf(refs, counts, base, remotes, syncs = new Map()) {
    if (!base)
        return NO_BRANCHES;
    const counted = readCounts(counts);
    const branches = refs.filter(r => r.symref === '' && (r.ref.startsWith('refs/heads/') || r.ref.startsWith('refs/remotes/')));
    const locals = branches.filter(r => r.ref.startsWith('refs/heads/'));
    const upstreams = new Set(locals.map(r => r.upstream).filter(u => u !== ''));
    const localNames = new Set(locals.map(r => shortOf(r.ref)));
    const info = (r) => {
        const isRemote = r.ref.startsWith('refs/remotes/');
        const c = counted.get(r.ref);
        const synced = syncs.get(isRemote ? r.ref : r.upstream);
        return {
            ref: r.ref,
            name: isRemote ? splitRemote(r.ref, remotes)[1] : shortOf(r.ref),
            remote: isRemote ? shortOf(r.ref) : r.upstream === '' ? '' : shortOf(r.upstream),
            isCurrent: r.isHead && !isRemote,
            ...(c ? { ahead: c.ahead, behind: c.behind } : {}),
            sync: syncOf(r),
            ...(synced ? { synced } : {}),
            time: r.time,
            short: r.short,
            author: r.author,
            subject: r.subject,
            worktree: r.worktree,
        };
    };
    // Il principale si mostra con il locale che lo segue, se c'è.
    const isRemoteBase = base.ref.startsWith('refs/remotes/');
    const baseBranch = isRemoteBase ? splitRemote(base.ref, remotes)[1] : shortOf(base.ref);
    const follower = isRemoteBase
        ? (locals.find(r => r.upstream === base.ref && shortOf(r.ref) === baseBranch) ?? locals.find(r => r.upstream === base.ref))
        : undefined;
    const trunkRef = follower ?? base;
    const rest = branches.filter(r => {
        if (r.ref === trunkRef.ref || r.ref === base.ref)
            return false;
        if (r.ref.startsWith('refs/heads/'))
            return true;
        return !upstreams.has(r.ref) && !localNames.has(splitRemote(r.ref, remotes)[1]);
    });
    const isActive = (b) => b.ahead === undefined || b.ahead > 0 || b.isCurrent || b.worktree !== '';
    const all = rest.map(info);
    const byRecent = (a, b) => b.time - a.time || a.name.localeCompare(b.name);
    return {
        baseName: shortOf(base.ref),
        trunk: info(trunkRef),
        active: all.filter(isActive).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || byRecent(a, b)),
        merged: all.filter(b => !isActive(b)).sort(byRecent),
    };
}
/** L'ultima voce del reflog di un ref: quando, e con che cosa. */
export const reflogArgv = (ref) => ['reflog', 'show', '-1', '--date=unix', `--format=%gd${F}%gs`, ref, '--'];
/** La voce dall'uscita di `reflogArgv`; undefined se il ref non ha reflog. */
export const readReflog = (stdout) => {
    const [selector = '', message = ''] = stdout.trim().split(F);
    const time = Number(/@\{(\d+)\}$/.exec(selector)?.[1]);
    if (!Number.isFinite(time) || time <= 0)
        return undefined;
    const by = /^update by push/.test(message) ? 'push' : /^(fetch|pull)\b/.test(message) ? 'fetch' : undefined;
    return { time, ...(by ? { by } : {}) };
};
/**
 * I branch remoti che l'ultimo fetch ha visto, dal testo di FETCH_HEAD, con
 * il commit su cui stavano. Una riga dice `branch 'x' of <url>`: il remoto è
 * quello il cui url contiene <url>, o l'unico che c'è.
 */
export const readFetchHead = (text, remotes) => {
    const out = new Map();
    for (const line of text.split('\n')) {
        const m = /^([0-9a-f]+)\t[^\t]*\tbranch '(.+)' of (.+)$/.exec(line);
        if (!m)
            continue;
        const [, hash = '', branch = '', url = ''] = m;
        const remote = remotes.length === 1 ? remotes[0] : remotes.find(r => r.url.includes(url.trim()));
        if (remote)
            out.set(`refs/remotes/${remote.name}/${branch}`, hash);
    }
    return out;
};
/**
 * L'ultima sincronizzazione di ogni branch remoto: la più recente tra
 * l'ultima voce del suo reflog (un push o un fetch che l'ha spostato) e
 * l'ultimo fetch, se l'ha visto sullo stesso commit su cui sta ora.
 */
export function syncTimes(refs, reflogs, fetched, fetchTime) {
    const out = new Map();
    for (const r of refs) {
        if (r.symref !== '' || !r.ref.startsWith('refs/remotes/'))
            continue;
        const logged = reflogs.get(r.ref);
        const seen = fetchTime > 0 && fetched.get(r.ref) === r.hash ? { time: fetchTime, by: 'fetch' } : undefined;
        const latest = logged && seen ? (seen.time > logged.time ? seen : logged) : (logged ?? seen);
        if (latest)
            out.set(r.ref, latest);
    }
    return out;
}
/** `now`, `5m`, `3h`, `2d`, `3w`, `4mo`, `2y`: da quanto è successo. */
export const since = (ms, now) => {
    const s = Math.max(0, (now - ms) / 1000);
    const days = s / 86_400;
    if (s < 60)
        return 'now';
    if (s < 3600)
        return `${Math.floor(s / 60)}m`;
    if (days < 1)
        return `${Math.floor(s / 3600)}h`;
    if (days < 7)
        return `${Math.floor(days)}d`;
    if (days < 30)
        return `${Math.floor(days / 7)}w`;
    if (days < 365)
        return `${Math.floor(days / 30.44)}mo`;
    return `${Math.floor(days / 365)}y`;
};
