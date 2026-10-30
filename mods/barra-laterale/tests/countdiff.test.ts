import { describe, expect, test } from 'claude-code/testing'

import { countDiff, record, touched, touchedList } from '../hooks/touched'

describe('countDiff', () => {
  test('righe cambiate, aggiunte, tolte, come le conta git', () => {
    expect(countDiff('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([2, 1])
    expect(countDiff('', 'uno\ndue\n')).toEqual([2, 0])
    expect(countDiff('uno\ndue\n', '')).toEqual([0, 2])
    expect(countDiff('x\ny\n', 'x\ny\n')).toEqual([0, 0])
    expect(countDiff('a\nb\nc\nd\n', 'a\nc\nb\nd\n')).toEqual([1, 1])
  })
})

describe('record', () => {
  test('somma le scritture della sessione e mette in cima la più recente', () => {
    touched.clear()
    record('/r/a.ts', 'x\n', 'x\ny\n', 1)
    record('/r/b.ts', null, 'nuovo\n', 2)
    record('/r/a.ts', 'x\ny\n', 'X\ny\n', 3)
    expect(touchedList().map(t => [t.path, t.added, t.removed, t.isNew])).toEqual([
      ['/r/a.ts', 2, 1, false],
      ['/r/b.ts', 1, 0, true],
    ])
  })
})
