/** La cache dei prompt dura un'ora dall'ultima richiesta. */
export const CACHE_TTL_MS = 60 * 60_000;
/** Da questo contesto in su la ricarica a freddo pesa: la sezione la segna in rosso. */
export const HEAVY = 150_000;
/** L'avviso arriva quando a una cache pesante mancano questi minuti. */
export const WARN_MS = 5 * 60_000;
/** Sotto questi minuti il countdown diventa giallo. */
export const SOON_MS = 10 * 60_000;
/** Ogni quanto si rileggono le sessioni. */
export const EVERY_MS = 60_000;
/** Scrivere un token in cache (un'ora) costa circa questo multiplo di rileggerlo. */
export const RELOAD_FACTOR = 20;
export const sessions = {
    list: [],
    // Quando lo script ha risposto l'ultima volta; 0 finché non ha risposto.
    at: 0,
    error: '',
    selfId: '',
    // L'id della sessione di cui si vedono i dettagli.
    selected: '',
    isLoading: false,
    // Il binario di herdr, se le sessioni girano lì: un clic porta al loro pane.
    herdr: '',
};
// Questa sessione, dalle sue richieste: più fresca dello script, che legge il
// transcript al massimo una volta al minuto.
const own = {};
// Gli avvisi già dati, per sessione e richiesta: uno solo per ogni scadenza.
const warned = new Set();
export function resetOwn() {
    delete own.lastMs;
    delete own.ctx;
    delete own.warmMs;
}
/** Glassbox ha appena tenuto calda la cache di questa sessione. */
export function ownWarmed(now) {
    own.warmMs = now;
}
/** L'ultima volta che la cache della sessione è stata letta: la sua ultima richiesta, o un rinfresco di glassbox. */
export const refreshedAt = (s) => s.lastMs === undefined ? undefined : Math.max(s.lastMs, s.warmMs ?? 0);
/** Quanti agenti della sessione sono al lavoro. */
export const agentsOf = (s) => s.agents ?? 0;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** L'uscita di bin/sessions.py: le sessioni, il binario di herdr se ci sono, o l'errore che ha dato. */
export function readSessions(stdout) {
    let data;
    try {
        data = JSON.parse(stdout);
    }
    catch {
        return { list: [], error: 'unreadable output from bin/sessions.py', herdr: '' };
    }
    const o = (data ?? {});
    const list = [];
    for (const raw of Array.isArray(o.sessions) ? o.sessions : []) {
        const r = (raw ?? {});
        if (typeof r.id !== 'string' || r.id === '')
            continue;
        list.push({
            id: r.id,
            name: typeof r.name === 'string' && r.name ? r.name : r.id.slice(0, 8),
            cwd: typeof r.cwd === 'string' ? r.cwd : '',
            status: typeof r.status === 'string' ? r.status : '',
            lastMs: num(r.lastMs),
            ctx: num(r.ctx),
            isCompacted: r.compacted === true,
            ...(typeof r.pane === 'string' && PANE_RE.test(r.pane) ? { pane: r.pane } : {}),
            ...(typeof r.title === 'string' && r.title ? { title: r.title } : {}),
            ...writesOf(r.writes),
            ...(num(r.agents) ? { agents: num(r.agents) } : {}),
            ...(num(r.warmMs) ? { warmMs: num(r.warmMs) } : {}),
        });
    }
    return { list, error: typeof o.error === 'string' ? o.error : '', herdr: typeof o.herdr === 'string' ? o.herdr : '' };
}
// I file scritti, come li dà lo script: [[percorso assoluto, ms], ...].
function writesOf(raw) {
    if (!Array.isArray(raw))
        return {};
    const out = new Map();
    for (const w of raw) {
        if (!Array.isArray(w))
            continue;
        const [path, at] = w;
        if (typeof path === 'string' && path.startsWith('/') && typeof at === 'number' && Number.isFinite(at))
            out.set(path, Math.max(at, out.get(path) ?? 0));
    }
    return out.size > 0 ? { writes: out } : {};
}
// Un pane di herdr come `w3:p8`: solo questo arriva al comando.
const PANE_RE = /^[\w.:-]{1,64}$/;
/** Il nome da mostrare: il titolo del terminale in herdr, se c'è, se no quello del registro. */
export const label = (s) => s.title || s.name;
/** Porta herdr sul pane della sessione; undefined se c'è riuscito, se no il perché. */
export async function focusSession($, s) {
    if (!s.pane || !sessions.herdr)
        return 'not running in herdr';
    try {
        const out = await $.process.run([sessions.herdr, 'agent', 'focus', s.pane], { timeoutMs: 5_000 });
        // herdr esce con 0 anche quando non trova il pane: l'errore è nel JSON.
        const answer = JSON.parse(out.stdout || '{}');
        if (answer.error)
            return String(answer.error.message ?? 'herdr refused');
        return out.exitCode === 0 ? undefined : out.stderr.trim() || `herdr exited with ${out.exitCode}`;
    }
    catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}
