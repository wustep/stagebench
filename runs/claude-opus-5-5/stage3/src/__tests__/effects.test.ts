// effects.processing — every Layer Effects unit and every listed type processes real audio:
// a standardized test signal is rendered through each unit in the Web Audio simulator and
// compared with bypass and with the other types of the same unit.
import { describe, expect, it } from 'vitest'
import { AmpEqUnit, CompUnit } from '../audio/fx/ampEq'
import type { FxUnit } from '../audio/fx/common'
import { DelayUnit, delaySeconds, TapTempo, tempoForSeconds } from '../audio/fx/delay'
import { Mod1Unit, Mod2Unit, MOD1_TYPES, MOD2_TYPES, type Mod1Type, type Mod2Type } from '../audio/fx/modulation'
import { ReverbUnit } from '../audio/fx/reverb'
import { RotaryUnit } from '../audio/fx/rotary'
import type { AudioContextLike, BufferLike } from '../audio/webAudioTypes'
import { AMP_TYPES, defaultChain, REVERB_TYPES, type AmpType, type ReverbType } from '../model/sound'
import { brightness, difference, rms, SimAudioContext } from '../testing/simAudio'

const SR = 16000

/** Standard test signal: a bright decaying 220 Hz saw pluck, repeated every 0.25 s (plus a quiet note). */
function testSignal(ctx: AudioContextLike, seconds: number, loud = 0.5, quiet = 0.5): BufferLike {
  const n = Math.round(seconds * SR)
  const buf = ctx.createBuffer(1, n, SR)
  const d = new Float32Array(n)
  const period = Math.round(0.25 * SR)
  for (let i = 0; i < n; i++) {
    const k = i % period
    const idx = Math.floor(i / period)
    const amp = idx % 2 === 0 ? loud : quiet
    const t = k / SR
    const saw = 2 * ((220 * t) % 1) - 1
    d[i] = amp * saw * Math.exp(-t / 0.08)
  }
  buf.copyToChannel(d, 0)
  return buf
}

interface Rig<U> {
  ctx: SimAudioContext
  unit: U
  render: (seconds: number) => { mono: Float32Array; left: Float32Array; right: Float32Array }
}

function rig<U extends { input: { connect: unknown }; output: { connect(d: never): unknown } }>(
  make: (ctx: SimAudioContext) => U,
  signalSeconds = 1,
  loud = 0.5,
  quiet = 0.5,
  signal: (ctx: AudioContextLike) => BufferLike = (c) => testSignal(c, signalSeconds, loud, quiet),
): Rig<U> {
  const ctx = new SimAudioContext(SR)
  const unit = make(ctx)
  const src = ctx.createBufferSource()
  src.buffer = signal(ctx)
  src.connect(unit.input as never)
  unit.output.connect(ctx.destination as never)
  src.start(0)
  return {
    ctx,
    unit,
    render: (seconds) => {
      const { left, right } = ctx.renderStereo(seconds)
      const mono = new Float32Array(left.length)
      for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2
      return { mono, left, right }
    },
  }
}

function renderUnit<S>(make: (ctx: SimAudioContext) => FxUnit<S>, state: S, active: boolean, seconds = 0.8, loud = 0.5, quiet = 0.5, signalSeconds = seconds) {
  const r = rig(make, signalSeconds, loud, quiet)
  r.unit.apply(state, active, 0)
  return r.render(seconds)
}

const chain = defaultChain()

