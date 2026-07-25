import { control } from '../model/controls'
import { timbreIsAvailable } from '../audio/pianoTypes'
import { ORGAN_MODEL_IDS, VIB_CHORUS_IDS, type OrganModelId, type VibChorusId } from '../audio/organVoice'
import { OSC_CATEGORIES } from '../audio/synthVoice'
import {
  FULL_ZONE,
  LAYER_KEYS,
  ORGAN_LAYER_IDS,
  SYNTH_LAYER_IDS,
  type AmpType,
  type ArpDirection,
  type ArpMode,
  type ChainSettings,
  type DelayFilterId,
  type EngineSettings,
  type KbTouchId,
  type LayerId,
  type LayerKey,
  type LayerSettings,
  type LfoDestination,
  type LfoWaveform,
  type Mod1Type,
  type Mod2Type,
  type NotePriority,
  type OrganLayerId,
  type OrganLayerSettings,
  type OscCategory,
  type ReverbToneId,
  type ReverbType,
  type RotarySpeedId,
  type SynthFilterType,
  type SynthLayerId,
  type SynthLayerSettings,
  type SynthMode,
  type TimbreId,
  type VibratoMode,
  type VoiceMode,
  type ZoneSettings,
} from '../audio/settings'
import {
  VIBRATO_PRESETS,
  focusedLayerOf,
  layerTypeId,
  morphedValues,
  scopeOf,
  transposeActive,
  type DeckState,
  type HardwareValues,
} from './hardware'
import { LAYER_SCOPED_IDS } from './hardware'
import type { FxSection } from './program'

/**
 * The pure mapping from panel values to engine settings.
 *
 * Everything the engine does is a function of this output, so a test can prove that a control,
 * the canonical state and the rendered audio agree — and that a control which is *not* mapped
 * here really is inert. Morph sources are applied first: `morphedValues` interpolates every
 * assigned destination at the source's current position, so a morph reaches the engine through
 * exactly the same path a hand on the knob would.
 */

const MOD1_TYPES: readonly Mod1Type[] = ['apan', 'tremolo', 'ringmod', 'awah', 'wah', 'pump']
const MOD2_TYPES: readonly Mod2Type[] = ['chorus', 'flanger', 'phaser', 'vibe', 'ensemble', 'spin']
const AMP_TYPES: readonly AmpType[] = ['twin', 'jc', 'small', 'rotary', 'lp24', 'hp24']
const DELAY_FILTERS: readonly DelayFilterId[] = ['lp', 'bp', 'hp']
const REVERB_TYPES: readonly ReverbType[] = ['room', 'booth', 'spring', 'stage', 'hall', 'cathedral']
const REVERB_TONES: readonly ReverbToneId[] = ['normal', 'bright', 'dark']
const KB_TOUCH: readonly KbTouchId[] = ['normal', 'heavy', 'medium', 'light']
const TIMBRES: readonly TimbreId[] = ['off', 'soft', 'mid', 'bright', 'dyno1', 'dyno2']
const ROTARY_SPEEDS: readonly RotarySpeedId[] = ['slow', 'fast', 'morph']
const SYNTH_MODES: readonly SynthMode[] = ['samples', 'analog', 'extern']
const SYNTH_FILTERS: readonly SynthFilterType[] = ['lp12', 'lp24', 'lphp', 'bp', 'hp', 'lpm']
/** Exactly the five waveforms the synth spec requires, in printed panel order. */
const LFO_WAVEFORMS: readonly LfoWaveform[] = ['triangle', 'sawdown', 'sawup', 'square', 'sh']
const LFO_DESTINATIONS: readonly LfoDestination[] = ['off', 'pitch', 'ctrl', 'filter']
const VOICE_MODES: readonly VoiceMode[] = ['poly', 'mono', 'legato']
const PRIORITIES: readonly NotePriority[] = ['off', 'low', 'high']
const ARP_MODES: readonly ArpMode[] = ['poly', 'arp', 'gate']
const ARP_DIRECTIONS: readonly ArpDirection[] = ['up', 'down', 'updown', 'random']
/** Printed vibrato source positions. "Delayed" is the always-on mode with a delayed onset. */
const VIBRATO_MODES: readonly VibratoMode[] = ['off', 'wheel', 'on', 'aftertouch', 'pedal']
/** Printed EQ mid-frequency positions, in Hz (`fx.amp.freq`, 0–8). */
export const EQ_MID_FREQUENCIES: readonly number[] = [200, 250, 400, 600, 1000, 2000, 4000, 6000, 8000]

