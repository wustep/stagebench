import type {
  AssetBoundary,
  AudioBoundary,
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  SampleData,
  WaveShaperNodeLike,
} from './boundaries'
import {
  getInstrument,
  getSynthSampleSet,
  nearestSynthZone,
  nearestZones,
  SYNTH_SAMPLE_SETS,
  velocityLayerGains,
  type InstrumentSpec,
  type SampleZone,
} from './library'
import {
  createAmpEq,
  createComp,
  createDelay,
  createMod1,
  createMod2,
  createReverb,
  createRotary,
  createScanner,
  type EffectUnit,
  type RotaryUnit,
  type ScannerState,
} from './effects'
import { drawbarPartialGain, ORGAN_MODEL_RECIPES } from './organ-models'
import {
  FM_INHARMONIC_RATIO,
  fmModulationIndex,
  multiDetuneCents,
  oscCtrlActiveFor,
  pulse10Wave,
  pulse33Wave,
  shapeFoldCurve,
  shapeFoldDriveGain,
  shapePulseDuty,
  shapePulseWave,
  subOscGain,
  superDetuneCents,
  syncPeakHarmonic,
  syncWave,
  waveFormantWave,
  waveOrganWave,
} from './synth-oscillators'
import {
  initialInstrumentState,
  mappings,
  SYNTH_LAYER_IDS,
  SYNTH_WAVEFORMS,
  selectedInstrumentId,
  timbreListFor,
  zoneGainFor,
  type ArpPatternStep,
  type EffectChainState,
  type InstrumentState,
  type LayerId,
  type OrganModelId,
  type SynthLayerId,
  type SynthFilterType,
  type SynthLfoDestination,
  type SynthLfoWaveform,
} from '../state/instrument'

/**
 * Stage piano engine (Phase 2).
 *
 * One AudioContext. Notes enter reusable per-layer voice buses, flow through
 * per-layer timbre/dyn-comp shaping and the ordered effect chain
 * (Mod 1 → Mod 2 → Delay → Amp/EQ → Comp → Reverb), then either the single
 * Rotary Speaker instance (when routed via the Amp unit's To Rotary mode) or
 * directly into the master gain → limiter → one destination.
 *
 * Primary sound: bundled RECORDED sample sets (see src/audio/library.ts and
 * public/samples/SOURCES.md). The Phase 1 oscillator voice remains only as a
 * clearly labeled synthesized fallback after primary sample failure.
 */
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

export interface EngineStatusInfo {
  status: EngineStatus
  message: string
}

export type AllNotesOffReason = 'blur' | 'midi-disconnect' | 'unmount' | 'input-cleanup' | 'panic'

type VoiceSource =
  | { kind: 'sample'; node: AudioBufferSourceNodeLike; baseRate: number }
  /** `freqRatio` is the source's fixed multiple of the voice's fundamental
   *  (1 unless set): the Sub Osc square runs at 0.5x, FM-I's modulator at
   *  1.414x. A legato glide retargets `fundamental * freqRatio`, never the
   *  raw fundamental — gliding every source to the same Hz used to slam the
   *  sub up an octave and collapse FM-I's inharmonic ratio to 1:1. */
  | { kind: 'synth'; node: OscillatorNodeLike; baseDetune: number; freqRatio?: number }

export type SectionId = 'piano' | 'organ' | 'synth'
/** A layer id valid for the section it's paired with: A/B for piano and
 *  organ, A/B/C for synth (spec: three synth layers). */
export type VoiceLayer = LayerId | SynthLayerId

/** Live-updatable organ voice references: applyState retargets these gains
 *  when drawbars move while the note sounds (spec: drawbar movement changes
 *  the audible spectrum immediately). */
interface OrganVoiceLive {
  model: OrganModelId
  partials: Array<{ drawbar: number; level: number; gain: GainNodeLike }>
  voxMix: { dark: GainNodeLike; bright: GainNodeLike } | null
}

/** A detuned oscillator voice source retargeted live by Osc Ctrl: `source`
 *  is the same VoiceSource entry pitch-bend retargeting uses, so both stay
 *  consistent when its stored baseDetune is updated in place. */
interface LiveDetunedSource {
  source: VoiceSource & { kind: 'synth' }
}

/** Live-updatable synth voice references: applyState retargets these params
 *  when Osc Ctrl moves while the note sounds (spec knobs.oscCtrlKnob is
 *  "modulatable" — here it's simply live). Only the categories whose Osc
 *  Ctrl retargets a sounding voice populate a variant. Every variant also
 *  carries `oscCtrlParam`: a real AudioParam the LFO's "Osc Ctrl" destination
 *  and the non-toPitch oscillator envelope modulate at audio rate. FM-H uses
 *  its true modulation-index gain directly; the other three categories have
 *  no single linear AudioParam for their JS-computed Osc Ctrl math, so they
 *  share a declared-approximation gain summed into each oscillator's detune
 *  (a real, audible, audio-rate connection — not the literal per-category
 *  mechanism, honestly noted here and in IMPLEMENTATION_DETAILS.json). */
type SynthVoiceLive =
  | { kind: 'multi'; detuned: LiveDetunedSource[]; spreadDivisor: number; oscCtrlParam: AudioParamLike }
  | { kind: 'super'; detuned: LiveDetunedSource[]; oscCtrlParam: AudioParamLike }
  | { kind: 'fm'; modGain: AudioParamLike; carrierFrequency: number; oscCtrlParam: AudioParamLike }
  | { kind: 'sync'; square: boolean; oscillator: OscillatorNodeLike; peak: number; oscCtrlParam: AudioParamLike }
  // Optional-scope categories (spec.scope.optional):
  // Sub Osc's sub-oscillator gain follows Osc Ctrl directly (a real linear
  // AudioParam, not a declared detune approximation) — oscCtrlParam mirrors
  // subGain so the shared oscillator-envelope/LFO "Osc Ctrl" plumbing works.
  | { kind: 'sub'; subGain: AudioParamLike; oscCtrlParam: AudioParamLike }
  // Shape Pulse rebuilds its PeriodicWave on quantized ctrl steps exactly
  // like 'sync' above; oscCtrlParam is the same declared detune-summed
  // approximation gain the other non-FM-H categories use.
  | { kind: 'shapePulse'; oscillator: OscillatorNodeLike; duty: number; oscCtrlParam: AudioParamLike }
  // Shape Sine's fold amount is a LIVE pre-shaper drive gain (a real linear
  // AudioParam); the fold curve itself only rebuilds on quantized steps.
  | { kind: 'shapeFold'; driveGain: AudioParamLike; shaper: WaveShaperNodeLike; quantStep: number; oscCtrlParam: AudioParamLike }
  | null

/** Per-voice filter + drive stage (synth only): the source mix (`gain`)
 *  feeds `driveShaper` (bypassed at drive 0) into one or two cascaded biquad
 *  filters (LP24 = two lowpass stages in series; LP12/HP/BP = one stage),
 *  whose output replaces `gain` as the node that connects onward to the
 *  voice bus. `envBaseHz` is the keyboard-tracked base cutoff the filter
 *  envelope ramps away from and back to. */
interface SynthVoiceFilter {
  driveShaper: WaveShaperNodeLike
  filters: BiquadFilterNodeLike[]
  envBaseHz: number
  /** LP M's always-on fixed drive stage (declared ladder-style saturation),
   *  present only when the filter type is 'LP M'; distinct from driveShaper
   *  (the user-facing Drive knob's stage, which stays independently gated). */
  lpMPreShaper: WaveShaperNodeLike | null
}

interface Voice {
  section: SectionId
  layer: VoiceLayer
  midi: number
  seq: number
  keyDown: boolean
  sustained: boolean
  sostenuto: boolean
  releasing: boolean
  synthFallback: boolean
  sources: VoiceSource[]
  ownedNodes: AudioNodeLike[]
  /** Per-voice nodes fed by channel.lfo.depth / channel.vibrato.depth —
   *  cleanup disconnects the channel side or those edges leak. */
  lfoFeeds: AudioNodeLike[]
  vibratoFeeds: AudioNodeLike[]
  gain: GainNodeLike
  cleanupTimer: number | null
  organLive: OrganVoiceLive | null
  synthLive: SynthVoiceLive
  synthFilter: SynthVoiceFilter | null
  /** True while the arp scheduler (not a key press) is sounding this voice —
   *  ARP RUN off releases exactly these. */
  arpDriven: boolean
  /** Synth voices only: a dedicated post-filter gain the Gate mode pulses,
   *  so gating never cancels the amp envelope's own scheduled ramps. */
  gateGain: GainNodeLike | null
}

/** Numeric voice-map key — section/layer/midi packed into one small integer
 *  (midi is the raw 0..127 key number, never the octave-shifted pitch), so a
 *  key press/release no longer builds a garbage key string (iteration 23
 *  GC pass). */
const SECTION_KEY_CODE: Record<SectionId, number> = { piano: 0, organ: 1, synth: 2 }
const LAYER_KEY_CODE: Record<VoiceLayer, number> = { A: 0, B: 1, C: 2 }
function voiceKey(section: SectionId, layer: VoiceLayer, midi: number): number {
  return (SECTION_KEY_CODE[section] * 4 + LAYER_KEY_CODE[layer]) * 128 + midi
}

/** Packed (section, layer) code — the midi-independent prefix of voiceKey —
 *  keying the O(1) held-voice counters that replaced full voice-map scans on
 *  the note-on path (polyphony cap, organ percussion single-trigger). */
function layerCode(section: SectionId, layer: VoiceLayer): number {
  return SECTION_KEY_CODE[section] * 4 + LAYER_KEY_CODE[layer]
}

/** Every (section, layer) a voice map key can address. noteOff/isNoteActive
 *  probe these seven keys directly instead of scanning every held voice. */
const VOICE_ADDRESSES: ReadonlyArray<readonly [SectionId, VoiceLayer]> = [
  ['piano', 'A'],
  ['piano', 'B'],
  ['organ', 'A'],
  ['organ', 'B'],
  ['synth', 'A'],
  ['synth', 'B'],
  ['synth', 'C'],
]

/** Free-list cap: pooled Voice objects hold no AudioNode references (cleanup
 *  empties their arrays), so this only bounds retained plain-object count. */
const VOICE_POOL_MAX = 64

/** Static partial recipe for the labeled synthesized fallback voice
 *  (hoisted from a per-press literal — iteration 23 GC pass). */
const FALLBACK_VOICE_PARTIALS: ReadonlyArray<{ ratio: number; type: string; level: number; detune: number }> = [
  { ratio: 1, type: 'triangle', level: 1, detune: 0 },
  { ratio: 1, type: 'sine', level: 0.5, detune: 3 },
  { ratio: 2, type: 'sine', level: 0.24, detune: -2 },
  { ratio: 3.01, type: 'sine', level: 0.08, detune: 0 },
]

/** Left/right unison duplicate sides (hoisted from per-press literals). */
const UNISON_SIDES = [-1, 1] as const

/** Piano/Organ layer ids for the per-press noteOn loop (hoisted from a
 *  per-call `['A', 'B'] as const` literal; panel-edit paths keep theirs). */
const AB_LAYERS = ['A', 'B'] as const

type InstrumentLoadStatus = 'loading' | 'ready' | 'error'

export interface OrganChannel {
  voiceBus: GainNodeLike
  scanner: EffectUnit<ScannerState>
  levelGain: GainNodeLike
}

/** One standing LFO per synth layer (spec lfo): built alongside the layer's
 *  channel and always running; its depth gain is (re)connected to the
 *  destination param of every sounding voice of that layer as voices start
 *  or the destination/waveform/rate changes (manual p. 34: no destination
 *  LED lit means off but the settings are kept — depth simply goes to 0).
 *  Triangle/Saw Up/Square come from `osc` (its native type switches);
 *  Saw Down is `osc` through an inverting gain; S&H is a separate looping
 *  stepped-random buffer source. A per-source select gain mutes the two
 *  inactive sources so switching waveform never needs to reconnect the
 *  live `depth` fan-out mid-note. */
export interface SynthLfoUnit {
  osc: OscillatorNodeLike
  /** Inverting stage for Saw Down (native oscillator has no descending-ramp
   *  type without gain inversion); its select gain mutes it otherwise. */
  invert: GainNodeLike
  invertSelect: GainNodeLike
  oscSelect: GainNodeLike
  /** S&H stepped-random source (Sample & Hold has no native oscillator type). */
  sh: AudioBufferSourceNodeLike
  shSelect: GainNodeLike
  depth: GainNodeLike
  waveform: SynthLfoWaveform
}

/** Per-layer pitch LFO for the layer's Vibrato (spec voice.vibrato.menu:
 *  "Rate 2.0-8.0 Hz", "Amount 0-10" — both panel-editable via the VIBRATO
 *  MENU button's OLED dials, see setSynthVibratoEdit/updateSynthChannels).
 *  `depth`'s gain follows On/Delayed (vibratoAmount-scaled) or Wheel/Pedal
 *  (live position scaled by vibratoAmount) and connects to each sounding
 *  voice's source detune params at voice build, mirroring the standing
 *  LFO's connect-at-build pattern. */
export interface SynthVibratoUnit {
  osc: OscillatorNodeLike
  depth: GainNodeLike
}

/** Synth layer path (per-layer effect chain arrives with a later Synth
 *  iteration). Voices enter the bus, the level gain gates enabled/section-on
 *  audibility, feed the layer's own effect chain (spec: three independent
 *  synth chains), whose output's toMaster/toRotary sends mirror a Piano
 *  layer's routing (Amp unit "To Rotary" mode). */
export interface SynthChannel {
  voiceBus: GainNodeLike
  levelGain: GainNodeLike
  units: {
    mod1: EffectUnit<EffectChainState['mod1']>
    mod2: EffectUnit<EffectChainState['mod2']>
    delay: EffectUnit<EffectChainState['delay']>
    ampEq: EffectUnit<EffectChainState['ampEq']>
    comp: EffectUnit<EffectChainState['comp']>
    reverb: EffectUnit<EffectChainState['reverb']>
  }
  toMaster: GainNodeLike
  toRotary: GainNodeLike
  lfo: SynthLfoUnit
  vibrato: SynthVibratoUnit
}

/** The single effect chain shared by both Organ layers (manual p. 18: "Both
 *  Organ Layers share the same effects chain"). Each layer's levelGain feeds
 *  this chain's input; its output fans out to the shared master/rotary
 *  sends, mirroring the per-layer LayerChannel routing. */
export interface OrganSharedChain {
  input: GainNodeLike
  units: {
    mod1: EffectUnit<EffectChainState['mod1']>
    mod2: EffectUnit<EffectChainState['mod2']>
    delay: EffectUnit<EffectChainState['delay']>
    ampEq: EffectUnit<EffectChainState['ampEq']>
    comp: EffectUnit<EffectChainState['comp']>
    reverb: EffectUnit<EffectChainState['reverb']>
  }
  toMaster: GainNodeLike
  toRotary: GainNodeLike
}

export interface LayerChannel {
  voiceBus: GainNodeLike
  timbreBass: BiquadFilterNodeLike
  timbreTreble: BiquadFilterNodeLike
  dynComp: DynamicsCompressorNodeLike | null
  dynMakeup: GainNodeLike
  levelGain: GainNodeLike
  resSend: GainNodeLike
  resConvolver: AudioNodeLike
  units: {
    mod1: EffectUnit<EffectChainState['mod1']>
    mod2: EffectUnit<EffectChainState['mod2']>
    delay: EffectUnit<EffectChainState['delay']>
    ampEq: EffectUnit<EffectChainState['ampEq']>
    comp: EffectUnit<EffectChainState['comp']>
    reverb: EffectUnit<EffectChainState['reverb']>
  }
  toMaster: GainNodeLike
  toRotary: GainNodeLike
}

export const MAX_POLYPHONY = 24
const RELEASE_SECONDS = 0.18
const ORGAN_RELEASE_SECONDS = 0.02
const HALF_PEDAL_RELEASE_SECONDS = 0.85
const QUICK_RELEASE_SECONDS = 0.03
const PANIC_RELEASE_SECONDS = 0.008
const CLEANUP_GRACE_MS = 80
const SUSTAIN_DOWN = 0.85
const SUSTAIN_LIFT = 0.2
/** Per-partial scale so a full nine-drawbar registration stays headroom-safe. */
const ORGAN_PARTIAL_LEVEL = 0.075
/** Per-oscillator headroom scale for the synth voice (up to a 7-osc Super stack). */
const SYNTH_OSC_LEVEL = 0.13
/** Amp-envelope velocity-level "floor" — the peak gain at velocity 0, ramping
 *  up to the full peak at velocity 1 (Off/1/2/3 — spec envelopes.amplifier).
 *  Off (0) ignores played velocity entirely (handled separately); 1 is a
 *  shallow response, 3 the deepest (soft notes near-silent, hard notes full). */
const SYNTH_VELOCITY_FLOOR = [1, 0.7, 0.35, 0.05] as const

/** decay=127 holds at the attack peak (manual p. 33 "sustain mode"); otherwise
 *  0..126 maps to a short..long time constant for setTargetAtTime decay. */
function synthDecaySeconds(decay: number): number | null {
  if (decay >= 127) return null
  return 0.005 + Math.pow(decay / 126, 2) * 3
}

/** 0..127 -> 0.01..4s exponential release mapping for synth voices. */
function synthReleaseSeconds(release: number): number {
  return 0.01 * Math.pow(400, release / 127)
}

/** 0..127 -> 0.001..2s exponential attack mapping for synth voices. */
function synthAttackSeconds(attack: number): number {
  return 0.001 + Math.pow(attack / 127, 2) * 2
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Cents-depth-to-playbackRate-ratio translator scale for Samples-mode
 *  pitch modulation (see the pitchScalers hookup in startSynthVoice).
 *  Hoisted from a per-press closure (iteration 23 GC pass). */
function centsToRateScale(baseRate: number): number {
  return baseRate * (Math.pow(2, 1 / 1200) - 1)
}

/** Stops (if startable) and disconnects every node — used for the standing
 *  synth LFO's oscillator/buffer-source/gain nodes on full engine teardown
 *  (mirrors the equivalent helper in effects.ts for the effect LFOs). */
function stopAndDisconnect(nodes: AudioNodeLike[]): void {
  for (const node of nodes) {
    try {
      ;(node as OscillatorNodeLike).stop?.(0)
    } catch {
      /* not startable or already stopped */
    }
    try {
      node.disconnect()
    } catch {
      /* detached */
    }
  }
}

/** Native BiquadFilterNode type per filter type (LP24/LP M cascade two
 *  lowpass stages, LP+HP pairs a lowpass with a highpass — see
 *  synthFilterStageSpecs for the per-stage breakdown). Only used for the
 *  single-stage required types here; LP24/LP M/LP+HP resolve their stages'
 *  types from synthFilterStageSpecs instead. */
function biquadTypeFor(type: SynthFilterType): string {
  if (type === 'HP') return 'highpass'
  if (type === 'BP') return 'bandpass'
  return 'lowpass' // LP12, LP24, LP M (cascade default), LP+HP (stage 1)
}

/** Per-stage cascade spec: LP12/HP/BP are one stage; LP24 is two identical
 *  lowpass stages (24 dB/oct); the optional LP M is a ladder-style
 *  approximation — two lowpass stages, but the SECOND stage's resonance is
 *  mapped hotter (qMultiplier 1.5x) for a self-oscillating-ladder character
 *  distinct from LP24's identical-Q pair; the optional LP+HP is a lowpass
 *  at the cutoff in series with a highpass fixed 2 octaves below it — a
 *  wider/shallower band emphasis than BP's single resonant stage.
 *  Shared read-only constants (callers only iterate/index) so building a
 *  filtered voice allocates no per-press spec arrays (iteration 23 GC pass). */
interface SynthFilterStageSpec {
  type: string
  qMultiplier: number
  freqOctaveOffset: number
}
const LP24_STAGES: SynthFilterStageSpec[] = [
  { type: 'lowpass', qMultiplier: 1, freqOctaveOffset: 0 },
  { type: 'lowpass', qMultiplier: 1, freqOctaveOffset: 0 },
]
const LP_M_STAGES: SynthFilterStageSpec[] = [
  { type: 'lowpass', qMultiplier: 1, freqOctaveOffset: 0 },
  { type: 'lowpass', qMultiplier: 1.5, freqOctaveOffset: 0 },
]
const LP_HP_STAGES: SynthFilterStageSpec[] = [
  { type: 'lowpass', qMultiplier: 1, freqOctaveOffset: 0 },
  { type: 'highpass', qMultiplier: 1, freqOctaveOffset: -2 },
]
const SINGLE_STAGE: Record<string, SynthFilterStageSpec[]> = {}
function synthFilterStageSpecs(type: SynthFilterType): SynthFilterStageSpec[] {
  if (type === 'LP24') return LP24_STAGES
  if (type === 'LP M') return LP_M_STAGES
  if (type === 'LP+HP') return LP_HP_STAGES
  return (SINGLE_STAGE[type] ??= [{ type: biquadTypeFor(type), qMultiplier: 1, freqOctaveOffset: 0 }])
}

/** LP M's fixed gentle drive waveshaper (tanh k=1.5): a declared ladder-
 *  style saturating character applied BEFORE the filter stages, always
 *  active for this type (independent of the Drive knob's own stage), so LP M
 *  measurably differs from LP24 at identical freq/res/tracking settings. */
const LP_M_DRIVE_K = 1.5
/** Memoized: the curve is a constant, and rebuilding a 2048-float array on
 *  every LP M key press was pure per-press garbage (iteration 23 GC pass). */
let lpMDriveCurveCache: Float32Array | null = null
function lpMDriveCurve(): Float32Array {
  if (lpMDriveCurveCache) return lpMDriveCurveCache
  const curve = new Float32Array(2048)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * LP_M_DRIVE_K) / Math.tanh(LP_M_DRIVE_K)
  }
  lpMDriveCurveCache = curve
  return curve
}

