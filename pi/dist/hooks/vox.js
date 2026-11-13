import { redraw } from './ui';
import { disarm, isArmed, listen } from './vox-clip';
import { DEFAULTS, forkPrompt, paramsText, parseParams, quickRequest, revive, vars } from './vox-prompts';
import { shutdown, speak, speech, stop, watchSpeech } from './vox-speech';
import { cleanForSpeech, countWords, lastReply, prosaLevels, sintesiLines } from './vox-text';
// Il pannello di Glassbox, per portare il cursore nei campi dell'editor.
const PANE = 'glassbox';
const STORE_KEY = 'vox-prompts';
// `rec` resta acceso questo tempo senza copie né modifiche al testo, poi si spegne.
const ARM_SECONDS = 60;
// herdr può scrivere la stessa selezione negli appunti due volte di fila.
const DOUBLE_COPY_MS = 2000;
export const vox = {
    source: 'clip',
    // Il testo di partenza: la cattura o l'ultima risposta, e quello che ci scrivi tu.
    text: '',
    // Cresce quando il testo cambia da fuori (cattura, cp, svuota): il campo in modifica si ridisegna.
    textKey: 0,
    // Cresce a ogni cambio del testo: prosa e sintesi vecchie non valgono più.
    version: 0,
    mode: 'replace',
    // `rec`: fin quando resta acceso (ms).
    armedUntil: 0,
    // Cosa mostra VOX.
    view: 'raw',
    deep: { prosa: false, sintesi: false },
    level: { prosa: 0, sintesi: 0 },
    speed: 1,
    // Cosa si sta scrivendo adesso.
    busy: undefined,
    // Quale sezione ha chiesto l'ultima lettura.
    reading: '',
    error: { vox: '', synth: '' },
    edit: undefined,
    // Perché la voce non c'è; vuoto se è installata.
    setupError: '',
};
const outputs = new Map();
let prompts = DEFAULTS;
let setup;
let root = '';
// Apre la sezione quando un suo comando si usa da chiusa.
let reveal = () => undefined;
// I campi dell'editor hanno ogni volta un nome nuovo: Claude Code ricorda per
// nome un campo svuotato dall'Invio, anche dopo che il mod si è ricaricato.
let sessions = Date.now() % 1_000_000;
let keys = sessions;
export const promptsNow = () => prompts;
export const effectiveDeep = (kind) => vox.deep[kind] || (kind === 'prosa' && vox.level.prosa > 0);
const outputKey = (kind) => `${vox.version}:${kind}:${vox.level[kind]}:${effectiveDeep(kind)}`;
/** La prosa o la sintesi del testo di adesso, se è già scritta. */
export const outputOf = (kind) => outputs.get(outputKey(kind));
export const textOf = (target) => (target === 'raw' ? vox.text : (outputOf(target)?.text ?? ''));
/** Il testo che la sezione mostra, e che ▶ legge. */
export const shownText = (section) => textOf(section === 'synth' ? 'sintesi' : vox.view);
/** Le parole del testo di partenza come le conta la voce. */
export const sourceWords = () => countWords(cleanForSpeech(vox.text));
export const isReading = (section) => vox.reading === section && speech.phase === 'speaking';
export const isStarting = (section) => vox.reading === section && speech.phase === 'starting';
/** I secondi che restano a `rec`. */
export const armLeft = (now) => Math.max(0, Math.ceil((vox.armedUntil - now) / 1000));
/** `×2`, `×1/2` per la prosa; `3 lines` per la sintesi. */
export function levelLabel(kind) {
    if (kind === 'sintesi') {
        const n = sintesiLines(sourceWords(), prompts.sintesi.params, vox.level.sintesi);
        return n === 1 ? '1 line' : `${n} lines`;
    }
    const l = vox.level.prosa;
    return l === 0 ? '×1' : l > 0 ? `×${2 ** l}` : `×1/${2 ** -l}`;
}
// ---- la voce e i prompt, all'avvio -----------------------------------------
async function loadSetup($) {
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? '';
    const data = (await $.env.get('XDG_DATA_HOME').catch(() => undefined)) || `${home}/.local/share`;
    try {
        const raw = JSON.parse(await $.fs.read(`${data}/voxbox/config.json`));
        if (!raw.python || !raw.voice || !raw.win)
            throw new Error('incomplete config.json');
        setup = { python: raw.python, voice: raw.voice, win: raw.win };
        vox.setupError = '';
    }
    catch {
        setup = undefined;
        vox.setupError = `Voice not installed: run ${root}/bin/vox-setup.sh`;
    }
}
/** All'avvio della sessione: i prompt salvati, dov'è la voce, chi apre le sezioni. */
export async function startVox($, open) {
    reveal = open;
    root = $.plugin.root;
    prompts = revive(await $.store.get(STORE_KEY).catch(() => undefined));
    await loadSetup($);
    speech.dir = `/tmp/voxbox-${await $.session.id().catch(() => 'session')}`;
    watchSpeech(() => redraw($));
}
/** Alla chiusura del pannello: niente più ascolto degli appunti, e il motore della voce si chiude. */
export async function stopVox($) {
    await disarmAll($);
    await shutdown();
}
function say($, text) {
    try {
        $.ui.toast(text);
    }
    catch {
        // Senza toast resta il pannello.
    }
}
// ---- prendere il testo -----------------------------------------------------
function setSource(change) {
    change();
    vox.textKey++;
    vox.version++;
    vox.view = 'raw';
    vox.error.vox = '';
    vox.error.synth = '';
}
// Il timer di `rec`: un secondo alla volta ridisegna il conto alla rovescia e,
// allo scadere, spegne.
let tick;
async function disarmAll($) {
    tick?.cancel();
    tick = undefined;
    vox.armedUntil = 0;
    await disarm();
    redraw($);
}
/** Ogni copia, e ogni modifica al testo, rimette il timer di `rec` a 60 secondi. */
const renewArm = () => {
    if (isArmed())
        vox.armedUntil = Date.now() + ARM_SECONDS * 1000;
};
let lastCopy = { text: '', at: 0 };
function takeCopy($, text) {
    const clean = text.trim();
    const now = Date.now();
    if (clean === lastCopy.text && now - lastCopy.at < DOUBLE_COPY_MS)
        return;
    lastCopy = { text: clean, at: now };
    setSource(() => {
        // In concatena la copia va in fondo, a capo: punti, virgole e il resto li scrivi tu nel testo.
        vox.text = vox.source === 'clip' && vox.mode === 'append' && vox.text.trim() !== '' ? `${vox.text.trimEnd()}\n${clean}` : clean;
        vox.source = 'clip';
    });
    reveal('vox');
    if (vox.mode === 'replace')
        void disarmAll($);
    else {
        renewArm();
        redraw($);
    }
}
async function pressArm($) {
    if (isArmed()) {
        await disarmAll($);
        return;
    }
    reveal('vox');
    if (!setup)
        await loadSetup($);
    if (!setup) {
        vox.error.vox = vox.setupError;
        redraw($);
        return;
    }
    vox.error.vox = '';
    vox.armedUntil = Date.now() + ARM_SECONDS * 1000;
    tick?.cancel();
    tick = $.clock.every(1000, () => {
        if (!isArmed())
            return;
        if (Date.now() >= vox.armedUntil)
            void disarmAll($);
        else
            redraw($);
    });
    const listening = listen($, setup.win, text => takeCopy($, text), error => {
        tick?.cancel();
        tick = undefined;
        vox.armedUntil = 0;
        if (error)
            vox.error.vox = `rec: ${error}`;
        redraw($);
    });
    redraw($);
    await listening;
}
async function pressReply($) {
    const text = lastReply(await $.session.messages());
    if (text === '') {
        say($, 'VOX: no reply from Claude after your last message.');
        return;
    }
    setSource(() => {
        vox.text = text;
        vox.source = 'reply';
    });
    reveal('vox');
    redraw($);
}
function pressClear($) {
    setSource(() => {
        vox.text = '';
        vox.source = 'clip';
    });
    outputs.clear();
    redraw($);
}
// ---- prosa e sintesi -------------------------------------------------------
const sectionOf = (kind) => (kind === 'sintesi' ? 'synth' : 'vox');
async function generate($, kind) {
    const section = sectionOf(kind);
    const text = vox.text;
    if (text.trim() === '') {
        say($, 'Nothing to rewrite: press rec and select a text, or cp for the last reply.');
        return;
    }
    const key = outputKey(kind);
    if (outputs.has(key))
        return;
    if (vox.busy) {
        say($, 'Still writing: try again in a moment.');
        return;
    }
    const deep = effectiveDeep(kind);
    const values = vars(kind, prompts, countWords(cleanForSpeech(text)), vox.level[kind]);
    const isSelection = vox.source === 'clip';
    vox.busy = kind;
    vox.error[section] = '';
    redraw($);
    const t0 = Date.now();
    try {
        let reply;
        if (deep) {
            reply = await $.model.fork({ prompt: forkPrompt(kind, prompts, values, text, isSelection), effort: 'low' });
        }
        else {
            const context = isSelection ? lastReply(await $.session.messages()) : '';
            const request = quickRequest(kind, prompts, values, text, context && context !== text ? context : undefined);
            reply = await $.model.complete({ model: 'haiku', ...request, timeoutMs: 90_000 });
        }
        if (reply.isAnswered)
            outputs.set(key, { text: reply.text.trim(), ms: Date.now() - t0, deep });
        else
            vox.error[section] = `No text (${reply.reason})`;
    }
    catch (err) {
        vox.error[section] = err instanceof Error ? err.message : String(err);
    }
    finally {
        vox.busy = undefined;
        redraw($);
    }
}
function showView($, view) {
    vox.view = view;
    reveal('vox');
    if (view === 'prosa')
        void generate($, 'prosa');
    redraw($);
}
// SYNTH si scrive quando lo chiedi; con una sintesi già pronta, la riscrive.
function writeSynth($) {
    reveal('synth');
    outputs.delete(outputKey('sintesi'));
    void generate($, 'sintesi');
    redraw($);
}
function pressLevel($, kind, by) {
    const next = vox.level[kind] + by;
    if (kind === 'prosa') {
        const { min, max } = prosaLevels(prompts.prosa.params);
        if (next < min || next > max) {
            say($, by > 0 ? 'Prose is already at its longest.' : 'Prose is already at its shortest.');
            return;
        }
    }
    else {
        const words = sourceWords();
        if (sintesiLines(words, prompts.sintesi.params, next) === sintesiLines(words, prompts.sintesi.params, vox.level.sintesi)) {
            say($, by > 0 ? 'SYNTH is already at its longest.' : 'SYNTH is already at its shortest.');
            return;
        }
    }
    vox.level[kind] = next;
    if (kind === 'prosa')
        showView($, 'prosa');
    else {
        reveal('synth');
        void generate($, 'sintesi');
        redraw($);
    }
}
function setDeep($, kind, deep) {
    vox.deep[kind] = deep;
    void generate($, kind);
    redraw($);
}
// ---- leggere ad alta voce --------------------------------------------------
async function pressPlay($, section) {
    if (isReading(section)) {
        await stop($);
        return;
    }
    reveal(section);
    if (!setup)
        await loadSetup($);
    if (!setup) {
        vox.error[section] = vox.setupError;
        redraw($);
        return;
    }
    const text = cleanForSpeech(shownText(section));
    if (text === '') {
        say($, section === 'synth' ? 'SYNTH has nothing to read yet: press write.' : 'VOX has nothing to read.');
        return;
    }
    vox.reading = section;
    vox.error[section] = '';
    try {
        await speak($, setup, root, text, vox.speed);
    }
    catch (err) {
        vox.error[section] = `Voice: ${err instanceof Error ? err.message : String(err)}`;
        redraw($);
    }
}
function changeSpeed($, by) {
    vox.speed = Math.min(1.6, Math.max(0.7, Math.round((vox.speed + by) * 10) / 10));
    redraw($);
}
// ---- modificare un testo o un prompt, al posto delle sezioni -----------------
function focus($, key) {
    void $.ui.focus({ requestId: PANE, key }).catch(() => undefined);
}
// Apre un campo dell'editor con il cursore dentro. Il pannello deve avere la
// tastiera perché il fuoco si sposti: la si chiede riaprendolo con `focus`, che
// Claude Code concede solo se nel prompt non c'è scritto niente. Se la nega,
// si clicca nel campo.
async function focusField($, key) {
    await $.ui.open({ id: PANE, title: 'Glassbox', columns: 64, backgroundColor: 'transparent', focus: true }).catch(() => undefined);
    await $.ui.focus({ requestId: PANE, key }).catch(() => undefined);
}
function closeEdit($) {
    const edit = vox.edit;
    vox.edit = undefined;
    redraw($);
    // Il campo sparisce: il fuoco della tastiera va su ▶ della sezione, il passo dopo naturale.
    if (edit)
        focus($, edit.what === 'text' ? `${edit.target === 'sintesi' ? 'synth' : 'vox'}-play` : `${sectionOf(edit.kind)}-play`);
}
function editText($, target) {
    if (textOf(target).trim() === '')
        return;
    vox.edit = { what: 'text', target, session: ++sessions };
    renewArm();
    redraw($);
    void focusField($, `vox-text-${sessions}`);
}
// Il testo catturato è il master: cambiarlo fa riscrivere prosa e sintesi;
// cambiare prosa o sintesi tocca solo quel testo.
function setText(target, value) {
    if (target === 'raw') {
        vox.text = value;
        vox.version++;
        return;
    }
    const key = outputKey(target);
    const out = outputs.get(key);
    if (out)
        outputs.set(key, { ...out, text: value });
}
/** Mentre si scrive: le modifiche contano solo da dentro il campo, e tengono acceso `rec`. */
function typeText(target, value) {
    if (vox.edit?.what !== 'text' || vox.edit.target !== target || value.trim() === '')
        return;
    setText(target, value);
    renewArm();
}
/** Invio salva ed esce; un Invio a campo vuoto esce senza cancellare (per svuotare c'è ✕). */
function submitText($, target, value) {
    typeText(target, value);
    closeEdit($);
}
function editPrompt($, kind) {
    vox.edit = { what: 'prompt', kind, draft: prompts[kind].template, params: paramsText(kind, prompts), key: ++keys };
    redraw($);
    void focusField($, `vox-prompt-${keys}`);
}
async function savePrompt($) {
    const edit = vox.edit;
    if (edit?.what !== 'prompt')
        return;
    const { kind } = edit;
    const withText = { ...prompts, [kind]: { ...prompts[kind], template: edit.draft.trim() === '' ? DEFAULTS[kind].template : edit.draft } };
    const parsed = parseParams(kind, edit.params, withText);
    prompts = parsed.prompts;
    await $.store.set(STORE_KEY, prompts).catch(err => $.ui.log(`glassbox: vox prompts not saved: ${err}`));
    outputs.clear();
    const name = kind === 'prosa' ? 'Prose' : 'SYNTH';
    say($, parsed.errors.length > 0 ? `${name} prompt saved, but: ${parsed.errors.join('; ')}` : `${name} prompt saved.`);
    closeEdit($);
}
// ↺ default: rimette nell'editor il prompt di partenza; save lo tiene.
function resetPrompt($) {
    const edit = vox.edit;
    if (edit?.what !== 'prompt')
        return;
    vox.edit = { ...edit, draft: DEFAULTS[edit.kind].template, params: paramsText(edit.kind, DEFAULTS), key: ++keys };
    redraw($);
}
/** I comandi delle due sezioni, legati alla sessione. */
export function voxActions($) {
    return {
        arm: () => void pressArm($),
        toggleMode: () => {
            vox.mode = vox.mode === 'replace' ? 'append' : 'replace';
            renewArm();
            redraw($);
        },
        reply: () => void pressReply($),
        clear: () => pressClear($),
        show: (view) => showView($, view),
        write: () => writeSynth($),
        level: (kind, by) => pressLevel($, kind, by),
        deep: (kind, deep) => setDeep($, kind, deep),
        play: (section) => void pressPlay($, section),
        speed: (by) => changeSpeed($, by),
        editText: (target) => editText($, target),
        typeText,
        submitText: (target, value) => submitText($, target, value),
        editPrompt: (kind) => editPrompt($, kind),
        typePrompt: (field, value) => {
            if (vox.edit?.what === 'prompt')
                vox.edit[field] = value;
        },
        savePrompt: () => void savePrompt($),
        resetPrompt: () => resetPrompt($),
        closeEdit: () => closeEdit($),
    };
}
// Usati solo dai test: il mod resta caricato da un test all'altro.
export const _testing = {
    reset: () => {
        outputs.clear();
        prompts = DEFAULTS;
        Object.assign(vox, { source: 'clip', text: '', mode: 'replace', armedUntil: 0, view: 'raw', speed: 1, busy: undefined, reading: '', edit: undefined });
        vox.deep = { prosa: false, sintesi: false };
        vox.level = { prosa: 0, sintesi: 0 };
        vox.error = { vox: '', synth: '' };
        vox.version++;
    },
};
