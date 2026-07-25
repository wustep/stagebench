import { describe, expect, it } from 'vitest'
import { peak } from '../audio/offline'
import { engineRig } from '../test/engineRig'
import type { EngineSettings, LayerKey } from '../audio/settings'
import { deckReducer, initialDeckState, type DeckState, type HardwareAction } from './hardware'
import { deriveSettings } from './settings'

/**
 * Layer routing across all seven playable layers of all three engines.
 *
 * Feature: layers.routing
 *
 * Every layer is driven from the panel exactly as its section's siblings are: an enable button, a
 * level fader, an octave shift that follows the section's focus, and an effect target that follows
 * the Layer Effects focus. Each of the four is asserted here for each of the seven layers, and the
 * enable state is then confirmed on rendered audio rather than on settings alone.
 */

function run(actions: HardwareAction[], from: DeckState = initialDeckState()): DeckState {
  return actions.reduce(deckReducer, from)
}

const press = (id: string): HardwareAction => ({ type: 'activate', id })
const set = (id: string, value: number): HardwareAction => ({ type: 'set', id, value })

interface LayerUnderTest {
  readonly key: LayerKey
  readonly section: 'organ' | 'piano' | 'synth'
  readonly layer: 'a' | 'b' | 'c'
  /** Actions that leave exactly this layer sounding, from the power-up panel. */
  readonly solo: HardwareAction[]
  readonly read: (settings: EngineSettings) => { enabled: boolean; level: number; octave: number }
}

const LAYERS: readonly LayerUnderTest[] = [
  {
    key: 'organ.a',
    section: 'organ',
    layer: 'a',
    solo: [press('organ.section-on'), press('piano.section-on')],
    read: (s) => s.organ.layers.a,
  },
  {
    key: 'organ.b',
    section: 'organ',
    layer: 'b',
    solo: [press('organ.section-on'), press('piano.section-on'), press('organ.a.on'), press('organ.b.on')],
    read: (s) => s.organ.layers.b,
  },
  { key: 'piano.a', section: 'piano', layer: 'a', solo: [], read: (s) => ({ ...s.layers.a }) },
  {
    key: 'piano.b',
    section: 'piano',
    layer: 'b',
    solo: [press('piano.a.on'), press('piano.b.on')],
    read: (s) => ({ ...s.layers.b }),
  },
  {
    key: 'synth.a',
    section: 'synth',
    layer: 'a',
    solo: [press('synth.section-on'), press('piano.section-on')],
    read: (s) => s.synth.layers.a,
  },
  {
    key: 'synth.b',
    section: 'synth',
    layer: 'b',
    solo: [press('synth.section-on'), press('piano.section-on'), press('synth.a.on'), press('synth.b.on')],
    read: (s) => s.synth.layers.b,
  },
  {
    key: 'synth.c',
    section: 'synth',
    layer: 'c',
    solo: [press('synth.section-on'), press('piano.section-on'), press('synth.a.on'), press('synth.c.on')],
    read: (s) => s.synth.layers.c,
  },
]

/** Which layer of a section the Layer Effects knobs are currently editing. */
function focusedLayerName(state: DeckState, section: 'organ' | 'piano' | 'synth'): string | null {
  if (state.fxSection !== section) return null
  if (section === 'organ') return state.organFocus
  if (section === 'synth') return state.synthFocus
  return state.focus
}

/** Renders one note through a whole deck state. */
function render(deck: DeckState, note = 60): number {
  const rig = engineRig({ settings: deriveSettings(deck) })
  rig.engine.noteOn('probe', note, 0.9)
  const level = peak(rig.graph.render(0.4))
  rig.engine.dispose()
  return level
}

