import { h, Fragment } from '../../src/jsx.ts'
import { fit, len } from './ui';
import { textOf, vox } from './vox';
const INDENT = '  ';
const NAMES = { raw: 'VOX text', prosa: 'VOX prose', sintesi: 'SYNTH' };
export function voxEditLines(el, width, bodyRows, edit, color, a) {
    const { Box, Button, Input, Text } = el;
    const inner = Math.max(8, width - len(INDENT) - 1);
    const title = edit.what === 'text' ? `✎ ${NAMES[edit.target]}` : `✎ ${edit.kind === 'prosa' ? 'prose' : 'SYNTH'} prompt`;
    const hint = edit.what === 'text'
        ? 'Enter saves · \\ + Enter: new line'
        : edit.kind === 'prosa'
            ? '{parole}: from the formula'
            : '{righe}, {parole_riga}: from the formula';
    const head = (h(Box, { key: "vox-edit:head", flexDirection: "row", height: 1, overflow: "hidden" },
        h(Text, null, INDENT),
        h(Button, { key: "vox-edit-back", plain: true, label: "\u2190", onPress: a.closeEdit }),
        h(Text, { color: color, bold: true }, ` ${title}`),
        h(Text, { dimColor: true }, fit(`  ${hint}`, Math.max(1, inner - 2 - len(title))))));
    const rule = (h(Box, { key: "vox-edit:rule", height: 1, overflow: "hidden" },
        h(Text, { color: color, dimColor: true }, '▔'.repeat(width))));
    // Un campo di testo va disegnato senza un contenitore che ne fissi altezza o
    // margini (lì il terminale non lo mostra): solo una riga con il rientro.
    // Mentre si scrive, Claude Code mette accanto al campo una colonna
    // "↵ · \↵ new line" che l'API non permette di togliere né spostare.
    const field = (key, input) => (h(Box, { key: key, flexDirection: "row" },
        h(Text, null, INDENT),
        input));
    if (edit.what === 'text') {
        const { target } = edit;
        // Invio salva ed esce: Claude Code poi svuota il campo, e quel vuoto non
        // deve arrivare al testo, quindi le modifiche contano solo mentre si è
        // dentro. Con `rec` in concatena le copie nuove arrivano in fondo anche
        // adesso: `textKey` ridisegna il campo.
        return [
            head,
            rule,
            field(`vox-edit:text:${vox.textKey}`, h(Input, { key: `vox-text-${edit.session}`, autoFocus: true, value: textOf(target), rows: Math.max(2, bodyRows - 3), submitLabel: "save", onInput: value => a.typeText(target, value), onSubmit: value => a.submitText(target, value) })),
        ];
    }
    return [
        head,
        rule,
        field('vox-edit:template', h(Input, { key: `vox-prompt-${edit.key}`, autoFocus: true, value: edit.draft, submitLabel: "save", rows: Math.max(3, bodyRows - 6), onInput: value => a.typePrompt('draft', value), onSubmit: value => {
                a.typePrompt('draft', value);
                a.savePrompt();
            } })),
        field('vox-edit:params', h(Input, { key: `vox-params-${edit.key}`, label: "params", value: edit.params, onInput: value => a.typePrompt('params', value), onSubmit: value => {
                a.typePrompt('params', value);
                a.savePrompt();
            } })),
        h(Box, { key: "vox-edit:buttons", flexDirection: "row", height: 1, overflow: "hidden" },
            h(Text, null, INDENT),
            h(Button, { key: "vox-prompt-save", onPress: a.savePrompt },
                h(Text, { color: color, bold: true }, "save")),
            h(Text, null, " "),
            h(Button, { key: "vox-prompt-reset", onPress: a.resetPrompt },
                h(Text, null, "\u21BA default")),
            h(Text, null, " "),
            h(Button, { key: "vox-prompt-close", onPress: a.closeEdit },
                h(Text, null, "close"))),
    ];
}
