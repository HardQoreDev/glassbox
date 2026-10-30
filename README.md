# claude-code-mods

I mod di Claude Code di HardQoreDev. Un mod cambia l'interfaccia o il comportamento di Claude Code dall'interno: pannelli, pulsanti, comandi. Servono Claude Code 2.1.287 o successivo (provati con la 2.1.314).

## I mod

### barra-laterale

Una barra a destra in quattro sezioni, ognuna con la sua barretta colorata:

- **HOOKS**: gli hook delle tue impostazioni, uno per riga con un pulsante `ON` / `OFF`. `OFF` vale solo per la sessione e non tocca `settings.json`. Quando un hook scatta, il nome si illumina: giallo mentre gira, verde se è passato, rosso se ha bloccato, grigio se è stato saltato.
- **BRANCHES**: il grafo dei commit di tutti i branch, come in VS Code, con una corsia colorata per ramo. Un clic su un commit mostra hash, autore e data.
- **FILES**: i file modificati nella sessione con le righe inserite e cancellate (vista `changed`), oppure l'albero delle cartelle con lo stato git (vista `tree`).
- **TURNS**: ogni richiesta al modello con input, output e finestra di contesto.

Si apre con `/sidebar` e si chiude con `/sidebar close`. Nel terminale sta a destra con il layout a schermo intero (`/tui fullscreen`) e almeno 110 colonne; altrimenti compare sopra il prompt. Dettagli in [`mods/barra-laterale/README.md`](mods/barra-laterale/README.md).

### copia-risposta

Tre pulsanti in basso a destra, accanto al prompt:

- `[CP]` copia tutto il testo di Claude dopo il tuo ultimo messaggio;
- `[IN]` copia il tuo ultimo messaggio, con i testi incollati per intero;
- `[BZ]` copia quello che hai scritto nel prompt e non hai ancora inviato. Se contiene un testo incollato compresso (`[Pasted text #1 +N lines]`), premi `[BZ]` e poi Invio entro 30 secondi: la bozza viene copiata per intero e non parte.

## Installazione

La repo è privata: serve accesso all'organizzazione HardQoreDev su GitHub e git configurato sul tuo computer (SSH o `gh auth login`).

Al prompt di una sessione di Claude Code:

```
/plugin install barra-laterale --marketplace HardQoreDev/claude-code-mods
/plugin install copia-risposta --marketplace HardQoreDev/claude-code-mods
```

Rispondi `y` per aggiungere il marketplace, poi scegli dove installare. Da una shell è lo stesso:

```bash
claude plugin install barra-laterale --marketplace HardQoreDev/claude-code-mods
claude plugin install copia-risposta --marketplace HardQoreDev/claude-code-mods
```

Poi apri una nuova sessione. Per gli aggiornamenti: `claude plugin update barra-laterale` (e lo stesso per `copia-risposta`), poi `/reload-plugins`.

Se carichi già questi mod da una cartella con `CLAUDE_CODE_PLUGIN_DIRS`, non installarli anche dal marketplace: avresti due plugin con lo stesso nome.

## Sviluppare

```bash
git clone git@github.com:HardQoreDev/claude-code-mods.git
cd claude-code-mods
claude --plugin-dir mods/barra-laterale      # una sessione con il mod caricato dalla cartella
claude plugin validate mods/barra-laterale   # quello che Claude Code rifiuterebbe
claude plugin test mods/barra-laterale       # i test in mods/barra-laterale/tests
```

Con `--plugin-dir` (o con la cartella in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`) la sessione ricarica il mod a ogni salvataggio. Quando Claude Code carica un mod scrive i suoi tipi in `.claude-plugin/types/`; da lì `npx -p typescript tsc -p mods/barra-laterale --noEmit` controlla i tipi. Quella cartella non va in git.

Prima di aprire una pull request: `claude plugin validate` e `claude plugin test` puliti per il mod che hai toccato.

## Codice di terze parti

`barra-laterale` contiene codice ripreso da [filetree](https://github.com/data-goblin/claude-code-filetree) e da [turn-inspector](https://github.com/davila7/claude-code-templates), entrambi con licenza MIT: dettagli in [`mods/barra-laterale/THIRD-PARTY.md`](mods/barra-laterale/THIRD-PARTY.md).
