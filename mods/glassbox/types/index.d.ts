// Il nome che Glassbox aggiunge a `$` per Voxbox: chi dei due disegna nel
// pannello (vedi hooks/twin.ts).
export type GlassboxTurn = 'glassbox' | 'voxbox'

export type Glassbox = {
  /** Chi disegna adesso nel pannello. */
  turn: () => Promise<GlassboxTurn>
  /** Passa il pannello a uno dei due, e lo ridisegna. */
  setTurn: (turn: GlassboxTurn) => Promise<void>
  /** Voxbox si annuncia: il titolo di Glassbox diventa lo scambio. */
  join: () => Promise<void>
  /** Apre il pannello sul turno dato. */
  show: (turn: GlassboxTurn) => Promise<void>
}

declare module 'claude-code' {
  interface EngineInterface {
    glassbox: Glassbox
  }
}
