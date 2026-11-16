import { h, Fragment } from '../../src/jsx.ts'
import { fit, len } from './ui';
const INDENT = '  ';
export const MENU_COLOR = '#5eead4';
export function menuLines(el, width, items, toggle, back) {
    const { Box, Button, Text } = el;
    const titleW = Math.max(...items.map(i => len(i.title)));
    const head = '≡ Sections';
    const hint = '  what the pane shows';
    return [
        h(Box, { key: "menu:head", flexDirection: "row", height: 1, overflow: "hidden" },
            h(Text, null, INDENT),
            h(Button, { key: "menu-back", plain: true, label: "\u2190", onPress: back }),
            h(Text, { color: MENU_COLOR, bold: true }, ` ${head}`),
            h(Text, { dimColor: true }, fit(hint, Math.max(0, width - len(INDENT) - 2 - len(head))))),
        h(Box, { key: "menu:rule", height: 1, overflow: "hidden" },
            h(Text, { color: MENU_COLOR, dimColor: true }, '▔'.repeat(width))),
        ...items.map(item => {
            const mark = item.isOn ? '[x]' : '[ ]';
            const used = len(INDENT) + len(mark) + 1 + titleW + 2;
            return (h(Box, { key: `menu:${item.id}`, flexDirection: "row", height: 1, overflow: "hidden" },
                h(Text, null, INDENT),
                h(Button, { key: `menu-${item.id}`, plain: true, label: `${item.isOn ? 'Hide' : 'Show'} ${item.title}`, onPress: () => toggle(item.id) },
                    h(Text, { color: item.isOn ? item.color : undefined, dimColor: !item.isOn, bold: item.isOn }, `${mark} ${item.title}`)),
                h(Text, null, ' '.repeat(titleW - len(item.title) + 2)),
                h(Text, { dimColor: true }, fit(item.about, Math.max(0, width - used)))));
        }),
        h(Box, { key: "menu:gap", height: 1 },
            h(Text, null, " ")),
        h(Box, { key: "menu:done", flexDirection: "row", height: 1, overflow: "hidden" },
            h(Text, null, INDENT),
            h(Button, { key: "menu-done", onPress: back },
                h(Text, { color: MENU_COLOR, bold: true }, "done"))),
    ];
}
