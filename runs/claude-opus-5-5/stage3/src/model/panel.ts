// The complete visible Nord Stage 4 control deck. Coordinates were measured on
// reference/nord-stage-4-73.jpg (converted to 1600-wide design px) and are mapped into the
// spec section boxes by SectionBuilder. IDs are stable: `${section}-${name}`.
import { SECTIONS, photoToSectionX } from './geometry'
import { emptyPanel, resolveLedOwners, SectionBuilder, type PanelData } from './panelBuilder'

const SIX = (ids: string[], names: string[]) => ({ states: [[], ...ids.map((id) => [id])], names: ['unlit', ...names] })

function buildPerformance(out: PanelData): void {
  const b = new SectionBuilder(out, 'performance')
  b.text('MASTER LEVEL', 195, 61.5)
  b.knob('master-level', 'Master level', 195, 78, 16, { scale: 'none', initial: 96 })
  b.stick('pitch-stick', 'Pitch stick', 75.5, 93.5, 44, 20, -14)
  b.wheel('mod-wheel', 'Modulation wheel', 128.5, 144.5, 13, 64, -18)

  b.box(176, 107, 217, 254, { title: 'ROTARY SPEAKER', titleStyle: 'band' })
  b.led('rotary-on', 212, 119)
  b.text('ON', 206.5, 119, { size: 3.6 })
  b.knob('rotary-drive', 'Rotary speaker drive', 195, 135, 14, { initial: 40 })
  b.text('DRIVE', 195, 149.5, { size: 3.6 })
  // The ON LED is driven by the routing state (any layer reaching the Rotary), not by this button.
  const organ = b.led('rotary-organ', 187.1, 157)
  b.text('ORGAN', 191, 157, { size: 3.6, align: 'left' })
  b.button('rotary-organ', 'Rotary speaker on for organ (Close Mic with Shift)', 197, 169, { toggle: organ })
  b.led('rotary-close-mic', 187.1, 180)
  b.text('CLOSE MIC▽', 191, 180, { size: 3.4, align: 'left' })
  const stop = b.led('rotary-stop-mode', 187.1, 192)
  b.text('STOP MODE', 191, 192, { size: 3.4, align: 'left' })
  b.button('rotary-stop-mode', 'Rotary stop mode (Angle with Shift)', 197, 203, { toggle: stop })
  b.text('ANGLE', 197, 213, { size: 3.4 })
  const slow = b.led('rotary-slow', 185.2, 224, 'green')
  b.text('SLOW', 188.4, 224, { size: 3.4, align: 'left' })
  const fast = b.led('rotary-fast', 203.8, 224, 'green')
  b.text('FAST', 206.8, 224, { size: 3.4, align: 'left' })
  b.button('rotary-speed', 'Rotary speed slow/fast', 197, 235, { states: [[], [slow], [fast]], names: ['unlit', 'SLOW', 'FAST'] })
  b.led('rotary-morph', 187.1, 247)
  b.text('MORPH', 191, 247, { size: 3.4, align: 'left' })

  b.text('nord stage 4', 42.5, 240, { size: 18.5, align: 'left', weight: 400, font: 'brand' })
  b.text('HAMMER ACTION 73', 43.5, 253, { size: 3.1, align: 'left', weight: 400, spacing: 3.1 })
}

function buildOrgan(out: PanelData): void {
  const b = new SectionBuilder(out, 'organ')
  b.plate(216.6, 59.3, 517.6, 254, 59.3, 66.7, { x1: 216.6, x2: 342.6, y1: 50.4 })
  b.tone = 'dark'
  b.text('ORGAN', 219.5, 55.2, { size: 7.2, weight: 800, align: 'left' })
  b.text('SECTION', 219.8, 62.2, { size: 3.2, align: 'left' })
  b.text('FX FOCUS', 272, 55.5, { size: 3.5 })
  b.led('fx-focus', 272, 61.5, 'yellow')
  b.text('ON', 294.6, 55.5, { size: 3.6 })
  const on = b.led('on', 294.6, 61.5)
  b.button('on', 'Organ section on', 311, 58.6, { h: 11, toggle: on })
  b.text('SOLO ▼', 333.5, 59, { size: 3.5 })
  b.tone = 'light'

  b.fader('level-a', 'Organ layer A level', 225.8, 68, 140, 100, 241.4)
  b.fader('level-b', 'Organ layer B level', 258, 68, 140, 64, 272.6)
  b.text('A', 222.5, 146.3, { size: 5.4, weight: 800 })
  b.text('AUX KB', 233.8, 146, { size: 3.4 })
  b.led('a-aux-kb', 245, 146, 'green')
  b.text('B', 253.8, 146.3, { size: 5.4, weight: 800 })
  b.text('AUX KB', 265, 146, { size: 3.4 })
  b.led('b-aux-kb', 276, 146, 'green')
  b.box(225.5, 150, 252, 156.8, { fill: 'light', outline: 'none' })
  b.box(256.5, 150, 283, 156.8, { fill: 'light', outline: 'none' })
  const aOn = b.led('a-on', 229, 153.4, 'green')
  const bOn = b.led('b-on', 260, 153.4, 'green')
  b.text('ON/OFF▼', 240.5, 153.4, { size: 3.4, tone: 'dark' })
  b.text('ON/OFF▼', 271.5, 153.4, { size: 3.4, tone: 'dark' })
  b.button('layer-a', 'Organ layer A on/off', 233.6, 165, { style: 'light', w: 24, toggle: aOn })
  b.button('layer-b', 'Organ layer B on/off', 264.5, 165, { style: 'light', w: 24, toggle: bOn })
  b.led('sustped', 224.4, 177)
  b.text('SUSTPED', 227.8, 177, { size: 3.4, align: 'left' })
  b.led('pstick', 255.6, 177)
  b.text('PSTICK', 259, 177, { size: 3.4, align: 'left' })
  const preset = b.led('preset', 241.4, 193)
  b.text('PRESET', 245, 193, { size: 3.6, align: 'left' })
  b.button('preset', 'Organ preset (Sync with Shift)', 249.6, 204, { toggle: preset })
  b.text('SYNC▽', 249.6, 214, { size: 3.4 })
  b.text('◂ OCTAVE SHIFT ▸', 249.6, 222.6, { size: 3.4 })
  b.button('octave-down', 'Organ octave shift down', 237, 232.5)
  b.button('octave-up', 'Organ octave shift up', 261, 232.5)
  b.text('◂ KB ZONE ▸', 249.6, 242, { size: 3.4 })
  ;[239.5, 246.7, 254, 261.3].forEach((x, i) => b.led(`kb-zone-${i + 1}`, x, 248, 'green'))

  // Organ model
  b.box(290, 71, 341.5, 130, { title: 'ORGAN MODEL' })
  b.box(311, 83, 321.5, 107, { fill: 'black', outline: 'none' })
  const models = ['FARF', 'VOX', 'B3', 'PIPE1', 'PIPE2', 'B3 BASS']
  const modelLeds = models.map((m, i) =>
    b.led(`model-${m.toLowerCase().replace(' ', '-')}`, i < 3 ? 313.6 : 318.8, [87, 95, 103][i % 3], 'red', i < 3 ? 'tri-left' : 'tri-right'),
  )
  models.forEach((m, i) => b.text(m, i < 3 ? 309.5 : 323.2, [87, 95, 103][i % 3], { size: 3.5, align: i < 3 ? 'right' : 'left' }))
  b.button('model', 'Organ model select', 315.5, 117, SIX(modelLeds, models))

  // Vib/Chorus
  b.box(341.5, 71, 412.5, 130, { title: 'VIB/CHORUS' })
  b.box(380.5, 88.4, 401.5, 99.8, { fill: 'black', outline: 'none' })
  const cols = [384.2, 391, 397.8]
  ;['C2', 'V3', 'C3'].forEach((t, i) => b.text(t, cols[i], 84.8, { size: 3.5 }))
  ;['V2', 'C1', 'V1'].forEach((t, i) => b.text(t, cols[i], 103.2, { size: 3.5 }))
  const vc: Record<string, string> = {}
  ;['C2', 'V3', 'C3'].forEach((t, i) => (vc[t] = b.led(`vibchorus-${t.toLowerCase()}`, cols[i], 91.3, 'red', 'tri-up')))
  ;['V2', 'C1', 'V1'].forEach((t, i) => (vc[t] = b.led(`vibchorus-${t.toLowerCase()}`, cols[i], 96.8, 'red', 'tri-down')))
  const vcOrder = ['V1', 'V2', 'V3', 'C1', 'C2', 'C3']
  b.button('vibchorus-type', 'Vibrato/chorus type', 364, 94, SIX(vcOrder.map((t) => vc[t]), vcOrder))
  b.text('ON', 362.5, 116.8, { size: 3.5 })
  const vcOn = b.led('vibchorus-on', 362.5, 122.6)
  b.button('vibchorus-on', 'Vibrato/chorus on', 378, 120, { style: 'light', w: 24, toggle: vcOn })

  // B3 percussion
  b.box(412.5, 71, 510.5, 130, { title: 'B3 PERCUSSION' })
  const perc: [string, string, string, number][] = [
    ['volume', 'VOLUME', 'SOFT', 432],
    ['decay', 'DECAY', 'FAST', 460.8],
    ['harmonic', 'HARMONIC', 'THIRD', 489],
  ]
  for (const [key, title, sub, x] of perc) {
    b.text(title, x, 79.4, { size: 3.6 })
    const led = b.led(`perc-${key}`, x - 10.5, 85.5)
    b.text(sub, x - 7, 85.5, { size: 3.5, align: 'left' })
    b.button(`perc-${key}`, `Percussion ${title.toLowerCase()} ${sub.toLowerCase()}`, x, 97, { w: 24, toggle: led })
  }
  b.led('perc-poly', 421.5, 108)
  b.text('POLY▽', 425, 108, { size: 3.4, align: 'left' })
  b.text('ON', 474.5, 116.8, { size: 3.5 })
  const percOn = b.led('perc-on', 474.5, 122.6)
  b.button('perc-on', 'Percussion on', 489, 120, { style: 'light', w: 24, toggle: percOn })

  // Nine drawbars with LED graphs
  const xs = [289, 315, 341.5, 367.5, 393, 419.6, 445.5, 471, 497]
  const footage = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′']
  const caps: ('black' | 'white')[] = ['black', 'black', 'white', 'white', 'black', 'white', 'black', 'black', 'white']
  const initial = [8, 0, 8, 3, 0, 4, 7, 2, 4]
  const top: [string, string][] = [
    ['BASS16', '16′'],
    ['STR16', '8′'],
    ['FLUTE8', '4′'],
    ['OBOE8', '2′'],
    ['TRMP8', 'II'],
    ['STR8', 'III'],
    ['FLUTE4', 'IV'],
    ['STR4', ''],
    ['2 2/3', '∿–∿'],
  ]
  xs.forEach((x, i) => {
    b.drawbar(`drawbar-${i + 1}`, `Drawbar ${i + 1} (${footage[i]})`, footage[i], x, caps[i], initial[i])
    b.text(footage[i], x, 250.2, { size: 4, weight: 700 })
    b.text(top[i][0], x + 9.5, 136.2, { size: 3.1 })
    if (top[i][1]) b.text(top[i][1], x + 9.5, 140.4, { size: 3.1 })
  })
  b.led('split-1', 219, 258.3)
  b.led('split-2', 324.8, 258.3)
  b.led('split-3', 465, 258.3, 'yellow')
}

