/**
 * Normalized typed control inventory for the Nord Stage 4 control deck.
 *
 * Every visible physical input on the panel has an entry here with a stable id,
 * an accessible name, a control kind, and (where relevant) a value domain. This
 * is presentation-only metadata: nothing here is wired to audio or system state.
 * Phase 1 renders all of these as decorative controls that move/press/toggle and
 * change nothing else (the honesty contract).
 *
 * Section order and widths come from specs/nord-stage-4.visual.json:
 *   performance 0.13, organ 0.21, piano 0.15, program 0.09, synth 0.21, effects 0.21
 */

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects';

export type ControlKind =
  | 'knob' // continuous rotary (0..1 normalized)
  | 'encoder' // endless rotary dial (large program / model dials)
  | 'fader' // vertical slider (0..1)
  | 'drawbar' // organ drawbar (0..8, inverted travel)
  | 'button' // momentary/toggle push button
  | 'selector' // cycles a fixed list of options
  | 'wheel' // modulation wheel (0..1) / pitch stick (spring-centered)
  | 'led' // pure indicator (non-interactive)
  | 'oled'; // display panel (non-interactive)

export interface ControlDef {
  id: string;
  section: SectionId;
  /** Accessible name (aria-label / role name). */
  name: string;
  kind: ControlKind;
  /** For selectors: the ordered option labels. */
  options?: readonly string[];
  /** Default normalized value (0..1) for knobs/faders/wheels, or option index for selectors. */
  default?: number;
  /** For drawbars: max step (8). */
  max?: number;
  /** Small caption rendered under/near the control. */
  caption?: string;
  /** Whether this control is spring-centered (pitch stick). */
  centered?: boolean;
}

export interface SectionDef {
  id: SectionId;
  label: string;
  /** Horizontal fraction of the deck width. */
  fraction: number;
  /** Surface style: exposed red chassis vs. dark inset plate. */
  surface: 'chassis' | 'inset' | 'central';
}

export const SECTIONS: readonly SectionDef[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.13, surface: 'chassis' },
  { id: 'organ', label: 'Organ', fraction: 0.21, surface: 'inset' },
  { id: 'piano', label: 'Piano', fraction: 0.15, surface: 'inset' },
  { id: 'program', label: 'Program and morph', fraction: 0.09, surface: 'central' },
  { id: 'synth', label: 'Synth', fraction: 0.21, surface: 'inset' },
  { id: 'effects', label: 'Layer effects', fraction: 0.21, surface: 'inset' },
] as const;

const ORGAN_DRAWBAR_LABELS = [
  "16'",
  "5 1/3'",
  "8'",
  "4'",
  "2 2/3'",
  "2'",
  "1 3/5'",
  "1 1/3'",
  "1'",
] as const;

const PROGRAM_BUTTON_LABELS = [
  'System',
  'Sound',
  'Organize',
  'Extra',
  'Output',
  'Pedal',
  'MIDI',
  'Extra 8',
] as const;

/**
 * The full control inventory. Grouped by construction below then flattened.
 * IDs are `${section}-${slug}`.
 */
