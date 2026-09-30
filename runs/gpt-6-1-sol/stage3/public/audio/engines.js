// Original streaming synthesis. Shared verbatim by AudioWorklet and audio tests.
const TAU=2*Math.PI
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v))
const frequency=n=>440*2**((n-69)/12)
export function env(t,p,released=Infinity,releaseLevel=1){const attack=Math.max(.001,p.attack),decay=Math.max(.005,p.decay);const held=t<attack?t/attack:p.decay>=4?1:Math.exp(-(t-attack)*4/decay);return t<released?held:releaseLevel*Math.max(0,1-(t-released)/Math.max(.005,p.release))}
export function lfo(wave,phase){const p=((phase%1)+1)%1;if(wave===0)return 1-4*Math.abs(p-.5);if(wave===1)return 1-2*p;if(wave===2)return 2*p-1;if(wave===3)return p<.5?1:-1;return Math.sin((Math.floor(phase)+1)*127.1)*43758.5453%1}
function saw(p){return 2*(p-Math.floor(p)) -1}
function pure(w,p,seed){const x=p-Math.floor(p);if(w===0)return Math.sin(TAU*x);if(w===1)return 1-4*Math.abs(x-.5);if(w===2)return saw(p);if(w===3)return x<.5?1:-1;if(w===4)return x<.33?1:-.4925;if(w===5)return x<.1?1:-.1111;return Math.sin(seed*127.1+311.7)*43758.5453%1}
export function oscillator(w,phase,ctrl,time=0,seed=0){if(w<=6)return pure(w,phase,seed);if(w===7||w===8){const synced=(phase%1)*(1+ctrl*7);return w===7?saw(synced):synced%1<.5?1:-1}if(w===9||w===10){let x=0;for(let i=-1;i<=1;i++)x+=saw(phase*(w===10&&i===1?2:1)+i*ctrl*time*4);return x/3}if(w===11||w===12){let x=0;for(let i=-3;i<=3;i++){const p=phase+i*ctrl*time*3.1;x+=w===11?saw(p):p%1<.5?1:-1}return x/7}return Math.sin(TAU*phase+ctrl*8*Math.sin(TAU*phase*2))}
class Filter {
 constructor(){this.x1=0;this.x2=0;this.y1=0;this.y2=0}
 run(x,type,hz,q,rate){const w=TAU*clamp(hz,20,rate*.43)/rate,c=Math.cos(w),a=Math.sin(w)/(2*q),a0=1+a;let b0,b1,b2;if(type===2){b0=(1+c)/2;b1=-(1+c);b2=b0}else if(type===3){b0=a;b1=0;b2=-a}else{b0=(1-c)/2;b1=1-c;b2=b0}const y=(b0*x+b1*this.x1+b2*this.x2+2*c*this.y1-(1-a)*this.y2)/a0;this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y}
}
export class VoiceDSP {
 constructor(kind,note,velocity,settings,rate,options={}){this.kind=kind;this.note=note;this.velocity=velocity;this.settings=settings;this.rate=rate;this.time=0;this.phase=0;this.released=Infinity;this.releaseLevel=1;this.alive=true;this.filters=[new Filter(),new Filter()];this.zone=options.gain??1;this.percussion=options.percussion!==false;this.pitch=0;this.bpm=120;this.wheel=0;this.currentNote=options.fromNote??note;this.smoothed={};this.drawbars=[...settings.drawbars??[]]}
 update(settings,bpm,pitch,wheel){this.settings=settings;this.bpm=bpm;this.pitch=pitch;this.wheel=wheel}
 release(){if(this.released!==Infinity)return;this.releaseLevel=this.kind==='Synth'?env(this.time,this.settings.ampEnv):1;this.released=this.time}
 retune(note,velocity,legato){this.note=note;this.velocity=velocity;if(!legato){this.time=0;this.released=Infinity;this.filters=[new Filter(),new Filter()]}}
 sample(){const s=this.settings,t=this.time,k=1-Math.exp(-1/(this.rate*.015));this.time+=1/this.rate
  const release=this.kind==='Synth'?s.ampEnv.release:.035;if(t>this.released+release){this.alive=false;return 0}
  const glide=this.kind==='Synth'&&s.mode>0?s.glide:0;const difference=this.note-this.currentNote;this.currentNote+=glide>0?Math.sign(difference)*Math.min(Math.abs(difference),12/(glide*this.rate)):difference
  let n=this.currentNote+(s.pstick?this.pitch*2:0),mod=0,ctrl=s.ctrl??0
  if(this.kind==='Synth'){
   const e=env(t,s.oscEnv,this.released,env(this.released,s.oscEnv))*(s.oscEnv.velocity?this.velocity:1)*s.oscEnv.amount
   if(s.oscEnv.pitch)n+=e*12;else ctrl+=e
   const hz=s.lfo.sync?this.bpm/60*s.lfo.division:s.lfo.rate;mod=lfo(s.lfo.wave,t*hz)*s.lfo.amount
   if(s.lfo.destination===0)n+=mod*2;if(s.lfo.destination===1)ctrl+=mod
   if(s.vibrato===1||s.vibrato===2)n+=Math.sin(TAU*t*s.vibRate)*s.vibAmount*.04*(s.vibrato===2?this.wheel:1)
   n+=s.coarse+s.fine/100
  }else if(s.vibOn){n+=Math.sin(TAU*t*6)*(.04+(s.vib%3)*.045)*(s.vib<3?.5:1)}
  this.phase+=frequency(n)/this.rate;let out=0
  if(this.kind==='Organ'){
   const partials=[.5,1.5,1,2,3,4,5,6,8];for(let i=0;i<9;i++){this.drawbars[i]+=(s.drawbars[i]-this.drawbars[i])*k;let a=this.drawbars[i]/8;if(s.model==='Farf')a=Number(a>.5);if(s.model==='B3 Bass'&&i!==0&&i!==2)a=0;const h=partials[i],p=this.phase*h;if(frequency(n)*h>this.rate*.45)continue
    let x=Math.sin(TAU*p);if(s.model==='Vox'){x=.7*saw(p)+.3*Math.sin(TAU*p);a*=i===8?.5:1;if(i===8)x=saw(this.phase)*(s.drawbars[7]/8+.5)}if(s.model==='Farf')x=Math.sin(TAU*p)+.35*Math.sin(TAU*p*3);if(s.model.startsWith('Pipe'))x=Math.sin(TAU*p)+.22*Math.sin(TAU*p*2)+.08*Math.sin(TAU*p*3);if(s.model==='Pipe 2')x+=.13*Math.sin(TAU*p*4);out+=x*a/(s.model==='B3'?.9+i*.2:1+i*.15)
   }
   out*=.09
   if(s.model==='B3'&&s.percussion&&this.percussion)out+=Math.sin(TAU*this.phase*(s.third?3:2))*Math.exp(-t/(s.fast?.08:.4))*(s.soft?.05:.12)
   if(s.click&&s.model.startsWith('B3')&&t<.012)out+=Math.sin((Math.floor(t*this.rate)+this.note)*173.31)*Math.exp(-t*400)*.1
   if(s.vibOn&&s.vib<3)out=out*.7+Math.sin(TAU*(this.phase-.003*Math.sin(t*TAU*6)))*.07*(1+s.vib*.4)
   out*=Math.min(1,t/.003)*(this.released===Infinity?1:Math.max(0,1-(t-this.released)/.035))
  }else{
   for(const key of ['ctrl','cutoff','res']){this.smoothed[key]??=s[key];this.smoothed[key]+=(s[key]-this.smoothed[key])*k}ctrl+=this.smoothed.ctrl-s.ctrl
   const count=s.unison?3:1;for(let i=0;i<count;i++){const detune=count===1?0:(i-1)*s.unison*.045;out+=oscillator(s.wave,this.phase+t*detune*frequency(n)/12,clamp(ctrl,0,1),t,Math.floor(t*this.rate)+this.note)/Math.sqrt(count)}
   out=Math.tanh(out*(1+s.drive*1.5))/(1+s.drive*.3)
   const e=env(t,s.filterEnv,this.released,env(this.released,s.filterEnv))*(s.filterEnv.velocity?this.velocity:1)*s.filterEnv.amount
   const tracking=s.tracking/3;const cutoff=this.smoothed.cutoff*2**(((this.note-60)*tracking)/12+e*4+(s.lfo.destination===2?mod*3:0)),q=.707+this.smoothed.res*9
   out=this.filters[0].run(out,s.filter,cutoff,q,this.rate);if(s.filter===1)out=this.filters[1].run(out,0,cutoff,q,this.rate)
   const amp=env(t,s.ampEnv,this.released,this.releaseLevel);out*=amp*(s.ampEnv.velocity?this.velocity**(s.ampEnv.velocity*.5):1)*.2
  }
  return Number.isFinite(out)?out*this.zone:0
 }
}
export function arpOrder(notes,range,direction,step){const pool=[...new Set(notes)].sort((a,b)=>a-b),all=[];for(let o=0;o<range;o++)for(const n of pool)all.push(n+o*12);if(!all.length)return null;if(direction===1)all.reverse();if(direction===2){const cycle=[...all,...all.slice(1,-1).reverse()];return cycle[step%cycle.length]}if(direction===3)return all[Math.floor((Math.sin((step+1)*12.9898)*43758.5453%1+1)%1*all.length)];return all[step%all.length]}
export class EngineDSP {
 constructor(kind,rate){this.kind=kind;this.rate=rate;this.settings=null;this.voices=new Map();this.notes=new Map();this.ended=[];this.frame=0;this.nextStep=0;this.step=0;this.bpm=120;this.pitch=0;this.wheel=0;this.lastNote=60;this.lastArp=null;this.arpVoice=null;this.gatePhase=0}
 configure(settings,bpm=120,pitch=0,wheel=0){const old=this.settings;this.settings=settings;this.bpm=bpm;this.pitch=pitch;this.wheel=wheel;if(old&&old.arp?.run!==settings.arp?.run){this.stopVoices();this.nextStep=this.frame;this.step=0;if(!settings.arp.run)for(const [id,n] of this.notes)this.startVoice(id,n)}if(old?.arp?.hold&&!settings.arp.hold)for(const [id,n] of this.notes)if(!n.held)this.off(id);for(const v of this.voices.values())v.update(settings,bpm,pitch,wheel)}
 on(id,note,velocity,gain=1){this.notes.set(id,{note,velocity,gain,held:true});if(this.settings.arp?.run)return;this.startVoice(id,this.notes.get(id))}
 startVoice(id,n){const s=this.settings;if(this.kind==='Synth'&&s.mode>0){const selected=this.selected();if(selected?.[0]!==id)return;const old=[...this.voices.values()][0];this.stopVoices();if(s.mode===2&&old){old.alive=true;old.released=Infinity;old.retune(n.note,n.velocity,true);old.zone=n.gain;this.voices.set(id,old);return}}
 const percussion=this.notes.size===1;const v=new VoiceDSP(this.kind,n.note,n.velocity,s,this.rate,{gain:n.gain,percussion,fromNote:this.kind==='Synth'&&s.mode>0&&this.notes.size>1?this.lastNote:n.note});v.update(s,this.bpm,this.pitch,this.wheel);this.voices.set(id,v);this.lastNote=n.note}
 selected(){const notes=[...this.notes.entries()];if(!notes.length)return null;if(this.settings.priority===1)notes.sort((a,b)=>a[1].note-b[1].note);else if(this.settings.priority===2)notes.sort((a,b)=>b[1].note-a[1].note);else notes.reverse();return notes[0]}
 off(id){const n=this.notes.get(id);if(!n)return;if(this.settings.arp?.hold){n.held=false;return}this.notes.delete(id);if(this.kind==='Synth'&&this.settings.mode>0&&!this.settings.arp.run){const selected=this.selected();if(selected){this.startVoice(selected[0],selected[1]);this.ended.push(id);return}}this.voices.get(id)?.release();if(!this.voices.has(id))this.ended.push(id);if(!this.notes.size&&this.arpVoice){this.arpVoice.release();this.lastArp=null}}
 kill(id){this.notes.delete(id);this.voices.delete(id);if(!this.notes.size){this.arpVoice=null;this.lastArp=null}}
 stopVoices(){this.voices.clear();this.arpVoice=null;this.lastArp=null}
 clear(){this.stopVoices();this.notes.clear();this.ended=[];this.step=0;this.nextStep=this.frame}
 sample(){if(!this.settings)return 0;const s=this.settings,a=s.arp;let out=0
  if(a?.run&&this.notes.size){const hz=(a.sync?this.bpm:a.rate)/60*(a.sync?a.division:1),interval=this.rate/Math.max(.05,hz)
   if(this.frame>=this.nextStep){this.nextStep+=interval;const note=arpOrder([...this.notes.values()].map(n=>n.note),a.range,a.direction,this.step++);if(a.mode===0){const root=[...this.notes.values()].find(n=>(note-n.note)%12===0)??[...this.notes.values()][0];this.arpVoice=new VoiceDSP('Synth',note,root.velocity,s,this.rate,{gain:root.gain});this.arpVoice.update(s,this.bpm,this.pitch,this.wheel);this.lastArp=note}else if(a.mode===1){this.stopVoices();for(const [id,n] of this.notes)this.voices.set(id,new VoiceDSP('Synth',n.note+((this.step-1)%a.range)*12,n.velocity,s,this.rate,{gain:n.gain}))}else{for(const [id,n] of this.notes)if(!this.voices.has(id))this.voices.set(id,new VoiceDSP('Synth',n.note,n.velocity,s,this.rate,{gain:n.gain}));this.gatePhase=0}}
   if(this.arpVoice){if(this.arpVoice.time>interval/this.rate*.65)this.arpVoice.release();out+=this.arpVoice.sample()}if(a.mode===1)for(const v of this.voices.values())if(v.time>interval/this.rate*.65)v.release()
   if(a.mode===2)this.gatePhase+=1/interval
  }else if(this.arpVoice){out+=this.arpVoice.sample();if(!this.arpVoice.alive)this.arpVoice=null}
  for(const [id,v] of this.voices){v.update(s,this.bpm,this.pitch,this.wheel);let x=v.sample();if(a?.run&&a.mode===2)x*=Math.max(0,1-this.gatePhase*2)**a.range;out+=x;if(!v.alive){this.voices.delete(id);if(!this.notes.has(id))this.ended.push(id)}}this.frame++;return out
 }
}
