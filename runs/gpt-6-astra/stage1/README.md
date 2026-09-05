# Nord Stage 4 73 — Phase 1

A React/TypeScript instrument study with a 73-key E1–E7 keybed, one original synthesized piano voice and 155 accessible presentation-only panel controls. No Nord samples or other recordings are used.

Run with Node 22.13+ and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Play with pointer or independent touch, computer keys A/W/S/E/D/F/T/G/Y/H/U/J/K/O/L/P/;/', or MIDI. Space and the external Sustain button hold notes. Activate audio retries a failed audio initialization. Stop notes clears every input. The panel does not change sound. Inspect surface provides a scrollable enlarged view on narrow screens.

Validation:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers pnpm exec playwright install chromium
pnpm test:browser
```

The browser pass serves dist/, operates every panel input with keyboard and pointer, tests independent touch, keyboard, cancel/blur, and renders the actual audio graph offline. It then invokes the workspace-local parent capture module. No physical audio output, MIDI device, or external network is needed once dependencies and Chromium are installed.

See IMPLEMENTATION_DETAILS.json for audio provenance and limitations, tests/feature-matrix.json for coverage, and evidence/ for canonical captures and the measured visual audit. This candidate is not sealed by these scripts.
