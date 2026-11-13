// VOX e SYNTH: lo stato delle due sezioni e quello che fanno i loro comandi.
//
// VOX prende un testo (una selezione copiata dopo `rec`, o l'ultima risposta
// di Claude con `cp`), lo mostra com'è (raw) o srotolato in prosa (prose), e lo
// legge ad alta voce con Piper. SYNTH riduce lo stesso testo a poche righe
// telegrafiche, e legge quelle. Prosa e sintesi le scrive Haiku dall'interno
// della sessione (fast) o un fork della sessione stessa, che ne conosce il
// contesto (deep): nessuna risposta in più nella chat.
//
// Il disegno è in view-vox.tsx, view-synth.tsx e view-vox-edit.tsx.
import type { EngineInterface, Timer } from 'claude-code'

import { redraw } from './ui'
import { disarm, isArmed, listen } from './vox-clip'
import { DEFAULTS, forkPrompt, paramsText, parseParams, quickRequest, revive, vars } from './vox-prompts'
import type { Kind, Prompts } from './vox-prompts'
import { shutdown, speak, speech, stop, watchSpeech } from './vox-speech'
import type { Setup } from './vox-speech'
import { cleanForSpeech, countWords, lastReply, prosaLevels, sintesiLines } from './vox-text'

export type VoxSection = 'vox' | 'synth'
/** Un testo che si può leggere e modificare: quello catturato, la prosa, la sintesi. */
export type Target = 'raw' | Kind
type Output = { text: string; ms: number; deep: boolean }

// Il pannello di Glassbox, per portare il cursore nei campi dell'editor.
const PANE = 'glassbox'
const STORE_KEY = 'vox-prompts'
// `rec` resta acceso questo tempo senza copie né modifiche al testo, poi si spegne.
const ARM_SECONDS = 60
// herdr può scrivere la stessa selezione negli appunti due volte di fila.
const DOUBLE_COPY_MS = 2000

/** Cosa c'è aperto al posto delle sezioni: un testo da modificare, o un prompt con i suoi parametri. */
export type Edit =
  | { what: 'text'; target: Target; session: number }
  | { what: 'prompt'; kind: Kind; draft: string; params: string; key: number }

export const vox = {
  source: 'clip' as 'clip' | 'reply',
  // Il testo di partenza: la cattura o l'ultima risposta, e quello che ci scrivi tu.
  text: '',
  // Cresce quando il testo cambia da fuori (cattura, cp, svuota): il campo in modifica si ridisegna.
  textKey: 0,
  // Cresce a ogni cambio del testo: prosa e sintesi vecchie non valgono più.
  version: 0,
  mode: 'replace' as 'replace' | 'append',
  // `rec`: fin quando resta acceso (ms).
  armedUntil: 0,
  // Cosa mostra VOX.
  view: 'raw' as 'raw' | 'prosa',
  deep: { prosa: false, sintesi: false } as Record<Kind, boolean>,
  level: { prosa: 0, sintesi: 0 } as Record<Kind, number>,
  speed: 1,
  // Cosa si sta scrivendo adesso.
  busy: undefined as Kind | undefined,
  // Quale sezione ha chiesto l'ultima lettura.
  reading: '' as VoxSection | '',
  error: { vox: '', synth: '' } as Record<VoxSection, string>,
  edit: undefined as Edit | undefined,
  // Perché la voce non c'è; vuoto se è installata.
  setupError: '',
}

const outputs = new Map<string, Output>()
let prompts: Prompts = DEFAULTS
let setup: Setup | undefined
let root = ''
// Apre la sezione quando un suo comando si usa da chiusa.
let reveal: (section: VoxSection) => void = () => undefined
let sessions = 0
let keys = 0

export const promptsNow = (): Prompts => prompts

