# Stage 1 visual audit

## Reference contract

| Measurement | Reference | Implemented contract |
| --- | ---: | ---: |
| Instrument aspect ratio | 3.0951:1 | 3.0951:1 |
| Desktop width | 88–97% of 1440px | 94vw = 1353.6px target |
| Control deck / keybed | 54% / 46% | 54% / 46% grid rows |
| Performance / Organ / Piano / Program / Synth / Effects | 13 / 21 / 15 / 9 / 21 / 21% | 13 / 21 / 15 / 9 / 21 / 21 normalized fractions |
| Keyboard | 73 total; 43 white, 30 black; E–E | 73 total; 43 white, 30 black; E1–E7 |
| Black-key height | 61% | 61% |

The application renders one `.instrument[data-chassis]` element around the top rail, six inset panels, connected end cheeks, 73-key keyboard, and bottom rail. The supplied photograph is not loaded by the application and is not used as a texture, background, or overlay.

## Control inventory and dominant color check

- Six ordered panels are rendered from the normalized hardware map with 132 stable control IDs.
- Dominant colors follow the measured reference: mid-red `#79232c`, dark red `#721f29` family, blue-gray panels `#3c424d`, black keys `#0b0b0b`, and warm white keys near `#dcdcdc`.
- Material accents include black rotary caps with white indices, mixed fader caps, silver/gray switches, red LEDs, green/yellow level meters, blue-green OLEDs, and fine white legends.
- Density is intentionally asymmetric: sparse wheels and performance area; nine-drawbar Organ bank; selector-heavy Piano; central Program display/keypad; multi-column Synth; dense effects matrix.

## Screenshot pass 1 — desktop structural comparison

Parent browser measurement at **1440×900**: chassis **1353.6×437.3px** (**3.095:1**), control deck **215.8px**, keyboard region **186px**, **43 white / 30 black** keys, and no horizontal or vertical overflow. The measured geometry, allocation, and key model match the reference contract.

Preflight corrections already applied before capture:

1. Replaced equal-width generic panel columns with the measured six-section fractions.
2. Consolidated previously separate-looking frame pieces into one continuous red chassis with inset control plates and connected end cheeks.
3. Corrected the keyboard to the full 73-key E1–E7 model and tied every black-key position to the 43-white-key geometry.

## Screenshot pass 2 — corrected desktop

Required final file: `evidence/stage1-desktop.png` at **1440×900**.

The second-pass code correction keeps the measured geometry fixed and addresses the three largest remaining reference mismatches:

1. **Performance material:** removed the full slate-panel treatment from Performance. Its vertical pitch/mod hardware, master controls, and Nord Stage 4 logo now sit directly on exposed muted red chassis metal, as in the photograph.
2. **Chassis separation:** increased the red reveal between all six control sections and reinforced the surrounding red deck shading so the inset plates no longer read as one continuous charcoal slab.
3. **Top framing:** strengthened the red top rail with brighter upper metal, a darker lower seam, and more physical highlight/shadow depth while retaining the same 4.2% rail row and overall 54/46 allocation.

The browser-enabled parent captured the final pass at **1440×900**. The chassis measured **1353.1×437.2px** (**3.095:1**) at `x=43.4`, the control deck measured **215.7px**, and the keyboard region measured **185.9px**. The document remained exactly **1440px** wide with no overflow, all **43 white / 30 black** keys were present, and the browser reported no warnings or errors. Final evidence: `evidence/stage1-desktop.png`. The first comparison pass is retained as `evidence/stage1-desktop-pass1.png`.

## Narrow verification

Required final file: `evidence/stage1-narrow.png` at **390×844**.

The browser-enabled parent captured the narrow pass at **390×844**. The chassis measured **374.4×121px** at `x=7.8`, the control deck measured **59.2px**, and the keyboard measured **353.8×51.2px**. The document and viewport both measured **390px** wide, so the complete chassis and all 73 keys remained within the viewport without horizontal overflow. The compact status line remained below the instrument and the browser reported no warnings or errors. Final evidence: `evidence/stage1-narrow.png`.

## Remaining visible deviations

1. Browser text cannot match the manufacturer’s proprietary panel lettering exactly; the recreation uses condensed locally available fallbacks.
2. Fine jack labels on the rear/top rail are simplified because they are barely visible in the source top-down photograph.
3. Some tiny legends consolidate multi-line manufacturer copy, while control group, type, relative scale, material, and interaction remain represented.

## Console and interaction state

Automated component tests cover key press/release, button/LED state, knob pointer and keyboard changes, clamping, semantic roles, focusability, stable panel models, exact key counts, and chassis continuity. The parent browser pass confirmed a clean warning/error console at desktop and narrow widths and an accessibility tree containing named buttons and sliders for the hardware surface.
