#!/usr/bin/env python3
"""
Builds the bundled piano sample library used by the app (Phase 2).

    python3 -m venv .venv && .venv/bin/pip install numpy soundfile
    .venv/bin/python scripts/build-samples.py --work /tmp/stage2-samples

What it does
  1. downloads the openly licensed source recordings listed in SOURCES (skipped when already present in --work),
  2. picks a subset of notes / velocity layers per model,
  3. downmixes to mono, trims leading offsets and long tails (with a fade), encodes Ogg Vorbis,
  4. writes public/samples/<model>/*.ogg and src/audio/library/manifest.json.

The recordings are NOT edited beyond that (no pitch shifting, no loops, no synthesis). Provenance and licenses
are copied into the manifest and from there into IMPLEMENTATION_DETAILS.json (scripts/write-details.mjs).
"""
import argparse
import concurrent.futures as cf
import json
import math
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
OUT_AUDIO = ROOT / "public" / "samples"
OUT_MANIFEST = ROOT / "src" / "audio" / "library" / "manifest.json"

MAX_SECONDS = 7.0
VORBIS_COMPRESSION = 0.72  # libsndfile: quality = 1 - compression  (~0.28 => roughly 80 kbit/s mono)

GH = "https://raw.githubusercontent.com/sfzinstruments"
NOTE_INDEX = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def note_number(name: str) -> int:
    m = re.fullmatch(r"([A-G]#?)(-?\d)", name)
    assert m, name
    return NOTE_INDEX[m.group(1)] + 12 * (int(m.group(2)) + 1)


def salamander_notes():
    names = ["A0"]
    for octave in range(1, 8):
        names += [f"C{octave}", f"D#{octave}", f"F#{octave}", f"A{octave}"]
    names.append("C8")
    return names


SOURCES = {
    "grand-salamander": {
        "type": "Grand",
        "name": "Salamander Grand",
        "author": "Alexander Holm",
        "license": "CC-BY-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
        "sourceUrl": "https://archive.org/details/SalamanderGrandPianoV3",
        "mirrorUrl": "https://github.com/sfzinstruments/SalamanderGrandPiano",
        "attribution": "Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0. Selected notes and velocity layers, mono, Ogg Vorbis.",
        "layers": [3, 8, 13],  # Salamander velocity layers v1..v16, each covers 8 MIDI velocities
    },
    "upright-kw": {
        "type": "Upright",
        "name": "Upright KW",
        "author": "Gonzalo and Roberto (FreePats)",
        "license": "CC0-1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "sourceUrl": "https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW",
        "attribution": "Upright Piano KW, FreePats project, released under CC0 1.0. Mono, Ogg Vorbis, tails trimmed.",
        "archive": "https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SFZ+FLAC-20220221.7z",
    },
    "electric-wurlitzer": {
        "type": "Electric",
        "name": "Wurlitzer EP200",
        "author": "Greg Sullivan (mapped by kinwie)",
        "license": "CC-BY-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
        "sourceUrl": "http://www.sullivang.net/",
        "mirrorUrl": "https://github.com/sfzinstruments/GregSullivan.E-Pianos",
        "attribution": "Wurlitzer EP200 Electric Piano v1.1 by Greg Sullivan, CC BY 3.0. Mono, Ogg Vorbis.",
        "sfz": "Wurlitzer EP200/Wurlitzer EP200.sfz",
        "samples_dir": "Wurlitzer EP200/Samples",
    },
    "electric-pianet": {
        "type": "Electric",
        "name": "Pianet T",
        "author": "Greg Sullivan (mapped by kinwie)",
        "license": "CC-BY-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
        "sourceUrl": "http://www.sullivang.net/",
        "mirrorUrl": "https://github.com/sfzinstruments/GregSullivan.E-Pianos",
        "attribution": "Hohner Pianet T (type 2) v1.3 by Greg Sullivan, CC BY 3.0. Mono, Ogg Vorbis, release samples not used.",
        "sfz": "Pianet T/Pianet T.sfz",
        "samples_dir": "Pianet T/Samples",
    },
}


def fetch(url: str, dest: Path):
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def gh_url(repo: str, path: str) -> str:
    return f"{GH}/{repo}/master/{urllib.parse.quote(path)}"