function buildPiano(out: PanelData): void {
  const b = new SectionBuilder(out, 'piano')
  b.plate(521, 50.4, 649, 254, 50.4, 66.7)
  b.tone = 'dark'
  b.text('PIANO', 523.5, 55.2, { size: 7.2, weight: 800, align: 'left' })
  b.text('SECTION', 523.8, 62.2, { size: 3.2, align: 'left' })
  b.text('FX FOCUS', 576.6, 54.8, { size: 3.4 })
  b.led('fx-focus', 576.6, 60.6, 'yellow')
  b.text('ON', 600, 55, { size: 3.6 })
  const on = b.led('on', 600, 61)
  b.button('on', 'Piano section on', 615.7, 57.5, { h: 11, toggle: on })
  b.text('SOLO▼', 638.5, 58, { size: 3.4 })
  b.tone = 'light'

  b.fader('level-a', 'Piano layer A level', 530.5, 69, 138.5, 110, 545.7)
  b.fader('level-b', 'Piano layer B level', 562.4, 69, 138.5, 70, 577.7)
  b.text('A', 525.2, 146, { size: 5.4, weight: 800 })
  b.text('AUX KB', 535.5, 145.6, { size: 3.3 })
  b.led('a-aux-kb', 547.5, 145.6, 'green')
  b.text('B', 556, 146, { size: 5.4, weight: 800 })
  b.text('AUX KB', 566.4, 145.6, { size: 3.3 })
  b.led('b-aux-kb', 578.5, 145.6, 'green')
  b.box(525, 149.5, 551.5, 156, { fill: 'light', outline: 'none' })
  b.box(556, 149.5, 582.5, 156, { fill: 'light', outline: 'none' })
  const aOn = b.led('a-on', 529, 152.7, 'green')
  const bOn = b.led('b-on', 560, 152.7, 'green')
  b.text('ON/OFF▼', 540.5, 152.7, { size: 3.3, tone: 'dark' })
  b.text('ON/OFF▼', 571.5, 152.7, { size: 3.3, tone: 'dark' })
  b.button('layer-a', 'Piano layer A on/off', 538.3, 164.4, { style: 'light', w: 25, h: 13, toggle: aOn })
  b.button('layer-b', 'Piano layer B on/off', 568.8, 164.4, { style: 'light', w: 25, h: 13, toggle: bOn })
  b.led('sustped', 528.7, 176.4)
  b.text('SUSTPED', 532, 176.4, { size: 3.3, align: 'left' })
  b.led('pstick', 559.6, 176.4)
  b.text('PSTICK', 563, 176.4, { size: 3.3, align: 'left' })

  b.text('ACOUSTICS', 602.2, 74, { size: 3.6 })
  const softRel = b.led('soft-rel', 590.8, 80.5)
  b.text('SOFT REL', 594.2, 80.5, { size: 3.3, align: 'left' })
  const stringRes = b.led('string-res', 590.8, 87.7)
  b.text('STRING RES', 594.2, 87.7, { size: 3.3, align: 'left' })
  b.button('acoustics', 'Piano acoustics (soft release / string resonance)', 602.2, 99.4, {
    states: [[], [softRel], [stringRes], [softRel, stringRes]],
    names: ['unlit', 'SOFT REL', 'STRING RES', 'both'],
  })
  b.led('ped-noise', 590.8, 111)
  b.text('PED NOISE▽', 594.2, 111, { size: 3.3, align: 'left' })

  b.text('UNISON', 633.4, 74, { size: 3.6 })
  const u2 = b.led('unison-2', 633.4, 80.5)
  const u1 = b.led('unison-1', 633.4, 87.7)
  b.text('2', 629.6, 80.5, { size: 3.4, align: 'right' })
  b.text('1', 629.6, 87.7, { size: 3.4, align: 'right' })
  b.text('3', 638.2, 84.1, { size: 3.4, align: 'left' })
  b.button('unison', 'Piano unison', 633.4, 99.4, { states: [[], [u1], [u2], [u1, u2]], names: ['off', '1', '2', '3'] })

  b.text('KB TOUCH', 602.2, 119.6, { size: 3.6 })
  const med = b.led('kb-touch-med', 602.2, 126)
  const heavy = b.led('kb-touch-heavy', 602.2, 133.5)
  b.text('MED', 599, 126, { size: 3.3, align: 'right' })
  b.text('LIGHT', 605.6, 129.8, { size: 3.3, align: 'left' })
  b.text('HEAVY', 599, 133.5, { size: 3.3, align: 'right' })
  b.button('kb-touch', 'Piano KB touch', 602.2, 144.8, { states: [[], [heavy], [med], [heavy, med]], names: ['unlit', 'HEAVY', 'MED', 'LIGHT'] })

  b.text('DYN COMP', 633.4, 119.6, { size: 3.6 })
  const d2 = b.led('dyn-comp-2', 633.4, 126)
  const d1 = b.led('dyn-comp-1', 633.4, 133.5)
  b.text('2', 629.6, 126, { size: 3.4, align: 'right' })
  b.text('1', 629.6, 133.5, { size: 3.4, align: 'right' })
  b.text('3', 638.2, 129.8, { size: 3.4, align: 'left' })
  b.button('dyn-comp', 'Piano dynamic compressor', 633.4, 144.8, { states: [[], [d1], [d2], [d1, d2]], names: ['off', '1', '2', '3'] })

  b.box(592, 156, 645, 250, { title: 'PIANO SELECT' })
  b.box(614, 162.6, 624, 185.6, { fill: 'black', outline: 'none' })
  const types = ['ELECTRIC', 'UPRIGHT', 'GRAND', 'CLAV', 'DIGITAL', 'MISC']
  const typeLeds = types.map((t, i) => b.led(`type-${t.toLowerCase()}`, i < 3 ? 616.6 : 621.6, [166.5, 174, 181.8][i % 3], 'red', i < 3 ? 'tri-left' : 'tri-right'))
  types.forEach((t, i) => b.text(t, i < 3 ? 612.6 : 625.6, [166.5, 174, 181.8][i % 3], { size: 3.3, align: i < 3 ? 'right' : 'left' }))
  const order = [2, 1, 0, 3, 4, 5]
  b.button('type', 'Piano type select', 618, 193.5, SIX(order.map((i) => typeLeds[i]), order.map((i) => types[i])))
  b.text('INFO', 618, 202.6, { size: 3.4 })
  b.encoder('model', 'Piano model dial', 618, 230.8, 18)
  b.text('MODEL', 613.5, 244.2, { size: 3.4 })
  b.text('LIST', 626.2, 244.2, { size: 3.2, boxed: 'light', tone: 'dark' })

  b.text('TIMBRE', 560.6, 187, { size: 3.6 })
  const bright = b.led('timbre-bright', 560.6, 193.5)
  const mid = b.led('timbre-mid', 560.6, 201)
  const soft = b.led('timbre-soft', 560.6, 208.4)
  b.text('BRIGHT', 557, 193.5, { size: 3.3, align: 'right' })
  b.text('MID', 557, 201, { size: 3.3, align: 'right' })
  b.text('SOFT', 557, 208.4, { size: 3.3, align: 'right' })
  b.text('DYNO1', 564, 197.2, { size: 3.3, align: 'left' })
  b.text('DYNO2', 564, 204.7, { size: 3.3, align: 'left' })
  b.rocker('timbre', 'Piano timbre', 535.8, 202.4, {
    w: 12.4,
    h: 25,
    states: [[], [soft], [mid], [bright], [bright, mid], [mid, soft]],
    names: ['off', 'SOFT', 'MID', 'BRIGHT', 'DYNO1', 'DYNO2'],
  })
  b.text('◂ OCTAVE SHIFT ▸', 553.4, 222, { size: 3.3 })
  b.button('octave-down', 'Piano octave shift down', 541.8, 232, { w: 22 })
  b.button('octave-up', 'Piano octave shift up', 565, 232, { w: 22 })
  b.text('◂ KB ZONE ▸', 553.4, 241.4, { size: 3.3 })
  ;[542.2, 549.6, 557, 564.4].forEach((x, i) => b.led(`kb-zone-${i + 1}`, x, 247.6, 'green'))
  b.led('split-1', 571.3, 258.3)
}

