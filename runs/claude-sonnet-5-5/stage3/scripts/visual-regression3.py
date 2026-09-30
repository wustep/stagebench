#!/usr/bin/env python3
"""Pixel comparison of the Phase 3 captures against the sealed Phase 2 captures (instrument region only).
    python3 scripts/visual-regression3.py     (needs pillow + numpy)
Writes evidence/stage3-visual-regression.json and evidence/stage3-vs-stage2-diff-{desktop,narrow}.png"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
ev = root / "evidence"
cap = json.loads((ev / "stage3-capture.json").read_text())
report = {"threshold": "per-channel difference > 24/255 counts as changed", "profiles": {}}
for name in ("desktop", "narrow"):
    a = np.asarray(Image.open(ev / f"stage2-{name}.png").convert("RGB")).astype(int)
    b = np.asarray(Image.open(ev / f"stage3-{name}.png").convert("RGB")).astype(int)
    same = a.shape == b.shape
    inst = cap[name]["instrument"]
    x0, y0, x1, y1 = int(inst["x"]), int(inst["y"]), int(inst["x"] + inst["width"]), int(inst["y"] + inst["height"])
    if not same:
        report["profiles"][name] = {"sameSize": False}
        continue
    changed = (np.abs(a - b).max(axis=2) > 24)
    region = changed[y0:y1, x0:x1]
    sections = {}
    for s in cap[name]["sections"]:
        sx0, sy0, sx1, sy1 = int(s["x"]), int(s["y"]), int(s["x"] + s["width"]), int(s["y"] + s["height"])
        sections[s["id"]] = round(float(changed[sy0:sy1, sx0:sx1].mean()), 5)
    keybed_top = int(inst["y"] + inst["height"] * 0.54)
    report["profiles"][name] = {
        "sameSize": True,
        "instrumentChangedFraction": round(float(region.mean()), 5),
        "changedFractionBySection": sections,
        "keybedChangedFraction": round(float(changed[keybed_top:y1, x0:x1].mean()), 5),
        "note": "NOT a like-for-like comparison: the sealed Phase 2 capture was made with Playwright Chromium 149, this one with Chrome for Testing 154, so font rasterisation and antialiasing differ everywhere and the changed fractions are an upper bound dominated by rendering differences. Real Phase 3 changes are the canonical default state shown on organ drawbars and synth faders, LEDs (effect focus, zone LEDs, amp velocity), the two OLEDs, the split LEDs on the rail and the status bar. Geometry is checked separately in stage3-capture.json (section fractions, 73 keys, 54/46 split).",
    }
    Image.fromarray((changed * 255).astype("uint8")).convert("RGB").crop((x0, y0, x1, y1)).save(ev / f"stage3-vs-stage2-diff-{name}.png")
(ev / "stage3-visual-regression.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
