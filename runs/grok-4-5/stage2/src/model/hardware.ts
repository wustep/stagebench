/** Normalized hardware control inventory with stable IDs */

export type ControlKind =
  | 'knob'
  | 'encoder'
  | 'fader'
  | 'drawbar'
  | 'button'
  | 'wheel'
  | 'stick'
  | 'oled'
  | 'led-graph'

export type SectionId =
  | 'performance'
  | 'organ'
  | 'piano'
  | 'program'
  | 'synth'
  | 'effects'

export interface ControlDef {
  id: string
  section: SectionId
  kind: ControlKind
  label: string
  /** Default value 0..1 for continuous, 0/1 for buttons */
  defaultValue: number
  min?: number
  max?: number
  steps?: number
  /** Button is momentary press (not toggle) */
  momentary?: boolean
}

export const SECTION_LAYOUT = [
  { id: 'performance' as const, label: 'Performance controls', fraction: 0.14 },
  { id: 'organ' as const, label: 'Organ', fraction: 0.2 },
  { id: 'piano' as const, label: 'Piano', fraction: 0.085 },
  { id: 'program' as const, label: 'Program and morph', fraction: 0.125 },
  { id: 'synth' as const, label: 'Synth', fraction: 0.25 },
  { id: 'effects' as const, label: 'Layer effects', fraction: 0.2 },
]

export const VERTICAL_ALLOCATION = {
  controlDeck: 0.54,
  keybed: 0.46,
  tolerance: 0.025,
}

function btn(
  section: SectionId,
  id: string,
  label: string,
  opts?: { momentary?: boolean; defaultValue?: number },
): ControlDef {
  return {
    id,
    section,
    kind: 'button',
    label,
    defaultValue: opts?.defaultValue ?? 0,
    momentary: opts?.momentary ?? false,
  }
}

function knob(section: SectionId, id: string, label: string, defaultValue = 0.5): ControlDef {
  return { id, section, kind: 'knob', label, defaultValue, min: 0, max: 1 }
}

function fader(section: SectionId, id: string, label: string, defaultValue = 0.7): ControlDef {
  return { id, section, kind: 'fader', label, defaultValue, min: 0, max: 1 }
}

function drawbar(section: SectionId, id: string, label: string, defaultValue = 0): ControlDef {
  return { id, section, kind: 'drawbar', label, defaultValue, min: 0, max: 1, steps: 9 }
}

