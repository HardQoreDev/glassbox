// voxbox-win: il lato Windows di Voxbox, due comandi.
//
//   voxbox-win.exe play [frequenza]   suona PCM 16 bit mono letto da stdin, in
//                                      streaming (waveOut). Esce quando stdin si
//                                      chiude e la coda è finita; ucciderlo ferma
//                                      subito il suono.
//   voxbox-win.exe clip [secondi]     aspetta la PROSSIMA copia negli appunti
//                                      (quello che c'era prima non conta), scrive
//                                      il testo in UTF-8 su stdout ed esce 0.
//                                      Scaduto il tempo esce 2 senza scrivere nulla.
//   voxbox-win.exe clips [secondi]    come clip, ma resta in ascolto: ogni copia
//                                      nuova esce seguita da un byte NUL, finché
//                                      non lo si chiude (ARMA in concatena).
//
// Si compila con il csc.exe del .NET Framework presente in ogni Windows:
// bin/setup.sh lo fa da sé.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class VoxboxWin {
  [STAThread]
  static int Main(string[] args) {
    string cmd = args.Length > 0 ? args[0] : "";
    if (cmd == "play") return Play(args.Length > 1 ? int.Parse(args[1]) : 22050);
    if (cmd == "clip") return Clip(args.Length > 1 ? int.Parse(args[1]) : 60);
    if (cmd == "clips") return Clips(args.Length > 1 ? int.Parse(args[1]) : 3600);
    Console.Error.WriteLine("uso: voxbox-win.exe play [frequenza] | clip [secondi] | clips [secondi]");
    return 64;
  }

  // ---- appunti -------------------------------------------------------------

  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();

  static int Clip(int seconds) {
    uint start = GetClipboardSequenceNumber();
    DateTime end = DateTime.UtcNow.AddSeconds(seconds);
    while (DateTime.UtcNow < end) {
      Thread.Sleep(100);
      uint now = GetClipboardSequenceNumber();
      if (now == start) continue;
      string text = ReadText();
      // Una copia che non è testo (un'immagine) non chiude l'attesa.
      if (string.IsNullOrEmpty(text)) { start = now; continue; }
      byte[] bytes = Encoding.UTF8.GetBytes(text);
      using (Stream stdout = Console.OpenStandardOutput()) stdout.Write(bytes, 0, bytes.Length);
      return 0;
    }
    return 2;
  }

  // Come clip, ma resta in ascolto: ogni copia nuova esce su stdout seguita da
  // un byte NUL, finché chi l'ha lanciato non lo chiude (o al massimo `seconds`).
  // Così tra una copia e l'altra non c'è un buco in cui una copia si perde.
  static int Clips(int seconds) {
    uint last = GetClipboardSequenceNumber();
    DateTime end = DateTime.UtcNow.AddSeconds(seconds);
    using (Stream stdout = Console.OpenStandardOutput()) {
      while (DateTime.UtcNow < end) {
        Thread.Sleep(100);
        uint now = GetClipboardSequenceNumber();
        if (now == last) continue;
        last = now;
        string text = ReadText();
        if (string.IsNullOrEmpty(text)) continue;
        byte[] bytes = Encoding.UTF8.GetBytes(text.Replace("\0", ""));
        stdout.Write(bytes, 0, bytes.Length);
        stdout.WriteByte(0);
        stdout.Flush();
      }
    }
    return 2;
  }

  // Chi ha appena copiato può tenere gli appunti aperti per un attimo: si riprova.
  static string ReadText() {
    for (int i = 0; i < 10; i++) {
      try {
        return Clipboard.ContainsText() ? Clipboard.GetText(TextDataFormat.UnicodeText) : "";
      } catch (ExternalException) {
        Thread.Sleep(50);
      }
    }
    return "";
  }

  // ---- audio ---------------------------------------------------------------

  [StructLayout(LayoutKind.Sequential)]
  struct WaveFormat { public ushort Tag, Channels; public uint Rate, BytesPerSec; public ushort BlockAlign, Bits, Extra; }
  [StructLayout(LayoutKind.Sequential)]
  struct WaveHdr { public IntPtr Data; public uint Length, Recorded; public IntPtr User; public uint Flags, Loops; public IntPtr Next, Reserved; }

  [DllImport("winmm.dll")] static extern int waveOutOpen(out IntPtr h, int dev, ref WaveFormat f, IntPtr cb, IntPtr inst, int flags);
  [DllImport("winmm.dll")] static extern int waveOutPrepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveOutUnprepareHeader(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveOutWrite(IntPtr h, IntPtr hdr, int size);
  [DllImport("winmm.dll")] static extern int waveOutClose(IntPtr h);

  const uint DONE = 1;
  static readonly int HdrSize = Marshal.SizeOf(typeof(WaveHdr));
  static readonly int FlagsAt = (int)Marshal.OffsetOf(typeof(WaveHdr), "Flags");

  static int Play(int rate) {
    var fmt = new WaveFormat { Tag = 1, Channels = 1, Rate = (uint)rate, Bits = 16, BlockAlign = 2, BytesPerSec = (uint)rate * 2 };
    IntPtr dev;
    if (waveOutOpen(out dev, -1, ref fmt, IntPtr.Zero, IntPtr.Zero, 0) != 0) {
      Console.Error.WriteLine("voxbox-win: nessun dispositivo audio");
      return 1;
    }
    Stream input = Console.OpenStandardInput();
    var queue = new List<IntPtr[]>();
    byte[] buf = new byte[rate / 10 * 2];  // blocchi da 100 ms
    int n;
    while ((n = ReadFull(input, buf)) > 0) {
      n &= ~1;
      if (n == 0) break;
      IntPtr data = Marshal.AllocHGlobal(n);
      Marshal.Copy(buf, 0, data, n);
      IntPtr hdr = Marshal.AllocHGlobal(HdrSize);
      Marshal.StructureToPtr(new WaveHdr { Data = data, Length = (uint)n }, hdr, false);
      waveOutPrepareHeader(dev, hdr, HdrSize);
      waveOutWrite(dev, hdr, HdrSize);
      queue.Add(new[] { hdr, data });
      Release(dev, queue, false);
    }
    Release(dev, queue, true);
    waveOutClose(dev);
    return 0;
  }

  static int ReadFull(Stream s, byte[] b) {
    int got = 0, r;
    while (got < b.Length && (r = s.Read(b, got, b.Length - got)) > 0) got += r;
    return got;
  }

  static void Release(IntPtr dev, List<IntPtr[]> queue, bool wait) {
    while (queue.Count > 0) {
      IntPtr hdr = queue[0][0];
      if ((Marshal.ReadInt32(hdr, FlagsAt) & DONE) == 0) {
        if (!wait) return;
        Thread.Sleep(15);
        continue;
      }
      waveOutUnprepareHeader(dev, hdr, HdrSize);
      Marshal.FreeHGlobal(queue[0][1]);
      Marshal.FreeHGlobal(hdr);
      queue.RemoveAt(0);
    }
  }
}
