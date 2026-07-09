import { processEffect, processEffectChain, renderPianoNote } from './dsp'
import {
  type EffectChainState, type EffectTarget, type InstrumentState, type LayerId, type LfoWaveform, type OrganLayerState,
  type OrganModel, type SynthLayerId, type SynthLayerState, type SynthWaveform,
} from './instrument'
import { morphedValue, routeLayerGain } from './programs'

const TAU = Math.PI * 2
const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value))

export function effectiveEffectChain(state: InstrumentState, target: EffectTarget, chain: EffectChainState): EffectChainState {
  const copy = structuredClone(chain)
  for (const unitId of ['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'] as const) {
    const unit = copy[unitId]
    for (const key of ['rate', 'amount', 'mix', 'feedback', 'bright'] as const) {
      unit[key] = morphedValue(state, `${target}:${unitId}:${key}` as never, unit[key])
    }
  }
  return copy
}

export function effectiveOrganLayer(state: InstrumentState, layerId: LayerId): OrganLayerState {
  const layer = structuredClone(state.organ.layers[layerId])
  layer.drawbars = layer.drawbars.map((value, index) => Math.round(morphedValue(state, `organ:${layerId}:drawbar:${index}`, value / 8) * 8))
  return layer
}

export function effectiveSynthLayer(state: InstrumentState, layerId: SynthLayerId): SynthLayerState {
  const layer = structuredClone(state.synth.layers[layerId])
  layer.oscCtrl = morphedValue(state, `synth:${layerId}:oscCtrl`, layer.oscCtrl)
  layer.lfoRate = morphedValue(state, `synth:${layerId}:lfoRate`, layer.lfoRate)
  layer.lfoAmount = morphedValue(state, `synth:${layerId}:lfoAmount`, layer.lfoAmount)
  layer.filterFreq = morphedValue(state, `synth:${layerId}:filterFreq`, layer.filterFreq)
  layer.filterResonance = morphedValue(state, `synth:${layerId}:filterResonance`, layer.filterResonance)
  layer.arpRate = morphedValue(state, `synth:${layerId}:arpRate`, layer.arpRate)
  if (layer.vibratoMode === 'Wheel') layer.vibratoAmount *= state.morphs.values.wheel
  return layer
}

const organRatios: Record<OrganModel, number[]> = {
  B3: [.5, 1.5, 1, 2, 3, 4, 5, 6, 8],
  'B3 Bass': [.5, 1, 0, 0, 0, 0, 0, 0, 0],
  Vox: [.5, 1, 2, 3, 4, 5, 6, 8, 9],
  Farf: [.5, 1, 2, 3, 4, 5, 6, 8, 10],
  'Pipe 1': [.5, 1, 2, 3, 4, 5, 6, 8, 12],
  'Pipe 2': [.5, 1, 2, 4, 6, 8, 10, 12, 16],
}

function deterministicNoise(index: number, seed: number): number {
  const value = Math.sin((index + 1) * (12.9898 + seed * .013)) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}

export function renderOrganNote(layer: OrganLayerState, note = 60, velocity = .75, duration = 1, sampleRate = 12000): Float32Array {
  const output = new Float32Array(Math.max(1, Math.floor(duration * sampleRate)))
  const frequency = 440 * 2 ** ((note + layer.octave - 69) / 12)
  const ratios = organRatios[layer.model]
  const vibratoDepth = layer.vibratoOn ? (Number(layer.vibrato[1]) || 1) * .0016 : 0
  const chorus = layer.vibrato.startsWith('C')
  for (let index = 0; index < output.length; index += 1) {
    const time = index / sampleRate
    const vibrato = Math.sin(TAU * (5.4 + (Number(layer.vibrato[1]) || 1) * .18) * time) * vibratoDepth
    let sample = 0
    for (let partial = 0; partial < ratios.length; partial += 1) {
      const ratio = ratios[partial]
      if (!ratio) continue
      const raw = layer.drawbars[partial] ?? 0
      const level = layer.model === 'Farf' ? Number(raw >= 4) * .13 : (raw / 8) ** 1.35 * .16
      const phase = TAU * frequency * ratio * (1 + vibrato) * time
      if (layer.model === 'Vox') sample += (Math.sin(phase) + .28 * Math.sin(phase * 2)) * level
      else if (layer.model === 'Farf') sample += (Math.sin(phase) + .32 * Math.sign(Math.sin(phase))) * level
      else if (layer.model.startsWith('Pipe')) sample += Math.sin(phase + partial * .07) * level * (1 - partial * .025)
      else sample += Math.sin(phase) * level
      if (chorus) sample += Math.sin(phase * (1 + vibratoDepth * 1.7) + .3) * level * .45
    }
    if (layer.model.startsWith('B3') && layer.percussion) {
      const harmonic = layer.percussionThird ? 3 : 2
      const decay = layer.percussionFast ? 9 : 3.8
      const level = layer.percussionSoft ? .08 : .16
      sample += Math.sin(TAU * frequency * harmonic * time) * Math.exp(-time * decay) * level
    }
    if (layer.keyClick && index < sampleRate * .014) sample += deterministicNoise(index, note) * (1 - index / (sampleRate * .014)) * .13
    const onset = Math.min(1, time / (layer.model.startsWith('Pipe') ? .055 : .008))
    output[index] = clamp(sample * onset * velocity * layer.level)
  }
  return output
}

