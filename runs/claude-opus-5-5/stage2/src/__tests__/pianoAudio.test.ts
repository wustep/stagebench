// Rendered-audio tests: the real generated buffers and gain/filter automation are executed by
// the sample-accurate simulator (src/testing/simAudio.ts); assertions are tolerant relationships.
import { describe, expect, it } from 'vitest'
import { NoteEngine } from '../audio/noteEngine'
import { PianoAudio } from '../audio/pianoAudio'
import { midiToHz, renderPianoTone, rootNotes, velocityCutoff, velocityGain } from '../audio/pianoTone'
import { peak, rms, SimAudioContext } from '../testing/simAudio'

const SR = 16000

async function readyPiano(opts: { durationScale?: number; renderTone?: (n: number) => Float32Array } = {}) {
  const contexts: SimAudioContext[] = []
  const audio = new PianoAudio({
    createContext: () => {
      const c = new SimAudioContext(SR)
      contexts.push(c)
      return c
    },
    lowNote: 28,
    highNote: 100,
    toneOptions: { sampleRate: 8000, durationScale: opts.durationScale ?? 0.5 },
    yieldToEventLoop: () => Promise.resolve(),
    renderTone: opts.renderTone,
  })
  await audio.load()
  const engine = new NoteEngine(audio)
  return { audio, engine, ctx: () => contexts[0] }
}

function zeroCrossingHz(x: Float32Array, sr: number): number {
  let crossings = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1] <= 0 && x[i] > 0) crossings++
  return (crossings * sr) / x.length
}

describe('generated piano tone (honest synthesis)', () => {
  it('renders non-silent, decaying, normalized audio at the right pitch', () => {
    const tone = renderPianoTone(57, { sampleRate: 16000, durationScale: 0.4 }) // A3 = 220 Hz
    expect(peak(tone)).toBeGreaterThan(0.5)
    expect(peak(tone)).toBeLessThanOrEqual(0.8001)
    const early = rms(tone, 800, 4000)
    const late = rms(tone, tone.length - 4000, tone.length - 1000)
    expect(early).toBeGreaterThan(late * 2)
    // Fundamental dominates zero crossings in a steady segment (tolerant ±8 %).
    const hz = zeroCrossingHz(tone.subarray(2000, 10000), 16000)
    expect(Math.abs(hz - 220) / 220).toBeLessThan(0.08)
  })

  it('is deterministic and different notes render differently', () => {
    const a = renderPianoTone(60, { sampleRate: 8000, durationScale: 0.1 })
    const b = renderPianoTone(60, { sampleRate: 8000, durationScale: 0.1 })
    const c = renderPianoTone(72, { sampleRate: 8000, durationScale: 0.1 })
    expect(Array.from(a)).toEqual(Array.from(b))
    let diff = 0
    for (let i = 0; i < Math.min(a.length, c.length); i++) diff += Math.abs(a[i] - c[i])
    expect(diff).toBeGreaterThan(10)
  })

  it('covers E1…E7 with roots never more than one semitone from any key', () => {
    const roots = rootNotes(28, 100)
    expect(roots[0]).toBe(28)
    expect(roots[roots.length - 1]).toBe(100)
    for (let n = 28; n <= 100; n++) expect(Math.min(...roots.map((r) => Math.abs(r - n)))).toBeLessThanOrEqual(1)
  })

  it('velocity curves are monotonic (gain and brightness)', () => {
    for (let v = 2; v <= 127; v++) {
      expect(velocityGain(v)).toBeGreaterThan(velocityGain(v - 1))
      expect(velocityCutoff(v, 60)).toBeGreaterThan(velocityCutoff(v - 1, 60))
    }
    expect(midiToHz(69)).toBeCloseTo(440)
  })
})