describe('effects.processing — Mod 1 (every type changes the signal)', () => {
  const mod1 = (type: Mod1Type, on = true) => renderUnit((c) => new Mod1Unit(c), { ...chain.mod1, type, on, amount: 110, rate: 80 }, on)
  const dry = mod1('trem', false)

  it('bypass is transparent: output equals the input signal', () => {
    const r = rig((c) => {
      const g = c.createGain()
      return { input: g, output: g }
    }, 0.8)
    const direct = r.render(0.8).mono
    expect(difference(dry.mono, direct)).toBeLessThan(1e-6)
  })

  it.each(MOD1_TYPES)('%s processes real audio and differs from bypass', (type) => {
    const out = mod1(type)
    expect(rms(out.mono)).toBeGreaterThan(0.005)
    expect(difference(out.mono, dry.mono) + difference(out.left, out.right)).toBeGreaterThan(0.05)
  })

  it('all six Mod 1 types are mutually distinct', () => {
    const outs = MOD1_TYPES.map((t) => mod1(t))
    for (let i = 0; i < outs.length; i++)
      for (let j = i + 1; j < outs.length; j++) {
        const d = difference(outs[i].mono, outs[j].mono) + difference(outs[i].left, outs[j].left)
        expect(d, `${MOD1_TYPES[i]} vs ${MOD1_TYPES[j]}`).toBeGreaterThan(0.02)
      }
  })

  it('A-Pan moves the image between channels; Tremolo keeps full level at zero amount', () => {
    const pan = mod1('pan')
    expect(difference(pan.left, pan.right)).toBeGreaterThan(0.1)
    const trem0 = renderUnit((c) => new Mod1Unit(c), { ...chain.mod1, type: 'trem', on: true, amount: 0 }, true)
    // After the 20 ms bypass crossfade, zero-amount tremolo is the dry signal at full level.
    expect(difference(trem0.mono.subarray(800), dry.mono.subarray(800))).toBeLessThan(0.02)
  })

  it('Amount is a primary parameter: more amount = more change', () => {
    const lo = renderUnit((c) => new Mod1Unit(c), { ...chain.mod1, type: 'trem', on: true, amount: 30, rate: 80 }, true)
    const hi = renderUnit((c) => new Mod1Unit(c), { ...chain.mod1, type: 'trem', on: true, amount: 127, rate: 80 }, true)
    expect(difference(hi.mono, dry.mono)).toBeGreaterThan(difference(lo.mono, dry.mono))
  })
})

describe('effects.processing — Mod 2 (every type changes the signal)', () => {
  const mod2 = (type: Mod2Type, on = true, amount = 100) => renderUnit((c) => new Mod2Unit(c), { ...chain.mod2, type, on, amount, rate: 70 }, on)
  const dry = mod2('chorus', false)

  it.each(MOD2_TYPES)('%s processes real audio and differs from bypass', (type) => {
    const out = mod2(type)
    expect(rms(out.mono)).toBeGreaterThan(0.005)
    expect(difference(out.mono, dry.mono) + difference(out.left, out.right)).toBeGreaterThan(0.05)
  })

  it('all six Mod 2 types are mutually distinct', () => {
    const outs = MOD2_TYPES.map((t) => mod2(t))
    for (let i = 0; i < outs.length; i++)
      for (let j = i + 1; j < outs.length; j++) {
        const d = difference(outs[i].mono, outs[j].mono) + difference(outs[i].left, outs[j].left)
        expect(d, `${MOD2_TYPES[i]} vs ${MOD2_TYPES[j]}`).toBeGreaterThan(0.02)
      }
  })

  it('Amount changes the processed signal', () => {
    expect(difference(mod2('flanger', true, 10).mono, mod2('flanger', true, 127).mono)).toBeGreaterThan(0.02)
  })
})

