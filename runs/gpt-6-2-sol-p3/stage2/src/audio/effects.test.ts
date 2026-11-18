// @vitest-environment node
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it, vi } from 'vitest'
import { panelUpdate, panelValue, tapDelay } from '../hardware/bindings'
import {
  ampTypes, editUnit, initialSettings, modulation1, modulation2, reverbTypes, toggleGlobal, toggleGroup,
} from '../piano/settings'
import type { Layer, Settings } from '../piano/settings'
import { PianoRack } from '../piano/sound'
import { EffectsRack } from './effects'

const rate = 32000
type Edit = (settings: Settings) => Settings | void
type Signal = readonly [Float32Array, Float32Array]

function rms(samples: Float32Array, from = 0.02, to = 0.78) {
  const window = samples.subarray(Math.round(from * rate), Math.round(to * rate))
  return Math.sqrt(window.reduce((sum, n) => sum + n * n, 0) / window.length)
}

function distance(a: Signal, b: Signal, from?: number, to?: number) {
  return Math.max(...a.map((samples, side) => rms(samples.map((value, i) => value - b[side][i]), from, to)))
}

function band(signal: Float32Array, frequency: number, from: number, to: number) {
  let cos = 0
  let sin = 0
  for (let i = Math.round(from * rate); i < to * rate; i++) {
    const angle = 2 * Math.PI * frequency * i / rate
    cos += signal[i] * Math.cos(angle)
    sin += signal[i] * Math.sin(angle)
  }
  return Math.hypot(cos, sin)
}

function testSignal(context: BaseAudioContext, short: boolean) {
  const source = context.createBufferSource()
  const length = short ? 0.105 : 0.82
  const buffer = context.createBuffer(1, Math.round(rate * length), rate)
  const channel = buffer.getChannelData(0)
  for (let i = 0; i < channel.length; i++) {
    const time = i / rate
    const envelope = Math.min(1, time / 0.005, (length - time) / 0.008)
    const loudness = short ? 0.55 : time < 0.20 || time > 0.52 ? 0.07 : 0.88
    channel[i] = envelope * loudness * (
      0.4 * Math.sin(2 * Math.PI * 270 * time) +
      0.30 * Math.sin(2 * Math.PI * 5400 * time) +
      0.19 * Math.sin(2 * Math.PI * 1110 * time) +
      0.11 * Math.sin(2 * Math.PI * 87 * time)
    )
  }
  source.buffer = buffer
  return source
}

async function renderFx(edit: Edit = () => {}, layer: Layer = 'A', short = false): Promise<Signal> {
  const engine = new OfflineAudioContext(2, Math.round(2.2 * rate), rate)
  const context = engine as unknown as BaseAudioContext
  const master = context.createGain()
  master.gain.value = 0.7
  master.connect(context.destination)
  const effects = new EffectsRack(master, context, () => context.currentTime)
  const settings = initialSettings()
  settings.layers.B.on = true
  settings.layers.B.level = 12
  effects.update(edit(settings) ?? settings)
  const source = testSignal(context, short)
  source.connect(effects.input(layer))
  source.start(0.035)
  const audio = await engine.startRendering()
  source.disconnect()
  effects.dispose()
  master.disconnect()
  return [Float32Array.from(audio.getChannelData(0)), Float32Array.from(audio.getChannelData(1))]
}

async function renderEach<T>(choices: readonly T[], render: (choice: T) => Promise<Signal>) {
  const results: Signal[] = []
  for (const choice of choices) results.push(await render(choice))
  return results
}

function distinct(reference: Signal, output: Signal[], minimum: number) {
  for (const [i, signal] of output.entries()) {
    expect(distance(reference, signal), `variant ${i + 1} versus bypass`).toBeGreaterThan(minimum)
    for (let j = 0; j < i; j++) {
      expect(distance(output[j], signal), `variant ${i + 1} versus variant ${j + 1}`).toBeGreaterThan(minimum)
    }
  }
}

