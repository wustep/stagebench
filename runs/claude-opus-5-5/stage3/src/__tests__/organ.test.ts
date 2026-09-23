// Phase 3 Organ: two-layer lifecycle, the four distinct engines, drawbars, percussion, key click,
// vibrato/chorus and the Rotary — all measured on audio rendered through the real StageAudio graph
// by the Web Audio simulator.
import { describe, expect, it } from 'vitest'
import { B3_RATIOS } from '../audio/organ'
import { applyMorphs, assignMorph } from '../model/morph'
import type { OrganLayerState, OrganModel, VibType } from '../model/organState'
import { defaultSound, editUnit, focusSlot, updateOrganLayer, type SoundState } from '../model/sound'
import { makeStageRig } from '../testing/stageRig'
import { difference, rms, SimParam } from '../testing/simAudio'
import { envelopeVariation, frequencyDeviation, goertzel, harmonicProfile, profileDistance } from '../testing/spectrum'

const SR = 16000
const C4 = 60
const F0 = 261.6256

const organOnly = (patch: Partial<OrganLayerState> = {}, extra: (s: SoundState) => SoundState = (s) => s) => (s: SoundState): SoundState =>
  extra(
    updateOrganLayer(
      focusSlot({ ...s, piano: { ...s.piano, on: false }, organ: { ...s.organ, on: true }, rotary: { ...s.rotary, organ: false } }, 'organA'),
      'A',
      { drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0], ...patch },
    ),
  )

async function organNote(patch: Partial<OrganLayerState> = {}, extra?: (s: SoundState) => SoundState, hold = 0.35, tail = 0.05, note = C4) {
  const rig = await makeStageRig({ slots: 'all', sound: organOnly(patch, extra) })
  return rig.play(note, 100, hold, tail)
}

const steady = (_x: Float32Array) => [Math.round(0.1 * SR), Math.round(0.34 * SR)] as const

