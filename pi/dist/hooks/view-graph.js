import { h, Fragment } from '../../src/jsx.ts'
import { repo } from './repo';
import { ACCENT, SELECTED_BG, ago, fit, len } from './ui';
// I colori delle corsie, nell'ordine in cui le apre il grafo (quelli di VS Code).
export const LANES = ['#59a4f9', '#ffb000', '#dc267f', '#40b0a6', '#b66dff', '#fe6100', '#a4c639', '#e5c07b'];
const REMOTE_BG = '#b180d7';
const DARK = '#1e1e1e';
const lane = (i) => LANES[i % LANES.length] ?? ACCENT;
export const graph = { selected: '' };
// I nomi dei primi `most` branch del commit, ognuno in `room` colonne.
const badgesOf = (row, room, most) => {
    const refs = row.commit.refs;
    const out = refs.slice(0, most).map(r => {
        const name = fit(r.name, room);
        if (r.kind === 'remote')
            return { text: ` ☁ ${name} `, bg: REMOTE_BG, fg: DARK };
        if (r.kind === 'detached')
            return { text: ' HEAD ', bg: LANES[7], fg: DARK, bold: true };
        const mark = r.kind === 'current' ? '◎ ' : '';
        return { text: ` ${mark}${name}${r.isSynced ? ' ☁' : ''} `, bg: lane(row.color), fg: DARK, bold: r.kind === 'current' };
    });
    if (refs.length > most)
        out.push({ text: `+${refs.length - most}`, dim: true });
    return out;
};
const badgesW = (badges) => badges.reduce((w, b) => w + len(b.text) + 1, 0);
// Ogni nome con uno spazio davanti.
const badgeEls = (el, badges) => badges.map(b => (h(el.Text, null,
    ' ',
    h(el.Text, { backgroundColor: b.bg, color: b.fg, bold: b.bold, dimColor: b.dim }, b.text))));
// I segni delle corsie di una riga, ognuno del colore della sua.
const cellsEl = (el, row) => (h(el.Text, null, row.cells.map(cell => (h(el.Text, { color: lane(cell.glyphColor) },
    cell.glyph,
    h(el.Text, { color: lane(cell.fillColor) }, cell.fill))))));
// Sotto il commit scelto: le corsie che proseguono, poi i suoi dati.
const detailLines = (row, width, texts) => {
    const c = row.commit;
    const rail = row.below.map(color => (color === null ? '  ' : '│ '));
    const railW = rail.length * 2;
    return texts.map((text, i) => el => (h(el.Box, { key: `d:${c.hash}:${i}`, flexDirection: "row", height: 1, overflow: "hidden", backgroundColor: SELECTED_BG },
        h(el.Text, null, row.below.map((color, k) => (h(el.Text, { color: color === null ? undefined : lane(color) }, rail[k])))),
        h(el.Text, { dimColor: true }, fit(text, Math.max(4, width - railW))))));
};
// Fuori da un repo, con un errore o senza commit: una riga che lo dice.
export const emptyLines = (width) => {
    if (!repo.top)
        return [el => h(el.Text, { dimColor: true }, fit('This session is not in a git repo.', width))];
    if (repo.error)
        return [el => h(el.Text, { color: "red" }, fit(repo.error, width))];
    if (repo.rows.length === 0)
        return [el => h(el.Text, { dimColor: true }, "No commits.")];
    return undefined;
};
/** Il testo accanto al titolo: il branch attuale e quanto è avanti o indietro. */
export const graphInfo = () => {
    const b = repo.branch;
    if (!repo.top)
        return [{ text: 'no repo', dim: true }];
    if (!b)
        return [];
    return [
        { text: b.head, color: ACCENT },
        ...(b.ahead > 0 ? [{ text: ` ↑${b.ahead}`, color: '#40b0a6' }] : []),
        ...(b.behind > 0 ? [{ text: ` ↓${b.behind}`, color: '#59a4f9' }] : []),
    ];
};
export function graphLines(width, now, select) {
    const empty = emptyLines(width);
    if (empty)
        return empty;
    const lines = [];
    for (const row of repo.rows) {
        const c = row.commit;
        const isSelected = graph.selected === c.hash;
        const badges = badgesOf(row, Math.max(6, Math.floor(width * 0.3)), 2);
        const graphW = row.cells.length * 2;
        const subjectW = Math.max(4, width - graphW - badgesW(badges));
        const subject = fit(c.subject, subjectW);
        const pad = ' '.repeat(Math.max(0, width - graphW - len(subject) - badgesW(badges)));
        lines.push(el => (h(el.Box, { key: `g:${c.hash}`, flexDirection: "row", height: 1, overflow: "hidden", backgroundColor: isSelected ? SELECTED_BG : undefined },
            cellsEl(el, row),
            h(el.Button, { key: `commit:${c.hash}`, plain: true, label: subject, onPress: () => select(c.hash) },
                h(el.Text, { bold: c.isHead }, subject)),
            h(el.Text, null, pad),
            badgeEls(el, badges))));
        if (!isSelected)
            continue;
        lines.push(...detailLines(row, width, [
            `${c.short} · ${c.author} · ${ago(c.time * 1000, now)}`,
            ...(c.refs.length > 2 ? [c.refs.map(r => r.name).join('  ')] : []),
        ]));
    }
    return lines;
}
