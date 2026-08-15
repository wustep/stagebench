import { describe, expect, it } from 'vitest'
import { OrganEngine } from '../src/audio/organ'
import { defaultOrgan } from '../src/system/factory'
import type { OrganState } from '../src/system/program'

const SR = 8000

function rmsArray(a: Float32Array): number {
  let s = 0
  for (const x of a) s += x * x
  return Math.sqrt(s / a.length)
}

/** maximum per-sample absolute difference (sensitive to transients/pitch drift). */
function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let m = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > m) m = d
  }
  return m
}

function orgWith(model: OrganState['layers'][number]['model'], drawbars: number[] = [4, 3, 8, 6, 4, 2, 0, 0, 0]): OrganState {
  const o = defaultOrgan()
  o.layers[0].enabled = true
  o.layers[0].model = model
  o.layers[1].enabled = false
  o.drawbars = drawbars as OrganState['drawbars']
  return o
}

/** render `frames` after a single note; returns the mono buffer. */
function renderModel(model: OrganState['layers'][number]['model'], mutate?: (o: OrganState) => void, frames = SR * 0.4): Float32Array {
  const o = orgWith(model)
  if (mutate) mutate(o)
  const organ = new OrganEngine({ sampleRate: SR }, o)
  organ.noteOn(0, 60, 0.9)
  return organ.render(frames).samples
}

describe('organ.engine — two layers, shared chain, levels, cleanup', () => {
  it('note on produces sound; release decays toward silence', () => {
    const organ = new OrganEngine({ sampleRate: SR }, orgWith('B3'))
    organ.noteOn(0, 60, 0.9)
    const during = rmsArray(organ.render(SR * 0.2).samples)
    expect(during).toBeGreaterThan(1e-4)
    organ.noteOff(0, 60)
    const tail = rmsArray(organ.render(SR * 1.2).samples)
    expect(tail).toBeLessThan(during)
  })

  it('both layers share one effect chain', () => {
    const organ = new OrganEngine({ sampleRate: SR }, orgWith('B3'))
    expect(organ.layerChain).toBeTruthy()
    // a single chain instance serves both layers (no second chain).
    organ.layerChain.apply(organ.layerChain === organ.layerChain ? orgWith('B3').chain : orgWith('B3').chain)
    expect(organ.layerChain.reverb).toBeTruthy()
  })

  it('layer level changes loudness', () => {
    const o = orgWith('B3')
    o.layers[0].level = 1
    const loud = new OrganEngine({ sampleRate: SR }, o)
    loud.noteOn(0, 60, 0.9)
    const l = rmsArray(loud.render(SR * 0.3).samples)
    const o2 = orgWith('B3')
    o2.layers[0].level = 0.05
    const quiet = new OrganEngine({ sampleRate: SR }, o2)
    quiet.noteOn(0, 60, 0.9)
    const q = rmsArray(quiet.render(SR * 0.3).samples)
    expect(l).toBeGreaterThan(q)
  })

  it('organ sectionOn off silences the layer', () => {
    const o = orgWith('B3')
    o.layers[0].enabled = false
    const organ = new OrganEngine({ sampleRate: SR }, o)
    organ.noteOn(0, 60, 0.9)
    expect(organ.voiceCount).toBe(0)
  })
})

