// The whole playable instrument: the piano (Phase 2), the organ engine, and the synth engine, all on
// one AudioContext and one signal graph. The hub owns what the engines share: keyboard zones and
// crossfades, transpose, sustain routing, MIDI, the arpeggiator, and Panic.
//
// Piano notes keep their Phase 2 path. Organ and synth notes start on their own note controllers,
// each with a per-layer gain from the zone map. While the arpeggiator runs, the synth layers play only
// what the sequencer steps through; held keys feed it. With Hold on, the arpeggiator keeps the notes
// that were latched after the keys lift; with Hold off, it plays only the keys that are down.

import { gainNode, NodeBag, ramp } from '../audio/effects/nodes'
import type { AudioContextLike, GainNodeLike } from '../audio/audioBoundary'
import { ArpSequencer, type ArpEvent, type ArpSettings } from '../audio/synth/arp'
import type { ChainId } from '../audio/signalGraph'
import { layerZoneGain, zoneWeights } from '../audio/zones'
import { NoteController } from '../engine/noteController'
import { OrganLayerSink } from '../engine/organLayerSink'
import { SynthLayerSink } from '../engine/synthLayerSink'
import { MIDI_SOURCE, type MidiAccessRequest } from '../input/midi'
import { isKeyboardNote } from '../model/keybed'
import type { AudioSettings } from '../model/audioSettings'
import { createPianoInstrument, KEYBOARD_SUSTAIN_SOURCE, PEDAL_SOURCE, type PianoInstrument, type PianoInstrumentOptions } from './pianoInstrument'

export const ORGAN_LAYER_IDS = ['A', 'B'] as const
export const SYNTH_LAYER_IDS = ['A', 'B', 'C'] as const
export const ARP_SOURCE = 'arp'
const SUSTAIN_SOURCES = [PEDAL_SOURCE, KEYBOARD_SUSTAIN_SOURCE, MIDI_SOURCE] as const
/** Arpeggiator steps play at a fixed strength. */
const ARP_VELOCITY = 100

export interface Stage4InstrumentOptions extends PianoInstrumentOptions {
  midiRequest?: MidiAccessRequest
}

export interface Stage4Instrument {
  readonly piano: PianoInstrument
  configure(settings: AudioSettings): void
  noteOn(source: string, note: number, velocity: number): boolean
  noteOff(source: string, note: number): boolean
  setSustain(source: string, on: boolean): void
  /** Releases every note of every engine and clears sustain. Used on blur and unmount. */
  releaseEverything(): void
  /** Panic: an internal All Notes Off across every engine, with the arpeggiator's latched and held input cleared. */
  panic(): void
  /** Runs the arpeggiator forward to `now` (audio seconds). Returns the events it played. */
  advanceTo(now: number): ArpEvent[]
  /** Organ and synth voices still sounding, counted per note, for cleanup checks. */
  activeVoiceCount(): number
  /** Synth voices actually sounding: poly voices, or one mono voice per layer. */
  synthVoiceCount(): number
  teardown(): void
}

type OrganLayer = (typeof ORGAN_LAYER_IDS)[number]
type SynthLayer = (typeof SYNTH_LAYER_IDS)[number]

