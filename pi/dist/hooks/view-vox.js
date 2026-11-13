import { h, Fragment } from '../../src/jsx.ts'
import { host } from './host';
import { fit, len } from './ui';
import { armLeft, effectiveDeep, isReading, isStarting, levelLabel, shownText, sourceWords, vox } from './vox';
import { isArmed } from './vox-clip';
import { cleanForSpeech, countWords, listenTime, wrap } from './vox-text';
export const VOX_COLOR = '#f472b6';
export const VOX_RED = '#f87171';
/** Una parola che si preme: accesa nel colore della sezione, spenta in grigio. */
export const chip = (key, label, isOn, color, press) => ({
    w: len(label),
    draw: el => (h(el.Button, { key: key, plain: true, label: label, onPress: press },
        h(el.Text, { color: isOn ? color : undefined, bold: isOn, dimColor: !isOn }, label))),
});
export const word = (text) => ({ w: len(text), draw: el => h(el.Text, { dimColor: true }, text) });
/** Pezzi che stanno sempre insieme nella stessa riga. */
export const group = (...parts) => ({
    w: parts.reduce((w, p) => w + p.w, 0),
    draw: el => (h(el.Box, { flexDirection: "row", flexShrink: 0 }, parts.map(p => p.draw(el)))),
});
const GAP = 2;
/** I pezzi in righe di `width` colonne: chi non entra passa alla riga sotto. */
export function flowLines(key, width, parts) {
    const rows = [[]];
    let used = 0;
    for (const part of parts) {
        const current = rows.at(-1);
        const need = (current.length > 0 ? GAP : 0) + part.w;
        if (current.length > 0 && used + need > width) {
            rows.push([part]);
            used = part.w;
        }
        else {
            current.push(part);
            used += need;
        }
    }
    return rows.map((row, i) => (el) => (h(el.Box, { key: `${key}:${i}`, flexDirection: "row", height: 1, overflow: "hidden" }, row.flatMap((part, j) => (j === 0 ? [part.draw(el)] : [h(el.Text, null, ' '.repeat(GAP)), part.draw(el)])))));
}
/** Un testo a capo, una riga della sezione per riga di testo. */
export const textLines = (key, text, width, style = {}) => wrap(text, width).map((line, i) => (el) => (h(el.Text, { key: `${key}:${i}`, color: style.color, dimColor: style.dim }, line === '' ? ' ' : line)));
/** ◂ etichetta ▸ e fast | deep, per la prosa e per la sintesi. */
export function rewriteParts(kind, color, a) {
    const isDeep = effectiveDeep(kind);
    return [
        group(chip(`${kind}-less`, '◂', false, color, () => a.level(kind, -1)), word(` ${levelLabel(kind)} `), chip(`${kind}-more`, '▸', false, color, () => a.level(kind, 1))),
        group(chip(`${kind}-fast`, 'fast', !isDeep, color, () => a.deep(kind, false)), word(' | '), chip(`${kind}-deep`, 'deep', isDeep, color, () => a.deep(kind, true))),
        chip(`${kind}-prompt`, 'prompt', false, color, () => a.editPrompt(kind)),
    ];
}
/** Cosa dice la sezione mentre il modello scrive. */
export const writing = (kind) => (effectiveDeep(kind) ? 'The session fork is writing…' : `${host.fast} is writing…`);
// ---- VOX ---------------------------------------------------------------------
// Quante righe in cima alla sezione restano ferme quando scorre: i comandi.
let pinned = 0;
export const voxPinned = () => pinned;
/** Il testo accanto al titolo: `rec` con i suoi secondi, da dove viene il testo, quanto è lungo. */
export function voxInfo(now = Date.now()) {
    const armed = isArmed();
    const rec = armed ? [{ text: `● rec ${armLeft(now)}s`, color: VOX_RED, bold: true }, { text: ' · ', dim: true }] : [];
    if (vox.text.trim() === '')
        return [...rec, { text: armed ? (vox.mode === 'append' ? 'every copy is added' : 'select a text') : 'empty', dim: true }];
    if (isReading('vox'))
        return [...rec, { text: 'reading…', color: VOX_COLOR }];
    if (vox.busy === 'prosa')
        return [...rec, { text: 'writing…', color: VOX_COLOR }];
    const words = countWords(cleanForSpeech(shownText('vox'))) || sourceWords();
    return [...rec, { text: `${vox.source === 'reply' ? 'last reply' : 'copied'} · ${words} words · ${listenTime(words, vox.speed)}`, dim: true }];
}
/** I comandi accanto al titolo. */
export function voxTools(a) {
    const armed = isArmed();
    return [
        { key: 'vox-rec', label: 'rec', active: armed, ...(armed ? { color: VOX_RED } : {}), press: a.arm },
        // Il modo di `rec`: 1 = la copia sostituisce il testo, + = si aggiunge in fondo.
        { key: 'vox-mode', label: vox.mode === 'replace' ? '1' : '+', press: a.toggleMode },
        { key: 'vox-cp', label: 'cp', press: a.reply },
        playTool('vox', a),
        ...(vox.text.trim() !== '' ? [{ key: 'vox-clear', label: '✕', dim: true, press: a.clear }] : []),
    ];
}
/** ▶ legge la sezione; mentre legge è ■, e la ferma. */
export const playTool = (section, a) => {
    const reading = isReading(section);
    return {
        key: `${section}-play`,
        label: reading ? '■' : isStarting(section) ? '…' : '▶',
        active: reading,
        ...(reading ? { color: VOX_RED } : {}),
        press: () => a.play(section),
    };
};
const GUIDE = [
    'rec, then select a text in the terminal: the copy lands here. cp takes Claude\'s last reply.',
    'prose unrolls it into plain spoken prose; SYNTH, below, cuts it to the bone. ▶ reads it aloud.',
];
export function voxLines(width, a) {
    const shown = shownText('vox');
    const speed = ` ${vox.speed.toFixed(1)}× `;
    const bar = flowLines('vox:bar', width, [
        group(chip('vox-view-raw', 'raw', vox.view === 'raw', VOX_COLOR, () => a.show('raw')), word(' | '), chip('vox-view-prosa', 'prose', vox.view === 'prosa', VOX_COLOR, () => a.show('prosa'))),
        ...(vox.view === 'prosa' ? rewriteParts('prosa', VOX_COLOR, a) : []),
        ...(shown.trim() !== '' ? [chip('vox-edit', 'edit', false, VOX_COLOR, () => a.editText(vox.view))] : []),
        group(chip('vox-slower', '−', false, VOX_COLOR, () => a.speed(-0.1)), word(speed), chip('vox-faster', '+', false, VOX_COLOR, () => a.speed(0.1))),
    ]);
    pinned = bar.length;
    const lines = [...bar];
    if (vox.error.vox)
        lines.push(...textLines('vox:error', vox.error.vox, width, { color: VOX_RED }));
    if (shown !== '')
        return [...lines, ...textLines('vox:text', shown, width)];
    if (vox.text.trim() === '') {
        const armed = isArmed();
        const guide = armed
            ? [vox.mode === 'append' ? 'Select the texts one after the other: each copy is added here, and rec stays on.' : 'Select a text: the next copy lands here.']
            : GUIDE;
        for (const [i, text] of guide.entries())
            lines.push(...textLines(`vox:guide:${i}`, text, width, { dim: true }));
        if (vox.setupError && !vox.error.vox)
            lines.push(el => h(el.Text, { dimColor: true }, fit(vox.setupError, width)));
        return lines;
    }
    // In prosa, senza ancora la prosa.
    return [...lines, ...textLines('vox:wait', vox.busy === 'prosa' ? writing('prosa') : 'Press prose again to write it.', width, { dim: true })];
}
