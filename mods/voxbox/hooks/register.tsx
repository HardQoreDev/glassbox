// Voxbox: il gemello di Glassbox, nello stesso posto a destra. Prende un testo
// (una selezione copiata dopo ARMA, o l'ultima risposta di Claude), lo mostra
// RAW, in VOX (prosa: srotolato e spiegato) o in SYNTH (sintesi: asciutto), e
// lo legge ad alta voce con Piper. VOX e SYNTH le scrive Haiku dall'interno
// della sessione (fast) o un fork della sessione stessa, che ne conosce il
// contesto (deep): nessuna risposta in più nella chat.
// Cliccare il titolo passa il pannello a Glassbox, e da Glassbox si torna qui.
import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import { disarm, isArmed, listen } from './clip'
import { DEFAULTS, forkPrompt, paramsText, parseParams, quickRequest, revive, vars } from './prompts'
import type { Kind, Prompts } from './prompts'
import { shutdown, speak, speech, stop, watchSpeech } from './speech'
import type { Setup } from './speech'
import { MORPH_FRAMES, MORPH_MS, morphLines, titleLines } from './view-title'
import type { TitleOf } from './view-title'
import { cleanForSpeech, countWords, lastReply, listenTime, parseSteps, prosaLevels, sintesiLines, wrap } from './text'

const PANE = 'voxbox'
// Il pannello di Glassbox, condiviso a turno.
const GLASSBOX_PANE = 'glassbox'
const TITLE = 'Voxbox'
const COMMAND = 'voxbox'
// Larga come Glassbox, così lo scambio non sposta niente.
const COLUMNS = 64
const STORE_KEY = 'prompts'
const TITLE_MIN_ROWS = 20
const INDENT = '  '

const ACCENT = '#f472b6'
// Cosa dice il pannello vuoto.
const GUIDE = [
  'REC, poi seleziona un testo: la copia arriva qui, e qui si può modificare.',
  'CP prende l\'ultima risposta di Claude.',
  '',
  'VOX la srotola in prosa, SYNTH la riduce all\'osso: ◂ ▸ ne cambiano la lunghezza, ✎ il prompt.',
  '▶ legge ad alta voce la vista aperta, ■ la ferma.',
].join('\n')
const guideArmed = () =>
  st.mode === 'append'
    ? 'Seleziona i testi uno dopo l\'altro: si aggiungono qui in fondo, e puoi ritoccarli mentre REC resta acceso.'
    : 'Seleziona un testo: la prossima copia arriva qui.'
// Le colonne di un testo nel terminale: le emoji ne prendono due.
const cols = (text: string): number => Array.from(text).reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0)
// Il testo tagliato a `width` colonne, con … se non ci sta.
function fitText(text: string, width: number): string {
  if (cols(text) <= width) return text
  let out = ''
  for (const ch of Array.from(text)) {
    if (cols(out + ch) > width - 1) break
    out += ch
  }
  return `${out}…`
}

type View = 'raw' | Kind
// I nomi che il pannello mostra: PROSA è VOX, SINTESI è SYNTH.
const NAMES: Record<View, string> = { raw: 'RAW', prosa: 'VOX', sintesi: 'SYNTH' }

// REC resta acceso questo tempo senza copie né modifiche al testo, poi si spegne.
const ARM_SECONDS = 60
type Output = { text: string; ms: number; deep: boolean }

// ---- lo stato del pannello ----------------------------------------------

const st = {
  source: 'clip' as 'clip' | 'reply',
  // Il testo di RAW: la cattura o l'ultima risposta, e quello che ci scrivi tu.
  text: '',
  // Cresce quando il testo cambia da fuori (cattura, CP, svuota): il campo si ridisegna.
  textKey: 0,
  version: 0, // cresce a ogni cambio della sorgente: le uscite vecchie non valgono più
  mode: 'replace' as 'replace' | 'append',
  // REC: fin quando resta acceso (ms).
  armedUntil: 0,
  view: 'raw' as View,
  deep: false,
  level: { prosa: 0, sintesi: 0 } as Record<Kind, number>,
  speed: 1,
  offset: 0,
  busy: '',
  note: '',
  error: '',
  editing: undefined as Kind | undefined,
  draft: '',
  draftParams: '',
  editKey: 0,
}
const outputs = new Map<string, Output>()
let prompts: Prompts = DEFAULTS
let setup: Setup | undefined
let setupError = ''
let version = ''
let root = ''
// Fin dove scorre il testo all'ultimo disegno.
let maxOffset = 0

