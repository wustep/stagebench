#!/usr/bin/env python3
"""
Builds the bundled piano sample library (public/samples/<set-id>/) from the raw, redistributable source
recordings fetched by fetch.sh. Nothing in `pnpm build` or `pnpm test` runs this script; the encoded
library is committed so the instrument works offline.

Per file: decode with ffmpeg to mono float32 44.1 kHz (applying the source mapping's tune / offset / end /
volume), trim the onset (first sample above 0.2 % of the peak, 1 ms back-off and fade-in), cut the tail at
the natural end (last sample 60 dB below the peak, never below -72 dBFS) or at the per-root cap (<=47: 7 s, 48-71: 5 s, >=72: 3.5 s) with a
0.4 s raised-cosine fade-out, verify the fundamental against the named root with a harmonic-comb spectral check (octave hypotheses included), apply one gain
per set (loudest layer's median 0.5 s RMS -> -18 dBFS, reduced so no peak exceeds 0.95) and encode with
libvorbis -q 3. Writes manifest.json per set, index.json and LICENSES.md.

Usage: build.py --sources <dir> --out <candidate>/public/samples [--sets a,b,c] [--quality 3] [--jobs 6]
Requires: python3 + numpy, ffmpeg/ffprobe with libvorbis.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import math
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SR = 44100
NOTE_INDEX = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
VCSL_SPLITS = {1: [(1, 127)], 2: [(1, 64), (65, 127)], 3: [(1, 42), (43, 84), (85, 127)], 4: [(1, 32), (33, 64), (65, 96), (97, 127)]}


def note_to_midi(name: str, c4: int = 60) -> int:
    """Scientific pitch name (C4 = 60 by default, sharps with '#', flats with 'b') -> MIDI."""
    m = re.fullmatch(r"([A-Ga-g])([#b]?)(-?\d+)", name.strip())
    if not m:
        raise ValueError(f"bad note name {name!r}")
    pc = NOTE_INDEX[m.group(1).upper()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return (int(m.group(3)) + 1) * 12 + pc + (c4 - 60)


def midi_to_hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


@dataclass
class Item:
    path: Path
    root: int
    layer: int
    source_file: str
    tune_cents: float = 0.0
    offset: int = 0  # start offset in source frames
    end: int | None = None  # end frame in source frames
    volume_db: float = 0.0


@dataclass
class Layer:
    index: int
    name: str
    lovel: int
    hivel: int

    @property
    def velocity(self) -> int:
        return (self.lovel + self.hivel) // 2


@dataclass
class SetDef:
    id: str
    type: str
    model: str
    source: dict
    layers: list[Layer]
    adapter: object  # callable(sources: Path) -> list[Item] | raises FileNotFoundError
    notes: list[str] = field(default_factory=list)
    license_text: str = ""


# ------------------------------------------------------------------------------------------ adapters

def sfz_regions(sfz_path: Path) -> list[dict]:
    """Minimal SFZ parser: returns one dict per <region> with inherited <global>/<group> opcodes."""
    text = sfz_path.read_text(encoding="utf-8", errors="replace")
    defines: dict[str, str] = {}
    for m in re.finditer(r"#define\s+(\$\w+)\s+(\S+)", text):
        defines[m.group(1)] = m.group(2)
    text = re.sub(r"//[^\n]*", "", text)
    for k, v in defines.items():
        text = text.replace(k, v)
    scope = {"global": {}, "group": {}}
    regions: list[dict] = []
    control: dict = {}
    for header, body in re.findall(r"<(\w+)>([^<]*)", text):
        ops = dict(re.findall(r"(\w+)=(\S+)", body))
        if header == "control":
            control.update(ops)
        elif header == "global":
            scope["global"] = ops
            scope["group"] = {}
        elif header == "group":
            scope["group"] = ops
        elif header == "region":
            merged = {**scope["global"], **scope["group"], **ops}
            merged["_default_path"] = control.get("default_path", "")
            regions.append(merged)
    return regions


def sfz_layers(regions: list[dict]) -> list[Layer]:
    bands = sorted({(int(r.get("lovel", 1)), int(r.get("hivel", 127)), r.get("group_label", "")) for r in regions if "pitch_keycenter" in r or "key" in r})
    return [Layer(i, b[2] or f"v{i}", b[0], b[1]) for i, b in enumerate(bands)]


def sfz_items(base: Path, sfz_name: str, skip=lambda r: False) -> tuple[list[Item], list[Layer]]:
    regions = [r for r in sfz_regions(base / sfz_name) if not skip(r)]
    regions = [r for r in regions if ("pitch_keycenter" in r or "key" in r) and r.get("pitch_keytrack", "100") != "0"]
    layers = sfz_layers(regions)
    band_index = {(l.lovel, l.hivel): l.index for l in layers}
    items: dict[tuple, Item] = {}
    for r in regions:
        root = int(r.get("pitch_keycenter", r.get("key")))
        layer = band_index[(int(r.get("lovel", 1)), int(r.get("hivel", 127)))]
        rel = r["_default_path"] + r["sample"]
        path = base / rel.replace("\\", "/")
        key = (path.name, root, layer)
        if key in items:
            continue
        items[key] = Item(path=path, root=root, layer=layer, source_file=rel, tune_cents=float(r.get("tune", 0)), offset=int(r.get("offset", 0)), end=int(r["end"]) if "end" in r else None, volume_db=float(r.get("volume", 0)))
    return list(items.values()), layers


def salamander_adapter(sources: Path) -> list[Item]:
    base = sources / "salamander"
    files = list(base.rglob("*.wav"))
    if not files:
        raise FileNotFoundError("salamander/*.wav (extract v3/v7/v11/v15 from SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz)")
    layer_of = {"3": 0, "7": 1, "11": 2, "15": 3}
    items = []
    for f in files:
        m = re.fullmatch(r"([A-G]#?\d)v(\d+)\.wav", f.name)
        if not m or m.group(2) not in layer_of:
            continue
        items.append(Item(path=f, root=note_to_midi(m.group(1)), layer=layer_of[m.group(2)], source_file=f.name))
    if not items:
        raise FileNotFoundError("no Salamander v3/v7/v11/v15 wav files found")
    return items


def upright_kw_adapter(sources: Path) -> list[Item]:
    base = sources / "upright-piano-KW"
    sfz = next(iter(base.glob("UprightPianoKW-*.sfz")), None)
    if not sfz:
        raise FileNotFoundError("upright-piano-KW/UprightPianoKW-*.sfz (clone https://github.com/freepats/upright-piano-KW)")
    items, layers = sfz_items(base, sfz.name)
    # The SFZ carries the velocity split (vL: 1-80, vH: 81-127); keep every root (minor thirds plus the vH-only B roots).
    return items


def greg_sullivan_adapter(folder: str, sfz: str, skip=lambda r: False):
    def adapter(sources: Path) -> list[Item]:
        base = sources / "GregSullivan.E-Pianos" / folder
        if not (base / sfz).exists():
            raise FileNotFoundError(f"GregSullivan.E-Pianos/{folder}/{sfz} (clone https://github.com/sfzinstruments/GregSullivan.E-Pianos)")
        items, _ = sfz_items(base, sfz, skip)
        return items
    return adapter


def vcsl_adapter(rel_dir: str, name_re: str, c4: int = 60, sub: str | None = None, vl_names: dict[str, int] | None = None):
    pattern = re.compile(name_re)

    def adapter(sources: Path) -> list[Item]:
        base = sources / "VCSL" / rel_dir
        if sub:
            base = base / sub
        files = sorted(base.rglob("*.wav")) if base.exists() else []
        if not files:
            raise FileNotFoundError(f"VCSL/{rel_dir} (sparse-checkout from https://github.com/sgossner/VCSL)")
        picked: dict[tuple[int, int], tuple[int, Item]] = {}
        for f in files:
            m = pattern.search(f.name)
            if not m:
                continue
            g = m.groupdict()
            rr = int(g["rr"]) if g.get("rr") else 1
            vl = g.get("vl")
            layer = (vl_names[vl] if vl_names else int(vl) - 1) if vl else 0
            root = note_to_midi(g["note"], c4)
            item = Item(path=f, root=root, layer=layer, source_file=str(f.relative_to(sources / "VCSL")).replace("\\", "/"))
            key = (root, layer)
            if key not in picked or rr < picked[key][0]:
                picked[key] = (rr, item)  # first round robin per root / layer
        items = [v[1] for v in picked.values()]
        if not items:
            raise FileNotFoundError(f"no files matched {name_re} under VCSL/{rel_dir}")
        return items
    return adapter


def sfz_layers_for(folder: str, sfz: str, skip=lambda r: False):
    def fn(sources: Path) -> list[Layer]:
        base = sources / "GregSullivan.E-Pianos" / folder
        _, layers = sfz_items(base, sfz, skip)
        return layers
    return fn


# ------------------------------------------------------------------------------------------ DSP helpers

def ffprobe_rate(path: Path) -> int:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True).stdout.strip()
    return int(out.splitlines()[0])


def decode(item: Item) -> np.ndarray:
    """ffmpeg -> mono float32 at SR, with the mapping's offset/end (source frames), tune (cents) and volume (dB)."""
    src_rate = ffprobe_rate(item.path)
    filters = []
    if item.offset or item.end is not None:
        trim = f"atrim=start_sample={item.offset}"
        if item.end is not None:
            trim += f":end_sample={item.end}"
        filters.append(trim)
    if item.tune_cents:
        filters.append(f"asetrate={src_rate * 2 ** (item.tune_cents / 1200):.6f}")
    filters.append(f"aresample={SR}")
    if item.volume_db:
        filters.append(f"volume={item.volume_db}dB")
    cmd = ["ffmpeg", "-v", "error", "-i", str(item.path), "-af", ",".join(filters), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float32)


