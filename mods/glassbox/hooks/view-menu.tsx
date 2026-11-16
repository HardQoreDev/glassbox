// Il menù delle sezioni, al posto del pannello: una spunta per sezione, per
// scegliere quali Glassbox mostra. Una sezione tolta non occupa nemmeno la
// riga del titolo (chiuderla dal titolo, invece, la lascia lì). La scelta
// resta salvata per le sessioni dopo.
import type { RenderElement } from 'claude-code'

import { fit, len } from './ui'
import type { Els } from './ui'

export type MenuItem = { id: string; title: string; color: string; about: string; isOn: boolean }

const INDENT = '  '
export const MENU_COLOR = '#5eead4'

export function menuLines(el: Els, width: number, items: MenuItem[], toggle: (id: string) => void, back: () => void): RenderElement[] {
  const { Box, Button, Text } = el
  const titleW = Math.max(...items.map(i => len(i.title)))
  const head = '≡ Sections'
  const hint = '  what the pane shows'
  return [
    <Box key="menu:head" flexDirection="row" height={1} overflow="hidden">
      <Text>{INDENT}</Text>
      <Button key="menu-back" plain label="←" onPress={back} />
      <Text color={MENU_COLOR} bold>{` ${head}`}</Text>
      <Text dimColor>{fit(hint, Math.max(0, width - len(INDENT) - 2 - len(head)))}</Text>
    </Box>,
    <Box key="menu:rule" height={1} overflow="hidden">
      <Text color={MENU_COLOR} dimColor>
        {'▔'.repeat(width)}
      </Text>
    </Box>,
    ...items.map(item => {
      const mark = item.isOn ? '[x]' : '[ ]'
      const used = len(INDENT) + len(mark) + 1 + titleW + 2
      return (
        <Box key={`menu:${item.id}`} flexDirection="row" height={1} overflow="hidden">
          <Text>{INDENT}</Text>
          <Button key={`menu-${item.id}`} plain label={`${item.isOn ? 'Hide' : 'Show'} ${item.title}`} onPress={() => toggle(item.id)}>
            <Text color={item.isOn ? item.color : undefined} dimColor={!item.isOn} bold={item.isOn}>
              {`${mark} ${item.title}`}
            </Text>
          </Button>
          <Text>{' '.repeat(titleW - len(item.title) + 2)}</Text>
          <Text dimColor>{fit(item.about, Math.max(0, width - used))}</Text>
        </Box>
      )
    }),
    <Box key="menu:gap" height={1}>
      <Text> </Text>
    </Box>,
    <Box key="menu:done" flexDirection="row" height={1} overflow="hidden">
      <Text>{INDENT}</Text>
      <Button key="menu-done" onPress={back}>
        <Text color={MENU_COLOR} bold>
          done
        </Text>
      </Button>
    </Box>,
  ]
}
