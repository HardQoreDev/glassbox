declare module 'claude-code' {
  interface PluginState {
    'copia-risposta': { lastPrompt: string | null; draftArmedUntil: number | null }
  }
}
