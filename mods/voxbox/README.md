# Voxbox

Il gemello di Glassbox, nello stesso posto a destra della sessione: invece di guardare dentro l'agente, lo **ascolti**. Prende un testo, che può essere una selezione fatta col mouse o l'ultima risposta di Claude. Te lo mostra così com'è, srotolato in prosa o ridotto all'osso, e lo legge ad alta voce con una voce italiana che gira sul tuo computer.

VOX e SYNTH li scrive un modello **dall'interno della sessione**, senza chiedere a Claude un'altra risposta nella chat. Il contesto di lavoro resta pulito e si spendono meno token che a chiedere "riscrivilo meglio".

## Il pannello

```
  █ █ █▀█ ▀▄▀ █▄▄ █▀█ ▀▄▀                          v0.1.0
  ▀▄▀ █▄█ █ █ █▄█ █▄█ █ █                  hear the agent
                                               ⇄ glassbox
  [ ● REC ][ + ]                            [ CP ]
  testo catturato · 238 parole · REC

  RAW | VOX | SYNTH✎
  ◂ 5 righe ▸ fast | deep
  ──────────────────────────────────────────
  …il testo…
                                             ✎ 🗑
  ──────────────────────────────────────────
  [ ▶ ] [ ■ ] − 1.0× +  ≈ 1′30″
  Haiku · 2.4 s · 238 parole
```

- **⇄ glassbox**, sotto il motto (o un clic sul logo), restituisce il pannello a Glassbox, con una transizione di circa un terzo di secondo: le lettere passano da un logo all'altro e la luce scorre da una sfumatura all'altra; **⇄ voxbox**, sotto il motto di Glassbox, riporta qui. È un pannello solo, quello di Glassbox, e le due mod ci disegnano a turno: lo scambio è istantaneo, a qualsiasi larghezza.
- **REC** apre la porta alle copie. Premi REC, selezioni un testo in herdr (che lo copia da solo, `copy_on_select`), e il testo arriva qui. Dopo 60 secondi senza copie e senza modifiche al testo si spegne da solo. Mentre è spento nessun processo guarda gli appunti; ripremerlo lo spegne.
- **1 / +**, accanto a REC, è il modo: un pulsante solo che dice quello attivo e lo scambia. `1` = sostituisci, `+` = concatena (lo ricorda anche la riga sotto, a pannello vuoto).
  - sostituisci: la copia prende il posto del testo di prima, e REC si spegne. Per la prossima va ripremuto.
  - concatena: ogni copia si aggiunge in fondo, a capo, e REC **resta acceso**. Se herdr scrive la stessa selezione due volte di fila, la seconda si ignora. Punti, virgole o frasi in mezzo li scrivi nel testo con ✎; ogni copia e ogni modifica rimettono il timer a 60 secondi.
- **✎**, accanto al cestino, rende modificabile nel pannello il testo della vista aperta: in RAW il testo catturato (o l'ultima risposta), in VOX e SYNTH il testo generato. Dopo ✎ si clicca nel testo (Claude Code non lascia a un mod spostare il cursore nel pannello di un altro), si scrive, e **Invio** salva ed esce; **\ + Invio** va a capo. RAW è il testo di partenza: cambiarlo fa riscrivere VOX e SYNTH. In concatena le copie nuove arrivano in fondo a RAW anche mentre lo modifichi, e ogni modifica tiene acceso REC.
- **🗑**, in basso a destra nel riquadro del testo, svuota.
- **CP**, all'estrema destra, prende il testo di Claude dopo il tuo ultimo messaggio.
- **RAW** è il testo così com'è. **VOX** lo srotola in prosa: tabelle ed elenchi diventano un discorso spiegato. **SYNTH** lo riduce a poche righe telegrafiche. Si scrivono solo quando apri la vista, poi restano pronte finché la sorgente non cambia.
- **◂ ▸** modulano la lunghezza:
  - VOX: lungo come l'originale fino a 250 parole; oltre, ogni parola in più ne vale mezza. ▸ raddoppia e approfondisce, ◂ dimezza, fino a ×4 e ×1/4.
  - SYNTH: a gradini (fino a 60 parole 1 riga, 200 → 3, 500 → 5, 1000 → 7, oltre 9), mai più lunga dell'originale.
- **fast | deep**, sotto VOX e SYNTH:
  - fast: Haiku, con `$.model.complete`, vede solo il testo (e, per una selezione, la risposta da cui viene);
  - deep: un fork della sessione stessa, con `$.model.fork`, che conosce tutta la conversazione. Costa di più. ▸ oltre il livello base della Prosa passa da solo a deep (`deep (auto)`), perché approfondire senza contesto vuol dire inventare.
- **✎**, accanto alla vista scelta (VOX o SYNTH), apre nel pannello il suo prompt e, sotto, i suoi parametri (si clicca nel campo per scrivere; Invio salva) (`soglia=250 tetto=4`, `gradini=60:1,200:3,500:5,1000:7,oltre:9 parole_riga=12`). **salva** li applica, anche nelle sessioni dopo; **↺ default** rimette nei campi quelli di partenza (salva per tenerli); **chiudi** lascia tutto com'era. `{parole}`, `{righe}` e `{parole_riga}` li riempie la formula.
- **▶** legge la vista aperta, **■** la ferma subito, **− +** cambiano la velocità. Accanto c'è la durata stimata.

VOX e SYNTH sono sempre in italiano. Il testo letto passa prima da una pulizia: niente blocchi di codice, link, simboli markdown, caratteri grafici del terminale; i percorsi diventano il loro ultimo nome.

Si apre con `/voxbox` o dal titolo di Glassbox, e si chiude con `/voxbox close`.

## La voce

[Piper](https://github.com/OHF-Voice/piper1-gpl) con la voce `it_IT-serena-high`, tutto in locale: nessun testo esce dal computer per essere letto. Il motore (`bin/voxbox-tts.py`) parte alla prima lettura e resta carico; dopo 10 minuti senza letture si chiude da solo. Il primo pezzo di ogni lettura è corto, fino alla prima virgola, così la voce parte in circa un secondo.

L'audio esce **dal lato Windows**, con `voxbox-win.exe`: un player di poche righe che suona l'audio in streaming. Lo stesso programma ascolta anche gli appunti per REC. Si compila con il `csc.exe` del .NET Framework che c'è già in ogni Windows: niente download, niente sudo.

Per ora Voxbox richiede **WSL su Windows**.

## Installazione

Serve [uv](https://docs.astral.sh/uv/), un solo binario in `~/.local/bin`. Dalla cartella della repo:

```bash
mods/voxbox/bin/setup.sh
```

Lo script si può rilanciare, e rifà solo quello che manca:

| Cosa | Dove |
|---|---|
| Piper | `~/.local/share/voxbox/venv` |
| la voce (circa 114 MB) | `~/.local/share/voxbox/voices` |
| `voxbox-win.exe` | `%LOCALAPPDATA%\voxbox` |
| i percorsi per il mod | `~/.local/share/voxbox/config.json` |

Un'altra voce di Piper: `VOXBOX_VOICE=it_IT-paola-medium mods/voxbox/bin/setup.sh`.

Per disinstallare: `mods/voxbox/bin/setup.sh --uninstall`. I prompt modificati stanno nello store del plugin.