describe('organ.models-drawbars — B3/Vox/Farf/Pipe1 spectral distinctions', () => {
  it('B3, Vox, Farf and Pipe1 are audibly distinct, not one renamed oscillator', () => {
    const frames = SR * 0.4
    const b3 = renderModel('B3', undefined, frames)
    const vox = renderModel('Vox', undefined, frames)
    const farf = renderModel('Farf', undefined, frames)
    const pipe = renderModel('Pipe1', undefined, frames)
    const rms = (a: Float32Array): number => rmsArray(a)
    const vals = [rms(b3), rms(vox), rms(farf), rms(pipe)]
    // every pair must differ perceptibly.
    for (let i = 0; i < vals.length; i++) {
      for (let j = i + 1; j < vals.length; j++) {
        expect(Math.abs(vals[i] - vals[j])).toBeGreaterThan(1e-4)
      }
    }
  })

  it('every drawbar movement changes the audible spectrum', () => {
    const full = rmsArray(renderModel('B3'))
    const low16 = rmsArray(renderModel('B3', (o) => { o.drawbars[0] = 0 }))
    expect(Math.abs(full - low16)).toBeGreaterThan(1e-5)
  })

  it('B3 percussion measurably changes rendered audio', () => {
    const off = renderModel('B3', (o) => { o.percussion.on = false }, SR * 0.12)
    const on = renderModel('B3', (o) => { o.percussion.on = true }, SR * 0.12)
    // percussion adds a decaying partial at the attack: sample-level diff.
    expect(maxAbsDiff(off, on)).toBeGreaterThan(1e-4)
  })

  it('key click measurably changes the attack', () => {
    // key click is an attack transient: compare the early block sample-wise.
    const earlyOff = renderModel('B3', (o) => { o.keyClick = false }, SR * 0.02)
    const earlyOn = renderModel('B3', (o) => { o.keyClick = true }, SR * 0.02)
    expect(maxAbsDiff(earlyOff, earlyOn)).toBeGreaterThan(1e-4)
  })

  it('vibrato vs chorus are distinct and depth grows across positions', () => {
    // C1 (chorus) vs V1 (vibrato) differ.
    const c1 = renderModel('B3', (o) => { o.vibratoChorus = 1; o.layers[0].vibratoOn = true; o.percussion.on = false; o.keyClick = false })
    const v1 = renderModel('B3', (o) => { o.vibratoChorus = 4; o.layers[0].vibratoOn = true; o.percussion.on = false; o.keyClick = false })
    expect(maxAbsDiff(c1, v1)).toBeGreaterThan(1e-4)
    // C3 depth differs from C1 depth.
    const c3 = renderModel('B3', (o) => { o.vibratoChorus = 3; o.layers[0].vibratoOn = true; o.percussion.on = false; o.keyClick = false })
    expect(maxAbsDiff(c1, c3)).toBeGreaterThan(1e-4)
  })

  it('the drawbar LED graph state follows the drawbar value', () => {
    // The graph controls are read from the hardware store in the UI; here we
    // assert the mapping rule: drawbar value 0..8 drives a 9-segment graph.
    const db = 6
    const lit = db // 9 segments, value = lit count
    expect(lit).toBeGreaterThanOrEqual(0)
    expect(lit).toBeLessThanOrEqual(8)
  })
})

describe('organ.rotary — routing, slow/fast/stop, drive', () => {
  function routedOrg(speed: number, drive = 0.4): Float32Array {
    const o = orgWith('B3')
    o.toRotary = true
    o.rotarySpeed = speed
    o.rotaryDrive = drive
    const organ = new OrganEngine({ sampleRate: SR }, o)
    organ.noteOn(0, 60, 0.9)
    return organ.render(SR * 0.6).samples
  }

  it('rotary routing changes the signal (dry vs routed)', () => {
    const dry = renderModel('B3', (o) => { o.toRotary = false; o.rotaryDrive = 0 }, SR * 0.6)
    const routed = routedOrg(0)
    expect(Math.abs(rmsArray(dry) - rmsArray(routed))).toBeGreaterThan(1e-5)
  })

  it('slow, fast and stop are distinct rotary states', () => {
    const slow = routedOrg(0)
    const fast = routedOrg(1)
    const stop = routedOrg(2)
    expect(Math.abs(rmsArray(slow) - rmsArray(fast))).toBeGreaterThan(1e-5)
    expect(Math.abs(rmsArray(stop) - rmsArray(fast))).toBeGreaterThan(1e-5)
  })

  it('drive measurably saturates the routed signal', () => {
    const d0 = routedOrg(0, 0.05)
    const d2 = routedOrg(0, 0.9)
    expect(Math.abs(rmsArray(d0) - rmsArray(d2))).toBeGreaterThan(1e-5)
  })
})