describe('rendered modulation and amp types', () => {
  it('renders all Mod 1 algorithms and responds to rate, amount, envelope and clock', async () => {
    const bypass = await renderFx()
    const types = await renderEach(modulation1, (type) => renderFx((s) => {
      Object.assign(s.layers.A.chain.mod1, { type, on: true, amount: 9, rate: 5 })
    }))
    distinct(bypass, types, 0.009)
    const zero = await renderFx((s) => { Object.assign(s.layers.A.chain.mod1, { type: 'Tremolo', on: true, amount: 0 }) })
    expect(distance(bypass, zero)).toBeLessThan(0.000001)
    const clock = await renderFx((s) => {
      s.effects.clockBpm = 161
      Object.assign(s.layers.A.chain.mod1, { type: 'Tremolo', on: true, amount: 9, rate: 5, sync: true })
    })
    expect(distance(clock, types[1])).toBeGreaterThan(0.008)
    const sensitivity = await renderFx((s) => {
      Object.assign(s.layers.A.chain.mod1, { type: 'A-Wah', on: true, amount: 9, rate: 10 })
    })
    expect(distance(sensitivity, types[3])).toBeGreaterThan(0.003)
  })

  it('renders all Mod 2 algorithms and changes both rate and amount', async () => {
    const bypass = await renderFx()
    const variants = await renderEach(modulation2, (type) => renderFx((s) => {
      Object.assign(s.layers.A.chain.mod2, { type, on: true, amount: 9, rate: 6 })
    }))
    distinct(bypass, variants, 0.008)
    const slow = await renderFx((s) => {
      Object.assign(s.layers.A.chain.mod2, { type: 'Chorus', on: true, amount: 9, rate: 1 })
    })
    const shallow = await renderFx((s) => {
      Object.assign(s.layers.A.chain.mod2, { type: 'Chorus', on: true, amount: 2, rate: 6 })
    })
    expect(distance(slow, variants[0])).toBeGreaterThan(0.008)
    expect(distance(shallow, variants[0])).toBeGreaterThan(0.008)
  })

  it('renders EQ, three distinct cabinets, two resonant filters and To Rotary', async () => {
    const bypass = await renderFx()
    const variants = await renderEach(ampTypes, (type) => renderFx((s) => {
      Object.assign(s.layers.A.chain.amp, { on: true, type, bass: 9, drive: 7 })
      s.effects.rotary.on = true
    }))
    distinct(bypass, variants, 0.008)
    const cutoff = await renderFx((s) => {
      Object.assign(s.layers.A.chain.amp, { type: 'LP24 Filter', on: true, frequency: 8, mid: 8 })
    })
    const driven = await renderFx((s) => {
      Object.assign(s.layers.A.chain.amp, { type: 'Twin', on: true, drive: 0, bass: 9 })
    })
    expect(distance(cutoff, variants[4])).toBeGreaterThan(0.01)
    expect(distance(driven, variants[1])).toBeGreaterThan(0.01)
    const fast = await renderFx((s) => {
      Object.assign(s.layers.A.chain.amp, { type: 'To Rotary', on: true })
      Object.assign(s.effects.rotary, { on: true, fast: true, drive: 3 })
    })
    const fastDirty = await renderFx((s) => {
      Object.assign(s.layers.A.chain.amp, { type: 'To Rotary', on: true })
      Object.assign(s.effects.rotary, { on: true, fast: true, drive: 10 })
    })
    expect(distance(fast, variants[6])).toBeGreaterThan(0.01)
    expect(distance(fast, fastDirty)).toBeGreaterThan(0.01)
    const off = await renderFx((s) => { Object.assign(s.layers.A.chain.amp, { type: 'To Rotary', on: true }) })
    expect(distance(off, bypass)).toBeLessThan(0.000001)
  })
})