/** 0..127 -> 40..16000 Hz cutoff, reusing the shared filterFreqHz mapping. */
function synthFilterFreqHz(freq: number): number {
  return mappings.filterFreqHz(freq)
}

/** 0..127 -> 0.5..18 biquad Q (resonance): a gentle low end rising to a
 *  clearly self-resonant peak at 127. */
function synthFilterQ(res: number): number {
  return 0.5 + Math.pow(res / 127, 2) * 17.5
}

/** Keyboard tracking scales the base cutoff by the note's distance from
 *  middle C, at Off/1-3/2-3/1 fractions of a full octave-per-octave track
 *  (spec filter.keyboardTracking). */
function synthFilterTrackingScale(tracking: 0 | 1 | 2 | 3, midi: number): number {
  const fraction = tracking / 3
  return Math.pow(2, (fraction * (midi - 60)) / 12)
}

/** Drive stage curve (Off/1/2/3): the same tanh-saturation shape used by the
 *  rotary drive (createRotary in effects.ts), scaled 1..3 across the three
 *  active levels so higher settings clip harder. Memoized per level — the
 *  curve only depends on `drive`, and rebuilding a 2048-float array on every
 *  driven key press was pure per-press garbage (iteration 23 GC pass). */
const synthDriveCurveCache = new Map<number, Float32Array>()
function synthDriveCurve(drive: 0 | 1 | 2 | 3): Float32Array | null {
  if (drive === 0) return null
  const cached = synthDriveCurveCache.get(drive)
  if (cached) return cached
  const k = 1 + drive * 3
  const curve = new Float32Array(2048)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * k) / Math.tanh(k)
  }
  synthDriveCurveCache.set(drive, curve)
  return curve
}

/** Filter-envelope peak cutoff: envAmount (0..127, 64 = 0) sweeps the base
 *  cutoff up to +4 octaves above `base`, clamped to the base at 64 and below
 *  base is never swept downward (spec: "Env Amt" is the filter envelope's
 *  depth, not a bipolar control on the real hardware). */
function synthFilterEnvPeakHz(baseHz: number, envAmount: number): number {
  const depth = Math.max(0, (envAmount - 64) / 63) * 4
  return Math.min(20000, baseHz * Math.pow(2, depth))
}

/** Oscillator-envelope bipolar pitch amount (64 = 0) -> ±12 semitones -> cents. */
function oscEnvPitchCents(amount: number): number {
  return ((amount - 64) / 63) * 12 * 100
}

/** Oscillator-envelope bipolar Osc Ctrl amount (64 = 0) -> a ±0.5 (0..127
 *  scale) live-target offset the same shape as the LFO's Osc Ctrl depth. */
function oscEnvCtrlOffset(amount: number): number {
  return ((amount - 64) / 63) * 63.5
}

export interface EngineOptions {
  assets?: AssetBoundary
}

export class PianoEngine {
  private readonly boundary: AudioBoundary
  private readonly assets: AssetBoundary | null
  private context: AudioContextLike | null = null
  private masterGain: GainNodeLike | null = null
  private limiter: DynamicsCompressorNodeLike | null = null
  private channels: Record<LayerId, LayerChannel> | null = null
  private organChannels: Record<LayerId, OrganChannel> | null = null
  private organChain: OrganSharedChain | null = null
  private synthChannels: Record<SynthLayerId, SynthChannel> | null = null
  private rotary: RotaryUnit | null = null
  /** Summed pre-master bus (all layer sends + rotary) feeding the shared
   *  post-rotary Global Reverb (manual p. 52-53). */
  private preMaster: GainNodeLike | null = null
  private globalReverb: EffectUnit<EffectChainState['reverb']> | null = null

  private voices = new Map<number, Voice>()
  private releasingVoices = new Set<Voice>()
  /** Held-voice count per packed (section, layer) code — kept in sync with
   *  `voices` by the start paths and releaseVoice, so the per-note-on
   *  polyphony-cap check reads O(1) instead of scanning every voice. */
  private heldCounts = new Map<number, number>()
  /** Held-voice count per section (organ percussion's single-trigger check
   *  reads this instead of scanning the voice map on every key press). */
  private heldSectionCounts: Record<SectionId, number> = { piano: 0, organ: 0, synth: 0 }
  /** Voice free-list (iteration 23 GC pass): cleanupVoice returns the JS
   *  bookkeeping object here — with its sources/ownedNodes arrays emptied in
   *  place — so sustained playing stops allocating one object plus two
   *  arrays per key press. AudioNodes are never pooled or reused. */
  private voicePool: Voice[] = []
  private sustainLevel = 0
  private softDown = false
  private sostenutoDown = false
  private pitchBend = 0
  private appliedBend: Record<SectionId, number> = { piano: 0, organ: 0, synth: 0 }
  /** Osc Pitch offset (cents) last applied to each synth layer's sounding
   *  voices — edits retarget live via the bend retarget path (applyBendToVoices). */
  private appliedSynthPitch: Record<SynthLayerId, number> = { A: 0, B: 0, C: 0 }
  /** Param-diff guards for updateSynthVoiceLive: retargeting a sounding
   *  voice's AudioParams calls cancelScheduledValues, which would truncate
   *  the note-on-scheduled filter/pitch envelope ramps. Every store commit
   *  reaches updateSynthVoiceLive, so unrelated edits (master level, morph
   *  motion, program browse) must NOT touch these params — only a change to
   *  the values that actually shape them may. */
  private appliedSynthLiveSig: Record<SynthLayerId, string> = { A: '', B: '', C: '' }
  private appliedSynthFilterSig: Record<SynthLayerId, string> = { A: '', B: '', C: '' }
  /** Effective drawbar values last retargeted onto sounding organ voices —
   *  the same commit-frequency guard idea as appliedSynthLiveSig. */
  private appliedOrganDrawbarSig = ''
  private seqCounter = 0
  private organClick: AudioBufferLike | null = null
  private organChiff: AudioBufferLike | null = null
  private synthNoiseLoop: AudioBufferLike | null = null
  /** Shared stepped-random buffer for every layer's LFO S&H waveform. */
  private synthShBuffer: AudioBufferLike | null = null

  /** Per-layer held-note stack (spec voice.priority / arpeggiatorGate): the
   *  physically (or KB-HOLD-latched) held notes, oldest first. Drives note
   *  priority in Mono/Legato and — when the section-level arp is running —
   *  the arpeggiator's note set (shared across every enabled synth layer). */
  private synthHeld: Record<SynthLayerId, number[]> = { A: [], B: [], C: [] }
  /** Per-layer sounding voice midi in Mono/Legato mode (null = none sounding). */
  private synthSoundingMidi: Record<SynthLayerId, number | null> = { A: null, B: null, C: null }
  /** Arp scheduler: null while ARP RUN is off. */
  private arpTimer: number | null = null
  private arpStepIndex = 0
  /** Melodic position, advanced only on SOUNDING steps — a pattern's silent
   *  steps shape the rhythm without skipping notes of the arpeggio. */
  private arpNoteIndex = 0
  /** Arp-mode's one sounding note per layer (so each step releases the
   *  previous note before sounding the next — Poly mode ignores this and
   *  retriggers every held note in place each step, per spec). */
  private arpSoundingMidi: Record<SynthLayerId, number | null> = { A: null, B: null, C: null }
  /** Deterministic xorshift RNG state for Random direction, reseeded each
   *  run-start (spec: "deterministic xorshift seeded per run-start"). */
  private arpRngState = 0
  private arpRunning = false

  private state: InstrumentState = initialInstrumentState()
  private detachStore: (() => void) | null = null

  /** Last-applied dependency tuples per applyState block (see depsChanged):
   *  a block whose inputs are reference-identical to the previous apply is
   *  skipped wholesale. Every store commit runs applyState — knob drags and
   *  morph/CC input arrive at ~120 commits/sec — and re-ramping every
   *  AudioParam of every effect unit on each one flooded the audio thread
   *  with cancelScheduledValues/setTargetAtTime messages. State patches are
   *  immutable (unchanged sub-objects keep identity), so reference checks
   *  are exact. */
  private appliedDeps = new Map<string, readonly unknown[]>()

  private sampleCache = new Map<string, AudioBufferLike>()
  private instrumentStatus = new Map<string, InstrumentLoadStatus>()
  private instrumentError = new Map<string, string>()
  private pedalThump: AudioBufferLike | null = null
  private reducedPath = false

  private statusInfo: EngineStatusInfo = { status: 'idle', message: 'Audio starts on the first key press.' }
  private listeners = new Set<(info: EngineStatusInfo) => void>()

  constructor(boundary: AudioBoundary, options: EngineOptions = {}) {
    this.boundary = boundary
    this.assets = options.assets ?? null
  }

  /** Subscribes the engine to canonical state; every store change is applied to the live graph. */
  attachStore(store: { getState(): InstrumentState; subscribe(listener: () => void): () => void }): void {
    this.detachStore?.()
    this.state = store.getState()
    this.detachStore = store.subscribe(() => {
      const previous = this.state
      this.state = store.getState()
      if (this.context) {
        // The needed sample sets and the status line only depend on the
        // piano layer selections and the synth section (Samples mode);
        // unrelated commits — knob drags at ~120/sec — skip both. Load
        // completions refresh the status themselves.
        const selectionChanged = this.state.layers !== previous.layers || this.state.synth !== previous.synth
        if (selectionChanged) this.loadNeededInstruments()
        this.applyState()
        if (selectionChanged) this.refreshStatus()
      }
    })
  }

  getStatus(): EngineStatusInfo {
    return this.statusInfo
  }

  subscribe(listener: (info: EngineStatusInfo) => void): () => void {
    this.listeners.add(listener)
    listener(this.statusInfo)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: EngineStatus, message: string): void {
    // refreshStatus runs on every store commit; an unchanged status keeps
    // its object identity so App's useSyncExternalStore snapshot doesn't
    // re-render the whole tree per knob tick. Listeners are still notified
    // unconditionally — whenReady() counts on a notification even when the
    // visible status text is unchanged (e.g. the last-needed sample set
    // finishing load under an already-"ready" piano line).
    if (this.statusInfo.status !== status || this.statusInfo.message !== message) {
      this.statusInfo = { status, message }
    }
    for (const listener of this.listeners) listener(this.statusInfo)
  }

  /* -------------------------------------------------------- graph setup -- */

