import { describe, expect, it } from 'vitest'
import { rms, windowEnergy } from '../audio/fake-backend'
import { frameWidth } from '../audio/dsp'
import { renderGraph } from '../audio/render'
import { renderIsolated, freshPerf } from '../test-helpers'
import { makeRig } from '../test-helpers'
import { FakeAudioBackend } from '../audio/fake-backend'
import type { NoteEvent } from '../audio/render'

function corr(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, ea = 0, eb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; ea += a[i] * a[i]; eb += b[i] * b[i] }
  return dot / Math.max(1e-12, Math.sqrt(ea * eb))
}

/** High-frequency energy ratio: energy above ~1.5 kHz vs total (DFT bins). */
function brightness(buf: Float32Array, sr: number): number {
  // Goertzel-style band energy: sum of |X(k)|² for k above cutoff / total.
  const n = Math.min(buf.length, 2048)
  const cutoffHz = 1500
  let hi = 0
  let total = 0
  for (let k = 1; k < n / 2; k++) {
    const freq = (k * sr) / n
    let re = 0
    let im = 0
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * k * i) / n
      re += buf[i] * Math.cos(a)
      im += buf[i] * Math.sin(a)
    }
    const e = re * re + im * im
    total += e
    if (freq >= cutoffHz) hi += e
  }
  return hi / Math.max(1e-12, total)
}

describe('piano.velocity-controls', () => {
  it('KB Touch: Light reaches full level sooner than Heavy for the same strike', () => {
    const medium = renderIsolated(0.5, { velocity: 0.5, perf: freshPerf() })
    const heavy = renderIsolated(0.5, { velocity: 0.5, perf: { ...freshPerf(), kbTouch: 0 } })
    const light = renderIsolated(0.5, { velocity: 0.5, perf: { ...freshPerf(), kbTouch: 2 } })
    expect(rms(light)).toBeGreaterThan(rms(medium))
    expect(rms(medium)).toBeGreaterThan(rms(heavy))
  })

  it('Dyn Comp narrows dynamic range: soft strokes get louder relative to hard', () => {
    const mk = (dynComp: 0 | 3) => ({
      soft: renderIsolated(0.5, { velocity: 0.25, perf: { ...freshPerf(), dynComp } }),
      hard: renderIsolated(0.5, { velocity: 1.0, perf: { ...freshPerf(), dynComp } }),
    })
    const off = mk(0)
    const on = mk(3)
    const ratioOff = rms(off.hard) / rms(off.soft)
    const ratioOn = rms(on.hard) / rms(on.soft)
    expect(ratioOn).toBeLessThan(ratioOff * 0.8)
    // And the soft stroke is audibly louder with Dyn Comp on.
    expect(rms(on.soft)).toBeGreaterThan(rms(off.soft) * 1.2)
  })

  it('Timbre Soft darkens and Bright brightens the rendered signal', () => {
    const off = renderIsolated(0.6, { perf: freshPerf() })
    const soft = renderIsolated(0.6, { perf: { ...freshPerf(), timbre: 1 } })
    const bright = renderIsolated(0.6, { perf: { ...freshPerf(), timbre: 3 } })
    expect(brightness(soft, 8000)).toBeLessThan(brightness(off, 8000) * 0.9)
    expect(brightness(bright, 8000)).toBeGreaterThan(brightness(off, 8000) * 1.1)
    expect(corr(off, soft)).toBeLessThan(0.99)
  })

  it('Timbre Dyno settings change the electric family (and only it)', () => {
    const epOff = renderIsolated(0.6, { layer: { type: 'electric' }, perf: freshPerf() })
    const dyno1 = renderIsolated(0.6, { layer: { type: 'electric' }, perf: { ...freshPerf(), timbre: 4 } })
    const dyno2 = renderIsolated(0.6, { layer: { type: 'electric' }, perf: { ...freshPerf(), timbre: 5 } })
    expect(corr(epOff, dyno1)).toBeLessThan(0.98)
    expect(corr(dyno1, dyno2)).toBeLessThan(0.9995)
    // On an acoustic type, index 4/5 are out of range → identical to Off.
    const acOff = renderIsolated(0.6, { perf: freshPerf() })
    const acDyno = renderIsolated(0.6, { perf: { ...freshPerf(), timbre: 4 } })
    expect(corr(acOff, acDyno)).toBeGreaterThan(0.999)
  })

  it('Unison adds detuned stereo voices (wider image, different waveform)', () => {
    const backend = new FakeAudioBackend()
    const mkParams = (unison: 0 | 3) => {
      const p = backend.buildRenderParams({ perf: { ...freshPerf(), unison } }, 0.6)
      p.layers[0].level = 0.9
      return p
    }
    const notes = new Map([['pianoA' as const, [{ note: 60, velocity: 0.8, start: 0, release: null, stop: null } as NoteEvent]]])
    const dry = renderGraph(mkParams(0), notes)
    const wide = renderGraph(mkParams(3), notes)
    expect(frameWidth(wide)).toBeGreaterThan(frameWidth(dry) * 2)
    const m = (f: { l: Float32Array; r: Float32Array }) => {
      const o = new Float32Array(f.l.length)
      for (let i = 0; i < o.length; i++) o[i] = (f.l[i] + f.r[i]) / 2
      return o
    }
    expect(corr(m(dry), m(wide))).toBeLessThan(0.98)
  })

  it('Soft Release lengthens the note tail after release', () => {
    const normal = renderIsolated(2.0, { releaseAt: 0.3, perf: freshPerf() })
    const soft = renderIsolated(2.0, { releaseAt: 0.3, perf: { ...freshPerf(), softRelease: true } })
    const sr = 8000
    const tailNormal = windowEnergy(normal, sr * 1, sr * 2)
    const tailSoft = windowEnergy(soft, sr * 1, sr * 2)
    expect(tailSoft).toBeGreaterThan(tailNormal * 2)
    // Disabled for Clav (manual p. 25): tails identical.
    const clavNormal = renderIsolated(1.5, { layer: { type: 'clav' }, releaseAt: 0.3, perf: freshPerf() })
    const clavSoft = renderIsolated(1.5, { layer: { type: 'clav' }, releaseAt: 0.3, perf: { ...freshPerf(), softRelease: true } })
    expect(corr(clavNormal, clavSoft)).toBeGreaterThan(0.999)
  })

  it('String Res adds sympathetic energy while other notes are held', async () => {
    const { backend, engine } = await makeRig()
    // Hold a chord, then strike another note with and without String Res.
    engine.noteOn(48, 0.8)
    engine.noteOn(52, 0.8)
    backend.advance(0.1)
    engine.noteOn(60, 0.8)
    backend.advance(0.02)
    const dryMix = backend.renderMix(0.4)
    engine.update(() => {
      engine.perf.stringRes = true
    })
    const resMix = backend.renderMix(0.4)
    expect(rms(resMix)).toBeGreaterThan(rms(dryMix) * 1.01)
    expect(corr(dryMix, resMix)).toBeLessThan(0.999)
  })

  it('Master Level scales the final rendered output (and nothing bypasses it)', async () => {
    const { backend, engine } = await makeRig()
    engine.noteOn(60, 0.9)
    backend.advance(0.05)
    const full = backend.renderMix(0.4)
    engine.setMasterLevel(0.3)
    const low = backend.renderMix(0.4)
    expect(rms(low)).toBeLessThan(rms(full) * 0.6)
    engine.setMasterLevel(0)
    const muted = backend.renderMix(0.4)
    expect(rms(muted)).toBeLessThan(1e-6)
  })
})
