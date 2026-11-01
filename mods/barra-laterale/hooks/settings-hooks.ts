// Gli hook che girano in questa sessione: quelli delle impostazioni (utente,
// progetto, locale, --settings e quelli gestiti dall'organizzazione) e quelli
// dei plugin abilitati, letti dai loro hooks.json.
//
// Un mod non può fermare un hook classico: in un'organizzazione Team o
// Enterprise il plugin di sicurezza del motore (sec-default) sta davanti a
// tutti e manda gli eventi classici oltre i mod. Per questo un hook si spegne
// da solo: scritto come `hook-switch <nome> <comando>` (bin/hook-switch), non
// parte se <nome> è in HOOK_SWITCH_OFF, che il mod cambia per questa sola
// sessione; gli hook lanciati dopo la ereditano. <nome> dice cosa fa l'hook,
// ed è il titolo della sua riga. Vale anche per un plugin che scrive così i
// suoi hook; gli altri si vedono e basta.
import type { EngineInterface } from 'claude-code'

export type HookSource = 'policy' | 'user' | 'project' | 'local' | 'flag' | 'plugin'

export type SettingsHook = {
  id: string
  source: HookSource
  event: string
  matcher: string
  // Il nome da mostrare: quello dato a hook-switch, lo script del comando, o il tipo dell'hook.
  label: string
  command: string
  // Il nome con cui hook-switch lo spegne; assente se non è scritto così.
  switchName?: string
  // Per un hook di plugin: la chiave name@marketplace e la cartella da cui gira.
  plugin?: string
  root?: string
  timeout?: number
  statusMessage?: string
}

export const hooks = {
  list: [] as SettingsHook[],
  // I nomi spenti in questa sessione, come stanno in HOOK_SWITCH_OFF.
  off: new Set<string>(),
  // L'hook di cui si vedono i dettagli.
  selected: '',
  // La cartella di casa e quella della configurazione, per i percorsi da mostrare.
  home: '',
  config: '',
}

