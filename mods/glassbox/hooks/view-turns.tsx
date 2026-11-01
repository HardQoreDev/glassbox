// La sezione in basso: il disegno di turn-inspector (claude-code-templates,
// hooks/turn-inspector.tsx) spezzato in righe, perché la sezione ne mostra
// solo quante ne stanno. Input in viola, output in grigio. Le voci della
// legenda e i blocchi di un turno aperto aprono quello che entra nel
// contesto; la tendina `stats` mostra in cima i numeri e i consigli.
import { partOf } from './context'
import type { Part } from './context'
import { statsOf } from './stats'
import type { Level, Share } from './stats'
import { turns } from './turns-state'
import { cell, fit, len, wrapText } from './ui'
import type { Line } from './ui'
import { barCells, contextAfter, fmtTokens, gist, inputStack } from './vendor/turns'
import type { Block, BlockKind, Turn } from './vendor/turns'

const INK = '#f3eeff'
const STYLE: Record<BlockKind, { icon: string; bg: string; fg: string }> = {
  system: { icon: '⚙', bg: '#2e1f4d', fg: '#d8c8f0' },
  history: { icon: '↺', bg: '#4c3480', fg: INK },
  user: { icon: '❯', bg: '#6d4fc2', fg: INK },
  tool_result: { icon: '⇠', bg: '#6d4fc2', fg: INK },
  thinking: { icon: '✻', bg: '#151515', fg: '#d6d6d6' },
  text: { icon: '¶', bg: '#5e5e5e', fg: INK },
  tool_use: { icon: '⚒', bg: '#5e5e5e', fg: INK },
  truncated: { icon: '✂', bg: '#2b2b2b', fg: '#9a9a9a' },
}
export const INPUT_RAIL = '#a78bfa'
const OUTPUT_RAIL = '#8c8c8c'
const BAR = { system: '#2e1f4d', history: '#5b3fa0', added: '#a78bfa', output: '#9a9a9a', free: '#3a3a3a' }
// Le voci della legenda: il pezzo del contesto che aprono e il loro colore.
const LEGEND: [Part, string][] = [
  ['system', BAR.system],
  ['earlier', BAR.history],
  ['new', BAR.added],
  ['output', BAR.output],
]
const LEVEL = { warn: { mark: '! ', color: '#ffb000' }, info: { mark: '· ', color: '#59a4f9' }, good: { mark: '✓ ', color: '#4ade80' } } satisfies Record<Level, unknown>
// La colonna dei nomi nella tendina.
const LABEL_W = 12

/** Il testo accanto al titolo: quanto contesto è in uso, e la percentuale. */
export const turnsInfo = (): { text: string; color?: string; dim?: boolean }[] => {
  const window = turns.ledger.window
  const lastDone = [...turns.ledger.turns].reverse().find(t => t.input !== undefined)
  const used = lastDone ? contextAfter(lastDone) : undefined
  const pct = used !== undefined && window ? Math.round((used / window) * 100) : undefined
  return [
    { text: `${fmtTokens(used)} / ${fmtTokens(window)}`, dim: true },
    ...(pct !== undefined ? [{ text: ` ${pct}%`, color: pct > 80 ? 'red' : pct > 60 ? 'yellow' : 'green' }] : []),
  ]
}

