import { createSection, tile } from '../builder'
import type { SectionInventory } from '../types'

/**
 * Layer Effects: the FX Focus column on red chassis, then a dark plate split into
 * two visibly separate groups — Mod 1 / Mod 2 / Amp Sim-EQ on the left,
 * Delay / Comp / Reverb on the right. No OLED.
 */
export function buildEffects(): SectionInventory {
  const s = createSection('effects')
  const u = tile(5)
  const w = tile(6)
  const z = tile(7)

  // Header and plate.
  s.plate('dark', u(1155, 212), z(632, 1275), 20)
  s.plate('light', u(985, 127), w(527, 222), 20)
  s.plate('light', u(985, 178), z(632, 222), 20)
  s.plate('light', u(985, 212), u(1155, 247), 4)
  s.label('LAYER EFFECTS', w(6, 178), { font: 'wide', size: 40, tone: 'dark' })
  s.label('FX FOCUS', u(1068, 232), { font: 'wide', size: 20, tone: 'dark' })
  s.label('ON', w(329, 157), { tone: 'dark' })
  s.toggle('fx-on', 'Layer Effects On', w(421, 172), w(328, 186), { initial: 1 })

  // FX Focus column.
  s.label('ORGAN', u(1062, 316))
  s.label('A B', u(1062, 375))
  s.toggle('fx-focus-organ', 'FX Focus Organ', u(1062, 432), u(1062, 345), { color: 'yellow' })
  s.label('ALL FX OFF', u(1062, 487))
  s.label('PIANO', u(1062, 563))
  s.label('A', u(1031, 621))
  s.label('B', u(1090, 621))
  s.selector(
    'fx-focus-piano',
    'FX Focus Piano layer',
    u(1061, 679),
    ['None', 'Layer A', 'Layer B'],
    [
      { slug: 'a', at: u(1031, 591), on: [1], color: 'yellow' },
      { slug: 'b', at: u(1090, 591), on: [2], color: 'yellow' },
    ],
  )
  s.label('GROUP ▽', u(1062, 733))
  s.label('SYNTH', u(1059, 811))
  s.label('A', u(1004, 869))
  s.label('B', u(1059, 869))
  s.label('C', u(1113, 869))
  s.selector(
    'fx-focus-synth',
    'FX Focus Synth layer',
    u(1059, 929),
    ['None', 'Layer A', 'Layer B', 'Layer C', 'Group A B C'],
    [
      { slug: 'a', at: u(1004, 839), on: [1, 4], color: 'yellow' },
      { slug: 'b', at: u(1059, 839), on: [2, 4], color: 'yellow' },
      { slug: 'c', at: u(1113, 839), on: [3, 4], color: 'yellow' },
    ],
    { initial: 4 },
  )
  s.label('GROUP ▽', u(1060, 982))
  s.plate('light', u(1003, 1056), u(1113, 1267), 8)
  s.label('SHIFT', u(1058, 1077), { tone: 'dark' })
  s.button('fx-shift', 'Shift / Exit, effects side', u(1058, 1162), { look: 'light', vertical: true })
  s.label('EXIT', u(1058, 1247), { tone: 'dark' })

  // ── Group 1: modulation and amp ─────────────────────────────────────────────
  // Mod 1.
  s.plate('frame', u(1165, 235), w(748, 522), 22)
  s.label('MOD 1', w(187, 235), { font: 'wide', size: 22, box: 'cut-dark' })
  s.knob('fx-mod1-rate', 'Mod 1 Rate', w(72, 372), { initial: 3.2 })
  s.led('fx-mod1-rate-morph', w(12, 448), 'red', false)
  s.label('RATE', w(57, 448), { tone: 'dim' })
  s.label('SENS', w(127, 448), { box: 'outline', tone: 'dim', size: 26 })
  s.plate('red-box', w(-8, 475), w(128, 507), 4)
  s.led('fx-mod1-mst-clk', w(12, 491), 'red', false)
  s.label('MST CLK', w(78, 491))
  s.knob('fx-mod1-amount', 'Mod 1 Amount', w(310, 368), { initial: 6.5 })
  s.led('fx-mod1-amount-morph', w(247, 448), 'red', false)
  s.label('AMOUNT', w(312, 448), { tone: 'dim' })
  s.plate('led-box', w(483, 270), w(541, 393), 4)
  s.label('RM', w(458, 288))
  s.label('TREM', w(446, 331))
  s.label('A-PAN', w(441, 375))
  s.label('A-WAH', w(593, 288), { box: 'outline', size: 26 })
  s.label('WAH', w(580, 331), { box: 'filled', tone: 'dark', size: 26 })
  s.label('PUMP', w(586, 375), { box: 'filled', tone: 'dark', size: 26 })
  s.selector(
    'fx-mod1-type',
    'Mod 1 effect type',
    w(511, 439),
    ['A-Pan', 'Trem', 'RM', 'A-Wah', 'Wah', 'Pump'],
    [
      { slug: 'a-pan', at: w(498, 374), on: [0], shape: 'left' },
      { slug: 'trem', at: w(498, 331), on: [1], shape: 'left' },
      { slug: 'rm', at: w(498, 288), on: [2], shape: 'left' },
      { slug: 'a-wah', at: w(526, 288), on: [3], shape: 'right' },
      { slug: 'wah', at: w(526, 331), on: [4], shape: 'right' },
      { slug: 'pump', at: w(526, 374), on: [5], shape: 'right' },
    ],
    { initial: 5 },
  )
  s.led('fx-mod1-variation', w(418, 453), 'red', false)
  s.label('VARIATION', w(491, 498))
  s.label('PED', w(579, 498), { box: 'filled', tone: 'dark', size: 26 })
  s.label('▽', w(617, 498))
  s.label('ON', w(677, 328))
  s.toggle('fx-mod1-on', 'Mod 1 On', w(692, 420), w(714, 328), { look: 'light', vertical: true, initial: 1 })

  // Mod 2.
  s.plate('frame', u(1165, 527), w(748, 787), 22)
  s.label('MOD 2', w(186, 526), { font: 'wide', size: 22, box: 'cut-dark' })
  s.knob('fx-mod2-rate', 'Mod 2 Rate', w(70, 650), { initial: 6.3 })
  s.led('fx-mod2-rate-morph', w(10, 727), 'red', false)
  s.label('RATE', w(65, 727), { tone: 'dim' })
  s.knob('fx-mod2-amount', 'Mod 2 Amount', w(307, 646), { initial: 3 })
  s.led('fx-mod2-amount-morph', w(243, 727), 'red', false)
  s.label('AMOUNT', w(309, 727), { tone: 'dim' })
  s.plate('led-box', w(481, 541), w(539, 664), 4)
  s.label('CHOR', w(443, 558))
  s.label('FLANG', w(439, 602))
  s.label('PHAS', w(444, 645))
  s.label('VIBE', w(573, 558))
  s.label('ENS', w(569, 602))
  s.label('SPIN', w(573, 645))
  s.selector(
    'fx-mod2-type',
    'Mod 2 effect type',
    w(509, 711),
    ['Phaser', 'Flanger', 'Chorus', 'Vibe', 'Ensemble', 'Spin'],
    [
      { slug: 'phas', at: w(496, 645), on: [0], shape: 'left' },
      { slug: 'flang', at: w(496, 602), on: [1], shape: 'left' },
      { slug: 'chor', at: w(496, 559), on: [2], shape: 'left' },
      { slug: 'vibe', at: w(524, 559), on: [3], shape: 'right' },
      { slug: 'ens', at: w(524, 602), on: [4], shape: 'right' },
      { slug: 'spin', at: w(524, 645), on: [5], shape: 'right' },
    ],
    { initial: 2 },
  )
  s.led('fx-mod2-variation', w(415, 723), 'red', true)
  s.label('VARIATION ▽', w(510, 765))
  s.label('ON', w(675, 602))
  s.toggle('fx-mod2-on', 'Mod 2 On', w(690, 695), w(712, 602), { look: 'light', vertical: true, initial: 1 })

  // Amp Sim / EQ.
  s.plate('frame', u(1165, 792), w(745, 1258), 22)
  s.label('AMP SIM/EQ', w(183, 792), { font: 'wide', size: 22, box: 'cut-dark' })
  s.label('ON', u(1188, 808))
  s.led('fx-drive-on', u(1188, 835), 'red', true)
  s.knob('fx-drive', 'Amp Sim Drive', w(65, 912), { initial: 3.2 })
  s.led('fx-drive-morph', w(8, 990), 'red', false)
  s.label('DRIVE', w(63, 990), { tone: 'dim' })
  s.knob('fx-eq-bass', 'EQ Bass', w(65, 1150), { scale: 'bipolar-15', min: -15, max: 15, initial: 6, unit: 'dB' })
  s.label('BASS', w(62, 1226), { tone: 'dim' })
  s.knob('fx-eq-mid-freq', 'EQ Mid Frequency', w(305, 908), { scale: 'eq-freq', initial: 5.2 })
  s.led('fx-eq-freq-morph', w(245, 990), 'red', false)
  s.label('FREQ', w(299, 988), { tone: 'dim' })
  s.label('FREQ', w(299, 1017), { box: 'filled', tone: 'dark', size: 24 })
  s.plate('rule', w(296, 1036), w(300, 1062), 0)
  s.knob('fx-eq-mid', 'EQ Mid', w(305, 1147), { scale: 'bipolar-15', min: -15, max: 15, initial: 8, unit: 'dB' })
  s.label('MID', w(272, 1226), { tone: 'dim' })
  s.label('RES', w(323, 1226), { box: 'filled', tone: 'dark', size: 24 })
  s.knob('fx-eq-treble', 'EQ Treble', w(540, 1145), { scale: 'bipolar-15', min: -15, max: 15, initial: 1, unit: 'dB' })
  s.label('TREBLE', w(534, 1226), { tone: 'dim' })
  s.plate('led-box', w(514, 813), w(573, 936), 4)
  s.label('SMALL', w(471, 831))
  s.label('JC', w(495, 874))
  s.label('TWIN', w(477, 916))
  s.label('TO ROTARY', w(645, 830), { box: 'red', size: 26 })
  s.label('LP FILTER', w(635, 873), { box: 'filled', tone: 'dark', size: 26 })
  s.label('HP FILTER', w(635, 916), { box: 'filled', tone: 'dark', size: 26 })
  s.selector(
    'fx-amp-type',
    'Amp Sim / EQ model',
    w(543, 983),
    ['Twin', 'JC', 'Small', 'To Rotary', 'LP Filter', 'HP Filter'],
    [
      { slug: 'twin', at: w(529, 916), on: [0], shape: 'left' },
      { slug: 'jc', at: w(529, 874), on: [1], shape: 'left' },
      { slug: 'small', at: w(529, 831), on: [2], shape: 'left' },
      { slug: 'to-rotary', at: w(557, 831), on: [3], shape: 'right' },
      { slug: 'lp-filter', at: w(557, 874), on: [4], shape: 'right' },
      { slug: 'hp-filter', at: w(557, 916), on: [5], shape: 'right' },
    ],
  )
  s.led('fx-amp-variation', w(450, 995), 'red', false)
  s.label('VARIATION ▽', w(544, 1035))
  s.label('ON', w(671, 1039))
  s.toggle('fx-amp-on', 'Amp Sim / EQ On', w(687, 1132), w(708, 1039), { look: 'light', vertical: true, initial: 1 })

  // ── Group 2: delay, compressor, reverb ──────────────────────────────────────
  // Delay.
  s.plate('frame', w(752, 235), z(618, 822), 22)
  s.label('DELAY', z(285, 234), { font: 'wide', size: 22, box: 'cut-dark' })
  s.knob('fx-delay-tempo', 'Delay Tempo', w(883, 394), { initial: 3 })
  s.led('fx-delay-tempo-morph', w(820, 471), 'red', false)
  s.label('TEMPO', w(879, 471), { tone: 'dim' })
  s.plate('red-box', w(802, 498), w(936, 530), 4)
  s.led('fx-delay-mst-clk', w(820, 514), 'red', false)
  s.label('MST CLK', w(886, 514))
  s.label('EFFECTS', w(1090, 290))
  s.label('CHOR', w(1039, 325))
  s.label('VIBE', w(1044, 367))
  s.label('ENS', w(1048, 409))
  s.label('FLAM', w(1139, 346))
  s.label('SPACE', w(1144, 388))
  s.selector(
    'fx-delay-effects',
    'Delay feedback Effects',
    w(1088, 474),
    ['Off', 'Chorus', 'Flam', 'Vibe', 'Space', 'Ensemble'],
    [
      { slug: 'chor', at: w(1090, 325), on: [1, 2] },
      { slug: 'vibe', at: w(1090, 367), on: [2, 3, 4] },
      { slug: 'ens', at: w(1090, 409), on: [4, 5] },
    ],
    { initial: 4 },
  )
  s.led('fx-delay-variation', w(1024, 541), 'red', false)
  s.label('VARIATION ▽', w(1112, 541))
  s.plate('light', w(787, 575), w(962, 763), 10)
  s.led('fx-delay-tap-set', w(819, 603), 'red', false)
  s.label('TAP/SET ▼', w(893, 603), { tone: 'dark' })
  s.button('fx-delay-tap', 'Delay Tap/Set', w(874, 669))
  s.led('fx-delay-analog', w(819, 735), 'red', false)
  s.label('ANALOG ▽', w(893, 735), { tone: 'dark' })
  s.knob('fx-delay-mix', 'Delay Dry/Wet', w(1094, 692), { initial: 2 })
  s.led('fx-delay-mix-morph', w(1012, 770), 'red', false)
  s.label('DRY', w(1054, 770), { tone: 'dim' })
  s.label('WET', w(1122, 770), { tone: 'dim' })
  s.knob('fx-delay-feedback', 'Delay Feedback', z(523, 327), { initial: 6.5 })
  s.led('fx-delay-feedback-morph', z(451, 408), 'red', false)
  s.label('FEEDBACK', z(523, 408), { tone: 'dim' })
  s.label('FILTER', z(495, 451))
  s.label('HP', z(460, 484))
  s.label('LP', z(458, 526))
  s.label('BP', z(530, 505))
  s.selector(
    'fx-delay-filter',
    'Delay feedback Filter',
    z(494, 592),
    ['Off', 'LP', 'BP', 'HP'],
    [
      { slug: 'hp', at: z(495, 484), on: [2, 3] },
      { slug: 'lp', at: z(495, 526), on: [1, 2] },
    ],
    { initial: 1 },
  )
  s.led('fx-delay-ping-pong', z(586, 604), 'red', false)
  s.label('PING PONG ▽', z(495, 646))
  s.label('ON', z(424, 701))
  s.toggle('fx-delay-on', 'Delay On', z(518, 725), z(424, 729), { look: 'light', initial: 1 })
  s.plate('red-box', z(443, 775), z(588, 807), 4)
  s.led('fx-delay-global', z(461, 791), 'red', false)
  s.label('GLOBAL ▽', z(529, 791))

  // Compressor.
  s.plate('frame', w(752, 825), w(987, 1258), 22)
  s.label('COMP', w(868, 824), { font: 'wide', size: 22, box: 'cut-dark' })
  s.led('fx-comp-active', w(792, 863), 'red', false)
  s.label('ACTIVE', w(850, 863))
  s.knob('fx-comp-amount', 'Compressor Amount', w(875, 965), { initial: 2.2 })
  s.label('AMOUNT', w(865, 1040), { tone: 'dim' })
  s.led('fx-comp-fast', w(811, 1069), 'red', false)
  s.label('FAST', w(859, 1069), { tone: 'dim' })
  s.label('ON', w(778, 1143))
  s.toggle('fx-comp-on', 'Compressor On', w(872, 1167), w(778, 1171))
  s.plate('red-box', w(797, 1217), w(942, 1249), 4)
  s.led('fx-comp-global', w(815, 1233), 'red', false)
  s.label('GLOBAL ▽', w(885, 1233))

  // Reverb.
  s.plate('frame', w(990, 825), z(612, 1258), 22)
  s.label('REVERB', z(400, 824), { font: 'wide', size: 22, box: 'cut-dark' })
  s.label('BRIGHT', z(289, 864))
  s.label('DARK', z(278, 906))
  s.selector(
    'fx-reverb-tone',
    'Reverb Bright / Dark',
    z(282, 972),
    ['Off', 'Bright', 'Dark'],
    [
      { slug: 'bright', at: z(228, 864), on: [1] },
      { slug: 'dark', at: z(228, 906), on: [2] },
    ],
  )
  s.plate('led-box', z(455, 845), z(513, 966), 4)
  s.label('ROOM', z(414, 862))
  s.label('BOOTH', z(410, 904))
  s.label('SPRING', z(407, 946))
  s.label('STAGE', z(557, 862))
  s.label('HALL', z(549, 904))
  s.label('CATH', z(550, 946))
  s.selector(
    'fx-reverb-type',
    'Reverb type',
    z(484, 1016),
    ['Spring', 'Booth', 'Room', 'Stage', 'Hall', 'Cathedral'],
    [
      { slug: 'spring', at: z(470, 946), on: [0], shape: 'left' },
      { slug: 'booth', at: z(470, 904), on: [1], shape: 'left' },
      { slug: 'room', at: z(470, 862), on: [2], shape: 'left' },
      { slug: 'stage', at: z(498, 862), on: [3], shape: 'right' },
      { slug: 'hall', at: z(498, 904), on: [4], shape: 'right' },
      { slug: 'cath', at: z(498, 946), on: [5], shape: 'right' },
    ],
    { initial: 5 },
  )
  s.led('fx-reverb-chorale', z(576, 1027), 'red', true)
  s.label('VAR | CHORALE ▽', z(484, 1068))
  s.knob('fx-reverb-mix', 'Reverb Dry/Wet', z(300, 1150), { initial: 6.5 })
  s.led('fx-reverb-mix-morph', z(217, 1233), 'red', false)
  s.label('DRY', z(259, 1233), { tone: 'dim' })
  s.label('WET', z(326, 1233), { tone: 'dim' })
  s.label('ON', z(420, 1143))
  s.toggle('fx-reverb-on', 'Reverb On', z(514, 1166), z(420, 1170), { look: 'light', initial: 1 })
  s.plate('red-box', z(439, 1217), z(584, 1249), 4)
  s.led('fx-reverb-global', z(457, 1233), 'red', false)
  s.label('GLOBAL ▽', z(525, 1233))

  s.label('HANDMADE IN SWEDEN BY CLAVIA DMI AB   v2.0  Rev.B', z(645, 965), { size: 20, vertical: true })

  s.landmark('two effect groups', ['fx-mod1-type', 'fx-mod2-type', 'fx-amp-type', 'fx-delay-effects', 'fx-reverb-type'])
  s.landmark('amp simulator and EQ', ['fx-drive', 'fx-amp-type', 'fx-eq-bass', 'fx-eq-mid-freq', 'fx-eq-mid', 'fx-eq-treble', 'fx-amp-on'])
  s.landmark('delay', ['fx-delay-tempo', 'fx-delay-feedback', 'fx-delay-mix', 'fx-delay-effects', 'fx-delay-filter', 'fx-delay-tap', 'fx-delay-on'])
  s.landmark('compressor', ['fx-comp-amount', 'fx-comp-on'])
  s.landmark('reverb', ['fx-reverb-type', 'fx-reverb-tone', 'fx-reverb-mix', 'fx-reverb-on'])
  s.landmark('layer focus controls', ['fx-focus-organ', 'fx-focus-piano', 'fx-focus-synth'])
  return s.inventory
}
