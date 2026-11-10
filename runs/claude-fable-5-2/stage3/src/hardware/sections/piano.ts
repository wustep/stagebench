import { createSection, tile } from '../builder'
import type { SectionInventory } from '../types'
import { layerStrip, octaveShift } from './shared'

/** Piano: dark inset plate, two layer strips, timbre, acoustics, touch, and the Piano Select block. */
export function buildPiano(): SectionInventory {
  const s = createSection('piano')
  const t = tile(2)
  const v = tile(3)

  const rail = { size: 23 }
  s.label('MIDI IN', t(909, 92), rail)
  s.label('MIDI OUT', t(1086, 92), rail)
  s.label('ROTOR PEDAL', v(55, 91), rail)

  s.plate('dark', t(578, 218), v(100, 1280), 20)
  s.plate('light', t(578, 132), v(100, 228), 20)
  s.label('PIANO', t(675, 170), { font: 'wide', size: 42, tone: 'dark' })
  s.label('SECTION', t(637, 201), { tone: 'dark', size: 26 })
  s.label('FX FOCUS', t(893, 163), { tone: 'dark' })
  s.led('piano-fx-focus', t(893, 192), 'yellow', true)
  s.label('ON', t(1020, 163), { tone: 'dark' })
  s.toggle('piano-on', 'Piano section On', t(1112, 179), t(1020, 192), { initial: 1 })
  s.label('SOLO ▼', t(1232, 179), { tone: 'dark', size: 26 })

  layerStrip(s, t, { prefix: 'piano', sectionName: 'Piano', letter: 'A', x: 634, y: 232, level: 100, on: true, color: 'green' })
  layerStrip(s, t, { prefix: 'piano', sectionName: 'Piano', letter: 'B', x: 810, y: 232, level: 42, on: false, color: 'green' })
  s.led('piano-sustped', t(619, 844), 'red', true)
  s.label('SUSTPED', t(687, 844))
  s.led('piano-pstick', t(794, 844), 'red', false)
  s.label('PSTICK', t(851, 844))

  // Timbre: one vertical button, three LEDs; two LEDs together mean Dyno 1 / Dyno 2.
  s.label('TIMBRE', t(800, 906))
  s.label('BRIGHT', t(740, 940))
  s.label('MID', t(758, 983))
  s.label('SOFT', t(752, 1025))
  s.label('DYNO1', t(858, 962))
  s.label('DYNO2', t(858, 1004))
  s.selector(
    'piano-timbre',
    'Piano Timbre',
    t(657, 983),
    ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'],
    [
      { slug: 'bright', at: t(800, 940), on: [3, 4] },
      { slug: 'mid', at: t(800, 983), on: [2, 4, 5] },
      { slug: 'soft', at: t(800, 1025), on: [1, 5] },
    ],
    { vertical: true },
  )

  octaveShift(s, t, 'piano', 'Piano', 758, 1158, [true, true, true, true])

  // Acoustics / Unison.
  s.label('ACOUSTICS', t(1034, 269))
  s.label('SOFT REL', t(1038, 303))
  s.label('STRING RES', t(1052, 346))
  s.selector(
    'piano-acoustics',
    'Piano Acoustics, Soft Release and String Resonance',
    t(1034, 410),
    ['Off', 'Soft Release', 'String Resonance', 'Soft Release and String Resonance'],
    [
      { slug: 'soft-rel', at: t(970, 303), on: [1, 3] },
      { slug: 'string-res', at: t(970, 346), on: [2, 3] },
    ],
    { initial: 2 },
  )
  // Pedal noise is excluded by the piano spec, so its LED is never lit.
  s.led('piano-ped-noise', t(971, 478), 'red', false)
  s.label('PED NOISE ▽', t(1060, 478))

  s.label('UNISON', t(1211, 269))
  s.label('2', t(1182, 302))
  s.label('1', t(1182, 346))
  s.label('3', t(1239, 324))
  s.selector(
    'piano-unison',
    'Piano Unison',
    t(1211, 410),
    ['Off', '1', '2', '3'],
    [
      { slug: '2', at: t(1210, 302), on: [2, 3] },
      { slug: '1', at: t(1210, 346), on: [1, 3] },
    ],
  )

  // KB Touch / Dyn Comp.
  s.label('KB TOUCH', t(1034, 525))
  s.label('MED', t(990, 560))
  s.label('HEAVY', t(980, 602))
  s.label('LIGHT', t(1088, 581))
  s.selector(
    'piano-kb-touch',
    'Piano KB Touch',
    t(1036, 668),
    ['Medium', 'Light', 'Heavy'],
    [
      { slug: 'med', at: t(1036, 560), on: [0, 1] },
      { slug: 'heavy', at: t(1036, 602), on: [1, 2] },
    ],
  )
  s.label('DYN COMP', t(1211, 525))
  s.label('2', t(1183, 560))
  s.label('1', t(1183, 602))
  s.label('3', t(1239, 581))
  s.selector(
    'piano-dyn-comp',
    'Piano Dyn Comp',
    t(1213, 668),
    ['Off', '1', '2', '3'],
    [
      { slug: '2', at: t(1212, 560), on: [2, 3] },
      { slug: '1', at: t(1212, 602), on: [1, 3] },
    ],
  )

  // Piano Select.
  s.plate('frame', t(973, 742), t(1278, 1260), 22)
  s.label('PIANO SELECT', t(1124, 742), { font: 'wide', size: 22, box: 'cut-dark' })
  s.plate('led-box', t(1096, 771), t(1153, 893), 4)
  s.label('ELECTRIC', t(1036, 788))
  s.label('UPRIGHT', t(1038, 832))
  s.label('GRAND', t(1047, 875))
  s.label('CLAV', t(1192, 788))
  s.label('DIGITAL', t(1207, 832))
  s.label('MISC', t(1194, 875))
  s.selector(
    'piano-type',
    'Piano Select type',
    t(1125, 940),
    ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'],
    [
      { slug: 'grand', at: t(1111, 875), on: [0], shape: 'left' },
      { slug: 'upright', at: t(1111, 832), on: [1], shape: 'left' },
      { slug: 'electric', at: t(1111, 789), on: [2], shape: 'left' },
      { slug: 'clav', at: t(1138, 789), on: [3], shape: 'right' },
      { slug: 'digital', at: t(1138, 832), on: [4], shape: 'right' },
      { slug: 'misc', at: t(1138, 875), on: [5], shape: 'right' },
    ],
  )
  s.label('INFO', t(1126, 993))
  s.encoder('piano-model', 'Piano Model dial', t(1125, 1147))
  s.label('MODEL', t(1092, 1223), { tone: 'dim' })
  s.label('LIST', t(1167, 1223), { box: 'outline', tone: 'dim', size: 26 })

  s.landmark('layer level controls', ['piano-layer-a-level', 'piano-layer-b-level'])
  s.landmark('piano type selectors', ['piano-type'])
  s.landmark('model selector', ['piano-model'])
  s.landmark('timbre controls', ['piano-timbre'])
  s.landmark('piano-detail switches', ['piano-acoustics', 'piano-unison', 'piano-kb-touch', 'piano-dyn-comp'])
  return s.inventory
}
