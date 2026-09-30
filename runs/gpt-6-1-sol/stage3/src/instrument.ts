import {newPerformance,effectChains,focusedEffects,type PerformanceState} from './system'
export type LayerId='A'|'B'
export const pianoTypes=['Grand','Upright','Electric','Clav','Digital','Misc'] as const
export type PianoType=typeof pianoTypes[number]
export const modelNames:Record<PianoType,string>={Grand:'Salamander C5',Upright:'Upright KW',Electric:'Wurlitzer EP200',Clav:'Plucked clav · synthesis',Digital:'FM keys · synthesis',Misc:'Vibraphone · synthesis'}
export const effectTypes={mod1:['A-Pan','Tremolo','Ring Mod','A-Wah','Wah','Pump'],mod2:['Chorus','Flanger','Phaser','Vibe','Ensemble','Spin'],ampEq:['EQ only','Twin','JC','Small','LP24 Filter','HP24 Filter','To Rotary'],reverb:['Room','Booth','Spring','Stage','Hall','Cathedral']} as const
export type UnitId='mod1'|'mod2'|'delay'|'ampEq'|'compressor'|'reverb'
export const unitOrder:UnitId[]=['mod1','mod2','delay','ampEq','compressor','reverb']
export interface Effect {on:boolean;type:number;rate:number;amount:number;wet:number;feedback:number;filter:number;drive:number;bass:number;mid:number;freq:number;treble:number;fast:boolean;tone:number;sync:boolean;division:number}
export interface PianoLayer {zones:[number,number];enabled:boolean;level:number;octave:number;type:PianoType;modelPosition:number;sustped:boolean;pstick:boolean;touch:number;dynComp:number;timbre:number;unison:number;softRelease:boolean;stringRes:boolean;effects:Record<UnitId,Effect>}
export interface InstrumentState extends PerformanceState {on:boolean;focus:LayerId;fxFocus:LayerId;fxSection:'Piano'|'Organ'|'Synth';group:boolean;globals:Record<'delay'|'compressor'|'reverb',boolean>;effectsOn:boolean;master:number;pitch:number;clockBpm:number;tapIndicator:boolean;rotary:{on:boolean;fast:boolean;drive:number;stop:boolean;speed:number;organ:boolean};layers:Record<LayerId,PianoLayer>}
export function newEffect():Effect {return {on:false,type:0,rate:1.3,amount:.5,wet:.35,feedback:.35,filter:0,drive:.25,bass:0,mid:0,freq:1000,treble:0,fast:false,tone:.5,sync:false,division:1}}
export function newLayer(enabled:boolean):PianoLayer {return {zones:[0,3],enabled,level:.65,octave:0,type:'Grand',modelPosition:50,sustped:true,pstick:true,touch:1,dynComp:0,timbre:0,unison:0,softRelease:false,stringRes:false,effects:Object.fromEntries(unitOrder.map(id=>[id,newEffect()])) as Record<UnitId,Effect>}}
export function newInstrument():InstrumentState {return {...newPerformance(),on:true,focus:'A',fxFocus:'A',fxSection:'Piano',group:false,globals:{delay:false,compressor:false,reverb:false},effectsOn:true,master:.42,pitch:0,clockBpm:120,tapIndicator:false,rotary:{on:false,fast:false,drive:.2,stop:false,speed:0,organ:false},layers:{A:newLayer(true),B:newLayer(false)}}}
export function effectiveVelocity(v:number,layer:PianoLayer) {return Math.max(.001,Math.min(1,v**[1.6,1,.65][layer.touch]))}
export function levelVelocity(v:number,layer:PianoLayer) {return v**(1.45-layer.dynComp*.28)}
export function timbres(type:PianoType) {return type==='Electric'?['Off','Soft','Mid','Bright','Dyno 1','Dyno 2']:['Off','Soft','Mid','Bright']}
export function editEffect(state:InstrumentState,id:UnitId,patch:Partial<Effect>) {
  const global=['delay','compressor','reverb'].includes(id)&&state.globals[id as keyof typeof state.globals]
  const targets=global?effectChains(state):state.group&&state.fxSection==='Piano'?[state.layers.A.effects,state.layers.B.effects]:state.group&&state.fxSection==='Synth'?Object.values(state.synth.layers).map(l=>l.effects):[focusedEffects(state)]
  for(const effects of targets) Object.assign(effects[id],patch)
}
export function focusLayer(state:InstrumentState,id:LayerId) {state.focus=id;state.fxFocus=id;state.fxSection='Piano'}