const SOURCES = ['policy', 'user', 'project', 'local', 'flag'] as const

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
// Un valore di enabledPlugins che abilita: true, o le versioni chieste.
const isEnabled = (v: unknown): boolean => v !== undefined && v !== null && v !== false
const words = (text: string | undefined): string[] => (text ?? '').split(/\s+/).filter(Boolean)
const unquote = (w: string) => w.replace(/^['"]|['"]$/g, '')
const base = (path: string) => path.split('/').pop() ?? path

// `rel` sotto `dir`, senza i `./` e la barra in fondo.
const under = (dir: string, rel: string): string =>
  rel.startsWith('/') ? rel : `${dir.replace(/\/$/, '')}/${rel.replace(/^(\.\/)+/, '').replace(/^\.$/, '')}`.replace(/\/$/, '')

// Il nome breve di un comando: lo script lanciato, senza percorso né virgolette.
const labelOf = (type: string, args: string[]): string => {
  if (type !== 'command') return type
  const script = args.find(w => /[/.]/.test(w) && !w.startsWith('-') && !/^(bash|sh|python3?|node)$/.test(w))
  return base(script ?? args[0] ?? type)
}

const parse = (source: HookSource, raw: unknown, plugin?: { key: string; root: string }): SettingsHook[] => {
  if (!isObject(raw)) return []
  const out: SettingsHook[] = []
  for (const [event, groups] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups as { matcher?: unknown; hooks?: unknown }[]) {
      const matcher = typeof group?.matcher === 'string' ? group.matcher : ''
      if (!Array.isArray(group?.hooks)) continue
      for (const hook of group.hooks as Record<string, unknown>[]) {
        const type = typeof hook?.type === 'string' ? hook.type : 'command'
        const command = typeof hook?.command === 'string' ? hook.command : typeof hook?.prompt === 'string' ? hook.prompt : ''
        const args = (command.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(unquote)
        const isSwitch = type === 'command' && base(args[0] ?? '') === 'hook-switch' && args[1] !== undefined
        const switchName = isSwitch ? args[1] : undefined
        out.push({
          id: `${plugin ? `plugin:${plugin.key}` : source}|${event}|${matcher}|${command}`,
          source,
          event,
          matcher,
          label: switchName ?? labelOf(type, args),
          command,
          ...(switchName ? { switchName } : {}),
          ...(plugin ? { plugin: plugin.key, root: plugin.root } : {}),
          ...(typeof hook.timeout === 'number' ? { timeout: hook.timeout } : {}),
          ...(typeof hook.statusMessage === 'string' ? { statusMessage: hook.statusMessage } : {}),
        })
      }
    }
  }
  return out
}

async function readJson($: EngineInterface, path: string): Promise<Json | undefined> {
  const text = await $.fs.read(path).catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

// Da dove gira un plugin installato. Quello di un marketplace `directory`
// gira dalla cartella sorgente, non dalla copia in cache; gli altri dalla
// copia che installed_plugins.json indica. Lo legge come fa il motore oggi:
// se il motore cambia posto ai plugin, qui non si trova più niente.
async function pluginRoot($: EngineInterface, key: string, config: string, project: string): Promise<string | undefined> {
  const [name = '', market = ''] = key.split('@')
  const markets = await readJson($, `${config}/plugins/known_marketplaces.json`)
  const known = markets?.[market]
  const source = isObject(known) ? known.source : undefined
  if (isObject(known) && isObject(source) && source.source === 'directory') {
    const dir = typeof known.installLocation === 'string' ? known.installLocation : typeof source.path === 'string' ? source.path : ''
    const listing = await readJson($, `${dir}/.claude-plugin/marketplace.json`)
    const entries = Array.isArray(listing?.plugins) ? (listing.plugins as Json[]) : []
    const entry = entries.find(p => isObject(p) && p.name === name)
    if (typeof entry?.source === 'string') return under(dir, entry.source)
  }
  const installed = await readJson($, `${config}/plugins/installed_plugins.json`)
  const plugins = isObject(installed?.plugins) ? installed.plugins : {}
  const copies = (Array.isArray(plugins[key]) ? plugins[key] : []) as Json[]
  const copy = copies.find(c => c.projectPath === project) ?? copies.find(c => c.scope === 'user') ?? copies[0]
  return typeof copy?.installPath === 'string' ? copy.installPath : undefined
}

// Gli hook di un plugin: hooks/hooks.json, più quelli che il manifest nomina
// (un file, una lista di file o gli hook scritti lì).
async function hooksOfPlugin($: EngineInterface, key: string, root: string): Promise<SettingsHook[]> {
  const plugin = { key, root }
  const manifest = await readJson($, `${root}/.claude-plugin/plugin.json`)
  const named = manifest?.hooks
  const listed = typeof named === 'string' ? [named] : Array.isArray(named) ? named.filter((f): f is string => typeof f === 'string') : []
  const out: SettingsHook[] = []
  for (const file of [...new Set([`${root}/hooks/hooks.json`, ...listed.map(f => under(root, f))])]) {
    const json = await readJson($, file)
    out.push(...parse('plugin', json?.hooks, plugin))
  }
  if (isObject(named)) out.push(...parse('plugin', isObject(named.hooks) ? named.hooks : named, plugin))
  return out
}

// Gli hook dei plugin abilitati.
async function pluginHooks($: EngineInterface, config: string): Promise<SettingsHook[]> {
  const [project, merged] = await Promise.all([$.session.root(), $.settings.read().catch(() => ({}) as Json)])
  const enabled = isObject((merged as Json).enabledPlugins) ? ((merged as Json).enabledPlugins as Json) : {}
  const lists = await Promise.all(
    Object.keys(enabled)
      .filter(key => isEnabled(enabled[key]))
      .map(async key => {
        const root = await pluginRoot($, key, config, project).catch(() => undefined)
        return root ? hooksOfPlugin($, key, root).catch(() => []) : []
      }),
  )
  return lists.flat()
}

/** Rilegge gli hook della sessione e quali sono spenti; `true` se è cambiato qualcosa. */
export async function loadHooks($: EngineInterface): Promise<boolean> {
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  // La configurazione di Claude Code: CLAUDE_CONFIG_DIR, o ~/.claude.
  const config = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? `${home}/.claude`
  hooks.home = home
  hooks.config = config
  const [layers, plugins, off] = await Promise.all([
    Promise.all(
      SOURCES.map(source =>
        $.settings
          .read({ source })
          .then(s => parse(source, (s as { hooks?: unknown }).hooks))
          .catch(() => [] as SettingsHook[]),
      ),
    ),
    pluginHooks($, config).catch(() => [] as SettingsHook[]),
    $.env.get('HOOK_SWITCH_OFF').catch(() => undefined),
  ])
  const list = [...layers.flat(), ...plugins]
  const next = { list, off: [...new Set(words(off))].sort() }
  if (JSON.stringify(next) === JSON.stringify({ list: hooks.list, off: [...hooks.off].sort() })) return false
  hooks.list = list
  hooks.off = new Set(next.off)
  return true
}

/** Se l'hook è spento in questa sessione. */
export const isOff = (h: SettingsHook): boolean => h.switchName !== undefined && hooks.off.has(h.switchName)

/** Se la barra può spegnerlo: scritto con hook-switch, e non dell'organizzazione. */
export const canSwitch = (h: SettingsHook): boolean => h.source !== 'policy' && h.switchName !== undefined

/** Spegne o riaccende un hook in questa sessione; resolve con il testo per il toast. */
export async function toggleHook($: EngineInterface, h: SettingsHook): Promise<string> {
  if (!canSwitch(h) || h.switchName === undefined) throw new Error(`${h.label} is not written with hook-switch`)
  const wasOff = isOff(h)
  const off = new Set(hooks.off)
  if (wasOff) off.delete(h.switchName)
  else off.add(h.switchName)
  const value = [...off].join(' ')
  const r = await $.env.set('HOOK_SWITCH_OFF', value === '' ? undefined : value)
  if (r.deny !== undefined) throw new Error(r.deny)
  hooks.off = off
  return `${h.switchName}: ${wasOff ? 'ON' : 'OFF'} for this session`
}