/** La tendina: i numeri della sessione, il contesto per categoria, gli strumenti, i consigli. */
export function statsLines(width: number): Line[] {
  const s = statsOf(turns.ledger, turns.calls, turns.breakdown)
  const lines: Line[] = []
  const title = (text: string): Line => el => (
    <el.Text color={INPUT_RAIL} bold>
      {fit(text, width)}
    </el.Text>
  )
  for (const r of s.rows) {
    const value = fit(r.value, Math.max(4, width - LABEL_W))
    lines.push(el => (
      <el.Box key={`s:${r.label}`} flexDirection="row" height={1} overflow="hidden">
        <el.Text dimColor>{cell(r.label, LABEL_W)}</el.Text>
        <el.Text color={r.level && r.level !== 'good' ? LEVEL[r.level].color : undefined}>{value}</el.Text>
      </el.Box>
    ))
  }
  // Una riga per voce: il nome, una barra lunga quanto pesa, il valore.
  const shares = (list: readonly Share[], of: number, value: (x: Share) => string, size: (x: Share) => number, color: string) => {
    const barW = Math.max(4, Math.min(16, width - LABEL_W - 14))
    for (const x of list) {
      const filled = of > 0 ? Math.max(1, Math.round((size(x) / of) * barW)) : 0
      const text = fit(` ${value(x)}`, Math.max(4, width - LABEL_W - barW))
      lines.push(el => (
        <el.Box key={`s:${x.name}`} flexDirection="row" height={1} overflow="hidden">
          <el.Text>{`${cell(x.name, LABEL_W - 1)} `}</el.Text>
          <el.Text color={color}>{'█'.repeat(Math.min(barW, filled))}</el.Text>
          <el.Text color={BAR.free}>{'░'.repeat(Math.max(0, barW - filled))}</el.Text>
          <el.Text dimColor>{text}</el.Text>
        </el.Box>
      ))
    }
  }
  const window = turns.breakdown?.rawMaxTokens ?? turns.ledger.window ?? 0
  if (s.categories.length > 0) {
    lines.push(title('by category'))
    shares(s.categories, window, x => fmtTokens(x.tokens), x => x.tokens, BAR.history)
  }
  if (s.tools.length > 0) {
    lines.push(title('most used tools · calls · tokens in context'))
    const most = Math.max(...s.tools.map(x => x.count ?? 0))
    shares(s.tools, most, x => `${x.count}${x.failed ? ` (${x.failed}✗)` : ''}${x.tokens > 0 ? ` · ${fmtTokens(x.tokens)}` : ''}`, x => x.count ?? 0, BAR.added)
  }
  lines.push(title('tips'))
  for (const tip of s.tips) {
    const { mark, color } = LEVEL[tip.level]
    wrapText(tip.text, Math.max(8, width - 2)).forEach((text, i) => {
      lines.push(el => (
        <el.Box flexDirection="row" height={1} overflow="hidden">
          <el.Text color={color}>{i === 0 ? mark : '  '}</el.Text>
          <el.Text>{text}</el.Text>
        </el.Box>
      ))
    })
  }
  lines.push(el => <el.Text color={INPUT_RAIL} dimColor>{'─'.repeat(width)}</el.Text>)
  return lines
}

