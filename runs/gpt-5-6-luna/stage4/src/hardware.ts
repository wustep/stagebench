export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects';
export type ControlKind = 'knob' | 'fader' | 'button' | 'led' | 'encoder' | 'display';

export interface HardwareControl {
  id: string;
  label: string;
  section: SectionId;
  kind: ControlKind;
  value?: number;
  min?: number;
  max?: number;
  group: string;
  accent?: 'red' | 'green' | 'blue' | 'white';
}

export interface HardwareSection {
  id: SectionId;
  label: string;
  fraction: number;
  eyebrow: string;
  controls: HardwareControl[];
  primaryDisplay?: string;
}

export const keyboardModel = {
  variant: 'stage-4-88',
  action: 'hammer action',
  range: 'A to C',
  totalKeys: 88,
  whiteKeys: 52,
  blackKeys: 36,
  blackKeyHeightFraction: 0.61,
};

const knob = (id: string, label: string, section: SectionId, group: string, value = 0.52, accent?: HardwareControl['accent']): HardwareControl => ({ id, label, section, kind: 'knob', value, min: 0, max: 1, group, accent });
const fader = (id: string, label: string, section: SectionId, group: string, value = 0.56, accent?: HardwareControl['accent']): HardwareControl => ({ id, label, section, kind: 'fader', value, min: 0, max: 1, group, accent });
const button = (id: string, label: string, section: SectionId, group: string, accent?: HardwareControl['accent']): HardwareControl => ({ id, label, section, kind: 'button', group, accent });
const led = (id: string, label: string, section: SectionId, group: string, accent: HardwareControl['accent'] = 'green'): HardwareControl => ({ id, label, section, kind: 'led', group, accent });

const performanceControls: HardwareControl[] = [
  knob('performance-master-level', 'Master level', 'performance', 'master', 0.68),
  button('performance-shift', 'Shift', 'performance', 'master', 'red'),
  button('performance-panic', 'Panic', 'performance', 'master', 'red'),
  button('performance-sustain', 'Sustain', 'performance', 'pedals', 'red'),
  button('performance-rotary', 'Rotary', 'performance', 'pedals', 'red'),
  button('performance-morph-wheel', 'Wheel morph', 'performance', 'morph', 'red'),
];

const organControls: HardwareControl[] = [
  ...Array.from({ length: 9 }, (_, i) => fader(`organ-drawbar-${i + 1}`, `Organ drawbar ${i + 1}`, 'organ', 'drawbars', 0.2 + ((i * 7) % 8) / 10, 'white')),
  ...Array.from({ length: 9 }, (_, i) => led(`organ-level-led-${i + 1}`, `Organ level LED ${i + 1}`, 'organ', 'led-ladder')),
  button('organ-on', 'Organ on', 'organ', 'layer', 'red'),
  button('organ-b3', 'B3 model', 'organ', 'model', 'red'),
  button('organ-vox', 'Vox model', 'organ', 'model', 'red'),
  button('organ-farfisa', 'Farfisa model', 'organ', 'model', 'red'),
  button('organ-percussion', 'Percussion', 'organ', 'percussion', 'red'),
  button('organ-vibrato', 'Vibrato chorus', 'organ', 'vibrato', 'red'),
  knob('organ-rotary-drive', 'Rotary drive', 'organ', 'rotary', 0.36),
  knob('organ-rotary-speed', 'Rotary speed', 'organ', 'rotary', 0.5),
  fader('organ-level', 'Organ level', 'organ', 'layer', 0.73),
];

const pianoControls: HardwareControl[] = [
  fader('piano-level', 'Piano level', 'piano', 'layer', 0.65),
  fader('piano-layer-b-level', 'Piano B level', 'piano', 'layer', 0.52),
  button('piano-layer-a', 'Piano layer A', 'piano', 'layer', 'green'),
  button('piano-layer-b', 'Piano layer B', 'piano', 'layer', 'green'),
  button('piano-on', 'Piano on', 'piano', 'layer', 'red'),
  button('piano-acoustic', 'Acoustic piano', 'piano', 'type', 'red'),
  button('piano-electric', 'Electric piano', 'piano', 'type', 'red'),
  button('piano-clav', 'Clavinet', 'piano', 'type', 'red'),
  button('piano-model', 'Piano model select', 'piano', 'model', 'blue'),
  button('piano-touch-heavy', 'KB touch heavy', 'piano', 'touch', 'white'),
  button('piano-touch-medium', 'KB touch medium', 'piano', 'touch', 'white'),
  button('piano-touch-light', 'KB touch light', 'piano', 'touch', 'white'),
  button('piano-dyn-comp', 'Dynamic compression', 'piano', 'compression', 'red'),
  button('piano-timbre', 'Timbre', 'piano', 'timbre', 'red'),
  button('piano-soft', 'Soft release', 'piano', 'detail', 'red'),
  button('piano-string', 'String resonance', 'piano', 'detail', 'red'),
  button('piano-sustain', 'Sustain pedal', 'piano', 'detail', 'red'),
  button('piano-unison', 'Unison', 'piano', 'detail', 'blue'),
  knob('piano-timbre-control', 'Piano timbre', 'piano', 'timbre', 0.43),
  knob('piano-acoustics', 'Piano acoustics', 'piano', 'detail', 0.55),
];