describe('effects.processing — Delay', () => {
  // One pluck (0.25 s) then silence, so later energy is delay output.
  const TEMPO = tempoForSeconds(0.3)
  const delay = (patch: Partial<typeof chain.delay>, on = true, seconds = 1.2) =>
    renderUnit((c) => new DelayUnit(c), { ...chain.delay, on, tempo: TEMPO, feedback: 90, dryWet: 64, ...patch }, on, seconds, 0.5, 0, 0.25)

  it('repeats appear after the delay time and bypass removes them', () => {
    const secs = delaySeconds(TEMPO)
    const on = delay({})
    const off = delay({}, false)
    const at = Math.round((secs + 0.002) * SR)
    const w = Math.round(0.04 * SR)
    expect(secs).toBeGreaterThan(0.25)
    expect(rms(on.mono, at, at + w)).toBeGreaterThan(0.05)
    expect(rms(on.mono, at, at + w)).toBeGreaterThan(rms(off.mono, at, at + w) * 5)
  })

  it('Feedback lengthens the tail; Tempo moves the repeats; Dry/Wet balances them', () => {
    const tail = (x: Float32Array) => rms(x, Math.round(0.8 * SR), Math.round(1.2 * SR))
    expect(tail(delay({ feedback: 120 }).mono)).toBeGreaterThan(tail(delay({ feedback: 10 }).mono) * 2)
    expect(difference(delay({ tempo: 50 }).mono, delay({ tempo: 90 }).mono)).toBeGreaterThan(0.1)
    const dryOnly = delay({ dryWet: 0 })
    const wetOnly = delay({ dryWet: 127 })
    // After the 20 ms mix ramp: fully dry passes the pluck, fully wet holds only repeats.
    const head = (x: Float32Array) => rms(x, Math.round(0.025 * SR), Math.round(0.06 * SR))
    expect(head(dryOnly.mono)).toBeGreaterThan(head(wetOnly.mono) * 5)
  })

  it('feedback filter processes the repeats (progressively filtered), not the dry path', () => {
    const secs = delaySeconds(TEMPO)
    // A 40 ms deterministic noise burst: broadband, so each filter pass visibly removes energy.
    const burst = (c: AudioContextLike) => {
      const b = c.createBuffer(1, SR, SR)
      const d = new Float32Array(SR)
      let seed = 12345
      for (let i = 0; i < 0.04 * SR; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        d[i] = 0.5 * ((seed / 0x7fffffff) * 2 - 1)
      }
      b.copyToChannel(d, 0)
      return b
    }
    const run = (filter: 'off' | 'lp' | 'hp' | 'bp') => {
      const r = rig((c) => new DelayUnit(c), 1, 0, 0, burst)
      r.unit.apply({ ...chain.delay, on: true, tempo: TEMPO, feedback: 110, dryWet: 64, filter }, true, 0)
      return r.render(1.4).mono
    }
    const off = run('off')
    const lp = run('lp')
    const seg = (k: number) => {
      const a = Math.round(k * secs * SR)
      return [a, a + Math.round(0.06 * SR)] as const
    }
    // Dry burst is identical with and without the filter.
    const head = Math.round(0.04 * SR)
    expect(difference(lp.subarray(0, head), off.subarray(0, head))).toBeLessThan(1e-3)
    // Every repeat is filtered (far darker than the unfiltered repeats), and each successive repeat
    // has passed the LP once more, so it is darker than the one before (until only the passband is left).
    const b = (x: Float32Array, k: number) => brightness(x, ...seg(k))
    for (const k of [1, 2, 3]) expect(b(lp, k)).toBeLessThan(0.5 * b(off, k))
    expect(b(lp, 2)).toBeLessThan(b(lp, 1) * 0.95)
    expect(b(lp, 3)).toBeLessThan(b(lp, 2))
    expect(rms(lp, ...seg(1))).toBeLessThan(rms(off, ...seg(1)) * 0.8)
    for (const f of ['hp', 'bp'] as const) expect(difference(run(f), off)).toBeGreaterThan(0.05)
  })

  it('tap tempo and the Tempo knob agree', () => {
    const tap = new TapTempo()
    expect(tap.tap(1000)).toBeNull()
    const s = tap.tap(1400)!
    expect(s).toBeCloseTo(0.4, 5)
    expect(delaySeconds(tempoForSeconds(s))).toBeCloseTo(0.4, 1)
  })
})

