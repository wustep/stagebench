import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FxChain } from '../src/audio/dsp/effects'
import { AmpType, DelayFilter, Mod1Type, ReverbType, layerGain, type ChainSound, type SoundState } from '../src/audio/dsp/params'
import { mountApp } from './support/app'
import { burst, chainSound, db, envelope, impulse, runChain, silence, through, tone } from './support/fxbench'
import { down, kernelOf, keys, press, render, shiftPress, start, up } from './support/panel'
import { SR, equal, mono, peak, rms, rmsAt } from './support/signal'
import { change, difference, fx, largestStep, makeStage, renderStage, selectType } from './support/stage'

/**
 * Feature: effects.graph
 * One AudioContext, per-layer buses, ordered effects, master gain/limiter, one destination, cleanup.
 */

function allOff(chain: ChainSound): void {
  for (const unit of [chain.mod1, chain.mod2, chain.delay, chain.amp, chain.comp, chain.reverb]) unit.on = false
}

function everythingOn(sound: SoundState): void {
  for (const layer of sound.layers) {
    layer.on = true
    layer.level = 1
    for (const unit of [layer.fx.mod1, layer.fx.mod2, layer.fx.delay, layer.fx.amp, layer.fx.comp, layer.fx.reverb]) unit.on = true
  }
  sound.layers[0].fx.amp.type = AmpType.ToRotary
}

describe('effects.graph: one context, one node, one destination', () => {
  it('however the panel is used there is one AudioContext and one connection to its destination', async () => {
    const app = mountApp()
    await start(app)
    for (const id of ['fx-mod1-on', 'fx-mod2-on', 'fx-delay-on', 'fx-amp-on', 'fx-comp-on', 'fx-reverb-on']) press(app, id)
    for (let presses = 0; presses < 3; presses += 1) press(app, 'fx-amp-type')
    press(app, 'piano-layer-b')
    press(app, 'piano-type')
    shiftPress(app, 'fx-reverb-on')
    press(app, 'rotary-speed')
    await app.settle()
    down(app, 60)
    expect(rms(render(app, 0.3).left)).toBeGreaterThan(0.001)
    up(app, 60)
    await app.settle()

    const { audio } = app.fake
    expect(audio.contexts).toHaveLength(1)
    expect(audio.workletNodes).toHaveLength(1)
    expect(audio.context.scriptNodes).toHaveLength(0)
    expect(audio.connections).toHaveLength(1)
    expect(audio.connections[0].from).toBe(audio.node)
    expect(audio.connections[0].to).toBe(audio.context.destination)
    expect(audio.context.addModuleCalls).toHaveLength(1)
  })

  it('the effects live inside the one audio node: the app creates no other Web Audio nodes', () => {
    // The platform boundary can create exactly two kinds of node, and the engine uses one of each at most.
    const types = readFileSync(join(process.cwd(), 'src', 'platform', 'types.ts'), 'utf8')
    expect(types).toMatch(/createWorkletNode/)
    expect(types).not.toMatch(/createGain|createConvolver|createDelay|createBiquadFilter|createDynamicsCompressor/)
    const engine = readFileSync(join(process.cwd(), 'src', 'audio', 'engine.ts'), 'utf8')
    expect(engine.match(/\.connect\(context\.destination\)/g)).toHaveLength(2) // worklet path, fallback path
    expect(engine).not.toMatch(/new AudioContext|createGain|createConvolver/)
  })
})