/** Com'è la cache di una sessione adesso. */
export function cacheOf(s, now) {
    if (s.status === 'busy')
        return { kind: 'busy' };
    if (s.isCompacted)
        return { kind: 'compacted' };
    const at = refreshedAt(s);
    if (at === undefined)
        return { kind: 'unknown' };
    const left = at + CACHE_TTL_MS - now;
    return left > 0 ? { kind: 'warm', leftMs: left } : { kind: 'cold', sinceMs: now - at - CACHE_TTL_MS };
}
/** Le sessioni con questa aggiornata dalle sue richieste, se sono più recenti. */
export function merged(list = sessions.list, selfId = sessions.selfId) {
    return list.map(s => {
        if (s.id !== selfId)
            return s;
        const fresher = own.lastMs !== undefined && (s.lastMs === undefined || own.lastMs > s.lastMs || s.isCompacted)
            ? { ...s, lastMs: own.lastMs, ctx: own.ctx, isCompacted: false }
            : s;
        return own.warmMs !== undefined && own.warmMs > (fresher.warmMs ?? 0) ? { ...fresher, warmMs: own.warmMs } : fresher;
    });
}
/** Questa sessione: dal registro se c'è, altrimenti solo dalle sue richieste. */
export function selfSession() {
    const found = merged().find(s => s.id === sessions.selfId);
    if (found)
        return found;
    if (own.lastMs === undefined)
        return undefined;
    return {
        id: sessions.selfId,
        name: 'this session',
        cwd: '',
        status: '',
        lastMs: own.lastMs,
        ctx: own.ctx,
        isCompacted: false,
        ...(own.warmMs !== undefined ? { warmMs: own.warmMs } : {}),
    };
}
const rank = (c) => ({ busy: 0, warm: 1, compacted: 2, cold: 3, unknown: 4 })[c.kind];
/** Ferma su una domanda o un permesso: aspetta te. Il registro la scrive `waiting`. */
export const isWaiting = (s) => s.status === 'waiting';
/** Questa in cima; poi chi lavora, chi aspetta te, le calde dalla più vicina alla scadenza, le fredde dalla più pesante. */
export function ordered(list, now, selfId = sessions.selfId) {
    const key = (s) => {
        if (s.id === selfId)
            return [-1, 0];
        const c = cacheOf(s, now);
        const by = c.kind === 'warm' ? c.leftMs : c.kind === 'cold' ? -(s.ctx ?? 0) : 0;
        return [isWaiting(s) ? 0.5 : rank(c), by];
    };
    return [...list].sort((a, b) => {
        const [ra, va] = key(a);
        const [rb, vb] = key(b);
        return ra - rb || va - vb || label(a).localeCompare(label(b));
    });
}
export const isHeavy = (s) => (s.ctx ?? 0) >= HEAVY;
/** Quante aperte, quante aspettano te, quante con la cache calda (o al lavoro), quante da ricaricare con molto contesto. */
export function counts(list, now) {
    let warm = 0;
    let reload = 0;
    for (const s of list) {
        const c = cacheOf(s, now);
        if (c.kind === 'busy' || c.kind === 'warm')
            warm++;
        else if (c.kind === 'cold' && isHeavy(s))
            reload++;
    }
    return { open: list.length, waiting: list.filter(isWaiting).length, warm, reload };
}
/** `312k`, `1.2M`. */
export const tokens = (n) => n === undefined ? '' : n >= 999_500 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
export const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));
/** Quanto tempo, a grana grossa: `40m`, `14h`, `7d`. */
export const span = (ms) => ms < 3_600_000 ? `${Math.max(1, Math.floor(ms / 60_000))}m` : ms < 48 * 3_600_000 ? `${Math.floor(ms / 3_600_000)}h` : `${Math.floor(ms / 86_400_000)}d`;
/**
 * Gli avvisi da dare adesso: le cache pesanti e ferme a cui mancano WARN_MS o
 * meno. Uno per scadenza. Non per chi ha agenti al lavoro: la sua cache la
 * tiene calda glassbox.
 */
