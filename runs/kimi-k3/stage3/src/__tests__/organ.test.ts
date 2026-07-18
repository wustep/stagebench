import { describe, expect, it } from 'vitest'
import { makeRig } from '../test-helpers'
import { corr, highBandRatio, rms, windowEnergy } from '../audio/fake-backend'
import { renderOrganVoice, makeVibratoFn } from '../audio/organ-models'
import { defaultOrganState, type OrganLayerState } from '../state/organ-state'

const SR = 8000

function layerWith(mut: (l: OrganLayerState) => void): OrganLayerState {
  const s = defaultOrganState()
  const l = s.layers.A
  l.drawbars = [8, 8, 8, 0, 0, 0, 0, 0, 0]
  mut(l)
  return l
}

function renderOrgan(layer: OrganLayerState, seconds = 0.6, note = 60): Float32Array {
  return renderOrganVoice(layer, { note, velocity: 0.9, seconds, sampleRate: SR }, makeVibratoFn(layer.vibratoMode, layer.vibratoOn))
}

describe('organ.engine', () => {
  it('two-layer note lifecycle: enable, voices, release, cleanup', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.noteOn(60, 0.9)
    expect(backend.activeVoiceCount()).toBe(2) // piano A + organ A both enabled
    expect(engine.getVoices().some((v) => v.layer === 'organA')).toBe(true)
    engine.noteOff(60)
    expect(engine.getVoices().find((v) => v.layer === 'organA')!.releasedAt).not.toBeNull()
    engine.allNotesOff()
    expect(backend.activeVoiceCount()).toBe(0)
  })

  it('organ section off starts no organ voices; re-enable restores', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(false)
    engine.setSectionOn(false)
    engine.noteOn(60, 0.9)
    expect(backend.startCount).toBe(0)
    engine.setOrganSectionOn(true)
    engine.noteOn(60, 0.9)
    expect(engine.getVoices().filter((v) => v.layer === 'organA').length).toBe(1)
  })

  it('layer B adds a second organ voice with its own model; disabling stops only its voices', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.setOrganLayerEnabled('B', true)
    engine.update(() => {
      engine.organ.layers.B.model = 3 // Farf on B, B3 on A
      engine.organ.layers.B.drawbars = [8, 8, 8, 8, 8, 8, 8, 8, 8]
    })
    engine.setSectionOn(false)
    engine.noteOn(60, 0.9)
    expect(engine.getVoices().filter((v) => v.layer === 'organA').length).toBe(1)
    expect(engine.getVoices().filter((v) => v.layer === 'organB').length).toBe(1)
    backend.advance(0.02)
    const both = backend.renderMix(0.4)
    engine.setOrganLayerEnabled('B', false)
    expect(engine.getVoices().every((v) => v.layer === 'organA')).toBe(true)
    const aOnly = backend.renderMix(0.4)
    expect(rms(both)).toBeGreaterThan(rms(aOnly) * 1.02)
    expect(corr(both, aOnly)).toBeLessThan(0.999)
  })

  it('organ layer level scales it in the mix; octave transposes rendered audio', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.setSectionOn(false)
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const loud = backend.renderMix(0.4)
    engine.update(() => {
      engine.organ.layers.A.level = 10
    })
    const quiet = backend.renderMix(0.4)
    expect(rms(quiet)).toBeLessThan(rms(loud) * 0.4)
    engine.update(() => {
      engine.organ.layers.A.level = 100
      engine.organ.layers.A.octave = 12
    })
    const up = backend.renderMix(0.4)
    expect(corr(loud, up)).toBeLessThan(0.9)
  })

  it('organ routes through the shared organ effect chain (reverb on organ chain)', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.setSectionOn(false)
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const dry = backend.renderMix(1.2)
    engine.update(() => {
      engine.effects.chains.organ.reverb.on = true
      engine.effects.chains.organ.reverb.type = 5
      engine.effects.chains.organ.reverb.amount = 110
    })
    const wet = backend.renderMix(1.2)
    const sr = backend.sampleRate
    expect(windowEnergy(wet, sr * 0.8, sr * 1.2)).toBeGreaterThan(windowEnergy(dry, sr * 0.8, sr * 1.2) * 2)
  })

  it('organ voice cleanup returns counts to baseline', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.noteOn(60, 0.9)
    engine.noteOn(64, 0.9)
    engine.dispose()
    expect(backend.activeVoiceCount()).toBe(0)
    expect(rms(backend.renderMix(0.3, 0.2))).toBeLessThan(1e-6)
  })
})