describe('effects.graph: per-layer buses', () => {
  it('each layer has its own chain: Layer A\'s effects never touch Layer B\'s signal', async () => {
    const play = async (configure: (sound: SoundState) => void) => {
      const kernel = await makeStage((sound) => {
        sound.layers[1].on = true
        sound.layers[1].level = 1
        selectType(sound.layers[1], 'Electric')
        configure(sound)
      })
      kernel.noteOn(60, 0.8)
      kernel.noteOn(67, 0.8)
      return renderStage(kernel, 0.8)
    }
    const soakA = (sound: SoundState) => {
      const chain = fx(sound, 0)
      for (const unit of [chain.mod1, chain.mod2, chain.delay, chain.amp, chain.comp, chain.reverb]) unit.on = true
    }
    // With Layer A's fader down, only Layer B is heard — and it is bit-for-bit unaffected by A's effects.
    const bAlone = await play((sound) => void (sound.layers[0].level = 0))
    const bWithAEffects = await play((sound) => {
      sound.layers[0].level = 0
      soakA(sound)
    })
    expect(rms(bAlone.left)).toBeGreaterThan(0.005)
    expect(equal(bAlone.left, bWithAEffects.left)).toBe(true)
    expect(equal(bAlone.right, bWithAEffects.right)).toBe(true)
    // The same effects do change Layer A.
    const aDry = await play((sound) => void (sound.layers[1].level = 0))
    const aWet = await play((sound) => {
      sound.layers[1].level = 0
      soakA(sound)
    })
    expect(difference(aDry.left, aWet.left)).toBeGreaterThan(0.2)
  })

  it('the two layers can run different effects at once', async () => {
    const kernel = await makeStage((sound) => {
      sound.layers[1].on = true
      sound.layers[1].level = 1
      fx(sound, 0).reverb.on = true
      fx(sound, 1).delay.on = true
    })
    kernel.noteOn(60, 0.8)
    renderStage(kernel, 0.1)
    kernel.noteOff(60)
    renderStage(kernel, 1.5)
    expect(kernel.voiceCount).toBe(0)
    // Both tails are still ringing, each on its own bus.
    expect(kernel.layerAsleep(0)).toBe(false)
    expect(kernel.layerAsleep(1)).toBe(false)
    expect(rms(renderStage(kernel, 0.2).left)).toBeGreaterThan(1e-5)
  })
})

