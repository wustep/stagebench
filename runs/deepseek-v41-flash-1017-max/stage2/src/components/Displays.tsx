import { VARIANT } from '../hardware/variant'
import { keybedRangeLabel } from '../hardware/keybed'
import type { MidiStatusReport } from '../input/midi'
import type { PianoSnapshot } from '../audio/noteSession'
import type { PianoState } from '../audio/pianoState'
import type { EffectState } from '../audio/effectState'
import { modelById, timbreLabelFor, typeLabel } from '../audio/pianoLibrary'
import { effectiveChain } from '../audio/effectState'
import type { LibraryStatus } from '../audio/webAudioEngine'

/**
 * The two OLEDs.
 *
 * They are the only displays on the instrument (visual spec: Program and Synth are the only
 * primary OLED locations; the performance band and the effects band carry none).
 *
 * Both are truthful by construction. The Program display prints what Phase 2 actually
 * implements — the selected type and model per layer, whether that model is a recording or
 * a model, the real FX focus, and the real sample-library state — and nothing that it does
 * not. It still prints no bank:slot readout and no invented preset name, because no
 * program library exists in this phase. The Synth display says the Synth engine is out of
 * scope rather than showing a waveform it cannot produce.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteLabel(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

function audioLine(snapshot: PianoSnapshot): { label: string; tone: string } {
  const { status } = snapshot.audio
  switch (status) {
    case 'ready':
      return { label: 'AUDIO READY', tone: 'ok' }
    case 'loading':
      return { label: 'AUDIO LOADING', tone: 'warn' }
    case 'suspended':
      return { label: 'AUDIO SUSPENDED', tone: 'warn' }
    case 'fallback':
      return { label: 'NO AUDIO OUTPUT', tone: 'warn' }
    case 'error':
      return { label: 'AUDIO ERROR', tone: 'bad' }
    default:
      return { label: 'AUDIO IDLE', tone: 'warn' }
  }
}

function midiLine(midi: MidiStatusReport): { label: string; tone: string } {
  switch (midi.state) {
    case 'ready':
      return { label: `MIDI ${midi.inputCount} IN`, tone: 'ok' }
    case 'denied':
      return { label: 'MIDI DENIED', tone: 'warn' }
    case 'disconnected':
      return { label: 'MIDI LOST', tone: 'warn' }
    case 'unsupported':
      return { label: 'NO WEB MIDI', tone: 'warn' }
    case 'error':
      return { label: 'MIDI ERROR', tone: 'bad' }
    case 'requesting':
      return { label: 'MIDI…', tone: 'warn' }
    default:
      return { label: 'MIDI IDLE', tone: 'warn' }
  }
}

/** The library line: says "recorded" only when a recording is really loaded. */
function libraryLine(library: LibraryStatus): { label: string; tone: string } {
  switch (library.state) {
    case 'ready':
      return { label: library.loadedFiles > 0 ? 'SAMPLES READY' : 'MODELLED', tone: 'ok' }
    case 'loading':
      return { label: 'LOADING SAMPLES', tone: 'warn' }
    case 'fallback':
      return { label: 'PIANO NOT FOUND', tone: 'bad' }
    case 'error':
      return { label: 'PIANO NOT FOUND', tone: 'bad' }
    default:
      return { label: 'LIBRARY IDLE', tone: 'warn' }
  }
}

export interface ProgramDisplayProps {
  snapshot: PianoSnapshot
  midi: MidiStatusReport
  /** Number of physical keys currently under a pointer or key. */
  heldCount: number
  /** Piano section state, for the layer/model readout. */
  piano?: PianoState
  /** Layer Effects state, for the real FX focus readout. */
  effects?: EffectState
  /** Truthful piano-library status. */
  library?: LibraryStatus
}

/**
 * Primary program OLED. Reads the real engine, MIDI, voice, piano and effect state.
 */
