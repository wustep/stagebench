import { engineBindings, organState, synthState } from './engineBindings'
import { splitPoints, synthLayers } from '../instrument/parameters'
import { midFrequency } from '../audio/effects'
import {
  ampTypes, cycle, delayDivisions, delayFilters, editUnit, effectiveUnit, focusLayer, globalUnits, models, modulation1, modulation2, selectedTarget,
  pianoTypes, pitchSteps, reverbTones, reverbTypes, setLayer, timbres, toggleGlobal, toggleGroup, touchNames,
} from '../piano/settings'
import type { Chain, GlobalUnit, Layer, Settings } from '../piano/settings'

type Value = number | boolean
type Description = { value?: Value; text?: string }
export interface Binding {
  read(s: Settings): Description
  write?(s: Settings, value: Value, shift: boolean): Settings
  unit?: keyof Chain
}

const focused = (state: Settings) => state.layers[state.focus]
const describe = (value: Value, text?: string): Description => ({ value, text })
const levelText = (value: number, max = 10) => `${Math.round(100 * value / max)}%`
const bpmFor = (position: number) => 40 + position * 20
const stepFor = (bpm: number) => Math.max(0, Math.min(10, Math.round((bpm - 40) / 20)))

function binding(read: Binding['read'], write: Binding['write']): Binding {
  return { read, write }
}

function unit<K extends keyof Chain>(
  key: K, read: (value: Chain[K], settings: Settings) => Description,
  patch: (value: Chain[K], input: Value, shift: boolean) => Partial<Chain[K]>,
): Binding {
  const current = (state: Settings) => effectiveUnit(state, selectedTarget(state), key)
  return {
    read: (state) => read(current(state), state),
    write: (state, value, shift) => editUnit(state, key, patch(current(state), value, shift)),
    unit: key,
  }
}

function on<K extends keyof Chain>(key: K): Binding {
  const control = unit(key, (value, state) => {
    const global = (state.effects.global as Partial<Chain>)[key]
    return describe(value.on, global ? (value.on ? 'Global on' : 'Global bypassed') : (value.on ? 'On' : 'Bypassed'))
  }, (_, value) => ({ on: Boolean(value) }) as Partial<Chain[K]>)
  const write = control.write
  control.write = (state, value, shift) => shift && globalUnits.some((name) => name === key)
    ? toggleGlobal(state, key as GlobalUnit) : write?.(state, value, shift) ?? state
  return control
}

function typeOf<K extends keyof Chain, P extends keyof Chain[K]>(
  key: K, prop: P, choices: readonly Chain[K][P][],
): Binding {
  return unit(key, (s) => describe(s[prop] !== choices[0], String(s[prop])),
    (s, _next, shift) => shift ? {} : { ...s, [prop]: cycle(choices, s[prop]) })
}

