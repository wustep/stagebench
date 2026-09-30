import type { OledSpec } from '../hardware/layout'
import { box, useInstrumentSnapshot } from './context'

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

const AUDIO_LABEL: Record<string, string> = {
  idle: 'AUDIO IDLE',
  loading: 'AUDIO LOADING',
  ready: 'AUDIO READY',
  fallback: 'AUDIO FALLBACK',
  error: 'AUDIO ERROR',
}

/** The two primary OLEDs. They only ever show state that is real in this phase. */
export default function Oled({ spec }: { spec: OledSpec }) {
  const snap = useInstrumentSnapshot()
  const program = spec.id === 'program-oled'
  const lines = program
    ? [
        'PIANO  basic voice',
        AUDIO_LABEL[snap.audio.phase] ?? 'AUDIO',
        `VOICES ${pad(snap.voices)}/${snap.maxVoices}  SUST ${snap.sustain ? 'ON' : 'OFF'}`,
        'Programs: not yet',
      ]
    : ['Not active yet', 'Panel is decorative', 'No synth audio']
  return (
    <div
      id={spec.id}
      className={`oled oled--${program ? 'program' : 'synth'}`}
      role="status"
      aria-live="off"
      aria-label={program ? 'Program OLED: live piano status' : 'Synth OLED: inactive in this phase'}
      data-oled={program ? 'program' : 'synth'}
      data-section={spec.section}
      style={box(spec.x, spec.y, spec.w, spec.h, false)}
    >
      <div className="ol-title">{program ? 'NORD STAGE 4 73' : 'SYNTH'}</div>
      {lines.map((l, i) => (
        <div key={i} className="ol-line">
          {l}
        </div>
      ))}
    </div>
  )
}
