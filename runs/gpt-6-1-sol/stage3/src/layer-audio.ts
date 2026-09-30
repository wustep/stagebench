import type {AudioBackend,VoiceOptions} from './audio'
import {SampleLibrary,renderSynthetic,voiceVelocity} from './library'
import {effectChains,previewState,type SynthId} from './system'
import {newInstrument,type InstrumentState,type LayerId} from './instrument'
export interface LayerContext extends Pick<AudioContext,'createGain'|'createDynamicsCompressor'|'createBufferSource'|'createBuffer'|'createBiquadFilter'|'createStereoPanner'|'decodeAudioData'|'destination'|'sampleRate'|'currentTime'|'state'> {audioWorklet:Pick<AudioWorklet,'addModule'>;resume():Promise<void>;close():Promise<void>}
type WorkletFactory=(ctx:LayerContext,name:string,options:AudioWorkletNodeOptions)=>AudioWorkletNode
const ramp=(p:AudioParam,value:number,t:number)=>{p.cancelAndHoldAtTime(t);p.linearRampToValueAtTime(value,t+.015)}
export class LayerAudioBackend implements AudioBackend {
  context:LayerContext|null=null;state:InstrumentState=newInstrument();readonly library:SampleLibrary
  private initializing:Promise<void>|null=null;private disposed=false;private acknowledgements:Array<()=>void>=[]
  buses:GainNode[]=[];chains:AudioWorkletNode[]=[];levels:GainNode[]=[];rotary:AudioWorkletNode|null=null;master:GainNode|null=null;limiter:DynamicsCompressorNode|null=null
  private nextBarrier=0;private barriers=new Map<number,()=>void>()
  streams:AudioWorkletNode[]=[];organLevels:GainNode[]=[];streamEnded=new Map<number,()=>void>()
  nodes=new Map<number,{stream?:AudioWorkletNode;sources:AudioBufferSourceNode[];gain:GainNode;filters:BiquadFilterNode[];pans:StereoPannerNode[];layer:SynthId;section?:string;release:number}>()
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
        this.rotary=this.makeWorklet(ctx,'stage-rotary',{numberOfInputs:6,numberOfOutputs:6,outputChannelCount:[2,2,2,2,2,2]})
        for(let i=0;i<6;i++){
          const bus=ctx.createGain(),chain=this.makeWorklet(ctx,'stage-layer',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}),level=ctx.createGain()
          level.gain.value=1;bus.connect(chain);chain.connect(this.rotary,0,i);this.rotary.connect(level,i,0);level.connect(this.master)
          this.buses.push(bus);this.chains.push(chain);this.levels.push(level)
        }
      }
      if(!this.streams.length)for(let i=0;i<5;i++){
        const stream=this.makeWorklet(ctx,'stage-engine',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{kind:i<2?'Organ':'Synth'}})
        stream.port.onmessage=event=>{if(event.data.barrier){this.barriers.get(event.data.barrier)?.();this.barriers.delete(event.data.barrier)}for(const id of event.data.ended??[]){this.disconnect(id);this.streamEnded.get(id)?.();this.streamEnded.delete(id)}}
        if(i<2){const level=ctx.createGain();stream.connect(level);level.connect(this.buses[2]);this.organLevels.push(level)}else stream.connect(this.buses[i+1])
        this.streams.push(stream)
      }
      await this.library.load(ctx)
      if(this.disposed){this.library.clear();return}
      const nodes=[...this.chains,this.rotary!,...this.streams]
      const ready=Promise.all(nodes.map(node=>new Promise<void>(resolve=>{const original=node.port.onmessage;const done=()=>{node.port.onmessage=original;resolve()};this.acknowledgements.push(done);node.port.onmessage=event=>{original?.call(node.port,event);if(event.data.ready)done()}})))
      this.configure(this.state);await ready;this.acknowledgements=[]
    })().finally(()=>{this.initializing=null})
    return this.initializing
  }
  /** Await queued streaming commands at deterministic offline test boundaries. */
  synchronize(){return Promise.all(this.streams.map(stream=>new Promise<void>(resolve=>{const id=++this.nextBarrier;this.barriers.set(id,resolve);stream.port.postMessage({barrier:id})})))}
  configure(state:InstrumentState){
    this.state=previewState(state);state=this.state;const ctx=this.context;if(!ctx||!this.master||!this.rotary)return
    ramp(this.master.gain,state.master,ctx.currentTime)
    const chains=effectChains(state)
    const gains=[state.on&&state.layers.A.enabled?state.layers.A.level:0,state.on&&state.layers.B.enabled?state.layers.B.level:0,1,...(['A','B','C'] as const).map(id=>state.synth.on&&state.synth.layers[id].enabled?state.synth.layers[id].level:0)]
    for(let i=0;i<6;i++){ramp(this.levels[i].gain,gains[i],ctx.currentTime);this.chains[i].port.postMessage({effects:chains[i],enabled:state.effectsOn,bpm:state.clockBpm})}
    for(let i=0;i<this.streams.length;i++){
      const layer=i<2?state.organ.layers[i===0?'A':'B']:state.synth.layers[(['A','B','C'] as const)[i-2]]
      if(i<2)ramp(this.organLevels[i].gain,state.organ.on&&layer.enabled?layer.level:0,ctx.currentTime)
      this.streams[i].port.postMessage({settings:layer,bpm:state.clockBpm,pitch:state.pitch,wheel:state.morphInput.Wheel})
    }
    this.rotary.port.postMessage({rotary:{...state.rotary,speed:Object.values(state.morphs).flat().some(m=>m.path==='rotary.speed')?state.rotary.speed:state.rotary.speed||Number(state.rotary.fast),on:state.rotary.on&&state.effectsOn},routes:chains.map((effects,i)=>i===2?state.rotary.organ:effects.ampEq.on&&effects.ampEq.type===6)})
    for(const voice of this.nodes.values())if(!voice.stream)for(const source of voice.sources)ramp(source.detune,state.layers[voice.layer as LayerId].pstick?state.pitch*200:0,ctx.currentTime)
  }
  start(id:number,note:number,velocity:number,ended:()=>void,options?:VoiceOptions){
    const ctx=this.context!;const section=options?.section??'Piano'
    if(this.state.clockSync&&!this.nodes.size)for(const node of [...this.streams,...this.chains])node.port.postMessage({clockReset:true})
    if(section!=='Piano'){
      const layer=options?.layer??'A',i=section==='Organ'?(layer==='A'?0:1):2+(['A','B','C'] as const).indexOf(layer),stream=this.streams[i]
      this.streamEnded.set(id,ended);this.nodes.set(id,{stream,sources:[],gain:this.buses[section==='Organ'?2:i+1],filters:[],pans:[],layer,section,release:0})
      stream.port.postMessage({on:true,id,note,velocity,gain:options?.zoneGain??1});return
    }
    const layerId=(options?.layer??'A') as LayerId,layer=this.state.layers[layerId],gain=ctx.createGain(),sources:AudioBufferSourceNode[]=[],filters:BiquadFilterNode[]=[],pans:StereoPannerNode[]=[]
    const {touch,amplitude}=voiceVelocity(velocity,layer);const selected=this.library.choose(layer.type,note,touch)
    let buffer:AudioBuffer,root=note
    if(selected){buffer=selected.buffer;root=selected.entry.rootNote}
    else {const pcm=renderSynthetic(layer.type,note,touch,ctx.sampleRate);buffer=ctx.createBuffer(1,pcm.length,ctx.sampleRate);buffer.copyToChannel(pcm,0)}
    // Compression changes level, not the selected recording/timbre velocity.
    gain.gain.value=(options?.zoneGain??1)*(selected?amplitude*.9:amplitude/(touch**1.45)*.7)/(layer.unison?Math.sqrt(3):1);gain.connect(this.buses[layerId==='A'?0:1])
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
  private disconnect(id:number){const n=this.nodes.get(id);if(!n)return;if(n.stream){this.nodes.delete(id);return}for(const s of n.sources){s.onended=null;s.disconnect()}for(const f of n.filters)f.disconnect();for(const p of n.pans)p.disconnect();n.gain.disconnect();this.nodes.delete(id)}
  release(id:number){const n=this.nodes.get(id);if(!n||!this.context)return;if(n.stream){n.stream.port.postMessage({off:true,id});return}const t=this.context.currentTime;n.gain.gain.cancelAndHoldAtTime(t);n.gain.gain.linearRampToValueAtTime(0,t+n.release);for(const s of n.sources)s.stop(t+n.release)}
  kill(id:number){const n=this.nodes.get(id);if(!n)return;if(n.stream){n.stream.port.postMessage({kill:true,id});this.streamEnded.delete(id);this.disconnect(id);return}for(const s of n.sources){s.onended=null;s.stop()}this.disconnect(id)}
  clearEffects(){for(const n of [...this.streams,...this.chains,...(this.rotary?[this.rotary]:[])])n.port.postMessage({clear:true})}
  dispose(){this.disposed=true;for(const resolve of this.barriers.values())resolve();this.barriers.clear();for(const done of this.acknowledgements)done();this.acknowledgements=[];for(const id of this.nodes.keys())this.kill(id);for(const n of [...this.streams,...this.chains,...(this.rotary?[this.rotary]:[])]){n.port.postMessage({dispose:true});n.port.close();n.disconnect()}for(const n of [...this.buses,...this.levels,...this.organLevels])n.disconnect();this.master?.disconnect();this.limiter?.disconnect();void this.context?.close();this.library.clear();this.context=null;this.streams=[];this.streamEnded.clear();this.organLevels=[];this.buses=[];this.chains=[];this.levels=[];this.rotary=null;this.master=null;this.limiter=null}
}
