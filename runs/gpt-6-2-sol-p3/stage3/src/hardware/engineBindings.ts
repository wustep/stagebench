import {
  arpModes, categories, clamp, clockDivisions, filterTypes, lfoTargets, lfoWaves, organChorus,
  organModels, priorities, splitPoints, synthLayers, voiceModes, waves,
} from '../instrument/parameters'
import type { LayerKey, OrganLayer, SynthLayer, ZoneRange } from '../instrument/parameters'
import { cutoffHz } from '../audio/synth'
import { editLayer, layerAt } from '../instrument/programs'
import { cycle, focusLayer, layers } from '../piano/settings'
import type { Layer, Settings, Step } from '../piano/settings'
import type { Binding } from './bindings'

export const organState = (s: Settings) => s.organ.layers[s.organ.focus]
export const synthState = (s: Settings) => s.synth.layers[s.synth.focus]

export function editOrgan(s: Settings, patch: Partial<OrganLayer>): Settings {
  const id = s.organ.focus
  return { ...s, organ: { ...s.organ, layers: { ...s.organ.layers, [id]: { ...organState(s), ...patch } } } }
}

export function editSynth(s: Settings, patch: Partial<SynthLayer>): Settings {
  const id = s.synth.focus
  return { ...s, synth: { ...s.synth, layers: { ...s.synth.layers, [id]: { ...synthState(s), ...patch } } } }
}

export function synthGroup<K extends keyof SynthLayer>(s: Settings, group: K, patch: Partial<SynthLayer[K]>): Settings {
  return editSynth(s, { [group]: { ...synthState(s)[group] as object, ...patch } })
}

export function zoneName(zone: ZoneRange, count: number) {
  const [first, end] = zone
  if (first === 0 && end === 3) return 'All zones'
  if (first >= count) return `Zone ${first + 1} (inactive)`
  return first === Math.min(end, count - 1) ? `Zone ${first + 1}` : `Zones ${first + 1}–${Math.min(end, count - 1) + 1}`
}

function shiftZone(s: Settings, key: LayerKey, direction: number): Settings {
  const count = splitPoints(s.splits).length + 1
  const choices: ZoneRange[] = []
  for (let first = 0; first < count; first++) {
    for (let end = first; end < count; end++) choices.push([first, end === count - 1 && first === 0 ? 3 : end])
  }
  const current = layerAt(s, key).zone
  const index = choices.findIndex(([first, end]) => first === current[0] && end === current[1])
  return editLayer(s, key, { zone: choices[(Math.max(0, index) + direction + choices.length) % choices.length] })
}

type Section = 'organ' | 'piano' | 'synth'
function focus(s: Settings, section: Section, id: Layer | 'C'): Settings {
  if (section === 'piano') return focusLayer(s, id as Layer)
  if (section === 'organ') return { ...s, organ: { ...s.organ, focus: id as Layer }, effects: { ...s.effects, focus: 'Organ' } }
  return { ...s, synth: { ...s.synth, focus: id }, effects: { ...s.effects, focus: 'Synth', synthLayer: id } }
}

function octave(section: Section, direction: number): Binding {
  const key = (s: Settings): LayerKey => section === 'piano' ? `piano${s.focus}` : `${section}${s[section].focus}` as LayerKey
  return {
    read(s) {
      const layer = layerAt(s, key(s))
      const label = layer.octave ? `${layer.octave > 0 ? '+' : '−'}1 octave` : 'Normal octave'
      return { value: layer.octave === direction, text: `${label} · ${zoneName(layer.zone, splitPoints(s.splits).length + 1)}` }
    },
    write(s, _, shift) {
      return shift ? shiftZone(s, key(s), direction) : editLayer(s, key(s), { octave: clamp(layerAt(s, key(s)).octave + direction, -1, 1) })
    },
  }
}

function organToggle(prop: 'pitch' | 'sustain' | 'vibrato'): Binding {
  return {
    read: (s) => ({ value: organState(s)[prop] }),
    write: (s, v) => editOrgan(s, { [prop]: Boolean(v) }),
  }
}

function synthToggle(prop: 'pitch' | 'sustain'): Binding {
  return {
    read: (s) => ({ value: synthState(s)[prop] }),
    write: (s, v) => editSynth(s, { [prop]: Boolean(v) }),
  }
}

function synthCycle<K extends keyof SynthLayer, P extends keyof SynthLayer[K]>(
  group: K, property: P, choices: readonly SynthLayer[K][P][], defaultIndex = 0,
): Binding {
  const get = (s: Settings) => synthState(s)[group][property]
  return {
    read: (s) => ({ value: get(s) !== choices[defaultIndex], text: String(get(s)) }),
    write: (s) => synthGroup(s, group, { [property]: cycle(choices, get(s)) } as unknown as Partial<SynthLayer[K]>),
  }
}

function synthNumber<K extends 'arp' | 'lfo' | 'voice' | 'osc' | 'filter', P extends keyof SynthLayer[K]>(
  group: K, property: P, label?: (value: number, s: Settings) => string,
): Binding {
  return {
    read(s) {
      const value = Number(synthState(s)[group][property])
      return { value, text: label?.(value, s) }
    },
    write(s, value) { return synthGroup(s, group, { [property]: Number(value) } as Partial<SynthLayer[K]>) },
  }
}

