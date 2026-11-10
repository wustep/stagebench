/**
 * The sound state: everything the DSP kernel needs to know, as plain serialisable data.
 * The panel's canonical state (src/state) is reduced to this and posted to the audio host;
 * the kernel never sees a control ID, a focus, or a group flag.
 */

export type SampleSetId = 'grand' | 'upright' | 'electric'
export type RecipeId = 'basic' | 'clav-neck' | 'clav-bridge' | 'fm-piano' | 'vibraphone' | 'marimba'

export type SourceSpec = { kind: 'samples'; set: SampleSetId } | { kind: 'partials'; recipe: RecipeId }

/** Which timbre EQ table applies. */
export type TimbreFamily = 'acoustic' | 'electric'

export const Mod1Type = { APan: 0, Tremolo: 1, RingMod: 2, AWah: 3, Wah: 4, Pump: 5 } as const
export const Mod2Type = { Phaser: 0, Flanger: 1, Chorus: 2, Vibe: 3, Ensemble: 4, Spin: 5 } as const
export const AmpType = { Twin: 0, JC: 1, Small: 2, ToRotary: 3, LP24: 4, HP24: 5, EqOnly: 6 } as const
export const DelayFilter = { Off: 0, LP: 1, BP: 2, HP: 3 } as const
export const ReverbType = { Spring: 0, Booth: 1, Room: 2, Stage: 3, Hall: 4, Cathedral: 5 } as const
export const ReverbTone = { Off: 0, Bright: 1, Dark: 2 } as const
export const KbTouch = { Medium: 0, Light: 1, Heavy: 2 } as const
export const Timbre = { Off: 0, Soft: 1, Mid: 2, Bright: 3, Dyno1: 4, Dyno2: 5 } as const

export interface ModSound {
  on: boolean
  type: number
  /** 0..1 knob travel. */
  rate: number
  amount: number
}

export interface DelaySound {
  on: boolean
  /** Seconds between repeats. */
  time: number
  /** 0..1 knob travel. */
  feedback: number
  mix: number
  filter: number
  pingPong: boolean
}

export interface AmpSound {
  on: boolean
  type: number
  /** 0..1 knob travel. */
  drive: number
  /** dB, -15..15. */
  bass: number
  /** dB in EQ modes; resonance (mapped from -15..15) in the two filter modes. */
  mid: number
  /** 0..1 knob travel: 200 Hz..8 kHz as mid frequency, 60 Hz..18 kHz as filter cutoff. */
  freq: number
  treble: number
}

export interface CompSound {
  on: boolean
  amount: number
  fast: boolean
}

export interface ReverbSound {
  on: boolean
  type: number
  tone: number
  mix: number
}

export interface ChainSound {
  mod1: ModSound
  mod2: ModSound
  delay: DelaySound
  amp: AmpSound
  comp: CompSound
  reverb: ReverbSound
}

export interface LayerSound {
  /** The layer sounds: its own button is on and so is the Piano section. */
  on: boolean
  /** Fader travel, 0..1. */
  level: number
  octave: number
  source: SourceSpec
  family: TimbreFamily
  timbre: number
  kbTouch: number
  dynComp: number
  unison: number
  softRelease: boolean
  stringRes: boolean
  /** The sustain pedal reaches this layer (SUSTPED). */
  sustain: boolean
  /** Pitch-stick bend currently applied, semitones. */
  bend: number
  /** Keyboard zones this layer plays in: first and last zone, 0..3. */
  zone: ZoneRange
  fx: ChainSound
}

export interface RotarySound {
  fast: boolean
  /** Stop Mode: the slow position stops the rotors instead. */
  stop: boolean
  drive: number
  /**
   * Morphed rotor speed, 0 (slow, or stopped in Stop Mode) .. 1 (fast). When present it replaces
   * `fast`: the rotors head for a speed in between and still accelerate on the way there.
   */
  speed?: number
}

// ── Keyboard: zones, split points, transpose ──────────────────────────────────

/** First and last keyboard zone (0..3) a layer plays in. */
export type ZoneRange = [number, number]

export interface SplitPointSound {
  on: boolean
  /** First key of the upper side, MIDI note number. */
  note: number
  /** Crossfade width in semitones on each side of the point: 0, 6, or 12. */
  xfade: number
}