describe('effects.graph: the documented order', () => {
  // 2 Hz tremolo at full depth: full level at t = 0, silent a quarter of a second later.
  const tremRate = Math.log2(20) / 7

  it('Mod 1 comes before Delay: an echo carries the tremolo of the moment it was played', () => {
    const chain = (c: ChainSound) => {
      allOff(c)
      c.mod1 = { on: true, type: Mod1Type.Tremolo, rate: tremRate, amount: 1 }
      c.delay = { on: true, time: 0.25, feedback: 0, mix: 0.5, filter: DelayFilter.Off, pingPong: false }
    }
    // Played at the tremolo's loudest moment; its echo lands on the tremolo's silent moment.
    const fx1 = new FxChain(SR)
    fx1.configure(chainSound(chain))
    const loud = mono(through(impulse(1), (l, r, n) => fx1.process(l, r, n, true)))
    const echoAt = (signal: Float32Array, seconds: number) => peak(signal.subarray(Math.round(seconds * SR) - 100, Math.round(seconds * SR) + 100))
    // If the tremolo came after the delay, this echo would be silenced.
    expect(echoAt(loud, 0.25)).toBeGreaterThan(0.1)

    // Played at the silent moment: no echo, though the tremolo is at full level when it would land.
    const fx2 = new FxChain(SR)
    fx2.configure(chainSound(chain))
    const late = silence(1)
    late.left[Math.round(0.25 * SR)] = 0.5
    late.right[Math.round(0.25 * SR)] = 0.5
    const quiet = mono(through(late, (l, r, n) => fx2.process(l, r, n, true)))
    expect(echoAt(quiet, 0.5)).toBeLessThan(0.005)
  })

  it('Amp Sim/EQ comes before the Compressor: a bass boost is compressed, not added afterwards', () => {
    const level = (bass: number) => {
      const out = runChain(tone(60, 1.5, 0.1), (c) => {
        allOff(c)
        c.amp = { on: true, type: AmpType.EqOnly, drive: 0, bass, mid: 0, freq: 0.5, treble: 0 }
        c.comp = { on: true, amount: 1, fast: false }
      })
      return rmsAt(out.left, 1, 0.4)
    }
    const boost = db(level(15) / level(0))
    // 15 dB into an 8:1 compressor comes out as about 2 dB. After the compressor it would be all 15.
    expect(boost).toBeGreaterThan(0.5)
    expect(boost).toBeLessThan(5)
  })

  it('the Compressor comes before the Reverb: the tail decays naturally instead of being pumped up', () => {
    const tail = (comp: boolean) => {
      const out = mono(runChain(burst(0.2, 4, 0.5, 440), (c) => {
        allOff(c)
        c.comp = { on: comp, amount: 1, fast: true }
        c.reverb = { on: true, type: ReverbType.Hall, tone: 0, mix: 1 }
      }))
      const env = envelope(out, 0.05)
      const start = env[6]
      let k = 6
      while (k < env.length - 1 && env[k] > start * 0.1) k += 1
      return (k - 6) * 0.05
    }
    // Time for the tail to fall 20 dB, with and without the compressor in front.
    const ratio = tail(true) / tail(false)
    expect(ratio).toBeGreaterThan(0.75)
    expect(ratio).toBeLessThan(1.35)
  })

  it('Delay comes before the Reverb, and Mod 2 before Delay: repeats are reverberated, the reverb is not repeated', () => {
    // Reverb fully wet removes the direct sound. If the delay came after it, the delay's dry path
    // would still be reverb only; what tells the order is the Mod 2 flanger's resonance, which must
    // be present in the echo (Mod 2 before Delay) even though Mod 2 never sees the delay's output.
    const out = mono(runChain(burst(0.05, 2), (c) => {
      allOff(c)
      c.delay = { on: true, time: 0.5, feedback: 0, mix: 1, filter: DelayFilter.Off, pingPong: false }
      c.reverb = { on: true, type: ReverbType.Booth, tone: 0, mix: 0.3 }
    }))
    // Fully wet delay: nothing at all for half a second, then the echo and its reverb.
    expect(rmsAt(out, 0, 0.45)).toBeLessThan(1e-6)
    expect(rmsAt(out, 0.5, 0.1)).toBeGreaterThan(0.01)
    // The reverb's tail follows the echo; it is not itself echoed a second time.
    expect(rmsAt(out, 0.62, 0.1)).toBeGreaterThan(1e-4)
    expect(rmsAt(out, 1.3, 0.3)).toBeLessThan(rmsAt(out, 0.62, 0.1) * 0.05)
  })

  it('Reverb comes before the Rotary: the reverb tail itself is spun', async () => {
    const tail = async (routed: boolean) => {
      const kernel = await makeStage((sound) => {
        const chain = fx(sound)
        chain.reverb = { on: true, type: ReverbType.Hall, tone: 0, mix: 1 }
        chain.amp = { on: routed, type: AmpType.ToRotary, drive: 0, bass: 0, mid: 0, freq: 0.5, treble: 0 }
        sound.rotary.fast = true
      })
      // Let the rotor reach speed, then a short chord, then listen to the tail alone.
      renderStage(kernel, 4)
      for (const note of [72, 76, 79]) kernel.noteOn(note, 0.9)
      renderStage(kernel, 0.1)
      for (const note of [72, 76, 79]) kernel.noteOff(note)
      renderStage(kernel, 0.7)
      expect(kernel.voiceCount).toBe(0)
      return { out: renderStage(kernel, 1.2), horn: kernel.rotorSpeed.horn }
    }
    const spun = await tail(true)
    const plain = await tail(false)
    expect(spun.horn).toBeGreaterThan(6)
    // How strongly the tail's left/right balance swings at the horn's own speed.
    const swing = (out: { left: Float32Array; right: Float32Array }, hz: number) => {
      const left = envelope(out.left, 0.01)
      const right = envelope(out.right, 0.01)
      let re = 0
      let im = 0
      for (let k = 0; k < left.length; k += 1) {
        const balance = (left[k] - right[k]) / (left[k] + right[k] + 1e-12)
        re += balance * Math.cos(2 * Math.PI * hz * k * 0.01)
        im += balance * Math.sin(2 * Math.PI * hz * k * 0.01)
      }
      return (2 * Math.hypot(re, im)) / left.length
    }
    expect(rms(spun.out.left)).toBeGreaterThan(1e-4)
    expect(swing(spun.out, spun.horn)).toBeGreaterThan(0.2)
    expect(swing(plain.out, spun.horn)).toBeLessThan(swing(spun.out, spun.horn) / 3)
  })

  it('the layer level comes after every effect: halving the fader scales the output exactly, even through a compressor and drive', async () => {
    const play = async (level: number) => {
      const kernel = await makeStage((sound) => {
        sound.layers[0].level = level
        sound.master = 0.3
        const chain = fx(sound)
        chain.amp = { on: true, type: AmpType.Twin, drive: 0.8, bass: 3, mid: 0, freq: 0.5, treble: 0 }
        chain.comp = { on: true, amount: 0.9, fast: false }
        chain.reverb = { on: true, type: ReverbType.Room, tone: 0, mix: 0.3 }
      })
      kernel.noteOn(60, 0.9)
      return mono(renderStage(kernel, 0.6))
    }
    const full = await play(1)
    const half = await play(0.5)
    expect(peak(full)).toBeLessThan(0.5) // below the limiter's knee, so the master stage is linear here
    const scaled = full.map((sample) => sample * (layerGain(0.5) / layerGain(1)))
    // Were the level ahead of the compressor or the drive, the shape would change, not just the size.
    expect(difference(scaled, half)).toBeLessThan(1e-4)
  })

  it('master gain and limiter come last: nothing gets round them', async () => {
    const kernel = await makeStage((sound) => {
      everythingOn(sound)
      sound.master = 0
    })
    for (const note of [48, 55, 60, 64, 67, 72]) kernel.noteOn(note, 1)
    // Voices, both chains, delay repeats, reverb, and the Rotary are all running — into a closed master.
    expect(peak(renderStage(kernel, 1).left)).toBe(0)
    expect(kernel.voiceCount).toBeGreaterThan(0)
    change(kernel, (sound) => void (sound.master = 1))
    const out = renderStage(kernel, 1)
    expect(rms(out.left)).toBeGreaterThan(0.01)
    expect(peak(out.left)).toBeLessThanOrEqual(1)
    expect(peak(out.right)).toBeLessThanOrEqual(1)
  })
})