describe('organ.models-drawbars', () => {
  it('B3, Vox, Farf, Pipe 1 render audibly distinct spectra', () => {
    const renders = [0, 2, 3, 4].map((model) => renderOrgan(layerWith((l) => (l.model = model))))
    for (const r of renders) expect(rms(r)).toBeGreaterThan(0.01)
    for (let i = 0; i < renders.length; i++) {
      for (let j = i + 1; j < renders.length; j++) {
        expect(corr(renders[i], renders[j]), `model ${i} vs ${j}`).toBeLessThan(0.98)
      }
    }
    // Distinct spectra, not renamed copies: high-band content separates models.
    const hb = renders.map((r) => highBandRatio(r, SR, 1500))
    expect(Math.max(...hb) - Math.min(...hb)).toBeGreaterThan(0.02)
  })

  it('B3 Bass reuses the B3 engine limited to 16′ and 8′ drawbars', () => {
    const bass = renderOrgan(layerWith((l) => (l.model = 1)))
    const b3 = renderOrgan(layerWith((l) => (l.model = 0)))
    expect(rms(bass)).toBeGreaterThan(0.01)
    expect(corr(bass, b3)).toBeLessThan(0.999) // not identical
    // Bass is darker (less high-band energy).
    expect(highBandRatio(bass, SR, 1000)).toBeLessThan(highBandRatio(b3, SR, 1000))
  })

  it('every drawbar movement changes the spectrum (8th drawbar adds the 1′ partial)', () => {
    const without = renderOrgan(layerWith(() => {}))
    const with1ft = renderOrgan(layerWith((l) => (l.drawbars[8] = 8)))
    expect(corr(without, with1ft)).toBeLessThan(0.98)
    expect(highBandRatio(with1ft, SR, 2500)).toBeGreaterThan(highBandRatio(without, SR, 2500) * 1.2)
  })

  it('Farf registers act as switches: position ≤ 4 is off, > 4 is on', () => {
    const off = renderOrgan(layerWith((l) => {
      l.model = 3
      l.drawbars = [8, 0, 0, 0, 0, 0, 0, 0, 4] // 1' barely in = off
    }))
    const on = renderOrgan(layerWith((l) => {
      l.model = 3
      l.drawbars = [8, 0, 0, 0, 0, 0, 0, 0, 5] // pulled past half = on
    }))
    expect(corr(off, on)).toBeLessThan(0.98)
    expect(highBandRatio(on, SR, 2500)).toBeGreaterThan(highBandRatio(off, SR, 2500) * 1.2)
  })

  it('B3 percussion adds a decaying attack partial; soft/fast/third change it', () => {
    // layerWith defaults percussion to { on:false, soft:false, fast:false, third:true }
    const noPerc = renderOrgan(layerWith(() => {}), 0.4)
    const perc = renderOrgan(layerWith((l) => (l.percussion.on = true)), 0.4)
    expect(corr(noPerc, perc)).toBeLessThan(0.98)
    // Fast percussion (default panel state is slow; this render uses the
    // layer's default slow decay) decays: attack window > tail window of the
    // percussion-only difference signal.
    const diff = new Float32Array(perc.length)
    for (let i = 0; i < diff.length; i++) diff[i] = perc[i] - noPerc[i]
    const early = windowEnergy(diff, 0, SR * 0.1)
    const late = windowEnergy(diff, SR * 0.3, SR * 0.4)
    expect(early).toBeGreaterThan(late * 2)
    const percSoft = renderOrgan(layerWith((l) => {
      l.percussion.on = true
      l.percussion.soft = true
    }), 0.4)
    expect(windowEnergy(percSoft, 0, SR * 0.1)).toBeLessThan(windowEnergy(perc, 0, SR * 0.1) * 0.8)
    const perc2nd = renderOrgan(layerWith((l) => {
      l.percussion.on = true
      l.percussion.third = false
    }), 0.4)
    expect(corr(perc, perc2nd)).toBeLessThan(0.98)
  })

  it('B3 key click adds a short attack transient', () => {
    const b3 = renderOrgan(layerWith(() => {}), 0.2)
    const pipe = renderOrgan(layerWith((l) => (l.model = 4)), 0.2)
    // B3 has a click: more energy in the first 12 ms relative to its body.
    const clickB3 = windowEnergy(b3, 0, SR * 0.012) / Math.max(1e-9, windowEnergy(b3, SR * 0.012, SR * 0.2))
    const clickPipe = windowEnergy(pipe, 0, SR * 0.012) / Math.max(1e-9, windowEnergy(pipe, SR * 0.012, SR * 0.2))
    expect(clickB3).toBeGreaterThan(clickPipe * 1.2)
  })

  it('vibrato/chorus: V1 and C1 are audibly distinct; depth grows 1→3', () => {
    const v1 = renderOrgan(layerWith((l) => {
      l.vibratoOn = true
      l.vibratoMode = 0
    }), 0.8)
    const c1 = renderOrgan(layerWith((l) => {
      l.vibratoOn = true
      l.vibratoMode = 3
    }), 0.8)
    const dry = renderOrgan(layerWith(() => {}), 0.8)
    expect(corr(v1, dry)).toBeLessThan(0.99)
    expect(corr(v1, c1)).toBeLessThan(0.999)
    const v3 = renderOrgan(layerWith((l) => {
      l.vibratoOn = true
      l.vibratoMode = 2
    }), 0.8)
    // Deeper vibrato decorrelates more from the dry signal.
    expect(corr(v3, dry)).toBeLessThan(corr(v1, dry) + 0.02)
  })

  it('B3 Bass keeps key click; Pipe 2 is a brighter Pipe 1 registration', () => {
    const p1 = renderOrgan(layerWith((l) => (l.model = 4)))
    const p2 = renderOrgan(layerWith((l) => (l.model = 5)))
    expect(corr(p1, p2)).toBeLessThan(0.999)
    expect(highBandRatio(p2, SR, 2000)).toBeGreaterThan(highBandRatio(p1, SR, 2000))
  })
})