export const CONTROLS: ControlDef[] = [
  // --- Performance ---
  knob('performance', 'perf-master-level', 'Master Level', 0.75),
  { id: 'perf-pitch-stick', section: 'performance', kind: 'stick', label: 'Pitch Stick', defaultValue: 0.5, min: 0, max: 1 },
  { id: 'perf-mod-wheel', section: 'performance', kind: 'wheel', label: 'Modulation Wheel', defaultValue: 0, min: 0, max: 1 },
  btn('performance', 'perf-transpose', 'Transpose'),
  btn('performance', 'perf-kb-zones', 'KB Zones'),
  btn('performance', 'perf-panic', 'Panic', { momentary: true }),
  btn('performance', 'perf-hold', 'Hold'),
  btn('performance', 'perf-mono', 'Mono'),

  // --- Organ ---
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
    drawbar('organ', `organ-drawbar-${n}`, `Drawbar ${n}`, n <= 4 ? 0.8 : 0.3),
  ),
  btn('organ', 'organ-model-b3', 'B3', { defaultValue: 1 }),
  btn('organ', 'organ-model-vox', 'Vox'),
  btn('organ', 'organ-model-farf', 'Farf'),
  btn('organ', 'organ-model-pipe', 'Pipe'),
  btn('organ', 'organ-layer-a', 'Organ Layer A', { defaultValue: 1 }),
  btn('organ', 'organ-layer-b', 'Organ Layer B'),
  fader('organ', 'organ-level-a', 'Organ Level A', 0.8),
  fader('organ', 'organ-level-b', 'Organ Level B', 0),
  btn('organ', 'organ-oct-a-down', 'Organ A Octave Down', { momentary: true }),
  btn('organ', 'organ-oct-a-up', 'Organ A Octave Up', { momentary: true }),
  btn('organ', 'organ-oct-b-down', 'Organ B Octave Down', { momentary: true }),
  btn('organ', 'organ-oct-b-up', 'Organ B Octave Up', { momentary: true }),
  btn('organ', 'organ-perc-on', 'Percussion On'),
  btn('organ', 'organ-perc-soft', 'Perc Soft'),
  btn('organ', 'organ-perc-fast', 'Perc Fast'),
  btn('organ', 'organ-perc-third', 'Perc Third'),
  btn('organ', 'organ-vibrato', 'Vibrato/Chorus'),
  btn('organ', 'organ-rotary-speed', 'Rotary Speed'),
  btn('organ', 'organ-rotary-stop', 'Rotary Stop'),
  btn('organ', 'organ-section-on', 'Organ Section On'),
  btn('organ', 'organ-sustped', 'Organ Sustain Pedal'),
  btn('organ', 'organ-pstick', 'Organ Pitch Stick'),
  knob('organ', 'organ-drive', 'Rotary Drive', 0.3),
  knob('organ', 'organ-key-click', 'Key Click', 0.4),

  // --- Piano ---
  btn('piano', 'piano-section-on', 'Piano Section On', { defaultValue: 1 }),
  btn('piano', 'piano-layer-a', 'Piano Layer A', { defaultValue: 1 }),
  btn('piano', 'piano-layer-b', 'Piano Layer B'),
  fader('piano', 'piano-level-a', 'Piano Level A', 0.85),
  fader('piano', 'piano-level-b', 'Piano Level B', 0),
  btn('piano', 'piano-oct-a-down', 'Piano A Octave Down', { momentary: true }),
  btn('piano', 'piano-oct-a-up', 'Piano A Octave Up', { momentary: true }),
  btn('piano', 'piano-oct-b-down', 'Piano B Octave Down', { momentary: true }),
  btn('piano', 'piano-oct-b-up', 'Piano B Octave Up', { momentary: true }),
  btn('piano', 'piano-type-grand', 'Grand', { defaultValue: 1 }),
  btn('piano', 'piano-type-upright', 'Upright'),
  btn('piano', 'piano-type-electric', 'Electric'),
  btn('piano', 'piano-type-clav', 'Clav'),
  btn('piano', 'piano-type-digital', 'Digital'),
  btn('piano', 'piano-type-misc', 'Misc'),
  knob('piano', 'piano-model', 'Piano Model', 0),
  knob('piano', 'piano-kb-touch', 'KB Touch', 0.5),
  knob('piano', 'piano-dyn-comp', 'Dyn Comp', 0),
  knob('piano', 'piano-timbre', 'Timbre', 0),
  btn('piano', 'piano-unison', 'Unison'),
  btn('piano', 'piano-soft-release', 'Soft Release'),
  btn('piano', 'piano-string-res', 'String Resonance'),
  btn('piano', 'piano-sustped', 'Piano Sustain Pedal', { defaultValue: 1 }),
  btn('piano', 'piano-pstick', 'Piano Pitch Stick'),

  // --- Program ---
  { id: 'program-oled', section: 'program', kind: 'oled', label: 'Program Display', defaultValue: 0 },
  { id: 'program-dial', section: 'program', kind: 'encoder', label: 'Program Dial', defaultValue: 0, min: 0, max: 1 },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    btn('program', `program-btn-${n}`, `Program ${n}`, { defaultValue: n === 1 ? 1 : 0 }),
  ),
  btn('program', 'program-page-up', 'Page Up', { momentary: true }),
  btn('program', 'program-page-down', 'Page Down', { momentary: true }),
  btn('program', 'program-live', 'Live Mode'),
  btn('program', 'program-scene-1', 'Scene I', { defaultValue: 1 }),
  btn('program', 'program-scene-2', 'Scene II'),
  btn('program', 'program-store', 'Store', { momentary: true }),
  btn('program', 'program-store-as', 'Store As', { momentary: true }),
  btn('program', 'program-split', 'Split'),
  btn('program', 'program-morph-wheel', 'Morph Wheel'),
  btn('program', 'program-morph-ctrl', 'Morph Control Pedal'),
  btn('program', 'program-morph-aft', 'Morph Aftertouch'),
  btn('program', 'program-list', 'Program List'),
  btn('program', 'program-shift', 'Shift'),

  // --- Synth ---
  { id: 'synth-oled', section: 'synth', kind: 'oled', label: 'Synth Display', defaultValue: 0 },
  btn('synth', 'synth-section-on', 'Synth Section On'),
  btn('synth', 'synth-layer-a', 'Synth Layer A', { defaultValue: 1 }),
  btn('synth', 'synth-layer-b', 'Synth Layer B'),
  btn('synth', 'synth-layer-c', 'Synth Layer C'),
  fader('synth', 'synth-level-a', 'Synth Level A', 0.7),
  fader('synth', 'synth-level-b', 'Synth Level B', 0),
  fader('synth', 'synth-level-c', 'Synth Level C', 0),
  btn('synth', 'synth-oct-a-down', 'Synth A Octave Down', { momentary: true }),
  btn('synth', 'synth-oct-a-up', 'Synth A Octave Up', { momentary: true }),
  btn('synth', 'synth-oct-b-down', 'Synth B Octave Down', { momentary: true }),
  btn('synth', 'synth-oct-b-up', 'Synth B Octave Up', { momentary: true }),
  btn('synth', 'synth-oct-c-down', 'Synth C Octave Down', { momentary: true }),
  btn('synth', 'synth-oct-c-up', 'Synth C Octave Up', { momentary: true }),
  knob('synth', 'synth-osc-ctrl', 'Osc Ctrl', 0.5),
  knob('synth', 'synth-osc-shape', 'Osc Shape', 0.5),
  knob('synth', 'synth-filter-freq', 'Filter Freq', 0.6),
  knob('synth', 'synth-filter-res', 'Filter Res', 0.2),
  knob('synth', 'synth-filter-drive', 'Filter Drive', 0),
  knob('synth', 'synth-env-attack', 'Amp Attack', 0.1),
  knob('synth', 'synth-env-decay', 'Amp Decay', 0.4),
  knob('synth', 'synth-env-release', 'Amp Release', 0.3),
  knob('synth', 'synth-mod-env-attack', 'Mod Env Attack', 0.1),
  knob('synth', 'synth-mod-env-decay', 'Mod Env Decay', 0.4),
  knob('synth', 'synth-lfo-rate', 'LFO Rate', 0.4),
  knob('synth', 'synth-lfo-amount', 'LFO Amount', 0),
  knob('synth', 'synth-arp-rate', 'Arp Rate', 0.5),
  btn('synth', 'synth-osc-wave', 'Osc Wave'),
  btn('synth', 'synth-filter-type', 'Filter Type'),
  btn('synth', 'synth-voice-poly', 'Poly', { defaultValue: 1 }),
  btn('synth', 'synth-voice-mono', 'Mono'),
  btn('synth', 'synth-voice-legato', 'Legato'),
  btn('synth', 'synth-unison', 'Synth Unison'),
  btn('synth', 'synth-vibrato', 'Vibrato'),
  btn('synth', 'synth-arp-on', 'Arp On'),
  btn('synth', 'synth-arp-hold', 'Arp Hold'),
  btn('synth', 'synth-sustped', 'Synth Sustain Pedal'),
  btn('synth', 'synth-pstick', 'Synth Pitch Stick'),

  // --- Effects ---
  btn('effects', 'fx-group-1', 'Effect Group 1', { defaultValue: 1 }),
  btn('effects', 'fx-group-2', 'Effect Group 2'),
  btn('effects', 'fx-focus-organ-a', 'FX Focus Organ A'),
  btn('effects', 'fx-focus-organ-b', 'FX Focus Organ B'),
  btn('effects', 'fx-focus-piano-a', 'FX Focus Piano A', { defaultValue: 1 }),
  btn('effects', 'fx-focus-piano-b', 'FX Focus Piano B'),
  btn('effects', 'fx-focus-synth-a', 'FX Focus Synth A'),
  btn('effects', 'fx-focus-synth-b', 'FX Focus Synth B'),
  btn('effects', 'fx-focus-synth-c', 'FX Focus Synth C'),
  btn('effects', 'fx-mod1-on', 'Mod 1 On'),
  knob('effects', 'fx-mod1-rate', 'Mod 1 Rate', 0.4),
  knob('effects', 'fx-mod1-amount', 'Mod 1 Amount', 0.3),
  btn('effects', 'fx-mod1-type', 'Mod 1 Type'),
  btn('effects', 'fx-mod2-on', 'Mod 2 On'),
  knob('effects', 'fx-mod2-rate', 'Mod 2 Rate', 0.4),
  knob('effects', 'fx-mod2-amount', 'Mod 2 Amount', 0.3),
  btn('effects', 'fx-mod2-type', 'Mod 2 Type'),
  btn('effects', 'fx-delay-on', 'Delay On'),
  knob('effects', 'fx-delay-time', 'Delay Time', 0.4),
  knob('effects', 'fx-delay-feedback', 'Delay Feedback', 0.3),
  knob('effects', 'fx-delay-mix', 'Delay Mix', 0.25),
  btn('effects', 'fx-amp-on', 'Amp Sim On'),
  knob('effects', 'fx-amp-drive', 'Amp Drive', 0.2),
  knob('effects', 'fx-eq-bass', 'EQ Bass', 0.5),
  knob('effects', 'fx-eq-mid', 'EQ Mid', 0.5),
  knob('effects', 'fx-eq-treble', 'EQ Treble', 0.5),
  btn('effects', 'fx-comp-on', 'Compressor On'),
  knob('effects', 'fx-comp-amount', 'Compressor Amount', 0.3),
  btn('effects', 'fx-reverb-on', 'Reverb On'),
  knob('effects', 'fx-reverb-amount', 'Reverb Amount', 0.3),
  knob('effects', 'fx-reverb-time', 'Reverb Time', 0.5),
  btn('effects', 'fx-reverb-type', 'Reverb Type'),
  btn('effects', 'fx-to-rotary', 'To Rotary'),
  btn('effects', 'fx-bypass', 'Effects Bypass'),
  btn('effects', 'fx-global', 'Global Effects'),
]

export const CONTROL_BY_ID = Object.fromEntries(CONTROLS.map((c) => [c.id, c])) as Record<
  string,
  ControlDef
>

export const PRIMARY_OLED_IDS = ['program-oled', 'synth-oled'] as const

export function controlsForSection(section: SectionId): ControlDef[] {
  return CONTROLS.filter((c) => c.section === section)
}

export function defaultControlValues(): Record<string, number> {
  const values: Record<string, number> = {}
  for (const c of CONTROLS) {
    values[c.id] = c.defaultValue
  }
  return values
}
