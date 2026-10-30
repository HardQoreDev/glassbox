import { describe, expect, test } from 'claude-code/testing'

import { FILES, PANE, PENDING, fakeEngine, oneTurn, settle, start } from './engine'

describe('la barra', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`quattro sezioni: hook, grafo, file e turni (${surface})`, async ($, on) => {
      const opened: string[] = []
      fakeEngine(on, opened)
      await start($)
      expect(opened[0]).toBe('barra-laterale')
      await oneTurn($)

      const ui = await $.ui.mount({ ...PANE, surface })
      for (const key of ['section:hooks', 'section:graph', 'section:files', 'section:turns']) expect(await ui.find({ key })).toBeDefined()

      // il grafo: il merge in testa, il branch attuale avanti di uno
      expect(await ui.find({ key: 'commit:c3' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /↑1/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /◎ main ☁/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /☁ origin\/feature/ })).toBeDefined()

      // i file, nella vista ad albero: .git nascosto, src modificata con le sue righe
      await ui.press({ key: 'files-view-tree' })
      await ui.redraw()
      expect(await ui.find({ key: 'file:/r/src' })).toBeDefined()
      expect(await ui.find({ key: 'file:/r/.git' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: / M:1/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: / \+3/ })).toBeDefined()

      // i turni: il prompt e la sua richiesta
      expect(await ui.find({ type: 'Text', text: /sistema il login/ })).toBeDefined()
      expect(await ui.find({ key: 'turn:1' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('una cartella si apre al clic, una sezione si chiude dal titolo', async ($, on) => {
    fakeEngine(on, [])
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await ui.press({ key: 'files-view-tree' })
    await ui.redraw()
    expect(await ui.find({ key: 'file:/r/src/app.ts' })).toBeUndefined()
    await ui.press({ key: 'file:/r/src' })
    await ui.redraw()
    expect(await ui.find({ key: 'file:/r/src/app.ts' })).toBeDefined()

    await ui.press({ key: 'commit:c3' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /c3 · Giulio/ })).toBeDefined()

    await ui.press({ key: 'section:graph' })
    await ui.redraw()
    expect(await ui.find({ key: 'commit:c3' })).toBeUndefined()
    expect(await ui.find({ key: 'section:graph' })).toBeDefined()
    await ui.unmount()
  })

  test('un file letto da Claude apre le cartelle sopra di lui', async ($, on) => {
    fakeEngine(on, [])
    await start($)
    await $.tool.call({ tool: 'Read', file_path: '/r/src/app.ts' } as never)
    // l'attività si mostra fuori dal giro dello strumento
    await settle()

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'files-view-tree' })
    await ui.redraw()
    expect(await ui.find({ key: 'file:/r/src/app.ts' })).toBeDefined()
    await ui.unmount()
  })

  test('/sidebar close chiude la barra', async ($, on) => {
    fakeEngine(on, [])
    const closed: string[] = []
    on('ui.close', (_, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    const run = (args: string) =>
      $.command.run({ command: 'sidebar', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })

    expect((await run('close')).text).toBe('Sidebar closed: /sidebar reopens it.')
    expect(closed).toEqual(['barra-laterale'])
  })

  test('la vista principale elenca i file modificati con le righe inserite e cancellate', async ($, on) => {
    fakeEngine(on)
    FILES['/r/src/app.ts'] = 'uno\ndue\ntre\n'
    PENDING['/r/src/app.ts'] = 'uno\nDUE\ntre\nquattro\n'
    PENDING['/r/nuovo.md'] = 'riga\n'
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /No files changed in this session yet/ })).toBeDefined()

    await $.tool.call({ tool: 'Edit', file_path: '/r/src/app.ts', old_string: 'due', new_string: 'DUE' } as never)
    await $.tool.call({ tool: 'Write', file_path: '/r/nuovo.md', content: 'riga' } as never)
    await settle()
    await ui.redraw()

    expect(await ui.find({ key: 'touched:/r/src/app.ts' })).toBeDefined()
    expect(await ui.find({ key: 'touched:/r/nuovo.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ \+2$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ −1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 files/ })).toBeDefined()

    // Un clic porta il file nell'albero, con le cartelle sopra aperte.
    await ui.press({ key: 'touched:/r/src/app.ts' })
    await settle()
    await ui.redraw()
    expect(await ui.find({ key: 'file:/r/src/app.ts' })).toBeDefined()
    await ui.unmount()
  })
})
