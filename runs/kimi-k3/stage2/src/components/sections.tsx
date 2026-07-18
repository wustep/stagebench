import { CONTROL_BY_ID } from '../hardware/controls'
import { ControlView } from './controls'
import { useEngine } from '../state/app-context'
import { useHardwareState } from '../state/hardware-store'
import { PIANO_TYPES } from '../audio/piano-models'

function C({ id }: { id: string }) {
  const def = CONTROL_BY_ID.get(id)
  if (!def) throw new Error(`Unknown control ${id}`)
  return <ControlView def={def} />
}

function SectionLabel({ text }: { text: string }) {
  return <div className="section-label" aria-hidden="true">{text}</div>
}

export function PerformanceSection() {
  return (
    <section className="deck-section section-performance" data-section="performance" aria-label="Performance controls">
      <div className="brand">
        <span className="brand-stage">STAGE 4</span>
        <span className="brand-nord">NORD</span>
      </div>
      <div className="perf-wheels">
        <C id="perf.pitchStick" />
        <C id="perf.modWheel" />
      </div>
      <div className="perf-master">
        <C id="perf.masterLevel" />
      </div>
      <div className="perf-slogan" aria-hidden="true">73 · HAMMER ACTION</div>
    </section>
  )
}

export function OrganSection() {
  return (
    <section className="deck-section inset section-organ" data-section="organ" aria-label="Organ section">
      <SectionLabel text="ORGAN" />
      <div className="organ-top">
        <div className="organ-models">
          <span className="group-label">MODEL</span>
          <C id="organ.model" />
          <span className="organ-model-names" aria-hidden="true">B3 · B3 BAS · VOX · FARF · PIPE1 · PIPE2</span>
        </div>
        <div className="organ-rotary">
          <span className="group-label">ROTARY</span>
          <C id="organ.rotarySpeed" />
          <C id="organ.rotaryDrive" />
        </div>
        <div className="organ-perc">
          <span className="group-label">VIB/CHORUS · PERCUSSION</span>
          <div className="organ-btn-row">
            <C id="organ.vibratoChorus" />
            <C id="organ.vibratoChorusOn" />
            <C id="organ.percussionOn" />
            <C id="organ.percussionDecay" />
            <C id="organ.percussionHarmonic" />
            <C id="organ.percussionSoft" />
          </div>
        </div>
      </div>
      <div className="organ-drawbars">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <C key={n} id={`organ.drawbar.${n}`} />
        ))}
      </div>
      <div className="organ-bottom">
        <C id="organ.panelASelect" />
        <C id="organ.panelBSelect" />
        <C id="organ.sustainPedal" />
        <C id="organ.pitchStick" />
        <C id="organ.level" />
      </div>
    </section>
  )
}

export function PianoSection() {
  return (
    <section className="deck-section inset section-piano" data-section="piano" aria-label="Piano section">
      <SectionLabel text="PIANO" />
      <div className="piano-row">
        <C id="piano.on" />
        <C id="piano.layerA" />
        <C id="piano.layerB" />
        <C id="piano.level" />
        <C id="piano.octaveShift" />
      </div>
      <div className="piano-row">
        <C id="piano.type" />
        <C id="piano.modelSelect" />
      </div>
      <div className="piano-row piano-toggles">
        <C id="piano.kbTouch" />
        <C id="piano.dynComp" />
        <C id="piano.timbre" />
        <C id="piano.unison" />
        <C id="piano.softRelease" />
        <C id="piano.stringRes" />
        <C id="piano.sustainPedal" />
        <C id="piano.pitchStick" />
      </div>
    </section>
  )
}

export function ProgramSection() {
  const engine = useEngine()
  useHardwareState()
  const focus = engine.getFocusedLayer()
  const layer = engine.layers[focus]
  const type = PIANO_TYPES.find((t) => t.id === layer.type)
  const failed = engine.isTypeFailed(layer.type)
  return (
    <section className="deck-section section-program" data-section="program" aria-label="Program and morph section">
      <SectionLabel text="PROGRAM" />
      <div className="oled oled-program" role="status" aria-label="Program display">
        <span className="oled-line">1:1</span>
        <span className="oled-line" data-oled="piano-model">
          Piano {focus === 'pianoA' ? 'A' : 'B'}: {type?.model ?? layer.type}
        </span>
        {failed ? (
          <span className="oled-line oled-warn" data-oled="piano-fallback">
            {type?.label} samples failed — synthesized fallback
          </span>
        ) : (
          <span className="oled-line oled-dim">— programs: phase 3 —</span>
        )}
      </div>
      <div className="program-grid">
        <div className="program-pages">
          <C id="program.pageLeft" />
          <C id="program.pageRight" />
        </div>
        <div className="program-buttons">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <C key={n} id={`program.button.${n}`} />
          ))}
        </div>
        <div className="program-dial">
          <C id="program.dial" />
        </div>
      </div>
      <div className="program-row">
        <C id="program.liveMode" />
        <C id="program.layerScene" />
        <C id="program.store" />
        <C id="program.split" />
      </div>
      <div className="program-row">
        <C id="program.panelASelect" />
        <C id="program.panelBSelect" />
        <C id="program.kbHold" />
        <C id="program.transpose" />
      </div>
      <div className="program-row morph-row">
        <span className="group-label">MORPH ASSIGN</span>
        <C id="program.morphWheel" />
        <C id="program.morphAftertouch" />
        <C id="program.morphCtrlPedal" />
        <C id="program.panic" />
        <C id="program.shift" />
      </div>
    </section>
  )
}

