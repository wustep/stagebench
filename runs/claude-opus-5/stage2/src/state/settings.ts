import { control } from '../model/controls'
import { timbreIsAvailable } from '../audio/pianoTypes'
import type {
  AmpType,
  ChainSettings,
  DelayFilterId,
  EngineSettings,
  KbTouchId,
  LayerId,
  LayerSettings,
  Mod1Type,
  Mod2Type,
  ReverbToneId,
  ReverbType,
  RotarySpeedId,
  TimbreId,
} from '../audio/settings'
import { layerTypeId, type DeckState, type HardwareValues } from './hardware'

/**
 * The pure mapping from panel values to engine settings.
 *
 * Everything the engine does is a function of this output, so a test can prove that a control,
 * the canonical state and the rendered audio agree — and that a control which is *not* mapped
 * here really is inert.
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

function layerFrom(deck: DeckState, id: LayerId): LayerSettings {
  // The focused layer's live panel values; the other layer's stored bank.
  const bank = id === deck.focus ? deck.values : { ...deck.values, ...deck.banks[id] }
  const type = layerTypeId(bank)
  const acoustics = Math.round(bank['piano.acoustics'] ?? 0)
  const timbre = pick(TIMBRES, bank['piano.timbre'], 'off')
  const modelSpec = control('piano.model')
  return {
    enabled: on(deck.values[`piano.${id}.on`]),
    level: unit(deck.values[`piano.${id}.level`]),
    octave: deck.octaves[id],
    sustainPedal: on(bank['piano.sustped']),
    // The pitch stick does not bend any section yet; the indicator is declared unsupported.
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

export function deriveSettings(deck: DeckState): EngineSettings {
  return {
    masterLevel: unit(deck.values['perf.master-level']),
    sectionOn: on(deck.values['piano.section-on']),
    effectsOn: on(deck.values['fx.section-on']),
    layers: { a: layerFrom(deck, 'a'), b: layerFrom(deck, 'b') },
    rotary: {
      speed: pick(ROTARY_SPEEDS, deck.values['perf.rotary.speed'], 'slow'),
      drive: unit(deck.values['perf.rotary.drive']),
    },
  }
}