export function createStage4Instrument(options: Stage4InstrumentOptions = {}): Stage4Instrument {
  let settings: AudioSettings | undefined
  const heldSustain = new Set<string>()
  /** Keys down on the keyboard, MIDI, and computer keys, feeding the arpeggiator when Hold is off. */
  const keysDown = new Set<number>()
  /** Notes latched while Hold is on. */
  const latched = new Set<number>()
  const arp = new ArpSequencer()
  let arpQueue: ArpEvent[] = []
  let arpRunning = false
  const bag = new NodeBag()
  let organGains: Record<OrganLayer, GainNodeLike | undefined> = { A: undefined, B: undefined }
  let organGraph: unknown

  // MIDI reaches every engine, not only the piano.
  const piano: PianoInstrument = createPianoInstrument({
    ...options,
    midiRoute: {
      noteOn: (note, velocity) => {
        if (isKeyboardNote(note)) hub.noteOn(MIDI_SOURCE, note, velocity)
      },
      noteOff: (note) => {
        hub.noteOff(MIDI_SOURCE, note)
      },
      sustain: (on) => hub.setSustain(MIDI_SOURCE, on),
      allNotesOff: () => releaseSource(MIDI_SOURCE),
    },
  })

  const context = (): AudioContextLike | undefined => piano.engine.audio?.context

  const organSinks: Record<OrganLayer, OrganLayerSink> = {
    A: organSink('A'),
    B: organSink('B'),
  }
  function organSink(layer: OrganLayer): OrganLayerSink {
    return new OrganLayerSink({
      context,
      destination: () => organGains[layer],
      settings: () => {
        const config = settings?.organ[layer]
        if (!config) return undefined
        return { model: config.model, drawbars: config.drawbars, vibrato: config.vibrato, percussion: config.percussion, keyClick: true }
      },
      pitchOffset: () => (settings?.organ[layer].octave ?? 0) + (settings?.transpose ?? 0),
    })
  }

  const synthSinks: Record<SynthLayer, SynthLayerSink> = {
    A: synthSink('A'),
    B: synthSink('B'),
    C: synthSink('C'),
  }
  function synthSink(layer: SynthLayer): SynthLayerSink {
    return new SynthLayerSink({
      context,
      destination: () => piano.engine.audio?.graph.input(`S${layer}` as ChainId),
      settings: () => settings?.synth[layer].voice,
    })
  }

  const organControllers: Record<OrganLayer, NoteController> = { A: new NoteController(organSinks.A), B: new NoteController(organSinks.B) }
  const synthControllers: Record<SynthLayer, NoteController> = {
    A: new NoteController(synthSinks.A),
    B: new NoteController(synthSinks.B),
    C: new NoteController(synthSinks.C),
  }

  /** Each organ layer's level reaches the shared organ chain through its own gain, made with the graph. */
  function ensureOrganGains(): void {
    const audio = piano.engine.audio
    if (!audio || organGraph === audio.graph) return
    organGraph = audio.graph
    for (const layer of ORGAN_LAYER_IDS) {
      const node = gainNode(audio.context, bag, 0)
      node.connect(audio.graph.input('O'))
      organGains[layer] = node
    }
    applyOrganLevels()
  }

  function applyOrganLevels(): void {
    const audio = piano.engine.audio
    if (!audio || !settings) return
    for (const layer of ORGAN_LAYER_IDS) {
      const config = settings.organ[layer]
      const node = organGains[layer]
      if (node) ramp(audio.context, node.gain, config.on ? config.level * config.level : 0, 0.02)
    }
  }

  /** Per-note gains of every layer from the zone map. A note in a crossfade sounds in both zones. */
  function zoneGains(note: number) {
    const weights = zoneWeights(note, settings?.splits ?? [])
    const gain = (zone: readonly [number, number]) => layerZoneGain(weights, zone)
    return {
      piano: { A: gain(settings?.piano.A.zone ?? [1, 4]), B: gain(settings?.piano.B.zone ?? [1, 4]) },
      organ: { A: gain(settings?.organ.A.zone ?? [1, 4]), B: gain(settings?.organ.B.zone ?? [1, 4]) },
      synth: { A: gain(settings?.synth.A.zone ?? [1, 4]), B: gain(settings?.synth.B.zone ?? [1, 4]), C: gain(settings?.synth.C.zone ?? [1, 4]) },
    }
  }

  function syncSustain(): void {
    const routed = settings?.sustainRouted ?? false
    for (const source of SUSTAIN_SOURCES) {
      const active = routed && heldSustain.has(source)
      for (const layer of ORGAN_LAYER_IDS) organControllers[layer].setSustain(source, active)
      for (const layer of SYNTH_LAYER_IDS) synthControllers[layer].setSustain(source, active)
    }
  }

  function releaseSource(source: string): void {
    for (const layer of ORGAN_LAYER_IDS) organControllers[layer].releaseSource(source)
    for (const layer of SYNTH_LAYER_IDS) synthControllers[layer].releaseSource(source)
  }

  function arpSettings(current: AudioSettings): ArpSettings {
    return {
      mode: current.arp.mode,
      direction: current.arp.direction,
      octaves: current.arp.octaves,
      step: current.arp.stepSeconds,
      gate: current.arp.gate,
    }
  }

  const hub: Stage4Instrument = {
    piano,
    configure(next) {
      const previous = settings
      settings = next
      piano.configure(next)
      ensureOrganGains()
      applyOrganLevels()
      syncSustain()
      if (previous && previous.arp.hold && !next.arp.hold) latched.clear()
      if (next.arp.run && !arpRunning) {
        arpRunning = true
        arp.start(context()?.currentTime ?? 0)
      } else if (!next.arp.run && arpRunning) {
        arpRunning = false
        arp.stop()
        arpQueue = []
        latched.clear()
        for (const layer of SYNTH_LAYER_IDS) synthControllers[layer].releaseSource(ARP_SOURCE)
      }
    },
    noteOn(source, note, velocity) {
      if (!isKeyboardNote(note)) return false
      const gains = zoneGains(note)
      let accepted = piano.noteOn(source, note, velocity, gains.piano)
      ensureOrganGains()
      for (const layer of ORGAN_LAYER_IDS) {
        if (settings?.organ[layer].on && organControllers[layer].noteOn(source, note, velocity, gains.organ[layer])) accepted = true
      }
      if (arpRunning) {
        // The arpeggiator owns the synth layers while it runs: the key feeds it instead of sounding directly.
        keysDown.add(note)
        latched.add(note)
        accepted = true
      } else {
        for (const layer of SYNTH_LAYER_IDS) {
          if (settings?.synth[layer].on && synthControllers[layer].noteOn(source, note, velocity, gains.synth[layer])) accepted = true
        }
      }
      return accepted
    },
    noteOff(source, note) {
      const released = piano.noteOff(source, note)
      for (const layer of ORGAN_LAYER_IDS) organControllers[layer].noteOff(source, note)
      for (const layer of SYNTH_LAYER_IDS) synthControllers[layer].noteOff(source, note)
      keysDown.delete(note)
      return released
    },
    setSustain(source, on) {
      if (on) heldSustain.add(source)
      else heldSustain.delete(source)
      piano.setSustain(source, on)
      syncSustain()
    },
    releaseEverything() {
      piano.releaseEverything()
      for (const layer of ORGAN_LAYER_IDS) organControllers[layer].allNotesOff()
      for (const layer of SYNTH_LAYER_IDS) synthControllers[layer].allNotesOff()
      heldSustain.clear()
      keysDown.clear()
      latched.clear()
      syncSustain()
    },
    panic() {
      hub.releaseEverything()
      arpQueue = []
      if (arpRunning) {
        arp.stop()
        arp.start(context()?.currentTime ?? 0)
      }
    },
    advanceTo(now) {
      if (!arpRunning || !settings) return []
      const input = settings.arp.hold ? latched : keysDown
      const events = arp.advance(now, [...input], arpSettings(settings))
      arpQueue = [...arpQueue, ...events].sort((a, b) => a.time - b.time)
      const due = arpQueue.filter((event) => event.time <= now)
      arpQueue = arpQueue.filter((event) => event.time > now)
      for (const event of due) {
        for (const layer of SYNTH_LAYER_IDS) {
          if (!settings.synth[layer].on) continue
          if (event.type === 'on') synthControllers[layer].noteOn(ARP_SOURCE, event.note, ARP_VELOCITY, 1)
          else synthControllers[layer].noteOff(ARP_SOURCE, event.note)
        }
      }
      return due
    },
    synthVoiceCount() {
      return SYNTH_LAYER_IDS.reduce((sum, layer) => sum + synthSinks[layer].voiceCount, 0)
    },
    activeVoiceCount() {
      return ORGAN_LAYER_IDS.reduce((sum, layer) => sum + organControllers[layer].voiceCount, 0) +
        SYNTH_LAYER_IDS.reduce((sum, layer) => sum + synthControllers[layer].voiceCount, 0)
    },
    teardown() {
      for (const layer of ORGAN_LAYER_IDS) organControllers[layer].stopAll()
      for (const layer of SYNTH_LAYER_IDS) synthControllers[layer].stopAll()
      arp.stop()
      arpQueue = []
      bag.dispose()
      organGraph = undefined
      piano.teardown()
    },
  }
  return hub
}

