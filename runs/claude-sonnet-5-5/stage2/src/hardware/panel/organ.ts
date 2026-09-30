import { A1, B1 } from '../geometry'
import { Builder, type PanelData } from './builder'

const DRAWBAR_LABELS: Array<{ top: [string, string]; bottom: string; tone: 'black' | 'white'; initial: number; name: string }> = [
  { top: ['BASS16', "16'"], bottom: "16'", tone: 'black', initial: 7, name: "16'" },
  { top: ['STR16', "8'"], bottom: "5⅓'", tone: 'black', initial: 3, name: "5 1/3'" },
  { top: ['FLUTE8', "4'"], bottom: "8'", tone: 'white', initial: 8, name: "8'" },
  { top: ['OBOE8', "2'"], bottom: "4'", tone: 'white', initial: 4, name: "4'" },
  { top: ['TRMP8', 'II'], bottom: "2⅔'", tone: 'black', initial: 3, name: "2 2/3'" },
  { top: ['STR8', 'III'], bottom: "2'", tone: 'white', initial: 4, name: "2'" },
  { top: ['FLUTE4', 'IV'], bottom: "1³/₅'", tone: 'black', initial: 7, name: "1 3/5'" },
  { top: ['STR4', ''], bottom: "1⅓'", tone: 'black', initial: 3, name: "1 1/3'" },
  { top: ['2 2/3', '∿–∿'], bottom: "1'", tone: 'white', initial: 5, name: "1'" },
]

