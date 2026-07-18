import { CONTROL_BY_ID } from '../hardware/controls'
import { ControlView } from './controls'
import { useEngine, useEngineVersion } from '../state/app-context'
import { useHardwareState } from '../state/hardware-store'
import { PIANO_TYPES } from '../audio/piano-models'
import { ORGAN_MODELS } from '../state/organ-state'
import { SYNTH_WAVES, FILTER_TYPES, LFO_WAVES, LFO_DESTS, SYNC_DIVISIONS } from '../state/synth-state'
import { SPLIT_POSITIONS, SPLIT_POINT_IDS, activeSplitMidis, zoneCount, CROSSFADE_WIDTHS } from '../state/program-state'
import { isUnsupportedControl, UNSUPPORTED_CONTROLS, getStoreState, getSplitEditPoint } from '../state/panel-bindings'
import { kbZoneAssign } from '../state/panel-bindings'
import { KEYS } from '../hardware/keys'

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
        <C id="perf.ctrlPedal" />
      </div>
      <div className="perf-master">
        <C id="perf.masterLevel" />
      </div>
      <div className="perf-slogan" aria-hidden="true">73 · HAMMER ACTION</div>
    </section>
  )
}

export function OrganSection() {
  const engine = useEngine()
  useEngineVersion()
  useHardwareState()
  const o = engine.organ
  const focus = o.layers[o.focusLayer]
  return (
    <section className="deck-section inset section-organ" data-section="organ" aria-label="Organ section">
      <SectionLabel text="ORGAN" />
      <div className="organ-top">
        <div className="organ-models">
          <span className="group-label">MODEL</span>
          <C id="organ.on" />
          <C id="organ.model" />
          <span className="organ-model-names" aria-hidden="true" data-oled="organ-model">
            {o.focusLayer}: {ORGAN_MODELS[focus.model]}
          </span>
        </div>
        <div className="organ-rotary">
          <span className="group-label">ROTARY</span>
          <C id="organ.rotaryRoute" />
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
        <C id="organ.layerA" />
        <C id="organ.layerB" />
        <C id="organ.octaveShift" />
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

/** Program OLED: position, name, dirty E, store flow, list view, split edit. */
function ProgramOled() {
  const engine = useEngine()
  useEngineVersion()
  useHardwareState()
  const focus = engine.getFocusedLayer()
  const layer = engine.layers[focus]
  const type = PIANO_TYPES.find((t) => t.id === layer.type)
  const failed = engine.isTypeFailed(layer.type)
  const store = getStoreState()
  const dirty = engine.isDirty()
  const label = engine.getProgramLabel()
  const splitEdit = getSplitEditPoint()

  if (engine.listView) {
    // Numeric list of all 32 programs (Shift + Program dial).
    return (
      <div className="oled oled-program" role="status" aria-label="Program display" data-oled-mode="list">
        <span className="oled-line oled-title">PROGRAMS</span>
        <div className="oled-list">
          {Array.from({ length: 32 }, (_, i) => {
            const p = engine.bank.get(i)
            const pos = `${Math.floor(i / 8) + 1}.${(i % 8) + 1}`
            return (
              <span key={i} className={`oled-list-item ${engine.currentSlot === i && !engine.liveMode ? 'oled-current' : ''}`}>
                {pos} {p.name}
              </span>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="oled oled-program" role="status" aria-label="Program display">
      <span className="oled-line oled-title" data-oled="program-position">
        {label} {engine.currentName}
        {dirty ? ' E' : ''}
      </span>
      {store.armed ? (
        <span className="oled-line oled-warn" data-oled="store-flow">
          {store.armed === 'storeAs' ? `STORE AS: ${store.name}▮` : `STORE → ${store.dest !== null ? `${Math.floor(store.dest / 8) + 1}.${(store.dest % 8) + 1}` : label}`} (STORE=ok · SHIFT=cancel)
        </span>
      ) : splitEdit ? (
        <span className="oled-line" data-oled="split-edit">
          SPLIT {splitEdit}: {SPLIT_POSITIONS[engine.split.points[splitEdit].position]} xfade {CROSSFADE_WIDTHS[engine.split.points[splitEdit].xfade] === 0 ? 'Off' : `±${CROSSFADE_WIDTHS[engine.split.points[splitEdit].xfade]}`}
        </span>
      ) : (
        <span className="oled-line" data-oled="piano-model">
          Piano {focus === 'pianoA' ? 'A' : 'B'}: {type?.model ?? layer.type}
        </span>
      )}
      <span className="oled-line oled-dim" data-oled="clock-line">
        {engine.clock.bpm} BPM{engine.clock.kbSync ? ' KB SYNC' : ''} · TR {engine.transpose > 0 ? `+${engine.transpose}` : engine.transpose} · {engine.scene === 'II' ? 'SCENE II' : 'SCENE I'}
      </span>
      {failed ? (
        <span className="oled-line oled-warn" data-oled="piano-fallback">
          {type?.label} samples failed — synthesized fallback
        </span>
      ) : null}
    </div>
  )
}

export function ProgramSection() {
  return (
    <section className="deck-section section-program" data-section="program" aria-label="Program and morph section">
      <SectionLabel text="PROGRAM" />
      <ProgramOled />
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
        <C id="program.mstClock" />
      </div>
      <div className="program-row">
        <C id="program.split" />
        <C id="program.splitLow" />
        <C id="program.splitMid" />
        <C id="program.splitHigh" />
        <C id="program.kbZone" />
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

/** Synth OLED: focused layer's waveform, filter, envelopes, arp/clock values. */
function SynthOled() {
  const engine = useEngine()
  useEngineVersion()
  useHardwareState()
  const s = engine.synth
  const layer = s.layers[s.focusLayer]
  const unsupported = Object.keys(UNSUPPORTED_CONTROLS).filter((id) => id.startsWith('synth.') && isUnsupportedControl(id))
  return (
    <div className="oled oled-synth" role="status" aria-label="Synth display">
      <span className="oled-line oled-title" data-oled="synth-wave">
        {s.focusLayer} · {SYNTH_WAVES[layer.oscWave]} · OSC CTRL {(layer.oscCtrl / 12.7).toFixed(1)}
      </span>
      <span className="oled-line" data-oled="synth-filter">
        {FILTER_TYPES[layer.filterType]} F{layer.filterFreq} R{layer.filterRes} · ENV A {(layer.ampEnv.attack / 12.7).toFixed(1)} D {(layer.ampEnv.decay / 12.7).toFixed(1)} R {(layer.ampEnv.release / 12.7).toFixed(1)}
      </span>
      <span className="oled-line oled-dim" data-oled="synth-lfo">
        LFO {LFO_WAVES[layer.lfoWave]} → {LFO_DESTS[layer.lfoDest]}
        {layer.lfoSync ? ` ${SYNC_DIVISIONS[Math.round(layer.lfoRate) % SYNC_DIVISIONS.length]}` : ''} · ARP {layer.arpRun ? 'RUN' : '—'}
        {layer.arpSync ? ` ${SYNC_DIVISIONS[Math.round(layer.arpRate) % SYNC_DIVISIONS.length]}` : ''}
      </span>
      {unsupported.length > 0 ? (
        <span className="oled-line oled-dim" data-oled="synth-unsupported">
          unsupported: {unsupported.map((id) => id.split('.')[1]).join(', ')}
        </span>
      ) : null}
    </div>
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
            <C id="synth.layerC" />
            <C id="synth.level" />
            <C id="synth.octaveShift" />
          </div>
          <SynthOled />
          <div className="synth-row">
            <C id="synth.sustainPedal" />
            <C id="synth.pitchStick" />
            <C id="synth.voiceMode" />
            <C id="synth.priority" />
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
              <C id="synth.envToPitch" />
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
              <C id="synth.ampRelease" />
              <C id="synth.modAttack" />
              <C id="synth.modDecay" />
              <C id="synth.modRelease" />
            </div>
          </div>
          <div className="synth-group">
            <span className="group-label">LFO · ARP</span>
            <div className="synth-knobs">
              <C id="synth.lfoWave" />
              <C id="synth.lfoDest" />
              <C id="synth.lfoRate" />
              <C id="synth.lfoAmount" />
              <C id="synth.arpMode" />
              <C id="synth.arpOn" />
              <C id="synth.arpRate" />
              <C id="synth.arpPattern" />
              <C id="synth.arpRange" />
              <C id="synth.arpHold" />
              <C id="synth.unison" />
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
          <C id="fx.eqMidFreq" />
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

/** Split-point LEDs and zone keys above the keybed (manual p. 39). */
export function SplitStrip() {
  const engine = useEngine()
  useEngineVersion()
  useHardwareState()
  const split = engine.split
  const edges = activeSplitMidis(split)
  const zones = zoneCount(split)
  return (
    <div className="split-strip" aria-label="Split points and keyboard zones" data-split-strip>
      <div className="split-leds">
        {SPLIT_POINT_IDS.map((id) => {
          const p = split.points[id]
          return (
            <span
              key={id}
              className={`split-led ${split.on && p.enabled ? 'led-on' : ''}`}
              data-split-led={id}
              title={`${id}: ${SPLIT_POSITIONS[p.position]}`}
            >
              {SPLIT_POSITIONS[p.position]}
            </span>
          )
        })}
      </div>
      <div className="zone-keys" role="group" aria-label="Zone select">
        {Array.from({ length: 4 }, (_, z) => {
          const active = split.on && z < zones
          return (
            <button
              key={z}
              type="button"
              className={`zone-key ${active ? 'zone-active' : ''}`}
              data-zone-key={z}
              aria-label={`Zone ${z + 1}${active ? ` (${z === 0 ? `E1–${edgeName(edges[0])}` : z === zones - 1 ? `${edgeName(edges[z - 1])}–E7` : `${edgeName(edges[z - 1])}–${edgeName(edges[z])}`})` : ' (unused)'}`}
              aria-pressed={active}
              disabled={!split.on}
              onClick={() => kbZoneAssign(engine, z)}
            >
              Z{z + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function edgeName(midi: number | undefined): string {
  if (midi === undefined) return '—'
  const key = KEYS.find((k) => k.midi === midi)
  return key?.name ?? String(midi)
}
