import { h, Fragment } from '../../src/jsx.ts'
import { doc } from './context';
import { clean } from './preview';
import { fit, len, wrapText } from './ui';
import { frameHead, scrollbar, slider } from './view-frame';
import { INPUT_RAIL } from './view-turns';
const TONE_COLOR = { user: INPUT_RAIL, assistant: '#c9c9c9', system: '#d8c8f0' };
let cache;
function screen(visible) {
    if (cache && cache.version === doc.version && cache.visible === visible && cache.wrap === doc.wrap)
        return cache;
    const rows = [];
    const starts = [];
    let width = 0;
    for (const l of doc.lines) {
        starts.push(rows.length);
        // I titoli stanno in una riga; le note vanno sempre a capo.
        if (l.tone !== undefined && l.tone !== 'note')
            rows.push(l);
        else if (l.tone === undefined && !doc.wrap) {
            const text = clean(l.text);
            rows.push({ text });
            width = Math.max(width, len(text));
        }
        else
            for (const text of wrapText(clean(l.text), visible))
                rows.push({ text, ...(l.tone ? { tone: l.tone } : {}) });
    }
    cache = { version: doc.version, visible, wrap: doc.wrap, rows, width, starts };
    return cache;
}
export function contextLayout(width, bodyRows) {
    const visible = Math.max(1, width - 1);
    const s = screen(visible);
    const maxLeft = doc.wrap ? 0 : Math.max(0, s.width - visible);
    const rows = Math.max(1, bodyRows - (maxLeft > 0 ? 3 : 2));
    const maxTop = Math.max(0, s.rows.length - rows);
    // Aperta su un blocco: la finestra parte dal suo titolo, una volta sola.
    if (doc.focus !== undefined) {
        doc.offset = Math.min(s.starts[doc.focus] ?? 0, maxTop);
        doc.focus = undefined;
    }
    return { rows, visible, maxTop, maxLeft, sliderRow: maxLeft > 0 ? 2 + rows : -1 };
}
export function contextLines(el, width, layout, color, act) {
    const { rows, visible, maxTop } = layout;
    const s = screen(visible);
    const from = doc.offset;
    const row = (r) => {
        if (r.tone === 'user' || r.tone === 'assistant' || r.tone === 'system') {
            const label = fit(`── ${r.text} `, visible);
            return (h(el.Text, { color: TONE_COLOR[r.tone], bold: true }, label + '─'.repeat(Math.max(0, visible - len(label)))));
        }
        if (r.tone === 'block')
            return (h(el.Text, { dimColor: true, bold: true }, fit(`▸ ${r.text}`, visible)));
        if (r.tone === 'note')
            return (h(el.Text, { dimColor: true, italic: true }, r.text || ' '));
        const text = doc.wrap || doc.left === 0 ? r.text : Array.from(r.text).slice(doc.left).join('');
        return h(el.Text, null, fit(text, visible) || ' ');
    };
    const lines = [
        ...frameHead(el, width, color, {
            id: 'context',
            back: { key: 'context-back', label: 'Back to the sections', press: act.back },
            title: room => [{ text: fit(doc.title, room), bold: true }],
            right: doc.info ? [{ text: doc.info, dim: true }] : [],
            tools: [
                ...(act.rerun ? [{ key: 'context-rerun', label: '↻', press: act.rerun }] : []),
                { key: 'context-wrap', label: 'wrap', active: doc.wrap, press: act.toggleWrap },
                { key: 'context-open', label: '↗', press: act.open },
                { key: 'context-close', label: '✕', press: act.back },
            ],
        }),
        h(el.Box, { key: "context:body", flexDirection: "row", height: rows, overflow: "hidden" },
            h(el.Box, { flexDirection: "column", width: width - 1, height: rows, overflow: "hidden" }, s.rows.slice(from, from + rows).map((r, i) => (h(el.Box, { key: `context:${from + i}`, height: 1, overflow: "hidden" }, row(r))))),
            scrollbar(el, rows, { from, max: maxTop, shown: rows, total: s.rows.length }, color)),
    ];
    if (layout.sliderRow < 0)
        return lines;
    lines.push(slider(el, 'context', width, color, { left: doc.left, maxLeft: layout.maxLeft, visible, width: s.width }, act.slide));
    return lines;
}
