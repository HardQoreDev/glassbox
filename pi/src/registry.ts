// Le sessioni di pi aperte sulla macchina, per la sezione SESSIONS e per GUARD.
// Claude Code tiene un registro delle sue sessioni; pi no. Qui ogni sessione
// con Glassbox scrive un piccolo file con il suo stato, e lo toglie quando
// finisce: l'elenco è l'insieme di quei file i cui processi sono ancora vivi.
// La forma è quella che darebbe mods/glassbox/bin/sessions.py.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Running = {
  pid: number
  id: string
  name: string
  cwd: string
  status: 'idle' | 'busy'
  lastMs?: number
  ctx?: number
  compacted?: boolean
  // I file scritti con edit e write, con l'ora dell'ultima volta.
  writes: [string, number][]
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM'
  }
}

export function createRegistry(dir: string) {
  const own = join(dir, `${process.pid}.json`)
  return {
    /** Scrive lo stato di questa sessione. */
    write(state: Running): void {
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(own, JSON.stringify(state))
      } catch {
        // Senza registro la sezione mostra solo questa sessione.
      }
    },
    remove(): void {
      rmSync(own, { force: true })
    },
    /** L'elenco, in JSON; i file dei processi morti si tolgono. */
    read(): string {
      const sessions: Running[] = []
      let names: string[] = []
      try {
        names = readdirSync(dir).filter(n => n.endsWith('.json'))
      } catch {
        names = []
      }
      for (const name of names) {
        const path = join(dir, name)
        try {
          const s = JSON.parse(readFileSync(path, 'utf8')) as Running
          if (typeof s.pid === 'number' && isAlive(s.pid)) sessions.push(s)
          else rmSync(path, { force: true })
        } catch {
          rmSync(path, { force: true })
        }
      }
      return JSON.stringify({ at: Date.now(), herdr: '', sessions })
    },
  }
}
