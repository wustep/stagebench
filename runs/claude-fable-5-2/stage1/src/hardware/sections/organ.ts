import { createSection, tile } from '../builder'
import type { SectionInventory } from '../types'
import { layerStrip, octaveShift } from './shared'

interface DrawbarSpec {
  /** Cap centre x, absolute photo px. */
  x: number
  top: string
  footage: string
  cap: 'brown' | 'white' | 'black'
  /** Lit LED count on the photo, used as the initial value. */
  initial: number
}

/** Nine drawbars at a 146 px pitch. Cap centres measured on the photo. */
export const ORGAN_DRAWBARS: readonly DrawbarSpec[] = [
  { x: 2924, top: 'BASS16\n16′', footage: '16′', cap: 'brown', initial: 8 },
  { x: 3070, top: 'STR16\n8′', footage: '5⅓′', cap: 'brown', initial: 6 },
  { x: 3218, top: 'FLUTE8\n4′', footage: '8′', cap: 'white', initial: 8 },
  { x: 3362, top: 'OBOE8\n2′', footage: '4′', cap: 'white', initial: 4 },
  { x: 3508, top: 'TRMP8\nII', footage: '2⅔′', cap: 'black', initial: 3 },
  { x: 3654, top: 'STR8\nIII', footage: '2′', cap: 'white', initial: 3 },
  { x: 3800, top: 'FLUTE4\nIV', footage: '1⅗′', cap: 'black', initial: 6 },
  { x: 3946, top: 'STR4', footage: '1⅓′', cap: 'black', initial: 3 },
  { x: 4091, top: '2 2/3\n∿–∿', footage: '1′', cap: 'white', initial: 5 },
]