export const effectiveDeep = (kind: Kind): boolean => vox.deep[kind] || (kind === 'prosa' && vox.level.prosa > 0)
const outputKey = (kind: Kind) => `${vox.version}:${kind}:${vox.level[kind]}:${effectiveDeep(kind)}`
/** La prosa o la sintesi del testo di adesso, se è già scritta. */
export const outputOf = (kind: Kind): Output | undefined => outputs.get(outputKey(kind))

export const textOf = (target: Target): string => (target === 'raw' ? vox.text : (outputOf(target)?.text ?? ''))
/** Il testo che la sezione mostra, e che ▶ legge. */
export const shownText = (section: VoxSection): string => textOf(section === 'synth' ? 'sintesi' : vox.view)
/** Le parole del testo di partenza come le conta la voce. */
export const sourceWords = (): number => countWords(cleanForSpeech(vox.text))

export const isReading = (section: VoxSection): boolean => vox.reading === section && speech.phase === 'speaking'
export const isStarting = (section: VoxSection): boolean => vox.reading === section && speech.phase === 'starting'
/** I secondi che restano a `rec`. */
export const armLeft = (now: number): number => Math.max(0, Math.ceil((vox.armedUntil - now) / 1000))

/** `×2`, `×1/2` per la prosa; `3 lines` per la sintesi. */
export function levelLabel(kind: Kind): string {
  if (kind === 'sintesi') {
    const n = sintesiLines(sourceWords(), prompts.sintesi.params, vox.level.sintesi)
    return n === 1 ? '1 line' : `${n} lines`
  }
  const l = vox.level.prosa
  return l === 0 ? '×1' : l > 0 ? `×${2 ** l}` : `×1/${2 ** -l}`
}

// ---- la voce e i prompt, all'avvio -----------------------------------------

async function loadSetup($: EngineInterface): Promise<void> {
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const data = (await $.env.get('XDG_DATA_HOME').catch(() => undefined)) || `${home}/.local/share`
  try {
    const raw = JSON.parse(await $.fs.read(`${data}/voxbox/config.json`)) as Partial<Setup>
    if (!raw.python || !raw.voice || !raw.win) throw new Error('incomplete config.json')
    setup = { python: raw.python, voice: raw.voice, win: raw.win }
    vox.setupError = ''
  } catch {
    setup = undefined
    vox.setupError = `Voice not installed: run ${root}/bin/vox-setup.sh`
  }
}

/** All'avvio della sessione: i prompt salvati, dov'è la voce, chi apre le sezioni. */
export async function startVox($: EngineInterface, open: (section: VoxSection) => void): Promise<void> {
  reveal = open
  root = $.plugin.root
  prompts = revive(await $.store.get(STORE_KEY).catch(() => undefined))
  await loadSetup($)
  speech.dir = `/tmp/voxbox-${await $.session.id().catch(() => 'session')}`
  watchSpeech(() => redraw($))
}

/** Alla chiusura del pannello: niente più ascolto degli appunti, e il motore della voce si chiude. */
export async function stopVox($: EngineInterface): Promise<void> {
  await disarmAll($)
  await shutdown()
}

function say($: EngineInterface, text: string): void {
  try {
    $.ui.toast(text)
  } catch {
    // Senza toast resta il pannello.
  }
}

// ---- prendere il testo -----------------------------------------------------

function setSource(change: () => void): void {
  change()
  vox.textKey++
  vox.version++
  vox.view = 'raw'
  vox.error.vox = ''
  vox.error.synth = ''
}

// Il timer di `rec`: un secondo alla volta ridisegna il conto alla rovescia e,
// allo scadere, spegne.
let tick: Timer | undefined

async function disarmAll($: EngineInterface): Promise<void> {
  tick?.cancel()
  tick = undefined
  vox.armedUntil = 0
  await disarm()
  redraw($)
}

/** Ogni copia, e ogni modifica al testo, rimette il timer di `rec` a 60 secondi. */
const renewArm = () => {
  if (isArmed()) vox.armedUntil = Date.now() + ARM_SECONDS * 1000
}

