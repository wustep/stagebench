export const sections = [
  { id: 'performance', label: 'Performance controls', fraction: .14 },
  { id: 'organ', label: 'Organ', fraction: .20 },
  { id: 'piano', label: 'Piano', fraction: .085 },
  { id: 'program', label: 'Program and morph', fraction: .125 },
  { id: 'synth', label: 'Synth', fraction: .25 },
  { id: 'effects', label: 'Layer effects', fraction: .20 },
] as const
export type Section = typeof sections[number]['id']
export type ControlKind = 'knob' | 'button' | 'fader' | 'drawbar' | 'wheel' | 'stick'
export interface HardwareControl { id: string; section: Section; label: string; kind: ControlKind; x: number; y: number; w: number; h: number; initial: number; group: string }
const controls: HardwareControl[] = []
function add(section: Section, label: string, kind: ControlKind, x: number, y: number, w = 10, h = 12, initial = 0, group = '') {
  const slug = label.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  controls.push({ id: `${section}-${slug}`, section, label, kind, x, y, w, h, initial, group })
}
const button = (s: Section, l: string, x: number, y: number, w = 10, g = '') => add(s,l,'button',x,y,w,6,0,g)
const knob = (s: Section, l: string, x: number, y: number, w = 9, g = '') => add(s,l,'knob',x,y,w,13,45,g)
knob('performance','Master level',81,7,12)
add('performance','Pitch stick','stick',12,27,22,10,50)
add('performance','Modulation wheel','wheel',43,33,9,31,0)
knob('performance','Rotary drive',83,31,10,'ROTARY SPEAKER')
for (const [i,l] of ['Rotary on','Rotary slow fast','Rotary stop mode','Rotary source'].entries()) button('performance',l,80,54+i*10,14,'ROTARY SPEAKER')
for(const [i,l] of ['A','B'].entries()) { add('organ',`Layer ${l} level`,'fader',3+i*10,10,5,27,75,'LAYERS'); button('organ',`Layer ${l} on`,2+i*10,45,8); }
button('organ','Sustain pedal',2,55,8); button('organ','Pitch stick routing',12,55,8)
button('organ','Organ model',25,23,11,'ORGAN MODEL')
button('organ','Vibrato chorus',42,19,9,'VIB / CHORUS'); button('organ','Vibrato chorus on',44,30,9)
for(const [i,l] of ['Percussion volume','Percussion decay','Percussion harmonic'].entries()) button('organ',l,64+i*11,20,9,'PERCUSSION')
button('organ','Percussion on',84,31,9)
button('organ','Preset',3,69,14); button('organ','Octave shift',3,84,16)
for (let i=0;i<9;i++) add('organ',`Drawbar ${['16','5⅓','8','4','2⅔','2','1⅗','1⅓','1'][i]}`,'drawbar',24+i*8.1,49,5.4,43,[80,70,95,48,60,66,83,60,75][i],'DRAWBARS')
for(const [i,l] of ['A','B'].entries()) { add('piano',`Layer ${l} level`,'fader',8+i*23,9,11,28,65); button('piano',`Layer ${l} on`,4+i*23,44,19); }
button('piano','Sustain pedal',4,54,19); button('piano','Pitch stick routing',27,54,19)
button('piano','Piano type',70,18,24,'PIANO TYPE'); knob('piano','Model selector',69,33,23)
button('piano','KB touch',62,52,28,'PIANO DETAIL'); button('piano','Dyn comp',62,62,28)
button('piano','Timbre',62,72,28); button('piano','Unison',62,82,28)
button('piano','Soft release',5,68,23); button('piano','String resonance',29,68,23)
button('piano','Octave shift',5,82,43); button('piano','Piano on',5,92,23)
for (const [i,l] of ['Wheel morph','Aftertouch morph','Control pedal morph'].entries()) button('program',l,5+i*30,7,26,'MORPH ASSIGN')
button('program','Monitor',5,20,16); button('program','Store',25,20,16)
knob('program','Program dial',5,39,17)
button('program','Page previous',5,58,11); button('program','Page next',19,58,11)
button('program','Live mode',5,70,17); button('program','Layer scene',5,84,17)
for(let i=0;i<8;i++) button('program',`Program ${i+1}`,29+(i%4)*17,70+Math.floor(i/4)*14,14,'PROGRAMS')
for(const [i,l] of ['Split on','Split set','Master clock','Transpose'].entries()) button('program',l,5+i*23,28,18)
for(const [i,l] of ['A','B','C'].entries()) { add('synth',`Layer ${l} level`,'fader',3+i*7,10,3.5,29,60); button('synth',`Layer ${l} on`,2+i*7,45,6); }
button('synth','Sustain pedal',2,55,8); button('synth','Pitch stick routing',12,55,8)
button('synth','Octave shift',2,84,18); button('synth','Synth on',2,68,8); button('synth','Layer focus',12,68,8)
button('synth','Oscillator mode',58,13,7,'OSCILLATOR'); knob('synth','Oscillator select',28,37,8); knob('synth','Oscillator control',40,37,8); knob('synth','Oscillator mix',52,37,8)
button('synth','Waveform',24,58,8); knob('synth','Oscillator shape',28,67,6)
knob('synth','LFO rate',22,82,6,'LFO'); knob('synth','LFO amount',33,82,6); button('synth','LFO waveform',22,70,6)
knob('synth','Arpeggiator rate',69,12,6,'ARPEGGIATOR / GATE'); knob('synth','Arpeggiator range',90,12,7); button('synth','Arpeggiator on',79,17,7)
button('synth','Arpeggiator mode',90,31,7); button('synth','Arpeggiator hold',79,31,7)
knob('synth','Filter frequency',76,38,8,'FILTER'); knob('synth','Filter resonance',90,42,6)
button('synth','Filter type',65,42,7); button('synth','Filter drive',65,54,7)
knob('synth','Filter envelope amount',43,82,5); knob('synth','Filter velocity',52,82,5)
for(const [i,l] of ['Amp attack','Amp decay','Amp sustain','Amp release'].entries()) knob('synth',l,43+i*13,63,6,'AMP ENVELOPE')
for(const [i,l] of ['Mod attack','Mod decay','Mod sustain','Mod release'].entries()) knob('synth',l,61+i*9,82,5,'MOD ENVELOPE')
button('synth','Mono legato',91,68,7); button('synth','Unison',91,57,7)
for(const [i,l] of ['Organ focus','Piano focus','Synth focus','Effects on'].entries()) button('effects',l,2,15+i*18,7,'LAYER FOCUS')
const effectGroups = [
  {name:'MOD 1',x:14,y:12,knobs:['Mod 1 rate','Mod 1 amount'],buttons:['Mod 1 type','Mod 1 on']},
  {name:'MOD 2',x:14,y:37,knobs:['Mod 2 rate','Mod 2 amount'],buttons:['Mod 2 type','Mod 2 on']},
  {name:'AMP SIM / EQ',x:14,y:64,knobs:['EQ bass','EQ mid','EQ treble'],buttons:['Amp model','Amp EQ on']},
  {name:'DELAY',x:62,y:12,knobs:['Delay time','Delay feedback'],buttons:['Delay tap','Delay on']},
  {name:'COMPRESSOR',x:62,y:45,knobs:['Compressor amount','Compressor dry wet'],buttons:['Compressor mode','Compressor on']},
  {name:'REVERB',x:62,y:76,knobs:['Reverb amount','Reverb tone'],buttons:['Reverb type','Reverb on']},
]
for(const g of effectGroups) { g.knobs.forEach((l,i)=>knob('effects',l,g.x+i*(g.knobs.length===3?12:14),g.y,g.knobs.length===3?7:8,g.name)); g.buttons.forEach((l,i)=>button('effects',l,g.x+(g.knobs.length===3?34:28),g.y+i*11,g.knobs.length===3?8:11,g.name)); }
export const hardware = controls
export const initialHardware = () => Object.fromEntries(hardware.map(c=>[c.id,c.initial])) as Record<string,number>
export function setPresentation(state: Record<string,number>, id: string, value: number) { if (!hardware.some(c=>c.id===id)) return state; return {...state,[id]:Math.max(0,Math.min(100,value))} }
const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B']
let whiteIndex = 0
export const keys = Array.from({length:73},(_,i)=> { const note=28+i; const black=[1,3,6,8,10].includes(note%12); const index=black?whiteIndex-.31:whiteIndex++; return {id:`key-${note}`,note,name:`${names[note%12]}${Math.floor(note/12)-1}`,black,left:index/43*100,width:(black?.62:1)/43*100} })
export const computerKeys: Record<string,number> = Object.fromEntries(['KeyA','KeyW','KeyS','KeyE','KeyD','KeyF','KeyT','KeyG','KeyY','KeyH','KeyU','KeyJ','KeyK','KeyO','KeyL','KeyP','Semicolon'].map((k,i)=>[k,60+i]))
