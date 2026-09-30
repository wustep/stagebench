import {EngineDSP} from './engines.js'
import {ChainDSP,RotaryDSP} from './dsp.js'
class LayerProcessor extends AudioWorkletProcessor {
  constructor(){super();this.dsp=new ChainDSP(sampleRate);this.settings=null;this.enabled=true;this.bpm=120;this.alive=true;this.port.onmessage=({data})=>{if(data.dispose)this.alive=false;else if(data.clear)this.dsp.reset();else if(data.clockReset){for(const u of this.dsp.units)u.time=0}else {this.settings=data.effects;this.enabled=data.enabled;this.bpm=data.bpm;this.port.postMessage({ready:true})}}}
  process(inputs,outputs){const input=inputs[0],out=outputs[0];for(let i=0;i<out[0].length;i++){const l=input[0]?.[i]??0,r=input[1]?.[i]??l;const y=this.settings?this.dsp.sample(l,r,this.settings,this.enabled,this.bpm):[l,r];out[0][i]=y[0];out[1][i]=y[1]}return this.alive}
}
class RotaryProcessor extends AudioWorkletProcessor {
  constructor(){super();this.dsp=new RotaryDSP(sampleRate);this.settings={on:false,fast:false,drive:0};this.routes=[false,false];this.alive=true;this.port.onmessage=({data})=>{if(data.dispose)this.alive=false;else if(data.clear)this.dsp=new RotaryDSP(sampleRate);else {this.settings=data.rotary;this.routes=data.routes;this.port.postMessage({ready:true})}}}
  process(inputs,outputs){for(let i=0;i<outputs[0][0].length;i++)for(let layer=0;layer<outputs.length;layer++){const input=inputs[layer]??[],l=input[0]?.[i]??0,r=input[1]?.[i]??l;const y=this.dsp.sample(l,r,layer,this.settings,this.routes[layer]);outputs[layer][0][i]=y[0];outputs[layer][1][i]=y[1]}return this.alive}
}
registerProcessor('stage-layer',LayerProcessor);registerProcessor('stage-rotary',RotaryProcessor)

class EngineProcessor extends AudioWorkletProcessor {
 constructor(options){super();this.dsp=new EngineDSP(options.processorOptions.kind,sampleRate);this.alive=true;this.port.onmessage=({data})=>{if(data.dispose){this.dsp.clear();this.alive=false}else if(data.clear)this.dsp.clear();else if(data.clockReset){this.dsp.frame=0;this.dsp.nextStep=0;this.dsp.step=0}else if(data.settings){this.dsp.configure(data.settings,data.bpm,data.pitch,data.wheel);this.port.postMessage({ready:true})}else if(data.on)this.dsp.on(data.id,data.note,data.velocity,data.gain);else if(data.off)this.dsp.off(data.id);else if(data.kill)this.dsp.kill(data.id);else if(data.barrier)this.port.postMessage({barrier:data.barrier})}}
 process(_inputs,outputs){const out=outputs[0];for(let i=0;i<out[0].length;i++){const x=this.dsp.sample();out[0][i]=x;out[1][i]=x}if(this.dsp.ended.length){this.port.postMessage({ended:this.dsp.ended});this.dsp.ended=[]}return this.alive}
}
registerProcessor('stage-engine',EngineProcessor)