let lastCopy = { text: '', at: 0 }

function takeCopy($: EngineInterface, text: string): void {
  const clean = text.trim()
  const now = Date.now()
  if (clean === lastCopy.text && now - lastCopy.at < DOUBLE_COPY_MS) return
  lastCopy = { text: clean, at: now }
  setSource(() => {
    // In concatena la copia va in fondo, a capo: punti, virgole e il resto li scrivi tu nel testo.
    vox.text = vox.source === 'clip' && vox.mode === 'append' && vox.text.trim() !== '' ? `${vox.text.trimEnd()}\n${clean}` : clean
    vox.source = 'clip'
  })
  reveal('vox')
  if (vox.mode === 'replace') void disarmAll($)
  else {
    renewArm()
    redraw($)
  }
}

async function pressArm($: EngineInterface): Promise<void> {
  if (isArmed()) {
    await disarmAll($)
    return
  }
  reveal('vox')
  if (!setup) await loadSetup($)
  if (!setup) {
    vox.error.vox = vox.setupError
    redraw($)
    return
  }
  vox.error.vox = ''
  vox.armedUntil = Date.now() + ARM_SECONDS * 1000
  tick?.cancel()
  tick = $.clock.every(1000, () => {
    if (!isArmed()) return
    if (Date.now() >= vox.armedUntil) void disarmAll($)
    else redraw($)
  })
  const listening = listen(
    $,
    setup.win,
    text => takeCopy($, text),
    error => {
      tick?.cancel()
      tick = undefined
      vox.armedUntil = 0
      if (error) vox.error.vox = `rec: ${error}`
      redraw($)
    },
  )
  redraw($)
  await listening
}

async function pressReply($: EngineInterface): Promise<void> {
  const text = lastReply(await $.session.messages())
  if (text === '') {
    say($, 'VOX: no reply from Claude after your last message.')
    return
  }
  setSource(() => {
    vox.text = text
    vox.source = 'reply'
  })
  reveal('vox')
  redraw($)
}

function pressClear($: EngineInterface): void {
  setSource(() => {
    vox.text = ''
    vox.source = 'clip'
  })
  outputs.clear()
  redraw($)
}

// ---- prosa e sintesi -------------------------------------------------------

const sectionOf = (kind: Kind): VoxSection => (kind === 'sintesi' ? 'synth' : 'vox')

async function generate($: EngineInterface, kind: Kind): Promise<void> {
  const section = sectionOf(kind)
  const text = vox.text
  if (text.trim() === '') {
    say($, 'Nothing to rewrite: press rec and select a text, or cp for the last reply.')
    return
  }
  const key = outputKey(kind)
  if (outputs.has(key)) return
  if (vox.busy) {
    say($, 'Still writing: try again in a moment.')
    return
  }
  const deep = effectiveDeep(kind)
  const values = vars(kind, prompts, countWords(cleanForSpeech(text)), vox.level[kind])
  const isSelection = vox.source === 'clip'
  vox.busy = kind
  vox.error[section] = ''
  redraw($)
  const t0 = Date.now()
  try {
    let reply: { isAnswered: true; text: string } | { isAnswered: false; reason: string }
    if (deep) {
      // `effort` manca nei tipi di qualche versione di Claude Code: lì si ignora.
      const request = { prompt: forkPrompt(kind, prompts, values, text, isSelection), effort: 'low' }
      reply = await $.model.fork(request)
    } else {
      const context = isSelection ? lastReply(await $.session.messages()) : ''
      const request = quickRequest(kind, prompts, values, text, context && context !== text ? context : undefined)
      reply = await $.model.complete({ model: 'haiku', ...request, timeoutMs: 90_000 })
    }
    if (reply.isAnswered) outputs.set(key, { text: reply.text.trim(), ms: Date.now() - t0, deep })
    else vox.error[section] = `No text (${reply.reason})`
  } catch (err) {
    vox.error[section] = err instanceof Error ? err.message : String(err)
  } finally {
    vox.busy = undefined
    redraw($)
  }
}

