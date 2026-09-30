import { modelFor } from '../audio/library/catalog'
import type { OledSpec } from '../hardware/layout'
import { LAYER_IDS, type LayerId } from '../engine/state'
import { box, useEngineState, useInstrumentSnapshot } from './context'

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

const AUDIO_LABEL: Record<string, string> = {
  idle: 'AUDIO IDLE',
  loading: 'AUDIO LOADING',
  ready: 'AUDIO READY',
  fallback: 'AUDIO FALLBACK',
  error: 'AUDIO ERROR',
}

const octaveText = (n: number) => (n > 0 ? `+${n}` : String(n))

/** The two primary OLEDs. They only ever show state that is real in this phase. */
export default function Oled({ spec }: { spec: OledSpec }) {
  const snap = useInstrumentSnapshot()
  const state = useEngineState()
  const program = spec.id === 'program-oled'

  const layerLine = (id: LayerId) => {
    const layer = state.layers[id]
    const focus = state.focus === id ? '▸' : ' '
    if (!layer.enabled) return `${id}${focus} off`
    const model = modelFor(layer.type, layer.models[layer.type])
    const status = snap.models[id]
    const suffix = status.phase === 'error' ? '  PIANO NOT FOUND (fallback)' : status.phase === 'loading' ? `  loading ${status.loaded}/${status.total}` : ''
    const oct = layer.octave !== 0 ? `  oct ${octaveText(layer.octave)}` : ''
    return `${id}${focus} ${layer.type} · ${model.name}${oct}${suffix}`
  }

  const lines = program
    ? [
        state.pianoOn ? layerLine('A') : 'PIANO SECTION OFF',
        state.pianoOn ? layerLine('B') : '',
        `${AUDIO_LABEL[snap.audio.phase] ?? 'AUDIO'}  VOICES ${pad(snap.voices)}/${snap.maxVoices}  SUST ${snap.sustain ? 'ON' : 'OFF'}`,
        `Programs: not yet  FX ${state.effectsOn ? 'on' : 'bypassed'}${state.group ? ' group' : ` ${state.fxFocus}`}`,
      ]
    : ['Not active yet', 'Panel is decorative', 'No synth audio']
  const focused = LAYER_IDS.find((id) => id === state.focus)
  return (
    <div
      id={spec.id}
      className={`oled oled--${program ? 'program' : 'synth'}`}
      role="status"
      aria-live="off"
      aria-label={program ? `Program OLED: piano layers, audio and effects status. Layer ${focused} has the focus` : 'Synth OLED: inactive in this phase'}
      data-oled={program ? 'program' : 'synth'}
      data-section={spec.section}
      style={box(spec.x, spec.y, spec.w, spec.h, false)}
    >
      <div className="ol-title">{program ? 'NORD STAGE 4 73' : 'SYNTH'}</div>
      {lines.map((l, i) => (
        <div key={i} className="ol-line">
          {l || ' '}
        </div>
      ))}
    </div>
  )
}
