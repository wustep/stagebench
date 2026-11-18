import { pitchSteps } from '../piano/settings'
import type { Box, ButtonControl, Control, Lamp, Legend, Panel, Plate, SectionId } from './model'

function panel() {
  const data: Panel = { controls: [], legends: [], lamps: [], plates: [] }
  const label = (x: number, y: number, text: string, style?: Legend['style']) =>
    data.legends.push({ x, y, text, style })
  const plate = (box: Box, title?: string, style?: Plate['style']) =>
    data.plates.push({ box, title, style })
  const lamp = (left: number, top: number, color: Lamp['color'] = 'red', on = false, controlId?: string) =>
    data.lamps.push({ left, top, color, on, controlId })
  const button = (
    id: string, name: string, box: Box, legend?: string,
    options: Pick<ButtonControl, 'style' | 'led'> & { initial?: boolean; legendAbove?: boolean } = {},
  ) => {
    const { legendAbove, initial = false, ...appearance } = options
    data.controls.push({ type: 'button', id, name, box, initial, ...appearance })
    if (legend) label(box[0] + box[2] / 2, legendAbove ? box[1] - 5 : box[1] + box[3] + 4, legend)
  }
  const knob = (id: string, name: string, x: number, y: number, legend: string, size = 36, initial = 5) => {
    data.controls.push({
      type: 'knob', id, name, box: [x - size / 2, y - size / 2, size, size],
      initial, maximum: 10, legend,
    })
    if (legend) label(x, y + size / 2 + 3, legend)
  }
  const indicatorList = (x: number, y: number, steps: string[], active: number, spacing = 8, bindings?: string[]) => {
    steps.forEach((step, index) => {
      lamp(x - 4, y + index * spacing + 2, 'red', index === active, bindings?.[index])
      label(x + 14, y + index * spacing, step, 'tiny')
    })
  }
  return { data, plate, label, lamp, button, knob, indicatorList }
}

const performance = panel()
{
  const { data, plate, label, lamp, button, knob } = performance
  label(220, 67, 'MASTER LEVEL')
  knob('master-level', 'Master Level', 220, 88, '', 36, 3)
  data.controls.push(
    { type: 'stick', id: 'pitch-stick', name: 'Pitch Stick', box: [61, 92, 53, 31], initial: pitchSteps / 2, maximum: pitchSteps, style: 'wood' },
    { type: 'wheel', id: 'mod-wheel', name: 'Modulation Wheel', box: [126, 120, 35, 89], initial: 2, maximum: 10 },
  )
  plate([198, 121, 48, 165], 'ROTARY\nSPEAKER', 'red')
  knob('rotary-drive', 'Rotary Speaker Drive', 216, 151, 'DRIVE', 31, 3)
  button('rotary-on', 'Rotary Speaker On', [226, 130, 14, 10], 'ON', { led: 'red' })
  button('rotary-organ', 'Rotary Speaker Organ', [208, 184, 28, 15], 'CLOSE MIC ▾', { style: 'light' })
  label(220, 175, 'ORGAN')
  lamp(207, 177, 'red', true, 'rotary-organ')
  button('rotary-stop', 'Rotary Speaker Stop Mode', [207, 221, 30, 15], 'ANGLE')
  label(223, 212, 'STOP MODE')
  button('rotary-speed', 'Rotary Speaker Slow / Fast', [207, 257, 30, 16], 'MORPH')
  label(223, 249, 'SLOW    FAST')
  lamp(207, 252, 'green', true, 'rotary-slow')
  lamp(233, 252, 'red', false, 'rotary-fast')
}

function addHeader(p: ReturnType<typeof panel>, id: SectionId, title: string, x: number, width: number) {
  p.plate([x, 55, width, 24], undefined, 'silver')
  p.label(x + 4, 60, title, 'title')
  if (id !== 'effects') p.label(x + 4, 70, 'SECTION', 'dark')
  const onX = x + (id === 'effects' ? 113 : 92)
  p.button(`${id}-section-on`, `${title} Section On`, [onX, 57, 28, 16], undefined, { initial: id === 'piano' || id === 'effects' })
  p.lamp(onX - 5, 67, 'red', false, `${id}-section-on`)
  p.label(onX - 5, 60, 'ON', 'dark')
  if (id === 'effects') {
    p.label(x + 19, 73, 'FX FOCUS', 'dark')
  } else {
    p.label(onX - 35, 60, 'FX FOCUS', 'dark')
    p.lamp(onX - 35, 68, 'amber', id === 'piano', id === 'piano' ? 'piano-fx-focus' : `fx-focus:${id === 'organ' ? 'Organ' : 'Synth'}`)
    p.label(onX + 38, 65, 'SOLO ▾', 'dark')
  }
}