function buildProgram(out: PanelData): void {
  const b = new SectionBuilder(out, 'program')
  b.box(659, 50.8, 737.4, 84, { title: 'MORPH ASSIGN', titleStyle: 'band', fill: 'dark' })
  const morph: [string, string, string, number, number][] = [
    ['wheel', 'WHEEL▾', 'Morph assign wheel', 664.7, 674.3],
    ['at', 'A.T.▾', 'Morph assign aftertouch', 690.2, 699],
    ['ctrlped', 'CTRLPED▾', 'Morph assign control pedal', 713.3, 722.5],
  ]
  for (const [key, text, label, lx, bx] of morph) {
    const led = b.led(`morph-${key}`, lx, 60.6, 'green')
    b.text(text, lx + 3.3, 60.6, { size: 3.3, align: 'left' })
    b.button(`morph-${key}`, label, bx, 71.7, { w: 22, toggle: led })
  }
  b.text('CLEAR MORPH', 699, 81.4, { size: 3.2 })

  b.text('SPLIT', 759, 53.8, { size: 3.6, boxed: 'light', tone: 'dark', weight: 800 })
  const s1 = b.led('split-low', 748.8, 60.6)
  const s2 = b.led('split-mid', 759, 60.6, 'yellow')
  const s3 = b.led('split-high', 769.4, 60.6)
  b.text('ON/SET▼', 759, 66.2, { size: 3.3 })
  b.button('split', 'Split on/set (Set Key with Shift)', 759, 75.6, { states: [[], [s1], [s2], [s3]], names: ['unlit', 'low', 'mid', 'high'] })
  b.text('SET KEY', 759, 85.2, { size: 3.3 })

  b.text('MST CLK', 793.5, 53.8, { size: 3.6, boxed: 'light', tone: 'dark', weight: 800 })
  const clk = b.led('master-clock', 782.5, 60.6)
  b.text('TAP/SET▼', 786, 60.6, { size: 3.3, align: 'left' })
  b.button('master-clock', 'Master clock tap/set', 793, 71.7, { toggle: clk })
  b.led('pedal-tap', 783.6, 83.4)
  b.text('PEDAL TAP', 787, 83.4, { size: 3.2, align: 'left' })

  b.text('TRANSP', 827, 53.8, { size: 3.6, boxed: 'light', tone: 'dark', weight: 800 })
  const tr = b.led('transpose', 815.5, 60.6)
  b.text('ON/SET▼', 819, 60.6, { size: 3.3, align: 'left' })
  b.button('transpose', 'Transpose on/set (Panic with Shift)', 827, 71.7, { toggle: tr })
  b.text('PANIC', 827, 81.4, { size: 3.3 })
  b.text('PROG VIEW', 827, 89.8, { size: 3.3 })
  b.button('prog-view', 'Program view (Preset Name with Shift)', 827, 98.7)
  b.text('PRESET NAME', 827, 108.4, { size: 3.1 })

  const store = b.led('store', 666.1, 94.8)
  b.text('STORE', 669.5, 94.8, { size: 3.4, align: 'left' })
  b.button('store', 'Store (Store As with Shift)', 675.7, 106.5, { style: 'red', toggle: store })
  b.text('STORE AS...', 675.7, 116, { size: 3.2 })
  b.text('PAGE NAME', 675.7, 119.8, { size: 3 })
  b.text('MIDI', 700.2, 98.8, { size: 3.3 })
  b.led('midi', 700.2, 104.7)
  b.text('EXTERN', 700.2, 111.6, { size: 3.3 })
  b.led('extern', 700.2, 117.9)

  b.box(713, 92.7, 792, 122.5, { title: 'PRESET LIBRARY', titleStyle: 'band', fill: 'light' })
  const lib: [string, string, number, number][] = [
    ['organ', 'ORGAN', 719.7, 728.2],
    ['piano', 'PIANO', 742.7, 752.3],
    ['synth', 'SYNTH', 766.5, 776.1],
  ]
  for (const [key, text, lx, bx] of lib) {
    const led = b.led(`preset-${key}`, lx, 99.2)
    b.text(text, lx + 3.3, 99.2, { size: 3.3, align: 'left', tone: 'dark' })
    b.button(`preset-${key}`, `Preset library ${key}`, bx, 110, { w: 22, toggle: led })
  }
  b.text('SINGLE LAYER', 752.3, 119.6, { size: 3.1, tone: 'dark' })

  b.encoder('dial', 'Program dial', 680.3, 140.2, 19)
  b.text('PROGRAM', 676.5, 154.6, { size: 3.4 })
  b.text('LIST', 690.3, 154.6, { size: 3.1, boxed: 'light', tone: 'dark' })
  b.text('◂ PAGE/CAT ▸', 680.3, 161.6, { size: 3.3 })
  b.button('page-left', 'Page/category left (Bank with Shift)', 668.2, 172.2, { w: 22 })
  b.button('page-right', 'Page/category right (Bank with Shift)', 692, 172.2, { w: 22 })
  b.text('◂ BANK ▸', 680.3, 181.4, { size: 3.3 })

  b.box(706.3, 126, 799, 176.6, { fill: 'black', outline: 'none' })
  b.oled('oled', 'Program OLED display', 708.7, 128.5, 796.7, 174)
  for (const x of [719.7, 741.7, 763.7, 786]) b.line([[x, 179], [x, 183.5]])

  const live = b.led('live-mode', 663.6, 189.2)
  b.text('LIVE MODE', 667, 189.2, { size: 3.4, align: 'left' })
  b.button('live-mode', 'Live mode', 675.7, 201.3, { style: 'light', w: 24, toggle: live })
  b.led('num-pad', 663.6, 213)
  b.text('NUM PAD', 667, 213, { size: 3.3, align: 'left' })
  b.box(659, 219, 690.5, 250.5, { fill: 'dark' })
  const scene = b.led('layer-scene', 664.7, 225.2)
  b.text('LAYER', 668, 223.4, { size: 3.3, align: 'left' })
  b.text('SCENE II', 668, 227.2, { size: 3.3, align: 'left' })
  b.button('layer-scene', 'Layer scene', 675.4, 236.2, { toggle: scene })
  b.led('pedal', 664.7, 246.8)
  b.text('PEDAL', 668, 246.8, { size: 3.3, align: 'left' })

  b.box(699, 189, 807.4, 251, { title: 'PROGRAM', titleStyle: 'band', fill: 'dark' })
  const bx = [714.4, 740, 765.5, 791.4]
  const menus = ['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB', 'OUTPUT', 'PEDAL', 'MIDI', 'EXTERN']
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1
    const x = bx[i % 4]
    const ledY = row ? 226.6 : 199.6
    const led = b.led(`program-${i + 1}`, x - 2.4, ledY)
    b.text(String(i + 1), x + 1.6, ledY, { size: 3.6, align: 'left' })
    b.button(`slot-${i + 1}`, `Program button ${i + 1} (${menus[i]} menu with Shift)`, x, row ? 238.2 : 211.2, { w: 24, h: 12.5, toggle: led })
    b.text(menus[i], x, row ? 247.4 : 220.6, { size: 3.1 })
  }

  b.box(812, 116, 841.8, 207, {})
  const solo = b.led('solo', 818.9, 121)
  b.text('SOLO', 822.2, 121, { size: 3.4, align: 'left' })
  b.button('solo', 'Solo (Undo with Shift)', 827, 132.4, { toggle: solo })
  b.text('UNDO', 827, 142, { size: 3.3 })
  const edit = b.led('section-edit', 817, 152.8)
  b.text('SECTION', 820.3, 151, { size: 3.2, align: 'left' })
  b.text('EDIT ▾', 820.3, 154.8, { size: 3.2, align: 'left' })
  b.button('section-edit', 'Section edit (Layer Init with Shift)', 827, 164.4, { toggle: edit })
  b.text('LAYER INIT', 827, 174, { size: 3.2 })
  b.text('MON/COPY', 827, 183.3, { size: 3.2 })
  b.button('mon-copy', 'Monitor/copy (Paste with Shift)', 827, 193.5)
  b.text('PASTE ▾', 827, 202.4, { size: 3.2 })

  b.box(820, 213.7, 841.5, 250.3, { fill: 'light', outline: 'none' })
  b.text('SHIFT', 830.7, 217.4, { size: 3.4, tone: 'dark' })
  b.rocker('shift', 'Program shift / exit', 830.7, 231.2, { style: 'rocker-light', w: 11.4, h: 21 })
  b.text('EXIT', 830.7, 247, { size: 3.4, tone: 'dark' })
  b.led('split-1', 711.5, 258.3)
  b.led('split-2', 817.3, 258.3)
}

