// La sezione in cima: una riga per hook, con il pulsante ON / OFF a
// destra; il nome si illumina mentre l'hook gira e per due secondi dopo, del
// colore di come è andato.
import { hooks, sharesEvent } from './settings-hooks'
import type { Glow, SettingsHook } from './settings-hooks'
import { fit, len } from './ui'
import type { Line } from './ui'

const GLOW: Record<Glow, string> = { run: '#ffb000', ok: '#4ade80', block: '#f87171', skip: '#9a9a9a' }
const WORD: Record<Glow, string> = { run: ' running…', ok: ' ok', block: ' blocked', skip: ' skipped' }
const ON = { bg: '#2e7d32', fg: '#ffffff' }
// Spento è una protezione tolta: rosso scuro, non grigio.
const OFF = { bg: '#7f1d1d', fg: '#fecaca' }
const DARK = '#1e1e1e'

type Seg = { text: string; color?: string; dim?: boolean }

/** Il testo accanto al titolo: quanti hook ci sono, o quanti sono spenti. */
export const hooksInfo = (): Seg[] => {
  if (hooks.list.length === 0) return [{ text: 'none', dim: true }]
  const off = hooks.list.filter(h => hooks.off.has(h.id)).length
  if (off === 0) return [{ text: `${hooks.list.length} on`, dim: true }]
  return [{ text: `${off} off`, color: GLOW.block }]
}

export function hookLines(width: number, now: number, toggle: (h: SettingsHook) => void): Line[] {
  if (hooks.list.length === 0) return [el => <el.Text dimColor>{fit('No hooks in settings.', width)}</el.Text>]

  return hooks.list.map((hook, i) => {
    const isOff = hooks.off.has(hook.id)
    const isManaged = hook.source === 'policy'
    const g = hooks.glow.get(hook.id)
    const glow = g !== undefined && g.until > now ? g.kind : undefined
    // ON ha nel suo riquadro uno spazio per parte come OFF, così la parola sta
    // al centro; la colonna che manca va nel riempimento a sinistra.
    const sw = isManaged ? ' MANAGED ' : isOff ? ' OFF ' : ' ON '
    const swW = Math.max(len(sw), len(' OFF '))
    const status = glow ? WORD[glow] : isOff && sharesEvent(hook) ? ' ⚠ runs anyway' : ''
    const room = Math.max(4, width - 2 - swW - 1 - len(status))
    const name = fit(hook.label, room)
    const where = fit(` ${hook.matcher ? `${hook.event} · ${hook.matcher}` : hook.event}`, Math.max(0, room - len(name)))
    const pad = ' '.repeat(Math.max(0, width - 2 - len(name) - len(where) - len(status) - len(sw)))
    const dot = glow ? GLOW[glow] : isOff ? undefined : GLOW.ok

    return el => (
      <el.Box key={`k:${i}`} flexDirection="row" height={1} overflow="hidden">
        <el.Text color={dot} dimColor={dot === undefined}>
          {isOff ? '○ ' : '● '}
        </el.Text>
        <el.Text bold backgroundColor={glow ? GLOW[glow] : undefined} color={glow ? DARK : undefined} dimColor={isOff && !glow}>
          {name}
        </el.Text>
        <el.Text dimColor>{where}</el.Text>
        <el.Text color={glow ? GLOW[glow] : '#f0b429'}>{status}</el.Text>
        <el.Text>{pad}</el.Text>
        {isManaged ? (
          <el.Text dimColor>{sw}</el.Text>
        ) : (
          <el.Button key={`hook:${i}`} plain label={sw.trim()} onPress={() => toggle(hook)}>
            <el.Text bold backgroundColor={isOff ? OFF.bg : ON.bg} color={isOff ? OFF.fg : ON.fg}>
              {sw}
            </el.Text>
          </el.Button>
        )}
      </el.Box>
    )
  })
}
