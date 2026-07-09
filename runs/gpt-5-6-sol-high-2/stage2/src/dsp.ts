import type { AmpType, EffectChainState, EffectUnitId, FeedbackFilter, InstrumentState, LayerId, Mod1Type, Mod2Type, PianoLayerState, PianoType, ReverbType } from './instrument'

const TAU = Math.PI * 2
const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value))

export function rms(signal: Float32Array): number {
  return Math.sqrt(signal.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, signal.length))
}

function shapedVelocity(velocity: number, layer: PianoLayerState): number {
  const exponent = layer.kbTouch === 'Heavy' ? 1.9 : layer.kbTouch === 'Light' ? 0.72 : 1.25
  const raw = velocity ** exponent
  const floor = layer.dynComp * 0.085
  return floor + raw * (1 - floor)
}

function harmonics(type: PianoType): Array<[number, number, number]> {
  switch (type) {
    case 'Grand': return [[1, 1, 1], [2.01, .42, 1.7], [3.99, .19, 2.3], [6.02, .08, 3.1]]
    case 'Upright': return [[1, .82, 1.3], [2.03, .55, 2.2], [3.07, .22, 1.8], [5.12, .14, 3.6]]
    case 'Electric': return [[1, .75, .7], [2, .16, 1.3], [3, .34, 1.8], [7, .08, 2.8]]
    case 'Clav': return [[1, .55, 4], [2, .5, 5], [3, .3, 7], [5, .16, 9]]
    case 'Digital': return [[1, .62, .8], [2, .36, 1.2], [4, .24, 1.6], [.5, .12, .7]]
    case 'Misc': return [[1, .7, 3.3], [4, .32, 4.6], [10, .18, 7.5], [13, .08, 10]]
  }
}

export function renderPianoNote(
  type: PianoType,
  note = 60,
  velocity = 0.75,
  duration = 1,
  sampleRate = 12000,
  layerOverrides: Partial<PianoLayerState> = {},
): Float32Array {
  const layer: PianoLayerState = {
    enabled: true, level: 1, octave: 0, sustped: true, pstick: false, type, model: type,
    kbTouch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false,
    ...layerOverrides,
  }
  const count = Math.max(1, Math.floor(duration * sampleRate))
  const output = new Float32Array(count)
  const frequency = 440 * 2 ** ((note + layer.octave - 69) / 12)
  const gain = shapedVelocity(velocity, layer) * layer.level * .38
  const voices = layer.unison + 1
  const release = layer.softRelease && type !== 'Clav' ? 1.4 : 1
  const timbre = layer.timbre === 'Soft' ? .62 : layer.timbre === 'Mid' ? 1.12 : layer.timbre === 'Bright' ? 1.5 : layer.timbre.startsWith('Dyno') ? 1.8 : 1
  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate
    let sample = 0
    for (let voice = 0; voice < voices; voice += 1) {
      const detune = voices === 1 ? 0 : (voice - (voices - 1) / 2) * (.0015 + layer.unison * .0012)
      for (const [ratio, amount, decay] of harmonics(type)) {
        const brightAmount = ratio > 1 ? amount * timbre : amount
        sample += Math.sin(TAU * frequency * ratio * (1 + detune) * time + ratio * .13) * brightAmount * Math.exp(-time * decay / release)
      }
    }
    if (layer.stringRes) sample += Math.sin(TAU * frequency * 1.502 * time) * .09 * Math.exp(-time * 1.1)
    output[index] = clamp(sample * gain / voices)
  }
  return output
}

function onePole(signal: Float32Array, coefficient: number, highpass = false): Float32Array {
  const output = new Float32Array(signal.length)
  let low = 0
  for (let index = 0; index < signal.length; index += 1) {
    low += coefficient * (signal[index] - low)
    output[index] = highpass ? signal[index] - low : low
  }
  return output
}

function delayed(signal: Float32Array, samples: number, feedback: number, filter: FeedbackFilter): Float32Array {
  const output = new Float32Array(signal)
  let filtered = 0
  for (let index = samples; index < output.length; index += 1) {
    let repeat = output[index - samples] * feedback
    filtered += .16 * (repeat - filtered)
    if (filter === 'LP') repeat = filtered
    else if (filter === 'HP') repeat -= filtered
    else if (filter === 'BP') repeat = filtered - (output[Math.max(0, index - samples - 1)] * feedback * .55)
    output[index] += repeat
  }
  return output
}

function mix(dry: Float32Array, wet: Float32Array, amount: number): Float32Array {
  return Float32Array.from(dry, (sample, index) => clamp(sample * (1 - amount) + wet[index] * amount))
}

