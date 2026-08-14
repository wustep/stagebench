import type { SectionId } from './variant'

export type ControlKind =
  | 'knob'
  | 'encoder'
  | 'fader'
  | 'drawbar'
  | 'button'
  | 'wheel'
  | 'stick'
  | 'oled'

export interface ControlDef {
  id: string
  section: SectionId
  kind: ControlKind
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  group?: string
}

function knob(id: string, section: SectionId, label: string, group?: string, def = 0.35): ControlDef {
  return { id, section, kind: 'knob', label, min: 0, max: 1, step: 0.01, defaultValue: def, group }
}

function encoder(id: string, section: SectionId, label: string, group?: string): ControlDef {
  return { id, section, kind: 'encoder', label, min: 0, max: 1, step: 0.01, defaultValue: 0, group }
}

function fader(id: string, section: SectionId, label: string, group?: string, def = 0.8): ControlDef {
  return { id, section, kind: 'fader', label, min: 0, max: 1, step: 0.01, defaultValue: def, group }
}

function drawbar(id: string, label: string, def: number): ControlDef {
  return {
    id,
    section: 'organ',
    kind: 'drawbar',
    label,
    min: 0,
    max: 8,
    step: 1,
    defaultValue: def,
    group: 'drawbars',
  }
}

function button(id: string, section: SectionId, label: string, group?: string, on = 0): ControlDef {
  return { id, section, kind: 'button', label, min: 0, max: 1, step: 1, defaultValue: on, group }
}

function oled(id: string, section: SectionId, label: string): ControlDef {
  return { id, section, kind: 'oled', label, min: 0, max: 0, step: 0, defaultValue: 0, group: 'display' }
}

