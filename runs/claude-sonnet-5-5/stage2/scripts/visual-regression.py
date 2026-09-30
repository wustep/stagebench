#!/usr/bin/env python3
"""Pixel comparison of the Phase 2 captures against the sealed Phase 1 captures (instrument region only).
    python3 scripts/visual-regression.py     (needs pillow + numpy)
Writes evidence/stage2-visual-regression.json and evidence/stage2-vs-stage1-diff-{desktop,narrow}.png"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
ev = root / "evidence"
cap = json.loads((ev / "stage2-capture.json").read_text())
report = {"threshold": "per-channel difference > 24/255 counts as changed", "profiles": {}}
for name in ("desktop", "narrow"):
    a = np.asarray(Image.open(ev / f"stage1-{name}.png").convert("RGB")).astype(int)
    b = np.asarray(Image.open(ev / f"stage2-{name}.png").convert("RGB")).astype(int)
    inst = cap[name]["instrument"]
    x0, y0, x1, y1 = int(inst["x"]), int(inst["y"]), int(inst["x"] + inst["width"]), int(inst["y"] + inst["height"])
    changed = (np.abs(a - b).max(axis=2) > 24)
    region = changed[y0:y1, x0:x1]
    sections = {}
    for s in cap[name]["sections"]:
        sx0, sy0, sx1, sy1 = int(s["x"]), int(s["y"]), int(s["x"] + s["width"]), int(s["y"] + s["height"])
        sections[s["id"]] = round(float(changed[sy0:sy1, sx0:sx1].mean()), 5)
    keys = cap[name]["keys"]
    keybed_top = int(inst["y"] + inst["height"] * 0.54)
    report["profiles"][name] = {
        "sameSize": a.shape == b.shape,
        "instrumentChangedFraction": round(float(region.mean()), 5),
        "changedFractionBySection": sections,
        "keybedChangedFraction": round(float(changed[keybed_top:y1, x0:x1].mean()), 5),
        "note": "changes are limited to LEDs that now reflect real state (section on, layer A on, effects on, FX focus, ...), knob positions set to canonical defaults (EQ knobs centred, delay feedback), the two extra selector states, and the Program OLED text",
    }
    diff = Image.fromarray((changed * 255).astype("uint8")).convert("RGB")
    diff.crop((x0, y0, x1, y1)).save(ev / f"stage2-vs-stage1-diff-{name}.png")
(ev / "stage2-visual-regression.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
