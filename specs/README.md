# Stagebench specifications

These files convert the Nord Stage 4 reference photograph and the Nord Stage 4 User Manual (fetched to reference/manual.pdf) into machine-readable implementation contracts.

## Precedence

1. The fetched product image (reference/nord-stage-4-73.jpg) is authoritative for visible layout and materials.
2. The fetched manual is authoritative for behavior and parameter relationships.
3. `benchmark-phases.json` assigns specs and hard gates to benchmark phases.
4. The domain specs summarize the manual with page citations; they do not replace it when a behavior is ambiguous.

## Files

- `nord-stage-4.visual.json` - shared control-deck chassis, section, and presentation geometry (variant-neutral).
- `nord-stage-4.variants.json` - the three hardware variants (88, 73, Compact 73): per-variant keybed, reference image, and silhouette. Each run targets one.
- `nord-stage-4.piano.json` - Piano layers, source selection, playing behavior, and piano controls.
- `nord-stage-4.programs.json` - Programs, morphs, splits, scenes, presets, live mode, and editing workflows.
- `nord-stage-4.effects.json` - effect instances, focus/group/global behavior, effect types, parameters, and signal order.
- `nord-stage-4.organ.json` - Organ layers, models, drawbars/registers, percussion, vibrato, and rotary behavior.
- `nord-stage-4.synth.json` - Synth layers, sources, oscillators, filters, envelopes, LFO, voice modes, and arpeggiator/gate.
- `benchmark-phases.json` - four-phase ownership, completion gates, and required evidence.

All normalized values use `0..1` unless a unit is explicitly stated. Manual page numbers refer to the printed page number, which matches the PDF page number for the referenced chapters.
