import { h, Fragment } from '../../src/jsx.ts'
import { since } from './branches';
import { repo } from './repo';
import { ACCENT, SELECTED_BG, fit, len } from './ui';
import { emptyLines } from './view-graph';
const AHEAD = '#40b0a6';
const BEHIND = '#ffb000';
const PUSH = '#40b0a6';
const PULL = '#59a4f9';
const GONE = '#f87171';
const REMOTE = '#b180d7';
export const branchView = {
    // Il ref del branch di cui si vedono i dettagli.
    selected: '',
    showMerged: false,
};
const segsW = (segs) => segs.reduce((w, s) => w + len(s.text), 0);
const segEls = (el, segs) => segs.map(s => (h(el.Text, { color: s.color, dimColor: s.dim }, s.text)));
// I commit in più e in meno del principale, ognuno nella sua colonna.
const aheadOf = (b) => {
    if (b.ahead === undefined || b.behind === undefined)
        return undefined;
    if (b.ahead === 0 && b.behind === 0)
        return { text: '=', dim: true };
    return b.ahead > 0 ? { text: `+${b.ahead}`, color: AHEAD } : undefined;
};
const behindOf = (b) => b.behind !== undefined && b.behind > 0 ? { text: `−${b.behind}`, color: BEHIND } : undefined;
// I commit da spingere e da tirare giù, per un branch che segue un remoto.
const arrowsOf = (s) => s.kind !== 'diverged'
    ? []
    : [
        ...(s.ahead > 0 ? [{ text: `↑${s.ahead}`, color: PUSH }] : []),
        ...(s.ahead > 0 && s.behind > 0 ? [{ text: ' ' }] : []),
        ...(s.behind > 0 ? [{ text: `↓${s.behind}`, color: PULL }] : []),
    ];
// Com'è messo sul remoto, in una parola; `last sync` quando si sa da quando.
const stateOf = (b) => {
    const s = b.sync;
    if (s.kind === 'local')
        return { text: 'local', dim: true };
    if (s.kind === 'gone')
        return { text: 'gone', color: GONE };
    if (s.kind === 'remote')
        return { text: 'remote', color: REMOTE };
    if (b.synced)
        return { text: 'last sync', dim: true };
    return s.kind === 'synced' ? { text: 'synced', dim: true } : undefined;
};
// `3m ago`, `just now`.
const agoText = (seconds, now) => {
    const t = since(seconds * 1000, now);
    return t === 'now' ? 'just now' : `${t} ago`;
};
const commits = (n) => `${n} commit${n === 1 ? '' : 's'}`;
const vsText = (b, base) => {
    const { ahead, behind } = b;
    if (ahead === undefined || behind === undefined)
        return '';
    if (ahead === 0 && behind === 0)
        return `same commit as ${base}`;
    if (behind === 0)
        return `${commits(ahead)} ahead of ${base}`;
    if (ahead === 0)
        return `${commits(behind)} behind ${base}`;
    return `${commits(ahead)} ahead of ${base}, ${behind} behind`;
};
const syncText = (b) => {
    const s = b.sync;
    if (s.kind === 'synced')
        return `in sync with ${b.remote}`;
    if (s.kind === 'local')
        return 'not on any remote';
    if (s.kind === 'gone')
        return `${b.remote} was deleted on the remote`;
    if (s.kind === 'remote')
        return `only on the remote, as ${b.remote}`;
    return `${b.remote}: ${[s.ahead > 0 ? `${s.ahead} to push` : '', s.behind > 0 ? `${s.behind} to pull` : ''].filter(Boolean).join(', ')}`;
};
const tilde = (path) => (repo.home && path.startsWith(`${repo.home}/`) ? `~${path.slice(repo.home.length)}` : path);
// Sotto il branch scelto: l'ultimo commit, il confronto con il principale, il
// remoto e il worktree in cui è aperto, se non è questo.
const detailTexts = (b, isTrunk, base, now) => [
    b.subject,
    `${b.short} · ${b.author} · committed ${agoText(b.time, now)}`,
    isTrunk ? `the branches below are compared with ${base}` : vsText(b, base),
    syncText(b),
    b.synced ? `last sync ${agoText(b.synced.time, now)}${b.synced.by ? `, by ${b.synced.by}` : ''}` : '',
    b.worktree !== '' && b.worktree !== repo.top ? `open in ${tilde(b.worktree)}` : '',
].filter(Boolean);
const detailLines = (b, rail, texts, width) => texts.map((text, i) => el => (h(el.Box, { key: `bd:${b.ref}:${i}`, flexDirection: "row", height: 1, overflow: "hidden", backgroundColor: SELECTED_BG },
    h(el.Text, { dimColor: true }, `${rail}${fit(text, Math.max(4, width - len(rail)))}`))));
