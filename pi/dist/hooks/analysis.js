import { doc } from './context';
import { saveAnalysis } from './record';
import { fmtTokens } from './vendor/turns';
// Sotto questi token l'input pagato per intero (il prompt dell'analisi) non si dice.
const UNCACHED_SHOWN = 1_000;
export const analysis = {
    state: 'idle',
    /** La richiesta di cui si legge il contesto. */
    n: 0,
    model: '',
    startedAt: 0,
    text: '',
    error: '',
    usage: undefined,
    /** Dove è salvata; '' se il registro è spento. */
    path: '',
};
/** Quello che si chiede: il ruolo, i numeri di Glassbox, le sezioni della risposta. */
export function analysisPrompt(n, measures) {
    return [
        `Glassbox, the pane that shows the person what goes into your context, asks you for a context-engineering review of this conversation as request #${n} sent it. You are not continuing the task: your tools are off and nothing you write here reaches the work or the person's conversation.`,
        'Read your own context as it stands (the system prompt, the tools, the memory files, every message, tool result and reminder) and judge it for the work still ahead.',
        '',
        'Glassbox measured it as follows; a ~ marks an estimate from characters.',
        '<glassbox-measures>',
        measures || 'No numbers yet.',
        '</glassbox-measures>',
        '',
        'Answer in the language you use with the person, in markdown, in at most about 500 words, with exactly these sections:',
        '## What the context holds',
        'Two or three lines: what the work is now, and what the context is made of, by weight.',
        '## Dead weight',
        'The concrete items that no longer help the work ahead, each named (the file, the command, the search, the discussion) with its rough weight: stale, repeated, failed, superseded or never used. Say "nothing worth dropping" if so.',
        '## What to do now',
        'The two to four actions with the most effect, in order, and only those that apply here: for example /compact now with the exact instructions to type after it, so the summary keeps what the work needs; /clear and a fresh start from the brief below; a rule or a fact to move into CLAUDE.md or memory; an MCP server, a skill or a hook to switch off; exploration to hand to a subagent.',
        '## Habits',
        "One or two changes to the person's way of working that would keep the context lean, judged from this session.",
        '## Brief to restart',
        'At most 12 lines a fresh session could start from without losing anything the work needs: the goal, the decisions taken, the state now, the files that matter, what comes next.',
    ].join('\n');
}
const reasonText = (r) => {
    switch (r.reason) {
        case 'nothing-to-fork':
            return 'Nothing to analyze yet: the first answer has to come back first.';
        case 'api-error':
            return `The API answered with an error${r.status ? ` ${r.status}` : ''} (${r.error}).`;
        case 'empty-reply':
            return 'The model answered without text.';
        case 'aborted':
            return 'The analysis was cut short.';
    }
};
/** Il costo in token: l'output, l'input letto dalla cache e, se conta, quello pagato per intero. */
export function usageText(u) {
    if (!u)
        return '';
    const full = u.input_tokens + u.cache_creation_input_tokens;
    return [`${fmtTokens(u.output_tokens)} out`, u.cache_read_input_tokens > 0 ? `${fmtTokens(u.cache_read_input_tokens)} cached` : '', full >= UNCACHED_SHOWN ? `${fmtTokens(full)} uncached` : '']
        .filter(Boolean)
        .join(' · ');
}
/** Il markdown della risposta come righe della finestra: i titoli fino a ## con la riga, gli altri in grassetto. */
export function markdownLines(md) {
    return md.split('\n').map(l => {
        const m = /^(#{1,6})\s+(.*)$/.exec(l);
        const text = (m ? m[2] : l).replace(/\*\*(.+?)\*\*/g, '$1');
        if (!m)
            return { text };
        return { text, tone: m[1].length <= 2 ? 'system' : 'block' };
    });
}
const clock = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
function analysisLines() {
    const of = analysis.n ? `request #${analysis.n}` : 'the last request';
    if (analysis.state === 'running')
        return [
            { text: `Claude is reading its own context as ${of} sent it, with Glassbox's numbers. The context goes again, read from the prompt cache while it is warm.`, tone: 'note' },
            { text: '' },
            { text: `Working since ${clock(analysis.startedAt)}…`, tone: 'note' },
        ];
    if (analysis.state === 'failed')
        return [{ text: analysis.error, tone: 'note' }, { text: '' }, { text: '↻ asks again.', tone: 'note' }];
    return [
        { text: `Claude's own reading of its context as ${of} sent it, with Glassbox's numbers, at ${clock(analysis.startedAt)}.${analysis.path ? ` Saved with the session record as ${analysis.path.split('/').slice(-2).join('/')}; ↗ opens it.` : ''}`, tone: 'note' },
        { text: '' },
        ...markdownLines(analysis.text.trim()),
    ];
}
/** Apre la finestra sull'analisi, com'è ora. */
export function openAnalysis() {
    const info = analysis.state === 'running' ? 'running…' : analysis.state === 'done' ? usageText(analysis.usage) : 'failed';
    Object.assign(doc, {
        isOpen: true,
        n: analysis.n,
        part: 'analysis',
        title: analysis.n ? `#${analysis.n} analysis` : 'analysis',
        info,
        lines: analysisLines(),
        version: doc.version + 1,
        offset: 0,
        left: 0,
        focus: undefined,
    });
}
export const isShowingAnalysis = () => doc.isOpen && doc.part === 'analysis';
// Il file salvato: il titolo, quando e quanto è costata, poi la risposta.
const fileText = () => [
    `# Context analysis · request #${analysis.n}`,
    '',
    `> ${new Date(analysis.startedAt).toISOString()}${analysis.model ? ` · ${analysis.model}` : ''}${analysis.usage ? ` · ${usageText(analysis.usage)}` : ''}`,
    '',
    analysis.text.trim(),
    '',
].join('\n');
/**
 * Chiede l'analisi del contesto di `n` e la mostra nella finestra; `done` dice
 * quando è pronta, per ridisegnare o avvisare se la finestra è stata chiusa.
 */
export async function runAnalysis($, n, model, measures, done) {
    Object.assign(analysis, { state: 'running', n, model, startedAt: Date.now(), text: '', error: '', usage: undefined, path: '' });
    openAnalysis();
    done(true);
    try {
        const r = await $.model.fork({ prompt: analysisPrompt(n, measures) });
        if (r.isAnswered) {
            Object.assign(analysis, { state: 'done', text: r.text, usage: r.usage });
            analysis.path = await saveAnalysis($, n, fileText()).catch(() => '');
        }
        else
            Object.assign(analysis, { state: 'failed', error: reasonText(r), usage: 'usage' in r ? r.usage : undefined });
    }
    catch (err) {
        Object.assign(analysis, { state: 'failed', error: `The analysis did not run: ${err instanceof Error ? err.message : err}` });
    }
    const isShown = isShowingAnalysis();
    if (isShown)
        openAnalysis();
    done(isShown);
}
/** Per i test. */
export function resetAnalysis() {
    Object.assign(analysis, { state: 'idle', n: 0, model: '', startedAt: 0, text: '', error: '', usage: undefined, path: '' });
}
