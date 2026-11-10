import { createSection, tile } from '../builder'
import type { SectionInventory } from '../types'

/** Performance band: exposed red chassis, no inset plate, no OLED. */
export function buildPerformance(): SectionInventory {
  const s = createSection('performance')
  const t = tile(0)

  s.stick('perf-pitch-stick', 'Pitch stick', t(469, 381), 262, 122, -17)
  s.wheel('perf-mod-wheel', 'Modulation wheel', t(763, 669), 100, 404, -13)

  s.label('MASTER LEVEL', t(1146, 198), { size: 30 })
  s.plate('ring', t(1066, 219), t(1214, 367), 74)
  s.knob('perf-master-level', 'Master Level', t(1140, 293), { scale: 'master', initial: 7 })

  // Rotary Speaker block: printed on the red chassis below Master Level.
  s.plate('frame-red', t(1035, 455), t(1272, 1280), 18)
  s.plate('light', t(1035, 455), t(1272, 499), 18)
  s.label('ROTARY\nSPEAKER', t(1150, 476), { font: 'wide', size: 21, tone: 'dark' })
  s.label('ON', t(1203, 519))
  s.led('rotary-on', t(1238, 519), 'red', true)
  s.knob('rotary-drive', 'Rotary Speaker Drive', t(1143, 608), { initial: 1.5 })
  s.label('DRIVE', t(1151, 689), { tone: 'dim' })

  s.label('ORGAN', t(1157, 736))
  s.toggle('rotary-source', 'Rotary Speaker Organ source', t(1152, 800), t(1098, 736), { look: 'light' })
  s.led('rotary-close-mic', t(1091, 867), 'red', false)
  s.label('CLOSE MIC ▽', t(1179, 867))

  s.plate('rule', t(1059, 929), t(1064, 1112), 0)
  s.plate('rule', t(1059, 929), t(1080, 934), 0)
  s.plate('rule', t(1059, 1107), t(1072, 1112), 0)
  s.label('STOP MODE', t(1173, 931))
  s.toggle('rotary-stop-mode', 'Rotary Speaker Stop Mode', t(1155, 996), t(1092, 931))
  s.label('ANGLE', t(1156, 1049))

  s.label('SLOW', t(1136, 1110))
  s.label('FAST', t(1235, 1110))
  s.selector(
    'rotary-speed',
    'Rotary Speaker speed, Slow/Stop or Fast',
    t(1156, 1176),
    ['Slow/Stop', 'Fast'],
    [
      { slug: 'slow', at: t(1085, 1110), on: [0], color: 'green' },
      { slug: 'fast', at: t(1189, 1110), on: [1], color: 'green' },
    ],
  )
  s.led('rotary-morph', t(1103, 1242), 'red', false)
  s.label('MORPH', t(1164, 1242))

  s.label('nord stage 4', t(637, 1196), { font: 'logo', size: 133 }).id = 'brand-logo'
  s.label('HAMMER ACTION 73', t(637, 1276), { font: 'logo-sub', size: 27 })

  s.landmark('master level knob', ['perf-master-level'])
  s.landmark('rotary speaker controls', ['rotary-drive', 'rotary-source', 'rotary-stop-mode', 'rotary-speed'])
  s.landmark('pitch stick', ['perf-pitch-stick'])
  s.landmark('modulation wheel', ['perf-mod-wheel'])
  s.landmark('Nord Stage 4 branding', ['brand-logo'])
  return s.inventory
}
