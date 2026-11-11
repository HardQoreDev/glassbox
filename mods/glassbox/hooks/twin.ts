// Glassbox e Voxbox: un pannello solo, due mod che ci disegnano a turno.
//
// Il pannello è quello di Glassbox. `twin.turn` dice chi disegna: quando tocca
// a Voxbox, i hook di Glassbox sul pannello (disegno e rotella) passano oltre
// con `next(e)`, e Voxbox, che ha i suoi hook sullo stesso pannello, disegna al
// suo posto. Funziona in qualunque ordine l'engine metta le due mod: ognuna
// disegna solo nel suo turno. Nessun pannello si apre o si chiude, quindi lo
// scambio è istantaneo e non dipende dalla larghezza del terminale.
//
// Voxbox parla con Glassbox solo attraverso il nome `$.glassbox` (il contratto
// in types/index.d.ts, costruito in register.tsx a engine.create): legge il
// turno, lo cambia, si annuncia.
import type { GlassboxTurn } from '../types'

export const twin = {
  turn: 'glassbox' as GlassboxTurn,
  // Se Voxbox c'è: solo allora il titolo porta là.
  hasVoxbox: false,
}
