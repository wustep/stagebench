import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FxChain, Rotor } from '../src/audio/dsp/effects'
import { LAYER_COUNT, defaultSoundState } from '../src/audio/dsp/params'
import { StageKernel } from '../src/audio/dsp/stage'
import { FUNCTIONAL_CONTROL_IDS } from '../src/hardware/functional'
import { INVENTORY } from '../src/hardware/inventory'
import { PIANO_TYPES } from '../src/piano/catalog'
import { createInitialState, deriveSound } from '../src/state/model'
import { makeRig, renderKernel } from './support/rig'
import { SR, equal, rms } from './support/signal'
import matrix from './feature-matrix.json'

/**
 * Feature: regression.phase2
 * All Phase 1–2 tests remain green.
 *
 * "Green" is the test run itself: every Phase 1 and Phase 2 suite is part of `pnpm test` and is
 * listed under this feature in the matrix. This file guards "present": no inherited suite,
 * test, or piece of evidence may quietly disappear, and the Phase 2 instrument — a plain grand
 * piano with its effects — must still be what the Phase 3 instrument starts as.
 */

/** Each Phase 2 suite and the number of `it(` blocks it had when Phase 2 was sealed. */
const PHASE_2_SUITES: Record<string, number> = {
  'tests/piano.instrument-library.test.tsx': 18,
  'tests/piano.layers.test.tsx': 16,
  'tests/piano.velocity-controls.test.tsx': 27,
  'tests/piano.pedals.test.tsx': 12,
  'tests/piano.fallback.test.tsx': 12,
  'tests/effects.graph.test.tsx': 20,
  'tests/effects.routing.test.tsx': 22,
  'tests/effects.processing.test.ts': 44,
  'tests/regression.phase1.test.ts': 10,
}

const PHASE_2_FEATURES: Record<string, string> = {
  'piano.instrument-library': 'tests/piano.instrument-library.test.tsx',
  'piano.layers': 'tests/piano.layers.test.tsx',
  'piano.velocity-controls': 'tests/piano.velocity-controls.test.tsx',
  'piano.pedals': 'tests/piano.pedals.test.tsx',
  'piano.fallback': 'tests/piano.fallback.test.tsx',
  'effects.graph': 'tests/effects.graph.test.tsx',
  'effects.routing': 'tests/effects.routing.test.tsx',
  'effects.processing': 'tests/effects.processing.test.ts',
  'regression.phase1': 'tests/regression.phase1.test.ts',
}

const PHASE_1_SUITES = [
  'tests/visual.key-count.test.tsx',
  'tests/visual.section-layout.test.tsx',
  'tests/visual.control-inventory.test.tsx',
  'tests/interaction.keys.test.tsx',
  'tests/interaction.decorative-controls.test.tsx',
  'tests/accessibility.controls.test.tsx',
  'tests/piano.basic-note-lifecycle.test.ts',
  'tests/piano.basic-inputs.test.tsx',
  'tests/piano.basic-sustain-polyphony.test.ts',
  'tests/piano.basic-status-cleanup.test.tsx',
  'tests/regression.chassis.test.tsx',
]

