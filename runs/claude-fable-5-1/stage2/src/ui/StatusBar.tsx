import { useSyncExternalStore } from 'react'
import { midiToName } from '../hardware/keybed'
import { useStore } from '../state/store'
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
  unavailable: 'unavailable (layers feed the master gain directly)',
}

/** Honest status strip under the instrument: audio, library, effects host, MIDI, sustain pedal, keyboard mapping. */
export function StatusBar({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const services = useServices() as Services
  const { engine, midi, bus } = services
  const status = useEngineStatus()
  const midiStatus = useSyncExternalStore(midi.subscribe, midi.getStatus, midi.getStatus)
  const notes = useSyncExternalStore(bus.subscribe, bus.getState, bus.getState)
  const base = useStore(services.keyboardBase, (b) => b)
  const sustped = useInstrumentState((s) => s.piano.sustped)
  const uiSustain = notes.sustainSources.has('ui')
  const held = [...notes.held.keys()].sort((a, b) => a - b).map(midiToName)
  const layerText = (id: 'A' | 'B') => {
    const l = status.layers[id]
    if (!l.on) return `${id} off`
    const source = l.source === 'recorded-samples' ? 'recorded samples' : l.source === 'generated-buffers' ? 'generated' : l.source === 'fallback-generated' ? 'FALLBACK generated' : l.source === 'fallback-oscillator' ? 'FALLBACK oscillator' : 'not loaded'
    return `${id}: ${l.type} · ${l.modelName} (${source}) ${l.state === 'loading' ? `${l.loaded}/${l.total}` : l.state}`
  }
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
        <span className="status-pill" id="library-status" data-a={status.layers.A.state} data-b={status.layers.B.state}>
          Piano {status.library ? 'library' : 'voice'}
        </span>
        <span className="status-text" id="library-message">
          {layerText('A')} · {layerText('B')}
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
        <button type="button" className="status-btn" id="all-notes-off" onClick={() => bus.releaseAll()}>
          All notes off
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
