/** Synth voice synthesis — Analog mode with required waveforms */

import {
  categoryOf,
  type ArpDirection,
  type FilterType,
  type KbTrack,
  type SynthLayerId,
  type SynthLayerState,
  type SynthWaveform,
} from '../model/synth-types'

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export interface SynthVoice {
  oscs: OscillatorNode[]
  gains: GainNode[]
  noise?: AudioBufferSourceNode
  amp: GainNode
  filter: BiquadFilterNode
  lfo?: OscillatorNode
  lfoGain?: GainNode
  midi: number
  layer: SynthLayerId
  noteId: string
  baseFreq: number
}

export interface SynthBuses {
  A: GainNode
  B: GainNode
  C: GainNode
  levelA: GainNode
  levelB: GainNode
  levelC: GainNode
}

export function createSynthBuses(ctx: AudioContext): SynthBuses {
  const make = () => {
    const bus = ctx.createGain()
    const level = ctx.createGain()
    bus.connect(level)
    return { bus, level }
  }
  const a = make()
  const b = make()
  const c = make()
  a.level.gain.value = 0.7
  b.level.gain.value = 0
  c.level.gain.value = 0
  return {
    A: a.bus,
    B: b.bus,
    C: c.bus,
    levelA: a.level,
    levelB: b.level,
    levelC: c.level,
  }
}

function oscTypeFor(wave: SynthWaveform): OscillatorType {
  if (wave === 'Sine') return 'sine'
  if (wave === 'Triangle') return 'triangle'
  if (wave === 'Square' || wave === 'Pulse 33' || wave === 'Pulse 10' || wave === 'Sync Square' || wave === 'Super Square')
    return 'square'
  return 'sawtooth'
}

function filterConfig(type: FilterType): BiquadFilterType {
  if (type === 'HP') return 'highpass'
  if (type === 'BP') return 'bandpass'
  return 'lowpass'
}

function kbTrackAmount(track: KbTrack): number {
  if (track === 'Off') return 0
  if (track === '1/3') return 1 / 3
  if (track === '2/3') return 2 / 3
  return 1
}

function cutoffHz(freqKnob: number, midi: number, track: KbTrack): number {
  const base = 40 * Math.pow(2, freqKnob * 9) // ~40Hz..20kHz
  const trackAmt = kbTrackAmount(track)
  const keyFactor = Math.pow(2, ((midi - 60) / 12) * trackAmt)
  return Math.min(18000, base * keyFactor)
}

function lfoRateHz(rate: number, clockSync: boolean, bpm: number): number {
  if (clockSync) {
    // map rate to divisions
    const divs = [0.25, 0.5, 1, 2, 4, 8]
    const i = Math.min(divs.length - 1, Math.floor(rate * divs.length))
    return (bpm / 60) * divs[i]!
  }
  return 0.1 + rate * 12
}