export interface KeyboardSound {
  /** Semitones added to every key, -6..6. */
  transpose: number
  /** Low, Mid, High. Point p separates zone p from zone p + 1. */
  points: [SplitPointSound, SplitPointSound, SplitPointSound]
}

/**
 * How loudly a layer assigned to `zone` plays `key`: 0 outside its zones, 1 inside, and in
 * between across a crossfade. A split point that is off bounds nothing: the zones on either
 * side of it are one zone.
 */
export function zoneGain(points: readonly SplitPointSound[], zone: readonly number[], key: number): number {
  let gain = 1
  for (let p = Math.min(2, zone[0] - 1); p >= 0; p -= 1) {
    const point = points[p]
    if (!point?.on) continue
    const w = point.xfade
    gain *= w > 0 ? Math.min(1, Math.max(0, (key - (point.note - w)) / (2 * w))) : key >= point.note ? 1 : 0
    break
  }
  for (let p = Math.max(0, zone[1]); p <= 2; p += 1) {
    const point = points[p]
    if (!point?.on) continue
    const w = point.xfade
    gain *= w > 0 ? Math.min(1, Math.max(0, (point.note + w - key) / (2 * w))) : key < point.note ? 1 : 0
    break
  }
  return gain
}

// ── Organ ─────────────────────────────────────────────────────────────────────

export const OrganModel = { B3: 0, Vox: 1, Farf: 2, Pipe1: 3, Pipe2: 4, B3Bass: 5 } as const
/** Vibrato/Chorus selector positions, in the order the panel button steps through them. */
export const VibType = { V1: 0, C1: 1, V2: 2, C2: 3, V3: 4, C3: 5 } as const

export interface OrganLayerSound {
  on: boolean
  /** Fader travel, 0..1. */
  level: number
  octave: number
  zone: ZoneRange
  model: number
  /** Nine drawbars, 0..8 each. */
  drawbars: number[]
  /** Vibrato/chorus on for this layer. */
  vibOn: boolean
  perc: { on: boolean; soft: boolean; fast: boolean; third: boolean }
}

export interface OrganSound {
  layers: [OrganLayerSound, OrganLayerSound]
  /** Selected vibrato/chorus type, shared by both layers. */
  vibType: number
  sustain: boolean
  bend: number
  /** The Rotary Speaker's Organ button: the organ plays through the shared rotor. */
  toRotary: boolean
  /** The one effect chain both organ layers share. */
  fx: ChainSound
}

// ── Synth ─────────────────────────────────────────────────────────────────────

/** Oscillator waveforms, in catalog order (src/synth/catalog.ts). */
export const SynthWave = {
  Sine: 0,
  Triangle: 1,
  Saw: 2,
  Square: 3,
  Pulse33: 4,
  Pulse10: 5,
  Noise: 6,
  SyncSaw: 7,
  SyncSquare: 8,
  MultiSaw: 9,
  MultiSawOct: 10,
  SuperSaw: 11,
  SuperSquare: 12,
  Fm2Op: 13,
} as const
export const FilterType = { LP12: 0, LP24: 1, HP: 2, BP: 3 } as const
export const LfoWave = { Triangle: 0, SawDown: 1, SawUp: 2, Square: 3, SampleHold: 4 } as const
export const LfoDest = { Off: 0, Pitch: 1, Ctrl: 2, Filter: 3 } as const
export const VoiceMode = { Poly: 0, Mono: 1, Legato: 2 } as const
export const NotePriority = { Last: 0, Low: 1, High: 2 } as const
export const VibratoMode = { Off: 0, On: 1, Delay: 2, Wheel: 3, Pedal: 4 } as const
export const ArpMode = { Arp: 0, Gate: 1, Poly: 2 } as const
export const ArpDirection = { Up: 0, Down: 1, UpDown: 2, Random: 3 } as const

export interface EnvelopeSound {
  /** Seconds. */
  attack: number
  decay: number
  release: number
  /** Decay at maximum: the envelope holds at full level while the key is down. */
  sustain: boolean
}

