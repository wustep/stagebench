import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './boundaries'
import { makeTubeCurve } from './effectUnits'
import { midiToFrequency } from './pianoVoice'
import {
  envKnobToSeconds,
  masterClockSubdivisionHz,
  type MasterClockState,
  type SynthLayerId,
  type SynthLayerState,
  type SynthLfoWaveform,
  type SynthWaveformId,
} from '../model/organSynthTypes'

const noiseCache = new WeakMap<AudioContextLike, AudioBufferLike>()
const sampleHoldCache = new WeakMap<AudioContextLike, AudioBufferLike>()

function getSynthNoiseBuffer(ctx: AudioContextLike): AudioBufferLike | null {
  if (typeof ctx.createBuffer !== 'function') return null
  const cached = noiseCache.get(ctx)
  if (cached) return cached
  const sr = ctx.sampleRate || 44100
  const len = Math.floor(sr * 1.5)
  const buf = ctx.createBuffer(1, len, sr)
  const ch = buf.getChannelData?.(0)
  if (!ch) return null
  let seed = 0x73796e74
  for (let i = 0; i < len; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    ch[i] = (seed / 4294967296) * 2 - 1
  }
  noiseCache.set(ctx, buf)
  return buf
}

/**
 * Deterministic stepped Sample & Hold looping buffer (32 distinct random steps over 1 second at 1x rate).
 */
function getSampleAndHoldBuffer(ctx: AudioContextLike): AudioBufferLike | null {
  if (typeof ctx.createBuffer !== 'function') return null
  const cached = sampleHoldCache.get(ctx)
  if (cached) return cached
  const sr = ctx.sampleRate || 44100
  const steps = 32
  const samplesPerStep = Math.max(64, Math.floor(sr / steps))
  const len = steps * samplesPerStep
  const buf = ctx.createBuffer(1, len, sr)
  const ch = buf.getChannelData?.(0)
  if (!ch) return null
  let seed = 0x1f05a11d
  for (let s = 0; s < steps; s++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const val = (seed / 4294967296) * 2 - 1
    const base = s * samplesPerStep
    for (let i = 0; i < samplesPerStep; i++) {
      ch[base + i] = val
    }
  }
  sampleHoldCache.set(ctx, buf)
  return buf
}

function buildPulseWave(ctx: AudioContextLike, duty: number): unknown | null {
  if (typeof ctx.createPeriodicWave !== 'function') return null
  const harmonics = 32
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
  }
  return ctx.createPeriodicWave(real, imag)
}

/**
 * Generates a hard-synced harmonic PeriodicWave whose formant peak tracks `syncRatio` (1.0..6.0),
 * producing authentic Sync Saw and Sync Square overtone sweep as Osc Ctrl changes.
 */
function buildHardSyncWave(
  ctx: AudioContextLike,
  kind: 'Sync Saw' | 'Sync Square',
  syncRatio: number,
): unknown | null {
  if (typeof ctx.createPeriodicWave !== 'function') return null
  const harmonics = 40
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  const r = Math.max(1.0, Math.min(6.5, syncRatio))
  for (let n = 1; n <= harmonics; n++) {
    // Hard-sync spectral envelope peaks sharply around integer multiples of slave ratio r
    const dist = Math.abs(n - r)
    const dist2 = Math.abs(n - 2 * r)
    const formant =
      1 / (1 + dist * dist * 1.4) + 0.55 / (1 + dist2 * dist2 * 1.8) + 0.12 / Math.sqrt(n)
    if (kind === 'Sync Square') {
      // Square emphasizes odd harmonics around the sync formant
      const parity = n % 2 === 1 ? 1.0 : 0.25
      imag[n] = (formant * parity) / Math.pow(n, 0.35)
    } else {
      imag[n] = formant / Math.pow(n, 0.28)
      real[n] = (formant * 0.25) / Math.pow(n, 0.45)
    }
  }
  return ctx.createPeriodicWave(real, imag)
}

