import { OrganModel } from '../audio/dsp/params'

/**
 * The Organ models. All of them are live synthesis (see src/audio/dsp/organ.ts); none is a
 * recording. B3 Bass and Pipe 2 reuse the B3 and Pipe engines, as the organ spec allows, and
 * say so.
 */

export interface OrganModelInfo {
  id: number
  name: string
  kind: string
  /** What each of the nine drawbars is on this model. A null is a drawbar the model does not use. */
  drawbars: readonly (string | null)[]
  /** True when the drawbars act as on/off register tabs. */
  tabs: boolean
  percussion: boolean
  about: string
}

const B3_FOOTAGES = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"] as const

/** In the order the Organ Model button steps through them. */
export const ORGAN_MODELS: readonly OrganModelInfo[] = [
  {
    id: OrganModel.B3,
    name: 'B3',
    kind: 'tonewheel',
    drawbars: B3_FOOTAGES,
    tabs: false,
    percussion: true,
    about: 'Synthesized tonewheel organ: nine harmonic drawbars, key click, percussion, scanner vibrato/chorus.',
  },
  {
    id: OrganModel.Vox,
    name: 'Vox',
    kind: 'transistor',
    drawbars: ["16'", "8'", "4'", "2'", 'II', 'III', 'IV', 'Flute mix', 'Reed mix'],
    tabs: false,
    percussion: false,
    about: 'Synthesized transistor organ: four footages, three mixtures, and a filtered/unfiltered mix on the last two drawbars.',
  },
  {
    id: OrganModel.Farf,
    name: 'Farf',
    kind: 'transistor',
    drawbars: ['Bass 16', 'Strings 16', 'Flute 8', 'Oboe 8', 'Trumpet 8', 'Strings 8', 'Flute 4', 'Strings 4', '2 2/3'],
    tabs: true,
    percussion: false,
    about: 'Synthesized transistor organ: nine register tabs; a drawbar pulled past half is on.',
  },
  {
    id: OrganModel.Pipe1,
    name: 'Pipe 1',
    kind: 'pipe',
    drawbars: ["Flute 16'", "Flute 8'", "Principal 8'", "Flute 4'", "Principal 4'", "2 2/3'", "2'", "1 1/3'", "1'"],
    tabs: false,
    percussion: false,
    about: 'Synthesized pipe organ: nine slow-speaking flute and principal ranks.',
  },
  {
    id: OrganModel.Pipe2,
    name: 'Pipe 2',
    kind: 'pipe principal',
    drawbars: ["16'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'", "4/5'"],
    tabs: false,
    percussion: false,
    about: 'Synthesized principal chorus: the Pipe 1 engine with nine brighter principal ranks.',
  },
  {
    id: OrganModel.B3Bass,
    name: 'B3 Bass',
    kind: 'tonewheel bass',
    drawbars: ["16'", "8'", null, null, null, null, null, null, null],
    tabs: false,
    percussion: false,
    about: "Synthesized tonewheel bass: the B3 engine with only its 16' and 8' drawbars.",
  },
]

export function organModel(id: number): OrganModelInfo {
  return ORGAN_MODELS.find((model) => model.id === id) ?? ORGAN_MODELS[0]
}

/** Vibrato/Chorus positions in the order the selector button steps through them. */
export const VIB_TYPES = ['V1', 'C1', 'V2', 'C2', 'V3', 'C3'] as const
