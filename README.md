# glassbox

I mod di Claude Code di HardQoreDev. Un mod cambia l'interfaccia o il comportamento di Claude Code dall'interno: pannelli, pulsanti, comandi. Servono Claude Code 2.1.287 o successivo (provati con la 2.1.314).

## I mod

### Glassbox

Claude Code come una scatola di vetro invece che una scatola nera: un pannello a destra della sessione che mostra cosa succede intorno all'agente, in sette sezioni, ognuna con la sua barretta colorata (VOX e SYNTH partono chiuse: si aprono dal titolo, o al primo dei loro comandi):

- **HOOKS**: gli hook della sessione, raggruppati per evento: quelli delle tue impostazioni (utente, progetto, locale, `--settings`, organizzazione) e quelli dei plugin abilitati. Ognuno ha un nome che dice cosa fa, da dove viene e il pulsante `ON` / `OFF`, che lo spegne solo in questa sessione; un clic sul nome mostra il comando, il file e il timeout. Quelli che non si possono spegnere (`ALWAYS` e `MANAGED`) partono nascosti, contati accanto al titolo: il pulsante `always` li mostra e li nasconde. Si spengono gli hook scritti con `hook-switch`: vedi [Spegnere gli hook](#spegnere-gli-hook-la-regola-hook-switch).
- **GIT**: la vista **active** (quella di partenza) è uno schema dei branch ancora in corso. In alto c'è il principale (quello a cui punta HEAD del remoto, se no `main` o `master`), e sotto sono appesi i branch con commit che lui non ha, più quello attuale e quelli aperti in un worktree. Ogni riga dice `+N −M` (commit in più e in meno del principale) e com'è messa sul remoto: `↑` da spingere e `↓` da tirare giù, poi `last sync` con il tempo dall'ultima sincronizzazione (l'ultimo push o fetch che ha spostato il branch remoto, o l'ultimo fetch che l'ha visto dov'è), `local` se non è mai stato spinto, `gone` se è stato cancellato sul remoto, `remote` se c'è solo là. I branch già uniti sono contati in una riga che, con un clic, li elenca. Un clic su un branch mostra l'ultimo commit e quando è stato fatto, il confronto a parole, l'ultima sincronizzazione e il worktree in cui è aperto. La vista **full** è il grafo dei commit di tutti i branch, come in VS Code, con una corsia colorata per ramo; un clic su un commit mostra hash, autore e data. La vista **tags** elenca i tag dal più recente, `◆` gli annotati e `◇` i leggeri, quello su HEAD in evidenza. Ogni riga dice quanti commit il principale ha fatto dopo il tag (`N since`, cioè quello che non è ancora in un rilascio), `off trunk` se il tag sta su un commit che il principale non ha, `local` se il remoto non ce l'ha e `moved` se il remoto ce l'ha su un altro commit. Il remoto si interroga con `git ls-remote` quando la vista si apre, con `↻` e dopo un `git push` fatto da Claude, mai di continuo. Un clic su un tag mostra il messaggio, il commit, chi l'ha messo e quando, il confronto con il principale e il comando per spingerlo se manca.
- **FILES**: i file modificati nella sessione con le righe inserite e cancellate, anche quelli cambiati da un comando di shell come `sed -i` (vista `changed`), oppure l'albero delle cartelle con lo stato git (vista `tree`), oppure i file che sta cambiando anche un'altra sessione aperta (vista `guard`). La parola `guard` nel titolo si accende in rosso, con quanti file, quando questa sessione e un'altra hanno tutte e due lavoro non salvato nello stesso file: modifiche non committate e nessun commit dopo le loro scritture (fuori da git, scritture dell'ultimo giorno). Sotto ogni file, le altre sessioni che l'hanno scritto e quando; un clic porta herdr sul loro pane. Un toast lo dice una volta, e nella vista `changed` il file ha `▲`. Quello che scrivono le altre sessioni viene dai loro transcript (gli `Edit` e `Write` riusciti, non i comandi di shell), letti una volta sola e poi solo nelle righe nuove. Un clic su un file modificato apre l'anteprima: il file com'è adesso, con le righe aggiunte in verde e quelle tolte in rosso rispetto a prima della sessione; le righe troppo larghe si leggono con lo slider in fondo, oppure vanno a capo con `wrap`. L'icona `↗` accanto a ogni file lo apre in VS Code (con il suo comando `code`); se non c'è, con l'applicazione predefinita del sistema (in WSL quella di Windows).
- **CONTEXT**: ogni richiesta al modello con input, output e finestra di contesto. Le voci della legenda sotto la barra (`system`, `earlier`, `new`, `output`) sono cliccabili e mostrano, al posto delle sezioni, esattamente quello che entra nel contesto dell'ultima richiesta: il prompt di sistema a sezioni con gli strumenti, la conversazione che la richiesta si porta dietro messaggio per messaggio, quello che porta di nuovo (il prompt o le risposte degli strumenti) e la risposta del modello. Lo stesso fanno i blocchi di un turno aperto, per quel turno. `↗` scrive il testo in un file Markdown e lo apre in VS Code. Il pulsante `stats` apre una tendina pensata per il context engineering, in cinque viste: **health** (contesto in uso e quanto cresce a richiesta, quanto è caricato prima della prima domanda, quanto si potrebbe togliere, la cache, tutti i consigli), **fill** (di cosa è fatta l'ultima richiesta, dai messaggi che ha mandato davvero: risposte e chiamate degli strumenti, testo e ragionamento del modello, prompt, reminder; i cinque blocchi più pesanti, che con un clic si aprono al loro posto nella richiesta; il contesto per categoria come lo conta `/context`), **waste** (risposte vecchie di 10 o più richieste, ripetute identiche, fallite; server MCP e skill caricati e mai usati), **flow** (quanto si manda in tutto, dove si è rotta la cache, le compattazioni e quanto hanno liberato, i subagent e quanto contesto hanno tenuto fuori) e **tools** (gli strumenti più usati e quanto pesano le loro risposte). I consigli escono da soglie scritte in `hooks/stats.ts`: per esempio, se prima della prima domanda il contesto è già pieno oltre il 20%, se un server MCP pesato in ogni richiesta non è mai stato chiamato, se lo stesso file è tornato identico più volte. Il pulsante `analyze` chiede a Claude di rileggere il proprio contesto com'era all'ultima richiesta, insieme ai numeri della tendina, e di giudicarlo da context engineer: cosa contiene, cosa pesa senza servire (nominato uno per uno), cosa fare adesso (per esempio `/compact` con le istruzioni già scritte, oppure `/clear` e ripartire), le abitudini da cambiare e un brief per ricominciare da una sessione nuova. La risposta si apre nella finestra di contesto; `↻` la richiede. L'analisi rimanda il contesto con `$.model.fork`, senza strumenti: se la cache è ancora calda si paga come lettura dalla cache, altrimenti per intero, e il costo compare accanto al titolo.
- **SESSIONS**: le sessioni di Claude Code aperte sulla macchina, questa in cima, ognuna con il suo contesto e lo stato della cache dei prompt, che dura un'ora dall'ultima richiesta: `◐ working` lavora, `◆ needs you` è ferma su una tua risposta o un permesso, `● 41m left` è calda con i minuti che le restano (gialli sotto i dieci), `○ reload` è fredda con 150k o più di contesto e il prossimo messaggio la riscrive tutta in cache (costa come una ventina di messaggi a cache calda), `○ cold` è fredda ma leggera, `◌ compacted` è stata compattata. Se le sessioni girano in [herdr](https://herdr.dev), ogni riga mostra il titolo del suo terminale (su cosa sta lavorando) e un clic sul nome porta herdr sul suo pane; `▸` in fondo alla riga apre i dettagli: il nome nel registro, la cartella, il pane, cosa costa tornarci e il comando `claude --resume`. La sessione corrente sta in cima, con la barretta `▌` e **this** prima del nome, e resta lì quando la sezione scorre. Una sessione che aspetta i suoi agenti (una revisione, una ricerca) non è ferma: mostra `◐ 2 agents` e glassbox le tiene calda la cache, con una richiesta minima cinque minuti prima che scada che rilegge il contesto dalla cache (costa circa un ventesimo di riscriverlo); il rinfresco si segna in un file per sessione, che possono leggere anche la status line e gli hook. Anche a pannello chiuso, un toast avvisa cinque minuti prima che scada una cache pesante e ferma, di questa sessione o di un'altra, ma non per chi ha agenti al lavoro. L'elenco lo dà `bin/sessions.py` (serve `python3`) leggendo il registro delle sessioni di Claude Code (`~/.claude/sessions/`) e la coda dei transcript; il risultato si condivide tra le sessioni per 45 secondi, così venti sessioni aperte non rifanno lo stesso lavoro.
- **VOX**: un testo da leggere e da ascoltare. `rec` apre la porta alle copie: selezioni un testo nel terminale (herdr lo copia da solo, `copy_on_select`) e arriva qui; `1` vuol dire che la copia sostituisce il testo, `+` che si aggiunge in fondo, e allora `rec` resta acceso. `cp` prende invece l'ultima risposta di Claude. `▶` lo legge ad alta voce con una voce italiana che gira sul tuo computer, e mentre legge diventa `■`; `✕` svuota. Sotto il titolo, **raw** mostra il testo com'è e **prose** lo srotola in prosa parlata (tabelle ed elenchi diventano un discorso), con `◂ ▸` per la lunghezza; `edit` lo apre in un campo per ritoccarlo, `− +` cambiano la velocità della voce.
- **SYNTH**: lo stesso testo ridotto a poche righe telegrafiche. `write` la scrive (poi `↻` la riscrive), `◂ ▸` cambiano il numero di righe, `▶` legge la sintesi. Prosa e sintesi le scrive Haiku dall'interno della sessione (`fast`) oppure un fork della sessione che ne conosce il contesto (`deep`), senza aggiungere risposte alla chat; `prompt` apre il loro prompt e i parametri, che restano salvati.

#### Il registro delle sessioni

Claude Code salva già da solo la trascrizione di ogni sessione in `~/.claude/projects/<progetto>/<id>.jsonl`, ma la cancella dopo 30 giorni (`cleanupPeriodDays`) e non conserva quello che ogni richiesta ha mandato davvero. Glassbox salva ogni richiesta del ciclo principale in `~/.claude/glassbox/sessions/<progetto>/<id sessione>/`:

- `session.json`: il riassunto, aggiornato a ogni richiesta. Contiene il primo prompt, i modelli, le richieste, i token (input, cache letta e scritta, output), il contesto dell'ultima richiesta e il più grande, le compattazioni, il `/context` dell'ultimo turno, gli strumenti chiamati, i subagent, le analisi e il comando `claude --resume` per riprenderla;
- `requests/0001.json`, una per richiesta: i token, la risposta del modello e i messaggi. Ogni richiesta dice quanti messaggi tiene uguali dalla precedente (`keep`) e riporta solo quelli nuovi, quindi il contesto della richiesta k è quello della k-1 tagliato a `keep` più i suoi `messages` (`replay` in `hooks/record.ts` lo ricostruisce). Dopo una compattazione `keep` è 0;
- `system/01.json`: il prompt di sistema e gli strumenti; un file nuovo solo quando cambiano;
- `analyses/*.md`: le analisi chieste con `analyze`.

Una sessione ripresa continua nella stessa cartella. Nella tendina, la vista **flow** dice quante richieste sono registrate e quanto pesano su disco. Il registro contiene tutto quello che è passato nel contesto, compresi i file letti, quindi va trattato come le trascrizioni di Claude Code. Si spegne o si sposta dalle opzioni del plugin (`recordSessions`, `sessionsDir`, nel menu `/config` o in `pluginConfigs` delle impostazioni).

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

#### La voce di VOX e SYNTH

`cp`, la prosa e la sintesi funzionano ovunque. Per `▶` e `rec` serve la voce, [Piper](https://github.com/OHF-Voice/piper1-gpl) con `it_IT-serena-high`, tutta in locale: per ora richiede **WSL su Windows**, perché l'audio esce dal lato Windows e da lì si leggono gli appunti. Si installa una volta, senza sudo, con [uv](https://docs.astral.sh/uv/) già presente:

```bash
mods/glassbox/bin/vox-setup.sh
```

Finché manca, VOX lo dice e mostra il percorso dello script nella copia installata del plugin. Dettagli in [`mods/glassbox/README.md`](mods/glassbox/README.md#vox-and-synth-read-and-listen).

### copia-risposta

Tre pulsanti in basso a destra, accanto al prompt:

- `[CP]` copia tutto il testo di Claude dopo il tuo ultimo messaggio;
- `[IN]` copia il tuo ultimo messaggio, con i testi incollati per intero;
- `[BZ]` copia quello che hai scritto nel prompt e non hai ancora inviato. Se contiene un testo incollato compresso (`[Pasted text #1 +N lines]`), premi `[BZ]` e poi Invio entro 30 secondi: la bozza viene copiata per intero e non parte.

## Installazione

La repo è privata: serve accesso all'organizzazione HardQoreDev su GitHub e git configurato sul tuo computer (SSH o `gh auth login`).

Al prompt di una sessione di Claude Code:

```
/plugin install glassbox --marketplace HardQoreDev/glassbox
/plugin install copia-risposta --marketplace HardQoreDev/glassbox
```

Rispondi `y` per aggiungere il marketplace, poi scegli dove installare. Da una shell è lo stesso:

```bash
claude plugin install glassbox --marketplace HardQoreDev/glassbox
claude plugin install copia-risposta --marketplace HardQoreDev/glassbox
```

Poi apri una nuova sessione. Per gli aggiornamenti: `claude plugin update glassbox` (e lo stesso per `copia-risposta`), poi `/reload-plugins`.

Se carichi già questi mod da una cartella con `CLAUDE_CODE_PLUGIN_DIRS`, non installarli anche dal marketplace: avresti due plugin con lo stesso nome.

## Sviluppare

```bash
git clone git@github.com:HardQoreDev/glassbox.git
cd glassbox
claude --plugin-dir mods/glassbox      # una sessione con il mod caricato dalla cartella
claude plugin validate mods/glassbox   # quello che Claude Code rifiuterebbe
claude plugin test mods/glassbox       # i test in mods/glassbox/tests
python3 -I mods/glassbox/tests/sessions_helper_test.py   # il test di bin/sessions.py
```

Con `--plugin-dir` (o con la cartella in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`) la sessione ricarica il mod a ogni salvataggio. Quando Claude Code carica un mod scrive i suoi tipi in `.claude-plugin/types/`; da lì `npx -p typescript tsc -p mods/glassbox --noEmit` controlla i tipi. Quella cartella non va in git.

Prima di aprire una pull request: `claude plugin validate` e `claude plugin test` puliti per il mod che hai toccato.

## Codice di terze parti

`glassbox` contiene codice ripreso da [filetree](https://github.com/data-goblin/claude-code-filetree) e da [turn-inspector](https://github.com/davila7/claude-code-templates), entrambi con licenza MIT: dettagli in [`mods/glassbox/THIRD-PARTY.md`](mods/glassbox/THIRD-PARTY.md).
