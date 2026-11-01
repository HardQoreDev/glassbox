# claude-code-mods

I mod di Claude Code di HardQoreDev. Un mod cambia l'interfaccia o il comportamento di Claude Code dall'interno: pannelli, pulsanti, comandi. Servono Claude Code 2.1.287 o successivo (provati con la 2.1.314).

## I mod

### Glassbox

Claude Code come una scatola di vetro invece che una scatola nera: un pannello a destra della sessione che mostra cosa succede intorno all'agente, in quattro sezioni, ognuna con la sua barretta colorata:

- **HOOKS**: gli hook della sessione, raggruppati per evento: quelli delle tue impostazioni (utente, progetto, locale, `--settings`, organizzazione) e quelli dei plugin abilitati. Ognuno ha un nome che dice cosa fa, da dove viene e il pulsante `ON` / `OFF`, che lo spegne solo in questa sessione; un clic sul nome mostra il comando, il file e il timeout. Quelli che non si possono spegnere (`ALWAYS` e `MANAGED`) partono nascosti, contati accanto al titolo: il pulsante `always` li mostra e li nasconde. Si spengono gli hook scritti con `hook-switch`: vedi [Spegnere gli hook](#spegnere-gli-hook-la-regola-hook-switch).
- **GIT**: la vista **active** (quella di partenza) è uno schema dei branch ancora in corso. In alto c'è il principale (quello a cui punta HEAD del remoto, se no `main` o `master`), e sotto sono appesi i branch con commit che lui non ha, più quello attuale e quelli aperti in un worktree. Ogni riga dice `+N −M` (commit in più e in meno del principale) e com'è messa sul remoto: `↑` da spingere e `↓` da tirare giù, poi `last sync` con il tempo dall'ultima sincronizzazione (l'ultimo push o fetch che ha spostato il branch remoto, o l'ultimo fetch che l'ha visto dov'è), `local` se non è mai stato spinto, `gone` se è stato cancellato sul remoto, `remote` se c'è solo là. I branch già uniti sono contati in una riga che, con un clic, li elenca. Un clic su un branch mostra l'ultimo commit e quando è stato fatto, il confronto a parole, l'ultima sincronizzazione e il worktree in cui è aperto. La vista **full** è il grafo dei commit di tutti i branch, come in VS Code, con una corsia colorata per ramo; un clic su un commit mostra hash, autore e data.
- **FILES**: i file modificati nella sessione con le righe inserite e cancellate (vista `changed`), oppure l'albero delle cartelle con lo stato git (vista `tree`). Un clic su un file modificato apre l'anteprima: il file com'è adesso, con le righe aggiunte in verde e quelle tolte in rosso rispetto a prima della sessione; le righe troppo larghe si leggono con lo slider in fondo, oppure vanno a capo con `wrap`. L'icona `↗` accanto a ogni file lo apre in VS Code (con il suo comando `code`); se non c'è, con l'applicazione predefinita del sistema (in WSL quella di Windows).
- **CONTEXT**: ogni richiesta al modello con input, output e finestra di contesto. Le voci della legenda sotto la barra (`system`, `earlier`, `new`, `output`) sono cliccabili e mostrano, al posto delle sezioni, esattamente quello che entra nel contesto dell'ultima richiesta: il prompt di sistema a sezioni con gli strumenti, la conversazione che la richiesta si porta dietro messaggio per messaggio, quello che porta di nuovo (il prompt o le risposte degli strumenti) e la risposta del modello. Lo stesso fanno i blocchi di un turno aperto, per quel turno. `↗` scrive il testo in un file Markdown e lo apre in VS Code. Il pulsante `stats` apre una tendina con i numeri della sessione (contesto caricato prima della prima domanda, contesto in uso e quanto cresce a richiesta, cache, output e ragionamento, strumenti più usati e quanto pesano le loro risposte, contesto per categoria) e i consigli per tenerlo snello: per esempio, se prima della prima domanda è già pieno oltre il 20%, quali server MCP o file di memoria pesano di più.

Si apre con `/glassbox` e si chiude con `/glassbox close`. Nel terminale sta a destra con il layout a schermo intero (`/tui fullscreen`) e almeno 110 colonne; altrimenti compare sopra il prompt. Dettagli in [`mods/glassbox/README.md`](mods/glassbox/README.md).

#### Spegnere gli hook: la regola `hook-switch`

Con un account Team o Enterprise, Claude Code mette davanti a tutti un suo plugin di sicurezza che non passa ai mod gli eventi degli hook: un mod non può fermare un hook. Per questo gli hook si scrivono in modo che si spengano da soli:

```json
{ "type": "command",
  "command": "~/.claude/hooks/hook-switch blocca-scritture-fuori-progetto ~/.claude/hooks/confine-writes.sh" }
```

`hook-switch <nome> <comando>` lancia il comando con lo stesso input e lo stesso codice di uscita, a meno che `<nome>` sia nella variabile `HOOK_SWITCH_OFF` (nomi separati da spazi): allora esce senza fare niente. Il nome è una parola sola con i trattini e dice cosa fa l'hook (`blocca-scritture-fuori-progetto`, `segnala-sessione-a-herdr`): Glassbox lo usa come titolo della riga. Il pulsante `OFF` cambia quella variabile solo nella sessione in cui lo premi, e ha effetto subito; le altre sessioni non la vedono. Una sessione può anche partire con un hook già spento: `HOOK_SWITCH_OFF="segnala-sessione-a-herdr" claude`.

Lo script è in [`mods/glassbox/bin/hook-switch`](mods/glassbox/bin/hook-switch) e serve `sh` (Linux, macOS, WSL). Dalla cartella della repo:

```bash
install -m 755 mods/glassbox/bin/hook-switch ~/.claude/hooks/hook-switch
```

- Un hook scritto senza `hook-switch` si vede con il nome del suo script e `ALWAYS` al posto del pulsante.
- Gli hook dell'organizzazione (`MANAGED`) non si spengono.
- Gli hook dei plugin compaiono con il nome del plugin. Si spengono solo se il plugin li scrive con `hook-switch`, portandosi dietro la sua copia dello script: `"${CLAUDE_PLUGIN_ROOT}/hooks/hook-switch" <nome> <comando>`.
- Uno strumento che riscrive il proprio hook nelle impostazioni (herdr quando si aggiorna, per esempio) può togliere `hook-switch`: la riga torna `ALWAYS`.
- Non c'è uno spegnimento permanente in un file, perché quel file potrebbe scriverlo anche Claude. La variabile della sessione la cambia solo Glassbox: i comandi lanciati da Claude hanno un ambiente loro.

### copia-risposta

Tre pulsanti in basso a destra, accanto al prompt:

- `[CP]` copia tutto il testo di Claude dopo il tuo ultimo messaggio;
- `[IN]` copia il tuo ultimo messaggio, con i testi incollati per intero;
- `[BZ]` copia quello che hai scritto nel prompt e non hai ancora inviato. Se contiene un testo incollato compresso (`[Pasted text #1 +N lines]`), premi `[BZ]` e poi Invio entro 30 secondi: la bozza viene copiata per intero e non parte.

## Installazione

La repo è privata: serve accesso all'organizzazione HardQoreDev su GitHub e git configurato sul tuo computer (SSH o `gh auth login`).

Al prompt di una sessione di Claude Code:

```
/plugin install glassbox --marketplace HardQoreDev/claude-code-mods
/plugin install copia-risposta --marketplace HardQoreDev/claude-code-mods
```

Rispondi `y` per aggiungere il marketplace, poi scegli dove installare. Da una shell è lo stesso:

```bash
claude plugin install glassbox --marketplace HardQoreDev/claude-code-mods
claude plugin install copia-risposta --marketplace HardQoreDev/claude-code-mods
```

Poi apri una nuova sessione. Per gli aggiornamenti: `claude plugin update glassbox` (e lo stesso per `copia-risposta`), poi `/reload-plugins`.

Se carichi già questi mod da una cartella con `CLAUDE_CODE_PLUGIN_DIRS`, non installarli anche dal marketplace: avresti due plugin con lo stesso nome.

## Sviluppare

```bash
git clone git@github.com:HardQoreDev/claude-code-mods.git
cd claude-code-mods
claude --plugin-dir mods/glassbox      # una sessione con il mod caricato dalla cartella
claude plugin validate mods/glassbox   # quello che Claude Code rifiuterebbe
claude plugin test mods/glassbox       # i test in mods/glassbox/tests
```

Con `--plugin-dir` (o con la cartella in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`) la sessione ricarica il mod a ogni salvataggio. Quando Claude Code carica un mod scrive i suoi tipi in `.claude-plugin/types/`; da lì `npx -p typescript tsc -p mods/glassbox --noEmit` controlla i tipi. Quella cartella non va in git.

Prima di aprire una pull request: `claude plugin validate` e `claude plugin test` puliti per il mod che hai toccato.

## Codice di terze parti

`glassbox` contiene codice ripreso da [filetree](https://github.com/data-goblin/claude-code-filetree) e da [turn-inspector](https://github.com/davila7/claude-code-templates), entrambi con licenza MIT: dettagli in [`mods/glassbox/THIRD-PARTY.md`](mods/glassbox/THIRD-PARTY.md).