export const CONTROLS: ControlDef[] = [
  knob('perf-master-level', 'performance', 'Master Level', 'master', 0.72),
  {
    id: 'perf-pitch-stick',
    section: 'performance',
    kind: 'stick',
    label: 'Pitch stick',
    min: -1,
    max: 1,
    step: 0.01,
    defaultValue: 0,
    group: 'wheels',
  },
  {
    id: 'perf-mod-wheel',
    section: 'performance',
    kind: 'wheel',
    label: 'Modulation wheel',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0,
    group: 'wheels',
  },

  button('organ-on', 'organ', 'Organ on', 'power', 1),
  button('organ-layer-a-enable', 'organ', 'Organ layer A enable', 'layer-a', 1),
  button('organ-layer-a-focus', 'organ', 'Organ layer A focus', 'layer-a', 1),
  fader('organ-layer-a-level', 'organ', 'Organ layer A level', 'layer-a'),
  button('organ-layer-b-enable', 'organ', 'Organ layer B enable', 'layer-b'),
  button('organ-layer-b-focus', 'organ', 'Organ layer B focus', 'layer-b'),
  fader('organ-layer-b-level', 'organ', 'Organ layer B level', 'layer-b', 0.6),
  button('organ-oct-down', 'organ', 'Organ octave down', 'octave'),
  button('organ-oct-up', 'organ', 'Organ octave up', 'octave'),
  drawbar('organ-drawbar-16', 'Drawbar 16′', 8),
  drawbar('organ-drawbar-513', 'Drawbar 5⅓′', 8),
  drawbar('organ-drawbar-8', 'Drawbar 8′', 8),
  drawbar('organ-drawbar-4', 'Drawbar 4′', 0),
  drawbar('organ-drawbar-223', 'Drawbar 2⅔′', 0),
  drawbar('organ-drawbar-2', 'Drawbar 2′', 0),
  drawbar('organ-drawbar-135', 'Drawbar 1⅗′', 0),
  drawbar('organ-drawbar-113', 'Drawbar 1⅓′', 0),
  drawbar('organ-drawbar-1', 'Drawbar 1′', 0),
  button('organ-model-b3', 'organ', 'Organ model B3', 'model', 1),
  button('organ-model-vox', 'organ', 'Organ model Vox', 'model'),
  button('organ-model-farfisa', 'organ', 'Organ model Farfisa', 'model'),
  button('organ-model-pipe1', 'organ', 'Organ model Pipe 1', 'model'),
  button('organ-model-pipe2', 'organ', 'Organ model Pipe 2', 'model'),
  button('organ-preset-1', 'organ', 'Organ preset 1', 'preset', 1),
  button('organ-preset-2', 'organ', 'Organ preset 2', 'preset'),
  button('organ-vibrato-on', 'organ', 'Organ vibrato/chorus on', 'vibrato'),
  knob('organ-vibrato-type', 'organ', 'Organ vibrato/chorus type', 'vibrato', 0.2),
  button('organ-perc-on', 'organ', 'Organ percussion on', 'perc'),
  button('organ-perc-volume', 'organ', 'Organ percussion volume soft', 'perc'),
  button('organ-perc-decay', 'organ', 'Organ percussion decay fast', 'perc'),
  button('organ-perc-harmonic', 'organ', 'Organ percussion third harmonic', 'perc'),
  button('organ-rotary-stop', 'organ', 'Rotary stop', 'rotary'),
  button('organ-rotary-fast', 'organ', 'Rotary fast', 'rotary'),
  knob('organ-rotary-drive', 'organ', 'Rotary drive', 'rotary', 0.2),
  button('organ-sustped', 'organ', 'Organ sustain pedal enable', 'assign'),
  button('organ-pstick', 'organ', 'Organ pitch stick enable', 'assign'),

  button('piano-on', 'piano', 'Piano on', 'power', 1),
  button('piano-layer-a-enable', 'piano', 'Piano layer A enable', 'layer-a', 1),
  button('piano-layer-a-focus', 'piano', 'Piano layer A focus', 'layer-a', 1),
  fader('piano-layer-a-level', 'piano', 'Piano layer A level', 'layer-a'),
  button('piano-layer-b-enable', 'piano', 'Piano layer B enable', 'layer-b'),
  button('piano-layer-b-focus', 'piano', 'Piano layer B focus', 'layer-b'),
  fader('piano-layer-b-level', 'piano', 'Piano layer B level', 'layer-b', 0.6),
  button('piano-oct-down', 'piano', 'Piano octave down', 'octave'),
  button('piano-oct-up', 'piano', 'Piano octave up', 'octave'),
  button('piano-type', 'piano', 'Piano type', 'type'),
  button('piano-type-grand', 'piano', 'Piano type Grand', 'type', 1),
  button('piano-type-upright', 'piano', 'Piano type Upright', 'type'),
  button('piano-type-electric', 'piano', 'Piano type Electric', 'type'),
  button('piano-type-clav', 'piano', 'Piano type Clav', 'type'),
  button('piano-type-digital', 'piano', 'Piano type Digital', 'type'),
  button('piano-type-misc', 'piano', 'Piano type Misc', 'type'),
  encoder('piano-model', 'piano', 'Piano model', 'model'),
  knob('piano-kb-touch', 'piano', 'KB Touch', 'detail', 0.5),
  knob('piano-dyn-comp', 'piano', 'Dyn Comp', 'detail', 0),
  knob('piano-timbre', 'piano', 'Timbre', 'detail', 0.5),
  knob('piano-unison', 'piano', 'Unison', 'detail', 0),
  button('piano-soft-release', 'piano', 'Soft Release', 'switches'),
  button('piano-string-res', 'piano', 'String Resonance', 'switches'),
  button('piano-sustped', 'piano', 'Piano sustain pedal enable', 'assign', 1),
  button('piano-pstick', 'piano', 'Piano pitch stick enable', 'assign'),

  oled('program-oled', 'program', 'Program display'),
  encoder('program-dial', 'program', 'Program dial'),
  button('program-1', 'program', 'Program 1', 'programs', 1),
  button('program-2', 'program', 'Program 2', 'programs'),
  button('program-3', 'program', 'Program 3', 'programs'),
  button('program-4', 'program', 'Program 4', 'programs'),
  button('program-5', 'program', 'Program 5', 'programs'),
  button('program-6', 'program', 'Program 6', 'programs'),
  button('program-7', 'program', 'Program 7', 'programs'),
  button('program-8', 'program', 'Program 8', 'programs'),
  button('program-page-down', 'program', 'Program page down', 'nav'),
  button('program-page-up', 'program', 'Program page up', 'nav'),
  button('program-live-mode', 'program', 'Live Mode', 'mode'),
  button('program-layer-scene', 'program', 'Layer Scene', 'mode'),
  button('program-store', 'program', 'Store', 'edit'),
  button('program-split', 'program', 'Split', 'edit'),
  button('program-shift', 'program', 'Shift', 'edit'),
  button('program-exit', 'program', 'Exit', 'edit'),
  button('program-morph-wheel', 'program', 'Morph assign wheel', 'morph'),
  button('program-morph-at', 'program', 'Morph assign aftertouch', 'morph'),
  button('program-morph-pedal', 'program', 'Morph assign control pedal', 'morph'),

  button('synth-on', 'synth', 'Synth on', 'power'),
  oled('synth-oled', 'synth', 'Synth display'),
  button('synth-layer-a-enable', 'synth', 'Synth layer A enable', 'layer-a'),
  button('synth-layer-a-focus', 'synth', 'Synth layer A focus', 'layer-a', 1),
  fader('synth-layer-a-level', 'synth', 'Synth layer A level', 'layer-a'),
  button('synth-layer-b-enable', 'synth', 'Synth layer B enable', 'layer-b'),
  button('synth-layer-b-focus', 'synth', 'Synth layer B focus', 'layer-b'),
  fader('synth-layer-b-level', 'synth', 'Synth layer B level', 'layer-b', 0.7),
  button('synth-layer-c-enable', 'synth', 'Synth layer C enable', 'layer-c'),
  button('synth-layer-c-focus', 'synth', 'Synth layer C focus', 'layer-c'),
  fader('synth-layer-c-level', 'synth', 'Synth layer C level', 'layer-c', 0.7),
  button('synth-oct-down', 'synth', 'Synth octave down', 'octave'),
  button('synth-oct-up', 'synth', 'Synth octave up', 'octave'),
  encoder('synth-osc-wave', 'synth', 'Oscillator waveform', 'osc'),
  knob('synth-osc-shape', 'synth', 'Oscillator shape', 'osc', 0.4),
  knob('synth-osc-detune', 'synth', 'Oscillator detune', 'osc', 0.15),
  knob('synth-osc-semi', 'synth', 'Oscillator semitone', 'osc', 0.5),
  button('synth-filter-type', 'synth', 'Filter type', 'filter'),
  knob('synth-filter-freq', 'synth', 'Filter frequency', 'filter', 0.65),
  knob('synth-filter-res', 'synth', 'Filter resonance', 'filter', 0.2),
  knob('synth-filter-drive', 'synth', 'Filter drive', 'filter', 0.1),
  knob('synth-filter-kb', 'synth', 'Filter keyboard track', 'filter', 0.5),
  knob('synth-env-attack', 'synth', 'Amp attack', 'amp-env', 0.05),
  knob('synth-env-decay', 'synth', 'Amp decay', 'amp-env', 0.35),
  knob('synth-env-sustain', 'synth', 'Amp sustain', 'amp-env', 0.7),
  knob('synth-env-release', 'synth', 'Amp release', 'amp-env', 0.3),
  knob('synth-mod-attack', 'synth', 'Mod attack', 'mod-env', 0.1),
  knob('synth-mod-decay', 'synth', 'Mod decay', 'mod-env', 0.4),
  knob('synth-mod-amount', 'synth', 'Mod amount', 'mod-env', 0.25),
  knob('synth-lfo-rate', 'synth', 'LFO rate', 'lfo', 0.35),
  knob('synth-lfo-amount', 'synth', 'LFO amount', 'lfo', 0.15),
  button('synth-lfo-wave', 'synth', 'LFO waveform', 'lfo'),
  button('synth-arp-on', 'synth', 'Arpeggiator on', 'lfo'),
  knob('synth-glide', 'synth', 'Glide', 'misc', 0),
  knob('synth-unison', 'synth', 'Synth unison', 'misc', 0),
  knob('synth-vibrato', 'synth', 'Synth vibrato', 'misc', 0.1),
  button('synth-sustped', 'synth', 'Synth sustain pedal enable', 'assign'),
  button('synth-pstick', 'synth', 'Synth pitch stick enable', 'assign'),

  button('fx-focus-a', 'effects', 'Effects focus A', 'focus', 1),
  button('fx-focus-b', 'effects', 'Effects focus B', 'focus'),
  button('fx-focus-c', 'effects', 'Effects focus C', 'focus'),
  button('fx-on', 'effects', 'Layer effects on', 'power', 1),
  button('fx-group', 'effects', 'Piano effects group', 'focus'),
  button('fx1-on', 'effects', 'Effect 1 on', 'fx1'),
  button('fx1-type', 'effects', 'Effect 1 type', 'fx1'),
  knob('fx1-rate', 'effects', 'Effect 1 rate', 'fx1', 0.4),
  knob('fx1-amount', 'effects', 'Effect 1 amount', 'fx1', 0.35),
  button('fx2-on', 'effects', 'Effect 2 on', 'fx2'),
  button('fx2-type', 'effects', 'Effect 2 type', 'fx2'),
  knob('fx2-rate', 'effects', 'Effect 2 rate', 'fx2', 0.4),
  knob('fx2-amount', 'effects', 'Effect 2 amount', 'fx2', 0.35),
  button('amp-on', 'effects', 'Amp/EQ on', 'amp'),
  button('amp-type', 'effects', 'Amp type', 'amp'),
  knob('amp-drive', 'effects', 'Amp drive', 'amp', 0.2),
  knob('amp-bass', 'effects', 'EQ bass', 'amp', 0.5),
  knob('amp-mid', 'effects', 'EQ mid', 'amp', 0.5),
  knob('amp-mid-freq', 'effects', 'EQ mid frequency', 'amp', 0.4),
  knob('amp-treble', 'effects', 'EQ treble', 'amp', 0.5),
  button('comp-on', 'effects', 'Compressor on', 'comp'),
  knob('comp-amount', 'effects', 'Compressor amount', 'comp', 0.3),
  button('comp-fast', 'effects', 'Compressor fast', 'comp'),
  button('comp-global', 'effects', 'Compressor global', 'comp'),
  button('delay-on', 'effects', 'Delay on', 'delay'),
  knob('delay-tempo', 'effects', 'Delay tempo', 'delay', 0.45),
  knob('delay-feedback', 'effects', 'Delay feedback', 'delay', 0.25),
  knob('delay-mix', 'effects', 'Delay mix', 'delay', 0.2),
  button('delay-filter', 'effects', 'Delay feedback filter', 'delay'),
  button('delay-tap', 'effects', 'Delay tap tempo', 'delay'),
  button('delay-global', 'effects', 'Delay global', 'delay'),
  button('reverb-on', 'effects', 'Reverb on', 'reverb'),
  button('reverb-type', 'effects', 'Reverb type', 'reverb'),
  knob('reverb-mix', 'effects', 'Reverb mix', 'reverb', 0.28),
  button('reverb-bright', 'effects', 'Reverb bright', 'reverb', 1),
  button('reverb-global', 'effects', 'Reverb global', 'reverb'),
  button('rotary-on', 'effects', 'Rotary speaker on', 'rotary'),
  knob('rotary-speed', 'effects', 'Rotary speed', 'rotary', 0.35),
  knob('rotary-drive-fx', 'effects', 'Rotary speaker drive', 'rotary', 0.2),
]

export const CONTROL_BY_ID = Object.fromEntries(CONTROLS.map((c) => [c.id, c])) as Record<
  string,
  ControlDef
>

export const INTERACTIVE_CONTROLS = CONTROLS.filter((c) => c.kind !== 'oled')
export const OLED_CONTROLS = CONTROLS.filter((c) => c.kind === 'oled')

export function defaultHardwareValues(): Record<string, number> {
  const values: Record<string, number> = {}
  for (const control of CONTROLS) values[control.id] = control.defaultValue
  return values
}