function countTests(file: string): number {
  return readFileSync(join(process.cwd(), file), 'utf8').match(/^\s*it\(/gm)?.length ?? 0
}

describe('regression.phase2: the inherited suites are all still here', () => {
  it('every Phase 2 test file exists and has at least the tests it was sealed with', () => {
    let total = 0
    for (const [file, sealed] of Object.entries(PHASE_2_SUITES)) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(true)
      expect(countTests(file), file).toBeGreaterThanOrEqual(sealed)
      total += sealed
    }
    // Phase 2 was sealed with 181 `it` blocks in these nine files.
    expect(total).toBe(181)
  })

  it('every Phase 2 feature ID is still in the matrix, mapped to its own suite', () => {
    const byId = new Map(matrix.features.map((feature) => [feature.id, feature.tests]))
    for (const [id, file] of Object.entries(PHASE_2_FEATURES)) {
      expect(byId.get(id), id).toBeDefined()
      expect(byId.get(id)![0], id).toBe(file)
      expect(readFileSync(join(process.cwd(), file), 'utf8'), id).toContain(`Feature: ${id}`)
    }
  })

  it('this feature lists every Phase 1 and Phase 2 suite, so "green" means all of them ran', () => {
    const own = matrix.features.find((feature) => feature.id === 'regression.phase2')
    expect(own).toBeDefined()
    expect(own!.tests[0]).toBe('tests/regression.phase2.test.ts')
    for (const file of [...Object.values(PHASE_2_FEATURES), ...PHASE_1_SUITES]) expect(own!.tests, file).toContain(file)
  })

  it('the Phase 1 and Phase 2 evidence and scripts are preserved', () => {
    for (const file of [
      'evidence/stage1-desktop.png',
      'evidence/stage1-narrow.png',
      'evidence/stage1-capture.json',
      'evidence/stage1-visual-audit.md',
      'evidence/stage2-desktop.png',
      'evidence/stage2-narrow.png',
      'evidence/stage2-effects-on.png',
      'evidence/stage2-capture.json',
      'evidence/stage2-visual-audit.md',
    ]) {
      const path = join(process.cwd(), file)
      expect(existsSync(path), file).toBe(true)
      expect(statSync(path).size, file).toBeGreaterThan(500)
    }
    for (const file of ['scripts/capture-stage1.js', 'scripts/capture-stage2.js', 'scripts/build-samples.mjs', 'scripts/write-details.mjs']) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(true)
    }
    const capture = JSON.parse(readFileSync(join(process.cwd(), 'evidence/stage2-capture.json'), 'utf8'))
    expect(capture.phase).toBe(2)
    expect(JSON.stringify(capture)).toMatch(/stage2-desktop\.png/)
    expect(JSON.stringify(capture)).toMatch(/1440/)
  })

  it('the test support the inherited suites use is still there', () => {
    for (const file of ['app.tsx', 'fakes.ts', 'signal.ts', 'spec.ts', 'stage.ts', 'fxbench.ts', 'panel.ts']) {
      expect(existsSync(join(process.cwd(), 'tests', 'support', file)), file).toBe(true)
    }
  })

  it('the bundled recordings and their licences are untouched', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src/audio/library/manifest.json'), 'utf8'))
    expect(Object.keys(manifest.sets)).toEqual(['grand', 'upright', 'electric'])
    let files = 0
    for (const [id, set] of Object.entries(manifest.sets as Record<string, { files: Array<{ file: string; bytes: number }> }>)) {
      expect(existsSync(join(process.cwd(), 'public', 'samples', id, 'LICENSE.txt')), id).toBe(true)
      for (const file of set.files) {
        files += 1
        expect(statSync(join(process.cwd(), 'public', 'samples', file.file)).size, file.file).toBe(file.bytes)
      }
    }
    expect(files).toBe(198)
  })
})