export interface SynthLayerSound {
  on: boolean
  level: number
  octave: number
  zone: ZoneRange
  osc: {
    wave: number
    /** Osc Ctrl knob travel, 0..1. */
    ctrl: number
    /** Semitones, -24..24. */
    coarse: number
    /** Cents, -50..50. */
    fine: number
  }
  oscEnv: EnvelopeSound & {
    /** Bipolar amount, -1..1. */
    amount: number
    velocity: boolean
    /** Env To Pitch: the envelope bends the pitch instead of moving Osc Ctrl. */
    toPitch: boolean
  }
  filter: {
    on: boolean
    type: number
    /** Knob travel, 0..1. */
    freq: number
    res: number
    envAmt: number
    /** Keyboard tracking: 0, 1/3, 2/3, or 1. */
    track: number
    /** Drive level, 0..3. */
    drive: number
  }
  filterEnv: EnvelopeSound & { velocity: boolean }
  ampEnv: EnvelopeSound & {
    /** Velocity sensitivity level, 0..3. */
    velocity: number
  }
  lfo: {
    wave: number
    dest: number
    /** Cycles per second (already resolved from the knob or the Master Clock). */
    rate: number
    /** Knob travel, 0..1. */
    amount: number
  }
  voice: {
    mode: number
    priority: number
    /** Knob travel, 0..1. Zero is no glide. */
    glide: number
    unison: number
    vibrato: number
    /** Hz, 2..8. */
    vibRate: number
    /** 0..1. */
    vibAmount: number
  }
  arp: {
    run: boolean
    mode: number
    /** Steps per second (already resolved from the knob or the Master Clock). */
    rate: number
    /** Octaves, 1..4, in Arp and Poly modes. */
    range: number
    /** Gate envelope hardness, 0..1, in Gate mode. */
    hardness: number
    direction: number
    /** KB Sync: playing from silence restarts the pattern and the LFO. */
    kbSync: boolean
  }
  fx: ChainSound
}

export interface SynthSound {
  layers: [SynthLayerSound, SynthLayerSound, SynthLayerSound]
  sustain: boolean
  bend: number
  /** KB Hold: notes stay down after the keys are lifted. */
  hold: boolean
  /** Modulation wheel and control pedal positions, 0..1, for the Wheel and Pedal vibrato modes. */
  wheel: number
  pedal: number
}

export interface SoundState {
  /** Master Level knob travel, 0..1. */
  master: number
  /** Layer Effects On: when false every effect unit and the Rotary are bypassed. */
  fxOn: boolean
  /** The two Piano layers. */
  layers: [LayerSound, LayerSound]
  rotary: RotarySound
  organ: OrganSound
  synth: SynthSound
  keyboard: KeyboardSound
}

/** Piano layers. */
export const LAYER_COUNT = 2
export const ORGAN_LAYER_COUNT = 2
export const SYNTH_LAYER_COUNT = 3
/** Effect chains: Piano A, Piano B, Organ (shared by its two layers), Synth A, Synth B, Synth C. */
export const CHAIN_COUNT = 6
export const Chain = { PianoA: 0, PianoB: 1, Organ: 2, SynthA: 3, SynthB: 4, SynthC: 5 } as const

/** Delay Tempo knob (0..1) to seconds: 20 ms .. 1.5 s, exponential. */
export const DELAY_MIN_SECONDS = 0.02
export const DELAY_MAX_SECONDS = 1.5
export function delayKnobToSeconds(knob: number): number {
  return DELAY_MIN_SECONDS * Math.pow(DELAY_MAX_SECONDS / DELAY_MIN_SECONDS, Math.min(1, Math.max(0, knob)))
}
export function delaySecondsToKnob(seconds: number): number {
  const clamped = Math.min(DELAY_MAX_SECONDS, Math.max(DELAY_MIN_SECONDS, seconds))
  return Math.log(clamped / DELAY_MIN_SECONDS) / Math.log(DELAY_MAX_SECONDS / DELAY_MIN_SECONDS)
}

