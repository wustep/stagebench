import type { AudioBackend } from './audio'
export class TestBackend implements AudioBackend {
  nodes=new Map<number,{note:number;velocity:number;ended:()=>void}>(); releases:number[]=[]; kills:number[]=[]; disposed=false
  async initialize() {}
  start(id:number,note:number,velocity:number,ended:()=>void) { this.nodes.set(id,{note,velocity,ended}) }
  release(id:number) { this.releases.push(id) }
  kill(id:number) { this.kills.push(id); this.nodes.delete(id) }
  end(id:number) { const v=this.nodes.get(id); this.nodes.delete(id); v?.ended() }
  dispose() { this.nodes.clear(); this.disposed=true }
}
