// Il grafo dei commit come lo disegna il pannello Source Control di VS Code:
// una corsia per ramo, un nodo per commit, i rami che si separano e si uniscono
// sulla riga stessa del commit. Qui solo dati: i colori sono indici di corsia.
const F = '\x1f';
const R = '\x1e';
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
];
// Prima il branch attuale, poi gli altri locali, poi i remoti.
const ORDER = { current: 0, detached: 0, local: 1, remote: 2 };
// `origin/fix/x` → `fix/x`.
const branchOf = (remote) => remote.slice(remote.indexOf('/') + 1);
export const parseRefs = (decoration, remotes) => {
    const refs = decoration
        .split(', ')
        .filter(name => name !== '')
        .map(name => {
        if (name.startsWith('HEAD -> '))
            return { name: name.slice(8), kind: 'current' };
        if (name === 'HEAD')
            return { name: 'HEAD', kind: 'detached' };
        const isRemote = remotes.some(remote => name.startsWith(`${remote}/`));
        return { name, kind: isRemote ? 'remote' : 'local' };
    });
    // Un remoto con il locale omonimo sullo stesso commit diventa la nuvola del locale.
    const locals = new Set(refs.filter(r => r.kind !== 'remote').map(r => r.name));
    const synced = new Set(refs.filter(r => r.kind === 'remote').map(r => branchOf(r.name)).filter(b => locals.has(b)));
    return refs
        .filter(r => r.kind !== 'remote' || !synced.has(branchOf(r.name)))
        .map(r => (r.kind !== 'remote' && synced.has(r.name) ? { ...r, isSynced: true } : r))
        .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
};
/** I commit dall'uscita di `LOG_ARGV`; `remotes` da `git remote`. */
export const parseLog = (stdout, remotes) => stdout
    .split(R)
    .map(record => record.replace(/^\n/, ''))
    .filter(record => record.includes(F))
    .map(record => {
    const [hash = '', short = '', parents = '', decoration = '', subject = '', author = '', time = '0'] = record.split(F);
    const refs = parseRefs(decoration, remotes);
    return {
        hash,
        short,
        parents: parents.split(' ').filter(p => p !== ''),
        refs,
        subject,
        author,
        time: Number(time),
        isHead: refs.some(r => r.kind === 'current' || r.kind === 'detached'),
    };
});
/**
 * Le righe del grafo: per ogni commit la sua corsia e i segni di ogni colonna.
 * Una corsia aspetta il prossimo commit del suo ramo; quando due corsie
 * aspettano lo stesso commit si uniscono lì (`╯`), e il secondo genitore di un
 * merge apre una corsia nuova (`╮`) o raggiunge quella che già lo aspetta (`┤`).
 */
export function layout(commits) {
    const lanes = [];
    let colors = 0;
    const free = (skip) => {
        const i = lanes.findIndex((l, k) => l === null && k !== skip);
        return i === -1 ? Math.max(lanes.length, skip + 1) : i;
    };
    return commits.map(c => {
        const before = lanes.slice();
        let lane = lanes.findIndex(l => l?.hash === c.hash);
        if (lane === -1) {
            lane = free(-1);
            lanes[lane] = { hash: c.hash, color: colors++ };
        }
        const color = lanes[lane]?.color ?? 0;
        const merging = [];
        lanes.forEach((l, j) => {
            if (j !== lane && l?.hash === c.hash) {
                merging.push({ col: j, color: l.color });
                lanes[j] = null;
            }
        });
        const [first, ...rest] = c.parents;
        lanes[lane] = first === undefined ? null : { hash: first, color };
        const forks = [];
        for (const parent of rest) {
            const j = lanes.findIndex(l => l?.hash === parent);
            if (j !== -1) {
                forks.push({ col: j, color: lanes[j]?.color ?? 0, joins: true });
            }
            else {
                const k = free(lane);
                lanes[k] = { hash: parent, color: colors++ };
                forks.push({ col: k, color: lanes[k]?.color ?? 0, joins: false });
            }
        }
        for (let k = 0; k < lanes.length; k++)
            if (lanes[k] === undefined)
                lanes[k] = null;
        while (lanes.length > 0 && lanes.at(-1) === null)
            lanes.pop();
        const width = Math.max(before.length, lanes.length, lane + 1);
        const cells = Array.from({ length: width }, (_, k) => {
            const up = before[k];
            const down = lanes[k];
            const passes = up != null && down != null;
            const tint = (down ?? up)?.color ?? color;
            return { glyph: passes ? '│' : ' ', glyphColor: tint, fill: ' ', fillColor: tint };
        });
        const node = cells[lane];
        if (node) {
            node.glyph = c.isHead ? '○' : c.parents.length > 1 ? '⊙' : '●';
            node.glyphColor = color;
        }
        const link = (target, glyph) => {
            const cell = cells[target.col];
            if (cell) {
                cell.glyph = glyph;
                cell.glyphColor = target.color;
            }
            const [from, to] = target.col > lane ? [lane, target.col] : [target.col, lane];
            for (let k = from; k < to; k++) {
                const cur = cells[k];
                if (!cur)
                    continue;
                cur.fill = '─';
                cur.fillColor = target.color;
                if (k > from && cur.glyph === ' ') {
                    cur.glyph = '─';
                    cur.glyphColor = target.color;
                }
            }
        };
        for (const m of merging) {
            const reopened = forks.some(f => f.col === m.col);
            link(m, reopened ? (m.col > lane ? '┤' : '├') : m.col > lane ? '╯' : '╰');
        }
        for (const f of forks) {
            if (merging.some(m => m.col === f.col))
                continue;
            link(f, f.joins ? (f.col > lane ? '┤' : '├') : f.col > lane ? '╮' : '╭');
        }
        return { commit: c, cells, lane, color, below: lanes.map(l => l?.color ?? null) };
    });
}