# --- SFZ parsing (only what these three instruments use) ---------------------------------------------
def parse_sfz(text: str, ext="flac"):
    text = re.sub(r"//[^\n]*", "", text).replace("$EXT", ext)
    parts = re.split(r"<(\w+)>", text)
    scopes = {"global": {}, "master": {}, "group": {}}
    regions = []
    for i in range(1, len(parts), 2):
        header, body = parts[i], parts[i + 1]
        ops = dict(re.findall(r"(\w+)=([^\s]+)", body))
        if header in scopes:
            scopes[header] = ops
            if header == "master":
                scopes["group"] = {}
        elif header == "region":
            merged = {}
            for k in ("global", "master", "group"):
                merged.update(scopes[k])
            # regions may share a line with more regions: the split above already separates them
            merged.update(ops)
            regions.append(merged)
    return regions


def encode(dest: Path, data: np.ndarray, sr: int):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with sf.SoundFile(str(dest), "w", samplerate=sr, channels=1, format="OGG", subtype="VORBIS", compression_level=VORBIS_COMPRESSION) as f:
        f.write(data.astype(np.float32))


def load_mono(path: Path, offset=0):
    data, sr = sf.read(str(path), always_2d=True, dtype="float32")
    mono = data.mean(axis=1)
    if offset:
        mono = mono[int(offset):]
    return mono, sr


def trim(mono: np.ndarray, sr: int):
    limit = int(MAX_SECONDS * sr)
    if len(mono) > limit:
        mono = mono[:limit].copy()
        fade = int(1.4 * sr)
    else:
        mono = mono.copy()
        fade = int(0.06 * sr)
    fade = min(fade, len(mono))
    mono[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, fade)))
    return mono