export function spawnSynthVoice(
  ctx: AudioContext,
  bus: GainNode,
  noteId: string,
  midi: number,
  velocity: number,
  layer: SynthLayerId,
  state: SynthLayerState,
  zoneGain: number,
  masterBpm: number,
  glideFromMidi?: number,
): SynthVoice | null {
  if (zoneGain <= 0.001) return null
  const now = ctx.currentTime
  const playMidi = midi + state.octave * 12
  let freq = midiToFreq(playMidi)
  const wave = state.waveform
  const cat = categoryOf(wave)
  const oscCtrl = state.oscCtrl

  // Osc Ctrl by category
  if (cat === 'Sync') {
    // relative sync pitch affects tone via detune of secondary
  } else if (cat === 'Multi' || cat === 'Super') {
    // detune amount
  } else if (cat === 'FM-H') {
    // FM amount
  }

  const amp = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  filter.type = filterConfig(state.filterType)
  filter.frequency.value = cutoffHz(state.filterFreq, playMidi, state.filterKbTrack)
  filter.Q.value = 0.5 + state.filterRes * 18
  if (state.filterType === 'LP24') filter.Q.value += 2

  const velAmt =
    state.ampEnv.velocity === 'Off'
      ? 0.7
      : state.ampEnv.velocity === 1
        ? 0.5 + velocity * 0.3
        : state.ampEnv.velocity === 2
          ? 0.3 + velocity * 0.55
          : velocity
  const peak = (0.1 + velAmt * 0.45) * zoneGain * state.level

  const atk = 0.002 + state.ampEnv.attack * 1.5
  const dec = 0.02 + state.ampEnv.decay * 2
  amp.gain.setValueAtTime(0, now)
  amp.gain.linearRampToValueAtTime(peak, now + atk)
  // decay to sustain (decay max ≈ sustain)
  const sus = state.ampEnv.decay > 0.95 ? peak : peak * 0.65
  amp.gain.linearRampToValueAtTime(sus, now + atk + dec)

  // filter envelope
  const fAtk = 0.002 + state.filterEnv.attack * 1.2
  const fEnv = state.filterEnvAmt * 4000 * (state.filterEnv.velocity ? velocity : 1)
  const baseCut = filter.frequency.value
  filter.frequency.setValueAtTime(baseCut, now)
  filter.frequency.linearRampToValueAtTime(baseCut + fEnv, now + fAtk)
  filter.frequency.linearRampToValueAtTime(baseCut + fEnv * 0.3, now + fAtk + 0.02 + state.filterEnv.decay * 1.5)

  amp.connect(filter)
  filter.connect(bus)

  // Drive
  if (state.filterDrive !== 'Off') {
    // pre-filter waveshape via gain boost
    const driveGain = 1 + (state.filterDrive as number) * 2
    amp.gain.setValueAtTime(0, now)
    amp.gain.linearRampToValueAtTime(peak * driveGain * 0.5, now + atk)
  }

  const voice: SynthVoice = {
    oscs: [],
    gains: [],
    amp,
    filter,
    midi: playMidi,
    layer,
    noteId,
    baseFreq: freq,
  }

  // Glide
  if (
    glideFromMidi !== undefined &&
    state.glide > 0.01 &&
    (state.voiceMode === 'Mono' || state.voiceMode === 'Legato')
  ) {
    const from = midiToFreq(glideFromMidi + state.octave * 12)
    const glideTime = 0.02 + state.glide * 0.6
    freq = from
    // will ramp oscillator frequencies
    voice.baseFreq = midiToFreq(playMidi)
    const target = voice.baseFreq
    // set below when creating oscs
    void target
    void glideTime
  }

  const startFreq = (() => {
    if (
      glideFromMidi !== undefined &&
      state.glide > 0.01 &&
      (state.voiceMode === 'Mono' || state.voiceMode === 'Legato')
    ) {
      return midiToFreq(glideFromMidi + state.octave * 12)
    }
    return midiToFreq(playMidi)
  })()
  const targetFreq = midiToFreq(playMidi)
  const glideTime =
    glideFromMidi !== undefined && state.glide > 0.01 ? 0.02 + state.glide * 0.6 : 0

  const makeOsc = (f: number, type: OscillatorType, gainLevel: number, detune = 0) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f, now)
    if (glideTime > 0) {
      osc.frequency.linearRampToValueAtTime(targetFreq * (f / startFreq), now + glideTime)
    }
    if (detune) {
      try {
        osc.detune.value = detune
      } catch {
        /* ignore */
      }
    }
    const g = ctx.createGain()
    g.gain.value = gainLevel
    osc.connect(g)
    g.connect(amp)
    osc.start(now)
    voice.oscs.push(osc)
    voice.gains.push(g)
    return osc
  }

  if (wave === 'White Noise') {
    try {
      const len = Math.floor(ctx.sampleRate * 2)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const g = ctx.createGain()
      g.gain.value = 0.25
      src.connect(g)
      g.connect(amp)
      src.start(now)
      voice.noise = src
      voice.gains.push(g)
    } catch {
      makeOsc(startFreq, 'sawtooth', 0.2)
    }
  } else if (cat === 'FM-H') {
    // 2-op FM: modulator → carrier
    const car = ctx.createOscillator()
    car.type = 'sine'
    car.frequency.setValueAtTime(startFreq, now)
    if (glideTime > 0) car.frequency.linearRampToValueAtTime(targetFreq, now + glideTime)
    const mod = ctx.createOscillator()
    mod.type = 'sine'
    mod.frequency.setValueAtTime(startFreq * 2, now)
    const modG = ctx.createGain()
    modG.gain.value = oscCtrl * 600
    mod.connect(modG)
    try {
      modG.connect(car.frequency)
    } catch {
      /* mocks may not support */
    }
    const g = ctx.createGain()
    g.gain.value = 0.28
    car.connect(g)
    g.connect(amp)
    mod.start(now)
    car.start(now)
    voice.oscs.push(car, mod)
    voice.gains.push(g, modG)
  } else if (cat === 'Sync') {
    makeOsc(startFreq, oscTypeFor(wave), 0.22)
    const syncRatio = 1 + oscCtrl * 4
    makeOsc(startFreq * syncRatio, oscTypeFor(wave), 0.12 * oscCtrl)
  } else if (cat === 'Multi') {
    const det = oscCtrl * 25
    makeOsc(startFreq, 'sawtooth', 0.18)
    makeOsc(startFreq, 'sawtooth', 0.12, det)
    makeOsc(startFreq, 'sawtooth', 0.12, -det)
    if (wave === 'Multi Saw 8ve') makeOsc(startFreq * 2, 'sawtooth', 0.1)
  } else if (cat === 'Super') {
    const width = oscCtrl * 40
    for (let i = -2; i <= 2; i++) {
      makeOsc(startFreq, oscTypeFor(wave), 0.08, i * width)
    }
  } else {
    // Pure
    makeOsc(startFreq, oscTypeFor(wave), 0.28)
    if (wave === 'Pulse 33' || wave === 'Pulse 10') {
      // approximate pulse with phase-offset square mix
      makeOsc(startFreq, 'square', wave === 'Pulse 10' ? 0.15 : 0.1, 0)
    }
  }

  // Unison
  if (state.unison !== 'Off') {
    const n = state.unison as number
    for (let i = 1; i <= n; i++) {
      makeOsc(startFreq, oscTypeFor(wave === 'White Noise' ? 'Saw' : wave), 0.06, i * 7)
      makeOsc(startFreq, oscTypeFor(wave === 'White Noise' ? 'Saw' : wave), 0.06, -i * 7)
    }
  }

  // LFO
  if (state.lfoDest !== 'Off' && state.lfoAmount > 0.01) {
    const lfo = ctx.createOscillator()
    const lw = state.lfoWave
    lfo.type = lw === 'Square' ? 'square' : lw === 'Triangle' ? 'triangle' : 'sawtooth'
    lfo.frequency.value = lfoRateHz(state.lfoRate, state.lfoClockSync, masterBpm)
    const lg = ctx.createGain()
    if (state.lfoDest === 'Osc Pitch') {
      lg.gain.value = state.lfoAmount * 50
      lfo.connect(lg)
      for (const o of voice.oscs) {
        try {
          lg.connect(o.detune)
        } catch {
          /* ignore */
        }
      }
    } else if (state.lfoDest === 'Filter Freq') {
      lg.gain.value = state.lfoAmount * 2000
      lfo.connect(lg)
      try {
        lg.connect(filter.frequency)
      } catch {
        /* ignore */
      }
    } else if (state.lfoDest === 'Osc Ctrl') {
      lg.gain.value = state.lfoAmount * 0.5
      // approximate by amp modulation
      lfo.connect(lg)
      try {
        lg.connect(amp.gain)
      } catch {
        /* ignore */
      }
    }
    lfo.start(now)
    voice.lfo = lfo
    voice.lfoGain = lg
  }

  // Vibrato on
  if (state.vibrato === 'On') {
    const v = ctx.createOscillator()
    v.type = 'sine'
    v.frequency.value = state.vibratoRate
    const vg = ctx.createGain()
    vg.gain.value = state.vibratoAmount * 40
    v.connect(vg)
    for (const o of voice.oscs) {
      try {
        vg.connect(o.detune)
      } catch {
        /* ignore */
      }
    }
    v.start(now)
    voice.oscs.push(v)
    voice.gains.push(vg)
  }

  return voice
}

