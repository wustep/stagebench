import { CONTROL_BY_ID, type ControlDef } from '../model/controls'
import { useInstrument } from '../state/instrument-context'
import { Drawbar, Fader, Knob, LedButton, Oled, Stick, Wheel } from './widgets'

export function useCtrl(id: string): { def: ControlDef; value: number; onChange: (id: string, value: number) => void } {
  const { values, setControl } = useInstrument()
  const def = CONTROL_BY_ID[id]
  if (!def) throw new Error(`Unknown control ${id}`)
  return { def, value: values[id] ?? def.defaultValue, onChange: setControl }
}

export function Btn({ id }: { id: string }) {
  const ctrl = useCtrl(id)
  return <LedButton {...ctrl} />
}

export function Kn({ id, size }: { id: string; size?: 'sm' | 'md' | 'lg' }) {
  const ctrl = useCtrl(id)
  return <Knob {...ctrl} size={size} />
}

export function Fd({ id }: { id: string }) {
  const ctrl = useCtrl(id)
  return <Fader {...ctrl} />
}

export function Db({ id }: { id: string }) {
  const ctrl = useCtrl(id)
  return <Drawbar {...ctrl} />
}

export function PerformanceSection() {
  const master = useCtrl('perf-master-level')
  const stick = useCtrl('perf-pitch-stick')
  const wheel = useCtrl('perf-mod-wheel')
  return (
    <section className="section section-performance" data-section="performance" aria-label="Performance controls">
      <div className="perf-top">
        <Knob {...master} size="lg" />
      </div>
      <div className="brand" aria-hidden="true">
        <span className="brand-nord">nord</span>
        <span className="brand-stage">STAGE 4</span>
      </div>
      <div className="perf-wheels">
        <Stick {...stick} />
        <Wheel {...wheel} />
      </div>
    </section>
  )
}

export function OrganSection() {
  return (
    <section className="section section-organ inset" data-section="organ" aria-label="Organ">
      <div className="section-head">ORGAN</div>
      <div className="layer-row">
        <Btn id="organ-on" />
        <Btn id="organ-layer-a-enable" />
        <Btn id="organ-layer-a-focus" />
        <Fd id="organ-layer-a-level" />
        <Btn id="organ-layer-b-enable" />
        <Btn id="organ-layer-b-focus" />
        <Fd id="organ-layer-b-level" />
        <Btn id="organ-oct-down" />
        <Btn id="organ-oct-up" />
      </div>
      <div className="drawbar-bank">
        <Db id="organ-drawbar-16" />
        <Db id="organ-drawbar-513" />
        <Db id="organ-drawbar-8" />
        <Db id="organ-drawbar-4" />
        <Db id="organ-drawbar-223" />
        <Db id="organ-drawbar-2" />
        <Db id="organ-drawbar-135" />
        <Db id="organ-drawbar-113" />
        <Db id="organ-drawbar-1" />
      </div>
      <div className="organ-lower">
        <div className="btn-col">
          <Btn id="organ-model-b3" />
          <Btn id="organ-model-vox" />
          <Btn id="organ-model-farfisa" />
          <Btn id="organ-model-pipe1" />
          <Btn id="organ-model-pipe2" />
        </div>
        <div className="btn-col">
          <Btn id="organ-preset-1" />
          <Btn id="organ-preset-2" />
          <Btn id="organ-vibrato-on" />
          <Kn id="organ-vibrato-type" size="sm" />
        </div>
        <div className="btn-col">
          <Btn id="organ-perc-on" />
          <Btn id="organ-perc-volume" />
          <Btn id="organ-perc-decay" />
          <Btn id="organ-perc-harmonic" />
        </div>
        <div className="btn-col">
          <Btn id="organ-rotary-stop" />
          <Btn id="organ-rotary-fast" />
          <Kn id="organ-rotary-drive" size="sm" />
          <Btn id="organ-sustped" />
          <Btn id="organ-pstick" />
        </div>
      </div>
    </section>
  )
}

export function PianoSection() {
  return (
    <section className="section section-piano inset" data-section="piano" aria-label="Piano">
      <div className="section-head">PIANO</div>
      <div className="layer-row compact">
        <Btn id="piano-on" />
        <Btn id="piano-layer-a-enable" />
        <Btn id="piano-layer-a-focus" />
        <Fd id="piano-layer-a-level" />
        <Btn id="piano-layer-b-enable" />
        <Btn id="piano-layer-b-focus" />
        <Fd id="piano-layer-b-level" />
      </div>
      <div className="type-leds">
        <Btn id="piano-type" />
        <Btn id="piano-type-grand" />
        <Btn id="piano-type-upright" />
        <Btn id="piano-type-electric" />
        <Btn id="piano-type-clav" />
        <Btn id="piano-type-digital" />
        <Btn id="piano-type-misc" />
      </div>
      <Kn id="piano-model" size="md" />
      <div className="knob-row">
        <Kn id="piano-kb-touch" size="sm" />
        <Kn id="piano-dyn-comp" size="sm" />
        <Kn id="piano-timbre" size="sm" />
        <Kn id="piano-unison" size="sm" />
      </div>
      <div className="btn-row">
        <Btn id="piano-oct-down" />
        <Btn id="piano-oct-up" />
        <Btn id="piano-soft-release" />
        <Btn id="piano-string-res" />
        <Btn id="piano-sustped" />
        <Btn id="piano-pstick" />
      </div>
    </section>
  )
}

