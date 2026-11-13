import { h, Fragment } from '../../src/jsx.ts'
import { len } from './ui';
export const segsW = (segs) => segs.reduce((w, s) => w + len(s.text), 0);
/** La riga del titolo e quella sottile sotto, del colore della finestra. */
export function frameHead(el, width, color, head) {
    const lead = '▌ ';
    const rightW = segsW(head.right) + head.tools.reduce((w, t) => w + 1 + len(t.label), 0);
    const title = head.title(Math.max(4, width - len(lead) - rightW - 1));
    const pad = ' '.repeat(Math.max(1, width - len(lead) - segsW(title) - rightW));
    return [
        h(el.Box, { key: `${head.id}:head`, flexDirection: "row", height: 1, overflow: "hidden" },
            h(el.Text, { color: color }, lead),
            h(el.Button, { key: head.back.key, plain: true, label: head.back.label, onPress: head.back.press }, title.map(s => (h(el.Text, { color: s.color, dimColor: s.dim, bold: s.bold }, s.text)))),
            h(el.Text, null, pad),
            head.right.map(s => (h(el.Text, { color: s.color, dimColor: s.dim, bold: s.bold }, s.text))),
            head.tools.flatMap(t => [
                h(el.Text, null, " "),
                t.active === undefined ? (h(el.Button, { key: t.key, plain: true, dimColor: true, label: t.label, onPress: t.press })) : (h(el.Button, { key: t.key, plain: true, label: t.label, onPress: t.press },
                    h(el.Text, { color: t.active ? color : undefined, dimColor: !t.active, bold: t.active, underline: t.active }, t.label))),
            ])),
        h(el.Box, { key: `${head.id}:rule`, height: 1, overflow: "hidden" },
            h(el.Text, { color: color, dimColor: true }, '▔'.repeat(width))),
    ];
}
/**
 * La colonna dello scorrimento, alta `rows`: il cursore lungo quanto la parte
 * mostrata (`shown` di `total`), dove arriva `from` di `max`.
 */
export function scrollbar(el, rows, at, color) {
    const thumb = Math.min(rows, Math.max(1, Math.round((rows * at.shown) / Math.max(1, at.total))));
    const thumbAt = at.max === 0 ? 0 : Math.round((at.from / at.max) * (rows - thumb));
    return (h(el.Box, { flexDirection: "column", width: 1, height: rows }, Array.from({ length: rows }, (_, i) => {
        const isThumb = i >= thumbAt && i < thumbAt + thumb;
        return at.max === 0 ? (h(el.Text, null, " ")) : (h(el.Text, { color: isThumb ? color : undefined, dimColor: !isThumb }, isThumb ? '┃' : '│'));
    })));
}
/**
 * Lo slider: ◂ e ▸ spostano di mezza larghezza, un clic sulla barra porta lì
 * il cursore. Ogni cella è un pulsante, perché un clic non dice la colonna.
 */
export function slider(el, id, width, color, at, slide) {
    const { left, maxLeft, visible } = at;
    const track = Math.max(1, width - 4);
    const knob = Math.min(track, Math.max(1, Math.round((track * visible) / Math.max(1, at.width))));
    const span = track - knob;
    const knobAt = span === 0 ? 0 : Math.round((left / maxLeft) * span);
    const leftAt = (i) => (span === 0 ? 0 : Math.round((Math.max(0, Math.min(span, i - Math.floor(knob / 2))) / span) * maxLeft));
    const step = Math.max(1, Math.floor(visible / 2));
    return (h(el.Box, { key: `${id}:slider`, flexDirection: "row", height: 1, overflow: "hidden" },
        h(el.Button, { key: `${id}-left`, plain: true, dimColor: left === 0, label: "\u25C2", onPress: () => slide(left - step) }),
        h(el.Text, null, " "),
        Array.from({ length: track }, (_, i) => {
            const isKnob = i >= knobAt && i < knobAt + knob;
            return (h(el.Button, { key: `${id}-x:${i}`, plain: true, label: `Column ${leftAt(i) + 1}`, onPress: () => slide(leftAt(i)) },
                h(el.Text, { color: isKnob ? color : undefined, dimColor: !isKnob }, isKnob ? '━' : '─')));
        }),
        h(el.Text, null, " "),
        h(el.Button, { key: `${id}-right`, plain: true, dimColor: left >= maxLeft, label: "\u25B8", onPress: () => slide(left + step) })));
}