function buildLfoWave(ctx: AudioContextLike, waveform: SynthLfoWaveform): unknown | null {
  if (typeof ctx.createPeriodicWave !== 'function') return null
  if (waveform === 'Saw up') {
    const nMax = 24
    const real = new Float32Array(nMax + 1)
    const imag = new Float32Array(nMax + 1)
    for (let n = 1; n <= nMax; n++) {
      imag[n] = -2 / (n * Math.PI)
    }
    return ctx.createPeriodicWave(real, imag)
  }
  if (waveform === 'Saw down') {
    const nMax = 24
    const real = new Float32Array(nMax + 1)
    const imag = new Float32Array(nMax + 1)
    for (let n = 1; n <= nMax; n++) {
      imag[n] = 2 / (n * Math.PI)
    }
    return ctx.createPeriodicWave(real, imag)
  }
  return null
}

export function computeFilterCutoffHz(
  freqKnob0To100: number,
  effectiveMidi: number,
  kbTrack: 0 | 1 | 2 | 3,
  sampleRate = 44100,
): number {
  const norm = Math.max(0, Math.min(100, freqKnob0To100)) / 100
  const baseHz = 45 * Math.pow(360, norm) // 45 Hz .. 16.2 kHz
  const trackRatio = kbTrack / 3 // 0, 1/3, 2/3, 1
  const trackMult = Math.pow(2, ((effectiveMidi - 60) / 12) * trackRatio)
  const nyquistSafe = Math.max(2500, sampleRate * 0.43)
  return Math.max(30, Math.min(nyquistSafe, baseHz * trackMult))
}

export function computeLfoRateHz(
  lfoRate0To100: number,
  clockSync: boolean,
  masterClock: MasterClockState,
): number {
  if (clockSync) {
    return masterClockSubdivisionHz(masterClock.bpm, lfoRate0To100)
  }
  const norm = Math.max(0, Math.min(100, lfoRate0To100)) / 100
  return 0.12 * Math.pow(160, norm) // 0.12 Hz .. 19.2 Hz
}

export interface ActiveSynthVoice {
  readonly layerId: SynthLayerId
  baseMidi: number
  effectiveMidi: number
  readonly ampGain: GainNodeLike
  readonly filterNodes: readonly BiquadFilterNodeLike[]
  readonly pitchTargets: Array<{
    readonly node: OscillatorNodeLike
    baseHz: number
    readonly mult: number
  }>
  readonly nodes: AudioNodeLike[]
  readonly stopTargets: Array<OscillatorNodeLike | AudioBufferSourceNodeLike>
  readonly releaseSec: number
  readonly filterReleaseSec: number
  readonly filterBaseHz: number
  released: boolean
}

function getUnisonSpecs(unison: 0 | 1 | 2 | 3): readonly { detuneCents: number; pan: number }[] {
  if (unison === 0) return [{ detuneCents: 0, pan: 0 }]
  if (unison === 1) {
    return [
      { detuneCents: -7, pan: -0.45 },
      { detuneCents: 7, pan: 0.45 },
    ]
  }
  if (unison === 2) {
    return [
      { detuneCents: 0, pan: 0 },
      { detuneCents: -14, pan: -0.75 },
      { detuneCents: 14, pan: 0.75 },
    ]
  }
  return [
    { detuneCents: -22, pan: -0.92 },
    { detuneCents: -8, pan: -0.35 },
    { detuneCents: 8, pan: 0.35 },
    { detuneCents: 22, pan: 0.92 },
  ]
}

/**
 * Spawns a full-featured Nord Stage 4 Synth voice on the shared AudioContext:
 * - Required waveforms (Pure, Sync, Multi, Super, FM-H) with category-correct Osc Ctrl
 * - Oscillator Envelope (modulates Osc Ctrl or Osc Pitch)
 * - Filter (LP12/LP24/LP M/HP/BP/LP+HP) with Freq, Res, KB Track, Drive, Filter Env
 * - Amp Envelope with velocity levels Off/1/2/3 & decay=100 sustain hold
 * - LFO (5 waveforms, 3 destinations + Off, Master Clock sync)
 * - Unison (Off/1/2/3) & Vibrato (Off/On/Wheel/Delayed/Pedal)
 */
