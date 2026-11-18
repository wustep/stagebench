"""Prepare the Grand and Electric banks from the workspace pack."""
import array
from concurrent.futures import ThreadPoolExecutor
import json
import re
import struct
import subprocess

from importlib import import_module

upright = import_module("prepare-upright")
CANDIDATE = upright.CANDIDATE
PACK = upright.PACK
GRAND = "grand/salamander-grand-v3/Samples"
RHODES = "electric/learman-rhodes-gm/Discord GM/Melodic/005-Electric Piano 1"
DYNAMICS = [1, 4, 7, 10, 16]


def loop_points(path):
    with path.open("rb") as wav:
        wav.seek(12)
        while header := wav.read(8):
            chunk, size = struct.unpack("<4sI", header)
            if chunk == b"smpl":
                fields = struct.unpack_from("<15I", wav.read(size))
                if fields[7]:
                    return fields[11], fields[12] + 1
                return None
            wav.seek(size + size % 2, 1)
    return None


def cut(job):
    bank, path, root, layer = job
    rate, channels = (48000, 2) if bank == "grand" else (44100, 1)
    samples = array.array("f", subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-"
    ]))
    peak = max(abs(sample) for sample in samples)
    attack = next(index // channels for index, sample in enumerate(samples) if abs(sample) >= peak * 0.006)
    start = max(0, attack - round(rate * 0.002))
    loop = loop_points(path) if bank == "electric" else None
    end = min(len(samples) // channels, start + rate * (9 if root < 60 else 7))
    if loop:
        end = min(len(samples) // channels, max(end, loop[1] + round(rate * 0.05)))
    duration = (end - start) / rate
    fade = min(0.28, duration * 0.15)
    fade_start = duration - fade
    if loop:
        fade_start = max(fade_start, (loop[1] - start) / rate)
        fade = min(fade, duration - fade_start)
    # Keep some of the original strike-level contrast while matching the existing upright bank.
    target_peak = 0.67 if bank == "electric" else 0.68 * (0.71 + 0.29 * (layer - 1) / 15)
    gain = target_peak / peak
    file = f"{root}-{'v' + str(layer) if bank == 'grand' else 'single'}.ogg"
    target = CANDIDATE / "public" / "samples" / bank / file
    filters = f"atrim=start_sample={start}:end_sample={end},asetpts=PTS-STARTPTS,volume={gain:.8f}"
    if fade > 0.001:
        filters += f",afade=t=out:st={fade_start:.6f}:d={fade:.6f}"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(path), "-af", filters,
        "-c:a", "libvorbis", "-q:a", "5", "-map_metadata", "-1", str(target)
    ], check=True)
    dynamic = f"v{layer}" if bank == "grand" else "single"
    asset = {"root": root, "layer": dynamic, "file": file}
    if loop and start <= loop[0] < loop[1] <= end:
        asset["loop"] = [(edge - start) / rate for edge in loop]
    entry = {
        "path": target.relative_to(CANDIDATE).as_posix(),
        "origin": "pack",
        "packFile": path.relative_to(PACK).as_posix(),
        "rootNote": root,
        "velocityLayer": dynamic,
        "processing": (
            f"Trimmed {start / rate * 1000:.2f} ms of lead-in, kept {duration:.3f} seconds, "
            f"gain multiplied by {gain:.6f}, {fade:.3f} second end fade, "
            f"{rate / 1000:g} kHz {'stereo' if channels == 2 else 'mono'} Ogg Vorbis q5."
        ),
    }
    return bank, asset, entry


def main():
    jobs = []
    for path in sorted((PACK / GRAND).glob("*.flac")):
        match = re.fullmatch(r"(A|C|D#|F#)(\d)v(\d+)", path.stem)
        if not match:
            continue
        pitch, octave, layer = match.groups()
        root = (int(octave) + 1) * 12 + upright.NOTES[pitch]
        if 21 <= root <= 108 and int(layer) in DYNAMICS:
            jobs.append(("grand", path, root, int(layer)))
    for path in sorted((PACK / RHODES).glob("*.wav")):
        jobs.append(("electric", path, int(path.name.split("_")[1]), 0))
    for bank in ("grand", "electric"):
        (CANDIDATE / "public" / "samples" / bank).mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = sorted(pool.map(cut, jobs), key=lambda result: (result[0], result[1]["root"], result[1]["layer"]))

    details_path = CANDIDATE / "IMPLEMENTATION_DETAILS.json"
    details = json.loads(details_path.read_text())
    details["phase"] = 2
    details["audio"]["files"] = [
        entry for entry in details["audio"]["files"] if entry["path"].startswith("public/samples/upright/")
    ] + [entry for _, _, entry in results]
    sources = json.loads((PACK / "sample-sources.json").read_text())["sampleSources"]
    details["audio"]["sampleSources"] = [source for source in sources if source["id"] in {
        "salamander-grand-v3", "upright-piano-kw", "learman-rhodes-gm",
    }]
    details["audio"]["strategy"] = (
        "Three offline recorded banks. Salamander C5 uses five recorded dynamics with crossfades between layers. "
        "Upright Piano KW uses two recorded dynamics. Rhodes Mark I uses one recorded dynamic, velocity-sensitive gain "
        "and filtering, and the author’s sustain loops at runtime. Nearby roots are transposed during playback. "
        "Clavinet, FM Stage Piano, Rosewood Marimba and the fallback are synthesized. "
        "All audio passes through per-layer effects and one master path."
    )
    details["audio"]["generatedSources"] = [
        "Runtime additive, FM and inharmonic partial buffers for Clavinet, FM Stage Piano, Rosewood Marimba and the piano fallback.",
        "Runtime damped oscillator modes for sympathetic string resonance and seeded impulse responses for reverb.",
    ]
    details_path.write_text(json.dumps(details, indent=2, ensure_ascii=False) + "\n")
    for bank in ("grand", "electric"):
        assets = [asset for name, asset, _ in results if name == bank]
        (CANDIDATE / "src" / "piano" / f"{bank}-bank.json").write_text(json.dumps(assets, indent=2) + "\n")


if __name__ == "__main__":
    main()
