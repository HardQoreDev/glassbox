import { describe, expect, test } from 'claude-code/testing'

import { ENV, FILES, PANE, PENDING, RUNS, fakeEngine, oneTurn, settle, start } from './engine'

// Un pannello alto, perché i branch e i loro dettagli stiano tutti nella sezione.
const TALL = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 80 } } }

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

      // i branch: il principale in alto, il branch attuale avanti di uno sul remoto
      expect((await ui.find({ key: 'branch:refs/heads/main' }))?.text).toBe('◎ main')
      // il grafo: il merge in testa
      await ui.press({ key: 'graph-view-full' })
      await ui.redraw()
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

    await ui.press({ key: 'graph-view-full' })
    await ui.redraw()
    await ui.press({ key: 'commit:c3' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /c3 · Giulio/ })).toBeDefined()

    await ui.press({ key: 'section:graph' })
    await ui.redraw()
    expect(await ui.find({ key: 'commit:c3' })).toBeUndefined()
    expect(await ui.find({ key: 'section:graph' })).toBeDefined()
    await ui.unmount()
  })

  test('la vista active: il principale in alto, sotto i branch attivi, gli uniti contati', async ($, on) => {
    fakeEngine(on, [])
    await start($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })

    // È la vista di partenza.
    expect(await ui.find({ key: 'commit:c3' })).toBeUndefined()
    const rows = async () => (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('b:')).map(b => b.text)
    const shown = await rows()
    // main segue origin/main; poi dal più recente: spike mai spinto, wip
    // senza commit suoi ma aperto in un worktree, feature solo sul remoto.
    // A destra l'ultima sincronizzazione; un branch mai spinto non ne ha.
    expect(shown[0]).toMatch(/^◎ main +last sync +\S+$/)
    expect(shown[1]).toMatch(/^├─ spike +\+2 −1 {2}local *$/)
    expect(shown[2]).toMatch(/^├─ wip += {5}local *$/)
    expect(shown[3]).toMatch(/^└─ feature +\+1 −2 {2}remote +\S+$/)
    // old-fix è già in origin/main: solo contato.
    expect(shown[4]).toBe('   ▸ 1 merged')
    expect(await ui.find({ key: 'branch:refs/heads/old-fix' })).toBeUndefined()
    // origin/main e origin/HEAD sono il principale, non righe loro.
    expect(shown).toHaveLength(5)

    await ui.press({ key: 'branches-merged' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /^ {5}old-fix$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▾ 1 merged' })).toBeDefined()

    await ui.press({ key: 'graph-view-full' })
    await ui.redraw()
    expect(await ui.find({ key: 'commit:c3' })).toBeDefined()
    expect(await ui.find({ key: 'branch:refs/heads/main' })).toBeUndefined()
    await ui.unmount()
  })

  test('un clic su un branch apre il suo ultimo commit, il confronto, il remoto e il worktree', async ($, on) => {
    fakeEngine(on, [])
    await start($)
    const ui = await $.ui.mount({ ...TALL, surface: 'terminal' })

    await ui.press({ key: 'branch:refs/heads/spike' })
    await ui.redraw()
    for (const text of [/│  Prova veloce/, /│  s2 · Ada · committed .+ ago$/, /│  2 commits ahead of origin\/main, 1 behind/, /│  not on any remote/])
      expect(await ui.find({ type: 'Text', text })).toBeDefined()
    // Mai spinto: nei dettagli non c'è un'ultima sincronizzazione.
    expect(await ui.find({ type: 'Text', text: /│  last sync/ })).toBeUndefined()

    // Uno alla volta; l'ultimo della lista non ha la linea dell'albero a sinistra.
    await ui.press({ key: 'branch:refs/heads/wip' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Prova veloce/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /same commit as origin\/main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'open in ~/r-wip' })).toBeDefined()

    await ui.press({ key: 'branch:refs/remotes/origin/feature' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /only on the remote, as origin\/feature/ })).toBeDefined()
    // Il push è dopo l'ultimo fetch che l'ha visto sullo stesso commit.
    expect(await ui.find({ type: 'Text', text: /last sync .+ ago, by push$/ })).toBeDefined()

    await ui.press({ key: 'branch:refs/heads/main' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /in sync with origin\/main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /last sync .+ ago, by fetch$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /the branches below are compared with origin\/main/ })).toBeDefined()
    // Il worktree di main è questo: non si ripete.
    expect(await ui.find({ type: 'Text', text: /open in/ })).toBeUndefined()
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

    await ui.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`un clic su un file modificato apre il file con le righe aggiunte e tolte (${surface})`, async ($, on) => {
      fakeEngine(on)
      FILES['/r/src/app.ts'] = 'uno\ndue\ntre\n'
      PENDING['/r/src/app.ts'] = 'uno\nDUE\ntre\nquattro\n'
      await start($)
      await $.tool.call({ tool: 'Edit', file_path: '/r/src/app.ts', old_string: 'due', new_string: 'DUE' } as never)
      await settle()
      const ui = await $.ui.mount({ ...PANE, surface })

      await ui.press({ key: 'touched:/r/src/app.ts' })
      await settle()
      await ui.redraw()
      const code = await ui.find({ type: 'Code' })
      expect(code?.props.format).toBe('diff')
      expect(code?.props.source).toBe('@@ -1,3 +1,4 @@\n uno\n-due\n+DUE\n tre\n+quattro')
      expect(await ui.find({ type: 'Text', text: /^app\.ts$/ })).toBeDefined()
      expect(await ui.find({ key: 'section:files' })).toBeUndefined()

      // Una scrittura dopo rifà il confronto con il file di prima della sessione.
      PENDING['/r/src/app.ts'] = 'uno\ndue\ntre\nquattro\n'
      await $.tool.call({ tool: 'Edit', file_path: '/r/src/app.ts', old_string: 'DUE', new_string: 'due' } as never)
      await settle()
      await ui.redraw()
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe('@@ -1,3 +1,4 @@\n uno\n due\n tre\n+quattro')

      // Le righe entrano tutte: niente slider.
      expect(await ui.find({ key: 'preview-right' })).toBeUndefined()

      await ui.press({ key: 'preview-close' })
      await ui.redraw()
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      expect(await ui.find({ key: 'touched:/r/src/app.ts' })).toBeDefined()

      // Dall'anteprima il file si mostra nell'albero, con le cartelle sopra aperte.
      await ui.press({ key: 'touched:/r/src/app.ts' })
      await settle()
      await ui.redraw()
      await ui.press({ key: 'preview-tree' })
      await settle()
      await ui.redraw()
      expect(await ui.find({ key: 'file:/r/src/app.ts' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('con wrap le righe lunghe vanno a capo, senza slider, fino in fondo al file', async ($, on) => {
    fakeEngine(on)
    const long = (i: number) => `${i}`.padEnd(120, String.fromCharCode(97 + (i % 26)))
    const lines = Array.from({ length: 40 }, (_, i) => long(i))
    FILES['/r/src/app.ts'] = 'uno\n'
    PENDING['/r/src/app.ts'] = `uno\n${lines.join('\n')}\n`
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/r/src/app.ts', content: '' } as never)
    await settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'touched:/r/src/app.ts' })
    await settle()
    await ui.redraw()
    expect(await ui.find({ key: 'preview-right' })).toBeDefined()

    await ui.press({ key: 'preview-wrap' })
    await ui.redraw()
    const code = async () => (await ui.find({ type: 'Code' }))?.props as { source: string; wrap: string }
    expect((await code()).wrap).toBe('wrap')
    expect(await ui.find({ key: 'preview-right' })).toBeUndefined()
    // 28 righe di schermo: `uno`, poi nove righe da tre (53 colonne di testo)
    expect((await code()).source).toBe(`@@ -1,1 +1,10 @@\n uno\n${lines.slice(0, 9).map(l => `+${l}`).join('\n')}`)

    // In fondo le ultime righe entrano intere.
    await $.ui.scroll({ component: 'Pane', requestId: 'barra-laterale', offset: 0, by: 100, bodyRows: 30, contentRows: 30, origin: { kind: 'person' } })
    await ui.redraw()
    expect((await code()).source).toBe(`@@ -1,0 +33,9 @@\n${lines.slice(31).map(l => `+${l}`).join('\n')}`)

    // wrap resta acceso da un file all'altro, finché non si spegne.
    await ui.press({ key: 'preview-close' })
    await ui.redraw()
    await ui.press({ key: 'touched:/r/src/app.ts' })
    await settle()
    await ui.redraw()
    expect((await code()).wrap).toBe('wrap')
    await ui.press({ key: 'preview-wrap' })
    await ui.redraw()
    expect((await code()).wrap).toBe('truncate-end')
    await ui.unmount()
  })

  test("l'icona accanto a un file modificato lo apre con l'applicazione del sistema", async ($, on) => {
    fakeEngine(on)
    FILES['/r/notes.md'] = '# Note\n'
    PENDING['/r/notes.md'] = '# Note\n\nAltro.\n'
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/r/notes.md' } as never)
    await settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    RUNS.length = 0

    // In WSL con explorer.exe, che apre il file con l'applicazione di Windows.
    ENV.WSL_DISTRO_NAME = 'Ubuntu'
    await ui.press({ key: 'open:/r/notes.md' })
    await settle()
    expect(RUNS).toEqual([
      ['wslpath', '-w', '/r/notes.md'],
      ['explorer.exe', '\\\\wsl.localhost\\Ubuntu\\r\\notes.md'],
    ])
    // L'anteprima non si apre: l'icona apre solo il file fuori.
    await ui.redraw()
    expect(await ui.find({ type: 'Code' })).toBeUndefined()

    // Su Linux con xdg-open.
    delete ENV.WSL_DISTRO_NAME
    RUNS.length = 0
    await ui.press({ key: 'open:/r/notes.md' })
    await settle()
    expect(RUNS).toEqual([
      ['uname', '-s'],
      ['xdg-open', '/r/notes.md'],
    ])
    await ui.unmount()
  })

  test('una riga troppo larga si legge con lo slider', async ($, on) => {
    fakeEngine(on)
    const long = Array.from({ length: 120 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
    FILES['/r/src/app.ts'] = 'uno\n'
    PENDING['/r/src/app.ts'] = `uno\n${long}\n`
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/r/src/app.ts', content: '' } as never)
    await settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'touched:/r/src/app.ts' })
    await settle()
    await ui.redraw()
    const source = async () => String((await ui.find({ type: 'Code' }))?.props.source)
    expect(await source()).toBe(`@@ -1,1 +1,2 @@\n uno\n+${long}`)

    // ▸ sposta di mezza larghezza: 54 colonne di testo, 27 alla volta.
    await ui.press({ key: 'preview-right' })
    await ui.redraw()
    expect(await source()).toBe(`@@ -1,1 +1,2 @@\n \n+${long.slice(27)}`)

    // In fondo alla barra si arriva alla fine della riga, all'inizio si torna a capo.
    await ui.press({ key: 'preview-x:55' })
    await ui.redraw()
    expect(await source()).toBe(`@@ -1,1 +1,2 @@\n \n+${long.slice(66)}`)
    await ui.press({ key: 'preview-x:0' })
    await ui.redraw()
    expect(await source()).toBe(`@@ -1,1 +1,2 @@\n uno\n+${long}`)

    // La rotella sopra lo slider scorre di lato, quattro colonne a tic.
    await $.ui.scroll({
      component: 'Pane',
      requestId: 'barra-laterale',
      offset: 0,
      by: 2,
      bodyRows: 30,
      contentRows: 30,
      origin: { kind: 'person' },
      pointer: { column: 20, row: 29 },
    })
    await ui.redraw()
    expect(await source()).toBe(`@@ -1,1 +1,2 @@\n \n+${long.slice(8)}`)
    await ui.unmount()
  })

  test("l'anteprima di un file lungo scorre con la rotella", async ($, on) => {
    fakeEngine(on)
    const lines = Array.from({ length: 100 }, (_, i) => `riga ${i + 1}`)
    FILES['/r/src/app.ts'] = `${lines.join('\n')}\n`
    PENDING['/r/src/app.ts'] = `${lines.map((l, i) => (i === 49 ? 'cambiata' : l)).join('\n')}\n`
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/r/src/app.ts', old_string: 'riga 50', new_string: 'cambiata' } as never)
    await settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'touched:/r/src/app.ts' })
    await settle()
    await ui.redraw()

    // Si apre poco sopra la prima modifica, con le righe che entrano.
    const first = String((await ui.find({ type: 'Code' }))?.props.source)
    expect(first.split('\n')[0]).toBe('@@ -47,27 +47,27 @@')
    expect(first).toContain('-riga 50\n+cambiata')

    // Un tic della rotella scorre di tre righe; oltre la fine non si va.
    const wheel = (by: number) =>
      $.ui.scroll({
        component: 'Pane',
        requestId: 'barra-laterale',
        offset: 0,
        by,
        bodyRows: 30,
        contentRows: 30,
        origin: { kind: 'person' },
        pointer: { column: 10, row: 10 },
      })
    await wheel(1)
    await ui.redraw()
    expect(String((await ui.find({ type: 'Code' }))?.props.source).split('\n')[0]).toBe('@@ -50,27 +50,27 @@')
    await wheel(100)
    await ui.redraw()
    expect(String((await ui.find({ type: 'Code' }))?.props.source).split('\n')[0]).toBe('@@ -73,28 +73,28 @@')
    await ui.unmount()
  })
})
