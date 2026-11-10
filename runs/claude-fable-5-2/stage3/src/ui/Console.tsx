import { useSyncExternalStore } from 'react'
import type { Session } from '../app/session'
import type { AudioStatus } from '../audio/engine'
import { SAMPLE_MANIFEST, SAMPLE_SET_IDS } from '../audio/library/loader'
import { UNSUPPORTED_CONTROLS, UNSUPPORTED_FUNCTIONS } from '../hardware/functional'
import { INVENTORY } from '../hardware/inventory'
import { noteName } from '../hardware/keys'
import type { MidiStatus } from '../input/midi'
import { programHeader } from '../state/display'
import { LAYER_NAMES } from '../state/model'
import { describeLayerVoice } from './Oleds'

interface ConsoleProps {
  session: Session
  zoom: number
  zoomSteps: readonly number[]
  onZoom: (zoom: number) => void
}

const AUDIO_LABEL: Record<AudioStatus, string> = {
  idle: 'Idle',
  loading: 'Loading',
  ready: 'Ready',
  fallback: 'Fallback',
  error: 'Error',
}

const MIDI_LABEL: Record<MidiStatus, string> = {
  unsupported: 'Unsupported',
  idle: 'Off',
  requesting: 'Asking permission',
  connected: 'Connected',
  'no-inputs': 'No input connected',
  denied: 'Denied',
  error: 'Error',
}

const PEDAL_SOURCE = 'ui:pedal'

const VOICE_LABEL = {
  recorded: 'Recorded samples',
  synthesized: 'Synthesis',
  fallback: 'Fallback',
  loading: 'Loading',
} as const

/**
 * Everything that is not the instrument: live status, the functional helpers that have no
 * place on the panel (MIDI permission, a sustain pedal, a control pedal), view zoom, the list
 * of unsupported controls, and how to play. It sits below the instrument so nothing stands
 * between the viewer and the hardware.
 */
