// Synth layer performance parameters for the note engine, derived from canonical state: voice mode,
// priority, constant-rate glide, KB Hold, and the arpeggiator settings (rate unsynced in BPM or a
// Master Clock subdivision; Range 1–4 octaves; Master Clock keyboard sync).
import type { ArpSettings } from './arp'
import type { SynthLayerParams } from './synthEngine'
import { slotLayer, type SlotId, type SoundState } from '../model/sound'
import { arpBpm, divisionSeconds, glideSecondsPerSemitone, type SynthLayerId } from '../model/synthState'

/** Range knob 0…127 → 1…4 octaves. */
export const arpOctaves = (range: number) => 1 + Math.min(3, Math.floor((Math.max(0, range) / 127) * 4))

/** Seconds per arpeggiator step. */
export function arpStepSeconds(sound: SoundState, layer: SynthLayerId): number {
  const a = sound.synth.layers[layer].arp
  return a.sync ? divisionSeconds(a.rate, sound.clock.bpm) : 60 / arpBpm(a.rate)
}

export function arpSettings(sound: SoundState, layer: SynthLayerId, gridOrigin: number): ArpSettings {
  const a = sound.synth.layers[layer].arp
  return {
    mode: a.mode,
    step: arpStepSeconds(sound, layer),
    octaves: arpOctaves(a.range),
    direction: a.direction,
    gridOrigin: a.sync ? gridOrigin : null,
    kbSync: sound.clock.kbSync,
  }
}

export function synthLayerParams(slot: SlotId, sound: SoundState, gridOrigin = 0): SynthLayerParams {
  const id = slotLayer(slot) as SynthLayerId
  const l = sound.synth.layers[id]
  return {
    mode: l.voice.mode,
    priority: l.voice.priority,
    glide: glideSecondsPerSemitone(l.voice.glide),
    hold: sound.synth.kbHold,
    arp: l.arp.run ? arpSettings(sound, id, gridOrigin) : null,
  }
}