function baseWave(waveform: SynthWaveform, phase: number, index: number, note: number): number {
  const wrapped = phase / TAU - Math.floor(phase / TAU)
  if (waveform === 'Sine') return Math.sin(phase)
  if (waveform === 'Triangle') return 1 - 4 * Math.abs(wrapped - .5)
  if (waveform === 'Square' || waveform === 'Sync Square' || waveform === 'Super Square') return wrapped < .5 ? 1 : -1
  if (waveform === 'Pulse 33') return wrapped < .33 ? 1 : -1
  if (waveform === 'Pulse 10') return wrapped < .1 ? 1 : -1
  if (waveform === 'White Noise') return deterministicNoise(index, note)
  return wrapped * 2 - 1
}

function lfoValue(waveform: LfoWaveform, phase: number, index: number): number {
  const wrapped = phase / TAU - Math.floor(phase / TAU)
  if (waveform === 'Triangle') return 1 - 4 * Math.abs(wrapped - .5)
  if (waveform === 'Saw down') return 1 - wrapped * 2
  if (waveform === 'Saw up') return wrapped * 2 - 1
  if (waveform === 'Square') return wrapped < .5 ? 1 : -1
  return deterministicNoise(Math.floor(index / 270), 91)
}

function envelopeValue(time: number, duration: number, attack: number, decay: number, release: number): number {
  const attackSeconds = .002 + attack * 1.4
  const decaySeconds = .02 + decay * 2.4
  const releaseSeconds = .02 + release * Math.min(1.8, duration * .7)
  if (time < attackSeconds) return time / attackSeconds
  const held = .62 + .38 * Math.exp(-(time - attackSeconds) / decaySeconds)
  const releaseStart = Math.max(attackSeconds, duration - releaseSeconds)
  if (time <= releaseStart) return held
  return held * Math.max(0, 1 - (time - releaseStart) / releaseSeconds)
}

function onePoleDynamic(signal: Float32Array, coefficients: Float32Array, highpass = false): Float32Array {
  const output = new Float32Array(signal.length)
  let low = 0
  for (let index = 0; index < signal.length; index += 1) {
    low += coefficients[index] * (signal[index] - low)
    output[index] = highpass ? signal[index] - low : low
  }
  return output
}