def tail_cap_seconds(root: int) -> float:
    return 7.0 if root <= 47 else 5.0 if root <= 71 else 3.5


def trim(x: np.ndarray, root: int) -> np.ndarray:
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak <= 0:
        return x[:0]
    thr = max(1e-4, 0.002 * peak)
    idx = np.flatnonzero(np.abs(x) > thr)
    start = max(0, int(idx[0]) - int(0.001 * SR))
    # Natural end: last sample above -60 dB relative to the file's own peak (never below -72 dBFS), so quiet
    # recordings keep their decay and loud ones do not drag a noise floor along.
    floor = max(peak * 10 ** (-60 / 20), 10 ** (-72 / 20))
    above = np.flatnonzero(np.abs(x) > floor)
    natural_end = int(above[-1]) + 1 if above.size else x.size
    cap_end = start + int(tail_cap_seconds(root) * SR)
    end = min(natural_end, cap_end, x.size)
    y = x[start:end].copy()
    fade_in = max(1, int(0.001 * SR))
    y[:fade_in] *= np.linspace(0, 1, fade_in, endpoint=False, dtype=np.float32)
    fade = min(int(0.4 * SR), max(1, int(0.3 * y.size)))
    if fade > 0 and y.size > fade:
        w = 0.5 * (1 + np.cos(np.linspace(0, math.pi, fade, dtype=np.float32)))
        y[-fade:] *= w
    return y


