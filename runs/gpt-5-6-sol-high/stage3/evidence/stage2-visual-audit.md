# Stage 2 visual audit

## Evidence provenance

The isolated implementation context had no connected browser backend, so it initially preserved explicitly labeled Stage 1 baseline copies. The browser-enabled parent subsequently replaced both files with fresh Stage 2 renders from `http://127.0.0.1:5175/`: `stage2-desktop.png` at 1440×900 and `stage2-narrow.png` at 390×844. These images include the newly added status/actions below the chassis.

The Stage 2 implementation deliberately leaves the instrument container, six-section grid, control-deck/keybed rows, chassis continuity, keyboard geometry, and responsive scaling rules unchanged. Functional state is threaded into existing controls. The only layout additions are a compact status/action row and keyboard hint below the instrument; no region was added above the instrument.

## Measured baseline comparison

| Measurement | Primary contract | Desktop baseline | Stage 2 CSS/source verification |
| --- | ---: | ---: | --- |
| Viewport | 1440 × 900 | 1440 × 900 | Required viewport retained |
| Instrument bounds | 88–97% viewport width | x = 43.2, y = 209, w = 1353.6, h = 437.3 | `width: 94vw`; aspect ratio unchanged |
| Width fraction | 0.88–0.97 | ≈ 0.94 | 0.94 |
| Aspect ratio | 3.0951 | ≈ 3.095 | `3.0951 / 1` |
| Deck / keybed | 54% / 46% | 54% / 46% | Grid rows remain 4.2 + 49.8 / 43.5 + 2.5 |
| Section fractions | 13 / 21 / 15 / 9 / 21 / 21% | Matches | Hardware map unchanged |
| Keys | 73 total; 43 white / 30 black | 73 / 43 / 30 | Model and regression tests pass |
| Narrow viewport | 390 × 844 | Chassis 374.4×121 at x = 7.8; document width 390 | Instrument remains `96vw`, whole-surface scaling retained |

## Interaction and console state

- Deterministic UI tests exercise pointer/touch note velocity, mapped computer keys, visual pressed state, sustain, panic, contextual status, and inherited control interactions.
- MIDI tests exercise connected routing, disconnection, permission denial, note velocity, note-on-zero, and sustain CC64 without physical hardware.
- The parent browser toggled Sustain from off to on, clicked C4, observed `WHITE GRAND · 1 VOICE · SAMPLE PIANO READY`, then released sustain and used Panic. C4, Sustain, and Panic each resolved to one accessible button.
- Fresh desktop and narrow passes reported no browser warnings or errors and no horizontal overflow. Live physical MIDI remained unavailable, so MIDI behavior is supported by the deterministic fake-device tests.
- Production build, TypeScript, ESLint, and all deterministic tests pass; those checks reported no compile-time or test-runtime errors.

## Three most visible remaining deviations

1. At 390 px, the complete hardware remains visible but legends and most control details are necessarily very small compared with a dedicated scroll/zoom inspection view.
2. The DOM/CSS panel abstracts several physical legends and irregular control spacings; the Performance and Piano areas remain less mechanically exact than the primary photograph even though the measured silhouette and allocations match.
3. Browser permission constraints prevent physical MIDI confirmation in automated evidence, although connection, denial, disconnection, note, velocity, and sustain messages are covered with fake-device tests.
