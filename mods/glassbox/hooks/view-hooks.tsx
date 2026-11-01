// La sezione in cima: gli hook della sessione raggruppati per evento, ognuno
// con la sua fonte e il pulsante ON / OFF a destra. Un clic sul nome apre
// sotto il comando, il file da cui viene e come si spegne. Quelli che non si
// possono spegnere (ALWAYS e MANAGED) stanno nascosti finché `always` non li
// mostra.
import { canSwitch, hooks, isOff } from './settings-hooks'
import type { SettingsHook } from './settings-hooks'
import { SELECTED_BG, fit, len } from './ui'
import type { Line } from './ui'

const ON_DOT = '#4ade80'
const ON = { bg: '#2e7d32', fg: '#ffffff' }
// Spento è una protezione tolta: rosso scuro, non grigio.
const OFF = { bg: '#7f1d1d', fg: '#fecaca' }
const OFF_TEXT = '#f87171'
// Le righe del comando nei dettagli, al massimo.
const COMMAND_ROWS = 3

// Gli eventi nell'ordine in cui capitano in una sessione; gli altri dopo.
const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'Stop',
  'SessionEnd',
]

type Seg = { text: string; color?: string; dim?: boolean }

export const hookView = {
  // Se si vedono anche gli hook che non si possono spegnere.
  showAlways: false,
}

/** Gli hook che non si possono spegnere: quelli che `always` mostra o nasconde. */
export const fixedHooks = (): SettingsHook[] => hooks.list.filter(h => !canSwitch(h))

const rank = (event: string): number => {
  const i = EVENTS.indexOf(event)
  return i < 0 ? EVENTS.length : i
}

/** Gli hook nell'ordine delle righe: per evento, e dentro come li dà il motore. */
export const ordered = (): SettingsHook[] =>
  hooks.list
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rank(a.h.event) - rank(b.h.event) || a.h.event.localeCompare(b.h.event) || a.i - b.i)
    .map(x => x.h)

/** Il testo accanto al titolo: quanti hook ci sono, quanti spenti e quanti nascosti. */
export const hooksInfo = (): Seg[] => {
  if (hooks.list.length === 0) return [{ text: 'none', dim: true }]
  const off = hooks.list.filter(isOff).length
  const hidden = hookView.showAlways ? 0 : fixedHooks().length
  return [
    { text: `${hooks.list.length - off} on`, dim: true },
    ...(off > 0 ? [{ text: ` · ${off} off`, color: OFF_TEXT }] : []),
    ...(hidden > 0 ? [{ text: ` · ${hidden} hidden`, dim: true }] : []),
  ]
}

const tilde = (path: string): string => (hooks.home && path.startsWith(`${hooks.home}/`) ? `~${path.slice(hooks.home.length)}` : path)

// Da quali impostazioni o da che plugin viene; per quelle dell'organizzazione
// lo dice il pulsante.
const tagOf = (h: SettingsHook): string =>
  h.plugin !== undefined ? (h.plugin.split('@')[0] ?? h.plugin) : h.source === 'flag' ? '--settings' : h.source === 'policy' ? '' : h.source

// Il pulsante, o la parola che dice perché non c'è.
const switchOf = (h: SettingsHook): string =>
  h.source === 'policy' ? ' MANAGED ' : !canSwitch(h) ? ' ALWAYS ' : isOff(h) ? ' OFF ' : ' ON '

// Da dove viene: il file delle impostazioni, o il plugin e sotto la sua cartella.
const fromOf = (h: SettingsHook): string[] => {
  if (h.plugin !== undefined) return [`from plugin ${h.plugin}`, `  ${tilde(h.root ?? '')}`]
  if (h.source === 'user') return [`from ${tilde(`${hooks.config}/settings.json`)}`]
  if (h.source === 'project') return ['from .claude/settings.json']
  if (h.source === 'local') return ['from .claude/settings.local.json']
  if (h.source === 'flag') return ['from --settings']
  return ['from managed settings']
}

const howOf = (h: SettingsHook): string => {
  if (h.source === 'policy') return 'Set by your organization.'
  if (h.switchName !== undefined) return 'OFF skips it in this session only.'
  if (h.plugin !== undefined) return 'To switch it, its plugin writes it with hook-switch.'
  return 'To switch it: hook-switch <what-it-does> <command>'
}