function addLayers(p: ReturnType<typeof panel>, id: 'organ' | 'piano' | 'synth', x: number, values: number[]) {
  const name = id[0].toUpperCase() + id.slice(1)
  values.forEach((initial, index) => {
    const layer = 'ABC'[index]
    const left = x + index * 35
    p.data.controls.push({
      type: 'fader', id: `${id}-layer-${layer.toLowerCase()}-level`,
      name: `${name} Layer ${layer} Level`, box: [left, 73, 30, 81], initial, maximum: 12,
    })
    p.label(left + 15, 160, `${layer}  AUX KB`, 'tiny')
    p.button(`${id}-layer-${layer.toLowerCase()}-focus`, `Focus ${name} Layer ${layer}`,
      [left, 154, 29, 13], undefined, { style: 'indicator', led: 'amber' })
    p.button(`${id}-layer-${layer.toLowerCase()}-on`, `${name} Layer ${layer} On / Off`,
      [left, 178, 28, 15], undefined, { style: 'light', initial: index === 0 })
    p.plate([left, 169, 28, 7], 'ON/OFF ▾', 'silver')
    p.lamp(left + 3, 173, id === 'synth' ? 'amber' : 'green', false, `${id}-layer-${layer.toLowerCase()}-on`)
  })
  p.label(x + 13, 198, 'SUSTPED', 'tiny')
  p.label(x + 49, 198, id === 'synth' ? 'PSTICK/RNG ▾' : 'PSTICK', 'tiny')
  p.button(`${id}-sustped`, `${name} SUSTPED`, [x - 3, 193, 30, 13], undefined, { style: 'indicator' })
  p.button(`${id}-pstick`, `${name} PSTICK`, [x + 32, 193, 30, 13], undefined, { style: 'indicator' })
}

function addOctave(p: ReturnType<typeof panel>, id: string, name: string, x: number) {
  p.label(x + 28, 248, '◀ OCTAVE SHIFT ▶')
  p.button(`${id}-octave-down`, `${name} Octave Shift Down`, [x, 255, 28, 15])
  p.button(`${id}-octave-up`, `${name} Octave Shift Up`, [x + 28, 255, 28, 15])
  p.label(x + 28, 273, '◀ KB ZONE ▶', 'tiny')
  for (let index = 0; index < 4; index++) p.lamp(x + 15 + index * 8, 280, 'green', false, `zone-${id}:${index}`)
}

