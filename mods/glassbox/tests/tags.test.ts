import { describe, expect, test } from 'claude-code/testing'

import { readCounts } from '../hooks/branches'
import { readRemoteTags, readTags, tagRemote } from '../hooks/tags'

import { COUNTS, TAGS } from './engine'

describe('i tag', () => {
  test('annotati e leggeri, con il commit, chi e il confronto con il principale', () => {
    const tags = readTags(TAGS, readCounts(COUNTS))
    expect(tags.map(t => t.name)).toEqual(['v1.1', 'exp', 'v1.0'])
    expect(tags[0]).toEqual({
      ref: 'refs/tags/v1.1',
      name: 'v1.1',
      isAnnotated: true,
      object: 'tag11',
      commit: 'c3',
      short: 'c3',
      time: 1761800000,
      who: 'Giulio',
      subject: 'Release 1.1',
      commitSubject: 'Merge feature',
      ahead: 0,
      behind: 0,
    })
    // Un tag leggero è il commit: il suo autore, il suo soggetto.
    expect(tags[2]).toMatchObject({ isAnnotated: false, object: 'c1', commit: 'c1', who: 'Giulio', subject: 'Primo commit', commitSubject: 'Primo commit', ahead: 0, behind: 3 })
    // Senza i conti di git, niente confronto.
    expect(readTags(TAGS)[0]?.ahead).toBeUndefined()
  })

  test('sul remoto: c’è, manca, o punta altrove', () => {
    const remote = readRemoteTags('tag11\trefs/tags/v1.1\nx^\trefs/tags/v1.1^{}\nh\trefs/heads/main\nother\trefs/tags/exp\n')
    expect([...remote]).toEqual([
      ['v1.1', 'tag11'],
      ['exp', 'other'],
    ])
    const tags = readTags(TAGS)
    expect(tags.map(t => tagRemote(t, remote))).toEqual(['pushed', 'moved', 'local'])
    expect(tagRemote(tags[0]!, undefined)).toBeUndefined()
  })
})