export function processEffect(signal: Float32Array, unitId: EffectUnitId, type: string, amount = .5, sampleRate = 12000, feedbackFilter: FeedbackFilter = 'Off'): Float32Array {
  const wet = new Float32Array(signal.length)
  if (unitId === 'mod1') {
    const mode = type as Mod1Type
    for (let i = 0; i < signal.length; i += 1) {
      const t = i / sampleRate
      const lfo = Math.sin(TAU * (1.2 + amount * 7) * t)
      const factor = mode === 'Ring Mod' ? Math.sin(TAU * (32 + amount * 310) * t)
        : mode === 'Pump' ? .35 + .65 * Math.max(0, lfo)
          : mode === 'Tremolo' ? 1 - amount * .72 * (.5 + .5 * lfo)
            : mode === 'A-Pan' ? .78 + amount * .2 * Math.sin(TAU * (2.2 + amount * 5) * t + .8)
            : mode === 'A-Wah' ? .35 + Math.abs(signal[i]) * (1.2 + amount)
              : .62 + .38 * lfo
      wet[i] = clamp(signal[i] * factor)
    }
  } else if (unitId === 'mod2') {
    const offsets: Record<Mod2Type, number> = { Chorus: 43, Flanger: 11, Phaser: 3, Vibe: 19, Ensemble: 67, Spin: 29 }
    const offset = offsets[type as Mod2Type] ?? 23
    for (let i = 0; i < signal.length; i += 1) {
      const delayedSample = signal[Math.max(0, i - offset - Math.round(Math.sin(i / 97) * offset * .3))]
      wet[i] = clamp(signal[i] * .62 + delayedSample * (type === 'Phaser' ? -.48 : .48))
    }
  } else if (unitId === 'delay') {
    return delayed(signal, Math.max(24, Math.floor(sampleRate * (.055 + amount * .24))), .18 + amount * .65, feedbackFilter)
  } else if (unitId === 'ampEq') {
    const mode = type as AmpType
    const filtered = mode === 'LP24 Filter' ? onePole(signal, .04 + amount * .3)
      : mode === 'HP24 Filter' ? onePole(signal, .04 + amount * .3, true) : signal
    const drive = mode === 'Twin' ? 1.8 : mode === 'JC' ? 1.25 : mode === 'Small' ? 3.2 : mode === 'To Rotary' ? .72 : 1 + amount
    for (let i = 0; i < signal.length; i += 1) wet[i] = Math.tanh(filtered[i] * drive) / Math.tanh(Math.max(.1, drive))
  } else if (unitId === 'compressor') {
    const threshold = .34 - amount * .2
    for (let i = 0; i < signal.length; i += 1) {
      const magnitude = Math.abs(signal[i])
      wet[i] = Math.sign(signal[i]) * (magnitude <= threshold ? magnitude : threshold + (magnitude - threshold) * (.48 - amount * .3))
    }
  } else {
    const lengths: Record<ReverbType, number> = { Room: .08, Booth: .035, Spring: .16, Stage: .22, Hall: .38, Cathedral: .62 }
    const taps = Math.max(2, Math.floor((lengths[type as ReverbType] ?? .18) * sampleRate))
    wet.set(signal)
    for (let i = 1; i < taps; i += Math.max(7, Math.floor(taps / 11))) {
      const gain = (1 - i / taps) * (type === 'Spring' ? Math.sin(i * .37) : .42)
      for (let j = i; j < wet.length; j += 1) wet[j] += signal[j - i] * gain * .16
    }
  }
  return mix(signal, wet, amount)
}

export function processEffectChain(signal: Float32Array, chain: EffectChainState, sampleRate = 12000): Float32Array {
  if (chain.allBypass) return new Float32Array(signal)
  let output: Float32Array<ArrayBufferLike> = new Float32Array(signal)
  const order: EffectUnitId[] = ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb']
  for (const unitId of order) {
    const unit = chain[unitId]
    if (unit.on) {
      if (unitId === 'delay') {
        const seconds = .055 + unit.rate * .7
        const synced = [.125, .25, .375, .5, .75].reduce((best, value) => Math.abs(value - seconds) < Math.abs(best - seconds) ? value : best, .25)
        const repeats = delayed(output, Math.floor(sampleRate * (unit.fast ? synced : seconds)), unit.feedback, unit.filter)
        output = mix(output, repeats, unit.mix)
      } else {
        const parameter = unitId === 'reverb' ? unit.mix : unit.amount * .82 + unit.rate * .18
        output = processEffect(output, unitId, unit.type, parameter, sampleRate, unit.filter)
      }
      if (unitId === 'ampEq') {
        const bass = onePole(output, .045)
        const treble = onePole(output, .18, true)
        const mid = onePole(output, .02 + unit.feedback * .32)
        output = Float32Array.from(output, (sample, index) => clamp(sample + bass[index] * (unit.rate - .5) * .5 + mid[index] * (unit.bright - .5) * .4 + treble[index] * (unit.mix - .5) * .5))
      } else if (unitId === 'reverb') {
        const toned = onePole(output, .03 + unit.bright * .4)
        output = mix(output, toned, .24)
      }
    }
  }
  return output
}

export function renderInstrumentNote(state: InstrumentState, note = 60, velocity = .75, duration = 1, sampleRate = 12000): Float32Array {
  const output = new Float32Array(Math.floor(duration * sampleRate))
  if (!state.sectionOn) return output
  for (const layerId of ['A', 'B'] as LayerId[]) {
    const layer = state.layers[layerId]
    if (!layer.enabled) continue
    let layerSignal = renderPianoNote(layer.type, note + (layer.pstick ? state.pitchBend * 2 : 0), velocity, duration, sampleRate, { ...layer, level: 1 })
    layerSignal = processEffectChain(layerSignal, state.effects[layerId], sampleRate)
    if (state.effects[layerId].ampEq.type === 'To Rotary' && state.effects[layerId].ampEq.on && state.rotaryOn) {
      const rotary = processEffect(layerSignal, 'mod2', state.rotaryFast ? 'Spin' : 'Vibe', .36, sampleRate)
      layerSignal = Float32Array.from(rotary, (sample) => Math.tanh(sample * (1 + state.rotaryDrive * 2)))
    }
    for (let index = 0; index < output.length; index += 1) output[index] += layerSignal[index] * layer.level
  }
  return Float32Array.from(output, (sample) => clamp(sample * state.masterLevel))
}
