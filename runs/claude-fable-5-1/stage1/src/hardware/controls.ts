/**
 * Normalized hardware inventory of every visible physical input on the Nord Stage 4 deck.
 * Every control has a stable id (`<section>.<group>.<control>`), an accessible name, a kind and a
 * presentation-only value model. Nothing here produces sound or program state in Phase 1.
 */
import type { SectionId } from './sections'

export type ControlKind = 'knob' | 'dial' | 'button' | 'fader' | 'drawbar' | 'wheel' | 'stick'
export type ButtonMode = 'toggle' | 'select' | 'momentary' | 'radio'
export type ButtonStyle = 'dark' | 'gray' | 'red' | 'gray-tall' | 'dark-wide'
export type KnobScale = 'unipolar' | 'bipolar10' | 'bipolar15' | 'freq' | 'range' | 'level'
export type LedColor = 'red' | 'green' | 'yellow'

export interface ControlBase {
  id: string
  section: SectionId
  kind: ControlKind
  /** Accessible name. */
  name: string
  /** Printed legend on the panel (may be empty for unlabeled controls). */
  legend?: string
}

export interface ContinuousControl extends ControlBase {
  kind: 'knob' | 'dial' | 'fader' | 'drawbar' | 'wheel' | 'stick'
  min: number
  max: number
  step: number
  initial: number
  /** Endless encoder: value wraps around. */
  wrap?: boolean
  /** Springs back to the initial value when released (pitch stick). */
  springBack?: boolean
  scale?: KnobScale
  cap?: 'black' | 'white' | 'gray'
  ladder?: LedColor
  size?: 'small' | 'medium' | 'large'
  unit?: string
}

export interface ButtonControl extends ControlBase {
  kind: 'button'
  mode: ButtonMode
  style: ButtonStyle
  /** Select buttons cycle through these options (index stored as value). */
  options?: string[]
  /** Toggle buttons: initial lit state. Select: initial index. */
  initial?: number
  /** Radio buttons share a group; exactly one is lit. */
  radioGroup?: string
  /** Legend of the associated LED for toggles. */
  ledLegend?: string
  ledColor?: LedColor
  /** Shift / hold function printed below the button. */
  shiftLegend?: string
}

export type ControlSpec = ContinuousControl | ButtonControl

type Cont = Partial<Omit<ContinuousControl, 'id' | 'section' | 'kind' | 'name'>>
type Btn = Partial<Omit<ButtonControl, 'id' | 'section' | 'kind' | 'name'>>

function knob(section: SectionId, id: string, name: string, extra: Cont = {}): ContinuousControl {
  return { id, section, kind: 'knob', name, min: 0, max: 10, step: 0.1, initial: 5, scale: 'unipolar', ...extra }
}
function dial(section: SectionId, id: string, name: string, extra: Cont = {}): ContinuousControl {
  return { id, section, kind: 'dial', name, min: 0, max: 345, step: 15, initial: 0, wrap: true, ...extra }
}
function fader(section: SectionId, id: string, name: string, initial = 80, extra: Cont = {}): ContinuousControl {
  return { id, section, kind: 'fader', name, min: 0, max: 100, step: 1, initial, ladder: 'green', cap: 'gray', ...extra }
}
function drawbar(section: SectionId, id: string, name: string, initial: number, cap: 'black' | 'white', legend: string): ContinuousControl {
  return { id, section, kind: 'drawbar', name, legend, min: 0, max: 8, step: 1, initial, ladder: 'red', cap }
}
function button(section: SectionId, id: string, name: string, extra: Btn = {}): ButtonControl {
  return { id, section, kind: 'button', name, mode: 'toggle', style: 'dark', ...extra }
}
function select(section: SectionId, id: string, name: string, options: string[], extra: Btn = {}): ButtonControl {
  return { id, section, kind: 'button', name, mode: 'select', style: 'dark', options, initial: 0, ...extra }
}
function momentary(section: SectionId, id: string, name: string, extra: Btn = {}): ButtonControl {
  return { id, section, kind: 'button', name, mode: 'momentary', style: 'dark', ...extra }
}