describe('effects.graph: stability', () => {
  it('every unit and type at its extreme settings stays finite and inside the limiter', async () => {
    for (let type = 0; type < 7; type += 1) {
      const kernel = await makeStage((sound) => {
        everythingOn(sound)
        sound.master = 1
        sound.rotary = { fast: type % 2 === 0, stop: false, drive: 1 }
        for (const layer of sound.layers) {
          layer.unison = 3
          layer.fx.mod1 = { on: true, type: type % 6, rate: 1, amount: 1 }
          layer.fx.mod2 = { on: true, type: type % 6, rate: 1, amount: 1 }
          layer.fx.delay = { on: true, time: type % 2 ? 0.02 : 1.5, feedback: 1, mix: 1, filter: type % 4, pingPong: type % 2 === 1 }
          layer.fx.amp = { on: true, type, drive: 1, bass: 15, mid: 15, freq: type % 2 ? 1 : 0, treble: 15 }
          layer.fx.comp = { on: true, amount: 1, fast: true }
          layer.fx.reverb = { on: true, type: type % 6, tone: type % 3, mix: 1 }
        }
      })
      kernel.setSustain(true)
      for (let note = 28; note <= 100; note += 3) kernel.noteOn(note, 1)
      const out = renderStage(kernel, 4)
      for (const channel of [out.left, out.right]) {
        expect(channel.every((sample) => Number.isFinite(sample)), `type ${type}`).toBe(true)
        expect(peak(channel), `type ${type}`).toBeLessThanOrEqual(1)
      }
      // And it can still be silenced.
      kernel.allNotesOff()
      renderStage(kernel, 0.4)
      expect(peak(renderStage(kernel, 0.2).left), `type ${type}`).toBe(0)
    }
  })
})