  /** Creates the audio graph. Safe to call from any input gesture, and also
   *  from idle warm-up: the context may start suspended (no gesture yet), in
   *  which case the next gesture only has to resume it. */
  ensureStarted(): void {
    if (this.context) {
      // Offline render contexts are 'suspended' until startRendering and must
      // not be resumed here; a live context suspended by pre-gesture warm-up
      // resumes on this (gesture-driven) call.
      if (this.context.state === 'suspended' && !('startRendering' in this.context)) {
        void Promise.resolve(this.context.resume()).catch(() => undefined)
      }
      return
    }
    this.setStatus('loading', 'Starting audio engine…')
    let context: AudioContextLike
    try {
      context = this.boundary.createContext()
    } catch (error) {
      this.setStatus('error', `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.context = context
    try {
      const master = context.createGain()
      master.gain.value = 0.85
      let tail: AudioNodeLike = master
      if (typeof context.createDynamicsCompressor === 'function') {
        try {
          const limiter = context.createDynamicsCompressor()
          // True limiter pose: hard-ish knee near full scale so normal
          // program material passes untouched and only peaks are caught.
          limiter.threshold.value = -3
          limiter.knee.value = 3
          limiter.ratio.value = 20
          limiter.attack.value = 0.002
          limiter.release.value = 0.15
          master.connect(limiter)
          tail = limiter
          this.limiter = limiter
        } catch {
          this.reducedPath = true
        }
      } else {
        this.reducedPath = true
      }
      tail.connect(context.destination)
      this.masterGain = master
      this.rotary = createRotary(context)
      // Global Reverb placement (manual p. 52-53): reverb precedes the
      // rotary "unless the Reverb is set to Global mode, in which case the
      // Reverb is placed after the Rotary Speaker". One shared reverb sits
      // on the summed pre-master bus (post-rotary); it idles as a dry pass
      // until GLOBAL reverb is engaged, when the per-chain reverbs bypass
      // and this one takes over.
      const preMaster = context.createGain()
      this.preMaster = preMaster
      this.globalReverb = createReverb(context)
      preMaster.connect(this.globalReverb.input)
      this.globalReverb.output.connect(master)
      this.rotary.output.connect(preMaster)
      this.channels = { A: this.buildChannel(context), B: this.buildChannel(context) }
      // Organ channels (with their always-running scanner LFOs) are built
      // lazily on first Organ-section use — a piano-only session never pays
      // for them (see ensureOrganChannels, called from applyState).
      // OfflineAudioContext (offline render tests) rejects resume() before
      // startRendering; a live context resumes on this first gesture.
      if (context.state === 'suspended') void Promise.resolve(context.resume()).catch(() => undefined)
      this.appliedDeps.clear()
      this.loadNeededInstruments()
      this.applyState()
      this.refreshStatus()
    } catch (error) {
      // Preferred graph failed entirely: fall back to the most minimal path.
      try {
        const master = context.createGain()
        master.gain.value = 0.7
        master.connect(context.destination)
        this.masterGain = master
        this.channels = null
        this.reducedPath = true
        this.setStatus('fallback', 'Running on a reduced audio path (synthesized fallback voice, no effects).')
      } catch {
        this.setStatus('error', `Audio graph failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private buildChannel(context: AudioContextLike): LayerChannel {
    const voiceBus = context.createGain()
    const timbreBass = context.createBiquadFilter()
    timbreBass.type = 'lowshelf'
    timbreBass.frequency.value = 250
    timbreBass.gain.value = 0
    const timbreTreble = context.createBiquadFilter()
    timbreTreble.type = 'highshelf'
    timbreTreble.frequency.value = 2800
    timbreTreble.gain.value = 0
    let dynComp: DynamicsCompressorNodeLike | null = null
    if (typeof context.createDynamicsCompressor === 'function') {
      try {
        dynComp = context.createDynamicsCompressor()
        dynComp.threshold.value = 0
        dynComp.ratio.value = 1
        dynComp.knee.value = 20
        dynComp.attack.value = 0.005
        dynComp.release.value = 0.18
      } catch {
        dynComp = null
      }
    }
    const dynMakeup = context.createGain()
    const levelGain = context.createGain()

    voiceBus.connect(timbreBass)
    timbreBass.connect(timbreTreble)
    if (dynComp) {
      timbreTreble.connect(dynComp)
      dynComp.connect(dynMakeup)
    } else {
      timbreTreble.connect(dynMakeup)
    }

    const units = {
      mod1: createMod1(context),
      mod2: createMod2(context),
      delay: createDelay(context),
      ampEq: createAmpEq(context),
      comp: createComp(context),
      reverb: createReverb(context),
    }
    dynMakeup.connect(units.mod1.input)

    // Sympathetic/pedal-down string resonance approximation: a generated
    // short bright impulse fed from the voice bus, active with String Res +
    // damper lift. Declared as generated DSP, not recorded pedal-down samples.
    const resSend = context.createGain()
    resSend.gain.value = 0
    const resConvolver = context.createConvolver()
    resConvolver.buffer = this.makeResonanceImpulse(context)
    voiceBus.connect(resSend)
    resSend.connect(resConvolver)
    resConvolver.connect(units.mod1.input)
    units.mod1.output.connect(units.mod2.input)
    units.mod2.output.connect(units.delay.input)
    units.delay.output.connect(units.ampEq.input)
    units.ampEq.output.connect(units.comp.input)
    units.comp.output.connect(units.reverb.input)

    // Spec signalContract.requiredOrder: the Layer level sits AFTER the
    // effect chain — pulling a fader trims the already-processed sound, it
    // never starves the delay/reverb tails of input. (The single shared
    // rotary makes a strictly-post-rotary per-layer level impossible; the
    // level rides the post-reverb split feeding both sends instead.)
    const toMaster = context.createGain()
    const toRotary = context.createGain()
    toRotary.gain.value = 0
    units.reverb.output.connect(levelGain)
    levelGain.connect(toMaster)
    levelGain.connect(toRotary)
    toMaster.connect(this.preMaster ?? this.masterGain!)
    toRotary.connect(this.rotary!.input)

    return { voiceBus, timbreBass, timbreTreble, dynComp, dynMakeup, levelGain, resSend, resConvolver, units, toMaster, toRotary }
  }

  /** Builds the organ layer paths and the shared organ effect chain on first
   *  use (organ section switched on). */
  private ensureOrganChannels(): void {
    if (this.organChannels || !this.context || !this.masterGain || !this.rotary || !this.channels) return
    this.organChain = this.buildOrganSharedChain(this.context)
    this.organChannels = {
      A: this.buildOrganChannel(this.context, this.organChain),
      B: this.buildOrganChannel(this.context, this.organChain),
    }
    // Fresh nodes carry construction-default params: the next applyState
    // must apply every block to them regardless of what state it last saw.
    this.appliedDeps.clear()
  }

  /** Organ layer path: voices → vib/chorus scanner → level → shared chain
   *  input. Unlike Piano/Synth, the Organ level must stay PRE-chain: both
   *  layers mix into the one shared effect chain (manual p. 18), so the
   *  faders are the only place their balance can be set. */
  private buildOrganChannel(context: AudioContextLike, chain: OrganSharedChain): OrganChannel {
    const voiceBus = context.createGain()
    const scanner = createScanner(context)
    const levelGain = context.createGain()
    voiceBus.connect(scanner.input)
    scanner.output.connect(levelGain)
    levelGain.connect(chain.input)
    return { voiceBus, scanner, levelGain }
  }

  /** The single effect chain shared by both Organ layers (manual p. 18),
   *  wired identically to a piano LayerChannel's chain: Mod 1 → Mod 2 →
   *  Delay → Amp/EQ → Comp → Reverb, then to master or the shared rotary. */
  private buildOrganSharedChain(context: AudioContextLike): OrganSharedChain {
    const input = context.createGain()
    const units = {
      mod1: createMod1(context),
      mod2: createMod2(context),
      delay: createDelay(context),
      ampEq: createAmpEq(context),
      comp: createComp(context),
      reverb: createReverb(context),
    }
    input.connect(units.mod1.input)
    units.mod1.output.connect(units.mod2.input)
    units.mod2.output.connect(units.delay.input)
    units.delay.output.connect(units.ampEq.input)
    units.ampEq.output.connect(units.comp.input)
    units.comp.output.connect(units.reverb.input)

    const toMaster = context.createGain()
    const toRotary = context.createGain()
    toRotary.gain.value = 0
    units.reverb.output.connect(toMaster)
    units.reverb.output.connect(toRotary)
    toMaster.connect(this.preMaster ?? this.masterGain!)
    toRotary.connect(this.rotary!.input)

    return { input, units, toMaster, toRotary }
  }

  /** Builds the three synth layer paths on first use (synth section switched
   *  on). Straight to master — the per-layer effect chain arrives with a
   *  later Synth iteration. */
  private ensureSynthChannels(): void {
    if (this.synthChannels || !this.context || !this.masterGain) return
    this.synthChannels = {
      A: this.buildSynthChannel(this.context),
      B: this.buildSynthChannel(this.context),
      C: this.buildSynthChannel(this.context),
    }
    // See ensureOrganChannels: fresh nodes need a full applyState pass.
    this.appliedDeps.clear()
  }

  private buildSynthChannel(context: AudioContextLike): SynthChannel {
    const voiceBus = context.createGain()
    const levelGain = context.createGain()
    const units = {
      mod1: createMod1(context),
      mod2: createMod2(context),
      delay: createDelay(context),
      ampEq: createAmpEq(context),
      comp: createComp(context),
      reverb: createReverb(context),
    }
    voiceBus.connect(units.mod1.input)
    units.mod1.output.connect(units.mod2.input)
    units.mod2.output.connect(units.delay.input)
    units.delay.output.connect(units.ampEq.input)
    units.ampEq.output.connect(units.comp.input)
    units.comp.output.connect(units.reverb.input)

    // Layer level post-chain (spec signalContract.requiredOrder) — see the
    // piano channel note.
    const toMaster = context.createGain()
    const toRotary = context.createGain()
    toRotary.gain.value = 0
    units.reverb.output.connect(levelGain)
    levelGain.connect(toMaster)
    levelGain.connect(toRotary)
    toMaster.connect(this.preMaster ?? this.masterGain!)
    toRotary.connect(this.rotary!.input)

    return { voiceBus, levelGain, units, toMaster, toRotary, lfo: this.buildSynthLfo(context), vibrato: this.buildSynthVibrato(context) }
  }

  /** Per-layer vibrato pitch LFO (spec voice.vibrato.menu): always running
   *  once the layer's channel exists; its frequency follows the layer's
   *  mapped Rate and its depth gain follows the mapped Amount (see
   *  updateSynthChannels), connecting to every sounding voice's source
   *  detune params at voice build, same convention as the standing
   *  modulation LFO. Initial frequency is the default mapped rate; the next
   *  sync pass corrects it to the layer's actual state. */
  private buildSynthVibrato(context: AudioContextLike): SynthVibratoUnit {
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 5.5
    const depth = context.createGain()
    depth.gain.value = 0
    osc.connect(depth)
    osc.start(0)
    return { osc, depth }
  }

  /** One always-running standing LFO per synth layer (spec lfo): built once
   *  and never torn down until the section itself is (mirrors the always-on
   *  Mod 1/2 LFO oscillators in effects.ts). `depth`'s gain gets connected to
   *  each sounding voice's destination param at voice build and disconnected
   *  from released voices' nodes as they clean up (the disconnect happens
   *  implicitly: releasing a voice's owned nodes tears down that connection). */
  private buildSynthLfo(context: AudioContextLike): SynthLfoUnit {
    const osc = context.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = mappings.lfoRateHz(64)
    const invert = context.createGain()
    invert.gain.value = -1
    osc.connect(invert)
    // S&H: a looping stepped-random buffer (a real oscillator has no
    // sample-and-hold type) — built once per LFO at a fixed step rate, then
    // its playbackRate is scaled to follow the Rate knob (see updateSynthLfos).
    const sh = context.createBufferSource()
    sh.buffer = this.getSynthShBuffer(context)
    sh.loop = true
    sh.playbackRate.value = 1
    sh.start(0)
    // Select gains mute the two inactive sources so a waveform change never
    // reconnects the live depth fan-out mid-note (Triangle/Saw Up/Square all
    // read `osc` directly; Saw Down reads `invert`; S&H reads `sh`).
    const oscSelect = context.createGain()
    oscSelect.gain.value = 1
    const invertSelect = context.createGain()
    invertSelect.gain.value = 0
    const shSelect = context.createGain()
    shSelect.gain.value = 0
    const depth = context.createGain()
    depth.gain.value = 0
    osc.connect(oscSelect)
    invert.connect(invertSelect)
    sh.connect(shSelect)
    oscSelect.connect(depth)
    invertSelect.connect(depth)
    shSelect.connect(depth)
    osc.start(0)
    return { osc, invert, invertSelect, oscSelect, sh, shSelect, depth, waveform: 'Triangle' }
  }

  /** Generated looping stepped-random buffer (xorshift; declared generated)
   *  for the LFO's Sample & Hold waveform: one held random value per step,
   *  16 steps/second at playbackRate 1 — scaled by the Rate knob so faster
   *  settings step faster. */
  private getSynthShBuffer(context: AudioContextLike): AudioBufferLike {
    if (!this.synthShBuffer) {
      const rate = context.sampleRate
      const stepsPerSecond = 16
      const totalSteps = 64
      const samplesPerStep = Math.max(1, Math.floor(rate / stepsPerSecond))
      const length = totalSteps * samplesPerStep
      const buffer = context.createBuffer(1, length, rate)
      const data = buffer.getChannelData(0)
      let seed = 0x9e3779b9
      for (let step = 0; step < totalSteps; step++) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        const value = seed / 0xffffffff - 0.5
        for (let i = 0; i < samplesPerStep; i++) data[step * samplesPerStep + i] = value
      }
      this.synthShBuffer = buffer
    }
    return this.synthShBuffer
  }

  private makeResonanceImpulse(context: AudioContextLike): AudioBufferLike {
    const rate = context.sampleRate
    const length = Math.max(1, Math.floor(0.6 * rate))
    const buffer = context.createBuffer(2, length, rate)
    let seed = 0x1234567
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        const t = i / rate
        data[i] = (seed / 0xffffffff - 0.5) * Math.exp(-t * 7) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 220 * t))
      }
    }
    return buffer
  }

  /* ----------------------------------------------------- sample library -- */

  private neededInstrumentIds(): string[] {
    const ids = new Set<string>()
    for (const layer of ['A', 'B'] as const) {
      const id = selectedInstrumentId(this.state.layers[layer])
      if (id) ids.add(id)
    }
    return [...ids]
  }

  /** Synth sample-set ids needed by any synth layer currently in Samples
   *  mode (spec.scope.optional Samples mode) — loaded/tracked through the
   *  same sample-cache and status machinery as the Piano library, kept as a
   *  separate id namespace (getSynthSampleSet vs getInstrument) so piano
   *  status/fallback reporting stays untouched. */
  private neededSynthSampleSetIds(): string[] {
    const anySamplesLayer = SYNTH_LAYER_IDS.some((layer) => this.state.synth.layers[layer].mode === 'Samples')
    // Both bundled sets load together (the WAVE list switches between them
    // instantly with no load gap) once any layer is in Samples mode.
    return anySamplesLayer ? SYNTH_SAMPLE_SETS.map((set) => set.id) : []
  }

  private loadNeededInstruments(): void {
    if (!this.context || !this.channels) return
    for (const id of this.neededInstrumentIds()) this.loadInstrument(getInstrument(id))
    for (const id of this.neededSynthSampleSetIds()) this.loadInstrument(getSynthSampleSet(id))
  }

  private loadInstrument(spec: { id: string; zones: SampleZone[] }): void {
    if (!this.context) return
    const existing = this.instrumentStatus.get(spec.id)
    if (existing === 'ready' || existing === 'loading') return
    if (!this.assets) {
      this.instrumentStatus.set(spec.id, 'error')
      this.instrumentError.set(spec.id, 'No sample assets available in this environment.')
      this.refreshStatus()
      return
    }
    this.instrumentStatus.set(spec.id, 'loading')
    this.refreshStatus()

    const pending: Array<Promise<void>> = []
    let syncFailure: string | null = null
    for (const zone of spec.zones) {
      if (this.sampleCache.has(zone.file)) continue
      try {
        const data = this.assets.load(zone.file)
        if (isThenable(data)) {
          pending.push(data.then((resolved) => this.storeSample(zone.file, resolved)))
        } else {
          const stored = this.storeSample(zone.file, data)
          if (isThenable(stored)) pending.push(stored)
        }
      } catch (error) {
        syncFailure = error instanceof Error ? error.message : String(error)
        break
      }
    }

    const finalize = (failure: string | null) => {
      if (failure) {
        this.instrumentStatus.set(spec.id, 'error')
        this.instrumentError.set(spec.id, failure)
      } else {
        this.instrumentStatus.set(spec.id, 'ready')
      }
      this.refreshStatus()
    }

    if (syncFailure) {
      finalize(syncFailure)
    } else if (pending.length === 0) {
      finalize(null)
    } else {
      Promise.all(pending).then(
        () => finalize(null),
        (error: unknown) => finalize(error instanceof Error ? error.message : String(error)),
      )
    }
  }

  /** Decodes (if raw bytes) and stores a sample, truncating very long tails to bound memory. */
  private storeSample(file: string, data: SampleData): undefined | Promise<void> {
    const context = this.context
    if (!context) return undefined
    if (isAudioBuffer(data)) {
      this.sampleCache.set(file, this.truncateBuffer(context, data))
      return undefined
    }
    return context.decodeAudioData(data).then((decoded) => {
      this.sampleCache.set(file, this.truncateBuffer(context, decoded))
    })
  }

  private truncateBuffer(context: AudioContextLike, buffer: AudioBufferLike): AudioBufferLike {
    const MAX_SECONDS = 6.5
    if (buffer.duration <= MAX_SECONDS) return buffer
    const rate = buffer.sampleRate
    const length = Math.floor(MAX_SECONDS * rate)
    const fade = Math.floor(0.4 * rate)
    const truncated = context.createBuffer(buffer.numberOfChannels, length, rate)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel)
      const target = truncated.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        const gain = i > length - fade ? (length - i) / fade : 1
        target[i] = source[i]! * gain
      }
    }
    return truncated
  }

  instrumentLoadStatus(id: string): InstrumentLoadStatus | undefined {
    return this.instrumentStatus.get(id)
  }

  /** Resolves once every currently needed instrument (piano models AND any
   *  Samples-mode synth sample sets) has finished loading (ready or error). */
  whenReady(): Promise<EngineStatusInfo> {
    const settled = () => {
      const needed = [...this.neededInstrumentIds(), ...this.neededSynthSampleSetIds()]
      return needed.every((id) => {
        const status = this.instrumentStatus.get(id)
        return status === 'ready' || status === 'error'
      })
    }
    if (!this.context || !this.channels || settled()) return Promise.resolve(this.statusInfo)
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(() => {
        if (settled()) {
          unsubscribe()
          resolve(this.statusInfo)
        }
      })
    })
  }

  private refreshStatus(): void {
    if (!this.context || !this.masterGain || !this.channels) return
    const needed = this.neededInstrumentIds()
    const statuses = needed.map((id) => this.instrumentStatus.get(id))
    const reducedNote = this.reducedPath ? ' Reduced path: no master limiter.' : ''
    if (statuses.some((status) => status === 'loading' || status === undefined)) {
      this.setStatus('loading', 'Loading piano samples…')
      return
    }
    const failed = needed.filter((id) => this.instrumentStatus.get(id) === 'error')
    if (failed.length === needed.length && needed.length > 0) {
      this.setStatus(
        'fallback',
        `FALLBACK voice active (synthesized, not the recorded library) — sample load failed: ${this.instrumentError.get(failed[0]!) ?? 'unknown error'}.${reducedNote}`,
      )
      return
    }
    if (failed.length > 0) {
      const failedNames = failed.map((id) => getInstrument(id).name).join(', ')
      this.setStatus(
        'fallback',
        `Partial FALLBACK: ${failedNames} failed to load — affected layer uses the synthesized fallback voice.${reducedNote}`,
      )
      return
    }
    // Synth Samples-mode sets (optional scope): a labeled fallback note
    // appended to the truthful piano status line, same "declared fallback"
    // convention as above, without overriding the piano section's own status.
    const synthNeeded = this.neededSynthSampleSetIds()
    const synthFailed = synthNeeded.filter((id) => this.instrumentStatus.get(id) === 'error')
    const synthNote =
      synthFailed.length > 0
        ? ` Synth Samples-mode FALLBACK: ${synthFailed.map((id) => getSynthSampleSet(id).name).join(', ')} failed to load — affected layer uses the synthesized fallback voice.`
        : ''
    const layerLine = (['A', 'B'] as const)
      .map((layer) => {
        const id = selectedInstrumentId(this.state.layers[layer])
        return `${layer}: ${id ? getInstrument(id).name : '—'}`
      })
      .join(' · ')
    this.setStatus('ready', `Pianos ready (recorded samples) — ${layerLine}.${reducedNote}${synthNote}`)
  }

  /* ------------------------------------------------------- state -> DSP -- */

  /** True when `deps` differs from the tuple last recorded under `key`
   *  (Object.is per slot), recording the new tuple. Guards applyState's
   *  blocks: skipping a block whose inputs are unchanged is semantically a
   *  no-op (every ramp it would schedule targets the already-applied value)
   *  but saves the whole cancel/setTarget message storm per commit. */
  private depsChanged(key: string, deps: readonly unknown[]): boolean {
    const previous = this.appliedDeps.get(key)
    if (previous && previous.length === deps.length) {
      let same = true
      for (let i = 0; i < deps.length; i++) {
        if (!Object.is(previous[i], deps[i])) {
          same = false
          break
        }
      }
      if (same) return false
    }
    this.appliedDeps.set(key, deps)
    return true
  }

  private applyState(): void {
    const context = this.context
    if (!context || !this.masterGain) return
    const now = context.currentTime
    const state = this.state
    if (this.depsChanged('master', [state.masterVolume])) {
      rampTo(this.masterGain.gain, mappings.levelToGain(state.masterVolume) * 0.9, now)
    }

    // KB HOLD off: everything the hold was carrying (keys already lifted)
    // releases now, and the held stacks shrink back to the keys still down.
    if (this.lastKbHold && !state.kbHold) this.releaseKbHoldVoices()
    this.lastKbHold = state.kbHold

    // SUSTPED off: the damper is no longer routed to that section — release
    // anything it was holding there. (Direct Map iteration: releaseVoice
    // only ever deletes entries, which is safe mid-iteration.)
    for (const voice of this.voices.values()) {
      if (this.sectionSustped(voice.section)) continue
      if (voice.sustained && !voice.keyDown && !voice.sostenuto) {
        voice.sustained = false
        this.releaseVoice(voice, this.releaseSecondsFor(voice))
      }
    }
    // PSTICK toggles re-route the pitch stick on sounding voices immediately.
    for (const section of ['piano', 'organ', 'synth'] as const) {
      if (this.effectiveBend(section) !== this.appliedBend[section]) this.applyBendToVoices(section)
    }

    if (!this.channels || !this.rotary) return
    if (this.depsChanged('rotary', [state.rotary, state.globalSettings])) {
      this.rotary.update(
        {
          ...state.rotary,
          // Sound menu 8-11 (manual p. 58): global rotor/horn speed + acceleration.
          tuning: {
            rotorSpeed: state.globalSettings.rotaryRotorSpeed,
            rotorAcc: state.globalSettings.rotaryRotorAcc,
            hornSpeed: state.globalSettings.rotaryHornSpeed,
            hornAcc: state.globalSettings.rotaryHornAcc,
          },
        },
        now,
      )
    }

    // GLOBAL Reverb relocation (manual p. 52-53): with Reverb in Global
    // mode the ONE shared post-rotary reverb takes over and every chain's
    // local reverb bypasses; otherwise the shared unit idles as a dry pass.
    // All chains mirror the same reverb settings in Global mode, so chain
    // A's state speaks for all of them.
    const globalReverbOn = state.fxGlobal.reverb
    if (this.depsChanged('globalReverb', [state.chains.A.reverb, state.allFxOff, globalReverbOn])) {
      this.globalReverb?.update(state.chains.A.reverb, !state.allFxOff && globalReverbOn && state.chains.A.reverb.on, now)
    }

    // Master-clock sync (manual p. 17/40/49/51): while a unit's MST CLK is
    // lit its OWN Rate/Tempo knob selects a subdivision of the master beat
    // (½ = half notes, 1/8T = eighth triplets …) — the knob stays musical,
    // it never goes dead. Each unit reads its own knob value here.
    const beatMs = 60000 / state.masterClock.bpm
    const syncDelay = <T extends { mstClk: boolean; tempo: number }>(delay: T): T =>
      delay.mstClk ? { ...delay, tempo: mappings.msToDelayTempo(beatMs * mappings.clockDelayDivision(delay.tempo).beats) } : delay
    const syncMod1 = <T extends { mstClk: boolean; rate: number }>(mod1: T): T =>
      mod1.mstClk ? { ...mod1, rate: mappings.hzToLfoRate(1000 / (beatMs * mappings.clockRateDivision(mod1.rate).beats)) } : mod1
    // PED mode (manual p. 49): the control pedal drives the Wah sweep. The
    // live pedal position is injected outside the state object so pedal
    // moves never dirty program state.
    const pedal = state.morphValues.pedal / 127

    for (const layer of ['A', 'B'] as const) {
      const channel = this.channels[layer]
      const layerState = state.layers[layer]
      const chain = state.chains[layer]
      // Resonance routing follows the damper, which lives OUTSIDE the store
      // (setSustain calls applyState directly) — so the damper-derived
      // boolean joins the dependency tuple alongside the state references.
      const resActive = state.piano.stringRes && this.effectiveSustainLevel('piano') >= SUSTAIN_LIFT
      if (
        !this.depsChanged(`piano:${layer}`, [
          layerState,
          chain,
          state.piano,
          state.soloLayer,
          state.allFxOff,
          globalReverbOn,
          state.masterClock,
          state.morphValues.pedal,
          state.globalSettings,
          resActive,
        ])
      ) {
        continue
      }
      const solo = state.soloLayer
      const audible = layerState.enabled && state.piano.sectionOn && (!solo || (solo.section === 'piano' && solo.layer === layer))
      rampTo(channel.levelGain.gain, audible ? mappings.levelToGain(layerState.level) : 0, now)

      // Timbre voicing (family-aware).
      const family = layerState.type === 'Electric' ? 'electric' : 'acoustic'
      const timbreList = timbreListFor(layerState.type)
      const timbre = timbreList[Math.min(state.piano.timbre, timbreList.length - 1)]!
      const [bassDb, trebleDb] = timbreGains(family, timbre)
      rampTo(channel.timbreBass.gain, bassDb, now)
      rampTo(channel.timbreTreble.gain, trebleDb, now)

      // Dynamic compression 0..3 (raises the minimum sound level; timbre intact).
      if (channel.dynComp) {
        const level = state.piano.dynComp
        rampTo(channel.dynComp.threshold, level === 0 ? 0 : -12 - level * 9, now)
        rampTo(channel.dynComp.ratio, level === 0 ? 1 : 2 + level * 2, now)
        rampTo(channel.dynMakeup.gain, level === 0 ? 1 : 1 + level * 0.35, now)
      }

      // Resonance send follows String Res + damper state (as routed by
      // SUSTPED), trimmed by the Sound menu's String Res level (±6 dB).
      // A true-zero mute lets the browser mark the resonance convolver's
      // subgraph silent and skip its DSP while the damper is up.
      const resLevel = 0.4 * Math.pow(10, state.globalSettings.stringResDb / 20)
      rampTo(channel.resSend.gain, resActive ? resLevel : 0, now)

      // Ordered effect chain (families process real audio; allFxOff bypasses everything).
      const fxOn = !state.allFxOff
      channel.units.mod1.setPedal?.(pedal)
      channel.units.mod1.update(syncMod1(chain.mod1), fxOn && chain.mod1.on, now)
      channel.units.mod2.update(chain.mod2, fxOn && chain.mod2.on, now)
      channel.units.delay.update(syncDelay(chain.delay), fxOn && chain.delay.on, now)
      channel.units.ampEq.update(chain.ampEq, fxOn && chain.ampEq.on, now)
      channel.units.comp.update(chain.comp, fxOn && chain.comp.on, now)
      channel.units.reverb.update(chain.reverb, fxOn && chain.reverb.on && !globalReverbOn, now)

      // Routing: Amp unit in "To Rotary" mode sends this layer through the
      // single rotary instance (post-reverb: Reverb precedes Rotary). The
      // unused send is muted to a TRUE zero so the browser can silence-skip
      // the whole branch (0.0001 kept a -80 dB trickle flowing through the
      // rotary's delay/panner DSP forever).
      const routed = fxOn && chain.ampEq.on && chain.ampEq.type === 'To Rotary'
      rampTo(channel.toRotary.gain, routed ? 1 : 0, now)
      rampTo(channel.toMaster.gain, routed ? 0 : 1, now)
    }

    // Organ section: per-layer level + scanner feed the single shared effect
    // chain (manual p. 18: "Both Organ Layers share the same effects chain"),
    // whose output then follows the same rotary/master routing pattern as a
    // piano layer.
    if (state.organ.sectionOn) this.ensureOrganChannels()
    if (
      this.organChannels &&
      this.depsChanged('organ', [
        state.organ,
        state.organChain,
        state.organDrawbarPose,
        state.soloLayer,
        state.allFxOff,
        globalReverbOn,
        state.masterClock,
        state.morphValues.pedal,
      ])
    ) {
      for (const layer of ['A', 'B'] as const) {
        const channel = this.organChannels[layer]
        const layerState = state.organ.layers[layer]
        const organSolo = state.soloLayer
        const audible = layerState.enabled && state.organ.sectionOn && (!organSolo || (organSolo.section === 'organ' && organSolo.layer === layer))
        rampTo(channel.levelGain.gain, audible ? mappings.levelToGain(layerState.level) : 0, now)
        channel.scanner.update({ type: state.organ.vibratoType }, layerState.vibrato, now)
      }
      // Drawbar moves retune sounding organ voices immediately.
      this.updateOrganVoiceGains(now)

      const organChain = this.organChain!
      const organFxState = state.organChain
      const organFxOn = !state.allFxOff
      organChain.units.mod1.setPedal?.(pedal)
      organChain.units.mod1.update(syncMod1(organFxState.mod1), organFxOn && organFxState.mod1.on, now)
      organChain.units.mod2.update(organFxState.mod2, organFxOn && organFxState.mod2.on, now)
      organChain.units.delay.update(syncDelay(organFxState.delay), organFxOn && organFxState.delay.on, now)
      organChain.units.ampEq.update(organFxState.ampEq, organFxOn && organFxState.ampEq.on, now)
      organChain.units.comp.update(organFxState.comp, organFxOn && organFxState.comp.on, now)
      organChain.units.reverb.update(organFxState.reverb, organFxOn && organFxState.reverb.on && !globalReverbOn, now)

      // Routing: the ORGAN button in the Rotary group (manual p. 53) OR the
      // shared chain's Amp unit in "To Rotary" mode sends the organ through
      // the single rotary instance, post-reverb. True-zero mutes on the
      // unused send (see the piano routing note).
      const ampToRotary = organFxOn && organFxState.ampEq.on && organFxState.ampEq.type === 'To Rotary'
      const routed = state.organ.toRotary || ampToRotary
      rampTo(organChain.toRotary.gain, routed ? 1 : 0, now)
      rampTo(organChain.toMaster.gain, routed ? 0 : 1, now)
    }

    // Synth section: three layers, each with its own independent effect
    // chain (spec: "their own effect chains" — unlike Organ's shared chain).
    if (state.synth.sectionOn) this.ensureSynthChannels()
    if (this.synthChannels) {
      const fxOn = !state.allFxOff
      for (const layer of SYNTH_LAYER_IDS) {
        const channel = this.synthChannels[layer]
        const layerState = state.synth.layers[layer]
        if (
          !this.depsChanged(`synth:${layer}`, [
            layerState,
            state.synthChains[layer],
            state.synth.sectionOn,
            state.soloLayer,
            state.allFxOff,
            globalReverbOn,
            state.masterClock,
            // Vibrato's Wheel/Pedal modes and Mod 1's PED mode read the live
            // morph source positions.
            state.morphValues.wheel,
            state.morphValues.pedal,
          ])
        ) {
          continue
        }
        const synthSolo = state.soloLayer
        const audible = layerState.enabled && state.synth.sectionOn && (!synthSolo || (synthSolo.section === 'synth' && synthSolo.layer === layer))
        rampTo(channel.levelGain.gain, audible ? mappings.levelToGain(layerState.level) : 0, now)

        const synthChain = state.synthChains[layer]
        channel.units.mod1.setPedal?.(pedal)
        channel.units.mod1.update(syncMod1(synthChain.mod1), fxOn && synthChain.mod1.on, now)
        channel.units.mod2.update(synthChain.mod2, fxOn && synthChain.mod2.on, now)
        channel.units.delay.update(syncDelay(synthChain.delay), fxOn && synthChain.delay.on, now)
        channel.units.ampEq.update(synthChain.ampEq, fxOn && synthChain.ampEq.on, now)
        channel.units.comp.update(synthChain.comp, fxOn && synthChain.comp.on, now)
        channel.units.reverb.update(synthChain.reverb, fxOn && synthChain.reverb.on && !globalReverbOn, now)

        // Routing: the layer's Amp unit in "To Rotary" mode sends it through
        // the single rotary instance, post-reverb (mirrors a Piano layer).
        // True-zero mutes on the unused send (see the piano routing note).
        const routed = fxOn && synthChain.ampEq.on && synthChain.ampEq.type === 'To Rotary'
        rampTo(channel.toRotary.gain, routed ? 1 : 0, now)
        rampTo(channel.toMaster.gain, routed ? 0 : 1, now)

        // Vibrato rate: the layer's mapped Rate (spec voice.vibrato.menu:
        // 2.0-8.0 Hz) drives the per-layer pitch LFO oscillator directly.
        const voice = layerState.voice
        rampTo(channel.vibrato.osc.frequency, mappings.vibratoRateHz(voice.vibratoRate), now)

        // Vibrato depth: On/Delayed = fixed vibratoAmount (Delayed's per-
        // voice 0->full ramp lives on each voice's own delayGain — see
        // startSynthVoice/buildSynthVibrato); Wheel = live mod-wheel
        // position scaled by vibratoAmount; Pedal = live control-pedal
        // position scaled by vibratoAmount (spec voice.vibrato.optionalModes,
        // mirroring Wheel); Off = 0. ±40 cents at full depth (Amount 127 ->
        // spec-displayed 10).
        const amountScale = voice.vibratoAmount / 127
        const vibratoDepth =
          voice.vibrato === 'On' || voice.vibrato === 'Delayed'
            ? amountScale * 40
            : voice.vibrato === 'Wheel'
              ? (state.morphValues.wheel / 127) * amountScale * 40
              : voice.vibrato === 'Pedal'
                ? (state.morphValues.pedal / 127) * amountScale * 40
                : 0
        rampTo(channel.vibrato.depth.gain, vibratoDepth, now)
      }
      // Osc Ctrl moves retarget sounding synth voices immediately (Sync,
      // Multi, Super and FM-H categories; Pure has no Osc Ctrl effect); the
      // filter's type/freq/res/tracking/drive retarget the same way.
      this.updateSynthVoiceLive(now)
      // Osc Pitch edits (manual p. 28) retarget sounding voices immediately,
      // reusing the bend retarget path — it recomputes every synth source's
      // detune/playbackRate including the per-layer Osc Pitch offset.
      if (SYNTH_LAYER_IDS.some((layer) => this.synthOscPitchCents(layer) !== this.appliedSynthPitch[layer])) {
        this.applyBendToVoices('synth')
      }
      // Each layer's standing LFO follows its waveform/rate/amount/mstClk.
      this.updateSynthLfos(now)
    }
    // Arpeggiator/gate (spec arpeggiatorGate): a deterministic scheduler
    // driven by the injected timer boundary, started/stopped by ARP RUN.
    this.syncArpScheduler(now)
  }

  /** The drawbar values an organ layer actually sounds from: Preset On
   *  reads the Program's stored registration; Preset Off ("Drawbar Live",
   *  manual p. 19/21) reads the single physical drawbar pose instead. */
  private effectiveOrganDrawbars(layer: LayerId): number[] {
    const layerState = this.state.organ.layers[layer]
    return layerState.presetOn ? layerState.drawbars : this.state.organDrawbarPose
  }

  /** Retargets every sounding organ voice's partial gains from the live
   *  drawbar state (and the Vox tone-mix crossfade) — in Preset mode that
   *  means stored-registration edits/morphs, in Drawbar Live mode physical
   *  pose moves; both retune mid-note. */
  private updateOrganVoiceGains(now: number): void {
    // Runs on every store commit while the organ section is up: skip the
    // full voice walk (and its per-partial AudioParam ramps) unless the
    // effective drawbar values actually changed — new voices read the
    // current registration at start, so only changes need retargeting.
    const sig = `${this.effectiveOrganDrawbars('A').join(',')}|${this.effectiveOrganDrawbars('B').join(',')}`
    if (sig === this.appliedOrganDrawbarSig) return
    this.appliedOrganDrawbarSig = sig
    const apply = (voice: Voice) => {
      const live = voice.organLive
      if (!live) return
      const drawbars = this.effectiveOrganDrawbars(voice.layer as LayerId)
      const recipe = ORGAN_MODEL_RECIPES[live.model]
      for (const partial of live.partials) {
        const value = drawbars[partial.drawbar] ?? 0
        rampTo(partial.gain.gain, Math.max(0.0001, drawbarPartialGain(recipe, value) * partial.level), now)
      }
      if (live.voxMix) {
        const mix = (drawbars[8] ?? 0) / 8
        rampTo(live.voxMix.dark.gain, Math.max(0.0001, 1 - mix), now)
        rampTo(live.voxMix.bright.gain, Math.max(0.0001, mix), now)
      }
    }
    for (const voice of this.voices.values()) apply(voice)
    for (const voice of this.releasingVoices) apply(voice)
  }

  /** Retargets Osc Ctrl-dependent params on sounding synth voices (Multi
   *  detune, Super detune/width, FM index, Sync's periodic-wave peak) and the
   *  filter's type/frequency/resonance/tracking/drive. */
  private updateSynthVoiceLive(now: number): void {
    const context = this.context
    if (!context) return
    // Per-layer change detection (see appliedSynthLiveSig): only the layers
    // whose live-retarget inputs / filter parameters actually changed get
    // their sounding voices' params touched — an untouched layer's scheduled
    // filter/pitch envelope ramps keep running.
    const sectionBend = this.effectiveBend('synth')
    const liveChanged: Record<SynthLayerId, boolean> = { A: false, B: false, C: false }
    const filterChanged: Record<SynthLayerId, boolean> = { A: false, B: false, C: false }
    for (const layer of SYNTH_LAYER_IDS) {
      const layerState = this.state.synth.layers[layer]
      const f = layerState.filter
      const liveSig = `${layerState.oscCtrl}|${sectionBend}|${this.synthOscPitchCents(layer)}`
      const filterSig = `${f.type}|${f.freq}|${f.res}|${f.tracking}|${f.drive}`
      liveChanged[layer] = liveSig !== this.appliedSynthLiveSig[layer]
      filterChanged[layer] = filterSig !== this.appliedSynthFilterSig[layer]
      this.appliedSynthLiveSig[layer] = liveSig
      this.appliedSynthFilterSig[layer] = filterSig
    }
    // Nothing changed on any layer (the overwhelmingly common commit):
    // skip the voice walk entirely.
    if (!SYNTH_LAYER_IDS.some((layer) => liveChanged[layer] || filterChanged[layer])) return
    const apply = (voice: Voice) => {
      if (voice.section !== 'synth') return
      const layerState = this.state.synth.layers[voice.layer as SynthLayerId]
      const live = liveChanged[voice.layer as SynthLayerId] ? voice.synthLive : null
      if (live) {
        const oscCtrl = layerState.oscCtrl
        const bend = sectionBend
        // Osc Ctrl retargets recompute the full detune: base spread + bend +
        // the layer's Osc Pitch offset (manual p. 28).
        const pitchCents = this.synthOscPitchCents(voice.layer as SynthLayerId)
        switch (live.kind) {
          case 'multi': {
            const cents = multiDetuneCents(oscCtrl)
            // Same spread formula as voice build (8ve divides over the full
            // 4-oscillator stack even though the octave osc isn't detuned).
            const step = live.spreadDivisor > 0 ? (2 * cents) / live.spreadDivisor : 0
            live.detuned.forEach(({ source }, i) => {
              source.baseDetune = live.spreadDivisor > 0 ? -cents + step * i : 0
              rampTo(source.node.detune, source.baseDetune + bend * 100 + pitchCents, now)
            })
            break
          }
          case 'super': {
            live.detuned.forEach(({ source }, i) => {
              source.baseDetune = superDetuneCents(oscCtrl, i, live.detuned.length)
              rampTo(source.node.detune, source.baseDetune + bend * 100 + pitchCents, now)
            })
            break
          }
          case 'fm': {
            rampTo(live.modGain, fmModulationIndex(oscCtrl, live.carrierFrequency), now)
            break
          }
          case 'sync': {
            const peak = syncPeakHarmonic(oscCtrl)
            if (peak !== live.peak) {
              live.peak = peak
              live.oscillator.setPeriodicWave(syncWave(context, live.square, oscCtrl))
            }
            break
          }
          case 'sub': {
            rampTo(live.subGain, subOscGain(oscCtrl), now)
            break
          }
          case 'shapePulse': {
            const duty = shapePulseDuty(oscCtrl)
            if (Math.abs(duty - live.duty) > 0.0001) {
              live.duty = duty
              live.oscillator.setPeriodicWave(shapePulseWave(context, oscCtrl))
            }
            break
          }
          case 'shapeFold': {
            rampTo(live.driveGain, shapeFoldDriveGain(oscCtrl), now)
            if (oscCtrl !== live.quantStep) {
              live.quantStep = oscCtrl
              live.shaper.curve = shapeFoldCurve(oscCtrl)
            }
            break
          }
        }
      }
      const filter = filterChanged[voice.layer as SynthLayerId] ? voice.synthFilter : null
      if (filter) {
        const filterState = layerState.filter
        filter.driveShaper.curve = synthDriveCurve(filterState.drive)
        const baseHz = synthFilterFreqHz(filterState.freq) * synthFilterTrackingScale(filterState.tracking, voice.midi)
        filter.envBaseHz = baseHz
        const baseQ = synthFilterQ(filterState.res)
        const stageSpecs = synthFilterStageSpecs(filterState.type)
        filter.filters.forEach((biquad, i) => {
          const spec = stageSpecs[i] ?? stageSpecs[stageSpecs.length - 1]!
          biquad.type = spec.type
          rampTo(biquad.frequency, baseHz * Math.pow(2, spec.freqOctaveOffset), now)
          rampTo(biquad.Q, baseQ * spec.qMultiplier, now)
        })
      }
    }
    for (const voice of this.voices.values()) apply(voice)
    for (const voice of this.releasingVoices) apply(voice)
  }

  /** Updates every synth layer's standing LFO (waveform/rate/amount/master-
   *  clock substitution) and reconnects sounding voices whose destination
   *  just changed. */
  private updateSynthLfos(now: number): void {
    if (!this.synthChannels) return
    for (const layer of SYNTH_LAYER_IDS) {
      const channel = this.synthChannels[layer]
      const layerState = this.state.synth.layers[layer]
      const lfo = layerState.lfo
      // Runs on every store commit: skip the layer's four ramps unless its
      // LFO settings (or the master clock a synced rate reads) changed.
      if (!this.depsChanged(`synthLfo:${layer}`, [lfo, this.state.masterClock])) continue
      if (lfo.waveform !== channel.lfo.waveform) {
        channel.lfo.waveform = lfo.waveform
        channel.lfo.osc.type = lfo.waveform === 'Square' ? 'square' : lfo.waveform === 'Saw Up' || lfo.waveform === 'Saw Down' ? 'sawtooth' : 'triangle'
        const usesInvert = lfo.waveform === 'Saw Down'
        const usesSh = lfo.waveform === 'S&H'
        rampTo(channel.lfo.oscSelect.gain, usesInvert || usesSh ? 0 : 1, now)
        rampTo(channel.lfo.invertSelect.gain, usesInvert ? 1 : 0, now)
        rampTo(channel.lfo.shSelect.gain, usesSh ? 1 : 0, now)
      }
      // Synced: the Rate knob picks a beat subdivision — one LFO cycle per
      // division (manual p. 30: "presented as subdivisions of the tempo").
      const rateValue = lfo.mstClk
        ? mappings.hzToLfoRate(this.state.masterClock.bpm / 60 / mappings.clockRateDivision(lfo.rate).beats)
        : lfo.rate
      const frequencyHz = mappings.lfoRateHz(rateValue)
      rampTo(channel.lfo.osc.frequency, frequencyHz, now)
      // S&H steps at a fixed 16 Hz base rate; scale playbackRate so faster
      // Rate settings step faster, matching the oscillator waveforms' feel.
      rampTo(channel.lfo.sh.playbackRate, frequencyHz / mappings.lfoRateHz(64), now)
      // Normalized amount — each voice's destination-scale gain applies the
      // unit range (cents / Hz / index) it was built for.
      rampTo(channel.lfo.depth.gain, lfo.destination ? lfo.amount / 127 : 0, now)
    }
  }

  isRunning(): boolean {
    return this.masterGain !== null
  }

  /* ------------------------------------------------------ note lifecycle -- */

  activeVoiceCount(): number {
    return this.voices.size + this.releasingVoices.size
  }

  heldVoiceCount(): number {
    return this.voices.size
  }

  layerVoiceCount(layer: VoiceLayer, section: SectionId = 'piano'): number {
    return this.heldCounts.get(layerCode(section, layer)) ?? 0
  }

  isNoteActive(midi: number): boolean {
    for (const [section, layer] of VOICE_ADDRESSES) {
      if (this.voices.has(voiceKey(section, layer, midi))) return true
    }
    return false
  }

  /** Registers a freshly started voice in the map and the O(1) counters. */
  private trackVoice(key: number, voice: Voice): void {
    this.voices.set(key, voice)
    const code = layerCode(voice.section, voice.layer)
    this.heldCounts.set(code, (this.heldCounts.get(code) ?? 0) + 1)
    this.heldSectionCounts[voice.section] += 1
  }

  /** Removes a voice from the map (identity-checked) and the counters. */
  private untrackVoice(voice: Voice): void {
    const key = voiceKey(voice.section, voice.layer, voice.midi)
    if (this.voices.get(key) !== voice) return
    this.voices.delete(key)
    const code = layerCode(voice.section, voice.layer)
    const count = (this.heldCounts.get(code) ?? 1) - 1
    if (count > 0) this.heldCounts.set(code, count)
    else this.heldCounts.delete(code)
    this.heldSectionCounts[voice.section] = Math.max(0, this.heldSectionCounts[voice.section] - 1)
  }

  noteOn(midi: number, velocity: number): void {
    this.ensureStarted()
    if (!this.context || !this.masterGain) return
    const clamped = Math.min(1, Math.max(0, velocity))
    if (!this.channels) {
      // Minimal fallback path: single synthesized layer straight to master.
      this.startVoice('A', midi, clamped, this.masterGain, true)
      return
    }
    const state = this.state
    // B3 percussion is single-triggered (manual p. 20): it sounds only when
    // no other organ note IS SOUNDING at the moment this key goes down —
    // a chord held by the sustain pedal suppresses it just like held keys —
    // unless Percussion POLY is on (Shift + Percussion Volume, manual
    // p. 20), which lets every new key retrigger its own percussion partial.
    const allowPercussion = state.organ.percussion.poly ? true : this.heldSectionCounts.organ === 0
    for (const layer of AB_LAYERS) {
      // Keyboard zones (manual p. 39): a layer only sounds inside its
      // assigned zones; crossfades scale adjacent layers complementarily.
      if (state.layers[layer].enabled && state.piano.sectionOn) {
        const zoneGain = zoneGainFor(state.split, state.layers[layer].zone, midi)
        if (zoneGain > 0.005) this.startVoice(layer, midi, clamped, this.channels[layer].voiceBus, false, zoneGain)
      }
      if (this.organChannels && state.organ.sectionOn && state.organ.layers[layer].enabled) {
        const zoneGain = zoneGainFor(state.split, state.organ.layers[layer].zone, midi)
        if (zoneGain > 0.005) this.startOrganVoice(layer, midi, allowPercussion, zoneGain)
      }
    }
    if (this.synthChannels && state.synth.sectionOn) {
      // KBS (manual p. 41): a key pressed while NO synth key was held
      // re-syncs the running arpeggiator — checked before dispatch adds
      // this key to the held stacks.
      const keyboardWasSilent = SYNTH_LAYER_IDS.every((layer) => this.synthHeld[layer].length === 0)
      let synthKeyLanded = false
      for (const layer of SYNTH_LAYER_IDS) {
        if (!state.synth.layers[layer].enabled) continue
        const zoneGain = zoneGainFor(state.split, state.synth.layers[layer].zone, midi)
        if (zoneGain > 0.005) {
          this.synthKeyDown(layer, midi, clamped, zoneGain)
          synthKeyLanded = true
        }
      }
      if (synthKeyLanded && keyboardWasSilent && this.arpRunning && state.masterClock.kbs !== 'Off') {
        this.kbsResync(state.masterClock.kbs)
      }
    }
  }

  /** KBS re-sync (manual p. 41). On: the clock restarts NOW — the pattern's
   *  first step sounds on the key press and the beat re-anchors to it. Soft:
   *  the pattern restarts from its first step, but at the NEXT beat — the
   *  clock phase (and everything else synced to it) is left untouched. */
  private kbsResync(mode: 'On' | 'Soft'): void {
    this.arpStepIndex = 0
    this.arpNoteIndex = 0
    if (mode === 'Soft') return
    if (this.arpTimer !== null) {
      this.boundary.timers.clearTimeout(this.arpTimer)
      this.arpTimer = null
    }
    this.runArpStep()
  }

  /**
   * One synth layer's key-down (spec voice): tracks the held-note stack
   * (also the arpeggiator's shared note source), then — unless the section
   * arp is running, which sounds notes itself on its own schedule instead of
   * directly — dispatches per voice mode: Poly starts an independent voice
   * per note; Mono always retriggers the single sounding voice to the new
   * note (releasing whichever note it was on); Legato retriggers only when
   * no note was already held (a fresh attack) and otherwise glides the
   * already-sounding voice to the new frequency without a new envelope.
   * Priority (Low/High, Mono/Legato only): while a note is held, an
   * incoming lower/higher note only takes over the sounding voice if it
   * wins per the setting; losing incoming notes still join the held stack
   * so releasing the winner correctly returns to the next-priority note.
   */
  private synthKeyDown(layer: SynthLayerId, midi: number, velocity: number, zoneGain: number): void {
    const held = this.synthHeld[layer]
    const alreadyHeld = held.includes(midi)
    if (!alreadyHeld) held.push(midi)
    // Arp/Poly modes: the scheduler sounds notes itself — but only on the
    // layers the arp drives (GROUP, manual p. 36: every enabled layer with
    // Group On, the focused layer only with Group Off); other layers keep
    // sounding normally. Gate mode does NOT start notes — it rhythmically
    // gates normally-played voices (manual p. 35), so key presses must keep
    // sounding voices while it runs.
    const arp = this.state.synth.arp
    if (arp.run && arp.mode !== 'Gate' && (arp.group || layer === this.state.synth.focusedLayer)) return

    const voiceState = this.state.synth.layers[layer].voice
    if (voiceState.mode === 'Poly') {
      this.startSynthVoice(layer, midi, velocity, zoneGain)
      return
    }

    // Mono/Legato: priority decides whether this new note actually takes
    // over the sounding voice (Off always takes over — last note wins).
    const currentlySounding = this.synthSoundingMidi[layer]
    if (voiceState.priority !== 'Off' && currentlySounding !== null && alreadyHeld === false) {
      const wins = voiceState.priority === 'Low' ? midi < currentlySounding : midi > currentlySounding
      if (!wins) return // joins the held stack but does not sound
    }
    this.triggerSynthMonoVoice(layer, midi, velocity, zoneGain)
  }

  /** Starts or glides the single Mono/Legato sounding voice to `midi`. */
  private triggerSynthMonoVoice(layer: SynthLayerId, midi: number, velocity: number, zoneGain: number): void {
    const voiceState = this.state.synth.layers[layer].voice
    const previousMidi = this.synthSoundingMidi[layer]
    const previousKey = previousMidi !== null ? voiceKey('synth', layer, previousMidi) : null
    const wasSounding = previousKey !== null && this.voices.has(previousKey)
    if (voiceState.mode === 'Legato' && wasSounding) {
      this.glideSynthVoice(layer, previousMidi!, midi)
      this.synthSoundingMidi[layer] = midi
      return
    }
    // Mono (always retriggers), or Legato's first note (nothing sounding yet).
    let resumeLevel: number | undefined
    if (wasSounding) {
      const previous = this.voices.get(previousKey!)!
      // Manual p. 34: in Mono mode the envelope "restarts from the point in
      // the attack phase where the level is equal to the previous note" —
      // read the sounding level so fast mono lines never dip to silence.
      resumeLevel = previous.gain.gain.value
      this.releaseVoice(previous, QUICK_RELEASE_SECONDS)
    }
    this.startSynthVoice(layer, midi, velocity, zoneGain, true, resumeLevel)
    this.synthSoundingMidi[layer] = midi
  }

  /** Legato glide (spec voice.glide): retargets the sounding voice's source
   *  frequencies to the new note via setTargetAtTime — a constant-rate
   *  portamento, no envelope retrigger — and renames its voice-map key to
   *  the new midi so a later noteOff/noteOn addresses it correctly. */
  private glideSynthVoice(layer: SynthLayerId, fromMidi: number, toMidi: number): void {
    const context = this.context
    if (!context) return
    const key = voiceKey('synth', layer, fromMidi)
    const voice = this.voices.get(key)
    if (!voice) return
    const layerState = this.state.synth.layers[layer]
    const shifted = toMidi + layerState.octave * 12 + this.transposeOffset()
    const targetFrequency = midiToFrequency(shifted)
    const timeConstant = mappings.glideTimeConstant(layerState.voice.glide)
    const now = context.currentTime
    for (const source of voice.sources) {
      if (source.kind !== 'synth') continue
      // Every source glides at the same rate but toward its OWN multiple of
      // the fundamental (freqRatio: FM modulators keep their ratio, the Sub
      // Osc square stays an octave down; unison duplicates ride at 1).
      source.node.frequency.setTargetAtTime(targetFrequency * (source.freqRatio ?? 1), now, timeConstant)
    }
    // FM voices scale their modulation index by the carrier's pitch — track
    // the glide so a later Osc Ctrl retarget doesn't recompute the index for
    // the pre-glide note.
    const live = voice.synthLive
    if (live?.kind === 'fm') {
      live.carrierFrequency = targetFrequency
      rampTo(live.modGain, fmModulationIndex(layerState.oscCtrl, targetFrequency), now)
    }
    voice.midi = toMidi
    this.voices.delete(key)
    this.voices.set(voiceKey('synth', layer, toMidi), voice)
  }

  /* ----------------------------------------------------- arpeggiator/gate -- */

  /** Called every applyState tick: starts/stops the scheduler chain to match
   *  ARP RUN, without resetting an already-running chain (rate/mode/etc.
   *  changes are picked up live by each scheduled step reading fresh state). */
  private syncArpScheduler(now: number): void {
    const run = this.state.synth.sectionOn && this.state.synth.arp.run
    if (run && !this.arpRunning) this.startArp()
    else if (!run && this.arpRunning) this.stopArp()
    void now
  }

  private startArp(): void {
    this.arpRunning = true
    this.arpStepIndex = 0
    this.arpNoteIndex = 0
    this.arpSoundingMidi = { A: null, B: null, C: null }
    // Deterministic xorshift RNG, reseeded per run-start (spec determinism).
    this.arpRngState = 0x2f6e2b1
    this.scheduleArpStep(0)
  }

  /** `resound = false` (dispose/teardown): just halt the scheduler — there
   *  is no graph left to release voices into or re-sound held keys on. */
  private stopArp(resound = true): void {
    this.arpRunning = false
    if (this.arpTimer !== null) {
      this.boundary.timers.clearTimeout(this.arpTimer)
      this.arpTimer = null
    }
    this.arpSoundingMidi = { A: null, B: null, C: null }
    const context = this.context
    if (!context || !resound || !this.synthChannels) return
    const now = context.currentTime
    // Release every voice the scheduler was sounding — a run-off between
    // step boundaries otherwise leaves the last arp note hanging until its
    // key lifts (or forever under KB HOLD) — and re-open any half-closed
    // gate stages so normally-played voices aren't stuck dimmed.
    for (const voice of this.voices.values()) {
      if (voice.section !== 'synth') continue
      if (voice.arpDriven) {
        this.releaseVoice(voice, QUICK_RELEASE_SECONDS)
      } else if (voice.gateGain) {
        rampTo(voice.gateGain.gain, 1, now)
      }
    }
    // Held keys (physically down or KB-HOLD-latched) go back to sounding
    // normally, exactly as lifting the arp on the hardware leaves the held
    // chord ringing — through the normal per-mode dispatch so Poly starts
    // every note and Mono/Legato sounds only the priority winner. Gate mode
    // never owned the voices (key presses started them), so nothing to
    // re-sound there.
    if (this.state.synth.arp.mode === 'Gate') return
    for (const layer of SYNTH_LAYER_IDS) {
      const layerState = this.state.synth.layers[layer]
      if (!layerState.enabled || !this.state.synth.sectionOn) continue
      this.synthSoundingMidi[layer] = null
      if (layerState.voice.mode === 'Poly') {
        for (const midi of this.synthHeld[layer]) {
          const zoneGain = zoneGainFor(this.state.split, layerState.zone, midi)
          if (zoneGain > 0.005) this.startSynthVoice(layer, midi, 0.8, zoneGain)
        }
      } else if (this.synthHeld[layer].length > 0) {
        const held = this.synthHeld[layer]
        const priority = layerState.voice.priority
        const winner =
          priority === 'Low' ? Math.min(...held) : priority === 'High' ? Math.max(...held) : held[held.length - 1]!
        const zoneGain = zoneGainFor(this.state.split, layerState.zone, winner)
        if (zoneGain > 0.005) this.triggerSynthMonoVoice(layer, winner, 0.8, zoneGain)
      }
    }
  }

  private nextArpRandom(): number {
    let seed = this.arpRngState
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    this.arpRngState = seed
    return seed / 0xffffffff
  }

  private arpStepMs(): number {
    const arp = this.state.synth.arp
    // Synced: the Rate knob picks a beat subdivision (manual p. 35: "Set the
    // subdivision to 1/8 if you want the notes played as eighths").
    if (arp.mstClk) return (60000 / Math.max(1, this.state.masterClock.bpm)) * mappings.clockRateDivision(arp.rate).beats
    return 60000 / Math.max(1, mappings.arpRateBpm(arp.rate))
  }

  /** The expanded note sequence for Arp mode at the current range/direction
   *  (spec: "sound the next held note per direction expanded over range
   *  octaves"). Poly/Gate modes read the held set directly instead. */
  private arpSequenceFor(held: number[]): number[] {
    const arp = this.state.synth.arp
    const sorted = [...held].sort((a, b) => a - b)
    const expanded: number[] = []
    const whole = Math.floor(arp.range)
    for (let octave = 0; octave < whole; octave++) {
      for (const midi of sorted) expanded.push(midi + octave * 12)
    }
    // Half-step ranges add "a fifth on top" (manual p. 35: e.g. 2 octaves
    // and a fifth): the held notes once more, a fifth above the top octave.
    if (arp.range % 1 !== 0) {
      for (const midi of sorted) expanded.push(midi + (whole - 1) * 12 + 7)
    }
    if (arp.direction === 'Up') return expanded
    if (arp.direction === 'Down') return [...expanded].reverse()
    if (arp.direction === 'UpDown') {
      // A palindrome without repeating the two turnaround notes.
      const down = [...expanded].reverse()
      return expanded.length > 1 ? [...expanded, ...down.slice(1, -1)] : expanded
    }
    return expanded // Random: order is drawn fresh at each step below.
  }

  private scheduleArpStep(delayMs: number): void {
    this.arpTimer = this.boundary.timers.setTimeout(() => this.runArpStep(), delayMs)
  }

  /** Sequence index for step counter `step` (Arp mode, non-Random). Zig Zag
   *  (manual p. 35): "played notes will jump by two steps and then back one,
   *  in a given direction" — the walked positions are 0, 2, 1, 3, 2, 4, 3…
   *  (+2, -1 alternating) over the direction-expanded sequence, wrapping
   *  modulo its length. Off: the plain step order. Purely a function of the
   *  step counter, so determinism is unchanged. */
  private arpSequenceIndex(step: number, length: number, zigZag: boolean): number {
    if (!zigZag) return step % length
    const position = Math.floor(step / 2) + (step % 2 === 1 ? 2 : 0)
    return position % length
  }

  /** The layers the arp/gate drives this step (GROUP, manual p. 36):
   *  every enabled layer with Group On, the focused layer only with Group
   *  Off (this build's adaptation of the per-layer arpeggiator). */
  private arpLayerSet(): SynthLayerId[] {
    const synth = this.state.synth
    return SYNTH_LAYER_IDS.filter((layer) => synth.layers[layer].enabled && (synth.arp.group || layer === synth.focusedLayer))
  }

  /** The pattern step under the rhythm position, or null while PATTERN is
   *  off (manual p. 35-36: "the notes of the arpeggio or steps of the gate
   *  conform to the rhythm defined by the selected pattern"). */
  private arpPatternStep(): ArpPatternStep | null {
    const pattern = this.state.synth.arp.pattern
    if (!pattern.on) return null
    return pattern.steps[this.arpStepIndex % Math.max(2, pattern.length)] ?? null
  }

  private runArpStep(): void {
    if (!this.arpRunning) return
    const arp = this.state.synth.arp
    // The arp's note source is each driven layer's held set (a layer with
    // no held notes simply contributes nothing this step).
    const arpLayers = this.arpLayerSet()
    const heldByLayer = arpLayers.filter((layer) => this.synthHeld[layer].length > 0)
    // A layer that left the driven set (focus moved, Group dropped) keeps
    // its last arp note ringing otherwise — release it.
    for (const layer of SYNTH_LAYER_IDS) {
      if (arpLayers.includes(layer) || this.arpSoundingMidi[layer] === null) continue
      const voice = this.voices.get(voiceKey('synth', layer, this.arpSoundingMidi[layer]!))
      if (voice) this.releaseVoice(voice, QUICK_RELEASE_SECONDS)
      this.arpSoundingMidi[layer] = null
    }
    if (heldByLayer.length === 0 || !this.synthChannels) {
      this.scheduleArpStep(this.arpStepMs())
      return
    }
    const patternStep = this.arpPatternStep()
    // Pattern silent step: nothing sounds — Arp mode also cuts the note the
    // previous step left ringing, so the rhythm has actual holes in it.
    if (patternStep && patternStep.gate === 0) {
      for (const layer of heldByLayer) {
        if (arp.mode === 'Gate') {
          this.arpGateStep(layer, patternStep)
          continue
        }
        const sounding = this.arpSoundingMidi[layer]
        if (sounding !== null) {
          const voice = this.voices.get(voiceKey('synth', layer, sounding))
          if (voice) this.releaseVoice(voice, QUICK_RELEASE_SECONDS)
          this.arpSoundingMidi[layer] = null
        }
      }
      this.arpStepIndex++
      this.scheduleArpStep(this.arpStepMs())
      return
    }
    // Accent (manual p. 36): a velocity boost — audible only when a
    // velocity-sensitive parameter is active, exactly as the manual notes.
    const velocity = patternStep?.accent ? 1 : 0.8
    for (const layer of heldByLayer) {
      const held = this.synthHeld[layer]
      const layerState = this.state.synth.layers[layer]
      const zone = layerState.zone
      if (arp.mode === 'Gate') {
        this.arpGateStep(layer, patternStep)
        continue
      }
      if (arp.mode === 'Poly') {
        for (const midi of held) {
          const zoneGain = zoneGainFor(this.state.split, zone, midi)
          if (zoneGain > 0.005) {
            const voice = this.startSynthVoice(layer, midi, velocity, zoneGain)
            voice.arpDriven = true
            this.applyArpStepShape(voice, layer, patternStep)
          }
        }
        continue
      }
      // Arp mode: step through the direction-expanded sequence, one note
      // sounding at a time — release whatever this layer's arp was
      // sounding, then start the next step's note via the normal voice
      // path so zones/sustain stay consistent.
      const sequence = this.arpSequenceFor(held)
      if (sequence.length === 0) continue
      // Random draws a fresh index each step (there is no defined order for
      // a Zig Zag walk to traverse), so Zig Zag applies to the directed
      // orders only — the deterministic xorshift path is untouched.
      const index =
        arp.direction === 'Random'
          ? Math.floor(this.nextArpRandom() * sequence.length)
          : this.arpSequenceIndex(this.arpNoteIndex, sequence.length, arp.zigZag)
      const midi = sequence[index]!
      const previous = this.arpSoundingMidi[layer]
      if (previous !== null && previous !== midi) {
        const previousVoice = this.voices.get(voiceKey('synth', layer, previous))
        if (previousVoice) this.releaseVoice(previousVoice, QUICK_RELEASE_SECONDS)
      }
      const zoneGain = zoneGainFor(this.state.split, zone, midi)
      if (zoneGain > 0.005) {
        const voice = this.startSynthVoice(layer, midi, velocity, zoneGain)
        voice.arpDriven = true
        this.applyArpStepShape(voice, layer, patternStep)
        this.arpSoundingMidi[layer] = midi
      }
    }
    this.arpStepIndex++
    this.arpNoteIndex++
    this.scheduleArpStep(this.arpStepMs())
  }

  /** Pattern shaping for one arp-started voice (manual p. 36): a normal
   *  step (gate 1) closes its dedicated gate stage at ~60% of the step —
   *  Long (gate 2) rings into the next step's release instead — and a
   *  panned step routes the voice through a StereoPanner before the layer
   *  bus (Pattern Pan, "Left, Center and Right in the stereo panorama"). */
  private applyArpStepShape(voice: Voice, layer: SynthLayerId, patternStep: ArpPatternStep | null): void {
    const context = this.context
    if (!patternStep || !context || !this.synthChannels) return
    const now = context.currentTime
    const gate = voice.gateGain
    if (patternStep.gate === 1 && gate) {
      const stepSeconds = this.arpStepMs() / 1000
      gate.gain.setTargetAtTime(0.0001, now + stepSeconds * 0.6, stepSeconds * 0.06)
    }
    if (patternStep.pan !== 'C' && gate) {
      const bus = this.synthChannels[layer].voiceBus
      const panner = context.createStereoPanner()
      panner.pan.setValueAtTime(patternStep.pan === 'L' ? -0.8 : 0.8, now)
      gate.disconnect(bus)
      gate.connect(panner)
      panner.connect(bus)
      voice.ownedNodes.push(panner)
    }
  }

  /** Gate mode (spec: "do not retrigger — modulate the sounding synth voice
   *  gains with a gate envelope whose hardness comes from the range knob's
   *  repurposed value"): pulses every currently-sounding voice of the layer
   *  between full and a hardness-scaled floor, without starting new voices.
   *  With PATTERN on (manual p. 35: "the steps of the gate conform to the
   *  rhythm defined by the selected pattern") a silent step stays closed,
   *  a Long step stays open, and an accent pulses to full against a
   *  slightly ducked normal peak. */
  private arpGateStep(layer: SynthLayerId, patternStep: ArpPatternStep | null = null): void {
    const context = this.context
    if (!context) return
    const arp = this.state.synth.arp
    const now = context.currentTime
    const stepSeconds = this.arpStepMs() / 1000
    const hardness = arp.range / 4 // range 1..4 repurposed as gate hardness
    const floor = Math.max(0.0001, 1 - hardness) // harder = deeper gate dips
    const onFraction = 0.5 + hardness * 0.3 // harder = shorter, punchier gate-on
    const peak = patternStep ? (patternStep.accent ? 1 : 0.75) : 1
    for (const voice of this.voices.values()) {
      if (voice.section !== 'synth' || voice.layer !== layer) continue
      // Pulse the dedicated gate stage between the peak and the hardness
      // floor; the amp envelope's own gain keeps every ramp it scheduled at
      // note-on.
      const gate = voice.gateGain
      if (!gate) continue
      gate.gain.cancelScheduledValues(now)
      if (patternStep && patternStep.gate === 0) {
        // Silent pattern step: the gate stays closed for the whole step.
        gate.gain.setTargetAtTime(floor, now, stepSeconds * 0.08)
        continue
      }
      gate.gain.setValueAtTime(peak, now)
      if (patternStep?.gate === 2) continue // Long: open for the whole step
      gate.gain.setTargetAtTime(floor, now, stepSeconds * 0.08)
      gate.gain.setTargetAtTime(peak, now + stepSeconds * onFraction, stepSeconds * 0.08)
    }
  }

  /** Deterministic per-section, per-layer voice stealing: drop the oldest held voice past the cap. */
  private stealPastCap(section: SectionId, layer: VoiceLayer): void {
    while (this.layerVoiceCount(layer, section) >= MAX_POLYPHONY) {
      let oldest: Voice | null = null
      for (const voice of this.voices.values()) {
        if (voice.section === section && voice.layer === layer && (!oldest || voice.seq < oldest.seq)) oldest = voice
      }
      if (!oldest) break
      this.releaseVoice(oldest, QUICK_RELEASE_SECONDS)
    }
  }

  /** Pops a recycled Voice bookkeeping object (or builds the first one) and
   *  resets every field for a fresh key press; `gain` becomes the first owned
   *  node, matching the old `[gain]` literal each start* function built. */
  private acquireVoice(section: SectionId, layer: VoiceLayer, midi: number, gain: GainNodeLike): Voice {
    const voice = this.voicePool.pop() ?? {
      section,
      layer,
      midi,
      seq: 0,
      keyDown: true,
      sustained: false,
      sostenuto: false,
      releasing: false,
      synthFallback: false,
      sources: [],
      ownedNodes: [],
      lfoFeeds: [],
      vibratoFeeds: [],
      gain,
      cleanupTimer: null,
      organLive: null,
      synthLive: null,
      synthFilter: null,
      arpDriven: false,
      gateGain: null,
    }
    voice.section = section
    voice.layer = layer
    voice.midi = midi
    voice.seq = this.seqCounter++
    voice.keyDown = true
    voice.sustained = false
    voice.sostenuto = false
    voice.releasing = false
    voice.synthFallback = false
    voice.gain = gain
    voice.cleanupTimer = null
    voice.organLive = null
    voice.synthLive = null
    voice.synthFilter = null
    voice.arpDriven = false
    voice.gateGain = null
    voice.ownedNodes.push(gain)
    return voice
  }

  private startVoice(
    layer: LayerId,
    midi: number,
    velocity: number,
    bus: AudioNodeLike,
    forceSynth: boolean,
    zoneGain = 1,
  ): void {
    const context = this.context!
    const key = voiceKey('piano', layer, midi)
    const existing = this.voices.get(key)
    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    this.stealPastCap('piano', layer)

    const layerState = this.state.layers[layer]
    const shifted = midi + (forceSynth ? 0 : layerState.octave * 12) + this.transposeOffset()
    const touched = applyTouchCurve(velocity, this.state.piano.kbTouch)
    const soft = this.softDown ? 0.72 : 1

    const now = context.currentTime
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    const voice = this.acquireVoice('piano', layer, midi, gain)
    const ownedNodes = voice.ownedNodes
    const sources = voice.sources
    let synthFallback = false

    const instrumentId = forceSynth ? null : selectedInstrumentId(layerState)
    const spec = instrumentId ? getInstrument(instrumentId) : null
    const loaded = spec ? this.instrumentStatus.get(spec.id) === 'ready' : false
    const failed = spec ? this.instrumentStatus.get(spec.id) === 'error' : false

    if (spec && loaded) {
      this.buildSampleSources(spec, shifted, touched * soft, gain, ownedNodes, sources)
      const peak = (0.1 + 0.8 * Math.pow(touched, 1.3)) * soft * zoneGain
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), now + 0.004)
    } else if (failed || forceSynth) {
      // Labeled synthesized fallback (primary sample failure or minimal path).
      synthFallback = true
      this.buildSynthSources(shifted, touched * soft, gain, ownedNodes, sources, now, zoneGain)
    }
    // Otherwise the voice is tracked but silent: either the instrument is
    // still loading (status truthfully reports loading) or the selected type
    // has no bundled model ("Piano not found") — nothing pretends to sound.

    gain.connect(bus)
    voice.synthFallback = synthFallback
    this.trackVoice(key, voice)
  }

  /* --------------------------------------------------------- organ voices -- */

  private startOrganVoice(layer: LayerId, midi: number, allowPercussion: boolean, zoneGain = 1): void {
    const context = this.context!
    const channel = this.organChannels![layer]
    const key = voiceKey('organ', layer, midi)
    const existing = this.voices.get(key)
    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    this.stealPastCap('organ', layer)

    const layerState = this.state.organ.layers[layer]
    // Preset On = stored registration; Drawbar Live = physical pose (manual p. 19/21).
    const drawbars = this.effectiveOrganDrawbars(layer)
    const recipe = ORGAN_MODEL_RECIPES[layerState.model]
    const fundamental = midiToFrequency(midi + layerState.octave * 12 + this.transposeOffset())
    const bend = this.effectiveBend('organ')
    const now = context.currentTime

    // Organs are not velocity sensitive: a fixed fast attack, no touch curve.
    // Zone crossfades still scale the voice (manual p. 39).
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, zoneGain), now + 0.004)
    const voice = this.acquireVoice('organ', layer, midi, gain)
    const ownedNodes = voice.ownedNodes
    const sources = voice.sources

    // Vox tone mix: partials feed dark (lowpassed) and bright paths that the
    // 9th drawbar crossfades (manual p. 21).
    let entry: AudioNodeLike = gain
    let voxMix: OrganVoiceLive['voxMix'] = null
    if (recipe.voxToneMix) {
      const bus = context.createGain()
      const darkFilter = context.createBiquadFilter()
      darkFilter.type = 'lowpass'
      darkFilter.frequency.value = 1100
      darkFilter.Q.value = 0.5
      const dark = context.createGain()
      const bright = context.createGain()
      const mix = (drawbars[8] ?? 0) / 8
      dark.gain.value = Math.max(0.0001, 1 - mix)
      bright.gain.value = Math.max(0.0001, mix)
      bus.connect(darkFilter)
      darkFilter.connect(dark)
      dark.connect(gain)
      bus.connect(bright)
      bright.connect(gain)
      ownedNodes.push(bus, darkFilter, dark, bright)
      entry = bus
      voxMix = { dark, bright }
    }

    const partials: OrganVoiceLive['partials'] = []
    const frequencyCap = Math.min(9000, context.sampleRate * 0.45)
    for (const partial of recipe.partials) {
      const frequency = fundamental * partial.ratio
      if (frequency > frequencyCap) continue // top tonewheels are simply absent
      const osc = context.createOscillator()
      osc.type = partial.wave
      osc.frequency.value = frequency
      const baseDetune = partial.detune ?? 0
      osc.detune.value = baseDetune + bend * 100
      const level = partial.level * ORGAN_PARTIAL_LEVEL
      const partialGain = context.createGain()
      partialGain.gain.value = Math.max(
        0.0001,
        drawbarPartialGain(recipe, drawbars[partial.drawbar] ?? 0) * level,
      )
      osc.connect(partialGain)
      partialGain.connect(entry)
      osc.start(now)
      ownedNodes.push(partialGain)
      sources.push({ kind: 'synth', node: osc, baseDetune })
      partials.push({ drawbar: partial.drawbar, level, gain: partialGain })
    }

    // B3 percussion: a single decaying 2nd/3rd-harmonic partial (manual p. 20).
    const percussion = this.state.organ.percussion
    if (recipe.percussion && percussion.on && allowPercussion) {
      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = Math.min(frequencyCap, fundamental * (percussion.third ? 3 : 2))
      osc.detune.value = bend * 100
      const peak = percussion.soft ? 0.09 : 0.2
      const decay = percussion.fast ? 0.09 : 0.28
      const percGain = context.createGain()
      percGain.gain.setValueAtTime(peak, now)
      percGain.gain.setTargetAtTime(0.0001, now + 0.004, decay)
      osc.connect(percGain)
      percGain.connect(gain)
      osc.start(now)
      try {
        osc.stop(now + decay * 5 + 0.2)
      } catch {
        /* stays until voice cleanup */
      }
      ownedNodes.push(percGain)
      sources.push({ kind: 'synth', node: osc, baseDetune: 0 })
    }

    // Attack transient: B3 key click or pipe chiff (generated, declared).
    if (recipe.click) {
      const source = context.createBufferSource()
      source.buffer = recipe.click === 'b3' ? this.getOrganClick(context) : this.getOrganChiff(context)
      const filter = context.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = recipe.click === 'b3' ? 2600 : Math.min(6000, fundamental * 3)
      filter.Q.value = 1
      const clickGain = context.createGain()
      // Sound menu 6 (manual p. 58): B3 Key Click level Normal/High.
      const clickBoost = recipe.click === 'b3' && this.state.globalSettings.b3ClickLevel === 'High' ? 2 : 1
      clickGain.gain.value = (recipe.click === 'b3' ? 0.06 : 0.1) * clickBoost
      source.connect(filter)
      filter.connect(clickGain)
      clickGain.connect(gain)
      source.start(now)
      ownedNodes.push(filter, clickGain)
      sources.push({ kind: 'sample', node: source, baseRate: 1 })
    }

    gain.connect(channel.voiceBus)
    voice.organLive = { model: layerState.model, partials, voxMix }
    this.trackVoice(key, voice)
  }

  /* -------------------------------------------------------- synth voices -- */

  private startSynthVoice(
    layer: SynthLayerId,
    midi: number,
    velocity: number,
    zoneGain = 1,
    releasePrevious = true,
    resumeLevel?: number,
  ): Voice {
    const context = this.context!
    const channel = this.synthChannels![layer]
    const key = voiceKey('synth', layer, midi)
    const existing = this.voices.get(key)
    if (existing && releasePrevious) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    this.stealPastCap('synth', layer)

    const layerState = this.state.synth.layers[layer]
    const wave = SYNTH_WAVEFORMS[layerState.waveform] ?? SYNTH_WAVEFORMS[0]!
    const shifted = midi + layerState.octave * 12 + this.transposeOffset()
    const frequency = midiToFrequency(shifted)
    const bend = this.effectiveBend('synth')
    // Osc Pitch (manual p. 28: -24..+24 st + ±50 c fine tune): a per-layer
    // detune offset summed onto every source oscillator's detune (Analog) or
    // folded into the playbackRate pitch factor (Samples/noise loop) — the
    // same two paths the pitch bend rides, so live retargeting reuses
    // applyBendToVoices.
    const pitchCents = this.synthOscPitchCents(layer)
    const now = context.currentTime

    const envelope = layerState.ampEnvelope
    const floor = SYNTH_VELOCITY_FLOOR[envelope.velocity]
    const velocityShaped = envelope.velocity === 0 ? 1 : floor + (1 - floor) * velocity
    const peak = Math.max(0.0005, SYNTH_OSC_LEVEL * velocityShaped * zoneGain)
    const attackSeconds = Math.max(0.001, synthAttackSeconds(envelope.attack))

    const gain = context.createGain()
    // Mono retrigger (manual p. 34): resume the attack from the previous
    // note's sounding level. The remaining ramp time is the unfinished part
    // of the exponential attack, so the slope stays identical.
    const startFrom = Math.min(Math.max(0.0001, resumeLevel ?? 0.0001), peak)
    const attackDone = Math.log(startFrom / 0.0001) / Math.log(peak / 0.0001)
    const attackRemaining = Math.max(0.001, attackSeconds * (1 - Math.min(1, Math.max(0, attackDone))))
    gain.gain.setValueAtTime(startFrom, now)
    gain.gain.exponentialRampToValueAtTime(peak, now + attackRemaining)
    const decaySeconds = synthDecaySeconds(envelope.decay)
    if (decaySeconds !== null) gain.gain.setTargetAtTime(Math.max(0.0001, peak * 0.001), now + attackRemaining, decaySeconds)

    const voice = this.acquireVoice('synth', layer, midi, gain)
    const ownedNodes = voice.ownedNodes
    const sources = voice.sources
    let synthLive: SynthVoiceLive = null
    // Basic oscillator type unison duplicates re-play (spec: "reuse the
    // piano unison pattern" — a simplified single-oscillator stack per
    // duplicate, not a full per-category rebuild).
    let unisonOscType = 'sawtooth'

    // Samples mode (spec.scope.optional): AudioBufferSource voices from the
    // bundled SYNTH_SAMPLE_SETS, nearest-root + playbackRate pitch shift —
    // instead of the oscillator switch below. OSC CTRL has no effect (like
    // Wave); the WAVE list (the `waveform` field, reused) selects between
    // the two sample sets, clamped to that 2-item list.
    if (layerState.mode === 'Samples') {
      const setIndex = Math.max(0, Math.min(SYNTH_SAMPLE_SETS.length - 1, layerState.waveform))
      const set = SYNTH_SAMPLE_SETS[setIndex]!
      const buildSampleVoice = (detuneCents: number, panValue: number | null, levelScale: number): void => {
        const zone = nearestSynthZone(set, shifted)
        const buffer = this.sampleCache.get(zone.file)
        const source = context.createBufferSource()
        if (buffer) source.buffer = buffer
        const baseRate = Math.pow(2, (shifted - zone.rootMidi) / 12) * Math.pow(2, detuneCents / 1200)
        // Osc Pitch rides the same playbackRate pitch factor as the bend
        // (the manual's Samples-mode Pitch/Fine Tune, p. 28).
        source.playbackRate.value = baseRate * Math.pow(2, (bend * 100 + pitchCents) / 1200)
        // Declared per-set level (spec-consistent with the piano sample
        // pattern's `spec.gain`): each recorded set carries its own gain so
        // the two sets sit at a comparable perceived level.
        const levelGain = context.createGain()
        levelGain.gain.value = set.gain * levelScale
        source.connect(levelGain)
        ownedNodes.push(levelGain)
        let node: AudioNodeLike = levelGain
        if (panValue !== null) {
          const panner = context.createStereoPanner()
          panner.pan.value = panValue
          levelGain.connect(panner)
          node = panner
          ownedNodes.push(panner)
        }
        node.connect(gain)
        source.start(now)
        sources.push({ kind: 'sample', node: source, baseRate })
      }
      buildSampleVoice(0, null, 1)
      unisonOscType = 'sawtooth' // unused in Samples mode; kept for type continuity below
      const unisonLevel = layerState.voice.unison
      if (unisonLevel > 0) {
        for (const side of UNISON_SIDES) {
          buildSampleVoice(side * (5 + unisonLevel * 6), side * (0.25 + unisonLevel * 0.18), 0.35 + unisonLevel * 0.08)
        }
      }
    } else {
      const oscCtrlActive = oscCtrlActiveFor(wave.category)
      const oscCtrl = oscCtrlActive ? layerState.oscCtrl : 0

      // Sync/Multi/Super/Shape Pulse get a real, audio-rate "Osc Ctrl live
      // target" gain that sums into their oscillator(s)' detune as an
      // additive offset — a declared approximation (their Osc Ctrl math is
      // JS-computed, not a single linear AudioParam) that still gives the
      // oscillator envelope's non-toPitch mode and the LFO's "Osc Ctrl"
      // destination a real, audible connection. FM-H/FM-I need no such gain:
      // their modulation-index gain IS already that live target, connected
      // directly below; Sub Osc's sub-level gain and Shape Sine's fold-drive
      // gain are likewise already real linear params, connected in their own
      // case blocks; Wave has no Osc Ctrl target at all.
      const usesDeclaredOscCtrlGain =
        wave.category === 'Sync' || wave.category === 'Multi' || wave.category === 'Super' || wave.name === 'Shape Pulse'
      let oscCtrlGain: GainNodeLike | null = null
      if (oscCtrlActive && usesDeclaredOscCtrlGain) {
        oscCtrlGain = context.createGain()
        oscCtrlGain.gain.value = 0
        ownedNodes.push(oscCtrlGain)
      }

    switch (wave.category) {
      case 'Pure': {
        if (wave.name === 'White Noise') {
          const source = context.createBufferSource()
          source.buffer = this.getSynthNoiseLoop(context)
          source.loop = true
          // The noise loop is a sample-kind source: bend/Osc Pitch shift its
          // playbackRate (spectral tilt), matching applyBendToVoices'
          // retarget formula for sounding voices.
          source.playbackRate.value = Math.pow(2, (bend * 100 + pitchCents) / 1200)
          source.connect(gain)
          source.start(now)
          sources.push({ kind: 'sample', node: source, baseRate: 1 })
        } else {
          const osc = context.createOscillator()
          if (wave.name === 'Sine') osc.type = 'sine'
          else if (wave.name === 'Triangle') osc.type = 'triangle'
          else if (wave.name === 'Saw') osc.type = 'sawtooth'
          else if (wave.name === 'Square') osc.type = 'square'
          else if (wave.name === 'Pulse 33') osc.setPeriodicWave(pulse33Wave(context))
          else osc.setPeriodicWave(pulse10Wave(context)) // Pulse 10
          osc.frequency.value = frequency
          osc.detune.value = bend * 100 + pitchCents
          osc.connect(gain)
          osc.start(now)
          sources.push({ kind: 'synth', node: osc, baseDetune: 0 })
          unisonOscType = osc.type
        }
        break
      }
      case 'Sync': {
        const square = wave.name === 'Sync Square'
        const osc = context.createOscillator()
        osc.setPeriodicWave(syncWave(context, square, oscCtrl))
        osc.frequency.value = frequency
        osc.detune.value = bend * 100 + pitchCents
        oscCtrlGain!.connect(osc.detune)
        osc.connect(gain)
        osc.start(now)
        sources.push({ kind: 'synth', node: osc, baseDetune: 0 })
        synthLive = { kind: 'sync', square, oscillator: osc, peak: syncPeakHarmonic(oscCtrl), oscCtrlParam: oscCtrlGain!.gain }
        break
      }
      case 'Multi': {
        const eightVe = wave.name === 'Multi Saw 8ve'
        const count = eightVe ? 4 : 3
        const cents = multiDetuneCents(oscCtrl)
        const step = (2 * cents) / (count - 1)
        const detuned: LiveDetunedSource[] = []
        for (let i = 0; i < count; i++) {
          const osc = context.createOscillator()
          osc.type = 'sawtooth'
          const octaveUp = eightVe && i === count - 1
          const baseDetune = octaveUp ? 0 : count > 1 ? -cents + step * i : 0
          osc.frequency.value = frequency * (octaveUp ? 2 : 1)
          osc.detune.value = baseDetune + bend * 100 + pitchCents
          oscCtrlGain!.connect(osc.detune)
          const oscGain = context.createGain()
          oscGain.gain.value = octaveUp ? 0.5 : 1
          osc.connect(oscGain)
          oscGain.connect(gain)
          osc.start(now)
          ownedNodes.push(oscGain)
          const source: VoiceSource & { kind: 'synth' } = { kind: 'synth', node: osc, baseDetune }
          sources.push(source)
          if (!octaveUp) detuned.push({ source })
        }
        // 8ve excludes the octave oscillator from `detuned`, so the live
        // retarget needs the BUILD's spread divisor (count - 1), not the
        // detuned array length.
        synthLive = { kind: 'multi', detuned, spreadDivisor: count - 1, oscCtrlParam: oscCtrlGain!.gain }
        break
      }
      case 'Super': {
        const square = wave.name === 'Super Square'
        const count = 7
        const detuned: LiveDetunedSource[] = []
        for (let i = 0; i < count; i++) {
          const osc = context.createOscillator()
          osc.type = square ? 'square' : 'sawtooth'
          const baseDetune = superDetuneCents(oscCtrl, i, count)
          osc.frequency.value = frequency
          osc.detune.value = baseDetune + bend * 100 + pitchCents
          oscCtrlGain!.connect(osc.detune)
          const panner = context.createStereoPanner()
          panner.pan.value = count > 1 ? (i / (count - 1) - 0.5) * 1.6 : 0
          const oscGain = context.createGain()
          oscGain.gain.value = 1 / count
          osc.connect(oscGain)
          oscGain.connect(panner)
          panner.connect(gain)
          osc.start(now)
          ownedNodes.push(oscGain, panner)
          const source: VoiceSource & { kind: 'synth' } = { kind: 'synth', node: osc, baseDetune }
          sources.push(source)
          detuned.push({ source })
        }
        synthLive = { kind: 'super', detuned, oscCtrlParam: oscCtrlGain!.gain }
        break
      }
      case 'FM-H':
      case 'FM-I': {
        const carrier = context.createOscillator()
        carrier.type = 'sine'
        carrier.frequency.value = frequency
        carrier.detune.value = bend * 100 + pitchCents
        const modulator = context.createOscillator()
        modulator.type = 'sine'
        // FM-H's 'FM 2-op' uses a 1:1 (harmonic) ratio (algorithm A); FM-I's
        // 'FM 2-op B' uses the inharmonic 1.414 ratio instead (spec: "FM
        // Inharmonic algorithms") — otherwise identical 2-op FM structure.
        modulator.frequency.value = wave.category === 'FM-I' ? frequency * FM_INHARMONIC_RATIO : frequency
        // The modulator detunes with the carrier so bend/Osc Pitch preserve
        // the FM ratio — matching applyBendToVoices, which retargets both.
        modulator.detune.value = bend * 100 + pitchCents
        const modGain = context.createGain()
        modGain.gain.value = fmModulationIndex(oscCtrl, frequency)
        modulator.connect(modGain)
        modGain.connect(carrier.frequency)
        carrier.connect(gain)
        modulator.start(now)
        carrier.start(now)
        ownedNodes.push(modGain)
        sources.push({ kind: 'synth', node: carrier, baseDetune: 0 })
        sources.push({
          kind: 'synth',
          node: modulator,
          baseDetune: 0,
          freqRatio: wave.category === 'FM-I' ? FM_INHARMONIC_RATIO : 1,
        })
        synthLive = { kind: 'fm', modGain: modGain.gain, carrierFrequency: frequency, oscCtrlParam: modGain.gain }
        break
      }
      case 'Sub': {
        // Sub Osc: main osc (Saw Sub -> sawtooth, Square Sub -> square) plus
        // a real square sub-oscillator one octave down; Osc Ctrl = sub level
        // (0..1 gain, live-retargetable) — true synthesis, no approximation.
        const mainType = wave.name === 'Square Sub' ? 'square' : 'sawtooth'
        const main = context.createOscillator()
        main.type = mainType
        main.frequency.value = frequency
        main.detune.value = bend * 100 + pitchCents
        main.connect(gain)
        main.start(now)
        sources.push({ kind: 'synth', node: main, baseDetune: 0 })
        unisonOscType = mainType

        const sub = context.createOscillator()
        sub.type = 'square'
        sub.frequency.value = frequency / 2
        sub.detune.value = bend * 100 + pitchCents
        const subGain = context.createGain()
        subGain.gain.value = subOscGain(oscCtrl)
        sub.connect(subGain)
        subGain.connect(gain)
        sub.start(now)
        ownedNodes.push(subGain)
        sources.push({ kind: 'synth', node: sub, baseDetune: 0, freqRatio: 0.5 })
        synthLive = { kind: 'sub', subGain: subGain.gain, oscCtrlParam: subGain.gain }
        break
      }
      case 'Shape': {
        // Shape Pulse: a PeriodicWave pulse whose duty follows Osc Ctrl,
        // rebuilt on quantized ctrl steps exactly like Sync's peak-harmonic
        // wave rebuild; the same declared detune-summed approximation gain
        // as the other non-FM-H categories gives the oscillator envelope
        // and LFO "Osc Ctrl" destination a real connection.
        const osc = context.createOscillator()
        osc.setPeriodicWave(shapePulseWave(context, oscCtrl))
        osc.frequency.value = frequency
        osc.detune.value = bend * 100 + pitchCents
        oscCtrlGain!.connect(osc.detune)
        osc.connect(gain)
        osc.start(now)
        sources.push({ kind: 'synth', node: osc, baseDetune: 0 })
        synthLive = { kind: 'shapePulse', oscillator: osc, duty: shapePulseDuty(oscCtrl), oscCtrlParam: oscCtrlGain!.gain }
        break
      }
      case 'ShapeSine': {
        // Shape Sine: sine through a wavefolding waveshaper; Osc Ctrl is a
        // LIVE pre-shaper drive gain (fold amount) — the fold curve itself
        // only rebuilds on quantized ctrl steps (Sync's quantization
        // convention), same as Shape Pulse above. Split into its own
        // category (spec.scope.optional lists "Shape" and "Shape Sine" as
        // separate categories) even though both share a wavefold/duty family
        // flavor.
        const osc = context.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = frequency
        osc.detune.value = bend * 100 + pitchCents
        const driveGain = context.createGain()
        driveGain.gain.value = shapeFoldDriveGain(oscCtrl)
        const shaper = context.createWaveShaper()
        shaper.curve = shapeFoldCurve(oscCtrl)
        osc.connect(driveGain)
        driveGain.connect(shaper)
        shaper.connect(gain)
        osc.start(now)
        ownedNodes.push(driveGain, shaper)
        sources.push({ kind: 'synth', node: osc, baseDetune: 0 })
        synthLive = { kind: 'shapeFold', driveGain: driveGain.gain, shaper, quantStep: oscCtrl, oscCtrlParam: driveGain.gain }
        break
      }
      case 'Wave': {
        // Wave Organ / Wave Formant: two fixed digital PeriodicWaves. Osc
        // Ctrl has no effect for this category (spec-consistent with Pure's
        // "No effect" rule) — no oscCtrlGain is even created (oscCtrlActiveFor
        // returns false for 'Wave'), so this is a plain oscillator voice.
        const osc = context.createOscillator()
        osc.setPeriodicWave(wave.name === 'Wave Formant' ? waveFormantWave(context) : waveOrganWave(context))
        osc.frequency.value = frequency
        osc.detune.value = bend * 100 + pitchCents
        osc.connect(gain)
        osc.start(now)
        sources.push({ kind: 'synth', node: osc, baseDetune: 0 })
        break
      }
      }

      // Unison (spec voice.unisonLevels): detuned duplicate source stacks,
      // reusing the piano unison pattern (buildSampleSources) scaled by
      // level 1..3 — each duplicate re-plays the layer's fundamental
      // waveform at a small detune, panned to opposite sides, feeding the
      // same voice `gain` so the shared envelope/filter/LFO/vibrato stage
      // still applies once.
      const unisonLevel = layerState.voice.unison
      if (unisonLevel > 0) {
        for (const side of UNISON_SIDES) {
          const osc = context.createOscillator()
          osc.type = unisonOscType
          osc.frequency.value = frequency
          const baseDetune = side * (5 + unisonLevel * 6)
          osc.detune.value = baseDetune + bend * 100 + pitchCents
          const panner = context.createStereoPanner()
          panner.pan.value = side * (0.25 + unisonLevel * 0.18)
          const unisonGain = context.createGain()
          unisonGain.gain.value = 0.35 + unisonLevel * 0.08
          osc.connect(unisonGain)
          unisonGain.connect(panner)
          panner.connect(gain)
          osc.start(now)
          ownedNodes.push(unisonGain, panner)
          sources.push({ kind: 'synth', node: osc, baseDetune })
        }
      }
    }

    // Oscillator envelope (spec envelopes.oscillator): schedules pitch
    // retarget (toPitch: every source oscillator's detune, or — in Samples
    // mode — every buffer source's playbackRate, spec: "osc envelope toPitch
    // retargets playbackRate") or the live Osc Ctrl target (the same per-
    // category param the LFO's Osc Ctrl destination and Osc Ctrl live-
    // retargeting use; no effect in Samples mode), bipolar around 64 = 0.
    const oscEnv = layerState.oscEnvelope
    // One pass over sources, shared with the LFO/vibrato hookup below —
    // replaces four per-press filter/map array chains (iteration 23 GC pass).
    const oscillatorNodes: OscillatorNodeLike[] = []
    const sampleVoiceSources: Array<VoiceSource & { kind: 'sample' }> = []
    for (const source of sources) {
      if (source.kind === 'synth') oscillatorNodes.push(source.node)
      else sampleVoiceSources.push(source)
    }
    const isSamplesMode = layerState.mode === 'Samples'
    const oscEnvTarget: AudioParamLike | AudioParamLike[] | null = oscEnv.toPitch
      ? isSamplesMode
        ? sampleVoiceSources.map((source) => source.node.playbackRate)
        : oscillatorNodes.map((osc) => osc.detune)
      : isSamplesMode
        ? null // Osc Ctrl has no effect in Samples mode
        : (synthLive?.oscCtrlParam ?? null)
    if (oscEnvTarget) {
      const oscAttack = Math.max(0.001, synthAttackSeconds(oscEnv.attack))
      const oscFloor = oscEnv.velocity ? 0.05 + 0.95 * velocity : 1
      const target = oscEnv.toPitch ? oscEnvPitchCents(oscEnv.amount) : oscEnvCtrlOffset(oscEnv.amount)
      const peakOffset = target * oscFloor
      if (Math.abs(peakOffset) > 0.0001) {
        const oscDecaySeconds = synthDecaySeconds(oscEnv.decay)
        for (const param of Array.isArray(oscEnvTarget) ? oscEnvTarget : [oscEnvTarget]) {
          // Samples-mode toPitch retargets a playback-rate ratio: the same
          // bipolar cents amount converts to a rate multiplier so the sweep
          // reads as pitch, not raw rate cents.
          const peakValue = isSamplesMode && oscEnv.toPitch ? param.value * Math.pow(2, peakOffset / 1200) : param.value + peakOffset
          param.setValueAtTime(param.value, now)
          param.linearRampToValueAtTime(peakValue, now + oscAttack)
          if (oscDecaySeconds !== null) param.setTargetAtTime(param.value, now + oscAttack, oscDecaySeconds)
        }
      }
    }

    // Filter + drive stage: the source mix (`gain`) feeds the drive
    // waveshaper (bypassed at drive 0) — and, for LP M, an always-on fixed
    // pre-shaper first — into one or two cascaded biquad filter stages
    // (LP24/LP M/LP+HP; see synthFilterStageSpecs), whose output — not
    // `gain` — connects onward.
    const filterState = layerState.filter
    let filterOut: AudioNodeLike = gain
    let synthFilter: SynthVoiceFilter | null = null
    if (filterState.on) {
      const driveShaper = context.createWaveShaper()
      driveShaper.curve = synthDriveCurve(filterState.drive)
      const baseHz = synthFilterFreqHz(filterState.freq) * synthFilterTrackingScale(filterState.tracking, midi)
      const stageSpecs = synthFilterStageSpecs(filterState.type)
      const filters: BiquadFilterNodeLike[] = []
      let node: AudioNodeLike = driveShaper
      let lpMPreShaper: WaveShaperNodeLike | null = null
      if (filterState.type === 'LP M') {
        lpMPreShaper = context.createWaveShaper()
        lpMPreShaper.curve = lpMDriveCurve()
        node.connect(lpMPreShaper)
        node = lpMPreShaper
        ownedNodes.push(lpMPreShaper)
      }
      for (const spec of stageSpecs) {
        const biquad = context.createBiquadFilter()
        biquad.type = spec.type
        biquad.Q.value = synthFilterQ(filterState.res) * spec.qMultiplier
        biquad.frequency.value = baseHz * Math.pow(2, spec.freqOctaveOffset)
        node.connect(biquad)
        node = biquad
        filters.push(biquad)
      }
      gain.connect(driveShaper)
      ownedNodes.push(driveShaper, ...filters)
      filterOut = node
      synthFilter = { driveShaper, filters, envBaseHz: baseHz, lpMPreShaper }

      // Filter envelope (spec envelopes.filter): ramps cutoff from the base
      // toward the envAmount-scaled peak and back (decay=127 holds at the
      // peak, matching the shared sustain-mode convention). Each stage keeps
      // its own octave offset (LP+HP's HP stage stays 2 octaves below).
      const filterEnv = filterState.envelope
      const filterAttack = Math.max(0.001, synthAttackSeconds(filterEnv.attack))
      const envFloor = filterEnv.velocity ? 0.05 + 0.95 * velocity : 1
      const peakHz = baseHz + (synthFilterEnvPeakHz(baseHz, filterState.envAmount) - baseHz) * envFloor
      if (Math.abs(peakHz - baseHz) > 0.5) {
        filters.forEach((biquad, i) => {
          const offset = Math.pow(2, stageSpecs[i]!.freqOctaveOffset)
          biquad.frequency.setValueAtTime(baseHz * offset, now)
          biquad.frequency.linearRampToValueAtTime(peakHz * offset, now + filterAttack)
          const filterDecaySeconds = synthDecaySeconds(filterEnv.decay)
          if (filterDecaySeconds !== null) biquad.frequency.setTargetAtTime(baseHz * offset, now + filterAttack, filterDecaySeconds)
        })
      }
    }

    // LFO: the layer's one standing LFO connects its depth gain to this
    // voice's destination param, chosen by the current destination setting.
    // In Samples mode, Osc Pitch and vibrato connect through a per-source
    // cents->playbackRate-ratio scaling gain (declared: LFO/vibrato depth is
    // computed in "cents" terms — see updateSynthLfos/vibratoDepth — so this
    // translator keeps the SAME depth gain meaningful for a ratio param
    // instead of dropping the destination, per the spec's practicality
    // allowance for Samples-mode Osc Pitch).
    // Cents-depth-to-playbackRate-ratio translator: one small fixed-gain
    // node per sample source, input fed by the LFO/vibrato depth gain,
    // output summed onto that source's playbackRate — keeps the SAME
    // cents-shaped depth gains (updateSynthLfos/vibratoDepth) meaningful for
    // a ratio param instead of dropping the destination in Samples mode.
    const pitchScalers: GainNodeLike[] = sampleVoiceSources.map(({ node, baseRate }) => {
      const scaler = context.createGain()
      scaler.gain.value = centsToRateScale(baseRate)
      scaler.connect(node.playbackRate)
      ownedNodes.push(scaler)
      return scaler
    })
    this.connectSynthLfoDestination(context, voice, channel, layerState.lfo.destination, {
      oscillators: oscillatorNodes,
      filters: synthFilter?.filters ?? [],
      oscCtrlParam: isSamplesMode ? null : (synthLive?.oscCtrlParam ?? null),
      pitchScalers: isSamplesMode ? pitchScalers : [],
    })
    // Vibrato (spec voice.vibrato): the layer's fixed-rate pitch LFO connects
    // to every source's detune at voice build (or, in Samples mode, through
    // the same cents->rate scaling gains above), same connect-at-build
    // pattern — through one per-VOICE ramp gain shared by every target on
    // this voice. Delayed mode (spec voice.vibrato.optionalModes) needs the
    // depth to start at 0 and ramp to full only ~700ms after THIS voice's
    // note-on — `channel.vibrato.depth` is a single shared gain per layer
    // (every sounding voice's target), so a per-voice indirection stage is
    // the simplest correct way to give each voice its own onset time without
    // disturbing already-sounding voices when a new note starts. Every other
    // mode's ramp gain is simply fixed at 1 (pass-through).
    const vibratoRamp = context.createGain()
    vibratoRamp.gain.value = layerState.voice.vibrato === 'Delayed' ? 0 : 1
    if (layerState.voice.vibrato === 'Delayed') {
      const delaySeconds = 0.7
      vibratoRamp.gain.setValueAtTime(0, now)
      vibratoRamp.gain.setTargetAtTime(1, now, delaySeconds / 4)
    }
    ownedNodes.push(vibratoRamp)
    voice.vibratoFeeds.push(vibratoRamp)
    channel.vibrato.depth.connect(vibratoRamp)
    for (const osc of oscillatorNodes) vibratoRamp.connect(osc.detune)
    for (const scaler of pitchScalers) vibratoRamp.connect(scaler)

    // Dedicated gate stage: the arp's Gate mode pulses THIS gain, never the
    // amp-envelope gain — cancelScheduledValues on the envelope gain used to
    // freeze a decaying voice at whatever level the first pulse sampled.
    const gateGain = context.createGain()
    gateGain.gain.value = 1
    filterOut.connect(gateGain)
    gateGain.connect(channel.voiceBus)
    ownedNodes.push(gateGain)
    voice.gateGain = gateGain
    voice.synthLive = synthLive
    voice.synthFilter = synthFilter
    this.trackVoice(key, voice)
    return voice
  }

  /**
   * Connects the layer's standing LFO depth gain to this voice's real
   * destination param at voice build (spec lfo: "connect at voice build" —
   * the destination only re-routes future voices, matching the manual's
   * "no destination LED lit means off but settings are kept"): Osc Pitch
   * connects to every source oscillator's detune; Filter Freq to every
   * filter stage's frequency; Osc Ctrl to the category's live target param
   * (FM-H's true modulation-index gain, or the declared-approximation gain
   * the other three categories sum into their oscillator(s)' detune). A
   * Pure waveform has no Osc Ctrl target and a filter-off voice has no
   * Filter Freq target, so those combinations are silent no-ops.
   */
  private connectSynthLfoDestination(
    context: AudioContextLike,
    voice: Voice,
    channel: SynthChannel,
    destination: SynthLfoDestination | null,
    targets: {
      oscillators: OscillatorNodeLike[]
      filters: BiquadFilterNodeLike[]
      oscCtrlParam: AudioParamLike | null
      /** Samples-mode Osc Pitch destination: per-source cents->rate
       *  translator gains (see startSynthVoice) instead of oscillator detune. */
      pitchScalers: GainNodeLike[]
    },
  ): void {
    if (!destination) return
    // The channel depth gain carries a NORMALIZED amount (0..1); this
    // per-voice gain applies the destination's unit scale, so voices built
    // for the OLD destination keep their own scale when the destination
    // changes mid-note (the depth would otherwise ramp 60 -> 4000 on a
    // still-connected detune param).
    const scale = context.createGain()
    scale.gain.value = destination === 'Filter Freq' ? 4000 : destination === 'Osc Pitch' ? 60 : 40
    voice.ownedNodes.push(scale)
    voice.lfoFeeds.push(scale)
    channel.lfo.depth.connect(scale)
    if (destination === 'Osc Pitch') {
      for (const osc of targets.oscillators) scale.connect(osc.detune)
      for (const scaler of targets.pitchScalers) scale.connect(scaler)
    } else if (destination === 'Filter Freq') {
      for (const filter of targets.filters) scale.connect(filter.frequency)
    } else if (targets.oscCtrlParam) {
      scale.connect(targets.oscCtrlParam)
    }
  }

  /** Generated looping white-noise buffer (xorshift; declared generated) for
   *  the Pure "White Noise" waveform. */
  private getSynthNoiseLoop(context: AudioContextLike): AudioBufferLike {
    if (!this.synthNoiseLoop) {
      const rate = context.sampleRate
      const length = Math.max(1, Math.floor(2 * rate))
      const buffer = context.createBuffer(1, length, rate)
      const data = buffer.getChannelData(0)
      let seed = 0x51ede1
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        data[i] = seed / 0xffffffff - 0.5
      }
      this.synthNoiseLoop = buffer
    }
    return this.synthNoiseLoop
  }

  /** Generated B3 key-click transient (contact-bounce approximation, declared generated). */
  private getOrganClick(context: AudioContextLike): AudioBufferLike {
    if (!this.organClick) this.organClick = makeNoiseBurst(context, 0.008, 90, 0x5eed01)
    return this.organClick
  }

  /** Generated pipe chiff transient (breath attack approximation, declared generated). */
  private getOrganChiff(context: AudioContextLike): AudioBufferLike {
    if (!this.organChiff) this.organChiff = makeNoiseBurst(context, 0.045, 35, 0x5eed02)
    return this.organChiff
  }

  private buildSampleSources(
    spec: InstrumentSpec,
    midi: number,
    velocity: number,
    voiceGain: GainNodeLike,
    ownedNodes: AudioNodeLike[],
    sources: VoiceSource[],
  ): void {
    const context = this.context!
    const zones = nearestZones(spec, midi)
    const layerGains = velocityLayerGains(spec.velocityLayers, velocity)
    const bendFactor = Math.pow(2, this.effectiveBend('piano') / 12)

    let entry: AudioNodeLike = voiceGain
    if (spec.velocityLayers <= 1) {
      // Single recorded layer: declared velocity shaping via a keyed lowpass.
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 700 + Math.pow(velocity, 1.5) * 11000
      filter.Q.value = 0.3
      filter.connect(voiceGain)
      ownedNodes.push(filter)
      entry = filter
    }

    for (const zone of zones) {
      const weight = layerGains[zone.velocityLayer - 1] ?? 0
      if (weight < 0.02) continue
      const buffer = this.sampleCache.get(zone.file)
      if (!buffer) continue
      const baseRate = Math.pow(2, (midi - zone.rootMidi) / 12)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = baseRate * bendFactor
      const zoneGain = context.createGain()
      zoneGain.gain.value = weight * spec.gain
      source.connect(zoneGain)
      zoneGain.connect(entry)
      source.start(context.currentTime)
      ownedNodes.push(zoneGain)
      sources.push({ kind: 'sample', node: source, baseRate })
    }

    // Unison: transposed-neighbor detuned voices for stereo width (manual p.26).
    const unison = this.state.piano.unison
    if (unison > 0 && zones.length > 0) {
      const mainZone = zones.reduce((a, b) =>
        (layerGains[a.velocityLayer - 1] ?? 0) >= (layerGains[b.velocityLayer - 1] ?? 0) ? a : b,
      )
      const buffer = this.sampleCache.get(mainZone.file)
      if (buffer) {
        const baseRate = Math.pow(2, (midi - mainZone.rootMidi) / 12)
        for (const side of UNISON_SIDES) {
          const source = context.createBufferSource()
          source.buffer = buffer
          source.playbackRate.value = baseRate * bendFactor
          source.detune.value = side * (4 + unison * 4)
          const panner = context.createStereoPanner()
          panner.pan.value = side * (0.25 + unison * 0.18)
          const unisonGain = context.createGain()
          unisonGain.gain.value = (0.25 + unison * 0.08) * spec.gain
          source.connect(unisonGain)
          unisonGain.connect(panner)
          panner.connect(entry)
          source.start(context.currentTime)
          ownedNodes.push(unisonGain, panner)
          sources.push({ kind: 'sample', node: source, baseRate })
        }
      }
    }
  }

  private buildSynthSources(
    midi: number,
    velocity: number,
    voiceGain: GainNodeLike,
    ownedNodes: AudioNodeLike[],
    sources: VoiceSource[],
    now: number,
    zoneGain = 1,
  ): void {
    const context = this.context!
    const frequency = midiToFrequency(midi)
    const peak = (0.04 + 0.32 * Math.pow(velocity, 1.5)) * zoneGain
    voiceGain.gain.exponentialRampToValueAtTime(peak, now + 0.004)
    voiceGain.gain.setTargetAtTime(peak * 0.12, now + 0.004, 0.35 + 1.4 / Math.sqrt(Math.max(1, midi - 20)))

    let entry: AudioNodeLike = voiceGain
    try {
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = Math.min(9000, 500 + frequency * 1.5 + velocity * 4200)
      filter.Q.value = 0.4
      filter.connect(voiceGain)
      entry = filter
      ownedNodes.push(filter)
    } catch {
      /* voice runs unfiltered */
    }

    for (const partial of FALLBACK_VOICE_PARTIALS) {
      const osc = context.createOscillator()
      osc.type = partial.type
      osc.frequency.value = frequency * partial.ratio
      const baseDetune = partial.detune
      osc.detune.value = baseDetune + this.effectiveBend('piano') * 100
      const partialGain = context.createGain()
      partialGain.gain.value = partial.level
      osc.connect(partialGain)
      partialGain.connect(entry)
      osc.start(now)
      ownedNodes.push(partialGain)
      sources.push({ kind: 'synth', node: osc, baseDetune })
    }
  }

  noteOff(midi: number): void {
    this.synthKeyUp(midi)
    // Direct keyed lookups: a key can address at most one voice per
    // (section, layer), so probing the seven possible map keys replaces the
    // old full scan over every held voice per key release. (Voice map keys
    // always carry the raw key number — glide renames keep them in sync.)
    for (const [section, layer] of VOICE_ADDRESSES) {
      const voice = this.voices.get(voiceKey(section, layer, midi))
      if (!voice) continue
      voice.keyDown = false
      // KB HOLD (manual p. 36): synth notes keep sounding after keys are
      // lifted; the release happens when KB HOLD is turned off. An EXCLUDEd
      // layer (Shift + KB Hold) opts out and releases normally.
      if (voice.section === 'synth' && this.state.kbHold && !this.state.synth.layers[voice.layer as SynthLayerId].kbHoldExclude) {
        continue
      }
      if (voice.sostenuto) continue
      const sustain = this.effectiveSustainLevel(voice.section)
      if (sustain >= SUSTAIN_DOWN) {
        voice.sustained = true
        continue
      }
      // Half-pedaling is a damper behavior: it lengthens piano releases only.
      if (voice.section === 'piano' && sustain >= SUSTAIN_LIFT) {
        this.releaseVoice(voice, HALF_PEDAL_RELEASE_SECONDS)
        continue
      }
      this.releaseVoice(voice, this.releaseSecondsFor(voice))
    }
  }

  /**
   * Removes `midi` from every synth layer's held-note stack (unless KB HOLD
   * is on, in which case physical key-up never removes it — manual p. 36:
   * "notes keep sounding... after keys are lifted"). For Mono/Legato with
   * priority, releasing the currently-sounding note returns to the next
   * most-recently-held note per the priority setting.
   */
  private lastKbHold = false

  /** KB HOLD released: synth voices whose keys are up release (respecting
   *  the damper), and the held stacks keep only physically-down keys. */
  private releaseKbHoldVoices(): void {
    const downMidis = new Set<number>()
    for (const voice of this.voices.values()) {
      if (voice.section === 'synth' && voice.keyDown) downMidis.add(voice.midi)
    }
    for (const voice of this.voices.values()) {
      if (voice.section !== 'synth' || voice.keyDown || voice.sostenuto || voice.sustained) continue
      if (this.effectiveSustainLevel('synth') >= SUSTAIN_DOWN) {
        voice.sustained = true
        continue
      }
      this.releaseVoice(voice, this.releaseSecondsFor(voice))
    }
    for (const layer of SYNTH_LAYER_IDS) {
      this.synthHeld[layer] = this.synthHeld[layer].filter((m) => downMidis.has(m))
      const sounding = this.synthSoundingMidi[layer]
      if (sounding !== null && !downMidis.has(sounding)) {
        this.synthSoundingMidi[layer] = this.synthHeld[layer].length > 0 ? this.synthHeld[layer][this.synthHeld[layer].length - 1]! : null
      }
    }
  }

  private synthKeyUp(midi: number): void {
    for (const layer of SYNTH_LAYER_IDS) {
      // KB HOLD keeps the layer's held stack after key-up — unless the
      // layer is EXCLUDEd (manual p. 36), which releases like normal.
      if (this.state.kbHold && !this.state.synth.layers[layer].kbHoldExclude) continue
      const held = this.synthHeld[layer]
      const index = held.indexOf(midi)
      if (index < 0) continue
      held.splice(index, 1)
      if (this.state.synth.arp.run) continue // the arp scheduler owns release timing
      if (this.synthSoundingMidi[layer] !== midi) continue // this key wasn't the sounding voice
      const voiceState = this.state.synth.layers[layer].voice
      if (held.length === 0) {
        this.synthSoundingMidi[layer] = null
        continue
      }
      // Return to the highest/lowest remaining held note per priority (Off:
      // the most recently held note, i.e. standard last-note-priority release).
      const next =
        voiceState.priority === 'Low'
          ? Math.min(...held)
          : voiceState.priority === 'High'
            ? Math.max(...held)
            : held[held.length - 1]!
      const velocity = 0.8 // a return-to-held retrigger has no fresh key velocity to reuse
      const zoneGain = zoneGainFor(this.state.split, this.state.synth.layers[layer].zone, next)
      this.triggerSynthMonoVoice(layer, next, velocity, zoneGain)
    }
  }

  /** Piano: Soft Release lengthens damping — except for Clav-type sounds
   *  (manual p. 25). Organ voices stop with a short declick ramp only. Synth
   *  voices release per the layer's amp envelope Release value. */
  private releaseSecondsFor(voice: Voice): number {
    if (voice.section === 'organ') return ORGAN_RELEASE_SECONDS
    if (voice.section === 'synth') return synthReleaseSeconds(this.state.synth.layers[voice.layer as SynthLayerId].ampEnvelope.release)
    const soft = this.state.piano.softRelease && this.state.layers[voice.layer as LayerId].type !== 'Clav'
    return soft ? RELEASE_SECONDS * 1.9 : RELEASE_SECONDS
  }

  /** SUSTPED routes the sustain pedal per section (manual p. 18/23). */
  private sectionSustped(section: SectionId): boolean {
    if (section === 'piano') return this.state.piano.sustped
    if (section === 'synth') return this.state.synth.sustped
    return this.state.organ.sustped
  }

  /** Sustain as a section sees it: zero while its SUSTPED routing is off. */
  private effectiveSustainLevel(section: SectionId): number {
    return this.sectionSustped(section) ? this.sustainLevel : 0
  }

  /* -------------------------------------------------------------- pedals -- */

  /** Damper pedal: boolean (keyboard/space) or continuous 0..1 (MIDI CC64 half-pedaling). */
  setSustain(value: boolean | number): void {
    const level = typeof value === 'boolean' ? (value ? 1 : 0) : Math.min(1, Math.max(0, value))
    const previous = this.sustainLevel
    if (previous === level) return
    this.sustainLevel = level
    if (level < SUSTAIN_DOWN) {
      // Direct Map iteration: releaseVoice only deletes entries, safe mid-loop.
      for (const voice of this.voices.values()) {
        if (voice.sustained && !voice.keyDown && !voice.sostenuto) {
          voice.sustained = false
          const halfPedal = voice.section === 'piano' && level >= SUSTAIN_LIFT
          this.releaseVoice(voice, halfPedal ? HALF_PEDAL_RELEASE_SECONDS : this.releaseSecondsFor(voice))
        }
      }
    }
    if (this.state.piano.sustped && previous < SUSTAIN_LIFT !== level < SUSTAIN_LIFT) {
      this.playPedalNoise()
      this.applyState() // resonance send follows damper state
    }
  }

  isSustainDown(): boolean {
    return this.sustainLevel >= SUSTAIN_LIFT
  }

  sustainPedalLevel(): number {
    return this.sustainLevel
  }

  /** Sostenuto (middle pedal): notes held at pedal-down sustain; later notes are unaffected. */
  setSostenuto(down: boolean): void {
    if (this.sostenutoDown === down) return
    this.sostenutoDown = down
    if (down) {
      for (const voice of this.voices.values()) if (voice.keyDown) voice.sostenuto = true
    } else {
      for (const voice of this.voices.values()) {
        if (!voice.sostenuto) continue
        voice.sostenuto = false
        if (!voice.keyDown) {
          if (this.effectiveSustainLevel(voice.section) >= SUSTAIN_DOWN) voice.sustained = true
          else this.releaseVoice(voice, this.releaseSecondsFor(voice))
        }
      }
    }
  }

  isSostenutoDown(): boolean {
    return this.sostenutoDown
  }

  /** Soft pedal (una corda): new notes are quieter and slightly darker. */
  setSoft(down: boolean): void {
    this.softDown = down
  }

  isSoftDown(): boolean {
    return this.softDown
  }

  private playPedalNoise(): void {
    const context = this.context
    if (!context || !this.channels || !this.state.piano.pedNoise) return
    if (!this.pedalThump) {
      const rate = context.sampleRate
      const length = Math.max(1, Math.floor(0.06 * rate))
      const buffer = context.createBuffer(1, length, rate)
      const data = buffer.getChannelData(0)
      let seed = 0xabcdef
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        data[i] = (seed / 0xffffffff - 0.5) * Math.exp((-i / rate) * 60)
      }
      this.pedalThump = buffer
    }
    for (const layer of ['A', 'B'] as const) {
      if (!this.state.layers[layer].enabled || !this.state.piano.sectionOn) continue
      const source = context.createBufferSource()
      source.buffer = this.pedalThump
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 300
      const gain = context.createGain()
      // Sound menu 2 (manual p. 58): Pedal Noise level trim, ±6 dB.
      gain.gain.value = 0.06 * Math.pow(10, this.state.globalSettings.pedalNoiseDb / 20)
      source.connect(filter)
      filter.connect(gain)
      gain.connect(this.channels[layer].voiceBus)
      source.start(context.currentTime)
      this.boundary.timers.setTimeout(() => {
        try {
          source.disconnect()
          filter.disconnect()
          gain.disconnect()
        } catch {
          /* detached */
        }
      }, 200)
    }
  }

  /** Pitch stick: bends sounding voices (spec: ±2 semitones) in each section
   *  whose PSTICK routing is on. Sections whose EFFECTIVE bend is unchanged
   *  (PSTICK routing off pins it at 0) are skipped entirely — a stick drag
   *  on a piano-only program no longer walks organ/synth voices, and — more
   *  importantly — never cancels their scheduled pitch-envelope ramps. */
  setPitchBend(semitones: number): void {
    const clamped = Math.max(-2, Math.min(2, semitones))
    if (this.pitchBend === clamped) return
    this.pitchBend = clamped
    for (const section of ['piano', 'organ', 'synth'] as const) {
      if (this.effectiveBend(section) !== this.appliedBend[section]) this.applyBendToVoices(section)
    }
  }

  /** Bend a section hears: zero while its PSTICK routing is off (manual p. 18/23). */
  private effectiveBend(section: SectionId): number {
    const routed = section === 'piano' ? this.state.piano.pstick : section === 'synth' ? this.state.synth.pstick : this.state.organ.pstick
    return routed ? this.pitchBend : 0
  }

  /** Program transpose (manual p. 40) plus the System menu's Global
   *  Transpose and Fine Tune (manual p. 57, added on top of the per-program
   *  value): shifts sounding pitch, never zone routing. Fine Tune is
   *  fractional semitones — every pitch path here is exponential, so
   *  cents flow through the same offset. */
  private transposeOffset(): number {
    const program = this.state.transpose.on ? this.state.transpose.semitones : 0
    const settings = this.state.globalSettings
    return program + settings.globalTranspose + settings.fineTune / 100
  }

  /** Per-layer Osc Pitch offset in cents (manual p. 28: -24..+24 semitones
   *  plus ±50 cents fine tune) — Synth section only. */
  private synthOscPitchCents(layer: SynthLayerId): number {
    const oscPitch = this.state.synth.layers[layer].oscPitch
    return oscPitch.semis * 100 + oscPitch.cents
  }

  private applyBendToVoices(section: SectionId): void {
    const context = this.context
    if (!context) return
    const bend = this.effectiveBend(section)
    this.appliedBend[section] = bend
    // Per-layer pitch offsets and rate factors, hoisted out of the voice
    // walk: bend streams (MIDI pitch wheel, stick drags) retarget every
    // sounding source, and recomputing Math.pow per voice was pure waste.
    const bendCents = bend * 100
    const centsByLayer: Record<VoiceLayer, number> = { A: bendCents, B: bendCents, C: bendCents }
    const factorByLayer: Record<VoiceLayer, number> = { A: 1, B: 1, C: 1 }
    if (section === 'synth') {
      for (const layer of SYNTH_LAYER_IDS) {
        const pitchCents = this.synthOscPitchCents(layer)
        this.appliedSynthPitch[layer] = pitchCents
        centsByLayer[layer] = bendCents + pitchCents
        factorByLayer[layer] = Math.pow(2, (bendCents + pitchCents) / 1200)
      }
    } else {
      const factor = Math.pow(2, bendCents / 1200)
      factorByLayer.A = factor
      factorByLayer.B = factor
      factorByLayer.C = factor
    }
    const now = context.currentTime
    const apply = (voice: Voice) => {
      if (voice.section !== section) return
      // Synth voices carry their layer's Osc Pitch offset on top of the bend
      // (manual p. 28); piano/organ voices have no such offset.
      const cents = centsByLayer[voice.layer]
      const factor = factorByLayer[voice.layer]
      for (const source of voice.sources) {
        if (source.kind === 'sample') {
          source.node.playbackRate.cancelScheduledValues(now)
          source.node.playbackRate.setTargetAtTime(source.baseRate * factor, now, 0.015)
        } else {
          source.node.detune.cancelScheduledValues(now)
          source.node.detune.setTargetAtTime(source.baseDetune + cents, now, 0.015)
        }
      }
    }
    for (const voice of this.voices.values()) apply(voice)
    for (const voice of this.releasingVoices) apply(voice)
  }

  pitchBendValue(): number {
    return this.pitchBend
  }

  /* ------------------------------------------------------------- cleanup -- */

  allNotesOff(reason: AllNotesOffReason): void {
    this.sustainLevel = 0
    this.sostenutoDown = false
    // Panic (and KB HOLD's own "hold-off clears" spec note) drops every
    // synth layer's held-note set, ending arp/priority/mono retention.
    if (reason === 'panic') {
      this.synthHeld = { A: [], B: [], C: [] }
      this.synthSoundingMidi = { A: null, B: null, C: null }
    }
    const releaseSeconds = reason === 'panic' ? PANIC_RELEASE_SECONDS : QUICK_RELEASE_SECONDS
    for (const voice of this.voices.values()) this.releaseVoice(voice, releaseSeconds)
  }

  private releaseVoice(voice: Voice, releaseSeconds: number): void {
    if (voice.releasing) return
    voice.releasing = true
    this.untrackVoice(voice)
    this.releasingVoices.add(voice)
    const context = this.context
    if (context) {
      const now = context.currentTime
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setTargetAtTime(0.0001, now, releaseSeconds / 4)
      const stopAt = now + releaseSeconds + 0.05
      for (const source of voice.sources) {
        try {
          source.node.stop(stopAt)
        } catch {
          /* already stopped */
        }
      }
    }
    voice.cleanupTimer = this.boundary.timers.setTimeout(
      () => this.cleanupVoice(voice),
      releaseSeconds * 1000 + CLEANUP_GRACE_MS,
    )
  }

  private cleanupVoice(voice: Voice): void {
    // Every cleanup path goes through releaseVoice (which adds the voice to
    // releasingVoices); a voice absent from the set was already cleaned —
    // and possibly recycled — so touching it again would corrupt the pool.
    if (!this.releasingVoices.has(voice)) return
    if (voice.cleanupTimer !== null) {
      this.boundary.timers.clearTimeout(voice.cleanupTimer)
      voice.cleanupTimer = null
    }
    for (const source of voice.sources) {
      try {
        source.node.disconnect()
      } catch {
        /* detached */
      }
    }
    for (const node of voice.ownedNodes) {
      try {
        node.disconnect()
      } catch {
        /* detached */
      }
    }
    // Sever the CHANNEL-side edges into this voice's lfo/vibrato feed gains:
    // target.disconnect() below only removes OUTGOING edges, so without this
    // the channel depth gains accumulate dead fan-out per note played.
    if (voice.section === 'synth' && this.synthChannels) {
      const channel = this.synthChannels[voice.layer as SynthLayerId]
      for (const fed of voice.lfoFeeds) {
        try {
          channel.lfo.depth.disconnect(fed)
        } catch {
          /* already detached */
        }
      }
      for (const fed of voice.vibratoFeeds) {
        try {
          channel.vibrato.depth.disconnect(fed)
        } catch {
          /* already detached */
        }
      }
    }
    this.releasingVoices.delete(voice)
    // Free-list recycle: empty the arrays in place and drop every AudioNode
    // reference so pooled bookkeeping objects never pin graph nodes.
    voice.sources.length = 0
    voice.ownedNodes.length = 0
    voice.lfoFeeds.length = 0
    voice.vibratoFeeds.length = 0
    voice.organLive = null
    voice.synthLive = null
    voice.synthFilter = null
    voice.gain = null as unknown as GainNodeLike
    if (this.voicePool.length < VOICE_POOL_MAX) this.voicePool.push(voice)
  }

  /**
   * Stops every owned voice and releases the audio graph. The engine returns
   * to `idle` and may be lazily restarted by a later gesture (this keeps
   * React StrictMode mount/cleanup/mount cycles sound).
   */
  dispose(): void {
    this.allNotesOff('unmount')
    for (const voice of [...this.releasingVoices]) this.cleanupVoice(voice)
    if (this.channels) {
      for (const layer of ['A', 'B'] as const) {
        const channel = this.channels[layer]
        for (const unit of Object.values(channel.units)) unit.dispose()
        for (const node of [
          channel.voiceBus,
          channel.timbreBass,
          channel.timbreTreble,
          channel.dynComp,
          channel.dynMakeup,
          channel.levelGain,
          channel.resSend,
          channel.resConvolver,
          channel.toMaster,
          channel.toRotary,
        ]) {
          try {
            node?.disconnect()
          } catch {
            /* detached */
          }
        }
      }
      this.channels = null
    }
    if (this.organChannels) {
      for (const layer of ['A', 'B'] as const) {
        const channel = this.organChannels[layer]
        channel.scanner.dispose()
        for (const node of [channel.voiceBus, channel.levelGain]) {
          try {
            node.disconnect()
          } catch {
            /* detached */
          }
        }
      }
      this.organChannels = null
    }
    if (this.organChain) {
      for (const unit of Object.values(this.organChain.units)) unit.dispose()
      for (const node of [this.organChain.input, this.organChain.toMaster, this.organChain.toRotary]) {
        try {
          node.disconnect()
        } catch {
          /* detached */
        }
      }
      this.organChain = null
    }
    if (this.synthChannels) {
      for (const layer of SYNTH_LAYER_IDS) {
        const channel = this.synthChannels[layer]
        stopAndDisconnect([
          channel.lfo.osc,
          channel.lfo.sh,
          channel.lfo.invert,
          channel.lfo.oscSelect,
          channel.lfo.invertSelect,
          channel.lfo.shSelect,
          channel.lfo.depth,
          channel.vibrato.osc,
          channel.vibrato.depth,
        ])
        for (const unit of Object.values(channel.units)) unit.dispose()
        for (const node of [channel.voiceBus, channel.levelGain, channel.toMaster, channel.toRotary]) {
          try {
            node.disconnect()
          } catch {
            /* detached */
          }
        }
      }
      this.synthChannels = null
    }
    this.stopArp(false)
    this.voicePool.length = 0
    this.heldCounts.clear()
    this.heldSectionCounts = { piano: 0, organ: 0, synth: 0 }
    this.synthHeld = { A: [], B: [], C: [] }
    this.synthSoundingMidi = { A: null, B: null, C: null }
    this.rotary?.dispose()
    this.rotary = null
    this.globalReverb?.dispose()
    this.globalReverb = null
    try {
      this.preMaster?.disconnect()
    } catch {
      /* detached */
    }
    this.preMaster = null
    try {
      this.limiter?.disconnect()
    } catch {
      /* detached */
    }
    this.limiter = null
    try {
      this.masterGain?.disconnect()
    } catch {
      /* detached */
    }
    this.masterGain = null
    if (this.context) void this.context.close()
    this.context = null
    this.appliedDeps.clear()
    this.sampleCache.clear()
    this.instrumentStatus.clear()
    this.instrumentError.clear()
    this.pedalThump = null
    this.organClick = null
    this.organChiff = null
    this.synthNoiseLoop = null
    this.synthShBuffer = null
    this.reducedPath = false
    this.detachStore?.()
    this.detachStore = null
    this.setStatus('idle', 'Audio starts on the first key press.')
  }

  /**
   * Diagnostics for tests and real-browser signal verification: references to
   * the REAL graph nodes (never metadata substitutes; never used by app
   * logic). Graph tests assert actual connectivity through these nodes.
   */
  diagnostics(): {
    context: AudioContextLike | null
    masterGain: GainNodeLike | null
    limiter: DynamicsCompressorNodeLike | null
    rotary: RotaryUnit | null
    channels: Record<LayerId, LayerChannel> | null
    organChannels: Record<LayerId, OrganChannel> | null
    /** The shared Organ effect chain's units and master/rotary sends (manual p. 18). */
    organChainUnits: OrganSharedChain['units'] | null
    organChainToMaster: GainNodeLike | null
    organChainToRotary: GainNodeLike | null
    synthChannels: Record<SynthLayerId, SynthChannel> | null
    /** The shared post-rotary Global Reverb unit (manual p. 52-53). */
    globalReverb: EffectUnit<EffectChainState['reverb']> | null
  } {
    return {
      context: this.context,
      masterGain: this.masterGain,
      limiter: this.limiter,
      rotary: this.rotary,
      channels: this.channels,
      organChannels: this.organChannels,
      organChainUnits: this.organChain?.units ?? null,
      organChainToMaster: this.organChain?.toMaster ?? null,
      organChainToRotary: this.organChain?.toRotary ?? null,
      synthChannels: this.synthChannels,
      globalReverb: this.globalReverb,
    }
  }
}

