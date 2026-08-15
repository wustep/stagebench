import type { InstrumentSpec, SectionSpec } from './types'

// Six ordered sections at their documented (photo-corrected) deck fractions.
// The stage-1 prompt lists coarse values (13/21/15/9/21/21); the machine
// spec's horizontalSectionsNote explicitly corrects those to the values below
// (performance .14, organ .20, piano .085, program .125, synth .25, effects
// .20), which is what the visual scanner measures against.
const DECK_FRACTION = 0.54
const KEYBED_FRACTION = 0.46

function performanceControls(): SectionSpec['controls'] {
  return [
    { id: 'perf.pitch-stick', kind: 'stick', label: 'Pitch stick', ariaRole: 'slider' },
    { id: 'perf.mod-wheel', kind: 'wheel', label: 'Modulation wheel', ariaRole: 'slider', defaultValue: 0 },
    { id: 'perf.master-level', kind: 'knob', label: 'Master level', steps: 0, defaultValue: 0.8 },
    { id: 'perf.branding', kind: 'led', label: 'Nord Stage 4 branding' },
  ]
}

function organControls(): SectionSpec['controls'] {
  const drawbars: SectionSpec['controls'] = [
    { id: 'organ.db-16', kind: 'drawbar', label: '16 foot drawbar', defaultValue: 0 },
    { id: 'organ.db-5-1-3', kind: 'drawbar', label: '5 1/3 foot drawbar', defaultValue: 0 },
    { id: 'organ.db-8', kind: 'drawbar', label: '8 foot drawbar', defaultValue: 8 },
    { id: 'organ.db-4', kind: 'drawbar', label: '4 foot drawbar', defaultValue: 0 },
    { id: 'organ.db-2-2-3', kind: 'drawbar', label: '2 2/3 foot drawbar', defaultValue: 0 },
    { id: 'organ.db-2', kind: 'drawbar', label: '2 foot drawbar', defaultValue: 0 },
    { id: 'organ.db-1-3-5', kind: 'drawbar', label: '1 3/5 foot drawbar', defaultValue: 0 },
    { id: 'organ.db-1-1-3', kind: 'drawbar', label: '1 1/3 foot drawbar', defaultValue: 0 },
    { id: 'organ.db-1', kind: 'drawbar', label: '1 foot drawbar', defaultValue: 0 },
  ]
  const leds: SectionSpec['controls'] = drawbars.map((d) => ({
    id: `${d.id}-led`,
    kind: 'graph' as const,
    label: `${d.label} level graph`,
    segments: 9,
    defaultValue: 0,
  }))
  return [
    ...drawbars,
    ...leds,
    { id: 'organ.model-b3', kind: 'button', label: 'B3 organ model', defaultValue: true },
    { id: 'organ.model-vox', kind: 'button', label: 'Vox organ model' },
    { id: 'organ.model-farf', kind: 'button', label: 'Farfisa organ model' },
    { id: 'organ.model-pipe', kind: 'button', label: 'Pipe organ model' },
    { id: 'organ.percussion', kind: 'button', label: 'Percussion on/off' },
    { id: 'organ.perc-decay', kind: 'momentary', label: 'Percussion decay' },
    { id: 'organ.perc-level', kind: 'momentary', label: 'Percussion level' },
    { id: 'organ.rotary-speed', kind: 'knob', label: 'Rotary speed', steps: 3, defaultValue: 0.5 },
    { id: 'organ.rotary-drive', kind: 'knob', label: 'Rotary drive', steps: 0, defaultValue: 0.2 },
    { id: 'organ.vibrato', kind: 'button', label: 'Vibrato on/off' },
    { id: 'organ.vibrato-chorus', kind: 'knob', label: 'Vibrato chorus', steps: 4, defaultValue: 0 },
    { id: 'organ.level', kind: 'fader', label: 'Organ level', segments: 12, defaultValue: 0.7 },
  ]
}

