import { A1, B1 } from '../geometry'
import { Builder, type PanelData } from './builder'

/** Performance controls: exposed red chassis — master level, wheels, rotary speaker, branding. */
export function buildPerformance(data: PanelData) {
  const b = new Builder('performance', data)

  b.knob('master-level', 'Master level', A1(765, 318), { size: 15, ticks: 'none', initial: 0.72 })
  b.text('MASTER LEVEL', A1(765, 252), { size: 2.3 })

  b.wheel('mod-wheel', 'Modulation wheel', A1(310, 375), { variant: 'mod', length: 30, width: 12, angle: -13, initial: 0, spring: false })
  b.wheel('pitch-stick', 'Pitch stick', B1(509, -19), { variant: 'pitch', length: 44, width: 8, angle: -15.7, initial: 0.5, spring: true })

  // rotary speaker block (light frame, dark inside, sits on the red chassis)
  b.frame(A1(690, 425), B1(848, 395), 'well', { title: 'ROTARY SPEAKER', titleTone: 'light', titleSize: 2.3 })
  b.indicator(A1(825, 466), 'red', 'ON', 'l')
  b.knob('rotary-drive', 'Rotary speaker drive', A1(762, 525), { size: 13.5 })
  b.text('DRIVE', A1(768, 579), { size: 2.4 })
  b.button('rotary-organ', 'Rotary speaker: organ', B1(767, 72), {
    style: 'gray',
    leds: [{ p: A1(731, 611), c: 'green', on: 'on', t: 'ORGAN' }],
  })
  b.tag('rotary-close-mic', 'Rotary speaker: close mic', B1(728, 118), 'CLOSE MIC ▽', { c: 'red' })
  b.button('rotary-stop-mode', 'Rotary speaker: stop mode, angle', B1(770, 205), {
    leds: [{ p: B1(728, 160), c: 'red', on: 'on', t: 'STOP MODE' }],
  })
  b.text('ANGLE', B1(770, 240), { size: 2.4 })
  b.button('rotary-speed', 'Rotary speaker speed', B1(770, 323), {
    mode: 'cycle',
    options: ['Slow', 'Fast'],
    leds: [
      { p: B1(723, 280), c: 'green', on: 0, t: 'SLOW' },
      { p: B1(793, 280), c: 'red', on: 1, t: 'FAST' },
    ],
  })
  b.indicator(B1(735, 368), 'red', 'MORPH')

  // branding
  b.text('nord stage 4', B1(425, 338), { size: 13.4, tone: 'white', weight: 'normal', font: 'brand', spacing: -0.02 })
  b.text('H A M M E R   A C T I O N   7 3', B1(420, 390), { size: 2.1, weight: 'normal', tone: 'muted', spacing: 0.5 })
}