const redraw = ($: EngineInterface) => $.ui.invalidate('ui.render')

const sourceText = (): string => st.text
const effectiveDeep = (kind: Kind): boolean => st.deep || (kind === 'prosa' && st.level.prosa > 0)
const outputKey = (kind: Kind) => `${st.version}:${kind}:${st.level[kind]}:${effectiveDeep(kind)}`

function shownText(): string {
  if (st.view === 'raw') return sourceText()
  return outputs.get(outputKey(st.view))?.text ?? ''
}

// ---- le azioni -------------------------------------------------------------

async function loadSetup($: EngineInterface): Promise<void> {
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const data = (await $.env.get('XDG_DATA_HOME').catch(() => undefined)) || `${home}/.local/share`
  try {
    const raw = JSON.parse(await $.fs.read(`${data}/voxbox/config.json`)) as Partial<Setup>
    if (!raw.python || !raw.voice || !raw.win) throw new Error('config.json incompleto')
    setup = { python: raw.python, voice: raw.voice, win: raw.win }
    setupError = ''
  } catch {
    setup = undefined
    setupError = `Voce non installata: esegui ${root}/bin/setup.sh`
  }
}

// Con Glassbox, Voxbox disegna nel suo pannello quando è il suo turno; da solo,
// in un pannello suo (vedi mods/glassbox/hooks/twin.ts).
async function show($: EngineInterface): Promise<void> {
  try {
    await $.glassbox.show('voxbox')
    return
  } catch {
    // Glassbox non c'è: il pannello di Voxbox.
  }
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS, backgroundColor: 'transparent' })
}

// Di chi è il turno nel pannello di Glassbox; senza Glassbox, suo.
async function glassboxTurn($: EngineInterface): Promise<'glassbox' | 'voxbox'> {
  try {
    return await $.glassbox.turn()
  } catch {
    return 'glassbox'
  }
}

// La transizione tra i due titoli, che fa tutta Voxbox: all'arrivo (da
// Glassbox a Voxbox) e alla partenza (da Voxbox a Glassbox, poi il turno passa).
let morph: { from: TitleOf; to: TitleOf; start: number } | undefined
let morphTick = false
// Di chi era il turno all'ultimo disegno nel pannello di Glassbox.
let seenTurn: TitleOf = 'glassbox'

// Il titolo (o il logo) restituisce il pannello a Glassbox, dopo la transizione.
async function toGlassbox($: EngineInterface): Promise<void> {
  if (morph) return
  await disarmAll($, '')
  morph = { from: 'voxbox', to: 'glassbox', start: Date.now() }
  redraw($)
  $.clock.after(MORPH_FRAMES * MORPH_MS, () => {
    morph = undefined
    seenTurn = 'glassbox'
    void $.glassbox.setTurn('glassbox').catch(() => undefined)
  })
}

function setSource(change: () => void): void {
  change()
  st.textKey++
  st.version++
  st.view = 'raw'
  st.offset = 0
  st.error = ''
}

// Il timer di ARMA: un secondo alla volta ridisegna il conto alla rovescia e,
// allo scadere, spegne.
let tick: Timer | undefined

async function disarmAll($: EngineInterface, note: string): Promise<void> {
  tick?.cancel()
  tick = undefined
  st.armedUntil = 0
  await disarm()
  if (note) st.note = note
  redraw($)
}

/** Ogni copia, e ogni modifica al testo, rimette il timer di REC a 60 secondi. */
const renewArm = () => {
  if (isArmed()) st.armedUntil = Date.now() + ARM_SECONDS * 1000
}

