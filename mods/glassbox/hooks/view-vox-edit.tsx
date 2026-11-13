// L'editor di VOX e SYNTH, al posto di tutte le sezioni: un testo (quello
// catturato, la prosa o la sintesi) da ritoccare, oppure il prompt di prosa o
// sintesi con i suoi parametri. Invio salva ed esce; `\` + Invio va a capo.
import type { RenderElement } from 'claude-code'

import { fit, len } from './ui'
import type { Els } from './ui'
import { textOf, vox } from './vox'
import type { Edit, VoxActions } from './vox'

const INDENT = '  '

const NAMES = { raw: 'VOX text', prosa: 'VOX prose', sintesi: 'SYNTH' } as const

export function voxEditLines(el: Els, width: number, bodyRows: number, edit: Edit, color: string, a: VoxActions): RenderElement[] {
  const { Box, Button, Input, Text } = el
  const inner = Math.max(8, width - len(INDENT) - 1)
  const title = edit.what === 'text' ? `✎ ${NAMES[edit.target]}` : `✎ ${edit.kind === 'prosa' ? 'prose' : 'SYNTH'} prompt`
  const hint =
    edit.what === 'text'
      ? 'Enter saves · \\ + Enter: new line'
      : edit.kind === 'prosa'
        ? '{parole}: from the formula'
        : '{righe}, {parole_riga}: from the formula'
  const head = (
    <Box key="vox-edit:head" flexDirection="row" height={1} overflow="hidden">
      <Text>{INDENT}</Text>
      <Button key="vox-edit-back" plain label="←" onPress={a.closeEdit} />
      <Text color={color} bold>{` ${title}`}</Text>
      <Text dimColor>{fit(`  ${hint}`, Math.max(1, inner - 2 - len(title)))}</Text>
    </Box>
  )
  const rule = (
    <Box key="vox-edit:rule" height={1} overflow="hidden">
      <Text color={color} dimColor>
        {'▔'.repeat(width)}
      </Text>
    </Box>
  )
  // Un campo di testo va disegnato senza un contenitore che ne fissi altezza o
  // margini (lì il terminale non lo mostra): solo una riga con il rientro.
  // Mentre si scrive, Claude Code mette accanto al campo una colonna
  // "↵ · \↵ new line" che l'API non permette di togliere né spostare.
  const field = (key: string, input: RenderElement) => (
    <Box key={key} flexDirection="row">
      <Text>{INDENT}</Text>
      {input}
    </Box>
  )

  if (edit.what === 'text') {
    const { target } = edit
    // Invio salva ed esce: Claude Code poi svuota il campo, e quel vuoto non
    // deve arrivare al testo, quindi le modifiche contano solo mentre si è
    // dentro. Con `rec` in concatena le copie nuove arrivano in fondo anche
    // adesso: `textKey` ridisegna il campo.
    return [
      head,
      rule,
      field(
        `vox-edit:text:${vox.textKey}`,
        <Input
          key={`vox-text-${edit.session}`}
          autoFocus
          value={textOf(target)}
          rows={Math.max(2, bodyRows - 3)}
          submitLabel="save"
          onInput={value => a.typeText(target, value)}
          onSubmit={value => a.submitText(target, value)}
        />,
      ),
    ]
  }

  return [
    head,
    rule,
    field(
      'vox-edit:template',
      <Input
        key={`vox-prompt-${edit.key}`}
        autoFocus
        value={edit.draft}
        submitLabel="save"
        rows={Math.max(3, bodyRows - 6)}
        onInput={value => a.typePrompt('draft', value)}
        onSubmit={value => {
          a.typePrompt('draft', value)
          a.savePrompt()
        }}
      />,
    ),
    field(
      'vox-edit:params',
      <Input
        key={`vox-params-${edit.key}`}
        label="params"
        value={edit.params}
        onInput={value => a.typePrompt('params', value)}
        onSubmit={value => {
          a.typePrompt('params', value)
          a.savePrompt()
        }}
      />,
    ),
    <Box key="vox-edit:buttons" flexDirection="row" height={1} overflow="hidden">
      <Text>{INDENT}</Text>
      <Button key="vox-prompt-save" onPress={a.savePrompt}>
        <Text color={color} bold>
          save
        </Text>
      </Button>
      <Text> </Text>
      <Button key="vox-prompt-reset" onPress={a.resetPrompt}>
        <Text>↺ default</Text>
      </Button>
      <Text> </Text>
      <Button key="vox-prompt-close" onPress={a.closeEdit}>
        <Text>close</Text>
      </Button>
    </Box>,
  ]
}