describe('rendered delay, compression and reverb', () => {
  it('keeps the dry signal and first echo unfiltered and re-filters each repeat', async () => {
    const variants = await renderEach(['Off', 'LP', 'HP', 'BP'] as const, (filter) =>
      renderFx((s) => { Object.assign(s.layers.A.chain.delay, { on: true, mix: 5, feedback: 9, filter }) }, 'A', true),
    )
    const [flat, low, high, bandpass] = variants
    const bypass = await renderFx(undefined, 'A', true)
    const dry = await renderFx((s) => { Object.assign(s.layers.A.chain.delay, { on: true, mix: 0, feedback: 9 }) }, 'A', true)
    expect(distance(dry, bypass)).toBeLessThan(0.000001)
    for (const output of variants) {
      expect(distance(flat, output, 0.041, 0.12)).toBeLessThan(0.000001)
      expect(distance(flat, output, 0.542, 0.635)).toBeLessThan(0.000001)
    }
    const fraction = (signal: Signal, from: number, to: number) =>
      band(signal[0], 5400, from, to) / band(signal[0], 270, from, to)
    expect(fraction(low, 1.05, 1.135)).toBeLessThan(fraction(flat, 1.05, 1.135) * 0.25)
    expect(fraction(low, 1.55, 1.635)).toBeLessThan(fraction(low, 1.05, 1.135) * 0.3)
    expect(fraction(high, 1.05, 1.135)).toBeGreaterThan(fraction(flat, 1.05, 1.135) * 2)
    const midsToHighs = (signal: Signal) => band(signal[0], 1110, 1.05, 1.135) / band(signal[0], 5400, 1.05, 1.135)
    expect(midsToHighs(bandpass)).toBeGreaterThan(midsToHighs(flat) * 3)
    const sync = await renderFx((s) => {
      s.effects.clockBpm = 200
      Object.assign(s.layers.A.chain.delay, { on: true, sync: true, bpm: 120, feedback: 0, mix: 10 })
    }, 'A', true)
    expect(rms(sync[0], 0.35, 0.42)).toBeGreaterThan(0.02)
    expect(rms(sync[0], 0.54, 0.61)).toBeLessThan(0.000001)
    const eighthNote = await renderFx((s) => {
      s.effects.clockBpm = 200
      Object.assign(s.layers.A.chain.delay, { on: true, sync: true, division: 3, mix: 10 })
    }, 'A', true)
    expect(rms(eighthNote[0], 0.20, 0.27)).toBeGreaterThan(0.02)
    expect(rms(sync[0], 0.20, 0.27)).toBeLessThan(0.000001)
  })

  it('reduces dynamic range and recovers faster in Fast mode', async () => {
    const bypass = await renderFx()
    const renderComp = (fast: boolean) => renderFx((s) => {
      Object.assign(s.layers.A.chain.compressor, { on: true, amount: 9, fast })
    })
    const [slow, fast] = await Promise.all([renderComp(false), renderComp(true)])
    const ratio = (signal: Signal) => rms(signal[0], 0.36, 0.49) / rms(signal[0], 0.1, 0.18)
    expect(ratio(slow)).toBeLessThan(ratio(bypass) * 0.75)
    expect(ratio(fast)).toBeLessThan(ratio(bypass) * 0.75)
    expect(rms(fast[0], 0.67, 0.81)).toBeGreaterThan(rms(slow[0], 0.67, 0.81) * 1.13)
  })

  it('renders all reverb spaces with fully wet output, tone, and distinct tails', async () => {
    const bypass = await renderFx(undefined, 'A', true)
    const variants = await renderEach(reverbTypes, (type) => renderFx((s) => {
      Object.assign(s.layers.A.chain.reverb, { type, on: true, mix: 10 })
    }, 'A', true))
    distinct(bypass, variants, 0.0006)
    const [room, booth, spring, , hall, cathedral] = variants
    expect(rms(hall[0], 0.04, 0.055)).toBeLessThan(0.000001)
    expect(rms(bypass[0], 0.04, 0.055)).toBeGreaterThan(0.05)
    expect(rms(cathedral[0], 0.74, 0.95)).toBeGreaterThan(rms(hall[0], 0.74, 0.95) * 1.1)
    expect(rms(hall[0], 0.41, 0.63)).toBeGreaterThan(rms(booth[0], 0.41, 0.63) + 0.00005)
    expect(distance(room, spring, 0.15, 0.45)).toBeGreaterThan(0.0004)
    const dark = await renderFx((s) => {
      Object.assign(s.layers.A.chain.reverb, { on: true, type: 'Hall', mix: 10, tone: 'Dark' })
    }, 'A', true)
    const bright = await renderFx((s) => {
      Object.assign(s.layers.A.chain.reverb, { on: true, type: 'Hall', mix: 10, tone: 'Bright' })
    }, 'A', true)
    expect(band(dark[0], 5400, 0.14, 0.28)).toBeLessThan(band(bright[0], 5400, 0.14, 0.28) * 0.35)
    const dry = await renderFx((s) => {
      Object.assign(s.layers.A.chain.reverb, { on: true, type: 'Hall', mix: 0, tone: 'Dark' })
    }, 'A', true)
    expect(distance(dry, bypass)).toBeLessThan(0.000001)
  })
})

