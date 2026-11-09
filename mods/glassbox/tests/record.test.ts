import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { projectSlug, replay } from '../hooks/record'
import type { RequestRecord, SessionRecord } from '../hooks/record'

import { FILES, MESSAGES, fakeEngine, settle, start } from './engine'

const DIR = '/home/u/.claude/glassbox/sessions/-r/s1'
const read = <T>(path: string): T => JSON.parse(FILES[path] ?? 'null') as T
const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text', text }] })
const assistant = (text: string) => ({ role: 'assistant' as const, content: [{ type: 'text', text }] })

// Dimentica i registri dei test prima.
const clean = () => {
  for (const k of Object.keys(FILES)) if (k.includes('/glassbox/sessions/') || k.startsWith('/home/u/rec/')) delete FILES[k]
}

// Le scritture vanno in coda fuori dal giro: si aspetta che il file ci sia.
async function until(path: string, check: (text: string) => boolean = () => true) {
  for (let i = 0; i < 60; i++) {
    if (path in FILES && check(FILES[path] ?? '')) return
    await settle()
  }
  throw new Error(`${path} not written: ${Object.keys(FILES).filter(k => k.includes('glassbox')).join(', ')}`)
}

async function turn($: Engine, turnId: string, text: string, count: number) {
  await $.turn.start({ text, turnId })
  const s = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: count })
  for (;;) if ((await s.next()).done) break
  await $.turn.complete({ answer: 'Fatto.', durationMs: 900, isAborted: false, turnId, reason: 'answer' })
}