// L'ultima copia presa: herdr può scrivere la stessa selezione negli appunti due
// volte di fila, e la seconda non va aggiunta.
let lastCopy = { text: '', at: 0 }
const DOUBLE_COPY_MS = 2000

function takeCopy($: EngineInterface, text: string): void {
  const clean = text.trim()
  const now = Date.now()
  if (clean === lastCopy.text && now - lastCopy.at < DOUBLE_COPY_MS) return
  lastCopy = { text: clean, at: now }
  setSource(() => {
    // In concatena la copia va in fondo, a capo: punti, virgole e il resto li scrivi tu nel testo.
    st.text = st.source === 'clip' && st.mode === 'append' && st.text.trim() !== '' ? `${st.text.trimEnd()}\n${clean}` : clean
    st.source = 'clip'
  })
  st.note = `Preso: ${countWords(clean)} parole.`
  if (st.mode === 'replace') void disarmAll($, '')
  else {
    renewArm()
    redraw($)
  }
}

async function pressArm($: EngineInterface): Promise<void> {
  if (isArmed()) {
    await disarmAll($, 'REC spento.')
    return
  }
  if (!setup) {
    st.error = setupError
    redraw($)
    return
  }
  st.note = ''
  st.error = ''
  st.armedUntil = Date.now() + ARM_SECONDS * 1000
  tick?.cancel()
  tick = $.clock.every(1000, () => {
    if (!isArmed()) return
    if (Date.now() >= st.armedUntil) void disarmAll($, '')
    else redraw($)
  })
  const listening = listen(
    $,
    setup.win,
    text => takeCopy($, text),
    error => {
      tick?.cancel()
      tick = undefined
      st.armedUntil = 0
      if (error) st.error = `ARMA: ${error}`
      redraw($)
    },
  )
  redraw($)
  await listening
}

async function pressReply($: EngineInterface): Promise<void> {
  const text = lastReply(await $.session.messages())
  if (text === '') {
    st.note = 'Nessuna risposta di Claude dopo il tuo ultimo messaggio.'
    redraw($)
    return
  }
  setSource(() => {
    st.text = text
    st.source = 'reply'
  })
  st.note = `Ultima risposta: ${countWords(text)} parole.`
  redraw($)
}

function pressClear($: EngineInterface): void {
  setSource(() => {
    st.text = ''
    st.source = 'clip'
  })
  outputs.clear()
  st.note = 'Svuotato.'
  redraw($)
}

async function generate($: EngineInterface, kind: Kind): Promise<void> {
  const text = sourceText()
  if (text.trim() === '') {
    st.note = 'Niente da rielaborare: premi ARMA e seleziona, oppure prendi l\'ultima risposta.'
    redraw($)
    return
  }
  const key = outputKey(kind)
  if (outputs.has(key) || st.busy) return
  const deep = effectiveDeep(kind)
  const words = countWords(cleanForSpeech(text))
  const values = vars(kind, prompts, words, st.level[kind])
  const isSelection = st.source === 'clip'
  st.busy = deep ? 'Il fork della sessione scrive…' : 'Haiku scrive…'
  st.error = ''
  redraw($)
  const t0 = Date.now()
  try {
    let reply: { isAnswered: true; text: string } | { isAnswered: false; reason: string }
    if (deep) {
      reply = await $.model.fork({ prompt: forkPrompt(kind, prompts, values, text, isSelection), effort: 'low' })
    } else {
      const context = isSelection ? lastReply(await $.session.messages()) : ''
      const request = quickRequest(kind, prompts, values, text, context && context !== text ? context : undefined)
      reply = await $.model.complete({ model: 'haiku', ...request, timeoutMs: 90_000 })
    }
    if (reply.isAnswered) outputs.set(key, { text: reply.text.trim(), ms: Date.now() - t0, deep })
    else st.error = `Nessun testo (${reply.reason})`
  } catch (err) {
    st.error = err instanceof Error ? err.message : String(err)
  } finally {
    st.busy = ''
    redraw($)
  }
}

