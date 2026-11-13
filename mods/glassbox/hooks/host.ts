// Dove gira Glassbox. Nasce come mod di Claude Code; lo stesso codice gira
// anche in pi, dentro l'adattatore in `pi/` alla radice della repo, che prima
// di caricare register.tsx cambia questi valori. Qui dentro c'è solo quello che
// tra i due agenti è diverso e che il pannello deve sapere.
export const host = {
  /** Il comando che riprende una sessione dal suo id. */
  resume: (sessionId: string): string => `claude --resume ${sessionId}`,
  /** Le sezioni che l'agente non ha: in pi non ci sono hook da shell. */
  hidden: [] as string[],
  /** Il modello piccolo che scrive prosa e sintesi in fast, come lo chiama il pannello. */
  fast: 'Haiku',
}
