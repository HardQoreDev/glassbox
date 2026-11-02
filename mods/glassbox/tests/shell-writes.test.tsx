import { describe, expect, test } from 'claude-code/testing'

import { parseStatus } from '../hooks/shell-writes'
import { COMMITTED, FILES, GIT, PANE, SHELL, STATUS, fakeEngine, settle, start } from './engine'

describe('i file cambiati da un comando', () => {
  test('git status: un file per riga, la rinomina con il suo nome nuovo, niente ignorati né cartelle', () => {
    const out = ['## main', ' M a.ts', 'R  nuovo.ts', 'vecchio.ts', '?? dir/x.md', '?? vuota/', '!! node_modules/', 'D  tolto.ts', '?? tolto.ts', ''].join('\0')
    expect(parseStatus(out, '/r')).toEqual([
      { path: '/r/a.ts', rel: 'a.ts', isUntracked: false },
      { path: '/r/nuovo.ts', rel: 'nuovo.ts', isUntracked: false },
      { path: '/r/dir/x.md', rel: 'dir/x.md', isUntracked: true },
      // tolto dall'indice e rimasto sul disco: è ancora nel commit
      { path: '/r/tolto.ts', rel: 'tolto.ts', isUntracked: false },
    ])
  })

  test('un sed su un file pulito, uno su un file già modificato, un file nuovo: tutti in FILES', async ($, on) => {
    fakeEngine(on)
    const values = '/r/helm/values.yaml'
    FILES[values] = 'image:\n  tag: "v0.0.15-pre"\n'
    COMMITTED['c3:helm/values.yaml'] = FILES[values]
    FILES['/r/src/app.ts'] = 'uno\n'
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const row = async (path: string) => (await ui.find({ key: `t:${path}` }))?.text

    // Il tag cambiato come nella sessione: pulito prima, modificato dopo.
    SHELL.run = () => {
      FILES[values] = 'image:\n  tag: "v2.0.0-pre"\n'
      GIT.status = `${STATUS} M helm/values.yaml\0`
    }
    await $.tool.call({ tool: 'Bash', command: `sed -i 's/v0.0.15-pre/v2.0.0-pre/' helm/values.yaml` } as never)
    await settle()
    await ui.redraw()
    expect(await row(values)).toMatch(/values\.yaml +\+1 −1/)

    // Un file già modificato prima, e uno che non c'era.
    SHELL.run = () => {
      FILES['/r/src/app.ts'] = 'uno\ndue\n'
      FILES['/r/out.txt'] = 'a\nb\n'
      GIT.status = `${GIT.status}?? out.txt\0`
    }
    await $.tool.call({ tool: 'Bash', command: 'echo due >> src/app.ts && printf "a\\nb\\n" > out.txt' } as never)
    await settle()
    await ui.redraw()
    expect(await row('/r/src/app.ts')).toMatch(/app\.ts +\+1 −0/)
    expect(await row('/r/out.txt')).toMatch(/^\+ out\.txt +\+2 −0/)
    expect(await ui.find({ type: 'Text', text: /3 files/ })).toBeDefined()

    // Un commit: il repo torna pulito, ma i file sono come prima del comando.
    SHELL.run = () => {
      GIT.status = ''
    }
    await $.tool.call({ tool: 'Bash', command: 'git commit -qam "tag"' } as never)
    await settle()
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /3 files/ })).toBeDefined()
    expect(await row(values)).toMatch(/\+1 −1/)

    await ui.unmount()
    GIT.status = STATUS
    for (const path of [values, '/r/src/app.ts', '/r/out.txt']) delete FILES[path]
    delete COMMITTED['c3:helm/values.yaml']
  })
})
