import { h, Fragment } from '../../src/jsx.ts'
import { len } from './ui';
const LOGO = ['█▀▀ █   ▄▀█ █▀ █▀ █▄▄ █▀█ ▀▄▀', '█▄█ █▄▄ █▀█ ▄█ ▄█ █▄█ █▄█ █ █'];
const MOTTO = 'see inside the agent';
// Verde acqua, azzurro, viola.
const STOPS = [
    [0x5e, 0xea, 0xd4],
    [0x59, 0xa4, 0xf9],
    [0xa7, 0x8b, 0xfa],
];
// La riga di sotto ha questa parte della luce di quella di sopra.
const LOWER = 0.78;
// A sinistra come il nome delle sezioni, dopo la loro barretta.
const LEFT = '  ';
const hex = (c) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** Il colore al punto `t` (da 0 a 1) della sfumatura, con `light` della sua luce. */
export function shade(t, light = 1) {
    const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(x));
    const a = STOPS[i];
    const b = STOPS[i + 1];
    return hex(a.map((v, k) => (v + (b[k] - v) * (x - i)) * light));
}
// Una riga di testo colonna per colonna lungo la sfumatura; gli spazi restano spazi.
const gradient = (el, text, light) => {
    const chars = Array.from(text);
    return chars.map((ch, i) => (ch === ' ' ? h(el.Text, null, " ") : h(el.Text, { color: shade(i / Math.max(1, chars.length - 1), light) }, ch)));
};
/** Le righe del titolo, l'ultima vuota a staccarlo dalle sezioni. */
export function titleLines(el, width, version) {
    const tag = version ? `v${version}` : '';
    const logoW = len(LEFT) + len(LOGO[0]);
    const row = (key, left, leftW, right, italic) => (h(el.Box, { key: key, flexDirection: "row", height: 1, overflow: "hidden" },
        h(el.Text, null, LEFT),
        left,
        right && width - leftW - len(right) >= 2 ? (h(el.Text, { dimColor: true, italic: italic }, `${' '.repeat(width - leftW - len(right))}${right}`)) : (h(el.Text, null, " "))));
    const blank = (h(el.Box, { key: "title:gap", height: 1 },
        h(el.Text, null, " ")));
    if (width < logoW + 1) {
        const word = 'G L A S S B O X';
        return [row('title:0', gradient(el, word, 1), len(LEFT) + len(word), tag, false), blank];
    }
    return [
        row('title:0', gradient(el, LOGO[0], 1), logoW, tag, false),
        row('title:1', gradient(el, LOGO[1], LOWER), logoW, MOTTO, true),
        blank,
    ];
}
