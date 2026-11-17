# Sample pack: raw piano recordings

This directory is the only source of recorded audio in this workspace. There is no internet here, so a
"recorded sample set" is built from these files or it is not recorded. Every candidate is given the same pack.

The recordings are **raw**: each file is byte-for-byte what its author published. Nothing has been trimmed,
levelled, re-encoded, mapped to keys, or chosen for you. Turning them into an instrument a browser can load —
which notes and dynamics to keep, where each sample starts and ends, how loud it is, what format and size it
ships in, how it maps across the keybed — is part of the work.

## What is here

| Directory | Source | Instrument | Recordings | Size | Format | License |
| --- | --- | --- | ---: | ---: | --- | --- |
| `grand/salamander-grand-v3/` | Salamander Grand Piano V3 | Yamaha C5 grand piano | 341 | 278.6 MB | FLAC, 48 kHz, 24-bit, stereo (two AKG C414 in AB, about 12 cm above the strings) | CC-BY-3.0 |
| `upright/upright-piano-kw/` | Upright Piano KW | Kawai upright piano, recorded in a living room | 66 | 31.3 MB | FLAC, 44.1 kHz, 24-bit, stereo (Zoom H1 at the player position) | CC0-1.0 |
| `electric/greg-sullivan-e-pianos/` | Greg Sullivan's E-Pianos | Wurlitzer EP200 (reed), Hohner Pianet T (reed), Yamaha CP80 (electric grand) | 172 | 20.5 MB | FLAC, 44.1 kHz, 16-bit, mono | CC-BY-3.0 |

579 recordings, 330.4 MB in all. `MANIFEST.json` lists every file with its size and sha256.

- **Grand** — `grand/salamander-grand-v3/Samples/`. Thirty notes in minor thirds from A0 to C8, each at six
  dynamics: `<note>v1` (softest), `v4`, `v7`, `v10`, `v13`, `v16` (loudest). Also `rel*` (the sound of a key being
  released, one per key), `harm*` (sympathetic string resonance), and `pedal*` (pedal noise). Upstream's own
  mapping is in `Salamander Grand Piano V3.sfz` and `Data/`; it describes all sixteen dynamics the original has,
  of which six are in this pack.
- **Upright** — `upright/upright-piano-kw/samples/`. `<note>vL` (soft) and `<note>vH` (loud); not every note has
  both. Upstream's mapping is in `UprightPianoKW-20220221.sfz`.
- **Electric** — `electric/greg-sullivan-e-pianos/`. Three instruments, each with its own `Samples/` and `.sfz`:
  `Wurlitzer EP200/` (reed electric piano; `pp`, `mp`, `f`, `ff`), `Pianet T/` (reed; `P`, `FF`, and key releases),
  and `CP80/` (electric grand; `PP`, `MP`, `F`, `FF`).

The upstream `README.md`, `LICENSE`, and `.sfz` files are included unchanged as documentation. The `.sfz` files
are text; read them for root notes and velocity ranges.

Tools for the work are installed: `ffmpeg`, `ffprobe`, and `sox`.

## What the seal checks

Bundle only what you need (a web instrument does not ship 330 MB), in whatever format you choose. Then declare
**every audio file you bundle** in `IMPLEMENTATION_DETAILS.json` under `audio.files`:

```json
{
  "audio": {
    "strategy": "…",
    "sampleSources": [ /* the entry for each source you used, copied from sample-sources.json */ ],
    "files": [
      { "path": "public/samples/grand/A4-v7.ogg", "origin": "pack",
        "packFile": "grand/salamander-grand-v3/Samples/A4v7.flac",
        "processing": "20 ms lead-in trimmed, 8 s, fade-out from 6 s, -3 dB, mono, Ogg Vorbis q5" },
      { "path": "public/ir/plate.wav", "origin": "generated",
        "description": "scripts/make-ir.mjs: exponentially decaying filtered noise" }
    ]
  }
}
```

- `path` is relative to `candidate/`. `packFile` is relative to this directory.
- `origin` is `"pack"` for anything cut from a recording here and `"generated"` for anything your own code produced
  (a synthesized tone, an impulse response, a noise burst). Never describe a generated file as a recording, or a
  recording as generated.
- The seal decodes each `"pack"` file and compares it with the recording it names. It matches when it is a **cut of
  that recording**: trimmed, faded, changed in level, mixed to mono or one channel, resampled, re-encoded. It does
  not match another note, another instrument, or a synthesized tone, and it does not match once pitch or timing has
  been changed. If you pitch-shift, time-stretch, or layer recordings into one file, add `"verifiable": false` and a
  `"reason"`; that is recorded and shown to the evaluator. Encode at 48 kbps or better: far below that, a lossy
  codec stops preserving the waveform and a true cut may fail to match.
- An audio file that is not declared fails the seal. So does a declared file that does not exist.
- For each source you used, copy its entry from `sample-sources.json` into `audio.sampleSources` unchanged. Two of
  the three sources are CC BY: the attribution in that entry is what their license requires, and your app should
  show it somewhere a user can find (an about or credits view is enough). `ATTRIBUTION.md` has the same lines.

## Licenses

See `LICENSES.md`. In short: the grand and the electric pianos are Creative Commons Attribution 3.0 (use and
adapt freely, credit the author); the upright is CC0 (public domain).