/** Organ: dark inset plate, nine drawbars with LED graphs, model/vibrato/percussion blocks. */
export function buildOrgan(): SectionInventory {
  const s = createSection('organ')
  const t = tile(1)
  const u = tile(2)

  // Rear-panel legends printed on the top rail above this section.
  const rail = { size: 23 }
  s.label('MONITOR\nIN', t(70, 105), rail)
  s.label('HEADPHONES', t(185, 95), rail)
  s.label('OUT 1', t(320, 95), rail)
  s.plate('rule', t(374, 93), t(410, 97), 0)
  s.label('OUT 2', t(460, 95), rail)
  s.label('OUT 3', t(598, 95), rail)
  s.plate('rule', t(652, 93), t(688, 97), 0)
  s.label('OUT 4', t(737, 95), rail)
  s.label('CONTROL\nPEDAL', t(876, 104), rail)
  s.label('ORGAN\nSWELL', t(1014, 104), rail)
  s.label('SUSTAIN\nPEDAL', t(1152, 104), rail)
  s.label('TRIPLE\nPEDAL', u(113, 104), rail)

  // Plate and header tab.
  s.plate('dark', t(62, 222), u(555, 1280), 20)
  s.plate('light', t(62, 135), t(772, 232), 20)
  s.plate('light', t(62, 185), u(555, 232), 20)
  s.label('ORGAN', t(176, 172), { font: 'wide', size: 42, tone: 'dark' })
  s.label('SECTION', t(124, 204), { tone: 'dark', size: 26 })
  s.label('FX FOCUS', t(377, 165), { tone: 'dark' })
  s.led('organ-fx-focus', t(377, 194), 'yellow', false)
  s.label('ON', t(503, 165), { tone: 'dark' })
  s.toggle('organ-on', 'Organ section On', t(595, 181), t(503, 194), { initial: 1 })
  s.label('SOLO ▼', t(715, 181), { tone: 'dark', size: 26 })

  layerStrip(s, t, { prefix: 'organ', sectionName: 'Organ', letter: 'A', x: 119, y: 235, level: 100, on: true, color: 'green' })
  layerStrip(s, t, { prefix: 'organ', sectionName: 'Organ', letter: 'B', x: 293, y: 235, level: 50, on: true, color: 'green' })
  s.led('organ-sustped', t(105, 846), 'red', false)
  s.label('SUSTPED', t(173, 846))
  s.led('organ-pstick', t(281, 846), 'red', false)
  s.label('PSTICK', t(339, 846))

  s.label('PRESET', t(262, 935))
  s.toggle('organ-preset', 'Organ Preset', t(249, 1000), t(203, 935))
  s.label('SYNC ▽', t(250, 1053))
  octaveShift(s, t, 'organ', 'Organ', 248, 1160, [false, false, true, true])

  // Organ Model.
  s.plate('frame', t(478, 270), t(765, 588), 22)
  s.label('ORGAN\nMODEL', t(617, 269), { font: 'wide', size: 22, box: 'cut-dark' })
  s.plate('led-box', t(588, 334), t(647, 458), 4)
  s.label('FARF', t(554, 352))
  s.label('VOX', t(557, 396))
  s.label('B3', t(565, 440))
  s.label('PIPE1', t(686, 352))
  s.label('PIPE2', t(687, 396))
  s.label('B3\nBASS', t(686, 440))
  s.selector(
    'organ-model',
    'Organ Model',
    t(618, 510),
    ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2', 'B3 Bass'],
    [
      { slug: 'b3', at: t(604, 440), on: [0], shape: 'left' },
      { slug: 'vox', at: t(604, 397), on: [1], shape: 'left' },
      { slug: 'farf', at: t(604, 354), on: [2], shape: 'left' },
      { slug: 'pipe1', at: t(631, 354), on: [3], shape: 'right' },
      { slug: 'pipe2', at: t(631, 397), on: [4], shape: 'right' },
      { slug: 'b3-bass', at: t(631, 440), on: [5], shape: 'right' },
    ],
  )

  // Vibrato / Chorus.
  s.plate('frame', t(765, 270), t(1165, 588), 22)
  s.label('VIB/CHORUS', t(963, 269), { font: 'wide', size: 22, box: 'cut-dark' })
  s.plate('led-box', t(985, 352), t(1106, 410), 4)
  s.label('C2', t(1003, 334))
  s.label('V3', t(1045, 334))
  s.label('C3', t(1089, 334))
  s.label('V2', t(1003, 430))
  s.label('C1', t(1046, 430))
  s.label('V1', t(1089, 430))
  s.selector(
    'organ-vibrato-type',
    'Organ Vibrato/Chorus type',
    t(890, 381),
    ['V1', 'C1', 'V2', 'C2', 'V3', 'C3'],
    [
      { slug: 'v1', at: t(1088, 395), on: [0], shape: 'down' },
      { slug: 'c1', at: t(1045, 395), on: [1], shape: 'down' },
      { slug: 'v2', at: t(1003, 395), on: [2], shape: 'down' },
      { slug: 'c2', at: t(1003, 368), on: [3], shape: 'up' },
      { slug: 'v3', at: t(1045, 368), on: [4], shape: 'up' },
      { slug: 'c3', at: t(1088, 368), on: [5], shape: 'up' },
    ],
    { initial: 5 },
  )
  s.label('ON', t(880, 512))
  s.toggle('organ-vibrato-on', 'Organ Vibrato/Chorus On', t(968, 528), t(880, 541), { look: 'light', initial: 1 })

  // B3 Percussion.
  s.plate('frame', t(1165, 270), u(518, 588), 22)
  s.label('B3 PERCUSSION', u(240, 269), { font: 'wide', size: 22, box: 'cut-dark' })
  s.label('VOLUME', u(79, 299))
  s.label('SOFT', u(73, 332))
  s.toggle('organ-perc-volume-soft', 'B3 Percussion Volume Soft', u(80, 398), u(25, 332))
  s.led('organ-perc-poly', u(26, 464), 'red', false)
  s.label('POLY ▽', u(86, 464))
  s.label('DECAY', u(240, 299))
  s.label('FAST', u(233, 332))
  s.toggle('organ-perc-decay-fast', 'B3 Percussion Decay Fast', u(240, 398), u(186, 332), { initial: 1 })
  s.label('HARMONIC', u(400, 299))
  s.label('THIRD', u(400, 332))
  s.toggle('organ-perc-harmonic-third', 'B3 Percussion Harmonic Third', u(400, 398), u(346, 332), { initial: 1 })
  s.label('ON', u(312, 512))
  s.toggle('organ-perc-on', 'B3 Percussion On', u(401, 528), u(313, 541), { look: 'light' })

  // Drawbars. LED graph, numerals, and slot are drawn by the drawbar itself.
  ORGAN_DRAWBARS.forEach((bar, index) => {
    const number = index + 1
    s.label(bar.top, [bar.x + 60, 560 + 637], { size: 25 })
    s.drawbar(`organ-drawbar-${number}`, `Organ drawbar ${number}, ${bar.footage}`, [bar.x, 560], bar.initial, bar.cap)
    s.label(bar.footage, [bar.x + 6, 560 + 1257], { size: 30 })
  })

  s.landmark(
    'nine physical drawbars',
    ORGAN_DRAWBARS.map((_, index) => `organ-drawbar-${index + 1}`),
  )
  s.landmark('level LED ladders', ['organ-layer-a-level', 'organ-layer-b-level'])
  s.landmark('organ model switches', ['organ-model', 'organ-vibrato-type', 'organ-vibrato-on'])
  s.landmark('percussion controls', [
    'organ-perc-volume-soft',
    'organ-perc-decay-fast',
    'organ-perc-harmonic-third',
    'organ-perc-on',
  ])
  return s.inventory
}
