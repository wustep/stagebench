import type {
  AudioBufferLike,
  AudioContextLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './types'
import {
  SYNTH_WAVE_CATEGORY,
  type SynthLayerState,
  type SynthWave,
} from '../model/instrument-state'
import type { StartedNodes } from './organ-voices'

const MAX_NOTE = 8

export function startSynthVoice(
  ctx: AudioContextLike,
  dest: GainNodeLike,
  layer: SynthLayerState,
  midi: number,
  velocity: number,
  when: number,
  noise: AudioBufferLike | null,
  pulse33: AudioBufferLike | null,
  pulse10: AudioBufferLike | null,
  glideFromHz: number | null,
): StartedNodes {
  const freq = midiToFreq(midi + layer.coarse + layer.fine / 100)
  const vel = ampVel(layer, velocity)
  const voiceGain = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  configureFilter(filter, layer, midi, when)
  const drive = ctx.createWaveShaper()
  drive.curve = driveCurve(layer.filterDrive)
  filter.connect(drive)
  drive.connect(voiceGain)
  voiceGain.connect(dest)

  const peak = 0.08 + vel * 0.18
  const a = 0.005 + layer.ampEnvA * 0.8
  const d = 0.04 + layer.ampEnvD * 1.2
  const s = layer.ampEnvD >= 0.98 ? peak : peak * layer.ampEnvS
  voiceGain.gain.setValueAtTime(0.0001, when)
  voiceGain.gain.linearRampToValueAtTime(peak, when + a)
  voiceGain.gain.linearRampToValueAtTime(Math.max(0.0001, s), when + a + d)

  const nodes: StartedNodes['nodes'] = [adapt(voiceGain), adapt(filter), adapt(drive)]
  const oscCtrl = layer.oscCtrl
  const category = SYNTH_WAVE_CATEGORY[layer.wave]
  spawnOscillators(ctx, filter, layer.wave, freq, when, oscCtrl, nodes, noise, pulse33, pulse10)

  if (layer.unison === 1 || layer.unison === 2 || layer.unison === 3) {
    const extra = layer.unison === 1 ? [7] : layer.unison === 2 ? [-9, 11] : [-14, 12, 21]
    for (const cents of extra) {
      spawnOscillators(
        ctx,
        filter,
        layer.wave,
        freq * 2 ** (cents / 1200),
        when,
        oscCtrl,
        nodes,
        noise,
        pulse33,
        pulse10,
        0.45,
      )
    }
  }

  if (glideFromHz && glideFromHz > 0 && (layer.voiceMode === 'Mono' || layer.voiceMode === 'Legato')) {
    const glideSec = 0.02 + layer.glide * 0.6
    for (const node of nodes) {
      void node
    }
    applyGlide(ctx, filter, glideFromHz, freq, when, glideSec, nodes)
  }

  applyFilterEnvelope(filter, layer, midi, vel, when)
  applyLfo(ctx, filter, layer, freq, when, nodes, oscCtrl)
  applyVibrato(ctx, filter, layer, when, nodes)

  if (category === 'Pure' && oscCtrl > 0) {
    /* Osc Ctrl has no effect on Pure — leave spectrum unchanged. */
  }

  return { nodes, gain: voiceGain }
}

function spawnOscillators(
  ctx: AudioContextLike,
  dest: BiquadFilterNodeLike,
  wave: SynthWave,
  freq: number,
  when: number,
  oscCtrl: number,
  nodes: StartedNodes['nodes'],
  noise: AudioBufferLike | null,
  pulse33: AudioBufferLike | null,
  pulse10: AudioBufferLike | null,
  gainScale = 1,
): void {
  const cat = SYNTH_WAVE_CATEGORY[wave]
  if (wave === 'White Noise' && noise) {
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.35 * gainScale, when)
    src.connect(g)
    g.connect(dest)
    src.start(when)
    src.stop(when + MAX_NOTE)
    nodes.push(adapt(src), adapt(g))
    return
  }
  if (wave === 'Pulse 33' || wave === 'Pulse 10') {
    const buf = wave === 'Pulse 33' ? pulse33 : pulse10
    if (buf) {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.playbackRate.setValueAtTime((freq * buf.length) / buf.sampleRate, when)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.28 * gainScale, when)
      src.connect(g)
      g.connect(dest)
      src.start(when)
      src.stop(when + MAX_NOTE)
      nodes.push(adapt(src), adapt(g))
      return
    }
  }
  if (cat === 'Sync') {
    const master = ctx.createOscillator()
    master.type = wave.includes('Square') ? 'square' : 'sawtooth'
    master.frequency.setValueAtTime(freq, when)
    const slave = ctx.createOscillator()
    slave.type = wave.includes('Square') ? 'square' : 'sawtooth'
    const ratio = 1 + oscCtrl * 4
    slave.frequency.setValueAtTime(freq * ratio, when)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.22 * gainScale, when)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.18 * gainScale, when)
    master.connect(g)
    slave.connect(g2)
    g.connect(dest)
    g2.connect(dest)
    master.start(when)
    slave.start(when)
    master.stop(when + MAX_NOTE)
    slave.stop(when + MAX_NOTE)
    nodes.push(adapt(master), adapt(slave), adapt(g), adapt(g2))
    return
  }
  if (cat === 'Multi') {
    const count = wave.includes('8ve') ? 4 : 3
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      const det = (i - (count - 1) / 2) * (8 + oscCtrl * 35)
      const oct = wave.includes('8ve') && i === count - 1 ? 2 : 1
      osc.frequency.setValueAtTime(freq * oct * 2 ** (det / 1200), when)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.16 * gainScale, when)
      osc.connect(g)
      g.connect(dest)
      osc.start(when)
      osc.stop(when + MAX_NOTE)
      nodes.push(adapt(osc), adapt(g))
    }
    return
  }
  if (cat === 'Super') {
    const type: OscillatorType = wave.includes('Square') ? 'square' : 'sawtooth'
    for (let i = 0; i < 7; i++) {
      const osc = ctx.createOscillator()
      osc.type = type
      const det = (i - 3) * (6 + oscCtrl * 28)
      osc.frequency.setValueAtTime(freq * 2 ** (det / 1200), when)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.1 * gainScale, when)
      osc.connect(g)
      g.connect(dest)
      osc.start(when)
      osc.stop(when + MAX_NOTE)
      nodes.push(adapt(osc), adapt(g))
    }
    return
  }
  if (cat === 'FM-H') {
    const car = ctx.createOscillator()
    car.type = 'sine'
    car.frequency.setValueAtTime(freq, when)
    const mod = ctx.createOscillator()
    mod.type = 'sine'
    mod.frequency.setValueAtTime(freq * 2, when)
    const idx = ctx.createGain()
    idx.gain.setValueAtTime(freq * oscCtrl * 6, when)
    mod.connect(idx)
    idx.connect(car.frequency)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.28 * gainScale, when)
    car.connect(g)
    g.connect(dest)
    car.start(when)
    mod.start(when)
    car.stop(when + MAX_NOTE)
    mod.stop(when + MAX_NOTE)
    nodes.push(adapt(car), adapt(mod), adapt(idx), adapt(g))
    return
  }
  const osc = ctx.createOscillator()
  osc.type = pureType(wave)
  osc.frequency.setValueAtTime(freq, when)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.28 * gainScale, when)
  osc.connect(g)
  g.connect(dest)
  osc.start(when)
  osc.stop(when + MAX_NOTE)
  nodes.push(adapt(osc), adapt(g))
}

