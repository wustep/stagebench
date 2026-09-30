import {ChainDSP,RotaryDSP} from './dsp.js'
class LayerProcessor extends AudioWorkletProcessor {
  constructor(){super();this.dsp=new ChainDSP(sampleRate);this.settings=null;this.enabled=true;this.bpm=120;this.alive=true;this.port.onmessage=({data})=>{if(data.dispose)this.alive=false;else if(data.clear)this.dsp.reset();else {this.settings=data.effects;this.enabled=data.enabled;this.bpm=data.bpm;this.port.postMessage({ready:true})}}}
  process(inputs,outputs){const input=inputs[0],out=outputs[0];for(let i=0;i<out[0].length;i++){const l=input[0]?.[i]??0,r=input[1]?.[i]??l;const y=this.settings?this.dsp.sample(l,r,this.settings,this.enabled,this.bpm):[l,r];out[0][i]=y[0];out[1][i]=y[1]}return this.alive}
}
class RotaryProcessor extends AudioWorkletProcessor {
  constructor(){super();this.dsp=new RotaryDSP(sampleRate);this.settings={on:false,fast:false,drive:0};this.routes=[false,false];this.alive=true;this.port.onmessage=({data})=>{if(data.dispose)this.alive=false;else if(data.clear)this.dsp=new RotaryDSP(sampleRate);else {this.settings=data.rotary;this.routes=data.routes;this.port.postMessage({ready:true})}}}
  process(inputs,outputs){for(let i=0;i<outputs[0][0].length;i++)for(let layer=0;layer<2;layer++){const input=inputs[layer],l=input[0]?.[i]??0,r=input[1]?.[i]??l;const y=this.dsp.sample(l,r,layer,this.settings,this.routes[layer]);outputs[layer][0][i]=y[0];outputs[layer][1][i]=y[1]}return this.alive}
}
registerProcessor('stage-layer',LayerProcessor);registerProcessor('stage-rotary',RotaryProcessor)
