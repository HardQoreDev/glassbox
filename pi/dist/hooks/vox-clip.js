// Il tetto di sicurezza dell'ascolto lato Windows, oltre il timer del mod.
const MAX_SECONDS = 3600;
let listening;
export const isArmed = () => listening !== undefined;
/**
 * Arma: `onCopy` riceve ogni copia; `onEnd` quando l'ascolto finisce da sé,
 * con il motivo se è un errore. Si risolve quando l'ascolto è finito.
 */
export async function listen($, win, onCopy, onEnd) {
    if (listening)
        return;
    const stream = $.process.spawn({ argv: [win, 'clips', String(MAX_SECONDS)] });
    listening = stream;
    let buffer = '';
    let err = '';
    let error;
    try {
        for await (const chunk of stream) {
            if (chunk.stream === 'stderr') {
                err = (err + chunk.text).slice(-2000);
                continue;
            }
            buffer += chunk.text;
            let at;
            while ((at = buffer.indexOf('\0')) !== -1) {
                const text = buffer.slice(0, at).replace(/\r\n/g, '\n');
                buffer = buffer.slice(at + 1);
                if (listening === stream && text.trim() !== '')
                    onCopy(text);
            }
        }
        const end = await stream.result;
        if (end.code !== 0 && end.code !== 2)
            error = err.trim() || `ascolto degli appunti finito con codice ${end.code}`;
    }
    catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    finally {
        if (listening === stream) {
            listening = undefined;
            onEnd(error);
        }
    }
}
/** Chiude la porta. */
export async function disarm() {
    const stream = listening;
    listening = undefined;
    await stream?.return(undefined).catch(() => undefined);
}
