// La voce: bin/voxbox-tts.py (Piper tenuto carico) avviato la prima volta che
// si preme ▶, e voxbox-win.exe dal lato Windows. Il motore riceve i lavori come
// file in una cartella sua, perché lo stdin di un processo del mod si dà una
// volta sola; risponde con un evento JSON per riga su stdout.
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

export type Setup = { python: string; voice: string; win: string }

type Phase = 'off' | 'starting' | 'ready' | 'speaking'

export const speech = {
  phase: 'off' as Phase,
  error: '',
  dir: '',
}

let proc: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined
let ready: Promise<void> | undefined
let onChange: () => void = () => undefined

/** Chi ridisegna il pannello quando la voce cambia stato. */
export const watchSpeech = (fn: () => void) => {
  onChange = fn
}

const set = (phase: Phase, error = '') => {
  speech.phase = phase
  speech.error = error
  onChange()
}

/** Avvia il motore se non c'è; si risolve quando ha caricato la voce. */
function start($: EngineInterface, setup: Setup, root: string): Promise<void> {
  if (ready && speech.phase !== 'off') return ready
  set('starting')
  ready = new Promise<void>((resolve, reject) => {
    const stream = $.process.spawn({
      argv: [setup.python, '-I', `${root}/bin/voxbox-tts.py`, '--voice', setup.voice, '--player', setup.win, '--dir', speech.dir],
    })
    proc = stream
    let buffer = ''
    let stderr = ''
    void (async () => {
      try {
        for await (const chunk of stream) {
          if (chunk.stream === 'stderr') {
            stderr = (stderr + chunk.text).slice(-2000)
            continue
          }
          buffer += chunk.text
          let nl: number
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl)
            buffer = buffer.slice(nl + 1)
            let ev: { event?: string; message?: string }
            try {
              ev = JSON.parse(line) as typeof ev
            } catch {
              continue
            }
            if (ev.event === 'ready') {
              set('ready')
              resolve()
            } else if (ev.event === 'start') set('speaking')
            else if (ev.event === 'done' || ev.event === 'stopped') set('ready')
            else if (ev.event === 'error') set(speech.phase === 'starting' ? 'off' : 'ready', ev.message ?? 'errore della voce')
          }
        }
      } catch (err) {
        stderr ||= err instanceof Error ? err.message : String(err)
      }
      // Il motore è uscito: per inattività, per errore o perché lo si è chiuso.
      const wasStarting = speech.phase === 'starting'
      proc = undefined
      ready = undefined
      const why = stderr.trim().split('\n').at(-1) ?? ''
      set('off', wasStarting ? why || 'la voce non è partita' : '')
      if (wasStarting) reject(new Error(why || 'la voce non è partita'))
    })()
  })
  return ready
}

/** Legge `text`; una lettura in corso si interrompe. */
export async function speak($: EngineInterface, setup: Setup, root: string, text: string, speed: number): Promise<void> {
  await start($, setup, root)
  const id = `${Date.now()}`
  await $.fs.write(`${speech.dir}/job-${id}.json`, JSON.stringify({ id, text, speed }))
}

/** Ferma la lettura in corso. */
export async function stop($: EngineInterface): Promise<void> {
  if (speech.phase !== 'speaking') return
  await $.fs.write(`${speech.dir}/stop`, '')
}

/** Chiude il motore (alla chiusura del pannello o allo scaricamento del mod). */
export async function shutdown(): Promise<void> {
  await proc?.return(undefined as unknown as ProcessSpawnResult).catch(() => undefined)
  proc = undefined
  ready = undefined
  speech.phase = 'off'
}
