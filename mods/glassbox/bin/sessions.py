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

Per la vista GUARD di FILES, di ogni sessione esce anche quali file ha scritto
e quando: le risposte riuscite di Edit e Write nel transcript, subagent
compresi. I transcript arrivano a centinaia di mega, e si leggono una volta
sola: un indice (WRITES) tiene per ognuno fin dove è stato letto, e ai giri
dopo si leggono solo le righe aggiunte.

Di ogni sessione esce anche quanti agenti ha al lavoro (i suoi subagent non
ancora finiti che hanno scritto nelle ultime AGENTS_H ore: quelli più vecchi
sono rimasti appesi a una sessione chiusa o riavviata), e quando glassbox ne
ha tenuto calda la cache l'ultima volta mentre lavoravano: `--warm <id>` lo
segna in WARM, un file per sessione che leggono anche l'hook sessioni-fredde
e la status line.

Glassbox lo chiama ogni minuto in ogni sessione aperta: perché venti sessioni
non rifacciano lo stesso lavoro, il risultato resta in un file per FRESH_S
secondi e chi chiama in quel tempo rilegge quello; chi arriva mentre un'altra
lo sta rifacendo aspetta il suo turno (LOCK) e trova il risultato pronto.
--fresh lo rifà comunque.
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

try:
    import fcntl
except ImportError:  # fuori da Unix si lavora senza turni
    fcntl = None

FRESH_S = 45
BASE = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
TMP = os.environ.get("TMPDIR") or "/tmp"
CACHE = os.path.join(TMP, f"claude-glassbox-sessions-{os.getuid()}.json")
WRITES = os.path.join(TMP, f"claude-glassbox-writes-{os.getuid()}.json")
LOCK = os.path.join(TMP, f"claude-glassbox-sessions-{os.getuid()}.lock")
WARM = os.path.join(TMP, f"claude-glassbox-warm-{os.getuid()}")
AGENTS_H = 2
SID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
# Di ogni sessione escono al massimo tanti file scritti, dai più recenti, e
# solo quelli scritti negli ultimi WRITES_DAYS giorni.
MAX_WRITES = 300
WRITES_DAYS = 30
# La prima lettura di tutti i transcript può durare più di quanto glassbox
# aspetta lo script: oltre questi secondi ci si ferma, e il giro dopo riprende
# da dove si era arrivati.
SCAN_S = 6
DEADLINE = time.monotonic() + SCAN_S


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


def scan(path, entry):
    """`entry` ({'ino', 'off', 'writes'}) aggiornato con le righe che il transcript
    ha aggiunto da `off` in poi: per ogni file scritto, l'ora dell'ultima volta.
    Un transcript riscritto (un altro inode, o più corto) si rilegge da capo."""
    st = os.stat(path)
    if not isinstance(entry, dict) or entry.get("ino") != st.st_ino or st.st_size < entry.get("off", 0):
        entry = {"ino": st.st_ino, "off": 0, "writes": {}}
    writes, off = entry["writes"], entry["off"]
    if st.st_size == off:
        return entry
    with open(path, "rb") as f:
        f.seek(off)
        for raw in f:
            if not raw.endswith(b"\n") or time.monotonic() > DEADLINE:
                break  # l'ultima riga è ancora a metà, o il tempo è finito: si riprende al prossimo giro
            off += len(raw)
            # Solo le risposte di Edit e Write portano structuredPatch accanto a filePath.
            if b'"structuredPatch"' not in raw or b'"filePath"' not in raw:
                continue
            try:
                o = json.loads(raw)
            except ValueError:
                continue
            r = o.get("toolUseResult") if isinstance(o, dict) else None
            if not isinstance(r, dict) or "structuredPatch" not in r:
                continue
            p, t = r.get("filePath"), ms(o.get("timestamp"))
            if isinstance(p, str) and p.startswith("/") and len(p) <= 4096 and not re.search(r"[\x00-\x1f]", p) and t:
                if t > writes.get(p, 0):
                    writes[p] = t
    entry["off"] = off
    return entry


def load_index():
    try:
        with open(WRITES) as f:
            index = json.load(f)
        if index.get("base") == BASE and isinstance(index.get("files"), dict):
            return index["files"]
    except (OSError, ValueError, AttributeError):
        pass
    return {}


def save_index(files):
    try:
        tmp = f"{WRITES}.{os.getpid()}"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"base": BASE, "files": files}, f)
        os.replace(tmp, WRITES)
    except OSError:
        pass


