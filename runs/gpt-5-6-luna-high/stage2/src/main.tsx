import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PianoEngine, PianoControls, PianoType, TouchCurve, Timbre } from './pianoEngine';
import './styles.css';

type Control = { id:string; label:string; kind:'knob'|'button'|'fader'|'display'|'wheel'|'drawbar'; value?:number; oled?:boolean };
type Section = { id:string; label:string; controls:Control[]; oled?:boolean };

export const sectionDefs: Section[] = [
  { id:'performance', label:'PERFORMANCE', controls:[{id:'performance.master',label:'Master Level',kind:'knob',value:72},{id:'performance.pitch',label:'Pitch Stick',kind:'wheel',value:50},{id:'performance.mod',label:'Modulation Wheel',kind:'wheel',value:34},{id:'performance.panic',label:'Panic',kind:'button'}] },
  { id:'organ', label:'ORGAN', controls:[...Array.from({length:9},(_,i)=>({id:`organ.drawbar-${i+1}`,label:`Drawbar ${i+1}`,kind:'drawbar' as const,value:72-i*4})),...['16′','8′','4′','2′','Perc 2nd','Perc 3rd','Key Click','Vibrato'].map((label,i)=>({id:`organ.led-${i}`,label,kind:'button' as const})),{id:'organ.model',label:'B3 / Vox / Farf',kind:'button'},{id:'organ.percussion',label:'Percussion',kind:'button'},{id:'organ.rotary',label:'Rotary',kind:'knob',value:46},{id:'organ.drive',label:'Drive',kind:'knob',value:34}] },
  { id:'piano', label:'PIANO', controls:[{id:'piano.layerA',label:'Layer A',kind:'button'},{id:'piano.layerB',label:'Layer B',kind:'button'},{id:'piano.layerA.level',label:'Layer A Level',kind:'fader',value:80},{id:'piano.layerB.level',label:'Layer B Level',kind:'fader',value:65},{id:'piano.type',label:'Piano Type',kind:'button'},{id:'piano.model',label:'Model',kind:'knob',value:0},{id:'piano.touch',label:'Touch Curve',kind:'button'},{id:'piano.dynamic',label:'Dyn Comp',kind:'button'},{id:'piano.timbre',label:'Timbre',kind:'knob',value:0},{id:'piano.unison',label:'Unison',kind:'knob',value:0},{id:'piano.softRelease',label:'Soft Release',kind:'button'},{id:'piano.resonance',label:'String Res',kind:'button'},{id:'piano.softPedal',label:'Soft Pedal',kind:'button'},{id:'piano.sostenuto',label:'Sostenuto',kind:'button'},{id:'piano.reverb',label:'Reverb',kind:'knob',value:18},{id:'piano.sustain',label:'Sustain Pedal',kind:'wheel',value:0},{id:'piano.midi',label:'Connect MIDI',kind:'button'}] },
  { id:'program', label:'PROGRAM / MORPH', oled:true, controls:[{id:'program.display',label:'Program Display',kind:'display',oled:true},{id:'program.encoder',label:'Program Encoder',kind:'knob',value:44},...['Page ◀','Page ▶','Store','Shift','Exit','Live 1','Live 2','Live 3','Live 4','Live 5'].map((label,i)=>({id:`program.nav-${i}`,label,kind:'button' as const})),{id:'program.morph',label:'Morph',kind:'knob',value:38},{id:'program.wheel',label:'Wheel',kind:'button'}] },
  { id:'synth', label:'SYNTH', oled:true, controls:[{id:'synth.display',label:'Synth Display',kind:'display',oled:true},{id:'synth.layer',label:'Layer Level',kind:'fader',value:66},...['Osc 1','Osc 2','Shape','Tune','Mix','Filter','Reso','Drive','Attack','Decay','Sustain','Release','LFO','Rate','Arp','Gate'].map((label,i)=>({id:`synth.control-${i}`,label,kind:i%3===0?'knob' as const:'button' as const,value:40+i*3})),{id:'synth.arp',label:'Arpeggiator',kind:'button'}] },
  { id:'effects', label:'LAYER EFFECTS', controls:[...['Focus A','Mod 1','Mod 2','Delay','Amp / EQ','Comp','Reverb','Rotary','Rate','Depth','Time','Damp','Drive','To Rotary','Focus B'].map((label,i)=>({id:`effects.control-${i}`,label,kind:i===0||i===14?'button' as const:(i%2?'knob' as const:'button' as const),value:35+i*3}))] }
];

export const whiteCount = 43;
export const blackOffsets = new Set([0,1,3,4,5,7,8,10,11,12,14,15,17,18,19,21,22,24,25,26,28,29,30,32,33,35,36,37,39,40]);

