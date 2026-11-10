import { useSyncExternalStore, type CSSProperties } from 'react'
import type { Session } from '../app/session'
import type { AudioStatus, EngineSnapshot } from '../audio/engine'
import { VARIANT } from '../hardware/geometry'
import type { OledDef } from '../hardware/types'
import type { MidiStatus } from '../input/midi'
import { FALLBACK_VOICE_NAME, PIANO_TYPES } from '../piano/catalog'
import { LAYER_NAMES, layerModel, type PianoLayerState, type StageState } from '../state/model'

function box(def: OledDef): CSSProperties {
  return { left: def.x - def.w / 2, top: def.y - def.h / 2, width: def.w, height: def.h }
}

export const AUDIO_WORDS: Record<AudioStatus, string> = {
  idle: 'PRESS A KEY',
  loading: 'LOADING',
  ready: 'READY',
  fallback: 'FALLBACK',
  error: 'NO AUDIO',
}

export const MIDI_WORDS: Record<MidiStatus, string> = {
  unsupported: 'UNSUPPORTED',
  idle: 'OFF',
  requesting: 'ASKING',
  connected: 'CONNECTED',
  'no-inputs': 'NO INPUT',
  denied: 'DENIED',
  error: 'ERROR',
}

/** What a layer is really playing right now, and how to say so. */
export interface LayerVoice {
  /** Name of the voice that sounds: the model, or the stand-in when its samples are missing. */
  name: string
  kind: 'recorded' | 'synthesized' | 'fallback' | 'loading'
  /** Short all-caps line for the display. */
  line: string
  /** One sentence for the status console. */
  sentence: string
}

export function describeLayerVoice(layer: PianoLayerState, audio: EngineSnapshot): LayerVoice {
  const model = layerModel(layer)
  if (model.source.kind !== 'samples') {
    return { name: model.name, kind: 'synthesized', line: 'SYNTHESIZED, NOT RECORDED', sentence: model.about }
  }
  const set = model.source.set
  const status = audio.library[set]
  if (status === 'failed') {
    return {
      name: FALLBACK_VOICE_NAME,
      kind: 'fallback',
      line: 'PIANO NOT FOUND - FALLBACK',
      sentence: `${model.name} could not be loaded (${audio.libraryErrors[set] ?? 'unknown error'}). A synthesized stand-in piano plays instead; it is not a recording.`,
    }
  }
  if (status === 'loading') {
    return { name: model.name, kind: 'loading', line: 'LOADING SAMPLES...', sentence: `Loading the ${model.name} samples…` }
  }
  return {
    name: model.name,
    kind: 'recorded',
    line: status === 'ready' ? 'RECORDED SAMPLES' : 'RECORDED SAMPLES - STANDBY',
    sentence: model.about,
  }
}

function layerSummary(state: StageState): string {
  return state.piano.layers
    .map((layer, index) => {
      const what = !state.piano.on || !layer.on ? 'OFF' : PIANO_TYPES[layer.type].toUpperCase()
      return `${LAYER_NAMES[index]}:${what}${state.piano.focus === index ? '<' : ''}`
    })
    .join('  ')
}

/**
 * The Program OLED. There are no programs until Phase 3, so it does not show one. It shows
 * what is true right now: the Piano layers, the focused layer's model and whether that is a
 * recording or synthesis, the last panel action, and the live audio/MIDI/pedal state.
 */
export function ProgramOled({ def, session }: { def: OledDef; session: Session }) {
  const audio = useSyncExternalStore(session.engine.subscribe, session.engine.getSnapshot, session.engine.getSnapshot)
  const midi = useSyncExternalStore(session.midi.subscribe, session.midi.getSnapshot, session.midi.getSnapshot)
  const notes = useSyncExternalStore(
    session.lifecycle.subscribe,
    session.lifecycle.getSnapshot,
    session.lifecycle.getSnapshot,
  )
  const state = useSyncExternalStore(session.stage.subscribe, session.stage.getState, session.stage.getState)
  const layer = state.piano.layers[state.piano.focus]
  const voice = describeLayerVoice(layer, audio)
  const summary = `PIANO ${layerSummary(state)}`
  const rows = [
    voice.line,
    `AUDIO ${AUDIO_WORDS[audio.status]}`,
    `MIDI ${MIDI_WORDS[midi.status]}`,
    `SUSTAIN ${notes.sustain ? 'DOWN' : 'UP'}  VOICES ${audio.voices}`,
  ]
  const notice = state.notice ? `> ${state.notice.toUpperCase()}` : ''
  // Monospace: keep the longest names inside the glass.
  const nameSize = Math.min(46, Math.floor(452 / (Math.max(10, voice.name.length) * 0.6)))
  return (
    <div
      id={def.id}
      className="oled oled--program"
      role="img"
      aria-label={`${def.name}. ${VARIANT.label}, Phase 2. ${summary}. Layer ${LAYER_NAMES[state.piano.focus]}: ${voice.name}. ${rows.join('. ')}.${state.notice ? ` Last action: ${state.notice}.` : ''}`}
      data-oled="program"
      data-voice-kind={voice.kind}
      style={box(def)}
    >
      <span className="px-small" data-line="layers">
        {summary}
      </span>
      <span className="px-big" data-line="model" style={{ fontSize: nameSize }}>
        {voice.name}
      </span>
      <span className="px-rule" />
      {rows.map((row, index) => (
        <span key={index} className="px-row" data-line={index === 0 ? 'source' : undefined}>
          {row}
        </span>
      ))}
      <span className="px-row px-row--notice" data-line="notice">
        {notice}
      </span>
    </div>
  )
}

/** The Synth OLED. The Synth engine arrives in Phase 3, and the glass says so. */
export function SynthOled({ def }: { def: OledDef }) {
  return (
    <div
      id={def.id}
      className="oled"
      role="img"
      aria-label={`${def.name}. Synth is not active in Phase 2. Its panel controls are decorative.`}
      data-oled="synth"
      style={box(def)}
    >
      <span className="px-bar">SYNTH</span>
      <span className="px-big">Not active</span>
      <span className="px-row">PHASE 2 · NO SYNTH ENGINE</span>
      <span className="px-row">PANEL IS DECORATIVE</span>
    </div>
  )
}