describe('piano voice through Web Audio graph', () => {
  it('output differs from silence', async () => {
    const { engine, ctx } = await readyPiano()
    engine.noteOn(60, 100, 'p')
    const out = ctx().render(0.3)
    expect(rms(out)).toBeGreaterThan(0.01)
  })

  it('higher velocity is louder', async () => {
    const measure = async (velocity: number) => {
      const { engine, ctx } = await readyPiano()
      engine.noteOn(60, velocity, 'p')
      return rms(ctx().render(0.25))
    }
    const soft = await measure(30)
    const mid = await measure(80)
    const loud = await measure(127)
    expect(mid).toBeGreaterThan(soft * 1.5)
    expect(loud).toBeGreaterThan(mid * 1.2)
  })

  it('note release shortens the sound; sustain keeps it ringing', async () => {
    const tail = async (sustain: boolean) => {
      const { engine, ctx } = await readyPiano({ durationScale: 0.6 })
      if (sustain) engine.setSustain(true, 'ped')
      engine.noteOn(55, 100, 'p')
      ctx().render(0.15)
      engine.noteOff(55, 'p')
      ctx().render(0.3)
      return rms(ctx().render(0.3))
    }
    const released = await tail(false)
    const sustained = await tail(true)
    expect(sustained).toBeGreaterThan(0.005)
    expect(released).toBeLessThan(sustained * 0.02)
  })

  it('releasing the sustain pedal ends sustained notes', async () => {
    const { engine, ctx } = await readyPiano({ durationScale: 0.6 })
    engine.setSustain(true, 'ped')
    engine.noteOn(55, 100, 'p')
    engine.noteOff(55, 'p')
    ctx().render(0.2)
    const before = rms(ctx().render(0.1))
    engine.setSustain(false, 'ped')
    ctx().render(0.3)
    const after = rms(ctx().render(0.1))
    expect(before).toBeGreaterThan(0.005)
    expect(after).toBeLessThan(before * 0.02)
  })

  it('different notes are audibly different (not one pitch-shifted sample)', async () => {
    const render = async (note: number) => {
      const { engine, ctx } = await readyPiano()
      engine.noteOn(note, 100, 'p')
      return ctx().render(0.25)
    }
    const low = await render(40)
    const high = await render(76)
    const hzLow = zeroCrossingHz(low.subarray(800), SR)
    const hzHigh = zeroCrossingHz(high.subarray(800), SR)
    expect(hzHigh).toBeGreaterThan(hzLow * 3)
  })

  it('every voice goes through the master gain (nothing bypasses the master path)', async () => {
    const { audio, engine, ctx } = await readyPiano()
    engine.noteOn(60, 100, 'a')
    engine.noteOn(67, 100, 'b')
    const c = ctx()
    const direct = [...c.destination.inputs]
    expect(direct).toHaveLength(1) // only the master gain feeds the destination
    const master = direct[0]
    expect(master.inputs.size).toBe(2)
    expect(audio.liveVoiceCount).toBe(2)
  })

  it('polyphony renders concurrent voices louder than one', async () => {
    const one = await readyPiano()
    one.engine.noteOn(60, 100, 'a')
    const single = rms(one.ctx().render(0.2))
    const chord = await readyPiano()
    for (const [i, n] of [60, 64, 67, 72].entries()) chord.engine.noteOn(n, 100, `s${i}`)
    const four = rms(chord.ctx().render(0.2))
    expect(four).toBeGreaterThan(single * 1.4)
  })

  it('voices, nodes and sources return to baseline after release and all-notes-off', async () => {
    const { audio, engine, ctx } = await readyPiano()
    engine.noteOn(60, 100, 'a')
    const c = ctx()
    const baseline = 1 // master gain → destination
    for (const n of [62, 64, 65, 67, 69]) engine.noteOn(n, 90, `k${n}`)
    expect(c.connectedNodeCount()).toBe(baseline + 6 * 3)
    engine.noteOff(60, 'a')
    engine.allNotesOff()
    c.render(0.5)
    expect(audio.liveVoiceCount).toBe(0)
    expect(engine.snapshot().voices).toHaveLength(0)
    expect(c.liveSourceCount()).toBe(0)
    expect(c.connectedNodeCount()).toBe(baseline)
    expect(rms(c.render(0.05))).toBe(0)
  })

  it('stolen voices are faded and freed deterministically', async () => {
    const contexts: SimAudioContext[] = []
    const audio = new PianoAudio({
      createContext: () => {
        const c = new SimAudioContext(SR)
        contexts.push(c)
        return c
      },
      lowNote: 28,
      highNote: 100,
      toneOptions: { sampleRate: 8000, durationScale: 0.5 },
      yieldToEventLoop: () => Promise.resolve(),
    })
    await audio.load()
    const engine = new NoteEngine(audio, 4)
    for (let i = 0; i < 10; i++) engine.noteOn(50 + i, 100, `s${i}`)
    expect(engine.snapshot().voices.map((v) => v.note)).toEqual([56, 57, 58, 59])
    contexts[0].render(0.2)
    expect(audio.liveVoiceCount).toBe(4)
  })

  it('natural decay frees the voice even while the key is held', async () => {
    const { audio, engine, ctx } = await readyPiano({ durationScale: 0.05 })
    engine.noteOn(96, 100, 'p')
    ctx().render(0.5)
    expect(audio.liveVoiceCount).toBe(0)
    expect(engine.snapshot().voices).toHaveLength(0)
    expect(engine.snapshot().held).toEqual([96]) // still physically held
  })
})