function buildSynth(out: PanelData): void {
  const b = new SectionBuilder(out, 'synth')
  b.plate(848, 57.8, 1226, 252, 57.8, 65.7, { x1: 848, x2: 1005.3, y1: 49.7 })
  b.tone = 'dark'
  b.text('SYNTH', 851, 55, { size: 7.2, weight: 800, align: 'left' })
  b.text('SECTION', 851.3, 62, { size: 3.2, align: 'left' })
  b.text('FX FOCUS', 935.7, 54.6, { size: 3.4 })
  b.led('fx-focus', 935.7, 60.4, 'yellow')
  b.text('ON', 958, 55, { size: 3.6 })
  const on = b.led('on', 958, 60.8)
  b.button('on', 'Synth section on', 974, 57.8, { h: 11, toggle: on })
  b.text('SOLO▼', 995.5, 58.5, { size: 3.4 })
  b.tone = 'light'

  const layers: [string, number, number, number, number][] = [
    ['a', 857.6, 872.9, 118, 865],
    ['b', 888.9, 904.2, 40, 896],
    ['c', 920.1, 936, 90, 927.2],
  ]
  layers.forEach(([key, fx, lx, init, bx]) => {
    const up = key.toUpperCase()
    b.fader(`level-${key}`, `Synth layer ${up} level`, fx, 67.4, 136.7, init, lx)
    b.text(up, bx - 12.4, 145, { size: 5.4, weight: 800 })
    b.text('AUX KB', bx - 2, 144.8, { size: 3.3 })
    b.led(`${key}-aux-kb`, bx + 10.6, 144.8, 'green')
    b.box(bx - 13, 149.2, bx + 13.5, 155.5, { fill: 'light', outline: 'none' })
    const led = b.led(`${key}-on`, bx - 8.3, 152.3, 'yellow')
    b.text('ON/OFF▼', bx + 3, 152.3, { size: 3.3, tone: 'dark' })
    b.button(`layer-${key}`, `Synth layer ${up} on/off`, bx, 164, { style: 'light', w: 24, toggle: led })
  })
  b.led('sustped', 855.1, 175.7)
  b.text('SUSTPED', 858.5, 175.7, { size: 3.3, align: 'left' })
  b.led('pstick', 883.5, 175.7)
  b.text('PSTICK/RNG▼', 887, 175.7, { size: 3.3, align: 'left' })
  b.text('PAN▼', 927.2, 175.7, { size: 3.3 })

  b.box(962.5, 69, 1055, 118, { fill: 'black', outline: 'none' })
  b.oled('oled', 'Synth OLED display', 964.5, 71, 1052.9, 116)
  b.line([[975.9, 121], [975.9, 128], [966.2, 143]])
  b.line([[1008.5, 121], [1008.5, 145]])
  b.line([[1040.6, 121], [1040.6, 128], [1050, 143]])
  b.encoder('info', 'Synth info dial', 966.2, 158, 20)
  b.encoder('list-1', 'Synth list dial 1', 1008.5, 158, 20)
  b.encoder('list-2', 'Synth list dial 2', 1050, 158, 20)
  b.text('INFO', 966.2, 171.6, { size: 3.4 })
  b.text('LIST', 1008.5, 171.6, { size: 3.4 })
  b.text('LIST', 1050, 171.6, { size: 3.4 })

  b.box(1059, 68, 1093, 115.4, { title: 'MODE', titleStyle: 'band', fill: 'light', outline: 'none' })
  const samples = b.led('mode-samples', 1066.5, 79.4)
  const analog = b.led('mode-analog', 1066.5, 86.6)
  const extern = b.led('mode-extern', 1066.5, 110)
  b.text('SAMPLES', 1070, 79.4, { size: 3.3, align: 'left', tone: 'dark' })
  b.text('ANALOG', 1070, 86.6, { size: 3.3, align: 'left', tone: 'dark' })
  b.text('EXTERN', 1070, 110, { size: 3.3, align: 'left', tone: 'dark' })
  b.button('mode', 'Synth oscillator mode', 1076, 98.3, { w: 22, states: [[], [samples], [analog], [extern]], names: ['unlit', 'SAMPLES', 'ANALOG', 'EXTERN'] })
  b.text('WAVEFORM', 1082.3, 124.2, { size: 3.4 })
  b.led('keep-edits', 1071.6, 128.8)
  b.text('KEEP EDITS▼', 1075, 128.8, { size: 2.9, align: 'left' })
  b.rocker('sound-init', 'Synth waveform (Sound Init with Shift)', 1082.3, 146.6, { outline: true, h: 23 })
  b.text('SOUND', 1082.3, 161, { size: 3.3 })
  b.text('INIT', 1082.3, 164.8, { size: 3.3 })

  // Arpeggiator / gate
  b.box(1097.6, 68, 1225.4, 121.8, { title: 'ARPEGGIATOR/GATE' })
  b.knob('arp-rate', 'Arpeggiator rate/time', 1115, 91.2, 17, { initial: 70 })
  b.led('arp-rate', 1106.4, 106.2)
  b.text('RATE/TIME', 1110, 106.2, { size: 3.2, align: 'left' })
  b.led('arp-mst-clk', 1105.4, 113.8)
  b.text('MST CLK', 1115.8, 113.8, { size: 3.1, boxed: 'red' })
  const poly = b.led('arp-poly', 1148.3, 82.7)
  const arp = b.led('arp-arp', 1148.3, 90.5)
  b.text('POLY', 1144.6, 82.7, { size: 3.3, align: 'right' })
  b.text('ARP', 1144.6, 90.5, { size: 3.3, align: 'right' })
  b.text('GATE', 1158.4, 86.6, { size: 3.1, boxed: 'light', tone: 'dark' })
  b.button('arp-mode', 'Arpeggiator/gate mode', 1148.7, 101.9, { states: [[], [poly], [arp], [poly, arp]], names: ['unlit', 'POLY', 'ARP', 'GATE'] })
  b.led('arp-pattern', 1138, 113.8)
  b.text('PATTERN▽', 1141.5, 113.8, { size: 3.2, align: 'left' })
  b.knob('arp-range', 'Arpeggiator range', 1185.3, 91.2, 17, { scale: 'range', halo: true, initial: 40 })
  b.led('arp-range', 1174.2, 106.2)
  b.text('RANGE', 1182.4, 106.2, { size: 3.2 })
  b.text('ENV', 1193.4, 106.2, { size: 3, boxed: 'light', tone: 'dark' })
  b.led('arp-menu', 1206.8, 79.4)
  b.text('MENU', 1210.2, 79.4, { size: 3.3, align: 'left' })
  b.rocker('arp-menu', 'Arpeggiator menu', 1213.7, 97.6, { outline: true, h: 23 })
  b.text('GROUP▽', 1213.7, 114.2, { size: 3.1 })

  b.box(1097.6, 122.5, 1169.3, 172, { title: 'VOICE' })
  const mono = b.led('voice-mono', 1105.4, 136)
  const legato = b.led('voice-legato', 1105.4, 143.4)
  b.text('MONO', 1109, 136, { size: 3.3, align: 'left' })
  b.text('LEGATO', 1109, 143.4, { size: 3.3, align: 'left' })
  b.button('voice', 'Synth voice mode', 1114.3, 155, { states: [[], [mono], [legato]], names: ['unlit', 'MONO', 'LEGATO'] })
  b.knob('glide', 'Glide', 1149.8, 146, 17, { initial: 30 })
  b.text('GLIDE', 1149.8, 160.4, { size: 3.3 })
  b.line([[1128, 136], [1135, 136], [1135, 160.4], [1142, 160.4]])
  b.led('glide-lo', 1105.4, 167.2)
  b.text('LO▽', 1108.8, 167.2, { size: 3.2, align: 'left' })
  b.led('glide-hi', 1118, 167.2)
  b.text('HI▽', 1121.4, 167.2, { size: 3.2, align: 'left' })

  b.box(1169.3, 122.5, 1225.4, 172, { title: 'VIBRATO' })
  const whl = b.led('vibrato-whl', 1187.4, 129.9)
  const dly = b.led('vibrato-dly', 1187.4, 137.4)
  const von = b.led('vibrato-on', 1187.4, 144.8)
  b.text('WHL', 1183.6, 129.9, { size: 3.3, align: 'right' })
  b.text('DLY', 1183.6, 137.4, { size: 3.3, align: 'right' })
  b.text('ON', 1183.6, 144.8, { size: 3.3, align: 'right' })
  b.text('A.T.', 1191, 133.6, { size: 3.3, align: 'left' })
  b.text('PED', 1191, 141.1, { size: 3.3, align: 'left' })
  b.button('vibrato', 'Synth vibrato source', 1187, 156.2, { states: [[], [whl], [dly], [von]], names: ['unlit', 'WHL', 'DLY', 'ON'] })
  b.led('vibrato-menu', 1206.8, 134.9)
  b.text('MENU', 1210.2, 134.9, { size: 3.3, align: 'left' })
  b.rocker('vibrato-menu', 'Vibrato menu', 1213, 150.8, { outline: true, h: 23 })

  const hold = b.led('kb-hold', 855.1, 188.1)
  b.text('KB HOLD', 864.8, 188.1, { size: 3.3, boxed: 'red' })
  b.button('kb-hold', 'Keyboard hold', 865, 199.5, { toggle: hold })
  b.led('exclude', 855.1, 211.9)
  b.text('EXCLUDE▽', 858.5, 211.9, { size: 3.2, align: 'left' })
  const run = b.led('arp-run', 886.4, 188.1)
  b.text('ARP RUN', 890, 188.1, { size: 3.3, align: 'left' })
  b.button('arp-run', 'Arpeggiator run', 896, 199.5, { style: 'red', toggle: run })
  b.led('kb-sync', 886.4, 211.9)
  b.text('KB SYNC▽', 890, 211.9, { size: 3.2, align: 'left' })
  b.text('◂ OCTAVE SHIFT ▸', 880.5, 221.8, { size: 3.3 })
  b.button('octave-down', 'Synth octave shift down', 868.6, 231.4)
  b.button('octave-up', 'Synth octave shift up', 892.4, 231.4)
  b.text('◂ KB ZONE ▸', 880.5, 241, { size: 3.3 })
  ;[869.4, 876.5, 883.6, 890.7].forEach((x, i) => b.led(`kb-zone-${i + 1}`, x, 247.4, 'green'))

  // Lower row: LFO, oscillators, filter, amp, unison (light sub-panels)
  b.tone = 'dark'
  b.box(915.5, 177.5, 991.8, 250.3, { title: 'LFO', fill: 'mid' })
  const wave = b.led('lfo-waveform', 921.9, 182.4)
  b.text('WAVEFORM', 925.4, 182.4, { size: 3.3, align: 'left' })
  b.button('lfo-waveform', 'LFO waveform', 932.2, 194.2, { outline: true, toggle: wave })
  b.led('lfo-group', 921.9, 205.9)
  b.text('GROUP▽', 925.4, 205.9, { size: 3.2, align: 'left' })
  b.knob('lfo-mod-amt', 'LFO modulation amount', 974.8, 196.6, 17, { initial: 80 })
  b.led('lfo-mod-amt', 966.6, 211.2)
  b.text('MOD AMT', 970, 211.2, { size: 3.2, align: 'left' })
  b.knob('lfo-rate', 'LFO rate/time', 935.7, 224.3, 17, { initial: 50 })
  b.led('lfo-rate', 927.2, 238.6)
  b.text('RATE/TIME', 930.6, 238.6, { size: 3.2, align: 'left' })
  const pitch = b.led('lfo-osc-pitch', 974.8, 222.2)
  const ctrl = b.led('lfo-osc-ctrl', 974.8, 230)
  b.text('OSC PITCH', 971.4, 222.2, { size: 3.2, align: 'right' })
  b.text('OSC CTRL', 971.4, 230, { size: 3.2, align: 'right' })
  b.text('FILTER', 978.4, 226.1, { size: 3.2, align: 'left' })
  b.button('lfo-dest', 'LFO destination', 974.8, 241.6, { w: 22, states: [[], [pitch], [ctrl], [pitch, ctrl]], names: ['unlit', 'OSC PITCH', 'OSC CTRL', 'FILTER'] })
  b.led('lfo-mst-clk', 926.4, 246.2)
  b.text('MST CLK', 936.2, 246.2, { size: 3.1, boxed: 'red', tone: 'light' })

  b.box(996.4, 177.5, 1080.5, 250.3, { title: 'OSCILLATORS', fill: 'mid' })
  const psmp = b.led('osc-pitch-smp', 1007.8, 183.9)
  b.text('PITCH/SMP', 1011.3, 183.9, { size: 3.2, align: 'left' })
  b.button('osc-pitch', 'Oscillator pitch/sample', 1017.4, 195.2, { outline: true, toggle: psmp })
  b.led('osc-env-to-pitch', 1007.8, 207.6)
  b.text('ENV TO PITCH▽', 1011.3, 207.6, { size: 3.1, align: 'left' })
  const oenv = b.led('osc-envelope', 1050.4, 183.9)
  b.text('ENVELOPE', 1053.9, 183.9, { size: 3.2, align: 'left' })
  b.button('osc-envelope', 'Oscillator modulation envelope', 1060, 195.2, { outline: true, toggle: oenv })
  b.led('osc-velocity', 1050.4, 207.6)
  b.text('VELOCITY▽', 1053.9, 207.6, { size: 3.1, align: 'left' })
  b.knob('osc-ctrl', 'Oscillator control', 1017.4, 228.4, 19, { halo: true, initial: 50 })
  b.led('osc-ctrl', 1004.6, 244.4)
  b.text('OSC CTRL', 1019, 244.4, { size: 3.2 })
  b.knob('osc-env-amt', 'Oscillator envelope amount', 1060.3, 229.6, 17, { scale: 'bipolar', initial: 80 })
  b.led('osc-env-amt', 1049.4, 244.4)
  b.text('ENV AMT', 1062, 244.4, { size: 3.2 })

  b.box(1084.8, 177.5, 1188.8, 250.3, { title: 'FILTER', fill: 'mid' })
  const ftype = b.led('filter-type', 1092.2, 183.9)
  b.text('TYPE', 1095.7, 183.9, { size: 3.2, align: 'left' })
  b.button('filter-type', 'Filter type', 1101.9, 195.2, { outline: true, toggle: ftype })
  b.led('filter-group', 1092.2, 207.6)
  b.text('GROUP▽', 1095.7, 207.6, { size: 3.1, align: 'left' })
  const fenv = b.led('filter-envelope', 1126.7, 183.9)
  b.text('ENVELOPE', 1130.2, 183.9, { size: 3.2, align: 'left' })
  b.button('filter-envelope', 'Filter envelope', 1137.4, 195.2, { outline: true, toggle: fenv })
  b.led('filter-velocity', 1126.7, 207.6)
  b.text('VELOCITY▽', 1130.2, 207.6, { size: 3.1, align: 'left' })
  b.knob('filter-env-amt', 'Filter envelope amount', 1172.9, 193.4, 17, { initial: 60 })
  b.led('filter-env-amt', 1164.2, 208.2)
  b.text('ENV AMT', 1175.6, 208.2, { size: 3.1 })
  b.knob('filter-freq', 'Filter frequency', 1107.2, 228.4, 19, { halo: true, initial: 50 })
  b.led('filter-freq', 1096.6, 244.4)
  b.text('FREQ', 1108.6, 244.4, { size: 3.2 })
  b.knob('filter-res', 'Filter resonance / HP frequency', 1151.6, 228.2, 17, { initial: 70 })
  b.led('filter-res', 1138.6, 244.4)
  b.text('RES/FREQ HP', 1154.4, 244.4, { size: 3.1 })
  const fon = b.led('filter-on', 1170.4, 220.6)
  b.text('FILTER', 1177.6, 214.4, { size: 3.2 })
  b.text('ON', 1173.8, 220.6, { size: 3.2, align: 'left' })
  b.rocker('filter-on', 'Filter on', 1177.6, 236.8, { h: 22, toggle: fon })

  b.box(1192.4, 177.5, 1225.4, 213, { title: 'AMP', fill: 'mid' })
  const aenv = b.led('amp-envelope', 1197.8, 183.9)
  b.text('ENVELOPE', 1201.2, 183.9, { size: 3, align: 'left' })
  b.button('amp-envelope', 'Amp envelope', 1209, 195.2, { outline: true, w: 22, toggle: aenv })
  b.text('VELOCITY▽', 1209, 205.4, { size: 3 })
  b.led('amp-velocity-1', 1203, 210)
  b.led('amp-velocity-2', 1216, 210)
  b.text('1', 1199.6, 210, { size: 3 })
  b.text('2', 1212.6, 210, { size: 3 })

  b.box(1192.4, 214.7, 1225.4, 250.3, { title: 'UNISON', fill: 'mid' })
  const su2 = b.led('unison-2', 1208.4, 222.8)
  const su1 = b.led('unison-1', 1208.4, 230)
  b.text('2', 1204.6, 222.8, { size: 3.3, align: 'right' })
  b.text('1', 1204.6, 230, { size: 3.3, align: 'right' })
  b.text('3', 1213.2, 226.4, { size: 3.3, align: 'left' })
  b.button('unison', 'Synth unison', 1209, 242, { w: 22, states: [[], [su1], [su2], [su1, su2]], names: ['off', '1', '2', '3'] })
  b.tone = 'light'
  b.led('split-1', 958.3, 258.3)
  b.led('split-2', 1059, 258.3)
  b.led('split-3', 1200, 258.3)
}