def writes_of(sid, main, old, new):
    """I file che la sessione ha scritto, dal transcript principale e da quelli dei
    suoi subagent: [[percorso, ms], ...] dal più recente. `old` è l'indice letto,
    `new` quello che si salva, con i soli transcript delle sessioni aperte."""
    paths = [main] if main else []
    if main:
        paths += glob.glob(os.path.join(os.path.dirname(main), sid, "subagents", "*.jsonl"))
    merged = {}
    for p in paths:
        try:
            entry = scan(p, old.get(p))
        except OSError:
            continue
        new[p] = entry
        for f, t in entry["writes"].items():
            if t > merged.get(f, 0):
                merged[f] = t
    since = (time.time() - WRITES_DAYS * 86400) * 1000
    recent = sorted(((f, t) for f, t in merged.items() if t >= since), key=lambda x: -x[1])
    return [[f, t] for f, t in recent[:MAX_WRITES]]


def agents_of(sid, main, now):
    """Quanti agenti della sessione sono al lavoro: il meta.json accanto al loro
    transcript non dice ancora finished, e hanno scritto nelle ultime AGENTS_H ore."""
    if not main:
        return 0
    n = 0
    for meta in glob.glob(os.path.join(os.path.dirname(main), sid, "subagents", "*.meta.json")):
        try:
            with open(meta) as f:
                if json.load(f).get("finished") is True:
                    continue
            last = os.path.getmtime(meta)
            log = meta[: -len(".meta.json")] + ".jsonl"
            if os.path.exists(log):
                last = max(last, os.path.getmtime(log))
        except (OSError, ValueError, AttributeError):
            continue
        if now - last < AGENTS_H * 3600:
            n += 1
    return n


def warm_ms(sid):
    """L'ultima volta che glassbox ha tenuto calda la cache della sessione, o None."""
    try:
        return int(os.path.getmtime(os.path.join(WARM, sid)) * 1000)
    except OSError:
        return None


def mark_warm(sid):
    """Segna che la cache della sessione è stata rinfrescata adesso; toglie i segni di più di due giorni."""
    if not SID_RE.match(sid):
        raise SystemExit(2)
    os.makedirs(WARM, mode=0o700, exist_ok=True)
    now = time.time()
    for f in glob.glob(os.path.join(WARM, "*")):
        try:
            if now - os.path.getmtime(f) > 2 * 86400:
                os.remove(f)
        except OSError:
            pass
    fd = os.open(os.path.join(WARM, sid), os.O_WRONLY | os.O_CREAT, 0o600)
    os.close(fd)
    os.utime(os.path.join(WARM, sid), (now, now))


def collect():
    out = []
    exe, panes = herdr_agents()
    old, new = load_index(), {}
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
        main = transcript(sid)
        s.update(tail_state(main))
        s.update(panes.get(sid, {}))
        s["writes"] = writes_of(sid, main, old, new)
        s["agents"] = agents_of(sid, main, time.time())
        warm = warm_ms(sid)
        if warm:
            s["warmMs"] = warm
        out.append(s)
    save_index(new)
    return {"at": int(time.time() * 1000), "base": BASE, "herdr": exe if panes else "", "sessions": out}


def cached():
    """Il risultato condiviso, se è ancora fresco; None se no."""
    try:
        if time.time() - os.path.getmtime(CACHE) < FRESH_S:
            with open(CACHE) as f:
                found = json.load(f)
            if found.get("base") == BASE:
                return found
    except (OSError, ValueError, AttributeError):
        pass
    return None


def take_turn():
    """Aspetta che nessun'altra sessione stia rifacendo il risultato; il file
    aperto tiene il turno finché il processo non esce. None se non si può."""
    if fcntl is None:
        return None
    try:
        fd = os.open(LOCK, os.O_WRONLY | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        return fd
    except OSError:
        return None


def main():
    if sys.argv[1:2] == ["--warm"]:
        mark_warm(sys.argv[2] if len(sys.argv) > 2 else "")
        return
    fresh = "--fresh" in sys.argv[1:]
    found = None if fresh else cached()
    if found is None:
        take_turn()
        # Chi aveva il turno prima l'ha appena rifatto: basta rileggerlo.
        found = None if fresh else cached()
    if found is not None:
        print(json.dumps(found))
        return
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