describe('routing and graph lifecycle', () => {
  it('targets the manual layer, groups the chains, and applies Global across layers', async () => {
    const bypass = await renderFx()
    const a = (s: Settings) => editUnit(s, 'mod1', { on: true, type: 'Ring Mod', amount: 9 })
    const b = (s: Settings) => a(panelUpdate(s, 'effects-focus-piano', true, false)!)
    const group = (s: Settings) => a(toggleGroup(s))
    const global = (s: Settings) => editUnit(toggleGlobal(s, 'delay'), 'delay', { mix: 8, bpm: 180 })
    const localA = await renderFx(a, 'A')
    expect(distance(localA, bypass)).toBeGreaterThan(0.02)
    expect(distance(await renderFx(a, 'B'), bypass)).toBeLessThan(0.000001)
    expect(distance(await renderFx(b, 'B'), localA)).toBeLessThan(0.000001)
    expect(distance(await renderFx(b, 'A'), bypass)).toBeLessThan(0.000001)
    expect(distance(await renderFx(group, 'B'), localA)).toBeLessThan(0.000001)
    const globalA = await renderFx(global, 'A')
    expect(distance(globalA, bypass)).toBeGreaterThan(0.03)
    expect(distance(await renderFx(global, 'B'), globalA)).toBeLessThan(0.000001)
    expect(distance(await renderFx((s) => toggleGlobal(global(s), 'delay'), 'B'), bypass)).toBeLessThan(0.000001)
    const afterTap = tapDelay(global(initialSettings()), 157)
    expect(afterTap.effects.clockBpm).toBe(157)
    expect(panelValue(afterTap, 'effects-delay-tempo')?.text).toBe('157 BPM')
    const allBypassed = await renderFx((s) => ({ ...a(s), effects: { ...s.effects, on: false } }))
    expect(distance(allBypassed, bypass)).toBeLessThan(0.000001)
  })

  it('routes a fully wet reverb tail through the shared Rotary and obeys all bypass', async () => {
    const routed: Edit = (s) => {
      Object.assign(s.layers.A.chain.reverb, { type: 'Hall', on: true, mix: 10 })
      Object.assign(s.layers.A.chain.amp, { type: 'To Rotary', on: true })
    }
    const verb = await renderFx(routed, 'A', true)
    const horn = await renderFx((s) => {
      routed(s)
      Object.assign(s.effects.rotary, { on: true, fast: true })
    }, 'A', true)
    expect(rms(verb[0], 0.24, 0.47)).toBeGreaterThan(0.0002)
    expect(distance(verb, horn, 0.24, 0.47)).toBeGreaterThan(0.0004)
    const bypass = await renderFx(undefined, 'A', true)
    const allOff = await renderFx((s) => {
      routed(s)
      s.effects.rotary.on = true
      s.effects.on = false
    }, 'A', true)
    expect(distance(bypass, allOff)).toBeLessThan(0.000001)
  })

  it('crossfades the all-effects bypass while a signal is sounding', async () => {
    const engine = new OfflineAudioContext(1, Math.round(0.3 * rate), rate)
    const context = engine as unknown as BaseAudioContext
    const master = context.createGain()
    master.connect(context.destination)
    const rack = new EffectsRack(master, context, () => context.currentTime)
    const settings = initialSettings()
    Object.assign(settings.layers.A.chain.delay, { on: true, mix: 10 })
    rack.update(settings)
    const signal = context.createConstantSource()
    signal.offset.value = 0.4
    signal.connect(rack.input('A'))
    signal.start(0.03)
    const pause = engine.suspend(0.14)
    const rendering = engine.startRendering()
    await pause
    const change = context.currentTime
    rack.update({ ...settings, effects: { ...settings.effects, on: false } })
    await engine.resume()
    const audio = await rendering
    const samples = audio.getChannelData(0)
    expect(rms(samples, 0.09, 0.13)).toBeLessThan(0.000001)
    expect(rms(samples, change + 0.05, change + 0.09)).toBeGreaterThan(0.39)
    const span = samples.subarray(Math.floor(change * rate) - 4, Math.floor((change + 0.05) * rate))
    const jump = span.reduce((peak, n, i) => i ? Math.max(peak, Math.abs(n - span[i - 1])) : peak, 0)
    expect(jump).toBeLessThan(0.006)
    signal.disconnect()
    rack.dispose()
    master.disconnect()
  })

  it('connects only the master to the destination and disconnects every allocated node', async () => {
    const renderer = new OfflineAudioContext(2, Math.round(0.8 * rate), rate)
    const native = renderer as unknown as BaseAudioContext
    const tracked = new Map<AudioNode, Set<AudioNode | AudioParam>>()
    const stopped = new Map<OscillatorNode, number>()
    const destinationLinks: AudioNode[] = []
    const context = new Proxy(native, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target)
        if (typeof value !== 'function') return value
        if (typeof key !== 'string' || !key.startsWith('create') || key === 'createBuffer') return value.bind(target)
        return (...args: unknown[]) => {
          const node = Reflect.apply(value, target, args) as AudioNode
          const connections = new Set<AudioNode | AudioParam>()
          tracked.set(node, connections)
          const connect = node.connect.bind(node)
          node.connect = function (destination: AudioNode | AudioParam, ...channels: number[]) {
            connections.add(destination)
            if (destination === target.destination) destinationLinks.push(node)
            return Reflect.apply(connect, node, [destination, ...channels])
          } as typeof node.connect
          const disconnect = node.disconnect.bind(node)
          node.disconnect = (() => { connections.clear(); disconnect() }) as typeof node.disconnect
          if (key === 'createOscillator') {
            const oscillator = node as OscillatorNode
            const stop = oscillator.stop.bind(oscillator)
            stopped.set(oscillator, 0)
            oscillator.stop = (...args) => { stopped.set(oscillator, (stopped.get(oscillator) ?? 0) + 1); stop(...args) }
          }
          return node
        }
      },
    })
    let time = 0.02
    const rack = new PianoRack(context, () => time)
    const s = initialSettings()
    s.layers.B.on = true
    s.layers.B.level = 10
    s.layers.B.type = 'Clav'
    s.layers.A.chain.reverb.on = true
    rack.configure(s)
    const ended = vi.fn()
    const voice = rack.play(60, 118, ended)
    time = 0.23
    voice?.release()
    const rendered = await renderer.startRendering()
    expect(rms(rendered.getChannelData(0))).toBeGreaterThan(0.006)
    expect(destinationLinks).toHaveLength(1)
    expect(destinationLinks[0]).toHaveProperty('curve')
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce())
    for (const [node, links] of tracked) {
      if ('buffer' in node && 'playbackRate' in node) expect(links.size).toBe(0)
    }
    rack.dispose()
    for (const connections of tracked.values()) expect(connections.size).toBe(0)
    expect([...stopped.values()].every((count) => count === 1)).toBe(true)
  })
})