function buildEffects(out: PanelData): void {
  const b = new SectionBuilder(out, 'effects')
  b.plate(1226.5, 58, 1519.4, 251, 58, 67.4, { x1: 1226.5, x2: 1359.6, y1: 49 }, { x1: 1226.5, x2: 1256.5 })
  b.tone = 'dark'
  b.text('LAYER EFFECTS', 1229.6, 57.4, { size: 6.4, weight: 800, align: 'left' })
  b.text('ON', 1323.4, 54, { size: 3.6 })
  const on = b.led('on', 1323.4, 59.6)
  b.button('on', 'Layer effects on', 1340.8, 56.8, { h: 11, toggle: on })
  b.text('FX FOCUS', 1229.8, 65.2, { size: 3.4, align: 'left' })
  b.tone = 'light'

  // FX focus column on the red chassis
  b.text('ORGAN', 1240.7, 82.7, { size: 3.4 })
  const fo = b.led('focus-organ', 1240.7, 88.2)
  b.text('A B', 1240.7, 93, { size: 3.3 })
  b.button('focus-organ', 'Effects focus organ (All FX Off with Shift)', 1240.7, 103.3, { w: 24, toggle: fo })
  b.text('ALL FX OFF', 1240.7, 112.8, { size: 3.1 })
  b.text('PIANO', 1240.7, 126.4, { size: 3.4 })
  const pa = b.led('focus-piano-a', 1235.2, 131.8)
  const pb = b.led('focus-piano-b', 1246.2, 131.8)
  b.text('A', 1235.2, 137.2, { size: 3.3 })
  b.text('B', 1246.2, 137.2, { size: 3.3 })
  b.button('focus-piano', 'Effects focus piano', 1240.7, 146.6, { w: 24, states: [[], [pa], [pb]], names: ['unlit', 'A', 'B'] })
  b.text('GROUP▽', 1240.7, 156.3, { size: 3.1 })
  b.text('SYNTH', 1240.7, 170, { size: 3.4 })
  const sa = b.led('focus-synth-a', 1230.4, 175.8, 'yellow')
  const sb = b.led('focus-synth-b', 1240.6, 175.8, 'yellow')
  const sc = b.led('focus-synth-c', 1250.8, 175.8, 'yellow')
  b.text('A', 1230.4, 181.2, { size: 3.3 })
  b.text('B', 1240.6, 181.2, { size: 3.3 })
  b.text('C', 1250.8, 181.2, { size: 3.3 })
  b.button('focus-synth', 'Effects focus synth', 1240.7, 191, { w: 24, states: [[], [sa], [sb], [sc]], names: ['unlit', 'A', 'B', 'C'] })
  b.text('GROUP▽', 1240.7, 200.6, { size: 3.1 })
  b.box(1231, 213.5, 1250.4, 250.5, { fill: 'light', outline: 'none' })
  b.text('SHIFT', 1240.7, 217.3, { size: 3.4, tone: 'dark' })
  b.rocker('shift', 'Effects shift / exit', 1240.7, 231.6, { style: 'rocker-light', w: 12.4, h: 20 })
  b.text('EXIT', 1240.7, 247.2, { size: 3.4, tone: 'dark' })

  const matrix = (prefix: string, key: string, label: string, left: string[], right: string[], x: number, y0: number, bx: number, by: number, boxRight: ('light' | 'red' | undefined)[]) => {
    const ys = [y0, y0 + 7.5, y0 + 15.2]
    b.box(x - 5, y0 - 4, x + 5.5, y0 + 19.2, { fill: 'black', outline: 'none' })
    const ids = [
      ...left.map((t, i) => b.led(`${prefix}-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, x - 2.4, ys[i], 'red', 'tri-left')),
      ...right.map((t, i) => b.led(`${prefix}-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, x + 2.6, ys[i], 'red', 'tri-right')),
    ]
    left.forEach((t, i) => b.text(t, x - 6.4, ys[i], { size: 3.2, align: 'right' }))
    right.forEach((t, i) => {
      const boxed = boxRight[i]
      b.text(t, x + 7, ys[i], { size: 3.1, align: 'left', boxed, tone: boxed === 'light' ? 'dark' : 'light' })
    })
    b.button(key, label, bx, by, SIX(ids, [...left, ...right]))
  }

  b.box(1258.5, 66.7, 1397.6, 119, { title: 'MOD 1' })
  b.knob('mod1-rate', 'Mod 1 rate', 1278, 93.4, 17, { initial: 50 })
  b.led('mod1-rate', 1267.3, 106.4)
  b.text('RATE', 1271, 106.4, { size: 3.3, align: 'left' })
  b.text('SENS', 1289.6, 106.4, { size: 3, boxed: 'light', tone: 'dark' })
  b.led('mod1-mst-clk', 1267.3, 113.6)
  b.text('MST CLK', 1277.4, 113.6, { size: 3, boxed: 'red' })
  b.knob('mod1-amount', 'Mod 1 amount', 1320.6, 92.3, 17, { initial: 64 })
  b.led('mod1-amount', 1310.6, 106.4)
  b.text('AMOUNT', 1314.2, 106.4, { size: 3.3, align: 'left' })
  matrix('mod1', 'mod1-type', 'Mod 1 effect type', ['RM', 'TREM', 'A-PAN'], ['A-WAH', 'WAH', 'PUMP'], 1356, 77.5, 1356, 104.7, ['light', 'light', 'light'])
  b.led('mod1-variation', 1339.6, 106.6)
  b.text('VARIATION', 1356, 114.6, { size: 3.1 })
  b.text('PED▽', 1373, 114.6, { size: 3, boxed: 'light', tone: 'dark' })
  b.text('ON', 1385, 85, { size: 3.4 })
  const m1on = b.led('mod1-on', 1391.4, 85)
  b.rocker('mod1-on', 'Mod 1 on', 1388, 101.2, { style: 'rocker-light', w: 12.4, h: 23, toggle: m1on })

  b.box(1258.5, 119, 1397.6, 165.8, { title: 'MOD 2' })
  b.knob('mod2-rate', 'Mod 2 rate', 1278, 141.3, 17, { initial: 40 })
  b.led('mod2-rate', 1267.3, 155.6)
  b.text('RATE', 1271, 155.6, { size: 3.3, align: 'left' })
  b.knob('mod2-amount', 'Mod 2 amount', 1320.6, 140.2, 17, { initial: 70 })
  b.led('mod2-amount', 1310.6, 155.6)
  b.text('AMOUNT', 1314.2, 155.6, { size: 3.3, align: 'left' })
  matrix('mod2', 'mod2-type', 'Mod 2 effect type', ['CHOR', 'FLANG', 'PHAS'], ['VIBE', 'ENS', 'SPIN'], 1356, 125.9, 1356, 152, [undefined, undefined, undefined])
  b.led('mod2-variation', 1339.6, 153.6)
  b.text('VARIATION', 1358, 162, { size: 3.1 })
  b.text('ON', 1385, 133.4, { size: 3.4 })
  const m2on = b.led('mod2-on', 1391.4, 133.4)
  b.rocker('mod2-on', 'Mod 2 on', 1388, 148.4, { style: 'rocker-light', w: 12.4, h: 23, toggle: m2on })

  b.box(1258.5, 165.8, 1397.6, 251, { title: 'AMP SIM/EQ' })
  b.text('ON', 1263.4, 170.4, { size: 3.2 })
  b.led('eq-on', 1263.4, 175.2)
  b.knob('amp-drive', 'Amp simulator drive', 1278, 186.4, 17, { initial: 30 })
  b.led('amp-drive', 1269.4, 201.8)
  b.text('DRIVE', 1273, 201.8, { size: 3.3, align: 'left' })
  b.knob('eq-freq', 'EQ mid frequency', 1320.6, 186.4, 17, { scale: 'freq', initial: 64 })
  b.led('eq-freq', 1311.2, 201.8)
  b.text('FREQ', 1322, 201.8, { size: 3.3 })
  b.text('FREQ', 1320.6, 206.4, { size: 3, boxed: 'light', tone: 'dark' })
  matrix('amp', 'amp-type', 'Amp simulator type', ['SMALL', 'JC', 'TWIN'], ['TO ROTARY', 'LP FILTER', 'HP FILTER'], 1362.4, 173.1, 1361.4, 200.6, ['red', 'light', 'light'])
  b.led('amp-variation', 1345.4, 207.2)
  b.text('VARIATION▽', 1365.4, 209.8, { size: 3.1 })
  b.knob('eq-bass', 'EQ bass', 1277, 229, 17, { scale: 'eq', initial: 64 })
  b.text('BASS', 1277, 244.4, { size: 3.3 })
  b.knob('eq-mid', 'EQ mid', 1318.8, 229, 17, { scale: 'eq', initial: 64 })
  b.text('MID', 1315, 244.4, { size: 3.3 })
  b.text('RES', 1324.4, 244.4, { size: 3, boxed: 'light', tone: 'dark' })
  b.knob('eq-treble', 'EQ treble', 1360.7, 229, 17, { scale: 'eq', initial: 64 })
  b.text('TREBLE', 1360.7, 244.4, { size: 3.3 })
  b.text('ON', 1385.4, 211.6, { size: 3.4 })
  const ampOn = b.led('amp-on', 1391.4, 211.6)
  b.rocker('amp-on', 'Amp simulator/EQ on', 1388, 223.6, { style: 'rocker-light', w: 12.4, h: 23, toggle: ampOn })

  b.box(1397.6, 66.7, 1519.4, 170.4, { title: 'DELAY' })
  b.knob('delay-tempo', 'Delay tempo', 1421.8, 95.9, 17, { initial: 60 })
  b.led('delay-tempo', 1413.6, 109.6)
  b.text('TEMPO', 1417.2, 109.6, { size: 3.3, align: 'left' })
  b.led('delay-mst-clk', 1411.2, 117.4)
  b.text('MST CLK', 1421.4, 117.4, { size: 3, boxed: 'red' })
  b.text('EFFECTS', 1461.6, 77.8, { size: 3.3 })
  const dchor = b.led('delay-chor', 1459.2, 84.6)
  const dvibe = b.led('delay-vibe', 1459.2, 91.6)
  const dens = b.led('delay-ens', 1459.2, 98.7)
  b.text('CHOR', 1455.6, 84.6, { size: 3.2, align: 'right' })
  b.text('VIBE', 1455.6, 91.6, { size: 3.2, align: 'right' })
  b.text('ENS', 1455.6, 98.7, { size: 3.2, align: 'right' })
  b.text('FLAM', 1463, 88.1, { size: 3.2, align: 'left' })
  b.text('SPACE', 1463, 95.2, { size: 3.2, align: 'left' })
  b.button('delay-effects', 'Delay effects', 1458, 110, { w: 22, states: [[], [dchor], [dvibe], [dens]], names: ['unlit', 'CHOR', 'VIBE', 'ENS'] })
  b.led('delay-variation', 1449.2, 122.4)
  b.text('VARIATION▽', 1452.6, 122.4, { size: 3.1, align: 'left' })
  b.knob('delay-feedback', 'Delay feedback', 1499.9, 84.1, 17, { initial: 50 })
  b.led('delay-feedback', 1486.2, 98.6)
  b.text('FEEDBACK', 1489.6, 98.6, { size: 3.2, align: 'left' })
  b.text('FILTER', 1495, 106.4, { size: 3.2 })
  const dhp = b.led('delay-hp', 1495.6, 112.4)
  const dlp = b.led('delay-lp', 1495.6, 119.4)
  b.text('HP', 1492, 112.4, { size: 3.2, align: 'right' })
  b.text('BP', 1499.2, 115.8, { size: 3.2, align: 'left' })
  b.text('LP', 1492, 119.4, { size: 3.2, align: 'right' })
  b.button('delay-filter', 'Delay filter (Ping Pong with Shift)', 1494.9, 131.3, { w: 22, states: [[], [dhp], [dlp], [dhp, dlp]], names: ['unlit', 'HP', 'LP', 'BP'] })
  b.text('PING PONG▽', 1491, 140.8, { size: 3.1 })
  b.led('delay-ping-pong', 1511.6, 133.4)
  b.box(1405.5, 128.9, 1436, 161.5, { fill: 'light', outline: 'none' })
  b.led('delay-tap', 1411, 133.4)
  b.text('TAP/SET▼', 1414.4, 133.4, { size: 3.1, align: 'left', tone: 'dark' })
  b.button('delay-tap', 'Delay tap tempo', 1420.7, 144.8, { w: 22 })
  b.led('delay-analog', 1411, 156.9)
  b.text('ANALOG▽', 1414.4, 156.9, { size: 3.1, align: 'left', tone: 'dark' })
  b.knob('delay-dry-wet', 'Delay dry/wet', 1459.7, 149.1, 17, { initial: 40 })
  b.text('DRY', 1450.6, 163.4, { size: 3.2 })
  b.text('WET', 1469, 163.4, { size: 3.2 })
  b.text('ON', 1482, 150.4, { size: 3.3 })
  const don = b.led('delay-on', 1482, 155.6)
  b.button('delay-on', 'Delay on', 1498, 155.1, { style: 'light', w: 21, h: 11, toggle: don })
  b.led('delay-global', 1487.6, 166.6)
  b.text('GLOBAL▽', 1500.6, 166.6, { size: 3, boxed: 'red' })

  b.box(1397.6, 170.4, 1440.5, 251, { title: 'COMP' })
  b.led('comp-active', 1405.6, 180)
  b.text('ACTIVE', 1409, 180, { size: 3.2, align: 'left' })
  b.knob('comp-amount', 'Compressor amount', 1420, 195.3, 17, { initial: 50 })
  b.text('AMOUNT', 1420, 211.4, { size: 3.2 })
  b.led('comp-fast', 1410.4, 216.6)
  b.text('FAST', 1414, 216.6, { size: 3.2, align: 'left' })
  b.text('ON', 1403.6, 228.8, { size: 3.3 })
  const con = b.led('comp-on', 1403.6, 234.3)
  b.button('comp-on', 'Compressor on', 1420, 234.3, { w: 20, toggle: con })
  b.led('comp-global', 1409.4, 245.8)
  b.text('GLOBAL▽', 1422.4, 245.8, { size: 3, boxed: 'red' })

  b.box(1440.5, 170.4, 1519.4, 251, { title: 'REVERB' })
  const rb = b.led('reverb-bright', 1447.6, 180)
  const rd = b.led('reverb-dark', 1447.6, 187.4)
  b.text('BRIGHT', 1451, 180, { size: 3.2, align: 'left' })
  b.text('DARK', 1451, 187.4, { size: 3.2, align: 'left' })
  b.button('reverb-tone', 'Reverb tone', 1457.3, 199.5, { w: 22, states: [[], [rb], [rd]], names: ['unlit', 'BRIGHT', 'DARK'] })
  matrix('reverb', 'reverb-type', 'Reverb type', ['ROOM', 'BOOTH', 'SPRING'], ['STAGE', 'HALL', 'CATH'], 1493.4, 179.3, 1492.8, 206.6, [undefined, undefined, undefined])
  b.text('VAR|CHORALE▽', 1488.6, 215.8, { size: 3 })
  b.led('reverb-variation', 1512, 207.6)
  b.knob('reverb-dry-wet', 'Reverb dry/wet', 1459.7, 231.8, 17, { initial: 45 })
  b.text('DRY', 1450.6, 245.9, { size: 3.2 })
  b.text('WET', 1469, 245.9, { size: 3.2 })
  b.text('ON', 1482, 228.8, { size: 3.3 })
  const ron = b.led('reverb-on', 1482, 234.3)
  b.button('reverb-on', 'Reverb on', 1498, 234.3, { style: 'light', w: 21, h: 11, toggle: ron })
  b.led('reverb-global', 1487.6, 245.8)
  b.text('GLOBAL▽', 1500.6, 245.8, { size: 3, boxed: 'red' })

  b.text('HANDMADE IN SWEDEN BY CLAVIA DMI AB   v2.0 Rev.B', 1523, 190, { size: 2.7, rotate: -90, weight: 600 })
  b.led('split-1', 1305.7, 258.3)
  b.led('split-2', 1446.6, 258.3)
}