const organ = panel()
{
  const { data, plate, label, lamp, button, indicatorList } = organ
  plate([246, 66, 337, 221], undefined, 'panel')
  addHeader(organ, 'organ', 'ORGAN', 246, 141)
  addLayers(organ, 'organ', 247, [9, 7])
  plate([326, 83, 62, 63], 'ORGAN MODEL', 'outline')
  plate([387, 83, 84, 63], 'VIB / CHORUS', 'outline')
  plate([470, 83, 105, 63], 'B3 PERCUSSION', 'outline')
  indicatorList(345, 98, ['FARF  ▸  PIPE 1', 'VOX  ▸  PIPE 2', 'B3  ▸  B3 BASS'], 2, 8, ['Farf', 'Vox', 'B3'].map((name) => `organ-model:${name}`))
  ;['Pipe 1', 'Pipe 2', 'B3 Bass'].forEach((name, index) => lamp(383, 100 + index * 8, 'red', false, `organ-model:${name}`))
  button('organ-model', 'Organ Model', [340, 123, 29, 16])
  button('organ-vibrato-type', 'Organ Vibrato / Chorus Type', [396, 99, 28, 16])
  label(444, 101, 'C2   V3   C3')
  label(444, 117, 'V2   C1   V1')
  ;['C2', 'V3', 'C3', 'V2', 'C1', 'V1'].forEach((name, index) =>
    lamp(433 + index % 3 * 11, 109 + Math.floor(index / 3) * 13, 'red', false, `organ-chorus:${name}`))
  button('organ-vibrato-on', 'Organ Vibrato / Chorus On', [409, 128, 29, 15], undefined, { style: 'light', initial: true })
  lamp(404, 137, 'red', false, 'organ-vibrato-on')
  ;(['Volume', 'Decay', 'Harmonic'] as const).forEach((name, index) => {
    const x = 473 + index * 32
    label(x + 14, 89, name.toUpperCase(), 'tiny')
    label(x + 14, 97, ['SOFT', 'FAST', 'THIRD'][index], 'tiny')
    button(`organ-percussion-${name.toLowerCase()}`, `Organ Percussion ${name}`, [x, 102, 28, 15])
  })
  button('organ-percussion-on', 'Organ Percussion On', [537, 128, 29, 15], undefined, { style: 'light' })
  button('organ-preset', 'Organ Preset', [265, 220, 30, 16], 'SYNC ▾')
  label(281, 213, 'PRESET')
  addOctave(organ, 'organ', 'Organ', 250)
  const footage = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′']
  const alternate = ['BASS16', 'STR16', 'FLUTE8', 'OBOE8', 'TRMP8', 'STR8', 'FLUTE4', 'STR4', '2 / 3']
  footage.forEach((legend, index) => {
    const x = 315 + index * 29
    data.controls.push({
      type: 'drawbar', id: `organ-drawbar-${index + 1}`, name: `Organ Drawbar ${index + 1} (${legend})`,
      box: [x, 160, 26, 116], maximum: 8, initial: [8, 5, 8, 4, 3, 5, 8, 5, 5][index],
      style: [2, 3, 5, 8].includes(index) ? 'white' : 'dark',
    })
    label(x + 15, 153, alternate[index], 'tiny')
    label(x + 12, 281, legend)
  })
}

const piano = panel()
{
  const { plate, label, lamp, button, knob, indicatorList } = piano
  plate([587, 66, 145, 221], undefined, 'panel')
  addHeader(piano, 'piano', 'PIANO', 587, 143)
  addLayers(piano, 'piano', 589, [12, 5])
  label(680, 81, 'ACOUSTICS')
  indicatorList(668, 91, ['SOFT REL', 'STRING RES'], 1, 8, ['piano-acoustic:Soft', 'piano-acoustic:String'])
  button('piano-acoustics', 'Piano Acoustics', [665, 105, 28, 15], 'PED NOISE ▾')
  label(713, 82, 'UNISON')
  label(712, 95, '2\n1    3', 'tiny')
  lamp(700, 99, 'red', false, 'piano-unison:1')
  lamp(712, 91, 'red', false, 'piano-unison:2')
  lamp(724, 99, 'red', false, 'piano-unison:3')
  button('piano-unison', 'Piano Unison', [701, 105, 25, 15])
  label(676, 135, 'KB TOUCH')
  label(676, 147, 'HVY    LT', 'tiny')
  lamp(665, 151, 'red', false, 'piano-touch:Heavy')
  lamp(678, 144, 'red', true, 'piano-touch:Medium')
  lamp(691, 151, 'red', false, 'piano-touch:Light')
  button('piano-kb-touch', 'Piano Keyboard Touch', [665, 157, 27, 15])
  label(713, 135, 'DYN COMP')
  label(712, 145, '2\n1    3', 'tiny')
  lamp(700, 149, 'red', false, 'piano-dynamics:1')
  lamp(712, 141, 'red', false, 'piano-dynamics:2')
  lamp(724, 149, 'red', false, 'piano-dynamics:3')
  button('piano-dyn-comp', 'Piano Dynamic Compression', [701, 157, 25, 15])
  label(629, 210, 'TIMBRE')
  indicatorList(619, 219, ['BRIGHT • DYNO 1', 'MID • DYNO 2', 'SOFT'], -1, 8, ['piano-timbre:Bright', 'piano-timbre:Mid', 'piano-timbre:Soft'])
  button('piano-timbre', 'Piano Timbre', [598, 214, 15, 29])
  addOctave(piano, 'piano', 'Piano', 594)
  plate([665, 177, 63, 106], 'PIANO SELECT', 'outline')
  label(680, 187, 'ELECTRIC\nUPRIGHT\nGRAND', 'tiny')
  label(713, 187, 'CLAV\nDIGITAL\nMISC', 'tiny')
  ;['Electric', 'Upright', 'Grand', 'Clav', 'Digital', 'Misc'].forEach((type, i) =>
    lamp(i < 3 ? 669 : 701, 189 + (i % 3) * 5.7, 'red', type === 'Upright', `piano-type:${type}`))
  button('piano-type', 'Piano Type', [681, 210, 28, 15], 'INFO')
  knob('piano-model', 'Piano Model Selector', 696, 260, 'MODEL  LIST', 30, 4)
}

