# Sample library pipeline

`public/samples/` holds the bundled, recorded, redistributable piano sample sets the instrument plays
(one directory per set with a `manifest.json` and mono 44.1 kHz Ogg Vorbis one-shots). The library is
committed so the instrument works offline; these scripts only document and reproduce how it was made.
Neither `pnpm build` nor `pnpm test` runs them.

```
scripts/samples/fetch.sh /path/to/sources     # downloads / partially clones the raw recordings (~1.2 GB)
python3 scripts/samples/build.py --sources /path/to/sources --out public/samples
```

Requirements: python3 with numpy, ffmpeg + ffprobe with libvorbis, git, curl.

## What build.py does

For every set (see `SETS` in `build.py`):

1. **Map** the source files to root notes and velocity layers — from the source SFZ where one exists
   (Upright Piano KW, Greg Sullivan's E-Pianos: `pitch_keycenter`, `lovel`/`hivel`, `tune`, `offset`, `end`,
   `volume`) or from the file names (Salamander, VCSL).
2. **Decode** each file with ffmpeg to mono float32 at 44.1 kHz, baking in the SFZ tune / offset / end /
   volume of that region.
3. **Trim**: onset at the first sample above 0.2 % of the peak (1 ms back-off, 1 ms fade-in); tail cut at
   the natural end (last sample above −60 dB relative to the peak, never below −72 dBFS) or at the per-root
   cap (root ≤ 47: 7 s, 48–71: 5 s, ≥ 72: 3.5 s), whichever is earlier, with a 0.4 s raised-cosine fade-out.
4. **Verify the pitch** of every file against its named root with a harmonic-comb score on a 0.5 s
   spectrum (named pitch, one octave down and one octave up, each searched ±0.7 semitones). A whole set
   that is consistently an octave off (VCSL's harpsichord and marimba use the C3 = 60 naming convention)
   has its roots corrected and says so in `manifest.json` → `notes`. Files whose fundamental is more than
   0.6 semitones away from any of these hypotheses are rejected and listed in the notes. Piano bass strings
   (below 65 Hz, weak inharmonic fundamentals) and the top octave (above 2 kHz) cannot be verified reliably
   and are kept as named.
5. **Normalise per set**: one gain for the whole set, chosen so the loudest layer's median 0.5 s RMS is
   −18 dBFS and no peak exceeds 0.95 (relative levels between layers and roots are preserved).
6. **Encode** with `libvorbis -q:a 3`, verify the encoded duration, and write `manifest.json`
   (source, licence, layers with velocity ranges, every file's root / layer / length / peak / RMS / source file).

Finally `index.json` (one row per set) is regenerated. `LICENSES.md` is maintained by hand and reproduces
the attribution each source requires.

## Manifest shape

```json
{
  "id": "grand-salamander", "type": "Grand", "model": "Salamander C5", "kind": "recorded",
  "source": { "name": "…", "author": "…", "url": "…", "license": "CC-BY-3.0", "licenseUrl": "…", "instrument": "…", "recording": "…", "files": "…" },
  "format": "ogg-vorbis", "sampleRate": 44100, "channels": 1,
  "layers": [ { "index": 0, "name": "v3", "lovel": 1, "hivel": 36, "velocity": 18 } ],
  "range": { "lowestRoot": 21, "highestRoot": 108 },
  "files": [ { "file": "021-l0.ogg", "root": 21, "layer": 0, "seconds": 7.0, "peak": 0.63, "rms": 0.09, "sourceFile": "A0v3.wav" } ],
  "processing": "…", "notes": ["…"]
}
```

Files are named `<root 3 digits>-l<layer>.ogg` and sorted by root then layer. A root that only exists in some
layers is normal: the player picks, for the velocity layer it needs, the nearest root that has that layer.
