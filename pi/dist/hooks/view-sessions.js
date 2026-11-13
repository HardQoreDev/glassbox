import { h, Fragment } from '../../src/jsx.ts'
// La sezione SESSIONS: una riga per sessione aperta su questa macchina. Questa
// sta in cima, con la barretta ▌ e «this» prima del nome, e resta lì quando la
// sezione scorre. ◐ lavora; ◆ aspetta te, su una domanda o un permesso; ● ha la cache
// calda, con i minuti che le restano (gialli sotto i dieci); ○ l'ha persa,
// rossa se ha tanto contesto da ricaricare; ◌ è stata compattata dopo l'ultima
// richiesta. ◐ anche per chi aspetta i suoi agenti, con quanti sono: la sua
// cache la tiene calda glassbox (keepwarm.ts). Il nome è il titolo del
// terminale in herdr, quando c'è. Un clic
// sul nome porta herdr sul pane della sessione; ▸ in fondo apre sotto la
// cartella, cosa costa tornarci e il comando per riprenderla (fuori da herdr,
// o per questa sessione, lo fa anche il clic sul nome).
import { host } from './host';
import { keep } from './keepwarm';
import { CACHE_TTL_MS, RELOAD_FACTOR, SOON_MS, agentsOf, cacheOf, counts, isHeavy, isWaiting, label, merged, minutes, ordered, refreshedAt, selfSession, sessions, span, tokens } from './sessions';
import { SELECTED_BG, fit, len, wrapText } from './ui';
export const SESSIONS_COLOR = '#22d3ee';
const WARM = '#4ade80';
const SOON = '#f0b429';
const RELOAD = '#f87171';
const BUSY = '#59a4f9';
const WAITING = '#e879f9';
const idle = (s, now) => (s.lastMs === undefined ? '' : span(now - s.lastMs));
const markOf = (c, s) => {
    if (c.kind === 'busy')
        return { text: '◐', color: BUSY };
    if (isWaiting(s))
        return { text: '◆', color: WAITING };
    if (agentsOf(s) > 0)
        return { text: '◐', color: BUSY };
    if (c.kind === 'warm')
        return { text: '●', color: c.leftMs <= SOON_MS ? SOON : WARM };
    if (c.kind === 'cold')
        return isHeavy(s) ? { text: '○', color: RELOAD } : { text: '○', dim: true };
    if (c.kind === 'compacted')
        return { text: '◌', dim: true };
    return { text: '·', dim: true };
};
const stateOf = (c, s, now) => {
    if (c.kind === 'busy')
        return { text: 'working', color: BUSY };
    if (isWaiting(s))
        return { text: c.kind === 'warm' ? `needs you · ${minutes(c.leftMs)}m left` : c.kind === 'cold' && isHeavy(s) ? 'needs you · reload' : 'needs you', color: WAITING };
    const n = agentsOf(s);
    if (n > 0) {
        const agents = `${n} agent${n === 1 ? '' : 's'}`;
        if (c.kind === 'warm')
            return { text: `${agents} · ${minutes(c.leftMs)}m left`, color: BUSY };
        return c.kind === 'cold' && isHeavy(s) ? { text: `${agents} · reload`, color: RELOAD } : { text: agents, color: BUSY };
    }
    if (c.kind === 'warm')
        return { text: `${minutes(c.leftMs)}m left`, color: c.leftMs <= SOON_MS ? SOON : WARM };
    if (c.kind === 'cold')
        return isHeavy(s) ? { text: `reload · idle ${idle(s, now)}`, color: RELOAD } : { text: `cold · idle ${idle(s, now)}`, dim: true };
    if (c.kind === 'compacted')
        return { text: 'compacted', dim: true };
    return { text: 'no data', dim: true };
};
const clock = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// Sotto la sessione scelta: dove lavora, cosa costa tornarci, come riprenderla.
const detailTexts = (s, c, now) => {
    const waits = isWaiting(s) ? ['Waiting for you: a question or a permission.'] : [];
    const cost = c.kind === 'busy'
        ? 'Working now: its cache stays warm while it runs.'
        : c.kind === 'warm'
            ? `Cache warm until ${clock((refreshedAt(s) ?? now) + CACHE_TTL_MS)}, idle ${idle(s, now)}.`
            : c.kind === 'cold' && isHeavy(s)
                ? `The next message rewrites ${tokens(s.ctx)} into the cache: about ${RELOAD_FACTOR} messages at warm cache. If it is done, close it; /clear with a state note costs almost nothing.`
                : c.kind === 'cold'
                    ? `Cache expired, but ${tokens(s.ctx) || 'its context'} reloads cheaply.`
                    : c.kind === 'compacted'
                        ? 'Compacted after its last request: its context is small now.'
                        : 'No request yet.';
    const n = agentsOf(s);
    const agents = n > 0
        ? [`${n} agent${n === 1 ? '' : 's'} working. While they do, Glassbox in that session keeps its cache warm: a minimal request 5 minutes before it expires, which reads the context from the cache (about 1/${RELOAD_FACTOR} of rewriting it).`]
        : [];
    const kept = s.id === sessions.selfId && keep.pings > 0
        ? [`Kept warm ${keep.pings} time${keep.pings === 1 ? '' : 's'}, last at ${clock(keep.lastMs)}: ${tokens(keep.read)} read from the cache${keep.written > 0 ? `, ${tokens(keep.written)} written` : ''}.`]
        : [];
    const failed = s.id === sessions.selfId && keep.error ? [`Last keep-warm failed: ${keep.error}.`] : [];
    const where = [s.title ? s.name : '', s.cwd, s.pane ? `herdr ${s.pane}` : ''].filter(Boolean).join(' · ');
    return [where, ...waits, ...agents, cost, ...kept, ...failed, host.resume(s.id)].filter(Boolean);
};
/** Si può portare herdr lì: gira in herdr, e non è questa. */
export const canJump = (s) => Boolean(s.pane && sessions.herdr && s.id !== sessions.selfId);
// Quante righe in cima alla sezione restano ferme quando scorre: la riga di
// questa sessione, se c'è. La scrive l'ultimo sessionLines.
let pinned = 0;
export const sessionsPinned = () => pinned;
/** Il testo accanto al titolo: quante aperte, quante calde, quante da ricaricare. */
export const sessionsInfo = (now = Date.now()) => {
    if (sessions.error && sessions.list.length === 0)
        return [{ text: 'not read', color: RELOAD }];
    if (sessions.at === 0)
        return [{ text: 'reading…', dim: true }];
    const n = counts(merged(), now);
    return [
        { text: `${n.open} open`, dim: true },
        ...(n.waiting > 0 ? [{ text: ' · ', dim: true }, { text: `${n.waiting} need${n.waiting === 1 ? 's' : ''} you`, color: WAITING }] : []),
        { text: ' · ', dim: true },
        { text: `${n.warm} warm`, color: n.warm > 0 ? WARM : undefined, dim: n.warm === 0 },
        ...(n.reload > 0 ? [{ text: ' · ', dim: true }, { text: `${n.reload} to reload`, color: RELOAD }] : []),
    ];
};
export function sessionLines(width, now, select, jump) {
    pinned = 0;
    if (sessions.error && sessions.list.length === 0)
        return [
            el => h(el.Text, { color: RELOAD }, fit(sessions.error, width)),
            el => h(el.Text, { dimColor: true }, fit('The section needs python3. ↻ tries again.', width)),
        ];
    if (sessions.at === 0)
        return [el => h(el.Text, { dimColor: true }, fit('Reading the sessions…', width))];
    // Questa c'è anche quando il registro non la nomina, dalle sue richieste.
    const known = merged();
    const self = selfSession();
    const list = ordered(self && !known.some(s => s.id === self.id) ? [self, ...known] : known, now);
    if (list.length === 0)
        return [el => h(el.Text, { dimColor: true }, fit('No interactive session is open.', width))];
    if (list[0]?.id === sessions.selfId)
        pinned = 1;
    const rows = list.map(s => {
        const c = cacheOf(s, now);
        return { s, c, mark: markOf(c, s), state: stateOf(c, s, now), size: tokens(s.ctx) };
    });
    // A sinistra la barretta di questa sessione; a destra le colonne, larghe
    // quanto il loro testo più lungo, e in fondo ▸.
    const sizeW = Math.max(...rows.map(r => len(r.size)));
    const stateW = Math.max(...rows.map(r => len(r.state.text)));
    const fixedW = 1 + 2 + (sizeW + 1) + (stateW + 2);
    const lines = [];
    for (const { s, c, mark, state, size } of rows) {
        const isSelf = s.id === sessions.selfId;
        const isSelected = sessions.selected === s.id;
        // «this» va prima del nome: se il nome è lungo, si taglia lui.
        const tag = isSelf ? 'this · ' : '';
        const name = fit(label(s), Math.max(4, width - fixedW - len(tag)));
        const pad = ' '.repeat(Math.max(1, width - fixedW - len(tag) - len(name)));
        const sizeColor = c.kind === 'cold' && isHeavy(s) ? RELOAD : undefined;
        const press = canJump(s) ? () => jump(s) : () => select(s.id);
        lines.push(el => (h(el.Box, { key: `s:${s.id}`, flexDirection: "row", height: 1, overflow: "hidden", backgroundColor: isSelected ? SELECTED_BG : undefined },
            h(el.Text, { color: SESSIONS_COLOR }, isSelf ? '▌' : ' '),
            h(el.Button, { key: `session:${s.id}`, plain: true, label: label(s), onPress: press },
                h(el.Text, { bold: isSelf },
                    h(el.Text, { color: mark.color, dimColor: mark.dim },
                        mark.text,
                        ' '),
                    isSelf
                        ? [
                            h(el.Text, { key: "this", color: SESSIONS_COLOR, bold: true }, "this"),
                            h(el.Text, { key: "dot", dimColor: true }, ' · '),
                        ]
                        : [],
                    name)),
            h(el.Text, null, pad),
            h(el.Text, { color: sizeColor, dimColor: !sizeColor },
                ' '.repeat(sizeW - len(size)),
                size,
                ' '),
            h(el.Text, null, ' '.repeat(stateW - len(state.text))),
            h(el.Text, { color: state.color, dimColor: state.dim }, state.text),
            h(el.Text, null, " "),
            h(el.Button, { key: `session-more:${s.id}`, plain: true, dimColor: !isSelected, label: isSelected ? '▾' : '▸', onPress: () => select(s.id) }))));
        if (!isSelected)
            continue;
        for (const text of detailTexts(s, c, now))
            for (const part of wrapText(text, width - 2))
                lines.push(el => (h(el.Box, { key: `sd:${s.id}:${part}`, flexDirection: "row", height: 1, overflow: "hidden", backgroundColor: SELECTED_BG },
                    h(el.Text, { dimColor: true }, fit(`  ${part}`, width)))));
    }
    return lines;
}