describe('layer routing', () => {
  for (const layer of LAYERS) {
    const onId = `${layer.section}.${layer.layer}.on`
    const levelId = `${layer.section}.${layer.layer}.level`

    it(`routes enable, level, octave and effect target for ${layer.key}`, () => {
      const soloed = run(layer.solo)
      expect(layer.read(deriveSettings(soloed)).enabled).toBe(true)

      // Enable.
      const off = run([press(onId)], soloed)
      expect(layer.read(deriveSettings(off)).enabled).toBe(false)

      // Level: the fader position is the layer's own level and nobody else's.
      const quiet = run([set(levelId, 2)], soloed)
      const loud = run([set(levelId, 10)], soloed)
      expect(layer.read(deriveSettings(quiet)).level).toBeLessThan(layer.read(deriveSettings(loud)).level)
      expect(deriveSettings(quiet).masterLevel).toBe(deriveSettings(soloed).masterLevel)

      // Octave: the section's octave buttons move the focused layer of that section.
      const shifted = run([press(`${layer.section}.octave-up`)], soloed)
      expect(layer.read(deriveSettings(shifted)).octave).toBe(12)
      const back = run([press(`${layer.section}.octave-down`), press(`${layer.section}.octave-down`)], shifted)
      expect(layer.read(deriveSettings(back)).octave).toBe(-12)

      // Effect target: the Layer Effects focus button walks to this layer, and the edit lands
      // there. (Turning a layer on focuses it too; this proves the focus button on its own.)
      let focused = soloed
      for (let i = 0; i < 3 && focusedLayerName(focused, layer.section) !== layer.layer; i += 1) {
        focused = run([press(`fx.focus.${layer.section}`)], focused)
      }
      expect(focusedLayerName(focused, layer.section)).toBe(layer.layer)
      const reverbed = run([press('fx.reverb.on'), set('fx.reverb.dry-wet', 9.5)], focused)
      const chain =
        layer.section === 'organ'
          ? deriveSettings(reverbed).organ.chain
          : layer.section === 'piano'
            ? deriveSettings(reverbed).layers[layer.layer as 'a' | 'b'].chain
            : deriveSettings(reverbed).synth.layers[layer.layer].chain
      expect(chain.reverb.on).toBe(true)
      expect(chain.reverb.mix).toBeCloseTo(0.95, 6)
    })

    it(`hears ${layer.key} only while it is enabled`, () => {
      const soloed = run(layer.solo)
      expect(render(soloed)).toBeGreaterThan(0)
      expect(render(run([press(onId)], soloed))).toBe(0)
    })
  }

  it('keeps an effect edit on the focused layer instead of leaking to its sibling', () => {
    // Piano B focused: the edit belongs to B, and A keeps the setting it had.
    const focused = run([press('piano.b.on')])
    const edited = run([press('fx.mod1.on'), set('fx.mod1.amount', 9)], focused)
    const settings = deriveSettings(edited)
    expect(settings.layers.b.chain.mod1.on).toBe(true)
    expect(settings.layers.a.chain.mod1.on).toBe(false)

    // Refocusing A and reading the panel back gives A's own value, not B's.
    const backToA = run([press('fx.focus.piano')], edited)
    expect(backToA.focus).toBe('a')
    expect(backToA.values['fx.mod1.on']).toBe(0)
    expect(deriveSettings(backToA).layers.b.chain.mod1.on).toBe(true)
  })

  it('shares one chain between the organ layers and follows the focused one, as the panel prints', () => {
    const organ = run([press('organ.section-on'), press('organ.b.on')])
    expect(organ.organFocus).toBe('b')
    const edited = run([press('fx.delay.on'), set('fx.delay.dry-wet', 8)], organ)
    // One chain for the section: both layers are heard through the same units.
    expect(deriveSettings(edited).organ.chain.delay.on).toBe(true)
    const focusA = run([press('fx.focus.organ')], edited)
    expect(focusA.organFocus).toBe('a')
    expect(deriveSettings(focusA).organ.chain.delay.on).toBe(false)
  })

  it('gives each synth layer its own chain, so three layers are three chains', () => {
    const synth = run([press('synth.section-on'), press('synth.b.on'), press('synth.c.on')])
    const edited = run([press('fx.mod2.on')], synth)
    const chains = deriveSettings(edited).synth.layers
    expect(chains.c.chain.mod2.on).toBe(true)
    expect(chains.a.chain.mod2.on).toBe(false)
    expect(chains.b.chain.mod2.on).toBe(false)
  })
})