const programControls: HardwareControl[] = [
  button('program-store', 'Store program', 'program', 'navigation', 'red'),
  button('program-list', 'Program list', 'program', 'navigation', 'red'),
  button('program-up', 'Program up', 'program', 'navigation', 'white'),
  button('program-down', 'Program down', 'program', 'navigation', 'white'),
  ...Array.from({ length: 5 }, (_, i) => button(`program-live-${i + 1}`, `Live program ${i + 1}`, 'program', 'live', 'red')),
  ...Array.from({ length: 4 }, (_, i) => button(`program-morph-${i + 1}`, `Morph ${i + 1}`, 'program', 'morph', 'green')),
  { id: 'program-encoder', label: 'Program encoder', section: 'program', kind: 'encoder', value: 0.42, min: 0, max: 1, group: 'navigation', accent: 'white' },
];

const synthControls: HardwareControl[] = [
  fader('synth-level', 'Synth level', 'synth', 'layer', 0.6),
  button('synth-on', 'Synth on', 'synth', 'layer', 'red'),
  button('synth-sample', 'Sample source', 'synth', 'source', 'red'),
  button('synth-analog', 'Analog source', 'synth', 'source', 'red'),
  ...Array.from({ length: 5 }, (_, i) => knob(`synth-osc-${i + 1}`, `Synth oscillator ${i + 1}`, 'synth', 'oscillator', 0.33 + i * 0.1)),
  ...Array.from({ length: 4 }, (_, i) => knob(`synth-filter-${i + 1}`, `Synth filter ${i + 1}`, 'synth', 'filter', 0.42 + i * 0.08)),
  ...Array.from({ length: 4 }, (_, i) => knob(`synth-env-${i + 1}`, `Synth envelope ${i + 1}`, 'synth', 'envelope', 0.35 + i * 0.11)),
  button('synth-lfo', 'Synth LFO', 'synth', 'modulation', 'green'),
  button('synth-arp', 'Synth arpeggiator', 'synth', 'arpeggiator', 'green'),
  knob('synth-cutoff', 'Synth cutoff', 'synth', 'filter', 0.56),
  knob('synth-resonance', 'Synth resonance', 'synth', 'filter', 0.38),
];

const effectsControls: HardwareControl[] = [
  button('effects-focus-organ', 'Focus Organ effects', 'effects', 'focus', 'red'),
  button('effects-focus-piano', 'Focus Piano effects', 'effects', 'focus', 'red'),
  button('effects-focus-synth', 'Focus Synth effects', 'effects', 'focus', 'red'),
  button('effects-mod-1', 'Mod effect 1', 'effects', 'modulation', 'red'),
  button('effects-mod-2', 'Mod effect 2', 'effects', 'modulation', 'red'),
  knob('effects-mod-rate', 'Modulation rate', 'effects', 'modulation', 0.4),
  knob('effects-mod-amount', 'Modulation amount', 'effects', 'modulation', 0.58),
  button('effects-delay', 'Delay', 'effects', 'delay', 'red'),
  knob('effects-delay-time', 'Delay time', 'effects', 'delay', 0.48),
  knob('effects-delay-feedback', 'Delay feedback', 'effects', 'delay', 0.3),
  button('effects-amp-eq', 'Amp simulator and EQ', 'effects', 'amp-eq', 'red'),
  knob('effects-amp-drive', 'Amp drive', 'effects', 'amp-eq', 0.32),
  knob('effects-eq', 'EQ', 'effects', 'amp-eq', 0.52),
  button('effects-compressor', 'Compressor', 'effects', 'master', 'red'),
  knob('effects-compression', 'Compression', 'effects', 'master', 0.34),
  button('effects-reverb', 'Reverb', 'effects', 'master', 'red'),
  knob('effects-reverb-mix', 'Reverb mix', 'effects', 'master', 0.48),
];

export const sections: HardwareSection[] = [
  { id: 'performance', label: 'Performance', eyebrow: 'MASTER / MORPH', fraction: 0.13, controls: performanceControls },
  { id: 'organ', label: 'Organ', eyebrow: 'ORGAN', fraction: 0.21, controls: organControls },
  { id: 'piano', label: 'Piano', eyebrow: 'PIANO', fraction: 0.15, controls: pianoControls },
  { id: 'program', label: 'Program', eyebrow: 'PROGRAM / MORPH', fraction: 0.09, controls: programControls, primaryDisplay: 'program-display' },
  { id: 'synth', label: 'Synth', eyebrow: 'SYNTH', fraction: 0.21, controls: synthControls, primaryDisplay: 'synth-display' },
  { id: 'effects', label: 'Layer Effects', eyebrow: 'LAYER EFFECTS', fraction: 0.21, controls: effectsControls },
];

export const allControls = sections.flatMap((section) => section.controls);

export const noteNames = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
export const whiteNoteIndices = [0, 2, 3, 5, 7, 8, 10];
export const blackAfterWhite = [0, 1, 3, 4, 5];

export function createKeyModel() {
  const keys = Array.from({ length: keyboardModel.totalKeys }, (_, index) => {
    const octave = Math.floor(index / 12) + 1;
    const noteIndex = index % 12;
    const isBlack = !whiteNoteIndices.includes(noteIndex);
    return { id: `key-${index + 1}`, index, midi: 33 + index, note: `${noteNames[noteIndex]}${octave}`, isBlack };
  });
  return { keys, white: keys.filter((key) => !key.isBlack), black: keys.filter((key) => key.isBlack) };
}
