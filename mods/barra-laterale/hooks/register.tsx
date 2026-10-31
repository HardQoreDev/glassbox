// Una barra a destra divisa in quattro: in cima gli hook delle impostazioni,
// da spegnere e riaccendere; poi il grafo dei branch come in VS Code (o i soli
// rami), i file (quelli modificati nella sessione, o l'albero come in
// filetree) e i turni come in turn-inspector. Ogni sezione ha la sua barretta
// colorata, si chiude dal titolo e scorre con la rotella sotto il puntatore;
// le altre si prendono lo spazio.
import type { EngineInterface, Register, RenderElement, ToolCallInput } from 'claude-code'

import { FLASH_MS, readText, refreshDirs, reveal, toggleDir, touch, tree, visibleRows } from './files'
import type { FileRow, Tone } from './files'
import { closePreview, openPreview, preview, refreshPreview } from './preview'
import { refreshRepo } from './repo'
import { GLOW_MS, hooks, loadHooks, matches, subjectOf } from './settings-hooks'
import type { Glow, SettingsHook } from './settings-hooks'
import { record } from './touched'
import { registerTurns, startTurns, toolDone, turns } from './turns-state'
import { fit, len, redraw } from './ui'
import type { Els, Line } from './ui'
import { join } from './vendor/filetree'
import { fileLines, filesInfo, touchedInfo, touchedLines } from './view-files'
import { branchLines, graph, graphInfo, graphLines } from './view-graph'
import { hookLines, hooksInfo } from './view-hooks'
import { previewLayout, previewLines } from './view-preview'
import type { PreviewLayout } from './view-preview'
import { INPUT_RAIL, turnLines, turnsInfo } from './view-turns'

const PANE = 'barra-laterale'
const TITLE = 'Sidebar'
const COMMAND = 'sidebar'
// La larghezza chiesta per il pannello agganciato a destra; trascinarlo vince.
const COLUMNS = 64
// Ogni quanto si rilegge il repo, per i cambi fatti fuori da questa sessione.
const EVERY_MS = 10_000

// La sezione degli hook è alta quanto le sue righe, fino a questo massimo.
const HOOK_ROWS = 6
// Il rientro delle righe sotto il titolo, a destra della barretta.
const INDENT = '  '
// Le righe che un tic della rotella scorre nell'anteprima di un file, e le
// colonne con il puntatore sopra lo slider.
const PREVIEW_WHEEL = 3
const SLIDER_WHEEL = 4
const FILES_COLOR = '#f0b429'

type SectionId = 'hooks' | 'graph' | 'files' | 'turns'
// Ogni sezione ha il suo colore: la barretta, il titolo, la riga sotto, lo scorrimento.
const SECTIONS: { id: SectionId; title: string; color: string }[] = [
  { id: 'hooks', title: 'HOOKS', color: '#4ade80' },
  { id: 'graph', title: 'BRANCHES', color: '#59a4f9' },
  { id: 'files', title: 'FILES', color: FILES_COLOR },
  { id: 'turns', title: 'TURNS', color: INPUT_RAIL },
]

type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }
type Tool = { key: string; label: string; dim?: boolean; active?: boolean; press: () => void }

// Quali sezioni sono aperte, e da che riga parte ciascuna.
const isOpen: Record<SectionId, boolean> = { hooks: true, graph: true, files: true, turns: true }
const offset: Record<SectionId, number> = { hooks: 0, graph: 0, files: 0, turns: 0 }
// Le righe del corpo che ogni sezione occupava all'ultimo disegno: la rotella
// scorre quella sotto il puntatore.
let spans: { id: SectionId; from: number; to: number; max: number }[] = []
// La vista della sezione FILE: i file modificati nella sessione, o l'albero.
let filesView: 'touched' | 'tree' = 'touched'
// La vista dei BRANCHES: ogni commit, o i soli rami.
let graphView: 'full' | 'graph' = 'full'
// Come era disposta l'anteprima di un file all'ultimo disegno: fin dove
// scorre, e in che riga è lo slider.
let previewAt: PreviewLayout | undefined

const READS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'LS'])
const WRITES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

async function refreshAll($: EngineInterface): Promise<void> {
  const hooksChanged = await loadHooks($)
  const repoChanged = await refreshRepo($)
  const dirsChanged = await refreshDirs($)
  const previewChanged = await refreshPreview($)
  if (hooksChanged || repoChanged || dirsChanged || previewChanged) redraw($)
}

// Accende gli hook appena scattati del colore di come è andata, e ridisegna
// quando la luce si spegne.
function glow($: EngineInterface, list: SettingsHook[], kind: Glow): void {
  const until = kind === 'run' ? Number.MAX_SAFE_INTEGER : Date.now() + GLOW_MS
  for (const item of list) hooks.glow.set(item.id, { kind, until })
  redraw($)
  if (kind !== 'run') $.clock.after(GLOW_MS + 100, () => redraw($))
}

