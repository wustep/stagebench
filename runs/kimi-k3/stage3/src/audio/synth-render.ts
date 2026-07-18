/**
 * Synth layer source renderer (Phase 3).
 *
 * Renders one synth layer's note events (or the running arpeggiator/gate
 * driven by the held-note pool) into a stereo frame using the per-voice
 * SynthVoice engine: poly/mono/legato with priority + glide, unison detune
 * stack, vibrato, LFO, three envelopes, and the filter block.
 */

import { stereoFrame, type StereoFrame } from './dsp'
import { SynthVoice, Arpeggiator, arpStepsPerSecond } from './synth-engine'
import type { SynthLayerId, SynthLayerState, SynthState } from '../state/synth-state'
import type { NoteEvent } from './render'

export interface SynthRenderContext {
  bpm: number
  transpose: number
  wheelPos: number
  /** Held-note pool for the arp (from the engine, honors arpHold). */
  arpNotes: number[]
}

const UNISON_DETUNE = [0, 4, 9, 15] // cents per unison level

/** Render one synth voice (plus unison stack) into the frame. */
function placeVoice(
  layer: SynthLayerState,
  ev: NoteEvent,
  glideFrom: number | null,
  seconds: number,
  sr: number,
  ctx: SynthRenderContext,
  out: StereoFrame,
): void {
  const n = Math.max(1, Math.floor(seconds * sr))
  const startIdx = Math.max(0, Math.floor(ev.start * sr))
  const len = n - startIdx
  if (len <= 0) return
  const relIdx = ev.release !== null ? Math.max(0, Math.floor((ev.release - ev.start) * sr)) : null
  const stopIdx = ev.stop !== null ? Math.max(0, Math.floor((ev.stop - ev.start) * sr)) : null
  const renderUntil = stopIdx !== null ? Math.min(len, stopIdx + Math.floor(0.05 * sr)) : len
  const gain = (0.35 + 0.65 * ev.velocity) * (ev.zoneGain ?? 1)
  const voices = 1 + Math.min(3, Math.max(0, layer.unison))
  for (let u = 0; u < voices; u++) {
    const cents = u === 0 ? 0 : UNISON_DETUNE[Math.min(3, layer.unison)] * (u % 2 === 1 ? 1 : -1) * Math.ceil(u / 2)
    const v = new SynthVoice(
      layer,
      { note: ev.note + cents / 100, velocity: ev.velocity, glideFrom: u === 0 ? glideFrom : null, seed: Math.round(ev.note * 4) * 31 + 7 + u * 977 },
      sr,
    )
    const mono = new Float32Array(renderUntil)
    // Render in two spans so noteOff lands exactly on the release boundary.
    const spans = relIdx !== null && relIdx < renderUntil ? [relIdx, renderUntil - relIdx] : [renderUntil]
    let rendered = 0
    for (const span of spans) {
      if (span <= 0) continue
      if (rendered > 0) v.noteOff()
      v.render(span, ctx.bpm, ctx.transpose, ctx.wheelPos, mono, rendered)
      rendered += span
    }
    const pan = u === 0 ? 0 : 0.5 * (u % 2 === 1 ? 1 : -1)
    const gl = Math.cos(((pan + 1) * Math.PI) / 4)
    const gr = Math.sin(((pan + 1) * Math.PI) / 4)
    const scale = u === 0 ? gain : gain * 0.7
    for (let i = 0; i < rendered; i++) {
      out.l[startIdx + i] += mono[i] * scale * gl
      out.r[startIdx + i] += mono[i] * scale * gr
    }
  }
}

/** Expand note events for the arpeggiator/gate when it is running. */
export function expandArpEvents(layer: SynthLayerState, pool: number[], seconds: number, ctx: SynthRenderContext): NoteEvent[] {
  if (!layer.arpRun || pool.length === 0) return []
  const sps = arpStepsPerSecond(layer, ctx.bpm)
  const stepDur = 1 / sps
  const notes = Arpeggiator.pool(pool, layer.arpRange, layer.arpMode)
  if (notes.length === 0) return []
  const arp = new Arpeggiator()
  const events: NoteEvent[] = []
  const steps = Math.min(512, Math.ceil(seconds / stepDur) + 1)
  // Gate hardness (Gate mode repurposes the range knob): 1..4 → gate fraction.
  const gateFrac = layer.arpMode === 2 ? 1 - (Math.min(4, Math.max(1, layer.arpRange)) - 1) / 4 : 0.9
  for (let s = 0; s < steps; s++) {
    const step = arp.step(layer, notes)
    const start = s * stepDur
    if (start >= seconds) break
    for (const note of step.notes) {
      events.push({
        note,
        velocity: 0.85,
        start,
        release: start + stepDur * gateFrac,
        stop: null,
      })
    }
  }
  return events
}

/** Render a whole synth layer (arp-expanded or direct note events). */
export function renderSynthLayerSource(
  synth: SynthState,
  layerId: SynthLayerId,
  events: NoteEvent[],
  seconds: number,
  sr: number,
  ctx: SynthRenderContext,
): StereoFrame {
  const n = Math.max(1, Math.floor(seconds * sr))
  const out = stereoFrame(n)
  const layer = synth.layers[layerId]
  if (!synth.sectionOn || !layer.enabled) return out
  const useArp = layer.arpRun && ctx.arpNotes.length > 0
  const evts = useArp ? expandArpEvents(layer, ctx.arpNotes, seconds, ctx) : events
  if (evts.length === 0) return out

  if (layer.voiceMode === 0) {
    // Poly: every event is its own voice.
    for (const ev of evts) placeVoice(layer, ev, null, seconds, sr, ctx, out)
  } else {
    // Mono / Legato: a single voice line; glide connects legato transitions
    // (priority is decided at note-on by the engine's held-note tracking;
    // here the event order is authoritative).
    const sorted = [...evts].sort((a, b) => a.start - b.start)
    let prevNote: number | null = null
    for (let k = 0; k < sorted.length; k++) {
      const ev = sorted[k]
      const next = sorted[k + 1]
      // The voice sounds until the next event starts (or its own release).
      const end = next ? Math.min(next.start, ev.release ?? seconds) : (ev.release ?? seconds)
      const spanEv: NoteEvent = { ...ev, release: end >= seconds ? null : end }
      const glideFrom = layer.glide > 0 && prevNote !== null ? prevNote : null
      placeVoice(layer, spanEv, glideFrom, seconds, sr, ctx, out)
      prevNote = ev.note
    }
  }
  return out
}
