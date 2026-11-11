#!/bin/sh
# Prepara la voce di Voxbox (WSL su Windows). Si può rilanciare: rifà solo
# quello che manca. Niente sudo.
#
#   ~/.local/share/voxbox/venv          Piper (piper-tts) in un ambiente suo, con uv
#   ~/.local/share/voxbox/voices        la voce it_IT-serena-high
#   %LOCALAPPDATA%\voxbox\voxbox-win.exe  player e attesa degli appunti, compilato
#                                         con il csc.exe del .NET Framework
#   ~/.local/share/voxbox/config.json   dove sono le tre cose, per il mod
#
# Disinstallare: bin/setup.sh --uninstall
set -eu

VOICE="${VOXBOX_VOICE:-it_IT-serena-high}"
HOME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/voxbox"
HERE="$(cd "$(dirname "$0")" && pwd)"
CSC=/mnt/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe

say() { printf '%s\n' "voxbox: $*"; }
fail() { printf '%s\n' "voxbox: $*" >&2; exit 1; }

win_dir() {
  command -v powershell.exe >/dev/null || fail "powershell.exe non trovato: Voxbox richiede WSL su Windows"
  local_app=$(powershell.exe -NoProfile -Command '[Environment]::GetFolderPath("LocalApplicationData")' | tr -d '\r')
  wslpath -u "$local_app\\voxbox"
}

if [ "${1:-}" = "--uninstall" ]; then
  WIN=$(win_dir)
  rm -rf "$HOME_DIR" && say "rimosso $HOME_DIR"
  rm -rf "$WIN" && say "rimosso $(wslpath -w "$WIN")"
  exit 0
fi

command -v uv >/dev/null || fail "serve uv (https://docs.astral.sh/uv/): un solo binario in ~/.local/bin"
[ -x "$CSC" ] || fail "csc.exe non trovato in $CSC"
mkdir -p "$HOME_DIR/voices"

if [ ! -x "$HOME_DIR/venv/bin/python" ]; then
  say "creo l'ambiente di Piper"
  uv venv -q --python 3.12 "$HOME_DIR/venv"
fi
if ! "$HOME_DIR/venv/bin/python" -I -c "import piper" 2>/dev/null; then
  say "installo piper-tts"
  VIRTUAL_ENV="$HOME_DIR/venv" uv pip install -q piper-tts
fi

if [ ! -f "$HOME_DIR/voices/$VOICE.onnx" ]; then
  say "scarico la voce $VOICE"
  (cd "$HOME_DIR/voices" && "$HOME_DIR/venv/bin/python" -I -m piper.download_voices --download-dir . "$VOICE")
fi

WIN=$(win_dir)
mkdir -p "$WIN"
EXE="$WIN/voxbox-win.exe"
if [ ! -f "$EXE" ] || [ "$HERE/voxbox-win.cs" -nt "$EXE" ]; then
  say "compilo voxbox-win.exe"
  cp "$HERE/voxbox-win.cs" "$WIN/voxbox-win.cs"
  (cd "$WIN" && "$CSC" /nologo /optimize /platform:x64 /r:System.Windows.Forms.dll /out:voxbox-win.exe voxbox-win.cs) | tr -d '\r'
fi

cat > "$HOME_DIR/config.json" <<EOF
{
  "python": "$HOME_DIR/venv/bin/python",
  "voice": "$HOME_DIR/voices/$VOICE.onnx",
  "win": "$EXE"
}
EOF
say "pronto: $HOME_DIR/config.json"