function pianoControls(): SectionSpec['controls'] {
  return [
    { id: 'piano.on', kind: 'button', label: 'Piano section on', defaultValue: true },
    { id: 'piano.sustain-pedal', kind: 'button', label: 'Sustain pedal SUSTPED', defaultValue: true },
    { id: 'piano.pitch-stick', kind: 'button', label: 'Pitch stick PSTICK' },
    { id: 'piano.layer-a-on', kind: 'button', label: 'Piano layer A on', defaultValue: true },
    { id: 'piano.layer-b-on', kind: 'button', label: 'Piano layer B on' },
    { id: 'piano.layer-a-level', kind: 'fader', label: 'Piano layer A level', segments: 12, defaultValue: 0.8 },
    { id: 'piano.layer-b-level', kind: 'fader', label: 'Piano layer B level', segments: 12, defaultValue: 0 },
    { id: 'piano.layer-a-focus', kind: 'button', label: 'Piano layer A focus', defaultValue: true },
    { id: 'piano.layer-b-focus', kind: 'button', label: 'Piano layer B focus' },
    { id: 'piano.layer-a-octave', kind: 'knob', label: 'Piano layer A octave', steps: 3, defaultValue: 0.5 },
    { id: 'piano.layer-b-octave', kind: 'knob', label: 'Piano layer B octave', steps: 3, defaultValue: 0.5 },
    { id: 'piano.type-grand', kind: 'button', label: 'Grand piano type', defaultValue: true },
    { id: 'piano.type-upright', kind: 'button', label: 'Upright piano type' },
    { id: 'piano.type-electric', kind: 'button', label: 'Electric piano type' },
    { id: 'piano.type-clav', kind: 'button', label: 'Clavinet type' },
    { id: 'piano.type-digital', kind: 'button', label: 'Digital piano type' },
    { id: 'piano.type-misc', kind: 'button', label: 'Misc type' },
    { id: 'piano.model', kind: 'encoder', label: 'Model selector', defaultValue: 0 },
    { id: 'piano.kb-touch', kind: 'knob', label: 'KB Touch', steps: 3, defaultValue: 0.5 },
    { id: 'piano.dyn-comp', kind: 'knob', label: 'Dynamic compression', steps: 4, defaultValue: 0 },
    { id: 'piano.timbre', kind: 'knob', label: 'Timbre', steps: 6, defaultValue: 0 },
    { id: 'piano.unison', kind: 'knob', label: 'Unison', steps: 4, defaultValue: 0 },
    { id: 'piano.soft-release', kind: 'button', label: 'Soft release' },
    { id: 'piano.string-res', kind: 'button', label: 'String resonance' },
  ]
}

function programControls(): SectionSpec['controls'] {
  return [
    { id: 'prog.oled', kind: 'oled', label: 'Program display', text: 'A:001 Grand' },
    { id: 'prog.dial', kind: 'encoder', label: 'Program dial', defaultValue: 0 },
    { id: 'prog.btn-1', kind: 'momentary', label: 'Program button 1' },
    { id: 'prog.btn-2', kind: 'momentary', label: 'Program button 2' },
    { id: 'prog.btn-3', kind: 'momentary', label: 'Program button 3' },
    { id: 'prog.btn-4', kind: 'momentary', label: 'Program button 4' },
    { id: 'prog.btn-5', kind: 'momentary', label: 'Program button 5' },
    { id: 'prog.btn-6', kind: 'momentary', label: 'Program button 6' },
    { id: 'prog.btn-7', kind: 'momentary', label: 'Program button 7' },
    { id: 'prog.btn-8', kind: 'momentary', label: 'Program button 8' },
    { id: 'prog.page-up', kind: 'momentary', label: 'Page up' },
    { id: 'prog.page-down', kind: 'momentary', label: 'Page down' },
    { id: 'prog.live-mode', kind: 'button', label: 'Live Mode' },
    { id: 'prog.layer-scene-a', kind: 'button', label: 'Layer Scene A' },
    { id: 'prog.layer-scene-b', kind: 'button', label: 'Layer Scene B' },
    { id: 'prog.store', kind: 'momentary', label: 'Store' },
    { id: 'prog.split', kind: 'button', label: 'Split' },
    { id: 'prog.morph-wheel', kind: 'momentary', label: 'Morph assign wheel' },
    { id: 'prog.morph-after', kind: 'momentary', label: 'Morph assign aftertouch' },
    { id: 'prog.morph-pedal', kind: 'momentary', label: 'Morph assign control pedal' },
  ]
}