export function ProgramSection() {
  const oled = useCtrl('program-oled')
  const dial = useCtrl('program-dial')
  return (
    <section className="section section-program" data-section="program" aria-label="Program and morph">
      <div className="section-head">PROGRAM</div>
      <Oled def={oled.def} lines={['— — —', 'decorative']} />
      <div className="program-dial-row">
        <Knob {...dial} size="lg" />
        <div className="btn-col">
          <Btn id="program-page-down" />
          <Btn id="program-page-up" />
          <Btn id="program-shift" />
          <Btn id="program-exit" />
        </div>
      </div>
      <div className="program-pads">
        <Btn id="program-1" />
        <Btn id="program-2" />
        <Btn id="program-3" />
        <Btn id="program-4" />
        <Btn id="program-5" />
        <Btn id="program-6" />
        <Btn id="program-7" />
        <Btn id="program-8" />
      </div>
      <div className="btn-row wrap">
        <Btn id="program-live-mode" />
        <Btn id="program-layer-scene" />
        <Btn id="program-store" />
        <Btn id="program-split" />
        <Btn id="program-morph-wheel" />
        <Btn id="program-morph-at" />
        <Btn id="program-morph-pedal" />
      </div>
    </section>
  )
}

export function SynthSection() {
  const oled = useCtrl('synth-oled')
  return (
    <section className="section section-synth inset" data-section="synth" aria-label="Synth">
      <div className="section-head">SYNTH</div>
      <div className="synth-top">
        <Oled def={oled.def} lines={['OSC idle', 'decorative']} />
        <div className="synth-layers">
          <Btn id="synth-on" />
          <div className="layer-mini">
            <Btn id="synth-layer-a-enable" />
            <Btn id="synth-layer-a-focus" />
            <Fd id="synth-layer-a-level" />
          </div>
          <div className="layer-mini">
            <Btn id="synth-layer-b-enable" />
            <Btn id="synth-layer-b-focus" />
            <Fd id="synth-layer-b-level" />
          </div>
          <div className="layer-mini">
            <Btn id="synth-layer-c-enable" />
            <Btn id="synth-layer-c-focus" />
            <Fd id="synth-layer-c-level" />
          </div>
          <Btn id="synth-oct-down" />
          <Btn id="synth-oct-up" />
        </div>
      </div>
      <div className="synth-groups">
        <fieldset className="group">
          <legend>OSC</legend>
          <Kn id="synth-osc-wave" size="sm" />
          <Kn id="synth-osc-shape" size="sm" />
          <Kn id="synth-osc-detune" size="sm" />
          <Kn id="synth-osc-semi" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>FILTER</legend>
          <Btn id="synth-filter-type" />
          <Kn id="synth-filter-freq" size="sm" />
          <Kn id="synth-filter-res" size="sm" />
          <Kn id="synth-filter-drive" size="sm" />
          <Kn id="synth-filter-kb" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>AMP ENV</legend>
          <Kn id="synth-env-attack" size="sm" />
          <Kn id="synth-env-decay" size="sm" />
          <Kn id="synth-env-sustain" size="sm" />
          <Kn id="synth-env-release" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>MOD / LFO</legend>
          <Kn id="synth-mod-attack" size="sm" />
          <Kn id="synth-mod-decay" size="sm" />
          <Kn id="synth-mod-amount" size="sm" />
          <Kn id="synth-lfo-rate" size="sm" />
          <Kn id="synth-lfo-amount" size="sm" />
          <Btn id="synth-lfo-wave" />
          <Btn id="synth-arp-on" />
        </fieldset>
        <fieldset className="group">
          <legend>VOICE</legend>
          <Kn id="synth-glide" size="sm" />
          <Kn id="synth-unison" size="sm" />
          <Kn id="synth-vibrato" size="sm" />
          <Btn id="synth-sustped" />
          <Btn id="synth-pstick" />
        </fieldset>
      </div>
    </section>
  )
}

export function EffectsSection() {
  return (
    <section className="section section-effects inset" data-section="effects" aria-label="Layer effects">
      <div className="section-head">LAYER FX</div>
      <div className="btn-row">
        <Btn id="fx-focus-a" />
        <Btn id="fx-focus-b" />
        <Btn id="fx-focus-c" />
      </div>
      <div className="fx-grid">
        <fieldset className="group">
          <legend>FX1</legend>
          <Btn id="fx1-on" />
          <Btn id="fx1-type" />
          <Kn id="fx1-rate" size="sm" />
          <Kn id="fx1-amount" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>FX2</legend>
          <Btn id="fx2-on" />
          <Btn id="fx2-type" />
          <Kn id="fx2-rate" size="sm" />
          <Kn id="fx2-amount" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>AMP / EQ</legend>
          <Btn id="amp-on" />
          <Kn id="amp-drive" size="sm" />
          <Kn id="amp-bass" size="sm" />
          <Kn id="amp-mid" size="sm" />
          <Kn id="amp-treble" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>COMP</legend>
          <Btn id="comp-on" />
          <Kn id="comp-amount" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>DELAY</legend>
          <Btn id="delay-on" />
          <Kn id="delay-tempo" size="sm" />
          <Kn id="delay-feedback" size="sm" />
          <Kn id="delay-mix" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>REVERB</legend>
          <Btn id="reverb-on" />
          <Btn id="reverb-type" />
          <Kn id="reverb-mix" size="sm" />
        </fieldset>
        <fieldset className="group">
          <legend>ROTARY</legend>
          <Btn id="rotary-on" />
          <Kn id="rotary-speed" size="sm" />
          <Kn id="rotary-drive-fx" size="sm" />
        </fieldset>
      </div>
    </section>
  )
}