describe('organ.models-drawbars — four distinct engines, drawbars, percussion, click, vibrato/chorus', () => {
  it('every B3 drawbar adds its own footage partial to the spectrum', async () => {
    for (let i = 0; i < 9; i++) {
      const bars = [0, 0, 0, 0, 0, 0, 0, 0, 0]
      bars[i] = 8
      const out = await organNote({ drawbars: bars }, undefined, 0.3)
      const [a, b] = steady(out)
      const profile = harmonicProfile(out, F0, SR, B3_RATIOS, a, b)
      // The pulled bar's partial dominates (top partials fold back an octave, as on a tonewheel organ).
      let f = F0 * B3_RATIOS[i]
      while (f > 5900) f /= 2
      const at = goertzel(out, f, SR, a, b)
      expect(at, `drawbar ${i + 1}`).toBeGreaterThan(0.002)
      expect(profile[B3_RATIOS.indexOf(f / F0)] ?? 1).toBeGreaterThan(0.9)
    }
  })

  it('drawbar level changes the audible spectrum step by step (0 silent, 8 loudest)', async () => {
    const levels = [0, 4, 8].map(async (v) => {
      const out = await organNote({ drawbars: [0, 0, 8, v, 0, 0, 0, 0, 0] })
      const [a, b] = steady(out)
      return goertzel(out, F0 * 2, SR, a, b)
    })
    const [l0, l4, l8] = await Promise.all(levels)
    expect(l0).toBeLessThan(l4 * 0.05)
    expect(l4).toBeLessThan(l8)
  })

  it('moving a drawbar while a key is held changes the sounding note immediately', async () => {
    const rig = await makeStageRig({ slots: 'all', sound: organOnly() })
    rig.engine.noteOn(C4, 100, 't')
    const before = rig.render(0.2)
    rig.set((s) => updateOrganLayer(s, 'A', { drawbars: [0, 0, 8, 8, 0, 0, 0, 0, 0] }))
    const after = rig.render(0.2)
    rig.engine.noteOff(C4, 't')
    const h2 = (x: Float32Array) => goertzel(x, F0 * 2, SR, 800, 3200)
    expect(h2(after)).toBeGreaterThan(h2(before) * 5)
  })

  it('B3, Vox, Farf and Pipe 1 have distinct harmonic behaviour for the same drawbar setting', async () => {
    const bars = [0, 0, 8, 8, 0, 8, 0, 0, 0]
    const models: OrganModel[] = ['b3', 'vox', 'farf', 'pipe1']
    const ratios = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10]
    const profiles = new Map<OrganModel, number[]>()
    const attacks = new Map<OrganModel, number>()
    for (const m of models) {
      const out = await organNote({ model: m, drawbars: bars })
      const [a, b] = steady(out)
      profiles.set(m, harmonicProfile(out, F0, SR, ratios, a, b))
      attacks.set(m, rms(out, 0, Math.round(0.012 * SR)) / rms(out, a, b))
    }
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        expect(profileDistance(profiles.get(models[i])!, profiles.get(models[j])!), `${models[i]} vs ${models[j]}`).toBeGreaterThan(0.15)
      }
    }
    // B3 sines add nothing above the pulled footages; Vox square dividers add odd harmonics (the
    // 4' square's 3rd = 6 × f0, 5th = 10 × f0).
    expect(profiles.get('vox')![ratios.indexOf(10)]).toBeGreaterThan(profiles.get('b3')![ratios.indexOf(10)] + 0.05)
    // Pipes speak slowly: the first 12 ms are far quieter than the sustained tone.
    expect(attacks.get('pipe1')!).toBeLessThan(attacks.get('vox')! * 0.8)
  })

  it('Farf registers are switches (pulled past half = on); Vox bar 9 mixes filtered/unfiltered tone', async () => {
    const half = await organNote({ model: 'farf', drawbars: [0, 0, 3, 0, 0, 0, 0, 0, 0] })
    const on = await organNote({ model: 'farf', drawbars: [0, 0, 4, 0, 0, 0, 0, 0, 0] })
    const full = await organNote({ model: 'farf', drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0] })
    expect(rms(half)).toBeLessThan(1e-4)
    expect(rms(on)).toBeGreaterThan(0.005)
    expect(Math.abs(rms(on) - rms(full)) / rms(full)).toBeLessThan(0.02)
    const raw = await organNote({ model: 'vox', drawbars: [0, 8, 0, 0, 0, 0, 0, 0, 0] })
    const filtered = await organNote({ model: 'vox', drawbars: [0, 8, 0, 0, 0, 0, 0, 0, 8] })
    const [a, b] = steady(raw)
    const upper = (x: Float32Array) => goertzel(x, F0 * 9, SR, a, b) / goertzel(x, F0, SR, a, b)
    expect(upper(filtered)).toBeLessThan(upper(raw) * 0.5)
  })

  it('B3 percussion: on/off, soft volume, fast decay and 2nd/3rd harmonic each change the audio', async () => {
    const perc = (p: Partial<OrganLayerState['perc']>) => ({ perc: { on: true, soft: false, fast: true, third: true, ...p } })
    const off = await organNote(perc({ on: false }))
    const third = await organNote(perc({}))
    const second = await organNote(perc({ third: false }))
    const soft = await organNote(perc({ soft: true }))
    const slow = await organNote(perc({ fast: false }))
    const early = [0, Math.round(0.08 * SR)] as const
    const late = [Math.round(0.25 * SR), Math.round(0.34 * SR)] as const
    const h3 = (x: Float32Array, w: readonly [number, number]) => goertzel(x, F0 * 3, SR, w[0], w[1])
    const h2 = (x: Float32Array, w: readonly [number, number]) => goertzel(x, F0 * 2, SR, w[0], w[1])
    expect(h3(third, early)).toBeGreaterThan(h3(off, early) * 10)
    expect(h2(second, early)).toBeGreaterThan(h2(third, early) * 5)
    expect(h3(soft, early)).toBeLessThan(h3(third, early) * 0.7)
    expect(h3(slow, late)).toBeGreaterThan(h3(third, late) * 1.5)
  })

  it('percussion is single-triggered: legato keys do not retrigger it until all keys are released', async () => {
    const rig = await makeStageRig({ slots: 'all', sound: organOnly({ perc: { on: true, soft: false, fast: true, third: true } }) })
    const E4 = 64
    const fE = F0 * Math.pow(2, 4 / 12)
    rig.engine.noteOn(C4, 100, 't')
    rig.render(0.1)
    rig.engine.noteOn(E4, 100, 't')
    const legato = rig.render(0.08)
    rig.engine.noteOff(C4, 't')
    rig.engine.noteOff(E4, 't')
    rig.render(0.1)
    rig.engine.noteOn(E4, 100, 't')
    const fresh = rig.render(0.08)
    rig.engine.noteOff(E4, 't')
    const h3 = (x: Float32Array) => goertzel(x, fE * 3, SR)
    expect(h3(fresh)).toBeGreaterThan(h3(legato) * 5)
  })

  it('B3 key click is a short broadband attack transient', async () => {
    const out = await organNote({ drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0] })
    const click = goertzel(out, 2600, SR, 0, Math.round(0.02 * SR))
    const later = goertzel(out, 2600, SR, Math.round(0.1 * SR), Math.round(0.12 * SR))
    expect(click).toBeGreaterThan(later * 8)
    // Vox has no key click.
    const vox = await organNote({ model: 'vox', drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0] })
    expect(goertzel(vox, 2600, SR, 0, Math.round(0.02 * SR))).toBeLessThan(click * 0.5)
  })

  it('vibrato/chorus: per-layer on/off, V1 and C1 differ, and depth grows 1 → 3', async () => {
    const vib = (vibType: VibType, vibOn = true) => organNote({ vibOn }, (s) => ({ ...s, organ: { ...s.organ, vibType } }), 0.5)
    const dry = await vib('V1', false)
    const v1 = await vib('V1')
    const v2 = await vib('V2')
    const v3 = await vib('V3')
    const c1 = await vib('C1')
    const c3 = await vib('C3')
    const w = [Math.round(0.08 * SR), Math.round(0.5 * SR)] as const
    const dev = (x: Float32Array) => frequencyDeviation(x, SR, w[0], w[1])
    const beat = (x: Float32Array) => envelopeVariation(x, SR, w[0], w[1])
    // Vibrato: pitch deviation grows with depth 1 → 3; the dry organ has none.
    expect(dev(dry)).toBeLessThan(0.5)
    expect(dev(v1)).toBeGreaterThan(dev(dry) + 0.5)
    expect(dev(v2)).toBeGreaterThan(dev(v1) * 1.3)
    expect(dev(v3)).toBeGreaterThan(dev(v2) * 1.3)
    // Chorus mixes the vibrato with the dry signal: V1 and C1 are audibly different effects and
    // chorus beating deepens from C1 to C3.
    expect(difference(v1, c1)).toBeGreaterThan(0.2)
    expect(beat(c1)).toBeGreaterThan(beat(v1) + 0.005)
    expect(beat(c3)).toBeGreaterThan(beat(c1))
  })

  it('B3 Bass uses only 16′ and 8′; Pipe 2 is a brighter principal than Pipe 1', async () => {
    const bars = [0, 0, 8, 8, 0, 0, 0, 0, 0]
    const b3 = await organNote({ model: 'b3', drawbars: bars })
    const bass = await organNote({ model: 'b3bass', drawbars: bars })
    const [a, b] = steady(b3)
    expect(goertzel(bass, F0 * 2, SR, a, b)).toBeLessThan(goertzel(b3, F0 * 2, SR, a, b) * 0.05)
    const p1 = await organNote({ model: 'pipe1' })
    const p2 = await organNote({ model: 'pipe2' })
    const bright = (x: Float32Array) => goertzel(x, F0 * 3, SR, a, b) / goertzel(x, F0, SR, a, b)
    expect(bright(p2)).toBeGreaterThan(bright(p1) * 2)
  })
})