def verify_pitch(x: np.ndarray, expected_hz: float) -> tuple[float | None, int]:
    """
    Checks the recording against its named pitch with a harmonic-comb score on a high-resolution spectrum of the
    0.02-0.52 s window after the onset. Three hypotheses are scored (named pitch, one octave down, one octave up),
    each with a fine search of +/-0.7 semitones in 2-cent steps; the score is the mean prominence (dB above the
    local median floor) of the first harmonics measured in narrow windows, so it peaks sharply at the true pitch.
    A winning hypothesis is demoted by an octave when the odd harmonics of half its frequency are present too.
    Returns (deviation in semitones from the named pitch, number of prominent harmonics among the first four,
    prominence of the fundamental in dB) or (None, 0, 0) when the window is too short.
    """
    start = int(0.02 * SR)
    win = min(x.size - start, int(0.5 * SR))
    if win < int(0.04 * SR):
        return None, 0, 0.0
    seg = x[start : start + win].astype(np.float64)
    seg -= seg.mean()
    if not np.any(seg):
        return None, 0, 0.0
    seg *= np.hanning(seg.size)
    n = 1 << 18
    mag = 20 * np.log10(np.abs(np.fft.rfft(seg, n)) + 1e-9)
    bin_hz = SR / n
    nyq_bin = mag.size - 1
    kmax = 8 if expected_hz < 1000 else 4 if expected_hz < 2500 else 2

    def prominence(fk: float, k: int) -> float | None:
        if fk * 1.05 > SR * 0.47:
            return None
        tol = 0.006 + 0.0015 * k  # narrow: the Hann lobe sets the effective width; grows with inharmonicity
        lo = int(fk * (1 - tol) / bin_hz)
        hi = int(fk * (1 + tol) / bin_hz) + 2
        wlo = int(fk * 2 ** (-3 / 12) / bin_hz)
        whi = min(nyq_bin, int(fk * 2 ** (3 / 12) / bin_hz) + 1)
        if hi >= nyq_bin or whi - wlo < 8:
            return None
        peak = float(mag[lo:hi].max())
        # Noise reference: the median of the wide window plus the expected excess of the maximum of (hi - lo)
        # noise bins over that median, so a narrow window of pure noise scores ~0 dB.
        floor = float(np.median(mag[wlo:whi])) + 10 * math.log10(max(1.5, math.log(hi - lo) / math.log(2))) + 3
        return min(60.0, max(0.0, peak - floor))

    def score(f: float) -> tuple[float, int, float]:
        """1/k-weighted mean prominence: a hypothesis whose low partials are missing (an octave too low) loses.
        Returns (score, prominent harmonics among the first four, prominence of the fundamental)."""
        total = 0.0
        weight = 0.0
        prominent = 0
        fundamental = 0.0
        for k in range(1, kmax + 1):
            prom = prominence(k * f, k)
            if prom is None:
                break
            total += prom / k
            weight += 1 / k
            if k == 1:
                fundamental = prom
            if k <= 4 and prom >= 8:
                prominent += 1
        return (total / weight if weight else 0.0), prominent, fundamental

    best = (-1.0, 0.0, 0, 0.0)
    for hyp in (0, -12, 12):
        for cents in range(-70, 71, 2):
            dev = hyp + cents / 100
            sc, prom, fund = score(expected_hz * 2 ** (dev / 12))
            if sc > best[0]:
                best = (sc, dev, prom, fund)
    _, dev, prominent, fundamental = best
    # A strong peak at the named pitch with nothing at half of it is decisive: keep the named pitch when an
    # octave hypothesis won on partial alignment alone.
    if abs(dev) > 6:
        named = max((score(expected_hz * 2 ** (c / 1200)) + (c / 100,) for c in range(-70, 71, 2)), key=lambda t: t[0])
        if named[2] >= 25 and fundamental < named[2] - 25:
            dev, prominent, fundamental = named[3], named[1], named[2]
    # Sub-harmonic test: if the odd partials of half the winning frequency are present too, the fundamental is an
    # octave lower (a weak fundamental made the octave-up hypothesis win).
    f = expected_hz * 2 ** (dev / 12)
    if dev > -11.5:
        odd = [prominence(f * m, 1) for m in (0.5, 1.5, 2.5)]
        odd = [o for o in odd if o is not None]
        threshold = max(8.0, fundamental - 30)  # sub-harmonics 30 dB below the winner are crosstalk, not the pitch
        if len(odd) >= 2 and sum(1 for o in odd if o >= threshold) >= 2:
            # Real notes have no energy at half their fundamental and its odd multiples; these peaks mean the
            # true fundamental is an octave lower and merely weak (typical for piano strings).
            lower_dev = dev - 12
            _, prom, fund = score(expected_hz * 2 ** (lower_dev / 12))
            if prom >= 2:
                dev, prominent, fundamental = lower_dev, prom, fund
    return dev, prominent, fundamental


