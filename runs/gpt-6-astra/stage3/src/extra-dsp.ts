import { Filter } from './dsp'
import { extraIds, zoneGain, type Envelope, type ExtraId, type OrganLayer, type SynthLayer, type SystemState } from './system-state'
import type { InstrumentState } from './phase2-state'
const TAU = Math.PI * 2
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const noise = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1 }
export function envelope(e: Envelope, age: number, released: number, velocity: number) {
  const value = (t: number) => t < e.attack ? t / Math.max(.001, e.attack) : e.decay >= 4 ? 1 : Math.exp(-(t - e.attack) * 5 / Math.max(.01, e.decay))
  return value(released < 0 ? age : age - released) * (released < 0 ? 1 : Math.max(0, 1 - released / Math.max(.005, e.release))) * (e.velocity ? velocity ** (e.velocity / 2) : 1)
}
export function lfo(wave: number, phase: number) { const p = phase % 1; return wave === 0 ? 1 - 4 * Math.abs(p - .5) : wave === 1 ? 1 - 2 * p : wave === 2 ? 2 * p - 1 : wave === 3 ? p < .5 ? 1 : -1 : noise(Math.floor(phase)) }
export function arpNotes(notes: number[], range: number) { return Array.from({ length: range }, (_, octave) => [...new Set(notes)].sort((a, b) => a - b).map(n => n + octave * 12)).flat() }
export function arpIndex(step: number, length: number, direction: number) { if (length <= 1) return 0; if (direction === 1) return length - 1 - step % length; if (direction === 2) { const n = step % (2 * length - 2); return n < length ? n : 2 * length - 2 - n }; if (direction === 3) return Math.floor((noise(step + 31) + 1) * .5 * length) % length; return step % length }
function saw(phase: number, dt: number) { const t = ((phase / TAU) % 1 + 1) % 1; let y = 2 * t - 1; if (t < dt) { const p = t / dt; y -= p + p - p * p - 1 } else if (t > 1 - dt) { const p = (t - 1) / dt; y -= p * p + p + p + 1 }; return y }
export function waveform(wave: number, phase: number, ctrl: number, hz: number, sr: number, frame: number) {
  const dt = Math.min(.4, hz / sr), pulse = (duty: number) => (saw(phase, dt) - saw(phase + TAU * (1 - duty), dt)) * .7
  if (wave === 0) return Math.sin(phase)
  if (wave === 1) return Math.asin(Math.sin(phase)) * 2 / Math.PI
  if (wave === 2) return saw(phase, dt)
  if (wave === 3) return pulse(.5)
  if (wave === 4) return pulse(.33)
  if (wave === 5) return pulse(.1)
  if (wave === 6) return noise(frame)
  if (wave === 7 || wave === 8) { const synced = (phase % TAU) * (1 + ctrl * 7); return wave === 7 ? saw(synced, dt) : Math.tanh(Math.sin(synced) * 7) }
  if (wave === 13) return Math.sin(phase + Math.sin(phase * 2) * ctrl * 10)
  const copies = wave >= 11 ? 7 : 3; let result = 0
  for (let i = 0; i < copies; i++) { const offset = i - (copies - 1) / 2, ph = phase * (1 + offset * ctrl * (wave >= 11 ? .009 : .005)) * (wave === 10 && i === 2 ? 2 : 1); result += wave === 12 ? Math.tanh(Math.sin(ph) * 5) : saw(ph, dt) }
  return result / copies
}
interface Voice { id: number; layer: ExtraId; midi: number; velocity: number; age: number; release: number; phase: number; pitch: number; filters: Filter[]; percussion: boolean; forced: boolean; step: number; stepAge: number; lfoPhase: number; gain: number; latched: boolean; glideActive: boolean }
export class ExtraDSP {
  voices = new Map<number, Voice>(); frame = 0; arpStart = 0; finished: number[] = []; private lastPitch: Partial<Record<ExtraId, number>> = {}
  constructor(readonly sr: number) {}
  on(id: number, layer: ExtraId, midi: number, velocity: number, s: SystemState) {
    const held = [...this.voices.values()].filter(v => v.layer === layer && v.release < 0)
    if (layer.startsWith('S') && (s.synth[layer as 'Sa'].hold || s.synth[layer as 'Sa'].arp)) {
      // Re-pressing a held pitch replaces its owned voice; no orphan latch accumulates.
      for (const v of held) if (v.midi === midi) { this.voices.delete(v.id); this.finished.push(v.id) }
    }
    const previous = held.at(-1), p = layer.startsWith('S') ? s.synth[layer as 'Sa'] : undefined
    this.voices.set(id, { id, layer, midi, velocity: velocity / 127, age: p?.mode === 2 && previous ? previous.age : 0, release: -1, phase: p?.mode === 2 && previous ? previous.phase : 0, pitch: p?.mode && previous ? previous.pitch : midi, filters: Array.from({ length: 4 }, () => new Filter()), percussion: !held.length, forced: false, step: -1, stepAge: 0, lfoPhase: s.clockSync ? 0 : this.frame / this.sr * 4, gain: 0, latched: false, glideActive: !!previous })
    if (!held.length && s.clockSync) this.arpStart = this.frame
    if (held.length >= 32) { const v = held[0]; this.voices.delete(v.id); this.finished.push(v.id) }
  }
  off(id: number, s: SystemState | undefined, stop = false) { const v = this.voices.get(id); if (!v) return; if (!stop && v.layer.startsWith('S') && s?.synth[v.layer as 'Sa'].hold) { v.latched = true; return }; v.release = 0; v.forced = stop }
  clear() { this.finished.push(...this.voices.keys()); this.voices.clear(); this.frame = 0; this.arpStart = 0; this.lastPitch = {} }
  private organ(v: Voice, p: OrganLayer, hz: number, channel: number) {
    const depth = (p.chorus % 3 + 1) * .003, modulation = Math.sin(v.age / this.sr * TAU * 6.2) * depth
    const phase = v.phase * (p.vibrato ? 1 + modulation : 1), foot = [.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
    const tone = (ph: number) => { let x = 0
      for (let i = 0; i < 9; i++) { if (p.model === 1 && i !== 0 && i !== 2) continue; const gain = p.model === 3 ? Number(p.drawbars[i] > 4) : p.drawbars[i] / 8, f = foot[i]; if (hz * f > this.sr * .43) continue
        const a = ph * f
        let rank = Math.sin(a)
        if (p.model === 2) rank = (Math.sin(a) + .33 * Math.sin(a * 3) + .16 * Math.sin(a * 5)) * (i < 7 ? .8 : i === 7 ? 1.2 : .4)
        if (p.model === 3) rank = Math.tanh((Math.sin(a) + .4 * Math.sin(a * 2)) * 3) * .8
        if (p.model >= 4) rank = Math.sin(a * (1 + i * .0003)) + (p.model === 5 ? .5 : .22) * Math.sin(a * 2) + .07 * Math.sin(a * 4)
        x += rank * gain / 6
      }; return x }
    let x = tone(phase)
    if (p.vibrato && p.chorus < 3) x = (x + tone(v.phase + channel * .02)) / 2
    const t = v.age / this.sr
    if (p.model <= 1 && p.click && t < .008) x += noise(v.age + v.id * 29) * .15 * (1 - t / .008)
    if (p.model === 0 && p.percussion && (v.percussion || p.percussionPoly)) x += Math.sin(v.phase * (p.third ? 3 : 2)) * (p.soft ? .14 : .3) * Math.exp(-t * (p.fast ? 16 : 4))
    return x * Math.min(1, t / .003) * (v.release < 0 ? 1 : Math.max(0, 1 - v.release / (this.sr * (v.forced ? .005 : .07))))
  }
  tick(state: InstrumentState) {
    const s = state.system, buses = { Oa: [0, 0], Ob: [0, 0], Sa: [0, 0], Sb: [0, 0], Sc: [0, 0] }
    if (!s) return buses
    const groups = Object.fromEntries(extraIds.map(id => [id, [...this.voices.values()].filter(v => v.layer === id && v.release < 0)])) as Record<ExtraId, Voice[]>
    for (const v of this.voices.values()) {
      const organ = v.layer === 'Oa' || v.layer === 'Ob', p = organ ? s.organ[v.layer as 'Oa'] : s.synth[v.layer as 'Sa']
      const baseNote = v.midi - p.octave * 12 - s.transpose
      const route = zoneGain(s, v.layer, baseNote) * Number(p.enabled && (organ ? s.organOn : s.synthOn))
      let note = v.midi + (p.pstick ? state.bend * 2 : 0), amp = 1, ctrl = 0, filterEnv = 0, lf = 0
      const synth = p as SynthLayer, group = groups[v.layer]
      if (!organ && v.latched && !synth.hold) { v.release = 0; v.latched = false }
      if (!organ) {
        note += synth.coarse + synth.fine / 100
        if (synth.mode && group.length) { const winner = synth.priority === 1 ? group.reduce((a, b) => a.midi < b.midi ? a : b) : synth.priority === 2 ? group.reduce((a, b) => a.midi > b.midi ? a : b) : group.at(-1)!; if (winner.id !== v.id) amp = 0; if (winner.id === v.id && this.lastPitch[v.layer] !== undefined && synth.glide > 0 && v.glideActive) v.pitch = this.lastPitch[v.layer]! }
        if (synth.arp && group.length) {
          const seconds = (this.frame - this.arpStart) / this.sr, rate = synth.arpSync ? state.bpm * synth.subdivision / 4 : synth.arpRate, position = seconds * rate / 60, step = Math.floor(position), gate = position % 1
          const sequence = arpNotes(group.map(v => v.midi), synth.range), selected = sequence[arpIndex(step, sequence.length, synth.direction)]
          if (synth.arpMode === 0) { const base = group.find(g => (selected - g.midi) % 12 === 0); if (base?.id !== v.id) amp = 0; else note += selected - v.midi }
          if (gate > (synth.arpMode === 2 ? .15 + (5 - synth.range) * .15 : .65)) amp = 0
          if (step !== v.step) { v.step = step; v.stepAge = 0 }
        }
        const t = (synth.arp ? v.stepAge : v.age) / this.sr, rel = v.release / this.sr
        amp *= envelope(synth.ampEnv, t, rel, v.velocity)
        const oe = envelope(synth.oscEnv, t, rel, v.velocity) * synth.oscEnv.amount
        ctrl = synth.ctrl + (synth.oscEnv.pitch ? 0 : oe)
        if (synth.oscEnv.pitch) note += oe * 24
        filterEnv = envelope(synth.filterEnv, t, rel, v.velocity) * synth.filterEnv.amount
        v.lfoPhase += (synth.lfoSync ? state.bpm / 60 : synth.lfoRate) / this.sr
        lf = lfo(synth.lfoWave, v.lfoPhase) * synth.lfoAmount
        if (synth.lfoDest === 0) note += lf * 2
        if (synth.lfoDest === 1) ctrl += lf
        if (synth.vibrato) note += Math.sin(v.age / this.sr * TAU * synth.vibratoRate) * synth.vibratoAmount * (synth.vibrato === 2 ? s.wheel : 1)
        if (synth.mode && synth.glide > 0 && v.glideActive) v.pitch += clamp(note - v.pitch, -24 / (synth.glide * this.sr), 24 / (synth.glide * this.sr)); else v.pitch = note
        if (amp > 0) this.lastPitch[v.layer] = v.pitch
        note = v.pitch
      }
      const hz = 440 * 2 ** ((note - 69) / 12)
      v.gain += (amp * route - v.gain) / (this.sr * .003)
      for (let c = 0; c < 2; c++) {
        let x = 0
        if (organ) x = this.organ(v, p as OrganLayer, hz, c)
        else {
          const copies = synth.unison ? 3 : 1
          for (let u = 0; u < copies; u++) x += waveform(synth.wave, v.phase * (1 + (u - (copies - 1) / 2) * synth.unison * (c ? .0029 : .0021)), clamp(ctrl), hz, this.sr, v.age + c * 37) / copies
          const cutoff = 25 * 700 ** clamp(synth.cutoff + filterEnv * .4 + (synth.lfoDest === 2 ? lf * .4 : 0)) * 2 ** ((v.midi - 60) / 12 * synth.tracking / 3)
          if (v.age % 16 === 0) for (const index of [c * 2, c * 2 + 1]) v.filters[index].set(synth.filter === 2 ? 'hp' : synth.filter === 3 ? 'bp' : 'lp', cutoff, .6 + synth.resonance * 9, this.sr)
          x = Math.tanh(x * (1 + synth.drive * 2)) / (1 + synth.drive * .3)
          x = v.filters[c * 2].tick(x); if (synth.filter === 1) x = v.filters[c * 2 + 1].tick(x)
          x *= .3
        }
        buses[v.layer][c] += x * v.gain
      }
      v.phase += TAU * hz / this.sr; v.age++; v.stepAge++; if (v.release >= 0) v.release++
      const release = v.forced ? .005 : organ ? .07 : Math.max(synth.ampEnv.release, synth.oscEnv.release, synth.filterEnv.release)
      if (v.release >= release * this.sr) { this.voices.delete(v.id); this.finished.push(v.id) }
    }
    this.frame++; return buses
  }
}
