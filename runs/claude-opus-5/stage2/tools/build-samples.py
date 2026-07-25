#!/usr/bin/env python3
"""Build the bundled piano sample sets from their upstream, redistributable sources.

This script is the provenance record for `public/samples/`: every bundled file is produced
here, from a named upstream release, by the transformations written below (channel downmix,
band-limited resample, trim, fade, one gain per set). Nothing is synthesised here — the
recordings are real recordings of real instruments, and the licences are recorded in the
manifest the script writes.

Upstream sources (downloaded manually, not vendored):

  Grand     YDP-GrandPiano-SF2-20160804.tar.bz2
            https://freepats.zenvoid.org/Piano/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2
            Yamaha Disklavier Pro grand, Zenph Studios / OLPC sample library, soundfont by
            Roberto (FreePats). Licence: CC BY 3.0.

  Upright   UprightPianoKW-SFZ-20220221.7z
            https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SFZ-20220221.7z
            Kawai upright recorded by Gonzalo and Roberto for FreePats. Licence: CC0 1.0.

  Electric  FluidR3_GM.sf2 (Debian package fluid-soundfont-gm 3.1-6)
            https://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont-gm_3.1-6_all.deb
            "Rhodes" tine electric piano samples by Frank Wen. Licence: MIT.

Usage:
    python3 tools/build-samples.py --grand-sf2 <path> --upright-dir <path> --fluid-sf2 <path>

Requires numpy. Writes public/samples/<set>/*.wav and src/audio/sampleManifest.json.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import wave
from dataclasses import dataclass

import numpy as np

TARGET_RATE = 24000
PEAK_TARGET = 0.89
FADE_SECONDS = 0.28
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Sharps are written "s" in file names: "#" starts a fragment in a URL and would truncate it.
FILE_NOTE_NAMES = [name.replace("#", "s") for name in NOTE_NAMES]


# --------------------------------------------------------------------------- sf2 reading


def _riff_chunks(buf: bytes, start: int, end: int):
    off = start
    while off + 8 <= end:
        cid = buf[off : off + 4].decode("latin1")
        size = struct.unpack_from("<I", buf, off + 4)[0]
        yield cid, off + 8, off + 8 + size
        off += 8 + size + (size & 1)


@dataclass
class Sf2Sample:
    name: str
    start: int
    end: int
    rate: int
    original_pitch: int
    correction: int
    kind: int
    link: int


class Sf2:
    def __init__(self, path: str):
        self.buf = open(path, "rb").read()
        assert self.buf[:4] == b"RIFF" and self.buf[8:12] == b"sfbk", "not an sf2 file"
        total = 8 + struct.unpack_from("<I", self.buf, 4)[0]
        self.chunks: dict[str, tuple[int, int]] = {}
        for cid, s, e in _riff_chunks(self.buf, 12, total):
            if cid == "LIST":
                for c2, s2, e2 in _riff_chunks(self.buf, s + 4, e):
                    self.chunks[c2] = (s2, e2)
        self.samples = self._read_shdr()

    def _read_shdr(self) -> list[Sf2Sample]:
        s, e = self.chunks["shdr"]
        out = []
        for off in range(s, e, 46):
            rec = self.buf[off : off + 46]
            if len(rec) < 46:
                break
            name = rec[0:20].split(b"\0")[0].decode("latin1")
            start, end, _ls, _le, rate = struct.unpack_from("<IIIII", rec, 20)
            orig, corr, link, kind = struct.unpack_from("<BbHH", rec, 40)
            if name == "EOS":
                continue
            out.append(Sf2Sample(name, start, end, rate, orig, corr, kind, link))
        return out

    def pcm(self, sample: Sf2Sample) -> np.ndarray:
        base = self.chunks["smpl"][0]
        raw = self.buf[base + sample.start * 2 : base + sample.end * 2]
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


# --------------------------------------------------------------------------- dsp helpers


def read_wav_mono(path: str) -> tuple[np.ndarray, int]:
    """Minimal RIFF reader: handles plain PCM and WAVE_FORMAT_EXTENSIBLE, 16 or 24 bit."""
    buf = open(path, "rb").read()
    assert buf[:4] == b"RIFF" and buf[8:12] == b"WAVE", f"{path} is not a RIFF/WAVE file"
    total = 8 + struct.unpack_from("<I", buf, 4)[0]
    channels = width = rate = 0
    payload = b""
    for cid, start, end in _riff_chunks(buf, 12, min(total, len(buf))):
        if cid == "fmt ":
            _tag, channels, rate = struct.unpack_from("<HHI", buf, start)
            width = struct.unpack_from("<H", buf, start + 14)[0] // 8
        elif cid == "data":
            payload = buf[start:end]
    assert width in (2, 3) and channels and rate, f"unsupported wav format in {path}"
    if width == 2:
        data = np.frombuffer(payload, dtype="<i2").astype(np.float32) / 32768.0
    else:
        raw = np.frombuffer(payload[: len(payload) // 3 * 3], dtype=np.uint8).reshape(-1, 3)
        packed = raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8) | (raw[:, 2].astype(np.int8).astype(np.int32) << 16)
        data = packed.astype(np.float32) / 8388608.0
    if channels > 1:
        data = data[: len(data) // channels * channels].reshape(-1, channels).mean(axis=1)
    return data, rate


def resample(data: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    """Band-limited resample: windowed-sinc low pass, then linear interpolation."""
    if source_rate == target_rate:
        return data
    if target_rate < source_rate:
        cutoff = 0.45 * target_rate / source_rate  # cycles/sample, normalised to source rate
        taps = 63
        n = np.arange(taps) - (taps - 1) / 2
        kernel = np.sinc(2 * cutoff * n) * np.hamming(taps)
        kernel /= kernel.sum()
        data = np.convolve(data, kernel, mode="same")
    duration = len(data) / source_rate
    target_len = int(duration * target_rate)
    source_index = np.arange(target_len) * (source_rate / target_rate)
    return np.interp(source_index, np.arange(len(data)), data).astype(np.float32)


def detect_midi_note(data: np.ndarray, rate: int) -> float | None:
    """Autocorrelation pitch estimate, used to verify the declared root of every sample."""
    start = int(0.05 * rate)
    window = data[start : start + int(0.35 * rate)]
    if len(window) < 1024 or float(np.max(np.abs(window))) < 1e-4:
        return None
    window = window - window.mean()
    size = 1 << (len(window) * 2 - 1).bit_length()
    spectrum = np.fft.rfft(window, size)
    correlation = np.fft.irfft(spectrum * np.conj(spectrum))[: len(window)]
    # Skip the main lobe around lag 0 (correlation there is trivially large) by starting at the
    # first lag where the correlation goes negative, the standard autocorrelation pitch guard.
    negative = np.nonzero(correlation < 0)[0]
    lo = max(int(rate / 4300), int(negative[0]) if len(negative) else 1)
    hi = min(int(rate / 24), len(correlation) - 1)
    if hi <= lo:
        return None
    peak = lo + int(np.argmax(correlation[lo:hi]))
    # Sub-octave guard: prefer half the lag when it is nearly as strong a peak.
    for _ in range(3):
        half = peak // 2
        if half < lo:
            break
        window_lo, window_hi = max(lo, int(half * 0.92)), min(hi, int(half * 1.08) + 1)
        if window_hi <= window_lo:
            break
        candidate = window_lo + int(np.argmax(correlation[window_lo:window_hi]))
        if correlation[candidate] <= 0.85 * correlation[peak]:
            break
        peak = candidate
    # Parabolic interpolation, so short (high-note) lags are not quantised to whole samples.
    lag = float(peak)
    if 0 < peak < len(correlation) - 1:
        before, centre, after = correlation[peak - 1], correlation[peak], correlation[peak + 1]
        denominator = before - 2 * centre + after
        if denominator != 0:
            lag += 0.5 * (before - after) / denominator
    frequency = rate / lag
    return 69 + 12 * float(np.log2(frequency / 440.0))


def note_seconds(midi: int) -> float:
    """Bundled tail length: low notes keep more of their decay than high ones."""
    frequency = 440.0 * 2 ** ((midi - 69) / 12)
    return float(np.clip(4.6 * (261.63 / frequency) ** 0.33, 1.25, 3.4))


def shape(data: np.ndarray, rate: int, midi: int) -> np.ndarray:
    peak = float(np.max(np.abs(data))) if len(data) else 0.0
    if peak > 0:
        onset = int(np.argmax(np.abs(data) > peak * 0.02))
        data = data[max(0, onset - int(0.004 * rate)) :]
    length = min(len(data), int(note_seconds(midi) * rate))
    data = data[:length].copy()
    fade = min(int(FADE_SECONDS * rate), length)
    if fade > 1:
        data[length - fade :] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    return data


def write_wav(path: str, data: np.ndarray, rate: int) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    clipped = np.clip(data, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())
    return os.path.getsize(path)


def note_name(midi: int) -> str:
    return f"{FILE_NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


# --------------------------------------------------------------------------- set builders


@dataclass
class Layer:
    midi: int
    velocity_low: int
    velocity_high: int
    data: np.ndarray
    rate: int
    source: str


def build_grand(sf2_path: str) -> list[Layer]:
    sf2 = Sf2(sf2_path)
    by_root: dict[int, list[tuple[int, Sf2Sample]]] = {}
    for sample in sf2.samples:
        match = re.match(r"piano(\d+)v(\d+)$", sample.name)
        if not match:
            continue
        by_root.setdefault(int(match.group(1)), []).append((int(match.group(2)), sample))
    roots = [root for root in sorted(by_root) if 27 <= root <= 105 and (root - 27) % 6 == 0]
    layers: list[Layer] = []
    for root in roots:
        options = sorted(by_root[root])
        soft, loud = options[0][1], options[-1][1]
        layers.append(Layer(root, 1, 80, sf2.pcm(soft), soft.rate, f"{soft.name} (YDP-GrandPiano)"))
        layers.append(Layer(root, 81, 127, sf2.pcm(loud), loud.rate, f"{loud.name} (YDP-GrandPiano)"))
    return layers


def build_upright(directory: str) -> list[Layer]:
    sfz = None
    for root, _dirs, files in os.walk(directory):
        for name in files:
            if name.endswith(".sfz"):
                sfz = os.path.join(root, name)
    assert sfz, "no .sfz mapping found in the upright directory"
    text = open(sfz, encoding="utf8", errors="replace").read()

    # SFZ opcodes are inherited from the enclosing <group>, so the file is walked in order with
    # the current group's velocity window carried into each region rather than searched blindly.
    regions: list[tuple[int, int, int, str]] = []
    group_velocity = (1, 127)
    current: dict[str, str] | None = None
    section = None

    def flush() -> None:
        if section != "region" or current is None:
            return
        root = current.get("pitch_keycenter")
        sample = current.get("sample")
        if root is None or sample is None:
            return
        lovel = int(current.get("lovel", group_velocity[0]))
        hivel = int(current.get("hivel", group_velocity[1]))
        regions.append((int(root), lovel, hivel, os.path.join(os.path.dirname(sfz), sample.replace("\\", "/"))))

    for raw in text.splitlines():
        line = raw.split("//")[0].strip()
        if not line:
            continue
        for token in line.split():
            if token.startswith("<") and token.endswith(">"):
                flush()
                header = token[1:-1]
                if header == "group":
                    group_velocity = (1, 127)
                    section = "group"
                    current = {}
                elif header == "region":
                    section = "region"
                    current = {}
                else:
                    section = header
                    current = {}
                continue
            if "=" not in token or current is None:
                continue
            key, value = token.split("=", 1)
            current[key] = value
            if section == "group" and key in ("lovel", "hivel"):
                group_velocity = (
                    int(current.get("lovel", 1)),
                    int(current.get("hivel", 127)),
                )
    flush()

    roots = sorted({region[0] for region in regions})
    keep = {root for index, root in enumerate(roots) if index % 2 == 0 or root == roots[-1]}
    layers: list[Layer] = []
    for root, lovel, hivel, path in sorted(regions):
        if root not in keep or root > 106 or root < 24:
            continue
        data, rate = read_wav_mono(path)
        layers.append(Layer(root, lovel, hivel, data, rate, f"{os.path.basename(path)} (UprightPianoKW)"))
    assert len({(layer.midi, layer.velocity_high) for layer in layers}) == len(layers), (
        "two upright samples would be written to the same file name"
    )
    return layers


def build_electric(sf2_path: str) -> list[Layer]:
    sf2 = Sf2(sf2_path)
    named: dict[str, dict[str, Sf2Sample]] = {}
    for sample in sf2.samples:
        match = re.match(r"Rhodes ([A-G]#?)(\d)\((L|R)\)$", sample.name)
        if not match:
            continue
        named.setdefault(f"{match.group(1)}{match.group(2)}", {})[match.group(3)] = sample
    def merged(pair: dict[str, Sf2Sample]) -> tuple[np.ndarray, int]:
        left = pair["L"]
        data = sf2.pcm(left)
        right = pair.get("R")
        if right is not None:
            other = sf2.pcm(right)
            size = min(len(data), len(other))
            data = (data[:size] + other[:size]) * 0.5
        return data, left.rate

    def named_midi(label: str) -> int:
        pitch_class = NOTE_NAMES.index(label[:-1])
        return 12 * (int(label[-1]) + 1) + pitch_class

    # The shdr root keys in FluidR3 are overridden per zone, so the octave convention of the
    # sample names is resolved by measuring the pitch of the lowest, longest sample.
    anchor = min(named, key=named_midi)
    anchor_data, anchor_rate = merged(named[anchor])
    measured = detect_midi_note(anchor_data, anchor_rate)
    assert measured is not None, "could not measure the anchor Rhodes sample"
    offset = 12 * round((measured - named_midi(anchor)) / 12)

    layers: list[Layer] = []
    for label, pair in named.items():
        if "L" not in pair:
            continue
        data, rate = merged(pair)
        layers.append(Layer(named_midi(label) + offset, 1, 127, data, rate, f"Rhodes {label} (FluidR3_GM)"))
    layers.sort(key=lambda layer: layer.midi)
    return layers


# --------------------------------------------------------------------------- driver


SETS = {
    "grand": {
        "label": "Nord Grand — Yamaha Disklavier Pro",
        "type": "grand",
        "source": "FreePats YDP-GrandPiano 2016-08-04 (Zenph Studios / OLPC multisamples)",
        "license": "CC BY 3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/3.0/",
        "attribution": "Zenph Studios Yamaha Disklavier Pro multisamples for OLPC; soundfont by roberto@zenvoid.org for the FreePats project.",
        "url": "https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html",
    },
    "upright": {
        "label": "Upright KW — Kawai upright",
        "type": "upright",
        "source": "FreePats UprightPianoKW 2022-02-21",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        "attribution": "Recorded by Gonzalo and Roberto for the FreePats project, Kawai upright piano, Zoom H1.",
        "url": "https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW",
    },
    "electric": {
        "label": "Electric Tine — Rhodes-style tine piano",
        "type": "electric",
        "source": "FluidR3_GM.sf2 'Rhodes' samples (Debian fluid-soundfont-gm 3.1-6)",
        "license": "MIT",
        "licenseUrl": "https://opensource.org/license/mit",
        "attribution": "FluidR3 soundfont, Copyright (c) 2000-2002, 2008 Frank Wen; MIT licence.",
        "url": "https://packages.debian.org/sid/fluid-soundfont-gm",
    },
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--grand-sf2", required=True)
    parser.add_argument("--upright-dir", required=True)
    parser.add_argument("--fluid-sf2", required=True)
    parser.add_argument("--out", default="public/samples")
    parser.add_argument("--manifest", default="src/audio/sampleManifest.json")
    args = parser.parse_args()

    builders = {
        "grand": lambda: build_grand(args.grand_sf2),
        "upright": lambda: build_upright(args.upright_dir),
        "electric": lambda: build_electric(args.fluid_sf2),
    }

    manifest = {
        "generatedBy": "tools/build-samples.py",
        "sampleRate": TARGET_RATE,
        "format": "16-bit PCM mono WAV",
        "sets": [],
    }

    for set_id, meta in SETS.items():
        layers = builders[set_id]()
        assert layers, f"no layers built for {set_id}"
        shaped = []
        for layer in layers:
            # Pitch is verified on the untouched source data, where the autocorrelation lag has
            # far more resolution than it does after the resample to 24 kHz.
            # Pitch check on the untouched source data. Autocorrelation on a struck string
            # picks the wrong octave often enough (weak fundamentals low down, room rumble in
            # the upright recordings, too few samples per period high up) that the octave is
            # taken from the source metadata; what is verified here is that the sample lands on
            # the declared *pitch class* within a fraction of a semitone. Above MIDI 84 there are
            # too few samples per period for the estimate to mean anything, so those roots are
            # reported as unverified rather than checked badly.
            measured = detect_midi_note(layer.data, layer.rate) if layer.midi <= 84 else None
            drift = None
            if measured is not None:
                drift = round(measured - layer.midi - 12 * round((measured - layer.midi) / 12), 2)
                assert abs(drift) < 0.75, (
                    f"{set_id} root {layer.midi}: measured pitch class is {drift} semitones off"
                )
            data = resample(layer.data, layer.rate, TARGET_RATE)
            data = shape(data, TARGET_RATE, layer.midi)
            shaped.append((layer, data, drift))
        loudest = max(float(np.max(np.abs(data))) for _layer, data, _drift in shaped)
        gain = PEAK_TARGET / loudest
        files = []
        total_bytes = 0
        for layer, data, drift in shaped:
            name = f"{note_name(layer.midi)}_{layer.midi}_v{layer.velocity_high}.wav"
            path = os.path.join(args.out, set_id, name)
            total_bytes += write_wav(path, data * gain, TARGET_RATE)
            files.append(
                {
                    "file": name,
                    "root": layer.midi,
                    "velocityLow": layer.velocity_low,
                    "velocityHigh": layer.velocity_high,
                    "seconds": round(len(data) / TARGET_RATE, 3),
                    "pitchClassDriftSemitones": drift,
                    "sourceSample": layer.source,
                }
            )
        roots = sorted({entry["root"] for entry in files})
        spans = [b - a for a, b in zip(roots, roots[1:])] or [0]
        manifest["sets"].append(
            {
                "id": set_id,
                **meta,
                "recorded": True,
                "rootNotes": len(roots),
                "velocityLayers": len({entry["velocityHigh"] for entry in files}),
                "maxPitchShiftSemitones": max(spans) / 2,
                "bytes": total_bytes,
                "files": files,
            }
        )
        print(f"{set_id}: {len(files)} files, {len(roots)} roots, {total_bytes / 1e6:.2f} MB")

    os.makedirs(os.path.dirname(args.manifest), exist_ok=True)
    with open(args.manifest, "w", encoding="utf8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    print(f"manifest -> {args.manifest}")


if __name__ == "__main__":
    main()
