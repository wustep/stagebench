import { useEffect, useRef, useState } from 'react'
import { hardware, initialHardware, keys, sections, setPresentation, type HardwareControl } from './hardware'
import { PianoEngine, type AudioBackend } from './audio'
import { bindComputerInput, MidiInput, type MidiAccess } from './inputs'
import {LayerAudioBackend} from './layer-audio'
import {functional,panelText,panelValue,changePanel} from './panel'
import {modelNames,pianoTypes} from './instrument'
import Settings from './Settings'
export interface AppProps { backend?:AudioBackend; requestMidi?:()=>Promise<MidiAccess> }
function LedGraph({value}:{value:number}) { return <span className="led-graph" aria-hidden="true">{Array.from({length:9},(_,i)=><i key={i} className={value>=(8-i)*11?'lit':''}/>)}</span> }
function Control({control:c,value,update,text}:{control:HardwareControl;value:number;update:(id:string,v:number,shift?:boolean)=>void;text?:string}) {
  const drag=useRef<{y:number;x:number;value:number}|null>(null)
  const live=functional(c.id);const label=`${c.section} ${c.label}${live?'':' (decorative)'}`;const title=live?`${c.label} · ${text??Math.round(value)}`:`${c.label} — presentation only`
  const isButton=c.kind==='button'; const vertical=['fader','drawbar','wheel'].includes(c.kind)
  const short=c.label.replace(/^(Rotary |Layer |Arpeggiator |Oscillator |Compressor |Percussion |Filter |Program |Mod 1 |Mod 2 |Reverb |Delay |Amp |Mod )/,'')
  return <div className={`hardware-control ${c.kind}`} data-control-id={c.id} data-kind={c.kind} style={{left:`${c.x}%`,top:`${c.y}%`,width:`${c.w}%`,height:`${c.h}%`}}>
    <span className="control-legend" aria-hidden="true">{short}</span>
    {isButton ? <button id={c.id} type="button" aria-label={label} aria-pressed={value>0} title={title} onClick={e=>update(c.id,value?0:100,e.shiftKey)} className={value?'selected':''}><i aria-hidden="true"/></button> : <>
      {c.kind==='knob'&&<span className="knob-body" aria-hidden="true" style={{transform:`rotate(${-135+value*2.7}deg)`}}><i/></span>}
      {vertical&&<><span className="slider-track" aria-hidden="true"/><span className="slider-cap" aria-hidden="true" style={{top:`${(100-value)*.72+8}%`}}/>{c.kind!=='wheel'&&<LedGraph value={value}/>}</>}
      {c.kind==='stick'&&<span className="pitch-body" aria-hidden="true" style={{transform:`rotate(${(value-50)*.4}deg)`}}/>}
      <input id={c.id} type="range" min="0" max="100" value={value} aria-valuetext={live?text:undefined} aria-label={label} title={title} onChange={e=>update(c.id,Number(e.target.value))}
        onPointerDown={e=> { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture?.(e.pointerId); drag.current={y:e.clientY,x:e.clientX,value} }}
        onPointerMove={e=> { if(!drag.current) return; const d=drag.current; update(c.id,d.value+(vertical||c.kind==='knob'?d.y-e.clientY:e.clientX-d.x)*1.5) }}
        onPointerUp={e=> { if(c.kind==='stick')update(c.id,50);else if(drag.current&&e.clientX===drag.current.x&&e.clientY===drag.current.y) update(c.id,(value+10)%110); drag.current=null }}
        onPointerCancel={()=> { drag.current=null;if(c.kind==='stick')update(c.id,50) }}/>
    </>}
  </div>
}
const groups:Record<string,Array<[string,number,number,number,number]>>={
  organ:[['ORGAN MODEL',23,7,15,32],['VIB / CHORUS',40,7,20,32],['PERCUSSION',62,7,36,32]],
  piano:[['PIANO TYPE',58,7,39,40],['PIANO DETAIL',58,48,39,48]],
  program:[['MORPH ASSIGN',3,2,93,14],['PROGRAMS',26,64,71,32]],
  synth:[['OSCILLATOR',23,7,39,48],['ARPEGGIATOR / GATE',65,6,34,29],['FILTER',64,36,35,24],['LFO',21,61,20,34],['AMP / MOD ENVELOPE',42,60,56,35]],
  effects:[['MOD 1',12,6,44,28],['MOD 2',12,35,44,26],['AMP SIM / EQ',12,62,44,34],['DELAY',59,6,40,33],['COMPRESSOR',59,40,40,31],['REVERB',59,72,40,24]],
}
export default function App({backend,requestMidi}:AppProps) {
  const [,rerender]=useState(0); const [presentation,setPresentationState]=useState(initialHardware); const [zoom,setZoom]=useState(1)
  const engineRef=useRef<PianoEngine|null>(null); const midiRef=useRef<MidiInput|null>(null)
  if(!engineRef.current) engineRef.current=new PianoEngine(backend??new LayerAudioBackend(),()=>rerender(n=>n+1))
  const engine=engineRef.current
  if(!midiRef.current) midiRef.current=new MidiInput(engine,requestMidi??(navigator.requestMIDIAccess?async()=>await navigator.requestMIDIAccess() as unknown as MidiAccess:undefined),()=>rerender(n=>n+1))
  const midi=midiRef.current
  useEffect(()=> { const unbind=bindComputerInput(engine); const visibility=()=> { if(document.hidden) engine.allOff() }; document.addEventListener('visibilitychange',visibility); return ()=> { unbind(); document.removeEventListener('visibilitychange',visibility); midi.dispose(); engine.dispose() } },[engine,midi])
  const active=engine.activeNotes()
  const sampleFailed=engine.status==='fallback'&&(!(engine.backend instanceof LayerAudioBackend)||engine.backend.library.failures.has(engine.state.layers[engine.state.focus].type))
  return <main>
    <header className="app-header"><div><strong>Nord Stage 4 <span>73</span></strong><p>Interactive instrument study · Phase 2</p></div><span className="phase-label">HAMMER ACTION · E1–E7</span></header>
    <div className="instrument-viewport" aria-label="Instrument viewport; scroll horizontally when enlarged"><div className="instrument" data-testid="chassis" style={{width:`${zoom*100}%`}}>
      <div className="deck" data-testid="deck">
        {sections.map(s=><section key={s.id} className={`section ${s.id}`} data-section={s.id} aria-label={s.label} style={{width:`${Number((s.fraction*100).toFixed(2))}%`}}>
          {s.id==='performance'?<div className="brand" aria-hidden="true">nord stage 4<small>H A M M E R   A C T I O N   7 3</small></div>:<h2>{s.id==='program'?'PROGRAM':s.label.toUpperCase()}</h2>}
          {groups[s.id]?.map(([label,x,y,w,h])=><div key={label} className="control-group" aria-hidden="true" style={{left:`${x}%`,top:`${y}%`,width:`${w}%`,height:`${h}%`}}><span>{label}</span></div>)}
          {s.id==='program'&&<div className="oled program-oled" aria-label={`Program OLED: Piano ${engine.state.focus}, ${modelNames[engine.state.layers[engine.state.focus].type]}, programs inactive`}><b>PIANO {engine.state.focus}</b><span>{modelNames[engine.state.layers[engine.state.focus].type]}</span><small>{sampleFailed?'SAMPLE FAILED · FALLBACK':'Pianos + Layer FX'}</small><small>Programs inactive</small></div>}
          {s.id==='synth'&&<div className="oled synth-oled" aria-label="Synth OLED: inactive"><b>SYNTH OFFLINE</b><span>Phase 2</span><small>Decorative controls</small></div>}
          {s.id==='piano'&&<div className={`type-labels ${sampleFailed?'sample-failure':''}`} aria-hidden="true">{pianoTypes.map(type=><div key={type}>{engine.state.layers[engine.state.focus].type===type?'●':'○'} {type.toUpperCase()}</div>)}</div>}
          {hardware.filter(c=>c.section===s.id).map(c=><Control key={c.id} control={c} value={functional(c.id)?panelValue(engine.state,c.id):presentation[c.id]} text={functional(c.id)?panelText(engine.state,c.id):undefined} update={(id,v,shift)=>{if(id==='effects-delay-tap')engine.tapDelay();else if(functional(id))engine.updateState(state=>changePanel(state,id,v,shift));else setPresentationState(state=>setPresentation(state,id,v))}}/>)}
        </section>)}
      </div>
      <div className="keybed" data-testid="keybed" aria-label="73-key hammer action keyboard, E1 to E7">{keys.map(k=><button key={k.id} id={k.id} type="button" data-note={k.note} data-key-color={k.black?'black':'white'} className={`piano-key ${k.black?'black':'white'} ${active.has(k.note)?'pressed':''}`} aria-label={`Piano key ${k.name}`} aria-pressed={active.has(k.note)} style={{left:`${k.left}%`,width:`${k.width}%`}}
        onPointerDown={e=> { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture?.(e.pointerId); const rect=e.currentTarget.getBoundingClientRect(); const velocity=Math.max(.25,Math.min(1,(e.clientY-rect.top)/rect.height*.6+.4)); void engine.noteOn(`pointer:${e.pointerId}`,k.note,velocity) }}
        onPointerUp={e=>engine.noteOff(`pointer:${e.pointerId}`)} onPointerCancel={e=>engine.noteOff(`pointer:${e.pointerId}`)} onLostPointerCapture={e=>engine.noteOff(`pointer:${e.pointerId}`)}
        onKeyDown={e=> { if(['Enter','Space'].includes(e.code)) { e.preventDefault(); if(!e.repeat) void engine.noteOn(`focus:${k.note}`,k.note) } }}
        onKeyUp={e=> { if(['Enter','Space'].includes(e.code)) { e.preventDefault(); engine.noteOff(`focus:${k.note}`) } }} onBlur={()=>engine.noteOff(`focus:${k.note}`)}
      ><span aria-hidden="true">{k.name==='C4'?'C4':''}</span></button>)}</div>
    </div></div>
    <div className="utility-bar"><div className="audio-state" role="status"><i className={['ready','fallback'].includes(engine.status)?'ready':''}/>{engine.status==='idle'?'Audio idle · play a key to start':engine.status==='loading'?'Loading bundled piano recordings…':engine.status==='fallback'?`Sample failure · playable synthesis fallback · ${engine.backend instanceof LayerAudioBackend?[...engine.backend.library.failures.keys()].join(', '):''}`:engine.status==='ready'?(engine.backend instanceof LayerAudioBackend?'Ready · bundled recorded piano library':'Ready · synthesized piano'):`Audio error · ${engine.error}`}</div><div className="utility-actions"><button type="button" onClick={()=>void engine.prepare(engine.status==='fallback')}>{engine.status==='error'?'Retry audio':engine.status==='fallback'?'Retry samples':'Enable audio'}</button><button type="button" onClick={()=>void midi.connect()} disabled={midi.status==='requesting'}>MIDI: {midi.status}</button><button type="button" aria-pressed={engine.pedals.size>0} onClick={()=>engine.sustain('ui',!engine.pedals.has('ui'))}>Sustain {engine.pedals.size?'on':'off'}</button><button type="button" onClick={()=>engine.allOff()}>All notes off</button></div></div>
    <footer><p><b>Play</b> A W S E D F T G Y H U J K O L P ; &nbsp;·&nbsp; Space sustains &nbsp;·&nbsp; Touch supports chords.</p><div className="inspection"><label htmlFor="inspection-zoom">Inspect</label><input id="inspection-zoom" type="range" min="1" max="4" step=".25" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><button type="button" onClick={()=>setZoom(1)}>Fit</button></div><p className="honesty">Piano layers, effects, Rotary and Master Level are active. Organ, Synth, Program and excluded controls remain decorative. Grand/Upright/Electric use bundled recordings; Clav/Digital/Misc use synthesis. Drag or use arrow keys; Shift + effect On toggles global mode.</p></footer>
    <Settings engine={engine}/>
    <a className="sample-credits" href={`${import.meta.env.BASE_URL}samples/ATTRIBUTION.md`}>Sample credits &amp; licenses</a>
  </main>
}