export function releaseSynthVoice(ctx: AudioContext, voice: SynthVoice, releaseSec: number): void {
  const now = ctx.currentTime
  const rel = Math.max(0.02, releaseSec)
  try {
    voice.amp.gain.cancelScheduledValues(now)
    voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), now)
    voice.amp.gain.exponentialRampToValueAtTime(0.0001, now + rel)
  } catch {
    /* ignore */
  }
  window.setTimeout(() => stopSynthVoice(voice), rel * 1000 + 40)
}

export function stopSynthVoice(voice: SynthVoice): void {
  for (const o of voice.oscs) {
    try {
      o.stop()
      o.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (voice.noise) {
    try {
      voice.noise.stop()
      voice.noise.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (voice.lfo) {
    try {
      voice.lfo.stop()
      voice.lfo.disconnect()
    } catch {
      /* ignore */
    }
  }
  for (const g of voice.gains) {
    try {
      g.disconnect()
    } catch {
      /* ignore */
    }
  }
  try {
    voice.amp.disconnect()
    voice.filter.disconnect()
  } catch {
    /* ignore */
  }
}

/** Deterministic arpeggiator step order */
export function arpSteps(
  notes: number[],
  direction: ArpDirection,
  rangeOctaves: number,
  seed = 0,
): number[] {
  if (notes.length === 0) return []
  const base = [...notes].sort((a, b) => a - b)
  const expanded: number[] = []
  for (let o = 0; o < Math.max(1, rangeOctaves); o++) {
    for (const n of base) expanded.push(n + o * 12)
  }
  if (direction === 'Up') return expanded
  if (direction === 'Down') return [...expanded].reverse()
  if (direction === 'Up/Down') {
    if (expanded.length <= 1) return expanded
    return [...expanded, ...expanded.slice(1, -1).reverse()]
  }
  // Random but deterministic from seed
  const arr = [...expanded]
  let s = seed + notes.reduce((a, b) => a + b, 0) * 17
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

export function waveformSignature(wave: SynthWaveform): number[] {
  const cat = categoryOf(wave)
  const catId = { Pure: 1, Sync: 2, Multi: 3, Super: 4, 'FM-H': 5 }[cat]
  const idx = wave.length + wave.charCodeAt(0)
  return [catId, idx % 7, (idx * 3) % 11, catId * 10 + (idx % 5)]
}

export function filterSignature(type: FilterType, freq: number, res: number): number {
  const t = { LP12: 1, LP24: 2, HP: 3, BP: 4 }[type]
  return t * 100 + freq * 50 + res * 30
}