function showView($: EngineInterface, view: 'raw' | 'prosa'): void {
  vox.view = view
  reveal('vox')
  if (view === 'prosa') void generate($, 'prosa')
  redraw($)
}

// SYNTH si scrive quando lo chiedi; con una sintesi già pronta, la riscrive.
function writeSynth($: EngineInterface): void {
  reveal('synth')
  outputs.delete(outputKey('sintesi'))
  void generate($, 'sintesi')
  redraw($)
}

function pressLevel($: EngineInterface, kind: Kind, by: number): void {
  const next = vox.level[kind] + by
  if (kind === 'prosa') {
    const { min, max } = prosaLevels(prompts.prosa.params)
    if (next < min || next > max) {
      say($, by > 0 ? 'Prose is already at its longest.' : 'Prose is already at its shortest.')
      return
    }
  } else {
    const words = sourceWords()
    if (sintesiLines(words, prompts.sintesi.params, next) === sintesiLines(words, prompts.sintesi.params, vox.level.sintesi)) {
      say($, by > 0 ? 'SYNTH is already at its longest.' : 'SYNTH is already at its shortest.')
      return
    }
  }
  vox.level[kind] = next
  if (kind === 'prosa') showView($, 'prosa')
  else {
    reveal('synth')
    void generate($, 'sintesi')
    redraw($)
  }
}

function setDeep($: EngineInterface, kind: Kind, deep: boolean): void {
  vox.deep[kind] = deep
  void generate($, kind)
  redraw($)
}

// ---- leggere ad alta voce --------------------------------------------------

async function pressPlay($: EngineInterface, section: VoxSection): Promise<void> {
  if (isReading(section)) {
    await stop($)
    return
  }
  reveal(section)
  if (!setup) await loadSetup($)
  if (!setup) {
    vox.error[section] = vox.setupError
    redraw($)
    return
  }
  const text = cleanForSpeech(shownText(section))
  if (text === '') {
    say($, section === 'synth' ? 'SYNTH has nothing to read yet: press write.' : 'VOX has nothing to read.')
    return
  }
  vox.reading = section
  vox.error[section] = ''
  try {
    await speak($, setup, root, text, vox.speed)
  } catch (err) {
    vox.error[section] = `Voice: ${err instanceof Error ? err.message : String(err)}`
    redraw($)
  }
}

function changeSpeed($: EngineInterface, by: number): void {
  vox.speed = Math.min(1.6, Math.max(0.7, Math.round((vox.speed + by) * 10) / 10))
  redraw($)
}

// ---- modificare un testo o un prompt, al posto delle sezioni -----------------