describe('effects.graph: click-free switching', () => {
  it('switching each unit in and out mid-note adds no step larger than the music already has', async () => {
    const units = ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb'] as const
    for (const unit of units) {
      const kernel = await makeStage((sound) => selectType(sound.layers[0], 'Misc'))
      for (const note of [48, 60, 67]) kernel.noteOn(note, 0.7)
      renderStage(kernel, 0.4)
      const before = renderStage(kernel, 0.1)
      const baseline = Math.max(largestStep(before.left), largestStep(before.right))
      change(kernel, (sound) => void (fx(sound)[unit].on = true))
      const switchingIn = renderStage(kernel, 0.1)
      renderStage(kernel, 0.3)
      change(kernel, (sound) => void (fx(sound)[unit].on = false))
      const switchingOut = renderStage(kernel, 0.1)
      for (const moment of [switchingIn, switchingOut]) {
        expect(Math.max(largestStep(moment.left), largestStep(moment.right)), unit).toBeLessThan(baseline * 3 + 0.01)
      }
    }
  })

  it('the all-effects bypass and the Rotary route are click-free too', async () => {
    const kernel = await makeStage((sound) => {
      selectType(sound.layers[0], 'Misc')
      everythingOn(sound)
      sound.layers[1].on = false
    })
    for (const note of [48, 60, 67]) kernel.noteOn(note, 0.7)
    renderStage(kernel, 0.5)
    const baseline = largestStep(renderStage(kernel, 0.1).left)
    change(kernel, (sound) => void (sound.fxOn = false))
    expect(largestStep(renderStage(kernel, 0.1).left)).toBeLessThan(baseline * 3 + 0.01)
    change(kernel, (sound) => void (sound.fxOn = true))
    expect(largestStep(renderStage(kernel, 0.1).left)).toBeLessThan(baseline * 3 + 0.01)
  })

  it('parameter changes glide: a jump in Delay time, EQ, Reverb mix, or type does not click', async () => {
    const changes: Array<[string, (chain: ChainSound) => void]> = [
      ['delay time', (c) => void (c.delay.time = 0.09)],
      ['delay mix', (c) => void (c.delay.mix = 1)],
      ['eq bass', (c) => void (c.amp.bass = -15)],
      ['eq treble', (c) => void (c.amp.treble = 15)],
      ['reverb mix', (c) => void (c.reverb.mix = 0)],
      ['reverb type', (c) => void (c.reverb.type = ReverbType.Booth)],
      ['mod1 type', (c) => void (c.mod1.type = Mod1Type.RingMod)],
      ['amp type', (c) => void (c.amp.type = AmpType.Small)],
      ['comp amount', (c) => void (c.comp.amount = 1)],
    ]
    for (const [name, apply] of changes) {
      const kernel = await makeStage((sound) => {
        selectType(sound.layers[0], 'Misc')
        const chain = fx(sound)
        for (const unit of [chain.mod1, chain.mod2, chain.delay, chain.amp, chain.comp, chain.reverb]) unit.on = true
        chain.amp.type = AmpType.EqOnly
        chain.amp.drive = 0
        chain.mod1.type = Mod1Type.Tremolo
        chain.mod1.amount = 0.2
      })
      for (const note of [48, 60, 67]) kernel.noteOn(note, 0.6)
      renderStage(kernel, 0.6)
      const baseline = largestStep(renderStage(kernel, 0.1).left)
      change(kernel, (sound) => apply(fx(sound)))
      expect(largestStep(renderStage(kernel, 0.1).left), name).toBeLessThan(baseline * 3 + 0.01)
    }
  })
})

