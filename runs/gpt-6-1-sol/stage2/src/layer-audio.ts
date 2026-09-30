import type {AudioBackend,VoiceOptions} from './audio'
import {SampleLibrary,renderSynthetic,voiceVelocity} from './library'
import {newInstrument,type InstrumentState,type LayerId} from './instrument'
export interface LayerContext extends Pick<AudioContext,'createGain'|'createDynamicsCompressor'|'createBufferSource'|'createBuffer'|'createBiquadFilter'|'createStereoPanner'|'decodeAudioData'|'destination'|'sampleRate'|'currentTime'|'state'> {audioWorklet:Pick<AudioWorklet,'addModule'>;resume():Promise<void>;close():Promise<void>}
type WorkletFactory=(ctx:LayerContext,name:string,options:AudioWorkletNodeOptions)=>AudioWorkletNode
const ramp=(p:AudioParam,value:number,t:number)=>{p.cancelAndHoldAtTime(t);p.linearRampToValueAtTime(value,t+.015)}
export class LayerAudioBackend implements AudioBackend {
  context:LayerContext|null=null;state:InstrumentState=newInstrument();readonly library:SampleLibrary
  private initializing:Promise<void>|null=null;private disposed=false;private acknowledgements:Array<()=>void>=[]
  buses:GainNode[]=[];chains:AudioWorkletNode[]=[];levels:GainNode[]=[];rotary:AudioWorkletNode|null=null;master:GainNode|null=null;limiter:DynamicsCompressorNode|null=null
  nodes=new Map<number,{sources:AudioBufferSourceNode[];gain:GainNode;filters:BiquadFilterNode[];pans:StereoPannerNode[];layer:LayerId;release:number}>()
  constructor(readonly createContext:()=>LayerContext=()=>new AudioContext(),library=new SampleLibrary(),readonly makeWorklet:WorkletFactory=(ctx,name,options)=>new AudioWorkletNode(ctx as AudioContext,name,options)) {this.library=library}
  get fallback(){return this.library.status==='fallback'}
  get loadingDetail(){return 'Loading bundled piano recordings'}
  async initialize(){
    if(this.disposed)throw Error('Audio backend disposed')
    if(this.initializing)return this.initializing
    this.context??=this.createContext();const ctx=this.context
    // Resume immediately inside the initiating gesture, before asynchronous file loading.
    const resumed=ctx.resume()
    this.initializing=(async()=>{
      await resumed;if(ctx.state!=='running')throw Error('Audio did not start; try another gesture.')
      if(!this.master){
        await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio/processor.js`)
        if(this.disposed)return
        this.master=ctx.createGain();this.master.gain.value=this.state.master;this.limiter=ctx.createDynamicsCompressor();this.limiter.threshold.value=-3;this.limiter.knee.value=3;this.limiter.ratio.value=20;this.limiter.attack.value=.003;this.limiter.release.value=.1;this.master.connect(this.limiter);this.limiter.connect(ctx.destination)
        this.rotary=this.makeWorklet(ctx,'stage-rotary',{numberOfInputs:2,numberOfOutputs:2,outputChannelCount:[2,2]})
        for(let i=0;i<2;i++){
          const bus=ctx.createGain(),chain=this.makeWorklet(ctx,'stage-layer',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}),level=ctx.createGain()
          level.gain.value=this.state.layers[i===0?'A':'B'].level;bus.connect(chain);chain.connect(this.rotary,0,i);this.rotary.connect(level,i,0);level.connect(this.master)
          this.buses.push(bus);this.chains.push(chain);this.levels.push(level)
        }
      }
      await this.library.load(ctx)
      if(this.disposed){this.library.clear();return}
      const nodes=[...this.chains,this.rotary!]
      const ready=Promise.all(nodes.map(node=>new Promise<void>(resolve=>{const done=()=>{node.port.onmessage=null;resolve()};this.acknowledgements.push(done);node.port.onmessage=event=>{if(event.data.ready)done()}})))
      this.configure(this.state);await ready;this.acknowledgements=[]
    })().finally(()=>{this.initializing=null})
    return this.initializing
  }
  configure(state:InstrumentState){
    this.state=structuredClone(state);const ctx=this.context;if(!ctx||!this.master||!this.rotary)return
    ramp(this.master.gain,state.master,ctx.currentTime)
    for(const [i,id] of (['A','B'] as const).entries()){
      ramp(this.levels[i].gain,state.on&&state.layers[id].enabled?state.layers[id].level:0,ctx.currentTime)
      this.chains[i].port.postMessage({effects:state.layers[id].effects,enabled:state.effectsOn,bpm:state.clockBpm})
    }
    this.rotary.port.postMessage({rotary:{...state.rotary,on:state.rotary.on&&state.effectsOn},routes:(['A','B'] as const).map(id=>state.layers[id].effects.ampEq.on&&state.layers[id].effects.ampEq.type===6)})
    for(const voice of this.nodes.values())for(const source of voice.sources)ramp(source.detune,state.layers[voice.layer].pstick?state.pitch*200:0,ctx.currentTime)
  }
  start(id:number,note:number,velocity:number,ended:()=>void,options?:VoiceOptions){
    const ctx=this.context!;const layerId=options?.layer??'A',layer=this.state.layers[layerId],gain=ctx.createGain(),sources:AudioBufferSourceNode[]=[],filters:BiquadFilterNode[]=[],pans:StereoPannerNode[]=[]
    const {touch,amplitude}=voiceVelocity(velocity,layer);const selected=this.library.choose(layer.type,note,touch)
    let buffer:AudioBuffer,root=note
    if(selected){buffer=selected.buffer;root=selected.entry.rootNote}
    else {const pcm=renderSynthetic(layer.type,note,touch,ctx.sampleRate);buffer=ctx.createBuffer(1,pcm.length,ctx.sampleRate);buffer.copyToChannel(pcm,0)}
    // Compression changes level, not the selected recording/timbre velocity.
    gain.gain.value=(selected?amplitude*.9:amplitude/(touch**1.45)*.7)/(layer.unison?Math.sqrt(3):1);gain.connect(this.buses[layerId==='A'?0:1])
    const count=layer.unison?3:1
    for(let i=0;i<count;i++){
      const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),pan=ctx.createStereoPanner();source.buffer=buffer;source.playbackRate.value=2**((note-root)/12);source.detune.value=layer.pstick?this.state.pitch*200:0
      if(count>1)source.playbackRate.value*=2**((i-1)*layer.unison*7/1200)
      pan.pan.value=count>1?(i-1)*.85:0
      const tone=layer.timbre;filter.type=tone===1?'lowpass':tone===2?'peaking':'highshelf';filter.frequency.value=tone===1?1500:tone===2?1100:tone===4?2200:4000;filter.Q.value=.8;filter.gain.value=[0,0,5,7,10,-6][tone]
      source.connect(filter);filter.connect(pan);pan.connect(gain);sources.push(source);filters.push(filter);pans.push(pan)
    }
    // Simulated sympathetic partials are active only alongside another voice or a routed pedal.
    if(layer.stringRes&&options?.resonate){
      const pcm=renderSynthetic('Misc',note+12,.2,ctx.sampleRate,8),res=ctx.createBufferSource();const b=ctx.createBuffer(1,pcm.length,ctx.sampleRate);b.copyToChannel(pcm,0);res.buffer=b;res.detune.value=layer.pstick?this.state.pitch*200:0;res.connect(gain);sources.push(res)
    }
    const release=layer.softRelease&&layer.type!=='Clav'?.48:.22
    this.nodes.set(id,{sources,gain,filters,pans,layer:layerId,release})
    let remaining=sources.length
    for(const s of sources){s.onended=()=>{if(--remaining===0){this.disconnect(id);ended()}};s.start()}
  }
  private disconnect(id:number){const n=this.nodes.get(id);if(!n)return;for(const s of n.sources){s.onended=null;s.disconnect()}for(const f of n.filters)f.disconnect();for(const p of n.pans)p.disconnect();n.gain.disconnect();this.nodes.delete(id)}
  release(id:number){const n=this.nodes.get(id);if(!n||!this.context)return;const t=this.context.currentTime;n.gain.gain.cancelAndHoldAtTime(t);n.gain.gain.linearRampToValueAtTime(0,t+n.release);for(const s of n.sources)s.stop(t+n.release)}
  kill(id:number){const n=this.nodes.get(id);if(!n)return;for(const s of n.sources){s.onended=null;s.stop()}this.disconnect(id)}
  clearEffects(){for(const n of [...this.chains,...(this.rotary?[this.rotary]:[])])n.port.postMessage({clear:true})}
  dispose(){this.disposed=true;for(const done of this.acknowledgements)done();this.acknowledgements=[];for(const id of this.nodes.keys())this.kill(id);for(const n of [...this.chains,...(this.rotary?[this.rotary]:[])]){n.port.postMessage({dispose:true});n.port.close();n.disconnect()}for(const n of [...this.buses,...this.levels])n.disconnect();this.master?.disconnect();this.limiter?.disconnect();void this.context?.close();this.library.clear();this.context=null;this.buses=[];this.chains=[];this.levels=[];this.rotary=null;this.master=null;this.limiter=null}
}
