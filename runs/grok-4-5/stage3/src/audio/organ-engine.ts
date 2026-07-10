/** Organ voice synthesis — B3 / Vox / Farf / Pipe */

import {
  B3_HARMONICS,
  modelHarmonicWeights,
  type OrganLayerId,
  type OrganLayerState,
  type OrganModel,
  type OrganSectionState,
  type VibratoChorusPos,
} from '../model/organ-types'

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export interface OrganVoice {
  oscs: OscillatorNode[]
  gains: GainNode[]
  amp: GainNode
  vib?: OscillatorNode
  vibGain?: GainNode
  midi: number
  layer: OrganLayerId
  noteId: string
  click?: AudioBufferSourceNode
}

export interface OrganVoiceBus {
  A: GainNode
  B: GainNode
  levelA: GainNode
  levelB: GainNode
}

let percArmed = true
let heldCount = 0

export function resetOrganPercussion(): void {
  percArmed = true
  heldCount = 0
}

export function createOrganBuses(ctx: AudioContext): OrganVoiceBus {
  const A = ctx.createGain()
  const B = ctx.createGain()
  const levelA = ctx.createGain()
  const levelB = ctx.createGain()
  A.connect(levelA)
  B.connect(levelB)
  levelA.gain.value = 0.8
  levelB.gain.value = 0
  return { A, B, levelA, levelB }
}

function vibratoDepth(pos: VibratoChorusPos): { rate: number; depth: number; chorus: boolean } {
  const n = Number(pos[1])
  const chorus = pos[0] === 'C'
  return {
    rate: 5.5 + n * 0.8,
    depth: chorus ? 4 + n * 2 : 8 + n * 4,
    chorus,
  }
}

/** Drawbar effective levels for a model (Farf is on/off registers) */
export function effectiveDrawbars(model: OrganModel, drawbars: number[]): number[] {
  const weights = modelHarmonicWeights(model)
  return drawbars.map((d, i) => {
    if (model === 'Farf') return d >= 0.5 ? weights[i]! : 0
    if (model === 'B3 Bass' && i !== 0 && i !== 2) return 0
    return d * weights[i]!
  })
}

