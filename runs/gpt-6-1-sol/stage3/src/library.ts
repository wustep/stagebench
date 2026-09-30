import {renderPiano} from './audio'
import {effectiveVelocity,levelVelocity,type PianoLayer,type PianoType} from './instrument'
export interface SampleEntry {type:PianoType;file:string;rootNote:number;velocityLow:number;velocityHigh:number;source:string;sha256:string;license:string;author:string;originalFile:string;bytes:number}
export type AssetFetch=(url:string)=>Promise<Response>
export class SampleLibrary {
  entries:SampleEntry[]=[];buffers=new Map<string,AudioBuffer>();failures=new Map<PianoType,string>();status:'idle'|'loading'|'ready'|'fallback'='idle'
  constructor(readonly fetchAsset:AssetFetch=url=>fetch(url),readonly base=import.meta.env.BASE_URL) {}
  async load(ctx:Pick<BaseAudioContext,'decodeAudioData'>) {
    this.status='loading';this.failures.clear()
    try {
      const response=await this.fetchAsset(`${this.base}samples/manifest.json`);if(!response.ok)throw Error('Sample manifest unavailable')
      this.entries=await response.json() as SampleEntry[]
      await Promise.all(['Grand','Upright','Electric'].map(async kind=>{
        const entries=this.entries.filter(e=>e.type===kind)
        try {
          if(!entries.length)throw Error('No recordings in manifest')
          // Bound decode concurrency so initial preparation does not flood the browser.
          for(let i=0;i<entries.length;i+=6)await Promise.all(entries.slice(i,i+6).map(async entry=>{
            if(this.buffers.has(entry.file))return
            const r=await this.fetchAsset(`${this.base}${entry.file.split('/').map(encodeURIComponent).join('/')}`);if(!r.ok)throw Error(`${entry.file}: ${r.status}`)
            const data=await r.arrayBuffer();try{this.buffers.set(entry.file,await ctx.decodeAudioData(data))}catch(e){throw Error(`${entry.file}: ${String(e)} (${data.byteLength} bytes)`)}
          }))
        }catch(e){this.failures.set(kind as PianoType,String(e))}
      }))
    }catch(e){for(const kind of ['Grand','Upright','Electric'] as const)this.failures.set(kind,String(e))}
    this.status=this.failures.size?'fallback':'ready'
  }
  choose(type:PianoType,note:number,velocity:number) {
    if(this.failures.has(type))return undefined
    const entries=this.entries.filter(e=>e.type===type&&this.buffers.has(e.file));const v=Math.round(velocity*127)
    const selected=entries.sort((a,b)=>{
      const penalty=(e:SampleEntry)=>Math.abs(e.rootNote-note)+(v<e.velocityLow||v>e.velocityHigh?12:0)
      return penalty(a)-penalty(b)
    })[0]
    return selected?{entry:selected,buffer:this.buffers.get(selected.file)!}:undefined
  }
  clear(){this.buffers.clear();this.entries=[]}
}
/** Original synthesis for the three allowed synthetic types and explicit failed-recording fallback. */
export function renderSynthetic(type:PianoType,note:number,velocity:number,rate:number,seconds=10):Float32Array<ArrayBuffer> {
  if(['Grand','Upright','Electric'].includes(type))return renderPiano(note,velocity,rate,seconds)
  const pcm=new Float32Array(Math.ceil(rate*seconds)),f=440*2**((note-69)/12)
  for(let i=0;i<pcm.length;i++){
    const t=i/rate,phase=2*Math.PI*f*t,attack=Math.min(1,t/.003)
    let signal=0
    if(type==='Clav'){for(let h=1;h<12;h++)signal+=Math.sin(phase*h)*Math.exp(-t*(2+h*.7))/h;signal*=.2}
    if(type==='Digital')signal=Math.sin(phase+Math.sin(phase*2)*3*velocity*Math.exp(-t*2))*Math.exp(-t*.8)*.32
    if(type==='Misc')signal=(Math.sin(phase)*Math.exp(-t*1.5)+.4*Math.sin(phase*2.76)*Math.exp(-t*3.3)+.2*Math.sin(phase*5.4)*Math.exp(-t*5))*.32
    pcm[i]=signal*attack*velocity**1.45
  }
  return pcm
}
export function voiceVelocity(v:number,layer:PianoLayer){const touch=effectiveVelocity(v,layer);return {touch,amplitude:levelVelocity(touch,layer)}}