describe('effects.processing — Amp Sim/EQ and Compressor', () => {
  const amp = (type: AmpType, patch: Partial<typeof chain.amp> = {}, on = true) =>
    renderUnit((c) => new AmpEqUnit(c), { ...chain.amp, on, type, drive: 90, ...patch }, on)
  const dry = amp('eq', {}, false)

  it.each(AMP_TYPES)('%s processes real audio', (type) => {
    const out = amp(type, type === 'eq' || type === 'rotary' ? { bass: 120, treble: 10 } : { mid: 100, freq: 50 })
    expect(rms(out.mono)).toBeGreaterThan(0.005)
    expect(difference(out.mono, dry.mono)).toBeGreaterThan(0.05)
  })

  it('Twin, JC and Small amp models are mutually distinct; LP24 and HP24 differ', () => {
    const [twin, jc, small] = (['twin', 'jc', 'small'] as const).map((t) => amp(t))
    expect(difference(twin.mono, jc.mono)).toBeGreaterThan(0.05)
    expect(difference(twin.mono, small.mono)).toBeGreaterThan(0.05)
    expect(difference(jc.mono, small.mono)).toBeGreaterThan(0.05)
    const lp = amp('lp24', { freq: 40 })
    const hp = amp('hp24', { freq: 40 })
    expect(brightness(lp.mono)).toBeLessThan(brightness(dry.mono))
    expect(brightness(hp.mono)).toBeGreaterThan(brightness(dry.mono))
  })

  it('EQ bass/treble tilt the spectrum; Drive changes the amp', () => {
    const bright = amp('eq', { treble: 127, bass: 0 })
    const dark = amp('eq', { treble: 0, bass: 127 })
    expect(brightness(bright.mono)).toBeGreaterThan(brightness(dark.mono) * 1.3)
    expect(difference(amp('twin', { drive: 5 }).mono, amp('twin', { drive: 127 }).mono)).toBeGreaterThan(0.05)
  })

  it('Compressor narrows the dynamic range; Amount and Fast change the result', () => {
    // Sustained 220 Hz tone: loud (0.8) for 0.3 s, then quiet (0.08).
    const tone = (c: AudioContextLike) => {
      const n = SR
      const b = c.createBuffer(1, n, SR)
      const d = new Float32Array(n)
      for (let i = 0; i < n; i++) d[i] = (i < 0.3 * SR ? 0.8 : 0.08) * Math.sin((2 * Math.PI * 220 * i) / SR)
      b.copyToChannel(d, 0)
      return b
    }
    const comp = (patch: Partial<typeof chain.comp>, on = true) => {
      const r = rig((c) => new CompUnit(c), 1, 0, 0, tone)
      r.unit.apply({ ...chain.comp, on, amount: 110, ...patch }, on, 0)
      return r.render(1)
    }
    const ratio = (x: Float32Array) => rms(x, Math.round(0.15 * SR), Math.round(0.28 * SR)) / rms(x, Math.round(0.8 * SR), Math.round(0.95 * SR))
    const off = comp({}, false)
    const on = comp({})
    expect(ratio(on.mono)).toBeLessThan(ratio(off.mono) * 0.8)
    expect(difference(comp({ amount: 20 }).mono, comp({ amount: 127 }).mono)).toBeGreaterThan(0.02)
    expect(difference(comp({ fast: false }).mono, comp({ fast: true }).mono)).toBeGreaterThan(0.005)
  })
})

