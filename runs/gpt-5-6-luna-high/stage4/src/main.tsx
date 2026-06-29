import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PianoEngine, PianoControls, PianoType, TouchCurve, Timbre } from './pianoEngine';
import { OrganEngine, OrganModel } from './organEngine';
import { SynthEngine, SynthMode, AnalogCategory, FilterType } from './synthEngine';
import { ProgramStore, createDefaultProgramState, SPLIT_POSITIONS, MorphSource } from './programState';
import './styles.css';

type Control = { id:string; label:string; kind:'knob'|'button'|'fader'|'display'|'wheel'|'drawbar'; value?:number; oled?:boolean };
type Section = { id:string; label:string; controls:Control[]; oled?:boolean };

export const sectionDefs: Section[] = [
  { id:'performance', label:'PERFORMANCE', controls:[{id:'performance.master',label:'Master Level',kind:'knob',value:72},{id:'performance.pitch',label:'Pitch Stick',kind:'wheel',value:50},{id:'performance.mod',label:'Modulation Wheel',kind:'wheel',value:34},{id:'performance.panic',label:'Panic',kind:'button'}] },
  { id:'organ', label:'ORGAN', controls:[...Array.from({length:9},(_,i)=>({id:`organ.drawbar-${i+1}`,label:`Drawbar ${i+1}`,kind:'drawbar' as const,value:72-i*4})),...['16′','8′','4′','2′','Perc 2nd','Perc 3rd','Key Click','Vibrato'].map((label,i)=>({id:`organ.led-${i}`,label,kind:'button' as const})),{id:'organ.model',label:'B3 / Vox / Farf',kind:'button'},{id:'organ.percussion',label:'Percussion',kind:'button'},{id:'organ.rotary',label:'Rotary',kind:'knob',value:46},{id:'organ.drive',label:'Drive',kind:'knob',value:34}] },
  { id:'piano', label:'PIANO', controls:[{id:'piano.layerA',label:'Layer A',kind:'button'},{id:'piano.layerB',label:'Layer B',kind:'button'},{id:'piano.layerA.level',label:'Layer A Level',kind:'fader',value:80},{id:'piano.layerB.level',label:'Layer B Level',kind:'fader',value:65},{id:'piano.type',label:'Piano Type',kind:'button'},{id:'piano.model',label:'Model',kind:'knob',value:0},{id:'piano.touch',label:'Touch Curve',kind:'button'},{id:'piano.dynamic',label:'Dyn Comp',kind:'button'},{id:'piano.timbre',label:'Timbre',kind:'knob',value:0},{id:'piano.unison',label:'Unison',kind:'knob',value:0},{id:'piano.softRelease',label:'Soft Release',kind:'button'},{id:'piano.resonance',label:'String Res',kind:'button'},{id:'piano.softPedal',label:'Soft Pedal',kind:'button'},{id:'piano.sostenuto',label:'Sostenuto',kind:'button'},{id:'piano.reverb',label:'Reverb',kind:'knob',value:18},{id:'piano.sustain',label:'Sustain Pedal',kind:'wheel',value:0},{id:'piano.midi',label:'Connect MIDI',kind:'button'}] },
  { id:'program', label:'PROGRAM / MORPH', oled:true, controls:[{id:'program.display',label:'Program Display',kind:'display',oled:true},{id:'program.encoder',label:'Program Encoder',kind:'knob',value:44},...['Page ◀','Page ▶','Store','Store As','Undo','Cancel','Exit','Live 1','Live 2','Live 3','Live 4','Live 5','Live 6','Live 7','Live 8','Scene I','Scene II','Split Low','Split Mid','Split High','Crossfade','Morph Wheel','Morph Aftertouch','Morph Control Pedal','Numeric','Alphabetic','Category','Load Preset'].map((label,i)=>({id:`program.nav-${i}`,label,kind:'button' as const})),{id:'program.morph',label:'Morph',kind:'knob',value:38},{id:'program.wheel',label:'Wheel',kind:'button'}] },
  { id:'synth', label:'SYNTH', oled:true, controls:[{id:'synth.display',label:'Synth Display',kind:'display',oled:true},{id:'synth.layer',label:'Layer Level',kind:'fader',value:66},...['Osc 1','Osc 2','Shape','Tune','Mix','Filter','Reso','Drive','Attack','Decay','Sustain','Release','LFO','Rate','Arp','Gate'].map((label,i)=>({id:`synth.control-${i}`,label,kind:i%3===0?'knob' as const:'button' as const,value:40+i*3})),{id:'synth.arp',label:'Arpeggiator',kind:'button'}] },
  { id:'effects', label:'LAYER EFFECTS', controls:[...['Focus A','Mod 1','Mod 2','Delay','Amp / EQ','Comp','Reverb','Rotary','Rate','Depth','Time','Damp','Drive','To Rotary','Focus B','Global','Group','All Effects Off'].map((label,i)=>({id:`effects.control-${i}`,label,kind:i===0||i===14||i>=15?'button' as const:(i%2?'knob' as const:'button' as const),value:35+i*3}))] }
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

function Panel({section,state,setState,engine,program}:{section:Section;state:Record<string,number|boolean>;setState:(id:string,v:number|boolean)=>void;engine:PianoEngine;program:ProgramStore}) {
  const pianoSummary = section.id === 'piano' ? `${engine.controls.pianoType} M${engine.controls.model + 1} · ${engine.controls.touch} · Dyn ${engine.controls.dynamicCompression} · A${Math.round(engine.controls.layerLevelA * 100)} B${Math.round(engine.controls.layerLevelB * 100)} · ${engine.activeVoices.length} voices` : '';
  const programDisplay = `${program.state.name.toUpperCase()} · ${program.state.category} · ${program.state.listMode} · ${program.dirty ? 'EDIT' : 'STORED'}`;
  const effectDisplay = Object.entries(program.state.effects).filter(([, effect]) => effect.on && !effect.bypass).map(([id, effect]) => `${id}:${Math.round(effect.dryWet * 100)}%`).join(' ') || 'EFFECTS BYPASS';
  return <section className={`panel panel-${section.id}`} aria-label={section.label}><header><span>{section.label}</span>{section.id==='performance'&&<em>NORD STAGE 4</em>}{section.id==='piano'&&<div className="status-stack" title={`${pianoSummary} · ${engine.status} · ${engine.midiStatus}`}><small className="panel-status" aria-live="polite">{engine.status}</small><small className="midi-status" aria-live="polite">{engine.midiStatus}</small></div>}{section.id==='effects'&&<small className="panel-status" aria-live="polite">{effectDisplay}</small>}</header><div className="panel-content">{section.controls.map(c=>c.kind==='display'?<div key={c.id} className="oled" role="status" aria-label={c.label}>{section.id==='program'?programDisplay:(state['synth.arp']?'SYNTH / ARP':'SYNTH / WAVE')}</div>:c.kind==='knob'?<Knob key={c.id} control={c} value={Number(state[c.id]??c.value??50)} onChange={v=>setState(c.id,v)}/>:c.kind==='wheel'?<Wheel key={c.id} control={c} value={Number(state[c.id]??c.value??50)} onChange={v=>setState(c.id,v)}/>:c.kind==='drawbar'?<label className="drawbar" key={c.id} aria-label={c.label}><input type="range" min="0" max="100" value={Number(state[c.id]??c.value??50)} onChange={e=>setState(c.id,Number(e.target.value))}/><span/></label>:<SmallButton key={c.id} control={c} active={Boolean(state[c.id])} onToggle={()=>setState(c.id,!state[c.id])}/>)}</div></section>
}

function Keyboard({engine,organ,synth,onActivity}:{engine:PianoEngine;organ:OrganEngine;synth:SynthEngine;onActivity:()=>void}) {
  const [pressed,setPressed]=useState<Set<number>>(new Set());
  const press = (note:number, source: 'pointer'|'touch'|'keyboard' = 'pointer', velocity = 0.8) => { setPressed(prev=>new Set(prev).add(note)); engine.noteOn(note,velocity,source); if (organ.controls.layerA.enabled || organ.controls.layerB.enabled) organ.noteOn(note,velocity); if (synth.controls.layerA.enabled || synth.controls.layerB.enabled || synth.controls.layerC.enabled) synth.noteOn(note,velocity); onActivity(); };
  const release = (note:number, source: 'pointer'|'touch'|'keyboard' = 'pointer') => { setPressed(prev=>{const n=new Set(prev);n.delete(note);return n}); engine.noteOff(note,source); organ.allNotesOff(); synth.allNotesOff(); onActivity(); };
  useEffect(()=>{ const down=(e:KeyboardEvent)=>{ if (e.repeat) return; const note=computerMap[e.key.toLowerCase()]; if (note !== undefined) { e.preventDefault(); press(note,'keyboard',0.72); } }; const up=(e:KeyboardEvent)=>{ const note=computerMap[e.key.toLowerCase()]; if(note!==undefined){e.preventDefault();release(note,'keyboard');} }; const blur=()=>{setPressed(new Set());engine.allNotesOff();organ.allNotesOff();synth.allNotesOff();onActivity()}; window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur); return ()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur)}; });
  return <div className="keyboard" aria-label="73-key keyboard">{Array.from({length:whiteCount},(_,i)=>{const note=40+i; return <div key={`w${i}`} className={`white-key ${pressed.has(note)?'pressed':''}`} role="button" tabIndex={0} aria-label={`White key ${i+1}`} onPointerDown={e=>press(note,e.pointerType==='touch'?'touch':'pointer',e.pointerType==='touch'?0.62:0.82)} onPointerUp={()=>release(note)} onPointerCancel={()=>release(note)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter')press(note,'keyboard')}} onKeyUp={()=>release(note,'keyboard')}>{blackOffsets.has(i)&&<div className={`black-key ${pressed.has(note+1)?'pressed':''}`} role="button" tabIndex={0} aria-label={`Black key near ${i+1}`} onPointerDown={e=>{e.stopPropagation();press(note+1,e.pointerType==='touch'?'touch':'pointer',0.86)}} onPointerUp={e=>{e.stopPropagation();release(note+1)}} onPointerCancel={e=>{e.stopPropagation();release(note+1)}} onKeyDown={e=>{e.stopPropagation();if(e.key===' '||e.key==='Enter')press(note+1,'keyboard')}} onKeyUp={e=>{e.stopPropagation();release(note+1,'keyboard')}}/>}</div>})}</div>
}

export function App(){
  const engineRef = useRef<PianoEngine | null>(null); if (!engineRef.current) engineRef.current = new PianoEngine();
  const engine = engineRef.current;
  const organRef = useRef<OrganEngine | null>(null); if (!organRef.current) organRef.current = new OrganEngine(engine.audioContext, engine.graph);
  const organ = organRef.current;
  const synthRef = useRef<SynthEngine | null>(null); if (!synthRef.current) synthRef.current = new SynthEngine(engine.audioContext, engine.graph);
  const synth = synthRef.current;
  const programRef = useRef<ProgramStore | null>(null); if (!programRef.current) programRef.current = new ProgramStore();
  const program = programRef.current;
  const [state,setState]=useState<Record<string,number|boolean>>({ 'piano.layerA': true, 'piano.layerB': false, 'piano.layerA.level': 80, 'piano.layerB.level': 65, 'piano.resonance': true });
  const [,setVoiceTick] = useState(0);
  const [,setProgramTick] = useState(0);
  useEffect(() => engine.subscribeStatus(() => setVoiceTick(v => v + 1)), [engine]);
  useEffect(() => program.subscribe(() => setProgramTick(v => v + 1)), [program]);
  const set=(id:string,v:number|boolean)=>{ setState(s=>({...s,[id]:v}));
    program.update(s => {
      if (id === 'piano.layerA') { s.layers.pianoA.enabled = Boolean(v); s.scenes[s.activeScene] = Boolean(v) ? [...new Set([...s.scenes[s.activeScene], 'pianoA'])] as typeof s.scenes.I : s.scenes[s.activeScene].filter(layer => layer !== 'pianoA'); }
      if (id === 'piano.layerB') { s.layers.pianoB.enabled = Boolean(v); s.scenes[s.activeScene] = Boolean(v) ? [...new Set([...s.scenes[s.activeScene], 'pianoB'])] as typeof s.scenes.I : s.scenes[s.activeScene].filter(layer => layer !== 'pianoB'); }
      if (id === 'piano.layerA.level') s.layers.pianoA.level = Number(v) / 100;
      if (id === 'piano.layerB.level') s.layers.pianoB.level = Number(v) / 100;
      if (id === 'performance.master') s.routing.masterLevel = Number(v) / 100;
      if (id.startsWith('piano.')) s.piano[id.slice(6)] = v;
      if (id.startsWith('organ.')) s.organ[id.slice(6)] = v;
      if (id.startsWith('synth.')) s.synth[id.slice(6)] = v;
      if (id === 'performance.pitch') s.piano.pitch = Number(v) / 100;
      if (id === 'performance.mod') s.piano.mod = Number(v) / 100;
      if (id === 'program.encoder') s.displayMode = Math.round(Number(v) / 100 * 3);
      if (id === 'program.morph') s.morphs.forEach(m => { if (m.source === 'Wheel') m.end = Number(v) / 100; });
      if (id === 'effects.control-0' || id === 'effects.control-14') s.routing.focusedLayer = Boolean(v) ? 'pianoA' : 'pianoB';
    });
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
    if(id==='performance.panic') { engine.allNotesOff(); organ.allNotesOff(); synth.allNotesOff(); }
    if(id==='piano.midi' && v) void engine.connectMidi();
    if (id.startsWith('organ.drawbar-') && typeof v === 'number') organ.setDrawbar('A', Number(id.split('-')[1]) - 1, Number(v) / 100);
    if (id === 'organ.model' && v) { const models: OrganModel[] = ['B3','B3 Bass','Vox','Farf','Pipe 1','Pipe 2']; const next = models[(models.indexOf(organ.controls.layerA.model) + 1) % models.length]; organ.setLayerControl('A', 'model', next as never); }
    if (id === 'organ.percussion') organ.setLayerControl('A', 'percussion', Boolean(v) as never);
    if (id === 'organ.rotary') { const speed = Number(v) < 34 ? 'Stop' : Number(v) < 68 ? 'Slow' : 'Fast'; organ.setLayerControl('A', 'rotary', speed as never); }
    if (id === 'organ.drive' && typeof v === 'number') organ.setLayerControl('A', 'rotaryDrive', Number(v) / 100 as never);
    if (id.startsWith('organ.led-')) { const idx = Number(id.split('-')[1]); if (idx < 9) organ.setDrawbar('A', idx, Boolean(v) ? 1 : 0); if (idx === 6) organ.setLayerControl('A', 'keyClick', Boolean(v) ? .2 : 0); if (idx === 7) organ.setLayerControl('A', 'vibrato', Boolean(v)); }
    if (id === 'synth.layer' && typeof v === 'number') synth.setLayerControl('A', 'level', Number(v) / 100);
    if (id.startsWith('synth.control-')) { const idx = Number(id.split('-')[1]); const layer = synth.controls.layerA; if (idx === 0) synth.setLayerControl('A', 'waveform', (['Sine','Triangle','Saw','Square','Pulse','Noise','Super Saw'][Math.floor(Number(v) / 15)] ?? 'Saw') as never); if (idx === 1) synth.setLayerControl('A', 'oscCtrl', Number(v) / 100); if (idx === 2) synth.setLayerControl('A', 'tune', Math.round(Number(v) / 4 - 12)); if (idx === 3) synth.setLayerControl('A', 'mix', Number(v) / 100); if (idx === 4) synth.setLayerControl('A', 'filterFrequency', Number(v) / 100); if (idx === 5) synth.setLayerControl('A', 'resonance', Number(v) / 100); if (idx === 6) synth.setLayerControl('A', 'filterDrive', Math.min(3, Math.floor(Number(v) / 26)) as never); if (idx === 7) synth.setLayerControl('A', 'ampAttack', Number(v) / 100); if (idx === 8) synth.setLayerControl('A', 'ampDecay', Number(v) / 100); if (idx === 9) synth.setLayerControl('A', 'ampSustain', Number(v) / 100); if (idx === 10) synth.setLayerControl('A', 'ampRelease', Number(v) / 100); if (idx === 11) synth.setLayerControl('A', 'lfoAmount', Number(v) / 100); if (idx === 12) synth.setLayerControl('A', 'lfoRate', 1 + Number(v) / 5); if (idx === 13) synth.setLayerControl('A', 'arpRun', Boolean(v) as never); if (idx === 14) synth.setLayerControl('A', 'arpMode', Boolean(v) ? 'Arpeggiator' as never : 'Off' as never); if (idx === 15) synth.setLayerControl('A', 'arpMode', Boolean(v) ? 'Gate' as never : 'Off' as never); void layer; }
    if(id==='piano.type' && v) { const i=(pianoTypes.indexOf(engine.controls.pianoType)+1)%pianoTypes.length; engine.setControl('pianoType',pianoTypes[i]); }
    if(id==='piano.model' && typeof v === 'number') engine.setControl('model',Math.min(8,Math.round(Number(v) / 100 * 8)));
    if(id==='piano.touch' && v) { const i=(touchCurves.indexOf(engine.controls.touch)+1)%touchCurves.length; engine.setControl('touch',touchCurves[i]); }
    if(id==='piano.timbre' && typeof v === 'number') engine.setControl('timbre',timbres[Math.min(timbres.length-1,Math.floor(v/17))]);
    if(id==='piano.dynamic' && v) engine.setControl('dynamicCompression',((engine.controls.dynamicCompression+1)%4) as 0|1|2|3);
    if(id==='piano.unison' && typeof v === 'number') engine.setControl('unison',Math.min(3,Math.floor(v/26)) as 0|1|2|3);
    if(id.startsWith('effects.control-')) {
      const index = Number(id.split('-')[1]);
      if (index === 15) { Object.keys(program.state.effects).forEach(effect => { program.setEffect(effect, { global: Boolean(v) }); if (effect in engine.graph.state) engine.graph.setEffect(effect as keyof typeof engine.graph.state, { global: Boolean(v) }); }); }
      if (index === 16) { Object.keys(program.state.effects).forEach(effect => { program.setEffect(effect, { group: Boolean(v) }); if (effect in engine.graph.state) engine.graph.setEffect(effect as keyof typeof engine.graph.state, { group: Boolean(v) }); }); }
      if (index === 17) { engine.setAllEffectsBypass(Boolean(v)); program.update(s => { s.routing.allEffectsBypass = Boolean(v); }); }
      const unit = ({ 1: 'mod1', 2: 'mod2', 3: 'delay', 4: 'ampEq', 5: 'compressor', 6: 'reverb', 7: 'rotary' } as Record<number, 'mod1'|'mod2'|'delay'|'ampEq'|'compressor'|'reverb'|'rotary'>)[index] ?? (['mod1','mod2','delay','ampEq','compressor','reverb','rotary'] as const)[Math.min(6, Math.floor(index / 2))];
      if (unit && index < 15) {
        const amount = Number(v) / 100;
        const bypass = index % 2 === 0 && typeof v === 'boolean' ? !v : false;
        const toRotary = id === 'effects.control-13' || unit === 'rotary';
        engine.graph.setEffect(unit, { on: true, bypass, params: { amount, rate: amount, drive: amount, tempo: amount, feedback: amount }, dryWet: amount, toRotary });
        program.setEffect(unit, { on: true, bypass, dryWet: amount, toRotary, params: { amount, rate: amount, drive: amount, tempo: amount, feedback: amount } });
      }
      if (index === 0 || index === 14) engine.graph.setFocus(Boolean(v) ? 'piano-A' : 'piano-B');
    }
    if(id === 'program.nav-2') program.store();
    if(id === 'program.nav-3') program.storeAs(`Program ${program.programs.size + 1}`, 'Piano');
    if(id === 'program.nav-4') program.undo();
    if(id === 'program.nav-5') { program.cancelPreset(); program.cancel(); }
    if(id === 'program.nav-7' || id === 'program.nav-8' || id === 'program.nav-9' || id === 'program.nav-10' || id === 'program.nav-11' || id === 'program.nav-12' || id === 'program.nav-13' || id === 'program.nav-14') program.setLive(Number(id.split('-')[1]) - 6);
    if(id === 'program.nav-15') { program.switchScene('I'); engine.setControl('layerA', program.state.layers.pianoA.enabled); engine.setControl('layerB', program.state.layers.pianoB.enabled); }
    if(id === 'program.nav-16') { program.switchScene('II'); engine.setControl('layerA', program.state.layers.pianoA.enabled); engine.setControl('layerB', program.state.layers.pianoB.enabled); }
    if(id === 'program.nav-17') { const next = SPLIT_POSITIONS[(SPLIT_POSITIONS.indexOf(program.state.zones.low) + 1) % SPLIT_POSITIONS.length]; program.editZone('Low', next); }
    if(id === 'program.nav-18') { const next = SPLIT_POSITIONS[(SPLIT_POSITIONS.indexOf(program.state.zones.mid) + 1) % SPLIT_POSITIONS.length]; program.editZone('Mid', next); }
    if(id === 'program.nav-19') { const next = SPLIT_POSITIONS[(SPLIT_POSITIONS.indexOf(program.state.zones.high) + 1) % SPLIT_POSITIONS.length]; program.editZone('High', next); }
    if(id === 'program.nav-20') program.setCrossfade(program.state.zones.crossfade === 0 ? 6 : program.state.zones.crossfade === 6 ? 12 : 0);
    if (id === 'program.nav-0') program.browse(-1);
    if (id === 'program.nav-1') program.browse(1);
    if (id === 'program.nav-24') program.setListMode('Numeric');
    if (id === 'program.nav-25') program.setListMode('Alphabetic');
    if (id === 'program.nav-26') program.setListMode('Category');
    if (id === 'program.nav-27') { const preset = '01 Grand Piano'; if (!program.presets.has(preset)) program.storePreset(preset, 'Piano'); program.browsePreset(preset); }
    if (id.startsWith('program.nav-17') || id.startsWith('program.nav-18') || id.startsWith('program.nav-19') || id === 'program.nav-20') {
      const midi = (position: string) => 12 + ({ C2: 12, F2: 17, C3: 24, F3: 29, C4: 36, F4: 41, C5: 48, F5: 53, C6: 60, F6: 65, C7: 72 } as Record<string, number>)[position];
      engine.setRouting({ low: midi(program.state.zones.low), mid: midi(program.state.zones.mid), high: midi(program.state.zones.high), crossfade: program.state.zones.crossfade });
    }
    if(id === 'program.nav-21' || id === 'program.nav-22' || id === 'program.nav-23') { const source: MorphSource = id === 'program.nav-21' ? 'Wheel' : id === 'program.nav-22' ? 'Aftertouch' : 'Control Pedal'; program.assignMorph(source, 'layer.pianoA', program.state.layers.pianoA.level, 1); }
    if (id === 'program.display') program.setDisplayMode((program.state.displayMode + 1) % 4);
    if (id === 'program.nav-0') program.setBankPage(program.state.bank, Math.max(1, program.state.page - 1));
    if (id === 'program.nav-1') program.setBankPage(program.state.bank, Math.min(8, program.state.page + 1));
    if (id === 'performance.pitch' || id === 'performance.mod' || id === 'program.morph') {
      const source: MorphSource = id === 'performance.mod' || id === 'program.morph' ? 'Wheel' : 'Aftertouch';
      program.applyMorph(source, Number(v) / 100);
      program.state.morphs.filter(m => m.source === source).forEach(m => { if (m.destination === 'layer.pianoA') engine.setControl('layerLevelA', Number(program.state.layers.pianoA.level)); });
    }
  };
  const sections=useMemo(()=>sectionDefs,[ ]);
  return <main className="product-study"><div className="instrument"><div className="top-rail"/><div className="deck">{sections.map(s=><Panel key={s.id} section={s} state={state} setState={set} engine={engine} program={program}/>)}</div><Keyboard engine={engine} organ={organ} synth={synth} onActivity={()=>setVoiceTick(v=>v+1)}/><div className="bottom-rail"><span>73</span><span>HA 73</span><span>SWEDEN</span><span className="program-meta" aria-live="polite">{program.state.name}{program.dirty ? ' · EDITED' : ''} · {program.state.zones.low}/{program.state.zones.mid}/{program.state.zones.high} · Scene {program.state.activeScene} · Morph {program.state.morphs.length}</span></div></div><p className="caption">NORD STAGE 4 · 73-key product study <span>interactive surface / programs + effects phase 04</span></p></main>
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App/>);
