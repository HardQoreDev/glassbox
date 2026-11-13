#!/bin/sh
# Prova Glassbox dentro pi, senza credenziali e senza pannello: un modello
# finto fa un turno con uno strumento, e pi/test/smoke.ts controlla
# l'impaginazione e quello che Glassbox ha registrato. Controlla anche che
# pi/dist sia quella del codice di adesso. Glassbox si carica dalla radice della
# repo, come pacchetto: così si prova anche il manifest in package.json.
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
pi/build.sh --check
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/project" && cd "$WORK/project" && git init -q
OUT=$(GLASSBOX_DIR="$WORK/glassbox" GLASSBOX_HEADLESS=1 pi --offline -ne -p --no-session \
  -e "$ROOT/pi/test/faux.ts" -e "$ROOT" -e "$ROOT/pi/test/smoke.ts" \
  --model faux/faux-1 "scrivi un file di prova" </dev/null 2>&1) || true
printf '%s\n' "$OUT" | grep -A 20 "GLASSBOX-PI" || { printf '%s\n' "$OUT" | tail -20; echo "GLASSBOX-PI: no verdict" >&2; exit 1; }
printf '%s\n' "$OUT" | grep -q "GLASSBOX-PI OK"
