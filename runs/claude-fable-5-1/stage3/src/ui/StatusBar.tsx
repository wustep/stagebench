import { useSyncExternalStore } from 'react'
import { midiToName } from '../hardware/keybed'
import { useStore } from '../state/store'
import { isDirty } from '../state/instrumentState'
import { slotLabel } from '../state/programState'
import { ORGAN_MODELS } from '../dsp/organTypes'
import { waveName } from '../dsp/synthTypes'
import { useEngineStatus, useInstrumentState, useServices } from './context'
import type { Services } from './createServices'

const STATE_LABEL: Record<string, string> = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
  fallback: 'fallback',
}

const EFFECTS_LABEL: Record<string, string> = {
  none: 'not started',
  loading: 'loading DSP host…',
  worklet: 'AudioWorklet',
  'main-thread': 'main-thread fallback (ScriptProcessor)',
  unavailable: 'unavailable (layers feed the master gain directly; organ and synth need the DSP host)',
}

/** Honest status strip under the instrument: audio, library, engines, program, effects host, MIDI, pedals, keyboard mapping. */
export function StatusBar({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const services = useServices() as Services
  const { engine, midi, bus, controller } = services
  const status = useEngineStatus()
  const midiStatus = useSyncExternalStore(midi.subscribe, midi.getStatus, midi.getStatus)
  const notes = useSyncExternalStore(bus.subscribe, bus.getState, bus.getState)
  const base = useStore(services.keyboardBase, (b) => b)
  const sustped = useInstrumentState((s) => s.piano.sustped)
  // Selectors must return stable snapshots: read the state object and derive everything from it.
  const state = useInstrumentState((s) => s)
  const program = { name: state.name, slot: state.bank.slot, liveSlot: state.bank.liveSlot, live: state.bank.liveMode, dirty: isDirty(state), scene: state.scenes.active, split: state.split.on, transpose: state.transpose, bpm: state.clock.bpm, pedal: state.morphSources.pedal, wheel: state.morphSources.wheel, morphs: state.morph.wheel.length + state.morph.pedal.length, view: state.view.mode }
  const organ = state.organ
  const synth = state.synth
  const uiSustain = notes.sustainSources.has('ui')
  const held = [...notes.held.keys()].sort((a, b) => a - b).map(midiToName)
  const layerText = (id: 'A' | 'B') => {
    const l = status.layers[id]
    if (!l.on) return `${id} off`
    const source = l.source === 'recorded-samples' ? 'recorded samples' : l.source === 'generated-buffers' ? 'generated' : l.source === 'fallback-generated' ? 'FALLBACK generated' : l.source === 'fallback-oscillator' ? 'FALLBACK oscillator' : 'not loaded'
    return `${id}: ${l.type} · ${l.modelName} (${source}) ${l.state === 'loading' ? `${l.loaded}/${l.total}` : l.state}`
  }
  const organText = organ.on ? (['A', 'B'] as const).map((id) => (organ.layers[id].on ? `${id}: ${ORGAN_MODELS[organ.layers[id].model]} (${status.sources.organ[id]} notes)` : `${id} off`)).join(' · ') : 'section off'
  const synthText = synth.on ? (['A', 'B', 'C'] as const).map((id) => (synth.layers[id].on ? `${id}: ${waveName(synth.layers[id].wave)}${synth.layers[id].arp.run ? ' arp' : ''} (${status.sources.synth[id]} notes)` : `${id} off`)).join(' · ') : 'section off'
  return (
    <div className="status" id="status">
      <div className="status-group">
        <button type="button" id="start-audio" className="status-btn" onClick={() => void engine.start()} disabled={status.state === 'ready' || status.state === 'loading'}>
          Start audio
        </button>
        <span className={`status-pill state-${status.state}`} role="status" aria-live="polite" id="audio-status" data-state={status.state}>
          Audio: {STATE_LABEL[status.state] ?? status.state}
          {status.state === 'loading' && !status.library ? ` (${status.warmed}/${status.warmTotal})` : ''}
        </span>
        <span className="status-text" id="audio-message">
          {status.message}
        </span>
      </div>
      <div className="status-group">
        <span className="status-pill" id="program-status" data-slot={program.live ? slotLabel(program.liveSlot, true) : slotLabel(program.slot)} data-dirty={program.dirty} data-live={program.live} data-view={program.view}>
          Program {program.live ? `Live ${program.liveSlot + 1}` : slotLabel(program.slot)}
          {program.dirty ? ' E' : ''}
        </span>
        <span className="status-text" id="program-message">
          {program.name} · Scene {program.scene} · Split {program.split ? 'on' : 'off'} · Transpose {program.transpose.on ? `${program.transpose.semitones > 0 ? '+' : ''}${program.transpose.semitones}` : 'off'} · {program.bpm} BPM · {program.morphs} morph{program.morphs === 1 ? '' : 's'} (wheel {Math.round(program.wheel * 100)}%, pedal {Math.round(program.pedal * 100)}%)
        </span>
      </div>
      <div className="status-group">
        <span className="status-pill" id="library-status" data-a={status.layers.A.state} data-b={status.layers.B.state}>
          Piano {status.library ? 'library' : 'voice'}
        </span>
        <span className="status-text" id="library-message">
          {layerText('A')} · {layerText('B')}
        </span>
        <span className="status-pill" id="organ-status" data-on={organ.on} data-a={organ.layers.A.on} data-b={organ.layers.B.on}>
          Organ
        </span>
        <span className="status-text" id="organ-message">
          {organText} · live synthesis (src/dsp/organ.ts)
        </span>
        <span className="status-pill" id="synth-status" data-on={synth.on}>
          Synth
        </span>
        <span className="status-text" id="synth-message">
          {synthText} · live synthesis (src/dsp/synth.ts)
        </span>
        <span className="status-pill" id="effects-status" data-state={status.effects} title={status.effectsError ?? undefined}>
          Effects: {EFFECTS_LABEL[status.effects] ?? status.effects}
          {status.effectsError ? ` — ${status.effectsError}` : ''}
        </span>
      </div>
      <div className="status-group">
        <span className={`status-pill midi-${midiStatus.state}`} id="midi-status" data-state={midiStatus.state}>
          MIDI: {midiStatus.state}
        </span>
        <span className="status-text" id="midi-message">
          {midiStatus.message}
          {midiStatus.lastMessage ? ` · last: ${midiStatus.lastMessage}` : ''}
        </span>
        {midiStatus.state === 'idle' || midiStatus.state === 'denied' || midiStatus.state === 'error' ? (
          <button type="button" className="status-btn" id="midi-connect" onClick={() => void midi.connect()}>
            Request MIDI
          </button>
        ) : null}
      </div>
      <div className="status-group">
        <button type="button" id="sustain-pedal" className={`status-btn${uiSustain ? ' is-on' : ''}`} aria-pressed={uiSustain} onClick={() => bus.setSustain('ui', !uiSustain)}>
          Sustain pedal
        </button>
        <span className="status-text" id="sustain-status">
          Sustain: {notes.sustain ? 'down' : 'up'}
          {sustped ? '' : ' (SUSTPED off: piano ignores the pedal)'} · Keys: {held.length ? held.join(' ') : 'none'}
        </span>
        <label className="status-text status-range" htmlFor="control-pedal">
          Control pedal
          <input id="control-pedal" type="range" min={0} max={100} step={1} value={Math.round(program.pedal * 100)} aria-label="Control pedal (morph source, MIDI CC11)" onChange={(e) => controller.setControlPedal(Number(e.target.value) / 100)} />
          <span id="control-pedal-value">{Math.round(program.pedal * 100)}%</span>
        </label>
        <button type="button" className="status-btn" id="all-notes-off" onClick={() => bus.releaseAll()}>
          All notes off
        </button>
        <button type="button" className="status-btn" id="panic" onClick={() => controller.panic()}>
          Panic
        </button>
      </div>
      <div className="status-group">
        <span className="status-text" id="keyboard-hint">
          Computer keyboard: A W S E D F T G Y H U J K O L P ; ' play {midiToName(base)}–{midiToName(base + 17)} · Z / X octave · Shift = sustain
        </span>
        <button type="button" className="status-btn" id="octave-down" onClick={() => services.keyboardRef.current?.setBase(base - 12)}>
          Oct −
        </button>
        <button type="button" className="status-btn" id="octave-up" onClick={() => services.keyboardRef.current?.setBase(base + 12)}>
          Oct +
        </button>
      </div>
      <div className="status-group status-zoom">
        <span className="status-text">Inspect:</span>
        {[1, 2, 3].map((z) => (
          <button key={z} type="button" className={`status-btn${zoom === z ? ' is-on' : ''}`} aria-pressed={zoom === z} onClick={() => onZoom(z)} id={`zoom-${z}`}>
            {z === 1 ? 'Fit' : `${z}×`}
          </button>
        ))}
      </div>
    </div>
  )
}
