# Stage 4 73 — Phase 1

Run `pnpm install --frozen-lockfile`, then `pnpm dev`. The keybed plays one original synthesized piano voice. Click/touch keys, or use A W S E D F T G Y H U J K O L P ; for C4–E5. Space sustains when focus is outside a button/range; focused piano keys also play with Enter/Space. MIDI connects only on request and accepts notes, velocity and CC64. All notes off, blur, MIDI disconnect and unmount clear owned voices.

All physical panel controls are decorative: buttons toggle lights, ranges move their knobs/caps, and no panel control changes sound or functional program state. Drag ranges vertically or use their arrow keys. The utility sustain button is functional and separate from the panel. The Inspect slider provides a fitted overview and enlargement with horizontal scrolling on narrow screens.

Required checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Unit tests need no network, MIDI hardware or audio output. Optional browser verification: install Chromium locally with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" pnpm exec playwright install chromium --only-shell`, keep the Vite server running, then run `node tests/browser-check.mjs`. This generates the saved viewport captures and measurements; it is a substitute for the absent parent capture harness.

See `IMPLEMENTATION_DETAILS.json` for audio provenance and scope, `tests/feature-matrix.json` for required feature coverage, and `stage1-visual-audit.md` for measurements and declared deviations. No sealing step has been performed.