export function spawnSynthVoice(
  ctx: AudioContextLike,
  dest: AudioNodeLike,
  layerId: SynthLayerId,
  layer: SynthLayerState,
  masterClock: MasterClockState,
  baseMidi: number,
  effectiveMidi: number,
  velocity: number,
  zoneGain: number,
  bendFactor: number,
  modWheel0To100: number,
  controlPedal0To100: number,
  glideFromMidi: number | null,
  now: number,
): ActiveSynthVoice | null {
  if (zoneGain <= 0.0005) return null
  // Extern mode has no internal synth audio (spec-excluded MIDI-out)
  if (layer.mode === 'Extern') return null

  const nodes: AudioNodeLike[] = []
  const stopTargets: Array<OscillatorNodeLike | AudioBufferSourceNodeLike> = []
  const pitchTargets: ActiveSynthVoice['pitchTargets'] = []

  const normVel = Math.max(0.05, Math.min(1, velocity / 127))
  const totalPitchSemi = layer.pitchCoarse + layer.pitchFine / 100
  const targetHz = midiToFrequency(effectiveMidi + totalPitchSemi)
  const startHz =
    glideFromMidi !== null && layer.voice.glide > 0
      ? midiToFrequency(glideFromMidi + totalPitchSemi)
      : targetHz
  const glideSec =
    glideFromMidi !== null && layer.voice.glide > 0
      ? 0.015 + (layer.voice.glide / 100) * 0.45
      : 0

  // 1. Source mixing bus
  const sourceSum = ctx.createGain()
  sourceSum.gain.setValueAtTime(1, now)
  nodes.push(sourceSum)

  const oscCtrlNorm = Math.max(0, Math.min(1, layer.oscCtrl / 100))
  const oscEnvAmt = ((layer.oscEnv.amount - 50) / 50) * (layer.oscEnv.velocity ? normVel : 1)
  const oscEnvAtk = envKnobToSeconds(layer.oscEnv.attack, 'attack')
  const oscEnvDec = envKnobToSeconds(layer.oscEnv.decay, 'decay')
  const oscEnvSustainHold = layer.oscEnv.decay >= 99

  // Vibrato LFO (pitch modulation on all voice oscillators)
  let vibGain: GainNodeLike | null = null
  const vibAmt = layer.vibrato.amount / 10
  let vibScale = 0
  if (layer.vibrato.mode === 'On') vibScale = 1
  else if (layer.vibrato.mode === 'Wheel') vibScale = modWheel0To100 / 100
  else if (layer.vibrato.mode === 'Pedal') vibScale = controlPedal0To100 / 100
  else if (layer.vibrato.mode === 'Delayed') vibScale = 1

  if (vibScale > 0.001 && vibAmt > 0.001) {
    const vibOsc = ctx.createOscillator()
    vibOsc.type = 'sine'
    vibOsc.frequency.setValueAtTime(Math.max(2, Math.min(8, layer.vibrato.rateHz)), now)
    vibGain = ctx.createGain()
    const maxCents = vibAmt * vibScale * 65 // up to ±65 cents vibrato
    if (layer.vibrato.mode === 'Delayed') {
      vibGain.gain.setValueAtTime(0, now)
      vibGain.gain.setValueAtTime(0, now + 0.35)
      vibGain.gain.linearRampToValueAtTime(maxCents, now + 0.85)
    } else {
      vibGain.gain.setValueAtTime(maxCents, now)
    }
    vibOsc.connect(vibGain)
    vibOsc.start(now)
    nodes.push(vibOsc, vibGain)
    stopTargets.push(vibOsc)
  }

  // Synth LFO (5 waveforms, 3 destinations + Off, Master Clock sync)
  let lfoOut: GainNodeLike | null = null
  const lfoAmtNorm = Math.max(0, Math.min(1, layer.lfo.amount / 100))
  if (layer.lfo.destination !== 'Off' && lfoAmtNorm > 0.001) {
    const lfoRateHz = computeLfoRateHz(layer.lfo.rate, layer.lfo.clockSync, masterClock)
    lfoOut = ctx.createGain()
    lfoOut.gain.setValueAtTime(1, now)
    nodes.push(lfoOut)

    if (layer.lfo.waveform === 'Sample & Hold') {
      const shBuf = getSampleAndHoldBuffer(ctx)
      if (shBuf) {
        const shSrc = ctx.createBufferSource()
        shSrc.buffer = shBuf
        shSrc.loop = true
        shSrc.playbackRate.setValueAtTime(Math.max(0.05, lfoRateHz / 32), now)
        shSrc.connect(lfoOut)
        shSrc.start(now)
        nodes.push(shSrc)
        stopTargets.push(shSrc)
      }
    } else {
      const lfoOsc = ctx.createOscillator()
      lfoOsc.frequency.setValueAtTime(lfoRateHz, now)
      const customLfo = buildLfoWave(ctx, layer.lfo.waveform)
      if (customLfo && typeof lfoOsc.setPeriodicWave === 'function') {
        lfoOsc.setPeriodicWave(customLfo)
      } else {
        lfoOsc.type =
          layer.lfo.waveform === 'Square'
            ? 'square'
            : layer.lfo.waveform === 'Triangle'
              ? 'triangle'
              : 'sawtooth'
      }
      lfoOsc.connect(lfoOut)
      lfoOsc.start(now)
      nodes.push(lfoOsc)
      stopTargets.push(lfoOsc)
    }
  }

  let lfoPitchDepth: GainNodeLike | null = null
  if (lfoOut && layer.lfo.destination === 'Osc Pitch') {
    lfoPitchDepth = ctx.createGain()
    lfoPitchDepth.gain.setValueAtTime(lfoAmtNorm * 350, now) // up to ±3.5 semitones
    lfoOut.connect(lfoPitchDepth)
    nodes.push(lfoPitchDepth)
  }

  const unisonSpecs = getUnisonSpecs(layer.voice.unison)
  const unisonGainScale = 1 / Math.sqrt(unisonSpecs.length)
  const hasPanner = typeof ctx.createStereoPanner === 'function'

  const configurePitch = (osc: OscillatorNodeLike, mult: number, extraDetuneCents: number) => {
    const sHz = startHz * mult * bendFactor
    const tHz = targetHz * mult * bendFactor
    osc.frequency.setValueAtTime(sHz, now)
    if (glideSec > 0 && Math.abs(tHz - sHz) > 0.01) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(10, tHz), now + glideSec)
    }
    osc.detune.setValueAtTime(extraDetuneCents, now)

    // Oscillator Envelope -> Pitch when Env To Pitch enabled
    if (layer.oscEnv.toPitch && Math.abs(oscEnvAmt) > 0.01) {
      const peakCents = extraDetuneCents + oscEnvAmt * 1200 // ±12 semitones
      osc.detune.setValueAtTime(extraDetuneCents, now)
      osc.detune.linearRampToValueAtTime(peakCents, now + oscEnvAtk)
      if (!oscEnvSustainHold) {
        osc.detune.linearRampToValueAtTime(extraDetuneCents, now + oscEnvAtk + oscEnvDec)
      }
    }

    if (vibGain) vibGain.connect(osc.detune)
    if (lfoPitchDepth) lfoPitchDepth.connect(osc.detune)
    pitchTargets.push({ node: osc, baseHz: targetHz * mult, mult })
  }

  const wave: SynthWaveformId = layer.oscWaveform

  for (const u of unisonSpecs) {
    const branchGain = ctx.createGain()
    branchGain.gain.setValueAtTime(0.38 * unisonGainScale, now)
    nodes.push(branchGain)

    let branchOut: AudioNodeLike = branchGain
    if (hasPanner && Math.abs(u.pan) > 0.01) {
      const pan = ctx.createStereoPanner!()
      pan.pan.setValueAtTime(u.pan, now)
      branchGain.connect(pan)
      branchOut = pan
      nodes.push(pan)
    }
    branchOut.connect(sourceSum)

    if (wave === 'White Noise') {
      const nBuf = getSynthNoiseBuffer(ctx)
      if (nBuf) {
        const src = ctx.createBufferSource()
        src.buffer = nBuf
        src.loop = true
        src.connect(branchGain)
        src.start(now)
        nodes.push(src)
        stopTargets.push(src)
      }
      continue
    }

    if (layer.oscCategory === 'Pure') {
      // Pure category: Osc Ctrl intentionally has no effect (manual p. 29)
      const osc = ctx.createOscillator()
      if (wave === 'Pulse 33' || wave === 'Pulse 10') {
        const pw = buildPulseWave(ctx, wave === 'Pulse 33' ? 0.33 : 0.1)
        if (pw && typeof osc.setPeriodicWave === 'function') {
          osc.setPeriodicWave(pw)
        } else {
          osc.type = 'square'
        }
      } else {
        osc.type =
          wave === 'Sine'
            ? 'sine'
            : wave === 'Triangle'
              ? 'triangle'
              : wave === 'Square'
                ? 'square'
                : 'sawtooth'
      }
      configurePitch(osc, 1, u.detuneCents)
      osc.connect(branchGain)
      osc.start(now)
      nodes.push(osc)
      stopTargets.push(osc)
      continue
    }

    if (layer.oscCategory === 'Sync') {
      // Sync Saw / Sync Square: Osc Ctrl sets relative pitch of synced slave (1.0x..6.0x)
      // Plus a slave resonant overtone sweep modulated by Osc Env & LFO
      const syncEnvOffset = !layer.oscEnv.toPitch ? oscEnvAmt * 2.2 : 0
      const syncRatio = Math.max(1.0, Math.min(6.5, 1.0 + oscCtrlNorm * 5.0 + Math.max(0, syncEnvOffset)))
      const osc = ctx.createOscillator()
      const syncWave = buildHardSyncWave(
        ctx,
        wave === 'Sync Square' ? 'Sync Square' : 'Sync Saw',
        syncRatio,
      )
      if (syncWave && typeof osc.setPeriodicWave === 'function') {
        osc.setPeriodicWave(syncWave)
      } else {
        osc.type = wave === 'Sync Square' ? 'square' : 'sawtooth'
      }
      configurePitch(osc, 1, u.detuneCents)

      // Secondary slave formant filter emphasizes the synced harmonic peak dynamically
      const syncRes = ctx.createBiquadFilter()
      syncRes.type = 'peaking'
      const baseSyncHz = Math.min(12000, targetHz * syncRatio)
      syncRes.frequency.setValueAtTime(baseSyncHz, now)
      syncRes.Q.setValueAtTime(3.2, now)
      syncRes.gain?.setValueAtTime(6 + oscCtrlNorm * 8, now)
      if (!layer.oscEnv.toPitch && Math.abs(oscEnvAmt) > 0.01) {
        const peakHz = Math.max(80, Math.min(14000, targetHz * Math.max(1, syncRatio + oscEnvAmt * 3)))
        syncRes.frequency.linearRampToValueAtTime(peakHz, now + oscEnvAtk)
        if (!oscEnvSustainHold) {
          syncRes.frequency.exponentialRampToValueAtTime(Math.max(80, baseSyncHz), now + oscEnvAtk + oscEnvDec)
        }
      }
      if (lfoOut && layer.lfo.destination === 'Osc Ctrl') {
        const lfoSyncDepth = ctx.createGain()
        lfoSyncDepth.gain.setValueAtTime(lfoAmtNorm * targetHz * 2.5, now)
        lfoOut.connect(lfoSyncDepth)
        lfoSyncDepth.connect(syncRes.frequency)
        nodes.push(lfoSyncDepth)
      }

      osc.connect(syncRes)
      syncRes.connect(branchGain)
      osc.start(now)
      nodes.push(osc, syncRes)
      stopTargets.push(osc)
      continue
    }

    if (layer.oscCategory === 'Multi') {
      // Multi Saw / Multi Saw 8ve: 3 stacked saws, Osc Ctrl controls detune spread (0..45 cents)
      const spread = 2 + oscCtrlNorm * 43
      const multiConfig: readonly { mult: number; det: number; gain: number }[] =
        wave === 'Multi Saw 8ve'
          ? [
              { mult: 0.5, det: -spread * 0.7, gain: 0.45 },
              { mult: 1.0, det: 0, gain: 0.55 },
              { mult: 2.0, det: spread * 0.85, gain: 0.42 },
            ]
          : [
              { mult: 1.0, det: -spread, gain: 0.48 },
              { mult: 1.0, det: 0, gain: 0.52 },
              { mult: 1.0, det: spread, gain: 0.48 },
            ]
      for (const m of multiConfig) {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        configurePitch(osc, m.mult, u.detuneCents + m.det)
        if (lfoOut && layer.lfo.destination === 'Osc Ctrl' && m.det !== 0) {
          const lfoDet = ctx.createGain()
          lfoDet.gain.setValueAtTime(Math.sign(m.det) * lfoAmtNorm * 35, now)
          lfoOut.connect(lfoDet)
          lfoDet.connect(osc.detune)
          nodes.push(lfoDet)
        }
        const g = ctx.createGain()
        g.gain.setValueAtTime(m.gain, now)
        osc.connect(g)
        g.connect(branchGain)
        osc.start(now)
        nodes.push(osc, g)
        stopTargets.push(osc)
      }
      continue
    }

    if (layer.oscCategory === 'Super') {
      // Super Saw / Super Square: 5-voice stereo stack, Osc Ctrl controls detune & stereo width
      const oscType: OscillatorType = wave === 'Super Square' ? 'square' : 'sawtooth'
      const spread = 3 + oscCtrlNorm * 52
      const width = 0.2 + oscCtrlNorm * 0.75
      const stack = [
        { det: -spread, pan: -width, gain: 0.28 },
        { det: -spread * 0.48, pan: -width * 0.45, gain: 0.34 },
        { det: 0, pan: 0, gain: 0.42 },
        { det: spread * 0.48, pan: width * 0.45, gain: 0.34 },
        { det: spread, pan: width, gain: 0.28 },
      ]
      for (const s of stack) {
        const osc = ctx.createOscillator()
        osc.type = oscType
        configurePitch(osc, 1, u.detuneCents + s.det)
        if (lfoOut && layer.lfo.destination === 'Osc Ctrl' && s.det !== 0) {
          const lfoDet = ctx.createGain()
          lfoDet.gain.setValueAtTime(Math.sign(s.det) * lfoAmtNorm * 45, now)
          lfoOut.connect(lfoDet)
          lfoDet.connect(osc.detune)
          nodes.push(lfoDet)
        }
        const g = ctx.createGain()
        g.gain.setValueAtTime(s.gain, now)
        osc.connect(g)
        if (hasPanner && Math.abs(s.pan) > 0.01) {
          const pan = ctx.createStereoPanner!()
          pan.pan.setValueAtTime(Math.max(-1, Math.min(1, s.pan)), now)
          g.connect(pan)
          pan.connect(branchGain)
          nodes.push(pan)
        } else {
          g.connect(branchGain)
        }
        osc.start(now)
        nodes.push(osc, g)
        stopTargets.push(osc)
      }
      continue
    }

    // FM-H: 2-operator Harmonic FM (Algorithm A), Osc Ctrl controls FM modulation index!
    const carrier = ctx.createOscillator()
    carrier.type = 'sine'
    configurePitch(carrier, 1, u.detuneCents)

    const modOsc = ctx.createOscillator()
    modOsc.type = 'sine'
    configurePitch(modOsc, 2, u.detuneCents) // 2:1 harmonic ratio (Algorithm A)

    const fmIndexGain = ctx.createGain()
    const baseModHz = targetHz * (oscCtrlNorm * 7.5)
    fmIndexGain.gain.setValueAtTime(baseModHz, now)

    if (!layer.oscEnv.toPitch && Math.abs(oscEnvAmt) > 0.01) {
      const envPeakHz = Math.max(0, baseModHz + oscEnvAmt * targetHz * 6.5)
      fmIndexGain.gain.setValueAtTime(baseModHz, now)
      fmIndexGain.gain.linearRampToValueAtTime(envPeakHz, now + oscEnvAtk)
      if (!oscEnvSustainHold) {
        fmIndexGain.gain.linearRampToValueAtTime(baseModHz, now + oscEnvAtk + oscEnvDec)
      }
    }

    if (lfoOut && layer.lfo.destination === 'Osc Ctrl') {
      const lfoFm = ctx.createGain()
      lfoFm.gain.setValueAtTime(lfoAmtNorm * targetHz * 3.5, now)
      lfoOut.connect(lfoFm)
      lfoFm.connect(fmIndexGain.gain)
      nodes.push(lfoFm)
    }

    modOsc.connect(fmIndexGain)
    fmIndexGain.connect(carrier.frequency)
    carrier.connect(branchGain)
    modOsc.start(now)
    carrier.start(now)
    nodes.push(carrier, modOsc, fmIndexGain)
    stopTargets.push(carrier, modOsc)
  }

  // 2. Pre-filter Drive (Off, 1, 2, 3)
  let stageOut: AudioNodeLike = sourceSum
  if (layer.filter.on && layer.filter.drive > 0 && typeof ctx.createWaveShaper === 'function') {
    const driveNorm = layer.filter.drive / 3
    const pre = ctx.createGain()
    pre.gain.setValueAtTime(1 + driveNorm * 3.2, now)
    const shaper = ctx.createWaveShaper()
    shaper.curve = makeTubeCurve(0.35 + driveNorm * 0.65, 0.12)
    shaper.oversample = '2x'
    const post = ctx.createGain()
    post.gain.setValueAtTime(1 / (1 + driveNorm * 0.65), now)
    stageOut.connect(pre)
    pre.connect(shaper)
    shaper.connect(post)
    stageOut = post
    nodes.push(pre, shaper, post)
  }

  // 3. Filter (LP12, LP24, LP M, HP, BP, LP+HP) with Freq, Res, KB Track, Filter Env, LFO
  const filterNodes: BiquadFilterNodeLike[] = []
  const baseCutoffHz = computeFilterCutoffHz(
    layer.filter.freq,
    effectiveMidi,
    layer.filter.kbTrack,
    ctx.sampleRate || 44100,
  )
  const filterRelSec = envKnobToSeconds(layer.filterEnv.release, 'release')

  if (layer.filter.on) {
    const qBase = 0.6 + Math.pow(layer.filter.res / 100, 1.4) * 14
    const fEnvAmtNorm = (layer.filter.envAmt / 100) * (layer.filterEnv.velocity ? normVel : 1)
    const fEnvAtk = envKnobToSeconds(layer.filterEnv.attack, 'attack')
    const fEnvDec = envKnobToSeconds(layer.filterEnv.decay, 'decay')
    const fEnvSustainHold = layer.filterEnv.decay >= 99
    const nyquistSafe = Math.max(2500, (ctx.sampleRate || 44100) * 0.43)
    const peakCutoffHz = Math.min(nyquistSafe, baseCutoffHz * Math.pow(2, fEnvAmtNorm * 5.2))

    const addFilterStage = (type: BiquadFilterType, cutoff: number, peak: number, q: number) => {
      const f = ctx.createBiquadFilter()
      f.type = type
      f.Q.setValueAtTime(q, now)
      f.frequency.setValueAtTime(cutoff, now)
      if (fEnvAmtNorm > 0.005) {
        f.frequency.exponentialRampToValueAtTime(Math.max(30, peak), now + fEnvAtk)
        if (!fEnvSustainHold) {
          f.frequency.exponentialRampToValueAtTime(Math.max(30, cutoff), now + fEnvAtk + fEnvDec)
        }
      }
      if (lfoOut && layer.lfo.destination === 'Filter Freq') {
        const lfoFilt = ctx.createGain()
        lfoFilt.gain.setValueAtTime(lfoAmtNorm * Math.max(400, cutoff * 1.4), now)
        lfoOut.connect(lfoFilt)
        lfoFilt.connect(f.frequency)
        nodes.push(lfoFilt)
      }
      stageOut.connect(f)
      stageOut = f
      filterNodes.push(f)
      nodes.push(f)
    }

    if (layer.filter.type === 'LP12') {
      addFilterStage('lowpass', baseCutoffHz, peakCutoffHz, qBase)
    } else if (layer.filter.type === 'LP24' || layer.filter.type === 'LP M') {
      const stageQ = layer.filter.type === 'LP M' ? Math.max(0.8, qBase * 0.78) : Math.max(0.7, qBase * 0.65)
      addFilterStage('lowpass', baseCutoffHz, peakCutoffHz, stageQ)
      addFilterStage('lowpass', baseCutoffHz, peakCutoffHz, stageQ * 0.72)
    } else if (layer.filter.type === 'HP') {
      addFilterStage('highpass', baseCutoffHz, peakCutoffHz, qBase)
    } else if (layer.filter.type === 'BP') {
      addFilterStage('bandpass', baseCutoffHz, peakCutoffHz, Math.max(1.0, qBase))
    } else {
      // LP+HP serial pair
      addFilterStage('lowpass', baseCutoffHz, peakCutoffHz, Math.max(0.7, qBase * 0.7))
      const hpCutoff = Math.max(35, Math.min(3500, baseCutoffHz * 0.35))
      addFilterStage('highpass', hpCutoff, Math.min(6000, hpCutoff * 2), 0.85)
    }
  }

  // 4. Amplifier Envelope (Attack, Decay [100 = Sustain], Release, Velocity Off/1/2/3)
  const ampGain = ctx.createGain()
  const velDepth = layer.ampEnv.velocity / 3 // 0, 1/3, 2/3, 1
  const velScale = (1 - velDepth) + velDepth * Math.pow(normVel, 1.35)
  const peakAmp = 0.72 * velScale * zoneGain
  const ampAtk = envKnobToSeconds(layer.ampEnv.attack, 'attack')
  const ampDec = envKnobToSeconds(layer.ampEnv.decay, 'decay')
  const ampRel = envKnobToSeconds(layer.ampEnv.release, 'release')
  const ampSustainHold = layer.ampEnv.decay >= 99

  ampGain.gain.setValueAtTime(0.0001, now)
  ampGain.gain.linearRampToValueAtTime(Math.max(0.0005, peakAmp), now + ampAtk)
  if (!ampSustainHold) {
    ampGain.gain.exponentialRampToValueAtTime(0.0001, now + ampAtk + ampDec)
  }

  stageOut.connect(ampGain)
  ampGain.connect(dest)
  nodes.push(ampGain)

  return {
    layerId,
    baseMidi,
    effectiveMidi,
    ampGain,
    filterNodes,
    pitchTargets,
    nodes,
    stopTargets,
    releaseSec: ampRel,
    filterReleaseSec: filterRelSec,
    filterBaseHz: baseCutoffHz,
    released: false,
  }
}

/**
 * Smoothly glides an active Mono/Legato Synth voice to a new target MIDI note without retriggering envelopes.
 */
export function glideSynthVoiceToMidi(
  ctx: AudioContextLike,
  voice: ActiveSynthVoice,
  layer: SynthLayerState,
  newBaseMidi: number,
  newEffectiveMidi: number,
  bendFactor: number,
): void {
  if (voice.released) return
  const now = ctx.currentTime
  const totalPitchSemi = layer.pitchCoarse + layer.pitchFine / 100
  const newTargetHz = midiToFrequency(newEffectiveMidi + totalPitchSemi)
  const glideSec = Math.max(0.006, 0.012 + (layer.voice.glide / 100) * 0.45)

  voice.baseMidi = newBaseMidi
  voice.effectiveMidi = newEffectiveMidi
  for (const pt of voice.pitchTargets) {
    pt.baseHz = newTargetHz * pt.mult
    const targetFreq = Math.max(10, pt.baseHz * bendFactor)
    pt.node.frequency.cancelScheduledValues(now)
    pt.node.frequency.setValueAtTime(Math.max(10, pt.node.frequency.value || targetFreq), now)
    pt.node.frequency.exponentialRampToValueAtTime(targetFreq, now + glideSec)
  }
}
