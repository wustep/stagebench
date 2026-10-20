// Row placement of control groups inside each section, top to bottom. Groups in a row share the row's width.
// Rows share the section's height equally, so the deck can never push controls into the keybed.
// The grouping follows reference/nord-stage-4-73.jpg; the visual audit records the measured deviations.

import type { SectionId } from './sections'

export const SECTION_ROWS: Readonly<Record<SectionId, readonly (readonly string[])[]>> = {
  performance: [['performance.master'], ['performance.rotary'], ['performance.expression']],
  organ: [['organ.layer-a', 'organ.layer-b'], ['organ.drawbars'], ['organ.model', 'organ.vib-chorus'], ['organ.percussion']],
  piano: [['piano.layer-a', 'piano.layer-b'], ['piano.type'], ['piano.timbre'], ['piano.details']],
  program: [
    ['program.dial'],
    ['program.buttons'],
    ['program.navigation', 'program.store-split'],
    ['program.split-points'],
    ['program.clock'],
    ['program.morph'],
  ],
  synth: [
    ['synth.layer-a', 'synth.layer-b', 'synth.layer-c'],
    ['synth.oscillators', 'synth.filter'],
    ['synth.env-amp', 'synth.env-filter', 'synth.env-osc'],
    ['synth.lfo', 'synth.voice'],
    ['synth.arp'],
  ],
  effects: [['effects.mod'], ['effects.amp-eq'], ['effects.delay', 'effects.focus'], ['effects.comp-reverb']],
}

/**
 * Relative row heights, keyed by a row's first group. The deck is short, so rows holding tall controls
 * (drawbars, the program dial and its display) get more height than rows of small ones. Rows without
 * an entry share the rest equally, at weight 1.
 */
export const ROW_WEIGHTS: Readonly<Record<string, number>> = {
  'piano.layer-a': 1.5,
  'piano.type': 0.9,
  'piano.details': 0.9,
  'organ.layer-a': 0.9,
  'organ.drawbars': 1.6,
  'organ.model': 1.1,
  'organ.percussion': 0.9,
  'program.dial': 1.4,
  'program.buttons': 1.0,
  'program.navigation': 1.0,
  'program.split-points': 1.0,
  'program.clock': 1.0,
  'program.morph': 0.7,
  'synth.layer-a': 1.2,
  'synth.oscillators': 1.3,
  'synth.env-amp': 1.2,
  'synth.lfo': 1.2,
  'synth.arp': 0.9,
}