export function SynthSection() {
  return (
    <section className="deck-section inset section-synth" data-section="synth" aria-label="Synth section">
      <SectionLabel text="SYNTH" />
      <div className="synth-main">
        <div className="synth-left">
          <div className="synth-row">
            <C id="synth.on" />
            <C id="synth.layerA" />
            <C id="synth.layerB" />
            <C id="synth.level" />
            <C id="synth.octaveShift" />
          </div>
          <div className="oled oled-synth" role="status" aria-label="Synth display">
            <span className="oled-line">OSC</span>
            <span className="oled-line oled-dim">— decorative —</span>
          </div>
          <div className="synth-row">
            <C id="synth.sustainPedal" />
            <C id="synth.pitchStick" />
          </div>
        </div>
        <div className="synth-groups">
          <div className="synth-group">
            <span className="group-label">OSCILLATOR</span>
            <div className="synth-knobs">
              <C id="synth.oscWave" />
              <C id="synth.oscShape" />
              <C id="synth.oscCoarse" />
              <C id="synth.oscFine" />
              <C id="synth.oscMix" />
              <C id="synth.oscSync" />
            </div>
          </div>
          <div className="synth-group">
            <span className="group-label">FILTER</span>
            <div className="synth-knobs">
              <C id="synth.filterType" />
              <C id="synth.filterCutoff" />
              <C id="synth.filterResonance" />
              <C id="synth.filterEnvAmount" />
              <C id="synth.filterKbTrack" />
              <C id="synth.filterDrive" />
            </div>
          </div>
          <div className="synth-group">
            <span className="group-label">AMP ENV · MOD ENV</span>
            <div className="synth-knobs">
              <C id="synth.ampAttack" />
              <C id="synth.ampDecay" />
              <C id="synth.ampSustain" />
              <C id="synth.ampRelease" />
              <C id="synth.modAttack" />
              <C id="synth.modDecay" />
              <C id="synth.modSustain" />
              <C id="synth.modRelease" />
            </div>
          </div>
          <div className="synth-group">
            <span className="group-label">LFO · ARP</span>
            <div className="synth-knobs">
              <C id="synth.lfoWave" />
              <C id="synth.lfoRate" />
              <C id="synth.lfoAmount" />
              <C id="synth.arpOn" />
              <C id="synth.arpRate" />
              <C id="synth.arpPattern" />
              <C id="synth.unison" />
              <C id="synth.glide" />
              <C id="synth.glideRate" />
              <C id="synth.vibrato" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function EffectsSection() {
  return (
    <section className="deck-section inset section-effects" data-section="effects" aria-label="Layer effects section">
      <SectionLabel text="LAYER EFFECTS" />
      <div className="fx-focus">
        <C id="fx.on" />
        <C id="fx.focusA" />
        <C id="fx.focusB" />
        <C id="fx.groupPiano" />
      </div>
      <div className="fx-groups">
        <div className="fx-group">
          <span className="group-label">EFFECT 1</span>
          <C id="fx.effect1Type" />
          <C id="fx.effect1Rate" />
          <C id="fx.effect1Amount" />
          <C id="fx.effect1On" />
        </div>
        <div className="fx-group">
          <span className="group-label">EFFECT 2</span>
          <C id="fx.effect2Type" />
          <C id="fx.effect2Rate" />
          <C id="fx.effect2Amount" />
          <C id="fx.effect2On" />
        </div>
        <div className="fx-group">
          <span className="group-label">AMP / EQ</span>
          <C id="fx.ampType" />
          <C id="fx.ampDrive" />
          <C id="fx.ampOn" />
          <C id="fx.eqBassGain" />
          <C id="fx.eqMidGain" />
          <C id="fx.eqTrebleGain" />
        </div>
        <div className="fx-group">
          <span className="group-label">DELAY</span>
          <C id="fx.delayRate" />
          <C id="fx.delayFeedback" />
          <C id="fx.delayMix" />
          <C id="fx.delayOn" />
          <C id="fx.delayTempo" />
          <C id="fx.delayPingPong" />
          <C id="fx.delayFilter" />
          <C id="fx.delayGlobal" />
        </div>
        <div className="fx-group">
          <span className="group-label">COMP</span>
          <C id="fx.compAmount" />
          <C id="fx.compOn" />
          <C id="fx.compFast" />
          <C id="fx.compGlobal" />
        </div>
        <div className="fx-group">
          <span className="group-label">REVERB</span>
          <C id="fx.reverbAmount" />
          <C id="fx.reverbType" />
          <C id="fx.reverbOn" />
          <C id="fx.reverbBright" />
          <C id="fx.reverbGlobal" />
        </div>
        <div className="fx-group">
          <span className="group-label">ROTARY</span>
          <C id="fx.rotaryOn" />
          <C id="fx.rotarySpeed" />
          <C id="fx.rotaryDrive" />
        </div>
      </div>
    </section>
  )
}