describe('effects.graph: cleanup', () => {
  it('when the last tail has died the layer sleeps, its effect memory is cleared, and the output is exactly zero', async () => {
    const kernel = await makeStage((sound) => {
      const chain = fx(sound)
      chain.delay = { on: true, time: 0.2, feedback: 0.5, mix: 0.5, filter: DelayFilter.LP, pingPong: false }
      chain.reverb = { on: true, type: ReverbType.Room, tone: 0, mix: 0.4 }
      chain.amp = { on: true, type: AmpType.Twin, drive: 0.5, bass: 4, mid: 2, freq: 0.5, treble: 3 }
    })
    kernel.noteOn(60, 0.8)
    renderStage(kernel, 0.2)
    kernel.noteOff(60)
    renderStage(kernel, 0.8)
    expect(kernel.voiceCount).toBe(0)
    // The voice is gone but the echoes are not: the layer is still awake.
    expect(kernel.layerAsleep(0)).toBe(false)
    expect(peak(renderStage(kernel, 0.2).left)).toBeGreaterThan(0)
    renderStage(kernel, 12)
    expect(kernel.layerAsleep(0)).toBe(true)
    expect(peak(renderStage(kernel, 0.5).left)).toBe(0)

    // A note played now sounds exactly as it does on a freshly built instrument: nothing was left behind.
    const fresh = await makeStage((sound) => {
      Object.assign(fx(sound), structuredClone(fx(kernel.getState())))
    })
    kernel.noteOn(64, 0.7)
    fresh.noteOn(64, 0.7)
    const again = renderStage(kernel, 0.6)
    const first = renderStage(fresh, 0.6)
    expect(equal(again.left, first.left)).toBe(true)
    expect(equal(again.right, first.right)).toBe(true)
  })

  it('all notes off silences every voice and drops every effect tail within a quarter of a second', async () => {
    const kernel = await makeStage((sound) => {
      everythingOn(sound)
      for (const layer of sound.layers) {
        layer.fx.delay.feedback = 1
        layer.fx.reverb.type = ReverbType.Cathedral
        layer.fx.reverb.mix = 0.8
      }
    })
    kernel.setSustain(true)
    for (const note of [40, 52, 60, 64, 67]) kernel.noteOn(note, 0.9)
    renderStage(kernel, 1)
    expect(kernel.voiceCount).toBe(10)
    kernel.allNotesOff()
    const fading = renderStage(kernel, 0.25)
    expect(largestStep(fading.left)).toBeLessThan(0.2)
    expect(kernel.voiceCount).toBe(0)
    // No six-second cathedral tail, no endless repeats: nothing at all.
    expect(peak(renderStage(kernel, 0.5).left)).toBe(0)
    expect(kernel.layerAsleep(0)).toBe(true)
    expect(kernel.layerAsleep(1)).toBe(true)
    // And the instrument plays normally straight afterwards.
    kernel.noteOn(60, 0.8)
    expect(rms(renderStage(kernel, 0.2).left)).toBeGreaterThan(0.005)
  })

  it('a key struck right after a panic is not swallowed by it', async () => {
    const kernel = await makeStage((sound) => void (fx(sound).reverb.on = true))
    kernel.noteOn(48, 0.9)
    renderStage(kernel, 0.3)
    kernel.allNotesOff()
    renderStage(kernel, 0.02)
    kernel.noteOn(60, 0.8)
    expect(rms(renderStage(kernel, 0.1).left)).toBeGreaterThan(0.005)
  })

  it('unmounting with effects running stops every voice, closes the one context, and leaves no timers or listeners', async () => {
    const app = mountApp()
    await start(app)
    for (const id of ['fx-delay-on', 'fx-reverb-on', 'fx-mod2-on']) press(app, id)
    keys(app, 'fx-delay-feedback', 'End')
    press(app, 'piano-layer-b')
    await app.settle()
    for (const note of [48, 60, 64]) down(app, note)
    render(app, 0.3)
    expect(kernelOf(app).voiceCount).toBe(6)
    const { audio, events, timing } = app.fake
    const kernel = kernelOf(app)

    app.unmount()
    expect(audio.context.closed).toBe(true)
    expect(audio.node.connected).toBe(false)
    expect(audio.node.port.onmessage).toBeNull()
    expect(events.listenerCount).toBe(0)
    expect(timing.pendingTimers).toBe(0)
    audio.node.render(0.5)
    expect(kernel.voiceCount).toBe(0)
    expect(peak(audio.node.render(0.2).left)).toBe(0)
    expect(audio.contexts).toHaveLength(1)
  })

  it('a session disposes its panel bindings too', async () => {
    const { createSession } = await import('../src/app/session')
    const { createFakePlatform } = await import('./support/fakes')
    const fake = createFakePlatform()
    const session = createSession(fake.platform)
    expect(session.stage.listenerCount).toBe(2) // the binder and the engine feed
    expect(session.hardware.listenerCount).toBe(1) // the binder
    expect(session.engine.listenerCount).toBe(1)
    session.dispose()
    expect(session.stage.listenerCount).toBe(0)
    expect(session.hardware.listenerCount).toBe(0)
    expect(session.engine.listenerCount).toBe(0)
    expect(fake.events.listenerCount).toBe(0)
    expect(fake.timing.pendingTimers).toBe(0)
  })
})
