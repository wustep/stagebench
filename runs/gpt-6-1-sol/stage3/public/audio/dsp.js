// Original streaming DSP. This module is shared by the AudioWorklet and rendered-signal tests.
export const ORDER=['mod1','mod2','delay','ampEq','compressor','reverb']
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x))
export class Biquad {
  constructor(){this.x1=0;this.x2=0;this.y1=0;this.y2=0}
  run(x,mode,f,q,rate){
    const w=2*Math.PI*clamp(f,20,rate*.44)/rate,c=Math.cos(w),s=Math.sin(w),a=s/(2*Math.max(.3,q));
    let b0,b1,b2
    if(mode==='low'){b0=(1-c)/2;b1=1-c;b2=b0}
    else if(mode==='high'){b0=(1+c)/2;b1=-(1+c);b2=b0}
    else {b0=a;b1=0;b2=-a}
    const y=(b0*x+b1*this.x1+b2*this.x2+2*c*this.y1-(1-a)*this.y2)/(1+a)
    this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y
  }
}
class Line {
  constructor(rate,seconds=3){this.data=new Float32Array(Math.ceil(rate*seconds)+4);this.index=0;this.rate=rate}
  read(seconds){const p=(this.index-clamp(seconds*this.rate,1,this.data.length-2)+this.data.length)%this.data.length;const i=Math.floor(p),f=p-i;return this.data[i]*(1-f)+this.data[(i+1)%this.data.length]*f}
  write(x){this.data[this.index]=x;this.index=(this.index+1)%this.data.length}
}
export class Unit {
  constructor(id,rate){this.id=id;this.rate=rate;this.time=0;this.mix=0;this.env=0;this.low=[0,0];this.filters=Array.from({length:10},()=>new Biquad());this.lines=Array.from({length:8},()=>new Line(rate));this.phaseStates=new Float64Array(12);this.params={};this.lastType=-1;this.typeFade=1}
  run(l,r,p,enabled=true,bpm=120){
    if(!(enabled&&p.on)&&this.mix<.000001){this.time++;return [l,r]}
    // 15 ms one-pole smoothing of audible controls and bypass. Repeats keep flowing while bypassed.
    const k=1-Math.exp(-1/(this.rate*.015))
    for(const key of ['rate','amount','wet','feedback','drive','bass','mid','freq','treble','tone']){this.params[key]??=p[key];this.params[key]+=(p[key]-this.params[key])*k}
    this.mix+=((enabled&&p.on?1:0)-this.mix)*k
    if(this.lastType===-1)this.lastType=p.type
    const changing=this.lastType!==p.type
    this.typeFade+=((changing?0:1)-this.typeFade)*k
    if(changing&&this.typeFade<.001)this.lastType=p.type
    const s=this.params,t=this.time++/this.rate,a=s.amount,hz=p.sync&&(this.id==='mod2'||this.id==='mod1'&&[0,1,4,5].includes(this.lastType))?bpm/60*(p.division??1):s.rate,sine=Math.sin(t*2*Math.PI*hz),type=this.lastType
    const src=[l,r];let out=[l,r]
    if(this.id==='mod1'){
      if(type===0){out=[l*Math.sqrt((1-a*sine)*.5)*Math.SQRT2,r*Math.sqrt((1+a*sine)*.5)*Math.SQRT2]}
      if(type===1){const v=1-a*(.5+.5*sine);out=[l*v,r*v]}
      if(type===2){const v=Math.sin(t*2*Math.PI*(25+hz*60));out=[l*((1-a)+a*v),r*((1-a)+a*v)]}
      if(type===3||type===4){this.env+= (Math.max(Math.abs(l),Math.abs(r))-this.env)*(.005);const f=type===3?200+clamp(this.env*hz*12,0,1)*6000:350+(sine*.5+.5)*a*5000;out=[this.filters[0].run(l,type===3?'band':'low',f,2+a*3,this.rate),this.filters[1].run(r,type===3?'band':'low',f,2+a*3,this.rate)];out=out.map((x,c)=>src[c]*(1-a)+x*a)}
      if(type===5){const v=1-a*(.5+.5*Math.cos(t*2*Math.PI*hz))**4;out=[l*v,r*v]}
    }
    if(this.id==='mod2'){
      if(type===2||type===3){out=src.map((x,c)=>{let y=x;for(let j=0;j<4;j++){const i=c*4+j;const f=(type===3?280:500)+(1+Math.sin(t*2*Math.PI*hz+j*(type===3?.8:.2)))*900;const g=(Math.tan(Math.PI*f/this.rate)-1)/(Math.tan(Math.PI*f/this.rate)+1);const v=g*y+this.phaseStates[i];this.phaseStates[i]=y-g*v;y=v}return x*(1-a*.65)+y*a*.65})}
      else {out=src.map((x,c)=>{let y=0;const count=type===4?3:type===0&&a>.6?2:1;for(let j=0;j<count;j++){const base=type===1?.002:type===5?.008:.018;const depth=type===1?.0015:type===5?.003:.006;const d=this.lines[c*3+j].read(base+depth*Math.sin(t*2*Math.PI*hz*(1+j*.17)+c*1.7+j*2.1));this.lines[c*3+j].write(x+(type===1?d*a*.72:0));y+=d/count}return x*(1-a*.55)+y*a*.7})}
    }
    if(this.id==='delay'){
      const seconds=p.sync?60/bpm/(p.division??1):s.rate
      out=src.map((x,c)=>{const repeat=this.lines[c].read(clamp(seconds,.025,2.8));let feedback=repeat;if(p.filter)feedback=this.filters[c].run(repeat,['','low','high','band'][p.filter],p.filter===2?1200:1800,.707,this.rate);this.lines[c].write(x+feedback*clamp(s.feedback,0,.88));return x*(1-s.wet)+repeat*s.wet})
    }
    if(this.id==='ampEq'){
      if(type===4||type===5){out=src.map((x,c)=>{let y=this.filters[c*2].run(x,type===4?'low':'high',s.freq,.707+a*3,this.rate);return this.filters[c*2+1].run(y,type===4?'low':'high',s.freq,.707+a*3,this.rate)})}
      else if(type!==6){out=src.map((x,c)=>{this.low[c]+=(x-this.low[c])*(1-Math.exp(-2*Math.PI*100/this.rate));const hi=x-this.filters[c*2].run(x,'low',4000,.707,this.rate);const mid=this.filters[c*2+1].run(x,'band',s.freq,.8,this.rate);let y=x+this.low[c]*(10**(s.bass/20)-1)+mid*(10**(s.mid/20)-1)+hi*(10**(s.treble/20)-1);if(type>0){const color=[0,3200,6500,1400][type];y=Math.tanh(y*(1+s.drive*[0,5,2,12][type]))/(1+s.drive*1.5);y=this.filters[6+c].run(y,'low',color,.707,this.rate)}return y})}
    }
    if(this.id==='compressor'){
      const peak=Math.max(Math.abs(l),Math.abs(r)),attack=p.fast?.002:.012,release=p.fast?.045:.25
      this.env+=(peak-this.env)*(1-Math.exp(-1/(this.rate*(peak>this.env?attack:release))))
      const threshold=.45-a*.38,ratio=1+a*11,gain=this.env>threshold?(threshold+(this.env-threshold)/ratio)/this.env:1
      out=src.map(x=>x*(1-s.wet)+x*gain*s.wet)
    }
    if(this.id==='reverb'){
      const decay=[.9,.28,1.8,2.2,3.5,6.5][type],times=[.0297,.0371,.0411,.0533]
      out=src.map((x,c)=>{let y=0;for(let j=0;j<4;j++){const line=this.lines[c*4+j],d=times[j]*(1+type*.21+c*.09);let v=line.read(d);const filtered=this.filters[c*4+j].run(v,'low',900+s.tone*10000,.707,this.rate);line.write(x*.35+filtered*10**(-3*d/decay));y+=v*.5}if(type===2){const g=.65;const i=8+c;const v=-g*y+this.phaseStates[i];this.phaseStates[i]=y+g*v;y=v}return x*(1-s.wet)+y*s.wet})
    }
    const mix=this.mix*this.typeFade;return [l+(out[0]-l)*mix,r+(out[1]-r)*mix]
  }
}
export class ChainDSP {
  constructor(rate){this.rate=rate;this.units=ORDER.map(id=>new Unit(id,rate))}
  sample(l,r,settings,enabled=true,bpm=120){for(let i=0;i<ORDER.length;i++){const p=settings[ORDER[i]];const result=this.units[i].run(l,r,p,enabled,bpm);l=result[0];r=result[1]}return [l,r]}
  reset(){this.units=ORDER.map(id=>new Unit(id,this.rate))}
}
export class RotaryDSP {
  constructor(rate){this.rate=rate;this.phase=0;this.bassPhase=0;this.speed=.7;this.bassSpeed=.55;this.mix=Array(6).fill(0);this.low=Array(12).fill(0);this.lines=Array.from({length:12},()=>new Line(rate,.05));this.drive=0}
  sample(l,r,layer,p,routed){if(layer===0){this.speed+=((p.stop?0:p.speed!==undefined?.7+p.speed*6.1:p.fast?6.8:.7)-this.speed)/(this.rate*.6);this.bassSpeed+=((p.stop?0:p.speed!==undefined?.55+p.speed*4.75:p.fast?5.3:.55)-this.bassSpeed)/(this.rate*.6);this.phase+=2*Math.PI*this.speed/this.rate;this.bassPhase+=2*Math.PI*this.bassSpeed/this.rate;this.drive+=(p.drive-this.drive)/(this.rate*.015)}this.mix[layer]+=((p.on&&routed?1:0)-this.mix[layer])/(this.rate*.015);const src=[l,r],out=src.map((x,c)=>{const i=layer*2+c;this.low[i]+=(x-this.low[i])*.045;this.lines[i].write(x-this.low[i]);const horn=this.lines[i].read(.006+.002*Math.sin(this.phase+c*Math.PI));const y=this.low[i]*(.85+.15*Math.sin(this.bassPhase+c*Math.PI))+horn*(.65+.35*Math.sin(this.phase+c*Math.PI));const driven=Math.tanh(y*(1+this.drive*4))/(1+this.drive);return x+(driven-x)*this.mix[layer]});return out}
}