describe('regression.phase2: the Phase 2 instrument is what Phase 3 starts as', () => {
  it('start-up is still a plain grand piano: Layer A on, everything else off, every effect off', () => {
    const state = createInitialState()
    expect(state.name).toBe('Grand Piano')
    expect([state.organ.on, state.piano.on, state.synth.on]).toEqual([false, true, false])
    expect(state.piano.layers.map((layer) => layer.on)).toEqual([true, false])
    expect(PIANO_TYPES[state.piano.layers[0].type]).toBe('Grand')
    for (const chain of state.fx.chains) {
      for (const unit of [chain.mod1, chain.mod2, chain.delay, chain.amp, chain.comp, chain.reverb]) expect(unit.on).toBe(false)
    }
    expect(state.split.on).toBe(false)
    expect(state.transpose).toEqual({ on: false, semitones: 0 })
    expect(state.morph).toEqual({ wheel: [], pedal: [] })
    const sound = deriveSound(state)
    expect(sound.organ.layers.some((layer) => layer.on)).toBe(false)
    expect(sound.synth.layers.some((layer) => layer.on)).toBe(false)
    expect(sound.layers).toHaveLength(LAYER_COUNT)
  })

  it('the Phase 2 controls are all still functional', () => {
    const phase2 = [
      'piano-on', 'piano-layer-a', 'piano-layer-b', 'piano-timbre', 'piano-octave-down', 'piano-octave-up', 'piano-acoustics',
      'piano-unison', 'piano-kb-touch', 'piano-dyn-comp', 'piano-type', 'fx-on', 'fx-focus-piano', 'fx-mod1-type', 'fx-mod1-on',
      'fx-mod2-type', 'fx-mod2-on', 'fx-amp-type', 'fx-amp-on', 'fx-delay-tap', 'fx-delay-filter', 'fx-delay-on', 'fx-comp-on',
      'fx-reverb-tone', 'fx-reverb-type', 'fx-reverb-on', 'rotary-stop-mode', 'rotary-speed', 'shift', 'fx-shift',
      'piano-layer-a-level', 'piano-layer-b-level', 'piano-model', 'perf-master-level', 'perf-pitch-stick', 'rotary-drive',
      'fx-mod1-rate', 'fx-mod1-amount', 'fx-mod2-rate', 'fx-mod2-amount', 'fx-drive', 'fx-eq-bass', 'fx-eq-mid-freq', 'fx-eq-mid',
      'fx-eq-treble', 'fx-delay-tempo', 'fx-delay-mix', 'fx-delay-feedback', 'fx-comp-amount', 'fx-reverb-mix',
    ]
    expect(phase2).toHaveLength(50)
    for (const id of phase2) {
      expect(FUNCTIONAL_CONTROL_IDS, id).toContain(id)
      expect(INVENTORY.controlById.has(id), id).toBe(true)
    }
  })

  it('with the Organ and Synth off, the new engines add nothing: a piano note is the same samples as with them absent', () => {
    // The Phase 3 kernel in its default state, and the same kernel after the organ and synth have been
    // woken once and gone back to sleep: the piano renders identically either way.
    const fresh = new StageKernel({ sampleRate: SR })
    fresh.noteOn(60, 0.8)
    const reference = renderKernel(fresh, 0.5)

    const used = new StageKernel({ sampleRate: SR })
    const everything = defaultSoundState()
    everything.layers[0].on = false
    everything.organ.layers[0].on = true
    everything.synth.layers[0].on = true
    used.setState(everything)
    used.noteOn(64, 0.8)
    renderKernel(used, 0.3)
    used.noteOff(64)
    renderKernel(used, 3)
    used.setState(defaultSoundState())
    expect(used.voiceCount).toBe(0)
    used.noteOn(60, 0.8)
    const after = renderKernel(used, 0.5)
    expect(rms(reference.left)).toBeGreaterThan(0.005)
    expect(equal(reference.left, after.left)).toBe(true)
    expect(equal(reference.right, after.right)).toBe(true)
  })

  it('the Phase 2 effect chain and rotor are the same classes, now used by six buses', () => {
    const chain = new FxChain(SR)
    expect(chain.routesToRotary(true)).toBe(false)
    expect(chain.engaged).toBe(false)
    const rotor = new Rotor(SR)
    rotor.configure(true, false, 0.2)
    for (let block = 0; block < 4000; block += 1) rotor.advance(128)
    expect(rotor.hornSpeed).toBeGreaterThan(6.5)
    const rig = makeRig()
    expect(rig.kernel.busCount).toBe(6)
    expect(rig.state().fx.chains).toHaveLength(6)
    rig.dispose()
  })

  it('a Phase 2 session still works the way it did: layers, type, effects, Group, Global, To Rotary', () => {
    const rig = makeRig()
    rig.press('piano-layer-b')
    rig.press('piano-type')
    rig.press('fx-reverb-on')
    rig.shiftPress('fx-focus-piano')
    rig.shiftPress('fx-delay-on')
    rig.press('fx-amp-on')
    for (let presses = 0; presses < 3; presses += 1) rig.press('fx-amp-type')
    const sound = rig.sound()
    expect(sound.layers.map((layer) => layer.on)).toEqual([true, true])
    expect(sound.layers[1].source).toEqual({ kind: 'samples', set: 'upright' })
    expect(sound.layers[1].fx.reverb.on).toBe(true)
    expect(rig.state().fx.pianoGroup).toBe(true)
    expect(rig.state().fx.global.delay).toBe(true)
    expect(sound.layers.map((layer) => layer.fx.amp.type)).toEqual([3, 3])
    expect(rig.led('rotary-on')).toBe('on')
    expect(rig.state().notice).toBe('Amp Sim/EQ: To Rotary')
    rig.down(60)
    expect(rms(rig.render(0.3).left)).toBeGreaterThan(0.003)
    rig.dispose()
  })
})
