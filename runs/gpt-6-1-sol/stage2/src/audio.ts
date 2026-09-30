import {editEffect,newInstrument,type InstrumentState,type LayerId} from './instrument'
export type AudioStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
export interface VoiceOptions {layer:LayerId;resonate:boolean}
export interface AudioBackend { configure?(state:InstrumentState):void; readonly fallback?:boolean;clearEffects?():void; initialize():Promise<void>; start(id:number,note:number,velocity:number,ended:()=>void,options?:VoiceOptions):void; release(id:number):void; kill(id:number):void; dispose():void }
export const RELEASE_SECONDS = .22
/** Original analytic synthesis, not recorded piano samples. This exact PCM feeds Web Audio. */
export function pianoSignal(note:number,velocity:number,t:number):number {
  const v=Math.max(0,Math.min(1,velocity)); const frequency=440*2**((note-69)/12)
  const attack=Math.min(1,t/.004); let sum=0
  for(let h=1;h<=7;h++) { const decay=Math.exp(-t*(.65+h*.42)); const amplitude=(1/h**1.7)*(h===1?1:.25+.65*v); sum+=Math.sin(2*Math.PI*frequency*h*(1+.000055*h*h)*t)*amplitude*decay }
  return sum*attack*v**1.45*.32
}
export function renderPiano(note:number,velocity:number,rate:number,seconds:number,releaseAt=Infinity):Float32Array<ArrayBuffer> {
  const pcm=new Float32Array(Math.ceil(rate*seconds))
  const v=Math.max(0,Math.min(1,velocity));const frequency=440*2**((note-69)/12)
  // Recurrences produce the same analytic partials without millions of sin/exp calls on note-on.
  for(let h=1;h<=7;h++) {
    const step=2*Math.PI*frequency*h*(1+.000055*h*h)/rate
    const sinStep=Math.sin(step);const cosStep=Math.cos(step);const decayStep=Math.exp(-(.65+h*.42)/rate)
    const amplitude=(1/h**1.7)*(h===1?1:.25+.65*v)
    let sine=0;let cosine=1;let decay=1
    for(let i=0;i<pcm.length;i++) { pcm[i]+=sine*decay*amplitude;const next=sine*cosStep+cosine*sinStep;cosine=cosine*cosStep-sine*sinStep;sine=next;decay*=decayStep }
  }
  const level=v**1.45*.32
  for(let i=0;i<pcm.length;i++) { const t=i/rate;const release=t<releaseAt?1:Math.max(0,1-(t-releaseAt)/RELEASE_SECONDS);pcm[i]*=Math.min(1,t/.004)*level*release }
  return pcm
}
export type AudioContextBoundary = Pick<AudioContext,'createGain'|'createDynamicsCompressor'|'createBufferSource'|'createBuffer'|'destination'|'sampleRate'|'currentTime'|'resume'|'close'|'state'>
export class WebAudioBackend implements AudioBackend {
  constructor(readonly createContext:()=>AudioContextBoundary=()=>new AudioContext()) {}
  private context:AudioContextBoundary|null=null
  private master:GainNode|null=null
  private limiter:DynamicsCompressorNode|null=null
  private nodes=new Map<number,{source:AudioBufferSourceNode;gain:GainNode}>()
  async initialize() {
    this.context ??= this.createContext()
    if(!this.master) { this.master=this.context.createGain(); this.master.gain.value=.42; this.limiter=this.context.createDynamicsCompressor(); this.master.connect(this.limiter); this.limiter.connect(this.context.destination) }
    await this.context.resume()
    if(this.context.state!=='running') throw new Error('Audio did not start; try another gesture.')
  }
  start(id:number,note:number,velocity:number,ended:()=>void) {
    const ctx=this.context!; const source=ctx.createBufferSource(); const gain=ctx.createGain()
    const pcm=renderPiano(note,velocity,ctx.sampleRate,10); const buffer=ctx.createBuffer(1,pcm.length,ctx.sampleRate); buffer.copyToChannel(pcm,0)
    source.buffer=buffer; source.connect(gain); gain.connect(this.master!); this.nodes.set(id,{source,gain})
    source.onended=()=>{ source.disconnect(); gain.disconnect(); this.nodes.delete(id); ended() }; source.start()
  }
  release(id:number) { const n=this.nodes.get(id); if(!n||!this.context) return; const t=this.context.currentTime; n.gain.gain.cancelScheduledValues(t); n.gain.gain.setValueAtTime(n.gain.gain.value,t); n.gain.gain.linearRampToValueAtTime(0,t+RELEASE_SECONDS); n.source.stop(t+RELEASE_SECONDS) }
  kill(id:number) { const n=this.nodes.get(id); if(!n) return; n.source.onended=null; n.source.stop(); n.source.disconnect(); n.gain.disconnect(); this.nodes.delete(id) }
  dispose() { for(const id of this.nodes.keys()) this.kill(id); this.master?.disconnect(); this.limiter?.disconnect(); void this.context?.close(); this.context=null; this.master=null; this.limiter=null }
}
export interface Voice { id:number; owner:string; note:number; velocity:number; held:boolean; releasing:boolean;layer:LayerId }
export class PianoEngine {
  state:InstrumentState=newInstrument(); status:AudioStatus='idle'; error=''; readonly voices=new Map<number,Voice>(); readonly pending=new Map<string,{note:number;velocity:number}>(); readonly pedals=new Set<string>(); readonly held=new Map<string,number>()
  private nextId=0; private initializing:Promise<void>|null=null; private disposed=false
  constructor(readonly backend:AudioBackend,readonly changed:()=>void=()=>{},readonly polyphony=32) {}
  async prepare(force=false) {
    if(this.disposed) return
    if(!force&&(this.status==='ready'||this.status==='fallback')) return
    if(this.initializing) return this.initializing
    this.status='loading'; this.error=''; this.changed()
    this.backend.configure?.(this.state)
    this.initializing=this.backend.initialize().then(()=> { if(!this.disposed) this.status=this.backend.fallback?'fallback':'ready' }).catch(e=> { this.status='error'; this.error=String(e); this.pending.clear() }).finally(()=> { this.initializing=null; if(!this.disposed) this.changed() })
    return this.initializing
  }
  async noteOn(owner:string,note:number,velocity=.75) {
    if(this.disposed||!Number.isInteger(note)||note<28||note>100||!Number.isFinite(velocity)||velocity<=0) return
    this.noteOff(owner); this.held.set(owner,note); this.pending.set(owner,{note,velocity:Math.min(1,velocity)}); this.changed(); await this.prepare()
    const pending=this.pending.get(owner)
    if(!pending||this.disposed||!['ready','fallback'].includes(this.status)) return
    this.pending.delete(owner)
    for(const layer of ['A','B'] as const) {
      const settings=this.state.layers[layer];if(!this.state.on||!settings.enabled)continue
      if(this.voices.size>=this.polyphony) { const oldest=[...this.voices.values()].sort((a,b)=>Number(b.releasing)-Number(a.releasing)||Number(a.held)-Number(b.held)||a.id-b.id)[0]; this.backend.kill(oldest.id); this.voices.delete(oldest.id) }
      const id=++this.nextId; const voice={id,owner,...pending,held:true,releasing:false,layer}; this.voices.set(id,voice)
      try { this.backend.start(id,pending.note+settings.octave,pending.velocity,()=> { this.voices.delete(id); this.changed() },{layer,resonate:(settings.sustped&&this.pedals.size>0)||[...this.voices.values()].some(v=>v.id!==id&&v.layer===layer&&v.held)}) } catch(e) { this.voices.delete(id); this.status='error'; this.error=String(e); this.allOff();break }
    }
    this.changed()
  }
  noteOff(owner:string) { this.held.delete(owner); this.pending.delete(owner); for(const voice of this.voices.values()) if(voice.owner===owner&&voice.held) { voice.held=false; if(!this.pedals.size||!this.state.layers[voice.layer].sustped) this.release(voice) }; this.changed() }
  private release(v:Voice) { if(v.releasing) return; v.releasing=true; this.backend.release(v.id) }
  sustain(owner:string,down:boolean) { if(down) this.pedals.add(owner); else this.pedals.delete(owner); if(!this.pedals.size) for(const v of this.voices.values()) if(!v.held) this.release(v); this.changed() }
  private lastTap:number|null=null
  tapDelay(now=performance.now()) {this.state.tapIndicator=!this.state.tapIndicator;this.changed();if(this.lastTap!==null){const seconds=Math.max(.025,Math.min(2.8,(now-this.lastTap)/1000));this.updateState(state=>{editEffect(state,'delay',{rate:seconds,sync:false});state.clockBpm=60/seconds})}this.lastTap=now}
  updateState(mutator:(state:InstrumentState)=>void) {
    mutator(this.state)
    for(const v of this.voices.values()) {
      if(!this.state.on||!this.state.layers[v.layer].enabled){this.backend.kill(v.id);this.voices.delete(v.id)}
      else if(!v.held&&!this.state.layers[v.layer].sustped)this.release(v)
    }
    this.backend.configure?.(this.state);this.changed()
  }
  allOff() { this.held.clear(); this.pending.clear(); this.pedals.clear(); for(const id of this.voices.keys()) this.backend.kill(id); this.voices.clear(); this.backend.clearEffects?.();this.changed() }
  dispose() { this.disposed=true; this.allOff(); this.backend.dispose() }
  activeNotes() { return new Set(this.held.values()) }
}
