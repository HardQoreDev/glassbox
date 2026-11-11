// Il nome che Glassbox aggiunge a `$` (mods/glassbox/types/index.d.ts,
// mods/glassbox/hooks/twin.ts): chi dei due disegna nel pannello condiviso.
// Dove Glassbox non è caricato le chiamate falliscono: Voxbox le fa con un
// catch e si apre in un pannello suo.
declare module 'claude-code' {
  interface EngineInterface {
    glassbox: {
      turn: () => Promise<'glassbox' | 'voxbox'>
      setTurn: (turn: 'glassbox' | 'voxbox') => Promise<void>
      join: () => Promise<void>
      show: (turn: 'glassbox' | 'voxbox') => Promise<void>
    }
  }
}
export {}