function buildPanel(): PanelData {
  const out = emptyPanel()
  buildPerformance(out)
  buildOrgan(out)
  buildPiano(out)
  buildProgram(out)
  buildSynth(out)
  buildEffects(out)
  resolveLedOwners(out)
  return out
}

export const PANEL: PanelData = buildPanel()

/** Photo x (design px) → instrument x, via whichever section covers it. */
export function photoToInstrumentX(photoX: number): number {
  const sec = SECTIONS.find((s) => photoX >= s.photo[0] && photoX < s.photo[1]) ?? (photoX < SECTIONS[0].photo[0] ? SECTIONS[0] : SECTIONS[SECTIONS.length - 1])
  return photoToSectionX(sec, photoX)
}

/** Printed rear-panel legends along the top rail (not controls). */
export const RAIL_LEGENDS: { text: string[]; x: number; y: number }[] = [
  { text: ['MONITOR', 'IN'], x: 218.3, y: 41 },
  { text: ['HEADPHONES'], x: 237.9, y: 41 },
  { text: ['OUT 1'], x: 262.7, y: 41 },
  { text: ['—'], x: 275.1, y: 41 },
  { text: ['OUT 2'], x: 287.6, y: 41 },
  { text: ['OUT 3'], x: 311.7, y: 41 },
  { text: ['—'], x: 324.1, y: 41 },
  { text: ['OUT 4'], x: 336.5, y: 41 },
  { text: ['CONTROL', 'PEDAL'], x: 361, y: 41 },
  { text: ['ORGAN', 'SWELL'], x: 385.2, y: 41 },
  { text: ['SUSTAIN', 'PEDAL'], x: 402.9, y: 41 },
  { text: ['TRIPLE', 'PEDAL'], x: 438.4, y: 41 },
  { text: ['MIDI IN'], x: 580.2, y: 41 },
  { text: ['MIDI OUT'], x: 611, y: 41 },
  { text: ['ROTOR PEDAL'], x: 640.5, y: 41 },
  { text: ['USB'], x: 665.4, y: 41 },
  { text: ['FOOT SWITCH'], x: 686.7, y: 41 },
  { text: ['AC IN'], x: 984, y: 41 },
  { text: ['POWER ON/OFF'], x: 1053.9, y: 41 },
].map((l) => ({ ...l, x: Math.round(photoToInstrumentX(l.x) * 10) / 10 }))

/** Rear jack tops and handles that peek above the chassis (photo x, design px). */
export const REAR_JACKS: number[] = [49.7, 94, 255, 275, 300, 325, 350, 374.5, 399, 422, 546.5, 575, 644, 798.5, 985, 1055].map(photoToInstrumentX)
export const REAR_HANDLES: [number, number][] = [
  [470.7, 496.4],
  [1088.5, 1127.6],
].map(([a, b]) => [photoToInstrumentX(a), photoToInstrumentX(b)])