function synthControls(): SectionSpec['controls'] {
  const layers = ['S1', 'S2', 'S3']
  const layerCtrls: SectionSpec['controls'] = layers.flatMap((layer) => [
    { id: `synth.${layer.toLowerCase()}-level`, kind: 'fader', label: `${layer} level`, segments: 12, defaultValue: 0.7 },
    { id: `synth.${layer.toLowerCase()}-focus`, kind: 'button', label: `${layer} focus`, defaultValue: layer === 'S1' },
  ])
  return [
    { id: 'synth.oled', kind: 'oled', label: 'Synth display', text: 'SYNTH' },
    ...layerCtrls,
    { id: 'synth.osc-wave', kind: 'knob', label: 'Oscillator wave', steps: 10, defaultValue: 0 },
    { id: 'synth.osc-octave', kind: 'knob', label: 'Oscillator octave', steps: 3, defaultValue: 0.5 },
    { id: 'synth.osc-fine', kind: 'knob', label: 'Oscillator fine tune', steps: 0, defaultValue: 0.5 },
    { id: 'synth.osc-ctrl', kind: 'knob', label: 'Oscillator control', steps: 0, defaultValue: 0.2 },
    { id: 'synth.filter-type', kind: 'button', label: 'Filter LP' },
    { id: 'synth.filter-cutoff', kind: 'knob', label: 'Filter cutoff', steps: 0, defaultValue: 0.8 },
    { id: 'synth.filter-res', kind: 'knob', label: 'Filter resonance', steps: 0, defaultValue: 0 },
    { id: 'synth.filter-keytrack', kind: 'knob', label: 'Filter keytrack', steps: 0, defaultValue: 0.5 },
    { id: 'synth.env-amp-a', kind: 'knob', label: 'Envelope attack', steps: 0, defaultValue: 0.1 },
    { id: 'synth.env-amp-d', kind: 'knob', label: 'Envelope decay', steps: 0, defaultValue: 0.4 },
    { id: 'synth.env-amp-s', kind: 'knob', label: 'Envelope sustain', steps: 0, defaultValue: 0.6 },
    { id: 'synth.env-amp-r', kind: 'knob', label: 'Envelope release', steps: 0, defaultValue: 0.3 },
    { id: 'synth.env-filt-a', kind: 'knob', label: 'Filter envelope amount', steps: 0, defaultValue: 0 },
    { id: 'synth.lfo-rate', kind: 'knob', label: 'LFO rate', steps: 0, defaultValue: 0.2 },
    { id: 'synth.lfo-depth', kind: 'knob', label: 'LFO depth', steps: 0, defaultValue: 0 },
    { id: 'synth.lfo-shape', kind: 'knob', label: 'LFO shape', steps: 3, defaultValue: 0 },
    { id: 'synth.voice-mode', kind: 'knob', label: 'Synth voice mode', steps: 4, defaultValue: 0 },
    { id: 'synth.unison', kind: 'button', label: 'Synth unison' },
    { id: 'synth.glide', kind: 'knob', label: 'Glide', steps: 0, defaultValue: 0 },
    { id: 'synth.vibrato', kind: 'knob', label: 'Vibrato', steps: 0, defaultValue: 0 },
    { id: 'synth.arp-on', kind: 'button', label: 'Arpeggiator on' },
    { id: 'synth.arp-mode', kind: 'knob', label: 'Arpeggiator mode', steps: 6, defaultValue: 0 },
  ]
}

