import { describe,it,expect,vi } from 'vitest'
import { PianoEngine, pianoSignal, renderPiano, WebAudioBackend } from './audio'
import { TestBackend } from './test-backend'
const rms=(x:Float32Array)=>Math.sqrt(x.reduce((sum,v)=>sum+v*v,0)/x.length)
describe('basic piano signal',()=> {
  it('renders actual non-silent PCM with stronger velocity and pitch distinctions',()=> {
    const soft=renderPiano(60,.3,24000,1); const hard=renderPiano(60,1,24000,1)
    expect(rms(soft)).toBeGreaterThan(.005); expect(rms(hard)).toBeGreaterThan(rms(soft)*3)
    expect(hard).not.toEqual(renderPiano(64,1,24000,1)); expect(rms(hard.slice(16000))).toBeLessThan(rms(hard.slice(0,8000)))
  })
  it('matches the analytic piano signal with the faster buffer renderer',()=> {
    const pcm=renderPiano(64,.8,24000,.1)
    for(const i of [1,25,99,500,1600,2399]) expect(pcm[i]).toBeCloseTo(pianoSignal(64,.8,i/24000),6)
  })
  it('sustain extends output while damper release produces silence after its tail',()=> {
    const held=renderPiano(60,.8,24000,2); const released=renderPiano(60,.8,24000,2,.2)
    expect(rms(held.slice(24000))).toBeGreaterThan(.01); expect(rms(released.slice(12000))).toBe(0)
    expect(rms(released.slice(6000,9000))).toBeGreaterThan(0)
  })
})
describe('owned note lifecycle',()=> {
  it('releases independently overlapping notes and collects ended nodes',async()=> {
    const b=new TestBackend(); const e=new PianoEngine(b)
    await e.noteOn('p1',60,.2); await e.noteOn('p2',60,.9)
    expect(e.voices.size).toBe(2); e.noteOff('p1'); expect(b.releases).toEqual([1]); expect(e.voices.get(2)?.held).toBe(true)
    b.end(1); expect(e.voices.size).toBe(1); e.noteOff('p2'); b.end(2); expect(e.voices.size).toBe(0); expect(b.nodes.size).toBe(0)
  })
  it('repeated owner rearticulates and multiple sustain sources must all release',async()=> {
    const b=new TestBackend(); const e=new PianoEngine(b)
    await e.noteOn('key',60); await e.noteOn('key',60); expect(b.releases).toEqual([1]); expect(e.voices.size).toBe(2)
    e.sustain('ui',true); e.sustain('midi',true); e.noteOff('key'); expect(b.releases).toEqual([1])
    e.sustain('ui',false); expect(b.releases).toEqual([1]); e.sustain('midi',false); expect(b.releases).toEqual([1,2])
    e.sustain('midi',false); expect(b.releases).toEqual([1,2])
  })
  it('steals released first, then oldest unheld, then oldest held, deterministically',async()=> {
    const b=new TestBackend(); const e=new PianoEngine(b,()=>{},2)
    await e.noteOn('a',60); await e.noteOn('b',62); e.noteOff('b'); await e.noteOn('c',64); expect(b.kills).toEqual([2])
    await e.noteOn('d',65); expect(b.kills).toEqual([2,1]); expect(e.voices.size).toBe(2)
    e.allOff(); expect(e.voices.size).toBe(0); expect(b.nodes.size).toBe(0); expect(e.pedals.size).toBe(0)
  })
  it('plays the full E1–E7 range and steals the oldest sustained note before held notes',async()=> {
    const b=new TestBackend(); const e=new PianoEngine(b,()=>{},3)
    await e.noteOn('low',28);await e.noteOn('high',100);e.sustain('pedal',true);e.noteOff('high')
    await e.noteOn('middle',60);await e.noteOn('next',64)
    expect(b.kills).toEqual([2]);expect(e.voices.get(1)?.note).toBe(28);expect(e.voices.size).toBe(3)
    e.dispose();expect(b.nodes.size).toBe(0)
  })
  it('keeps physically held keys depressed after a voice is stolen or naturally ends',async()=> {
    const b=new TestBackend();const e=new PianoEngine(b,()=>{},1)
    await e.noteOn('a',60);await e.noteOn('b',64);expect(e.activeNotes()).toEqual(new Set([60,64]))
    b.end(2);expect(e.voices.size).toBe(0);expect(e.activeNotes()).toEqual(new Set([60,64]))
    e.noteOff('a');expect(e.activeNotes()).toEqual(new Set([64]));e.allOff();expect(e.activeNotes().size).toBe(0)
  })
  it('never revives notes canceled during loading; reports failures and supports retry',async()=> {
    let done!:()=>void; const b=new TestBackend(); b.initialize=()=>new Promise<void>(r=>{done=r})
    const e=new PianoEngine(b); const note=e.noteOn('touch',60); expect(e.status).toBe('loading'); e.allOff(); done(); await note
    expect(e.status).toBe('ready'); expect(b.nodes.size).toBe(0)
    const fail=new TestBackend(); fail.initialize=async()=>{throw Error('denied')}; const f=new PianoEngine(fail)
    await f.noteOn('a',60); expect(f.status).toBe('error'); expect(f.error).toContain('denied'); expect(f.pending.size).toBe(0)
    fail.initialize=async()=>{}; await f.noteOn('b',60); expect(f.status).toBe('ready'); expect(f.voices.size).toBe(1)
    f.dispose(); expect(fail.nodes.size).toBe(0); expect(fail.disposed).toBe(true); await f.noteOn('c',60); expect(f.voices.size).toBe(0)
  })
})
describe('real browser graph boundary',()=> {
  it('connects the tested generated PCM through voice gain and master, disconnects all nodes, closes context',async()=> {
    const nodes:Array<{connections:unknown[];disconnected:boolean;connect:(x:unknown)=>void;disconnect:()=>void}>=[]
    function node() { const n={connections:[] as unknown[],disconnected:false,connect(x:unknown){this.connections.push(x)},disconnect(){this.disconnected=true}}; nodes.push(n); return n }
    const gains:ReturnType<typeof gain>[]=[]
    function gain() { return Object.assign(node(),{gain:{value:1,cancelScheduledValues:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()}}) }
    const sources:Array<ReturnType<typeof source>>=[]
    function source() { return Object.assign(node(),{buffer:null as {pcm?:Float32Array}|null,onended:null as (()=>void)|null,start:vi.fn(),stop:vi.fn()}) }
    let pcm:Float32Array=new Float32Array(); const destination={}; const close=vi.fn()
    class Context { state='running';currentTime=0;sampleRate=8000;destination=destination; resume=async()=>{};close=close
      createGain(){const n=gain();gains.push(n);return n} createDynamicsCompressor(){return node()}
      createBufferSource(){const n=source();sources.push(n);return n} createBuffer(){return {copyToChannel(x:Float32Array){pcm=x}}}
    }
    vi.stubGlobal('AudioContext',Context)
    const b=new WebAudioBackend(); await b.initialize(); const ended=vi.fn(); b.start(1,60,.8,ended)
    expect(rms(pcm.slice(0,8000))).toBeGreaterThan(.03); expect(pcm).toEqual(renderPiano(60,.8,8000,10))
    expect(sources[0].connections).toEqual([gains[1]]); expect(gains[1].connections).toEqual([gains[0]])
    expect(gains[0].gain.value).toBe(.42); expect(nodes[1].connections).toEqual([destination])
    b.release(1); expect(gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0,.22)
    sources[0].onended?.(); expect(ended).toHaveBeenCalledOnce(); expect(sources[0].disconnected).toBe(true)
    b.start(2,64,.6,()=>{}); b.dispose(); expect(sources[1].disconnected).toBe(true); expect(gains[2].disconnected).toBe(true); expect(close).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