export function spawnOrganVoice(
  ctx: AudioContext,
  bus: GainNode,
  noteId: string,
  midi: number,
  velocity: number,
  layer: OrganLayerId,
  layerState: OrganLayerState,
  section: OrganSectionState,
  zoneGain: number,
): OrganVoice | null {
  if (zoneGain <= 0.001) return null
  const now = ctx.currentTime
  const playMidi = midi + layerState.octave * 12
  const freq = midiToFreq(playMidi)
  const model = layerState.model
  const bars = effectiveDrawbars(model, layerState.drawbars)

  const amp = ctx.createGain()
  const peak = (0.08 + velocity * 0.35) * zoneGain
  amp.gain.setValueAtTime(0, now)
  amp.gain.linearRampToValueAtTime(peak, now + 0.008)
  amp.connect(bus)

  const voice: OrganVoice = {
    oscs: [],
    gains: [],
    amp,
    midi: playMidi,
    layer,
    noteId,
  }

  // Vibrato via detune LFO on oscillators
  let vibGain: GainNode | null = null
  if (layerState.vibratoOn) {
    const { rate, depth } = vibratoDepth(layerState.vibratoPos)
    const vib = ctx.createOscillator()
    vib.type = 'sine'
    vib.frequency.value = rate
    vibGain = ctx.createGain()
    vibGain.gain.value = depth
    vib.connect(vibGain)
    vib.start(now)
    voice.vib = vib
    voice.vibGain = vibGain
  }

  const harmonics = model === 'Pipe 1' || model === 'Pipe 2' ? B3_HARMONICS.map((h) => h) : B3_HARMONICS

  for (let i = 0; i < 9; i++) {
    const level = bars[i] ?? 0
    if (level < 0.01) continue
    const osc = ctx.createOscillator()
    // Model-distinct waveforms
    if (model === 'Vox') osc.type = i % 2 === 0 ? 'square' : 'sawtooth'
    else if (model === 'Farf') osc.type = 'square'
    else if (model === 'Pipe 1' || model === 'Pipe 2') osc.type = 'sine'
    else osc.type = 'sine'

    const mult = harmonics[i] ?? 1
    const f = freq * mult * (model === 'Pipe 2' ? 1.002 : 1)
    osc.frequency.setValueAtTime(f, now)
    if (vibGain) {
      try {
        vibGain.connect(osc.detune)
      } catch {
        /* detune may not accept in mocks */
      }
    }
    const g = ctx.createGain()
    // spectral coloring
    let scale = level * 0.12
    if (model === 'Vox') scale *= 0.9
    if (model === 'Farf') scale *= 0.85
    if (model === 'Pipe 1') scale *= 0.75
    g.gain.value = scale
    osc.connect(g)
    g.connect(amp)
    osc.start(now)
    voice.oscs.push(osc)
    voice.gains.push(g)
  }

  // Key click
  if (section.keyClick > 0.05 && (model === 'B3' || model === 'B3 Bass' || model === 'Vox')) {
    try {
      const len = Math.floor(ctx.sampleRate * 0.012)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.25))
      }
      const src = ctx.createBufferSource()
      src.buffer = buf
      const cg = ctx.createGain()
      cg.gain.value = section.keyClick * 0.15 * zoneGain
      src.connect(cg)
      cg.connect(amp)
      src.start(now)
      voice.click = src
      voice.gains.push(cg)
    } catch {
      /* ignore */
    }
  }

  // Percussion (B3 only, single trigger)
  if (section.percussion.on && (model === 'B3' || model === 'B3 Bass') && percArmed) {
    const harm = section.percussion.third ? 3 : 2
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * harm, now)
    const g = ctx.createGain()
    const pLevel = section.percussion.soft ? 0.12 : 0.28
    const decay = section.percussion.fast ? 0.18 : 0.55
    g.gain.setValueAtTime(pLevel * zoneGain, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + decay)
    osc.connect(g)
    g.connect(amp)
    osc.start(now)
    osc.stop(now + decay + 0.05)
    voice.oscs.push(osc)
    voice.gains.push(g)
    percArmed = false
  }

  heldCount++
  return voice
}

export function releaseOrganVoice(ctx: AudioContext, voice: OrganVoice, release = 0.12): void {
  const now = ctx.currentTime
  try {
    voice.amp.gain.cancelScheduledValues(now)
    voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), now)
    voice.amp.gain.exponentialRampToValueAtTime(0.0001, now + release)
  } catch {
    /* ignore */
  }
  heldCount = Math.max(0, heldCount - 1)
  if (heldCount === 0) percArmed = true
  window.setTimeout(() => stopOrganVoice(voice), release * 1000 + 30)
}

export function stopOrganVoice(voice: OrganVoice): void {
  for (const o of voice.oscs) {
    try {
      o.stop()
      o.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (voice.vib) {
    try {
      voice.vib.stop()
      voice.vib.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (voice.click) {
    try {
      voice.click.stop()
      voice.click.disconnect()
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
  } catch {
    /* ignore */
  }
}

/** Offline spectral energy bands for model distinctness */
export function organModelSignature(model: OrganModel, drawbars?: number[]): number[] {
  const bars = effectiveDrawbars(model, drawbars ?? [1, 0.8, 0.9, 0.7, 0.5, 0.4, 0.3, 0.2, 0.2])
  const weights = modelHarmonicWeights(model)
  const bands = [0, 0, 0, 0]
  for (let i = 0; i < 9; i++) {
    bands[i % 4]! += bars[i]! * weights[i]! * (1 + i * 0.1)
  }
  // model class offset
  const offset =
    model === 'B3' || model === 'B3 Bass'
      ? 1
      : model === 'Vox'
        ? 2.5
        : model === 'Farf'
          ? 4
          : 3.2
  bands[0]! += offset
  return bands
}