describe('loading, fallback and error status (piano.basic-status-cleanup)', () => {
  it('reports loading progress, then ready', async () => {
    let release: () => void = () => undefined
    const audio = new PianoAudio({
      createContext: () => new SimAudioContext(SR),
      lowNote: 28,
      highNote: 100,
      toneOptions: { sampleRate: 8000, durationScale: 0.05 },
      yieldToEventLoop: () => new Promise<void>((r) => (release = r)),
    })
    expect(audio.status.voice).toBe('loading')
    const done = audio.load()
    await Promise.resolve()
    expect(audio.status.voice).toBe('loading')
    expect(audio.status.progress).toBeGreaterThan(0)
    expect(audio.status.progress).toBeLessThan(1)
    for (let i = 0; i < 30; i++) {
      release()
      await Promise.resolve()
      await Promise.resolve()
    }
    await done
    expect(audio.status.voice).toBe('ready')
    expect(audio.status.detail).toMatch(/Synthesized/)
  })

  it('plays a labelled fallback tone while loading', async () => {
    const ctxs: SimAudioContext[] = []
    const audio = new PianoAudio({
      createContext: () => {
        const c = new SimAudioContext(SR)
        ctxs.push(c)
        return c
      },
      lowNote: 28,
      highNote: 100,
    })
    expect(audio.status.voice).toBe('loading')
    const engine = new NoteEngine(audio)
    engine.noteOn(60, 100, 'p')
    expect(rms(ctxs[0].render(0.2))).toBeGreaterThan(0.01)
  })

  it('falls back to a playable oscillator when tone generation fails', async () => {
    const { audio, engine, ctx } = await readyPiano({
      renderTone: () => {
        throw new Error('out of memory')
      },
    })
    expect(audio.status.voice).toBe('fallback')
    expect(audio.status.detail).toMatch(/fallback/i)
    engine.noteOn(60, 100, 'p')
    expect(rms(ctx().render(0.2))).toBeGreaterThan(0.01)
  })

  it('reports an error (and no fake success) when Web Audio is unavailable', async () => {
    const audio = new PianoAudio({ createContext: null, lowNote: 28, highNote: 100 })
    await audio.load()
    expect(audio.status.voice).toBe('error')
    expect(audio.status.audio).toBe('unavailable')
    const engine = new NoteEngine(audio)
    engine.noteOn(60, 100, 'p')
    expect(engine.snapshot().held).toEqual([60])
    expect(engine.snapshot().voices).toHaveLength(0)
  })

  it('reports an error when the AudioContext cannot be created', async () => {
    const audio = new PianoAudio({
      createContext: () => {
        throw new Error('NotAllowedError')
      },
      lowNote: 28,
      highNote: 100,
      toneOptions: { sampleRate: 8000, durationScale: 0.05 },
      yieldToEventLoop: () => Promise.resolve(),
    })
    await audio.load()
    const engine = new NoteEngine(audio)
    engine.noteOn(60, 100, 'p')
    expect(audio.status.voice).toBe('error')
    expect(audio.status.detail).toMatch(/NotAllowedError/)
  })

  it('reflects a suspended context truthfully and resumes it', async () => {
    const ctx = new SimAudioContext(SR, 'suspended')
    const audio = new PianoAudio({ createContext: () => ctx, lowNote: 28, highNote: 100, toneOptions: { sampleRate: 8000, durationScale: 0.05 }, yieldToEventLoop: () => Promise.resolve() })
    expect(audio.status.audio).toBe('not-started')
    audio.unlock()
    await Promise.resolve()
    await Promise.resolve()
    expect(audio.status.audio).toBe('running')
  })

  it('dispose stops every voice and closes the context', async () => {
    const { audio, engine, ctx } = await readyPiano()
    engine.noteOn(60, 100, 'a')
    engine.noteOn(64, 100, 'b')
    const c = ctx()
    engine.dispose()
    audio.dispose()
    expect(audio.liveVoiceCount).toBe(0)
    expect(c.liveSourceCount()).toBe(0)
    expect(c.connectedNodeCount()).toBe(0)
    expect(c.state).toBe('closed')
  })
})