export function renderSynthNote(layer: SynthLayerState, note = 60, velocity = .75, duration = 1, sampleRate = 12000, masterClockBpm = 120, previousNote?: number): Float32Array {
  const count = Math.max(1, Math.floor(duration * sampleRate))
  const raw = new Float32Array(count)
  const cutoff = new Float32Array(count)
  const targetPitch = note + layer.octave + layer.coarse + layer.fine / 100
  const voices = layer.unison + 1
  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate
    const ampEnv = envelopeValue(time, duration, layer.ampEnvelope.attack, layer.ampEnvelope.decay, layer.ampEnvelope.release)
    const oscVelocity = layer.oscEnvelope.velocity === 0 ? 1 : .35 + velocity * .65
    const filterVelocity = layer.filterEnvelope.velocity === 0 ? 1 : .35 + velocity * .65
    const oscEnv = envelopeValue(time, duration, layer.oscEnvelope.attack, layer.oscEnvelope.decay, layer.oscEnvelope.release) * oscVelocity
    const filterEnv = envelopeValue(time, duration, layer.filterEnvelope.attack, layer.filterEnvelope.decay, layer.filterEnvelope.release) * filterVelocity
    const rate = layer.lfoSync ? 2 * (masterClockBpm / 60) : .2 + layer.lfoRate * 11.8
    const lfo = layer.lfoDestination === 'Off' ? 0 : lfoValue(layer.lfoWaveform, TAU * rate * time, index) * layer.lfoAmount
    let sample = 0
    for (let voice = 0; voice < voices; voice += 1) {
      const spread = voices === 1 ? 0 : (voice - (voices - 1) / 2) * (.002 + layer.unison * .0018)
      const pitchLfo = layer.lfoDestination === 'Osc Pitch' ? lfo * .025 : 0
      const vibrato = Math.sin(TAU * layer.vibratoRate * time) * layer.vibratoAmount * .018
      const envPitch = (oscEnv - .6) * layer.oscEnvelope.amount * .08
      const arpStepsPerSecond = layer.arpSync ? masterClockBpm / 15 : 2 + layer.arpRate * 14
      const arpStep = Math.floor(time * arpStepsPerSecond)
      const upDownLength = Math.max(1, layer.arpRange * 2 - 2)
      const octave = !layer.arpRun || layer.arpMode === 'Gate' ? 0
        : layer.arpDirection === 'Down' ? layer.arpRange - 1 - (arpStep % layer.arpRange)
          : layer.arpDirection === 'Up/Down' ? Math.abs((arpStep % upDownLength) - (layer.arpRange - 1))
            : layer.arpDirection === 'Random' ? Math.abs(Math.floor(deterministicNoise(arpStep, note) * 1000)) % layer.arpRange
              : arpStep % layer.arpRange
      const glideSeconds = .02 + layer.glide * 1.48
      const glideProgress = previousNote === undefined || layer.voiceMode === 'Poly' ? 1 : Math.min(1, time / glideSeconds)
      const pitch = previousNote === undefined ? targetPitch : previousNote + (targetPitch - previousNote) * glideProgress
      const frequency = 440 * 2 ** ((pitch - 69) / 12)
      const phase = TAU * frequency * 2 ** octave * (1 + spread + pitchLfo + vibrato + envPitch) * time
      const ctrl = clamp(layer.oscCtrl + (layer.lfoDestination === 'Osc Ctrl' ? lfo * .45 : 0), 0, 1)
      if (layer.category === 'Sync') {
        sample += baseWave(layer.waveform, phase * (1 + ctrl * 5), index, note) * .68 + baseWave('Sine', phase, index, note) * .32
      } else if (layer.category === 'Multi') {
        sample += (baseWave('Saw', phase * (1 - ctrl * .025), index, note) + baseWave('Saw', phase * (1 + ctrl * .031), index, note + 1)) * .5
        if (layer.waveform === 'Multi Saw 8ve') sample += baseWave('Saw', phase * 2, index, note) * .28
      } else if (layer.category === 'Super') {
        sample += (baseWave(layer.waveform, phase, index, note) + baseWave(layer.waveform, phase * (1 + ctrl * .045), index, note + 2) + baseWave(layer.waveform, phase * (1 - ctrl * .038), index, note + 3)) / 3
      } else if (layer.category === 'FM-H') {
        const modulator = Math.sin(phase * 2) * ctrl * 8
        sample += Math.sin(phase + modulator)
      } else {
        // Pure deliberately ignores Osc Ctrl.
        sample += baseWave(layer.waveform, phase, index, note)
      }
    }
    const velocityGain = layer.ampEnvelope.velocity === 0 ? 1 : (.35 + velocity * .65) ** (1 + layer.ampEnvelope.velocity * .16)
    const gate = layer.arpRun && (layer.arpMode === 'Gate' || layer.arpMode === 'Poly')
      ? Number((time * (layer.arpSync ? masterClockBpm / 15 : 2 + layer.arpRate * 14)) % 1 < .62) : 1
    raw[index] = sample / voices * ampEnv * velocityGain * gate * .42
    const tracking = layer.filterTracking === 'Off' ? 0 : layer.filterTracking === '1/3' ? 1 / 3 : layer.filterTracking === '2/3' ? 2 / 3 : 1
    const tracked = (note - 60) / 48 * tracking
    const lfoFilter = layer.lfoDestination === 'Filter Freq' ? lfo * .25 : 0
    cutoff[index] = clamp(.006 + (layer.filterFreq + tracked + lfoFilter + filterEnv * layer.filterEnvelope.amount * .24) ** 2 * .5, .002, .82)
  }
  const low = onePoleDynamic(raw, cutoff)
  const low24 = onePoleDynamic(low, cutoff)
  const high = onePoleDynamic(raw, cutoff, true)
  let filtered = layer.filterType === 'LP12' ? low : layer.filterType === 'LP24' ? low24 : layer.filterType === 'HP' ? high
    : Float32Array.from(low, (sample, index) => sample - low24[index])
  if (layer.filterResonance > 0) {
    filtered = Float32Array.from(filtered, (sample, index) => sample + (low[index] - low24[index]) * layer.filterResonance * 2.2)
  }
  const drive = 1 + layer.filterDrive * 1.7
  return Float32Array.from(filtered, (sample) => clamp(Math.tanh(sample * drive) / Math.tanh(drive) * layer.level))
}