const performance: ControlSpec[] = [
  knob('performance', 'performance.master-level', 'Master level', { initial: 7, scale: 'level', legend: 'MASTER LEVEL' }),
  { id: 'performance.pitch-stick', section: 'performance', kind: 'stick', name: 'Pitch stick', min: -1, max: 1, step: 0.05, initial: 0, springBack: true },
  { id: 'performance.mod-wheel', section: 'performance', kind: 'wheel', name: 'Modulation wheel', min: 0, max: 1, step: 0.01, initial: 0 },
  knob('performance', 'performance.rotary.drive', 'Rotary speaker drive', { initial: 2, legend: 'DRIVE' }),
  button('performance', 'performance.rotary.organ', 'Rotary speaker organ routing', { style: 'gray', ledLegend: 'ORGAN', shiftLegend: 'CLOSE MIC' }),
  button('performance', 'performance.rotary.stop-mode', 'Rotary speaker stop mode', { ledLegend: 'STOP MODE', shiftLegend: 'ANGLE' }),
  select('performance', 'performance.rotary.speed', 'Rotary speaker speed', ['Slow', 'Fast'], { shiftLegend: 'MORPH' }),
]

const organ: ControlSpec[] = [
  button('organ', 'organ.on', 'Organ section on', { ledLegend: 'ON', shiftLegend: 'SOLO' }),
  fader('organ', 'organ.layer-a.level', 'Organ layer A level', 78),
  fader('organ', 'organ.layer-b.level', 'Organ layer B level', 55),
  button('organ', 'organ.layer-a.on', 'Organ layer A on/off', { style: 'gray', ledLegend: 'ON/OFF', ledColor: 'green', initial: 1 }),
  button('organ', 'organ.layer-b.on', 'Organ layer B on/off', { style: 'gray', ledLegend: 'ON/OFF', ledColor: 'green' }),
  button('organ', 'organ.preset', 'Organ preset', { ledLegend: 'PRESET', shiftLegend: 'SYNC' }),
  momentary('organ', 'organ.octave-down', 'Organ octave shift down'),
  momentary('organ', 'organ.octave-up', 'Organ octave shift up'),
  select('organ', 'organ.model', 'Organ model', ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2', 'B3 Bass']),
  select('organ', 'organ.vibrato.mode', 'Vibrato/chorus mode', ['V1', 'C1', 'V2', 'C2', 'V3', 'C3'], { initial: 5 }),
  button('organ', 'organ.vibrato.on', 'Vibrato/chorus on', { style: 'gray', ledLegend: 'ON' }),
  button('organ', 'organ.percussion.volume', 'Percussion volume soft', { ledLegend: 'SOFT' }),
  button('organ', 'organ.percussion.decay', 'Percussion decay fast', { ledLegend: 'FAST', initial: 1 }),
  button('organ', 'organ.percussion.harmonic', 'Percussion harmonic third', { ledLegend: 'THIRD', initial: 1 }),
  button('organ', 'organ.percussion.on', 'Percussion on', { style: 'gray', ledLegend: 'ON', shiftLegend: 'POLY' }),
  drawbar('organ', 'organ.drawbar.16', "Drawbar 16'", 7, 'black', "16'"),
  drawbar('organ', 'organ.drawbar.5-1-3', "Drawbar 5 1/3'", 3, 'black', "5⅓'"),
  drawbar('organ', 'organ.drawbar.8', "Drawbar 8'", 8, 'white', "8'"),
  drawbar('organ', 'organ.drawbar.4', "Drawbar 4'", 4, 'white', "4'"),
  drawbar('organ', 'organ.drawbar.2-2-3', "Drawbar 2 2/3'", 5, 'black', "2⅔'"),
  drawbar('organ', 'organ.drawbar.2', "Drawbar 2'", 3, 'white', "2'"),
  drawbar('organ', 'organ.drawbar.1-3-5', "Drawbar 1 3/5'", 2, 'black', "1⅗'"),
  drawbar('organ', 'organ.drawbar.1-1-3', "Drawbar 1 1/3'", 2, 'black', "1⅓'"),
  drawbar('organ', 'organ.drawbar.1', "Drawbar 1'", 3, 'white', "1'"),
]

const piano: ControlSpec[] = [
  button('piano', 'piano.on', 'Piano section on', { ledLegend: 'ON', shiftLegend: 'SOLO', initial: 1 }),
  fader('piano', 'piano.layer-a.level', 'Piano layer A level', 90),
  fader('piano', 'piano.layer-b.level', 'Piano layer B level', 45),
  button('piano', 'piano.layer-a.on', 'Piano layer A on/off', { style: 'gray', ledLegend: 'ON/OFF', ledColor: 'green', initial: 1 }),
  button('piano', 'piano.layer-b.on', 'Piano layer B on/off', { style: 'gray', ledLegend: 'ON/OFF', ledColor: 'green' }),
  select('piano', 'piano.timbre', 'Piano timbre', ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2']),
  momentary('piano', 'piano.octave-down', 'Piano octave shift down'),
  momentary('piano', 'piano.octave-up', 'Piano octave shift up'),
  select('piano', 'piano.acoustics', 'Piano acoustics', ['Off', 'Soft release', 'String resonance', 'Soft release and string resonance'], { initial: 2 }),
  select('piano', 'piano.kb-touch', 'Piano keyboard touch', ['Heavy', 'Medium', 'Light'], { initial: 1 }),
  select('piano', 'piano.unison', 'Piano unison', ['Off', '1', '2', '3']),
  select('piano', 'piano.dyn-comp', 'Piano dynamic compression', ['Off', '1', '2', '3']),
  select('piano', 'piano.type', 'Piano type', ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'], { shiftLegend: 'INFO' }),
  dial('piano', 'piano.model', 'Piano model dial', { legend: 'MODEL', size: 'medium' }),
]

const program: ControlSpec[] = [
  button('program', 'program.morph.wheel', 'Morph assign wheel', { ledLegend: 'WHEEL', ledColor: 'green', initial: 1 }),
  button('program', 'program.morph.aftertouch', 'Morph assign aftertouch', { ledLegend: 'A.T.' }),
  button('program', 'program.morph.control-pedal', 'Morph assign control pedal', { ledLegend: 'CTRLPED' }),
  button('program', 'program.split', 'Split on/set', { ledLegend: 'ON/SET', shiftLegend: 'SET KEY', ledColor: 'yellow', initial: 1 }),
  button('program', 'program.master-clock', 'Master clock tap/set', { ledLegend: 'TAP/SET', shiftLegend: 'PEDAL TAP' }),
  button('program', 'program.transpose', 'Transpose on/set', { ledLegend: 'ON/SET', shiftLegend: 'PANIC' }),
  button('program', 'program.store', 'Store', { style: 'red', ledLegend: 'STORE', shiftLegend: 'STORE AS…' }),
  button('program', 'program.preset-library.organ', 'Preset library organ', { ledLegend: 'ORGAN' }),
  button('program', 'program.preset-library.piano', 'Preset library piano', { ledLegend: 'PIANO' }),
  button('program', 'program.preset-library.synth', 'Preset library synth', { ledLegend: 'SYNTH' }),
  momentary('program', 'program.prog-view', 'Program view', { shiftLegend: 'PRESET NAME' }),
  dial('program', 'program.dial', 'Program dial', { legend: 'PROGRAM', size: 'large' }),
  momentary('program', 'program.page-prev', 'Page / category previous'),
  momentary('program', 'program.page-next', 'Page / category next'),
  button('program', 'program.live-mode', 'Live mode', { style: 'gray', ledLegend: 'LIVE MODE', shiftLegend: 'NUM PAD' }),
  button('program', 'program.layer-scene', 'Layer scene II', { ledLegend: 'LAYER SCENE II', shiftLegend: 'PEDAL' }),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    button('program', `program.button.${n}`, `Program ${n}`, {
      mode: 'radio',
      radioGroup: 'program.buttons',
      initial: n === 1 ? 1 : 0,
      ledLegend: String(n),
      shiftLegend: ['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB', 'OUTPUT', 'PEDAL', 'MIDI', 'EXTERN'][n - 1],
    }),
  ),
  button('program', 'program.solo', 'Solo', { ledLegend: 'SOLO', shiftLegend: 'UNDO' }),
  button('program', 'program.section-edit', 'Section edit', { ledLegend: 'SECTION EDIT', shiftLegend: 'LAYER INIT' }),
  momentary('program', 'program.mon-copy', 'Monitor / copy', { shiftLegend: 'PASTE' }),
  momentary('program', 'program.shift', 'Shift / Exit', { style: 'gray-tall' }),
]

const synth: ControlSpec[] = [
  button('synth', 'synth.on', 'Synth section on', { ledLegend: 'ON', shiftLegend: 'SOLO', initial: 1 }),
  fader('synth', 'synth.layer-a.level', 'Synth layer A level', 82),
  fader('synth', 'synth.layer-b.level', 'Synth layer B level', 40),
  fader('synth', 'synth.layer-c.level', 'Synth layer C level', 66),
  button('synth', 'synth.layer-a.on', 'Synth layer A on/off', { style: 'gray', ledLegend: 'ON/OFF', ledColor: 'yellow', initial: 1 }),
  button('synth', 'synth.layer-b.on', 'Synth layer B on/off', { style: 'gray', ledLegend: 'ON/OFF', ledColor: 'yellow' }),
  button('synth', 'synth.layer-c.on', 'Synth layer C on/off', { style: 'gray', ledLegend: 'ON/OFF', ledColor: 'yellow' }),
  button('synth', 'synth.kb-hold', 'Keyboard hold', { ledLegend: 'KB HOLD', shiftLegend: 'EXCLUDE' }),
  button('synth', 'synth.arp-run', 'Arpeggiator run', { style: 'red', ledLegend: 'ARP RUN', shiftLegend: 'KB SYNC' }),
  momentary('synth', 'synth.octave-down', 'Synth octave shift down'),
  momentary('synth', 'synth.octave-up', 'Synth octave shift up'),
  dial('synth', 'synth.dial-1', 'Synth display dial 1', { legend: 'INFO' }),
  dial('synth', 'synth.dial-2', 'Synth display dial 2', { legend: 'LIST' }),
  dial('synth', 'synth.dial-3', 'Synth display dial 3', { legend: 'LIST' }),
  select('synth', 'synth.mode', 'Synth mode', ['Analog', 'Samples', 'Extern']),
  momentary('synth', 'synth.waveform', 'Waveform', { shiftLegend: 'SOUND INIT' }),
  knob('synth', 'synth.arp.rate', 'Arpeggiator rate/time', { initial: 4, legend: 'RATE/TIME' }),
  select('synth', 'synth.arp.mode', 'Arpeggiator mode', ['Arp', 'Poly', 'Gate']),
  knob('synth', 'synth.arp.range', 'Arpeggiator range', { initial: 2, scale: 'range', legend: 'RANGE' }),
  button('synth', 'synth.arp.menu', 'Arpeggiator menu', { ledLegend: 'MENU', shiftLegend: 'GROUP' }),
  select('synth', 'synth.voice.mode', 'Voice mode', ['Poly', 'Mono', 'Legato']),
  knob('synth', 'synth.voice.glide', 'Glide', { initial: 3, legend: 'GLIDE' }),
  select('synth', 'synth.vibrato.mode', 'Vibrato mode', ['Off', 'Wheel', 'Delay', 'On', 'Aftertouch', 'Pedal']),
  button('synth', 'synth.vibrato.menu', 'Vibrato menu', { ledLegend: 'MENU' }),
  momentary('synth', 'synth.lfo.waveform', 'LFO waveform', { shiftLegend: 'GROUP' }),
  knob('synth', 'synth.lfo.mod-amount', 'LFO modulation amount', { initial: 4, legend: 'MOD AMT' }),
  knob('synth', 'synth.lfo.rate', 'LFO rate/time', { initial: 5, legend: 'RATE/TIME' }),
  select('synth', 'synth.lfo.destination', 'LFO destination', ['Osc pitch', 'Osc ctrl', 'Filter']),
  momentary('synth', 'synth.osc.pitch', 'Oscillator pitch / sample', { shiftLegend: 'ENV TO PITCH' }),
  momentary('synth', 'synth.osc.envelope', 'Oscillator envelope', { shiftLegend: 'VELOCITY' }),
  knob('synth', 'synth.osc.ctrl', 'Oscillator control', { initial: 6, legend: 'OSC CTRL' }),
  knob('synth', 'synth.osc.env-amount', 'Oscillator envelope amount', { min: -10, max: 10, initial: 0, scale: 'bipolar10', legend: 'ENV AMT' }),
  momentary('synth', 'synth.filter.type', 'Filter type', { shiftLegend: 'GROUP' }),
  momentary('synth', 'synth.filter.envelope', 'Filter envelope', { shiftLegend: 'VELOCITY' }),
  knob('synth', 'synth.filter.env-amount', 'Filter envelope amount', { initial: 6, legend: 'ENV AMT' }),
  knob('synth', 'synth.filter.freq', 'Filter frequency', { initial: 6, legend: 'FREQ' }),
  knob('synth', 'synth.filter.resonance', 'Filter resonance / high-pass frequency', { initial: 2, legend: 'RES/FREQ HP' }),
  button('synth', 'synth.filter.on', 'Filter on', { style: 'gray-tall', ledLegend: 'ON', initial: 1 }),
  momentary('synth', 'synth.amp.envelope', 'Amp envelope', { shiftLegend: 'VELOCITY' }),
  select('synth', 'synth.unison', 'Synth unison', ['Off', '1', '2', '3']),
]

const effects: ControlSpec[] = [
  button('effects', 'effects.on', 'Layer effects on', { ledLegend: 'ON', initial: 1 }),
  button('effects', 'effects.focus.organ', 'Effects focus organ', { mode: 'radio', radioGroup: 'effects.focus', ledLegend: 'ORGAN', shiftLegend: 'ALL FX OFF' }),
  button('effects', 'effects.focus.piano', 'Effects focus piano', { mode: 'radio', radioGroup: 'effects.focus', ledLegend: 'PIANO', shiftLegend: 'GROUP', initial: 1 }),
  button('effects', 'effects.focus.synth', 'Effects focus synth', { mode: 'radio', radioGroup: 'effects.focus', ledLegend: 'SYNTH', shiftLegend: 'GROUP' }),
  momentary('effects', 'effects.shift', 'Shift / Exit (layer effects)', { style: 'gray-tall' }),
  knob('effects', 'effects.mod1.rate', 'Mod 1 rate', { initial: 4, legend: 'RATE' }),
  knob('effects', 'effects.mod1.amount', 'Mod 1 amount', { initial: 5, legend: 'AMOUNT' }),
  select('effects', 'effects.mod1.type', 'Mod 1 type', ['RM', 'Trem', 'A-Pan', 'A-Wah', 'Wah', 'Pump'], { initial: 5, shiftLegend: 'VARIATION' }),
  button('effects', 'effects.mod1.on', 'Mod 1 on', { style: 'gray-tall', ledLegend: 'ON' }),
  knob('effects', 'effects.mod2.rate', 'Mod 2 rate', { initial: 3, legend: 'RATE' }),
  knob('effects', 'effects.mod2.amount', 'Mod 2 amount', { initial: 6, legend: 'AMOUNT' }),
  select('effects', 'effects.mod2.type', 'Mod 2 type', ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'], { shiftLegend: 'VARIATION' }),
  button('effects', 'effects.mod2.on', 'Mod 2 on', { style: 'gray-tall', ledLegend: 'ON' }),
  knob('effects', 'effects.amp.drive', 'Amp simulator drive', { initial: 3, legend: 'DRIVE' }),
  knob('effects', 'effects.amp.freq', 'Amp simulator mid frequency', { initial: 5, scale: 'freq', legend: 'FREQ' }),
  select('effects', 'effects.amp.model', 'Amp simulator model', ['Small', 'JC', 'Twin', 'To rotary', 'LP filter', 'HP filter'], { initial: 2, shiftLegend: 'VARIATION' }),
  knob('effects', 'effects.amp.bass', 'EQ bass', { min: -15, max: 15, initial: 0, scale: 'bipolar15', legend: 'BASS' }),
  knob('effects', 'effects.amp.mid', 'EQ mid', { min: -15, max: 15, initial: 0, scale: 'bipolar15', legend: 'MID' }),
  knob('effects', 'effects.amp.treble', 'EQ treble', { min: -15, max: 15, initial: 0, scale: 'bipolar15', legend: 'TREBLE' }),
  button('effects', 'effects.amp.on', 'Amp simulator / EQ on', { style: 'gray-tall', ledLegend: 'ON' }),
  knob('effects', 'effects.delay.tempo', 'Delay tempo', { initial: 5, legend: 'TEMPO' }),
  select('effects', 'effects.delay.effect', 'Delay effect', ['Off', 'Chorus', 'Vibe', 'Ensemble', 'Flam', 'Space'], { initial: 2, shiftLegend: 'VARIATION' }),
  knob('effects', 'effects.delay.feedback', 'Delay feedback', { initial: 6, legend: 'FEEDBACK' }),
  select('effects', 'effects.delay.filter', 'Delay filter', ['Off', 'HP', 'BP', 'LP'], { initial: 3, shiftLegend: 'PING PONG' }),
  momentary('effects', 'effects.delay.tap', 'Delay tap / set', { shiftLegend: 'ANALOG' }),
  knob('effects', 'effects.delay.dry-wet', 'Delay dry/wet', { initial: 4, legend: 'DRY WET' }),
  button('effects', 'effects.delay.on', 'Delay on', { style: 'gray', ledLegend: 'ON', shiftLegend: 'GLOBAL' }),
  knob('effects', 'effects.comp.amount', 'Compressor amount', { initial: 5, legend: 'AMOUNT' }),
  button('effects', 'effects.comp.on', 'Compressor on', { style: 'gray', ledLegend: 'ON', shiftLegend: 'GLOBAL' }),
  select('effects', 'effects.reverb.tone', 'Reverb tone', ['Off', 'Bright', 'Dark']),
  select('effects', 'effects.reverb.type', 'Reverb type', ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cath'], { initial: 5, shiftLegend: 'VAR | CHORALE' }),
  knob('effects', 'effects.reverb.dry-wet', 'Reverb dry/wet', { initial: 6, legend: 'DRY WET' }),
  button('effects', 'effects.reverb.on', 'Reverb on', { style: 'gray', ledLegend: 'ON', shiftLegend: 'GLOBAL', initial: 1 }),
]

export const CONTROLS: readonly ControlSpec[] = [...performance, ...organ, ...piano, ...program, ...synth, ...effects]

export const CONTROL_BY_ID: ReadonlyMap<string, ControlSpec> = new Map(CONTROLS.map((c) => [c.id, c]))

export function getControl(id: string): ControlSpec {
  const spec = CONTROL_BY_ID.get(id)
  if (!spec) throw new Error(`Unknown control id: ${id}`)
  return spec
}

export function controlsInSection(section: SectionId): ControlSpec[] {
  return CONTROLS.filter((c) => c.section === section)
}

export function initialValue(spec: ControlSpec): number {
  if (spec.kind === 'button') return spec.mode === 'momentary' ? 0 : (spec.initial ?? 0)
  return spec.initial
}

/** Display elements (OLEDs). Only Program and Synth carry a primary OLED. */
export const DISPLAYS = [
  { id: 'program.oled', section: 'program' as SectionId, name: 'Program display', primary: true },
  { id: 'synth.oled', section: 'synth' as SectionId, name: 'Synth display', primary: true },
] as const