describe('il registro delle sessioni', () => {
  test('replay ricostruisce il contesto di ogni richiesta da keep e dai messaggi nuovi', () => {
    const [a, b, c, s, d] = [user('a'), assistant('b'), user('c'), user('riassunto'), assistant('d')]
    const out = replay([
      { keep: 0, messages: [a] },
      { keep: 1, messages: [b, c] },
      { keep: 0, messages: [s] },
      { keep: 1, messages: [d] },
      { keep: 0, messages: null },
    ])
    expect(out).toEqual([[a], [a, b, c], [s], [s, d], []])
    expect(projectSlug('/home/me/my_app.v2')).toBe('-home-me-my-app-v2')
  })

  test('ogni richiesta va su disco con i messaggi nuovi, il prompt di sistema una volta, il riassunto aggiornato', { timeoutMs: 20_000 }, async ($, on) => {
    clean()
    fakeEngine(on)
    await start($)

    MESSAGES.length = 0
    MESSAGES.push(user('sistema il login'))
    await turn($, 't1', 'sistema il login', 1)
    await until(`${DIR}/requests/0001.json`)
    const first = read<RequestRecord>(`${DIR}/requests/0001.json`)
    expect(first).toMatchObject({ format: 'glassbox-session/1', request: 1, n: 1, turnId: 't1', step: 0, model: 'claude-opus-5-5', keep: 0, system: 1, stopReason: 'end_turn' })
    expect(first.messages).toEqual([user('sistema il login')])
    expect(first.usage).toEqual({ input_tokens: 500, output_tokens: 40, cache_read_input_tokens: 14_000, cache_creation_input_tokens: 0 })
    expect(first.output).toEqual([{ index: 0, kind: 'text', text: 'Fatto.' }])
    const system = read<{ sections: { id: string }[]; tools: { name: string; mcp?: boolean }[] }>(`${DIR}/system/01.json`)
    expect(system.sections.map(s => s.id)).toEqual(['intro', 'memory'])
    expect(system.tools).toEqual([
      { name: 'Read', description: 'Reads a file.' },
      { name: 'mcp__docs__search', description: 'Searches the docs.', mcp: true },
    ])

    // La seconda richiesta porta i messaggi di prima: su disco solo i nuovi.
    MESSAGES.push(assistant('Fatto.'), user('ora i test'))
    await turn($, 't2', 'ora i test', 3)
    await until(`${DIR}/requests/0002.json`)
    const second = read<RequestRecord>(`${DIR}/requests/0002.json`)
    expect(second.keep).toBe(1)
    expect(second.messages).toEqual([assistant('Fatto.'), user('ora i test')])

    // Dopo una compattazione la lista ricomincia: tutta di nuovo.
    MESSAGES.length = 0
    MESSAGES.push(user('Riassunto: login sistemato, test da scrivere.'))
    await turn($, 't3', 'continua', 1)
    await until(`${DIR}/requests/0003.json`)
    const third = read<RequestRecord>(`${DIR}/requests/0003.json`)
    expect(third.keep).toBe(0)

    const contexts = replay([first, second, third])
    expect(contexts[1]).toEqual([user('sistema il login'), assistant('Fatto.'), user('ora i test')])
    expect(contexts[2]).toEqual([user('Riassunto: login sistemato, test da scrivere.')])

    // Il prompt di sistema non è cambiato: un file solo.
    expect(`${DIR}/system/02.json` in FILES).toBe(false)
    await until(`${DIR}/session.json`, t => (JSON.parse(t) as SessionRecord).requests === 3)
    const meta = read<SessionRecord>(`${DIR}/session.json`)
    expect(meta).toMatchObject({
      sessionId: 's1',
      project: '/r',
      resume: 'claude --resume s1',
      title: 'sistema il login',
      models: ['claude-opus-5-5'],
      requests: 3,
      systems: 1,
      tokens: { input: 1500, cacheRead: 42_000, cacheWrite: 0, output: 120 },
      context: { last: 14_540, peak: 14_540 },
    })
    expect(meta.bytes).toBeGreaterThan(0)

    // La fine della sessione si scrive nel riassunto.
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as never)
    await until(`${DIR}/session.json`, t => (JSON.parse(t) as SessionRecord).endReason === 'prompt_input_exit')
    expect(read<SessionRecord>(`${DIR}/session.json`).endedAt).toBeDefined()
  })

  test('una sessione ripresa continua la numerazione e riporta il contesto intero', { timeoutMs: 20_000 }, async ($, on) => {
    clean()
    FILES[`${DIR}/session.json`] = JSON.stringify({
      format: 'glassbox-session/1',
      sessionId: 's1',
      project: '/r',
      resume: 'claude --resume s1',
      glassbox: '0.13.0',
      startedAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T11:00:00.000Z',
      endedAt: '2026-11-01T11:00:00.000Z',
      endReason: 'prompt_input_exit',
      title: 'sistema il login',
      models: ['claude-opus-5-5'],
      requests: 5,
      systems: 1,
      bytes: 100,
      context: { last: 1000, peak: 2000 },
      tokens: { input: 10, cacheRead: 20, cacheWrite: 30, output: 40 },
      compactions: 0,
      analyses: [],
    } satisfies SessionRecord)
    fakeEngine(on)
    await start($)
    MESSAGES.length = 0
    MESSAGES.push(user('sistema il login'), assistant('Fatto.'), user('di nuovo'))
    await turn($, 't1', 'di nuovo', 3)
    await until(`${DIR}/requests/0006.json`)
    expect(read<RequestRecord>(`${DIR}/requests/0006.json`)).toMatchObject({ request: 6, keep: 0 })
    await until(`${DIR}/session.json`, t => (JSON.parse(t) as SessionRecord).requests === 6)
    const meta = read<SessionRecord>(`${DIR}/session.json`)
    expect(meta).toMatchObject({ startedAt: '2026-11-01T10:00:00.000Z', title: 'sistema il login', tokens: { input: 510, cacheRead: 14_020, cacheWrite: 30, output: 80 } })
    expect(meta.endedAt).toBeUndefined()
  })

  test('spento dalle opzioni non scrive niente', { options: { recordSessions: false }, timeoutMs: 20_000 }, async ($, on) => {
    clean()
    fakeEngine(on)
    await start($)
    MESSAGES.length = 0
    MESSAGES.push(user('sistema il login'))
    await turn($, 't1', 'sistema il login', 1)
    for (let i = 0; i < 10; i++) await settle()
    expect(Object.keys(FILES).filter(k => k.includes('/glassbox/sessions/'))).toEqual([])
  })

  test('sessionsDir sceglie la cartella, con ~ per la home', { options: { sessionsDir: '~/rec' }, timeoutMs: 20_000 }, async ($, on) => {
    clean()
    fakeEngine(on)
    await start($)
    MESSAGES.length = 0
    MESSAGES.push(user('sistema il login'))
    await turn($, 't1', 'sistema il login', 1)
    await until('/home/u/rec/-r/s1/requests/0001.json')
    expect(Object.keys(FILES).filter(k => k.includes('/glassbox/sessions/'))).toEqual([])
  })
})
