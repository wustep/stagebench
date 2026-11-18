"""Cut the declared Upright Piano KW recordings and rebuild the sample manifests."""
import array
import json
from pathlib import Path
import subprocess

CANDIDATE = Path(__file__).resolve().parents[1]
PACK = CANDIDATE.parent / "inputs" / "samples"
SOURCE = "upright/upright-piano-kw/samples"
NOTES = {"C": 0, "D#": 3, "F#": 6, "A": 9, "B": 11}
RATE = 44100
MAX_SECONDS = 8


def root_number(name):
    return (int(name[-3]) + 1) * 12 + NOTES[name[:-3]]


def cut_sample(source, target):
    samples = array.array("f", subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(source), "-f", "f32le", "-"
    ]))
    peak = max(abs(sample) for sample in samples)
    threshold = peak * 0.006
    attack = next(index // 2 for index, sample in enumerate(samples) if abs(sample) >= threshold)
    start = max(0, attack - round(RATE * 0.002))
    end = min(len(samples) // 2, start + RATE * MAX_SECONDS)
    fade_length = min(RATE * 0.35, (end - start) * 0.2)
    duration = (end - start) / RATE
    gain = 0.74 / peak
    filters = ",".join([
        f"atrim=start_sample={start}:end_sample={end}",
        "asetpts=PTS-STARTPTS",
        f"volume={gain:.8f}",
        f"afade=t=out:st={duration-fade_length/RATE:.6f}:d={fade_length/RATE:.6f}",
    ])
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(source), "-af", filters,
        "-c:a", "libvorbis", "-q:a", "5", "-map_metadata", "-1", str(target)
    ], check=True)
    return (
        f"Trimmed {start / RATE * 1000:.2f} ms of lead-in, kept {duration:.3f} seconds, "
        f"gain multiplied by {gain:.6f}, {fade_length/RATE:.3f} second end fade, "
        "44.1 kHz stereo Ogg Vorbis q5."
    )


def main():
    target_dir = CANDIDATE / "public" / "samples" / "upright"
    target_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    assets = []
    for source in sorted((PACK / SOURCE).glob("*.flac"), key=lambda file: (root_number(file.stem), file.stem)):
        root = root_number(source.stem)
        layer = "soft" if source.stem.endswith("L") else "firm"
        if not 27 <= root <= 102 or (source.stem.startswith("B") and root != 59):
            continue
        file = f"{root}-{layer}.ogg"
        target = target_dir / file
        manifest.append({
            "path": str(target.relative_to(CANDIDATE)),
            "origin": "pack",
            "packFile": SOURCE + "/" + source.name,
            "rootNote": root,
            "velocityLayer": layer,
            "processing": cut_sample(source, target),
        })
        assets.append({"root": root, "layer": layer, "file": file})

    all_sources = json.loads((PACK / "sample-sources.json").read_text())["sampleSources"]
    details = {
        "$schema": "https://stagebench.local/schemas/implementation-details.schema.json",
        "version": 1,
        "phase": 1,
        "audio": {
            "strategy": "One recorded acoustic upright voice with two recorded dynamics and runtime pitch transposition from neighboring roots. Deterministic additive synthesis plays while the bank loads or if the bank is unavailable.",
            "sampleSources": [source for source in all_sources if source["id"] == "upright-piano-kw"],
            "generatedSources": ["In-memory damped partial buffers created on demand by src/piano/sound.ts. No generated audio files are bundled."],
            "files": manifest,
        },
    }
    (CANDIDATE / "IMPLEMENTATION_DETAILS.json").write_text(json.dumps(details, indent=2) + "\n")
    (CANDIDATE / "src" / "piano" / "upright-bank.json").write_text(json.dumps(assets, indent=2) + "\n")


if __name__ == "__main__":
    main()