const controls: Record<string, Binding> = {
  'master-level': binding((s) => describe(s.master, levelText(s.master)), (s, v) => ({ ...s, master: Number(v) })),
  'pitch-stick': binding(
    (s) => describe(Math.round((0.5 + s.pitch / 20) * pitchSteps), `${Number((s.pitch / 5).toFixed(2))} semitones`),
    (s, v) => ({ ...s, pitch: 20 * (Number(v) / pitchSteps - 0.5) }),
  ),
  'piano-section-on': binding((s) => describe(s.on), (s, v) => ({ ...s, on: Boolean(v) })),
  'piano-type': binding(
    (s) => describe(focused(s).type !== 'Grand', focused(s).type),
    (s, _, shift) => {
      if (shift) return s
      const type = cycle(pianoTypes, focused(s).type)
      const timbre = type !== 'Electric' && focused(s).timbre.startsWith('Dyno') ? 'Off' : focused(s).timbre
      return setLayer(s, s.focus, { type, timbre })
    },
  ),
  'piano-model': { read: (s) => ({ text: models[focused(s).type] }) },
  'piano-kb-touch': binding(
    (s) => describe(focused(s).touch !== 'Medium', focused(s).touch),
    (s) => setLayer(s, s.focus, { touch: cycle(touchNames, focused(s).touch) }),
  ),
  'piano-dyn-comp': binding(
    (s) => describe(focused(s).dynamics > 0, String(focused(s).dynamics || 'Off')),
    (s) => setLayer(s, s.focus, { dynamics: cycle([0, 1, 2, 3], focused(s).dynamics) }),
  ),
  'piano-unison': binding(
    (s) => describe(focused(s).unison > 0, String(focused(s).unison || 'Off')),
    (s) => setLayer(s, s.focus, { unison: cycle([0, 1, 2, 3], focused(s).unison) }),
  ),
  'piano-timbre': binding(
    (s) => describe(focused(s).timbre !== 'Off', focused(s).timbre),
    (s) => setLayer(s, s.focus, { timbre: cycle(focused(s).type === 'Electric' ? timbres : timbres.slice(0, 4), focused(s).timbre) }),
  ),
  'piano-acoustics': binding(
    (s) => {
      const { softRelease, resonance, type } = focused(s)
      const soft = softRelease && type !== 'Clav'
      const strings = resonance && (type === 'Grand' || type === 'Upright')
      return describe(soft || strings, [soft && 'Soft Release', strings && 'String Res'].filter(Boolean).join(' + ') || 'Off')
    },
    (s, _, shift) => {
      if (shift) return s
      const { softRelease, resonance, type } = focused(s)
      if (type === 'Clav') return s
      if (type !== 'Grand' && type !== 'Upright') return setLayer(s, s.focus, { softRelease: !softRelease })
      const option = ((softRelease ? 1 : 0) + (resonance ? 2 : 0) + 1) % 4
      return setLayer(s, s.focus, { softRelease: Boolean(option & 1), resonance: Boolean(option & 2) })
    },
  ),
  'piano-sustped': binding((s) => describe(focused(s).sustain), (s, v) => setLayer(s, s.focus, { sustain: Boolean(v) })),
  'piano-pstick': binding((s) => describe(focused(s).pitch), (s, v) => setLayer(s, s.focus, { pitch: Boolean(v) })),
  'effects-section-on': binding((s) => describe(s.effects.on), (s, v) => ({ ...s, effects: { ...s.effects, on: Boolean(v) } })),
  'effects-focus-organ': binding(
    (s) => describe(s.effects.focus === 'Organ', s.effects.focus === 'Organ' ? 'Organ A + B' : undefined),
    (s, _, shift) => ({ ...s, effects: shift ? { ...s.effects, on: !s.effects.on } : { ...s.effects, focus: 'Organ' } }),
  ),
  'effects-focus-synth': binding(
    (s) => describe(s.effects.focus === 'Synth', s.effects.synthGroup ? 'Synth group' : `Synth ${s.effects.synthLayer}`),
    (s, _, shift) => shift ? toggleGroup(s, 'Synth') : {
      ...s, effects: { ...s.effects, focus: 'Synth', synthLayer: s.effects.focus === 'Synth' && !s.effects.synthGroup
        ? cycle(synthLayers, s.effects.synthLayer) : s.synth.focus },
    },
  ),
  'effects-focus-piano': binding(
    (s) => describe(s.effects.focus === 'Piano', s.effects.group ? 'Piano group' : `Piano ${s.effects.layer}`),
    (s, _, shift) => shift ? toggleGroup(s) : {
      ...s,
      effects: { ...s.effects, focus: 'Piano', layer: s.effects.focus === 'Piano' && !s.effects.group
        ? (s.effects.layer === 'A' ? 'B' : 'A') : s.focus },
    },
  ),
  'effects-mod-1-on': on('mod1'),
  'effects-mod-1-variation': typeOf('mod1', 'type', modulation1),
  'effects-mod-1-rate': unit('mod1', (s) => describe(s.rate, s.type === 'A-Wah' ? `Sensitivity ${levelText(s.rate)}` : undefined),
    (_, v) => ({ rate: Number(v) })),
  'effects-mod-1-amount': unit('mod1', (s) => describe(s.amount, levelText(s.amount)), (_, v) => ({ amount: Number(v) })),
  'effects-mod-1-sync': unit('mod1', (s) => describe(s.sync), (_, v) => ({ sync: Boolean(v) })),
  'effects-mod-2-on': on('mod2'),
  'effects-mod-2-variation': typeOf('mod2', 'type', modulation2),
  'effects-mod-2-rate': unit('mod2', (s) => describe(s.rate), (_, v) => ({ rate: Number(v) })),
  'effects-mod-2-amount': unit('mod2', (s) => describe(s.amount, levelText(s.amount)), (_, v) => ({ amount: Number(v) })),
  'effects-delay-on': on('delay'),
  'effects-delay-tempo': unit('delay', (s, state) => s.sync
    ? describe(s.division, `${delayDivisions[s.division][1]} · ${state.effects.clockBpm} BPM`)
    : describe(stepFor(s.bpm), `${s.bpm} BPM`),
    (s, v) => s.sync ? { division: Number(v) } : { bpm: bpmFor(Number(v)) }),
  'effects-delay-feedback': unit('delay', (s) => describe(s.feedback, levelText(s.feedback)), (_, v) => ({ feedback: Number(v) })),
  'effects-delay-mix': unit('delay', (s) => describe(s.mix, `${levelText(s.mix)} wet`), (_, v) => ({ mix: Number(v) })),
  'effects-delay-ping-pong': typeOf('delay', 'filter', delayFilters),
  'effects-delay-sync': unit('delay', (s) => describe(s.sync), (_, v) => ({ sync: Boolean(v) })),
  'effects-delay-tap': unit('delay', (s, state) => describe(false, `${s.sync ? state.effects.clockBpm : s.bpm} BPM`), () => ({})),
  'effects-amp-on': on('amp'),
  'effects-amp-variation': typeOf('amp', 'type', ampTypes),
  'effects-amp-drive': unit('amp', (s) => describe(s.drive, levelText(s.drive)), (_, v) => ({ drive: Number(v) })),
  'effects-eq-frequency': unit('amp', (s) => describe(s.frequency, `${Math.round(midFrequency(s.frequency))} Hz`), (_, v) => ({ frequency: Number(v) })),
  'effects-eq-bass': unit('amp', (s) => describe(s.bass, `${(s.bass - 5) * 3} dB`), (_, v) => ({ bass: Number(v) })),
  'effects-eq-mid': unit('amp', (s) => describe(s.mid, s.type.includes('Filter') ? `Resonance ${levelText(s.mid)}` : `${(s.mid - 5) * 3} dB`), (_, v) => ({ mid: Number(v) })),
  'effects-eq-treble': unit('amp', (s) => describe(s.treble, `${(s.treble - 5) * 3} dB`), (_, v) => ({ treble: Number(v) })),
  'effects-comp-on': on('compressor'),
  'effects-comp-fast': unit('compressor', (s) => describe(s.fast), (_, v) => ({ fast: Boolean(v) })),
  'effects-comp-amount': unit('compressor', (s) => describe(s.amount, levelText(s.amount)), (_, v) => ({ amount: Number(v) })),
  'effects-reverb-on': on('reverb'),
  'effects-reverb-variation': typeOf('reverb', 'type', reverbTypes),
  'effects-reverb-bright': typeOf('reverb', 'tone', reverbTones),
  'effects-reverb-mix': unit('reverb', (s) => describe(s.mix, `${levelText(s.mix)} wet`), (_, v) => ({ mix: Number(v) })),
  'rotary-on': binding((s) => describe(s.effects.rotary.on), (s, v) => ({ ...s, effects: { ...s.effects, rotary: { ...s.effects.rotary, on: Boolean(v) } } })),
  'rotary-speed': binding((s) => describe(s.effects.rotary.fast, s.effects.rotary.stop ? 'Stopped' : s.effects.rotary.fast ? 'Fast' : 'Slow'),
    (s, v) => ({ ...s, effects: { ...s.effects, rotary: { ...s.effects.rotary, fast: Boolean(v) } } })),
  'rotary-drive': binding((s) => describe(s.effects.rotary.drive, levelText(s.effects.rotary.drive)),
    (s, v) => ({ ...s, effects: { ...s.effects, rotary: { ...s.effects.rotary, drive: Number(v) } } })),
}

