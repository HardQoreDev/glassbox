// Ripreso da filetree (github.com/data-goblin/claude-code-filetree, v0.4.1):
// le funzioni pure di hooks/tree.ts, i colori git di hooks/icons.ts e i toni di
// hooks/git.ts che servono qui, senza il supporto ai percorsi Windows con
// lettera di unità né le icone Nerd Font.
// MIT License, Copyright (c) 2026 Kurt Buhler: vedi THIRD-PARTY.md.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function join(dir, name) {
    return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}
export function dirname(path) {
    const i = path.lastIndexOf('/');
    return i <= 0 ? '/' : path.slice(0, i);
}
export function inside(root, path) {
    return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}
export function relative(root, path) {
    return path === root ? '' : path.slice(root.endsWith('/') ? root.length : root.length + 1);
}
export function ancestorsOf(id, root) {
    const out = [];
    if (!root)
        return out;
    for (let dir = dirname(id), prev = id; dir !== prev && dir !== root && inside(root, dir); prev = dir, dir = dirname(dir))
        out.push(dir);
    return out;
}
export function underAny(id, set, root) {
    if (set.size === 0)
        return false;
    let cur = id;
    while (cur.length >= root.length) {
        if (set.has(cur))
            return true;
        const up = dirname(cur);
        if (up === cur)
            break;
        cur = up;
    }
    return false;
}
export function toNodes(dir, list) {
    return list
        .map(e => ({
        id: join(dir, e.name),
        parent: dir,
        name: e.name,
        kind: e.isLink ? 'link' : e.kind === 'dir' ? 'dir' : 'file',
        hidden: e.name.startsWith('.'),
        mtime: e.mtimeMs,
        size: e.size,
        loaded: false,
    }))
        .sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || collator.compare(a.name, b.name));
}
export function replaceChildren(nodes, listed) {
    if (listed.size === 0)
        return nodes;
    const keep = new Map();
    for (const n of nodes)
        if (listed.has(n.parent))
            keep.set(n.id, n);
    const freshIds = new Set();
    for (const kids of listed.values())
        for (const k of kids)
            freshIds.add(k.id);
    const gone = new Set([...keep.keys()].filter(id => !freshIds.has(id)));
    const under = (id) => {
        if (gone.size === 0)
            return false;
        for (let dir = dirname(id), prev = id; dir !== prev; prev = dir, dir = dirname(dir))
            if (gone.has(dir))
                return true;
        return false;
    };
    const fresh = [];
    for (const kids of listed.values()) {
        for (const k of kids) {
            if (under(k.id))
                continue;
            const old = keep.get(k.id);
            fresh.push(old && old.kind === 'dir' && k.kind === 'dir' ? { ...k, loaded: old.loaded } : k);
        }
    }
    const out = nodes.filter(n => !listed.has(n.parent) && !under(n.id));
    return [...out.map(n => (listed.has(n.id) ? { ...n, loaded: true } : n)), ...fresh];
}
export function parseBranch(record) {
    const body = record.replace(/^## /, '');
    if (body.startsWith('HEAD (no branch)'))
        return { head: 'detached', upstream: '', ahead: 0, behind: 0 };
    const head = body.match(/^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.|\s|$)/)?.[1] ?? body;
    const upstream = body.match(/\.\.\.(\S+)/)?.[1] ?? '';
    const ahead = Number(body.match(/ahead (\d+)/)?.[1] ?? 0);
    const behind = Number(body.match(/behind (\d+)/)?.[1] ?? 0);
    return { head, upstream, ahead, behind };
}
export function mapper(root, prefix) {
    return rel => (rel.startsWith(prefix) ? join(root, rel.slice(prefix.length).replace(/\/$/, '')).replace(/\/$/, '') : null);
}
export function parseGit(stdout, root, prefix) {
    const map = mapper(root, prefix);
    const git = {};
    const ignored = [];
    const untrackedDirs = [];
    const files = {};
    let branch = null;
    const parts = stdout.split('\0');
    for (let i = 0; i < parts.length; i++) {
        const rec = parts[i] ?? '';
        if (rec.startsWith('## ')) {
            branch = parseBranch(rec);
            continue;
        }
        if (rec.length < 4)
            continue;
        const xy = rec.slice(0, 2);
        const raw = rec.slice(3);
        if (xy[0] === 'R' || xy[0] === 'C')
            i++;
        const path = map(raw);
        if (!path)
            continue;
        if (xy === '!!') {
            ignored.push(path);
            continue;
        }
        if (xy === '??' && raw.endsWith('/'))
            untrackedDirs.push(path);
        else
            files[path] = xy === '??' || (xy.includes('A') && !xy.includes('D')) ? 'new' : xy.includes('D') && !/U/.test(xy) ? 'del' : 'mod';
        const letter = xy === '??'
            ? '?'
            : /U/.test(xy) || xy === 'AA' || xy === 'DD'
                ? 'U'
                : (['D', 'M', 'R', 'C', 'A', 'T'].find(c => xy.includes(c)) ?? '');
        if (!letter)
            continue;
        git[path] = stronger(git[path], letter);
        let dir = dirname(path);
        while (dir.length >= root.length && dir !== '/') {
            git[dir] = stronger(git[dir], letter);
            if (dir === root)
                break;
            dir = dirname(dir);
        }
    }
    return { git, ignored, untrackedDirs, branch, files };
}
export function parseNumstat(stdout, root, prefix, into) {
    const map = mapper(root, prefix);
    const parts = stdout.split('\0');
    for (let i = 0; i < parts.length; i++) {
        const rec = parts[i] ?? '';
        if (!rec)
            continue;
        const m = rec.match(/^(-|\d+)\t(-|\d+)\t(.*)$/s);
        if (!m)
            continue;
        let path = m[3] ?? '';
        if (path === '') {
            i += 2;
            path = parts[i] ?? '';
        }
        if (!path)
            continue;
        const add = m[1] === '-' ? 0 : Number(m[1]);
        const del = m[2] === '-' ? 0 : Number(m[2]);
        const abs = map(path);
        if (!abs)
            continue;
        const prev = into[abs] ?? [0, 0];
        into[abs] = [prev[0] + add, prev[1] + del];
    }
}
export function rollUp(diff, root) {
    const out = { ...diff };
    for (const [path, [add, del]] of Object.entries(diff)) {
        let dir = dirname(path);
        while (dir.length >= root.length && dir !== '/') {
            const prev = out[dir] ?? [0, 0];
            out[dir] = [prev[0] + add, prev[1] + del];
            if (dir === root)
                break;
            dir = dirname(dir);
        }
    }
    return out;
}
export function rollCounts(files, root) {
    const out = {};
    const slot = { new: 0, mod: 1, del: 2 };
    for (const [path, change] of Object.entries(files)) {
        let dir = dirname(path);
        while (dir.length >= root.length && dir !== '/') {
            const cur = out[dir] ?? [0, 0, 0];
            cur[slot[change]] += 1;
            out[dir] = cur;
            if (dir === root)
                break;
            dir = dirname(dir);
        }
    }
    return out;
}
// --- hooks/icons.ts ---
export const GIT_COLOR = {
    A: 'ansi256(2)',
    '?': 'ansi256(2)',
    R: 'ansi256(4)',
    C: 'ansi256(4)',
    M: 'ansi256(3)',
    T: 'ansi256(3)',
};
const PRIORITY = ['U', 'D', 'M', 'T', 'R', 'C', 'A', '?'];
export function stronger(a, b) {
    if (!a)
        return b;
    return PRIORITY.indexOf(b) < PRIORITY.indexOf(a) ? b : a;
}
// --- hooks/palette.ts e hooks/tree.ts (DEFAULT_THEME) ---
export const ADD_COLOR = 'ansi256(2)';
export const DEL_COLOR = 'ansi256(1)';
export const ACCENT = 'ansi256(4)';
export const URGENT = 'ansi256(1)';
// --- hooks/git.ts (TONES, il colore pieno di ogni tono) ---
export const TONES = {
    orange: '#f97316',
    green: '#4ade80',
    teal: '#2dd4bf',
    blue: '#60a5fa',
    purple: '#c084fc',
    red: '#f87171',
};
