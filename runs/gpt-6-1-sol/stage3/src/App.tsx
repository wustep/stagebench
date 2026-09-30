import { useEffect, useRef, useState } from 'react'
import { hardware, initialHardware, keys, sections, setPresentation, type HardwareControl } from './hardware'
import { PianoEngine, type AudioBackend } from './audio'
import { bindComputerInput, MidiInput, type MidiAccess } from './inputs'
import {LayerAudioBackend} from './layer-audio'
import {functional,panelText,panelValue,changePanel} from './panel'
import {modelNames,pianoTypes} from './instrument'
import Settings from './Settings'
import SystemSettings from './SystemSettings'
import {controlMorphPath} from './control-morph'
import {programAction,excludedControls} from './phase3-panel'
import {previewState,waveforms,categories,layerAt,setPath,type LayerKey} from './system'
export interface AppProps { backend?:AudioBackend; requestMidi?:()=>Promise<MidiAccess> }
function LedGraph({value,range}:{value:number;range?:[number,number]}) { return <span className="led-graph" aria-hidden="true">{Array.from({length:9},(_,i)=><i key={i} className={`${value>=(8-i)*11?'lit':''} ${range&&(8-i)*11>=Math.min(...range)&&(8-i)*11<=Math.max(...range)?'morph-range':''}`}/>)}</span> }
function Control({control:c,value,update,text,morph=false,morphRange,hold}:{morphRange?:[number,number];hold?:(id:string,down:boolean)=>void;morph?:boolean;control:HardwareControl;value:number;update:(id:string,v:number,shift?:boolean)=>void;text?:string}) {
  const pressed=useRef<{time:number;value:number;shift:boolean}|null>(null);const suppressClick=useRef(false)
  const morphSource=c.id==='program-wheel-morph'||c.id==='program-control-pedal-morph'
  const drag=useRef<{y:number;x:number;value:number}|null>(null)
  const live=functional(c.id);const label=`${c.section} ${c.label}${live?'':' (decorative)'}`;const title=live?`${c.label} · ${text??Math.round(value)}`:`${c.label} — presentation only`
  const isButton=c.kind==='button'; const vertical=['fader','drawbar','wheel'].includes(c.kind)
  const short=c.label.replace(/^(Rotary |Layer |Arpeggiator |Oscillator |Compressor |Percussion |Filter |Program |Mod 1 |Mod 2 |Reverb |Delay |Amp |Mod )/,'')
  return <div className={`hardware-control ${c.kind} ${morph?'morph-assigned':''}`} data-control-id={c.id} data-kind={c.kind} style={{left:`${c.x}%`,top:`${c.y}%`,width:`${c.w}%`,height:`${c.h}%`}}>
    <span className="control-legend" aria-hidden="true">{short}</span>
    {isButton ? <button id={c.id} type="button" aria-label={label} aria-pressed={value>0} title={title} onPointerDown={e=>{pressed.current={time:performance.now(),value,shift:e.shiftKey};if(!e.shiftKey&&(morphSource||c.id==='program-master-clock'))hold?.(c.id,true)}}
      onPointerUp={()=>{const p=pressed.current;if(!p)return;const long=performance.now()-p.time>=500;if(!p.shift&&morphSource){hold?.(c.id,!long&&p.value===0);suppressClick.current=true}else if(c.id==='program-master-clock'){hold?.(c.id,false);suppressClick.current=long}else if(c.id==='program-split-on'&&long){update('program-split-set',100);suppressClick.current=true}pressed.current=null}}
      onPointerCancel={()=>{if(morphSource||c.id==='program-master-clock')hold?.(c.id,false);pressed.current=null;suppressClick.current=false}}
      onDoubleClick={e=>{if(morphSource&&!e.shiftKey)hold?.(c.id,true)}}
      onClick={e=>{if(suppressClick.current){suppressClick.current=false;return}update(c.id,value?0:100,e.shiftKey)}} className={value?'selected':''}><i aria-hidden="true"/></button> : <>
      {c.kind==='knob'&&<span className="knob-body" aria-hidden="true" style={{transform:`rotate(${-135+value*2.7}deg)`}}><i/></span>}
      {vertical&&<><span className="slider-track" aria-hidden="true"/><span className="slider-cap" aria-hidden="true" style={{top:`${(100-value)*.72+8}%`}}/>{c.kind!=='wheel'&&<LedGraph value={value} range={morphRange}/>}</>}
      {c.kind==='stick'&&<span className="pitch-body" aria-hidden="true" style={{transform:`rotate(${(value-50)*.4}deg)`}}/>}
      <input id={c.id} type="range" min="0" max="100" value={value} aria-valuetext={live?text:undefined} aria-label={label} title={title} onChange={e=>update(c.id,Number(e.target.value))} onKeyDown={e=>{if(e.shiftKey&&e.code==='Enter'){e.preventDefault();update(c.id,value,true)}}}
        onPointerDown={e=> { e.preventDefault(); e.currentTarget.focus(); if(e.shiftKey){update(c.id,value,true);return}e.currentTarget.setPointerCapture?.(e.pointerId); drag.current={y:e.clientY,x:e.clientX,value} }}
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
  const [,rerender]=useState(0); const [presentation,setPresentationState]=useState(initialHardware); const [zoom,setZoom]=useState(1);const [systemOpen,setSystemOpen]=useState(false);const [clockHolding,setClockHolding]=useState(false);const clockHeld=useRef(false)
  const engineRef=useRef<PianoEngine|null>(null); const midiRef=useRef<MidiInput|null>(null)
  if(!engineRef.current) engineRef.current=new PianoEngine(backend??new LayerAudioBackend(),()=>rerender(n=>n+1),32,backend?undefined:localStorage)
  const engine=engineRef.current
  if(!midiRef.current) midiRef.current=new MidiInput(engine,requestMidi??(navigator.requestMIDIAccess?async()=>await navigator.requestMIDIAccess() as unknown as MidiAccess:undefined),()=>rerender(n=>n+1))
  const midi=midiRef.current
  useEffect(()=> { const unbind=bindComputerInput(engine); const visibility=()=> { if(document.hidden) engine.allOff() }; document.addEventListener('visibilitychange',visibility); return ()=> { unbind(); document.removeEventListener('visibilitychange',visibility); midi.dispose(); engine.dispose() } },[engine,midi])
  useEffect(()=>{const exit=(event:KeyboardEvent)=>{if(event.code!=='Escape')return;if(engine.programs.store)engine.cancelStore();engine.programs.list=false;engine.state.morphAssign=null;engine.changed();setSystemOpen(false)};window.addEventListener('keydown',exit);return()=>window.removeEventListener('keydown',exit)},[engine])
  const active=engine.activeNotes(),display=previewState(engine.state),programs=engine.programs
  const holdControl=(id:string,down:boolean)=>{if(id==='program-master-clock'){clockHeld.current=down;setClockHolding(down)}else engine.updateState(s=>{s.morphAssign=down?(id.includes('wheel')?'Wheel':'Pedal'):null})}
  const updateControl=(id:string,v:number,shift?:boolean)=>{if(id==='program-program-dial'&&clockHeld.current){engine.updateState(s=>{s.clockBpm=Math.round(30+v/100*270)});return}if(id==='program-split-set'||id==='program-master-clock'&&shift){setSystemOpen(true);return}if(programAction(engine,id,v,shift))return;if(id==='effects-delay-tap')engine.tapDelay();else if(id==='performance-modulation-wheel')engine.setMorph('Wheel',v/100);else if(functional(id))engine.updateState(state=>changePanel(state,id,v,shift));else setPresentationState(state=>setPresentation(state,id,v))}
  const valueControl=(id:string)=>id==='program-program-dial'&&clockHolding?(display.clockBpm-30)/270*100:id==='program-program-dial'?(programs.store?.destination??(programs.liveMode?programs.liveSelected:programs.selected))/(programs.liveMode?7:31)*100:id==='program-live-mode'?Number(programs.liveMode)*100:id==='program-store'?Number(!!programs.store)*100:/^program-program-[1-8]$/.test(id)?Number((programs.store?.destination??(programs.liveMode?programs.liveSelected:programs.selected))%8===Number(id.at(-1))-1)*100:panelValue(display,id)
  const sampleFailed=engine.status==='fallback'&&(!(engine.backend instanceof LayerAudioBackend)||engine.backend.library.failures.has(engine.state.layers[engine.state.focus].type))
  return <main>
    <header className="app-header"><div><strong>Nord Stage 4 <span>73</span></strong><p>Interactive instrument study · Phase 3</p></div><span className="phase-label">HAMMER ACTION · E1–E7</span></header>
    <div className="instrument-viewport" aria-label="Instrument viewport; scroll horizontally when enlarged"><div className="instrument" data-testid="chassis" style={{width:`${zoom*100}%`}}>
      <div className="deck" data-testid="deck">
        {sections.map(s=><section key={s.id} className={`section ${s.id}`} data-section={s.id} aria-label={s.label} style={{width:`${Number((s.fraction*100).toFixed(2))}%`}}>
          {s.id==='performance'?<div className="brand" aria-hidden="true">nord stage 4<small>H A M M E R   A C T I O N   7 3</small></div>:<h2>{s.id==='program'?'PROGRAM':s.label.toUpperCase()}</h2>}
          {groups[s.id]?.map(([label,x,y,w,h])=><div key={label} className="control-group" aria-hidden="true" style={{left:`${x}%`,top:`${y}%`,width:`${w}%`,height:`${h}%`}}><span>{label}</span></div>)}
          {s.id==='program'&&<div className="oled program-oled" aria-label={`Program OLED: ${programs.current.name}, ${programs.dirty(engine.state)?'edited':'stored'}`}><b>{programs.liveMode?`LIVE ${programs.liveSelected+1}`:`${Math.floor(programs.selected/8)+1}.${programs.selected%8+1}`} {programs.dirty(engine.state)&&!programs.liveMode?'E':''} · SCENE {engine.state.scene===0?'I':'II'}</b><span>{programs.current.name}</span><small>{sampleFailed?'SAMPLE FAILED · FALLBACK':`PIANO ${engine.state.focus} · ${modelNames[engine.state.layers[engine.state.focus].type]}`}</small><small>{programs.store?'STORE · destination audition':`${engine.state.clockBpm} BPM · Transpose ${engine.state.transpose}`}</small></div>}
          {s.id==='synth'&&<div className="oled synth-oled" aria-label={`Synth OLED: ${waveforms[engine.state.synth.layers[engine.state.synth.focus].wave]}`}><b>SYNTH {engine.state.synth.focus} · {categories[engine.state.synth.layers[engine.state.synth.focus].wave]}</b><span>{waveforms[engine.state.synth.layers[engine.state.synth.focus].wave]}</span><small>{['LP12','LP24','HP','BP'][engine.state.synth.layers[engine.state.synth.focus].filter]} · {['Poly','Mono','Legato'][engine.state.synth.layers[engine.state.synth.focus].mode]}</small><svg viewBox="0 0 100 18" aria-label="Amplifier envelope"><path d={`M0 17 L${Math.min(35,engine.state.synth.layers[engine.state.synth.focus].ampEnv.attack*12+2)} 1 L65 ${engine.state.synth.layers[engine.state.synth.focus].ampEnv.decay>=4?1:12} L80 12 L100 17`} fill="none" stroke="currentColor"/></svg></div>}
          {['organ','piano','synth'].includes(s.id)&&(['A','B',...(s.id==='synth'?['C']:[])]).map((id,i)=>{const layer=layerAt(engine.state,`${s.id[0].toUpperCase()+s.id.slice(1)}.${id}` as LayerKey);return <span key={id} className="zone-leds" aria-label={`${s.id} ${id} zones ${layer.zones[0]+1} to ${layer.zones[1]+1}`} style={{left:`${s.id==='piano'?7+i*23:3+i*(s.id==='organ'?10:7)}%`,width:`${s.id==='piano'?14:6}%`}}>{[0,1,2,3].map(zone=><i key={zone} className={zone>=layer.zones[0]&&zone<=layer.zones[1]?'lit':''}/>)}</span>})}
          {s.id==='piano'&&<div className={`type-labels ${sampleFailed?'sample-failure':''}`} aria-hidden="true">{pianoTypes.map(type=><div key={type}>{engine.state.layers[engine.state.focus].type===type?'●':'○'} {type.toUpperCase()}</div>)}</div>}
          {hardware.filter(c=>c.section===s.id).map(c=>{const path=controlMorphPath(engine.state,c.id);const assignment=Object.values(engine.state.morphs).flat().find(m=>m.path===path);let range:[number,number]|undefined;if(assignment){const copy=structuredClone(display);setPath(copy,assignment.path,assignment.start);const start=panelValue(copy,c.id);setPath(copy,assignment.path,assignment.end);range=[start,panelValue(copy,c.id)]}return <Control key={c.id} morph={!!assignment} morphRange={range} control={c} value={functional(c.id)?valueControl(c.id):presentation[c.id]} text={functional(c.id)?panelText(display,c.id):excludedControls[c.id]} update={updateControl} hold={holdControl}/>})}
        </section>)}
      </div>
      <div className="keybed" data-testid="keybed" aria-label="73-key hammer action keyboard, E1 to E7">{engine.state.splits.on&&engine.state.splits.points.filter(p=>p.on).map((p,i)=><i key={i} className="split-led" aria-label={`Split ${p.note}, crossfade ±${p.width}`} style={{left:`${keys.find(k=>k.note===p.note)?.left??0}%`}}/>)}{keys.map(k=><button key={k.id} id={k.id} type="button" data-note={k.note} data-key-color={k.black?'black':'white'} className={`piano-key ${k.black?'black':'white'} ${active.has(k.note)?'pressed':''}`} aria-label={`Piano key ${k.name}`} aria-pressed={active.has(k.note)} style={{left:`${k.left}%`,width:`${k.width}%`}}
        onPointerDown={e=> { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture?.(e.pointerId); const rect=e.currentTarget.getBoundingClientRect(); const velocity=Math.max(.25,Math.min(1,(e.clientY-rect.top)/rect.height*.6+.4)); void engine.noteOn(`pointer:${e.pointerId}`,k.note,velocity) }}
        onPointerUp={e=>engine.noteOff(`pointer:${e.pointerId}`)} onPointerCancel={e=>engine.noteOff(`pointer:${e.pointerId}`)} onLostPointerCapture={e=>engine.noteOff(`pointer:${e.pointerId}`)}
        onKeyDown={e=> { if(['Enter','Space'].includes(e.code)) { e.preventDefault(); if(!e.repeat) void engine.noteOn(`focus:${k.note}`,k.note) } }}
        onKeyUp={e=> { if(['Enter','Space'].includes(e.code)) { e.preventDefault(); engine.noteOff(`focus:${k.note}`) } }} onBlur={()=>engine.noteOff(`focus:${k.note}`)}
      ><span aria-hidden="true">{k.name==='C4'?'C4':''}</span></button>)}</div>
    </div></div>
    <div className="utility-bar"><div className="audio-state" role="status"><i className={['ready','fallback'].includes(engine.status)?'ready':''}/>{engine.status==='idle'?'Audio idle · play a key to start':engine.status==='loading'?'Loading bundled piano recordings…':engine.status==='fallback'?`Sample failure · playable synthesis fallback · ${engine.backend instanceof LayerAudioBackend?[...engine.backend.library.failures.keys()].join(', '):''}`:engine.status==='ready'?(engine.backend instanceof LayerAudioBackend?'Ready · bundled recorded piano library':'Ready · synthesized piano'):`Audio error · ${engine.error}`}</div><div className="utility-actions"><button type="button" onClick={()=>void engine.prepare(engine.status==='fallback')}>{engine.status==='error'?'Retry audio':engine.status==='fallback'?'Retry samples':'Enable audio'}</button><button type="button" onClick={()=>void midi.connect()} disabled={midi.status==='requesting'}>MIDI: {midi.status}</button><button type="button" aria-pressed={engine.pedals.size>0} onClick={()=>engine.sustain('ui',!engine.pedals.has('ui'))}>Sustain {engine.pedals.size?'on':'off'}</button><button type="button" onClick={()=>engine.allOff()}>All notes off</button></div></div>
    <footer><p><b>Play</b> A W S E D F T G Y H U J K O L P ; &nbsp;·&nbsp; Space sustains &nbsp;·&nbsp; Touch supports chords.</p><div className="inspection"><label htmlFor="inspection-zoom">Inspect</label><input id="inspection-zoom" type="range" min="1" max="4" step=".25" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><button type="button" onClick={()=>setZoom(1)}>Fit</button></div><p className="honesty">Piano, Organ, Synth and Programs are active. Recordings: Grand/Upright/Electric; all other voices are synthesized. Shift + effect On: global. Excluded controls and detailed parameters are listed below.</p></footer>
    <SystemSettings engine={engine} open={systemOpen} setOpen={setSystemOpen}/>
    <Settings engine={engine}/>
    <details className="settings"><summary>Unsupported controls &amp; scope notes</summary><p>Excluded: preset libraries, banks beyond 32 slots, Organize, Aftertouch, Num Pad, Monitor/Copy/Paste/Swap, Section Edit/Layer Init, Aux KB, Extern, Shift menus, external clock, pedal tap; Organ physical Drawbar Live/sync, swell, tonewheel wear/trigger and tuning; Piano pedal noise/half-pedal/Triple Pedal/size/INFO/downloads; effects Variations/Chorale/loop effects/Analog delay/pedal Wah/close mic/stop angle; Synth pattern editing/zig-zag/accent/pan/hold exclude/group modes and downloads. Optional Synth samples/extra categories/filters/FM-I are unavailable. Oscillator Mix controls coarse pitch; Shape controls Osc Env amount; Amp/Mod Sustain knobs control envelope velocity; decay at maximum sustains.</p></details>
    <a className="sample-credits" href={`${import.meta.env.BASE_URL}samples/ATTRIBUTION.md`}>Sample credits &amp; licenses</a>
  </main>
}
