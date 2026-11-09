#!/usr/bin/env python3
"""Il test di bin/sessions.py: python3 -I tests/sessions_helper_test.py

Un registro finto in una cartella temporanea, con processi `sleep` al posto
delle sessioni vive: tiene solo le interattive con il processo giusto, legge
dalla coda del transcript l'ultima risposta del thread principale (non quella
di un subagent), si accorge di una compattazione, e riusa il risultato
condiviso finché è fresco. Per GUARD: i file scritti da Edit e Write riusciti,
subagent compresi, letti una volta sola e poi solo nelle righe aggiunte.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "bin", "sessions.py")


def iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


def started(pid):
    with open(f"/proc/{pid}/stat") as f:
        return f.read().rsplit(")", 1)[1].split()[19]


def main():
    root = tempfile.mkdtemp(prefix="glassbox-sessions-")
    cfg, tmp = os.path.join(root, "cfg"), os.path.join(root, "tmp")
    os.makedirs(os.path.join(cfg, "projects", "p"))
    os.makedirs(os.path.join(cfg, "sessions"))
    os.makedirs(tmp)
    sleeps = [subprocess.Popen(["sleep", "120"]) for _ in range(4)]
    failures = []

    def check(label, cond, got=""):
        print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  -> {got}"))
        if not cond:
            failures.append(label)

    def register(pid, sid, kind="interactive", start=None, status="idle"):
        with open(os.path.join(cfg, "sessions", f"{pid}.json"), "w") as f:
            json.dump({"pid": pid, "sessionId": sid, "name": f"n-{sid}", "cwd": f"/w/{sid}", "kind": kind,
                       "status": status, "procStart": start or started(pid)}, f)

    def transcript(sid, lines):
        with open(os.path.join(cfg, "projects", "p", f"{sid}.jsonl"), "w") as f:
            for o in lines:
                f.write(json.dumps(o) + "\n")

    def append(path, lines, newline=True):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a") as f:
            f.write("\n".join(json.dumps(o) for o in lines) + ("\n" if newline else ""))

    def wrote(minutes_ago, path, kind="edit"):
        result = {"filePath": path, "structuredPatch": []}
        result.update({"oldString": "a", "newString": "b"} if kind == "edit" else {"type": "update", "content": "b"})
        return {"type": "user", "timestamp": iso(minutes_ago), "toolUseResult": result}

    def ago_ms(minutes_ago):
        return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).timestamp() * 1000

    def reply(minutes_ago, ctx, sidechain=False):
        return {"type": "assistant", "isSidechain": sidechain, "timestamp": iso(minutes_ago),
                "message": {"usage": {"input_tokens": 10, "cache_read_input_tokens": ctx - 20,
                                      "cache_creation_input_tokens": 5, "output_tokens": 5}}}

    # Un herdr finto: `agent list` con la sessione warm in un pane, il titolo
    # con un carattere di controllo, e un agente che il registro non ha.
    herdr = os.path.join(root, "herdr")
    agents = {"result": {"agents": [
        {"agent_session": {"value": "warm"}, "pane_id": "w1:p2", "terminal_title_stripped": "Lavoro\x1b[31m sporco"},
        {"agent_session": {"value": "altrove"}, "pane_id": "w5:p1", "terminal_title_stripped": "Altro"},
    ]}}
    with open(herdr, "w") as f:
        f.write("#!/bin/sh\n[ \"$1 $2\" = 'agent list' ] && cat <<'EOF'\n" + json.dumps(agents) + "\nEOF\n")
    os.chmod(herdr, 0o755)

    def run(*args, with_herdr=True):
        # PATH senza il herdr vero della macchina: parla solo quello finto.
        env = dict(os.environ, CLAUDE_CONFIG_DIR=cfg, TMPDIR=tmp, PATH="/usr/bin:/bin")
        env.pop("HERDR_BIN_PATH", None)
        if with_herdr:
            env["HERDR_BIN_PATH"] = herdr
        out = subprocess.run([sys.executable, "-I", SCRIPT, *args], capture_output=True, text=True, env=env, timeout=20)
        return json.loads(out.stdout)

    try:
        register(sleeps[0].pid, "warm", status="busy")
        transcript("warm", [reply(5, 300_000), reply(1, 999, sidechain=True),
                            {"type": "user", "message": {"content": "cita compact_boundary ma non lo è"}, "timestamp": iso(1)}])
        register(sleeps[1].pid, "compacted")
        transcript("compacted", [reply(90, 600_000), {"type": "system", "subtype": "compact_boundary", "timestamp": iso(80)}])
        register(sleeps[2].pid, "nodata")
        register(sleeps[2].pid + 0, "nodata")  # la stessa voce riscritta: una sola
        register(os.getpid(), "sdk", kind="sdk")
        register(999_999, "dead", start="1")
        with open(os.path.join(cfg, "sessions", "rotto.json"), "w") as f:
            f.write("{non json")

        out = run("--fresh")
        by = {s["id"]: s for s in out["sessions"]}
        check("solo le interattive vive", sorted(by) == ["compacted", "nodata", "warm"], sorted(by))
        w = by.get("warm", {})
        check("l'ultima risposta del thread principale, non del subagent", w.get("ctx") == 300_000 and w.get("status") == "busy", w)
        check("quando, in millisecondi", abs(w.get("lastMs", 0) - (datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp() * 1000) < 5_000, w)
        check("la compattazione dopo l'ultima risposta", by.get("compacted", {}).get("compacted") is True and "ctx" not in by.get("compacted", {}), by.get("compacted"))
        check("senza transcript: solo nome e stato", "lastMs" not in by.get("nodata", {}) and by.get("nodata", {}).get("name") == "n-nodata", by.get("nodata"))
        check("herdr: il pane e il titolo pulito", w.get("pane") == "w1:p2" and w.get("title") == "Lavoro[31m sporco" and out.get("herdr") == herdr, w)
        check("herdr: chi non è in un pane non ne ha", "pane" not in by.get("nodata", {}), by.get("nodata"))
        shared = os.path.join(tmp, f"claude-glassbox-sessions-{os.getuid()}.json")
        check("il risultato condiviso è privato", oct(os.stat(shared).st_mode & 0o777) == "0o600", oct(os.stat(shared).st_mode))

        # Fresco, il risultato condiviso si riusa; --fresh lo rifà.
        transcript("warm", [reply(0, 310_000)])
        check("entro 45 s si riusa", {s["id"]: s for s in run()["sessions"]}["warm"]["ctx"] == 300_000)
        check("--fresh rilegge", {s["id"]: s for s in run("--fresh")["sessions"]}["warm"]["ctx"] == 310_000)
        bare = run("--fresh", with_herdr=False)
        check("senza herdr: niente pane, e lo dice", bare.get("herdr") == "" and all("pane" not in s for s in bare["sessions"]), bare)

        # GUARD: i file scritti, dal transcript e dai subagent.
        main_t = os.path.join(cfg, "projects", "p", "writer.jsonl")
        register(sleeps[3].pid, "writer")
        append(main_t, [
            wrote(30, "/w/a.ts"),
            wrote(10, "/w/a.ts", kind="write"),
            # Un Edit fallito: la risposta è un testo, e il JSON citato non conta.
            {"type": "user", "timestamp": iso(5), "toolUseResult": "Error: String to replace not found",
             "message": {"content": [{"type": "tool_result", "is_error": True, "content": '{"filePath": "/w/no.ts", "structuredPatch": []}'}]}},
            # Una lettura porta filePath, ma non è una scrittura.
            {"type": "user", "timestamp": iso(4), "toolUseResult": {"type": "text", "file": {"filePath": "/w/letto.ts", "content": "x"}}},
            wrote(3, "relativo.ts"),
            wrote(40 * 24 * 60, "/w/vecchio.ts"),
        ])
        append(os.path.join(cfg, "projects", "p", "writer", "subagents", "agent-1.jsonl"), [wrote(2, "/w/sub.ts")])
        writes = {s["id"]: s for s in run("--fresh")["sessions"]}["writer"].get("writes", [])
        check("scritture: le riuscite, subagent compresi, dalla più recente",
              [w[0] for w in writes] == ["/w/sub.ts", "/w/a.ts"], writes)
        check("scritture: l'ora dell'ultima volta", len(writes) == 2 and abs(writes[1][1] - ago_ms(10)) < 5_000, writes)
        index = os.path.join(tmp, f"claude-glassbox-writes-{os.getuid()}.json")
        with open(index) as f:
            entry = json.load(f)["files"].get(main_t, {})
        check("l'indice è privato e sa fin dove ha letto",
              oct(os.stat(index).st_mode & 0o777) == "0o600" and entry.get("off") == os.path.getsize(main_t), entry.get("off"))

        # Le righe aggiunte si leggono al giro dopo; una a metà aspetta di essere finita.
        append(main_t, [wrote(1, "/w/b.ts")])
        append(main_t, [wrote(0, "/w/meta.ts")], newline=False)
        names = [w[0] for w in {s["id"]: s for s in run("--fresh")["sessions"]}["writer"]["writes"]]
        check("le righe nuove sì, quella a metà no", names[:1] == ["/w/b.ts"] and "/w/meta.ts" not in names, names)
        with open(main_t, "a") as f:
            f.write("\n")
        names = [w[0] for w in {s["id"]: s for s in run("--fresh")["sessions"]}["writer"]["writes"]]
        check("finita la riga, entra", names[:1] == ["/w/meta.ts"] and names.count("/w/a.ts") == 1, names)
    finally:
        for s in sleeps:
            s.kill()
        shutil.rmtree(root)
    print("TUTTI PASSATI" if not failures else f"FALLITI: {len(failures)}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