export function branchLines(width, now, select, toggleMerged) {
    const empty = emptyLines(width);
    if (empty)
        return empty;
    const { trunk, active, merged, baseName } = repo.branches;
    if (!trunk)
        return [el => h(el.Text, { dimColor: true }, fit('No branches.', width))];
    // Le colonne a destra, larghe quanto il loro testo più lungo.
    const rows = [trunk, ...active];
    const aheadW = Math.max(0, ...active.map(b => len(aheadOf(b)?.text ?? '')));
    const behindW = Math.max(0, ...active.map(b => len(behindOf(b)?.text ?? '')));
    const vsW = aheadW + (aheadW > 0 && behindW > 0 ? 1 : 0) + behindW;
    const arrowsW = Math.max(...rows.map(b => segsW(arrowsOf(b.sync))));
    const stateW = Math.max(...rows.map(b => len(stateOf(b)?.text ?? '')));
    const timeOf = (b) => (b.synced ? since(b.synced.time * 1000, now) : '');
    const timeW = Math.max(...rows.map(b => len(timeOf(b))));
    const rightW = (vsW > 0 ? vsW + 2 : 0) + (arrowsW > 0 ? arrowsW + 1 : 0) + stateW + (timeW > 0 ? 1 + timeW : 0);
    const lines = [];
    const row = (b, prefix, rail, isTrunk) => {
        const isSelected = branchView.selected === b.ref;
        const mark = b.isCurrent ? '◎ ' : '';
        const name = fit(b.name, Math.max(4, width - len(prefix) - len(mark) - rightW - 1));
        const pad = ' '.repeat(Math.max(1, width - len(prefix) - len(mark) - len(name) - rightW));
        const ahead = isTrunk ? undefined : aheadOf(b);
        const behind = isTrunk ? undefined : behindOf(b);
        const vs = vsW === 0
            ? []
            : [
                { text: ' '.repeat(aheadW - len(ahead?.text ?? '')) },
                ...(ahead ? [ahead] : []),
                { text: ' '.repeat(vsW - aheadW - len(behind?.text ?? '')) },
                ...(behind ? [behind] : []),
                { text: '  ' },
            ];
        const arrows = arrowsOf(b.sync);
        const state = stateOf(b);
        const time = timeOf(b);
        const right = [
            ...(arrowsW > 0 ? [{ text: ' '.repeat(arrowsW - segsW(arrows)) }, ...arrows, { text: ' ' }] : []),
            ...(state ? [state] : []),
            { text: ' '.repeat(stateW - len(state?.text ?? '')) },
            ...(timeW > 0 ? [{ text: ' '.repeat(1 + timeW - len(time)) }, { text: time, dim: true }] : []),
        ];
        lines.push(el => (h(el.Box, { key: `b:${b.ref}`, flexDirection: "row", height: 1, overflow: "hidden", backgroundColor: isSelected ? SELECTED_BG : undefined },
            h(el.Text, { dimColor: true }, prefix),
            h(el.Button, { key: `branch:${b.ref}`, plain: true, label: b.name, onPress: () => select(b.ref) },
                h(el.Text, { color: b.isCurrent ? ACCENT : undefined, bold: b.isCurrent || isTrunk }, `${mark}${name}`)),
            h(el.Text, null, pad),
            segEls(el, vs),
            segEls(el, right))));
        if (isSelected)
            lines.push(...detailLines(b, rail, detailTexts(b, isTrunk, baseName, now), width));
    };
    row(trunk, '', active.length > 0 ? '│  ' : '   ', true);
    active.forEach((b, i) => {
        const isLast = i === active.length - 1;
        row(b, isLast ? '└─ ' : '├─ ', isLast ? '   ' : '│  ', false);
    });
    if (merged.length > 0) {
        const label = `${branchView.showMerged ? '▾' : '▸'} ${merged.length} merged`;
        lines.push(el => (h(el.Box, { key: "b:merged", flexDirection: "row", height: 1, overflow: "hidden" },
            h(el.Text, null, '   '),
            h(el.Button, { key: "branches-merged", plain: true, label: label, onPress: toggleMerged },
                h(el.Text, { dimColor: true }, label)))));
        if (branchView.showMerged) {
            for (const b of merged) {
                const name = fit(b.name, Math.max(4, width - 5));
                lines.push(el => (h(el.Box, { key: `m:${b.ref}`, flexDirection: "row", height: 1, overflow: "hidden" },
                    h(el.Text, { dimColor: true }, `     ${name}`))));
            }
        }
    }
    return lines;
}