export function turnLines(width: number, toggle: (n: number) => void, show: (t: Turn, part: Part) => void): Line[] {
  const l = turns.ledger
  const window = l.window

  /** Le celle di una barra: system, turni prima, input nuovo, output, poi libero. */
  const bar = (t: Turn | undefined, w: number): { text: string; color: string }[] => {
    if (!t || !window || t.input === undefined) return [{ text: '░'.repeat(w), color: BAR.free }]
    const stack = inputStack(l, t)
    const sum = (kinds: BlockKind[]) => stack.filter(b => kinds.includes(b.kind)).reduce((s, b) => s + b.tokens, 0)
    const cells = barCells([sum(['system']), sum(['history']), sum(['user', 'tool_result']), t.output ?? 0], window, w)
    const free = Math.max(0, w - cells.reduce((s, c) => s + c, 0))
    const colors = [BAR.system, BAR.history, BAR.added, BAR.output]
    return [...cells.map((c, i) => ({ text: '█'.repeat(c), color: colors[i] ?? BAR.free })), { text: '░'.repeat(free), color: BAR.free }]
  }

  const lastDone = [...l.turns].reverse().find(t => t.input !== undefined)
  const legendW = LEGEND.reduce((w, [part], i) => w + (i ? 2 : 0) + 2 + len(part), 0)
  const which = lastDone ? `#${lastDone.n}` : ''
  const lines: Line[] = [
    ...(turns.showStats ? statsLines(width) : []),
    el => (
      <el.Text>
        {bar(lastDone, width).map(s => (
          <el.Text color={s.color}>{s.text}</el.Text>
        ))}
      </el.Text>
    ),
    // Le voci aprono quello che entra nel contesto della richiesta della barra.
    el => (
      <el.Box key="legend" flexDirection="row" height={1} overflow="hidden">
        {LEGEND.flatMap(([part, color], i) => [
          <el.Text color={color}>{`${i ? '  ' : ''}■ `}</el.Text>,
          lastDone ? (
            <el.Button key={`context:${part}`} plain label={`${part} of #${lastDone.n}`} onPress={() => show(lastDone, part)}>
              <el.Text dimColor>{part}</el.Text>
            </el.Button>
          ) : (
            <el.Text dimColor>{part}</el.Text>
          ),
        ])}
        <el.Text dimColor>{`${' '.repeat(Math.max(1, width - legendW - len(which)))}${which}`}</el.Text>
      </el.Box>
    ),
  ]

  if (l.turns.length === 0) {
    lines.push(el => <el.Text dimColor>{fit('No turns yet: send a prompt.', width)}</el.Text>)
    return lines
  }

  // Un blocco del turno: un clic apre il suo pezzo del contesto.
  const chip = (t: Turn, b: Block, key: string, w: number, rail: string): Line => {
    const s = STYLE[b.kind]
    const tok = b.kind === 'truncated' ? '' : `${b.isEstimate ? '~' : ''}${fmtTokens(b.tokens)}`
    const labelW = Math.max(4, w - tok.length - 5)
    const text = cell(` ${s.icon} ${cell(b.label, labelW)} ${tok} `, w)
    return el => (
      <el.Box key={`${key}:row`} flexDirection="row" height={1} overflow="hidden">
        <el.Text color={rail}>{'  ┃ '}</el.Text>
        <el.Button key={key} plain label={`${b.label} of #${t.n}`} onPress={() => show(t, partOf(b.kind))}>
          <el.Text backgroundColor={s.bg} color={b.isError ? '#ff8f80' : s.fg} italic={b.kind === 'truncated'}>
            {text}
          </el.Text>
        </el.Button>
      </el.Box>
    )
  }

  const title = (text: string, rail: string): Line => el => (
    <el.Text>
      <el.Text color={rail}>{'  ┃ '}</el.Text>
      <el.Text color={rail} bold>
        {fit(text, width - 4)}
      </el.Text>
    </el.Text>
  )

  let prompt: string | undefined
  for (const t of l.turns) {
    if (t.step === 0 || t.prompt !== prompt) {
      prompt = t.prompt
      const text = fit(`❯ ${t.prompt ? t.prompt.replace(/\s+/g, ' ') : '(continuation)'}`, width)
      lines.push(el => (
        <el.Text color={INPUT_RAIL} bold>
          {text}
        </el.Text>
      ))
    }

    const isOpen = turns.expanded.has(t.n)
    const after = contextAfter(t)
    const right = (after !== undefined ? fmtTokens(after) : '…').padStart(6)
    const barW = Math.max(6, Math.min(16, Math.floor(width / 4)))
    const labelW = Math.max(6, width - barW - 10)
    // Il riempimento sta fuori dal pulsante, che il motore inverte per intero.
    const label = fit(`#${t.n} ${gist(t)}`, labelW)
    const fill = cell('', labelW - len(label))
    const mark = t.status === 'failed' ? '✗' : isOpen ? '▾' : '▸'
    const markColor = t.status === 'failed' ? 'red' : t === turns.live ? 'yellow' : INPUT_RAIL
    lines.push(el => (
      <el.Box key={`t:${t.n}`} flexDirection="row" height={1} overflow="hidden">
        <el.Text color={markColor}>{`${mark} `}</el.Text>
        <el.Button key={`turn:${t.n}`} plain dimColor={!isOpen && t !== turns.live} label={label} onPress={() => toggle(t.n)} />
        <el.Text>{`${fill} `}</el.Text>
        <el.Text>
          {bar(t, barW).map(s => (
            <el.Text color={s.color}>{s.text}</el.Text>
          ))}
        </el.Text>
        <el.Text color="#c9c9c9">{` ${right}`}</el.Text>
      </el.Box>
    ))

    if (!isOpen) continue
    const w = width - 4
    const cached = t.cacheRead ? ` · ${fmtTokens(t.cacheRead)} cached` : ''
    lines.push(title(t.input !== undefined ? `INPUT  ${fmtTokens(t.input)}${cached}` : 'INPUT  sending…', INPUT_RAIL))
    inputStack(l, t).forEach((b, i) => lines.push(chip(t, b, `chip:${t.n}:in:${i}`, w, INPUT_RAIL)))
    lines.push(
      title(
        t.status === 'streaming' ? 'OUTPUT  streaming…' : t.output !== undefined ? `OUTPUT  +${fmtTokens(t.output)}` : 'OUTPUT  none',
        OUTPUT_RAIL,
      ),
    )
    t.answer.forEach((b, i) => lines.push(chip(t, b, `chip:${t.n}:out:${i}`, w, OUTPUT_RAIL)))
    const meta = [t.model, t.stopReason ?? '', t.isCompacted ? 'compacted before this turn' : ''].filter(Boolean).join(' · ')
    if (meta) lines.push(el => <el.Text dimColor>{fit(`    ${meta}`, width)}</el.Text>)
  }
  return lines
}
