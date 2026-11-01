// La sezione in basso: il disegno di turn-inspector (claude-code-templates,
// hooks/turn-inspector.tsx) spezzato in righe, perché la sezione ne mostra
// solo quante ne stanno. Input in viola, output in grigio.
import { turns } from './turns-state'
import { cell, fit, len } from './ui'
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

export function turnLines(width: number, toggle: (n: number) => void): Line[] {
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
  const lines: Line[] = [
    el => (
      <el.Text>
        {bar(lastDone, width).map(s => (
          <el.Text color={s.color}>{s.text}</el.Text>
        ))}
      </el.Text>
    ),
    el => (
      <el.Text>
        <el.Text color={BAR.system}>■</el.Text>
        <el.Text dimColor> system  </el.Text>
        <el.Text color={BAR.history}>■</el.Text>
        <el.Text dimColor> earlier  </el.Text>
        <el.Text color={BAR.added}>■</el.Text>
        <el.Text dimColor> new  </el.Text>
        <el.Text color={BAR.output}>■</el.Text>
        <el.Text dimColor> output</el.Text>
      </el.Text>
    ),
  ]

  if (l.turns.length === 0) {
    lines.push(el => <el.Text dimColor>{fit('No turns yet: send a prompt.', width)}</el.Text>)
    return lines
  }

  const chip = (b: Block, w: number, rail: string): Line => {
    const s = STYLE[b.kind]
    const tok = b.kind === 'truncated' ? '' : `${b.isEstimate ? '~' : ''}${fmtTokens(b.tokens)}`
    const labelW = Math.max(4, w - tok.length - 5)
    const text = cell(` ${s.icon} ${cell(b.label, labelW)} ${tok} `, w)
    return el => (
      <el.Text>
        <el.Text color={rail}>{'  ┃ '}</el.Text>
        <el.Text backgroundColor={s.bg} color={b.isError ? '#ff8f80' : s.fg} italic={b.kind === 'truncated'}>
          {text}
        </el.Text>
      </el.Text>
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
    for (const b of inputStack(l, t)) lines.push(chip(b, w, INPUT_RAIL))
    lines.push(
      title(
        t.status === 'streaming' ? 'OUTPUT  streaming…' : t.output !== undefined ? `OUTPUT  +${fmtTokens(t.output)}` : 'OUTPUT  none',
        OUTPUT_RAIL,
      ),
    )
    for (const b of t.answer) lines.push(chip(b, w, OUTPUT_RAIL))
    const meta = [t.model, t.stopReason ?? '', t.isCompacted ? 'compacted before this turn' : ''].filter(Boolean).join(' · ')
    if (meta) lines.push(el => <el.Text dimColor>{fit(`    ${meta}`, width)}</el.Text>)
  }
  return lines
}
