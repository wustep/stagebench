// Row placement of control groups inside each section, top to bottom. Groups in a row share the row's width.
// Rows share the section's height equally, so the deck can never push controls into the keybed.
// The grouping follows reference/nord-stage-4-73.jpg; the visual audit records the measured deviations.

import type { SectionId } from './sections'

export const SECTION_ROWS: Readonly<Record<SectionId, readonly (readonly string[])[]>> = {
  performance: [['performance.master'], ['performance.rotary'], ['performance.expression']],
  organ: [['organ.drawbars'], ['organ.model', 'organ.vib-chorus'], ['organ.percussion']],
  piano: [['piano.layer-a', 'piano.layer-b'], ['piano.type'], ['piano.timbre'], ['piano.details']],
  program: [['program.dial'], ['program.buttons'], ['program.navigation', 'program.store-split'], ['program.morph']],
  synth: [['synth.layer', 'synth.oscillators'], ['synth.filter'], ['synth.envelope'], ['synth.lfo', 'synth.arp']],
  effects: [['effects.mod'], ['effects.amp-eq'], ['effects.delay', 'effects.focus'], ['effects.comp-reverb']],
}
