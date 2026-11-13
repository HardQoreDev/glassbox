import { h, Fragment } from '../../src/jsx.ts'
// La sezione FILE, in due viste. La principale è la lista dei file che la
// sessione ha modificato, con le righe inserite e cancellate. L'altra è
// l'albero a cartelle disegnato come in filetree (hooks/register.tsx,
// `rowSpec`): colore e lettera dello stato git, conteggi delle cartelle, righe
// aggiunte e tolte, i file toccati da Claude accesi.
import { tree } from './files';
import { repo } from './repo';
import { touchedList } from './touched';
import { SELECTED_BG, fit, len } from './ui';
import { ACCENT, ADD_COLOR, DEL_COLOR, GIT_COLOR, TONES, URGENT, dirname, underAny } from './vendor/filetree';
import { GUARD_COLOR } from './view-guard';
const countSegs = (c) => {
    if (!c)
        return [];
    const out = [];
    if (c[0] > 0)
        out.push({ text: ` ?:${c[0]}`, color: GIT_COLOR['?'] });
    if (c[1] > 0)
        out.push({ text: ` M:${c[1]}`, color: GIT_COLOR.M });
    if (c[2] > 0)
        out.push({ text: ` D:${c[2]}`, color: URGENT });
    return out;
};
/** Il testo accanto al titolo: la cartella, le righe cambiate o `clean`. */
export const filesInfo = () => {
    if (!repo.root)
        return [];
    const name = repo.root.split('/').pop() || repo.root;
    const totals = repo.diff[repo.root] ?? [0, 0];
    const counts = countSegs(repo.counts[repo.root]);
    const out = [{ text: name }];
    if (totals[0] > 0)
        out.push({ text: ` +${totals[0]}`, color: ADD_COLOR });
    if (totals[1] > 0)
        out.push({ text: ` -${totals[1]}`, color: DEL_COLOR });
    out.push(...counts);
    if (repo.top && counts.length === 0 && totals[0] === 0 && totals[1] === 0)
        out.push({ text: ' clean', dim: true });
    return out;
};
/** Il testo accanto al titolo nella vista dei file toccati: quanti e quante righe. */
export const touchedInfo = () => {
    const list = touchedList();
    if (list.length === 0)
        return [{ text: 'no changes', dim: true }];
    const added = list.reduce((n, t) => n + t.added, 0);
    const removed = list.reduce((n, t) => n + t.removed, 0);
    return [
        { text: `${list.length} ${list.length === 1 ? 'file' : 'files'}`, dim: true },
        { text: ` +${added}`, color: ADD_COLOR },
        { text: ` −${removed}`, color: DEL_COLOR },
    ];
};
/**
 * La vista principale: un file per riga, dal più recente; la cartella in
 * grigio, il nome in chiaro, a destra le righe inserite e cancellate. Un file
 * che anche un'altra sessione aperta sta cambiando (`contested`, da GUARD) ha
 * ▲ e il nome in rosso.
 */
