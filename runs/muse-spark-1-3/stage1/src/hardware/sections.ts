/**
 * Normalized hardware model: sections, control inventory, and key map.
 *
 * Section width fractions follow specs/nord-stage-4.visual.json (photo-measured
 * 2026-07-04 correction): performance 0.14, organ 0.20, piano 0.085,
 * program 0.125, synth 0.25, effects 0.20.
 * The 13/21/15/9/21/21 split in prompts/stage1.md is the superseded coarse
 * value — see stage1-visual-audit.md.
 */

export const DECK_FRACTION = 0.54;
export const KEYBED_FRACTION = 0.46;

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects';

export interface SectionModel {
  id: SectionId;
  /** Short header label rendered on the deck plate. */
  label: string;
  fraction: number;
  /** Dark inset plate, or exposed red chassis for performance. */
  surface: 'exposed' | 'inset';
  /** Screen-reader landmark label. */
  ariaLabel: string;
}

export const SECTIONS: SectionModel[] = [
  { id: 'performance', label: 'PERFORMANCE', fraction: 0.14, surface: 'exposed', ariaLabel: 'Performance controls' },
  { id: 'organ', label: 'ORGAN', fraction: 0.2, surface: 'inset', ariaLabel: 'Organ section' },
  { id: 'piano', label: 'PIANO', fraction: 0.085, surface: 'inset', ariaLabel: 'Piano section' },
  { id: 'program', label: 'PROGRAM', fraction: 0.125, surface: 'inset', ariaLabel: 'Program and morph section' },
  { id: 'synth', label: 'SYNTH', fraction: 0.25, surface: 'inset', ariaLabel: 'Synth section' },
  { id: 'effects', label: 'LAYER EFFECTS', fraction: 0.2, surface: 'inset', ariaLabel: 'Layer effects section' },
];

export type ControlKind =
  | 'knob'
  | 'button'
  | 'fader'
  | 'drawbar'
  | 'wheel'
  | 'stick'
  | 'dial'
  | 'display';

export interface ControlModel {
  /** Stable id used in the DOM, presentation state, and tests. */
  id: string;
  section: SectionId;
  kind: ControlKind;
  /** Accessible name. */
  label: string;
  /**
   * Presentation behavior in Phase 1 (decorative): knobs/dials rotate in steps,
   * buttons toggle lit/unlit, faders/drawbars/wheels slide across their range.
   */
  steps?: number;
  /** Initial position in the 0..(steps-1) range. */
  initial?: number;
  /** Controls that light when active. */
  lights?: boolean;
  /** Read-only display text (displays only). */
  text?: string;
  /** Group heading inside a section (effects groups, synth sub-panels). */
  group?: string;
  decorative: true;
}

function knob(section: SectionId, id: string, label: string, opts?: Partial<ControlModel>): ControlModel {
  return { id, section, kind: 'knob', label, steps: 11, initial: 5, decorative: true, ...opts };
}
function btn(
  section: SectionId,
  id: string,
  label: string,
  opts?: Partial<ControlModel>,
): ControlModel {
  return { id, section, kind: 'button', label, lights: true, initial: 0, decorative: true, ...opts };
}
function drawbar(section: SectionId, id: string, label: string, initial = 4): ControlModel {
  return { id, section, kind: 'drawbar', label, steps: 9, initial, decorative: true };
}

const DRAWBAR_FOOTAGES = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'];

