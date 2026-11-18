import { useCallback, useEffect, useMemo, useState } from 'react'
import { Keybed } from './hardware/Keybed'
import { variant } from './hardware/model'
import { PanelEditor } from './hardware/PanelEditor'
import { shiftExclusions, unsupportedControls, usePanelActions } from './hardware/panelActions'
import { address } from './instrument/programs'
import { waves } from './instrument/parameters'
import { usePrograms } from './instrument/usePrograms'
import { ControlDeck } from './hardware/Surface'
import { isRecorded, models } from './piano/settings'
import { useInstrument } from './piano/useInstrument'
import type { InstrumentEnvironment } from './piano/useInstrument'

const audioLabels = {
  loading: 'Loading upright piano · Synth fallback',
  ready: 'Upright Piano KW ready',
  fallback: 'Upright samples unavailable · Synth fallback',
  error: 'Audio unavailable',
}

const midiLabels = {
  connecting: 'Checking MIDI',
  connected: 'MIDI connected',
  disconnected: 'No MIDI input',
  denied: 'MIDI permission denied',
  unavailable: 'MIDI unavailable',
  error: 'MIDI connection error',
}

export default function App({ environment }: { environment?: InstrumentEnvironment } = {}) {
  const [zoomed, setZoomed] = useState(false)
  const viewport = environment?.window ?? window
  const programs = usePrograms(environment?.storage ?? (environment ? null : undefined), viewport)
  const { keys, press, release, tap, audio, midi, settings, pedal, configure, togglePedal, panic, setPerformance, resetVersion } =
    useInstrument(environment, () => programs.initial)
  const { connect } = programs
  const program = useMemo(() => connect(settings, configure, panic), [connect, settings, configure, panic])
  const now = useCallback(() => viewport.performance.now(), [viewport])
  const actions = usePanelActions(settings, program, now, panic)
  const storing = Boolean(program.store)
  useEffect(() => {
    if (!storing && !actions.editor) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (actions.editor) actions.close()
      else program.cancelStore()
    }
    viewport.addEventListener('keydown', escape)
    return () => viewport.removeEventListener('keydown', escape)
  }, [actions, program, storing, viewport])
  const type = settings.layers[settings.focus].type
  const model = models[type]
  const pianoLabel = type === 'Upright' || audio === 'error' ? audioLabels[audio] : {
    ready: `${model} ready${isRecorded(type) ? '' : ' · Synthesis'}`,
    loading: `Loading ${model} · Synth fallback`,
    fallback: `${model} samples unavailable · Synth fallback`,
  }[audio]
  const organ = settings.organ.layers[settings.organ.focus]
  const synth = settings.synth.layers[settings.synth.focus]
  const activeSounds = [
    settings.organ.on && Object.values(settings.organ.layers).some((layer) => layer.on) && organ.model,
    settings.synth.on && Object.values(settings.synth.layers).some((layer) => layer.on) && waves[synth.category][synth.wave],
  ].filter(Boolean)
  const audioLabel = !settings.on && audio === 'ready'
    ? activeSounds.length ? `${activeSounds.join(' + ')} ready · Synthesis` : 'All sections muted'
    : pianoLabel
  return (
    <main className="studio">
      <div className={`instrument-view${zoomed ? ' instrument-view--zoomed' : ''}`}>
        <div id="instrument" className="instrument" data-instrument={variant.id} role="group" aria-label={variant.name}>
          <ControlDeck settings={settings} status={audio} program={program} actions={actions} now={now} />
          <Keybed state={keys} splits={settings.splits} resetVersion={resetVersion} press={press} release={release} tap={tap} />
        </div>
      </div>
      <div className="instrument-tools">
        <span role="status" className="screen-reader" data-program-dirty={program.dirty}>
          {program.label} {program.current.name}{program.dirty ? ' · Edited' : ''}
        </span>
        <div className="instrument-tools__status" role="status" data-audio-state={audio}>
          <i aria-hidden="true" />{audioLabel}
        </div>
        <div className="instrument-tools__midi" role="status" data-midi-state={midi}>{midiLabels[midi]}</div>
        <button className="instrument-tools__pedal" type="button" aria-pressed={pedal}
          onClick={togglePedal}>Sustain pedal</button>
        <label className="instrument-tools__expression">Control Pedal
          <input type="range" min="0" max="100" step="1" value={Math.round(settings.performance.pedal * 100)}
            aria-valuetext={`${Math.round(settings.performance.pedal * 100)}%`}
            onChange={(event) => setPerformance('pedal', event.currentTarget.valueAsNumber / 100)} />
        </label>
        <button className="instrument-tools__zoom" type="button" aria-controls="instrument" aria-pressed={zoomed}
          onClick={() => setZoomed(!zoomed)}>{zoomed ? 'Fit instrument' : 'Inspect controls'}</button>
        {zoomed && <span className="instrument-tools__pan">Swipe left or right to move along the panel.</span>}
        <details className="instrument-tools__help">
          <summary>Playing &amp; credits</summary>
          <p>Play with a mouse, touch, MIDI, or your computer keyboard. Use Z through / starting at C3 and Q through ] starting at C4. The row above each set adds sharps. Hold Space, use a MIDI pedal, or toggle Sustain pedal for notes routed through SUSTPED.</p>
          <p>Use Tab to focus controls, arrow keys to move sliders, and Enter or Space to press buttons. The amber buttons beneath the Piano faders focus each layer. Pitch Stick springs back when released with a pointer. Each of the six types has one model.</p>
          <p>Layer focus also targets the effects. Use Effects Shift with the Piano or Synth focus button to group those chains. Use Effects Shift with Delay, Compressor, or Reverb On to apply the unit globally. Use the Rotary Organ button for the shared Organ chain, or select To Rotary and turn on Amp for Piano or Synth.</p>
          <p>Use Program View or Shift with the Program Dial to browse. Press Store to choose a destination, then press Store again. Use Shift+Store to rename. Live slots save edits automatically.</p>
          <p>Hold Split or use Shift+Split to set the boundaries and zones. Shift with Octave moves the focused layer through zone ranges. Hold either morph source while moving a target, or double-tap to latch assignment. Use Shift with the source to clear its assignments. The wheel also accepts MIDI CC1, and the Control Pedal accepts MIDI CC11.</p>
          <p>Tap Master Clock four times or hold it and turn the Program Dial. Hold Transpose to adjust the interval. Shift+Transpose stops all notes and resets the performance inputs.</p>
          <p>In Synth, press an envelope button to set attack, decay, and release with the three display dials. Use Arpeggiator Menu for direction and clock sync, Shift with LFO Waveform for LFO clock sync, and Shift with Filter Resonance for tracking and drive.</p>
          <p><button type="button" onClick={() => actions.open('morph')}>Manage morph assignments</button></p>
          <details><summary>Unsupported features</summary>
            <p>{Object.values(unsupportedControls).join(' · ')}</p>
            <p>{Object.values(shiftExclusions).join(' · ')}</p>
            <p>Additional banks and program sorting, System/Sound/Organize/Output/Pedal/MIDI menus, Aux KB, Extern, memory protection, external clock and pedal tap, organ swell and tonewheel wear, keyboard trigger and rotary tuning, piano size classes, half-pedaling, Triple Pedal, piano downloads, Synth Samples mode, additional oscillator and filter models, delayed/aftertouch/pedal vibrato, arpeggiator zig-zag/accent/pan, LFO Group, Mod 1 pedal modes, Analog Delay, and post-Rotary global reverb placement.</p>
          </details>
          <p>Salamander Grand Piano V3 by Alexander Holm. Stereo recordings trimmed, levelled and encoded for this instrument. <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a> · <a href="https://archive.org/details/SalamanderGrandPianoV3">Source</a></p>
          <p>Upright Piano KW recordings by Gonzalo and Roberto, FreePats project. CC0 1.0. Rhodes Mark I samples (jRhodes GM version) by Jeff Learman. CC0 1.0.</p>
        </details>
      </div>
      {program.store && <aside className="store-banner" aria-label="Store destination">
        <div>Store <strong>{program.store.draft.name}</strong> to <strong>{address(program.selected)}</strong> · {program.selectedSlot.name}</div>
        <div><button type="button" onClick={program.confirmStore}>Confirm Store</button>
          <button type="button" onClick={program.cancelStore}>Cancel Store</button></div>
      </aside>}
      {program.storageError && <div className="storage-error" role="status">Browser storage is unavailable. Changes are saved for this session.</div>}
      <PanelEditor state={settings} program={program} actions={actions} />
    </main>
  )
}