// Il file su cui lavora uno strumento, assoluto; undefined se non ne nomina uno.
async function pathOf($: EngineInterface, e: ToolCallInput): Promise<string | undefined> {
  const input = e as unknown as Record<string, unknown>
  const path = [input.file_path, input.notebook_path, input.path].find((p): p is string => typeof p === 'string')
  if (path === undefined) return undefined
  return path.startsWith('/') ? path : join(await $.session.cwd(), path)
}

// Fuori dal giro dello strumento, così il suo esito arriva subito al modello
// e un errore qui non lo tocca. `before` è il file prima di una scrittura.
async function showActivity($: EngineInterface, e: ToolCallInput, isOk: boolean, before?: string | null): Promise<void> {
  try {
    const tone: Tone | undefined = WRITES.has(e.tool) ? 'orange' : READS.has(e.tool) ? 'purple' : undefined
    const path = await pathOf($, e)
    if (tone === 'orange' && path && isOk && before !== undefined) {
      const after = await readText($, path)
      if (after !== null && after !== before) record(path, before, after, Date.now())
      // L'anteprima aperta su questo file si aggiorna subito, senza aspettare git.
      if (path === preview.path && (await refreshPreview($))) redraw($)
    }
    if (tone && path && (await touch($, path, tone))) {
      redraw($)
      $.clock.after(FLASH_MS + 100, () => redraw($))
    }
    if (tone === 'orange' || e.tool === 'Bash') await refreshAll($)
  } catch (err) {
    $.ui.log(`barra-laterale: activity not shown: ${err}`)
  }
}

/** Divide `room` righe tra `n` sezioni aperte; il resto va alle prime. */
const share = (room: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => Math.floor(room / n) + (i < room % n ? 1 : 0))

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v))

