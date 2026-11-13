import { CACHE_TTL_MS, agentsOf, ownWarmed, refreshedAt, selfSession, sessions } from './sessions';
/** La cache si rinfresca quando le mancano questi minuti. */
export const KEEP_BEFORE_MS = 5 * 60_000;
// Più vicino alla scadenza la richiesta potrebbe arrivare tardi e riscrivere
// tutto: allora non si manda.
const TOO_LATE_MS = 20_000;
/** Quello che la richiesta chiede: niente effort, perché un livello diverso da quello della sessione riscriverebbe la cache. */
export const PING = "Glassbox keep-alive. This session's agents are still working, and this request only keeps the prompt cache warm until they report back: it is not a task. You have no tools. Answer with the single word OK, at once, without thinking it over.";
export const keep = {
    // I rinfreschi fatti in questa sessione, l'ultimo, e quanto ha letto e scritto in cache.
    pings: 0,
    lastMs: 0,
    read: 0,
    written: 0,
    error: '',
    isPinging: false,
};
/** Quanto manca alla scadenza della cache, dall'ultima lettura: anche mentre il thread principale aspetta un agente. */
const leftOf = (s, now) => {
    const at = refreshedAt(s);
    return at === undefined || s.isCompacted ? undefined : at + CACHE_TTL_MS - now;
};
/** Se adesso va rinfrescata: agenti al lavoro, cache ancora calda e a KEEP_BEFORE_MS o meno dalla scadenza. */
export function isDue(s, now) {
    if (!s || agentsOf(s) === 0)
        return false;
    const left = leftOf(s, now);
    return left !== undefined && left <= KEEP_BEFORE_MS && left > TOO_LATE_MS;
}
/** Rinfresca la cache di questa sessione se è il momento; true se l'ha fatto. */
export async function keepWarm($, now = Date.now()) {
    if (keep.isPinging || !isDue(selfSession(), now))
        return false;
    keep.isPinging = true;
    try {
        const r = await $.model.fork({ prompt: PING });
        if (!r.isAnswered) {
            keep.error = 'status' in r && r.status ? `${r.reason} ${r.status}` : r.reason;
            $.ui.log(`glassbox: cache not kept warm: ${keep.error}`);
            return false;
        }
        const at = Date.now();
        ownWarmed(at);
        keep.pings += 1;
        keep.lastMs = at;
        keep.read = r.usage.cache_read_input_tokens;
        keep.written = r.usage.cache_creation_input_tokens;
        keep.error = '';
        await $.process
            .run(['python3', '-I', `${$.plugin.root}/bin/sessions.py`, '--warm', sessions.selfId], { timeoutMs: 5_000 })
            .catch(err => $.ui.log(`glassbox: warm mark not written: ${err}`));
        return true;
    }
    catch (err) {
        keep.error = err instanceof Error ? err.message : String(err);
        $.ui.log(`glassbox: cache not kept warm: ${keep.error}`);
        return false;
    }
    finally {
        keep.isPinging = false;
    }
}