function pressView($: EngineInterface, view: View): void {
  st.view = view
  st.offset = 0
  if (view !== 'raw') void generate($, view)
  redraw($)
}

function pressLevel($: EngineInterface, kind: Kind, by: number): void {
  const words = countWords(cleanForSpeech(sourceText()))
  const next = st.level[kind] + by
  if (kind === 'prosa') {
    const { min, max } = prosaLevels(prompts.prosa.params)
    if (next < min || next > max) {
      st.note = by > 0 ? 'VOX già al tetto.' : 'VOX già al minimo.'
      redraw($)
      return
    }
  } else if (sintesiLines(words, prompts.sintesi.params, next) === sintesiLines(words, prompts.sintesi.params, st.level.sintesi)) {
    st.note = by > 0 ? 'SYNTH già al massimo.' : 'SYNTH già al minimo.'
    redraw($)
    return
  }
  st.level[kind] = next
  pressView($, kind)
}

async function pressSpeak($: EngineInterface): Promise<void> {
  if (!setup) {
    st.error = setupError
    redraw($)
    return
  }
  const text = cleanForSpeech(shownText())
  if (text === '') {
    st.note = 'Niente da leggere in questa vista.'
    redraw($)
    return
  }
  try {
    await speak($, setup, root, text, st.speed)
  } catch (err) {
    st.error = `Voce: ${err instanceof Error ? err.message : String(err)}`
    redraw($)
  }
}

function openEditor($: EngineInterface, kind: Kind): void {
  st.editing = kind
  st.draft = prompts[kind].template
  st.draftParams = paramsText(kind, prompts)
  st.editKey++
  st.error = ''
  redraw($)
}

async function saveEditor($: EngineInterface): Promise<void> {
  const kind = st.editing
  if (!kind) return
  const withText: Prompts = { ...prompts, [kind]: { ...prompts[kind], template: st.draft.trim() === '' ? DEFAULTS[kind].template : st.draft } }
  const parsed = parseParams(kind, st.draftParams, withText)
  prompts = parsed.prompts
  await $.store.set(STORE_KEY, prompts)
  outputs.clear()
  st.editing = undefined
  st.note = parsed.errors.length > 0 ? `Salvato, ma: ${parsed.errors.join('; ')}` : 'Prompt salvato.'
  redraw($)
}

function resetEditor($: EngineInterface): void {
  const kind = st.editing
  if (!kind) return
  st.draft = DEFAULTS[kind].template
  st.draftParams = paramsText(kind, DEFAULTS)
  st.editKey++
  st.note = 'Default reinserito: premi salva per tenerlo.'
  redraw($)
}

// ---- il disegno ------------------------------------------------------------

