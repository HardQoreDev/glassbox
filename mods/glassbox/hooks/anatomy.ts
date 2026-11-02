// L'anatomia di una richiesta: i messaggi che ha portato, blocco per blocco,
// divisi per quello che sono (risposte degli strumenti, chiamate, testo del
// modello, ragionamento, prompt, reminder), ognuno con il suo peso, la sua età
// in richieste e, per le risposte degli strumenti, la chiamata che le ha
// chieste. Da qui la tendina stats sa cosa riempie il contesto, cosa pesa di
// più, cosa c'è due volte e cosa è lì da tanto.
import type { ApiBlock, ApiMessage } from './context'

export type Kind = 'results' | 'calls' | 'replies' | 'thinking' | 'prompts' | 'reminders'

export type Item = {
  kind: Kind
  /** Quello che il blocco è, in poche parole: `Read register.tsx`, `reply`. */
  label: string
  /** Lo strumento, per le chiamate e le loro risposte. */
  tool?: string
  chars: number
  /** Dove sta nella richiesta: il messaggio e il blocco. */
  message: number
  block: number
  /** Quante risposte del modello sono venute dopo: 0 per l'input nuovo. */
  age: number
  /** Per le risposte: lo strumento, i suoi argomenti e il testo, uguali se il risultato è lo stesso. */
  same?: string
  isError?: boolean
}

export type Anatomy = { items: Item[]; chars: number }

// Un'immagine costa al più circa questi token; contata come caratteri.
const IMAGE_CHARS = 1_600 * 4
const ARG_W = 40

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const json = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p
const short = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > ARG_W ? `${one.slice(0, ARG_W - 1)}…` : one
}

/** Lo strumento e l'argomento che dice su cosa ha lavorato: `Read register.tsx`, `Bash npm test`. */
export function callLabel(name: string, input: unknown): string {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const path = str(i.file_path) || str(i.notebook_path)
  let arg = ''
  if (path) arg = base(path)
  else if (name === 'Bash') arg = str(i.command)
  else if (name === 'Grep' || name === 'Glob') arg = str(i.pattern)
  else if (name === 'WebFetch') arg = str(i.url).replace(/^https?:\/\//, '')
  else if (name === 'WebSearch') arg = str(i.query)
  else if (name === 'Agent' || name === 'Task') arg = str(i.description) || str(i.subagent_type)
  else if (name === 'Skill') arg = str(i.skill)
  else arg = Object.values(i).find((v): v is string => typeof v === 'string') ?? ''
  const tool = name.startsWith('mcp__') ? name.split('__').slice(1).join(' ') : name
  return arg ? `${tool} ${short(arg)}` : tool
}

// Un riassunto del testo, abbastanza per riconoscerlo e per confrontarlo.
const hash = (s: string): string => {
  let x = 0x811c9dc5
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193)
  return `${s.length}:${(x >>> 0).toString(36)}`
}

// Il testo di un risultato e quanto pesa, le immagini a peso fisso.
function resultBody(b: ApiBlock): { text: string; chars: number } {
  if (typeof b.content === 'string') return { text: b.content, chars: b.content.length }
  if (!Array.isArray(b.content)) return { text: '', chars: 0 }
  let text = ''
  let chars = 0
  for (const c of b.content as ApiBlock[]) {
    if (c.type === 'text') {
      text += str(c.text)
      chars += str(c.text).length
    } else if (c.type === 'image') chars += IMAGE_CHARS
    else {
      const j = json(c)
      text += j
      chars += j.length
    }
  }
  return { text, chars }
}

const isReminder = (t: string) => /^\s*<system-reminder>/.test(t)
const gist = (t: string) => short(t.replace(/<[^>]+>/g, ' '))

// I messaggi di una richiesta non cambiano: l'anatomia si fa una volta sola.
const memo = new WeakMap<readonly ApiMessage[], Anatomy>()

/** I blocchi dei messaggi di una richiesta, con il loro peso e la loro età. */
export function anatomyOf(messages: readonly ApiMessage[]): Anatomy {
  const known = memo.get(messages)
  if (known) return known
  const calls = new Map<string, { name: string; input: unknown }>()
  for (const m of messages) for (const b of m.content) if (b.type === 'tool_use') calls.set(str(b.id), { name: str(b.name), input: b.input })
  // L'età di ogni messaggio: le risposte del modello venute dopo.
  const ages: number[] = []
  let after = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    ages[i] = after
    if (messages[i]?.role === 'assistant') after += 1
  }
  const items: Item[] = []
  messages.forEach((m, mi) => {
    m.content.forEach((b, bi) => {
      const at = { message: mi, block: bi, age: ages[mi] ?? 0 }
      switch (b.type) {
        case 'tool_result': {
          const call = calls.get(str(b.tool_use_id))
          const body = resultBody(b)
          const name = call?.name ?? 'tool'
          items.push({
            kind: 'results',
            label: call ? callLabel(call.name, call.input) : 'tool result',
            tool: name,
            chars: body.chars,
            ...at,
            ...(call ? { same: `${name}\u0000${json(call.input)}\u0000${hash(body.text)}` } : {}),
            ...(b.is_error === true ? { isError: true } : {}),
          })
          return
        }
        case 'tool_use': {
          const name = str(b.name)
          items.push({ kind: 'calls', label: callLabel(name, b.input), tool: name, chars: name.length + json(b.input).length, ...at })
          return
        }
        case 'thinking':
          items.push({ kind: 'thinking', label: 'thinking', chars: str(b.thinking).length, ...at })
          return
        case 'redacted_thinking':
          items.push({ kind: 'thinking', label: 'thinking (redacted)', chars: str(b.data).length, ...at })
          return
        case 'text': {
          const t = str(b.text)
          if (m.role === 'assistant') items.push({ kind: 'replies', label: `reply “${gist(t)}”`, chars: t.length, ...at })
          else if (isReminder(t)) items.push({ kind: 'reminders', label: `reminder “${gist(t)}”`, chars: t.length, ...at })
          else items.push({ kind: 'prompts', label: `prompt “${gist(t)}”`, chars: t.length, ...at })
          return
        }
        case 'image':
          items.push({ kind: m.role === 'assistant' ? 'replies' : 'prompts', label: 'image', chars: IMAGE_CHARS, ...at })
          return
        default: {
          const j = json(b)
          items.push({ kind: m.role === 'assistant' ? 'replies' : 'prompts', label: b.type, chars: j.length, ...at })
        }
      }
    })
  })
  const anatomy = { items, chars: items.reduce((s, x) => s + x.chars, 0) }
  memo.set(messages, anatomy)
  return anatomy
}

/** Le risposte uguali a una venuta dopo (stesso strumento, stessi argomenti, stesso testo): le copie in più. */
export function repeats(items: readonly Item[]): Item[] {
  const latest = new Map<string, Item>()
  for (const x of items) if (x.same) latest.set(x.same, x)
  return items.filter(x => x.same && latest.get(x.same) !== x)
}