describe('organ.engine — two layers, levels, focus, zones, one shared chain, cleanup', () => {
  it('both layers own their voices; disabling one releases only its voices; release frees every node', async () => {
    const rig = await makeStageRig({ slots: 'all', sound: organOnly({}, (s) => updateOrganLayer(s, 'B', { enabled: true, model: 'vox' })) })
    const baseline = rig.ctx.connectedNodeCount()
    rig.engine.noteOn(C4, 100, 't')
    rig.render(0.05)
    expect(rig.engine.snapshot().perSlot).toMatchObject({ organA: 1, organB: 1, A: 0 })
    expect(rig.stage.liveVoices('organA')).toBe(1)
    rig.set((s) => updateOrganLayer(s, 'B', { enabled: false }))
    rig.render(0.1)
    expect(rig.stage.liveVoices('organB')).toBe(0)
    expect(rig.stage.liveVoices('organA')).toBe(1)
    rig.engine.noteOff(C4, 't')
    rig.render(0.2)
    expect(rig.stage.liveVoiceCount).toBe(0)
    expect(rig.ctx.connectedNodeCount()).toBe(baseline)
  })

  it('layer level and octave shift act per layer', async () => {
    const loud = await organNote({ level: 127 })
    const quiet = await organNote({ level: 40 })
    const silent = await organNote({ level: 0 })
    expect(rms(quiet)).toBeLessThan(rms(loud) * 0.3)
    expect(rms(silent)).toBeLessThan(1e-4)
    const up = await organNote({ octave: 1 })
    const [a, b] = steady(up)
    expect(goertzel(up, F0 * 2, SR, a, b)).toBeGreaterThan(goertzel(up, F0, SR, a, b) * 5)
  })

  it('the two organ layers share one effect chain (an organ reverb reaches both)', async () => {
    const onlyB = (s: SoundState) => updateOrganLayer(updateOrganLayer(s, 'A', { enabled: false }), 'B', { enabled: true, drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0] })
    const reverb = (s: SoundState) => editUnit(s, 'reverb', { on: true, dryWet: 127, type: 'hall' })
    const dryA = await organNote({}, undefined, 0.2, 0.3)
    const wetA = await organNote({}, reverb, 0.2, 0.3)
    const dryB = await organNote({}, onlyB, 0.2, 0.3)
    const wetB = await organNote({}, (s) => reverb(onlyB(s)), 0.2, 0.3)
    const tail = (x: Float32Array) => rms(x, Math.round(0.25 * SR), Math.round(0.45 * SR))
    expect(tail(wetA)).toBeGreaterThan(tail(dryA) * 5)
    expect(tail(wetB)).toBeGreaterThan(tail(dryB) * 5)
    const rig = await makeStageRig({ slots: 'all', sound: organOnly() })
    expect(rig.sound().fx.focus).toBe('organ')
  })
})

