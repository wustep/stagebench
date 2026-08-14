import type { AudioBufferLike, AudioContextLike, GainNodeLike, OscillatorNodeLike } from './types'
import type { OrganLayerState, VibratoPos } from '../model/instrument-state'

export interface StartedNodes {
  nodes: { stop: (time: number) => void; disconnect: () => void }[]
  gain: GainNodeLike
}

const B3_RATIOS = [0.5, 1.4983, 1, 2, 2.9966, 4, 5.0397, 5.9932, 8]
const VOX_RATIOS = [0.5, 1, 2, 3, 4, 5, 6, 8, 1]
const PIPE_RATIOS = [0.5, 0.75, 1, 2, 3, 4, 5, 6, 8]
const MAX_NOTE = 6

export function startOrganVoice(
  ctx: AudioContextLike,
  dest: GainNodeLike,
  layer: OrganLayerState,
  midi: number,
  velocity: number,
  when: number,
  noise: AudioBufferLike | null,
  percTrigger: boolean,
): StartedNodes {
  const voiceGain = ctx.createGain()
  const peak = (0.04 + velocity * 0.16) * layer.level
  voiceGain.gain.setValueAtTime(0.0001, when)
  const attack = layer.model.startsWith('Pipe') ? 0.03 : 0.006
  voiceGain.gain.linearRampToValueAtTime(peak, when + attack)
  voiceGain.connect(dest)

  const nodes: StartedNodes['nodes'] = [adapt(voiceGain)]
  const freq = midiToFreq(midi)
  const bars = layer.drawbars
  const vibHz = vibratoHz(layer.vibratoType)
  const vibDepth = layer.vibratoOn ? vibratoDepth(layer.vibratoType) : 0
  const chorus = layer.vibratoOn && layer.vibratoType.startsWith('C')

  if (layer.model === 'B3' || layer.model === 'Pipe 2') {
    addAdditive(ctx, voiceGain, freq, bars, B3_RATIOS, 'sine', when, nodes, 1, vibHz, vibDepth)
  } else if (layer.model === 'Vox') {
    addAdditive(ctx, voiceGain, freq, bars, VOX_RATIOS, 'triangle', when, nodes, 0.85, vibHz, vibDepth)
    const mix = (bars[8] ?? 0) / 8
    addAdditive(ctx, voiceGain, freq, [0, 0, 8 * mix, 0, 0, 0, 0, 0, 0], VOX_RATIOS, 'sawtooth', when, nodes, 0.4, vibHz, vibDepth)
  } else if (layer.model === 'Farf') {
    for (let i = 0; i < 9; i++) {
      if ((bars[i] ?? 0) < 4.5) continue
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(freq * B3_RATIOS[i] * 0.98, when)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.setValueAtTime(freq * B3_RATIOS[i] * (0.7 + i * 0.15), when)
      bp.Q.setValueAtTime(2 + i * 0.4, when)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.12, when)
      osc.connect(bp)
      bp.connect(g)
      g.connect(voiceGain)
      applyVibrato(osc, ctx, when, vibHz, vibDepth * 0.6, nodes)
      osc.start(when)
      osc.stop(when + MAX_NOTE)
      nodes.push(adapt(osc), adapt(bp), adapt(g))
    }
  } else {
    addAdditive(ctx, voiceGain, freq, bars, PIPE_RATIOS, 'sine', when, nodes, 0.7, vibHz, vibDepth * 0.35)
    const chiff = ctx.createOscillator()
    chiff.type = 'triangle'
    chiff.frequency.setValueAtTime(freq * 6.02, when)
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.08 * velocity, when)
    cg.gain.exponentialRampToValueAtTime(0.0001, when + 0.12)
    chiff.connect(cg)
    cg.connect(voiceGain)
    chiff.start(when)
    chiff.stop(when + 0.14)
    nodes.push(adapt(chiff), adapt(cg))
  }

  if (chorus) addChorusTap(ctx, voiceGain, dest, when, nodes, vibHz)

  if (layer.model === 'B3' && layer.percOn && percTrigger) {
    const ratio = layer.percThird ? 3 : 2
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * ratio, when)
    const g = ctx.createGain()
    const lvl = layer.percSoft ? 0.12 : 0.28
    g.gain.setValueAtTime(lvl * velocity, when)
    g.gain.exponentialRampToValueAtTime(0.0001, when + (layer.percFast ? 0.12 : 0.55))
    osc.connect(g)
    g.connect(voiceGain)
    osc.start(when)
    osc.stop(when + 0.7)
    nodes.push(adapt(osc), adapt(g))
  }

  if (noise && (layer.model === 'B3' || layer.model === 'Vox')) {
    const src = ctx.createBufferSource()
    src.buffer = noise
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.045 * velocity, when)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.018)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(2500, when)
    src.connect(hp)
    hp.connect(g)
    g.connect(voiceGain)
    src.start(when)
    src.stop(when + 0.03)
    nodes.push(adapt(src), adapt(g), adapt(hp))
  }

  return { nodes, gain: voiceGain }
}

function addAdditive(
  ctx: AudioContextLike,
  dest: GainNodeLike,
  freq: number,
  bars: number[],
  ratios: number[],
  type: OscillatorType,
  when: number,
  nodes: StartedNodes['nodes'],
  scale: number,
  vibHz: number,
  vibDepth: number,
): void {
  for (let i = 0; i < 9; i++) {
    const pos = bars[i] ?? 0
    if (pos <= 0) continue
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq * (ratios[i] ?? 1), when)
    const g = ctx.createGain()
    g.gain.setValueAtTime((pos / 8) * scale * (1 / Math.sqrt(i + 1)), when)
    osc.connect(g)
    g.connect(dest)
    applyVibrato(osc, ctx, when, vibHz, vibDepth, nodes)
    osc.start(when)
    osc.stop(when + MAX_NOTE)
    nodes.push(adapt(osc), adapt(g))
  }
}

function applyVibrato(
  osc: OscillatorNodeLike,
  ctx: AudioContextLike,
  when: number,
  hz: number,
  depth: number,
  nodes: StartedNodes['nodes'],
): void {
  if (depth <= 0 || hz <= 0) return
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.setValueAtTime(hz, when)
  const g = ctx.createGain()
  g.gain.setValueAtTime(depth, when)
  lfo.connect(g)
  g.connect(osc.frequency)
  lfo.start(when)
  lfo.stop(when + MAX_NOTE)
  nodes.push(adapt(lfo), adapt(g))
}

function addChorusTap(
  ctx: AudioContextLike,
  from: GainNodeLike,
  dest: GainNodeLike,
  when: number,
  nodes: StartedNodes['nodes'],
  hz: number,
): void {
  const delay = ctx.createDelay(0.03)
  delay.delayTime.setValueAtTime(0.012, when)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.55, when)
  const lfo = ctx.createOscillator()
  lfo.frequency.setValueAtTime(Math.max(0.4, hz), when)
  const depth = ctx.createGain()
  depth.gain.setValueAtTime(0.004, when)
  lfo.connect(depth)
  depth.connect(delay.delayTime)
  from.connect(delay)
  delay.connect(g)
  g.connect(dest)
  lfo.start(when)
  lfo.stop(when + MAX_NOTE)
  nodes.push(adapt(delay), adapt(g), adapt(lfo), adapt(depth))
}

function vibratoHz(pos: VibratoPos): number {
  const n = Number(pos[1]) || 1
  return 5.5 + n * 1.2
}

function vibratoDepth(pos: VibratoPos): number {
  const n = Number(pos[1]) || 1
  const chorus = pos.startsWith('C') ? 0.6 : 1
  return n * 4.5 * chorus
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
