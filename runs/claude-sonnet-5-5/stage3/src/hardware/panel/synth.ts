import { A2, A3, B2, B3, SA, SB, SC } from '../geometry'
import { Builder, type PanelData } from './builder'

const SIGNED = ['-10', '-5', '0', '5', '10']

export function buildSynth(data: PanelData) {
  const b = new Builder('synth', data)

  // plate and header
  b.frame(A2(1245, 208), A2(1840, 250), 'strip', { radius: 1 })
  b.frame(A2(1245, 240), SA(1262, 405), 'strip')
  b.frame(A2(1245, 268), B3(608, 385), 'plate')
  b.text('SYNTH', A2(1257, 232), { align: 'l', size: 5.4, tone: 'dark', weight: 'black', spacing: 0.25 })
  b.text('SECTION', A2(1257, 252), { align: 'l', size: 2.1, tone: 'dark' })
  b.text('FX FOCUS', A2(1577, 227), { size: 2.2, tone: 'dark' })
  b.indicator(A2(1577, 247), 'amber', undefined, 'r', 'led-synth-fx-focus')
  b.text('ON', A2(1660, 227), { size: 2.2, tone: 'dark' })
  b.button('synth-on', 'Synth section on/off', A2(1721, 237), { leds: [{ p: A2(1660, 247), c: 'red', on: 'on' }] })
  b.text('SOLO ▾', A2(1800, 237), { size: 2.2, tone: 'dark' })

  // layer faders A/B/C
  b.fader('synth-level-a', 'Synth layer A level', A2(1285, 410), 40, 0.95, 9.2)
  b.fader('synth-level-b', 'Synth layer B level', A2(1402, 410), 40, 0.25, 9.2)
  b.fader('synth-level-c', 'Synth layer C level', A2(1520, 410), 40, 0.72, 9.2)
  ;[
    ['A', 1270, 1312, 1352, 1310, 1279],
    ['B', 1387, 1428, 1468, 1427, 1397],
    ['C', 1503, 1545, 1585, 1543, 1513],
  ].forEach(([n, lx, tx, ledX, bx, onX]) => {
    b.text(String(n), A2(Number(lx), 565), { size: 3, weight: 'black' })
    b.text('AUX KB', A2(Number(tx), 565), { size: 2.4 })
    b.indicator(A2(Number(ledX), 565), 'red')
    b.button(`synth-layer-${String(n).toLowerCase()}-onoff`, `Synth layer ${n} on/off`, A2(Number(bx), 640), {
      style: 'gray',
      leds: [{ p: A2(Number(onX), 593), c: 'amber', on: 'on', t: 'ON/OFF ▾' }],
    })
  })
  b.tag('synth-sustain-pedal', 'Synth sustain pedal routing', B2(1273, 100), 'SUSTPED')
  b.tag('synth-pitch-stick-range', 'Synth pitch stick routing and range', B2(1378, 100), 'PSTICK/RNG▾')
  b.text('PAN ▾', B2(1543, 90), { size: 2.4 })

  b.button('synth-kb-hold', 'Synth keyboard hold', B2(1310, 190), { leds: [{ p: B2(1273, 148), c: 'red', on: 'on', t: 'KB HOLD' }] })
  b.tag('synth-exclude', 'Synth exclude', B2(1267, 236), 'EXCLUDE ▽')
  b.button('synth-arp-run', 'Arpeggiator run', B2(1427, 190), { style: 'red', leds: [{ p: B2(1390, 148), c: 'red', on: 'on', t: 'ARP RUN' }] })
  b.tag('synth-kb-sync', 'Synth keyboard sync', B2(1390, 236), 'KB SYNC ▽')
  b.text('◄ OCTAVE SHIFT ►', B2(1368, 272), { size: 2.3 })
  b.button('synth-octave-down', 'Synth octave shift down', B2(1323, 310), { mode: 'momentary' })
  b.button('synth-octave-up', 'Synth octave shift up', B2(1413, 310), { mode: 'momentary' })
  b.text('◄ KB ZONE ►', B2(1368, 346), { size: 2.3 })
  for (const [i, x] of [1327, 1355, 1383, 1411].entries()) b.indicator(B2(x, 368), 'green', undefined, 'r', `led-synth-zone-${i + 1}`)

  // knobs under the synth OLED
  b.encoder('synth-info-dial', 'Synth info dial', B2(1690, 30), 12.5)
  b.text('INFO', B2(1691, 84), { size: 2.4 })
  b.encoder('synth-list-dial-1', 'Synth list dial 1', B2(1848, 35), 12.5)
  b.text('LIST', B2(1848, 84), { size: 2.4 })
  b.encoder('synth-list-dial-2', 'Synth list dial 2', SB(260, 115), 12.5)
  b.text('LIST', SB(260, 195), { size: 2.4 })

  // mode
  b.frame(SA(310, 425), SA(500, 680), 'light', { title: 'MODE', titleTone: 'light', titleSize: 2.4 })
  b.button('synth-mode', 'Synth oscillator mode', SA(405, 585), {
    mode: 'cycle',
    options: ['Samples', 'Analog', 'Extern'],
    leds: [
      { p: SA(349, 476), c: 'red', on: 0, t: 'SAMPLES', side: 'r' },
      { p: SA(349, 519), c: 'red', on: 1, t: 'ANALOG', side: 'r' },
      { p: SA(346, 651), c: 'red', on: 2, t: 'EXTERN', side: 'r' },
    ],
  })
  b.text('WAVEFORM', SA(413, 728), { size: 2.4 })
  b.tag('synth-keep-edits', 'Synth keep edits', SA(378, 757), 'KEEP EDITS▾')
  b.button('synth-waveform', 'Synth waveform', SB(437, 55), { style: 'rocker', rim: true, w: 8, h: 17 })
  b.text('SOUND', SB(437, 148), { size: 2.5 })
  b.text('INIT', SB(437, 169), { size: 2.5 })

  // arpeggiator / gate
  b.frame(SA(527, 428), SA(1250, 720), 'line', { title: 'ARPEGGIATOR/GATE', titleSize: 2.4 })
  b.knob('synth-arp-rate', 'Arpeggiator rate and time', SA(620, 540), { size: 14 })
  b.indicator(SA(571, 630), 'red', 'RATE/TIME')
  b.indicator(SA(569, 672), 'red', 'MST CLK', 'r', 'led-synth-arp-clk')
  b.button('synth-arp-mode', 'Arpeggiator or gate mode', SA(818, 605), {
    mode: 'cycle',
    options: ['Gate', 'Arp', 'Poly gate'],
    leds: [
      { p: SA(818, 540), c: 'red', on: 1, t: 'ARP', side: 'l' },
      { p: SA(818, 497), c: 'red', on: 2, t: 'POLY', side: 'l' },
    ],
  })
  b.text('GATE', SA(868, 519), { size: 2.2, tone: 'tag' })
  b.tag('synth-arp-pattern', 'Arpeggiator pattern', SA(754, 672), 'PATTERN ▽')
  b.knob('synth-arp-range', 'Arpeggiator range', SA(1018, 548), { size: 14, ticks: ['0', '1', '2', '3', '4', '10'], ringTone: 'dark' })
  b.indicator(SA(946, 630), 'red', 'RANGE')
  b.text('ENV', SA(1064, 630), { size: 2.2, tone: 'tag' })
  b.tag('synth-arp-menu', 'Arpeggiator menu', SA(1141, 478), 'MENU')
  b.button('synth-arp-group-rocker', 'Arpeggiator group', SA(1180, 575), { style: 'rocker', rim: true, w: 7, h: 17 })
  b.tag('synth-arp-group', 'Arpeggiator group select', SA(1122, 675), 'GROUP ▽')

  // voice
  b.frame(A3(118, 482), A3(385, 667), 'line', { title: 'VOICE', titleSize: 2.4 })
  b.button('synth-voice-mode', 'Synth voice mode', A3(180, 603), {
    mode: 'cycle',
    options: ['Poly', 'Mono', 'Legato'],
    leds: [
      { p: A3(144, 531), c: 'red', on: 1, t: 'MONO', side: 'r' },
      { p: A3(144, 560), c: 'red', on: 2, t: 'LEGATO', side: 'r' },
    ],
  })
  b.tag('synth-voice-lo', 'Synth voice low priority', A3(142, 648), 'LO ▽')
  b.tag('synth-voice-hi', 'Synth voice high priority', A3(196, 648), 'HI ▽')
  b.knob('synth-glide', 'Synth glide', A3(313, 566), { size: 12.5 })
  b.text('GLIDE', A3(311, 620), { size: 2.4 })

  // vibrato
  b.frame(A3(388, 482), A3(598, 667), 'line', { title: 'VIBRATO', titleSize: 2.4 })
  b.button('synth-vibrato-source', 'Synth vibrato source', A3(454, 607), {
    mode: 'cycle',
    options: ['Off', 'Wheel', 'Delay', 'On'],
    leds: [
      { p: A3(454, 510), c: 'red', on: 1, t: 'WHL', side: 'l' },
      { p: A3(454, 538), c: 'red', on: 2, t: 'DLY', side: 'l' },
      { p: A3(454, 566), c: 'red', on: 3, t: 'ON', side: 'l' },
    ],
  })
  b.text('A.T.', A3(485, 524), { size: 2.3 })
  b.text('PED', A3(485, 552), { size: 2.3 })
  b.tag('synth-vibrato-menu', 'Synth vibrato menu', A3(526, 527), 'MENU')
  b.button('synth-vibrato-rocker', 'Synth vibrato amount', A3(551, 590), { style: 'rocker', rim: true, w: 7, h: 17 })

  // LFO
  b.frame(B2(1500, 108), B2(1800, 383), 'light', { title: 'LFO', titleTone: 'light', titleSize: 2.4 })
  b.indicator(B2(1523, 126), 'red', 'WAVEFORM')
  b.button('synth-lfo-waveform', 'LFO waveform', B2(1565, 170), { rim: true })
  b.tag('synth-lfo-group', 'LFO group', B2(1519, 213), 'GROUP ▽')
  b.knob('synth-lfo-rate', 'LFO rate and time', B2(1575, 282), { size: 14 })
  b.indicator(B2(1543, 364), 'red', 'MST CLK', 'r', 'led-synth-lfo-clk')
  b.knob('synth-lfo-amount', 'LFO modulation amount', B2(1723, 180), { size: 13 })
  b.indicator(B2(1686, 234), 'red', 'MOD AMT')
  b.button('synth-lfo-destination', 'LFO destination', B2(1722, 349), {
    mode: 'cycle',
    options: ['Osc pitch', 'Filter', 'Osc control', 'Off'],
    leds: [
      { p: B2(1723, 277), c: 'red', on: 0, t: 'OSC PITCH', side: 'l' },
      { p: B2(1723, 291), c: 'red', on: 1, t: 'FILTER', side: 'r' },
      { p: B2(1723, 305), c: 'red', on: 2, t: 'OSC CTRL', side: 'l' },
    ],
  })

  // oscillators
  b.frame(B2(1805, 108), B2(2120, 383), 'light', { title: 'OSCILLATORS', titleTone: 'light', titleSize: 2.4 })
  b.indicator(SB(18, 267), 'red', 'PITCH/SMP')
  b.button('synth-osc-pitch', 'Oscillator pitch and sample', SB(72, 330), { rim: true })
  b.tag('synth-osc-env-to-pitch', 'Oscillator envelope to pitch', SB(5, 398), 'ENV TO PITCH ▽')
  b.knob('synth-osc-control', 'Oscillator control', SB(72, 528), { size: 13.5 })
  b.indicator(SB(10, 608), 'red', 'OSC CTRL')
  b.indicator(SB(262, 267), 'red', 'ENVELOPE')
  b.button('synth-osc-envelope', 'Oscillator envelope', SB(318, 330), { rim: true })
  b.tag('synth-osc-velocity', 'Oscillator velocity', SB(262, 398), 'VELOCITY ▽')
  b.knob('synth-osc-env-amount', 'Oscillator envelope amount', SB(318, 527), { size: 13.5, min: -10, max: 10, initial: 0.75, ticks: SIGNED })
  b.indicator(SB(262, 608), 'red', 'ENV AMT')

  // filter
  b.frame(SC(355, 230), SC(940, 645), 'light', { title: 'FILTER', titleTone: 'light', titleSize: 2.4 })
  b.indicator(SC(400, 266), 'red', 'TYPE')
  b.button('synth-filter-type', 'Filter type', SC(447, 330), { rim: true })
  b.tag('synth-filter-group', 'Filter group', SC(393, 398), 'GROUP ▽')
  b.indicator(SC(595, 266), 'red', 'ENVELOPE')
  b.button('synth-filter-envelope', 'Filter envelope', SC(650, 330), { rim: true })
  b.tag('synth-filter-velocity', 'Filter velocity', SC(595, 398), 'VELOCITY ▽')
  b.knob('synth-filter-env-amount', 'Filter envelope amount', SC(852, 320), { size: 13.5, initial: 0.55 })
  b.indicator(SC(793, 400), 'red', 'ENV AMT')
  b.frame(SC(390, 435), SC(572, 628), 'well', { radius: 6 })
  b.knob('synth-filter-frequency', 'Filter frequency', SC(482, 527), { size: 14, initial: 0.3 })
  b.indicator(SC(427, 607), 'red', 'FREQ')
  b.knob('synth-filter-resonance', 'Filter resonance', SC(730, 527), { size: 14, initial: 0.5 })
  b.indicator(SC(647, 607), 'red', 'RES/FREQ HP')
  b.text('FILTER', SC(878, 445), { size: 2.4 })
  b.button('synth-filter-on', 'Filter on', SC(878, 560), { style: 'rocker', w: 7, h: 17, leds: [{ p: SC(847, 472), c: 'red', on: 'on', t: 'ON', side: 'r' }] })

  // amp
  b.frame(SC(962, 230), SC(1145, 432), 'light', { title: 'AMP', titleTone: 'light', titleSize: 2.4 })
  b.indicator(SC(990, 265), 'red', 'ENVELOPE')
  b.button('synth-amp-envelope', 'Amp envelope velocity', SC(1053, 330), {
    rim: true,
    mode: 'cycle',
    options: ['Off', '1', '2', '3'],
    leds: [
      { p: SC(1015, 413), c: 'red', on: [1, 3] },
      { p: SC(1096, 413), c: 'red', on: [2, 3] },
    ],
  })
  b.text('VELOCITY ▽', SC(1055, 388), { size: 2.3, tone: 'dark' })
  b.text('1', SC(992, 413), { size: 2.4, tone: 'dark' })
  b.text('2', SC(1070, 413), { size: 2.4, tone: 'dark' })

  // unison
  b.frame(SC(962, 455), SC(1145, 640), 'line', { title: 'UNISON', titleSize: 2.4 })
  b.button('synth-unison', 'Synth unison', SC(1052, 595), {
    mode: 'cycle',
    options: ['Off', '1', '2', '3'],
    leds: [
      { p: SC(1053, 529), c: 'red', on: 1 },
      { p: SC(1053, 487), c: 'red', on: 2 },
      { p: SC(1053, 508), c: 'red', on: 3 },
    ],
  })
  b.text('2', SC(1024, 487), { size: 2.4 })
  b.text('3', SC(1081, 508), { size: 2.4 })
  b.text('1', SC(1024, 529), { size: 2.4 })
}
