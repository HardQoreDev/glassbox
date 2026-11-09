#!/usr/bin/env python3
"""Le sessioni di Claude Code aperte su questa macchina, per la sezione SESSIONS.

Claude Code tiene un registro in ~/.claude/sessions/<pid>.json: una voce per
processo, con l'id della sessione, la cartella, il nome e busy/idle. Qui si
tengono le voci interattive il cui processo è ancora quello registrato (il pid
vivo e partito quando dice la voce, per non scambiarlo con uno riusato), e di
ognuna si legge la coda del transcript: quando è finita l'ultima richiesta del
thread principale e quanto contesto portava. Esce un JSON su stdout.

Se le sessioni girano in herdr, `herdr agent list` dice per ognuna il suo pane
(per portarci il focus con `herdr agent focus <pane>`) e il titolo del suo
terminale, che dice su cosa sta lavorando meglio del nome del registro.

Glassbox lo chiama ogni minuto in ogni sessione aperta: perché venti sessioni
non rifacciano lo stesso lavoro, il risultato resta in un file per FRESH_S
secondi e chi chiama in quel tempo rilegge quello. --fresh lo rifà comunque.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime

FRESH_S = 45
BASE = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
CACHE = os.path.join(os.environ.get("TMPDIR") or "/tmp", f"claude-glassbox-sessions-{os.getuid()}.json")
SID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def tail_state(path):
    """Dalla coda del transcript: {'lastMs', 'ctx'} dell'ultima risposta del thread
    principale; {'lastMs', 'compacted': True} se dopo c'è stata una compattazione;
    {} se non si trova niente."""
    try:
        size = os.path.getsize(path)
    except (OSError, TypeError):
        return {}
    for chunk in (256 * 1024, 4 * 1024 * 1024, 64 * 1024 * 1024):
        start = max(0, size - chunk)
        with open(path, "rb") as f:
            f.seek(start)
            lines = f.read().split(b"\n")
        if start > 0:
            lines = lines[1:]  # la prima è tagliata a metà
        for raw in reversed(lines):
            if b"compact_boundary" in raw or b"isCompactSummary" in raw:
                try:
                    o = json.loads(raw)
                except ValueError:
                    continue
                if o.get("subtype") == "compact_boundary" or o.get("isCompactSummary"):
                    return {"lastMs": ms(o.get("timestamp")), "compacted": True}
            if b'"assistant"' in raw and b'"usage"' in raw:
                try:
                    o = json.loads(raw)
                except ValueError:
                    continue
                if o.get("type") != "assistant" or o.get("isSidechain"):
                    continue
                u = (o.get("message") or {}).get("usage") or {}
                last = ms(o.get("timestamp"))
                if not u or last is None:
                    continue
                ctx = sum(int(u.get(k) or 0) for k in (
                    "input_tokens", "cache_read_input_tokens",
                    "cache_creation_input_tokens", "output_tokens"))
                return {"lastMs": last, "ctx": ctx}
        if start == 0:
            break
    return {}


def ms(ts):
    try:
        return int(datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def live():
    """Le voci interattive del registro il cui processo è ancora quello giusto."""
    for f in glob.glob(os.path.join(BASE, "sessions", "*.json")):
        try:
            with open(f) as fh:
                d = json.load(fh)
            pid = int(d["pid"])
            with open(f"/proc/{pid}/stat") as fh:
                started = fh.read().rsplit(")", 1)[1].split()[19]
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            continue
        if d.get("kind") == "interactive" and str(d.get("procStart")) == started:
            yield d


def herdr_agents():
    """Il binario di herdr e, per id di sessione, il pane e il titolo del terminale;
    ("", {}) se herdr non c'è o non risponde."""
    exe = os.environ.get("HERDR_BIN_PATH") or shutil.which("herdr") or ""
    if not exe:
        return "", {}
    try:
        out = subprocess.run([exe, "agent", "list"], capture_output=True, text=True, timeout=5)
        agents = json.loads(out.stdout)["result"]["agents"]
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return "", {}
    found = {}
    for a in agents if isinstance(agents, list) else []:
        sid = ((a or {}).get("agent_session") or {}).get("value")
        pane = a.get("pane_id")
        if isinstance(sid, str) and isinstance(pane, str):
            title = re.sub(r"[\x00-\x1f\x7f]", "", str(a.get("terminal_title_stripped") or ""))[:120]
            found[sid] = {"pane": pane, "title": title}
    return exe, found


def transcript(sid):
    found = glob.glob(os.path.join(BASE, "projects", "*", f"{sid}.jsonl"))
    return max(found, key=os.path.getmtime) if found else None


def collect():
    out = []
    exe, panes = herdr_agents()
    for d in live():
        sid = str(d.get("sessionId") or "")
        if not SID_RE.match(sid):
            continue
        s = {
            "id": sid,
            "name": str(d.get("name") or os.path.basename(str(d.get("cwd") or "")) or sid[:8]),
            "cwd": str(d.get("cwd") or ""),
            "status": str(d.get("status") or ""),
        }
        s.update(tail_state(transcript(sid)))
        s.update(panes.get(sid, {}))
        out.append(s)
    return {"at": int(time.time() * 1000), "base": BASE, "herdr": exe if panes else "", "sessions": out}


def main():
    fresh = "--fresh" in sys.argv[1:]
    if not fresh:
        try:
            if time.time() - os.path.getmtime(CACHE) < FRESH_S:
                with open(CACHE) as f:
                    cached = json.load(f)
                if cached.get("base") == BASE:
                    print(json.dumps(cached))
                    return
        except (OSError, ValueError):
            pass
    try:
        result = collect()
    except Exception as err:  # noqa: BLE001 - la sezione mostra l'errore, non deve cadere
        print(json.dumps({"at": int(time.time() * 1000), "sessions": [], "error": str(err)[:200]}))
        return
    text = json.dumps(result)
    try:
        tmp = f"{CACHE}.{os.getpid()}"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(text)
        os.replace(tmp, CACHE)
    except OSError:
        pass
    print(text)


if __name__ == "__main__":
    main()
