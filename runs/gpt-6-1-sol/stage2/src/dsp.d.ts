declare module '*audio/dsp.js' {
  import type {Effect,UnitId} from './instrument'
  export const ORDER:UnitId[]
  export class Unit {constructor(id:UnitId,rate:number);run(l:number,r:number,p:Effect & {bpm?:number},enabled?:boolean):number[]}
  export class ChainDSP {constructor(rate:number);sample(l:number,r:number,p:Record<UnitId,Effect>,enabled?:boolean,bpm?:number):number[];reset():void}
  export class RotaryDSP {constructor(rate:number);sample(l:number,r:number,layer:number,p:{on:boolean;fast:boolean;drive:number},routed:boolean):number[]}
}
