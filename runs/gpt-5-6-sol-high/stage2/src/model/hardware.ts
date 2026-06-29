export type ControlType = 'button' | 'knob' | 'encoder' | 'fader' | 'display' | 'meter' | 'wheel'

export interface HardwareControl {
  id: string
  type: ControlType
  label: string
  group: string
  initial?: number | boolean
  size?: 'small' | 'medium' | 'large' | 'wide'
  tone?: 'red' | 'green' | 'amber' | 'cyan' | 'white' | 'black'
}

export interface HardwareSection {
  id: 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
  label: string
  fraction: number
  controls: HardwareControl[]
}

export interface PianoKey {
  id: string
  midi: number
  note: string
  black: boolean
  whiteIndex: number
  blackLeft?: number
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export const KEYS: PianoKey[] = (() => {
  let whiteIndex = 0
  return Array.from({ length: 73 }, (_, offset) => {
    const midi = 28 + offset
    const pitchClass = midi % 12
    const black = BLACK_PITCH_CLASSES.has(pitchClass)
    const octave = Math.floor(midi / 12) - 1
    const key: PianoKey = {
      id: `key-${midi}`,
      midi,
      note: `${NOTE_NAMES[pitchClass]}${octave}`,
      black,
      whiteIndex,
      ...(black ? { blackLeft: (whiteIndex / 43) * 100 } : {}),
    }
    if (!black) whiteIndex += 1
    return key
  })
})()

const button = (id: string, label: string, group: string, initial = false): HardwareControl => ({
  id, type: 'button', label, group, initial, tone: 'red',
})
const knob = (id: string, label: string, group: string, initial = 45, size: HardwareControl['size'] = 'medium'): HardwareControl => ({
  id, type: 'knob', label, group, initial, size,
})
const encoder = (id: string, label: string, group: string, initial = 50): HardwareControl => ({
  id, type: 'encoder', label, group, initial, size: 'large',
})
const fader = (id: string, label: string, group: string, initial = 62, tone: HardwareControl['tone'] = 'white'): HardwareControl => ({
  id, type: 'fader', label, group, initial, tone,
})
const display = (id: string, label: string, group: string, size: HardwareControl['size'] = 'wide'): HardwareControl => ({
  id, type: 'display', label, group, size, tone: 'cyan',
})
const meter = (id: string, label: string, group: string): HardwareControl => ({
  id, type: 'meter', label, group, tone: 'green',
})

const PERFORMANCE: HardwareControl[] = [
  { id: 'perf-pitch-stick', type: 'wheel', label: 'Pitch stick', group: 'wheels', initial: 50 },
  { id: 'perf-mod-wheel', type: 'wheel', label: 'Modulation wheel', group: 'wheels', initial: 35 },
  knob('perf-master-level', 'Master level', 'master', 67, 'large'),
  button('perf-organ-enable', 'Organ enable', 'layers', true),
  button('perf-piano-enable', 'Piano enable', 'layers', true),
  button('perf-synth-enable', 'Synth enable', 'layers'),
  button('perf-panel-a', 'Panel A', 'layers', true),
  button('perf-panel-b', 'Panel B', 'layers'),
  button('perf-external-sync', 'External sync', 'utility'),
  knob('perf-monitor-level', 'Monitor level', 'utility', 35, 'small'),
]

const ORGAN: HardwareControl[] = [
  display('organ-display', 'Organ model display', 'header'),
  meter('organ-level-meter', 'Organ level', 'header'),
  ...Array.from({ length: 9 }, (_, index) => fader(`organ-drawbar-${index + 1}`, `Drawbar ${index + 1}`, 'drawbars', 75 - ((index * 11) % 58), index % 3 === 0 ? 'red' : 'white')),
  button('organ-model-b3', 'B3 model', 'model', true),
  button('organ-model-vox', 'Vox model', 'model'),
  button('organ-model-farf', 'Farfisa model', 'model'),
  button('organ-model-pipe', 'Pipe model', 'model'),
  button('organ-vibrato-chorus', 'Vibrato chorus', 'vibrato', true),
  button('organ-percussion', 'Percussion', 'vibrato'),
  button('organ-soft', 'Percussion soft', 'vibrato'),
  button('organ-fast', 'Percussion fast', 'vibrato'),
  button('organ-rotary-stop', 'Rotary stop mode', 'rotary'),
  button('organ-rotary-speed', 'Rotary speed', 'rotary', true),
  knob('organ-key-click', 'Key click', 'detail', 42, 'small'),
  knob('organ-bass-level', 'Bass level', 'detail', 55, 'small'),
  knob('organ-drive', 'Organ drive', 'detail', 34, 'small'),
  button('organ-preset', 'Organ preset', 'preset'),
  button('organ-drawbar-live', 'Drawbar live', 'preset', true),
]

const PIANO: HardwareControl[] = [
  display('piano-display', 'Piano model display', 'header'),
  meter('piano-meter-a', 'Piano A level', 'level'),
  meter('piano-meter-b', 'Piano B level', 'level'),
  fader('piano-level-a', 'Piano A level', 'level', 76, 'white'),
  fader('piano-level-b', 'Piano B level', 'level', 58, 'black'),
  button('piano-type-grand', 'Grand piano', 'type', true),
  button('piano-type-upright', 'Upright piano', 'type'),
  button('piano-type-electric', 'Electric piano', 'type'),
  button('piano-type-clav', 'Clavinet', 'type'),
  button('piano-type-digital', 'Digital piano', 'type'),
  button('piano-type-misc', 'Misc piano', 'type'),
  encoder('piano-model', 'Piano model', 'model', 44),
  button('piano-timbre-soft', 'Soft timbre', 'timbre'),
  button('piano-timbre-mid', 'Mid timbre', 'timbre', true),
  button('piano-timbre-bright', 'Bright timbre', 'timbre'),
  knob('piano-dynamic-compression', 'Dynamic compression', 'detail', 28, 'small'),
  knob('piano-unison', 'Unison', 'detail', 16, 'small'),
  button('piano-pedal-noise', 'Pedal noise', 'detail', true),
  button('piano-string-resonance', 'String resonance', 'detail', true),
  button('piano-clav-eq', 'Clavinet EQ', 'detail'),
]

const PROGRAM: HardwareControl[] = [
  display('program-display', 'Program display', 'display'),
  encoder('program-dial', 'Program dial', 'navigation', 35),
  button('program-up', 'Program up', 'navigation'),
  button('program-down', 'Program down', 'navigation'),
  button('program-page', 'Page', 'navigation'),
  button('program-shift', 'Shift', 'navigation'),
  button('program-store', 'Store', 'navigation'),
  button('program-live-1', 'Live 1', 'memory'),
  button('program-live-2', 'Live 2', 'memory'),
  button('program-live-3', 'Live 3', 'memory'),
  button('program-live-4', 'Live 4', 'memory'),
  button('program-live-5', 'Live 5', 'memory'),
  button('program-morph-wheel', 'Wheel morph', 'morph'),
  button('program-morph-aftertouch', 'Aftertouch morph', 'morph'),
  button('program-morph-pedal', 'Pedal morph', 'morph'),
  button('program-layer-scene', 'Layer scene', 'morph', true),
]

const SYNTH: HardwareControl[] = [
  display('synth-display', 'Synth display', 'header'),
  meter('synth-meter-a', 'Synth A level', 'level'),
  meter('synth-meter-b', 'Synth B level', 'level'),
  fader('synth-level-a', 'Synth A level', 'level', 64, 'white'),
  fader('synth-level-b', 'Synth B level', 'level', 48, 'black'),
  encoder('synth-sample', 'Sample select', 'oscillator', 61),
  knob('synth-waveform', 'Waveform', 'oscillator', 32),
  knob('synth-pitch', 'Oscillator pitch', 'oscillator', 50),
  knob('synth-shape', 'Oscillator shape', 'oscillator', 22),
  knob('synth-filter-frequency', 'Filter frequency', 'filter', 69, 'large'),
  knob('synth-filter-resonance', 'Filter resonance', 'filter', 33),
  knob('synth-filter-drive', 'Filter drive', 'filter', 18),
  knob('synth-env-attack', 'Envelope attack', 'envelope', 12),
  knob('synth-env-decay', 'Envelope decay', 'envelope', 51),
  knob('synth-env-release', 'Envelope release', 'envelope', 39),
  knob('synth-lfo-rate', 'LFO rate', 'modulation', 45),
  knob('synth-lfo-amount', 'LFO amount', 'modulation', 25),
  knob('synth-vibrato', 'Vibrato', 'modulation', 20),
  knob('synth-arp-rate', 'Arpeggiator rate', 'arpeggiator', 52),
  knob('synth-arp-range', 'Arpeggiator range', 'arpeggiator', 35),
  button('synth-osc-config', 'Oscillator configuration', 'oscillator'),
  button('synth-unison', 'Synth unison', 'oscillator', true),
  button('synth-filter-keyboard', 'Filter keyboard tracking', 'filter', true),
  button('synth-arp-run', 'Arpeggiator run', 'arpeggiator'),
  button('synth-arp-pattern', 'Arpeggiator pattern', 'arpeggiator'),
  button('synth-voice-mode', 'Voice mode', 'utility'),
  button('synth-glide', 'Glide', 'utility'),
]

const EFFECTS: HardwareControl[] = [
  display('effects-display', 'Layer effects display', 'header'),
  button('effects-layer-organ', 'Effects Organ layer', 'layer', true),
  button('effects-layer-piano', 'Effects Piano layer', 'layer'),
  button('effects-layer-synth', 'Effects Synth layer', 'layer'),
  knob('effects-1-rate', 'Effect 1 rate', 'effect1', 32),
  knob('effects-1-amount', 'Effect 1 amount', 'effect1', 42),
  encoder('effects-1-type', 'Effect 1 type', 'effect1', 18),
  button('effects-1-on', 'Effect 1 on', 'effect1', true),
  knob('effects-2-rate', 'Effect 2 rate', 'effect2', 52),
  knob('effects-2-amount', 'Effect 2 amount', 'effect2', 36),
  encoder('effects-2-type', 'Effect 2 type', 'effect2', 63),
  button('effects-2-on', 'Effect 2 on', 'effect2'),
  knob('effects-eq-bass', 'EQ bass', 'amp-eq', 48),
  knob('effects-eq-mid', 'EQ mid', 'amp-eq', 56),
  knob('effects-eq-treble', 'EQ treble', 'amp-eq', 52),
  knob('effects-amp-drive', 'Amp drive', 'amp-eq', 24),
  encoder('effects-amp-model', 'Amp model', 'amp-eq', 40),
  button('effects-amp-on', 'Amp simulator on', 'amp-eq', true),
  knob('effects-delay-tempo', 'Delay tempo', 'delay', 46, 'large'),
  knob('effects-delay-feedback', 'Delay feedback', 'delay', 29),
  knob('effects-delay-mix', 'Delay mix', 'delay', 22),
  button('effects-delay-tap', 'Tap tempo', 'delay'),
  button('effects-delay-on', 'Delay on', 'delay'),
  knob('effects-compressor', 'Compressor amount', 'dynamics', 38),
  button('effects-compressor-on', 'Compressor on', 'dynamics', true),
  knob('effects-reverb-size', 'Reverb size', 'reverb', 57),
  knob('effects-reverb-mix', 'Reverb mix', 'reverb', 31),
  knob('effects-reverb-bright', 'Reverb brightness', 'reverb', 49),
  button('effects-reverb-spring', 'Spring reverb', 'reverb'),
  button('effects-reverb-booth', 'Booth reverb', 'reverb', true),
  button('effects-reverb-stage', 'Stage reverb', 'reverb'),
  button('effects-reverb-hall', 'Hall reverb', 'reverb'),
  button('effects-reverb-on', 'Reverb on', 'reverb', true),
  knob('effects-rotary-speed', 'Rotary speed', 'rotary', 44),
  button('effects-rotary-drive', 'Rotary drive', 'rotary'),
]

export const HARDWARE_SECTIONS: HardwareSection[] = [
  { id: 'performance', label: 'Performance', fraction: 0.13, controls: PERFORMANCE },
  { id: 'organ', label: 'Organ', fraction: 0.21, controls: ORGAN },
  { id: 'piano', label: 'Piano', fraction: 0.15, controls: PIANO },
  { id: 'program', label: 'Program · Morph', fraction: 0.09, controls: PROGRAM },
  { id: 'synth', label: 'Synth', fraction: 0.21, controls: SYNTH },
  { id: 'effects', label: 'Layer Effects', fraction: 0.21, controls: EFFECTS },
]