function pureType(wave: SynthWave): OscillatorType {
  if (wave === 'Sine') return 'sine'
  if (wave === 'Triangle') return 'triangle'
  if (wave === 'Square' || wave.startsWith('Pulse')) return 'square'
  return 'sawtooth'
}

function configureFilter(filter: BiquadFilterNodeLike, layer: SynthLayerState, midi: number, when: number): void {
  filter.type = layer.filterType === 'HP' ? 'highpass' : layer.filterType === 'BP' ? 'bandpass' : 'lowpass'
  const track = layer.filterTrack === 'Off' ? 0 : layer.filterTrack === '1/3' ? 0.33 : layer.filterTrack === '2/3' ? 0.66 : 1
  const base = 40 * 2 ** (layer.filterFreq * 9)
  const tracked = base * 2 ** (((midi - 60) / 12) * track)
  filter.frequency.setValueAtTime(tracked, when)
  filter.Q.setValueAtTime(0.4 + layer.filterRes * 12, when)
}

function applyFilterEnvelope(
  filter: BiquadFilterNodeLike,
  layer: SynthLayerState,
  midi: number,
  vel: number,
  when: number,
): void {
  const amt = layer.filterEnvAmt * (layer.filtEnvVel ? vel : 1)
  if (amt <= 0.001) return
  const track = layer.filterTrack === 'Off' ? 0 : layer.filterTrack === '1/3' ? 0.33 : layer.filterTrack === '2/3' ? 0.66 : 1
  const base = 40 * 2 ** (layer.filterFreq * 9) * 2 ** (((midi - 60) / 12) * track)
  const peak = Math.min(18000, base * (1 + amt * 8))
  const a = 0.005 + layer.filtEnvA * 0.6
  const d = 0.04 + layer.filtEnvD * 1.1
  filter.frequency.setValueAtTime(base, when)
  filter.frequency.linearRampToValueAtTime(peak, when + a)
  filter.frequency.linearRampToValueAtTime(base, when + a + d)
}

