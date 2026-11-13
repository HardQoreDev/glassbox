// Il controllo di pi/test.sh, da dentro pi: l'impaginazione del pannello e,
// dopo un turno con uno strumento, quello che Glassbox ha messo su disco
// passando dall'adattatore (il registro della sessione e l'elenco di quelle aperte).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { visibleWidth } from '@earendil-works/pi-tui'

import { h } from '../src/jsx.ts'
import { layout } from '../src/layout.ts'

const failures: string[] = []
const check = (what: string, ok: boolean, got?: unknown) => {
  if (!ok) failures.push(got === undefined ? what : `${what}: ${JSON.stringify(got)}`)
}
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

function layoutChecks() {
  let pressed = 0
  const tree = h(
    'Box',
    { flexDirection: 'column' },
    h('Box', { flexDirection: 'row', height: 1, overflow: 'hidden' }, h('Text', { color: '#59a4f9' }, '▌ '), h('Button', { key: 'title', plain: true, onPress: () => pressed++ }, h('Text', { bold: true }, 'GIT')), h('Text', null, '  main')),
    h('Box', { flexDirection: 'row', height: 1 }, h('Button', { key: 'framed', onPress: () => undefined }, 'CP')),
    h('Box', { height: 1, overflow: 'hidden' }, h('Text', null, 'x'.repeat(100))),
    h('Box', { flexDirection: 'row', height: 3 }, h('Box', { width: 10, height: 3 }, h('Code', { source: '@@ a\n+uno\n-due', format: 'diff' })), h('Box', { flexDirection: 'column', width: 1, height: 3 }, h('Text', null, '│'), h('Text', null, '│'), h('Text', null, '│'))),
    h('Box', { flexDirection: 'row' }, h('Text', null, '  '), h('Input', { key: 'field', value: 'testo', rows: 2 })),
  )
  const lines = layout(tree, 40, 'truecolor')
  check('una riga per elemento, tre per il blocco', lines.length === 7, lines.length)
  check('il titolo', plain(lines[0]!.text) === '▌ GIT  main', plain(lines[0]!.text))
  check('il pulsante del titolo si clicca dove è scritto', lines[0]!.regions[0]?.x0 === 2 && lines[0]!.regions[0]?.x1 === 5, lines[0]!.regions)
  lines[0]!.regions[0]?.button.press()
  check('il clic arriva al pulsante', pressed === 1)
  check('un pulsante con la cornice', plain(lines[1]!.text) === '[ CP ]', plain(lines[1]!.text))
  check('una riga lunga è tagliata', visibleWidth(lines[2]!.text) === 40, visibleWidth(lines[2]!.text))
  check('codice e scorrimento fianco a fianco', plain(lines[4]!.text) === '+uno      │', plain(lines[4]!.text))
  check('il campo di testo', lines[6]!.field?.key === 'field' && lines[6]!.field.x === 2 && lines[6]!.field.width === 38, lines[6]!.field)
  check('il pulsante con il fuoco è invertito', layout(tree, 40, 'truecolor', 'title')[0]!.text.includes('\x1b[7m'))
}

export default function (pi: any) {
  const dir = process.env.GLASSBOX_DIR ?? ''
  pi.on('session_start', () => {
    try {
      layoutChecks()
    } catch (err) {
      failures.push(`layout: ${err}`)
    }
  })
  pi.on('agent_settled', async (_e: unknown, ctx: any) => {
    // Glassbox scrive il registro fuori dal giro degli eventi: gli si dà un momento.
    await new Promise(r => setTimeout(r, 1500))
    const id = ctx.sessionManager.getSessionId()
    const running = join(dir, 'running', `${process.pid}.json`)
    check('questa sessione è nel registro di quelle aperte', existsSync(running))
    if (existsSync(running)) {
      const r = JSON.parse(readFileSync(running, 'utf8'))
      check('con il suo id e il file che ha scritto', r.id === id && r.writes?.[0]?.[0]?.endsWith('/prova-glassbox.txt') && r.ctx > 0, r)
    }
    const sessions = join(dir, 'sessions')
    const project = existsSync(sessions) ? readdirSync(sessions)[0] : undefined
    const record = project ? join(sessions, project, id) : ''
    check('il registro della sessione esiste', record !== '' && existsSync(join(record, 'session.json')), record)
    if (record && existsSync(join(record, 'session.json'))) {
      const meta = JSON.parse(readFileSync(join(record, 'session.json'), 'utf8'))
      check('due richieste registrate', meta.requests === 2, meta.requests)
      check('riprende con pi', meta.resume === `pi --session ${id}`, meta.resume)
      check('la versione è quella del pacchetto pi', meta.glassbox === JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')).version, meta.glassbox)
      const second = JSON.parse(readFileSync(join(record, 'requests', '0002.json'), 'utf8'))
      const text = JSON.stringify(second)
      check('la seconda richiesta porta la chiamata e la risposta dello strumento', text.includes('tool_use') && text.includes('tool_result') && text.includes('"Write"'), Object.keys(second))
    }
    const debug = join(dir, 'debug.log')
    check('nessun errore nel log di Glassbox', !existsSync(debug), existsSync(debug) ? readFileSync(debug, 'utf8').slice(0, 600) : '')
    console.error(failures.length === 0 ? 'GLASSBOX-PI OK' : `GLASSBOX-PI FAILED\n- ${failures.join('\n- ')}`)
  })
}