export const register: Register = on => {
  registerTurns(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await startTurns($)
    await $.command
      .register({
        name: COMMAND,
        description: 'Opens the sidebar on the right: hooks, branches, files and turns (close)',
        argumentHint: '[close]',
      })
      .catch(err => $.ui.log(`barra-laterale: /${COMMAND} not registered: ${err}`))
    // La sessione parte subito; il pannello si riempie quando git ha risposto.
    // Trasparente: sotto la barra resta il fondo del terminale.
    void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS, backgroundColor: 'transparent' }).catch(() => undefined)
    void refreshAll($)
    $.clock.every(EVERY_MS, () => void refreshAll($))

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: `Sidebar closed: /${COMMAND} reopens it.` }
    }

    await refreshAll($)
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS, backgroundColor: 'transparent' })
    const hint = e.presentation.isFullscreen ? '' : ' It is above the prompt for now: /tui fullscreen docks it on the right.'
    return { text: `Sidebar opened.${hint}` }
  })

  // I file che Claude legge (viola) o scrive (arancio) si accendono; di quelli
  // che scrive si contano le righe, leggendoli prima e dopo. Dopo una
  // scrittura o un comando si rilegge il repo. La risposta va anche ai turni.
  on('tool.call', async ($, e, next) => {
    const path = WRITES.has(e.tool) ? await pathOf($, e).catch(() => undefined) : undefined
    const before = path ? await readText($, path) : undefined
    const ran = await next(e)
    toolDone(e, ran)
    void showActivity($, e, ran.deny === undefined && ran.isError !== true, before)

    return ran
  }).catch(($, e, next) => next(e))

  // Gli hook delle impostazioni passano di qui prima di partire: se tutti
  // quelli che corrispondono sono spenti, la risposta senza `next` li salta.
  on('classic.*', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : 'PreToolUse'
    const subject = subjectOf(input)
    const hit = hooks.list.filter(x => x.source !== 'policy' && x.event === event && matches(x.matcher, subject))
    if (hit.length === 0) return next(e)

    const live = hit.filter(x => !hooks.off.has(x.id))
    if (live.length === 0) {
      glow($, hit, 'skip')
      return {}
    }
    glow($, live, 'run')
    const r = await next(e).catch(err => {
      glow($, live, 'block')
      throw err
    })
    const answer = r as unknown as Record<string, unknown>
    glow($, live, answer.deny !== undefined || answer.block !== undefined ? 'block' : 'ok')

    return r
  }).catch(($, e, next) => next(e))

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (preview.path) {
      if (previewAt && e.pointer?.row === previewAt.sliderRow) preview.left = clamp(preview.left + e.by * SLIDER_WHEEL, previewAt.maxLeft)
      else preview.offset = clamp(preview.offset + e.by * (e.pointer ? PREVIEW_WHEEL : 1), previewAt?.maxTop ?? 0)
      redraw($)
      return {}
    }
    const row = e.pointer?.row
    const span =
      (row === undefined ? undefined : spans.find(s => row >= s.from && row < s.to)) ??
      spans.find(s => s.id === 'files') ??
      spans[0]
    if (!span) return {}
    offset[span.id] = clamp(offset[span.id] + e.by, span.max)
    if (span.id === 'turns') turns.follow = offset.turns >= span.max
    redraw($)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const el: Els = $.ui.resolve(e)
    const { Box, Button, Text } = el
    const width = Math.max(24, e.props.bodyColumns)
    // Il rientro a sinistra, una colonna a destra per lo scorrimento.
    const inner = width - len(INDENT) - 1
    const bodyRows = Math.max(SECTIONS.length, e.props.scroll.bodyRows)
    const now = Date.now()

    const fileRows = visibleRows()
    const pressFile = (r: FileRow) => {
      if (r.node.kind === 'dir') void toggleDir($, r.node.id).then(() => redraw($))
      else {
        tree.selected = tree.selected === r.node.id ? '' : r.node.id
        redraw($)
      }
    }
    const showView = (view: 'touched' | 'tree') => {
      if (filesView !== view) offset.files = 0
      filesView = view
      redraw($)
    }
    const showGraph = (view: 'full' | 'graph') => {
      if (graphView !== view) offset.graph = 0
      graphView = view
      redraw($)
    }
    const selectCommit = (hash: string) => {
      graph.selected = graph.selected === hash ? '' : hash
      redraw($)
    }

    // L'anteprima di un file prende il posto di tutte le sezioni.
    if (preview.path) {
      const layout = previewLayout(width, bodyRows)
      previewAt = layout
      preview.offset = clamp(preview.offset, layout.maxTop)
      preview.left = clamp(preview.left, layout.maxLeft)
      const slide = (left: number) => {
        preview.left = clamp(left, layout.maxLeft)
        redraw($)
      }
      const back = () => {
        closePreview()
        redraw($)
      }
      const showInTree = () => {
        const path = preview.path
        closePreview()
        showView('tree')
        void reveal($, path).then(() => redraw($))
      }
      return <Box flexDirection="column">{previewLines(el, width, layout, FILES_COLOR, back, showInTree, slide)}</Box>
    }

    const content: Record<SectionId, () => Line[]> = {
      hooks: () =>
        hookLines(inner, now, hook => {
          const wasOff = hooks.off.delete(hook.id)
          if (!wasOff) hooks.off.add(hook.id)
          $.ui.toast(`${hook.label}: ${wasOff ? 'ON' : 'OFF'} for this session`)
          redraw($)
        }),
      graph: () => (graphView === 'graph' ? branchLines(inner, now, selectCommit) : graphLines(inner, now, selectCommit)),
      files: () =>
        filesView === 'tree'
          ? fileLines(inner, now, fileRows, pressFile)
          : touchedLines(inner, now, t => void openPreview($, t.path).then(() => redraw($))),
      turns: () =>
        turnLines(inner, n => {
          if (turns.expanded.has(n)) turns.expanded.delete(n)
          else turns.expanded.add(n)
          redraw($)
        }),
    }
    const info: Record<SectionId, () => Seg[]> = {
      hooks: hooksInfo,
      graph: graphInfo,
      files: () => (filesView === 'tree' ? filesInfo() : touchedInfo()),
      turns: turnsInfo,
    }
    const tools: Record<SectionId, Tool[]> = {
      hooks: [],
      graph: [
        { key: 'graph-view-full', label: 'full', active: graphView === 'full', press: () => showGraph('full') },
        { key: 'graph-view-graph', label: 'graph', active: graphView === 'graph', press: () => showGraph('graph') },
        { key: 'graph-refresh', label: '↻', dim: true, press: () => void refreshAll($) },
      ],
      files: [
        { key: 'files-view-touched', label: 'changed', active: filesView === 'touched', press: () => showView('touched') },
        { key: 'files-view-tree', label: 'tree', active: filesView === 'tree', press: () => showView('tree') },
        ...(filesView === 'tree'
          ? [
              {
                key: 'files-collapse',
                label: '⊟',
                dim: true,
                press: () => {
                  tree.expanded.clear()
                  offset.files = 0
                  redraw($)
                },
              },
            ]
          : []),
        { key: 'files-refresh', label: '↻', dim: true, press: () => void refreshAll($) },
      ],
      turns: [
        {
          key: 'turns-follow',
          label: '⤓',
          dim: !turns.follow,
          press: () => {
            turns.follow = !turns.follow
            redraw($)
          },
        },
        {
          key: 'turns-collapse',
          label: '⊟',
          dim: true,
          press: () => {
            turns.expanded.clear()
            redraw($)
          },
        },
      ],
    }

    // Il titolo: la barretta colorata, il nome, le informazioni, gli strumenti a
    // destra. Da aperta la sezione ha sotto una riga sottile del suo colore.
    const header = (id: SectionId, title: string, color: string): RenderElement[] => {
      const open = isOpen[id]
      const label = `▌ ${title}`
      const toolsW = tools[id].reduce((w, t) => w + 1 + len(t.label), 0)
      const room = Math.max(0, width - len(label) - 2 - toolsW - 1)
      const segs: Seg[] = []
      let used = 0
      for (const s of info[id]()) {
        if (used >= room) break
        const text = fit(s.text, room - used)
        segs.push({ ...s, text })
        used += len(text)
      }
      const pad = ' '.repeat(Math.max(1, width - len(label) - 2 - used - toolsW))
      const titleRow = (
        <Box key={`h:${id}`} flexDirection="row" height={1} overflow="hidden">
          <Button
            key={`section:${id}`}
            plain
            label={label}
            onPress={() => {
              isOpen[id] = !isOpen[id]
              redraw($)
            }}
          >
            <Text color={color} dimColor={!open}>
              ▌{' '}
              <Text bold>{title}</Text>
            </Text>
          </Button>
          <Text>{'  '}</Text>
          {segs.map(s => (
            <Text color={s.color} dimColor={s.dim} bold={s.bold}>
              {s.text}
            </Text>
          ))}
          <Text>{pad}</Text>
          {tools[id].map(t =>
            t.active === undefined ? (
              <Button key={t.key} plain dimColor={t.dim} label={` ${t.label}`} onPress={t.press} />
            ) : (
              <Button key={t.key} plain label={` ${t.label}`} onPress={t.press}>
                <Text> </Text>
                <Text color={t.active ? color : undefined} dimColor={!t.active} bold={t.active} underline={t.active}>
                  {t.label}
                </Text>
              </Button>
            ),
          )}
        </Box>
      )
      if (!open) return [titleRow]
      return [
        titleRow,
        <Box key={`r:${id}`} height={1} overflow="hidden">
          <Text color={color} dimColor>
            {'▔'.repeat(width)}
          </Text>
        </Box>,
      ]
    }

    // Le righe di ogni sezione aperta; quella degli hook prende solo le sue,
    // le altre si dividono il resto in parti uguali.
    const lines = Object.fromEntries(SECTIONS.filter(s => isOpen[s.id]).map(s => [s.id, content[s.id]()])) as Partial<Record<SectionId, Line[]>>
    const headerRows = SECTIONS.reduce((n, s) => n + (isOpen[s.id] ? 2 : 1), 0)
    const hookRows = lines.hooks ? Math.min(HOOK_ROWS, lines.hooks.length) : 0
    const shared = SECTIONS.filter(s => isOpen[s.id] && s.id !== 'hooks')
    const heights = share(Math.max(0, bodyRows - headerRows - hookRows), shared.length)
    const out: RenderElement[] = []
    const nextSpans: typeof spans = []
    let row = 0
    for (const s of SECTIONS) {
      const head = header(s.id, s.title, s.color)
      out.push(...head)
      row += head.length
      if (!isOpen[s.id]) continue

      const own = lines[s.id] ?? []
      const rows = s.id === 'hooks' ? hookRows : (heights[shared.indexOf(s)] ?? 0)
      const max = Math.max(0, own.length - rows)
      if (s.id === 'turns' && turns.follow) offset.turns = max
      if (s.id === 'files' && filesView === 'tree' && tree.reveal) {
        const at = fileRows.findIndex(r => r.node.id === tree.reveal)
        if (at !== -1 && (at < offset.files || at >= offset.files + rows)) offset.files = at - Math.floor(rows / 2)
        tree.reveal = ''
      }
      offset[s.id] = clamp(offset[s.id], max)
      const from = offset[s.id]
      nextSpans.push({ id: s.id, from: row, to: row + rows, max })

      const thumb = Math.max(1, Math.round((rows * rows) / Math.max(1, own.length)))
      const thumbAt = max === 0 ? 0 : Math.round((from / max) * (rows - thumb))
      for (let i = 0; i < rows; i++) {
        const line = own[from + i]
        const isThumb = i >= thumbAt && i < thumbAt + thumb
        out.push(
          <Box key={`${s.id}:${i}`} flexDirection="row" height={1} overflow="hidden">
            <Text>{INDENT}</Text>
            <Box width={inner} height={1} overflow="hidden">
              {line ? line(el) : <Text> </Text>}
            </Box>
            {max > 0 ? (
              <Text color={isThumb ? s.color : undefined} dimColor={!isThumb}>
                {isThumb ? '┃' : '│'}
              </Text>
            ) : (
              <Text> </Text>
            )}
          </Box>,
        )
      }
      row += rows
    }
    spans = nextSpans

    return <Box flexDirection="column">{out}</Box>
  })
}
