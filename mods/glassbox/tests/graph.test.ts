import { describe, expect, test } from 'claude-code/testing'

import { layout, parseLog } from '../hooks/graph'
import type { GraphRow } from '../hooks/graph'

const F = '\x1f'
const R = '\x1e'
const commit = (hash: string, parents: string, refs: string, subject: string) =>
  [hash, hash.slice(0, 7), parents, refs, subject, 'Giulio', '1761700000'].join(F) + R

// Un ramo `feature` che si separa da c1 e torna in main con il merge c3.
export const LOG = [
  commit('c3', 'c2 c1b', 'HEAD -> main, origin/main', 'Merge feature'),
  commit('c2', 'c1', '', 'Lavoro su main'),
  commit('c1b', 'c1', 'origin/feature', 'Lavoro sul ramo'),
  commit('c1', '', '', 'Primo commit'),
].join('\n')

const drawn = (row: GraphRow | undefined) => row?.cells.map(c => c.glyph + c.fill).join('').trimEnd()

describe('parseLog', () => {
  test('hash, genitori, nomi e HEAD', () => {
    const [head, , branch, root] = parseLog(LOG, ['origin'])
    expect(head?.parents).toEqual(['c2', 'c1b'])
    expect(head?.refs).toEqual([{ name: 'main', kind: 'current', isSynced: true }])
    expect(head?.isHead).toBe(true)
    expect(branch?.refs).toEqual([{ name: 'origin/feature', kind: 'remote' }])
    expect(root?.parents).toEqual([])
  })
})

describe('layout', () => {
  test('il merge apre una corsia, il ramo ci scorre accanto e si riunisce al genitore', () => {
    const rows = layout(parseLog(LOG, ['origin']))
    expect(rows.map(drawn)).toEqual(['○─╮', '● │', '│ ●', '●─╯'])
    expect(rows.map(r => r.lane)).toEqual([0, 0, 1, 0])
    // il ramo ha un colore suo, main tiene il primo
    expect(rows[2]?.color).not.toBe(rows[0]?.color)
    expect(rows[3]?.color).toBe(rows[0]?.color)
  })

  test('un secondo genitore già atteso da una corsia la raggiunge con ┤', () => {
    // lo stesso commit del ramo unito in main due volte
    const log = [
      commit('m2', 'm1 f1', 'HEAD -> main', 'Secondo merge'),
      commit('m1', 'a1 f1', '', 'Primo merge'),
      commit('f1', 'a1', 'feature', 'Ramo'),
      commit('a1', '', '', 'Base'),
    ].join('\n')
    const rows = layout(parseLog(log, []))
    expect(rows.map(drawn)).toEqual(['○─╮', '⊙─┤', '│ ●', '●─╯'])
  })

  test('un branch che parte dal nulla prende la prima corsia libera', () => {
    const log = [commit('x2', 'x1', 'altro', 'Altro ramo'), commit('y1', '', 'main', 'Radice di main')].join('\n')
    const rows = layout(parseLog(log, []))
    expect(drawn(rows[0])).toBe('●')
    expect(drawn(rows[1])).toBe('│ ●')
  })
})