function pick<T>(options: readonly T[], value: number | undefined, fallback: T): T {
  const index = Math.round(value ?? -1)
  return options[index] ?? fallback
}

function unit(value: number | undefined, max = 10): number {
  // Rounded so the panel's stepped values map to clean numbers instead of float dust.
  const scaled = Math.min(1, Math.max(0, (value ?? 0) / max))
  return Math.round(scaled * 1e6) / 1e6
}

function on(value: number | undefined): boolean {
  return (value ?? 0) >= 0.5
}

function chainFrom(bank: HardwareValues): ChainSettings {
  return {
    mod1: {
      on: on(bank['fx.mod1.on']),
      type: pick(MOD1_TYPES, bank['fx.mod1.type'], 'apan'),
      rate: unit(bank['fx.mod1.rate']),
      amount: unit(bank['fx.mod1.amount']),
    },
    mod2: {
      on: on(bank['fx.mod2.on']),
      type: pick(MOD2_TYPES, bank['fx.mod2.type'], 'chorus'),
      rate: unit(bank['fx.mod2.rate']),
      amount: unit(bank['fx.mod2.amount']),
    },
    delay: {
      on: on(bank['fx.delay.on']),
      tempo: unit(bank['fx.delay.tempo']),
      feedback: unit(bank['fx.delay.feedback']),
      mix: unit(bank['fx.delay.dry-wet']),
      filter: pick(DELAY_FILTERS, bank['fx.delay.filter'], 'lp'),
    },
    amp: {
      on: on(bank['fx.amp.on']),
      type: pick(AMP_TYPES, bank['fx.amp.type'], 'twin'),
      drive: unit(bank['fx.amp.drive']),
      bass: bank['fx.amp.bass'] ?? 0,
      mid: bank['fx.amp.mid'] ?? 0,
      treble: bank['fx.amp.treble'] ?? 0,
      midFrequency: EQ_MID_FREQUENCIES[Math.round(bank['fx.amp.freq'] ?? 4)] ?? 1000,
    },
    compressor: {
      on: on(bank['fx.comp.on']),
      amount: unit(bank['fx.comp.amount']),
    },
    reverb: {
      on: on(bank['fx.reverb.on']),
      type: pick(REVERB_TYPES, bank['fx.reverb.type'], 'room'),
      mix: unit(bank['fx.reverb.dry-wet']),
      tone: pick(REVERB_TONES, bank['fx.reverb.tone'], 'normal'),
    },
  }
}

/**
 * One layer's complete view of the panel: its stored bank, with the live panel values overlaid
 * for whichever parts of the panel it currently has focus of.
 */
function viewFor(deck: DeckState, values: HardwareValues, key: LayerKey): HardwareValues {
  const [section, layer] = key.split('.') as [FxSection, string]
  const view: Record<string, number> = { ...values, ...deck.banks[key] }
  const sectionFocused = focusedLayerOf(deck, section) === layer
  const fxFocused = sectionFocused && deck.fxSection === section
  for (const id of LAYER_SCOPED_IDS) {
    const scope = scopeOf(id)
    if (scope === 'fx' ? fxFocused : scope === section && sectionFocused) view[id] = values[id]
  }
  return view
}

function layerFrom(deck: DeckState, values: HardwareValues, id: LayerId): LayerSettings {
  const bank = viewFor(deck, values, `piano.${id}` as LayerKey)
  const type = layerTypeId(bank)
  const acoustics = Math.round(bank['piano.acoustics'] ?? 0)
  const timbre = pick(TIMBRES, bank['piano.timbre'], 'off')
  const modelSpec = control('piano.model')
  return {
    enabled: on(values[`piano.${id}.on`]),
    level: unit(values[`piano.${id}.level`]),
    octave: deck.octaves[id],
    sustainPedal: on(bank['piano.sustped']),
    // The pitch stick bends the Synth section only; the piano indicator is declared unsupported.
    pitchStick: false,
    type,
    model: Math.min(Math.max(0, Math.round(bank['piano.model'] ?? 0)), modelSpec.max),
    timbre: timbreIsAvailable(type, timbre) ? timbre : 'off',
    unison: Math.round(bank['piano.unison'] ?? 0) as 0 | 1 | 2 | 3,
    kbTouch: pick(KB_TOUCH, bank['piano.kb-touch'], 'normal'),
    dynComp: Math.round(bank['piano.dyn-comp'] ?? 0) as 0 | 1 | 2 | 3,
    softRelease: acoustics === 1 || acoustics === 3,
    stringRes: acoustics === 2 || acoustics === 3,
    chain: chainFrom(bank),
  }
}

