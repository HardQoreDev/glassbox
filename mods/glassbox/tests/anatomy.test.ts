import { describe, expect, test } from 'claude-code/testing'

import { anatomyOf, callLabel, repeats } from '../hooks/anatomy'

describe('l’anatomia di una richiesta', () => {
  test('ogni chiamata col suo argomento più parlante', () => {
    expect(callLabel('Read', { file_path: '/r/src/login.ts', offset: 10 })).toBe('Read login.ts')
    expect(callLabel('Bash', { command: 'npm   test\n --watch' })).toBe('Bash npm test --watch')
    expect(callLabel('Grep', { pattern: 'TODO', path: '/r' })).toBe('Grep TODO')
    expect(callLabel('WebFetch', { url: 'https://example.com/a', prompt: 'x' })).toBe('WebFetch example.com/a')
    expect(callLabel('Agent', { description: 'Find the auth code', prompt: '...' })).toBe('Agent Find the auth code')
    expect(callLabel('mcp__docs__search', { query: 'hooks' })).toBe('docs search hooks')
    expect(callLabel('TodoWrite', {})).toBe('TodoWrite')
    expect(callLabel('Bash', { command: 'x'.repeat(80) })).toBe(`Bash ${'x'.repeat(39)}…`)
  })

  test('i blocchi per tipo, con la loro età in risposte del modello', () => {
    const a = anatomyOf([
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>ctx</system-reminder>' }, { type: 'text', text: 'ciao' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'leggo' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/r/a.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'abc' }, { type: 'image', source: { type: 'base64', data: 'xx' } }] }] },
    ])
    expect(a.items.map(x => [x.kind, x.label, x.age])).toEqual([
      ['reminders', 'reminder “ctx”', 1],
      ['prompts', 'prompt “ciao”', 1],
      ['thinking', 'thinking', 0],
      ['replies', 'reply “leggo”', 0],
      ['calls', 'Read a.ts', 0],
      ['results', 'Read a.ts', 0],
    ])
    // Un'immagine pesa come 1600 token.
    expect(a.items.at(-1)?.chars).toBe(3 + 6_400)
    expect(a.items.at(-1)?.tool).toBe('Read')
  })

  test('una risposta uguale a una venuta dopo è una copia; con un testo diverso no', () => {
    const call = (id: string, file: string) => ({ role: 'assistant' as const, content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: file } }] })
    const result = (id: string, text: string) => ({ role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: id, content: text }] })
    const a = anatomyOf([call('1', '/a'), result('1', 'v1'), call('2', '/a'), result('2', 'v1'), call('3', '/a'), result('3', 'v2'), call('4', '/b'), result('4', 'v1')])
    expect(repeats(a.items).map(x => x.message)).toEqual([1])
  })
})
