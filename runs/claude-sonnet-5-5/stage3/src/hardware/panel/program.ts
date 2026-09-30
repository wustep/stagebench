import { A2, B2 } from '../geometry'
import { Builder, type PanelData } from './builder'

/** Program and morph: red chassis with a few dark groups; the only primary OLED of the deck lives here. */
export function buildProgram(data: PanelData) {
  const b = new Builder('program', data)

  // morph assign
  b.frame(A2(537, 212), A2(832, 336), 'plate')
  b.frame(A2(537, 212), A2(832, 232), 'strip')
  b.text('MORPH ASSIGN', A2(685, 222), { size: 2.5, tone: 'dark', weight: 'black' })
  b.button('program-morph-wheel', 'Morph assign: wheel', A2(594, 292), { leds: [{ p: A2(559, 248), c: 'green', on: 'on', t: 'WHEEL▾' }] })
  b.button('program-morph-at', 'Morph assign: aftertouch', A2(684, 292), { leds: [{ p: A2(653, 248), c: 'red', on: 'on', t: 'A.T.▾' }] })
  b.button('program-morph-ctrlped', 'Morph assign: control pedal', A2(774, 292), { leds: [{ p: A2(737, 248), c: 'red', on: 'on', t: 'CTRLPED▾' }] })
  b.text('CLEAR MORPH', A2(685, 327), { size: 2.4 })

  // split
  b.frame(A2(862, 212), A2(962, 232), 'strip')
  b.text('SPLIT', A2(912, 222), { size: 2.5, tone: 'dark', weight: 'black' })
  b.indicator(A2(874, 247), 'red')
  b.indicator(A2(951, 247), 'red')
  b.text('ON/SET▾', A2(912, 270), { size: 2.3 })
  b.button('program-split', 'Split on/set', A2(912, 305), { style: 'dark', leds: [{ p: A2(912, 247), c: 'amber', on: 'on' }] })
  b.text('SET KEY', A2(912, 341), { size: 2.3 })

  // master clock
  b.frame(A2(989, 212), A2(1092, 232), 'strip')
  b.text('MST CLK', A2(1040, 222), { size: 2.5, tone: 'dark', weight: 'black' })
  b.button('program-master-clock-tap', 'Master clock tap and set', A2(1040, 290), { mode: 'momentary', leds: [{ p: A2(997, 247), c: 'red', on: 'held', t: 'TAP/SET▾' }] })
  b.tag('program-pedal-tap', 'Master clock pedal tap', A2(1003, 335), 'PEDAL TAP')

  // transpose
  b.frame(A2(1118, 212), A2(1217, 232), 'strip')
  b.text('TRANSP', A2(1167, 222), { size: 2.5, tone: 'dark', weight: 'black' })
  b.button('program-transpose', 'Transpose on/set', A2(1167, 290), { leds: [{ p: A2(1125, 247), c: 'red', on: 'on', t: 'ON/SET▾' }] })
  b.text('PANIC', A2(1167, 326), { size: 2.3 })
  b.text('PROG VIEW', A2(1167, 357), { size: 2.3 })
  b.button('program-prog-view', 'Program view', A2(1167, 395), { mode: 'momentary' })
  b.text('PRESET NAME', A2(1167, 430), { size: 2.3 })

  // store
  b.button('program-store', 'Store', A2(598, 420), {
    style: 'red',
    mode: 'momentary',
    leds: [{ p: A2(562, 376), c: 'red', on: 'held', t: 'STORE' }],
  })
  b.text('STORE AS...', A2(599, 455), { size: 2.2 })
  b.text('PAGE NAME', A2(599, 470), { size: 2.2, tone: 'red' })
  b.text('MIDI', A2(692, 390), { size: 2.2 })
  b.indicator(A2(692, 413), 'green')
  b.text('EXTERN', A2(692, 443), { size: 2.2 })
  b.indicator(A2(692, 463), 'green')

  // preset library
  b.frame(A2(740, 370), A2(1035, 480), 'plate')
  b.frame(A2(740, 370), A2(1035, 390), 'strip')
  b.text('PRESET LIBRARY', A2(887, 380), { size: 2.5, tone: 'dark', weight: 'black' })
  b.button('program-library-organ', 'Preset library: organ', A2(796, 435), { leds: [{ p: A2(762, 407), c: 'red', on: 'on', t: 'ORGAN' }] })
  b.button('program-library-piano', 'Preset library: piano', A2(887, 435), { leds: [{ p: A2(851, 407), c: 'red', on: 'on', t: 'PIANO' }] })
  b.button('program-library-synth', 'Preset library: synth', A2(977, 435), { leds: [{ p: A2(940, 407), c: 'red', on: 'on', t: 'SYNTH' }] })
  b.text('SINGLE LAYER', A2(933, 470), { size: 2.3 })

  // program dial + paging
  b.encoder('program-dial', 'Program dial', A2(617, 547), 11.8)
  b.text('PROGRAM', A2(590, 600), { size: 2.4 })
  b.text('LIST', A2(658, 600), { size: 2.2, tone: 'tag' })
  b.text('◄ PAGE/CAT ►', B2(617, 47), { size: 2.3 })
  b.button('program-page-prev', 'Page category previous', B2(570, 86), { mode: 'momentary' })
  b.button('program-page-next', 'Page category next', B2(660, 86), { mode: 'momentary' })
  b.text('◄  BANK  ►', B2(617, 121), { size: 2.3 })

  b.button('program-live-mode', 'Live mode', B2(597, 196), { style: 'gray', leds: [{ p: B2(554, 152), c: 'red', on: 'on', t: 'LIVE MODE' }] })
  b.indicator(B2(561, 240), 'red', 'NUM PAD')

  // layer scene
  b.frame(B2(545, 266), B2(653, 382), 'plate')
  b.button('program-layer-scene', 'Layer scene II', B2(597, 327), { leds: [{ p: B2(561, 283), c: 'red', on: 'on' }] })
  b.text('LAYER', B2(613, 277), { size: 2.2, align: 'l' })
  b.text('SCENE II', B2(613, 291), { size: 2.2, align: 'l' })
  b.indicator(B2(561, 370), 'red', 'PEDAL')

  // program buttons 1-8
  b.frame(B2(687, 152), B2(1092, 382), 'light', { title: 'PROGRAM', titleSize: 2.6 })
  const xs = [743, 841, 937, 1034]
  const topLabels = ['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB']
  const botLabels = ['OUTPUT', 'PEDAL', 'MIDI', 'EXTERN']
  xs.forEach((x, i) => {
    b.button(`program-button-${i + 1}`, `Program button ${i + 1}: ${topLabels[i].toLowerCase()}`, B2(x, 233), {
      mode: 'momentary',
      leds: [{ p: B2(x + 1, 189), c: 'red', on: [1], t: String(i + 1), side: 'r' }],
    })
    b.text(topLabels[i], B2(x, 268), { size: 2.3, tone: 'dark' })
    b.button(`program-button-${i + 5}`, `Program button ${i + 5}: ${botLabels[i].toLowerCase()}`, B2(x, 335), {
      mode: 'momentary',
      leds: [{ p: B2(x + 1, 290), c: 'red', on: [1], t: String(i + 5), side: 'r' }],
    })
    b.text(botLabels[i], B2(x, 369), { size: 2.3, tone: 'dark' })
  })

  // solo / undo / section edit / copy
  b.frame(A2(1110, 457), B2(1222, 215), 'rim', { radius: 2 })
  b.button('program-solo', 'Solo', A2(1167, 517), { leds: [{ p: A2(1135, 474), c: 'red', on: 'on', t: 'SOLO' }] })
  b.text('UNDO', A2(1167, 553), { size: 2.3 })
  b.text('SECTION', A2(1167, 588), { size: 2.2 })
  b.text('EDIT ⬇', A2(1167, 602), { size: 2.2 })
  b.indicator(A2(1127, 594), 'red')
  b.button('program-section-edit', 'Section edit', B2(1167, 58), { mode: 'momentary' })
  b.text('LAYER INIT', B2(1167, 93), { size: 2.2 })
  b.text('MON/COPY', B2(1167, 128), { size: 2.2 })
  b.button('program-copy', 'Copy', B2(1167, 163), { mode: 'momentary' })
  b.text('PASTE ⬇', B2(1167, 200), { size: 2.2 })

  // shift / exit
  b.frame(B2(1141, 240), B2(1213, 383), 'light')
  b.text('SHIFT', B2(1177, 254), { size: 2.4, tone: 'dark', weight: 'black' })
  b.button('program-shift', 'Shift', B2(1177, 310), { style: 'grayrocker', mode: 'momentary', w: 6, h: 14 })
  b.text('EXIT', B2(1177, 367), { size: 2.4, tone: 'dark', weight: 'black' })
}