const program = panel()
{
  const { data, plate, label, lamp, button, knob } = program
  plate([743, 57, 87, 37], 'MORPH ASSIGN', 'panel')
  ;['Wheel', 'A.T.', 'Ctrl Pedal'].forEach((name, index) => {
    const left = 746 + 28 * index
    label(left + 12, 68, name.toUpperCase())
    button(`morph-${['wheel', 'aftertouch', 'control-pedal'][index]}`, `Morph Assign ${name}`, [left, 74, 26, 15])
  })
  label(786, 93, 'CLEAR MORPH', 'tiny')
  ;[
    ['split', 'Split', 840, 'SET KEY'],
    ['master-clock', 'Master Clock', 878, 'PEDAL TAP'],
    ['transpose', 'Transpose', 916, 'PANIC'],
  ].forEach(([id, name, x, legend]) => {
    plate([Number(x), 57, 31, 7], String(id === 'master-clock' ? 'MST CLK' : name).toUpperCase(), 'silver')
    button(`program-${id}`, String(name), [Number(x), 74, 29, 15], String(legend), { led: 'red' })
  })
  button('program-store', 'Store Program', [745, 112, 29, 15], 'STORE AS…', { style: 'red', led: 'red' })
  label(759, 105, 'STORE')
  lamp(789, 113, 'red')
  label(790, 124, 'MIDI', 'tiny')
  lamp(789, 132, 'red')
  label(790, 137, 'EXTERN', 'tiny')
  plate([801, 106, 96, 34], 'PRESET LIBRARY', 'silver')
  ;['Organ', 'Piano', 'Synth'].forEach((name, index) => {
    label(815 + index * 28, 111, name.toUpperCase(), 'dark')
    button(`program-library-${name.toLowerCase()}`, `${name} Preset Library`, [805 + 28 * index, 118, 26, 15])
  })
  label(867, 135, 'SINGLE LAYER', 'dark')
  data.readout = { kind: 'program', box: [796, 145, 102, 55] }
  knob('program-dial', 'Program Dial', 766, 159, 'PROGRAM  LIST', 31, 4)
  label(765, 182, '◀ PAGE / CAT ▶')
  button('program-page-down', 'Previous Program Page', [737, 187, 28, 15])
  button('program-page-up', 'Next Program Page', [765, 187, 28, 15])
  label(765, 205, '◀ BANK ▶')
  button('program-live-mode', 'Live Mode', [744, 220, 29, 15], 'NUM PAD', { style: 'light' })
  label(759, 213, 'LIVE MODE')
  button('program-layer-scene', 'Layer Scene', [744, 259, 29, 15], 'PEDAL')
  label(759, 246, 'LAYER\nSCENE II')
  plate([786, 214, 121, 69], 'PROGRAM', 'panel')
  Array.from({ length: 8 }, (_, index) => {
    const x = 790 + (index % 4) * 28
    const y = 231 + Math.floor(index / 4) * 29
    button(`program-slot-${index + 1}`, `Program ${index + 1}`, [x, y, 26, 15],
      ['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB', 'OUTPUT', 'PEDAL', 'MIDI', 'EXTERN'][index],
      { initial: index === 0, led: 'red' })
    label(x + 19, y - 6, String(index + 1), 'tiny')
  })
  plate([913, 129, 34, 106], undefined, 'red')
  button('program-view', 'Program View', [917, 106, 27, 15], 'PRESET NAME')
  button('program-solo', 'Program Solo', [917, 144, 27, 15], 'UNDO', { led: 'red' })
  label(933, 134, 'SOLO')
  button('program-section-edit', 'Section Edit', [917, 177, 27, 15], 'LAYER INIT', { led: 'red' })
  label(932, 165, 'SECTION\nEDIT ▾')
  button('program-copy', 'Monitor / Copy', [917, 210, 27, 15], 'PASTE ▾')
  label(931, 205, 'MON/COPY', 'tiny')
  plate([921, 239, 22, 43], 'SHIFT', 'silver')
  button('program-shift', 'Program Shift', [926, 248, 13, 26], 'EXIT', { style: 'light' })
}