// Il pulsante in fondo a ogni file modificato, che lo apre fuori; lo spazio
// davanti sta fuori dal pulsante, che il motore inverte per intero.
const OPEN = '↗';
export function touchedLines(width, now, press, open, contested = new Set()) {
    const list = touchedList();
    if (list.length === 0)
        return [el => h(el.Text, { dimColor: true }, fit('No files changed in this session yet.', width))];
    return list.map(t => {
        const rel = repo.root && t.path.startsWith(`${repo.root}/`) ? t.path.slice(repo.root.length + 1) : t.path;
        const cut = rel.lastIndexOf('/');
        const name = rel.slice(cut + 1);
        const plus = ` +${t.added}`;
        const minus = ` −${t.removed}`;
        const room = Math.max(4, width - 2 - len(plus) - len(minus) - 1 - len(OPEN) - 1);
        const shownName = fit(name, room);
        const dirRoom = room - len(shownName);
        const dir = cut < 0 || dirRoom < 3 ? '' : len(rel.slice(0, cut + 1)) <= dirRoom ? rel.slice(0, cut + 1) : `…${rel.slice(0, cut + 1).slice(-(dirRoom - 1))}`;
        const pad = ' '.repeat(Math.max(0, width - 2 - len(dir) - len(shownName) - len(plus) - len(minus) - 1 - len(OPEN)));
        const flash = tree.flash.get(t.path);
        const isShared = contested.has(t.path);
        const lit = flash !== undefined && flash.until > now ? TONES[flash.tone] : isShared ? GUARD_COLOR : undefined;
        const mark = isShared ? '▲ ' : t.isNew ? '+ ' : '● ';
        return el => (h(el.Box, { key: `t:${t.path}`, flexDirection: "row", height: 1, overflow: "hidden" },
            h(el.Text, { color: isShared ? GUARD_COLOR : t.isNew ? ADD_COLOR : GIT_COLOR.M, bold: isShared }, mark),
            h(el.Button, { key: `touched:${t.path}`, plain: true, label: rel, onPress: () => press(t) },
                h(el.Text, { dimColor: true }, dir),
                h(el.Text, { color: lit, bold: lit !== undefined }, shownName)),
            h(el.Text, null, pad),
            h(el.Text, { color: ADD_COLOR, dimColor: t.added === 0 }, plus),
            h(el.Text, { color: DEL_COLOR, dimColor: t.removed === 0 }, minus),
            h(el.Text, null, " "),
            h(el.Button, { key: `open:${t.path}`, plain: true, dimColor: true, label: `Open ${name}`, onPress: () => open(t) },
                h(el.Text, { dimColor: true }, OPEN))));
    });
}
export function fileLines(width, now, rows, press) {
    if (!repo.root)
        return [];
    if (rows.length === 0)
        return [el => h(el.Text, { dimColor: true }, "empty")];
    return rows.map(r => {
        const n = r.node;
        const own = repo.git[n.id];
        const status = own ?? (underAny(dirname(n.id), repo.untracked, repo.root) ? '?' : undefined);
        const isIgnored = !status && underAny(n.id, repo.ignored, repo.root);
        const gitColor = status === 'D' || status === 'U' ? URGENT : status ? GIT_COLOR[status] : undefined;
        const flash = tree.flash.get(n.id);
        const lit = flash !== undefined && flash.until > now ? TONES[flash.tone] : undefined;
        const muted = isIgnored || n.hidden;
        const loc = repo.diff[n.id];
        const right = [];
        if (loc && loc[0] > 0)
            right.push({ text: ` +${loc[0]}`, color: ADD_COLOR });
        if (loc && loc[1] > 0)
            right.push({ text: ` -${loc[1]}`, color: DEL_COLOR });
        const dirCounts = n.kind === 'dir' ? countSegs(repo.counts[n.id]) : [];
        right.push(...dirCounts);
        const badge = dirCounts.length ? '' : status ? ` ${status}` : isIgnored ? ' ⊘' : '  ';
        if (badge)
            right.push({ text: badge, color: gitColor, dim: !status, bold: true });
        const rightW = right.reduce((w, s) => w + len(s.text), 0);
        const indent = '  '.repeat(r.depth);
        const caret = n.kind === 'dir' ? (r.open ? '▾ ' : '▸ ') : '  ';
        const glyph = n.kind === 'dir' ? '■' : '∙';
        const nameW = Math.max(4, width - len(indent) - 2 - 2 - rightW);
        const name = fit(n.name, nameW);
        const pad = ' '.repeat(Math.max(0, width - len(indent) - 4 - len(name) - rightW));
        const iconColor = lit ?? (muted ? undefined : (gitColor ?? (n.kind === 'dir' ? ACCENT : undefined)));
        const nameColor = lit ?? (muted ? undefined : gitColor);
        const isSelected = tree.selected === n.id;
        return el => (h(el.Box, { key: `f:${n.id}`, flexDirection: "row", height: 1, overflow: "hidden", backgroundColor: isSelected ? SELECTED_BG : undefined },
            h(el.Text, null, indent),
            h(el.Button, { key: `file:${n.id}`, plain: true, label: n.name, onPress: () => press(r) },
                h(el.Text, { dimColor: true }, caret),
                h(el.Text, { color: iconColor, dimColor: iconColor === undefined },
                    glyph,
                    ' '),
                h(el.Text, { color: nameColor, dimColor: muted && !lit, bold: lit !== undefined || isSelected, strikethrough: status === 'D' && n.kind !== 'dir' }, name)),
            h(el.Text, null, pad),
            right.map(s => (h(el.Text, { color: s.color, dimColor: s.dim, bold: s.bold }, s.text)))));
    });
}
