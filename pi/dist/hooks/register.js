import { h, Fragment } from '../../src/jsx.ts'
import { analysis, openAnalysis, runAnalysis } from './analysis';
import { closeContext, doc, openContext, writeDoc } from './context';
import { FLASH_MS, readText, refreshDirs, reveal, toggleDir, touch, tree, visibleRows } from './files';
import { openFile } from './open';
import { closePreview, openPreview, preview, refreshPreview } from './preview';
import { checkRemoteTags, refreshRepo, remoteTags, repo } from './repo';
import { hooks, loadHooks, toggleHook } from './settings-hooks';
import { shellWrites, snapshot } from './shell-writes';
import { configureRecord, recordInfo, setRecordVersion } from './record';
import { EVERY_MS as SESSIONS_EVERY_MS, focusSession, label, refreshSessions, resetOwn, sessions, tick } from './sessions';
import { contestedPaths, refreshGuard } from './guard';
import { host } from './host';
import { keepWarm } from './keepwarm';
import { statsOf, statsText } from './stats';
import { record } from './touched';
import { lastDone, registerTurns, seenNow, startTurns, toolDone, turns } from './turns-state';
import { fit, len, redraw } from './ui';
import { join } from './vendor/filetree';
import { fileLines, filesInfo, touchedInfo, touchedLines } from './view-files';
import { GUARD_COLOR, contestedCount, guardInfo, guardLines } from './view-guard';
import { branchLines, branchView } from './view-branches';
import { graph, graphInfo, graphLines } from './view-graph';
import { fixedHooks, hookLines, hookView, hooksInfo } from './view-hooks';
import { contextLayout, contextLines } from './view-context';
import { previewLayout, previewLines } from './view-preview';
import { SESSIONS_COLOR, sessionLines, sessionsInfo, sessionsPinned } from './view-sessions';
import { tagLines, tagView, tagsInfo } from './view-tags';
import { titleLines } from './view-title';
import { INPUT_RAIL, turnLines, turnsInfo } from './view-turns';
import { startVox, stopVox, vox, voxActions } from './vox';
import { SYNTH_COLOR, synthInfo, synthLines, synthPinned, synthTools } from './view-synth';
import { VOX_COLOR, voxInfo, voxLines, voxPinned, voxTools } from './view-vox';
import { voxEditLines } from './view-vox-edit';
const PANE = 'glassbox';
const TITLE = 'Glassbox';
const COMMAND = 'glassbox';
// La larghezza chiesta per il pannello agganciato a destra; trascinarlo vince.
const COLUMNS = 64;
// Ogni quanto si rilegge il repo, per i cambi fatti fuori da questa sessione.
const EVERY_MS = 10_000;
// La sezione degli hook è alta quanto le sue righe, fino a questo massimo.
const HOOK_ROWS = 18;
// Il rientro delle righe sotto il titolo, a destra della barretta.
const INDENT = '  ';
// Le righe che un tic della rotella scorre nell'anteprima di un file, e le
// colonne con il puntatore sopra lo slider.
const PREVIEW_WHEEL = 3;
const SLIDER_WHEEL = 4;
const FILES_COLOR = '#f0b429';
// Sotto queste righe il titolo lascia il posto alle sezioni.
const TITLE_MIN_ROWS = 20;
// Ogni sezione ha il suo colore: la barretta, il titolo, la riga sotto, lo scorrimento.
const ALL_SECTIONS = [
    { id: 'hooks', title: 'HOOKS', color: '#4ade80' },
    { id: 'graph', title: 'GIT', color: '#59a4f9' },
    { id: 'files', title: 'FILES', color: FILES_COLOR },
    { id: 'turns', title: 'CONTEXT', color: INPUT_RAIL },
    { id: 'sessions', title: 'SESSIONS', color: SESSIONS_COLOR },
    { id: 'vox', title: 'VOX', color: VOX_COLOR },
    { id: 'synth', title: 'SYNTH', color: SYNTH_COLOR },
];
// VOX e SYNTH prendono solo le righe del loro testo, fino alla loro parte; il
// resto va alle altre sezioni.
const COMPACT = new Set(['vox', 'synth']);
// Le sezioni che l'agente in cui gira Glassbox ha davvero (vedi host.ts).
let SECTIONS = ALL_SECTIONS;
// Quali sezioni sono aperte, e da che riga parte ciascuna. VOX e SYNTH si
// aprono dal titolo, o da sole al primo dei loro comandi.
const isOpen = { hooks: true, graph: true, files: true, turns: true, sessions: true, vox: false, synth: false };
const offset = { hooks: 0, graph: 0, files: 0, turns: 0, sessions: 0, vox: 0, synth: 0 };
// Le righe del corpo che ogni sezione occupava all'ultimo disegno: la rotella
// scorre quella sotto il puntatore.
let spans = [];
let filesView = 'touched';
// La vista di GIT: i branch attivi appesi al principale, ogni commit, o i tag.
let graphView = 'active';
// Come era disposta l'anteprima di un file all'ultimo disegno: fin dove
// scorre, e in che riga è lo slider.
let previewAt;
// La versione del mod, dal suo plugin.json, per il titolo.
let version = '';
// Lo stesso per la finestra di un pezzo del contesto.
let contextAt;
const READS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'LS']);
const WRITES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
async function refreshAll($) {
    const hooksChanged = host.hidden.includes('hooks') ? false : await loadHooks($);
    const repoChanged = await refreshRepo($);
    const dirsChanged = await refreshDirs($);
    const previewChanged = await refreshPreview($);
    if (hooksChanged || repoChanged || dirsChanged || previewChanged)
        redraw($);
}
// Il file su cui lavora uno strumento, assoluto; undefined se non ne nomina uno.
async function pathOf($, e) {
    const input = e;
    const path = [input.file_path, input.notebook_path, input.path].find((p) => typeof p === 'string');
    if (path === undefined)
        return undefined;
    return path.startsWith('/') ? path : join(await $.session.cwd(), path);
}
// Fuori dal giro dello strumento, così il suo esito arriva subito al modello
// e un errore qui non lo tocca. `before` è il file prima di una scrittura,
// `shell` i file che un comando ha cambiato.
async function showActivity($, e, isOk, before, shell = []) {
    try {
        const tone = WRITES.has(e.tool) ? 'orange' : READS.has(e.tool) ? 'purple' : undefined;
        const path = await pathOf($, e);
        const lit = tone && path ? [[path, tone]] : [];
        const written = [];
        if (tone === 'orange' && path && isOk && before !== undefined) {
            const after = await readText($, path);
            if (after !== null && after !== before)
                record(path, before, after, Date.now());
            written.push(path);
        }
        for (const w of shell) {
            record(w.path, w.before, w.after, Date.now());
            written.push(w.path);
            lit.push([w.path, 'orange']);
        }
        // L'anteprima aperta su un file scritto si aggiorna subito, senza aspettare git.
        if (written.includes(preview.path) && (await refreshPreview($)))
            redraw($);
        // Una scrittura di questa sessione può aver toccato un file di un'altra.
        if (written.length > 0)
            void refreshGuardView($);
        let isLit = false;
        for (const [p, t] of lit)
            isLit = (await touch($, p, t)) || isLit;
        if (isLit) {
            redraw($);
            $.clock.after(FLASH_MS + 100, () => redraw($));
        }
        if (tone === 'orange' || e.tool === 'Bash')
            await refreshAll($);
        // Dopo un push si rilegge cosa c'è sul remoto, se i tag si sono già guardati.
        const command = e.command;
        if (e.tool === 'Bash' && typeof command === 'string' && /\bgit\b[^\n]*\bpush\b/.test(command) && remoteTags.at > 0)
            await recheckTags($);
    }
    catch (err) {
        $.ui.log(`glassbox: activity not shown: ${err}`);
    }
}
// Chiede al remoto i suoi tag e ridisegna: prima, mentre aspetta, e quando risponde.
async function recheckTags($) {
    const asking = checkRemoteTags($, Date.now());
    redraw($);
    if (await asking)
        redraw($);
}
/** Divide `room` righe tra `n` sezioni aperte; il resto va alle prime. */
const share = (room, n) => Array.from({ length: n }, (_, i) => Math.floor(room / n) + (i < room % n ? 1 : 0));
const clamp = (v, max) => Math.max(0, Math.min(max, v));
// Le sessioni si rileggono, poi gli avvisi, il pannello, la cache da tenere
// calda se gli agenti di questa sessione lavorano, e la guardia.
async function refreshSessionsView($, fresh = false) {
    await refreshSessions($, fresh);
    tick($);
    redraw($);
    if (await keepWarm($))
        redraw($);
    await refreshGuardView($);
}
// La guardia guarda i file scritti da questa sessione e dalle altre; un file
// conteso da poco arriva anche come avviso, una volta sola.
async function refreshGuardView($) {
    try {
        const { text, isChanged } = await refreshGuard($);
        if (text)
            $.ui.toast(text);
        if (isChanged)
            redraw($);
    }
    catch (err) {
        $.ui.log(`glassbox: guard not refreshed: ${err}`);
    }
}
// herdr si sposta sul pane della sessione; qui resta solo un errore, se c'è.
const jumpTo = ($, s) => void focusSession($, s).then(err => {
    if (err)
        $.ui.toast(`${label(s)}: not opened in herdr: ${err}`);
});
export const register = (on, options) => {
    SECTIONS = ALL_SECTIONS.filter(s => !host.hidden.includes(s.id));
    configureRecord(options);
    registerTurns(on);
    on('session.start', async ($, e, next) => {
        const started = await next(e);
        await startTurns($);
        version = await $.fs
            .read(`${$.plugin.root}/.claude-plugin/plugin.json`)
            .then(text => String(JSON.parse(text).version ?? ''))
            .catch(() => '');
        setRecordVersion(version);
        // VOX e SYNTH: i prompt salvati e dov'è la voce.
        await startVox($, section => {
            isOpen[section] = true;
        }).catch(err => $.ui.log(`glassbox: vox not started: ${err}`));
        await $.command
            .register({
            name: COMMAND,
            description: 'Opens Glassbox on the right: hooks, git, files, what goes into the context and the open sessions (close)',
            argumentHint: '[close]',
        })
            .catch(err => $.ui.log(`glassbox: /${COMMAND} not registered: ${err}`));
        // La sessione parte subito; il pannello si riempie quando git ha risposto.
        // Trasparente: sotto la barra resta il fondo del terminale.
        void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS, backgroundColor: 'transparent' }).catch(() => undefined);
        void refreshAll($);
        $.clock.every(EVERY_MS, () => void refreshAll($));
        // Le sessioni ogni minuto, anche a pannello chiuso: gli avvisi sulle cache
        // in scadenza non devono aspettare che lo si apra.
        // Dopo un /clear questa è un'altra sessione: le sue richieste ripartono da zero.
        resetOwn();
        // La riga sotto il prompt che una versione precedente teneva: il countdown
        // della cache ora sta nella status line dell'utente, fuori da Glassbox.
        $.ui.status(undefined);
        void refreshSessionsView($);
        $.clock.every(SESSIONS_EVERY_MS, () => void refreshSessionsView($));
        return started;
    });
    on('command.run', { command: COMMAND }, async ($, e) => {
        const arg = e.args.trim().toLowerCase();
        if (arg === 'close') {
            await stopVox($).catch(() => undefined);
            await $.ui.close({ id: PANE }).catch(() => undefined);
            return { text: `Glassbox closed: /${COMMAND} reopens it.` };
        }
        await refreshAll($);
        await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS, backgroundColor: 'transparent' });
        const hint = e.presentation.isFullscreen ? '' : ' It is above the prompt for now: /tui fullscreen docks it on the right.';
        const recorded = recordInfo();
        const where = recorded ? ` This session is recorded in ${recorded.dir}.` : '';
        return { text: `Glassbox opened.${hint}${where}` };
    });
    // I file che Claude legge (viola) o scrive (arancio) si accendono; di quelli
    // che scrive si contano le righe, leggendoli prima e dopo. Un comando non
    // dice cosa scrive: si guarda git prima e dopo, e il dopo si legge qui
    // dentro, prima che parta lo strumento seguente. Dopo una scrittura o un
    // comando si rilegge il repo. La risposta va anche ai turni.
    on('tool.call', async ($, e, next) => {
        const path = WRITES.has(e.tool) ? await pathOf($, e).catch(() => undefined) : undefined;
        const before = path ? await readText($, path) : undefined;
        const shot = e.tool === 'Bash' ? await snapshot($).catch(() => undefined) : undefined;
        const ran = await next(e);
        const shell = shot ? await shellWrites($, shot).catch(() => []) : [];
        toolDone(e, ran);
        void showActivity($, e, ran.deny === undefined && ran.isError !== true, before, shell);
        return ran;
    }).catch(($, e, next) => next(e));
    on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
        // Nell'editor di VOX e SYNTH scorre il campo, non il pannello.
        if (vox.edit)
            return {};
        if (doc.isOpen) {
            if (contextAt && e.pointer?.row === contextAt.sliderRow)
                doc.left = clamp(doc.left + e.by * SLIDER_WHEEL, contextAt.maxLeft);
            else
                doc.offset = clamp(doc.offset + e.by * (e.pointer ? PREVIEW_WHEEL : 1), contextAt?.maxTop ?? 0);
            redraw($);
            return {};
        }
        if (preview.path) {
            if (previewAt && e.pointer?.row === previewAt.sliderRow)
                preview.left = clamp(preview.left + e.by * SLIDER_WHEEL, previewAt.maxLeft);
            else
                preview.offset = clamp(preview.offset + e.by * (e.pointer ? PREVIEW_WHEEL : 1), previewAt?.maxTop ?? 0);
            redraw($);
            return {};
        }
        const row = e.pointer?.row;
        const span = (row === undefined ? undefined : spans.find(s => row >= s.from && row < s.to)) ??
            spans.find(s => s.id === 'files') ??
            spans[0];
        if (!span)
            return {};
        offset[span.id] = clamp(offset[span.id] + e.by, span.max);
        if (span.id === 'turns')
            turns.follow = offset.turns >= span.max;
        redraw($);
        return {};
    });
    on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
        if (e.surface !== 'terminal' && e.surface !== 'desktop')
            return next(e);
        const el = $.ui.resolve(e);
        const { Box, Button, Text } = el;
        const width = Math.max(24, e.props.bodyColumns);
        // Il rientro a sinistra, una colonna a destra per lo scorrimento.
        const inner = width - len(INDENT) - 1;
        const bodyRows = Math.max(SECTIONS.length, e.props.scroll.bodyRows);
        const now = Date.now();
        const voxAct = voxActions($);
        // Un testo o un prompt di VOX e SYNTH in modifica prende il posto di tutte le sezioni.
        if (vox.edit) {
            const color = (vox.edit.what === 'text' ? vox.edit.target : vox.edit.kind) === 'sintesi' ? SYNTH_COLOR : VOX_COLOR;
            return h(Box, { flexDirection: "column" }, voxEditLines(el, width, bodyRows, vox.edit, color, voxAct));
        }
        const fileRows = visibleRows();
        const pressFile = (r) => {
            if (r.node.kind === 'dir')
                void toggleDir($, r.node.id).then(() => redraw($));
            else {
                tree.selected = tree.selected === r.node.id ? '' : r.node.id;
                redraw($);
            }
        };
        const showView = (view) => {
            if (filesView !== view)
                offset.files = 0;
            filesView = view;
            redraw($);
        };
        const showGraph = (view) => {
            if (graphView !== view)
                offset.graph = 0;
            graphView = view;
            // I tag sul remoto si leggono la prima volta che si guardano, per repo.
            if (view === 'tags' && remoteTags.top !== repo.top)
                void recheckTags($);
            redraw($);
        };
        const selectCommit = (hash) => {
            graph.selected = graph.selected === hash ? '' : hash;
            redraw($);
        };
        // L'analisi del contesto dell'ultima richiesta: una nuova, o quella già
        // fatta se l'ultima richiesta è ancora quella.
        const startAnalysis = () => {
            const last = lastDone();
            const measures = statsText(statsOf(turns.ledger, turns.calls, turns.breakdown, seenNow()));
            void runAnalysis($, last?.n ?? 0, last?.model ?? '', measures, isShown => {
                if (!isShown && analysis.state !== 'running')
                    $.ui.toast(analysis.state === 'done' ? 'The context analysis is ready: analyze in CONTEXT opens it.' : `Context analysis: ${analysis.error}`);
                redraw($);
            });
        };
        const analyze = () => {
            const last = lastDone();
            if (analysis.state === 'running' || (analysis.state === 'done' && analysis.n === (last?.n ?? 0))) {
                openAnalysis();
                redraw($);
            }
            else
                startAnalysis();
        };
        // Un pezzo del contesto prende il posto di tutte le sezioni.
        if (doc.isOpen) {
            const layout = contextLayout(width, bodyRows);
            contextAt = layout;
            doc.offset = clamp(doc.offset, layout.maxTop);
            doc.left = clamp(doc.left, layout.maxLeft);
            return (h(Box, { flexDirection: "column" }, contextLines(el, width, layout, INPUT_RAIL, {
                back: () => {
                    closeContext();
                    redraw($);
                },
                ...(doc.part === 'analysis' && analysis.state !== 'running' ? { rerun: startAnalysis } : {}),
                open: () => void (doc.part === 'analysis' && analysis.path ? Promise.resolve(analysis.path) : writeDoc($))
                    .then(path => openFile($, path))
                    .catch(err => $.ui.toast(`Could not open ${doc.title}: ${err instanceof Error ? err.message : err}`)),
                slide: left => {
                    doc.left = clamp(left, layout.maxLeft);
                    redraw($);
                },
                toggleWrap: () => {
                    doc.wrap = !doc.wrap;
                    doc.offset = 0;
                    redraw($);
                },
            })));
        }
        // L'anteprima di un file prende il posto di tutte le sezioni.
        if (preview.path) {
            const layout = previewLayout(width, bodyRows);
            previewAt = layout;
            preview.offset = clamp(preview.offset, layout.maxTop);
            preview.left = clamp(preview.left, layout.maxLeft);
            const slide = (left) => {
                preview.left = clamp(left, layout.maxLeft);
                redraw($);
            };
            const back = () => {
                closePreview();
                redraw($);
            };
            const showInTree = () => {
                const path = preview.path;
                closePreview();
                showView('tree');
                void reveal($, path).then(() => redraw($));
            };
            const toggleWrap = () => {
                preview.wrap = !preview.wrap;
                redraw($);
            };
            return h(Box, { flexDirection: "column" }, previewLines(el, width, layout, FILES_COLOR, { back, showInTree, slide, toggleWrap }));
        }
        const content = {
            hooks: () => hookLines(inner, hook => void toggleHook($, hook)
                .then(text => $.ui.toast(text))
                .catch(err => $.ui.toast(`${hook.label}: not switched: ${err instanceof Error ? err.message : err}`))
                .then(() => loadHooks($))
                .then(() => redraw($)), hook => {
                hooks.selected = hooks.selected === hook.id ? '' : hook.id;
                redraw($);
            }),
            graph: () => graphView === 'active'
                ? branchLines(inner, now, ref => {
                    branchView.selected = branchView.selected === ref ? '' : ref;
                    redraw($);
                }, () => {
                    branchView.showMerged = !branchView.showMerged;
                    redraw($);
                })
                : graphView === 'tags'
                    ? tagLines(inner, now, ref => {
                        tagView.selected = tagView.selected === ref ? '' : ref;
                        redraw($);
                    })
                    : graphLines(inner, now, selectCommit),
            files: () => filesView === 'tree'
                ? fileLines(inner, now, fileRows, pressFile)
                : filesView === 'guard'
                    ? guardLines(inner, now, path => void openPreview($, path).then(() => redraw($)), s => jumpTo($, s))
                    : touchedLines(inner, now, t => void openPreview($, t.path).then(() => redraw($)), t => void openFile($, t.path).catch(err => {
                        $.ui.toast(`Could not open ${t.path.split('/').pop()}: ${err instanceof Error ? err.message : err}`);
                    }), contestedPaths()),
            turns: () => turnLines(inner, {
                toggle: n => {
                    if (turns.expanded.has(n))
                        turns.expanded.delete(n);
                    else
                        turns.expanded.add(n);
                    redraw($);
                },
                show: (t, part, at) => void openContext($, turns.ledger, t, part, at)
                    .then(() => redraw($))
                    .catch(err => $.ui.toast(`#${t.n} ${part}: not shown: ${err instanceof Error ? err.message : err}`)),
                pick: tab => {
                    turns.statsTab = tab;
                    redraw($);
                },
            }),
            sessions: () => sessionLines(inner, now, id => {
                sessions.selected = sessions.selected === id ? '' : id;
                redraw($);
            }, s => jumpTo($, s)),
            vox: () => voxLines(inner, voxAct),
            synth: () => synthLines(inner, voxAct),
        };
        const info = {
            hooks: hooksInfo,
            graph: () => (graphView === 'tags' ? tagsInfo() : graphInfo()),
            files: () => (filesView === 'tree' ? filesInfo() : filesView === 'guard' ? guardInfo() : touchedInfo()),
            turns: turnsInfo,
            sessions: () => sessionsInfo(now),
            vox: () => voxInfo(now),
            synth: synthInfo,
        };
        const sharedFiles = contestedCount();
        const tools = {
            hooks: fixedHooks().length > 0
                ? [
                    {
                        key: 'hooks-always',
                        label: 'always',
                        active: hookView.showAlways,
                        press: () => {
                            hookView.showAlways = !hookView.showAlways;
                            offset.hooks = 0;
                            redraw($);
                        },
                    },
                ]
                : [],
            graph: [
                { key: 'graph-view-active', label: 'active', active: graphView === 'active', press: () => showGraph('active') },
                { key: 'graph-view-full', label: 'full', active: graphView === 'full', press: () => showGraph('full') },
                { key: 'graph-view-tags', label: 'tags', active: graphView === 'tags', press: () => showGraph('tags') },
                { key: 'graph-refresh', label: '↻', dim: true, press: () => void refreshAll($).then(() => (graphView === 'tags' ? recheckTags($) : undefined)) },
            ],
            files: [
                { key: 'files-view-touched', label: 'changed', active: filesView === 'touched', press: () => showView('touched') },
                { key: 'files-view-tree', label: 'tree', active: filesView === 'tree', press: () => showView('tree') },
                // La guardia: rossa quando un file di questa sessione lo sta cambiando anche un'altra.
                {
                    key: 'files-view-guard',
                    label: sharedFiles > 0 ? `guard ${sharedFiles}` : 'guard',
                    active: filesView === 'guard',
                    ...(sharedFiles > 0 ? { color: GUARD_COLOR } : {}),
                    press: () => showView('guard'),
                },
                ...(filesView === 'tree'
                    ? [
                        {
                            key: 'files-collapse',
                            label: '⊟',
                            dim: true,
                            press: () => {
                                tree.expanded.clear();
                                offset.files = 0;
                                redraw($);
                            },
                        },
                    ]
                    : []),
                { key: 'files-refresh', label: '↻', dim: true, press: () => void (filesView === 'guard' ? refreshSessionsView($, true) : refreshAll($)) },
            ],
            turns: [
                { key: 'turns-analyze', label: 'analyze', active: analysis.state === 'running', press: analyze },
                {
                    key: 'turns-stats',
                    label: 'stats',
                    active: turns.showStats,
                    press: () => {
                        turns.showStats = !turns.showStats;
                        // Aperta, la tendina sta in cima: la sezione smette di seguire l'ultimo turno.
                        turns.follow = !turns.showStats;
                        offset.turns = 0;
                        redraw($);
                    },
                },
                {
                    key: 'turns-follow',
                    label: '⤓',
                    dim: !turns.follow,
                    press: () => {
                        turns.follow = !turns.follow;
                        redraw($);
                    },
                },
                {
                    key: 'turns-collapse',
                    label: '⊟',
                    dim: true,
                    press: () => {
                        turns.expanded.clear();
                        redraw($);
                    },
                },
            ],
            sessions: [{ key: 'sessions-refresh', label: '↻', dim: true, press: () => void refreshSessionsView($, true) }],
            vox: voxTools(voxAct),
            synth: synthTools(voxAct),
        };
        // Il titolo: la barretta colorata, il nome, le informazioni, gli strumenti a
        // destra. Da aperta la sezione ha sotto una riga sottile del suo colore. I
        // pulsanti tengono solo la loro parola: il motore inverte tutto quello che
        // hanno dentro, e uno spazio o la barretta lo sposterebbero di lato.
        const header = (id, title, color) => {
            const open = isOpen[id];
            const label = `▌ ${title}`;
            const toolsW = tools[id].reduce((w, t) => w + 1 + len(t.label), 0);
            const room = Math.max(0, width - len(label) - 2 - toolsW - 1);
            const segs = [];
            let used = 0;
            for (const s of info[id]()) {
                if (used >= room)
                    break;
                const text = fit(s.text, room - used);
                segs.push({ ...s, text });
                used += len(text);
            }
            const pad = ' '.repeat(Math.max(1, width - len(label) - 2 - used - toolsW));
            const titleRow = (h(Box, { key: `h:${id}`, flexDirection: "row", height: 1, overflow: "hidden" },
                h(Text, { color: color, dimColor: !open },
                    "\u258C",
                    ' '),
                h(Button, { key: `section:${id}`, plain: true, label: title, onPress: () => {
                        isOpen[id] = !isOpen[id];
                        redraw($);
                    } },
                    h(Text, { color: color, dimColor: !open, bold: true }, title)),
                h(Text, null, '  '),
                segs.map(s => (h(Text, { color: s.color, dimColor: s.dim, bold: s.bold }, s.text))),
                h(Text, null, pad),
                tools[id].flatMap(t => [
                    h(Text, null, " "),
                    t.active === undefined ? (h(Button, { key: t.key, plain: true, dimColor: t.dim, label: t.label, onPress: t.press })) : (h(Button, { key: t.key, plain: true, label: t.label, onPress: t.press },
                        h(Text, { color: t.color ?? (t.active ? color : undefined), dimColor: !t.active && !t.color, bold: t.active || t.color !== undefined, underline: t.active }, t.label))),
                ])));
            if (!open)
                return [titleRow];
            return [
                titleRow,
                h(Box, { key: `r:${id}`, height: 1, overflow: "hidden" },
                    h(Text, { color: color, dimColor: true }, '▔'.repeat(width))),
            ];
        };
        // Le righe di ogni sezione aperta; quella degli hook prende solo le sue,
        // le altre si dividono il resto in parti uguali. VOX e SYNTH della loro
        // parte tengono solo le righe che hanno, e lasciano il resto alle altre.
        const lines = Object.fromEntries(SECTIONS.filter(s => isOpen[s.id]).map(s => [s.id, content[s.id]()]));
        const headerRows = SECTIONS.reduce((n, s) => n + (isOpen[s.id] ? 2 : 1), 0);
        const hookRows = lines.hooks ? Math.min(HOOK_ROWS, lines.hooks.length) : 0;
        const shared = SECTIONS.filter(s => isOpen[s.id] && s.id !== 'hooks');
        // In cima il titolo, quando il pannello è alto abbastanza.
        const title = bodyRows >= TITLE_MIN_ROWS ? titleLines(el, width, version) : [];
        const fair = share(Math.max(0, bodyRows - title.length - headerRows - hookRows), shared.length);
        const compactRows = shared.map((s, i) => (COMPACT.has(s.id) ? Math.min(lines[s.id]?.length ?? 0, fair[i] ?? 0) : undefined));
        const wide = shared.filter(s => !COMPACT.has(s.id));
        const spare = share(compactRows.reduce((n, rows, i) => n + (rows === undefined ? 0 : (fair[i] ?? 0) - rows), 0), wide.length);
        const heights = shared.map((s, i) => compactRows[i] ?? (fair[i] ?? 0) + (spare[wide.indexOf(s)] ?? 0));
        const out = [...title];
        const nextSpans = [];
        let row = title.length;
        for (const s of SECTIONS) {
            const head = header(s.id, s.title, s.color);
            out.push(...head);
            row += head.length;
            if (!isOpen[s.id])
                continue;
            const own = lines[s.id] ?? [];
            const rows = s.id === 'hooks' ? hookRows : (heights[shared.indexOf(s)] ?? 0);
            const max = Math.max(0, own.length - rows);
            if (s.id === 'turns' && turns.follow)
                offset.turns = max;
            if (s.id === 'files' && filesView === 'tree' && tree.reveal) {
                const at = fileRows.findIndex(r => r.node.id === tree.reveal);
                if (at !== -1 && (at < offset.files || at >= offset.files + rows))
                    offset.files = at - Math.floor(rows / 2);
                tree.reveal = '';
            }
            offset[s.id] = clamp(offset[s.id], max);
            const from = offset[s.id];
            // Le prime righe che restano ferme mentre il resto scorre: in SESSIONS, questa sessione.
            const pin = Math.min(s.id === 'sessions' ? sessionsPinned() : s.id === 'vox' ? voxPinned() : s.id === 'synth' ? synthPinned() : 0, rows);
            nextSpans.push({ id: s.id, from: row, to: row + rows, max });
            const thumb = Math.max(1, Math.round((rows * rows) / Math.max(1, own.length)));
            const thumbAt = max === 0 ? 0 : Math.round((from / max) * (rows - thumb));
            for (let i = 0; i < rows; i++) {
                const line = i < pin ? own[i] : own[from + i];
                const isThumb = i >= thumbAt && i < thumbAt + thumb;
                out.push(h(Box, { key: `${s.id}:${i}`, flexDirection: "row", height: 1, overflow: "hidden" },
                    h(Text, null, INDENT),
                    h(Box, { width: inner, height: 1, overflow: "hidden" }, line ? line(el) : h(Text, null, " ")),
                    max > 0 ? (h(Text, { color: isThumb ? s.color : undefined, dimColor: !isThumb }, isThumb ? '┃' : '│')) : (h(Text, null, " "))));
            }
            row += rows;
        }
        spans = nextSpans;
        return h(Box, { flexDirection: "column" }, out);
    });
};
