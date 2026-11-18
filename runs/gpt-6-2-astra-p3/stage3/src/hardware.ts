export type Section =
  'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
export type Kind = 'button' | 'knob' | 'drawbar' | 'fader' | 'pitch' | 'wheel'
export interface Control {
  id: string
  section: Section
  name: string
  kind: Kind
  x: number
  y: number
  width: number
  height: number
  legend: string
  initial: number
  finish: string
}
export interface Print {
  section: Section
  x: number
  y: number
  width: number
  height: number
  title: string
  light: boolean
}
export interface Legend {
  section: Section
  x: number
  y: number
  lines: string[]
}
export const sections = [
  { id: 'performance', name: 'Performance', x: 0, width: 245 },
  { id: 'organ', name: 'Organ', x: 245, width: 340 },
  { id: 'piano', name: 'Piano', x: 585, width: 148 },
  { id: 'program', name: 'Program', x: 733, width: 219 },
  { id: 'synth', name: 'Synth', x: 952, width: 433 },
  { id: 'effects', name: 'Layer effects', x: 1385, width: 345 },
] as const
export const controls: Control[] = []
export const groups: Print[] = []
export const legends: Legend[] = []
let section: Section = 'performance'
function control(
  name: string,
  kind: Kind,
  x: number,
  y: number,
  width: number,
  height: number,
  legend: string,
  initial: number,
  finish = 'black',
) {
  controls.push({
    id:
      section +
      '-' +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-$/, ''),
    section,
    name,
    kind,
    x,
    y,
    width,
    height,
    legend,
    initial,
    finish,
  })
}
function button(
  name: string,
  x: number,
  y: number,
  legend = name,
  finish = 'black',
  w = 24,
  h = 12,
) {
  control(name, 'button', x, y, w, h, legend, 0, finish)
}
function knob(
  name: string,
  x: number,
  y: number,
  legend = name,
  value = 60,
  size = 21,
) {
  control(name, 'knob', x, y, size, size, legend, value)
}
function group(
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  light = false,
) {
  groups.push({ section, x, y, width, height, title, light })
}
function print(x: number, y: number, ...lines: string[]) {
  legends.push({ section, x, y, lines })
}
knob('Master level', 220, 88, 'Master level', 81, 27)
control('Pitch stick', 'pitch', 84, 104, 54, 22, '', 45)
control('Modulation wheel', 'wheel', 144, 164, 18, 82, '', 0)
group(199, 124, 44, 159, 'ROTARY SPEAKER')
knob('Rotary drive', 220, 154, 'Drive', 25)
button('Rotary on', 221, 191, 'Organ', 'ivory')
button('Rotary stop mode', 221, 229, 'Stop mode')
button('Rotary speed', 221, 263, 'Slow   Fast')
function layers(start: number, count: number) {
  for (let i = 0; i < count; i++) {
    const x = start + i * 35,
      layer = String.fromCharCode(65 + i)
    control(
      'Layer ' + layer + ' level',
      'fader',
      x,
      118,
      15,
      80,
      '',
      [76, 54, 67][i],
    )
    button('Layer ' + layer + ' on', x + 7, 185, layer + '  ON/OFF', 'ivory')
    print(x + 7, 198, i === 0 ? 'SUSTPED' : i === 1 ? 'PSTICK' : 'PAN')
  }
}
function octave(x: number) {
  print(x, 249, '◂ OCTAVE SHIFT ▸')
  button('Octave down', x - 13, 261, '')
  button('Octave up', x + 13, 261, '')
  print(x, 277, 'KB ZONE ▾')
}
section = 'organ'
layers(253, 2)
group(326, 84, 56, 64, 'ORGAN MODEL')
print(354, 98, 'FARF   •   PIPE 1', 'VOX   •   PIPE 2', 'B3   ●   BASS')
button('Organ model', 354, 133, '')
group(383, 84, 80, 64, 'VIB / CHORUS')
button('Vibrato mode', 409, 106, '')
print(440, 99, 'C2  V3  C3', '•    •    •', 'V2  C1  V1')
button('Vibrato on', 424, 135, 'On', 'ivory')
group(464, 84, 116, 64, 'B3 PERCUSSION')
;['Volume', 'Decay', 'Harmonic'].forEach((n, i) =>
  button('Percussion ' + n, 486 + i * 33, 108, n),
)
button('Percussion on', 550, 135, 'On', 'ivory')
button('Organ preset', 281, 229, 'Preset')
octave(279)
const stops = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′']
stops.forEach((s, i) =>
  control(
    'Drawbar ' + (i + 1) + ' ' + s,
    'drawbar',
    326 + i * 29.1,
    218,
    21,
    101,
    s,
    [17, 44, 7, 37, 43, 30, 14, 40, 31][i],
    [
      'brown',
      'brown',
      'ivory',
      'ivory',
      'black',
      'ivory',
      'black',
      'black',
      'ivory',
    ][i],
  ),
)
section = 'piano'
layers(598, 2)
print(679, 85, 'ACOUSTICS', 'SOFT REL', 'STRING RES')
print(711, 86, 'UNISON', '2  •  3', '1  •')
button('Acoustics', 678, 112, '')
button('Unison', 713, 112, '')
print(678, 131, 'KB TOUCH', 'MED   LIGHT', 'HEAVY')
print(714, 136, 'DYN COMP', '2  •  3')
button('Keyboard touch', 678, 163, '')
button('Dynamic compression', 713, 163, '')
group(663, 176, 64, 104, 'PIANO SELECT')
print(694, 189, 'ELECTRIC  •  CLAV', 'UPRIGHT  •  DIGITAL', 'GRAND  ●  MISC')
button('Piano type', 695, 218, '')
knob('Piano model', 695, 260, 'Model', 43)
control('Timbre', 'button', 601, 227, 12, 24, 'Timbre', 0)
print(628, 217, 'BRIGHT  •', 'MID  •', 'SOFT  •')
octave(622)
section = 'program'
group(744, 57, 87, 36, 'MORPH ASSIGN', true)
;['Wheel', 'A.T.', 'Ctrlped'].forEach((n, i) =>
  button('Morph ' + n, 758 + i * 27, 80, n, 'black', 24),
)
button('Split', 852, 85, 'Split')
button('Master clock', 894, 82, 'Mst Clk')
button('Transpose', 930, 82, 'Transp')
button('Store', 759, 119, 'Store', 'red')
group(802, 104, 87, 33, 'PRESET LIBRARY', true)
;['Organ', 'Piano', 'Synth'].forEach((n, i) =>
  button('Preset ' + n, 818 + i * 26, 124, n),
)
knob('Program dial', 760, 159, 'Program', 45, 24)
button('Page previous', 748, 194, '◂ Page')
button('Page next', 774, 194, 'Cat ▸')
button('Live mode', 760, 225, 'Live Mode', 'ivory')
button('Layer scene', 760, 264, 'Layer Scene')
group(787, 214, 120, 67, 'PROGRAM')
for (let i = 0; i < 8; i++)
  button(
    'Program ' + (i + 1),
    804 + (i % 4) * 29,
    238 + Math.floor(i / 4) * 30,
    String(i + 1),
  )