const synth = panel()
{
  const { data, plate, label, lamp, button, knob, indicatorList } = synth
  plate([954, 66, 425, 221], undefined, 'panel')
  addHeader(synth, 'synth', 'SYNTH', 954, 181)
  addLayers(synth, 'synth', 957, [12, 3, 9])
  button('synth-kb-hold', 'Synth Keyboard Hold', [956, 218, 28, 15], 'EXCLUDE ▾', { led: 'red' })
  button('synth-arp-run', 'Synth Arpeggiator Run', [992, 218, 28, 15], 'KB SYNC ▾', { style: 'red' })
  label(970, 209, 'KB HOLD')
  label(1006, 209, 'ARP RUN')
  addOctave(synth, 'synth', 'Synth', 963)
  data.readout = { kind: 'synth', box: [1084, 81, 102, 54] }
  ;[
    ['osc-type', 'Oscillator Type', 1088, 'INFO', 5],
    ['osc-category', 'Oscillator Category', 1136, 'LIST', 3],
    ['osc-wave', 'Oscillator Waveform', 1183, 'LIST', 7],
  ].forEach(([id, name, position, legend, value]) => {
    knob(`synth-${id}`, `Synth ${name}`, Number(position), 178, String(legend), 30, Number(value))
    plate([Number(position) - 1, 140, 1.4, 20], undefined, 'silver')
  })
  plate([1192, 78, 40, 52], 'MODE', 'silver')
  label(1214, 88, 'SAMPLES', 'dark')
  label(1214, 98, 'ANALOG', 'dark')
  lamp(1198, 98, 'red', true)
  button('synth-mode', 'Synth Oscillator Mode', [1198, 104, 27, 15])
  label(1212, 123, 'EXTERN', 'dark')
  label(1217, 142, 'WAVEFORM')
  button('synth-waveform', 'Synth Waveform', [1210, 151, 16, 31], 'SOUND INIT', { led: 'red' })

  plate([1235, 79, 139, 58], 'ARPEGGIATOR / GATE', 'outline')
  knob('synth-arp-rate', 'Arpeggiator Rate / Time', 1256, 103, 'RATE/TIME', 34, 6)
  label(1256, 130, 'MST CLK', 'inverse')
  label(1294, 94, 'POLY    GATE', 'tiny')
  label(1293, 104, 'ARP', 'tiny')
  button('synth-arp-mode', 'Arpeggiator Mode', [1280, 108, 30, 15], 'PATTERN ▾')
  knob('synth-arp-range', 'Arpeggiator Range', 1335, 103, 'RANGE ENV', 33, 4)
  button('synth-arp-menu', 'Arpeggiator Menu', [1358, 98, 16, 26], 'GROUP ▾', { led: 'red' })
  label(1365, 88, 'MENU')

  plate([1235, 143, 84, 54], 'VOICE', 'outline')
  label(1257, 153, 'MONO')
  label(1257, 162, 'LEGATO')
  button('synth-voice-mode', 'Synth Voice Mode', [1239, 171, 28, 15], 'LO V   HI V')
  knob('synth-glide', 'Synth Glide', 1296, 171, 'GLIDE', 33, 6)
  plate([1320, 143, 54, 54], 'VIBRATO', 'outline')
  label(1347, 153, 'WHL    A.T.', 'tiny')
  label(1347, 162, 'DLY    PED', 'tiny')
  button('synth-vibrato', 'Synth Vibrato', [1320, 170, 29, 16])
  button('synth-vibrato-menu', 'Synth Vibrato Menu', [1356, 159, 15, 31], undefined, { led: 'red' })

  plate([1030, 202, 85, 80], 'LFO', 'silver')
  label(1050, 208, 'WAVEFORM', 'dark')
  button('synth-lfo-wave', 'LFO Waveform', [1036, 213, 28, 15], 'GROUP ▾', { led: 'red' })
  knob('synth-lfo-amount', 'LFO Modulation Amount', 1097, 225, 'MOD AMT', 33, 7)
  knob('synth-lfo-rate', 'LFO Rate / Time', 1053, 256, 'RATE/TIME', 32, 4)
  button('synth-lfo-target', 'LFO Modulation Target', [1083, 263, 28, 15])
  indicatorList(1088, 246, ['OSC CTRL', 'FILTER'], -1, 7, ['synth-lfo-target:Osc Ctrl', 'synth-lfo-target:Filter Freq'])
  label(1054, 279, 'MST CLK', 'inverse')

  plate([1119, 202, 102, 80], 'OSCILLATORS', 'silver')
  label(1145, 208, 'PITCH / SMP', 'dark')
  label(1194, 208, 'ENVELOPE', 'dark')
  button('synth-osc-pitch-mode', 'Oscillator Pitch / Sample Mode', [1132, 213, 30, 15], 'ENV TO PTCH ▾', { led: 'red' })
  button('synth-osc-envelope', 'Oscillator Envelope', [1179, 213, 30, 15], 'VELOCITY ▾', { led: 'red' })
  knob('synth-osc-control', 'Oscillator Control', 1144, 258, 'OSC CTRL', 38, 4)
  knob('synth-osc-envelope-amount', 'Oscillator Envelope Amount', 1195, 258, 'ENV AMT', 31, 6)

  plate([1224, 202, 119, 80], 'FILTER', 'silver')
  label(1243, 208, 'TYPE', 'dark')
  label(1285, 208, 'ENVELOPE', 'dark')
  button('synth-filter-type', 'Filter Type', [1229, 213, 30, 15], 'GROUP ▾', { led: 'red' })
  button('synth-filter-envelope', 'Filter Envelope', [1271, 213, 30, 15], 'VELOCITY ▾', { led: 'red' })
  knob('synth-filter-envelope-amount', 'Filter Envelope Amount', 1322, 220, 'ENV AMT', 33, 5)
  knob('synth-filter-frequency', 'Filter Frequency', 1244, 258, 'FREQ', 37, 4)
  knob('synth-filter-resonance', 'Filter Resonance / Keyboard Tracking', 1297, 258, 'RES / KB TRK', 32, 5)
  label(1326, 246, 'FILTER ON', 'dark')
  button('synth-filter-on', 'Filter On', [1319, 249, 14, 25], undefined, { led: 'red' })

  plate([1345, 202, 31, 80], 'AMP', 'panel')
  label(1360, 207, 'ENVELOPE')
  button('synth-amp-envelope', 'Amplifier Envelope', [1348, 213, 25, 15], 'VELOCITY ▾', { led: 'red' })
  label(1359, 245, 'UNISON')
  label(1359, 255, '1   2   3', 'tiny')
  lamp(1359, 251, 'red', false, 'synth-unison:')
  button('synth-unison', 'Synth Unison', [1347, 265, 27, 15])
}