function effectsControls(): SectionSpec['controls'] {
  return [
    { id: 'fx.focus-piano', kind: 'button', label: 'Effects focus piano' },
    { id: 'fx.focus-organ', kind: 'button', label: 'Effects focus organ', defaultValue: true },
    { id: 'fx.focus-synth-s1', kind: 'button', label: 'Effects focus synth S1' },
    { id: 'fx.focus-synth-s2', kind: 'button', label: 'Effects focus synth S2' },
    { id: 'fx.focus-synth-s3', kind: 'button', label: 'Effects focus synth S3' },
    // Effect group 1 (Modulation, Modulation FX 1)
    { id: 'fx.mod1-type', kind: 'knob', label: 'Mod 1 effect type', steps: 8, defaultValue: 0 },
    { id: 'fx.mod1-rate', kind: 'knob', label: 'Mod 1 rate', steps: 0, defaultValue: 0.3 },
    { id: 'fx.mod1-amount', kind: 'knob', label: 'Mod 1 amount', steps: 0, defaultValue: 0.4 },
    { id: 'fx.mod1-on', kind: 'button', label: 'Mod 1 on' },
    // Effect group 2 (Modulation FX 2)
    { id: 'fx.mod2-type', kind: 'knob', label: 'Mod 2 effect type', steps: 8, defaultValue: 0 },
    { id: 'fx.mod2-rate', kind: 'knob', label: 'Mod 2 rate', steps: 0, defaultValue: 0.3 },
    { id: 'fx.mod2-amount', kind: 'knob', label: 'Mod 2 amount', steps: 0, defaultValue: 0.4 },
    { id: 'fx.mod2-on', kind: 'button', label: 'Mod 2 on' },
    // Amp sim + EQ
    { id: 'fx.amp-type', kind: 'knob', label: 'Amp/EQ type', steps: 7, defaultValue: 0 },
    { id: 'fx.amp-drive', kind: 'knob', label: 'Amp drive', steps: 0, defaultValue: 0.2 },
    { id: 'fx.eq-bass', kind: 'knob', label: 'EQ bass', steps: 0, defaultValue: 0.5 },
    { id: 'fx.eq-mid', kind: 'knob', label: 'EQ mid gain', steps: 0, defaultValue: 0.5 },
    { id: 'fx.eq-mid-freq', kind: 'knob', label: 'EQ mid frequency', steps: 0, defaultValue: 0.5 },
    { id: 'fx.eq-treble', kind: 'knob', label: 'EQ treble', steps: 0, defaultValue: 0.5 },
    { id: 'fx.amp-on', kind: 'button', label: 'Amp simulator on', defaultValue: true },
    // Delay
    { id: 'fx.delay-rate', kind: 'knob', label: 'Delay rate', steps: 0, defaultValue: 0.3 },
    { id: 'fx.delay-feedback', kind: 'knob', label: 'Delay feedback', steps: 0, defaultValue: 0.3 },
    { id: 'fx.delay-mix', kind: 'knob', label: 'Delay mix', steps: 0, defaultValue: 0.2 },
    { id: 'fx.delay-filter', kind: 'knob', label: 'Delay feedback filter', steps: 4, defaultValue: 0 },
    { id: 'fx.delay-on', kind: 'button', label: 'Delay on' },
    { id: 'fx.delay-global', kind: 'button', label: 'Delay global' },
    // Compressor
    { id: 'fx.comp-threshold', kind: 'knob', label: 'Compressor amount', steps: 0, defaultValue: 0.3 },
    { id: 'fx.comp-fast', kind: 'button', label: 'Compressor fast' },
    { id: 'fx.comp-on', kind: 'button', label: 'Compressor on' },
    { id: 'fx.comp-global', kind: 'button', label: 'Compressor global' },
    // Reverb
    { id: 'fx.reverb-type', kind: 'knob', label: 'Reverb type', steps: 5, defaultValue: 0 },
    { id: 'fx.reverb-mix', kind: 'knob', label: 'Reverb mix', steps: 0, defaultValue: 0.3 },
    { id: 'fx.reverb-bright', kind: 'knob', label: 'Reverb bright/dark', steps: 0, defaultValue: 0.5 },
    { id: 'fx.reverb-on', kind: 'button', label: 'Reverb on' },
    { id: 'fx.reverb-global', kind: 'button', label: 'Reverb global' },
    // Rotary (shared) + routing / group / all-effects bypass
    { id: 'fx.rotary-speed', kind: 'knob', label: 'Rotary speed', steps: 3, defaultValue: 0.3 },
    { id: 'fx.rotary-on', kind: 'button', label: 'Rotary on' },
    { id: 'fx.to-rotary-a', kind: 'button', label: 'To Rotary layer A' },
    { id: 'fx.to-rotary-b', kind: 'button', label: 'To Rotary layer B' },
    { id: 'fx.group', kind: 'button', label: 'Piano group mode' },
    { id: 'fx.all-bypass', kind: 'button', label: 'Layer effects on', defaultValue: true },
  ]
}