def encode(y: np.ndarray, out: Path, quality: int) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "libvorbis", "-q:a", str(quality), str(out)], input=y.astype(np.float32).tobytes(), check=True)


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


# ------------------------------------------------------------------------------------------ set definitions

CC_BY_3 = ("CC-BY-3.0", "http://creativecommons.org/licenses/by/3.0/")
CC0 = ("CC0-1.0", "http://creativecommons.org/publicdomain/zero/1.0/")

GS_SOURCE = {
    "name": "Greg Sullivan's E-Pianos (sfz mapping by kinwie, sfzinstruments)",
    "author": "Greg Sullivan",
    "url": "https://github.com/sfzinstruments/GregSullivan.E-Pianos",
    "license": CC_BY_3[0],
    "licenseUrl": CC_BY_3[1],
}


def vcsl_source(instrument: str, recording: str, files: str) -> dict:
    return {
        "name": "Versilian Community Sample Library (VCSL)",
        "author": "Versilian Studios LLC (Samuel Gossner) and contributors",
        "url": "https://github.com/sgossner/VCSL",
        "license": CC0[0],
        "licenseUrl": CC0[1],
        "instrument": instrument,
        "recording": recording,
        "files": files,
    }


SETS: list[SetDef] = [
    SetDef(
        id="grand-salamander", type="Grand", model="Salamander C5",
        source={
            "name": "Salamander Grand Piano V3", "author": "Alexander Holm",
            "url": "https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html", "license": CC_BY_3[0], "licenseUrl": CC_BY_3[1],
            "instrument": "Yamaha C5 grand piano",
            "recording": "two AKG C414 in AB ~12 cm above the strings, 48 kHz/24-bit, 16 velocity layers, sampled in minor thirds from A0",
            "files": "SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz",
        },
        layers=[Layer(0, "v3", 1, 36), Layer(1, "v7", 37, 68), Layer(2, "v11", 69, 100), Layer(3, "v15", 101, 127)],
        adapter=salamander_adapter,
        notes=["Four of the sixteen recorded velocity layers are bundled (v3, v7, v11, v15); release, pedal and string-resonance samples are not.", "Stereo source down-mixed to mono."],
    ),
    SetDef(
        id="upright-kw", type="Upright", model="Kawai Upright KW",
        source={
            "name": "Upright Piano KW", "author": "Gonzalo and Roberto (FreePats project)",
            "url": "https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW", "license": CC0[0], "licenseUrl": CC0[1],
            "instrument": "Kawai upright piano in a living room",
            "recording": "Zoom H1 portable recorder at the player's head position, January 2017, two velocity layers, minor thirds (plus B roots in the loud layer)",
            "files": "https://github.com/freepats/upright-piano-KW (samples/*.flac, UprightPianoKW-20220221.sfz)",
        },
        layers=[Layer(0, "vL", 1, 80), Layer(1, "vH", 81, 127)],
        adapter=upright_kw_adapter,
        notes=["Velocity split taken from the source SFZ (vL up to 80, vH from 81). Roots with a single recorded layer keep that file only.", "Stereo source down-mixed to mono; the source's bass-note loops are not used (one-shots, capped)."],
    ),
    SetDef(
        id="electric-wurlitzer-200", type="Electric", model="Wurlitzer EP200",
        source={**GS_SOURCE, "instrument": "Wurlitzer EP200 reed electric piano (v1.1, 16 May 1999)", "recording": "direct recording by Greg Sullivan, four velocity layers (pp/mp/f/ff), roots as mapped in the SFZ", "files": "Wurlitzer EP200/Samples/*.flac, Wurlitzer EP200/Wurlitzer EP200.sfz"},
        layers=[], adapter=greg_sullivan_adapter("Wurlitzer EP200", "Wurlitzer EP200.sfz"),
        notes=["Per-region tune (cents) and volume (dB) from the source SFZ are baked in; a sample the SFZ reuses for several velocity bands is bundled once per band."],
    ),
    SetDef(
        id="electric-pianet-t", type="Electric", model="Hohner Pianet T",
        source={**GS_SOURCE, "instrument": "Hohner Pianet T (type 2) reed electric piano (v1.3, 24 Sep 2004)", "recording": "direct recording by Greg Sullivan, two velocity layers (P/FF); release samples not used", "files": "Pianet T/Samples/*.flac, Pianet T/Pianet T.sfz"},
        layers=[], adapter=greg_sullivan_adapter("Pianet T", "Pianet T.sfz", skip=lambda r: r.get("group_label") == "release" or "release" in r.get("sample", "")),
        notes=["Per-region tune / offset from the source SFZ are baked in."],
    ),
    SetDef(
        id="electric-cp80", type="Electric", model="Yamaha CP80",
        source={**GS_SOURCE, "instrument": "Yamaha CP80 electric grand piano (v1.3, 29 Sep 2004)", "recording": "direct recording by Greg Sullivan, four velocity layers (PP/MP/F/FF)", "files": "CP80/Samples/*.flac, CP80/CP80.sfz"},
        layers=[], adapter=greg_sullivan_adapter("CP80", "CP80.sfz"),
        notes=["Per-region volume / end from the source SFZ are baked in."],
    ),
    SetDef(
        id="digital-tx81z-fm", type="Digital", model="TX81Z FM Piano",
        source=vcsl_source("Yamaha TX81Z FM synthesizer, 'FM Piano' patch (a recorded digital piano sound)", "line recording of the hardware synth, three velocity layers, roots every major third (C, E, G#)", "Electrophones/TX81Z/FM Piano/*.wav"),
        layers=[], adapter=vcsl_adapter("Electrophones/TX81Z/FM Piano", r"_(?P<note>[A-G]#?-?\d)_vl(?P<vl>\d)"),
        notes=["Velocity split 1-42 / 43-84 / 85-127 assigned here (VCSL ships raw wav files without a mapping)."],
    ),
    SetDef(
        id="clav-harpsichord", type="Clav", model="Flemish Harpsichord",
        source=vcsl_source("Flemish-style harpsichord (Rudolph Hoffman collection recording, 'HarpsiRH'), lower register", "far stereo pair, VCSL; single dynamic (plucked instrument), one root every two to three semitones", "Chordophones/Zithers/Harpsichord, Flemish/Sustains/Low/*.wav"),
        layers=[Layer(0, "pluck", 1, 127)], adapter=vcsl_adapter("Chordophones/Zithers/Harpsichord, Flemish", r"_(?P<note>[A-G]#?-?\d)_rr(?P<rr>\d)", sub="Sustains/Low"),
        notes=["Sustain articulation of the lower register, first round robin per note; a harpsichord has no velocity layers, so one layer covers 1-127."],
    ),
    SetDef(
        id="misc-marimba", type="Misc", model="Marimba",
        source=vcsl_source("Concert marimba", "close stereo recording, VCSL, several velocity layers", "Idiophones/Struck Idiophones/Marimba/**/*.wav"),
        layers=[], adapter=vcsl_adapter("Idiophones/Struck Idiophones/Marimba", r"_(?P<note>[A-G]#?-?\d)_(?P<vl>soft|med|loud)_(?P<rr>\d+)", vl_names={"soft": 0, "med": 1, "loud": 2}),
        notes=["Outrigger mic position, soft / med / loud strokes as layers 0-2 (split 1-42 / 43-84 / 85-127 assigned here), first round robin only."],
    ),
]