function applyLfo(
  ctx: AudioContextLike,
  filter: BiquadFilterNodeLike,
  layer: SynthLayerState,
  freq: number,
  when: number,
  nodes: StartedNodes['nodes'],
  _oscCtrl: number,
): void {
  if (layer.lfoDest === 'Off' || layer.lfoAmt <= 0.001) return
  const lfo = ctx.createOscillator()
  lfo.type = lfoOscType(layer.lfoWave)
  const hz = layer.lfoSync ? 0 : 0.1 + layer.lfoRate * 18
  lfo.frequency.setValueAtTime(Math.max(0.05, hz), when)
  const g = ctx.createGain()
  if (layer.lfoDest === 'Filter Freq') {
    g.gain.setValueAtTime(layer.lfoAmt * 1800, when)
    lfo.connect(g)
    g.connect(filter.frequency)
  } else if (layer.lfoDest === 'Osc Pitch') {
    g.gain.setValueAtTime(layer.lfoAmt * freq * 0.15, when)
    lfo.connect(g)
    g.connect(filter.frequency)
  } else {
    g.gain.setValueAtTime(layer.lfoAmt * 400, when)
    lfo.connect(g)
    g.connect(filter.frequency)
  }
  lfo.start(when)
  lfo.stop(when + MAX_NOTE)
  nodes.push(adapt(lfo), adapt(g))
}

function applyVibrato(
  ctx: AudioContextLike,
  filter: BiquadFilterNodeLike,
  layer: SynthLayerState,
  when: number,
  nodes: StartedNodes['nodes'],
): void {
  const on = layer.vibrato === 'On' || (layer.vibrato === 'Wheel' && layer.lfoAmt >= 0)
  if (layer.vibrato === 'Off' || !on) return
  if (layer.vibrato === 'Wheel') return
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.setValueAtTime(layer.vibratoRate, when)
  const g = ctx.createGain()
  g.gain.setValueAtTime(layer.vibratoAmt * 720, when)
  lfo.connect(g)
  g.connect(filter.frequency)
  lfo.start(when)
  lfo.stop(when + MAX_NOTE)
  nodes.push(adapt(lfo), adapt(g))
}

function applyGlide(
  ctx: AudioContextLike,
  filter: BiquadFilterNodeLike,
  fromHz: number,
  toHz: number,
  when: number,
  sec: number,
  nodes: StartedNodes['nodes'],
): void {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(fromHz, when)
  osc.frequency.linearRampToValueAtTime(toHz, when + sec)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, when)
  osc.connect(g)
  g.connect(filter)
  osc.start(when)
  osc.stop(when + MAX_NOTE)
  nodes.push(adapt(osc), adapt(g))
}

function ampVel(layer: SynthLayerState, velocity: number): number {
  if (layer.ampVel === 'Off') return 0.7
  if (layer.ampVel === 1) return 0.45 + velocity * 0.4
  if (layer.ampVel === 3) return velocity ** 1.6
  return velocity
}

function lfoOscType(wave: SynthLayerState['lfoWave']): OscillatorType {
  if (wave === 'Square') return 'square'
  if (wave === 'Saw down' || wave === 'Saw up') return 'sawtooth'
  return 'sine'
}

function driveCurve(level: SynthLayerState['filterDrive']): Float32Array {
  const amt = level === 'Off' ? 0.02 : Number(level) * 0.35
  const n = 128
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(x * (1 + amt * 8))
  }
  return c
}

function midiToFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function adapt(node: { stop?: (time: number) => void; disconnect: () => void }): StartedNodes['nodes'][number] {
  return {
    stop: (time) => {
      node.stop?.(time)
    },
    disconnect: () => node.disconnect(),
  }
}

export function arpStepSeconds(layer: SynthLayerState, bpm: number, clockSync: boolean): number {
  if (layer.arpSync || clockSync) {
    const div = [0.5, 0.25, 1 / 6, 0.125][Math.min(3, Math.round(layer.arpRate * 3))] ?? 0.25
    return (60 / Math.max(30, bpm)) * (div * 4)
  }
  const rateBpm = 40 + layer.arpRate * 260
  return 60 / rateBpm
}

export function arpPattern(notes: number[], range: number, dir: SynthLayerState['arpDir'], seed: number): number[] {
  const unique = [...notes].sort((a, b) => a - b)
  if (unique.length === 0) return []
  const spanned: number[] = []
  const octs = Math.max(1, Math.min(4, range))
  for (let o = 0; o < octs; o++) {
    for (const n of unique) spanned.push(n + o * 12)
  }
  if (dir === 'Down') return [...spanned].reverse()
  if (dir === 'Up/Down') {
    if (spanned.length < 2) return spanned
    return [...spanned, ...spanned.slice(1, -1).reverse()]
  }
  if (dir === 'Random') {
    const out = [...spanned]
    let s = seed || 1
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      const j = s % (i + 1)
      const tmp = out[i]
      out[i] = out[j]
      out[j] = tmp
    }
    return out
  }
  return spanned
}

export type { OscillatorNodeLike }