function buildControls(): ControlDef[] {
  const c: ControlDef[] = [];

  // ---- Performance ---------------------------------------------------------
  c.push(
    { id: 'performance-master-level', section: 'performance', name: 'Master Level', kind: 'knob', default: 0.7, caption: 'MASTER LEVEL' },
    { id: 'performance-pitch-stick', section: 'performance', name: 'Pitch stick', kind: 'wheel', default: 0.5, centered: true, caption: 'PITCH' },
    { id: 'performance-mod-wheel', section: 'performance', name: 'Modulation wheel', kind: 'wheel', default: 0, caption: 'MOD' },
    // Rotary speaker cluster (exposed on chassis, small inset)
    { id: 'performance-rotary-drive', section: 'performance', name: 'Rotary drive', kind: 'knob', default: 0.2, caption: 'DRIVE' },
    { id: 'performance-rotary-on', section: 'performance', name: 'Rotary speaker on', kind: 'button', caption: 'ON' },
    { id: 'performance-rotary-source', section: 'performance', name: 'Rotary source', kind: 'selector', options: ['Organ', 'Close Mic'], default: 0 },
    { id: 'performance-rotary-stopmode', section: 'performance', name: 'Rotary stop mode', kind: 'selector', options: ['Angle', 'Slow'], default: 1, caption: 'STOP MODE' },
    { id: 'performance-rotary-speed', section: 'performance', name: 'Rotary speed', kind: 'selector', options: ['Slow', 'Fast'], default: 0 },
    { id: 'performance-rotary-morph', section: 'performance', name: 'Rotary morph', kind: 'button', caption: 'MORPH' },
  );

  // ---- Organ ---------------------------------------------------------------
  c.push(
    { id: 'organ-on', section: 'organ', name: 'Organ section on', kind: 'button', caption: 'ON' },
    { id: 'organ-solo', section: 'organ', name: 'Organ solo', kind: 'button', caption: 'SOLO' },
    { id: 'organ-level-a', section: 'organ', name: 'Organ layer A level', kind: 'fader', default: 0.8 },
    { id: 'organ-level-b', section: 'organ', name: 'Organ layer B level', kind: 'fader', default: 0.5 },
    { id: 'organ-on-off-a', section: 'organ', name: 'Organ layer A on/off', kind: 'button', caption: 'A ON/OFF' },
    { id: 'organ-on-off-b', section: 'organ', name: 'Organ layer B on/off', kind: 'button', caption: 'B ON/OFF' },
    { id: 'organ-sustped', section: 'organ', name: 'Organ sustain pedal route', kind: 'button', caption: 'SUSTPED' },
    { id: 'organ-pstick', section: 'organ', name: 'Organ pitch stick route', kind: 'button', caption: 'PSTICK' },
    { id: 'organ-model', section: 'organ', name: 'Organ model', kind: 'selector', options: ['B3', 'VOX', 'FARF', 'PIPE1', 'PIPE2', 'B3 BASS'], default: 0, caption: 'ORGAN MODEL' },
    { id: 'organ-preset', section: 'organ', name: 'Organ preset', kind: 'button', caption: 'PRESET' },
    { id: 'organ-octave-down', section: 'organ', name: 'Organ octave shift down', kind: 'button', caption: 'OCTAVE ◀' },
    { id: 'organ-octave-up', section: 'organ', name: 'Organ octave shift up', kind: 'button', caption: 'OCTAVE ▶' },
    { id: 'organ-vib-chorus', section: 'organ', name: 'Vibrato/chorus mode', kind: 'selector', options: ['V1', 'C1', 'V2', 'V3', 'C2', 'C3'], default: 0, caption: 'VIB/CHORUS' },
    { id: 'organ-vib-on', section: 'organ', name: 'Vibrato/chorus on', kind: 'button', caption: 'ON' },
    { id: 'organ-perc-volume', section: 'organ', name: 'Percussion volume soft', kind: 'button', caption: 'SOFT' },
    { id: 'organ-perc-decay', section: 'organ', name: 'Percussion decay fast', kind: 'button', caption: 'FAST' },
    { id: 'organ-perc-harmonic', section: 'organ', name: 'Percussion harmonic third', kind: 'button', caption: 'THIRD' },
    { id: 'organ-perc-on', section: 'organ', name: 'Percussion on', kind: 'button', caption: 'ON' },
  );
  ORGAN_DRAWBAR_LABELS.forEach((label, i) => {
    c.push({
      id: `organ-drawbar-${i + 1}`,
      section: 'organ',
      name: `Drawbar ${i + 1} (${label})`,
      kind: 'drawbar',
      max: 8,
      default: [8, 8, 8, 0, 0, 0, 0, 0, 3][i] ?? 0,
      caption: label,
    });
  });

  // ---- Piano ---------------------------------------------------------------
  c.push(
    { id: 'piano-on', section: 'piano', name: 'Piano section on', kind: 'button', caption: 'ON' },
    { id: 'piano-solo', section: 'piano', name: 'Piano solo', kind: 'button', caption: 'SOLO' },
    { id: 'piano-level-a', section: 'piano', name: 'Piano layer A level', kind: 'fader', default: 0.85 },
    { id: 'piano-level-b', section: 'piano', name: 'Piano layer B level', kind: 'fader', default: 0.4 },
    { id: 'piano-on-off-a', section: 'piano', name: 'Piano layer A on/off', kind: 'button', caption: 'A ON/OFF' },
    { id: 'piano-on-off-b', section: 'piano', name: 'Piano layer B on/off', kind: 'button', caption: 'B ON/OFF' },
    { id: 'piano-sustped', section: 'piano', name: 'Piano sustain pedal route', kind: 'button', caption: 'SUSTPED' },
    { id: 'piano-pstick', section: 'piano', name: 'Piano pitch stick route', kind: 'button', caption: 'PSTICK' },
    { id: 'piano-soft-rel', section: 'piano', name: 'Soft release', kind: 'button', caption: 'SOFT REL' },
    { id: 'piano-string-res', section: 'piano', name: 'String resonance', kind: 'button', caption: 'STRING RES' },
    { id: 'piano-ped-noise', section: 'piano', name: 'Pedal noise', kind: 'button', caption: 'PED NOISE' },
    { id: 'piano-unison', section: 'piano', name: 'Unison', kind: 'selector', options: ['Off', '1', '2', '3'], default: 0, caption: 'UNISON' },
    { id: 'piano-kb-touch', section: 'piano', name: 'Keyboard touch', kind: 'selector', options: ['Heavy', 'Medium', 'Light'], default: 1, caption: 'KB TOUCH' },
    { id: 'piano-dyn-comp', section: 'piano', name: 'Dynamic compression', kind: 'selector', options: ['Off', '1', '2', '3'], default: 0, caption: 'DYN COMP' },
    { id: 'piano-timbre', section: 'piano', name: 'Timbre', kind: 'selector', options: ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'], default: 0, caption: 'TIMBRE' },
    { id: 'piano-type', section: 'piano', name: 'Piano type', kind: 'selector', options: ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'], default: 0, caption: 'PIANO SELECT' },
    { id: 'piano-info', section: 'piano', name: 'Piano info', kind: 'button', caption: 'INFO' },
    { id: 'piano-model', section: 'piano', name: 'Piano model dial', kind: 'encoder', caption: 'MODEL' },
    { id: 'piano-octave-down', section: 'piano', name: 'Piano octave shift down', kind: 'button', caption: 'OCTAVE ◀' },
    { id: 'piano-octave-up', section: 'piano', name: 'Piano octave shift up', kind: 'button', caption: 'OCTAVE ▶' },
  );

  // ---- Program & Morph -----------------------------------------------------
  c.push(
    { id: 'program-morph-wheel', section: 'program', name: 'Morph assign wheel', kind: 'button', caption: 'WHEEL' },
    { id: 'program-morph-at', section: 'program', name: 'Morph assign aftertouch', kind: 'button', caption: 'A.T.' },
    { id: 'program-morph-ctrlped', section: 'program', name: 'Morph assign control pedal', kind: 'button', caption: 'CTRL PED' },
    { id: 'program-store', section: 'program', name: 'Store', kind: 'button', caption: 'STORE' },
    { id: 'program-store-as', section: 'program', name: 'Store as', kind: 'button', caption: 'STORE AS' },
    { id: 'program-dial', section: 'program', name: 'Program dial', kind: 'encoder', caption: 'PROGRAM' },
    { id: 'program-page-left', section: 'program', name: 'Page/category left', kind: 'button', caption: '◀ PAGE' },
    { id: 'program-page-right', section: 'program', name: 'Page/category right', kind: 'button', caption: 'PAGE ▶' },
    { id: 'program-live-mode', section: 'program', name: 'Live mode', kind: 'button', caption: 'LIVE MODE' },
    { id: 'program-num-pad', section: 'program', name: 'Num pad', kind: 'button', caption: 'NUM PAD' },
    { id: 'program-layer-scene', section: 'program', name: 'Layer scene', kind: 'selector', options: ['I', 'II'], default: 0, caption: 'LAYER SCENE' },
    { id: 'program-split', section: 'program', name: 'Split', kind: 'button', caption: 'SPLIT' },
    { id: 'program-transpose', section: 'program', name: 'Transpose', kind: 'button', caption: 'TRANSP' },
    { id: 'program-panic', section: 'program', name: 'Panic', kind: 'button', caption: 'PANIC' },
  );
  PROGRAM_BUTTON_LABELS.forEach((label, i) => {
    c.push({
      id: `program-button-${i + 1}`,
      section: 'program',
      name: `Program button ${i + 1} (${label})`,
      kind: 'button',
      caption: label,
    });
  });

  // ---- Synth ---------------------------------------------------------------
  c.push(
    { id: 'synth-on', section: 'synth', name: 'Synth section on', kind: 'button', caption: 'ON' },
    { id: 'synth-solo', section: 'synth', name: 'Synth solo', kind: 'button', caption: 'SOLO' },
    { id: 'synth-level-a', section: 'synth', name: 'Synth layer A level', kind: 'fader', default: 0.75 },
    { id: 'synth-level-b', section: 'synth', name: 'Synth layer B level', kind: 'fader', default: 0.6 },
    { id: 'synth-level-c', section: 'synth', name: 'Synth layer C level', kind: 'fader', default: 0.5 },
    { id: 'synth-on-off-a', section: 'synth', name: 'Synth layer A on/off', kind: 'button', caption: 'A ON/OFF' },
    { id: 'synth-on-off-b', section: 'synth', name: 'Synth layer B on/off', kind: 'button', caption: 'B ON/OFF' },
    { id: 'synth-on-off-c', section: 'synth', name: 'Synth layer C on/off', kind: 'button', caption: 'C ON/OFF' },
    { id: 'synth-sustped', section: 'synth', name: 'Synth sustain pedal route', kind: 'button', caption: 'SUSTPED' },
    { id: 'synth-pstick', section: 'synth', name: 'Synth pitch stick route', kind: 'button', caption: 'PSTICK' },
    { id: 'synth-mode', section: 'synth', name: 'Synth mode', kind: 'selector', options: ['Samples', 'Analog', 'Extern'], default: 1, caption: 'MODE' },
    { id: 'synth-kb-hold', section: 'synth', name: 'Keyboard hold', kind: 'button', caption: 'KB HOLD' },
    { id: 'synth-arp-run', section: 'synth', name: 'Arpeggiator run', kind: 'button', caption: 'ARP RUN' },
    { id: 'synth-octave-down', section: 'synth', name: 'Synth octave shift down', kind: 'button', caption: 'OCTAVE ◀' },
    { id: 'synth-octave-up', section: 'synth', name: 'Synth octave shift up', kind: 'button', caption: 'OCTAVE ▶' },
    // Oscillators
    { id: 'synth-osc-ctrl', section: 'synth', name: 'Oscillator control', kind: 'knob', default: 0.4, caption: 'OSC CTRL' },
    { id: 'synth-osc-env-amt', section: 'synth', name: 'Oscillator envelope amount', kind: 'knob', default: 0.5, caption: 'ENV AMT' },
    { id: 'synth-osc-pitch', section: 'synth', name: 'Oscillator pitch/sample', kind: 'button', caption: 'PITCH/SMP' },
    { id: 'synth-osc-env', section: 'synth', name: 'Oscillator envelope', kind: 'button', caption: 'ENVELOPE' },
    // Filter
    { id: 'synth-filter-freq', section: 'synth', name: 'Filter frequency', kind: 'knob', default: 0.6, caption: 'FREQ' },
    { id: 'synth-filter-res', section: 'synth', name: 'Filter resonance', kind: 'knob', default: 0.3, caption: 'RES' },
    { id: 'synth-filter-env-amt', section: 'synth', name: 'Filter envelope amount', kind: 'knob', default: 0.5, caption: 'ENV AMT' },
    { id: 'synth-filter-type', section: 'synth', name: 'Filter type', kind: 'button', caption: 'TYPE' },
    { id: 'synth-filter-env', section: 'synth', name: 'Filter envelope', kind: 'button', caption: 'ENVELOPE' },
    { id: 'synth-filter-on', section: 'synth', name: 'Filter on', kind: 'button', caption: 'FILTER ON' },
    // Amp / envelope
    { id: 'synth-amp-env', section: 'synth', name: 'Amp envelope', kind: 'button', caption: 'AMP ENV' },
    { id: 'synth-unison', section: 'synth', name: 'Synth unison', kind: 'selector', options: ['Off', '1', '2', '3'], default: 0, caption: 'UNISON' },
    // LFO
    { id: 'synth-lfo-rate', section: 'synth', name: 'LFO rate', kind: 'knob', default: 0.3, caption: 'RATE' },
    { id: 'synth-lfo-amt', section: 'synth', name: 'LFO mod amount', kind: 'knob', default: 0.2, caption: 'MOD AMT' },
    { id: 'synth-lfo-waveform', section: 'synth', name: 'LFO waveform', kind: 'button', caption: 'WAVEFORM' },
    // Arp
    { id: 'synth-arp-rate', section: 'synth', name: 'Arpeggiator rate', kind: 'knob', default: 0.5, caption: 'RATE' },
    { id: 'synth-arp-range', section: 'synth', name: 'Arpeggiator range', kind: 'knob', default: 0.3, caption: 'RANGE' },
    { id: 'synth-arp-mode', section: 'synth', name: 'Arpeggiator mode', kind: 'selector', options: ['Poly', 'Arp'], default: 1 },
    // Voice
    { id: 'synth-glide', section: 'synth', name: 'Glide', kind: 'knob', default: 0.2, caption: 'GLIDE' },
    { id: 'synth-voice-mode', section: 'synth', name: 'Voice mode', kind: 'selector', options: ['Poly', 'Mono', 'Legato'], default: 0 },
    // Vibrato
    { id: 'synth-vibrato', section: 'synth', name: 'Vibrato source', kind: 'selector', options: ['Off', 'Wheel', 'Delay', 'A.T.', 'Ped'], default: 0, caption: 'VIBRATO' },
  );

  // ---- Layer Effects -------------------------------------------------------
  c.push(
    { id: 'effects-on', section: 'effects', name: 'Layer effects on', kind: 'button', caption: 'ON' },
    { id: 'effects-all-off', section: 'effects', name: 'All effects off', kind: 'button', caption: 'ALL FX OFF' },
    { id: 'effects-focus', section: 'effects', name: 'FX focus', kind: 'selector', options: ['Organ A', 'Organ B', 'Piano A', 'Piano B', 'Synth A', 'Synth B', 'Synth C'], default: 2, caption: 'FX FOCUS' },
    // Mod 1
    { id: 'effects-mod1-rate', section: 'effects', name: 'Mod 1 rate', kind: 'knob', default: 0.4, caption: 'RATE' },
    { id: 'effects-mod1-amount', section: 'effects', name: 'Mod 1 amount', kind: 'knob', default: 0.5, caption: 'AMOUNT' },
    { id: 'effects-mod1-type', section: 'effects', name: 'Mod 1 type', kind: 'selector', options: ['RM', 'Trem', 'A-Pan', 'A-Wah', 'Wah', 'Pump'], default: 1, caption: 'MOD 1' },
    { id: 'effects-mod1-on', section: 'effects', name: 'Mod 1 on', kind: 'button', caption: 'ON' },
    // Mod 2
    { id: 'effects-mod2-rate', section: 'effects', name: 'Mod 2 rate', kind: 'knob', default: 0.35, caption: 'RATE' },
    { id: 'effects-mod2-amount', section: 'effects', name: 'Mod 2 amount', kind: 'knob', default: 0.5, caption: 'AMOUNT' },
    { id: 'effects-mod2-type', section: 'effects', name: 'Mod 2 type', kind: 'selector', options: ['Chor', 'Flang', 'Phas', 'Vibe', 'Ens', 'Spin'], default: 0, caption: 'MOD 2' },
    { id: 'effects-mod2-on', section: 'effects', name: 'Mod 2 on', kind: 'button', caption: 'ON' },
    // Amp Sim / EQ
    { id: 'effects-amp-drive', section: 'effects', name: 'Amp drive', kind: 'knob', default: 0.3, caption: 'DRIVE' },
    { id: 'effects-amp-freq', section: 'effects', name: 'Amp/EQ frequency', kind: 'knob', default: 0.6, caption: 'FREQ' },
    { id: 'effects-amp-bass', section: 'effects', name: 'EQ bass', kind: 'knob', default: 0.5, caption: 'BASS' },
    { id: 'effects-amp-mid', section: 'effects', name: 'EQ mid', kind: 'knob', default: 0.5, caption: 'MID' },
    { id: 'effects-amp-treble', section: 'effects', name: 'EQ treble', kind: 'knob', default: 0.5, caption: 'TREBLE' },
    { id: 'effects-amp-model', section: 'effects', name: 'Amp model', kind: 'selector', options: ['Small', 'JC', 'Twin', 'To Rotary', 'LP Filter', 'HP Filter'], default: 0 },
    { id: 'effects-amp-on', section: 'effects', name: 'Amp sim/EQ on', kind: 'button', caption: 'ON' },
    // Delay
    { id: 'effects-delay-tempo', section: 'effects', name: 'Delay tempo', kind: 'knob', default: 0.4, caption: 'TEMPO' },
    { id: 'effects-delay-feedback', section: 'effects', name: 'Delay feedback', kind: 'knob', default: 0.5, caption: 'FEEDBACK' },
    { id: 'effects-delay-drywet', section: 'effects', name: 'Delay dry/wet', kind: 'knob', default: 0.3, caption: 'DRY/WET' },
    { id: 'effects-delay-type', section: 'effects', name: 'Delay effect', kind: 'selector', options: ['Chor', 'Vibe', 'Ens', 'Flam', 'Space'], default: 0, caption: 'EFFECTS' },
    { id: 'effects-delay-filter', section: 'effects', name: 'Delay filter', kind: 'selector', options: ['LP', 'HP', 'BP'], default: 0, caption: 'FILTER' },
    { id: 'effects-delay-pingpong', section: 'effects', name: 'Delay ping pong', kind: 'button', caption: 'PING PONG' },
    { id: 'effects-delay-tap', section: 'effects', name: 'Delay tap/set', kind: 'button', caption: 'TAP/SET' },
    { id: 'effects-delay-on', section: 'effects', name: 'Delay on', kind: 'button', caption: 'ON' },
    // Comp
    { id: 'effects-comp-amount', section: 'effects', name: 'Compressor amount', kind: 'knob', default: 0.4, caption: 'AMOUNT' },
    { id: 'effects-comp-fast', section: 'effects', name: 'Compressor fast', kind: 'button', caption: 'FAST' },
    { id: 'effects-comp-on', section: 'effects', name: 'Compressor on', kind: 'button', caption: 'ON' },
    // Reverb
    { id: 'effects-reverb-drywet', section: 'effects', name: 'Reverb dry/wet', kind: 'knob', default: 0.35, caption: 'DRY/WET' },
    { id: 'effects-reverb-type', section: 'effects', name: 'Reverb type', kind: 'selector', options: ['Room', 'Stage', 'Booth', 'Hall', 'Spring', 'Cath'], default: 0 },
    { id: 'effects-reverb-tone', section: 'effects', name: 'Reverb tone', kind: 'selector', options: ['Bright', 'Dark'], default: 0 },
    { id: 'effects-reverb-on', section: 'effects', name: 'Reverb on', kind: 'button', caption: 'ON' },
  );

  return c;
}

export const CONTROLS: readonly ControlDef[] = buildControls();

export const CONTROLS_BY_ID: ReadonlyMap<string, ControlDef> = new Map(
  CONTROLS.map((ctrl) => [ctrl.id, ctrl]),
);

export function controlsForSection(section: SectionId): ControlDef[] {
  return CONTROLS.filter((ctrl) => ctrl.section === section);
}

/** OLED displays live only in Program and Synth (visual spec requirement). */
export const OLED_SECTIONS: readonly SectionId[] = ['program', 'synth'];