for (const layer of ['A', 'B'] as const) {
  const prefix = `piano-layer-${layer.toLowerCase()}`
  controls[`${prefix}-on`] = binding((s) => describe(s.layers[layer].on),
    (s, v, shift) => shift ? focusLayer(s, layer) : v ? focusLayer(setLayer(s, layer, { on: true }), layer) : setLayer(s, layer, { on: false }))
  controls[`${prefix}-focus`] = binding((s) => describe(s.focus === layer), (s) => focusLayer(s, layer))
  controls[`${prefix}-level`] = binding((s) => describe(s.layers[layer].level, levelText(s.layers[layer].level, 12)),
    (s, v) => setLayer(s, layer, { level: Number(v) }))
}
Object.assign(controls, engineBindings)

export const boundControlIds = new Set(Object.keys(controls))

export function panelValue(state: Settings, id: string) {
  return controls[id]?.read(state)
}

export function panelUpdate(state: Settings, id: string, value: Value, shift: boolean) {
  return controls[id]?.write?.(state, value, shift)
}

export function tapDelay(state: Settings, bpm: number) {
  return editUnit({ ...state, effects: { ...state.effects, clockBpm: bpm } }, 'delay', { bpm })
}

export function panelLamp(state: Settings, id: string): boolean | undefined {
  const [name, value] = id.split(':')
  const piano = focused(state)
  const target = selectedTarget(state)
  const fxFocused = state.effects.focus === 'Piano'
  const fx = <K extends keyof Chain>(key: K) => effectiveUnit(state, target, key)
  switch (name) {
    case 'organ-model': return organState(state).model === value
    case 'organ-chorus': return organState(state).chorus === value
    case 'synth-unison': return synthState(state).voice.unison > 0
    case 'synth-lfo-target': return synthState(state).lfo.target === value
    case 'fx-synth': return state.effects.focus === 'Synth' && (state.effects.synthGroup || state.effects.synthLayer === value)
    case 'zone-organ': case 'zone-piano': case 'zone-synth': {
      const zone = name === 'zone-organ' ? organState(state).zone : name === 'zone-synth' ? synthState(state).zone : piano.zone
      const index = Number(value)
      return index <= splitPoints(state.splits).length && index >= zone[0] && index <= zone[1]
    }
    case 'piano-type': return piano.type === value
    case 'piano-timbre': return piano.timbre === value || (piano.timbre === 'Dyno 1' && value === 'Bright') ||
      (piano.timbre === 'Dyno 2' && value === 'Mid')
    case 'piano-touch': return piano.touch === value
    case 'piano-unison': return piano.unison === Number(value)
    case 'piano-dynamics': return piano.dynamics === Number(value)
    case 'piano-acoustic': return value === 'Soft' ? piano.softRelease && piano.type !== 'Clav'
      : piano.resonance && (piano.type === 'Grand' || piano.type === 'Upright')
    case 'piano-fx-focus': return fxFocused
    case 'fx-piano': return fxFocused && (state.effects.group || target === value as Layer)
    case 'fx-focus': return state.effects.focus === value
    case 'fx-mod1': return fx('mod1').type === value
    case 'fx-mod2': return fx('mod2').type === value
    case 'fx-delay-filter': return fx('delay').filter === value
    case 'fx-amp': return fx('amp').type === value
    case 'fx-reverb': return fx('reverb').type === value
    case 'fx-reverb-tone': return fx('reverb').tone === value
    case 'fx-global': return Boolean(state.effects.global[value as GlobalUnit])
    case 'rotary-slow': return !state.effects.rotary.stop && (state.effects.rotary.speed ?? Number(state.effects.rotary.fast)) < 0.5
    case 'rotary-fast': return !state.effects.rotary.stop && (state.effects.rotary.speed ?? Number(state.effects.rotary.fast)) >= 0.5
    default: return undefined
  }
}