const levelLabel = (kind: Kind, words: number): string => {
  if (kind === 'sintesi') {
    const n = sintesiLines(words, prompts.sintesi.params, st.level.sintesi)
    return n === 1 ? '1 riga' : `${n} righe`
  }
  const l = st.level.prosa
  return l === 0 ? '×1' : l > 0 ? `×${2 ** l}` : `×1/${2 ** -l}`
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    root = $.plugin.root
    version = await $.fs
      .read(`${root}/.claude-plugin/plugin.json`)
      .then(text => String((JSON.parse(text) as { version?: unknown }).version ?? ''))
      .catch(() => '')
    prompts = revive(await $.store.get(STORE_KEY).catch(() => undefined))
    await loadSetup($)
    speech.dir = `/tmp/voxbox-${await $.session.id()}`
    watchSpeech(() => redraw($))
    // Glassbox, se c'è, fa del suo titolo lo scambio con Voxbox.
    try {
      await $.glassbox.join()
    } catch {
      // Glassbox non c'è: Voxbox si apre in un pannello suo.
    }
    await $.command
      .register({ name: COMMAND, description: 'Opens Voxbox: hear a selection or the last reply, raw, as prose or as a summary (close)', argumentHint: '[close]' })
      .catch(err => $.ui.log(`voxbox: /${COMMAND} not registered: ${err}`))
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'close') {
      await shutdown()
      if ((await glassboxTurn($)) === 'voxbox') {
        await disarmAll($, '')
        await $.glassbox.setTurn('glassbox')
      }
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: `Voxbox closed: /${COMMAND} reopens it.` }
    }
    await loadSetup($)
    await show($)
    return { text: setup ? 'Voxbox opened.' : `Voxbox opened. ${setupError}` }
  })

  // Lo stesso pannello, in due posti: il suo (Voxbox da solo) e quello di
  // Glassbox, dove disegna solo quando è il suo turno.
  for (const requestId of [PANE, GLASSBOX_PANE]) {
  const hosted = requestId === GLASSBOX_PANE

  on('ui.scroll', { component: 'Pane', requestId }, async ($, e, next) => {
    if (hosted && (await glassboxTurn($)) !== 'voxbox') return next(e)
    st.offset = clamp(st.offset + e.by, maxOffset)
    redraw($)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (hosted) {
      const turn = await glassboxTurn($)
      if (turn !== 'voxbox' && !morph) {
        seenTurn = turn
        return next(e)
      }
      // Appena passato a Voxbox: la transizione d'arrivo.
      if (turn === 'voxbox' && seenTurn !== 'voxbox' && !morph) morph = { from: 'glassbox', to: 'voxbox', start: Date.now() }
      seenTurn = 'voxbox'
    }
    const el = $.ui.resolve(e)
    const { Box, Button, Input, Text } = el
    // La larghezza vera: stretto è stretto, e il titolo toglie la versione prima del logo.
    const width = Math.max(12, e.props.bodyColumns)
    const inner = Math.max(8, width - INDENT.length - 1)
    const bodyRows = Math.max(12, e.props.scroll.bodyRows)
    const words = countWords(cleanForSpeech(sourceText()))
    const out: RenderElement[] = []

    const row = (key: string, ...children: (RenderElement | false | undefined)[]) => (
      <Box key={key} flexDirection="row" height={1} overflow="hidden">
        <Text>{INDENT}</Text>
        {children.filter(Boolean)}
      </Box>
    )
    const gap = (key: string) => (
      <Box key={key} height={1}>
        <Text> </Text>
      </Box>
    )
    const rule = (key: string) => row(key, <Text dimColor>{'─'.repeat(inner)}</Text>)
    const sp = (key: string) => <Text key={key}> </Text>

    // I comandi vanno a capo invece di schiacciarsi: ogni gruppo sa quanto è
    // largo, e se non entra nella riga passa a quella sotto.
    type Part = { w: number; el: RenderElement }
    const group = (key: string, w: number, ...children: RenderElement[]): Part => ({
      w,
      el: (
        <Box key={key} flexDirection="row" flexShrink={0}>
          {children}
        </Box>
      ),
    })
    const flow = (key: string, parts: Part[]): RenderElement[] => {
      const rows: Part[][] = [[]]
      let used = 0
      for (const part of parts) {
        const current = rows.at(-1)!
        const need = (current.length > 0 ? 1 : 0) + part.w
        if (current.length > 0 && used + need > inner) {
          rows.push([part])
          used = part.w
        } else {
          current.push(part)
          used += need
        }
      }
      return rows.map((parts, i) =>
        row(
          `${key}:${i}`,
          ...parts.flatMap((part, j) => (j === 0 ? [part.el] : [sp(`${key}:${i}:${j}`), part.el])),
        ),
      )
    }
    // Un pulsante con la cornice `[ … ]`, e un'etichetta che si preme: accesa
    // nel colore d'accento, spenta in grigio.
    const button = (key: string, label: string, press: () => void, color?: string, isBold = false): Part =>
      group(
        `${key}:g`,
        cols(label) + 4,
        <Button key={key} onPress={press}>
          <Text color={color} bold={isBold}>
            {label}
          </Text>
        </Button>,
      )
    const chip = (key: string, label: string, isOn: boolean, press: () => void) => (
      <Button key={key} plain onPress={press}>
        <Text color={isOn ? ACCENT : undefined} bold={isOn} dimColor={!isOn}>
          {label}
        </Text>
      </Button>
    )
    const chipPart = (key: string, label: string, isOn: boolean, press: () => void): Part => group(`${key}:g`, cols(label), chip(key, label, isOn, press))

    // Il titolo, come quello di Glassbox: sotto il motto lo scambio, se Glassbox c'è.
    if (bodyRows >= TITLE_MIN_ROWS) {
      const frame = morph ? Math.floor((Date.now() - morph.start) / MORPH_MS) : MORPH_FRAMES
      // Sotto le 18 colonne nemmeno G L A S S B O X ci sta: niente transizione.
      if (morph && frame < MORPH_FRAMES && width >= 18) {
        out.push(...morphLines(el, width, morph.from, morph.to, (frame + 1) / MORPH_FRAMES, frame))
        if (!morphTick) {
          morphTick = true
          $.clock.after(MORPH_MS, () => {
            morphTick = false
            redraw($)
          })
        }
      } else {
        if (morph?.to === 'voxbox') morph = undefined
        out.push(...titleLines(el, width, version, hosted ? () => void toGlassbox($) : undefined))
      }
    }

    // SORGENTE: REC e il suo modo vicini a sinistra (1 = sostituisci, + = concatena),
    // CP all'estrema destra; se non ci stanno, CP va a destra nella riga sotto.
    const armed = isArmed()
    const rec = button('arm', armed ? '● REC' : 'REC', () => void pressArm($), armed ? '#f87171' : undefined, armed)
    const mode = button(
      'mode',
      st.mode === 'replace' ? '1' : '+',
      () => {
        st.mode = st.mode === 'replace' ? 'append' : 'replace'
        renewArm()
        redraw($)
      },
      ACCENT,
      true,
    )
    const cp = button('reply', 'CP', () => void pressReply($))
    const leftW = rec.w + mode.w
    const pad = (key: string, n: number) => <Text key={key}>{' '.repeat(Math.max(1, n))}</Text>
    if (leftW + 1 + cp.w <= inner) out.push(row('source:0', rec.el, mode.el, pad('source:pad', inner - leftW - cp.w), cp.el))
    else {
      out.push(row('source:0', rec.el, mode.el))
      out.push(row('source:1', pad('source:pad', inner - cp.w), cp.el))
    }
    const summary =
      st.text.trim() === ''
        ? armed
          ? st.mode === 'append'
            ? 'REC: ogni copia si aggiunge qui'
            : 'REC: la prossima copia arriva qui'
          : `vuoto · ${st.mode === 'replace' ? '1 = sostituisci' : '+ = concatena'}`
        : `${st.source === 'reply' ? 'ultima risposta' : 'testo catturato'} · ${words} parole${armed ? ' · REC' : ''}`
    out.push(row('summary', <Text dimColor>{fitText(summary, inner)}</Text>))
    out.push(gap('gap:1'))

    // VISTE: RAW | VOX | SYNTH, in colonna se non ci stanno in una riga.
    const titles = [
      { kind: 'raw' as const, title: 'RAW' },
      { kind: 'prosa' as const, title: NAMES.prosa },
      { kind: 'sintesi' as const, title: NAMES.sintesi },
    ]
    // Accanto alla vista scelta (VOX o SYNTH) la matita del suo prompt.
    const tabs = titles.map(t =>
      st.view === t.kind && t.kind !== 'raw' ? (
        <Box key={`tab:${t.kind}`} flexDirection="row" flexShrink={0}>
          {chip(`view-${t.kind}`, t.title, true, () => pressView($, t.kind))}
          <Button key={`edit-${t.kind}`} plain dimColor onPress={() => openEditor($, t.kind as Kind)}>
            ✎
          </Button>
        </Box>
      ) : (
        chip(`view-${t.kind}`, t.title, st.view === t.kind, () => pressView($, t.kind))
      ),
    )
    if (cols(`${NAMES.raw} | ${NAMES.prosa} | ${NAMES.sintesi}`) + (st.view === 'raw' ? 0 : cols('✎')) <= inner) {
      out.push(row('views:0', ...tabs.flatMap((tab, i) => (i === 0 ? [tab] : [<Text key={`views:bar:${i}`} dimColor> | </Text>, tab]))))
    } else {
      tabs.forEach((tab, i) => out.push(row(`views:${i}`, tab)))
    }
    // Sotto, i comandi della vista scelta: lunghezza, fast o deep.
    // In RAW non ce ne sono, e la riga resta vuota perché il testo non salti.
    if (st.view === 'raw') out.push(gap('tools:0'))
    else {
      const kind = st.view
      const label = levelLabel(kind, words)
      const autoDeep = kind === 'prosa' && st.level.prosa > 0 && !st.deep
      // fast | deep stanno sempre insieme; a pannello molto stretto "(auto)" si toglie.
      const deepLabel = autoDeep && cols('fast | deep (auto)') <= inner ? 'deep (auto)' : 'deep'
      out.push(
        ...flow('tools', [
          group(
            'level:g',
            cols(label) + 4,
            <Button key={`${kind}-less`} plain dimColor onPress={() => pressLevel($, kind, -1)}>
              ◂
            </Button>,
            <Text dimColor>{` ${label} `}</Text>,
            <Button key={`${kind}-more`} plain dimColor onPress={() => pressLevel($, kind, 1)}>
              ▸
            </Button>,
          ),
          group(
            'speed:g',
            cols(`fast | ${deepLabel}`),
            chip('quick', 'fast', !st.deep && !autoDeep, () => {
              st.deep = false
              void generate($, kind)
              redraw($)
            }),
            <Text dimColor> | </Text>,
            chip('deep', deepLabel, st.deep || autoDeep, () => {
              st.deep = true
              void generate($, kind)
              redraw($)
            }),
          ),
        ]),
      )
    }
    out.push(rule('rule:1'))

    // Il fondo si prepara prima, per sapere quante righe restano al testo.
    const isSpeaking = speech.phase === 'speaking'
    const output = st.view === 'raw' ? undefined : outputs.get(outputKey(st.view))
    const shownWords = countWords(cleanForSpeech(shownText()))
    const speedLabel = ` ${st.speed.toFixed(1)}× `
    const footer = [
      rule('rule:2'),
      ...flow('controls', [
        button('play', speech.phase === 'starting' ? '…' : '▶', () => void pressSpeak($), ACCENT, true),
        button('stop', '■', () => void stop($), isSpeaking ? '#f87171' : undefined),
        group(
          'speed-ctl:g',
          cols(speedLabel) + 2,
          <Button
            key="slower"
            plain
            dimColor
            onPress={() => {
              st.speed = Math.max(0.7, Math.round((st.speed - 0.1) * 10) / 10)
              redraw($)
            }}
          >
            −
          </Button>,
          <Text>{speedLabel}</Text>,
          <Button
            key="faster"
            plain
            dimColor
            onPress={() => {
              st.speed = Math.min(1.6, Math.round((st.speed + 0.1) * 10) / 10)
              redraw($)
            }}
          >
            +
          </Button>,
        ),
        ...(shownWords > 0 ? [group('time:g', cols(listenTime(shownWords, st.speed)), <Text dimColor>{listenTime(shownWords, st.speed)}</Text>)] : []),
      ]),
    ]
    const status =
      st.error || speech.error || setupError
        ? { text: st.error || speech.error || setupError, color: '#f87171' }
        : st.busy
          ? { text: st.busy, color: ACCENT }
          : isSpeaking
            ? { text: '🔊 sto leggendo…', color: ACCENT }
            : output
              ? { text: `${output.deep ? 'fork della sessione' : 'Haiku'} · ${(output.ms / 1000).toFixed(1)} s · ${shownWords} parole`, color: undefined }
              : { text: st.note, color: undefined }
    footer.push(row('status', <Text color={status.color} dimColor={!status.color}>{fitText(status.text || ' ', inner)}</Text>))
    const room = Math.max(3, bodyRows - out.length - footer.length)
    // L'ultima riga del riquadro del testo porta a destra il cestino, quando c'è testo.
    const hasText = st.text.trim() !== '' && !st.editing
    const textRows = hasText ? room - 1 : room
    const trash = (
      <Box key="trash-row" flexDirection="row" height={1} overflow="hidden">
        <Text>{' '.repeat(Math.max(0, width - 1 - cols('🗑')))}</Text>
        <Button key="clear" plain dimColor onPress={() => pressClear($)}>
          🗑
        </Button>
      </Box>
    )

    if (st.editing) {
      const kind = st.editing
      const hint = kind === 'prosa' ? '{parole}: dalla formula' : '{righe}, {parole_riga}: dalla formula'
      out.push(row('edit:head', <Text color={ACCENT} bold>{`✎ prompt ${NAMES[kind]}`}</Text>, <Text dimColor>{fitText(`  ${hint}`, Math.max(1, inner - cols(`✎ prompt ${NAMES[kind]}`)))}</Text>))
      out.push(
        <Box key="edit:text" paddingLeft={INDENT.length}>
          <Input
            key={`edit-template-${st.editKey}`}
            value={st.draft}
            rows={Math.max(3, room - 4)}
            onInput={value => {
              st.draft = value
            }}
            onSubmit={value => {
              st.draft = value
            }}
          />
        </Box>,
      )
      out.push(
        <Box key="edit:params" paddingLeft={INDENT.length}>
          <Input
            key={`edit-params-${st.editKey}`}
            label="parametri"
            value={st.draftParams}
            onInput={value => {
              st.draftParams = value
            }}
            onSubmit={value => {
              st.draftParams = value
              void saveEditor($)
            }}
          />
        </Box>,
      )
      out.push(
        ...flow('edit:buttons', [
          button('edit-save', 'salva', () => void saveEditor($)),
          button('edit-reset', '↺ default', () => resetEditor($)),
          button('edit-cancel', 'annulla', () => {
            st.editing = undefined
            redraw($)
          }),
        ]),
      )
    } else if (st.view === 'raw' && st.text.trim() !== '') {
      // RAW si modifica: punti, virgole, a capo, tagli, aggiunte. In concatena le
      // copie nuove arrivano in fondo, e ogni modifica tiene acceso REC.
      const edit = (value: string) => {
        st.text = value
        st.version++
        renewArm()
      }
      out.push(
        <Box key={`raw:${st.textKey}`} paddingLeft={INDENT.length} width={width - 1} height={textRows} overflow="hidden">
          <Input
            key="raw"
            value={st.text}
            rows={Math.max(2, textRows - 2)}
            onInput={edit}
            onSubmit={value => {
              edit(value)
              redraw($)
            }}
          />
        </Box>,
      )
    } else {
      const shown = shownText()
      const isEmpty = sourceText().trim() === ''
      const lines =
        shown !== ''
          ? wrap(shown, inner)
          : st.view !== 'raw' && st.busy
            ? [st.busy]
            : isEmpty
              ? wrap(armed ? guideArmed() : GUIDE, inner)
              : st.view !== 'raw'
                ? ['Premi di nuovo la vista per rielaborare.']
                : ['']
      maxOffset = Math.max(0, lines.length - textRows)
      st.offset = clamp(st.offset, maxOffset)
      const visible = lines.slice(st.offset, st.offset + textRows)
      visible.forEach((line, i) => out.push(row(`line:${st.offset + i}`, <Text dimColor={shown === ''}>{line === '' ? ' ' : line}</Text>)))
      for (let i = visible.length; i < textRows; i++) out.push(gap(`pad:${i}`))
    }
    if (hasText) out.push(trash)
    out.push(...footer)

    return <Box flexDirection="column">{out}</Box>
  })
  }
}

// Usati solo dai test.
export const _testing = { st, outputs, parseSteps }
