#!/usr/bin/env python3
"""
Validates public/samples/: every manifest parses, every listed file exists, roots lie inside the declared range,
velocity layers tile 1..127 without gaps or overlaps, files are sorted by root then layer, and index.json agrees
with the manifests. Prints one row per set (files, bytes, layers, largest gap between consecutive roots per layer).

Usage: validate.py [public/samples]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "public/samples")
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    problems: list[str] = []
    print(f"{'set':26s} {'type':9s} {'model':22s} {'licence':12s} {'files':>5s} {'bytes':>9s} {'layers':>6s} {'max gap':>7s} {'roots':>13s}")
    total_bytes = 0
    for entry in index["sets"]:
        d = root / entry["id"]
        m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        for key in ("id", "type", "model", "kind", "source", "format", "sampleRate", "channels", "layers", "range", "files", "processing", "notes"):
            if key not in m:
                problems.append(f"{m.get('id', d.name)}: manifest lacks {key}")
        for key in ("name", "author", "url", "license", "licenseUrl"):
            if not m["source"].get(key):
                problems.append(f"{m['id']}: source lacks {key}")
        if m["id"] != entry["id"] or m["type"] != entry["type"] or m["model"] != entry["model"]:
            problems.append(f"{m['id']}: index.json disagrees with the manifest")
        layers = sorted(m["layers"], key=lambda l: l["lovel"])
        if [l["index"] for l in m["layers"]] != list(range(len(m["layers"]))):
            problems.append(f"{m['id']}: layer indexes are not 0..n-1")
        expected_lo = 1
        for l in layers:
            if l["lovel"] != expected_lo:
                problems.append(f"{m['id']}: layer {l['name']} starts at {l['lovel']}, expected {expected_lo}")
            expected_lo = l["hivel"] + 1
        if expected_lo != 128:
            problems.append(f"{m['id']}: layers end at {expected_lo - 1}, expected 127")
        bytes_ = 0
        keys = []
        per_layer_roots: dict[int, list[int]] = {}
        for f in m["files"]:
            p = d / f["file"]
            if not p.exists():
                problems.append(f"{m['id']}: missing {f['file']}")
                continue
            bytes_ += p.stat().st_size
            if not (m["range"]["lowestRoot"] <= f["root"] <= m["range"]["highestRoot"]):
                problems.append(f"{m['id']}: {f['file']} root {f['root']} outside range")
            if f["layer"] >= len(m["layers"]):
                problems.append(f"{m['id']}: {f['file']} layer {f['layer']} undefined")
            if f["file"] != f"{f['root']:03d}-l{f['layer']}.ogg":
                problems.append(f"{m['id']}: {f['file']} is not named <root>-l<layer>.ogg")
            keys.append((f["root"], f["layer"]))
            per_layer_roots.setdefault(f["layer"], []).append(f["root"])
        if keys != sorted(keys):
            problems.append(f"{m['id']}: files are not sorted by root then layer")
        if len(keys) != len(set(keys)):
            problems.append(f"{m['id']}: duplicate root/layer entries")
        if bytes_ != entry["bytes"] or len(m["files"]) != entry["files"]:
            problems.append(f"{m['id']}: index.json bytes/files stale")
        max_gap = 0
        for roots in per_layer_roots.values():
            roots.sort()
            max_gap = max([max_gap] + [b - a for a, b in zip(roots, roots[1:])])
        total_bytes += bytes_
        print(f"{m['id']:26s} {m['type']:9s} {m['model']:22s} {m['source']['license']:12s} {len(m['files']):5d} {bytes_:9d} {len(m['layers']):6d} {max_gap:7d} {m['range']['lowestRoot']:>6d}-{m['range']['highestRoot']:<6d}")
    print(f"total {total_bytes / 1e6:.2f} MB in {len(index['sets'])} sets")
    for p in problems:
        print("PROBLEM:", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