/** Mid-band centre frequency for a 0..1 knob: 200 Hz .. 8 kHz, as printed on the panel. */
export function midFrequency(knob: number): number {
  return 200 * Math.pow(40, Math.min(1, Math.max(0, knob)))
}
/** Cutoff of the LP24/HP24 filters for the same knob: 60 Hz .. 18 kHz. */
export function filterFrequency(knob: number): number {
  return 60 * Math.pow(300, Math.min(1, Math.max(0, knob)))
}
/** Mod 1 / Mod 2 LFO rates in Hz for a 0..1 knob. */
export function mod1Rate(knob: number): number {
  return 0.1 * Math.pow(2, 7 * knob)
}
export function mod2Rate(knob: number): number {
  return 0.05 * Math.pow(2, 7.6 * knob)
}
/** Ring-modulator sine pitch in Hz for the Rate knob. */
export function ringFrequency(knob: number): number {
  return 30 * Math.pow(2, 7 * knob)
}
/** Master Level knob travel to linear gain: silent at zero, 0.7 at the reference position 7. */
export function masterGain(knob: number): number {
  const k = Math.min(1, Math.max(0, knob))
  return (k * k * 0.7) / 0.49
}
/** Layer fader travel to linear gain. */
export function layerGain(level: number): number {
  const k = Math.min(1, Math.max(0, level))
  return k * k
}


// ── Synth and clock conversions (panel units → what the kernel needs) ─────────

/** Envelope dials move in steps; the last decay step is "sustain". */
export const ENV_STEPS = 40
/** Attack time for a dial step: 0.5 ms .. 10 s. */
export function attackSeconds(step: number): number {
  return 0.0005 * Math.pow(20000, clampStep(step) / ENV_STEPS)
}
/** Decay and release time for a dial step: 3 ms .. 20 s. */
export function decaySeconds(step: number): number {
  return 0.003 * Math.pow(20000 / 3, clampStep(step) / ENV_STEPS)
}
function clampStep(step: number): number {
  return Math.min(ENV_STEPS, Math.max(0, step))
}
/** Synth LFO rate for a 0..10 knob: 0.05 Hz .. 20 Hz. */
export function lfoRate(knob: number): number {
  return 0.05 * Math.pow(400, Math.min(10, Math.max(0, knob)) / 10)
}
/** Arpeggiator tempo for a 0..10 knob, in quarter-note BPM: 30 .. 300. It plays eighth notes. */
export function arpBpm(knob: number): number {
  return 30 * Math.pow(10, Math.min(10, Math.max(0, knob)) / 10)
}
/** Arpeggiator range in octaves for the Range knob: 1 at "1" on the scale, 4 at "4". */
export function arpOctaves(knob: number): number {
  return Math.min(4, Math.max(1, Math.round(1 + (knob - 2.56) / 1.63)))
}

/** Subdivisions of the Master Clock a synced rate knob steps through, in quarter-note beats. */
export const CLOCK_DIVISIONS = [
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16T', beats: 1 / 6 },
] as const
/** The subdivision a 0..10 knob selects when it is locked to the Master Clock. */
export function clockDivision(knob: number): (typeof CLOCK_DIVISIONS)[number] {
  const index = Math.round((Math.min(10, Math.max(0, knob)) / 10) * (CLOCK_DIVISIONS.length - 1))
  return CLOCK_DIVISIONS[index]
}
/** Seconds one subdivision lasts at a tempo. */
export function divisionSeconds(beats: number, bpm: number): number {
  return (beats * 60) / Math.min(300, Math.max(30, bpm))
}
/** The Mod 1 Rate knob position (0..1, may run past either end) whose LFO runs at `hz`. */
export function mod1KnobForRate(hz: number): number {
  return Math.log2(hz / 0.1) / 7
}

export function defaultChain(): ChainSound {
  return {
    mod1: { on: false, type: Mod1Type.Pump, rate: 0.32, amount: 0.65 },
    mod2: { on: false, type: Mod2Type.Chorus, rate: 0.63, amount: 0.3 },
    delay: { on: false, time: delayKnobToSeconds(0.3), feedback: 0.65, mix: 0.2, filter: DelayFilter.LP, pingPong: false },
    amp: { on: false, type: AmpType.Twin, drive: 0.32, bass: 6, mid: 8, freq: 0.52, treble: 1 },
    comp: { on: false, amount: 0.22, fast: false },
    reverb: { on: false, type: ReverbType.Cathedral, tone: ReverbTone.Off, mix: 0.65 },
  }
}

