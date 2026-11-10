/**
 * Values copied from the benchmark specs so the tests do not depend on files outside
 * the candidate directory.
 *
 *  - specs/nord-stage-4.visual.json (v1.4.0): horizontalSections, verticalAllocation,
 *    sectionLandmarks, presentation, referenceColors
 *  - specs/nord-stage-4.variants.json (v1.0.0): stage-4-73
 */

export const SPEC_SECTIONS = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14 },
  { id: 'organ', label: 'Organ', fraction: 0.2 },
  { id: 'piano', label: 'Piano', fraction: 0.085 },
  { id: 'program', label: 'Program and morph', fraction: 0.125 },
  { id: 'synth', label: 'Synth', fraction: 0.25 },
  { id: 'effects', label: 'Layer effects', fraction: 0.2 },
] as const

export const SPEC_VERTICAL = { deck: 0.54, keybed: 0.46, tolerance: 0.025 } as const

export const SPEC_VARIANT = {
  id: 'stage-4-73',
  aspectRatio: 3.0951,
  bounds: { width: 9013, height: 2912 },
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  range: 'E to E',
  blackKeyHeightFraction: 0.61,
} as const

export const SPEC_PRESENTATION = {
  desktop: { width: 1440, height: 900 },
  narrow: { width: 390, height: 844 },
  widthFraction: { minimum: 0.88, maximum: 0.97 },
} as const

export const SPEC_COLORS = {
  chassisMid: '#851a25',
  chassisDark: '#5a0c13',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

export const SPEC_LANDMARKS: Record<string, { required: string[]; forbidden: string[] }> = {
  performance: {
    required: ['master level knob', 'rotary speaker controls', 'pitch stick', 'modulation wheel', 'Nord Stage 4 branding'],
    forbidden: ['full dark inset plate', 'OLED display'],
  },
  organ: {
    required: ['nine physical drawbars', 'level LED ladders', 'organ model switches', 'percussion controls'],
    forbidden: ['wide OLED display', 'generic equal-width control grid'],
  },
  piano: {
    required: ['layer level controls', 'piano type selectors', 'model selector', 'timbre controls', 'piano-detail switches'],
    forbidden: ['wide OLED display', 'drawbar bank'],
  },
  program: {
    required: [
      'primary program OLED',
      'large program dial',
      'eight program buttons',
      'page navigation buttons',
      'Live Mode and Layer Scene buttons',
      'store and split buttons',
      'three morph assign buttons',
    ],
    forbidden: ['multiple primary displays'],
  },
  synth: {
    required: [
      'single synth OLED',
      'layer level controls',
      'oscillator controls',
      'filter controls',
      'envelope controls',
      'LFO and arpeggiator controls',
    ],
    forbidden: ['wide display spanning the section', 'uniform repeated knob matrix'],
  },
  effects: {
    required: ['two effect groups', 'amp simulator and EQ', 'delay', 'compressor', 'reverb', 'layer focus controls'],
    forbidden: ['OLED display', 'single undifferentiated control grid'],
  },
}
