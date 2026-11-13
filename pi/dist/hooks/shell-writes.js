import { readText } from './files';
import { git, repo } from './repo';
import { join } from './vendor/filetree';
// Un file più grande di così non si legge, e i suoi cambi non si contano.
const MAX_BYTES = 1_000_000;
// I file già modificati che si leggono prima di un comando, al massimo.
const MAX_DIRTY = 300;
// Un comando che fa comparire più file di così (un install, una build, un
// archivio aperto) non sta scrivendo a mano: i file nuovi non si contano.
const MAX_NEW = 200;
// git gira prima del comando e lo fa aspettare: oltre questo si rinuncia.
const GIT_MS = 5_000;
/** I file in `git status --porcelain=v1 -z`, assoluti, una volta sola; né ignorati né cartelle. */
export function parseStatus(stdout, top) {
    const out = new Map();
    const parts = stdout.split('\0');
    for (let i = 0; i < parts.length; i++) {
        const rec = parts[i] ?? '';
        if (rec.length < 4 || rec.startsWith('## '))
            continue;
        const xy = rec.slice(0, 2);
        const rel = rec.slice(3);
        // Una rinomina o una copia porta dietro il nome di prima.
        if (xy[0] === 'R' || xy[0] === 'C')
            i++;
        if (xy === '!!' || rel.endsWith('/'))
            continue;
        const path = join(top, rel);
        // Tolto dall'indice e rimasto sul disco: due righe, ed è ancora nel commit.
        const isUntracked = xy === '??' && (out.get(path)?.isUntracked ?? true);
        out.set(path, { path, rel, isUntracked });
    }
    return [...out.values()];
}
async function status($) {
    const out = await git($, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], GIT_MS).catch(() => undefined);
    return out?.exitCode === 0 && !out.isStdoutTruncated ? parseStatus(out.stdout, repo.top) : undefined;
}
// Il contenuto di un file per il confronto: null se non c'è, undefined se non
// è un file, è troppo grande o non si legge.
async function contentOf($, path) {
    const stat = await $.fs.stat(path).catch(() => undefined);
    if (!stat)
        return null;
    if (stat.kind !== 'file' || stat.size > MAX_BYTES)
        return undefined;
    return (await readText($, path)) ?? undefined;
}
// Un file pulito prima del comando, com'era nel commit: con i filtri di git,
// come gli a capo di Windows. null se non è tracciato.
async function committed($, head, entry) {
    if (entry.isUntracked || !head)
        return null;
    const out = await git($, ['cat-file', '--filters', `${head}:${entry.rel}`], GIT_MS).catch(() => undefined);
    return out?.exitCode === 0 && !out.isStdoutTruncated ? out.stdout : undefined;
}
/** Prima di un comando: i file già modificati e il loro contenuto. */
export async function snapshot($) {
    if (!repo.top)
        return undefined;
    const top = repo.top;
    const [entries, head] = await Promise.all([status($), git($, ['rev-parse', '--verify', '-q', 'HEAD'], GIT_MS).catch(() => undefined)]);
    if (!entries)
        return undefined;
    const texts = await Promise.all(entries.map((e, i) => (i < MAX_DIRTY ? contentOf($, e.path) : undefined)));
    return {
        top,
        head: head?.exitCode === 0 ? head.stdout.trim() : '',
        dirty: new Map(entries.map((e, i) => [e.path, texts[i]])),
    };
}
/** Dopo il comando: i file che ha cambiato, con il contenuto di prima e di adesso. */
export async function shellWrites($, shot) {
    if (repo.top !== shot.top)
        return [];
    const entries = await status($);
    if (!entries)
        return [];
    const fresh = entries.filter(e => !shot.dirty.has(e.path));
    const found = await Promise.all([
        ...[...shot.dirty].map(async ([path, before]) => {
            if (before === undefined)
                return undefined;
            const after = await contentOf($, path);
            return typeof after !== 'string' || after === before ? undefined : { path, before, after };
        }),
        ...(fresh.length > MAX_NEW ? [] : fresh).map(async (entry) => {
            const after = await contentOf($, entry.path);
            if (typeof after !== 'string')
                return undefined;
            const before = await committed($, shot.head, entry);
            return before === undefined || after === before ? undefined : { path: entry.path, before, after };
        }),
    ]);
    return found.filter(w => w !== undefined);
}
