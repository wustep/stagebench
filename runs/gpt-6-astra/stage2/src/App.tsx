import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { PianoEngine } from './audio'
import { LayeredPianoEngine } from './layer-audio'
import { panelBinding } from './panel'
import { PianoDetails } from './PianoDetails'
import { modelNames, pianoTypes } from './phase2-state'
import { InputController, type RequestMidi } from './inputs'
import { controls, initialHardware, keys, sections, updateHardware, type Control, type SectionId } from './hardware'

function HardwareControl({ control: c, value, change, feedback }: { control: Control; value: number; change: (id: string, value: number, shift?: boolean) => void; feedback?: string }) {
  const drag = useRef<{ x: number; y: number; value: number } | null>(null)
  const style = { left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%`, '--value': value, '--rotation': `${-135 + value * 2.7}deg` } as CSSProperties
  const label = `${sections.find(s => s.id === c.section)!.label}: ${c.label}${feedback === undefined ? " (decorative)" : ` · ${feedback}`}`
  return <div className={`hardware ${c.kind} ${c.tone ?? ''}`} style={style} data-control-id={c.id}>
    <span className="legend" aria-hidden="true">{c.label.replace(/^Layer /, '').replace(/^Drawbar /, '')}</span>
    {c.kind === 'button' ? <button id={c.id} type="button" aria-label={label} aria-pressed={!!value} title={label} onClick={e => change(c.id, value ? 0 : 1, e.shiftKey)}><i className={value ? 'lamp on' : 'lamp'} /></button> : <>
      <div className="mechanism" aria-hidden="true">{['fader', 'drawbar'].includes(c.kind) && <div className="ladder">{Array.from({ length: 9 }, (_, i) => <i key={i} className={value >= (9 - i) * 10 ? 'lit' : ''} />)}</div>}<i className="cap" /></div>
      <input id={c.id} type="range" min="0" max="100" step="1" value={value} aria-label={label} aria-valuetext={feedback ?? `${value} percent · decorative`} title={label}
        onChange={e => change(c.id, Number(e.target.value))}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, value } }}
        onPointerMove={e => { if (drag.current) { const d = drag.current; change(c.id, d.value + (e.clientX - d.x) * .7 - (e.clientY - d.y) * 1.5) } }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} />
    </>}
  </div>
}
const Text = ({ x, y, children, className = '' }: { x: number; y: number; children: React.ReactNode; className?: string }) => <div className={`panel-text ${className}`} aria-hidden="true" style={{ left: `${x}%`, top: `${y}%` }}>{children}</div>
function SectionDetails({ id, engine }: { id: SectionId; engine?: LayeredPianoEngine }) {
  if (id === 'performance') return <><div className="brand">nord stage 4<span>73 · H A M M E R  A C T I O N</span></div><Text x={77} y={28}>ROTARY<br />SPEAKER</Text></>
  if (id === 'organ') return <><Text x={27} y={3}>ORGAN MODEL</Text><Text x={45} y={3}>VIB / CHORUS</Text><Text x={72} y={3}>PERCUSSION</Text><Text x={28} y={22}>B3　 VOX　 FARF<br />PIPE 1　 PIPE 2</Text><Text x={3} y={96}>● 1　● 2　● 3　● 4</Text><div className="group-line organ-top" /></>
  if (id === 'piano') return <><Text x={52} y={5}>ACOUSTICS<br />SOFT REL<br />STRING RES</Text><Text x={51} y={34}>{engine ? <span className="type-leds">{pianoTypes.map(type => <span key={type} className={`${engine.state.layers[engine.state.focus].type === type ? "selected" : ""} ${engine.output.library.status === "fallback" && ["Grand", "Upright", "Electric"].includes(type) ? "missing" : ""}`}>{type.toUpperCase()}</span>)}</span> : <>GRAND　 UPRIGHT<br />ELECTRIC　 CLAV<br />DIGITAL　 MISC</>}</Text><Text x={52} y={59}>SOFT　 MID<br />BRIGHT　 DYNO</Text><Text x={4} y={96}>● 1　● 2　● 3　● 4</Text></>
  if (id === 'program' && engine) return <><div className="oled program-oled" aria-label="Program OLED: piano model status"><span>PIANO {engine.state.focus} · {engine.state.layers[engine.state.focus].type.toUpperCase()}</span><strong>{modelNames[engine.state.layers[engine.state.focus].type]}</strong><small>{engine.output.library.status === 'loading' ? 'LOADING LIBRARY' : ['Grand', 'Upright', 'Electric'].includes(engine.state.layers[engine.state.focus].type) ? 'RECORDINGS UNAVAILABLE' : 'ORIGINAL SYNTHESIS'}<br />FX {engine.state.fxSection} {engine.state.fxFocus}</small></div><Text x={5} y={18}>MORPH ASSIGN</Text><Text x={31} y={70}>PROGRAM　1　2　3　4</Text></>
  if (id === 'program') return <><div className="oled program-oled" aria-label="Program OLED: panel inactive"><span>PHASE 01</span><strong>Basic piano</strong><small>SYNTHESIZED VOICE<br />Panel is decorative</small></div><Text x={5} y={18}>MORPH ASSIGN</Text><Text x={31} y={70}>PROGRAM　1　2　3　4</Text></>
  if (id === 'synth') return <><div className="oled synth-oled" aria-label="Synth OLED: synthesis section inactive"><span>OSCILLATOR</span><strong>Panel only</strong><small>ENGINE INACTIVE</small><svg viewBox="0 0 90 14" aria-hidden="true"><path d="M0 9L15 9 16 2 30 12 45 2 60 12 75 2 90 9" /></svg></div><Text x={70} y={2}>ARPEGGIATOR / GATE</Text><Text x={71} y={38}>VOICE　　　 VIBRATO</Text><Text x={29} y={55}>LFO　　　 FILTER　　　　 ENVELOPES</Text><div className="group-line synth-bottom" /><Text x={4} y={96}>● 1　● 2　● 3　● 4</Text></>
  return <>{['MOD 1', 'MOD 2', 'AMP / EQ', 'DELAY', 'REVERB'].map((s, i) => <div key={s} className="effect-strip" style={{ left: `${12 + i * 17}%` }}><b>{s}</b><span>{['A-PAN　TREM\nRING　WAH', 'PHASER　FLANG\nCHORUS　VIBE', 'CLEAN　TWIN\nJC　SMALL', 'PING PONG\nANALOG　TAP', 'ROOM　STAGE\nHALL　CATH'][i]}</span></div>)}<Text x={28} y={69}>COMP</Text></>
}
export default function App({ suppliedEngine, requestMidi }: { suppliedEngine?: PianoEngine; requestMidi?: RequestMidi } = {}) {
  const [engine] = useState(() => suppliedEngine ?? new LayeredPianoEngine())
  const functional = engine instanceof LayeredPianoEngine ? engine : undefined
  const [hardware, setHardware] = useState(initialHardware)
  const [midiStatus, setMidiStatus] = useState('MIDI not connected')
  const [input] = useState(() => new InputController(engine, setMidiStatus))
  const [, redraw] = useState(0)
  const [zoom, setZoom] = useState(false)
  useEffect(() => {
    const unsubscribe = engine.subscribe(() => redraw(n => n + 1))
    const detach = input.attach(window)
    return () => { unsubscribe(); detach(); engine.dispose() }
  }, [engine, input])
  const active = new Set([...engine.notes.values()].filter(n => n.held).map(n => n.midi))
  const connectMidi = () => { const request = requestMidi ?? (navigator.requestMIDIAccess ? () => navigator.requestMIDIAccess() as unknown as ReturnType<RequestMidi> : undefined); void input.connect(request) }
  return <main>
    <header className="study-heading"><div><span className="eyebrow">INTERACTIVE INSTRUMENT STUDY</span><h1>Nord Stage 4 <span>/ 73</span></h1></div><span className="phase-badge">{functional ? '02' : '01'} <i /> {functional ? 'PIANOS + FX' : 'SURFACE + PIANO'}</span></header>
    <div className={`instrument-viewport ${zoom ? 'zoomed' : ''}`} tabIndex={zoom ? 0 : undefined} aria-label="Instrument view; use Inspect surface to enlarge">
      <div className="instrument" data-testid="chassis" aria-label="Nord Stage 4 73, hammer action, E1 to E7">
        <div className="top-rail"><span>MONITOR　 HEADPHONES　 OUT 1　 OUT 2　 OUT 3　 OUT 4</span><span>MIDI　 USB　 SUSTAIN　 CONTROL PEDAL</span></div>
        <div className="deck" data-testid="deck">{sections.map(section => <section key={section.id} data-section={section.id} className={`section ${section.id}`} aria-label={section.label} style={{ width: `${section.fraction * 100}%` }}>
          {section.id !== 'performance' && <div className="section-heading">{section.label}<span>●</span></div>}
          <div className="section-body"><SectionDetails id={section.id} engine={functional} />{controls.filter(c => c.section === section.id).map(control => { const binding = functional ? panelBinding(functional, control) : undefined; return <HardwareControl key={control.id} control={control} value={binding?.value ?? hardware[control.id]} feedback={binding?.text} change={(id, value, shift) => binding ? binding.change(value, shift) : setHardware(previous => updateHardware(previous, id, value))} /> })}</div>
        </section>)}</div>
        <div className="keybed" data-testid="keybed" role="group" aria-label="73 piano keys, E1 to E7">{keys.map(key => <button key={key.id} id={key.id} type="button" className={`piano-key ${key.black ? 'black-key' : 'white-key'} ${active.has(key.midi) ? 'depressed' : ''}`} data-midi={key.midi} aria-label={`Play ${key.name}`} aria-pressed={active.has(key.midi)} style={{ left: `${key.left}%`, width: `${key.width}%` }}
          onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); input.pointerDown(e.pointerId, key.midi, e.pointerType === 'pen' && e.pressure > 0 ? Math.round(30 + e.pressure * 97) : 96) }}
          onPointerUp={e => input.pointerUp(e.pointerId)} onPointerCancel={e => input.pointerUp(e.pointerId)} onLostPointerCapture={e => input.pointerUp(e.pointerId)}
          onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); if (!e.repeat) void engine.on(`accessible:${key.midi}`, key.midi) } }}
          onKeyUp={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); engine.off(`accessible:${key.midi}`) } }} onBlur={() => engine.off(`accessible:${key.midi}`)}>{key.name === 'C4' && <span>C4</span>}</button>)}</div>
        <div className="cheek left-cheek" /><div className="cheek right-cheek" /><div className="bottom-rail" />
      </div>
    </div>
    <footer className="workspace-controls">
      <div className="audio-summary"><span className={`status-dot ${engine.status}`} /><div><strong role="status">{({ idle: 'Piano asleep · play a key to begin', loading: 'Starting audio…', ready: functional ? functional.output.library.status === 'fallback' ? 'Playable fallback · synthesized piano library' : 'Piano ready · recorded library' : 'Piano ready · synthesized voice', error: 'Audio unavailable · retry activation' })[engine.status]}</strong><span>{engine.status === 'error' ? engine.error : functional ? 'Piano, effects and Master Level are active. Recorded assets unavailable.' : 'One piano voice. All panel controls are decorative.'}</span></div></div>
      <div className="toolbar"><button onClick={() => void engine.activate()}>Activate audio</button><button aria-pressed={engine.pedals.has('ui')} onClick={() => engine.sustain('ui', !engine.pedals.has('ui'))}>Sustain</button><button onClick={() => input.allOff()}>Stop notes</button><button aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? 'Fit instrument' : 'Inspect surface'}</button></div>
      <div className="playing-help"><span><kbd>A</kbd>–<kbd>;</kbd> play · <kbd>W E T Y U O P</kbd> sharps · <kbd>Space</kbd> sustain<br /><small>Touch supports chords. Tab to controls; arrows adjust, Enter / Space press.</small></span><div className="midi"><button onClick={connectMidi}>Connect MIDI ↗</button><span role="status">{midiStatus}</span></div></div>
      {functional && <PianoDetails engine={functional} />}
    </footer>
  </main>
}
