import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import { lastPromptIn, replySince } from './reply'

const lastPrompt = atom({ plugin: 'copia-risposta', key: 'lastPrompt' } as const, null)
const draftArmedUntil = atom({ plugin: 'copia-risposta', key: 'draftArmedUntil' } as const, null)

// Le origini che sono la persona: il terminale, Remote Control, l'host SDK.
const PERSON: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

// Il segnaposto con cui il prompt mostra un testo incollato lungo. Il testo vero
// il motore non lo dà ai mod finché la bozza non viene inviata: lì arriva espanso.
const PASTE_CHIP = /\[(?:Pasted text #\d+(?: \+\d+ lines)?|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]/

// Per quanto, dopo [BZ], l'Invio copia la bozza invece di mandarla.
const ARM_MS = 30_000

const copyText = async (
  $: EngineInterface,
  surface: RenderSurface | undefined,
  text: string,
  done: string,
) => {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(
    copied.isCopied ? `${done}: ${text.length} caratteri` : `Copia non riuscita (${copied.reason})`,
  )
}

const copyReply = async ($: EngineInterface, surface: RenderSurface) => {
  const text = replySince(await $.session.messages(), await read($, lastPrompt))
  if (text === '') {
    $.ui.toast('Nessuna risposta di Claude da copiare')
    return
  }

  await copyText($, surface, text, 'Risposta copiata')
}

const copyInput = async ($: EngineInterface, surface: RenderSurface) => {
  const text = (await read($, lastPrompt)) ?? lastPromptIn(await $.session.messages())
  if (text.trim() === '') {
    $.ui.toast('Nessun tuo messaggio da copiare')
    return
  }

  await copyText($, surface, text, 'Input copiato')
}

// Senza segnaposto la bozza si copia subito; con un incollato compresso si arma
// l'Invio, che la porta al prompt.submit qui sotto già espansa.
const copyDraft = async ($: EngineInterface, surface: RenderSurface) => {
  const { text } = await $.prompt.read()
  if (text.trim() === '') {
    $.ui.toast('Il prompt è vuoto')
    return
  }
  if (!PASTE_CHIP.test(text)) {
    await copyText($, surface, text, 'Bozza copiata')
    return
  }

  const now = await $.clock.now()
  await update($, draftArmedUntil, () => now + ARM_MS)
  $.ui.toast('Premi Invio entro 30 s: copio la bozza intera, senza inviarla', { timeoutMs: ARM_MS })
}

// Copia la bozza espansa e ferma l'invio. Se il motore ha già svuotato il prompt
// la rimette dov'era: un testo lungo lo richiude da sé in un segnaposto.
const keepDraft = async ($: EngineInterface, text: string) => {
  const copied = await $.ui.copy({ text })
  $.clock.after(200, () => {
    void $.prompt
      .read()
      .then(box => (box.text === '' ? $.prompt.fill({ text }) : undefined))
      .catch(() => $.ui.toast('La bozza è negli appunti, ma non sono riuscito a rimetterla nel prompt'))
  })

  return {
    drop: copied.isCopied
      ? `Bozza copiata: ${text.length} caratteri. Non è stata inviata.`
      : `Copia non riuscita (${copied.reason}). La bozza non è stata inviata.`,
  }
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' && e.command === undefined) {
      const armedUntil = await read($, draftArmedUntil)
      if (armedUntil !== null) {
        await update($, draftArmedUntil, () => null)
        if (armedUntil >= (await $.clock.now())) return keepDraft($, e.text)
      }
    }

    if (PERSON.has(e.origin.kind)) await update($, lastPrompt, () => e.text)

    return next(e)
  })

  // Il footer a destra del prompt: le etichette di modalità come le scrive il
  // motore (dim, unite da ` & `), poi i pulsanti.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const modes = e.props.modes.join(' & ')

    return (
      <Box flexDirection="row" columnGap={1}>
        {modes !== '' && <Text dimColor>{modes}</Text>}
        <Button
          key="copia"
          label="[CP]"
          plain
          dimColor
          onPress={press => void copyReply($, press.surface)}
        />
        <Button
          key="copia-input"
          label="[IN]"
          plain
          dimColor
          onPress={press => void copyInput($, press.surface)}
        />
        <Button
          key="copia-bozza"
          label="[BZ]"
          plain
          dimColor
          onPress={press => void copyDraft($, press.surface)}
        />
      </Box>
    )
  })
}