const bipolar = (v: number) => v === 5 ? '0' : `${v > 5 ? '+' : '−'}${Math.abs(v - 5) * 20}%`
const arp = (s: Settings) => synthState(s).arp
const lfo = (s: Settings) => synthState(s).lfo
const arpRateText = (rate: number, s: Settings) => arp(s).sync ? clockText(rate, s) : `${Math.round(30 + 27 * rate)} BPM`
const lfoRateText = (rate: number, s: Settings) => lfo(s).sync ? clockText(rate, s) : `${(0.08 * 2 ** rate).toFixed(2)} Hz`
function clockText(value: number, s: Settings) {
  return `${clockDivisions[Math.round(value)][1]} · ${s.effects.clockBpm} BPM`
}

export const engineBindings: Record<string, Binding> = {
  'mod-wheel': {
    read: (s) => ({ value: Math.round(s.performance.wheel * 10), text: `${Math.round(s.performance.wheel * 100)}%` }),
    write: (s, v) => ({ ...s, performance: { ...s.performance, wheel: Number(v) / 10 } }),
  },
  'organ-model': {
    read: (s) => ({ value: organState(s).model !== 'B3', text: organState(s).model }),
    write: (s) => editOrgan(s, { model: cycle(organModels, organState(s).model) }),
  },
  'organ-vibrato-type': {
    read: (s) => ({ value: organState(s).chorus !== 'C1', text: organState(s).chorus }),
    write: (s) => editOrgan(s, { chorus: cycle(organChorus, organState(s).chorus) }),
  },
  'organ-vibrato-on': organToggle('vibrato'),
  'organ-sustped': organToggle('sustain'),
  'organ-pstick': organToggle('pitch'),
  'synth-sustped': synthToggle('sustain'),
  'synth-pstick': synthToggle('pitch'),
  'synth-mode': { read: () => ({ value: true, text: 'Analog mode' }) },
  'synth-osc-type': {
    read: () => ({ value: 0, text: 'Analog · single source' }),
  },
  'synth-osc-category': {
    read: (s) => ({ value: categories.indexOf(synthState(s).category), text: synthState(s).category }),
    write: (s, v) => editSynth(s, { category: categories[Number(v)], wave: 0 }),
  },
  'synth-osc-wave': {
    read: (s) => ({ value: synthState(s).wave, text: waves[synthState(s).category][synthState(s).wave] }),
    write: (s, v) => editSynth(s, { wave: Number(v) }),
  },
  'synth-waveform': {
    read: (s) => ({ value: synthState(s).wave > 0, text: waves[synthState(s).category][synthState(s).wave] }),
    write: (s) => editSynth(s, { wave: (synthState(s).wave + 1) % waves[synthState(s).category].length }),
  },
  'synth-osc-control': {
    read: (s) => {
      const { category, control } = synthState(s)
      const label = { Pure: 'Inactive in Pure', Sync: 'Sync pitch', Multi: 'Detune', Super: 'Stereo detune', 'FM-H': 'FM amount' }
      return { value: Math.round(control), text: `${label[category]} · ${control.toFixed(1)}` }
    },
    write: (s, v) => editSynth(s, { control: Number(v) }),
  },
  'synth-kb-hold': {
    read: (s) => ({ value: arp(s).hold }),
    write: (s, v) => synthGroup(s, 'arp', { hold: Boolean(v) }),
  },
  'synth-arp-run': {
    read: (s) => ({ value: arp(s).run }),
    write: (s, v, shift) => shift ? { ...s, keyboardSync: !s.keyboardSync } : synthGroup(s, 'arp', { run: Boolean(v) }),
  },
  'synth-arp-rate': synthNumber('arp', 'rate', arpRateText),
  'synth-arp-range': synthNumber('arp', 'range', (v, s) => arp(s).mode === 'Gate' ? `Gate hardness ${v}` : `${Math.floor(v) + 1} octave(s)`),
  'synth-arp-mode': {
    ...synthCycle('arp', 'mode', arpModes),
    write: (s) => synthGroup(s, 'arp', { mode: cycle(arpModes, arp(s).mode), range: Math.min(3, arp(s).range) }),
  },
  'synth-arp-menu': { read: (s) => ({ value: arp(s).sync, text: arp(s).direction }) },
  'synth-voice-mode': {
    read: (s) => ({ value: synthState(s).voice.mode !== 'Poly',
      text: `${synthState(s).voice.mode} · ${synthState(s).voice.priority} priority` }),
    write: (s, _, shift) => shift ? synthGroup(s, 'voice', { priority: cycle(priorities, synthState(s).voice.priority) })
      : synthGroup(s, 'voice', { mode: cycle(voiceModes, synthState(s).voice.mode) }),
  },
  'synth-glide': synthNumber('voice', 'glide', (v) => v ? `${Math.round(96 / (1 + 2 * v))} semitones/s` : 'Off'),
  'synth-unison': synthCycle('voice', 'unison', [0, 1, 2, 3]),
  'synth-vibrato': synthCycle('vibrato', 'mode', ['Off', 'On', 'Wheel']),
  'synth-vibrato-menu': { read: (s) => ({ value: false, text: `${synthState(s).vibrato.rate.toFixed(1)} Hz` }) },
  'synth-lfo-rate': synthNumber('lfo', 'rate', lfoRateText),
  'synth-lfo-amount': synthNumber('lfo', 'amount', (v) => `${v * 10}%`),
  'synth-lfo-wave': synthCycle('lfo', 'wave', lfoWaves),
  'synth-lfo-target': synthCycle('lfo', 'target', lfoTargets),
  'synth-osc-pitch-mode': {
    read: (s) => ({ value: synthState(s).osc.toPitch,
      text: `${synthState(s).coarse} st · ${synthState(s).fine} cents` }),
    write: (s, _, shift) => shift ? synthGroup(s, 'osc', { toPitch: !synthState(s).osc.toPitch }) : s,
  },
  'synth-osc-envelope': {
    read: (s) => ({ value: synthState(s).osc.velocity }),
    write: (s) => synthGroup(s, 'osc', { velocity: !synthState(s).osc.velocity }),
  },
  'synth-osc-envelope-amount': synthNumber('osc', 'amount', bipolar),
  'synth-filter-frequency': synthNumber('filter', 'frequency', (v) => `${Math.round(cutoffHz(v))} Hz`),
  'synth-filter-resonance': synthNumber('filter', 'resonance', (v, s) => `${v * 10}% · Tracking ${synthState(s).filter.tracking}/3`),
  'synth-filter-envelope-amount': synthNumber('filter', 'amount', bipolar),
  'synth-filter-type': synthCycle('filter', 'type', filterTypes),
  'synth-filter-on': {
    read: (s) => ({ value: synthState(s).filter.on, text: `Drive ${synthState(s).filter.drive || 'Off'}` }),
    write: (s, v, shift) => synthGroup(s, 'filter', shift
      ? { drive: cycle<Step>([0, 1, 2, 3], synthState(s).filter.drive) } : { on: Boolean(v) }),
  },
  'synth-filter-envelope': {
    read: (s) => ({ value: synthState(s).filter.velocity }),
    write: (s) => synthGroup(s, 'filter', { velocity: !synthState(s).filter.velocity }),
  },
  'synth-amp-envelope': synthCycle('amp', 'velocity', [0, 1, 2, 3]),
  'rotary-organ': {
    read: (s) => ({ value: s.effects.rotary.organ }),
    write: (s, v) => ({ ...s, effects: { ...s.effects, rotary: { ...s.effects.rotary, organ: Boolean(v) } } }),
  },
  'rotary-stop': {
    read: (s) => ({ value: s.effects.rotary.stop }),
    write: (s, v) => ({ ...s, effects: { ...s.effects, rotary: { ...s.effects.rotary, stop: Boolean(v) } } }),
  },
}