/* ------------------------------------------------------------------ organ */

function organLayerFrom(deck: DeckState, values: HardwareValues, id: OrganLayerId): OrganLayerSettings {
  const bank = viewFor(deck, values, `organ.${id}` as LayerKey)
  const drawbars = Array.from({ length: 9 }, (_, index) => Math.round(bank[`organ.drawbar.${index + 1}`] ?? 0))
  return {
    enabled: on(values[`organ.${id}.on`]),
    level: unit(values[`organ.${id}.level`]),
    octave: deck.organOctaves[id],
    // The Organ section's SUSTPED indicator is unlit: the organ does not answer the sustain
    // pedal in this build, and the audit says so rather than the panel implying otherwise.
    sustainPedal: false,
    model: pick<OrganModelId>(ORGAN_MODEL_IDS, bank['organ.model'], 'b3'),
    drawbars,
    percussion: {
      on: on(bank['organ.perc.on']),
      soft: on(bank['organ.perc.volume']),
      fast: on(bank['organ.perc.decay']),
      third: on(bank['organ.perc.harmonic']),
    },
    vibratoOn: on(bank['organ.vibchorus.on']),
  }
}

/* ------------------------------------------------------------------ synth */

function synthLayerFrom(deck: DeckState, values: HardwareValues, id: SynthLayerId): SynthLayerSettings {
  const bank = viewFor(deck, values, `synth.${id}` as LayerKey)
  const menu = deck.menu[id]
  const extra = deck.synthExtra[id]
  const category: OscCategory = OSC_CATEGORIES[Math.min(OSC_CATEGORIES.length - 1, Math.max(0, menu.osc[1]))]
  const vibratoMode = pick(VIBRATO_MODES, bank['synth.vibrato.source'], 'off')
  const preset = VIBRATO_PRESETS[Math.min(VIBRATO_PRESETS.length - 1, Math.max(0, extra.vibratoPreset))]
  const wheel = Math.min(1, Math.max(0, values['perf.mod-wheel'] ?? 0))
  const pedal = Math.min(1, Math.max(0, deck.pedal))
  const vibratoScale = vibratoMode === 'wheel' ? wheel : vibratoMode === 'pedal' ? pedal : 1
  return {
    enabled: on(values[`synth.${id}.on`]),
    level: unit(values[`synth.${id}.level`]),
    octave: deck.synthOctaves[id],
    sustainPedal: true,
    mode: pick(SYNTH_MODES, bank['synth.mode'], 'analog'),
    category,
    waveform: Math.max(0, Math.round(menu.osc[2])),
    oscCtrl: unit(bank['synth.osc.ctrl']),
    oscEnv: {
      attack: unit(menu.oscEnv[0]),
      decay: unit(menu.oscEnv[1]),
      release: unit(menu.oscEnv[2]),
      amount: Math.max(-1, Math.min(1, (bank['synth.osc.env-amt'] ?? 0) / 10)),
      velocity: extra.oscEnvVelocity === 1,
      toPitch: on(bank['synth.osc.pitch-smp']),
    },
    filter: {
      on: on(bank['synth.filter.on']),
      type: pick(SYNTH_FILTERS, bank['synth.filter.type'], 'lp12'),
      freq: unit(bank['synth.filter.freq']),
      res: unit(bank['synth.filter.res']),
      envAmount: unit(bank['synth.filter.env-amt']),
      tracking: extra.tracking,
      drive: Math.max(0, Math.round(menu.osc[0])),
      env: {
        attack: unit(menu.filterEnv[0]),
        decay: unit(menu.filterEnv[1]),
        release: unit(menu.filterEnv[2]),
        velocity: extra.filterEnvVelocity === 1,
      },
    },
    amp: {
      attack: unit(menu.ampEnv[0]),
      decay: unit(menu.ampEnv[1]),
      release: unit(menu.ampEnv[2]),
      velocity: Math.min(3, Math.max(0, extra.ampVelocity)) as 0 | 1 | 2 | 3,
    },
    lfo: {
      waveform: pick(LFO_WAVEFORMS, bank['synth.lfo.waveform'], 'triangle'),
      rate: unit(bank['synth.lfo.rate']),
      amount: unit(bank['synth.lfo.mod-amt']),
      destination: pick(LFO_DESTINATIONS, bank['synth.lfo.destination'], 'off'),
      clockSync: extra.lfoSync === 1,
    },
    voice: {
      mode: pick(VOICE_MODES, bank['synth.voice.mode'], 'poly'),
      priority: pick(PRIORITIES, extra.priority, 'off'),
      glide: unit(bank['synth.voice.glide']),
      unison: Math.round(bank['synth.unison'] ?? 0) as 0 | 1 | 2 | 3,
      vibrato: { mode: vibratoMode, rate: preset.rate, amount: preset.amount * vibratoScale },
    },
    arp: {
      mode: pick(ARP_MODES, bank['synth.arp.mode'], 'poly'),
      rate: unit(bank['synth.arp.rate']),
      range: Math.round(bank['synth.arp.range'] ?? 2),
      direction: pick(ARP_DIRECTIONS, extra.arpDirection, 'up'),
      hold: on(bank['synth.kb-hold']),
      run: on(bank['synth.arp-run']),
      clockSync: extra.arpSync === 1,
    },
    chain: chainFrom(bank),
  }
}