export function defaultLayer(on: boolean, level: number): LayerSound {
  return {
    on,
    level,
    octave: 0,
    source: { kind: 'samples', set: 'grand' },
    family: 'acoustic',
    timbre: Timbre.Off,
    kbTouch: KbTouch.Medium,
    dynComp: 0,
    unison: 0,
    softRelease: false,
    stringRes: true,
    sustain: true,
    bend: 0,
    zone: [0, 3],
    fx: defaultChain(),
  }
}

export function defaultOrganLayer(on: boolean, level: number): OrganLayerSound {
  return {
    on,
    level,
    octave: 0,
    zone: [0, 3],
    model: OrganModel.B3,
    drawbars: [8, 6, 8, 4, 3, 3, 6, 3, 5],
    vibOn: true,
    perc: { on: false, soft: false, fast: true, third: true },
  }
}

export function defaultSynthLayer(on: boolean, level: number): SynthLayerSound {
  return {
    on,
    level,
    octave: 0,
    zone: [0, 3],
    osc: { wave: SynthWave.Saw, ctrl: 0.35, coarse: 0, fine: 0 },
    oscEnv: { attack: attackSeconds(0), decay: decaySeconds(20), release: decaySeconds(12), sustain: false, amount: 0.3, velocity: false, toPitch: false },
    filter: { on: true, type: FilterType.LP24, freq: 0.35, res: 0.52, envAmt: 0.55, track: 1, drive: 0 },
    filterEnv: { attack: attackSeconds(0), decay: decaySeconds(24), release: decaySeconds(18), sustain: false, velocity: false },
    ampEnv: { attack: attackSeconds(4), decay: decaySeconds(ENV_STEPS), release: decaySeconds(16), sustain: true, velocity: 2 },
    lfo: { wave: LfoWave.Triangle, dest: LfoDest.Off, rate: lfoRate(3.5), amount: 0.65 },
    voice: { mode: VoiceMode.Poly, priority: NotePriority.Last, glide: 0.7, unison: 2, vibrato: VibratoMode.Off, vibRate: 5.5, vibAmount: 0.5 },
    arp: { run: false, mode: ArpMode.Arp, rate: (arpBpm(6.5) / 60) * 2, range: arpOctaves(5), hardness: 0.5, direction: ArpDirection.Up, kbSync: false },
    fx: defaultChain(),
  }
}

export function defaultKeyboard(): KeyboardSound {
  return {
    transpose: 0,
    points: [
      { on: false, note: 48, xfade: 0 },
      { on: false, note: 60, xfade: 0 },
      { on: false, note: 72, xfade: 0 },
    ],
  }
}

/** The state the kernel starts in; src/state derives exactly this from its initial panel state. */
export function defaultSoundState(): SoundState {
  return {
    master: 0.7,
    fxOn: true,
    layers: [defaultLayer(true, 1), defaultLayer(false, 0.42)],
    rotary: { fast: false, stop: false, drive: 0.15 },
    organ: {
      layers: [defaultOrganLayer(false, 1), defaultOrganLayer(false, 0.5)],
      vibType: VibType.C3,
      sustain: false,
      bend: 0,
      toRotary: false,
      fx: defaultChain(),
    },
    synth: {
      layers: [defaultSynthLayer(false, 1), defaultSynthLayer(false, 0.25), defaultSynthLayer(false, 0.67)],
      sustain: true,
      bend: 0,
      hold: false,
      wheel: 0,
      pedal: 0,
    },
    keyboard: defaultKeyboard(),
  }
}

// ── Sample data handed to the kernel ──────────────────────────────────────────

export interface SampleZone {
  lo: number
  hi: number
  root: number
  /** Cents the recording is off its root. */
  tune: number
  /** Linear gain that brings the recording to the library's reference level. */
  gain: number
  rate: number
  data: Int16Array
}

export interface SampleLayer {
  /** Highest velocity (0..1) this layer serves. */
  maxVelocity: number
  zones: SampleZone[]
}

export interface SampleSet {
  id: SampleSetId
  layers: SampleLayer[]
}