def build(work: Path):
    work.mkdir(parents=True, exist_ok=True)
    models = {}

    # ---- collect raw entries: model -> layers[{velocity, samples[{src, root, cents, gainDb, offset, file}]}]
    raw = {}

    # Salamander: 4 of 16 velocity layers, minor-third spacing
    sal = SOURCES["grand-salamander"]
    files = [(n, l) for n in salamander_notes() for l in sal["layers"]]
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda nl: fetch(gh_url("SalamanderGrandPiano", f"Samples/{nl[0]}v{nl[1]}.flac"), work / "salamander" / f"{nl[0]}v{nl[1]}.flac"), files))
    layers = []
    for l in sal["layers"]:
        centre = l * 8 - 4
        layers.append({"velocity": centre, "samples": [{"src": work / "salamander" / f"{n}v{l}.flac", "name": f"{n}v{l}", "root": note_number(n), "cents": 0, "gainDb": 0.0, "offset": 0} for n in salamander_notes()]})
    raw["grand-salamander"] = layers

    # Upright: SFZ from the archive (vL <= 80, vH above)
    up = SOURCES["upright-kw"]
    arch = work / "upright.7z"
    fetch(up["archive"], arch)
    up_dir = work / "upright"
    if not up_dir.exists():
        up_dir.mkdir()
        subprocess.run(["tar", "-xf", str(arch), "-C", str(up_dir)], check=True)
    base = next(up_dir.iterdir())
    regs = parse_sfz((next(base.glob("*.sfz"))).read_text(), "flac")
    groups = {}
    for r in regs:
        lovel = int(r.get("lovel", 1))
        hivel = int(r.get("hivel", 127))
        groups.setdefault((lovel, hivel), []).append(r)
    layers = []
    for (lo, hi), rs in sorted(groups.items()):
        seen = {}
        for r in rs:
            name = Path(r["sample"]).stem
            m = re.match(r"([A-G]#?\d)v", name)
            root = int(r["pitch_keycenter"]) if "pitch_keycenter" in r else note_number(m.group(1))
            seen[name] = {"src": base / r["sample"], "name": name, "root": root, "cents": int(float(r.get("tune", 0))), "gainDb": float(r.get("volume", 0)), "offset": int(r.get("offset", 0))}
        layers.append({"velocity": (lo + hi) // 2 if hi < 127 else (lo + 127) // 2, "samples": list(seen.values())})
    raw["upright-kw"] = layers

    # Electric pianos
    for mid in ("electric-wurlitzer", "electric-pianet"):
        cfg = SOURCES[mid]
        sfz_path = work / mid / "model.sfz"
        fetch(gh_url("GregSullivan.E-Pianos", cfg["sfz"]), sfz_path)
        regs = [r for r in parse_sfz(sfz_path.read_text(), "flac") if r.get("trigger") != "release" and "pitch_keycenter" in r]
        names = sorted({r["sample"] for r in regs})
        with cf.ThreadPoolExecutor(8) as ex:
            list(ex.map(lambda n: fetch(gh_url("GregSullivan.E-Pianos", f"{cfg['samples_dir']}/{n}"), work / mid / n), names))
        groups = {}
        for r in regs:
            groups.setdefault((int(r.get("lovel", 1)), int(r.get("hivel", 127))), []).append(r)
        layers = []
        for (lo, hi), rs in sorted(groups.items()):
            seen = {}
            for r in rs:
                name = Path(r["sample"]).stem
                seen[name] = {"src": work / mid / r["sample"], "name": name, "root": int(r["pitch_keycenter"]), "cents": int(float(r.get("tune", 0))), "gainDb": float(r.get("volume", 0)), "offset": int(r.get("offset", 0))}
            layers.append({"velocity": (lo + hi) // 2, "samples": list(seen.values())})
        raw[mid] = layers

    # ---- encode + manifest
    out_models = []
    for mid, layers in raw.items():
        cfg = SOURCES[mid]
        # one scale for the whole model so the recorded dynamics between layers/notes are kept
        loaded = {}
        peak = 0.0
        for layer in layers:
            for s in layer["samples"]:
                mono, sr = load_mono(s["src"], s["offset"])
                mono = trim(mono, sr)
                loaded[s["name"] + str(layer["velocity"])] = (mono, sr)
                peak = max(peak, float(np.max(np.abs(mono))) * 10 ** (s["gainDb"] / 20))
        scale = 0.95 / peak
        used_files = set()
        out_layers = []
        for layer in layers:
            out_samples = []
            for s in sorted(layer["samples"], key=lambda x: x["root"]):
                mono, sr = loaded[s["name"] + str(layer["velocity"])]
                data = mono * scale * 10 ** (s["gainDb"] / 20)
                safe = s["name"].replace("#", "s")  # '#' would start a URL fragment
                rel = f"{mid}/{safe}.ogg"
                if rel in used_files:  # the same source file is mapped into several velocity layers (with different gains)
                    rel = f"{mid}/{safe}-v{layer['velocity']}.ogg"
                used_files.add(rel)
                encode(OUT_AUDIO / rel, data, sr)
                first = data[: int(0.5 * sr)]
                out_samples.append({"rms": round(float(np.sqrt(np.mean(first**2))), 5), "file": rel, "root": s["root"], "cents": s["cents"], "sampleRate": sr, "durationSec": round(len(data) / sr, 3), "bytes": (OUT_AUDIO / rel).stat().st_size, "source": s["src"].name})
            out_layers.append({"velocity": layer["velocity"], "samples": out_samples})
        out_models.append(
            {
                "id": mid,
                "type": cfg["type"],
                "name": cfg["name"],
                "author": cfg["author"],
                "license": cfg["license"],
                "licenseUrl": cfg["licenseUrl"],
                "sourceUrl": cfg["sourceUrl"],
                "mirrorUrl": cfg.get("mirrorUrl"),
                "attribution": cfg["attribution"],
                "encoding": "Ogg Vorbis, mono, quality ~0.28; tails trimmed to %.0f s with a fade; no looping, no pitch shifting in the files" % MAX_SECONDS,
                "layers": out_layers,
            }
        )
    OUT_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    OUT_MANIFEST.write_text(json.dumps({"version": 1, "models": out_models}, indent=1) + "\n")
    total = sum(s["bytes"] for m in out_models for l in m["layers"] for s in l["samples"])
    count = sum(len(l["samples"]) for m in out_models for l in m["layers"])
    print(f"{count} files, {total / 1e6:.1f} MB -> {OUT_AUDIO}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/stage2-samples", help="download cache")
    args = ap.parse_args()
    if OUT_AUDIO.exists():
        shutil.rmtree(OUT_AUDIO)
    build(Path(args.work))
