# Sample pack: raw piano, electric piano, and organ recordings

This directory is the only source of recorded audio in this workspace. There is no internet here, so a
"recorded sample set" is built from these files or it is not recorded. Every candidate is given the same pack.

The recordings are **raw**: each file is byte-for-byte what its author published. Nothing has been trimmed,
levelled, re-encoded, mapped to keys, or chosen for you. Turning them into an instrument a browser can load —
which notes and dynamics to keep, where each sample starts and ends, how loud it is, what format and size it
ships in, how it maps across the keybed — is part of the work.

## What is here

| Directory | Source | Instrument | Recordings | Size | Format | License |
| --- | --- | --- | ---: | ---: | --- | --- |
| `grand/salamander-grand-v3/` | Salamander Grand Piano V3 | Yamaha C5 grand piano | 401 | 357.2 MB | FLAC, 48 kHz, 24-bit, stereo (two AKG C414 in AB, about 12 cm above the strings) | CC-BY-3.0 |
| `upright/upright-piano-kw/` | Upright Piano KW | Kawai upright piano, recorded in a living room | 66 | 31.3 MB | FLAC, 44.1 kHz, 24-bit, stereo (Zoom H1 at the player position) | CC0-1.0 |
| `electric/greg-sullivan-e-pianos/` | Greg Sullivan's E-Pianos | Wurlitzer EP200 (reed), Hohner Pianet T (reed), Yamaha CP80 (electric grand) | 172 | 20.5 MB | FLAC, 44.1 kHz, 16-bit, mono | CC-BY-3.0 |
| `electric/learman-rhodes-gm/` | Rhodes Mark I, GM version (Discord SFZ GM Bank) | 1977 Rhodes Mark I Stage 73 (tine electric piano), recorded from the harp output | 15 | 5.9 MB | WAV, 44.1 kHz, 16-bit, mono; shortened and looped by the author | CC0-1.0 |
| `organ/vcsl-pipe-organ/` | VCSL Pipe Organ | Pipe organ, two registrations on the third manual | 42 | 86.2 MB | WAV, 44.1 kHz, 16-bit, stereo, about 12 s per note | CC0-1.0 |

696 recordings, 501.1 MB in all. `MANIFEST.json` lists every file with its size and sha256.

- **Grand** — `grand/salamander-grand-v3/Samples/`. Thirty notes in minor thirds from A0 to C8, each at eight
  dynamics: `<note>v1` (softest), `v2`, `v3`, `v4`, `v7`, `v10`, `v13`, `v16` (loudest). The soft end is sampled
  more closely because that is where the original's dynamics are furthest apart; with these eight, the largest step
  between neighbouring layers is under 5 dB. Also `rel*` (the sound of a key being released, one per key), `harm*`
  (sympathetic string resonance), and `pedal*` (pedal noise). Upstream's own mapping is in
  `Salamander Grand Piano V3.sfz` and `Data/`; it describes all sixteen dynamics the original has, of which eight
  are in this pack.
- **Upright** — `upright/upright-piano-kw/samples/`. `<note>vL` (soft) and `<note>vH` (loud); not every note has
  both. Upstream's mapping is in `UprightPianoKW-20220221.sfz`.
- **Electric, reed and electric grand** — `electric/greg-sullivan-e-pianos/`. Three instruments, each with its
  own `Samples/` and `.sfz`: `Wurlitzer EP200/` (reed electric piano; `pp`, `mp`, `f`, `ff`), `Pianet T/` (reed;
  `P`, `FF`, and key releases), and `CP80/` (electric grand; `PP`, `MP`, `F`, `FF`).
- **Electric, tine** — `electric/learman-rhodes-gm/Discord GM/Melodic/005-Electric Piano 1/`. A Rhodes Mark I
  Stage 73, recorded by its owner straight from the harp (with EQ: a treble boost and a low-mid scoop), cut down
  by him for a General MIDI bank. Fifteen roots from F1 to C7; the number in each file name is the MIDI note
  (`A_050__D3_3.wav` is note 50, D3). One dynamic per note, so velocity has to come from somewhere else (gain,
  filtering). Each sample was shortened and given a sustain loop by the author: the loop points are in the file's
  `smpl` chunk, and the mapping is in `005-Electric Piano 1.sfz` beside the folder.
- **Organ** — `organ/vcsl-pipe-organ/Aerophones/Edge-blown Aerophones/Pipe Organ/`. A pipe organ with two
  registrations of its third manual, each 21 notes in minor thirds from C1 to C6:
  `Loud/Rode_Man3Open_<note>.wav` and `Quiet/NT5_Man3Quiet_<note>_rr1.wav`. Each note is held for about ten
  seconds and then released, so the attack, the steady tone, and the room's decay are all in the recording. There is no upstream mapping; `Info.txt` names
  who recorded it.

The upstream `README.md`, `LICENSE`, `Info.txt`, and `.sfz` files are included unchanged as documentation. The
`.sfz` files are text; read them for root notes and velocity ranges.

The organ is a real recorded organ, offered as an option: the Phase 3 organ engine may be built from these
recordings, from your own synthesis, or from both. There are no tonewheel (Hammond-style) or combo organ
recordings in the pack, so B3, Vox, and Farfisa sounds are yours to synthesize; the pipe organ fits the Pipe
models. There are no synthesizer recordings either.

Tools for the work are installed: `ffmpeg`, `ffprobe`, and `sox`.

## What the seal checks

Bundle only what you need (a web instrument does not ship 500 MB), in whatever format you choose. Then declare
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
  been changed. If you pitch-shift, time-stretch, loop, or layer recordings into one file, add `"verifiable": false`
  and a `"reason"`; that is recorded and shown to the evaluator. Encode at 48 kbps or better: far below that, a lossy
  codec stops preserving the waveform and a true cut may fail to match.
- An audio file that is not declared fails the seal. So does a declared file that does not exist.
- For each source you used, copy its entry from `sample-sources.json` into `audio.sampleSources` unchanged. Two of
  the five sources are CC BY: the attribution in that entry is what their license requires, and your app should
  show it somewhere a user can find (an about or credits view is enough). The CC0 sources need no credit, but
  giving it is good practice. `ATTRIBUTION.md` has the same lines.

## Licenses

See `LICENSES.md`. In short: the grand and Greg Sullivan's electric pianos are Creative Commons Attribution 3.0
(use and adapt freely, credit the author); the upright, the Rhodes, and the organ are CC0 (public domain).