/* ------------------------------------------------------------- helpers -- */

/** Deterministic exponentially-decaying noise burst (xorshift; declared generated). */
function makeNoiseBurst(context: AudioContextLike, seconds: number, decayRate: number, seedStart: number): AudioBufferLike {
  const rate = context.sampleRate
  const length = Math.max(1, Math.floor(seconds * rate))
  const buffer = context.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  let seed = seedStart
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    data[i] = (seed / 0xffffffff - 0.5) * Math.exp((-i / rate) * decayRate)
  }
  return buffer
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown } | null)?.then === 'function'
}

function isAudioBuffer(data: SampleData): data is AudioBufferLike {
  return typeof (data as { getChannelData?: unknown }).getChannelData === 'function'
}

function rampTo(
  param: { cancelScheduledValues(t: number): unknown; setTargetAtTime(v: number, t: number, tc: number): unknown },
  value: number,
  now: number,
): void {
  param.cancelScheduledValues(now)
  param.setTargetAtTime(value, now, 0.02)
}

/** KB Touch velocity curves: Heavy needs more force, Light less (manual p.25). */
function applyTouchCurve(velocity: number, touch: 0 | 1 | 2): number {
  const gamma = touch === 0 ? 1.35 : touch === 1 ? 1 : 0.72
  return Math.pow(velocity, gamma)
}

/** [bass dB, treble dB] voicing per timbre setting. */
function timbreGains(family: 'acoustic' | 'electric', timbre: string): [number, number] {
  if (family === 'electric') {
    switch (timbre) {
      case 'Soft':
        return [1.5, -5.5]
      case 'Mid':
        return [-2, 3]
      case 'Bright':
        return [-1, 5.5]
      case 'Dyno 1':
        return [3, 6]
      case 'Dyno 2':
        return [6, 7]
      default:
        return [0, 0]
    }
  }
  switch (timbre) {
    case 'Soft':
      return [3, -4.5]
    case 'Mid':
      return [-4, -3.5]
    case 'Bright':
      return [0, 5.5]
    default:
      return [0, 0]
  }
}
