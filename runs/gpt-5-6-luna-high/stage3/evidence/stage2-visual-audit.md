# Stage 2 visual audit

## Capture

- Desktop: `stage2-desktop.png` at 1440×900.
- Narrow: `stage2-narrow.png` at 390×844.
- The 1440 capture keeps the instrument fully visible with the inherited 3.0951 silhouette, continuous red chassis, 54/46 deck/keybed allocation, and 13/21/15/9/21/21 section grid.

## Comparison and repair

The Phase 2 pass was compared with the inherited Phase 1 evidence and the visual contract. Section boundaries, OLED inventory, key count and red cheek continuity are unchanged. The Piano panel gained a compact status line (`model/fallback ready`, active voices and MIDI availability) without adding an OLED or changing panel width. Desktop controls remain inside the chassis; narrow mode intentionally preserves the 820px hardware canvas and horizontal scroll behavior.

Largest remaining differences from the product photograph are the inherited product-study simplifications: printed legends are less granular, Organ/Effects controls are represented by compact DOM controls, and the Piano model list is a small canonical selector rather than Nord's full sample browser. These are functional scope limitations, not geometry drift.

## Interaction / console

Pointer, touch, mapped computer-keyboard, sustain, Panic and blur cleanup were exercised through the shared lifecycle tests. The browser capture produced only Vite/React informational messages; the macOS headless-shell sandbox emitted its own system-services warning, not an application error. MIDI status is explicit and remains `MIDI unavailable` when the browser does not expose `requestMIDIAccess`.

## Quality-repair pass

The Piano header now keeps the existing compact footprint while exposing model index, touch/dynamic settings, layer levels, active voices, AudioContext readiness/fallback, and MIDI connection state. Added Soft Pedal and Sostenuto controls remain inside the inherited panel grid; no section width, chassis rail, key geometry, or OLED inventory changed. Desktop and narrow captures were refreshed after the audio lifecycle repair.
