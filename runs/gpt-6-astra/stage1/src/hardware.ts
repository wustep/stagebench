export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
export type ControlKind = 'button' | 'knob' | 'fader' | 'drawbar' | 'wheel' | 'stick'
export interface Control { id: string; section: SectionId; label: string; kind: ControlKind; x: number; y: number; w: number; h: number; initial: number; tone?: string }
export const sections: { id: SectionId; label: string; fraction: number }[] = [
  { id: 'performance', label: 'Performance', fraction: .14 }, { id: 'organ', label: 'Organ', fraction: .20 },
  { id: 'piano', label: 'Piano', fraction: .085 }, { id: 'program', label: 'Program / Morph', fraction: .125 },
  { id: 'synth', label: 'Synth', fraction: .25 }, { id: 'effects', label: 'Layer Effects', fraction: .20 },
]
const inventory: Control[] = []
function add(section: SectionId, label: string, kind: ControlKind, x: number, y: number, w = 10, h = 12, initial = 0, tone?: string) {
  inventory.push({ id: `${section}-${label.toLowerCase().replace(/⅓/g, '-one-third').replace(/⅔/g, '-two-thirds').replace(/⅗/g, '-three-fifths').replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`, section, label, kind, x, y, w, h, initial, tone })
}
function buttons(s: SectionId, labels: string[], x: number, y: number, step: number, w = 9) { labels.forEach((l, i) => add(s, l, 'button', x + i * step, y, w, 9)) }
function layers(s: SectionId, names: string[], x: number, step: number) {
  names.forEach((l, i) => { add(s, `Layer ${l} level`, 'fader', x + i * step, 7, step - 3, 34, 75 - i * 19); add(s, `Layer ${l}`, 'button', x + i * step, 45, step - 3, 8, i === 0 ? 1 : 0) })
}
add('performance', 'Master level', 'knob', 79, 5, 14, 15, 70)
add('performance', 'Pitch stick', 'stick', 16, 23, 26, 12, 50)
add('performance', 'Modulation wheel', 'wheel', 48, 37, 12, 33, 0)
add('performance', 'Rotary drive', 'knob', 80, 35, 13, 13, 15)
;['Rotary on', 'Close mic', 'Stop mode', 'Slow / Fast', 'Rotary morph'].forEach((l, i) => add('performance', l, 'button', 79, 53 + i * 8.5, 15, 6, i === 3 ? 1 : 0))
layers('organ', ['A', 'B'], 3, 10)
buttons('organ', ['Sustped', 'Pstick'], 3, 55, 10, 8)
add('organ', 'Organ preset', 'button', 4, 68, 16, 8)
add('organ', 'Octave down', 'button', 3, 83, 9, 8)
add('organ', 'Octave up', 'button', 13, 83, 9, 8)
buttons('organ', ['Organ model', 'Vibrato / Chorus'], 28, 15, 17, 10)
buttons('organ', ['Vibrato A', 'Vibrato B'], 46, 24, 8, 6)
buttons('organ', ['Percussion on', 'Soft', 'Fast', 'Third'], 62, 16, 9, 8)
add('organ', 'Drawbar live', 'button', 29, 32, 11, 8)
add('organ', 'Vibrato mode', 'button', 47, 32, 10, 8)
add('organ', 'Percussion mode', 'button', 85, 32, 10, 8)
;['16', '5⅓', '8', '4', '2⅔', '2', '1⅗', '1⅓', '1'].forEach((l, i) => add('organ', `Drawbar ${l}`, 'drawbar', 25 + i * 8, 47, 5.8, 46, [74, 50, 85, 42, 63, 53, 75, 61, 70][i], i < 2 ? 'brown' : [2, 3, 5, 8].includes(i) ? 'ivory' : 'black'))
layers('piano', ['A', 'B'], 4, 19)
buttons('piano', ['Sustped', 'Pstick'], 4, 55, 19, 15)
add('piano', 'Piano type', 'button', 51, 23, 19, 8)
add('piano', 'Piano timbre', 'button', 76, 23, 19, 8)
add('piano', 'Piano model', 'knob', 70, 82, 19, 13, 28)
buttons('piano', ['KB Touch', 'Dyn Comp'], 50, 47, 24, 20)
add('piano', 'Unison', 'button', 54, 69, 32, 8)
add('piano', 'Soft release', 'button', 5, 69, 14, 8)
add('piano', 'String resonance', 'button', 25, 69, 14, 8)
buttons('piano', ['Octave down', 'Octave up'], 5, 85, 20, 17)
buttons('program', ['Wheel morph', 'Aftertouch morph', 'Control pedal morph'], 4, 4, 17, 14)
buttons('program', ['Split on', 'Master clock', 'Transpose'], 57, 4, 15, 12)
buttons('program', ['Store', 'KB zones'], 4, 24, 16, 12)
buttons('program', ['Scene A', 'Scene B'], 39, 24, 17, 14)
add('program', 'Program dial', 'knob', 7, 43, 15, 14, 30)
buttons('program', ['Page previous', 'Page next'], 3, 59, 15, 12)
;['Live mode', 'Layer scene', 'Shift'].forEach((l, i) => add('program', l, 'button', 4, 72 + i * 9, 17, 7))
for (let i = 0; i < 8; i++) add('program', `Program ${i + 1}`, 'button', 30 + (i % 4) * 14, 77 + Math.floor(i / 4) * 12, 11, 8, i === 0 ? 1 : 0)
;['Prog view', 'Preset library', 'Undo', 'Monitor', 'Exit'].forEach((l, i) => add('program', l, 'button', 88, 25 + i * 13, 9, 8))
add('program', 'Panel on', 'button', 87, 87, 10, 10)
layers('synth', ['A', 'B', 'C'], 2, 9)
buttons('synth', ['Sustped', 'Pstick', 'KB hold'], 2, 56, 9, 7)
buttons('synth', ['Octave down', 'Octave up'], 3, 85, 10, 9)
add('synth', 'Synth preset', 'button', 4, 72, 19, 7)
;['Oscillator', 'Shape', 'Osc control'].forEach((l, i) => add('synth', l, 'knob', 30 + i * 12, 39, 8, 14, 30 + i * 20))
buttons('synth', ['Sample / Analog', 'Waveform'], 60, 12, 0, 7)
// The waveform selector sits below mode, next to the compact OLED.
inventory[inventory.length - 1].y = 32
add('synth', 'Arp rate', 'knob', 70, 12, 8, 14, 40)
add('synth', 'Arp range', 'knob', 87, 12, 8, 14, 20)
buttons('synth', ['Arp on', 'Arp mode', 'Arp hold'], 70, 30, 9, 7)
add('synth', 'Voice mode', 'button', 70, 45, 8, 8)
add('synth', 'Glide', 'knob', 81, 41, 8, 14, 25)
add('synth', 'Vibrato', 'button', 91, 46, 7, 8)
buttons('synth', ['LFO waveform', 'LFO destination', 'Filter type', 'Filter velocity', 'Amp velocity'], 30, 62, 14, 10)
add('synth', 'LFO rate', 'knob', 30, 77, 7, 13, 24)
add('synth', 'LFO amount', 'knob', 41, 83, 6, 11, 20)
add('synth', 'Filter cutoff', 'knob', 52, 79, 9, 15, 65)
add('synth', 'Filter resonance', 'knob', 65, 82, 7, 12, 20)
add('synth', 'Envelope attack', 'knob', 77, 79, 8, 14, 4)
add('synth', 'Envelope decay', 'knob', 89, 82, 7, 12, 45)
add('synth', 'Amp envelope', 'button', 94, 66, 5, 9)
// Each effects strip has its own physical boundary and uneven control grouping.
;['Mod 1', 'Mod 2', 'Amp / EQ', 'Delay', 'Reverb'].forEach((group, col) => {
  const x = 14 + col * 17
  add('effects', `${group} rate`, 'knob', x, 14, 9, 14, 25 + col * 9)
  add('effects', `${group} amount`, 'knob', x, 39, 9, 14, 35)
  add('effects', `${group} selector`, 'button', x + 1, 60, 9, 8)
  add('effects', `${group} on`, 'button', x + 1, 86, 9, 8)
})
;['Organ focus', 'Piano focus', 'Synth focus', 'Layer A focus', 'Layer B focus', 'Layer C focus'].forEach((l, i) => add('effects', l, 'button', 2, 11 + i * 13, 7, 8))
add('effects', 'EQ bass', 'knob', 48, 73, 7, 11, 50)
add('effects', 'EQ mid', 'knob', 57, 73, 7, 11, 50)
add('effects', 'Delay feedback', 'knob', 67, 73, 7, 11, 35)
add('effects', 'Reverb tone', 'knob', 85, 73, 7, 11, 50)
add('effects', 'Compressor amount', 'knob', 31, 74, 8, 12, 20)
add('effects', 'Compressor on', 'button', 39, 87, 7, 8)
add('effects', 'Delay tap tempo', 'button', 75, 27, 5, 10)
add('effects', 'Effects variation', 'button', 94, 48, 5, 10)
export const controls: readonly Control[] = inventory
export const initialHardware = Object.fromEntries(controls.map(c => [c.id, c.initial]))
export function updateHardware(state: Record<string, number>, id: string, value: number) {
  const c = controls.find(item => item.id === id)
  return c ? { ...state, [id]: Math.round(Math.max(0, Math.min(c.kind === 'button' ? 1 : 100, value))) } : state
}
let whites = 0
export const keys = Array.from({ length: 73 }, (_, i) => {
  const midi = 28 + i
  const pitch = midi % 12
  const black = [1, 3, 6, 8, 10].includes(pitch)
  const whiteIndex = whites
  if (!black) whites++
  return { id: `key-${midi}`, midi, black, name: `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch]}${Math.floor(midi / 12) - 1}`, left: black ? (whiteIndex - .31) / 43 * 100 : whiteIndex / 43 * 100, width: (black ? .62 : 1) / 43 * 100 }
})
export const computerMapping: Record<string, number> = Object.fromEntries(['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'].map((code, i) => [code, 60 + i]))