export function ProgramDisplay({ snapshot, midi, heldCount, piano, effects, library }: ProgramDisplayProps) {
  const audio = audioLine(snapshot)
  const midiStatus = midiLine(midi)
  const sounding = snapshot.sounding
  const focusedLayer = piano?.layers[piano.focused]
  const model = focusedLayer ? modelById(focusedLayer.model) : undefined

  // The model line names the selected model and its *declared* source, which is a property
  // of the library and therefore true whether or not audio is running. Whether that source
  // is actually loaded right now is the separate library chip's job.
  // Synthesised model names already end in "(modelled)", so the suffix is only printed for
  // recordings; that keeps the label informative instead of doubled.
  const sourceWord = model ? (model.source === 'recorded' ? 'recorded' : '') : ''
  const voiceLine =
    sounding.length === 0
      ? 'Idle'
      : `${sounding.length} voice${sounding.length === 1 ? '' : 's'}`

  const layers = piano ? (['piano.a', 'piano.b'] as const) : []
  const fxFocus = effects
    ? `${effects.focusedLayer === 'piano.b' ? 'PIANO B' : 'PIANO A'}${effects.pianoGroup ? ' GRP' : ''}`
    : ''
  const lib = library ? libraryLine(library) : null

  return (
    <div
      className="oled glass-program"
      data-testid="program-display"
      data-display-id="program.display"
      data-display-root="true"
      role="status"
      // Only state transitions are announced. A live region that re-announced on every
      // key press would read a wall of text at a player, so the region is polite and
      // carries the stable status line rather than the per-note readout.
      aria-live="polite"
      aria-atomic="false"
      aria-label={`Program display: ${audio.label}. ${midiStatus.label}. ${snapshot.audio.detail}${
        model ? `. Piano ${model.name}, ${model.source === 'recorded' ? 'recorded' : 'modelled'}` : ''
      }`}
    >
      <div className="glass-row glass-head">
        {/* No program library exists in this phase, so the slot area says so rather than
            printing a bank and number that would imply a loaded program. */}
        <span className="glass-bank">PHASE 2</span>
        <span className={`glass-status tone-${audio.tone}`}>{audio.label}</span>
      </div>
      <div className="glass-title">
        <span>{VARIANT.fullName}</span>
      </div>
      <div className="glass-row glass-voice">
        <span className="glass-icon" aria-hidden="true">
          PIANO
        </span>
        <span className="glass-value" data-testid="piano-model-line">
          {model ? `${typeLabel(model.type)} · ${model.name}${sourceWord ? ` (${sourceWord})` : ''}` : 'Modelled piano'}
        </span>
      </div>
      {piano && layers.length > 0 ? (
        <div className="glass-row glass-meta">
          {layers.map((id) => {
            const layer = piano.layers[id]
            const layerModel = modelById(layer.model)
            const letter = id === 'piano.a' ? 'A' : 'B'
            return (
              <span
                key={id}
                className={`glass-chip ${layer.enabled ? 'tone-ok' : ''} ${
                  piano.focused === id ? 'is-focused' : ''
                }`}
                data-testid={`layer-chip-${letter.toLowerCase()}`}
              >
                {letter} {layer.enabled ? `${Math.round(layer.level)}` : 'off'}
                {layer.octave !== 0 ? ` ${layer.octave > 0 ? '+' : ''}${layer.octave}` : ''}
                {piano.focused === id ? ' ◂' : ''}
                {layerModel && piano.focused === id ? ` ${timbreLabelFor(layer.type, piano.timbre)}` : ''}
              </span>
            )
          })}
        </div>
      ) : null}
      <div className="glass-row glass-meta">
        <span className={`glass-chip tone-${midiStatus.tone}`}>{midiStatus.label}</span>
        <span className="glass-chip">SUSTAIN {snapshot.sustainPedal ? 'DOWN' : 'UP'}</span>
        <span className="glass-chip">
          {heldCount}/{VARIANT.totalKeys} KEYS
        </span>
        {lib ? (
          <span className={`glass-chip tone-${lib.tone}`} data-testid="library-line">
            {lib.label}
          </span>
        ) : null}
      </div>
      {effects ? (
        <div className="glass-row glass-meta">
          <span className="glass-chip" data-testid="fx-focus-line">
            FX {fxFocus}
          </span>
          {(() => {
            const chain = effectiveChain(effects, effects.focusedLayer)
            const on = [
              chain.mod1.on ? 'MOD1' : null,
              chain.mod2.on ? 'MOD2' : null,
              chain.delay.on ? 'DLY' : null,
              chain.ampEq.on ? 'AMP' : null,
              chain.compressor.on ? 'CMP' : null,
              chain.reverb.on ? 'REV' : null,
              effects.rotary.on ? 'ROT' : null,
            ].filter(Boolean)
            return (
              <span className="glass-chip" data-testid="fx-active-line">
                {on.length > 0 ? on.join(' ') : 'FX OFF'}
              </span>
            )
          })()}
        </div>
      ) : null}
      <div className="glass-row glass-meta">
        <span className="glass-chip">
          {snapshot.byLayer['piano.a']}A / {snapshot.byLayer['piano.b']}B VOICES
        </span>
        <span className="glass-chip">{voiceLine}</span>
      </div>
      <div className="glass-foot">
        <span>{snapshot.audio.detail}</span>
      </div>
      <div className="glass-foot glass-note">
        <span>
          {keybedRangeLabel()} · {VARIANT.totalKeys} keys · {VARIANT.keyAction}
        </span>
        <span>
          {sounding.length > 0 ? sounding.slice(0, 6).map(noteLabel).join(' ') : '—'}
          {snapshot.stolen > 0 ? ` · ${snapshot.stolen} stolen` : ''}
        </span>
      </div>
      {library && library.detail ? (
        <div className="glass-foot glass-note">
          <span data-testid="library-detail">{library.detail}</span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Synth OLED. The Synth engine is out of scope for this phase, so the display says exactly
 * that instead of showing a waveform it cannot produce.
 */
export function SynthDisplay({ midi }: { midi: MidiStatusReport }) {
  void midi
  return (
    <div
      className="oled glass-synth"
      data-testid="synth-display"
      data-display-id="synth.display"
      data-display-root="true"
      aria-label="Synth display: synth engine not available in this phase"
    >
      <div className="glass-row glass-head">
        <span className="glass-bank">OSC WAVEFORM</span>
        <span className="glass-status tone-warn">OFFLINE</span>
      </div>
      <div className="glass-title glass-title-sm">
        <span>Synth engine</span>
      </div>
      <div className="glass-row glass-voice">
        <span className="glass-icon" aria-hidden="true">
          SYNTH
        </span>
        <span className="glass-value">Not available in this phase</span>
      </div>
      <div className="glass-foot">
        <span>Controls are present and move, but produce no sound here.</span>
      </div>
    </div>
  )
}
