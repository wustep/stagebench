import type { OrganLayerState, OrganModel, OrganState } from './program-types'

/** B3 tonewheel harmonic ratios relative to fundamental. */
const B3_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
const VOX_RATIOS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12]
const PIPE_RATIOS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 8]

export function organHarmonicLevels(model: OrganModel, drawbars: number[]): number[] {
  const ratios = model === 'B3' ? B3_RATIOS : model === 'Vox' ? VOX_RATIOS : model === 'Pipe' ? PIPE_RATIOS : B3_RATIOS
  const levels: number[] = []
  for (let i = 0; i < 9; i++) {
    const db = drawbars[i] ?? 0
    let level = model === 'Farf' ? (db >= 4 ? 1 : 0) : db / 8
    if (model === 'Vox' && i === 8 && level > 0) {
      for (let j = 0; j < 8; j++) levels[j] = (levels[j] ?? 0) * (1 - level * 0.35)
    }
    levels[i] = level * (ratios[i]! < 1 ? 0.85 : 1)
  }
  return levels
}

export function spawnOrganVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  velocity: number,
  layer: OrganLayerState,
  organ: OrganState,
  when: number,
): { nodes: AudioNode[]; stop: (time: number) => void } {
  const freq = 440 * 2 ** ((midi - 69) / 12)
  const harmonics = organHarmonicLevels(layer.model, layer.drawbars)
  const master = ctx.createGain()
  const amp = (velocity / 127) * (layer.level / 127) * 0.35
  master.gain.setValueAtTime(0, when)
  master.gain.linearRampToValueAtTime(amp, when + 0.01)
  master.connect(dest)

  const nodes: AudioNode[] = [master]
  const oscillators: OscillatorNode[] = []

  const ratios = layer.model === 'B3' ? B3_RATIOS : layer.model === 'Vox' ? VOX_RATIOS : layer.model === 'Pipe' ? PIPE_RATIOS : B3_RATIOS
  for (let i = 0; i < harmonics.length; i++) {
    const level = harmonics[i]!
    const ratio = ratios[i] ?? 1
    const osc = ctx.createOscillator()
    osc.type = layer.model === 'Pipe' ? 'sine' : layer.model === 'Vox' ? 'square' : 'sawtooth'
    osc.frequency.setValueAtTime(freq * ratio, when)
    const g = ctx.createGain()
    g.gain.value = level / harmonics.length
    osc.connect(g)
    g.connect(master)
    osc.start(when)
    oscillators.push(osc)
    nodes.push(osc, g)
  }

  if (layer.model === 'B3' && organ.percussion.on) {
    const perc = ctx.createOscillator()
    const percGain = ctx.createGain()
    perc.type = 'sine'
    perc.frequency.setValueAtTime(freq * (organ.percussion.third ? 3 : 2), when)
    const percLevel = organ.percussion.soft ? 0.08 : 0.16
    percGain.gain.setValueAtTime(percLevel * amp, when)
    percGain.gain.exponentialRampToValueAtTime(0.001, when + (organ.percussion.fast ? 0.15 : 0.35))
    perc.connect(percGain)
    percGain.connect(master)
    perc.start(when)
    perc.stop(when + 0.5)
    nodes.push(perc, percGain)
  }

  if (layer.model === 'B3' && organ.keyClick > 10) {
    const click = ctx.createBufferSource()
    const len = Math.floor(ctx.sampleRate * 0.004)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    click.buffer = buf
    const clickGain = ctx.createGain()
    clickGain.gain.value = (organ.keyClick / 127) * 0.12
    click.connect(clickGain)
    clickGain.connect(master)
    click.start(when)
    nodes.push(click, clickGain)
  }

  applyVibChorus(ctx, master, layer, when, nodes, oscillators)

  return {
    nodes,
    stop: (time: number) => {
      master.gain.cancelScheduledValues(time)
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), time)
      master.gain.exponentialRampToValueAtTime(0.0001, time + 0.08)
      for (const o of oscillators) {
        try { o.stop(time + 0.1) } catch { /* noop */ }
      }
    },
  }
}

function applyVibChorus(
  ctx: BaseAudioContext,
  master: GainNode,
  layer: OrganLayerState,
  when: number,
  nodes: AudioNode[],
  oscillators: OscillatorNode[],
): void {
  if (!layer.vibOn || layer.vibChorus === 0) return
  const isChorus = layer.vibChorus >= 3
  const depthIndex = (layer.vibChorus % 3) + 1
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 4 + depthIndex * 0.8
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = depthIndex * 0.004 * (isChorus ? 1.5 : 1)
  lfo.connect(lfoGain)
  for (const o of oscillators) lfoGain.connect(o.frequency)
  if (isChorus) {
    const dry = ctx.createGain()
    dry.gain.value = 0.65
    const wet = ctx.createGain()
    wet.gain.value = 0.35
    master.connect(dry)
    master.connect(wet)
    nodes.push(lfo, lfoGain, dry, wet)
  } else {
    nodes.push(lfo, lfoGain)
  }
  lfo.start(when)
}

export function modelSpectralSignature(model: OrganModel): number[] {
  const drawbarsByModel: Record<OrganModel, number[]> = {
    B3: [0, 0, 8, 0, 8, 4, 2, 0, 0],
    Vox: [0, 4, 6, 0, 4, 2, 0, 0, 6],
    Farf: [0, 0, 8, 0, 8, 0, 0, 0, 0],
    Pipe: [4, 0, 6, 4, 0, 6, 0, 4, 0],
  }
  return organHarmonicLevels(model, drawbarsByModel[model])
}
