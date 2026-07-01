import type { HardwareModel, VisualsSpec, SectionId } from './types'

// Stage 4 73: 73 keys, 43 white, 30 black, E to E, hammer action
// Aspect ratio: 3.095:1

export const visualsSpec: VisualsSpec = {
  chassisMid: '#79232c',
  chassisDark: '#721f29',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
  controlDeckHeightFraction: 0.54,
  keybedHeightFraction: 0.46,
}

// Horizontal section allocation (left to right)
export const sectionWidths: Record<SectionId, number> = {
  performance: 0.13,
  organ: 0.21,
  piano: 0.15,
  program: 0.09,
  synth: 0.21,
  effects: 0.21,
}

export const hardwareModel: HardwareModel = {
  variant: 'stage-4-73',
  keyboard: {
    totalKeys: 73,
    whiteKeys: 43,
    blackKeys: 30,
    range: 'E to E',
    blackKeyHeightFraction: 0.61,
    startNoteIndex: 16, // E2 = MIDI 40; 73-key range starts at E2
  },
  sections: [
    {
      id: 'performance',
      label: 'Performance controls',
      widthFraction: sectionWidths.performance,
      controls: [
        { id: 'master-level', label: 'Master Level', type: 'knob', value: 50, min: 0, max: 100 },
        { id: 'pitch-stick', label: 'Pitch Stick', type: 'wheel', value: 0, min: -100, max: 100 },
        { id: 'mod-wheel', label: 'Modulation Wheel', type: 'wheel', value: 0, min: 0, max: 100 },
      ],
    },
    {
      id: 'organ',
      label: 'Organ',
      widthFraction: sectionWidths.organ,
      controls: [
        // Nine drawbars: 16', 5 1/3', 8', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1'
        { id: 'drawbar-1', label: "16'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-2', label: "5 1/3'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-3', label: "8'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-4', label: "4'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-5', label: "2 2/3'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-6', label: "2'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-7', label: "1 3/5'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-8', label: "1 1/3'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'drawbar-9', label: "1'", type: 'drawbar', value: 50, min: 0, max: 100 },
        { id: 'organ-model', label: 'Organ Model', type: 'switch', active: false },
        { id: 'organ-level-led', label: 'Level LED', type: 'led', lit: false, color: 'green' },
      ],
    },
    {
      id: 'piano',
      label: 'Piano',
      widthFraction: sectionWidths.piano,
      controls: [
        { id: 'piano-type', label: 'Piano Type', type: 'switch', active: false },
        { id: 'piano-model', label: 'Piano Model', type: 'switch', active: false },
        { id: 'piano-level', label: 'Piano Level', type: 'knob', value: 50, min: 0, max: 100 },
      ],
    },
    {
      id: 'program',
      label: 'Program and morph',
      widthFraction: sectionWidths.program,
      controls: [
        { id: 'program-encoder', label: 'Program', type: 'encoder', value: 0, min: 0, max: 200 },
        { id: 'program-button-1', label: 'Program 1', type: 'button', active: false },
        { id: 'program-button-2', label: 'Program 2', type: 'button', active: false },
        { id: 'program-button-3', label: 'Program 3', type: 'button', active: false },
        { id: 'program-button-4', label: 'Program 4', type: 'button', active: false },
        { id: 'program-button-5', label: 'Program 5', type: 'button', active: false },
      ],
    },
    {
      id: 'synth',
      label: 'Synth',
      widthFraction: sectionWidths.synth,
      controls: [
        { id: 'synth-osc', label: 'Oscillator', type: 'knob', value: 50, min: 0, max: 100 },
        { id: 'synth-filter', label: 'Filter', type: 'knob', value: 50, min: 0, max: 100 },
        { id: 'synth-env', label: 'Envelope', type: 'knob', value: 50, min: 0, max: 100 },
        { id: 'synth-mode', label: 'Synth Mode', type: 'switch', active: false },
      ],
    },
    {
      id: 'effects',
      label: 'Layer effects',
      widthFraction: sectionWidths.effects,
      controls: [
        { id: 'effect-type', label: 'Effect Type', type: 'switch', active: false },
        { id: 'effect-amount', label: 'Amount', type: 'knob', value: 50, min: 0, max: 100 },
        { id: 'effect-mix', label: 'Mix', type: 'knob', value: 50, min: 0, max: 100 },
      ],
    },
  ],
  displayLocations: [
    { sectionId: 'program', label: 'Program OLED' },
    { sectionId: 'synth', label: 'Synth OLED' },
  ],
}