// Il testo a pezzi di `room` colonne, al massimo `most`; l'ultimo con … se avanza.
const chop = (text: string, room: number, most = Number.MAX_SAFE_INTEGER): string[] => {
  const chars = Array.from(text)
  const out: string[] = []
  for (let k = 0; k < chars.length && out.length < most; k += room) out.push(chars.slice(k, k + room).join(''))
  if (chars.length > room * most) out[most - 1] = fit(`${out[most - 1]}…`, room)
  return out
}

// Sotto l'hook scelto: il comando, da dove viene, timeout e messaggio, come si spegne.
const detailLines = (hook: SettingsHook, width: number): Line[] => {
  const room = Math.max(8, width - 3)
  const meta = [hook.timeout !== undefined ? `timeout ${hook.timeout}s` : '', hook.statusMessage ?? ''].filter(Boolean).join(' · ')
  const texts = [
    ...chop(`$ ${hook.command}`, room, COMMAND_ROWS),
    ...[...fromOf(hook), meta, howOf(hook)].filter(Boolean).flatMap(t => chop(t, room)),
  ]
  return texts.map((text, k) => el => (
    <el.Box key={`d:${hook.id}:${k}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={SELECTED_BG}>
      <el.Text dimColor>{`   ${text}`}</el.Text>
    </el.Box>
  ))
}

export function hookLines(width: number, toggle: (h: SettingsHook) => void, select: (h: SettingsHook) => void): Line[] {
  const list = ordered()
  if (list.length === 0) return [el => <el.Text dimColor>{fit('No hooks in this session.', width)}</el.Text>]
  const isShown = (hook: SettingsHook) => hookView.showAlways || canSwitch(hook)
  if (!list.some(isShown)) return [el => <el.Text dimColor>{fit(`Every hook here is always on: \`always\` shows them.`, width)}</el.Text>]

  const lines: Line[] = []
  let event = ''
  // `i` conta anche quelli nascosti, così i pulsanti tengono la loro chiave.
  list.forEach((hook, i) => {
    if (!isShown(hook)) return
    if (hook.event !== event) {
      event = hook.event
      const title = fit(event, width)
      lines.push(el => (
        <el.Box key={`e:${title}`} flexDirection="row" height={1} overflow="hidden">
          <el.Text dimColor bold>
            {title}
          </el.Text>
        </el.Box>
      ))
    }

    const off = isOff(hook)
    const sw = switchOf(hook)
    // ON ha nel suo riquadro uno spazio per parte come OFF, così la parola sta
    // al centro; la colonna che manca va nel riempimento a sinistra.
    const swW = Math.max(len(sw), len(' OFF '))
    const tag = tagOf(hook)
    const tagText = tag ? ` ${fit(tag, 17)} ` : ' '
    const room = Math.max(4, width - 3 - swW - len(tagText))
    const name = fit(hook.label, room)
    const whereRoom = room - len(name)
    const where = hook.matcher && whereRoom >= 4 ? fit(` ${hook.matcher}`, whereRoom) : ''
    const pad = ' '.repeat(Math.max(0, width - 3 - len(name) - len(where) - len(tagText) - len(sw)))
    const isSelected = hooks.selected === hook.id

    lines.push(el => (
      <el.Box key={`k:${hook.id}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={isSelected ? SELECTED_BG : undefined}>
        <el.Text color={off ? undefined : ON_DOT} dimColor={off}>
          {off ? ' ○ ' : ' ● '}
        </el.Text>
        <el.Button key={`hook-info:${i}`} plain label={`${hook.label} details`} onPress={() => select(hook)}>
          <el.Text bold={!off} dimColor={off}>
            {name}
          </el.Text>
        </el.Button>
        <el.Text dimColor>{where}</el.Text>
        <el.Text>{pad}</el.Text>
        <el.Text dimColor>{tagText}</el.Text>
        {canSwitch(hook) ? (
          <el.Button key={`hook:${i}`} plain label={sw.trim()} onPress={() => toggle(hook)}>
            <el.Text bold backgroundColor={off ? OFF.bg : ON.bg} color={off ? OFF.fg : ON.fg}>
              {sw}
            </el.Text>
          </el.Button>
        ) : (
          <el.Text dimColor>{sw}</el.Text>
        )}
      </el.Box>
    ))
    if (isSelected) lines.push(...detailLines(hook, width))
  })
  return lines
}
