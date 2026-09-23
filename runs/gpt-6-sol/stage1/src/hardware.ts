export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
export type ControlKind = 'knob' | 'encoder' | 'button' | 'fader' | 'drawbar' | 'wheel'
export interface Control {
  id: string
  section: SectionId
  name: string
  kind: ControlKind
  x: number
  y: number
  w: number
  h: number
  initial?: number
  accent?: boolean
}
export const sections: { id: SectionId; label: string; width: number }[] = [
  { id: 'performance', label: 'Performance', width: 14 },
  { id: 'organ', label: 'Organ', width: 20 },
  { id: 'piano', label: 'Piano', width: 8.5 },
  { id: 'program', label: 'Program / Morph', width: 12.5 },
  { id: 'synth', label: 'Synth', width: 25 },
  { id: 'effects', label: 'Layer Effects', width: 20 },
]
const controls: Control[] = []
const add = (section: SectionId, kind: ControlKind, name: string, x: number, y: number, w: number, h: number, initial = 0, accent = false) => {
  controls.push({ id: `${section}.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, section, kind, name, x, y, w, h, initial, accent })
}
const b = (s: SectionId, n: string, x: number, y: number, w = 12, h = 10, accent = false) => add(s, 'button', n, x, y, w, h, 0, accent)
const k = (s: SectionId, n: string, x: number, y: number, w = 13, h = 19, initial = 45) => add(s, 'knob', n, x, y, w, h, initial)
const f = (s: SectionId, n: string, x: number, y: number, w = 10, h = 44, initial = 68, kind: ControlKind = 'fader') => add(s, kind, n, x, y, w, h, initial)

k('performance', 'Master Level', 72, 8, 15, 22, 68)
f('performance', 'Pitch Stick', 18, 29, 14, 43, 50, 'wheel')
f('performance', 'Modulation Wheel', 37, 29, 12, 43, 25, 'wheel')
k('performance', 'Rotary Speed', 69, 37, 15, 21)
k('performance', 'Rotary Drive', 84, 37, 13, 21)
b('performance', 'Rotary Slow Stop', 62, 68, 18, 10)
b('performance', 'Rotary Fast', 82, 68, 14, 10)
b('performance', 'Rotary On', 69, 82, 20, 10)
b('performance', 'Rotary Select', 48, 82, 16, 10)

b('organ', 'Organ On', 3, 6, 12, 9, true)
f('organ', 'Organ Level A', 4, 20, 8, 37)
f('organ', 'Organ Level B', 14, 20, 8, 37)
;['B3', 'Vox', 'Farf', 'Pipe'].forEach((n, i) => b('organ', `Model ${n}`, 29 + i * 16, 17, 13, 10))
;['Vibrato', 'Chorus', 'Percussion', 'Soft', 'Fast', 'Third'].forEach((n, i) => b('organ', n, 30 + (i % 3) * 21, 32 + Math.floor(i / 3) * 15, 17, 10))
;['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'].forEach((n, i) => f('organ', `Drawbar ${i + 1} ${n}`, 4 + i * 10.4, 60, 7, 34, i % 3 === 0 ? 70 : 42, 'drawbar'))
b('organ', 'Organ Preset 1', 4, 57, 9, 8)
b('organ', 'Organ Preset 2', 16, 57, 9, 8)

b('piano', 'Piano On', 5, 6, 30, 9, true)
f('piano', 'Piano Level A', 5, 22, 15, 36)
f('piano', 'Piano Level B', 23, 22, 15, 36)
b('piano', 'Piano Layer A', 5, 62, 29, 9)
b('piano', 'Piano Layer B', 36, 62, 29, 9)
b('piano', 'Piano Type', 46, 18, 44, 10)
b('piano', 'Piano Model', 46, 33, 44, 10)
b('piano', 'KB Touch', 46, 49, 42, 10)
b('piano', 'Timbre', 46, 64, 42, 10)
b('piano', 'String Res', 5, 79, 28, 9)
b('piano', 'Soft Release', 37, 79, 28, 9)
b('piano', 'Sustain Pedal', 69, 79, 27, 9)

k('program', 'Program Dial', 54, 20, 35, 28, 40)
b('program', 'Store', 6, 9, 19, 8)
b('program', 'Live Mode', 28, 9, 28, 8)
b('program', 'Split', 59, 9, 20, 8)
b('program', 'Page Left', 6, 50, 19, 9)
b('program', 'Page Right', 28, 50, 19, 9)
;['1','2','3','4','5','6','7','8'].forEach((n, i) => b('program', `Program ${n}`, 5 + (i % 4) * 23, 65 + Math.floor(i / 4) * 13, 19, 10))
b('program', 'Layer Scene 1', 53, 50, 19, 9)
b('program', 'Layer Scene 2', 76, 50, 19, 9)
;['Wheel', 'Control Pedal', 'Aftertouch'].forEach((n, i) => b('program', `Morph Assign ${n}`, 7 + i * 30, 91, 25, 7))

b('synth', 'Synth On', 3, 5, 12, 9, true)
f('synth', 'Synth Level A', 3, 20, 8, 36)
f('synth', 'Synth Level B', 13, 20, 8, 36)
b('synth', 'Synth Layer A', 2, 63, 14, 8)
b('synth', 'Synth Layer B', 18, 63, 14, 8)
;['Sample', 'Analog', 'FM', 'Wave'].forEach((n, i) => b('synth', `Mode ${n}`, 26 + i * 17, 6, 14, 8))
;[['Osc Shape',29,40],['Osc Tune',46,40],['Mix',64,40],['Filter Freq',26,64],['Filter Resonance',44,64],['Env Attack',63,64],['Env Decay',80,64],['LFO Rate',27,83],['Arp Rate',47,83],['Vibrato',69,83]].forEach(([n,x,y]) => k('synth', String(n), Number(x), Number(y), 14, 17))
;['Osc Sync','Pitch Env','Filter Type','Filter Drive','LFO Target','Arp On','Arp Direction','Voice Mode','Glide'].forEach((n, i) => b('synth', n, 27 + (i % 5) * 14, 19 + Math.floor(i / 5) * 11, 12, 8))
b('synth', 'Synth Preset', 4, 80, 19, 9)

;['Effect 1', 'Effect 2', 'Amp Sim', 'EQ', 'Delay', 'Compressor', 'Reverb'].forEach((n, i) => b('effects', `${n} On`, 3 + (i % 4) * 24, 7 + Math.floor(i / 4) * 46, 18, 9))
;[['Effect 1 Rate',5,21],['Effect 1 Amount',27,21],['Effect 2 Rate',50,21],['Effect 2 Amount',74,21],['Amp Drive',5,67],['EQ Treble',27,67],['EQ Mid',49,67],['EQ Bass',72,67],['Delay Time',5,39],['Delay Feedback',27,39],['Compressor Amount',50,67],['Reverb Amount',74,39]].forEach(([n,x,y]) => k('effects', String(n), Number(x), Number(y), 18, 16))
;['Piano', 'Organ', 'Synth'].forEach((n, i) => b('effects', `Layer Focus ${n}`, 5 + i * 29, 88, 24, 8))

export const hardwareControls: readonly Control[] = controls
export const initialHardwareState: Record<string, number> = Object.fromEntries(controls.map(control => [control.id, control.initial ?? 0]))

export interface PianoKey { midi: number; name: string; isBlack: boolean; whiteIndex: number }
const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const pianoKeys: PianoKey[] = Array.from({ length: 73 }, (_, index) => {
  const midi = index + 28
  const name = names[midi % 12]
  const isBlack = name.includes('♯')
  const whiteIndex = Array.from({ length: index + 1 }, (_, i) => names[(i + 28) % 12]).filter(n => !n.includes('♯')).length - 1
  return { midi, name: `${name}${Math.floor(midi / 12) - 1}`, isBlack, whiteIndex }
})