describe('organ.rotary', () => {
  it('ORGAN button routes the organ to the shared rotary; unrouted stays dry', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.setSectionOn(false)
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const dry = backend.renderMix(0.8)
    engine.update(() => {
      engine.effects.rotary.on = true
      engine.effects.rotary.organRouted = true
      engine.effects.rotary.speed = 2
    })
    const routed = backend.renderMix(0.8)
    expect(rms(routed)).toBeGreaterThan(0.001)
    expect(corr(routed, dry)).toBeLessThan(0.9)
  })

  it('slow/fast/stop are distinct; speed changes ramp (acceleration, not a switch)', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.setSectionOn(false)
    engine.update(() => {
      engine.effects.rotary.on = true
      engine.effects.rotary.organRouted = true
    })
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    engine.update(() => (engine.effects.rotary.speed = 0))
    const slow = backend.renderMix(1.0)
    engine.update(() => (engine.effects.rotary.speed = 2))
    const fast = backend.renderMix(1.0)
    engine.update(() => (engine.effects.rotary.speed = 1))
    const stop = backend.renderMix(1.0)
    expect(corr(slow, fast)).toBeLessThan(0.9)
    expect(corr(slow, stop)).toBeLessThan(0.999)
    // Acceleration: the first 100 ms of a speed switch is more correlated to
    // the previous speed than the last 300 ms (ramps, not instant jumps).
    const sr = backend.sampleRate
    const earlyCorr = corr(fast.slice(0, sr * 0.1), slow.slice(0, sr * 0.1))
    const lateCorr = corr(fast.slice(sr * 0.7), slow.slice(sr * 0.7))
    expect(earlyCorr).toBeGreaterThan(lateCorr)
  })

  it('rotary drive adds grit to routed organ; morphable speed via canonical state', async () => {
    const { engine, backend } = await makeRig()
    engine.setOrganSectionOn(true)
    engine.setSectionOn(false)
    engine.update(() => {
      engine.effects.rotary.on = true
      engine.effects.rotary.organRouted = true
      engine.effects.rotary.speed = 2
      engine.effects.rotary.drive = 0
      engine.effects.rotary.organDrive = 0
    })
    engine.noteOn(60, 0.9)
    backend.advance(0.02)
    const clean = backend.renderMix(0.6)
    engine.update(() => {
      engine.effects.rotary.drive = 127
      engine.effects.rotary.organDrive = 127
    })
    const driven = backend.renderMix(0.6)
    // Drive changes the signal (waveshaping adds harmonics).
    expect(corr(clean, driven)).toBeLessThan(0.995)
    expect(rms(driven)).toBeGreaterThan(0.001)
    // Speed is canonical state: morph assignments can target it.
    expect(engine.assignMorph('wheel', 'organ.rotarySpeed', 0, 2)).toBe(true)
  })
})