export const CONTROLS: ControlModel[] = [
  // --- Performance (exposed red chassis): wheels, master level, rotary. ---
  { id: 'perf-pitch-stick', section: 'performance', kind: 'stick', label: 'Pitch stick', steps: 11, initial: 5, decorative: true },
  { id: 'perf-mod-wheel', section: 'performance', kind: 'wheel', label: 'Modulation wheel', steps: 11, initial: 0, decorative: true },
  { id: 'perf-master-level', section: 'performance', kind: 'knob', label: 'Master Level', steps: 11, initial: 7, decorative: true },
  { id: 'perf-rotary-speed', section: 'performance', kind: 'button', label: 'Rotary speaker slow fast', lights: true, initial: 0, decorative: true },
  { id: 'perf-rotary-stop', section: 'performance', kind: 'button', label: 'Rotary speaker stop', lights: true, initial: 0, decorative: true },
  { id: 'perf-rotary-drive', section: 'performance', kind: 'knob', label: 'Rotary drive', steps: 11, initial: 4, decorative: true },

  // --- Organ: nine drawbars + mixed switches (never a uniform grid). ---
  ...DRAWBAR_FOOTAGES.map((footage, i) => drawbar('organ', `organ-drawbar-${i + 1}`, `Organ drawbar ${i + 1} ${footage}`, [8, 6, 8, 6, 4, 2, 0, 0, 4][i])),
  knob('organ', 'organ-volume', 'Organ volume', { steps: 11, initial: 7 }),
  ...['Slow attack', 'Percussion decay fast', 'Percussion soft', 'Percussion on'].map((label, i) => btn('organ', `organ-perc-${i + 1}`, label)),
  ...['B3', 'Vox', 'Farfisa', 'Pipe 1', 'Pipe 2'].map((label, i) => btn('organ', `organ-model-${i + 1}`, `Organ model ${label}`)),
  ...['Vibrato chorus V1', 'Vibrato chorus V2', 'Vibrato chorus V3', 'Vibrato chorus C1', 'Vibrato chorus C2'].map((label, i) =>
    btn('organ', `organ-vib-${i + 1}`, label),
  ),
  btn('organ', 'organ-on-a', 'Organ layer A on', { initial: 1 }),
  btn('organ', 'organ-on-b', 'Organ layer B on'),
  { id: 'organ-level-a', section: 'organ', kind: 'fader', label: 'Organ layer A level', steps: 11, initial: 8, decorative: true },
  { id: 'organ-level-b', section: 'organ', kind: 'fader', label: 'Organ layer B level', steps: 11, initial: 0, decorative: true },

  // --- Piano: selectors + two layer faders. ---
  { id: 'piano-level-a', section: 'piano', kind: 'fader', label: 'Piano layer A level', steps: 11, initial: 8, decorative: true },
  { id: 'piano-level-b', section: 'piano', kind: 'fader', label: 'Piano layer B level', steps: 11, initial: 0, decorative: true },
  btn('piano', 'piano-on', 'Piano section on', { initial: 1 }),
  ...['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'].map((label, i) => btn('piano', `piano-type-${i + 1}`, `Piano type ${label}`, { initial: i === 0 ? 1 : 0 })),
  knob('piano', 'piano-model', 'Piano model selector', { steps: 8, initial: 0 }),
  knob('piano', 'piano-timbre', 'Piano timbre', { steps: 4, initial: 1 }),
  ...['KB Touch', 'Dyn Comp', 'Soft Release', 'String Res', 'Sustain pedal enable', 'Pitch stick enable'].map(
    (label, i) => btn('piano', `piano-detail-${i + 1}`, label),
  ),
  knob('piano', 'piano-octave', 'Piano octave shift', { steps: 5, initial: 2 }),

  // --- Program/morph: the single primary program OLED + dial + buttons. ---
  { id: 'program-display', section: 'program', kind: 'display', label: 'Program display', text: 'A:11 Stage Grand', decorative: true },
  { id: 'program-aux', section: 'program', kind: 'display', label: 'Program page indicator', text: 'PAGE 1', decorative: true },
  { id: 'program-dial', section: 'program', kind: 'dial', label: 'Program dial', steps: 32, initial: 10, decorative: true },
  ...Array.from({ length: 8 }, (_, i) => btn('program', `program-slot-${i + 1}`, `Program slot ${i + 1}`, { initial: i === 0 ? 1 : 0 })),
  ...['Page up', 'Page down', 'Live Mode', 'Layer Scene A', 'Layer Scene B', 'Store', 'Split', 'Transpose', 'Mono', 'Panic'].map(
    (label, i) => btn('program', `program-fn-${i + 1}`, label),
  ),
  ...['Wheel morph', 'Control pedal morph', 'Aftertouch morph'].map((label, i) => btn('program', `program-morph-${i + 1}`, label)),

  // --- Synth: one narrow OLED + grouped, varied-size controls. ---
  { id: 'synth-display', section: 'synth', kind: 'display', label: 'Synth display', text: 'Saw Sync', decorative: true },
  { id: 'synth-level-a', section: 'synth', kind: 'fader', label: 'Synth layer A level', steps: 11, initial: 8, decorative: true },
  { id: 'synth-level-b', section: 'synth', kind: 'fader', label: 'Synth layer B level', steps: 11, initial: 0, decorative: true },
  knob('synth', 'synth-osc-wave', 'Oscillator wave select', { steps: 8, initial: 2, group: 'Oscillators' }),
  knob('synth', 'synth-osc-shape', 'Oscillator shape', { steps: 11, initial: 5, group: 'Oscillators' }),
  knob('synth', 'synth-osc-oct', 'Oscillator octave', { steps: 5, initial: 2, group: 'Oscillators' }),
  knob('synth', 'synth-filter-cutoff', 'Filter cutoff', { steps: 11, initial: 8, group: 'Filter' }),
  knob('synth', 'synth-filter-res', 'Filter resonance', { steps: 11, initial: 2, group: 'Filter' }),
  knob('synth', 'synth-filter-env', 'Filter envelope amount', { steps: 11, initial: 5, group: 'Filter' }),
  knob('synth', 'synth-amp-attack', 'Amplifier attack', { steps: 11, initial: 0, group: 'Envelope' }),
  knob('synth', 'synth-amp-decay', 'Amplifier decay', { steps: 11, initial: 3, group: 'Envelope' }),
  knob('synth', 'synth-amp-sustain', 'Amplifier sustain', { steps: 11, initial: 8, group: 'Envelope' }),
  knob('synth', 'synth-amp-release', 'Amplifier release', { steps: 11, initial: 3, group: 'Envelope' }),
  knob('synth', 'synth-lfo-rate', 'LFO rate', { steps: 11, initial: 4, group: 'LFO' }),
  knob('synth', 'synth-lfo-amount', 'LFO amount', { steps: 11, initial: 0, group: 'LFO' }),
  ...['Synth on A', 'Synth on B', 'Unison', 'Arpeggiator run', 'Arpeggiator tap tempo', 'Vibrato'].map((label, i) =>
    btn('synth', `synth-fn-${i + 1}`, label, { group: i < 2 ? 'Layers' : 'Modulation' }),
  ),

  // --- Layer effects: two separated groups, no OLED. ---
  knob('effects', 'fx-organ-amount', 'Organ effect amount', { steps: 11, initial: 3, group: 'Organ + Piano/Rotary' }),
  knob('effects', 'fx-organ-rate', 'Organ effect rate', { steps: 11, initial: 5, group: 'Organ + Piano/Rotary' }),
  knob('effects', 'fx-piano-amount', 'Piano effect amount', { steps: 11, initial: 2, group: 'Organ + Piano/Rotary' }),
  knob('effects', 'fx-piano-rate', 'Piano effect rate', { steps: 11, initial: 5, group: 'Organ + Piano/Rotary' }),
  btn('effects', 'fx-organ-focus-a', 'Organ effect layer A focus', { group: 'Organ + Piano/Rotary' }),
  btn('effects', 'fx-organ-focus-b', 'Organ effect layer B focus', { group: 'Organ + Piano/Rotary' }),
  knob('effects', 'fx-delay-time', 'Delay time', { steps: 11, initial: 4, group: 'Delay + Amp/EQ + Reverb' }),
  knob('effects', 'fx-delay-feedback', 'Delay feedback', { steps: 11, initial: 3, group: 'Delay + Amp/EQ + Reverb' }),
  knob('effects', 'fx-reverb-decay', 'Reverb decay', { steps: 11, initial: 5, group: 'Delay + Amp/EQ + Reverb' }),
  knob('effects', 'fx-amp-drive', 'Amp drive', { steps: 11, initial: 2, group: 'Delay + Amp/EQ + Reverb' }),
  knob('effects', 'fx-eq-treble', 'Equalizer treble', { steps: 11, initial: 5, group: 'Delay + Amp/EQ + Reverb' }),
  knob('effects', 'fx-comp-amount', 'Compressor amount', { steps: 11, initial: 0, group: 'Delay + Amp/EQ + Reverb' }),
  ...['Organ effect on', 'Piano effect on', 'Delay on', 'Amp simulator on', 'Equalizer on', 'Compressor on', 'Reverb on'].map(
    (label, i) => btn('effects', `fx-on-${i + 1}`, label, { group: i < 2 ? 'Organ + Piano/Rotary' : 'Delay + Amp/EQ + Reverb' }),
  ),
];

export function controlsInSection(section: SectionId): ControlModel[] {
  return CONTROLS.filter((c) => c.section === section);
}

export function controlById(id: string): ControlModel | undefined {
  return CONTROLS.find((c) => c.id === id);
}

/**
 * Computer-keyboard map: chromatic rows anchored at middle C (MIDI 60),
 * home-row style (a = C4, w = C#4, … k = C5, … ; = E5).
 */
export const COMPUTER_KEY_MAP: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
  o: 73,
  l: 74,
  p: 75,
  ';': 76,
};

/** Sustain-hold key (Space) identifier used by the App keyboard layer. */
export const SUSTAIN_KEY = ' ';
