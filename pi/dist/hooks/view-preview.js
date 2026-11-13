import { h, Fragment } from '../../src/jsx.ts'
import { hunkOf, preview, rowsOf } from './preview';
import { repo } from './repo';
import { fit, len } from './ui';
import { ADD_COLOR, DEL_COLOR, URGENT } from './vendor/filetree';
import { frameHead, scrollbar, slider } from './view-frame';
// Le colonne che Code mette prima del testo, oltre alle cifre del numero di
// riga: lo spazio, il segno, lo spazio dopo, e una di margine. Una stima: il
// disegno è di Code.
const GUTTER = 4;
export function previewLayout(width, bodyRows) {
    const total = preview.rows.length;
    const visible = Math.max(1, width - 1 - String(total).length - GUTTER);
    if (!preview.wrap) {
        const maxLeft = Math.max(0, preview.width - visible);
        const rows = Math.max(1, bodyRows - (maxLeft > 0 ? 3 : 2));
        return { rows, visible, maxTop: Math.max(0, total - rows), maxLeft, sliderRow: maxLeft > 0 ? 2 + rows : -1, countFrom: () => rows };
    }
    // A capo: ogni riga del file prende le sue righe di schermo.
    const rows = Math.max(1, bodyRows - 2);
    const heights = new Map();
    const height = (i) => {
        const h = heights.get(i) ?? rowsOf(i, visible);
        heights.set(i, h);
        return h;
    };
    // La prima riga da cui il resto del file entra tutto; almeno l'ultima.
    let maxTop = total;
    let used = 0;
    while (maxTop > 0 && used + height(maxTop - 1) <= rows)
        used += height(--maxTop);
    // L'ultima riga può uscire di sotto: la taglia il riquadro.
    const countFrom = (from) => {
        let n = 0;
        for (let h = 0; from + n < total && h < rows; n++)
            h += height(from + n);
        return n;
    };
    return { rows, visible, maxTop: Math.min(maxTop, Math.max(0, total - 1)), maxLeft: 0, sliderRow: -1, countFrom };
}
export function previewLines(el, width, layout, color, act) {
    const rel = repo.root && preview.path.startsWith(`${repo.root}/`) ? preview.path.slice(repo.root.length + 1) : preview.path;
    const cut = rel.lastIndexOf('/');
    const right = [
        { text: ` +${preview.added}`, color: ADD_COLOR },
        { text: ` −${preview.removed}`, color: DEL_COLOR },
        ...(preview.isGone ? [{ text: ' deleted', color: URGENT }] : []),
    ];
    const title = (room) => {
        const name = fit(rel.slice(cut + 1), room);
        const dirRoom = room - len(name);
        const dirFull = cut < 0 ? '' : rel.slice(0, cut + 1);
        const dir = dirRoom < 3 ? '' : len(dirFull) <= dirRoom ? dirFull : `…${dirFull.slice(-(dirRoom - 1))}`;
        return [
            { text: dir, dim: true },
            { text: name, bold: true },
        ];
    };
    const { rows, maxTop: max } = layout;
    const from = preview.offset;
    const count = layout.countFrom(from);
    const source = hunkOf(preview.rows, from, from + count, preview.wrap ? 0 : preview.left);
    const empty = preview.isGone ? 'The file no longer exists.' : 'The file is empty.';
    const lines = [
        ...frameHead(el, width, color, {
            id: 'preview',
            back: { key: 'preview-back', label: 'Back to the files', press: act.back },
            title,
            right,
            tools: [
                { key: 'preview-wrap', label: 'wrap', active: preview.wrap, press: act.toggleWrap },
                { key: 'preview-tree', label: 'tree', press: act.showInTree },
                { key: 'preview-close', label: '✕', press: act.back },
            ],
        }),
        h(el.Box, { key: "preview:body", flexDirection: "row", height: rows, overflow: "hidden" },
            h(el.Box, { width: width - 1, height: rows, overflow: "hidden" }, source ? h(el.Code, { source: source, path: preview.path, format: "diff", wrap: preview.wrap ? 'wrap' : 'truncate-end' }) : h(el.Text, { dimColor: true }, fit(empty, width - 1))),
            scrollbar(el, rows, { from, max, shown: count, total: preview.rows.length }, color)),
    ];
    if (layout.sliderRow < 0)
        return lines;
    lines.push(slider(el, 'preview', width, color, { left: preview.left, maxLeft: layout.maxLeft, visible: layout.visible, width: preview.width }, act.slide));
    return lines;
}