export function Console({ session, zoom, zoomSteps, onZoom }: ConsoleProps) {
  const audio = useSyncExternalStore(session.engine.subscribe, session.engine.getSnapshot, session.engine.getSnapshot)
  const midi = useSyncExternalStore(session.midi.subscribe, session.midi.getSnapshot, session.midi.getSnapshot)
  const notes = useSyncExternalStore(
    session.lifecycle.subscribe,
    session.lifecycle.getSnapshot,
    session.lifecycle.getSnapshot,
  )
  const baseNote = useSyncExternalStore(session.keyboard.subscribe, session.keyboard.getBaseNote, session.keyboard.getBaseNote)
  const stage = useSyncExternalStore(session.stage.subscribe, session.stage.getState, session.stage.getState)
  const pedalDown = notes.sustain
  const focus = stage.piano.focus
  const voice = describeLayerVoice(stage.piano.layers[focus], audio)
  const pianoStatus = voice.kind === 'recorded' || voice.kind === 'synthesized' ? 'ready' : voice.kind

  const zoomIndex = zoomSteps.indexOf(zoom)
  const canEnableMidi = midi.status === 'idle'

  return (
    <aside className="console" aria-label="Status and playing help">
      <div className="console__row">
        <p className="chip" data-status-kind="audio" data-status={audio.status} role="status" aria-live="polite">
          <span className="chip__key">Audio</span>
          <span className="chip__value" data-testid="audio-status">
            {AUDIO_LABEL[audio.status]}
          </span>
          <span className="chip__detail" title={audio.detail}>
            {audio.detail}
          </span>
        </p>
        <p className="chip" data-status-kind="midi" data-status={midi.status} role="status" aria-live="polite">
          <span className="chip__key">MIDI</span>
          <span className="chip__value" data-testid="midi-status">
            {MIDI_LABEL[midi.status]}
          </span>
          <span className="chip__detail" title={midi.detail}>
            {midi.detail}
          </span>
        </p>
        <p className="chip" data-status-kind="program" data-status={stage.nav.dirty ? 'loading' : 'ready'}>
          <span className="chip__key">{stage.nav.live ? 'Live' : 'Program'}</span>
          <span className="chip__value" data-testid="program-status">
            {programHeader(stage)}
          </span>
          <span
            className="chip__detail"
            data-testid="program-edited"
            title={stage.nav.live ? 'Live Mode: edits are stored as they are made.' : stage.nav.dirty ? 'Edited (E): not stored yet.' : 'As stored.'}
          >
            {stage.nav.live ? 'Live Mode: edits are stored as they are made.' : stage.nav.dirty ? 'Edited (E): not stored yet.' : 'As stored.'}
          </span>
        </p>
        {/* Not a live region: a piano that fails to load is announced by the Audio status above. */}
        <p className="chip" data-status-kind="piano" data-status={pianoStatus}>
          <span className="chip__key">Piano {LAYER_NAMES[focus]}</span>
          <span className="chip__value" data-testid="piano-status">
            {VOICE_LABEL[voice.kind]}
          </span>
          <span className="chip__detail" data-testid="piano-detail" title={`${voice.name}. ${voice.sentence}`}>
            {voice.name}. {voice.sentence}
          </span>
        </p>
      </div>

      <div className="console__row console__row--tools">
        {canEnableMidi ? (
          <button type="button" className="tool" id="midi-enable" onClick={() => void session.midi.enable()}>
            Enable MIDI
          </button>
        ) : null}
        <button
          type="button"
          id="sustain-pedal"
          className="tool tool--pedal"
          aria-pressed={pedalDown}
          onClick={() => {
            session.wake()
            // The on-screen pedal latches: one tap down, one tap up.
            session.lifecycle.setSustain(PEDAL_SOURCE, !session.lifecycle.isSustainHeldBy(PEDAL_SOURCE))
          }}
        >
          Sustain pedal: {pedalDown ? 'down' : 'up'}
        </button>
        <label className="tool tool--slider" htmlFor="control-pedal">
          Control pedal
          <input
            id="control-pedal"
            type="range"
            min={0}
            max={127}
            step={1}
            value={Math.round(stage.pedal * 127)}
            aria-valuetext={`${Math.round(stage.pedal * 100)} percent`}
            onChange={(event) => session.stage.setPedal(Number(event.target.value) / 127)}
          />
        </label>
        <button type="button" id="all-notes-off" className="tool" onClick={session.panic}>
          All notes off
        </button>
        <span className="readout" data-testid="voice-count">
          Voices: {audio.voices}
        </span>
        <span className="readout" data-testid="held-count">
          Keys held: {notes.held.length}
        </span>
        <span className="tool-group" role="group" aria-label="Computer keyboard octave">
          <button type="button" className="tool" aria-label="Octave down" onClick={() => session.keyboard.shiftOctave(-1)}>
            Z −
          </button>
          <span className="readout" data-testid="kbd-octave">
            A = {noteName(baseNote)}
          </span>
          <button type="button" className="tool" aria-label="Octave up" onClick={() => session.keyboard.shiftOctave(1)}>
            X +
          </button>
        </span>
        <span className="tool-group" role="group" aria-label="View zoom">
          <button
            type="button"
            className="tool"
            aria-label="Zoom out"
            disabled={zoomIndex <= 0}
            onClick={() => onZoom(zoomSteps[Math.max(0, zoomIndex - 1)])}
          >
            −
          </button>
          <button type="button" className="tool" aria-pressed={zoom === 1} onClick={() => onZoom(1)}>
            {zoom === 1 ? 'Fit' : `${zoom}×`}
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Zoom in"
            disabled={zoomIndex >= zoomSteps.length - 1}
            onClick={() => onZoom(zoomSteps[Math.min(zoomSteps.length - 1, zoomIndex + 1)])}
          >
            +
          </button>
        </span>
        <details className="credits">
          <summary className="tool">Sample credits</summary>
          <div className="credits__panel" data-testid="sample-credits">
            <p>Recorded pianos bundled with this page (trimmed, mono, 32 kHz; see IMPLEMENTATION_DETAILS.json):</p>
            <ul>
              {SAMPLE_SET_IDS.map((id) => {
                const source = SAMPLE_MANIFEST.sets[id].source
                return (
                  <li key={id}>
                    <strong>{source.name}</strong> — {source.instrument}, by {source.author}. Licence: {source.license} (
                    {source.licenseUrl}). Source: github.com/{source.repo}.
                  </li>
                )
              })}
            </ul>
            <p>Clav, Digital, Misc, the fallback piano, every Organ model, and the Synth are synthesized by this app; they are not recordings.</p>
          </div>
        </details>
        <details className="credits">
          <summary className="tool">Unsupported controls</summary>
          <div className="credits__panel" data-testid="unsupported-controls">
            <p>These controls are excluded by the benchmark specs (or optional and not implemented). They move or press and do nothing else:</p>
            <ul>
              {Object.entries(UNSUPPORTED_CONTROLS).map(([id, reason]) => (
                <li key={id} data-unsupported={id}>
                  <strong>{INVENTORY.controlById.get(id)?.name ?? id}</strong> — {reason}
                </li>
              ))}
            </ul>
            <p>These functions of otherwise working controls report "not available" on the Program display and change nothing:</p>
            <ul>
              {Object.entries(UNSUPPORTED_FUNCTIONS).map(([name, reason]) => (
                <li key={name}>
                  <strong>{name}</strong> — {reason}
                </li>
              ))}
            </ul>
            <p>The Organ and Synth engines are live synthesis; nothing in them is a recording.</p>
          </div>
        </details>
      </div>

      <p className="console__note">
        <strong>Phase 3.</strong> Organ, Piano, Synth, Layer Effects, Rotary Speaker, and the Program section
        (32 programs, 8 Live slots, splits, Layer Scenes, morphs, Master Clock, transpose, Panic) are functional.
        The {Object.keys(UNSUPPORTED_CONTROLS).length} controls the specs exclude move or press, but each is
        decorative: it does not change the sound.
      </p>
      <p className="console__help" data-help="shift">
        <strong>Shift</strong> (the computer key, or click a panel Shift to latch it) + <em>Layer A</em> SUSTPED ·{' '}
        <em>Layer B</em> PSTICK · <em>Octave Shift</em> KB Zone · <em>FX Focus</em> Group · an effect's <em>On</em>{' '}
        Global · Delay <em>Filter</em> Ping Pong · turn Comp <em>Amount</em> Fast · turn a <em>Rate</em>/<em>Tempo</em>{' '}
        knob to lock it to the Master Clock · <em>Store</em> Store As · <em>Split</em> split page ·{' '}
        <em>Program dial</em> list · <em>Morph Assign</em> clear · <em>Transpose</em> Panic · <em>Arp Run</em> KB Sync ·{' '}
        <em>Waveform</em> Sound Init. On an editing page, Shift alone is Exit. Holding <em>Split</em>,{' '}
        <em>Mst Clk</em>, or <em>Transp</em> opens its page.
      </p>
      <p className="console__help" data-help="program">
        <strong>Programs.</strong> Program buttons 1–8 and Page pick one of 32; the dial steps through them.{' '}
        <em>Store</em> twice stores; an unsaved edit shows <strong>E</strong>. <em>Live Mode</em> gives 8 slots that
        store themselves. <strong>Morph:</strong> press <em>Wheel</em> or <em>Ctrl Ped</em>, move a knob, fader, or
        drawbar to where the morph should end, press it again; then move the wheel or the Control pedal slider.
      </p>
      <p className="console__help">
        Play with mouse or touch (strike nearer the front edge for a harder hit), a MIDI keyboard, or the computer
        keys <kbd>A</kbd> <kbd>W</kbd> <kbd>S</kbd> <kbd>E</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>T</kbd> <kbd>G</kbd>{' '}
        <kbd>Y</kbd> <kbd>H</kbd> <kbd>U</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>O</kbd> <kbd>L</kbd> <kbd>P</kbd>{' '}
        <kbd>;</kbd> <kbd>'</kbd>. <kbd>Z</kbd>/<kbd>X</kbd> shift the octave. <kbd>Space</kbd> is the sustain pedal
        unless a control has focus.
      </p>
    </aside>
  )
}
