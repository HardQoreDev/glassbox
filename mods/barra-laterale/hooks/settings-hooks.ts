// Gli hook delle impostazioni (settings.json utente, progetto, locale e quelli
// gestiti dall'organizzazione): la lista per la sezione HOOK, quali sono spenti
// in questa sessione e quali si sono appena attivati.
//
// Nel motore la catena di ogni evento classico è [hook gestiti, mod, gli altri
// hook delle impostazioni]: un mod che risponde senza `next` impedisce agli hook
// utente, progetto e locale di partire. Quelli gestiti stanno sopra e non si
// spengono. Il motore esegue in blocco gli hook dello stesso evento, quindi uno
// spento parte comunque se un altro acceso dello stesso evento corrisponde.
import type { EngineInterface } from 'claude-code'

export type HookSource = 'user' | 'project' | 'local' | 'policy'

export type SettingsHook = {
  id: string
  source: HookSource
  event: string
  matcher: string
  // Il nome da mostrare: lo script del comando, o il tipo dell'hook.
  label: string
  command: string
}

// Come si è appena comportato un hook: in corso, passato, ha bloccato, saltato perché spento.
export type Glow = 'run' | 'ok' | 'block' | 'skip'

export const GLOW_MS = 2_000

export const hooks = {
  list: [] as SettingsHook[],
  // Gli id degli hook spenti in questa sessione.
  off: new Set<string>(),
  glow: new Map<string, { kind: Glow; until: number }>(),
}

const SOURCES: HookSource[] = ['policy', 'user', 'project', 'local']

// Il nome breve di un comando: lo script lanciato, senza percorso né virgolette.
const labelOf = (type: string, command: string): string => {
  if (type !== 'command') return type
  const words = command.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
  const script = words.map(w => w.replace(/^['"]|['"]$/g, '')).find(w => /[/.]/.test(w) && !/^(bash|sh|python3?|node)$/.test(w))
  return (script ?? words[0] ?? command).split('/').pop() ?? command
}

const parse = (source: HookSource, raw: unknown): SettingsHook[] => {
  if (raw === null || typeof raw !== 'object') return []
  const out: SettingsHook[] = []
  for (const [event, groups] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups as { matcher?: unknown; hooks?: unknown }[]) {
      const matcher = typeof group?.matcher === 'string' ? group.matcher : ''
      if (!Array.isArray(group?.hooks)) continue
      for (const hook of group.hooks as { type?: unknown; command?: unknown; prompt?: unknown }[]) {
        const type = typeof hook?.type === 'string' ? hook.type : 'command'
        const command = typeof hook?.command === 'string' ? hook.command : typeof hook?.prompt === 'string' ? hook.prompt : ''
        out.push({ id: `${source}|${event}|${matcher}|${command}`, source, event, matcher, label: labelOf(type, command), command })
      }
    }
  }
  return out
}

/** Rilegge gli hook da tutte le impostazioni; `true` se la lista è cambiata. */
export async function loadHooks($: EngineInterface): Promise<boolean> {
  const layers = await Promise.all(
    SOURCES.map(source =>
      $.settings
        .read({ source })
        .then(s => parse(source, (s as { hooks?: unknown }).hooks))
        .catch(() => [] as SettingsHook[]),
    ),
  )
  const list = layers.flat()
  if (JSON.stringify(list) === JSON.stringify(hooks.list)) return false
  hooks.list = list
  return true
}

/**
 * Se `matcher` vale per `value`, come in Claude Code: vuoto o `*` vale sempre,
 * parole separate da `|` valgono esatte, il resto è un'espressione regolare.
 * Un evento che non ha niente da confrontare vale sempre.
 */
export const matches = (matcher: string, value: string): boolean => {
  if (matcher === '' || matcher === '*' || value === '') return true
  if (/^[\w|]+$/.test(matcher)) return matcher.split('|').includes(value)
  try {
    return new RegExp(matcher).test(value)
  } catch {
    return false
  }
}

/** Il valore con cui un evento confronta i matcher: lo strumento, la causa, il tipo. */
export const subjectOf = (e: Record<string, unknown>): string => {
  for (const key of ['tool', 'tool_name', 'source', 'trigger', 'reason', 'notification_type', 'agent_type']) {
    const v = e[key]
    if (typeof v === 'string') return v
  }
  return ''
}

/** Un hook spento che parte comunque, perché un altro acceso ha lo stesso evento. */
export const sharesEvent = (h: SettingsHook): boolean =>
  hooks.list.some(o => o.id !== h.id && o.event === h.event && o.source !== 'policy' && !hooks.off.has(o.id))
