declare module '*audio/dsp.js' {
  import type {Effect,UnitId} from './instrument'
  export const ORDER:UnitId[]
  export class Unit {constructor(id:UnitId,rate:number);run(l:number,r:number,p:Effect & {bpm?:number},enabled?:boolean):number[]}
  export class ChainDSP {constructor(rate:number);sample(l:number,r:number,p:Record<UnitId,Effect>,enabled?:boolean,bpm?:number):number[];reset():void}
  export class RotaryDSP {constructor(rate:number);sample(l:number,r:number,layer:number,p:{on:boolean;fast:boolean;drive:number},routed:boolean):number[]}
}
declare module '*audio/engines.js' {
 import type {SynthLayer,OrganLayer,Envelope} from './system'
 export function env(t:number,p:Envelope,released?:number,releaseLevel?:number):number
 export function lfo(wave:number,phase:number):number
 export function oscillator(w:number,phase:number,ctrl:number,time?:number,seed?:number):number
 export function arpOrder(notes:number[],range:number,direction:number,step:number):number|null
 export class VoiceDSP {constructor(kind:string,note:number,velocity:number,settings:SynthLayer|OrganLayer,rate:number,options?:{gain?:number;percussion?:boolean;fromNote?:number});sample():number;release():void;update(settings:SynthLayer|OrganLayer,bpm:number,pitch:number,wheel:number):void;retune(note:number,velocity:number,legato:boolean):void;alive:boolean;time:number;currentNote:number}
 export class EngineDSP {constructor(kind:string,rate:number);configure(settings:SynthLayer|OrganLayer,bpm?:number,pitch?:number,wheel?:number):void;on(id:number,note:number,velocity:number,gain?:number):void;off(id:number):void;kill(id:number):void;clear():void;sample():number;voices:Map<number,VoiceDSP>;notes:Map<number,{note:number;velocity:number;gain:number;held:boolean}>;ended:number[];lastArp:number|null;frame:number;step:number}
}
