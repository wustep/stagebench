import { useSyncExternalStore } from 'react'
import { getModel } from '../audio/pianoModels'
import { midiToName } from '../hardware/keybed'
import { focusedChainKey } from '../state/instrumentState'
import { useEngineStatus, useInstrumentState, useServices } from './context'

/**
 * The Program OLED: the only primary display of the program section. Shows the focused Piano layer's
 * type and model (manual p. 24: the model name is shown in the Program display), the truthful audio /
 * MIDI / library state and the effects focus. Never shows program names or unimplemented features.
 */
export function ProgramOled() {
  const { midi, bus } = useServices()
  const status = useEngineStatus()
  const midiStatus = useSyncExternalStore(midi.subscribe, midi.getStatus, midi.getStatus)
  const notes = useSyncExternalStore(bus.subscribe, bus.getState, bus.getState)
  const piano = useInstrumentState((s) => s.piano)
  const effects = useInstrumentState((s) => s.effects)
  const shiftArmed = useInstrumentState((s) => s.shiftArmed)
  const held = [...notes.held.keys()].sort((a, b) => a - b).map(midiToName)
  const focused = piano.layers[piano.focus]
  const model = getModel(focused.modelId)
  const layerStatus = status.layers[piano.focus]
  const headline = !piano.on ? 'Piano section off' : layerStatus.state === 'fallback' ? 'Piano not found' : `${model.type} · ${model.name}`
  const layerLine = (id: 'A' | 'B') => {
    const l = status.layers[id]
    if (!l.on) return `${id}: off`
    const src = l.source === 'recorded-samples' ? 'rec' : l.source === 'generated-buffers' ? 'gen' : l.source === 'none' ? '' : 'fallback'
    const st = l.state === 'loading' ? `${l.loaded}/${l.total}` : l.state
    return `${id}: ${l.modelName} ${src} ${st}`.trim()
  }
  const fx = `${effects.focus === 'piano' ? `Piano ${piano.focus}` : effects.focus === 'organ' ? 'Organ' : 'Synth'}${effects.pianoGroup && effects.focus === 'piano' ? ' GRP' : ''}${effects.on ? '' : ' FX OFF'}`
  const globals = (['delay', 'comp', 'reverb'] as const).filter((u) => effects.global[u]).map((u) => u.toUpperCase()[0])
  const chain = useInstrumentState((s) => s.effects.chains[focusedChainKey(s)])
  return (
    <div id="program.oled" className="oled oled-program" role="group" aria-label="Program display" data-display="primary" data-headline={headline}>
      <div className="oled-row oled-head">
        <span>STAGEBENCH</span>
        <span>{shiftArmed ? 'SHIFT · ' : ''}PHASE 2</span>
      </div>
      <div className="oled-row oled-big">{headline}</div>
      <div className="oled-rule" />
      <div className="oled-row" data-role="layers">
        {layerLine('A')} · {layerLine('B')}
      </div>
      <div className="oled-row">
        Audio {status.state} · MIDI {midiStatus.state} · FX {fx}
        {globals.length ? ` · Global ${globals.join('')}` : ''}
        {chain.delay.pingPong ? ' · PingPong' : ''}
        {chain.comp.fast ? ' · CompFast' : ''}
      </div>
      <div className="oled-row">
        Keys {held.length ? held.join(' ') : '—'} · Sus {notes.sustain ? (piano.sustped ? 'on' : 'on (SUSTPED off)') : 'off'}
        {piano.pstick ? ' · PSTICK' : ''}
      </div>
    </div>
  )
}

/** The Synth OLED: the section's single narrow display. Honest about being decorative in Phase 2. */
export function SynthOled() {
  return (
    <div id="synth.oled" className="oled oled-synth" role="group" aria-label="Synth display" data-display="primary">
      <div className="oled-row oled-head oled-center">SYNTH · PHASE 2</div>
      <div className="oled-row oled-big">Decorative</div>
      <div className="oled-row">No synth engine runs yet</div>
      <div className="oled-row oled-dials">
        <span>TYPE</span>
        <span>CAT</span>
        <span>WAVE</span>
      </div>
    </div>
  )
}
