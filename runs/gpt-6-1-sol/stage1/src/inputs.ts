import { PianoEngine } from './audio'
import { computerKeys } from './hardware'
export function bindComputerInput(engine:PianoEngine,target:Window=window) {
  const held=new Set<string>()
  const down=(event:KeyboardEvent)=> { if(event.defaultPrevented) return; const el=event.target as HTMLElement|null; if(el?.closest?.('input,textarea,select,[contenteditable=true]')||event.ctrlKey||event.metaKey||event.altKey) return
    if(event.code==='Space'&&el?.closest?.('button')) return
    if(event.code==='Space') { event.preventDefault(); if(!event.repeat) engine.sustain('keyboard',true); return }
    const note=computerKeys[event.code]; if(!note||event.repeat||held.has(event.code)) return
    event.preventDefault(); held.add(event.code); void engine.noteOn(`keyboard:${event.code}`,note)
  }
  const up=(event:KeyboardEvent)=> { if(event.code==='Space') engine.sustain('keyboard',false); if(held.delete(event.code)) engine.noteOff(`keyboard:${event.code}`) }
  const blur=()=> { held.clear(); engine.allOff() }
  target.addEventListener('keydown',down); target.addEventListener('keyup',up); target.addEventListener('blur',blur)
  return ()=> { target.removeEventListener('keydown',down); target.removeEventListener('keyup',up); target.removeEventListener('blur',blur); blur() }
}
export interface MidiPort { id:string; name?:string|null; state:string; onmidimessage:((event:{data:Uint8Array|null})=>void)|null }
export interface MidiAccess { inputs:Map<string,MidiPort>; onstatechange:(()=>void)|null }
export type MidiStatus='not connected'|'requesting'|'connected'|'no devices'|'denied'|'unavailable'|'disconnected'
export class MidiInput {
  status:MidiStatus='not connected'; private access:MidiAccess|null=null; private ports=new Map<string,MidiPort>(); private queues=new Map<string,string[]>(); private counter=0; private disposed=false
  constructor(readonly engine:PianoEngine,readonly request:(()=>Promise<MidiAccess>)|undefined,readonly changed:()=>void=()=>{}) {}
  async connect() {
    if(this.disposed) return
    if(!this.request) { this.status='unavailable'; this.changed(); return }
    if(this.access) { this.refresh(); return }
    if(this.status==='requesting') return
    this.status='requesting'; this.changed()
    try { const access=await this.request(); if(this.disposed) return; this.access=access; access.onstatechange=()=>this.refresh(); this.refresh() } catch { this.status='denied'; this.changed() }
  }
  private refresh() {
    if(!this.access) return
    let lost=false
    for(const [id,port] of this.ports) if(port.state==='disconnected'||!this.access.inputs.has(id)) { port.onmidimessage=null; this.ports.delete(id); lost=true }
    if(lost) { this.engine.allOff(); this.queues.clear() }
    for(const [id,port] of this.access.inputs) if(port.state==='connected') { this.ports.set(id,port); port.onmidimessage=event=> { if(event.data) this.message(id,event.data) } }
    this.status=this.ports.size?'connected':lost?'disconnected':'no devices'; this.changed()
  }
  message(port:string,data:Uint8Array) {
    if(this.disposed||data.length<3) return
    const [status,note,value]=data; const command=status&0xf0; const channel=status&0xf; const key=`${port}:${channel}:${note}`
    if(command===0x90&&value>0) { const owner=`midi:${key}:${++this.counter}`; const q=this.queues.get(key)??[]; q.push(owner); this.queues.set(key,q); void this.engine.noteOn(owner,note,value/127) }
    else if(command===0x80||(command===0x90&&value===0)) { const q=this.queues.get(key); const owner=q?.shift(); if(owner) this.engine.noteOff(owner); if(!q?.length) this.queues.delete(key) }
    else if(command===0xb0&&note===64) this.engine.sustain(`midi-pedal:${port}:${channel}`,value>=64)
    else if(command===0xb0&&(note===120||note===123)) { this.engine.allOff(); this.queues.clear() }
  }
  dispose() { this.disposed=true; if(this.access) this.access.onstatechange=null; for(const port of this.ports.values()) port.onmidimessage=null; this.ports.clear(); this.queues.clear(); this.engine.allOff() }
}