function addTo(output: Float32Array, signal: Float32Array, gain: number): void {
  for (let index = 0; index < output.length; index += 1) output[index] += (signal[index] ?? 0) * gain
}

export function renderCompleteInstrumentNote(state: InstrumentState, note = 60, velocity = .75, duration = 1, sampleRate = 12000): Float32Array {
  const output = new Float32Array(Math.floor(duration * sampleRate))
  const playedNote = note + state.transpose
  for (const layerId of ['A', 'B'] as LayerId[]) {
    const layer = state.layers[layerId]
    const routed = routeLayerGain(state, layer.zone, playedNote)
    if (state.sectionOn && layer.enabled && routed > 0) {
      const level = morphedValue(state, `piano:${layerId}`, layer.level)
      const source = renderPianoNote(layer.type, playedNote + (layer.pstick ? state.pitchBend * 2 : 0), velocity, duration, sampleRate, { ...layer, level: 1 })
      addTo(output, processEffectChain(source, effectiveEffectChain(state, `piano:${layerId}`, state.effects[layerId]), sampleRate, state.masterClockBpm), routed * level)
    }
  }
  for (const layerId of ['A', 'B'] as LayerId[]) {
    const layer = effectiveOrganLayer(state, layerId)
    const routed = routeLayerGain(state, layer.zone, playedNote)
    if (state.organ.sectionOn && layer.enabled && routed > 0) {
      const level = morphedValue(state, `organ:${layerId}`, layer.level)
      const source = renderOrganNote({ ...layer, level: 1 }, playedNote + (layer.pstick ? state.pitchBend * 2 : 0), velocity, duration, sampleRate)
      let signal = processEffectChain(source, effectiveEffectChain(state, 'organ', state.organ.effects), sampleRate, state.masterClockBpm)
      const rotaryFast = morphedValue(state, 'rotary:speed', state.rotaryFast ? 1 : 0) >= .5
      if (state.organ.rotaryRouted && state.rotaryOn) signal = processEffect(signal, 'mod2', rotaryFast ? 'Spin' : 'Vibe', state.rotaryStopped ? 0 : .25 + state.rotaryDrive * .55, sampleRate)
      addTo(output, signal, routed * level)
    }
  }
  for (const layerId of ['A', 'B', 'C'] as SynthLayerId[]) {
    const layer = effectiveSynthLayer(state, layerId)
    const routed = routeLayerGain(state, layer.zone, playedNote)
    if (state.synth.sectionOn && layer.enabled && routed > 0) {
      const level = morphedValue(state, `synth:${layerId}`, layer.level)
      let signal = renderSynthNote({ ...layer, level: 1 }, playedNote + (layer.pstick ? state.pitchBend * 2 : 0), velocity, duration, sampleRate, state.masterClockBpm)
      signal = processEffectChain(signal, effectiveEffectChain(state, `synth:${layerId}`, state.synth.effects[layerId]), sampleRate, state.masterClockBpm)
      if (state.synth.effects[layerId].ampEq.on && state.synth.effects[layerId].ampEq.type === 'To Rotary' && state.rotaryOn) {
        signal = processEffect(signal, 'mod2', state.rotaryFast ? 'Spin' : 'Vibe', state.rotaryStopped ? 0 : .3 + state.rotaryDrive * .5, sampleRate)
      }
      addTo(output, signal, routed * level)
    }
  }
  return Float32Array.from(output, (sample) => clamp(sample * state.masterLevel))
}

export function voicePlan(layer: SynthLayerState, heldNotes: number[], previousNote?: number): number[] {
  if (layer.voiceMode === 'Poly') return [...heldNotes].sort((a, b) => a - b)
  if (heldNotes.length === 0) return []
  if (layer.priority === 'Low') return [Math.min(...heldNotes)]
  if (layer.priority === 'High') return [Math.max(...heldNotes)]
  if (layer.voiceMode === 'Legato' && previousNote !== undefined && heldNotes.includes(previousNote)) return [previousNote]
  return [heldNotes.at(-1)!]
}