# Sets whose adapters read the SFZ velocity bands at build time.
SFZ_LAYERS = {
    "upright-kw": lambda sources: sfz_items(sources / "upright-piano-KW", next(iter((sources / "upright-piano-KW").glob("UprightPianoKW-*.sfz"))).name)[1],
    "electric-wurlitzer-200": sfz_layers_for("Wurlitzer EP200", "Wurlitzer EP200.sfz"),
    "electric-pianet-t": sfz_layers_for("Pianet T", "Pianet T.sfz", skip=lambda r: r.get("group_label") == "release" or "release" in r.get("sample", "")),
    "electric-cp80": sfz_layers_for("CP80", "CP80.sfz"),
}


# ------------------------------------------------------------------------------------------ build

@dataclass
class Processed:
    item: Item
    data: np.ndarray
    f0: float | None
    deviation: float | None  # semitones vs named root
    prominent: int = 0  # prominent harmonics among the first four at the best-matching pitch
    fundamental: float = 0.0  # prominence (dB) of the fundamental at the best-matching pitch


def process_item(item: Item) -> Processed:
    x = decode(item)
    y = trim(x, item.root)
    dev, prominent, fundamental = verify_pitch(y, midi_to_hz(item.root)) if y.size else (None, 0, 0.0)
    f0 = midi_to_hz(item.root) * 2 ** (dev / 12) if dev is not None else None
    return Processed(item, y, f0, dev, prominent, fundamental)