/* ------------------------------------------------------------------ zones */

/** The enabled split points, low to high. Three points give up to four zones. */
export function orderedSplitPoints(deck: DeckState) {
  if (!deck.split.on) return []
  return deck.split.points.filter((point) => point.enabled).sort((a, b) => a.note - b.note)
}

export function zoneSettingsFor(deck: DeckState, key: LayerKey): ZoneSettings {
  const points = orderedSplitPoints(deck)
  if (points.length === 0) return FULL_ZONE
  const count = points.length + 1
  const assigned = deck.zones[key]
  const from = Math.min(count - 1, Math.max(0, assigned.from))
  const to = Math.min(count - 1, Math.max(from, assigned.to))
  return {
    low: from === 0 ? 0 : points[from - 1].note,
    high: to === count - 1 ? 127 : points[to].note - 1,
    fadeLow: from === 0 ? 0 : points[from - 1].crossfade,
    fadeHigh: to === count - 1 ? 0 : points[to].crossfade,
  }
}

/* ------------------------------------------------------------------ top level */

export function deriveSettings(deck: DeckState): EngineSettings {
  const values = morphedValues(deck)
  const zones = {} as Record<LayerKey, ZoneSettings>
  for (const key of LAYER_KEYS) zones[key] = zoneSettingsFor(deck, key)
  const organLayers = {} as Record<OrganLayerId, OrganLayerSettings>
  for (const id of ORGAN_LAYER_IDS) organLayers[id] = organLayerFrom(deck, values, id)
  const synthLayers = {} as Record<SynthLayerId, SynthLayerSettings>
  for (const id of SYNTH_LAYER_IDS) synthLayers[id] = synthLayerFrom(deck, values, id)
  const wheel = Math.min(1, Math.max(0, values['perf.mod-wheel'] ?? 0))
  const stopMode = Math.round(values['perf.rotary.stop-mode'] ?? 0)

  return {
    masterLevel: unit(values['perf.master-level']),
    sectionOn: on(values['piano.section-on']),
    effectsOn: on(values['fx.section-on']),
    layers: { a: layerFrom(deck, values, 'a'), b: layerFrom(deck, values, 'b') },
    rotary: {
      speed: pick(ROTARY_SPEEDS, values['perf.rotary.speed'], 'slow'),
      drive: unit(values['perf.rotary.drive']),
      morph: wheel,
      stopMode: stopMode >= 1,
      stopAngle: stopMode === 2,
      closeMic: Math.round(values['perf.rotary.source'] ?? 0) === 1,
    },
    organ: {
      sectionOn: on(values['organ.section-on']),
      vibChorus: pick<VibChorusId>(VIB_CHORUS_IDS, values['organ.vibchorus.type'], 'v1'),
      layers: organLayers,
      // Both organ layers share one chain; the focused layer's bank is what the panel edits.
      chain: chainFrom(viewFor(deck, values, `organ.${deck.organFocus}` as LayerKey)),
      // The organ always feeds the shared rotary speaker, as it does on the instrument; the
      // source button chooses the microphone perspective rather than switching the feed off.
      toRotary: true,
    },
    synth: {
      sectionOn: on(values['synth.section-on']),
      layers: synthLayers,
    },
    clock: { bpm: deck.clock.bpm, keyboardSync: deck.clock.keyboardSync },
    transpose: transposeActive(deck) ? deck.transpose : 0,
    zones,
    pitchBend: (values['perf.pitch-stick'] ?? 0) * 2,
  }
}
