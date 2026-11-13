// La sezione SYNTH: il testo di VOX ridotto a poche righe telegrafiche.
// `write` la scrive (poi `↻` la riscrive), `▶` la legge ad alta voce. Sotto il
// titolo i comandi, fermi mentre le righe scorrono: `◂ ▸` cambiano il numero
// di righe, fast | deep scelgono chi scrive (Haiku, o un fork della sessione),
// `prompt` apre il prompt e i suoi parametri, `edit` modifica la sintesi.
import { host } from './host'
import type { Line } from './ui'
import { outputOf, vox } from './vox'
import type { VoxActions } from './vox'
import { cleanForSpeech, countWords, listenTime } from './vox-text'
import { VOX_RED, chip, flowLines, playTool, rewriteParts, textLines, writing } from './view-vox'
import type { HeaderTool, Seg } from './view-vox'

export const SYNTH_COLOR = '#fb923c'

let pinned = 0
export const synthPinned = (): number => pinned

/** Il testo accanto al titolo: quante righe, chi le ha scritte e in quanto, quanto dura l'ascolto. */
export function synthInfo(): Seg[] {
  if (vox.busy === 'sintesi') return [{ text: 'writing…', color: SYNTH_COLOR }]
  const out = outputOf('sintesi')
  if (!out) return [{ text: vox.text.trim() === '' ? 'no text in VOX' : 'not written', dim: true }]
  const n = out.text.split('\n').filter(l => l.trim() !== '').length
  const words = countWords(cleanForSpeech(out.text))
  return [{ text: `${n} line${n === 1 ? '' : 's'} · ${out.deep ? 'session fork' : host.fast} ${(out.ms / 1000).toFixed(1)}s · ${listenTime(words, vox.speed)}`, dim: true }]
}

/** I comandi accanto al titolo. */
export function synthTools(a: VoxActions): HeaderTool[] {
  return [{ key: 'synth-write', label: outputOf('sintesi') ? '↻' : 'write', active: vox.busy === 'sintesi', press: a.write }, playTool('synth', a)]
}

export function synthLines(width: number, a: VoxActions): Line[] {
  const out = outputOf('sintesi')
  const bar = flowLines('synth:bar', width, [
    ...rewriteParts('sintesi', SYNTH_COLOR, a),
    ...(out && out.text.trim() !== '' ? [chip('synth-edit', 'edit', false, SYNTH_COLOR, () => a.editText('sintesi'))] : []),
  ])
  pinned = bar.length
  const lines: Line[] = [...bar]
  if (vox.error.synth) lines.push(...textLines('synth:error', vox.error.synth, width, { color: VOX_RED }))
  if (out) return [...lines, ...textLines('synth:text', out.text, width)]
  const hint =
    vox.busy === 'sintesi'
      ? writing('sintesi')
      : vox.text.trim() === ''
        ? 'Nothing to summarise yet: VOX has no text.'
        : 'write reduces the text in VOX to a few terse lines.'
  return [...lines, ...textLines('synth:hint', hint, width, { dim: true })]
}
