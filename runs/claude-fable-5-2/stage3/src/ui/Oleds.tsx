import { useSyncExternalStore, type CSSProperties } from 'react'
import type { Session } from '../app/session'
import type { AudioStatus, EngineSnapshot } from '../audio/engine'
import { VARIANT } from '../hardware/geometry'
import type { OledDef } from '../hardware/types'
import type { MidiStatus } from '../input/midi'
import { FALLBACK_VOICE_NAME, PIANO_TYPES } from '../piano/catalog'
import { organSummary, programDisplay, programHeader, synthDisplay, synthSummary } from '../state/display'
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
 * The Program OLED. Its top bar is the loaded program — page.button, name, and an E when it
 * has unsaved edits. Under that it shows what is true right now: the layers of the section
 * touched last, the focused layer's sound and whether that is a recording or synthesis, the
 * last panel action, and the live audio/MIDI/pedal state. On an editing page (Store, naming,
 * list, split, clock, transpose) it shows that page instead.
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
  const header = programHeader(state)
  const edited = state.nav.dirty
  const notice = state.notice ? `> ${state.notice.toUpperCase()}` : ''
  const mode = state.ui.mode
  const bar = (text: string) => (
    <span className="px-bar px-bar--program" data-line="program">
      <span data-line="program-name">{text}</span>
      {edited ? (
        <b className="px-edited" data-line="edited" title="Edited: not stored">
          E
        </b>
      ) : null}
      {state.nav.live ? <b className="px-edited">LIVE</b> : null}
    </span>
  )

  if (mode !== 'play') {
    const page = programDisplay(state, session.stage.bank)
    const bigSize = Math.min(40, Math.floor(452 / (Math.max(10, page.big.length) * 0.6)))
    return (
      <div
        id={def.id}
        className="oled oled--program oled--page"
        role="img"
        aria-label={`${def.name}. ${page.header}. ${page.big}. ${page.rows.join('. ')}.${state.notice ? ` Last action: ${state.notice}.` : ''}`}
        data-oled="program"
        data-mode={mode}
        style={box(def)}
      >
        {bar(page.header)}
        {page.big ? (
          <span className="px-big" data-line="big" style={{ fontSize: bigSize }}>
            {page.big}
          </span>
        ) : null}
        {page.rows.map((row, index) => (
          <span key={index} className="px-row px-row--pre" data-line={`row-${index}`}>
            {row}
          </span>
        ))}
        <span className="px-row px-row--notice" data-line="notice">
          {notice}
        </span>
      </div>
    )
  }

  // The playing page describes the section that was touched last.
  const section = state.ui.section
  const layer = state.piano.layers[state.piano.focus]
  const voice = describeLayerVoice(layer, audio)
  const shown =
    section === 'organ'
      ? { ...organSummary(state), kind: 'synthesized' as const, focus: state.organ.focus }
      : section === 'synth'
        ? { ...synthSummary(state), kind: 'synthesized' as const, focus: state.synth.focus }
        : { layers: `PIANO ${layerSummary(state)}`, name: voice.name, source: voice.line, kind: voice.kind, focus: state.piano.focus }
  const rows = [
    `AUDIO ${AUDIO_WORDS[audio.status]}  VOICES ${audio.voices}`,
    `MIDI ${MIDI_WORDS[midi.status]}  SUSTAIN ${notes.sustain ? 'DOWN' : 'UP'}`,
  ]
  // Monospace: keep the longest names inside the glass.
  const nameSize = Math.min(44, Math.floor(452 / (Math.max(10, shown.name.length) * 0.6)))
  return (
    <div
      id={def.id}
      className="oled oled--program"
      role="img"
      aria-label={`${def.name}. ${VARIANT.label}. Program ${header}${edited ? ', edited, not stored' : ''}${state.nav.live ? ', Live Mode' : ''}. ${shown.layers}. Layer ${LAYER_NAMES[shown.focus]}: ${shown.name}. ${shown.source}. ${rows.join('. ')}.${state.notice ? ` Last action: ${state.notice}.` : ''}`}
      data-oled="program"
      data-mode={mode}
      data-section={section}
      data-voice-kind={shown.kind}
      style={box(def)}
    >
      {bar(header)}
      <span className="px-small" data-line="layers">
        {shown.layers}
      </span>
      <span className="px-big" data-line="model" style={{ fontSize: nameSize }}>
        {shown.name}
      </span>
      <span className="px-rule" />
      <span className="px-row" data-line="source">
        {shown.source}
      </span>
      {rows.map((row, index) => (
        <span key={index} className="px-row">
          {row}
        </span>
      ))}
      <span className="px-row px-row--notice" data-line="notice">
        {notice}
      </span>
    </div>
  )
}

/** Attack / decay / release drawn as a curve, the way the instrument's display does. */
function EnvelopeCurve({ curve }: { curve: { attack: number; decay: number; release: number; sustain: boolean } }) {
  const width = 440
  const height = 62
  const a = 20 + curve.attack * 110
  const d = a + 30 + curve.decay * 110
  const hold = curve.sustain ? 4 : height - 4
  const r = d + 40
  const end = r + 20 + curve.release * 90
  const path = `M2 ${height - 4} L${a} 4 ${curve.sustain ? `L${d} 4` : `Q${a + 10} ${height - 8} ${d} ${hold}`} L${r} ${hold} Q${r + 8} ${height - 6} ${end} ${height - 4}`
  return (
    <svg className="px-curve" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" data-curve="envelope">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="4" />
    </svg>
  )
}

/**
 * The Synth OLED: the focused layer's waveform on top, then the page its three dials are on —
 * oscillator, pitch, the three envelopes (with their curve), filter, LFO, arpeggiator, vibrato.
 */
export function SynthOled({ def, session }: { def: OledDef; session: Session }) {
  const state = useSyncExternalStore(session.stage.subscribe, session.stage.getState, session.stage.getState)
  const view = synthDisplay(state)
  const dials = view.dials.filter((dial) => dial.label)
  return (
    <div
      id={def.id}
      className="oled oled--synth"
      role="img"
      aria-label={`${def.name}. Synth layer ${view.bar}. ${view.title}. ${dials.map((dial) => `${dial.label} ${dial.value}`).join(', ')}. ${view.footer}.`}
      data-oled="synth"
      data-page={view.page}
      style={box(def)}
    >
      <span className="px-bar" data-line="bar">
        {view.bar}
      </span>
      <span className="px-row" data-line="title">
        {view.title}
      </span>
      {view.curve ? <EnvelopeCurve curve={view.curve} /> : null}
      <span className="px-dials" data-line="dials">
        {view.dials.map((dial, index) => (
          <span key={index} className="px-dial" data-dial={index + 1}>
            <i>{dial.label}</i>
            <b>{dial.value}</b>
          </span>
        ))}
      </span>
      <span className="px-row px-row--footer" data-line="footer">
        {view.footer}
      </span>
    </div>
  )
}
