import { createSection, tile } from '../builder'
import type { SectionInventory } from '../types'
import { layerStrip, octaveShift } from './shared'

/** Synth: dark inset plate, three layer strips, one narrow OLED with three dials, dense parameter groups. */
export function buildSynth(): SectionInventory {
  const s = createSection('synth')
  const t = tile(4)
  const u = tile(5)

  const rail = { size: 23 }
  s.label('AC IN', t(789, 88), rail)
  s.label('POWER ON/OFF', t(1180, 88), rail)

  s.plate('dark', t(18, 212), u(962, 1275), 20)
  s.plate('light', t(18, 128), t(908, 222), 20)
  s.plate('light', t(18, 180), u(962, 222), 20)
  s.label('SYNTH', t(125, 167), { font: 'wide', size: 42, tone: 'dark' })
  s.label('SECTION', t(78, 199), { tone: 'dark', size: 26 })
  s.label('FX FOCUS', t(514, 160), { tone: 'dark' })
  s.led('synth-fx-focus', t(514, 189), 'yellow', true)
  s.label('ON', t(640, 160), { tone: 'dark' })
  s.toggle('synth-on', 'Synth section On', t(733, 176), t(640, 189), { initial: 1 })
  s.label('SOLO ▼', t(852, 176), { tone: 'dark', size: 26 })

  layerStrip(s, t, { prefix: 'synth', sectionName: 'Synth', letter: 'A', x: 78, y: 229, level: 100, on: true, color: 'yellow' })
  layerStrip(s, t, { prefix: 'synth', sectionName: 'Synth', letter: 'B', x: 254, y: 229, level: 25, on: true, color: 'yellow' })
  layerStrip(s, t, { prefix: 'synth', sectionName: 'Synth', letter: 'C', x: 429, y: 229, level: 67, on: true, color: 'yellow' })
  s.led('synth-sustped', t(60, 841), 'red', true)
  s.label('SUSTPED', t(128, 841))
  s.led('synth-pstick', t(218, 841), 'red', true)
  s.label('PSTICK/RNG ▼', t(313, 841))
  s.label('PAN ▼', t(467, 828))

  s.plate('red-box', t(42, 896), t(178, 928), 4)
  s.label('KB HOLD', t(126, 912))
  s.toggle('synth-kb-hold', 'Synth KB Hold', t(115, 978), t(60, 912))
  s.led('synth-exclude', t(51, 1044), 'red', false)
  s.label('EXCLUDE ▽', t(130, 1044))
  s.label('ARP RUN', t(303, 912))
  s.toggle('synth-arp-run', 'Synth Arpeggiator Run', t(290, 978), t(235, 912), { look: 'red' })
  s.led('synth-kb-sync', t(236, 1044), 'red', false)
  s.label('KB SYNC ▽', t(313, 1044))
  s.plate('rule', t(196, 910), t(203, 914), 0)
  s.plate('rule', t(200, 910), t(204, 1046), 0)
  s.plate('rule', t(190, 1042), t(203, 1046), 0)

  octaveShift(s, t, 'synth', 'Synth', 203, 1156, [false, false, true, true])

  // The one OLED in this section, and the three dials wired to it.
  s.oled('synth-oled', 'Synth OLED', t(677, 249), t(1173, 507))
  s.plate('rule', t(741, 535), t(745, 572), 0)
  s.plate('rule', t(686, 630), t(690, 662), 0)
  s.plate('rule', t(921, 535), t(925, 662), 0)
  s.plate('rule', t(1103, 535), t(1107, 572), 0)
  s.plate('rule', t(1158, 630), t(1162, 662), 0)
  s.encoder('synth-osc-dial-1', 'Oscillator dial 1, type', t(687, 738), { ring: true })
  s.label('INFO', t(688, 816), { tone: 'dim' })
  s.encoder('synth-osc-dial-2', 'Oscillator dial 2, category', t(923, 738), { ring: true })
  s.label('LIST', t(923, 816), { tone: 'dim' })
  s.encoder('synth-osc-dial-3', 'Oscillator dial 3, waveform', t(1160, 738), { ring: true })
  s.label('LIST', t(1160, 816), { tone: 'dim' })

  // Mode.
  s.plate('light', t(1210, 245), u(200, 500), 18)
  s.label('MODE', u(106, 250), { font: 'wide', size: 22, tone: 'dark', box: 'cut-light' })
  s.label('SAMPLES', u(120, 297), { tone: 'dark' })
  s.label('ANALOG', u(114, 340), { tone: 'dark' })
  s.selector(
    'synth-mode',
    'Synth oscillator Mode',
    u(105, 405),
    ['Samples', 'Analog'],
    [
      { slug: 'samples', at: u(50, 297), on: [0] },
      { slug: 'analog', at: u(50, 340), on: [1] },
    ],
    { initial: 1 },
  )
  s.led('synth-mode-extern', u(45, 471), 'red', false)
  s.label('EXTERN', u(106, 471), { tone: 'dark' })

  // Waveform button.
  s.label('WAVEFORM', u(140, 548))
  s.led('synth-keep-edits', u(78, 577), 'red', true)
  s.label('KEEP EDITS ▼', u(150, 577), { tone: 'dim', size: 24 })
  s.button('synth-waveform', 'Synth Waveform / Sound Init', u(139, 675), { vertical: true, surround: true })
  s.label('SOUND\nINIT', u(139, 779))

  // LFO.
  s.plate('light', t(400, 852), t(832, 1263), 18)
  s.label('LFO', t(625, 852), { font: 'wide', size: 22, tone: 'dark', box: 'cut-light' })
  s.label('WAVEFORM', t(515, 879), { tone: 'dark' })
  s.toggle('synth-lfo-waveform', 'LFO Waveform', t(496, 945), t(433, 879), { surround: true })
  s.led('synth-lfo-group', t(429, 1011), 'red', false)
  s.label('GROUP ▽', t(507, 1011), { tone: 'dark' })
  s.knob('synth-lfo-amount', 'LFO Mod Amount', t(735, 962), { onLight: true, initial: 6.5 })
  s.led('synth-lfo-amount-morph', t(680, 1042), 'red', false)
  s.label('MOD AMT', t(753, 1042), { tone: 'dark' })
  s.knob('synth-lfo-rate', 'LFO Rate/Time', t(516, 1112), { onLight: true, initial: 3.5 })
  s.led('synth-lfo-rate-morph', t(465, 1194), 'red', false)
  s.label('RATE/TIME', t(541, 1194), { tone: 'dark' })
  s.plate('red-box', t(447, 1220), t(580, 1252), 4)
  s.led('synth-lfo-mst-clk', t(465, 1236), 'red', false)
  s.label('MST CLK', t(531, 1236))
  s.label('OSC PITCH', t(664, 1105), { tone: 'dark' })
  s.label('OSC CTRL', t(669, 1147), { tone: 'dark' })
  s.label('FILTER', t(782, 1127), { tone: 'dark' })
  s.selector(
    'synth-lfo-dest',
    'LFO destination',
    t(734, 1213),
    ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter'],
    [
      { slug: 'osc-pitch', at: t(734, 1105), on: [1, 3] },
      { slug: 'osc-ctrl', at: t(734, 1147), on: [2, 3] },
    ],
  )

  // Oscillators.
  s.plate('light', t(857, 852), u(130, 1263), 18)
  s.label('OSCILLATORS', t(1095, 852), { font: 'wide', size: 22, tone: 'dark', box: 'cut-light' })
  s.label('PITCH/SMP', t(997, 887), { tone: 'dark' })
  s.toggle('synth-osc-pitch', 'Oscillator Pitch / Sample', t(973, 950), t(917, 887), { surround: true })
  s.led('synth-osc-env-to-pitch', t(901, 1019), 'red', false)
  s.label('ENV TO PITCH ▽', t(1003, 1019), { tone: 'dark' })
  s.plate('arch', t(880, 1058), t(1063, 1250), 16)
  s.knob('synth-osc-ctrl', 'Oscillator Control', t(971, 1140), { initial: 3.5 })
  s.led('synth-osc-ctrl-morph', t(908, 1228), 'red', false)
  s.label('OSC CTRL', t(977, 1228))
  s.label('ENVELOPE', t(1238, 887), { tone: 'dark' })
  s.toggle('synth-osc-envelope', 'Oscillator Mod Envelope', t(1217, 950), t(1162, 887), { surround: true })
  s.led('synth-osc-velocity', t(1161, 1019), 'red', false)
  s.label('VELOCITY ▽', t(1241, 1019), { tone: 'dark' })
  s.knob('synth-osc-env-amt', 'Oscillator Mod Envelope Amount', t(1218, 1150), {
    scale: 'bipolar-10',
    onLight: true,
    min: -10,
    max: 10,
    initial: 3,
  })
  s.led('synth-osc-env-amt-morph', t(1161, 1228), 'red', false)
  s.label('ENV AMT', t(1229, 1228), { tone: 'dark' })

  // Arpeggiator / Gate.
  s.plate('frame', u(228, 248), u(948, 540), 22)
  s.label('ARPEGGIATOR/GATE', u(585, 248), { font: 'wide', size: 22, box: 'cut-dark' })
  s.knob('synth-arp-rate', 'Arpeggiator Rate/Time', u(323, 372), { initial: 6.5 })
  s.led('synth-arp-rate-morph', u(269, 450), 'red', false)
  s.label('RATE/TIME', u(346, 450))
  s.plate('red-box', u(251, 476), u(385, 508), 4)
  s.led('synth-arp-mst-clk', u(269, 492), 'red', false)
  s.label('MST CLK', u(335, 492))
  s.label('POLY', u(472, 318))
  s.label('ARP', u(477, 360))
  s.label('GATE', u(566, 339), { box: 'filled', tone: 'dark', size: 26 })
  s.selector(
    'synth-arp-mode',
    'Arpeggiator / Gate mode',
    u(518, 425),
    ['Arp', 'Gate', 'Poly'],
    [
      { slug: 'poly', at: u(518, 318), on: [1, 2] },
      { slug: 'arp', at: u(518, 360), on: [0, 1] },
    ],
  )
  s.led('synth-arp-pattern', u(454, 492), 'red', false)
  s.label('PATTERN ▽', u(530, 492))
  s.knob('synth-arp-range', 'Arpeggiator Range / Gate Envelope', u(718, 365), { scale: 'arp-range', initial: 5 })
  s.led('synth-arp-range-morph', u(647, 450), 'red', false)
  s.label('RANGE', u(701, 450))
  s.label('ENV', u(768, 450), { box: 'filled', tone: 'dark', size: 26 })
  s.label('MENU', u(891, 298))
  s.toggle('synth-arp-menu', 'Arpeggiator Menu', u(879, 398), u(841, 298), { vertical: true, surround: true })
  s.led('synth-arp-group', u(822, 495), 'red', false)
  s.label('GROUP ▽', u(887, 495))

  // Voice.
  s.plate('frame', u(228, 545), u(630, 820), 22)
  s.label('VOICE', u(420, 545), { font: 'wide', size: 22, box: 'cut-dark' })
  s.label('MONO', u(320, 617))
  s.label('LEGATO', u(325, 659))
  s.selector(
    'synth-voice-mode',
    'Synth Voice mode',
    u(319, 724),
    ['Poly', 'Mono', 'Legato'],
    [
      { slug: 'mono', at: u(264, 617), on: [1] },
      { slug: 'legato', at: u(264, 659), on: [2] },
    ],
  )
  s.led('synth-voice-lo', u(264, 790), 'red', false)
  s.label('LO ▽', u(302, 790), { size: 26 })
  s.led('synth-voice-hi', u(344, 790), 'red', false)
  s.label('HI ▽', u(381, 790), { size: 26 })
  s.plate('rule', u(374, 634), u(414, 638), 0)
  s.plate('rule', u(410, 634), u(414, 752), 0)
  s.plate('rule', u(410, 748), u(472, 752), 0)
  s.knob('synth-glide', 'Synth Glide', u(519, 668), { initial: 7 })
  s.label('GLIDE', u(517, 750), { tone: 'dim' })

  // Vibrato.
  s.plate('frame', u(633, 545), u(948, 820), 22)
  s.label('VIBRATO', u(790, 545), { font: 'wide', size: 22, box: 'cut-dark' })
  s.label('WHL', u(686, 583))
  s.label('DLY', u(691, 626))
  s.label('ON', u(694, 668))
  s.label('A.T.', u(771, 605))
  s.label('PED', u(773, 648))
  s.selector(
    'synth-vibrato-mode',
    'Synth Vibrato mode',
    u(731, 733),
    ['Off', 'On', 'Delay', 'Wheel', 'Aftertouch', 'Pedal'],
    [
      { slug: 'whl', at: u(732, 583), on: [3, 4] },
      { slug: 'dly', at: u(732, 626), on: [2, 4, 5] },
      { slug: 'on', at: u(732, 668), on: [1, 5] },
    ],
  )
  s.label('MENU', u(890, 610))
  s.toggle('synth-vibrato-menu', 'Vibrato Menu', u(877, 708), u(840, 610), { vertical: true, surround: true })

  // Filter.
  s.plate('light', u(155, 852), u(738, 1262), 18)
  s.label('FILTER', u(447, 852), { font: 'wide', size: 22, tone: 'dark', box: 'cut-light' })
  s.label('TYPE', u(249, 886), { tone: 'dark' })
  s.toggle('synth-filter-type', 'Filter Type', u(247, 950), u(201, 886), { surround: true })
  s.led('synth-filter-group', u(192, 1018), 'red', false)
  s.label('GROUP ▽', u(263, 1018), { tone: 'dark' })
  s.label('ENVELOPE', u(471, 886), { tone: 'dark' })
  s.toggle('synth-filter-envelope', 'Filter Envelope', u(450, 950), u(395, 886), { surround: true })
  s.led('synth-filter-velocity', u(395, 1018), 'red', false)
  s.label('VELOCITY ▽', u(477, 1018), { tone: 'dark' })
  s.knob('synth-filter-env-amt', 'Filter Envelope Amount', u(653, 940), { onLight: true, initial: 5.5 })
  s.led('synth-filter-env-amt-morph', u(593, 1021), 'red', false)
  s.label('ENV AMT', u(661, 1021), { tone: 'dark' })
  s.plate('arch', u(190, 1058), u(372, 1250), 16)
  s.knob('synth-filter-freq', 'Filter Frequency', u(281, 1148), { initial: 3.5 })
  s.led('synth-filter-freq-morph', u(228, 1227), 'red', false)
  s.label('FREQ', u(281, 1227))
  s.knob('synth-filter-res', 'Filter Resonance / Frequency HP', u(528, 1145), { onLight: true, initial: 5.2 })
  s.led('synth-filter-res-morph', u(447, 1227), 'red', false)
  s.label('RES/FREQ HP', u(537, 1227), { tone: 'dark' })
  s.label('FILTER', u(677, 1066), { tone: 'dark' })
  s.label('ON', u(685, 1092), { tone: 'dark' })
  s.toggle('synth-filter-on', 'Filter On', u(677, 1180), u(648, 1092), { vertical: true, initial: 1 })

  // Amp.
  s.plate('light', u(762, 852), u(945, 1052), 18)
  s.label('AMP', u(855, 852), { font: 'wide', size: 22, tone: 'dark', box: 'cut-light' })
  s.label('ENVELOPE', u(866, 886), { tone: 'dark' })
  s.toggle('synth-amp-envelope', 'Amp Envelope', u(854, 950), u(791, 886), { surround: true })
  s.label('VELOCITY ▽', u(857, 1008), { tone: 'dark', size: 26 })
  s.label('1', u(791, 1034), { tone: 'dark', size: 26 })
  s.led('synth-amp-velocity-1', u(816, 1034), 'red', false)
  s.label('2', u(870, 1034), { tone: 'dark', size: 26 })
  s.led('synth-amp-velocity-2', u(896, 1034), 'red', true)

  // Unison.
  s.plate('frame', u(762, 1075), u(945, 1258), 18)
  s.label('UNISON', u(853, 1077), { font: 'wide', size: 22, box: 'cut-dark' })
  s.label('2', u(824, 1107))
  s.label('1', u(824, 1149))
  s.label('3', u(881, 1128))
  s.selector(
    'synth-unison',
    'Synth Unison',
    u(853, 1213),
    ['Off', '1', '2', '3'],
    [
      { slug: '2', at: u(852, 1107), on: [2, 3] },
      { slug: '1', at: u(852, 1149), on: [1, 3] },
    ],
    { initial: 2 },
  )

  s.landmark('single synth OLED', ['synth-oled'])
  s.landmark('layer level controls', ['synth-layer-a-level', 'synth-layer-b-level', 'synth-layer-c-level'])
  s.landmark('oscillator controls', [
    'synth-osc-dial-1',
    'synth-osc-dial-2',
    'synth-osc-dial-3',
    'synth-mode',
    'synth-waveform',
    'synth-osc-pitch',
    'synth-osc-ctrl',
    'synth-osc-envelope',
    'synth-osc-env-amt',
  ])
  s.landmark('filter controls', [
    'synth-filter-type',
    'synth-filter-envelope',
    'synth-filter-env-amt',
    'synth-filter-freq',
    'synth-filter-res',
    'synth-filter-on',
  ])
  s.landmark('envelope controls', ['synth-osc-envelope', 'synth-filter-envelope', 'synth-amp-envelope'])
  s.landmark('LFO and arpeggiator controls', [
    'synth-lfo-waveform',
    'synth-lfo-rate',
    'synth-lfo-amount',
    'synth-lfo-dest',
    'synth-arp-run',
    'synth-arp-rate',
    'synth-arp-mode',
    'synth-arp-range',
    'synth-arp-menu',
  ])
  return s.inventory
}