function focus($: EngineInterface, key: string): void {
  void $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

function closeEdit($: EngineInterface): void {
  const edit = vox.edit
  vox.edit = undefined
  redraw($)
  // Il campo sparisce: il fuoco della tastiera va su ▶ della sezione, il passo dopo naturale.
  if (edit) focus($, edit.what === 'text' ? `${edit.target === 'sintesi' ? 'synth' : 'vox'}-play` : `${sectionOf(edit.kind)}-play`)
}

function editText($: EngineInterface, target: Target): void {
  if (textOf(target).trim() === '') return
  vox.edit = { what: 'text', target, session: ++sessions }
  renewArm()
  redraw($)
  focus($, `vox-text-${sessions}`)
}

// Il testo catturato è il master: cambiarlo fa riscrivere prosa e sintesi;
// cambiare prosa o sintesi tocca solo quel testo.
function setText(target: Target, value: string): void {
  if (target === 'raw') {
    vox.text = value
    vox.version++
    return
  }
  const key = outputKey(target)
  const out = outputs.get(key)
  if (out) outputs.set(key, { ...out, text: value })
}

/** Mentre si scrive: le modifiche contano solo da dentro il campo, e tengono acceso `rec`. */
function typeText(target: Target, value: string): void {
  if (vox.edit?.what !== 'text' || vox.edit.target !== target || value.trim() === '') return
  setText(target, value)
  renewArm()
}

/** Invio salva ed esce; un Invio a campo vuoto esce senza cancellare (per svuotare c'è ✕). */
function submitText($: EngineInterface, target: Target, value: string): void {
  typeText(target, value)
  closeEdit($)
}

function editPrompt($: EngineInterface, kind: Kind): void {
  vox.edit = { what: 'prompt', kind, draft: prompts[kind].template, params: paramsText(kind, prompts), key: ++keys }
  redraw($)
  focus($, `vox-prompt-${keys}`)
}

async function savePrompt($: EngineInterface): Promise<void> {
  const edit = vox.edit
  if (edit?.what !== 'prompt') return
  const { kind } = edit
  const withText: Prompts = { ...prompts, [kind]: { ...prompts[kind], template: edit.draft.trim() === '' ? DEFAULTS[kind].template : edit.draft } }
  const parsed = parseParams(kind, edit.params, withText)
  prompts = parsed.prompts
  await $.store.set(STORE_KEY, prompts).catch(err => $.ui.log(`glassbox: vox prompts not saved: ${err}`))
  outputs.clear()
  const name = kind === 'prosa' ? 'Prose' : 'SYNTH'
  say($, parsed.errors.length > 0 ? `${name} prompt saved, but: ${parsed.errors.join('; ')}` : `${name} prompt saved.`)
  closeEdit($)
}

// ↺ default: rimette nell'editor il prompt di partenza; save lo tiene.
function resetPrompt($: EngineInterface): void {
  const edit = vox.edit
  if (edit?.what !== 'prompt') return
  vox.edit = { ...edit, draft: DEFAULTS[edit.kind].template, params: paramsText(edit.kind, DEFAULTS), key: ++keys }
  redraw($)
}

/** I comandi delle due sezioni, legati alla sessione. */
export function voxActions($: EngineInterface) {
  return {
  arm: () => void pressArm($),
  toggleMode: () => {
    vox.mode = vox.mode === 'replace' ? 'append' : 'replace'
    renewArm()
    redraw($)
  },
  reply: () => void pressReply($),
  clear: () => pressClear($),
  show: (view: 'raw' | 'prosa') => showView($, view),
  write: () => writeSynth($),
  level: (kind: Kind, by: number) => pressLevel($, kind, by),
  deep: (kind: Kind, deep: boolean) => setDeep($, kind, deep),
  play: (section: VoxSection) => void pressPlay($, section),
  speed: (by: number) => changeSpeed($, by),
  editText: (target: Target) => editText($, target),
  typeText,
  submitText: (target: Target, value: string) => submitText($, target, value),
  editPrompt: (kind: Kind) => editPrompt($, kind),
  typePrompt: (field: 'draft' | 'params', value: string) => {
    if (vox.edit?.what === 'prompt') vox.edit[field] = value
  },
  savePrompt: () => void savePrompt($),
  resetPrompt: () => resetPrompt($),
  closeEdit: () => closeEdit($),
  }
}
export type VoxActions = ReturnType<typeof voxActions>

// Usati solo dai test: il mod resta caricato da un test all'altro.
export const _testing = {
  reset: () => {
    outputs.clear()
    prompts = DEFAULTS
    Object.assign(vox, { source: 'clip', text: '', mode: 'replace', armedUntil: 0, view: 'raw', speed: 1, busy: undefined, reading: '', edit: undefined })
    vox.deep = { prosa: false, sintesi: false }
    vox.level = { prosa: 0, sintesi: 0 }
    vox.error = { vox: '', synth: '' }
    vox.version++
  },
}
