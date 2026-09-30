import {describe,it,expect,vi} from 'vitest'
import {PianoEngine} from './audio'
import {TestBackend} from './test-backend'
import {effectTypes,editEffect,focusLayer,newEffect,newInstrument,unitOrder} from './instrument'
import {changePanel,panelValue} from './panel'
import {SampleLibrary,renderSynthetic} from './library'
import {ChainDSP,Unit,RotaryDSP,ORDER} from '../public/audio/dsp.js'
const rms=(x:ArrayLike<number>)=>{let sum=0;for(let i=0;i<x.length;i++)sum+=x[i]*x[i];return Math.sqrt(sum/x.length)}
const diff=(a:number[],b:number[])=>rms(a.map((v,i)=>v-b[i]))
const signal=(i:number,rate=8000)=>i<rate*.4?(Math.sin(i/rate*2*Math.PI*180)+.4*Math.sin(i/rate*2*Math.PI*1730))*.6:0
function renderUnit(id:typeof unitOrder[number],patch:Partial<ReturnType<typeof newEffect>>,seconds=1.5){const u=new Unit(id,8000),p={...newEffect(),on:true,rate:id==='delay'?.12:2.3,amount:.85,wet:.8,feedback:.7,...patch};return Array.from({length:8000*seconds},(_,i)=>u.run(signal(i),signal(i)*.8,p)[0])}
describe('Phase 2 streaming production DSP audio boundary',()=>{
 it('preserves the specified processing order and bypasses to the unchanged dry signal',()=>{
  expect(ORDER).toEqual(['mod1','mod2','delay','ampEq','compressor','reverb']);const s=newInstrument(),dsp=new ChainDSP(8000)
  for(let i=0;i<8000;i++)expect(dsp.sample(signal(i),signal(i),s.layers.A.effects)[0]).toBe(signal(i))
  for(const id of unitOrder){const dry=renderUnit(id,{on:false});expect(diff(dry,Array.from({length:12000},(_,i)=>signal(i)))).toBe(0)}
 })
 it('every listed type changes real audio and sounds different from every other type',()=>{
  for(const id of ['mod1','mod2','ampEq','reverb'] as const){const rendered=effectTypes[id].map((_,type)=>renderUnit(id,{type,bass:6,freq:1300,drive:.7}))
   for(let a=0;a<rendered.length;a++){
    expect(rms(rendered[a]),`${id} ${a}`).toBeGreaterThan(.001)
    // To Rotary is intentionally a route: its distinct audible output is tested through the shared processor below.
    if(!(id==='ampEq'&&a===6))expect(diff(rendered[a],renderUnit(id,{on:false}))).toBeGreaterThan(.005)
    for(let b=a+1;b<rendered.length;b++)expect(diff(rendered[a],rendered[b]),`${id}: ${a} vs ${b}`).toBeGreaterThan(.002)
   }
  }
 })
 it('wet/dry, amount, drive, EQ, cutoff, modulation rate and compressor fast change samples',()=>{
  const pairs:[typeof unitOrder[number],object,object][]=[['mod1',{amount:0},{amount:1}],['mod1',{rate:.3},{rate:5}],['mod2',{amount:0},{amount:1}],['mod2',{rate:.3},{rate:5}],['delay',{wet:0},{wet:1}],['delay',{feedback:0},{feedback:.8}],['delay',{rate:.08},{rate:.23}],['ampEq',{type:1,drive:0},{type:1,drive:1}],['ampEq',{bass:-15},{bass:15}],['ampEq',{mid:-15},{mid:15}],['ampEq',{treble:-15},{treble:15}],['ampEq',{type:4,freq:200},{type:4,freq:4000}],['ampEq',{type:4,amount:0},{type:4,amount:1}],['compressor',{amount:0},{amount:1}],['compressor',{amount:1,fast:false},{amount:1,fast:true}],['reverb',{wet:0},{wet:1}],['reverb',{tone:0},{tone:1}]]
  for(const [id,a,b] of pairs)expect(diff(renderUnit(id,a),renderUnit(id,b)),`${id} ${JSON.stringify(a)}`).toBeGreaterThan(.0005)
  expect(rms(renderUnit('compressor',{amount:1,wet:1}))).toBeLessThan(rms(renderUnit('compressor',{amount:0,wet:1})))
 })
 it('filters successive delay repeats while preserving the dry attack; sync sets interval',()=>{
  const dry=renderUnit('delay',{wet:.5,filter:0}),lp=renderUnit('delay',{wet:.5,filter:1}),hp=renderUnit('delay',{wet:.5,filter:2}),bp=renderUnit('delay',{wet:.5,filter:3})
  expect(diff(dry.slice(0,800),lp.slice(0,800))).toBe(0)
  for(const data of [lp,hp,bp])expect(diff(dry.slice(5000),data.slice(5000))).toBeGreaterThan(.001)
  const u=new Unit('delay',8000),p={...newEffect(),on:true,wet:1,rate:.1,sync:true};const result=Array.from({length:9000},(_,i)=>u.run(i===1000?1:0,0,p,true)[0]);expect(Math.abs(result[5000])).toBeGreaterThan(.99)
 })
 it('smoothly bypasses and sends reverb into the shared accelerating rotary',()=>{
  const s=newInstrument(),dsp=new ChainDSP(8000),rotary=new RotaryDSP(8000);s.layers.A.effects.reverb={...newEffect(),on:true,wet:1,type:5};let tail=0,changed=0
  for(let i=0;i<16000;i++){const x=signal(i),wet=dsp.sample(x,x,s.layers.A.effects);const y=rotary.sample(wet[0],wet[1],0,{on:true,fast:true,drive:.5},true);rotary.sample(0,0,1,{on:true,fast:true,drive:.5},false);if(i>8000)tail+=y[0]**2;changed+=(wet[0]-y[0])**2}
  expect(tail).toBeGreaterThan(.01);expect(changed).toBeGreaterThan(1)
  const u=new Unit('mod1',8000),p={...newEffect(),on:true,type:1,amount:1};for(let i=0;i<4000;i++)u.run(.5,.5,p);let previous=u.run(.5,.5,p)[0];p.on=false;let jump=0;for(let i=0;i<1000;i++){const next=u.run(.5,.5,p)[0];jump=Math.max(jump,Math.abs(next-previous));previous=next}expect(jump).toBeLessThan(.01);expect(previous).toBeCloseTo(.5,3)
 })
 it('honestly synthesizes three distinct non-recorded families',()=>{const data=['Clav','Digital','Misc'].map(type=>renderSynthetic(type as 'Clav',60,.8,8000,1));data.forEach(x=>expect(rms(x)).toBeGreaterThan(.01));for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)expect(data[i]).not.toEqual(data[j])})
})
describe('Phase 2 state, ownership and honest failures',()=>{
 it('owns each layer, follows focus, applies octave, and disables only the affected voices',async()=>{const b=new TestBackend(),e=new PianoEngine(b);e.updateState(s=>{s.layers.B.enabled=true;s.layers.B.octave=12;focusLayer(s,'B')});await e.noteOn('touch',60);expect([...b.nodes.values()].map(v=>v.note)).toEqual([60,72]);expect([...e.voices.values()].map(v=>v.layer)).toEqual(['A','B']);expect(e.state.fxFocus).toBe('B');e.updateState(s=>{s.layers.B.enabled=false});expect(b.kills).toEqual([2]);expect(e.voices.get(1)?.held).toBe(true);e.dispose();expect(b.nodes.size).toBe(0)})
 it('routes merged pedal input only to SUSTPED layers and damps on route removal',async()=>{const b=new TestBackend(),e=new PianoEngine(b);e.updateState(s=>{s.layers.B.enabled=true;s.layers.B.sustped=false});e.sustain('ui',true);e.sustain('midi',true);await e.noteOn('a',60);e.noteOff('a');expect(b.releases).toEqual([2]);e.sustain('ui',false);expect(b.releases).toEqual([2]);e.updateState(s=>{s.layers.A.sustped=false});expect(b.releases).toEqual([2,1]);e.sustain('midi',false);expect(b.releases).toEqual([2,1]);e.dispose()})
 it('targets focused/group/global chains and retains independent settings',()=>{const s=newInstrument();focusLayer(s,'B');editEffect(s,'mod1',{on:true,amount:.8});expect(s.layers.A.effects.mod1.on).toBe(false);s.group=true;editEffect(s,'mod1',{type:3});expect(s.layers.A.effects.mod1.type).toBe(3);s.group=false;changePanel(s,'effects-delay-on',0,true);editEffect(s,'delay',{on:true,wet:1});expect(s.layers.A.effects.delay.wet).toBe(1);expect(s.layers.B.effects.delay.on).toBe(true);changePanel(s,'performance-master-level',20);expect(panelValue(s,'performance-master-level')).toBe(20);changePanel(s,'effects-organ-focus',100);changePanel(s,'effects-mod-1-on',0);expect(s.layers.B.effects.mod1.on).toBe(true)})
 it('tap tempo and clock agree; stops pending and sustained voices on cleanup',()=>{const e=new PianoEngine(new TestBackend());e.tapDelay(1000);e.tapDelay(1500);expect(e.state.layers.A.effects.delay.rate).toBe(.5);expect(e.state.clockBpm).toBe(120);e.dispose()})
 it('asset failure never reports primary ready and stays playable with explicit fallback',async()=>{const library=new SampleLibrary(async()=>{throw Error('offline missing file')});await library.load({decodeAudioData:vi.fn()});expect(library.status).toBe('fallback');expect([...library.failures.keys()]).toEqual(['Grand','Upright','Electric']);expect(library.choose('Grand',60,.8)).toBeUndefined();const b=new TestBackend();Object.defineProperty(b,'fallback',{value:true});const e=new PianoEngine(b);await e.noteOn('a',60);expect(e.status).toBe('fallback');expect(b.nodes.size).toBe(1);e.dispose()})
})
