# Phase 4 visual audit

The Phase 4 surface preserves the verified Stage 3 1440×900 desktop and 390×844 narrow geometry: continuous red chassis, 43 white + 30 black E-to-E keybed, six ordered sections, and Program/Synth-only OLEDs. `stage4-desktop.png` and `stage4-narrow.png` retain that measured capture because the Codex in-app browser (`iab`) was unavailable during this agent pass; no layout code changed for the Organ/Synth audio boundary. The Vite build was verified with `pnpm build`, and direct Phase 4 tests exercise the new controls and shared graph.

Audit checklist:

- Organ controls remain in the dark inset section with nine drawbars, LEDs, model/percussion/rotary controls and no new OLED.
- Synth keeps its sole OLED and oscillator/filter/envelope/LFO/arp clusters; source and engine state are canonical rather than decorative.
- Program, split, scene, morph, focus and effect controls remain inherited and route to one master graph.
- Narrow layout remains horizontally scrollable without changing key count or section order.

Limitation: a fresh browser interaction screenshot with Organ/Synth gestures could not be produced because no in-app browser or local headless Chromium binary was available in this environment. The deterministic engine boundary and UI bindings are covered by `tests/phase4.test.ts` and the full pnpm gate run.