const pianoTypes: PianoType[] = ['Grand','Upright','Electric','Clav','Digital','Misc'];
const touchCurves: TouchCurve[] = ['Heavy','Medium','Light'];
const timbres: Timbre[] = ['Off','Soft','Mid','Bright','Dyno 1','Dyno 2'];
const computerMap: Record<string, number> = { z:52, s:53, x:54, d:55, c:56, v:57, g:58, b:59, h:60, n:61, j:62, m:63, ',':64, l:65, '.':66, ';':67, '/':68, q:64, '2':65, w:66, '3':67, e:68, r:69, '5':70, t:71, '6':72, y:73, '7':74, u:75, i:76 };

function Knob({control,value,onChange}:{control:Control;value:number;onChange:(n:number)=>void}) { return <button className="knob" aria-label={control.label} onClick={()=>onChange((value+10)%101)} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowRight')onChange(Math.min(100,value+5));if(e.key==='ArrowDown'||e.key==='ArrowLeft')onChange(Math.max(0,value-5));}}><span style={{transform:`rotate(${-135+value*2.7}deg)`}}/><b>{control.label}</b></button> }
function SmallButton({control,active,onToggle}:{control:Control;active:boolean;onToggle:()=>void}) { return <button className={`switch ${active?'active':''}`} aria-label={control.label} aria-pressed={active} onClick={onToggle}><i/>{control.label}</button> }
function Wheel({control,value,onChange}:{control:Control;value:number;onChange:(n:number)=>void}) { return <label className="wheel" aria-label={control.label}><input type="range" min="0" max="100" value={value} onChange={e=>onChange(Number(e.target.value))}/><b>{control.label}</b></label> }

function Panel({section,state,setState,engine}:{section:Section;state:Record<string,number|boolean>;setState:(id:string,v:number|boolean)=>void;engine:PianoEngine}) {
  const pianoSummary = section.id === 'piano' ? `${engine.controls.pianoType} M${engine.controls.model + 1} · ${engine.controls.touch} · Dyn ${engine.controls.dynamicCompression} · A${Math.round(engine.controls.layerLevelA * 100)} B${Math.round(engine.controls.layerLevelB * 100)} · ${engine.activeVoices.length} voices` : '';
  return <section className={`panel panel-${section.id}`} aria-label={section.label}><header><span>{section.label}</span>{section.id==='performance'&&<em>NORD STAGE 4</em>}{section.id==='piano'&&<div className="status-stack" title={`${pianoSummary} · ${engine.status} · ${engine.midiStatus}`}><small className="panel-status" aria-live="polite">{engine.status}</small><small className="midi-status" aria-live="polite">{engine.midiStatus}</small></div>}</header><div className="panel-content">{section.controls.map(c=>c.kind==='display'?<div key={c.id} className="oled" role="status" aria-label={c.label}>{section.id==='program'?(state['program.nav-5']?'LIVE 1':'01  GRAND PIANO'):(state['synth.arp']?'SYNTH / ARP':'SYNTH / WAVE')}</div>:c.kind==='knob'?<Knob key={c.id} control={c} value={Number(state[c.id]??c.value??50)} onChange={v=>setState(c.id,v)}/>:c.kind==='wheel'?<Wheel key={c.id} control={c} value={Number(state[c.id]??c.value??50)} onChange={v=>setState(c.id,v)}/>:c.kind==='drawbar'?<label className="drawbar" key={c.id} aria-label={c.label}><input type="range" min="0" max="100" value={Number(state[c.id]??c.value??50)} onChange={e=>setState(c.id,Number(e.target.value))}/><span/></label>:<SmallButton key={c.id} control={c} active={Boolean(state[c.id])} onToggle={()=>setState(c.id,!state[c.id])}/>)}</div></section>
}

function Keyboard({engine,onActivity}:{engine:PianoEngine;onActivity:()=>void}) {
  const [pressed,setPressed]=useState<Set<number>>(new Set());
  const press = (note:number, source: 'pointer'|'touch'|'keyboard' = 'pointer', velocity = 0.8) => { setPressed(prev=>new Set(prev).add(note)); engine.noteOn(note,velocity,source); onActivity(); };
  const release = (note:number, source: 'pointer'|'touch'|'keyboard' = 'pointer') => { setPressed(prev=>{const n=new Set(prev);n.delete(note);return n}); engine.noteOff(note,source); onActivity(); };
  useEffect(()=>{ const down=(e:KeyboardEvent)=>{ if (e.repeat) return; const note=computerMap[e.key.toLowerCase()]; if (note !== undefined) { e.preventDefault(); press(note,'keyboard',0.72); } }; const up=(e:KeyboardEvent)=>{ const note=computerMap[e.key.toLowerCase()]; if(note!==undefined){e.preventDefault();release(note,'keyboard');} }; const blur=()=>{setPressed(new Set());engine.allNotesOff();onActivity()}; window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur); return ()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur)}; });
  return <div className="keyboard" aria-label="73-key keyboard">{Array.from({length:whiteCount},(_,i)=>{const note=40+i; return <div key={`w${i}`} className={`white-key ${pressed.has(note)?'pressed':''}`} role="button" tabIndex={0} aria-label={`White key ${i+1}`} onPointerDown={e=>press(note,e.pointerType==='touch'?'touch':'pointer',e.pointerType==='touch'?0.62:0.82)} onPointerUp={()=>release(note)} onPointerCancel={()=>release(note)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter')press(note,'keyboard')}} onKeyUp={()=>release(note,'keyboard')}>{blackOffsets.has(i)&&<div className={`black-key ${pressed.has(note+1)?'pressed':''}`} role="button" tabIndex={0} aria-label={`Black key near ${i+1}`} onPointerDown={e=>{e.stopPropagation();press(note+1,e.pointerType==='touch'?'touch':'pointer',0.86)}} onPointerUp={e=>{e.stopPropagation();release(note+1)}} onPointerCancel={e=>{e.stopPropagation();release(note+1)}} onKeyDown={e=>{e.stopPropagation();if(e.key===' '||e.key==='Enter')press(note+1,'keyboard')}} onKeyUp={e=>{e.stopPropagation();release(note+1,'keyboard')}}/>}</div>})}</div>
}

export function App(){
  const engineRef = useRef<PianoEngine | null>(null); if (!engineRef.current) engineRef.current = new PianoEngine();
  const engine = engineRef.current;
  const [state,setState]=useState<Record<string,number|boolean>>({ 'piano.layerA': true, 'piano.layerB': false, 'piano.layerA.level': 80, 'piano.layerB.level': 65, 'piano.resonance': true });
  const [,setVoiceTick] = useState(0);
  useEffect(() => engine.subscribeStatus(() => setVoiceTick(v => v + 1)), [engine]);
  const set=(id:string,v:number|boolean)=>{ setState(s=>({...s,[id]:v}));
    if(id==='performance.master') engine.setMasterVolume(Number(v)/100);
    if(id==='piano.reverb') engine.setReverb(Number(v)/100);
    if(id==='piano.sustain') engine.setSustain(Number(v)/100);
    if(id==='piano.layerA.level') engine.setControl('layerLevelA',Number(v)/100);
    if(id==='piano.layerB.level') engine.setControl('layerLevelB',Number(v)/100);
    if(id==='piano.layerA') engine.setControl('layerA',Boolean(v));
    if(id==='piano.layerB') engine.setControl('layerB',Boolean(v));
    if(id==='piano.softRelease') engine.setControl('softRelease',Boolean(v));
    if(id==='piano.resonance') engine.setControl('stringResonance',Boolean(v));
    if(id==='piano.softPedal') engine.setControl('softPedal',Boolean(v));
    if(id==='piano.sostenuto') engine.setSostenuto(Boolean(v));
    if(id==='performance.panic') engine.allNotesOff();
    if(id==='piano.midi' && v) void engine.connectMidi();
    if(id==='piano.type' && v) { const i=(pianoTypes.indexOf(engine.controls.pianoType)+1)%pianoTypes.length; engine.setControl('pianoType',pianoTypes[i]); }
    if(id==='piano.model' && typeof v === 'number') engine.setControl('model',Math.min(8,Math.round(Number(v) / 100 * 8)));
    if(id==='piano.touch' && v) { const i=(touchCurves.indexOf(engine.controls.touch)+1)%touchCurves.length; engine.setControl('touch',touchCurves[i]); }
    if(id==='piano.timbre' && typeof v === 'number') engine.setControl('timbre',timbres[Math.min(timbres.length-1,Math.floor(v/17))]);
    if(id==='piano.dynamic' && v) engine.setControl('dynamicCompression',((engine.controls.dynamicCompression+1)%4) as 0|1|2|3);
    if(id==='piano.unison' && typeof v === 'number') engine.setControl('unison',Math.min(3,Math.floor(v/26)) as 0|1|2|3);
  };
  const sections=useMemo(()=>sectionDefs,[ ]);
  return <main className="product-study"><div className="instrument"><div className="top-rail"/><div className="deck">{sections.map(s=><Panel key={s.id} section={s} state={state} setState={set} engine={engine}/>)}</div><Keyboard engine={engine} onActivity={()=>setVoiceTick(v=>v+1)}/><div className="bottom-rail"><span>73</span><span>HA 73</span><span>SWEDEN</span></div></div><p className="caption">NORD STAGE 4 · 73-key product study <span>interactive surface / piano phase 02</span></p></main>
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App/>);
