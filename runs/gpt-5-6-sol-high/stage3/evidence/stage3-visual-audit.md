# Stage 3 visual audit

## Evidence provenance

The isolated Stage 3 context had no browser backend, so it initially preserved explicitly labeled Stage 2 geometry baselines. The browser-enabled parent subsequently replaced them with fresh Stage 3 captures from `http://127.0.0.1:5176/`: `stage3-desktop.png` at 1440×900 and `stage3-narrow.png` at 390×844. The Stage 3 source keeps the chassis, section grid, deck/keybed allocation, responsive whole-instrument scaling, and key model unchanged. It adds only compact hardware controls inside existing panel groups; it adds no region above or beside the instrument.

The fresh desktop render measured a **1353.4×437.3px** chassis at `x=43.3`, a **215.8px** deck, and a **186px** keyboard region. The fresh narrow render measured a **374.4×121px** chassis at `x=7.8` within a 390px document. Both passes reported no browser warnings or errors. Runtime behavior is also covered by 41 deterministic tests, including a rendered App integration test that exercises Stage 3 layer, split, Synth, preset, menu, effect, and focus controls. TypeScript, ESLint, and the production build pass.

## Measured reference and inherited-render comparison

| Measurement | Primary contract | Preserved Stage 2 render | Stage 3 source/model verification |
| --- | ---: | ---: | --- |
| Desktop viewport | 1440 × 900 | 1440 × 900 | Required evidence dimensions retained |
| Instrument bounds | 88–97% viewport width | x = 43.3, y = 209.3, w = 1353.4, h = 437.3 | `width: 94vw`; aspect ratio remains `3.0951 / 1` |
| Width fraction | 0.88–0.97 | ≈ 0.94 | 0.94 |
| Deck / keybed | 54% / 46% | 54% / 46% | Grid rows remain 4.2 + 49.8 / 43.5 + 2.5 |
| Section fractions | 13 / 21 / 15 / 9 / 21 / 21% | Matches | Hardware map remains exactly normalized to the same six fractions |
| Keys | 73 total; 43 white / 30 black | 73 / 43 / 30 | Inherited key/model tests remain green |
| Narrow viewport | 390 × 844 | Chassis 374.4×121 at x = 7.8 | `96vw` whole-surface scaling and no alternate dashboard retained |

## Stage 3 interaction verification

- Organ tests exercise drawbar bounds, six model identities, percussion modes, rotary speed/drive routing, retrigger, independent layer voices, and panic cleanup.
- Synth tests exercise waveform/shape/detune, four filter modes, ADR envelope and sustain level, LFO destination/rate/amount, live parameter updates, independent layer voices, and cleanup.
- Routing tests exercise seven enabled/focused/leveled layers, engine and effect assignments, three split points, four zones, and notes immediately below/at each boundary.
- Effects tests enumerate all 17 benchmark effects and verify per-layer/shared-Organ targeting, dry/wet mix, bypass, type replacement, and ordering.
- The rendered App test operates section enable, C4 split, Synth C focus, waveform editing, preset browser/menu navigation, program Store, FX focus, and effect type editing.
- The parent live pass opened and closed the Context menu, enabled the C4 keyboard split, enabled the Synth section, and played C4. Each control resolved uniquely through its accessible name; the status changed to `SPLIT C4` and the Program display changed to its menu state.

## Three most visible remaining deviations

1. At 390 px the complete hardware is visible, but legends and control detail are necessarily tiny because the physical surface scales as one instrument rather than becoming a generic stacked dashboard.
2. The DOM/CSS hardware remains an abstraction of several irregular physical legends and switch spacings, especially in Performance and Program, even though the measured silhouette, section ratios, material hierarchy, and key count are preserved.
3. Physical MIDI and audible comparison of all three engines/effect chains remain outside automated browser evidence; deterministic fake-boundary and routing tests cover those paths.
