import type { SessionMessage } from 'claude-code'

// Una riga user che è un prompt: ha testo e non porta risultati di strumenti.
const isPrompt = (m: SessionMessage): boolean =>
  m.role === 'user' && (m.toolResults?.length ?? 0) === 0 && m.text.trim() !== ''

/** Il testo dell'ultima riga user che è un prompt; `''` se non ce n'è. */
export const lastPromptIn = (messages: readonly SessionMessage[]): string =>
  messages.findLast(isPrompt)?.text ?? ''

/**
 * Il testo di Claude dopo l'ultimo prompt della persona: i blocchi di testo
 * dei messaggi assistant, in ordine, separati da una riga vuota; le chiamate
 * agli strumenti restano fuori. Il prompt si riconosce dal testo ricordato
 * all'invio; senza, o se non lo si ritrova, è l'ultima riga user che è un prompt.
 */
export const replySince = (
  messages: readonly SessionMessage[],
  prompt: string | null,
): string => {
  const needle = prompt?.trim().slice(0, 120) ?? ''
  let start =
    needle === '' ? -1 : messages.findLastIndex(m => isPrompt(m) && m.text.includes(needle))
  if (start === -1) start = messages.findLastIndex(isPrompt)

  return messages
    .slice(start + 1)
    .filter(m => m.role === 'assistant')
    .map(m => m.text.trim())
    .filter(text => text !== '')
    .join('\n\n')
}
