#!/bin/sh
# Compila il codice di Glassbox (mods/glassbox/hooks, TypeScript con JSX) nei
# file JavaScript che pi carica: pi/dist/hooks. pi non legge JSX, e chi installa
# con `pi install` non compila niente: pi/dist sta in git, e va rifatta e
# committata ogni volta che cambia mods/glassbox/hooks.
#
#   pi/build.sh           ricompila
#   pi/build.sh --check   esce con 1 se pi/dist non è quella del codice di adesso
set -eu
cd "$(dirname "$0")/.."
OUT=pi/dist/hooks
[ "${1:-}" = "--check" ] && OUT=$(mktemp -d)
[ "${1:-}" = "--check" ] || rm -rf "$OUT"

npx -p typescript tsc --noCheck --outDir "$OUT" --rootDir mods/glassbox/hooks \
  --jsx react --jsxFactory h --jsxFragmentFactory Fragment \
  --module esnext --target es2023 --moduleResolution bundler --skipLibCheck \
  mods/glassbox/hooks/*.ts mods/glassbox/hooks/*.tsx mods/glassbox/hooks/vendor/*.ts

# Il JSX compilato chiama `h`: in Claude Code è del motore, qui è in pi/src/jsx.ts.
for src in mods/glassbox/hooks/*.tsx; do
  js="$OUT/$(basename "$src" .tsx).js"
  { printf '%s\n' "import { h, Fragment } from '../../src/jsx.ts'"; cat "$js"; } > "$js.tmp" && mv "$js.tmp" "$js"
done

if [ "${1:-}" = "--check" ]; then
  if diff -r -q "$OUT" pi/dist/hooks >/dev/null; then rm -rf "$OUT"; echo "pi/dist is up to date"; else rm -rf "$OUT"; echo "pi/dist is stale: run pi/build.sh" >&2; exit 1; fi
fi