export function dueWarnings(list, now, selfId, given = warned) {
    const parts = [];
    let isSelf = false;
    for (const s of list) {
        const c = cacheOf(s, now);
        if (c.kind !== 'warm' || c.leftMs > WARN_MS || !isHeavy(s) || agentsOf(s) > 0)
            continue;
        const key = `${s.id}:${refreshedAt(s)}`;
        if (given.has(key))
            continue;
        given.add(key);
        if (s.id === selfId)
            isSelf = true;
        else
            parts.push(`${label(s)} ${minutes(c.leftMs)}m (${tokens(s.ctx)})`);
    }
    const self = list.find(s => s.id === selfId);
    const selfText = isSelf && self
        ? `This session's cache expires in ${minutes(cacheOf(self, now).leftMs)} min (${tokens(self.ctx)}): /compact now if you are stepping away.`
        : '';
    const others = parts.length ? `Cache expiring: ${parts.join(', ')}.` : '';
    return [selfText, others].filter(Boolean).join(' ') || undefined;
}
/** Rilegge le sessioni con bin/sessions.py; `fresh` salta il risultato condiviso tra le sessioni. */
export async function refreshSessions($, fresh = false) {
    if (sessions.isLoading)
        return;
    sessions.isLoading = true;
    try {
        const id = await $.session.id().catch(() => sessions.selfId);
        if (id !== sessions.selfId) {
            // Dopo un /clear la sessione è un'altra: le richieste di prima non contano più.
            if (sessions.selfId !== '')
                resetOwn();
            sessions.selfId = id;
        }
        const out = await $.process.run(['python3', '-I', `${$.plugin.root}/bin/sessions.py`, ...(fresh ? ['--fresh'] : [])], { timeoutMs: 15_000 });
        if (out.exitCode !== 0) {
            sessions.error = out.stderr.trim().split('\n').pop() || `bin/sessions.py exited with ${out.exitCode}`;
        }
        else {
            const read = readSessions(out.stdout);
            sessions.list = read.list;
            sessions.error = read.error;
            sessions.herdr = read.herdr;
        }
    }
    catch (err) {
        sessions.error = `python3 not run: ${err instanceof Error ? err.message : err}`;
    }
    finally {
        sessions.at = Date.now();
        sessions.isLoading = false;
    }
}
/** Gli avvisi sulle cache in scadenza, da rifare ogni minuto. */
export function tick($, now = Date.now()) {
    const list = merged();
    const self = selfSession();
    const text = dueWarnings(self && !list.some(s => s.id === self.id) ? [...list, self] : list, now, sessions.selfId);
    if (text)
        $.ui.toast(text);
}
/** Una richiesta del thread principale è finita: la cache di questa sessione riparte da adesso. */
export function stepSeen(usage, now = Date.now()) {
    if (!usage)
        return;
    own.lastMs = now;
    own.ctx = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens;
}
