export const hooks = {
    list: [],
    // I nomi spenti in questa sessione, come stanno in HOOK_SWITCH_OFF.
    off: new Set(),
    // L'hook di cui si vedono i dettagli.
    selected: '',
    // La cartella di casa e quella della configurazione, per i percorsi da mostrare.
    home: '',
    config: '',
};
const SOURCES = ['policy', 'user', 'project', 'local', 'flag'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Un valore di enabledPlugins che abilita: true, o le versioni chieste.
const isEnabled = (v) => v !== undefined && v !== null && v !== false;
const words = (text) => (text ?? '').split(/\s+/).filter(Boolean);
const unquote = (w) => w.replace(/^['"]|['"]$/g, '');
const base = (path) => path.split('/').pop() ?? path;
// `rel` sotto `dir`, senza i `./` e la barra in fondo.
const under = (dir, rel) => rel.startsWith('/') ? rel : `${dir.replace(/\/$/, '')}/${rel.replace(/^(\.\/)+/, '').replace(/^\.$/, '')}`.replace(/\/$/, '');
// Il nome breve di un comando: lo script lanciato, senza percorso né virgolette.
const labelOf = (type, args) => {
    if (type !== 'command')
        return type;
    const script = args.find(w => /[/.]/.test(w) && !w.startsWith('-') && !/^(bash|sh|python3?|node)$/.test(w));
    return base(script ?? args[0] ?? type);
};
const parse = (source, raw, plugin) => {
    if (!isObject(raw))
        return [];
    const out = [];
    for (const [event, groups] of Object.entries(raw)) {
        if (!Array.isArray(groups))
            continue;
        for (const group of groups) {
            const matcher = typeof group?.matcher === 'string' ? group.matcher : '';
            if (!Array.isArray(group?.hooks))
                continue;
            for (const hook of group.hooks) {
                const type = typeof hook?.type === 'string' ? hook.type : 'command';
                const command = typeof hook?.command === 'string' ? hook.command : typeof hook?.prompt === 'string' ? hook.prompt : '';
                const args = (command.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(unquote);
                const isSwitch = type === 'command' && base(args[0] ?? '') === 'hook-switch' && args[1] !== undefined;
                const switchName = isSwitch ? args[1] : undefined;
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
                });
            }
        }
    }
    return out;
};
async function readJson($, path) {
    const text = await $.fs.read(path).catch(() => undefined);
    if (text === undefined)
        return undefined;
    try {
        const value = JSON.parse(text);
        return isObject(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
// Da dove gira un plugin installato. Quello di un marketplace `directory`
// gira dalla cartella sorgente, non dalla copia in cache; gli altri dalla
// copia che installed_plugins.json indica. Lo legge come fa il motore oggi:
// se il motore cambia posto ai plugin, qui non si trova più niente.
async function pluginRoot($, key, config, project) {
    const [name = '', market = ''] = key.split('@');
    const markets = await readJson($, `${config}/plugins/known_marketplaces.json`);
    const known = markets?.[market];
    const source = isObject(known) ? known.source : undefined;
    if (isObject(known) && isObject(source) && source.source === 'directory') {
        const dir = typeof known.installLocation === 'string' ? known.installLocation : typeof source.path === 'string' ? source.path : '';
        const listing = await readJson($, `${dir}/.claude-plugin/marketplace.json`);
        const entries = Array.isArray(listing?.plugins) ? listing.plugins : [];
        const entry = entries.find(p => isObject(p) && p.name === name);
        if (typeof entry?.source === 'string')
            return under(dir, entry.source);
    }
    const installed = await readJson($, `${config}/plugins/installed_plugins.json`);
    const plugins = isObject(installed?.plugins) ? installed.plugins : {};
    const copies = (Array.isArray(plugins[key]) ? plugins[key] : []);
    const copy = copies.find(c => c.projectPath === project) ?? copies.find(c => c.scope === 'user') ?? copies[0];
    return typeof copy?.installPath === 'string' ? copy.installPath : undefined;
}
// Gli hook di un plugin: hooks/hooks.json, più quelli che il manifest nomina
// (un file, una lista di file o gli hook scritti lì).
async function hooksOfPlugin($, key, root) {
    const plugin = { key, root };
    const manifest = await readJson($, `${root}/.claude-plugin/plugin.json`);
    const named = manifest?.hooks;
    const listed = typeof named === 'string' ? [named] : Array.isArray(named) ? named.filter((f) => typeof f === 'string') : [];
    const out = [];
    for (const file of [...new Set([`${root}/hooks/hooks.json`, ...listed.map(f => under(root, f))])]) {
        const json = await readJson($, file);
        out.push(...parse('plugin', json?.hooks, plugin));
    }
    if (isObject(named))
        out.push(...parse('plugin', isObject(named.hooks) ? named.hooks : named, plugin));
    return out;
}
// Gli hook dei plugin abilitati.
async function pluginHooks($, config) {
    const [project, merged] = await Promise.all([$.session.root(), $.settings.read().catch(() => ({}))]);
    const enabled = isObject(merged.enabledPlugins) ? merged.enabledPlugins : {};
    const lists = await Promise.all(Object.keys(enabled)
        .filter(key => isEnabled(enabled[key]))
        .map(async (key) => {
        const root = await pluginRoot($, key, config, project).catch(() => undefined);
        return root ? hooksOfPlugin($, key, root).catch(() => []) : [];
    }));
    return lists.flat();
}
/** Rilegge gli hook della sessione e quali sono spenti; `true` se è cambiato qualcosa. */
export async function loadHooks($) {
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? '';
    // La configurazione di Claude Code: CLAUDE_CONFIG_DIR, o ~/.claude.
    const config = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? `${home}/.claude`;
    hooks.home = home;
    hooks.config = config;
    const [layers, plugins, off] = await Promise.all([
        Promise.all(SOURCES.map(source => $.settings
            .read({ source })
            .then(s => parse(source, s.hooks))
            .catch(() => []))),
        pluginHooks($, config).catch(() => []),
        $.env.get('HOOK_SWITCH_OFF').catch(() => undefined),
    ]);
    const list = [...layers.flat(), ...plugins];
    const next = { list, off: [...new Set(words(off))].sort() };
    if (JSON.stringify(next) === JSON.stringify({ list: hooks.list, off: [...hooks.off].sort() }))
        return false;
    hooks.list = list;
    hooks.off = new Set(next.off);
    return true;
}
/** Se l'hook è spento in questa sessione. */
export const isOff = (h) => h.switchName !== undefined && hooks.off.has(h.switchName);
/** Se la barra può spegnerlo: scritto con hook-switch, e non dell'organizzazione. */
export const canSwitch = (h) => h.source !== 'policy' && h.switchName !== undefined;
/** Spegne o riaccende un hook in questa sessione; resolve con il testo per il toast. */
export async function toggleHook($, h) {
    if (!canSwitch(h) || h.switchName === undefined)
        throw new Error(`${h.label} is not written with hook-switch`);
    const wasOff = isOff(h);
    const off = new Set(hooks.off);
    if (wasOff)
        off.delete(h.switchName);
    else
        off.add(h.switchName);
    const value = [...off].join(' ');
    const r = await $.env.set('HOOK_SWITCH_OFF', value === '' ? undefined : value);
    if (r.deny !== undefined)
        throw new Error(r.deny);
    hooks.off = off;
    return `${h.switchName}: ${wasOff ? 'ON' : 'OFF'} for this session`;
}
