// ARMA: apre la porta alle copie. `voxbox-win.exe clips` resta in ascolto
// degli appunti di Windows (quello che c'era prima non conta) e consegna ogni
// copia nuova, seguita da un byte NUL, finché non lo si chiude. Quando
// chiuderlo lo decide register.tsx: dopo la prima copia in modo sostituisci,
// dopo 60 secondi senza copie né ritocchi al separatore in modo concatena.
// Mentre non si è armati non c'è nessun processo che guarda gli appunti.
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

// Il tetto di sicurezza dell'ascolto lato Windows, oltre il timer del mod.
const MAX_SECONDS = 3600

let listening: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined

export const isArmed = (): boolean => listening !== undefined

/**
 * Arma: `onCopy` riceve ogni copia; `onEnd` quando l'ascolto finisce da sé,
 * con il motivo se è un errore. Si risolve quando l'ascolto è finito.
 */
export async function listen(
  $: EngineInterface,
  win: string,
  onCopy: (text: string) => void,
  onEnd: (error?: string) => void,
): Promise<void> {
  if (listening) return
  const stream = $.process.spawn({ argv: [win, 'clips', String(MAX_SECONDS)] })
  listening = stream
  let buffer = ''
  let err = ''
  let error: string | undefined
  try {
    for await (const chunk of stream) {
      if (chunk.stream === 'stderr') {
        err = (err + chunk.text).slice(-2000)
        continue
      }
      buffer += chunk.text
      let at: number
      while ((at = buffer.indexOf('\0')) !== -1) {
        const text = buffer.slice(0, at).replace(/\r\n/g, '\n')
        buffer = buffer.slice(at + 1)
        if (listening === stream && text.trim() !== '') onCopy(text)
      }
    }
    const end = await stream.result
    if (end.code !== 0 && end.code !== 2) error = err.trim() || `ascolto degli appunti finito con codice ${end.code}`
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    if (listening === stream) {
      listening = undefined
      onEnd(error)
    }
  }
}

/** Chiude la porta. */
export async function disarm(): Promise<void> {
  const stream = listening
  listening = undefined
  await stream?.return(undefined as unknown as ProcessSpawnResult).catch(() => undefined)
}
