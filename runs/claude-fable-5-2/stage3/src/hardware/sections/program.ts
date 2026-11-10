import { createSection, tile } from '../builder'
import type { SectionInventory } from '../types'

const PROGRAM_SOFT_LABELS = ['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB', 'OUTPUT', 'PEDAL', 'MIDI', 'EXTERN'] as const

/** Program and morph: the primary Program OLED, program dial, eight program buttons, morph assign. */
export function buildProgram(): SectionInventory {
  const s = createSection('program')
  const t = tile(3)

  const rail = { size: 23 }
  s.label('USB', t(190, 91), rail)
  s.label('FOOT SWITCH', t(329, 91), rail)

  // Morph Assign.
  s.plate('dark', t(155, 138), t(598, 325), 10)
  s.plate('light', t(155, 138), t(598, 166), 10)
  s.label('MORPH ASSIGN', t(377, 152), { font: 'wide', size: 22, tone: 'dark' })
  s.label('WHEEL ⇟', t(254, 191))
  // Lit while the source has assignments, flashing while its Morph Assign is latched. Program 1.1 has none.
  s.toggle('morph-wheel', 'Morph Assign Wheel', t(242, 257), t(188, 191), { color: 'green' })
  s.label('A.T. ⇟', t(381, 191))
  s.toggle('morph-aftertouch', 'Morph Assign Aftertouch', t(377, 257), t(330, 191), { color: 'green' })
  s.label('CTRLPED ⇟', t(533, 191))
  s.toggle('morph-control-pedal', 'Morph Assign Control Pedal', t(512, 257), t(456, 191), { color: 'green' })
  s.plate('rule', t(176, 308), t(292, 312), 0)
  s.label('CLEAR MORPH', t(377, 310), { size: 26 })
  s.plate('rule', t(462, 308), t(578, 312), 0)

  // Split.
  s.plate('light', t(643, 138), t(795, 164), 10)
  s.label('SPLIT', t(719, 151), { font: 'wide', size: 22, tone: 'dark' })
  s.led('split-low', t(660, 190), 'yellow', false)
  s.led('split-high', t(778, 190), 'yellow', false)
  s.label('ON/SET ▼', t(719, 224))
  // Program 1.1 has no split, so the Split LED starts dark.
  s.toggle('split', 'Split On/Set', t(719, 276), t(719, 190), { color: 'yellow' })
  s.label('SET KEY', t(719, 331))

  // Master Clock.
  s.plate('light', t(834, 138), t(986, 164), 10)
  s.label('MST CLK', t(910, 151), { font: 'wide', size: 22, tone: 'dark' })
  s.label('TAP/SET ▼', t(921, 190))
  s.toggle('mst-clk', 'Master Clock Tap/Set', t(910, 257), t(847, 190))
  s.led('mst-clk-pedal-tap', t(855, 323), 'red', false)
  s.label('PEDAL TAP', t(930, 323))

  // Transpose.
  s.plate('light', t(1025, 138), t(1177, 164), 10)
  s.label('TRANSP', t(1100, 151), { font: 'wide', size: 22, tone: 'dark' })
  s.label('ON/SET ▼', t(1109, 190))
  s.toggle('transpose', 'Transpose On/Set', t(1100, 257), t(1038, 190))
  s.label('PANIC', t(1100, 309))

  s.label('PROG VIEW', t(1100, 357))
  s.button('prog-view', 'Prog View', t(1100, 410))
  s.label('PRESET NAME', t(1100, 464))

  // Store, MIDI / Extern indicators.
  s.label('STORE', t(250, 384))
  s.toggle('store', 'Store', t(249, 449), t(194, 384), { look: 'red' })
  s.label('STORE AS...', t(249, 503))
  s.label('PAGE NAME', t(249, 525), { tone: 'pink' })
  s.label('MIDI', t(388, 405))
  s.led('midi-indicator', t(388, 439), 'red', false)
  s.label('EXTERN', t(389, 485))
  s.led('extern-indicator', t(389, 514), 'red', false)

  // Preset Library.
  s.plate('light', t(459, 372), t(905, 541), 10)
  s.label('PRESET LIBRARY', t(680, 373), { font: 'wide', size: 22, box: 'cut-red' })
  s.label('ORGAN', t(553, 408), { tone: 'dark' })
  s.toggle('preset-organ', 'Preset Library Organ', t(547, 472), t(493, 407))
  s.label('PIANO', t(683, 408), { tone: 'dark' })
  s.toggle('preset-piano', 'Preset Library Piano', t(682, 472), t(627, 407))
  s.label('SYNTH', t(818, 408), { tone: 'dark' })
  s.toggle('preset-synth', 'Preset Library Synth', t(817, 472), t(761, 407))
  s.plate('rule-dark', t(615, 523), t(668, 527), 0)
  s.label('SINGLE LAYER', t(749, 525), { tone: 'dark', size: 26 })
  s.plate('rule-dark', t(832, 523), t(885, 527), 0)

  // Program dial and page buttons.
  s.encoder('program-dial', 'Program dial', t(274, 643))
  s.label('PROGRAM', t(241, 720), { tone: 'dim' })
  s.label('LIST', t(336, 720), { box: 'outline', tone: 'dim', size: 26 })
  s.label('◀ PAGE/CAT ▶', t(275, 762))
  s.button('page-prev', 'Page / Category previous', t(207, 820))
  s.button('page-next', 'Page / Category next', t(342, 820))
  s.label('◀   BANK   ▶', t(276, 873))

  // The one primary OLED in this section.
  s.oled('program-oled', 'Program OLED', t(436, 575), t(931, 830))
  for (const x of [497, 621, 745, 869]) {
    s.plate('rule', t(x - 2, 855), t(x + 2, 890), 0)
  }

  // Live Mode, Layer Scene.
  s.label('LIVE MODE', t(258, 919))
  s.toggle('live-mode', 'Live Mode', t(245, 984), t(182, 919), { look: 'light' })
  s.led('num-pad', t(190, 1050), 'red', false)
  s.label('NUM PAD', t(260, 1050))
  s.plate('dark', t(165, 1087), t(328, 1265), 10)
  s.label('LAYER\nSCENE II', t(255, 1115), { size: 27 })
  s.toggle('layer-scene', 'Layer Scene II', t(246, 1180), t(190, 1113))
  s.led('layer-scene-pedal', t(190, 1246), 'red', false)
  s.label('PEDAL', t(245, 1246))

  // Eight program buttons.
  s.plate('dark', t(380, 918), t(988, 1265), 10)
  s.plate('light', t(380, 918), t(988, 948), 10)
  s.label('PROGRAM', t(684, 933), { font: 'wide', size: 22, tone: 'dark' })
  for (let index = 0; index < 8; index += 1) {
    const column = index % 4
    const row = Math.floor(index / 4)
    const x = 466 + column * 145
    const number = index + 1
    s.label(String(number), t(x + 27, 974 + row * 152))
    s.toggle(`program-${number}`, `Program ${number}`, t(x, 1040 + row * 152), t(x, 974 + row * 152), {
      initial: number === 1 ? 1 : 0,
    })
    s.label(PROGRAM_SOFT_LABELS[index], t(x, 1092 + row * 152), { tone: 'dim', size: 26 })
  }

  // Solo / Section Edit / Mon-Copy column.
  s.plate('frame-red', t(1016, 505), t(1186, 1015), 14)
  s.label('SOLO', t(1105, 531))
  s.toggle('solo', 'Solo', t(1100, 597), t(1054, 531))
  s.label('UNDO', t(1100, 650))
  s.label('SECTION\nEDIT ⇟', t(1108, 711), { size: 27 })
  s.toggle('section-edit', 'Section Edit', t(1100, 777), t(1042, 711))
  s.label('LAYER INIT', t(1100, 830))
  s.label('MON/COPY', t(1100, 883))
  s.button('mon-copy', 'Monitor / Copy', t(1100, 937))
  s.label('PASTE ⇟', t(1100, 990))

  // Shift.
  s.plate('light', t(1061, 1050), t(1170, 1265), 8)
  s.label('SHIFT', t(1115, 1072), { tone: 'dark' })
  s.button('shift', 'Shift / Exit', t(1115, 1158), { look: 'light', vertical: true })
  s.label('EXIT', t(1115, 1243), { tone: 'dark' })

  s.landmark('primary program OLED', ['program-oled'])
  s.landmark('large program dial', ['program-dial'])
  s.landmark('eight program buttons', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `program-${n}`))
  s.landmark('page navigation buttons', ['page-prev', 'page-next'])
  s.landmark('Live Mode and Layer Scene buttons', ['live-mode', 'layer-scene'])
  s.landmark('store and split buttons', ['store', 'split'])
  s.landmark('three morph assign buttons', ['morph-wheel', 'morph-aftertouch', 'morph-control-pedal'])
  return s.inventory
}