const effects = panel()
{
  const { plate, label, lamp, button, knob, indicatorList } = effects
  plate([1386, 66, 330, 221], undefined, 'panel')
  plate([1386, 78, 33, 206], undefined, 'red')
  addHeader(effects, 'effects', 'LAYER EFFECTS', 1386, 154)
  ;['Organ', 'Piano', 'Synth'].forEach((name, index) => {
    const y = 91 + index * 46
    label(1402, y, name.toUpperCase())
    label(1402, y + 13, ['A B', 'A     B', 'A  B  C'][index])
    lamp(1399, y + 9, 'amber', index === 1, index === 1 ? 'fx-piano:A' : index === 2 ? 'fx-synth:A' : `fx-focus:${name}`)
    lamp(1408, y + 9, 'amber', false, index === 1 ? 'fx-piano:B' : index === 2 ? 'fx-synth:B' : undefined)
    if (index === 2) lamp(1415, y + 9, 'amber', false, 'fx-synth:C')
    button(`effects-focus-${name.toLowerCase()}`, `Effects Focus ${name}`, [1387, y + 19, 30, 15],
      index === 0 ? 'ALL FX OFF' : 'GROUP ▾')
  })
  plate([1392, 240, 21, 42], 'SHIFT', 'silver')
  button('effects-shift', 'Effects Shift', [1396, 249, 13, 25], 'EXIT', { style: 'light' })

  for (const [index, y] of [77, 134].entries()) {
    const group = `effects-mod-${index + 1}`
    const name = `Mod ${index + 1}`
    plate([1421, y, 160, 59], name.toUpperCase(), 'outline')
    knob(`${group}-rate`, `${name} Rate`, 1445, y + 25, 'RATE', 36, index === 0 ? 3 : 6)
    knob(`${group}-amount`, `${name} Amount`, 1493, y + 25, 'AMOUNT', 36, index === 0 ? 6 : 4)
    const labels = index === 0 ? ['RM   A-WAH', 'TREM   WAH', 'A-PAN   PUMP'] : ['CHOR   VIBE', 'FLANG   ENS', 'PHAS   SPIN']
    const names = index === 0 ? ['Ring Mod', 'Tremolo', 'A-Pan', 'A-Wah', 'Wah', 'Pump']
      : ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
    indicatorList(1531, y + 9, labels, index === 0 ? 2 : 0, 8, names.slice(0, 3).map((type) => `fx-mod${index + 1}:${type}`))
    names.slice(3).forEach((type, i) => lamp(1571, y + 11 + i * 8, 'red', false, `fx-mod${index + 1}:${type}`))
    button(`${group}-variation`, `${name} Type`, [1519, y + 36, 29, 15], 'VARIATION ▾')
    label(1567, y + 21, 'ON')
    button(`${group}-on`, `${name} On`, [1562, y + 26, 14, 26], undefined, { style: 'light', led: 'red' })
    if (index === 0) {
      label(1446, y + 51, 'MST CLK', 'inverse')
      button('effects-mod-1-sync', 'Mod 1 Clock Sync', [1424, y + 46, 42, 12], undefined, { style: 'indicator' })
    }
  }

  plate([1421, 193, 160, 90], 'AMP SIM / EQ', 'outline')
  knob('effects-amp-drive', 'Amp Simulator Drive', 1445, 215, 'DRIVE', 36, 4)
  knob('effects-eq-frequency', 'EQ Mid Frequency', 1494, 215, 'FREQ', 36, 5)
  indicatorList(1530, 197, ['SMALL   ROTARY', 'JC   LP FILTER', 'TWIN   HP FILTER'], 2, 8, ['fx-amp:Small', 'fx-amp:JC', 'fx-amp:Twin'])
  ;['To Rotary', 'LP24 Filter', 'HP24 Filter'].forEach((type, i) => lamp(1574, 199 + i * 8, 'red', false, `fx-amp:${type}`))
  button('effects-amp-variation', 'Amp Simulator Type', [1527, 221, 29, 15], 'VARIATION ▾')
  label(1568, 239, 'ON')
  button('effects-amp-on', 'Amp Simulator On', [1561, 244, 15, 27], undefined, { style: 'light', led: 'red' })
  knob('effects-eq-bass', 'EQ Bass', 1445, 262, 'BASS', 35, 7)
  knob('effects-eq-mid', 'EQ Mid', 1494, 262, 'MID  RES', 35, 5)
  knob('effects-eq-treble', 'EQ Treble', 1541, 262, 'TREBLE', 35, 5)

  plate([1581, 77, 132, 114], 'DELAY', 'outline')
  knob('effects-delay-tempo', 'Delay Tempo', 1604, 105, 'TEMPO', 36, 4)
  label(1604, 133, 'MST CLK', 'inverse')
  button('effects-delay-sync', 'Delay Clock Sync', [1583, 127, 43, 13], undefined, { style: 'indicator' })
  knob('effects-delay-feedback', 'Delay Feedback', 1693, 95, 'FEEDBACK', 35, 6)
  indicatorList(1648, 88, ['CHOR', 'VIBE   FLAM', 'ENS   SPACE'], 1)
  button('effects-delay-variation', 'Delay Variation', [1635, 119, 29, 15], 'VARIATION ▾')
  plate([1588, 143, 35, 38], 'TAP / SET ▾', 'silver')
  button('effects-delay-tap', 'Delay Tap / Set', [1592, 153, 28, 15])
  label(1606, 176, 'ANALOG ▾', 'dark')
  knob('effects-delay-mix', 'Delay Dry / Wet', 1649, 168, 'DRY   WET', 36, 3)
  label(1689, 123, 'FILTER')
  label(1690, 137, 'HP  BP  LP', 'tiny')
  ;['HP', 'BP', 'LP'].forEach((type, i) => lamp(1680 + i * 9, 134, 'red', false, `fx-delay-filter:${type}`))
  button('effects-delay-ping-pong', 'Delay Feedback Filter', [1678, 141, 29, 15], 'PING PONG ▾')
  button('effects-delay-on', 'Delay On', [1681, 168, 28, 15], 'GLOBAL ▾', { style: 'light', led: 'red' })

  lamp(1712, 178, 'amber', false, 'fx-global:delay')

  plate([1581, 193, 49, 90], 'COMP', 'outline')
  label(1602, 203, 'ACTIVE')
  knob('effects-comp-amount', 'Compressor Amount', 1606, 226, 'AMOUNT', 35, 3)
  label(1606, 250, 'FAST', 'tiny')
  button('effects-comp-fast', 'Compressor Fast', [1592, 244, 33, 12], undefined, { style: 'indicator' })
  button('effects-comp-on', 'Compressor On', [1590, 256, 29, 15], 'GLOBAL ▾', { led: 'red' })

  lamp(1624, 267, 'amber', false, 'fx-global:compressor')

  plate([1630, 193, 83, 90], 'REVERB', 'outline')
  label(1650, 204, 'BRIGHT')
  label(1650, 214, 'DARK')
  lamp(1637, 208, 'red', false, 'fx-reverb-tone:Bright')
  lamp(1637, 216, 'red', false, 'fx-reverb-tone:Dark')
  button('effects-reverb-bright', 'Reverb Bright / Dark', [1634, 220, 29, 15])
  indicatorList(1675, 201, ['ROOM   STAGE', 'BOOTH   HALL', 'SPRING   CATH'], 2, 8, ['fx-reverb:Room', 'fx-reverb:Booth', 'fx-reverb:Spring'])
  ;['Stage', 'Hall', 'Cathedral'].forEach((type, i) => lamp(1709, 203 + i * 8, 'red', false, `fx-reverb:${type}`))
  button('effects-reverb-variation', 'Reverb Type', [1673, 227, 29, 15], 'VAR | CHORALE ▾')
  knob('effects-reverb-mix', 'Reverb Dry / Wet', 1654, 260, 'DRY   WET', 35, 6)
  button('effects-reverb-on', 'Reverb On', [1682, 256, 27, 15], 'GLOBAL ▾', { style: 'light', led: 'red' })
  lamp(1711, 267, 'amber', false, 'fx-global:reverb')
}

export const panels: Record<SectionId, Panel> = {
  performance: performance.data,
  organ: organ.data,
  piano: piano.data,
  program: program.data,
  synth: synth.data,
  effects: effects.data,
}

export const panelControls: readonly Control[] = Object.values(panels).flatMap((item) => item.controls)

export const connectorLegends = [
  [246, 'MONITOR\nIN'], [270, 'HEADPHONES'], [311, 'OUT 1 — OUT 2'], [364, 'OUT 3 — OUT 4'],
  [407, 'CONTROL\nPEDAL'], [432, 'ORGAN\nSWELL'], [461, 'SUSTAIN\nPEDAL'], [494, 'TRIPLE\nPEDAL'],
  [652, 'MIDI IN'], [685, 'MIDI OUT'], [721, 'ROTOR PEDAL'], [751, 'USB'], [776, 'FOOT SWITCH'],
  [1111, 'AC IN'], [1187, 'POWER ON/OFF'],
] as const
