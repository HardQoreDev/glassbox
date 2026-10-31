import { describe, expect, test } from 'claude-code/testing'

import { diffLines, hunkOf } from '../hooks/preview'

const ops = (before: string, after: string) => diffLines(before, after).map(r => r.op + r.text)

describe('diffLines', () => {
  test('il file di adesso, con in mezzo le righe tolte', () => {
    expect(ops('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([' a', '-b', '+B', ' c', '+d'])
    expect(ops('', 'uno\ndue\n')).toEqual(['+uno', '+due'])
    expect(ops('uno\ndue\n', '')).toEqual(['-uno', '-due'])
    expect(ops('x\ny\n', 'x\ny\n')).toEqual([' x', ' y'])
    expect(ops('a\nb\nc\nd\n', 'a\nc\nb\nd\n')).toHaveLength(5)
  })

  test('due modifiche lontane in un file lungo, senza toccare il resto', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `riga ${i}`)
    const after = [...lines]
    after[5] = 'cinque'
    after.splice(2990, 1)
    const rows = diffLines(`${lines.join('\n')}\n`, `${after.join('\n')}\n`)
    expect(rows.filter(r => r.op === '+').map(r => r.text)).toEqual(['cinque'])
    expect(rows.filter(r => r.op === '-').map(r => r.text)).toEqual(['riga 5', 'riga 2990'])
    expect(rows).toHaveLength(3001)
  })

  test('oltre il limite la parte cambiata è tutta tolta e poi tutta aggiunta', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n')
    const rows = diffLines(before, after)
    expect(rows).toHaveLength(6000)
    expect(rows[2999]?.op).toBe('-')
    expect(rows[3000]?.op).toBe('+')
  })
})

describe('hunkOf', () => {
  test('una finestra di righe come blocco di diff con i numeri giusti', () => {
    const rows = diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(hunkOf(rows, 0, 5)).toBe('@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d')
    expect(hunkOf(rows, 2, 4)).toBe('@@ -3,1 +2,2 @@\n+B\n c')
    expect(hunkOf(rows, 4, 9)).toBe('@@ -3,0 +4,1 @@\n+d')
    expect(hunkOf(rows, 9, 12)).toBe('')
  })

  test('lo slider toglie le prime colonne di ogni riga, non i numeri', () => {
    const rows = diffLines('abcdef\n', 'abcdef\nxyz\n')
    expect(hunkOf(rows, 0, 2, 4)).toBe('@@ -1,1 +1,2 @@\n ef\n+')
  })

  test('niente caratteri di controllo, i tab diventano spazi', () => {
    const rows = diffLines('', 'x\r\n\tdentro\x1b[0m\n')
    expect(hunkOf(rows, 0, 2)).toBe('@@ -0,0 +1,2 @@\n+x\n+    dentro\ufffd[0m')
    expect(hunkOf(diffLines('', 'ab\tc\n'), 0, 1)).toBe('@@ -0,0 +1,1 @@\n+ab  c')
  })
})
