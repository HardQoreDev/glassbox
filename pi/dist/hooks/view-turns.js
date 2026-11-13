import { h, Fragment } from '../../src/jsx.ts'
import { partAt, partOf, sentMessages } from './context';
import { recordInfo } from './record';
import { TABS, statsOf } from './stats';
import { seenNow, turns } from './turns-state';
import { cell, fit, len, wrapText } from './ui';
import { barCells, contextAfter, fmtTokens, gist, inputStack } from './vendor/turns';
const INK = '#f3eeff';
const STYLE = {
    system: { icon: '⚙', bg: '#2e1f4d', fg: '#d8c8f0' },
    history: { icon: '↺', bg: '#4c3480', fg: INK },
    user: { icon: '❯', bg: '#6d4fc2', fg: INK },
    tool_result: { icon: '⇠', bg: '#6d4fc2', fg: INK },
    thinking: { icon: '✻', bg: '#151515', fg: '#d6d6d6' },
    text: { icon: '¶', bg: '#5e5e5e', fg: INK },
    tool_use: { icon: '⚒', bg: '#5e5e5e', fg: INK },
    truncated: { icon: '✂', bg: '#2b2b2b', fg: '#9a9a9a' },
};
export const INPUT_RAIL = '#a78bfa';
const OUTPUT_RAIL = '#8c8c8c';
const BAR = { system: '#2e1f4d', history: '#5b3fa0', added: '#a78bfa', output: '#9a9a9a', free: '#3a3a3a' };
// Le voci della legenda: il pezzo del contesto che aprono e il loro colore.
const LEGEND = [
    ['system', BAR.system],
    ['earlier', BAR.history],
    ['new', BAR.added],
    ['output', BAR.output],
];
const LEVEL = { warn: { mark: '! ', color: '#ffb000' }, info: { mark: '· ', color: '#59a4f9' }, good: { mark: '✓ ', color: '#4ade80' } };
// La colonna dei nomi nella tendina, e fin dove si allarga per le barre.
const LABEL_W = 12;
const NAME_MAX = 18;
// Le fette del contesto nella vista fill: il nome e il colore.
const SLICE = {
    preloaded: { name: 'preloaded', color: '#7c6aa8' },
    results: { name: 'tool results', color: '#a78bfa' },
    calls: { name: 'tool calls', color: '#5eead4' },
    replies: { name: 'replies', color: '#c9c9c9' },
    thinking: { name: 'thinking', color: '#8a8f98' },
    prompts: { name: 'your prompts', color: '#f0abfc' },
    reminders: { name: 'reminders', color: '#59a4f9' },
};
const NOTHING_YET = 'Nothing yet: the numbers come after the first answer.';
const KIND_ICON = { results: '⇠', calls: '⚒', replies: '¶', thinking: '✻', prompts: '❯', reminders: '⚑' };
/** Il testo accanto al titolo: quanto contesto è in uso, e la percentuale. */
export const turnsInfo = () => {
    const window = turns.ledger.window;
    const lastDone = [...turns.ledger.turns].reverse().find(t => t.input !== undefined);
    const used = lastDone ? contextAfter(lastDone) : undefined;
    const pct = used !== undefined && window ? Math.round((used / window) * 100) : undefined;
    return [
        { text: `${fmtTokens(used)} / ${fmtTokens(window)}`, dim: true },
        ...(pct !== undefined ? [{ text: ` ${pct}%`, color: pct > 80 ? 'red' : pct > 60 ? 'yellow' : 'green' }] : []),
    ];
};
const bytesText = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
/** La tendina: le viste in cima, poi i numeri, le barre e i consigli della vista scelta. */
export function statsLines(width, act) {
    const s = statsOf(turns.ledger, turns.calls, turns.breakdown, seenNow());
    // Il registro su disco, in fondo al giro delle richieste.
    const recorded = recordInfo();
    if (recorded)
        s.rows.flow.push({ label: 'recorded', value: `${recorded.requests} request${recorded.requests === 1 ? '' : 's'} · ${bytesText(recorded.bytes)} on disk` });
    const tab = turns.statsTab;
    const lines = [];
    const title = (text) => el => (h(el.Text, { color: INPUT_RAIL, bold: true }, fit(text, width)));
    const note = (text) => wrapText(text, Math.max(8, width)).forEach(t => lines.push(el => h(el.Text, { dimColor: true, italic: true }, t)));
    // Le viste, con un punto dove c'è un avviso.
    const warned = new Set(s.tips.filter(t => t.level === 'warn').map(t => t.tab));
    lines.push(el => (h(el.Box, { key: "stats:tabs", flexDirection: "row", height: 1, overflow: "hidden" }, TABS.flatMap((id, i) => [
        ...(i ? [h(el.Text, null, '  ')] : []),
        h(el.Button, { key: `stats-tab:${id}`, plain: true, label: `stats: ${id}`, onPress: () => act.pick(id) },
            h(el.Text, { color: id === tab ? INPUT_RAIL : undefined, bold: id === tab, underline: id === tab, dimColor: id !== tab }, id)),
        ...(warned.has(id) ? [h(el.Text, { color: LEVEL.warn.color }, "\u2022")] : []),
    ]))));
    const statRows = (list) => {
        for (const r of list) {
            const value = fit(r.value, Math.max(4, width - LABEL_W));
            lines.push(el => (h(el.Box, { key: `s:${r.label}`, flexDirection: "row", height: 1, overflow: "hidden" },
                h(el.Text, { dimColor: true }, cell(r.label, LABEL_W)),
                h(el.Text, { color: r.level && r.level !== 'good' ? LEVEL[r.level].color : undefined }, value))));
        }
    };
    // Una riga per voce: il nome, una barra lunga quanto pesa, il valore. La
    // colonna dei nomi si allarga fin dove serve, entro un limite.
    const shares = (list, of, value, size, color) => {
        const nameW = Math.max(LABEL_W, Math.min(NAME_MAX, Math.max(...list.map(x => len(x.name))) + 1));
        const barW = Math.max(4, Math.min(16, width - nameW - 14));
        for (const x of list) {
            const filled = of > 0 ? Math.max(1, Math.round((size(x) / of) * barW)) : 0;
            const text = fit(` ${value(x)}`, Math.max(4, width - nameW - barW));
            lines.push(el => (h(el.Box, { key: `s:${x.name}`, flexDirection: "row", height: 1, overflow: "hidden" },
                h(el.Text, null, `${cell(x.name, nameW - 1)} `),
                h(el.Text, { color: color }, '█'.repeat(Math.min(barW, filled))),
                h(el.Text, { color: BAR.free }, '░'.repeat(Math.max(0, barW - filled))),
                h(el.Text, { dimColor: true }, text))));
        }
    };
    const tipLines = (list) => {
        for (const tip of list) {
            const { mark, color } = LEVEL[tip.level];
            wrapText(tip.text, Math.max(8, width - 2)).forEach((text, i) => {
                lines.push(el => (h(el.Box, { flexDirection: "row", height: 1, overflow: "hidden" },
                    h(el.Text, { color: color }, i === 0 ? mark : '  '),
                    h(el.Text, null, text))));
            });
        }
    };
    const own = s.tips.filter(t => t.tab === tab);
    const ownTips = () => {
        if (own.length === 0)
            return;
        lines.push(title('tips'));
        tipLines(own);
    };
    if (tab === 'health') {
        statRows(s.rows.health);
        lines.push(title('tips'));
        // Tutti i consigli, prima gli avvisi.
        const order = { warn: 0, info: 1, good: 2 };
        tipLines([...s.tips].sort((a, b) => order[a.level] - order[b.level]));
    }
    else if (tab === 'fill') {
        const f = s.fill;
        if (!f)
            note('What fills the context shows once Glassbox has seen a request go out: it reads the messages as they are sent.');
        else {
            const approx = f.isScaled ? '' : '~';
            lines.push(title(`what fills #${f.n} · ${approx}${fmtTokens(Math.round(f.total))}`));
            // Le fette in una barra sola, poi una riga ciascuna con il suo colore.
            const cells = barCells(f.slices.map(x => x.tokens), f.total, width);
            lines.push(el => (h(el.Text, null, f.slices.map((x, i) => (h(el.Text, { color: SLICE[x.kind].color }, '█'.repeat(cells[i] ?? 0)))))));
            for (const x of f.slices) {
                const { name, color } = SLICE[x.kind];
                const part = (x.tokens / Math.max(1, f.total)) * 100;
                const share = (part > 0 && part < 1 ? '<1%' : `${Math.round(part)}%`).padStart(4);
                const tokens = `${x.kind === 'preloaded' ? '' : '~'}${fmtTokens(Math.round(x.tokens))}`;
                lines.push(el => (h(el.Box, { key: `s:slice:${x.kind}`, flexDirection: "row", height: 1, overflow: "hidden" },
                    h(el.Text, { color: color }, '■ '),
                    h(el.Text, null, cell(name, LABEL_W)),
                    h(el.Text, null, share),
                    h(el.Text, { dimColor: true }, fit(`  ${tokens}`, Math.max(4, width - LABEL_W - 6))))));
            }
            if (f.heaviest.length > 0) {
                lines.push(title('heaviest · click to open'));
                const right = (x) => `${fmtTokens(Math.round(x.tokens))}${x.since !== undefined ? ` #${x.since}` : ''}`;
                const rightW = Math.max(...f.heaviest.map(x => len(right(x))));
                f.heaviest.forEach((x, i) => {
                    const labelW = Math.max(4, width - rightW - 4);
                    const label = cell(`${KIND_ICON[x.kind]} ${x.label}`, labelW);
                    lines.push(el => (h(el.Box, { key: `s:heavy:${i}`, flexDirection: "row", height: 1, overflow: "hidden" },
                        h(el.Button, { key: `stats-heavy:${i}`, plain: true, label: `Open ${x.label} in #${f.n}`, onPress: () => act.open(f.n, { message: x.message, block: x.block }) },
                            h(el.Text, { color: SLICE[x.kind].color }, label)),
                        h(el.Text, { dimColor: true }, `  ${cell(right(x), rightW, 'right')}`))));
                });
            }
        }
        statRows(s.rows.fill);
        if (s.categories.length > 0) {
            lines.push(title('by category · as /context counts it'));
            const window = turns.breakdown?.rawMaxTokens ?? turns.ledger.window ?? 0;
            shares(s.categories, window, x => fmtTokens(x.tokens), x => x.tokens, BAR.history);
        }
        ownTips();
    }
    else if (tab === 'waste') {
        if (s.rows.waste.length === 0)
            note('What could go shows once Glassbox has seen a request go out: old, repeated and failed tool results, tools and skills loaded and never used.');
        statRows(s.rows.waste);
        ownTips();
    }
    else if (tab === 'flow') {
        if (s.rows.flow.length === 0)
            note(NOTHING_YET);
        statRows(s.rows.flow);
        ownTips();
    }
    else {
        if (s.rows.tools.length === 0 && s.tools.length === 0)
            note(NOTHING_YET);
        statRows(s.rows.tools);
        if (s.tools.length > 0) {
            lines.push(title('most used · calls · results in context'));
            const most = Math.max(...s.tools.map(x => x.count ?? 0));
            shares(s.tools, most, x => `${x.count}${x.failed ? ` (${x.failed}✗)` : ''}${x.tokens > 0 ? ` · ${fmtTokens(x.tokens)}` : ''}${x.tokens > 0 && x.results ? ` · ${fmtTokens(Math.round(x.tokens / x.results))} each` : ''}`, x => x.count ?? 0, BAR.added);
        }
        ownTips();
    }
    lines.push(el => h(el.Text, { color: INPUT_RAIL, dimColor: true }, '─'.repeat(width)));
    return lines;
}
export function turnLines(width, act) {
    const { toggle, show } = act;
    const l = turns.ledger;
    const window = l.window;
    /** Le celle di una barra: system, turni prima, input nuovo, output, poi libero. */
    const bar = (t, w) => {
        if (!t || !window || t.input === undefined)
            return [{ text: '░'.repeat(w), color: BAR.free }];
        const stack = inputStack(l, t);
        const sum = (kinds) => stack.filter(b => kinds.includes(b.kind)).reduce((s, b) => s + b.tokens, 0);
        const cells = barCells([sum(['system']), sum(['history']), sum(['user', 'tool_result']), t.output ?? 0], window, w);
        const free = Math.max(0, w - cells.reduce((s, c) => s + c, 0));
        const colors = [BAR.system, BAR.history, BAR.added, BAR.output];
        return [...cells.map((c, i) => ({ text: '█'.repeat(c), color: colors[i] ?? BAR.free })), { text: '░'.repeat(free), color: BAR.free }];
    };
    const lastDone = [...l.turns].reverse().find(t => t.input !== undefined);
    const legendW = LEGEND.reduce((w, [part], i) => w + (i ? 2 : 0) + 2 + len(part), 0);
    const which = lastDone ? `#${lastDone.n}` : '';
    const lines = [
        ...(turns.showStats
            ? statsLines(width, {
                pick: act.pick,
                open: (n, at) => {
                    const t = l.turns.find(x => x.n === n);
                    const messages = sentMessages(n);
                    if (t && messages)
                        show(t, partAt(messages, at.message), at);
                },
            })
            : []),
        el => (h(el.Text, null, bar(lastDone, width).map(s => (h(el.Text, { color: s.color }, s.text))))),
        // Le voci aprono quello che entra nel contesto della richiesta della barra.
        el => (h(el.Box, { key: "legend", flexDirection: "row", height: 1, overflow: "hidden" },
            LEGEND.flatMap(([part, color], i) => [
                h(el.Text, { color: color }, `${i ? '  ' : ''}■ `),
                lastDone ? (h(el.Button, { key: `context:${part}`, plain: true, label: `${part} of #${lastDone.n}`, onPress: () => show(lastDone, part) },
                    h(el.Text, { dimColor: true }, part))) : (h(el.Text, { dimColor: true }, part)),
            ]),
            h(el.Text, { dimColor: true }, `${' '.repeat(Math.max(1, width - legendW - len(which)))}${which}`))),
    ];
    if (l.turns.length === 0) {
        lines.push(el => h(el.Text, { dimColor: true }, fit('No turns yet: send a prompt.', width)));
        return lines;
    }
    // Un blocco del turno: un clic apre il suo pezzo del contesto.
    const chip = (t, b, key, w, rail) => {
        const s = STYLE[b.kind];
        const tok = b.kind === 'truncated' ? '' : `${b.isEstimate ? '~' : ''}${fmtTokens(b.tokens)}`;
        const labelW = Math.max(4, w - tok.length - 5);
        const text = cell(` ${s.icon} ${cell(b.label, labelW)} ${tok} `, w);
        return el => (h(el.Box, { key: `${key}:row`, flexDirection: "row", height: 1, overflow: "hidden" },
            h(el.Text, { color: rail }, '  ┃ '),
            h(el.Button, { key: key, plain: true, label: `${b.label} of #${t.n}`, onPress: () => show(t, partOf(b.kind)) },
                h(el.Text, { backgroundColor: s.bg, color: b.isError ? '#ff8f80' : s.fg, italic: b.kind === 'truncated' }, text))));
    };
    const title = (text, rail) => el => (h(el.Text, null,
        h(el.Text, { color: rail }, '  ┃ '),
        h(el.Text, { color: rail, bold: true }, fit(text, width - 4))));
    let prompt;
    for (const t of l.turns) {
        if (t.step === 0 || t.prompt !== prompt) {
            prompt = t.prompt;
            const text = fit(`❯ ${t.prompt ? t.prompt.replace(/\s+/g, ' ') : '(continuation)'}`, width);
            lines.push(el => (h(el.Text, { color: INPUT_RAIL, bold: true }, text)));
        }
        const isOpen = turns.expanded.has(t.n);
        const after = contextAfter(t);
        const right = (after !== undefined ? fmtTokens(after) : '…').padStart(6);
        const barW = Math.max(6, Math.min(16, Math.floor(width / 4)));
        const labelW = Math.max(6, width - barW - 10);
        // Il riempimento sta fuori dal pulsante, che il motore inverte per intero.
        const label = fit(`#${t.n} ${gist(t)}`, labelW);
        const fill = cell('', labelW - len(label));
        const mark = t.status === 'failed' ? '✗' : isOpen ? '▾' : '▸';
        const markColor = t.status === 'failed' ? 'red' : t === turns.live ? 'yellow' : INPUT_RAIL;
        lines.push(el => (h(el.Box, { key: `t:${t.n}`, flexDirection: "row", height: 1, overflow: "hidden" },
            h(el.Text, { color: markColor }, `${mark} `),
            h(el.Button, { key: `turn:${t.n}`, plain: true, dimColor: !isOpen && t !== turns.live, label: label, onPress: () => toggle(t.n) }),
            h(el.Text, null, `${fill} `),
            h(el.Text, null, bar(t, barW).map(s => (h(el.Text, { color: s.color }, s.text)))),
            h(el.Text, { color: "#c9c9c9" }, ` ${right}`))));
        if (!isOpen)
            continue;
        const w = width - 4;
        const cached = t.cacheRead ? ` · ${fmtTokens(t.cacheRead)} cached` : '';
        lines.push(title(t.input !== undefined ? `INPUT  ${fmtTokens(t.input)}${cached}` : 'INPUT  sending…', INPUT_RAIL));
        inputStack(l, t).forEach((b, i) => lines.push(chip(t, b, `chip:${t.n}:in:${i}`, w, INPUT_RAIL)));
        lines.push(title(t.status === 'streaming' ? 'OUTPUT  streaming…' : t.output !== undefined ? `OUTPUT  +${fmtTokens(t.output)}` : 'OUTPUT  none', OUTPUT_RAIL));
        t.answer.forEach((b, i) => lines.push(chip(t, b, `chip:${t.n}:out:${i}`, w, OUTPUT_RAIL)));
        const meta = [t.model, t.stopReason ?? '', t.isCompacted ? 'compacted before this turn' : ''].filter(Boolean).join(' · ');
        if (meta)
            lines.push(el => h(el.Text, { dimColor: true }, fit(`    ${meta}`, width)));
    }
    return lines;
}