for (const [id, prop] of Object.entries({ on: 'on', volume: 'soft', decay: 'fast', harmonic: 'third' } as const)) {
  engineBindings[`organ-percussion-${id}`] = {
    read: (s) => ({ value: organState(s).percussion[prop] }),
    write: (s, v) => editOrgan(s, { percussion: { ...organState(s).percussion, [prop]: Boolean(v) } }),
  }
}
for (let i = 0; i < 9; i++) {
  engineBindings[`organ-drawbar-${i + 1}`] = {
    read: (s) => ({ value: organState(s).drawbars[i] }),
    write(s, v) {
      const drawbars = [...organState(s).drawbars]
      drawbars[i] = Number(v)
      return editOrgan(s, { drawbars })
    },
  }
}
for (const section of ['organ', 'piano', 'synth'] as const) {
  if (section !== 'piano') engineBindings[`${section}-section-on`] = {
    read: (s) => ({ value: s[section].on }),
    write: (s, v) => ({ ...s, [section]: { ...s[section], on: Boolean(v) } }),
  }
  for (const [id, direction] of [['down', -1], ['up', 1]] as const) engineBindings[`${section}-octave-${id}`] = octave(section, direction)
  if (section === 'piano') continue
  for (const id of section === 'organ' ? layers : synthLayers) {
    const key = `${section}${id}` as LayerKey
    const prefix = `${section}-layer-${id.toLowerCase()}`
    engineBindings[`${prefix}-on`] = {
      read: (s) => ({ value: layerAt(s, key).on, text: s[section].focus === id ? 'Focused' : 'Shift to focus' }),
      write: (s, v, shift) => shift ? focus(s, section, id) : v ? focus(editLayer(s, key, { on: true }), section, id) : editLayer(s, key, { on: false }),
    }
    engineBindings[`${prefix}-focus`] = {
      read: (s) => ({ value: s[section].focus === id }),
      write: (s) => focus(s, section, id),
    }
    engineBindings[`${prefix}-level`] = {
      read: (s) => ({ value: layerAt(s, key).level, text: `${Math.round(layerAt(s, key).level / 12 * 100)}%` }),
      write: (s, v) => editLayer(s, key, { level: Number(v) }),
    }
  }
}