;['Prog view', 'Solo', 'Section edit', 'Mon / copy'].forEach((n, i) =>
  button(n, 931, [108, 149, 186, 223][i], n),
)
control('Shift', 'button', 932, 261, 13, 26, 'Shift', 0, 'ivory')
section = 'synth'
layers(967, 3)
;['Info', 'Category', 'Waveform list'].forEach((n, i) =>
  knob(n, 1088 + i * 47, 178, '', 42 + i * 9, 23),
)
print(1209, 83, 'MODE', '•  SAMPLES', '●  ANALOG')
button('Synth mode', 1209, 111, '')
control('Sound init', 'button', 1216, 166, 13, 29, 'Waveform', 0)
group(1232, 79, 145, 60, 'ARPEGGIATOR / GATE')
knob('Arp rate', 1257, 104, 'Rate / time', 56)
button('Arp pattern', 1294, 115, 'Poly  Arp')
knob('Arp range', 1336, 104, 'Range', 47)
control('Arp menu', 'button', 1365, 108, 12, 24, 'Menu', 0)
group(1232, 144, 85, 51, 'VOICE')
button('Voice mode', 1253, 176, 'Mono  Legato')
knob('Glide', 1294, 166, 'Glide', 66)
group(1318, 144, 59, 51, 'VIBRATO')
button('Vibrato', 1336, 177, 'Whl   A.T.')
control('Vibrato menu', 'button', 1365, 172, 12, 23, 'Menu', 0)
button('KB hold', 974, 226, 'KB Hold')
button('Arp run', 1010, 226, 'Arp Run', 'red')
octave(989)
group(1032, 200, 85, 82, 'LFO', true)
button('LFO waveform', 1054, 219, 'Waveform')
knob('LFO mod amount', 1097, 223, 'Mod amt', 62)
knob('LFO rate', 1054, 255, 'Rate / time', 32)
button('LFO destination', 1095, 273, 'Osc pitch')
group(1120, 200, 96, 82, 'OSCILLATORS', true)
button('Oscillator pitch', 1144, 220, 'Pitch / Smp')
button('Oscillator envelope', 1192, 220, 'Envelope')
knob('Oscillator control', 1144, 259, 'Osc ctrl', 35)
knob('Oscillator env amount', 1192, 260, 'Env amt', 65)
group(1221, 200, 117, 82, 'FILTER', true)
button('Filter type', 1244, 220, 'Type')
button('Filter envelope', 1285, 220, 'Envelope')
knob('Filter envelope amount', 1318, 220, 'Env amt', 45)
knob('Filter frequency', 1246, 260, 'Freq', 32)
knob('Filter resonance', 1295, 260, 'Res / Freq', 53)
control('Filter on', 'button', 1325, 266, 12, 24, 'On', 0)
group(1342, 200, 36, 82, 'AMP', true)
button('Amp envelope', 1360, 220, 'Envelope')
button('Amp unison', 1360, 273, 'Unison')
section = 'effects'
;['Organ', 'Piano', 'Synth'].forEach((n, i) =>
  button('Layer focus ' + n, 1402, 117 + i * 49, n),
)
control('Effects shift', 'button', 1402, 263, 13, 26, 'Shift', 0, 'ivory')
function effectRow(y: number, n: number) {
  group(1423, y, 157, 58, 'MOD ' + n)
  knob('Mod ' + n + ' rate', 1445, y + 25, 'Rate / sens', n === 1 ? 33 : 56)
  knob('Mod ' + n + ' amount', 1493, y + 25, 'Amount', n === 1 ? 59 : 30)
  print(
    1536,
    y + 11,
    ...(n === 1
      ? ['RM  ▪  A-WAH', 'TREM  ▪  WAH', 'A-PAN  ▪  PUMP']
      : ['CHOR  ▪  VIBE', 'FLANG  ▪  ENS', 'PHAS  ▪  SPIN']),
  )
  button('Mod ' + n + ' variation', 1531, y + 40, '')
  control('Mod ' + n + ' on', 'button', 1568, y + 37, 12, 23, 'On', 0, 'ivory')
}
effectRow(78, 1)
effectRow(136, 2)
group(1423, 194, 157, 88, 'AMP SIM / EQ')
knob('Amp drive', 1445, 214, 'Drive', 35)
knob('Mid frequency', 1493, 214, '1 kHz', 48)
print(1537, 201, 'SMALL  ▪  ROTARY', 'JC  ▪  LP FILTER', 'TWIN  ▪  HP FILTER')
button('Amp variation', 1538, 228, '')
;['Bass', 'Mid', 'Treble'].forEach((n, i) =>
  knob(n, 1445 + i * 46, 260, n, 54 + i * 6),
)
control('Amp on', 'button', 1568, 255, 12, 24, 'On', 0, 'ivory')
group(1581, 78, 132, 115, 'DELAY')
knob('Delay tempo', 1606, 109, 'Tempo', 32)
knob('Delay feedback', 1694, 98, 'Feedback', 57)
print(1650, 90, 'EFFECTS', 'CHOR   ▪   FLAM', 'VIBE   ▪   SPACE', 'ENS   ▪')
button('Delay variation', 1649, 129, '')
button('Delay tap', 1606, 165, 'Tap / set')
knob('Delay mix', 1649, 167, 'Dry   Wet', 26)
button('Ping pong', 1693, 147, 'Ping pong')
button('Delay on', 1693, 174, 'On', 'ivory')
group(1581, 194, 46, 88, 'COMP')
knob('Compressor amount', 1603, 222, 'Amount', 24)
button('Compressor on', 1603, 264, 'On')
group(1628, 194, 85, 88, 'REVERB')
button('Reverb tone', 1646, 224, 'Bright')
print(1692, 201, 'BOOTH   ▪  STAGE', 'ROOM   ▪  HALL', 'SPRING   ▪  CATH')
button('Reverb variation', 1693, 232, '')
knob('Reverb mix', 1649, 261, 'Dry   Wet', 61)
button('Reverb on', 1692, 264, 'On', 'ivory')
for (const [s, x] of [
  ['organ', 369],
  ['piano', 693],
  ['synth', 1097],
  ['effects', 1513],
] as const) {
  section = s
  button('Section on', x, 65, 'On', 'black', 24)
}
// Secondary silkscreen under each control on the front panel.
section = 'performance'
print(221, 205, '● CLOSE MIC ▾')
print(221, 242, 'ANGLE')
print(221, 278, '● MORPH')
section = 'organ'
print(277, 214, '• PRESET')
print(281, 240, 'SYNC ▾')
print(486, 120, '◂ POLY ▾')
section = 'piano'
print(679, 123, '• PED NOISE ▾')
print(696, 230, 'INFO')
section = 'program'
print(761, 132, 'STORE AS ▾')
print(852, 98, 'SET KEY')
print(895, 95, '• PEDAL TAP')
print(931, 93, 'PANIC')
print(760, 181, '◂ PAGE / CAT ▸')
print(759, 207, '◂ BANK ▸')
print(760, 239, '• NUM PAD')
print(759, 279, '• PEDAL')
print(930, 120, 'PRESET NAME')
print(931, 161, 'UNDO')
print(931, 201, 'LAYER INIT')
print(931, 236, 'PASTE ▾')
;['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB'].forEach((l, i) =>
  print(804 + 29 * i, 249, l),
)
;['OUTPUT', 'PEDAL', 'MIDI', 'EXTERN'].forEach((l, i) =>
  print(804 + 29 * i, 280, l),
)
section = 'synth'
print(967, 240, '◇ EXCLUDE ▾')
print(1011, 240, 'KB SYNC ▾')
print(1088, 196, 'INFO')
print(1135, 196, 'LIST')
print(1182, 196, 'LIST')
print(1294, 133, '• PATTERN ▾')
print(1364, 133, 'GROUP ▾')
print(1254, 190, '● LOW    • HIGH')
print(1143, 236, '• ENV TO PITCH')
print(1193, 236, '• VELOCITY ▾')
print(1245, 236, 'GROUP ▾')
print(1284, 236, '• VELOCITY ▾')
section = 'effects'
print(1402, 131, 'ALL FX OFF')
print(1402, 182, 'GROUP ▾')
print(1401, 229, 'GROUP ▾')
print(1531, 129, 'VARIATION / PED ▾')
print(1532, 187, 'VARIATION ▾')
print(1649, 140, 'VARIATION ▾')
print(1605, 178, '• ANALOG ▾')
print(1604, 278, 'GLOBAL ▾')
print(1693, 279, 'GLOBAL ▾')
// The primary selector cycles types. Its printed Shift variation stays decorative.
for (const control of controls) {
  if (/^effects-(mod-[12]|amp|reverb)-variation$/.test(control.id))
    control.name = control.name.replace('variation', 'type')
}
export const initialPanel = Object.fromEntries(
  controls.map((c) => [c.id, c.initial]),
)
const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
let whites = 0
export const keys = Array.from({ length: 73 }, (_, i) => {
  const midi = 28 + i,
    name = names[midi % 12] + (Math.floor(midi / 12) - 1),
    black = name.includes('♯')
  const index = whites
  if (!black) whites++
  return { id: 'key-' + midi, midi, name, black, index }
})
