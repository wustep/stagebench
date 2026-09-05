import { PianoEngine } from './audio'
import { computerMapping } from './hardware'
export interface MidiInput { id: string; state: string; onmidimessage: ((event: { data: Uint8Array | null }) => void) | null }
export interface MidiAccess { inputs: Map<string, MidiInput>; onstatechange: (() => void) | null }
export type RequestMidi = () => Promise<MidiAccess>
export class InputController {
  private held = new Set<string>()
  private pointerNotes = new Map<number, string>()
  private midiQueues = new Map<string, string[]>()
  private ports = new Map<string, MidiInput>()
  private access?: MidiAccess
  private serial = 0
  private generation = 0
  private pending = false
  constructor(readonly engine: PianoEngine, private status: (message: string) => void = () => {}) {}
  pointerDown(id: number, midi: number, velocity = 96) { this.pointerUp(id); const owner = `pointer:${id}`; this.pointerNotes.set(id, owner); void this.engine.on(owner, midi, velocity) }
  pointerUp(id: number) { const owner = this.pointerNotes.get(id); if (owner) this.engine.off(owner); this.pointerNotes.delete(id) }
  keyDown(code: string, repeat = false, editing = false) {
    if (repeat || editing || this.held.has(code)) return false
    if (code !== 'Space' && computerMapping[code] === undefined) return false
    this.held.add(code)
    if (code === 'Space') this.engine.sustain('keyboard', true)
    else void this.engine.on(`keyboard:${code}`, computerMapping[code])
    return true
  }
  keyUp(code: string) {
    if (!this.held.delete(code)) return false
    if (code === 'Space') this.engine.sustain('keyboard', false)
    else this.engine.off(`keyboard:${code}`)
    return true
  }
  midi(id: string, data: Uint8Array) {
    const [status, note, value] = data
    if (data.length < 3) return
    const command = status & 0xf0, channel = status & 15
    const key = `${id}:${channel}:${note}`
    if (command === 0x90 && value > 0) {
      const owner = `midi:${key}:${this.serial++}`
      this.midiQueues.set(key, [...(this.midiQueues.get(key) ?? []), owner])
      void this.engine.on(owner, note, value)
    } else if (command === 0x80 || (command === 0x90 && value === 0)) {
      const queue = this.midiQueues.get(key)
      const owner = queue?.shift()
      if (owner) this.engine.off(owner)
      if (!queue?.length) this.midiQueues.delete(key)
    } else if (command === 0xb0 && note === 64) this.engine.sustain(`midi:${id}:${channel}`, value >= 64)
    else if (command === 0xb0 && [120, 123].includes(note)) this.allOff()
  }
  async connect(request?: RequestMidi) {
    if (!request) { this.status('MIDI unavailable in this browser'); return }
    if (this.pending || this.access) return
    const generation = this.generation
    this.pending = true; this.status('Requesting MIDI access…')
    try {
      const access = await request()
      if (generation !== this.generation) return
      this.access = access
      const refresh = () => {
        let disconnected = false
        for (const [id, input] of this.ports) {
          if (access.inputs.get(id)?.state !== 'connected') { input.onmidimessage = null; this.ports.delete(id); disconnected = true }
        }
        if (disconnected) this.allOff()
        for (const [id, input] of access.inputs) if (input.state === 'connected') { input.onmidimessage = e => { if (e.data) this.midi(id, e.data) }; this.ports.set(id, input) }
        this.status(this.ports.size ? `MIDI connected · ${this.ports.size} input${this.ports.size === 1 ? '' : 's'}` : disconnected ? 'MIDI disconnected · all notes stopped' : 'MIDI enabled · waiting for a device')
      }
      access.onstatechange = refresh; refresh()
    } catch { if (generation === this.generation) this.status('MIDI access denied or unavailable · keyboard still playable') }
    finally { if (generation === this.generation) this.pending = false }
  }
  allOff() { this.held.clear(); this.pointerNotes.clear(); this.midiQueues.clear(); this.engine.allOff() }
  attach(target: Window) {
    const down = (e: KeyboardEvent) => {
      const editing = e.target instanceof HTMLElement && (['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && this.keyDown(e.code, e.repeat, editing)) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => { if (this.keyUp(e.code)) e.preventDefault() }
    const blur = () => this.allOff()
    const visibility = () => { if (target.document.hidden) this.allOff() }
    target.addEventListener('keydown', down); target.addEventListener('keyup', up); target.addEventListener('blur', blur); target.document.addEventListener('visibilitychange', visibility)
    return () => { target.removeEventListener('keydown', down); target.removeEventListener('keyup', up); target.removeEventListener('blur', blur); target.document.removeEventListener('visibilitychange', visibility); this.dispose() }
  }
  dispose() { this.generation++; this.pending = false; if (this.access) this.access.onstatechange = null; for (const input of this.ports.values()) input.onmidimessage = null; this.ports.clear(); this.access = undefined; this.allOff() }
}
