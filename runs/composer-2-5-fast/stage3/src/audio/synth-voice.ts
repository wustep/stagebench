import type { SynthLayerState, SynthWaveCategory } from './program-types'
import { SYNTH_WAVEFORMS } from './program-types'

export function waveformName(layer: SynthLayerState): string {
  const list = SYNTH_WAVEFORMS[layer.category] ?? SYNTH_WAVEFORMS.Pure
  return list[layer.waveformIndex % list.length] ?? 'Saw'
}

export function createSynthOscillators(
  ctx: BaseAudioContext,
  freq: number,
  layer: SynthLayerState,
  when: number,
): { output: GainNode; oscillators: OscillatorNode[]; extras: AudioNode[] } {
  const mix = ctx.createGain()
  mix.gain.value = 1
  const oscillators: OscillatorNode[] = []
  const extras: AudioNode[] = []
  const name = waveformName(layer)
  const ctrl = layer.oscCtrl / 127

  if (layer.category === 'Pure') {
    const osc = ctx.createOscillator()
    osc.type = pureType(name)
    osc.frequency.setValueAtTime(freq, when)
    osc.connect(mix)
    oscillators.push(osc)
  } else if (layer.category === 'Sync') {
    const master = ctx.createOscillator()
    const slave = ctx.createOscillator()
    master.type = name.includes('Square') ? 'square' : 'sawtooth'
    slave.type = master.type
    master.frequency.setValueAtTime(freq, when)
    slave.frequency.setValueAtTime(freq * (1 + ctrl * 0.5), when)
    const shaper = ctx.createWaveShaper()
    shaper.curve = new Float32Array(makeSyncCurve())
    master.connect(shaper)
    slave.connect(mix)
    shaper.connect(mix)
    oscillators.push(master, slave)
    extras.push(shaper)
  } else if (layer.category === 'Multi' || layer.category === 'Super') {
    const count = layer.category === 'Super' ? 3 + Math.floor(ctrl * 4) : 2 + Math.floor(ctrl * 3)
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator()
      osc.type = name.includes('Square') ? 'square' : 'sawtooth'
      const detune = (i - (count - 1) / 2) * (8 + ctrl * 24)
      osc.detune.setValueAtTime(detune, when)
      osc.frequency.setValueAtTime(freq * (name.includes('8ve') ? 2 : 1), when)
      const g = ctx.createGain()
      g.gain.value = 1 / count
      osc.connect(g)
      g.connect(mix)
      oscillators.push(osc)
      extras.push(g)
    }
  } else if (layer.category === 'FM-H') {
    const mod = ctx.createOscillator()
    const car = ctx.createOscillator()
    mod.type = 'sine'
    car.type = 'sine'
    mod.frequency.setValueAtTime(freq * 2, when)
    car.frequency.setValueAtTime(freq, when)
    const modGain = ctx.createGain()
    modGain.gain.setValueAtTime(freq * ctrl * 4, when)
    mod.connect(modGain)
    modGain.connect(car.frequency)
    car.connect(mix)
    oscillators.push(mod, car)
    extras.push(modGain)
  }

  return { output: mix, oscillators, extras }
}

function pureType(name: string): OscillatorType | 'custom' {
  if (name === 'Sine') return 'sine'
  if (name === 'Triangle') return 'triangle'
  if (name === 'Saw') return 'sawtooth'
  if (name === 'Square') return 'square'
  if (name.includes('Pulse')) return 'square'
  return 'sawtooth'
}

function makeSyncCurve(): Float32Array {
  const n = 256
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) curve[i] = i < n / 2 ? 1 : -1
  return curve
}

export function createSynthFilter(
  ctx: BaseAudioContext,
  source: AudioNode,
  layer: SynthLayerState,
  midi: number,
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  const track = [0, 0.33, 0.66, 1][Math.floor((layer.filterTrack / 127) * 3)] ?? 0
  const baseFreq = 80 + (layer.filterFreq / 127) ** 2 * 8000
  filter.frequency.value = baseFreq + midi * track * 8
  filter.Q.value = 0.5 + (layer.filterRes / 127) * 12
  switch (layer.filterType) {
    case 'LP12':
      filter.type = 'lowpass'
      filter.Q.value *= 0.5
      break
    case 'LP24':
      filter.type = 'lowpass'
      break
    case 'HP':
      filter.type = 'highpass'
      break
    case 'BP':
      filter.type = 'bandpass'
      break
  }
  if (layer.filterDrive > 0) {
    const drive = ctx.createWaveShaper()
    drive.curve = new Float32Array(makeDriveCurve(8 + layer.filterDrive * 12))
    source.connect(drive)
    drive.connect(filter)
  } else {
    source.connect(filter)
  }
  return filter
}

function makeDriveCurve(amount: number): Float32Array {
  const n = 256
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1
    curve[i] = Math.tanh(x * amount)
  }
  return curve
}

export function categoryOscCtrlEffect(category: SynthWaveCategory, ctrl: number): number {
  if (category === 'Pure') return 0
  return ctrl / 127
}

export function buildArpSequence(notes: number[], range: number, direction: SynthLayerState['arpDirection']): number[] {
  const sorted = [...notes].sort((a, b) => a - b)
  const expanded: number[] = []
  for (let oct = 0; oct < range; oct++) {
    for (const n of sorted) expanded.push(n + oct * 12)
  }
  if (direction === 'Up') return expanded
  if (direction === 'Down') return [...expanded].reverse()
  if (direction === 'Up/Down') return [...expanded, ...[...expanded].slice(1, -1).reverse()]
  return expanded.sort(() => 0.5 - Math.random())
}
