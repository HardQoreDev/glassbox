export const speech = {
    phase: 'off',
    error: '',
    dir: '',
};
let proc;
let ready;
let onChange = () => undefined;
/** Chi ridisegna il pannello quando la voce cambia stato. */
export const watchSpeech = (fn) => {
    onChange = fn;
};
const set = (phase, error = '') => {
    speech.phase = phase;
    speech.error = error;
    onChange();
};
/** Avvia il motore se non c'è; si risolve quando ha caricato la voce. */
function start($, setup, root) {
    if (ready && speech.phase !== 'off')
        return ready;
    set('starting');
    ready = new Promise((resolve, reject) => {
        const stream = $.process.spawn({
            argv: [setup.python, '-I', `${root}/bin/voxbox-tts.py`, '--voice', setup.voice, '--player', setup.win, '--dir', speech.dir],
        });
        proc = stream;
        let buffer = '';
        let stderr = '';
        void (async () => {
            try {
                for await (const chunk of stream) {
                    if (chunk.stream === 'stderr') {
                        stderr = (stderr + chunk.text).slice(-2000);
                        continue;
                    }
                    buffer += chunk.text;
                    let nl;
                    while ((nl = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.slice(0, nl);
                        buffer = buffer.slice(nl + 1);
                        let ev;
                        try {
                            ev = JSON.parse(line);
                        }
                        catch {
                            continue;
                        }
                        if (ev.event === 'ready') {
                            set('ready');
                            resolve();
                        }
                        else if (ev.event === 'start')
                            set('speaking');
                        else if (ev.event === 'done' || ev.event === 'stopped')
                            set('ready');
                        else if (ev.event === 'error')
                            set(speech.phase === 'starting' ? 'off' : 'ready', ev.message ?? 'errore della voce');
                    }
                }
            }
            catch (err) {
                stderr ||= err instanceof Error ? err.message : String(err);
            }
            // Il motore è uscito: per inattività, per errore o perché lo si è chiuso.
            const wasStarting = speech.phase === 'starting';
            proc = undefined;
            ready = undefined;
            const why = stderr.trim().split('\n').at(-1) ?? '';
            set('off', wasStarting ? why || 'la voce non è partita' : '');
            if (wasStarting)
                reject(new Error(why || 'la voce non è partita'));
        })();
    });
    return ready;
}
/** Legge `text`; una lettura in corso si interrompe. */
export async function speak($, setup, root, text, speed) {
    await start($, setup, root);
    const id = `${Date.now()}`;
    await $.fs.write(`${speech.dir}/job-${id}.json`, JSON.stringify({ id, text, speed }));
}
/** Ferma la lettura in corso. */
export async function stop($) {
    if (speech.phase !== 'speaking')
        return;
    await $.fs.write(`${speech.dir}/stop`, '');
}
/** Chiude il motore (alla chiusura del pannello o allo scaricamento del mod). */
export async function shutdown() {
    await proc?.return(undefined).catch(() => undefined);
    proc = undefined;
    ready = undefined;
    speech.phase = 'off';
}
