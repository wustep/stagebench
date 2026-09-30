import { A2, B2 } from '../geometry'
import { Builder, type PanelData } from './builder'

export function buildPiano(data: PanelData) {
  const b = new Builder('piano', data)

  b.frame(A2(18, 208), A2(500, 250), 'strip', { radius: 1 })
  b.frame(A2(18, 268), B2(498, 392), 'plate')
  b.frame(A2(18, 240), A2(498, 268), 'strip')
  b.text('PIANO', A2(28, 234), { align: 'l', size: 5.4, tone: 'dark', weight: 'black', spacing: 0.25 })
  b.text('SECTION', A2(28, 255), { align: 'l', size: 2.1, tone: 'dark' })
  b.text('FX FOCUS', A2(227, 229), { size: 2.2, tone: 'dark' })
  b.indicator(A2(229, 247), 'amber', undefined, 'r', 'led-piano-fx-focus')
  b.text('ON', A2(313, 229), { size: 2.2, tone: 'dark' })
  b.button('piano-on', 'Piano section on/off', A2(375, 238), { leds: [{ p: A2(313, 248), c: 'red', on: 'on' }] })
  b.text('SOLO ▾', A2(455, 239), { size: 2.2, tone: 'dark' })

  b.fader('piano-level-a', 'Piano layer A level', A2(53, 410), 40, 0.95, 9.4)
  b.fader('piano-level-b', 'Piano layer B level', A2(172, 410), 40, 0.5, 9.4)
  b.text('A', A2(42, 567), { size: 3, weight: 'black' })
  b.text('AUX KB', A2(85, 567), { size: 2.4 })
  b.indicator(A2(124, 567), 'red')
  b.text('B', A2(158, 567), { size: 3, weight: 'black' })
  b.text('AUX KB', A2(200, 567), { size: 2.4 })
  b.indicator(A2(241, 567), 'red')
  b.button('piano-layer-a-onoff', 'Piano layer A on/off', A2(82, 640), {
    style: 'gray',
    leds: [{ p: A2(51, 595), c: 'green', on: 'on', t: 'ON/OFF ▾' }],
  })
  b.button('piano-layer-b-onoff', 'Piano layer B on/off', A2(198, 640), {
    style: 'gray',
    leds: [{ p: A2(168, 595), c: 'green', on: 'on', t: 'ON/OFF ▾' }],
  })
  b.tag('piano-sustain-pedal', 'Piano sustain pedal routing', B2(45, 102), 'SUSTPED')
  b.tag('piano-pitch-stick', 'Piano pitch stick routing', B2(162, 102), 'PSTICK')

  // acoustics / unison
  b.text('ACOUSTICS', A2(322, 299), { size: 2.4 })
  b.text('UNISON', A2(441, 299), { size: 2.4 })
  b.tag('piano-soft-release', 'Piano soft release', A2(281, 322), 'SOFT REL')
  b.tag('piano-string-res', 'Piano string resonance', A2(281, 350), 'STRING RES')
  b.button('piano-acoustics', 'Piano acoustics', A2(322, 395))
  b.button('piano-unison', 'Piano unison', A2(441, 395), {
    mode: 'cycle',
    options: ['Off', '1', '2', '3'],
    leds: [
      { p: A2(440, 350), on: 1 },
      { p: A2(440, 322), on: 2 },
      { p: A2(440, 336), on: 3 },
    ],
  })
  b.text('2', A2(421, 322), { size: 2.4 })
  b.text('3', A2(459, 336), { size: 2.4 })
  b.text('1', A2(421, 350), { size: 2.4 })
  b.tag('piano-ped-noise', 'Piano pedal noise', A2(281, 438), 'PED NOISE ▽')

  // KB touch / dyn comp
  b.text('KB TOUCH', A2(322, 470), { size: 2.4 })
  b.text('DYN COMP', A2(441, 470), { size: 2.4 })
  b.button('piano-kb-touch', 'Piano keyboard touch', A2(322, 565), {
    mode: 'cycle',
    options: ['Medium', 'Light', 'Heavy'],
    leds: [
      { p: A2(323, 494), on: 0, t: 'MED', side: 'l' },
      { p: A2(323, 507), on: 1, t: 'LIGHT', side: 'r' },
      { p: A2(323, 521), on: 2, t: 'HEAVY', side: 'l' },
    ],
  })
  b.button('piano-dyn-comp', 'Piano dynamic compression', A2(441, 565), {
    mode: 'cycle',
    options: ['Off', '1', '2', '3'],
    leds: [
      { p: A2(440, 522), on: 1 },
      { p: A2(440, 494), on: 2 },
      { p: A2(440, 508), on: 3 },
    ],
  })
  b.text('2', A2(421, 494), { size: 2.4 })
  b.text('3', A2(459, 508), { size: 2.4 })
  b.text('1', A2(421, 522), { size: 2.4 })

  // timbre
  b.text('TIMBRE', B2(166, 144), { size: 2.4 })
  b.button('piano-timbre', 'Piano timbre', B2(70, 190), {
    style: 'rocker',
    mode: 'cycle',
    options: ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'],
    leds: [
      { p: B2(167, 167), on: 3, t: 'BRIGHT', side: 'l' },
      { p: B2(167, 181), on: 4, t: 'DYNO1', side: 'r' },
      { p: B2(167, 195), on: 2, t: 'MID', side: 'l' },
      { p: B2(167, 209), on: 5, t: 'DYNO2', side: 'r' },
      { p: B2(167, 223), on: 1, t: 'SOFT', side: 'l' },
    ],
  })

  b.text('◄ OCTAVE SHIFT ►', B2(140, 273), { size: 2.3 })
  b.button('piano-octave-down', 'Piano octave shift down', B2(93, 313), { mode: 'momentary' })
  b.button('piano-octave-up', 'Piano octave shift up', B2(182, 313), { mode: 'momentary' })
  b.text('◄ KB ZONE ►', B2(140, 347), { size: 2.3 })
  for (const [i, x] of [97, 125, 153, 181].entries()) b.indicator(B2(x, 370), 'green', undefined, 'r', `led-piano-zone-${i + 1}`)

  // piano select
  b.frame(B2(282, 35), B2(485, 380), 'line', { title: 'PIANO SELECT', titleSize: 2.3 })
  b.text('ELECTRIC', B2(323, 65), { size: 2.4 })
  b.text('UPRIGHT', B2(323, 94), { size: 2.4 })
  b.text('GRAND', B2(330, 123), { size: 2.4 })
  b.text('CLAV', B2(428, 65), { size: 2.4 })
  b.text('DIGITAL', B2(438, 94), { size: 2.4 })
  b.text('MISC', B2(428, 123), { size: 2.4 })
  b.button('piano-select', 'Piano type', B2(383, 165), {
    mode: 'cycle',
    options: ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'],
    leds: [
      { p: B2(374, 123), on: 0, shape: 'left' },
      { p: B2(374, 94), on: 1, shape: 'left' },
      { p: B2(374, 65), on: 2, shape: 'left' },
      { p: B2(394, 65), on: 3, shape: 'right' },
      { p: B2(394, 94), on: 4, shape: 'right' },
      { p: B2(394, 123), on: 5, shape: 'right' },
    ],
  })
  b.text('INFO', B2(383, 202), { size: 2.4 })
  b.encoder('piano-model-dial', 'Piano model dial', B2(383, 303), 11.6)
  b.text('MODEL', B2(357, 356), { size: 2.4 })
  b.text('LIST', B2(410, 356), { size: 2.2, tone: 'tag' })
}