describe('effects.processing — Reverb', () => {
  // Shared impulse-response cache (same sample rate); IRs at half length keep tests quick.
  const cache = new Map<ReverbType, BufferLike>()
  const reverb = (type: ReverbType, patch: Partial<typeof chain.reverb> = {}, on = true) =>
    renderUnit((c) => new ReverbUnit(c, cache, 0.5), { ...chain.reverb, on, type, dryWet: 90, ...patch }, on, 0.8, 0.5, 0, 0.1)

  it.each(REVERB_TYPES)('%s adds a reverberant tail that bypass does not have', (type) => {
    const wet = reverb(type)
    const dry = reverb(type, {}, false)
    // The dry pluck ends at 0.1 s; anything after it is reverberation.
    const tailAt = Math.round(0.105 * SR)
    expect(rms(dry.mono, tailAt, tailAt + 800)).toBe(0)
    expect(rms(wet.mono, tailAt, tailAt + 800)).toBeGreaterThan(2e-4)
  })

  it('types are distinct; decay grows from Booth to Cathedral; Spring differs from Room', () => {
    const outs = REVERB_TYPES.map((t) => reverb(t))
    for (let i = 0; i < outs.length; i++)
      for (let j = i + 1; j < outs.length; j++) expect(difference(outs[i].mono, outs[j].mono), `${REVERB_TYPES[i]}/${REVERB_TYPES[j]}`).toBeGreaterThan(0.02)
    const late = (x: Float32Array) => rms(x, Math.round(0.35 * SR), Math.round(0.6 * SR))
    const booth = outs[REVERB_TYPES.indexOf('booth')]
    const cathedral = outs[REVERB_TYPES.indexOf('cathedral')]
    expect(late(cathedral.mono)).toBeGreaterThan(late(booth.mono) * 3)
  })

  it('Dry/Wet is fully wet at max; Bright/Dark shape the tail', () => {
    const full = reverb('hall', { dryWet: 127 })
    const input = reverb('hall', {}, false)
    // Fully wet: the direct attack is gone (output no longer tracks the dry input).
    expect(difference(full.mono.subarray(0, 400), input.mono.subarray(0, 400))).toBeGreaterThan(0.3)
    const bright = reverb('hall', { tone: 'bright', dryWet: 127 })
    const dark = reverb('hall', { tone: 'dark', dryWet: 127 })
    expect(brightness(bright.mono, 2000, 8000)).toBeGreaterThan(brightness(dark.mono, 2000, 8000))
  })
})

describe('effects.processing — shared Rotary', () => {
  const rotary = (fast: boolean, drive = 40, seconds = 1.2) => {
    const r = rig((c) => new RotaryUnit(c), seconds)
    r.unit.apply({ fast, drive }, 0)
    return r.render(seconds)
  }

  it('moves the sound between channels and Fast modulates faster than Slow', () => {
    const slow = rotary(false)
    const fast = rotary(true)
    expect(difference(slow.left, slow.right)).toBeGreaterThan(0.05)
    expect(difference(slow.mono, fast.mono)).toBeGreaterThan(0.05)
    // Count L/R balance sign changes in 20 ms windows: fast spins through more of them.
    const flips = (o: { left: Float32Array; right: Float32Array }) => {
      let n = 0
      let prev = 0
      for (let a = 0; a + 320 <= o.left.length; a += 320) {
        const s = Math.sign(rms(o.left, a, a + 320) - rms(o.right, a, a + 320))
        if (prev && s && s !== prev) n++
        if (s) prev = s
      }
      return n
    }
    expect(flips(fast)).toBeGreaterThan(flips(slow))
  })

  it('speed changes accelerate smoothly (no instant jump)', () => {
    const r = rig((c) => new RotaryUnit(c), 0.2)
    r.unit.apply({ fast: false, drive: 40 }, 0)
    r.render(0.1)
    r.unit.apply({ fast: true, drive: 40 }, r.ctx.currentTime)
    r.render(0.05)
    const horn = (r.unit as unknown as { rotors: { lfo: { osc: { frequency: { valueAt(t: number): number } } } }[] }).rotors[0]
    const f = horn.lfo.osc.frequency.valueAt(r.ctx.currentTime)
    expect(f).toBeGreaterThan(0.8)
    expect(f).toBeLessThan(6.8)
  })

  it('Drive changes the rotary signal', () => {
    expect(difference(rotary(false, 0, 0.6).mono, rotary(false, 127, 0.6).mono)).toBeGreaterThan(0.05)
  })
})
