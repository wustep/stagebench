import { A3, B3 } from '../geometry'
import { Builder, type PanelData } from './builder'

const EQ = ['-15', '-10', '-5', '0', '5', '10', '15']

export function buildEffects(data: PanelData) {
  const b = new Builder('effects', data)

  // header
  b.frame(A3(622, 205), A3(1118, 245), 'strip', { radius: 1 })
  b.frame(A3(622, 235), A3(1722, 265), 'strip')
  b.frame(A3(622, 265), A3(740, 292), 'strip')
  b.frame(A3(740, 265), B3(1706, 385), 'plate')
  b.text('LAYER EFFECTS', A3(768, 239), { align: 'l', size: 3.7, tone: 'dark', weight: 'black', spacing: 0.08 })
  b.text('FX FOCUS', A3(672, 276), { size: 2.2, tone: 'dark' })
  b.button('effects-on', 'Layer effects on/off', A3(1045, 235), { leds: [{ p: A3(985, 243), c: 'red', on: 'on', t: 'ON', side: 'l' }] })

  // FX focus column (on the red chassis)
  b.text('ORGAN', A3(675, 331), { size: 2.4 })
  b.button('effects-focus-organ', 'Effect focus: organ, A and B, all effects off', A3(675, 408), {
    w: 16,
    mode: 'cycle',
    options: ['A', 'B', 'A+B'],
    leds: [{ p: A3(675, 350), c: 'amber', shape: 'dot', on: 'on' }],
  })
  b.text('A B', A3(675, 370), { size: 2.4 })
  b.text('ALL FX OFF', A3(675, 444), { size: 2.3 })
  b.text('PIANO', A3(675, 495), { size: 2.4 })
  b.indicator(A3(654, 514), 'amber')
  b.indicator(A3(693, 514), 'amber')
  b.text('A', A3(654, 534), { size: 2.4 })
  b.text('B', A3(693, 534), { size: 2.4 })
  b.button('effects-focus-piano', 'Effect focus: piano, group', A3(675, 572), { w: 16 })
  b.text('GROUP ▽', A3(675, 609), { size: 2.3 })
  b.text('SYNTH', A3(673, 660), { size: 2.4 })
  b.button('effects-focus-synth', 'Effect focus: synth, group', B3(672, 158), {
    w: 16,
    mode: 'cycle',
    options: ['A', 'B', 'C'],
    leds: [
      { p: B3(636, 100), c: 'amber', on: 0 },
      { p: B3(672, 100), c: 'amber', on: 1 },
      { p: B3(709, 100), c: 'amber', on: 2 },
    ],
  })
  b.text('A', B3(636, 118), { size: 2.4 })
  b.text('B', B3(672, 118), { size: 2.4 })
  b.text('C', B3(709, 118), { size: 2.4 })
  b.text('GROUP ▽', B3(672, 194), { size: 2.3 })
  b.frame(B3(636, 245), B3(708, 384), 'light')
  b.text('SHIFT', B3(672, 258), { size: 2.4, tone: 'dark', weight: 'black' })
  b.button('effects-shift', 'Shift', B3(672, 305), { style: 'grayrocker', mode: 'momentary', w: 6, h: 14 })
  b.text('EXIT', B3(672, 371), { size: 2.4, tone: 'dark', weight: 'black' })

  // MOD 1
  b.frame(A3(743, 278), A3(1265, 455), 'line', { title: 'MOD 1', titleSize: 2.4 })
  b.knob('fx-mod1-rate', 'Modulation effect 1 rate', A3(808, 362), { size: 13.5, initial: 0.3 })
  b.indicator(A3(773, 418), 'red', 'RATE')
  b.text('SENS', A3(851, 418), { size: 2.2, tone: 'tag' })
  b.indicator(A3(773, 447), 'red', 'MST CLK')
  b.knob('fx-mod1-amount', 'Modulation effect 1 amount', A3(972, 362), { size: 13.5, initial: 0.55 })
  b.indicator(A3(931, 418), 'red', 'AMOUNT')
  b.text('RM', A3(1071, 311), { size: 2.3 })
  b.text('TREM', A3(1071, 340), { size: 2.3 })
  b.text('A-PAN', A3(1071, 370), { size: 2.3 })
  b.text('A-WAH', A3(1162, 311), { size: 2.2, tone: 'tag' })
  b.text('WAH', A3(1153, 340), { size: 2.2, tone: 'tag' })
  b.text('PUMP', A3(1158, 370), { size: 2.2, tone: 'tag' })
  b.button('fx-mod1-type', 'Modulation effect 1 type', A3(1106, 412), {
    mode: 'cycle',
    options: ['RM', 'Trem', 'A-Pan', 'A-Wah', 'Wah', 'Pump'],
    leds: [
      { p: A3(1097, 311), on: 0, shape: 'left' },
      { p: A3(1097, 340), on: 1, shape: 'left' },
      { p: A3(1097, 370), on: 2, shape: 'left' },
      { p: A3(1120, 311), on: 3, shape: 'right' },
      { p: A3(1120, 340), on: 4, shape: 'right' },
      { p: A3(1120, 370), on: 5, shape: 'right' },
    ],
  })
  b.indicator(A3(1045, 424), 'red')
  b.text('VARIATION', A3(1093, 452), { size: 2.3 })
  b.text('PED▽', A3(1160, 452), { size: 2.2, tone: 'tag' })
  b.button('fx-mod1-on', 'Modulation effect 1 on', A3(1228, 395), {
    style: 'grayrocker',
    w: 7,
    h: 16.5,
    leds: [{ p: A3(1243, 339), c: 'red', on: 'on', t: 'ON', side: 'l' }],
  })

  // MOD 2
  b.frame(A3(743, 470), A3(1265, 648), 'line', { title: 'MOD 2', titleSize: 2.4 })
  b.knob('fx-mod2-rate', 'Modulation effect 2 rate', A3(806, 552), { size: 13.5, initial: 0.75 })
  b.indicator(A3(772, 605), 'red', 'RATE')
  b.knob('fx-mod2-amount', 'Modulation effect 2 amount', A3(970, 552), { size: 13.5, initial: 0.4 })
  b.indicator(A3(931, 605), 'red', 'AMOUNT')
  b.text('CHOR', A3(1062, 492), { size: 2.3 })
  b.text('FLANG', A3(1058, 521), { size: 2.3 })
  b.text('PHAS', A3(1062, 550), { size: 2.3 })
  b.text('VIBE', A3(1148, 492), { size: 2.3 })
  b.text('ENS', A3(1146, 521), { size: 2.3 })
  b.text('SPIN', A3(1148, 550), { size: 2.3 })
  b.button('fx-mod2-type', 'Modulation effect 2 type', A3(1106, 592), {
    mode: 'cycle',
    options: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'],
    leds: [
      { p: A3(1097, 492), on: 0, shape: 'left' },
      { p: A3(1097, 521), on: 1, shape: 'left' },
      { p: A3(1097, 550), on: 2, shape: 'left' },
      { p: A3(1120, 492), on: 3, shape: 'right' },
      { p: A3(1120, 521), on: 4, shape: 'right' },
      { p: A3(1120, 550), on: 5, shape: 'right' },
    ],
  })
  b.indicator(A3(1043, 603), 'red')
  b.text('VARIATION▽', A3(1093, 630), { size: 2.3 })
  b.button('fx-mod2-on', 'Modulation effect 2 on', A3(1226, 584), {
    style: 'grayrocker',
    w: 7,
    h: 16.5,
    leds: [{ p: A3(1243, 521), c: 'red', on: 'on', t: 'ON', side: 'l' }],
  })

  // AMP SIM / EQ
  b.frame(A3(743, 648), B3(1262, 378), 'line', { title: 'AMP SIM/EQ', titleSize: 2.4 })
  b.knob('fx-amp-drive', 'Amp simulator drive', B3(812, 133), { size: 13.5, initial: 0.3 })
  b.indicator(B3(772, 200), 'red', 'DRIVE')
  b.knob('fx-amp-frequency', 'Equalizer mid frequency', B3(970, 145), {
    size: 13.5,
    initial: 0.55,
    ticks: ['200', '250', '400', '600', '1K', '2K', '4K', '6K', '8K'],
  })
  b.indicator(B3(930, 198), 'red', 'FREQ')
  b.text('FREQ', B3(966, 216), { size: 2.2, tone: 'tag' })
  b.knob('fx-eq-bass', 'Equalizer bass', B3(810, 305), { size: 13.5, min: -15, max: 15, initial: 0.55, ticks: EQ })
  b.text('BASS', B3(807, 357), { size: 2.4 })
  b.knob('fx-eq-mid', 'Equalizer mid', B3(968, 305), { size: 13.5, min: -15, max: 15, initial: 0.6, ticks: EQ })
  b.text('MID', B3(950, 357), { size: 2.4 })
  b.text('RES', B3(984, 357), { size: 2.2, tone: 'tag' })
  b.knob('fx-eq-treble', 'Equalizer treble', B3(1128, 305), { size: 13.5, min: -15, max: 15, initial: 0.47, ticks: EQ })
  b.text('TREBLE', B3(1122, 357), { size: 2.4 })
  b.text('SMALL', B3(1080, 93), { size: 2.3 })
  b.text('JC', B3(1096, 121), { size: 2.3 })
  b.text('TWIN', B3(1084, 150), { size: 2.3 })
  b.text('TO ROTARY', B3(1197, 93), { size: 2.2, tone: 'tag' })
  b.text('LP FILTER', B3(1189, 121), { size: 2.2, tone: 'tag' })
  b.text('HP FILTER', B3(1189, 150), { size: 2.2, tone: 'tag' })
  b.button('fx-amp-model', 'Amp simulator model', B3(1128, 195), {
    mode: 'cycle',
    options: ['Small', 'JC', 'Twin', 'To rotary', 'LP filter', 'HP filter'],
    leds: [
      { p: B3(1115, 93), on: 0, shape: 'left' },
      { p: B3(1115, 121), on: 1, shape: 'left' },
      { p: B3(1115, 150), on: 2, shape: 'left' },
      { p: B3(1139, 93), on: 3, shape: 'right' },
      { p: B3(1139, 121), on: 4, shape: 'right' },
      { p: B3(1139, 150), on: 5, shape: 'right' },
    ],
  })
  b.indicator(B3(1066, 204), 'red')
  b.text('VARIATION▽', B3(1118, 230), { size: 2.3 })
  b.button('fx-amp-on', 'Amp simulator and equalizer on', B3(1225, 293), {
    style: 'grayrocker',
    w: 7,
    h: 16.5,
    leds: [{ p: B3(1238, 232), c: 'red', on: 'on', t: 'ON', side: 'l' }],
  })
  b.indicator(B3(758, 96), 'red', 'ON', 'l')

  // DELAY
  b.frame(A3(1268, 278), B3(1712, 90), 'line', { title: 'DELAY', titleSize: 2.4 })
  b.knob('fx-delay-tempo', 'Delay tempo', A3(1356, 380), { size: 13.5, initial: 0.35 })
  b.indicator(A3(1315, 434), 'red', 'TEMPO')
  b.indicator(A3(1313, 462), 'red', 'MST CLK')
  b.knob('fx-delay-feedback', 'Delay feedback', A3(1620, 335), { size: 13.5, initial: 0.75 })
  b.indicator(A3(1600, 392), 'red', 'FEEDBACK')
  b.text('EFFECTS', A3(1493, 313), { size: 2.3 })
  b.text('CHOR', A3(1458, 337), { size: 2.3 })
  b.text('VIBE', A3(1463, 365), { size: 2.3 })
  b.text('ENS', A3(1465, 393), { size: 2.3 })
  b.text('FLAM', A3(1525, 351), { size: 2.3 })
  b.text('SPACE', A3(1529, 379), { size: 2.3 })
  b.button('fx-delay-effect', 'Delay effect type', A3(1493, 437), {
    mode: 'cycle',
    options: ['Off', 'Chorus', 'Vibe', 'Ensemble', 'Flanger', 'Space'],
    leds: [
      { p: A3(1493, 337), on: 1 },
      { p: A3(1493, 365), on: 2 },
      { p: A3(1493, 393), on: 3 },
    ],
  })
  b.tag('fx-delay-variation', 'Delay variation', A3(1449, 480), 'VARIATION ▽')
  b.text('FILTER', A3(1621, 421), { size: 2.3 })
  b.text('HP', A3(1606, 443), { size: 2.3 })
  b.text('BP', A3(1652, 457), { size: 2.3 })
  b.text('LP', A3(1606, 470), { size: 2.3 })
  b.button('fx-delay-filter', 'Delay filter type', A3(1630, 515), {
    mode: 'cycle',
    options: ['LP', 'BP', 'HP'],
    leds: [
      { p: A3(1630, 470), on: 0 },
      { p: A3(1630, 457), on: 1 },
      { p: A3(1630, 443), on: 2 },
    ],
  })
  b.tag('fx-delay-ping-pong', 'Delay ping pong', A3(1691, 523), 'PING PONG ▽')
  b.knob('fx-delay-dry-wet', 'Delay dry and wet', A3(1495, 580), { size: 13.5, initial: 0.4 })
  b.indicator(A3(1441, 634), 'red', 'DRY WET')
  b.frame(A3(1290, 502), A3(1410, 628), 'light')
  b.button('fx-delay-tap', 'Delay tap and set', A3(1350, 566), { mode: 'momentary', leds: [{ p: A3(1313, 522), c: 'red', on: 'held', t: 'TAP/SET▾' }] })
  b.tag('fx-delay-analog', 'Delay analog', A3(1313, 610), 'ANALOG ▽')
  b.button('fx-delay-on', 'Delay on', A3(1645, 603), { style: 'gray', leds: [{ p: A3(1581, 606), c: 'red', on: 'on', t: 'ON', side: 'l' }] })
  b.tag('fx-delay-global', 'Delay global', A3(1608, 648), 'GLOBAL ▽')

  // COMP
  b.frame(B3(1265, 90), B3(1422, 378), 'line', { title: 'COMP', titleSize: 2.4 })
  b.knob('fx-comp-amount', 'Compressor amount', B3(1350, 180), { size: 13.5, initial: 0.6 })
  b.text('AMOUNT', B3(1342, 233), { size: 2.4 })
  b.tag('fx-comp-active', 'Compressor active', B3(1295, 116), 'ACTIVE')
  b.tag('fx-comp-fast', 'Compressor fast', B3(1307, 253), 'FAST')
  b.button('fx-comp-on', 'Compressor on', B3(1347, 318), { leds: [{ p: B3(1285, 318), c: 'red', on: 'on', t: 'ON', side: 'l' }] })
  b.tag('fx-comp-global', 'Compressor global', B3(1310, 362), 'GLOBAL ▽')

  // REVERB
  b.frame(B3(1428, 90), B3(1712, 378), 'line', { title: 'REVERB', titleSize: 2.4 })
  b.tag('fx-reverb-bright', 'Reverb bright', B3(1452, 116), 'BRIGHT')
  b.tag('fx-reverb-dark', 'Reverb dark', B3(1452, 144), 'DARK')
  b.text('ROOM', B3(1575, 114), { size: 2.3 })
  b.text('BOOTH', B3(1575, 142), { size: 2.3 })
  b.text('SPRING', B3(1575, 171), { size: 2.3 })
  b.text('STAGE', B3(1671, 114), { size: 2.3 })
  b.text('HALL', B3(1671, 142), { size: 2.3 })
  b.text('CATH', B3(1671, 171), { size: 2.3 })
  b.button('fx-reverb-type', 'Reverb type', B3(1487, 187), {
    mode: 'cycle',
    options: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'],
    leds: [
      { p: B3(1607, 114), on: 0, shape: 'left' },
      { p: B3(1607, 142), on: 1, shape: 'left' },
      { p: B3(1607, 171), on: 2, shape: 'left' },
      { p: B3(1638, 114), on: 3, shape: 'right' },
      { p: B3(1638, 142), on: 4, shape: 'right' },
      { p: B3(1638, 171), on: 5, shape: 'right' },
    ],
  })
  b.button('fx-reverb-variation', 'Reverb variation and chorale', B3(1625, 215), { leds: [{ p: B3(1683, 225), c: 'red', on: 'on' }] })
  b.text('VAR|CHORALE▽', B3(1620, 251), { size: 2.3 })
  b.knob('fx-reverb-dry-wet', 'Reverb dry and wet', B3(1500, 308), { size: 13.5, initial: 0.4 })
  b.indicator(B3(1443, 362), 'red', 'DRY WET')
  b.button('fx-reverb-on', 'Reverb on', B3(1645, 318), { style: 'gray', leds: [{ p: B3(1580, 318), c: 'red', on: 'on', t: 'ON', side: 'l' }] })
  b.tag('fx-reverb-global', 'Reverb global', B3(1605, 362), 'GLOBAL ▽')

  b.text('HANDMADE IN SWEDEN BY CLAVIA DMI AB', A3(1730, 500), { size: 1.7, tone: 'white', rotate: 90, weight: 'normal' })
}
