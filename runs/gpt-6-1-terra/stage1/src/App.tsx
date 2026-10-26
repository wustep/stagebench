import { useEffect, useRef, useState } from 'react'
import { PianoEngine, WebAudioBackend } from './audio'
type Kind = 'knob' | 'button' | 'fader' | 'drawbar' | 'wheel'
type Control = { id: string; label: string; kind: Kind }
const group = (prefix: string, kind: Kind, labels: string[]): Control[] => labels.map((label, i) => ({ id: `${prefix}-${i}`, label, kind }))
const sections = [
 { id: 'performance', title: '', controls: [...group('perf', 'knob', ['Master Level', 'Rotary Drive']), ...group('rotary', 'button', ['Rotary Slow / Fast', 'Rotary Stop Mode', 'Rotary Brake']), ...group('wheel', 'wheel', ['Pitch Stick', 'Modulation Wheel'])] },
 { id: 'organ', title: 'ORGAN', controls: [...group('organ-level', 'fader', ['Organ Layer A Level', 'Organ Layer B Level']), ...group('organ-mode', 'button', ['Organ Model', 'Vibrato / Chorus', 'Percussion On', 'Percussion Fast', 'Percussion Third', 'Organ Layer A', 'Organ Layer B', 'Organ Octave Shift']), ...group('drawbar', 'drawbar', ["16′", "5⅓′", "8′", "4′", "2⅔′", "2′", "1⅗′", "1⅓′", "1′"].map(x => `Organ drawbar ${x}`))] },
 { id: 'piano', title: 'PIANO', controls: [...group('piano-level', 'fader', ['Piano Layer A Level', 'Piano Layer B Level']), ...group('piano', 'button', ['Piano Type', 'Piano KB Touch', 'Piano Dyn Comp', 'Piano Timbre', 'Piano Soft Release', 'Piano String Resonance', 'Piano Layer A', 'Piano Layer B', 'Piano Octave Shift']), ...group('piano-model', 'knob', ['Piano Model'])] },
 { id: 'program', title: 'PROGRAM', controls: [...group('morph', 'button', ['Morph Wheel', 'Morph Aftertouch', 'Morph Control Pedal', 'Store', 'Split', 'Transpose', 'Live Mode', 'Layer Scene', 'Page Left', 'Page Right']), ...group('program-dial', 'knob', ['Program Dial']), ...group('program-button', 'button', ['Program 1', 'Program 2', 'Program 3', 'Program 4', 'Program 5', 'Program 6', 'Program 7', 'Program 8'])] },
 { id: 'synth', title: 'SYNTH', controls: [...group('synth-level', 'fader', ['Synth Layer A Level', 'Synth Layer B Level']), ...group('synth-top', 'button', ['Synth Layer A', 'Synth Layer B', 'Oscillator Mode', 'Arpeggiator', 'Arpeggiator Range', 'LFO Waveform', 'Filter Type', 'Envelope Mode']), ...group('synth-knob', 'knob', ['Oscillator Control', 'Oscillator Pitch', 'Oscillator Shape', 'LFO Rate', 'LFO Amount', 'Arpeggiator Rate', 'Filter Frequency', 'Filter Resonance', 'Filter Envelope', 'Amp Attack', 'Amp Decay', 'Amp Release']), ...group('synth-bottom', 'button', ['Oscillator Waveform', 'Oscillator Modulation', 'Filter Drive', 'Filter Keyboard Track', 'Amp Velocity', 'Synth Octave Shift'])] },
 { id: 'effects', title: 'LAYER EFFECTS', controls: [...group('effect-focus', 'button', ['Effects Organ Focus', 'Effects Piano Focus', 'Effects Synth Focus', 'Effects Layer Focus']), ...group('effects-a', 'knob', ['Effect 1 Rate', 'Effect 1 Amount', 'Effect 2 Rate', 'Effect 2 Amount']), ...group('effects-switch', 'button', ['Effect 1 Select', 'Effect 1 On', 'Effect 2 Select', 'Effect 2 On', 'Amp Simulator', 'EQ On', 'Delay On', 'Compressor On', 'Reverb On']), ...group('effects-b', 'knob', ['Amp Drive', 'EQ Bass', 'EQ Mid', 'EQ Treble', 'Delay Tempo', 'Delay Feedback', 'Delay Amount', 'Compressor Amount', 'Reverb Amount'])] },
]
const black = new Set([1, 3, 6, 8, 10])
const notes = Array.from({ length: 73 }, (_, i) => 40 + i)
const noteName = (n: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][n % 12]}${Math.floor(n / 12) - 1}`
const keys = 'awsedftgyhujkolp;'
function controlGroups(controls: Control[]) {
 const groups = new Map<string, Control[]>()
 for (const control of controls) { const name = control.id.replace(/-\d+$/, ''); groups.set(name, [...(groups.get(name) ?? []), control]) }
 return [...groups.entries()]
}
function PanelControl({ control, value, change }: { control: Control; value: number; change: (value: number) => void }) {
 if (control.kind === 'button') return <div className="unit button-unit"><span>{control.label}</span><button id={control.id} type="button" aria-label={`${control.label} (decorative)`} aria-pressed={!!value} className={`switch ${value ? 'lit' : ''}`} onClick={() => change(value ? 0 : 1)} /></div>
 return <label className={`unit ${control.kind}-unit`} htmlFor={control.id} style={{ '--value': `${value}%` } as React.CSSProperties}><span>{control.label}</span><input id={control.id} aria-label={`${control.label} (decorative)`} type="range" min="0" max="100" value={value} onChange={e => change(Number(e.target.value))} style={{ '--value': `${value}%`, '--angle': `${value * 2.7 - 135}deg` } as React.CSSProperties} /></label>
}
export default function App() {
 const [values, setValues] = useState<Record<string, number>>({})
 const [pressed, setPressed] = useState<Record<string, number>>({})
 const [status, setStatus] = useState('Piano ready to start · synthesized voice')
 const [midiStatus, setMidiStatus] = useState('MIDI not connected')
 const engine = useRef<PianoEngine | null>(null)
 const pointers = useRef(new Map<number, string>())
 const activeKeys = useRef(new Set<string>())
 const getEngine = () => { if (!engine.current) try { engine.current = new PianoEngine(new WebAudioBackend(new AudioContext())); setStatus('Synthesized piano ready') } catch { setStatus('Audio unavailable in this browser') }; return engine.current }
 const on = (id: string, note: number, velocity = 100) => { getEngine()?.on(id, note, velocity); setPressed(p => ({ ...p, [id]: note })) }
 const off = (id: string) => { engine.current?.off(id); setPressed(p => { const next = { ...p }; delete next[id]; return next }) }
 const clear = () => { engine.current?.allOff(); activeKeys.current.clear(); pointers.current.clear(); setPressed({}) }
 useEffect(() => {
  const down = (e: KeyboardEvent) => { if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return; const i = keys.indexOf(e.key.toLowerCase()); if (i >= 0 && !activeKeys.current.has(e.key)) { activeKeys.current.add(e.key); on(`key-${e.key}`, 60 + i); e.preventDefault() } }
  const up = (e: KeyboardEvent) => { activeKeys.current.delete(e.key); off(`key-${e.key}`) }
  const blur = () => clear()
  window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
  let access: MIDIAccess | undefined
  let disposed = false
  const message = (event: MIDIMessageEvent) => { const [command = 0, note = 0, velocity = 0] = event.data ?? []; const type = command & 0xf0; const id = `midi-${(event.target as MIDIInput | null)?.id ?? 'input'}-${command & 15}-${note}`; if (type === 0x90 && velocity > 0) on(id, note, velocity); else if (type === 0x80 || (type === 0x90 && velocity === 0)) off(id); else if (type === 0xb0 && note === 64) getEngine()?.sustain(velocity >= 64) }
  const attach = () => { if (!access) return; access.inputs.forEach(input => { input.onmidimessage = message }); setMidiStatus(access.inputs.size ? 'MIDI connected' : 'MIDI not connected') }
  if (navigator.requestMIDIAccess) navigator.requestMIDIAccess().then(a => { if (disposed) return; access = a; attach(); a.onstatechange = () => { clear(); attach() } }).catch(() => setMidiStatus('MIDI access denied'))
  else setMidiStatus('MIDI unavailable')
  return () => { disposed = true; window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); if (access) { access.onstatechange = null; access.inputs.forEach(input => { input.onmidimessage = null }) }; engine.current?.close(); engine.current = null }
 }, [])
 let whiteIndex = 0
 return <main><div className="intro"><div><strong>Nord Stage 4</strong><span>73 · Hammer action</span></div><p>Play with your pointer, MIDI keyboard, or A–; on your computer keyboard. Panel controls are decorative.</p><div className="status" role="status">{status} · {midiStatus}</div></div><div className="viewport"><div className="instrument" aria-label="Nord Stage 4 73 instrument"><div className="deck">{sections.map(section => <section className={`section ${section.id}`} key={section.id} aria-label={section.title || 'Performance'}>{section.id === 'performance' && <div className="brand">nord stage 4<small>HAMMER ACTION 73</small></div>}{section.title && <h2>{section.title}</h2>}{section.id === 'program' && <div className="oled program-oled">STAGE 4<br /><small>Panel decorative</small></div>}{section.id === 'synth' && <div className="oled synth-oled">SYNTH<br /><small>Decorative</small></div>}<div className="controls">{controlGroups(section.controls).map(([name, controls]) => <div className={`control-group group-${name}`} key={name}>{controls.map(c => <PanelControl key={c.id} control={c} value={values[c.id] ?? (c.kind === 'button' ? 0 : 50)} change={v => setValues(old => ({ ...old, [c.id]: v }))} />)}</div>)}</div></section>)}</div><div className="keybed" aria-label="73-key E to E keyboard">{notes.map(note => { const isBlack = black.has(note % 12); const position = isBlack ? whiteIndex - 0.31 : whiteIndex++; return <button key={note} type="button" aria-label={`Piano ${noteName(note)}`} data-note={note} className={`piano-key ${isBlack ? 'black' : 'white'} ${Object.values(pressed).includes(note) ? 'pressed' : ''}`} style={{ left: `${position / 43 * 100}%`, width: `${(isBlack ? 0.62 : 1) / 43 * 100}%` }} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const id = `pointer-${e.pointerId}`; pointers.current.set(e.pointerId, id); on(id, note, 100) }} onPointerUp={e => { const id = pointers.current.get(e.pointerId); if (id) off(id); pointers.current.delete(e.pointerId) }} onPointerCancel={e => { const id = pointers.current.get(e.pointerId); if (id) off(id); pointers.current.delete(e.pointerId) }} onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); on(`focus-${note}`, note) } }} onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); off(`focus-${note}`) } }} /> })}</div></div></div></main>
}
