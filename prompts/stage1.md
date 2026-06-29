# Phase 1 - Visual Recreation

Work only inside the assigned `stage1` directory. Read these sources before writing code:

1. `BENCHMARK.md`
2. `TESTING.md`
3. `specs/benchmark-phases.json` Phase 1
4. `specs/nord-stage-4-73.visual.json`
5. `reference/nord-stage-4-73.jpg` at full resolution

The product image is the visual source of truth. This is the Nord Stage 4 73, not the Compact 73. Do not render the photograph inside the application.

## Non-negotiable outcome

Build a React + TypeScript product-study recreation whose chassis, section boundaries, keyboard, control hierarchy, density, and primary landmarks match the reference before micro-detail is added. The instrument must be the first and dominant content, not a landing page.

Use pnpm exclusively. Declare the current pnpm version in `packageManager`, retain `pnpm-lock.yaml`, and configure Vite with `base: './'`.

## Required implementation order

### 1. Measure and plan

Before implementation, create `IMPLEMENTATION_PLAN.md` and record:

- the assigned spec filename and a verbatim `Hard gates` checklist from Phase 1 of `specs/benchmark-phases.json`;
- measured 3.095:1 chassis bounds;
- 54/46 control-deck/keybed allocation;
- all six section widths;
- 43-white/30-black E-to-E key model;
- required and forbidden section landmarks from the visual spec;
- per-section control groups, approximate density, and control-size hierarchy;
- a component/data model that gives every control a stable ID.

Do not start with a generic control grid. Define section-specific hardware data first.

### 2. Build structural geometry

Implement the continuous red chassis, rails, end cheeks, six panel regions, and exact keybed before small controls. At 1440x900 the instrument must occupy 88-97% of viewport width and remain visible without vertical scrolling.

Hard failures:

- detached frame pieces or white gaps through the red chassis;
- an uninterrupted charcoal slab replacing the red structure;
- fewer or more than 73 keys;
- invented OLED displays in Organ, Piano, or Layer Effects;
- a marketing hero or decorative stage above the instrument.

### 3. Build reference-specific controls

Add the distinct clusters from the photograph: Performance wheels and master controls, nine Organ drawbars, compact Piano selectors, central Program display/keypad, dense Synth groups, and the Layer Effects matrix. Prefer fewer correctly placed controls over repeated placeholders.

Only Program and Synth have primary OLED displays. Performance remains exposed red metal.

### 4. Add interaction and accessibility

Every visible control must expose a stable accessible name and deliberate state. Keys depress, buttons/LEDs toggle coherently, knobs/encoders support pointer and keyboard adjustment, displays illuminate, and focus-visible treatment is clear. Interaction state must come from the normalized hardware model rather than isolated component-only state.

## Test and repair loop

Use a red-green-refactor loop. Maintain every Phase 1 feature ID in `tests/feature-matrix.json` and test exact section landmarks, control counts, key geometry, state transitions, and accessibility.

Complete two measured desktop repair passes:

1. Capture 1440x900 and crop both reference and render to chassis bounds.
2. Compare forbidden hardware, section boundaries, control placement/density, chassis/key geometry, materials, then typography.
3. Record the largest five discrepancies in `evidence/stage1-visual-audit.md`.
4. Fix at least the three largest structural discrepancies.
5. Repeat the desktop capture and add a 390x844 narrow capture.

Save:

- `evidence/stage1-desktop.png`
- `evidence/stage1-narrow.png`
- `evidence/stage1-visual-audit.md`

The audit must include measured bounds, section ratios, exact key counts, forbidden-landmark results, console state, corrections made, and remaining deviations. Resolve console errors and clipped/overflowing controls.

Create `IMPLEMENTATION_DETAILS.json` with Phase 1 and `None (visual-only phase)` audio strategy. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` before reporting completion.

Do not begin audio work in this phase.
