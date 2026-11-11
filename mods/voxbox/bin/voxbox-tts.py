"""voxbox-tts: la voce di Voxbox, Piper tenuto carico finché serve.

Voxbox lo avvia la prima volta che si preme ▶ e gli parla con dei file nella
cartella `--dir`, perché il suo stdin è dato una volta sola all'avvio:

  job-<id>.json  {"id", "text", "speed"}: leggi questo testo. Un lavoro nuovo
                 interrompe quello in corso.
  stop           ferma la lettura in corso.

Su stdout scrive un evento JSON per riga: ready, start, done, stopped, error,
idle. Dopo `--idle` secondi senza lavoro esce da solo.

L'audio va a `voxbox-win.exe play`, lato Windows, in streaming: il primo pezzo
è corto (fino alla prima virgola o al primo punto) così la voce parte subito.
Fermare vuol dire chiudere il player: ha in coda l'audio già sintetizzato.
"""

import argparse
import ctypes
import glob
import json
import os
import re
import signal
import subprocess
import sys
import time

POLL = 0.05
PR_SET_PDEATHSIG = 1


def die_with_parent():
    """Se il processo che ci ha lanciato muore, moriamo anche noi."""
    try:
        ctypes.CDLL("libc.so.6", use_errno=True).prctl(PR_SET_PDEATHSIG, signal.SIGTERM)
    except OSError:
        pass


def emit(event, **fields):
    sys.stdout.write(json.dumps({"event": event, **fields}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def first_cut(text):
    """Il primo pezzo corto e il resto: la voce parte con poche parole."""
    m = re.match(r"^((?:\S+\s+){3,}?\S*?[,:;.?!])\s+(.*)$", text, re.S)
    return [m.group(1), m.group(2)] if m else [text]


class Runner:
    def __init__(self, voice, player, folder):
        from piper import PiperVoice, SynthesisConfig

        self.SynthesisConfig = SynthesisConfig
        self.voice = PiperVoice.load(voice)
        for _ in self.voice.synthesize("Pronto."):
            pass
        self.rate = self.voice.config.sample_rate
        self.player_path = player
        self.dir = folder
        self.player = None

    # ---- i file di comando ----

    def take_job(self):
        jobs = sorted(glob.glob(os.path.join(self.dir, "job-*.json")), key=os.path.getmtime)
        if not jobs:
            return None
        try:
            with open(jobs[-1], encoding="utf-8") as f:
                job = json.load(f)
        except (OSError, ValueError):
            return None  # scritto a metà: al prossimo giro
        for path in jobs:
            try:
                os.remove(path)
            except OSError:
                pass
        return job

    def take_stop(self):
        path = os.path.join(self.dir, "stop")
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
            return True
        return False

    def interrupted(self):
        """Uno stop o un lavoro nuovo: il secondo resta in cartella per il giro dopo."""
        return self.take_stop() or bool(glob.glob(os.path.join(self.dir, "job-*.json")))

    # ---- il player ----

    def open_player(self):
        self.player = subprocess.Popen(
            [self.player_path, "play", str(self.rate)],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            preexec_fn=die_with_parent,
        )

    def kill_player(self):
        if self.player and self.player.poll() is None:
            self.player.kill()
            self.player.wait()
        self.player = None

    # ---- una lettura ----

    def speak(self, job):
        jid = job.get("id", "")
        text = (job.get("text") or "").strip()
        speed = float(job.get("speed") or 1.0)
        if not text:
            emit("done", id=jid)
            return
        config = self.SynthesisConfig(length_scale=1.0 / max(0.5, min(2.0, speed)))
        self.open_player()  # parte mentre Piper sintetizza il primo pezzo
        emit("start", id=jid)
        try:
            for part in first_cut(text):
                for chunk in self.voice.synthesize(part, syn_config=config):
                    if self.interrupted():
                        self.kill_player()
                        emit("stopped", id=jid)
                        return
                    self.player.stdin.write(chunk.audio_int16_bytes)
                    self.player.stdin.flush()
            self.player.stdin.close()
            while self.player.poll() is None:
                if self.interrupted():
                    self.kill_player()
                    emit("stopped", id=jid)
                    return
                time.sleep(POLL)
            emit("done", id=jid)
        except (BrokenPipeError, OSError) as err:
            self.kill_player()
            emit("error", id=jid, message=f"player: {err}")
        finally:
            self.player = None

    def run(self, idle):
        emit("ready", rate=self.rate)
        last = time.time()
        while True:
            self.take_stop()  # uno stop senza lettura in corso non vale per dopo
            job = self.take_job()
            if job is not None:
                self.speak(job)
                last = time.time()
                continue
            if time.time() - last > idle:
                emit("idle")
                return
            time.sleep(POLL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True)
    ap.add_argument("--player", required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--idle", type=float, default=600)
    args = ap.parse_args()
    die_with_parent()
    os.makedirs(args.dir, exist_ok=True)
    for path in glob.glob(os.path.join(args.dir, "job-*.json")) + [os.path.join(args.dir, "stop")]:
        try:
            os.remove(path)
        except OSError:
            pass
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        Runner(args.voice, args.player, args.dir).run(args.idle)
    except Exception as err:  # noqa: BLE001 - lo dice a Voxbox, che lo mostra
        emit("error", message=str(err))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
