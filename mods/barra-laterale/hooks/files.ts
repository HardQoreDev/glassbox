// L'albero dei file della sezione in mezzo: le cartelle lette con `$.fs.list`
// quando si aprono, e i file che Claude legge o scrive evidenziati per tre
// secondi, con le cartelle sopra di loro aperte, come fa filetree.
import type { EngineInterface } from 'claude-code'

import { repo } from './repo'
import { ancestorsOf, dirname, inside, replaceChildren, toNodes } from './vendor/filetree'
import type { Entry, FileNode } from './vendor/filetree'

// Viola per le letture, arancio per le scritture: i toni di filetree.
export type Tone = 'purple' | 'orange'

export type FileRow = { node: FileNode; depth: number; open: boolean }

export const FLASH_MS = 3_000

export const tree = {
  nodes: [] as FileNode[],
  expanded: new Set<string>(),
  selected: '',
  flash: new Map<string, { tone: Tone; until: number }>(),
  // Il file da portare nella finestra visibile al prossimo disegno.
  reveal: '',
}

// Le cartelle che non si mostrano mai.
const SKIP = new Set(['.git'])

// Il contenuto di ogni cartella letta l'ultima volta: senza cambi niente ridisegno.
const seen = new Map<string, string>()

/** Rilegge una cartella; `true` se il suo contenuto è cambiato. */
export async function listDir($: EngineInterface, dir: string): Promise<boolean> {
  const entries = await $.fs.list(dir).catch(() => null)
  if (entries === null) return false
  const list: Entry[] = entries
    .filter(e => !SKIP.has(e.name))
    .map(e => ({
      name: e.name,
      kind: e.kind === 'dir' ? 'dir' : e.kind === 'file' ? 'file' : 'other',
      mtimeMs: e.mtimeMs,
      size: e.size,
      isLink: e.isLink,
    }))
  const kids = toNodes(dir, list)
  const sig = kids.map(k => `${k.name}\t${k.kind}\t${k.mtime}\t${k.size}`).join('\n')
  if (seen.get(dir) === sig) return false
  seen.set(dir, sig)
  tree.nodes = replaceChildren(tree.nodes, new Map([[dir, kids]]))
  return true
}

/** Rilegge la radice e le cartelle aperte. */
export async function refreshDirs($: EngineInterface): Promise<boolean> {
  if (!repo.root) return false
  const dirs = [repo.root, ...[...tree.expanded].filter(d => inside(repo.root, d))]
  const changed = await Promise.all(dirs.map(d => listDir($, d)))
  return changed.some(Boolean)
}

export async function toggleDir($: EngineInterface, id: string): Promise<void> {
  if (tree.expanded.has(id)) {
    tree.expanded.delete(id)
    return
  }
  tree.expanded.add(id)
  await listDir($, id)
}

/** Claude ha letto o scritto `path`: apre le cartelle sopra e lo accende. */
export async function touch($: EngineInterface, path: string, tone: Tone): Promise<boolean> {
  if (!repo.root || path === repo.root || !inside(repo.root, path)) return false
  for (const dir of ancestorsOf(path, repo.root).reverse()) {
    tree.expanded.add(dir)
    await listDir($, dir)
  }
  if (tone === 'orange') await listDir($, dirname(path))
  tree.flash.set(path, { tone, until: Date.now() + FLASH_MS })
  tree.reveal = path
  return true
}

/** Mostra `path` nell'albero: apre le cartelle sopra e lo seleziona. */
export async function reveal($: EngineInterface, path: string): Promise<void> {
  if (!repo.root || !inside(repo.root, path)) return
  for (const dir of ancestorsOf(path, repo.root).reverse()) {
    tree.expanded.add(dir)
    await listDir($, dir)
  }
  await listDir($, dirname(path))
  tree.selected = path
  tree.reveal = path
}

/** Le righe visibili: la radice, poi dentro ogni cartella aperta. */
export const visibleRows = (): FileRow[] => {
  const kids = new Map<string, FileNode[]>()
  for (const n of tree.nodes) {
    const list = kids.get(n.parent)
    if (list) list.push(n)
    else kids.set(n.parent, [n])
  }
  const rows: FileRow[] = []
  const walk = (dir: string, depth: number) => {
    for (const node of kids.get(dir) ?? []) {
      const open = node.kind === 'dir' && tree.expanded.has(node.id)
      rows.push({ node, depth, open })
      if (open) walk(node.id, depth + 1)
    }
  }
  walk(repo.root, 0)
  return rows
}
