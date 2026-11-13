// Gli elementi che Glassbox disegna, per pi. In Claude Code il JSX delle viste
// (`<el.Text color=…>`) lo compila il motore; qui `pi/build.sh` lo compila in
// chiamate a `h`, che ne fa un albero di nodi: lo impagina layout.ts.

export type El = { type: string; props: Record<string, any>; children: Child[] }
export type Child = El | string

const flat = (list: unknown[], out: Child[] = []): Child[] => {
  for (const c of list) {
    if (Array.isArray(c)) flat(c, out)
    else if (typeof c === 'string') out.push(c)
    else if (typeof c === 'number') out.push(String(c))
    else if (c && typeof c === 'object') out.push(c as El)
  }
  return out
}

export function h(type: string, props: Record<string, any> | null, ...children: unknown[]): El {
  return { type, props: props ?? {}, children: flat(children) }
}

export const Fragment = 'Fragment'

/** Quello che `$.ui.resolve(e)` restituisce: i costruttori sono i loro nomi. */
export const elements = { Box: 'Box', Text: 'Text', Button: 'Button', Input: 'Input', Code: 'Code' }