describe('organ.rotary — routing, slow/fast/stop with acceleration, drive, morphable speed', () => {
  const rotaryOn = (patch: Partial<SoundState['rotary']>) => (s: SoundState) => ({ ...s, rotary: { ...s.rotary, organ: true, ...patch } })

  it('the ORGAN button routes the organ chain through the rotary (stereo motion appears)', async () => {
    const stereo = async (organ: boolean) => {
      const rig = await makeStageRig({ slots: 'all', sound: organOnly({}, rotaryOn({ organ, fast: true })) })
      rig.engine.noteOn(C4, 100, 't')
      const { left, right } = rig.ctx.renderStereo(0.4)
      let d = 0
      for (let i = 0; i < left.length; i++) d += (left[i] - right[i]) ** 2
      return Math.sqrt(d / left.length) / (rms(left) + 1e-9)
    }
    expect(await stereo(true)).toBeGreaterThan((await stereo(false)) + 0.1)
  })

  it('slow → fast accelerates smoothly; Stop mode brings the rotors to rest', async () => {
    const rig = await makeStageRig({ slots: 'all', sound: organOnly({}, rotaryOn({ fast: false })) })
    rig.render(0.05)
    const horn = rig.stage.rotaryUnit!.speedParams[0] as SimParam
    const t0 = rig.ctx.currentTime
    rig.set((s) => ({ ...s, rotary: { ...s.rotary, fast: true } }))
    const mid = horn.valueAt(t0 + 0.2)
    const end = horn.valueAt(t0 + 3)
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(6)
    expect(end).toBeGreaterThan(6.5)
    rig.render(0.1)
    const t1 = rig.ctx.currentTime
    rig.set((s) => ({ ...s, rotary: { ...s.rotary, fast: false, stopMode: true } }))
    expect(horn.valueAt(t1 + 0.1)).toBeGreaterThan(1)
    expect(horn.valueAt(t1 + 4)).toBeLessThan(0.05)
  })

  it('rotary drive changes the routed organ sound', async () => {
    const clean = await organNote({ drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 0] }, rotaryOn({ drive: 0 }))
    const driven = await organNote({ drawbars: [8, 8, 8, 8, 0, 0, 0, 0, 0] }, rotaryOn({ drive: 127 }))
    expect(difference(clean, driven)).toBeGreaterThan(0.1)
  })

  it('rotary speed is morphable from the wheel', () => {
    let s = organOnly({}, rotaryOn({ fast: false }))(defaultSound())
    s = assignMorph(s, 'wheel', 'rotary.speed', 1)
    expect(applyMorphs(s, 0, 0).rotary.fast).toBe(false)
    expect(applyMorphs(s, 127, 0).rotary.fast).toBe(true)
  })
})