function buildSections(): SectionSpec[] {
  return [
    {
      id: 'performance',
      label: 'Performance controls',
      fraction: 0.14,
      landmarks: ['master level knob', 'pitch stick', 'modulation wheel', 'Nord Stage 4 branding'],
      surface: 'chassis',
      controls: performanceControls(),
    },
    {
      id: 'organ',
      label: 'Organ',
      fraction: 0.2,
      landmarks: ['nine drawbars', 'level LED ladders', 'organ model switches', 'percussion controls', 'rotary controls'],
      surface: 'inset',
      controls: organControls(),
    },
    {
      id: 'piano',
      label: 'Piano',
      fraction: 0.085,
      landmarks: ['layer level controls', 'piano type selectors', 'model selector', 'timbre controls', 'piano-detail switches'],
      surface: 'inset',
      controls: pianoControls(),
    },
    {
      id: 'program',
      label: 'Program and morph',
      fraction: 0.125,
      landmarks: ['primary program OLED', 'large program dial', 'eight program buttons', 'page navigation buttons', 'Live Mode and Layer Scene buttons', 'store and split buttons', 'three morph assign buttons'],
      surface: 'chassis',
      controls: programControls(),
    },
    {
      id: 'synth',
      label: 'Synth',
      fraction: 0.25,
      landmarks: ['single synth OLED', 'layer level controls', 'oscillator controls', 'filter controls', 'envelope controls', 'LFO and arpeggiator controls'],
      surface: 'inset',
      controls: synthControls(),
    },
    {
      id: 'effects',
      label: 'Layer effects',
      fraction: 0.2,
      landmarks: ['two effect groups', 'amp simulator and EQ', 'delay', 'compressor', 'reverb', 'layer focus controls'],
      surface: 'inset',
      controls: effectsControls(),
    },
  ]
}

// Build the shared instrument spec: identical control deck across variants,
// with the assigned 73-key variant's keybed.
export const instrumentSpec: InstrumentSpec = {
  variant: 'stage-4-73',
  deckFraction: DECK_FRACTION,
  keybedFraction: KEYBED_FRACTION,
  sections: buildSections(),
  // keybed filled by assembleInstrument() in instrument.ts
  keybed: {} as InstrumentSpec['keybed'],
  colors: {
    chassisMid: '#851a25',
    chassisDark: '#5a0c13',
    panelBlueGray: '#3c424d',
    keyBlack: '#0b0b0b',
    keyWhite: '#dcdcdc',
  },
}

export const ALL_SECTION_FRACTIONS_SUM = buildSections()
  .reduce((sum, section) => sum + section.fraction, 0)