def build_set(sd: SetDef, sources: Path, out_root: Path, quality: int, jobs: int, log) -> dict | None:
    try:
        items = sd.adapter(sources)
    except FileNotFoundError as e:
        log(f"[{sd.id}] skipped: missing sources: {e}")
        return None
    layers = sd.layers or (SFZ_LAYERS[sd.id](sources) if sd.id in SFZ_LAYERS else None)
    if layers is None:
        n = max(i.layer for i in items) + 1
        layers = [Layer(i, f"vl{i + 1}", lo, hi) for i, (lo, hi) in enumerate(VCSL_SPLITS[n])]
    log(f"[{sd.id}] {len(items)} source files, {len(layers)} layers")
    with cf.ThreadPoolExecutor(max_workers=jobs) as ex:
        processed = list(ex.map(process_item, items))
    checked = [p.deviation for p in processed if p.deviation is not None]
    if checked:
        log(f"[{sd.id}] pitch deviations: median {float(np.median(checked)):+.2f} st, min {min(checked):+.2f}, max {max(checked):+.2f}, prominent harmonics median {float(np.median([p.prominent for p in processed]))}")
    # Pitch verification: detect a whole-set octave offset first, then reject individual outliers.
    devs = [p.deviation for p in processed if p.deviation is not None and 65 <= midi_to_hz(p.item.root) <= 2000 and p.prominent >= 2]
    if not devs:
        devs = [p.deviation for p in processed if p.deviation is not None]
    octave_shift = 0
    if devs:
        median = float(np.median(devs))
        if abs(median) > 6:
            octave_shift = int(round(median / 12)) * 12
            log(f"[{sd.id}] named pitches are off by {octave_shift:+d} semitones (median {median:+.2f}); correcting roots")
    kept: list[Processed] = []
    rejected: list[str] = []
    for p in processed:
        if p.data.size < int(0.05 * SR):
            rejected.append(f"{p.item.source_file}: too short after trimming ({p.data.size / SR:.3f} s)")
            continue
        hz = midi_to_hz(p.item.root + octave_shift)
        if p.deviation is None:
            log(f"[{sd.id}] {p.item.source_file}: too short to verify the pitch (kept, root {p.item.root})")
        elif hz < 65 or hz > 2000:
            # Piano bass strings (inharmonic partials, weak fundamental) and the top octave (one or two partials
            # below Nyquist) cannot be verified reliably; the curated sources name them consistently, so keep them.
            d = p.deviation - octave_shift
            if abs(d) > 0.6:
                log(f"[{sd.id}] {p.item.source_file}: unverifiable range (root {p.item.root}, best match {d:+.2f} st, {p.prominent} prominent harmonics); kept")
        else:
            d = p.deviation - octave_shift
            # Idiophones (marimba bars) have non-harmonic overtones, so a strong fundamental alone also passes.
            if abs(d) > 0.6 or (p.prominent < 2 and p.fundamental < 12):
                rejected.append(f"{p.item.source_file}: best match {p.f0:.1f} Hz = {d:+.2f} semitones from root {p.item.root} ({p.prominent} prominent harmonics)")
                continue
            if abs(d) > 0.35:
                log(f"[{sd.id}] {p.item.source_file}: {d:+.2f} semitones from root {p.item.root} (kept; stretch / tuning)")
        if octave_shift:
            p.item.root += octave_shift
        kept.append(p)
    for r in rejected:
        log(f"[{sd.id}] REJECTED {r}")
    if not kept:
        log(f"[{sd.id}] skipped: nothing left after pitch checks")
        return None
    # Normalisation: loudest layer's median early RMS -> -18 dBFS, then keep every peak <= 0.95.
    early = int(0.5 * SR)
    rms = {id(p): float(np.sqrt(np.mean(p.data[:early] ** 2))) for p in kept}
    top = max(p.item.layer for p in kept)
    top_rms = [rms[id(p)] for p in kept if p.item.layer == top]
    gain = 10 ** (-18 / 20) / max(1e-9, float(np.median(top_rms)))
    peak = max(float(np.max(np.abs(p.data))) for p in kept)
    if peak * gain > 0.95:
        gain = 0.95 / peak
    gain_db = 20 * math.log10(gain)
    out_dir = out_root / sd.id
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    kept.sort(key=lambda p: (p.item.root, p.item.layer))
    files = []
    for p in kept:
        y = (p.data * gain).astype(np.float32)
        name = f"{p.item.root:03d}-l{p.item.layer}.ogg"
        encode(y, out_dir / name, quality)
        dur = probe_duration(out_dir / name)
        expected = y.size / SR
        if abs(dur - expected) > max(0.02, 0.01 * expected):
            raise RuntimeError(f"{sd.id}/{name}: encoded duration {dur:.3f} s != {expected:.3f} s")
        files.append({
            "file": name, "root": p.item.root, "layer": p.item.layer, "seconds": round(expected, 3),
            "peak": round(float(np.max(np.abs(y))), 4), "rms": round(float(np.sqrt(np.mean(y[:early] ** 2))), 4),
            "sourceFile": p.item.source_file,
        })
    roots = sorted({f["root"] for f in files})
    manifest = {
        "id": sd.id, "type": sd.type, "model": sd.model, "kind": "recorded",
        "source": sd.source,
        "format": "ogg-vorbis", "sampleRate": SR, "channels": 1,
        "layers": [{"index": l.index, "name": l.name, "lovel": l.lovel, "hivel": l.hivel, "velocity": l.velocity} for l in layers],
        "range": {"lowestRoot": roots[0], "highestRoot": roots[-1]},
        "files": files,
        "processing": f"mono downmix, onset trim (0.2 % of peak, 1 ms fade-in), tail cut 60 dB below the peak (never below -72 dBFS) or at the per-root cap (7 / 5 / 3.5 s) with a 0.4 s raised-cosine fade, set gain {gain_db:+.1f} dB, Ogg Vorbis q{quality} at {SR} Hz",
        "notes": list(sd.notes) + ([f"Named roots corrected by {octave_shift:+d} semitones after pitch verification."] if octave_shift else []) + ([f"Rejected after pitch verification: {'; '.join(rejected)}"] if rejected else []),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    total = sum((out_dir / f["file"]).stat().st_size for f in files)
    log(f"[{sd.id}] wrote {len(files)} files, {total / 1e6:.2f} MB, gain {gain_db:+.1f} dB")
    return manifest


def write_index(out_root: Path, manifests: list[dict]) -> None:
    sets = []
    for m in manifests:
        d = out_root / m["id"]
        sets.append({"id": m["id"], "type": m["type"], "model": m["model"], "kind": m["kind"], "license": m["source"]["license"], "files": len(m["files"]), "bytes": sum((d / f["file"]).stat().st_size for f in m["files"])})
    (out_root / "index.json").write_text(json.dumps({"version": 1, "sets": sets}, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--sets", default="", help="comma-separated set ids (default: all)")
    ap.add_argument("--quality", type=int, default=3, help="libvorbis -q:a (default 3)")
    ap.add_argument("--jobs", type=int, default=6)
    args = ap.parse_args()
    wanted = [s for s in args.sets.split(",") if s]
    out_root: Path = args.out
    out_root.mkdir(parents=True, exist_ok=True)
    log = lambda msg: print(msg, flush=True)
    built: list[dict] = []
    for sd in SETS:
        if wanted and sd.id not in wanted:
            continue
        m = build_set(sd, args.sources, out_root, args.quality, args.jobs, log)
        if m:
            built.append(m)
    # index.json covers every set present on disk (so partial rebuilds keep the others).
    manifests = []
    for sd in SETS:
        p = out_root / sd.id / "manifest.json"
        if p.exists():
            manifests.append(json.loads(p.read_text(encoding="utf-8")))
    write_index(out_root, manifests)
    log(f"index.json: {len(manifests)} sets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
