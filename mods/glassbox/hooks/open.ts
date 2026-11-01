// Apre un file fuori dalla barra: in VS Code quando c'è il suo comando `code`
// (in WSL apre la finestra collegata a WSL), se no con l'applicazione che il
// sistema ha scelto per il suo tipo: in WSL quella di Windows, passando da
// explorer.exe; su macOS `open`, su Linux `xdg-open`, su Windows `start`.
import type { EngineInterface } from 'claude-code'

const WAIT_MS = 10_000

export async function openFile($: EngineInterface, path: string): Promise<void> {
  const code = await $.process.run(['code', path], { timeoutMs: WAIT_MS }).catch(() => undefined)
  if (code?.exitCode === 0) return
  await openWithSystem($, path)
}

export async function openWithSystem($: EngineInterface, path: string): Promise<void> {
  if (await $.env.get('WSL_DISTRO_NAME')) {
    const win = await $.process.run(['wslpath', '-w', path], { timeoutMs: WAIT_MS })
    if (win.exitCode !== 0) throw new Error(win.stderr.trim() || `wslpath exited with ${win.exitCode}`)
    // explorer.exe esce con 1 anche quando il file si apre: il codice non dice niente.
    await $.process.run(['explorer.exe', win.stdout.trim()], { timeoutMs: WAIT_MS })
    return
  }
  // Senza uname è Windows.
  const os = await $.process.run(['uname', '-s'], { timeoutMs: WAIT_MS }).catch(() => undefined)
  const argv = os === undefined ? ['cmd', '/c', 'start', '', path] : os.stdout.trim() === 'Darwin' ? ['open', path] : ['xdg-open', path]
  const done = await $.process.run(argv, { timeoutMs: WAIT_MS })
  if (done.exitCode !== 0) throw new Error(done.stderr.trim().split('\n')[0] || `${argv[0]} exited with ${done.exitCode}`)
}