export function buildOrgan(data: PanelData) {
  const b = new Builder('organ', data)

  // plate + header
  b.frame(A1(842, 210), A1(1315, 250), 'strip', { radius: 1 })
  b.frame(A1(842, 245), A1(1972, 272), 'strip')
  b.frame(A1(842, 272), B1(1975, 392), 'plate')
  b.text('ORGAN', A1(853, 236), { align: 'l', size: 5.4, tone: 'dark', weight: 'black', spacing: 0.25 })
  b.text('SECTION', A1(853, 256), { align: 'l', size: 2.1, tone: 'dark' })
  b.text('FX FOCUS', A1(1051, 231), { size: 2.2, tone: 'dark' })
  b.indicator(A1(1051, 249), 'amber')
  b.text('ON', A1(1134, 230), { size: 2.2, tone: 'dark' })
  b.button('organ-on', 'Organ section on/off', A1(1195, 240), { leds: [{ p: A1(1135, 249), c: 'red', on: 'on' }] })
  b.text('SOLO ▾', A1(1270, 241), { size: 2.2, tone: 'dark' })

  // layer level faders
  b.fader('organ-level-a', 'Organ layer A level', A1(880, 410), 40, 0.7, 9.2)
  b.fader('organ-level-b', 'Organ layer B level', A1(995, 410), 40, 0.5, 9.4)
  b.text('A', A1(866, 569), { size: 3, weight: 'black' })
  b.text('AUX KB', A1(908, 569), { size: 2.4 })
  b.indicator(A1(947, 569), 'red')
  b.text('B', A1(982, 569), { size: 3, weight: 'black' })
  b.text('AUX KB', A1(1024, 569), { size: 2.4 })
  b.indicator(A1(1065, 569), 'red')
  b.button('organ-layer-a-onoff', 'Organ layer A on/off', A1(905, 640), {
    style: 'gray',
    leds: [{ p: A1(876, 597), c: 'green', on: 'on', t: 'ON/OFF ▾' }],
  })
  b.button('organ-layer-b-onoff', 'Organ layer B on/off', A1(1020, 640), {
    style: 'gray',
    leds: [{ p: A1(993, 597), c: 'green', on: 'on', t: 'ON/OFF ▾' }],
  })
  b.tag('organ-sustain-pedal', 'Organ sustain pedal', B1(870, 104), 'SUSTPED')
  b.tag('organ-pitch-stick', 'Organ pitch stick', B1(988, 104), 'PSTICK')

  // preset / sync / octave / zone
  b.button('organ-preset-sync', 'Organ preset and sync', B1(965, 207), {
    leds: [{ p: B1(935, 163), c: 'red', on: 'on', t: 'PRESET' }],
  })
  b.text('SYNC ▽', B1(965, 242), { size: 2.4 })
  b.text('◄ OCTAVE SHIFT ►', B1(965, 275), { size: 2.3 })
  b.button('organ-octave-down', 'Organ octave shift down', B1(918, 313), { mode: 'momentary' })
  b.button('organ-octave-up', 'Organ octave shift up', B1(1010, 313), { mode: 'momentary' })
  b.text('◄ KB ZONE ►', B1(965, 349), { size: 2.3 })
  for (const x of [925, 953, 981, 1009]) b.indicator(B1(x, 372), 'green')

  // organ model
  b.frame(A1(1118, 298), A1(1310, 512), 'line', { title: 'ORGAN MODEL', titleSize: 2.3 })
  b.text('FARF', A1(1170, 355), { size: 2.4 })
  b.text('VOX', A1(1171, 384), { size: 2.4 })
  b.text('B3', A1(1175, 413), { size: 2.4 })
  b.text('PIPE1', A1(1259, 355), { size: 2.4 })
  b.text('PIPE2', A1(1259, 384), { size: 2.4 })
  b.text('B3', A1(1246, 406), { size: 2.4, align: 'l' })
  b.text('BASS', A1(1246, 421), { size: 2.4, align: 'l' })
  b.button('organ-model', 'Organ model', A1(1210, 460), {
    mode: 'cycle',
    options: ['B3', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2', 'B3 Bass'],
    leds: [
      { p: A1(1203, 413), on: 0, shape: 'left' },
      { p: A1(1203, 384), on: 1, shape: 'left' },
      { p: A1(1203, 355), on: 2, shape: 'left' },
      { p: A1(1220, 355), on: 3, shape: 'right' },
      { p: A1(1220, 384), on: 4, shape: 'right' },
      { p: A1(1220, 413), on: 5, shape: 'right' },
    ],
  })

  // vib / chorus
  b.frame(A1(1310, 298), A1(1577, 512), 'line', { title: 'VIB/CHORUS', titleSize: 2.3 })
  b.text('C2', A1(1468, 342), { size: 2.2 })
  b.text('V3', A1(1497, 342), { size: 2.2 })
  b.text('C3', A1(1525, 342), { size: 2.2 })
  b.text('V2', A1(1468, 407), { size: 2.2 })
  b.text('C1', A1(1497, 407), { size: 2.2 })
  b.text('V1', A1(1525, 407), { size: 2.2 })
  b.button('organ-vib-chorus-mode', 'Organ vibrato and chorus type', A1(1393, 373), {
    mode: 'cycle',
    options: ['V1', 'C1', 'V2', 'C2', 'V3', 'C3'],
    leds: [
      { p: A1(1525, 384), on: 0, shape: 'down' },
      { p: A1(1497, 384), on: 1, shape: 'down' },
      { p: A1(1468, 384), on: 2, shape: 'down' },
      { p: A1(1468, 367), on: 3, shape: 'up' },
      { p: A1(1497, 367), on: 4, shape: 'up' },
      { p: A1(1525, 367), on: 5, shape: 'up' },
    ],
  })
  b.button('organ-vib-chorus-on', 'Organ vibrato and chorus on', A1(1443, 472), {
    style: 'gray',
    leds: [{ p: A1(1387, 481), c: 'red', on: 'on', t: 'ON', side: 'l' }],
  })

  // B3 percussion
  b.frame(A1(1577, 298), A1(1945, 512), 'line', { title: 'B3 PERCUSSION', titleSize: 2.3 })
  b.text('VOLUME', A1(1653, 319), { size: 2.3 })
  b.text('DECAY', A1(1760, 319), { size: 2.3 })
  b.text('HARMONIC', A1(1866, 319), { size: 2.3 })
  b.button('organ-perc-volume', 'B3 percussion volume', A1(1652, 384), { leds: [{ p: A1(1617, 341), on: 'on', t: 'SOFT' }] })
  b.button('organ-perc-decay', 'B3 percussion decay', A1(1760, 384), { leds: [{ p: A1(1723, 341), on: 'on', t: 'FAST' }] })
  b.button('organ-perc-harmonic', 'B3 percussion harmonic', A1(1866, 384), { leds: [{ p: A1(1831, 341), on: 'on', t: 'THIRD' }] })
  b.tag('organ-perc-poly', 'B3 percussion polyphonic', A1(1617, 430), 'POLY ▽')
  b.button('organ-perc-on', 'B3 percussion on', A1(1867, 472), {
    style: 'gray',
    leds: [{ p: A1(1808, 481), c: 'red', on: 'on', t: 'ON', side: 'l' }],
  })

  // drawbars
  DRAWBAR_LABELS.forEach((d, i) => {
    const capX = 1117 + 97.2 * i
    b.drawbar(`organ-drawbar-${i + 1}`, `Organ drawbar ${d.name}`, B1(capX, 40), 41.6, d.tone, d.initial)
    b.text(d.top[0], A1(capX + 38, 538), { size: 2.1 })
    if (d.top[1]) b.text(d.top[1], A1(capX + 38, 554), { size: 2.1 })
    b.text(d.bottom, B1(capX + 3, 379), { size: 2.6 })
  })
}
