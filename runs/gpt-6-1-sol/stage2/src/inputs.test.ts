import {afterEach,describe,it,expect,vi} from 'vitest'
import {PianoEngine} from './audio'
import {bindComputerInput,MidiInput,type MidiAccess,type MidiPort} from './inputs'
import {TestBackend} from './test-backend'
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
afterEach(()=>vi.restoreAllMocks())
describe('computer keys',()=> {
  it('suppresses repeats, handles key release despite focus changes, pedals, blur and listener cleanup',async()=> {
    const b=new TestBackend();const e=new PianoEngine(b);const unbind=bindComputerInput(e)
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'})); await tick()
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA',repeat:true})); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'})); await tick()
    expect(b.nodes.size).toBe(1)
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'})); const input=document.createElement('input');document.body.append(input);input.focus();input.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyA',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));input.remove(); expect(b.releases).toHaveLength(0)
    window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'})); expect(b.releases).toHaveLength(1)
    window.dispatchEvent(new Event('blur')); expect(b.nodes.size).toBe(0)
    unbind();window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS'}));await tick();expect(b.nodes.size).toBe(0)
  })
})
describe('injected MIDI boundary',()=> {
  it('routes overlapping notes, velocities, note-on zero, CC64, all-notes-off and disconnect',async()=> {
    const b=new TestBackend();const e=new PianoEngine(b);const port:MidiPort={id:'fake',state:'connected',onmidimessage:null}
    const access:MidiAccess={inputs:new Map([['fake',port]]),onstatechange:null};const midi=new MidiInput(e,async()=>access)
    await midi.connect();expect(midi.status).toBe('connected')
    const send=(...data:number[])=>port.onmidimessage?.({data:new Uint8Array(data)})
    send(0x90,60,32);send(0x90,60,127);await tick();expect(e.voices.size).toBe(2)
    expect([...e.voices.values()].map(v=>v.velocity)).toEqual([32/127,1])
    send(0xb0,64,127);send(0x80,60,0);send(0x90,60,0);expect(b.releases).toHaveLength(0)
    send(0xb0,64,0);expect(b.releases).toHaveLength(2)
    send(0x91,64,110);await tick();send(0xb1,123,0);expect(b.nodes.size).toBe(0)
    send(0x90,60,100);await tick();port.state='disconnected';access.onstatechange?.();expect(midi.status).toBe('disconnected');expect(e.voices.size).toBe(0);expect(port.onmidimessage).toBeNull()
    port.state='connected';access.onstatechange?.();expect(midi.status).toBe('connected');midi.dispose();expect(access.onstatechange).toBeNull();expect(port.onmidimessage).toBeNull()
  })
  it('reports unavailable, denied, no device and ignores resolution after unmount',async()=> {
    const e=new PianoEngine(new TestBackend());const unavailable=new MidiInput(e,undefined);await unavailable.connect();expect(unavailable.status).toBe('unavailable')
    const denied=new MidiInput(e,async()=>{throw Error('Permission denied')});await denied.connect();expect(denied.status).toBe('denied')
    const empty=new MidiInput(e,async()=>({inputs:new Map(),onstatechange:null}));await empty.connect();expect(empty.status).toBe('no devices')
    let done!:(v:MidiAccess)=>void;const late=new MidiInput(e,()=>new Promise(r=>{done=r}));const p=late.connect();late.dispose();const access:MidiAccess={inputs:new Map(),onstatechange:null};done(access);await p;expect(access.onstatechange).toBeNull()
  })
})
