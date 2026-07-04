// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEngine, rms, zeroCrossingRate } from '../test/offline'
import { ORGAN_PRESETS } from '../model/presets'

/**
 * programs.preset-library — ORGAN bank rendered proof (manual p. 41).
 * Loading a factory Organ preset is an ordinary state edit, so the same
 * engine graph renders it: two presets with very different registrations
 * ('Flute Duet' — the two soft Farf flute registers only; 'Bright
 * Principal' — Pipe 2's bright principal chorus with the high ranks out)
 * must produce audibly distinct signals. Both avoid the rotary path so the
 * brightness measurement isolates the registration itself.
 */

async function renderOrganPreset(name: string) {
  const index = ORGAN_PRESETS.findIndex((p) => p.name === name)
  expect(index).toBeGreaterThanOrEqual(0)
  return renderEngine({
    duration: 1.4,
    configure: (store) => {
      store.setPianoSectionOn(false)
      store.enterPresetBrowse('organ', false)
      store.loadOrganPreset(index)
      store.exitPresetBrowse(true) // keep the loaded sound (manual p. 42)
    },
    steps: [
      { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
      { time: 1.1, run: ({ engine }) => engine.noteOff(60) },
    ],
  })
}

describe('programs.preset-library — organ rendered proof', () => {
  it('two organ presets with different registrations render distinct audio', async () => {
    const flutes = await renderOrganPreset('Flute Duet')
    const principal = await renderOrganPreset('Bright Principal')
    // Both presets audibly sound…
    expect(rms(flutes.left, 0.2, 1.0)).toBeGreaterThan(0.002)
    expect(rms(principal.left, 0.2, 1.0)).toBeGreaterThan(0.002)
    // …and the bright principal registration's zero-crossing rate dwarfs
    // the two-flute registration's.
    const flutesZcr = zeroCrossingRate(flutes.left, 0.2, 1.0)
    const principalZcr = zeroCrossingRate(principal.left, 0.2, 1.0)
    expect(principalZcr).toBeGreaterThan(flutesZcr * 2)
  }, 240000)
})
