import { useSyncExternalStore, type ReactNode } from 'react'
import { DRAWBAR_FOOTAGES, DRAWBAR_LEGENDS, DRAWBAR_REGISTERS, PROGRAM_BUTTON_LEGENDS } from '../model/hardware'
import { SECTIONS } from '../model/variant'
import type { PresentationStore } from '../state/presentation'
import { usePresentationMorphRange, usePresentationToggle, usePresentationValue } from '../state/presentation'
import {
  mappings,
  organModelLabel,
  programLabel,
  splitBoundaries,
  SPLIT_POINT_NAMES,
  SPLIT_POSITION_NAMES,
  SPLIT_POSITIONS,
  SYNTH_FILTER_TYPES,
  SYNTH_WAVEFORMS,
  timbreListFor,
  useInstrumentState,
  type InstrumentState,
  type InstrumentStore,
  type SectionKey,
} from '../state/instrument'
import { PRESET_BANKS } from '../model/presets'
import { instrumentsOfType, SYNTH_SAMPLE_SETS } from '../audio/library'
import type { EngineStatusInfo, PianoEngine } from '../audio/engine'
import {
  Drawbar,
  Encoder,
  Fader,
  GroupBox,
  Knob,
  Led,
  LedLadder,
  Legend,
  Oled,
  PanelButton,
  PitchStick,
  Wheel,
} from './controls'

interface SectionProps {
  store: PresentationStore
}

interface BoundSectionProps extends SectionProps {
  instrument: InstrumentStore
  /** Opens the section-zoom overlay for this section (narrow-legend-legibility). */
  onZoom?: () => void
}

function useEngineInfo(engine: PianoEngine): EngineStatusInfo {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getStatus(),
  )
}

/** KB ZONE LED row: available zones from the split, lit for the focused layer's range. */
function ZoneLeds({ state, section }: { state: InstrumentState; section: SectionKey }) {
  const zoneCount = splitBoundaries(state.split).length + 1
  const zone =
    section === 'piano'
      ? state.layers[state.focusedLayer].zone
      : section === 'synth'
        ? state.synth.layers[state.synth.focusedLayer].zone
        : state.organ.layers[state.organ.focusedLayer].zone
  const from = Math.min(zone.from, zoneCount - 1)
  const to = Math.min(zone.to, zoneCount - 1)
  return (
    <span className="kb-zone" aria-hidden="true">
      <Legend>◂ KB ZONE ▸</Legend>
      <span className="zone-leds">
        {[0, 1, 2, 3].map((i) => (
          <Led key={i} color="green" on={i < zoneCount && i >= from && i <= to} />
        ))}
      </span>
    </span>
  )
}

function SectionShell({ id, children }: { id: string; children: ReactNode }) {
  const spec = SECTIONS.find((s) => s.id === id)!
  return (
    <section
      className={`deck-section ${spec.insetPlate ? 'has-plate' : 'exposed-red'}`}
      data-section={spec.id}
      style={{ width: `${spec.fraction * 100}%` }}
      aria-label={spec.label}
    >
      {children}
    </section>
  )
}

function SectionHeader({
  title,
  store,
  onId,
  fxFocusLit = false,
  onZoom,
  onSoloHold,
}: {
  title: string
  store: PresentationStore
  onId: string
  fxFocusLit?: boolean
  /** Opens the section-zoom overlay (narrow-viewport legend legibility). */
  onZoom?: () => void
  /** Holding the ON button ~half a second performs SOLO (manual p. 18); a
   *  quick click keeps the normal on/off toggle. Shift + click is the
   *  keyboard-accessible equivalent, wired in presentation.ts's toggle(). */
  onSoloHold?: () => void
}) {
  return (
    <div className="plate-header">
      <PlateTitle title={title} onZoom={onZoom} subtitle="SECTION" />
      <span className="fx-focus">
        <Led color="yellow" on={fxFocusLit} />
        <Legend>FX FOCUS</Legend>
      </span>
      <span className="on-cluster">
        <Legend>ON</Legend>
        <PanelButton store={store} id={onId} className="pill" led="green" holdAction={onSoloHold} />
        <Legend className="dim">SOLO ▾</Legend>
      </span>
    </div>
  )
}

/** The plate-title area doubles as the section-inspect/zoom affordance
 *  (narrow-legend-legibility): always present and focusable, but primarily
 *  useful at narrow viewports where the panel legends render sub-pixel. */
function PlateTitle({ title, onZoom, subtitle }: { title: string; onZoom?: () => void; subtitle?: string }) {
  const inner = (
    <>
      {title}
      {subtitle && <span className="plate-subtitle">{subtitle}</span>}
    </>
  )
  if (!onZoom) return <span className="plate-title">{inner}</span>
  const titleCase = title.charAt(0) + title.slice(1).toLowerCase()
  return (
    <button type="button" className="plate-title plate-title-button" onClick={onZoom} aria-label={`Inspect ${titleCase} section`}>
      {inner}
    </button>
  )
}

function LayerFaderColumn({
  store,
  faderId,
  buttonId,
  letter,
  focused = false,
}: {
  store: PresentationStore
  faderId: string
  buttonId: string
  letter: string
  focused?: boolean
}) {
  const level = usePresentationValue(store, faderId)
  const range = usePresentationMorphRange(store, faderId, 9)
  const enabled = usePresentationToggle(store, buttonId)
  return (
    <div className="layer-column" data-focused={focused ? 'true' : undefined}>
      <div className="layer-fader-row">
        <LedLadder count={9} lit={Math.round((level / 127) * 9)} rangeLit={range ?? undefined} />
        <Fader store={store} id={faderId} />
      </div>
      <Legend className="layer-letter">
        <b>{letter}</b> AUX KB
      </Legend>
      {/* Reference: the ON/OFF legend lives on a light tab above the button
          (with the layer LED), and the tan-gray button cap itself is blank. */}
      <span className="onoff-tab" aria-hidden="true">
        <Led color="yellow" on={enabled} />
        <Legend>ON/OFF ▾</Legend>
      </span>
      <PanelButton store={store} id={buttonId} className="pill small blank" />
    </div>
  )
}

/* ---------------------------------------------------------- Performance -- */

export function PerformanceSection({ store, instrument }: BoundSectionProps) {
  const state = useInstrumentState(instrument)
  // The MORPH indicator lights while a morph source is assigned to the
  // rotary speed destination (the strip's only morphable parameter).
  const rotarySpeedMorphed = useSyncExternalStore(store.subscribe, () => store.morphTag('rotary-speed') !== null)
  const pianoRouted =
    !state.allFxOff &&
    (['A', 'B'] as const).some((layer) => state.chains[layer].ampEq.on && state.chains[layer].ampEq.type === 'To Rotary')
  const organRouted = state.organ.toRotary && state.organ.sectionOn
  const anyRouted = pianoRouted || organRouted
  return (
    <SectionShell id="performance">
      <div className="perf-layout">
        <div className="perf-main">
          <div className="perf-wheels">
            <div className="perf-wheel-slot stick-slot">
              <PitchStick store={store} id="perf-pitch-stick" />
            </div>
            <div className="perf-wheel-slot wheel-slot">
              <Wheel store={store} id="perf-mod-wheel" />
            </div>
          </div>
          <div className="branding" aria-hidden="true">
            <span className="brand-line">nord stage 4</span>
            <span className="brand-sub">HAMMER ACTION 73</span>
          </div>
        </div>
        <div className="perf-right">
          <div className="perf-master">
            <Legend>MASTER LEVEL</Legend>
            <Knob store={store} id="perf-master-level" className="large" scale="none" />
          </div>
          <div className="rotary-strip">
          <span className="rotary-title">
            ROTARY
            <br />
            SPEAKER
          </span>
          <span className="rotary-on">
            <Legend>ON</Legend>
            <Led color="red" on={anyRouted} />
          </span>
          <Knob store={store} id="rotary-drive" className="small" />
          <Legend>DRIVE</Legend>
          <span className="rotary-led-row">
            <Led color="yellow" on={state.organ.toRotary} />
            <Legend>ORGAN</Legend>
          </span>
          {/* Reference: blank tan cap with CLOSE MIC printed on the panel
              beneath it. The app has no close-mic state (manual p. 53's
              Shift+Organ close-mic variant is not modeled), so its LED stays
              truthfully unlit and the legend is a declared print. */}
          <PanelButton store={store} id="rotary-source" className="pill small blank" />
          <span className="rotary-led-row">
            <Led color="yellow" />
            <Legend className="dim">CLOSE MIC ▿</Legend>
          </span>
          <span className="rotary-led-row">
            <Led color="yellow" on={state.rotary.speed === 'stop'} />
            <Legend>STOP MODE</Legend>
          </span>
          <PanelButton store={store} id="rotary-stop-mode" className="dark small" />
          <Legend>ANGLE</Legend>
          <span className="rotary-led-row">
            <Led color="green" on={state.rotary.speed === 'slow'} />
            <Legend>SLOW</Legend>
            <Led color="red" on={state.rotary.speed === 'fast'} />
            <Legend>FAST</Legend>
          </span>
          <PanelButton store={store} id="rotary-speed" className="dark small" />
          {/* MORPH is an indicator LED, not a button (manual p. 53: an
              "active morph is indicated by the MORPH LED being lit"). */}
          <span className="rotary-led-row">
            <Led color="yellow" on={rotarySpeedMorphed} />
            <Legend>MORPH</Legend>
          </span>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/* ---------------------------------------------------------------- Organ -- */

function DrawbarColumn({ store, index, presetOn }: { store: PresentationStore; index: number; presetOn: boolean }) {
  const id = `organ-drawbar-${index + 1}`
  const value = usePresentationValue(store, id)
  const range = usePresentationMorphRange(store, id, 8)
  const color = [0, 1].includes(index) ? 'brown' : [2, 3, 5, 8].includes(index) ? 'white' : 'black'
  return (
    <div className="drawbar-column">
      <Legend className="drawbar-name">{DRAWBAR_LEGENDS[index]}</Legend>
      {/* Second printed register row (reference photo): footage/harmonic
          registers, blank under STR4, a sine-span glyph under the last. */}
      <Legend className="dim drawbar-register">{DRAWBAR_REGISTERS[index] || ' '}</Legend>
      <div className="drawbar-row">
        {/* Reference: each LED ladder sits in a light-outlined frame with the
            1-8 amount numerals printed beside the segments. In Drawbar Live
            mode "the drawbar LEDs are all unlit" (manual p. 19/21) — the
            frame and numerals stay printed, every LED goes dark (morph range
            included: morphs are not applicable in Drawbar Live, p. 39). */}
        <span className="drawbar-scale" aria-hidden="true">
          <span className="drawbar-scale-nums">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <i key={n}>{n}</i>
            ))}
          </span>
          <LedLadder count={8} lit={presetOn ? value : 0} color="red" fill="down" className="drawbar-ladder" rangeLit={(presetOn ? range : null) ?? undefined} />
        </span>
        <Drawbar store={store} id={id} className={`cap-${color}`} />
      </div>
      <Legend className="drawbar-footage">{DRAWBAR_FOOTAGES[index]}</Legend>
    </div>
  )
}

export function OrganSection({ store, instrument, onZoom }: BoundSectionProps) {
  const state = useInstrumentState(instrument)
  const organ = state.organ
  const focused = organ.layers[organ.focusedLayer]
  return (
    <SectionShell id="organ">
      <div className="plate">
        <SectionHeader
          title="ORGAN"
          store={store}
          onId="organ-on"
          fxFocusLit={state.fxSection === 'organ'}
          onZoom={onZoom}
          onSoloHold={() => instrument.soloSection('organ')}
        />
        <div className="organ-body">
          <div className="levels-column">
            <div className="layer-pair">
              <LayerFaderColumn
                store={store}
                faderId="organ-level-a"
                buttonId="organ-layer-a"
                letter="A"
                focused={organ.focusedLayer === 'A'}
              />
              <LayerFaderColumn
                store={store}
                faderId="organ-level-b"
                buttonId="organ-layer-b"
                letter="B"
                focused={organ.focusedLayer === 'B'}
              />
            </div>
            <span className="tiny-led-row">
              {/* SUSTPED lights RED on the reference photo. */}
              <Led color="red" on={organ.sustped} />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" on={organ.pstick} />
              <Legend>PSTICK</Legend>
            </span>
            {/* PRESET (manual p. 21): lit while the focused layer sounds its
                stored registration; dark = Drawbar Live (physical pose).
                SYNC ▿ = Shift + Preset copies the pose into the Program. */}
            <span className="tiny-led-row">
              <Led color="green" on={focused.presetOn} />
              <Legend>PRESET</Legend>
            </span>
            <PanelButton store={store} id="organ-preset" className="dark small" />
            <Legend className="dim">SYNC ▿</Legend>
            <span className="octave-row">
              <Legend>◂ OCTAVE SHIFT ▸</Legend>
              <span className="octave-buttons">
                <PanelButton store={store} id="organ-octave-down" className="dark tiny" />
                <PanelButton store={store} id="organ-octave-up" className="dark tiny" />
              </span>
            </span>
            <ZoneLeds state={state} section="organ" />
          </div>
          <div className="organ-main">
            <div className="organ-groups">
              <GroupBox title="Organ Model" className="organ-model">
                <div className="model-led-grid" aria-hidden="true">
                  <span>
                    <Legend>FARF</Legend>
                    <Led color="red" on={focused.model === 'Farf'} />
                    <Led color="red" on={focused.model === 'Pipe1'} />
                    <Legend>PIPE1</Legend>
                  </span>
                  <span>
                    <Legend>VOX</Legend>
                    <Led color="red" on={focused.model === 'Vox'} />
                    <Led color="red" on={focused.model === 'Pipe2'} />
                    <Legend>PIPE2</Legend>
                  </span>
                  <span>
                    <Legend>B3</Legend>
                    <Led color="red" on={focused.model === 'B3'} />
                    <Led color="red" on={focused.model === 'B3Bass'} />
                    <Legend>B3 BASS</Legend>
                  </span>
                </div>
                <PanelButton store={store} id="organ-model" className="dark small" />
              </GroupBox>
              <GroupBox title="Vib/Chorus" className="organ-vib">
                {/* Reference layout: selector button LEFT of a 2x3 LED matrix
                    labeled C2 V3 C3 over V2 C1 V1 (each LED lights for its
                    exact scanner position). */}
                <div className="vib-select-row">
                  <PanelButton store={store} id="organ-vib-select" className="dark small" />
                  <div className="vib-matrix" aria-hidden="true">
                    <span className="vib-matrix-row">
                      {(['C2', 'V3', 'C3'] as const).map((pos) => (
                        <span key={pos} className="vib-cell">
                          <Legend>{pos}</Legend>
                          <Led color="red" on={organ.vibratoType === pos} className="led-tri-up" />
                        </span>
                      ))}
                    </span>
                    <span className="vib-matrix-row">
                      {(['V2', 'C1', 'V1'] as const).map((pos) => (
                        <span key={pos} className="vib-cell">
                          <Led color="red" on={organ.vibratoType === pos} className="led-tri-down" />
                          <Legend>{pos}</Legend>
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
                <span className="perc-on">
                  <Led color="green" on={focused.vibrato} />
                  <Legend>ON</Legend>
                  <PanelButton store={store} id="organ-vib-on" className="pill small" led="green" />
                </span>
              </GroupBox>
              <GroupBox title="B3 Percussion" className="organ-perc">
                {/* Reference: a round LED left of each SOFT/FAST/THIRD print,
                    lit from the canonical percussion state. */}
                <div className="perc-grid">
                  <span className="perc-cell">
                    <Legend>VOLUME</Legend>
                    <span className="tiny-led-row">
                      <Led color="red" on={organ.percussion.soft} />
                      <Legend>SOFT</Legend>
                    </span>
                    <PanelButton store={store} id="organ-perc-volume" className="dark tiny" />
                  </span>
                  <span className="perc-cell">
                    <Legend>DECAY</Legend>
                    <span className="tiny-led-row">
                      <Led color="red" on={organ.percussion.fast} />
                      <Legend>FAST</Legend>
                    </span>
                    <PanelButton store={store} id="organ-perc-decay" className="dark tiny" />
                  </span>
                  <span className="perc-cell">
                    <Legend>HARMONIC</Legend>
                    <span className="tiny-led-row">
                      <Led color="red" on={organ.percussion.third} />
                      <Legend>THIRD</Legend>
                    </span>
                    <PanelButton store={store} id="organ-perc-harmonic" className="dark tiny" />
                  </span>
                </div>
                <span className="perc-on">
                  <Led color="yellow" on={organ.percussion.poly} />
                  <Legend className="dim">POLY ▿</Legend>
                  <Legend>ON</Legend>
                  <PanelButton store={store} id="organ-perc-on" className="pill small" led="green" />
                </span>
              </GroupBox>
            </div>
            <div className="drawbar-bank" role="group" aria-label="Drawbars">
              {DRAWBAR_FOOTAGES.map((_, i) => (
                <DrawbarColumn key={i} store={store} index={i} presetOn={focused.presetOn} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/* ---------------------------------------------------------------- Piano -- */

export function PianoSection({ store, instrument, engine, onZoom }: BoundSectionProps & { engine: PianoEngine }) {
  const state = useInstrumentState(instrument)
  useEngineInfo(engine) // re-render on load-status changes for the SUSTPED/selection feedback
  const focused = state.layers[state.focusedLayer]
  const timbreList = timbreListFor(focused.type)
  const timbre = timbreList[Math.min(state.piano.timbre, timbreList.length - 1)]!
  // Missing-model state (spec: selection.missingModelState): the type LED
  // flashes when the selected type has no model or its samples failed to load.
  const focusedModel = instrumentsOfType(focused.type)[focused.model]
  const loadFailed = focusedModel ? engine.instrumentLoadStatus(focusedModel.id) === 'error' : false
  const flashType = state.pianoNotFound ?? (loadFailed ? focused.type : null)
  return (
    <SectionShell id="piano">
      <div className="plate">
        <SectionHeader
          title="PIANO"
          store={store}
          onId="piano-on"
          fxFocusLit={state.fxSection === 'piano'}
          onZoom={onZoom}
          onSoloHold={() => instrument.soloSection('piano')}
        />
        <div className="piano-body">
          <div className="levels-column">
            <div className="layer-pair">
              <LayerFaderColumn
                store={store}
                faderId="piano-level-a"
                buttonId="piano-layer-a"
                letter="A"
                focused={state.focusedLayer === 'A' || state.fxGroupPiano}
              />
              <LayerFaderColumn
                store={store}
                faderId="piano-level-b"
                buttonId="piano-layer-b"
                letter="B"
                focused={state.focusedLayer === 'B' || state.fxGroupPiano}
              />
            </div>
            <span className="tiny-led-row">
              {/* SUSTPED lights RED on the reference photo. */}
              <Led color="red" on={state.piano.sustped} />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" on={state.piano.pstick} />
              <Legend>PSTICK</Legend>
            </span>
            {/* Reference: TIMBRE is a tall dark rocker LEFT of the printed
                label column — no enclosing box on the panel. */}
            <div className="timbre-cluster" role="group" aria-label="Timbre">
              <PanelButton store={store} id="piano-timbre" className="rocker timbre-rocker" />
              <div className="timbre-leds" aria-hidden="true">
                <Legend className="timbre-title">TIMBRE</Legend>
                <span>
                  <Legend>BRIGHT</Legend>
                  <Led color="red" on={timbre === 'Bright'} />
                </span>
                <span>
                  <Legend>MID</Legend>
                  <Led color="red" on={timbre === 'Mid' || timbre === 'Dyno 1'} />
                  <Legend className="dim">DYNO1</Legend>
                </span>
                <span>
                  <Legend>SOFT</Legend>
                  <Led color="red" on={timbre === 'Soft' || timbre === 'Dyno 2'} />
                  <Legend className="dim">DYNO2</Legend>
                </span>
              </div>
            </div>
            <span className="octave-row">
              <Legend>◂ OCTAVE SHIFT ▸</Legend>
              <span className="octave-buttons">
                <PanelButton store={store} id="piano-octave-down" className="dark tiny" />
                <PanelButton store={store} id="piano-octave-up" className="dark tiny" />
              </span>
            </span>
            <ZoneLeds state={state} section="piano" />
          </div>
          <div className="piano-main">
            <div className="piano-groups">
              <span className="acoustics-cell">
                <Legend className="group-label">ACOUSTICS</Legend>
                <span className="tiny-led-row">
                  <Led color="red" on={state.piano.softRelease} />
                  <Legend>SOFT REL</Legend>
                </span>
                <span className="tiny-led-row">
                  <Led color="red" on={state.piano.stringRes} />
                  <Legend>STRING RES</Legend>
                </span>
                <PanelButton store={store} id="piano-acoustics" className="dark small" />
                <span className="tiny-led-row">
                  <Led color="red" on={state.piano.pedNoise} />
                  <Legend>PED NOISE ▿</Legend>
                </span>
              </span>
              <span className="acoustics-cell">
                <Legend className="group-label">UNISON</Legend>
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>2</Legend>
                  <Led color="red" on={state.piano.unison >= 2} />
                  <Legend>3</Legend>
                </span>
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>1</Legend>
                  <Led color="red" on={state.piano.unison === 1 || state.piano.unison === 3} />
                </span>
                <PanelButton store={store} id="piano-unison" className="dark small" />
              </span>
              <span className="acoustics-cell">
                <Legend className="group-label">KB TOUCH</Legend>
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>MED</Legend>
                  <Led color="red" on={state.piano.kbTouch === 1 || state.piano.kbTouch === 2} />
                  <Legend>LIGHT</Legend>
                </span>
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>HEAVY</Legend>
                  <Led color="red" on={state.piano.kbTouch === 0 || state.piano.kbTouch === 2} />
                </span>
                <PanelButton store={store} id="piano-kb-touch" className="dark small" />
              </span>
              <span className="acoustics-cell">
                <Legend className="group-label">DYN COMP</Legend>
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>2</Legend>
                  <Led color="red" on={state.piano.dynComp >= 2} />
                  <Legend>3</Legend>
                </span>
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>1</Legend>
                  <Led color="red" on={state.piano.dynComp === 1 || state.piano.dynComp === 3} />
                </span>
                <PanelButton store={store} id="piano-dyn-comp" className="dark small" />
              </span>
            </div>
            <GroupBox title="Piano Select" className="piano-select">
              <div className="type-led-grid" aria-hidden="true">
                <span>
                  <Legend>ELECTRIC</Legend>
                  <Led color="red" on={focused.type === 'Electric'} className={flashType === 'Electric' ? 'flash' : ''} />
                  <Led color="red" on={focused.type === 'Clav'} className={flashType === 'Clav' ? 'flash' : ''} />
                  <Legend>CLAV</Legend>
                </span>
                <span>
                  <Legend>UPRIGHT</Legend>
                  <Led color="red" on={focused.type === 'Upright'} className={flashType === 'Upright' ? 'flash' : ''} />
                  <Led color="red" on={focused.type === 'Digital'} className={flashType === 'Digital' ? 'flash' : ''} />
                  <Legend>DIGITAL</Legend>
                </span>
                <span>
                  <Legend>GRAND</Legend>
                  <Led color="red" on={focused.type === 'Grand'} className={flashType === 'Grand' ? 'flash' : ''} />
                  <Led color="red" on={focused.type === 'Misc'} className={flashType === 'Misc' ? 'flash' : ''} />
                  <Legend>MISC</Legend>
                </span>
              </div>
              {/* One physical button (reference photo): INFO is its printed
                  Shift pairing (manual p. 25, Shift + Piano Select). */}
              <PanelButton store={store} id="piano-type" className="dark small" />
              <Legend className="dim">INFO</Legend>
              <div className="model-dial">
                <Encoder store={store} id="piano-model" />
                <Legend>
                  MODEL <b className="list-tag">LIST</b>
                </Legend>
              </div>
            </GroupBox>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/* -------------------------------------------------------------- Program -- */

export function ProgramSection({ store, instrument, engine }: BoundSectionProps & { engine: PianoEngine }) {
  const state = useInstrumentState(instrument)
  const engineInfo = useEngineInfo(engine)
  const focused = state.layers[state.focusedLayer]
  const models = instrumentsOfType(focused.type)
  const model = models[focused.model]
  const loadStatus = model ? engine.instrumentLoadStatus(model.id) : undefined
  // PRESET NAME (Shift + Prog View, manual p. 42): the layer lines show the
  // underlying sound source. Declared adaptation: with no preset library in
  // scope, the "sound name" IS the source, so the toggle switches to the
  // fully-qualified source form (piano type/model, synth waveform/sample set).
  const presetNameOn = state.programs.presetName
  const pianoLine = state.pianoNotFound
    ? `Piano not found (${state.pianoNotFound})`
    : model
      ? `${state.focusedLayer}: ${presetNameOn ? `${focused.type} / ` : ''}${model.name}${loadStatus === 'loading' ? ' — loading…' : loadStatus === 'error' ? ' — FALLBACK' : ''}`
      : `${state.focusedLayer}: —`
  const statusLine =
    engineInfo.status === 'fallback'
      ? 'FALLBACK (synth voice)'
      : engineInfo.status === 'error'
        ? 'AUDIO ERROR'
        : engineInfo.status === 'loading'
          ? 'Loading samples…'
          : ''

  const programs = state.programs
  const activeBank = programs.liveMode ? programs.live : programs.bank
  const reference = programs.storePending ? programs.storePending.destination : programs.current
  const currentSlot = activeBank[programs.current]!
  const naming = programs.naming
  // Num Pad entry pending (manual p. 44): the readout shows the page digit
  // and a dash until the slot digit arrives, e.g. "1–".
  const programReadout =
    programs.numPadPending !== null
      ? `${programs.numPadPending}–`
      : `${programLabel(programs.current, programs.liveMode)}${programs.dirty ? ' E' : ''}${
          programs.storePending ? ` ▸ STORE ${programLabel(reference, programs.liveMode)}?` : ''
        }`
  // PROG VIEW mode 1 (manual p. 42): large name/number only.
  const xl = programs.progView === 1 ? ' xl' : ''
  const nameLine = naming ? (
    <b className="oled-name" data-testid="oled-name-line">
      {naming.name
        .padEnd(naming.cursor + 1, ' ')
        .split('')
        .map((char, i) => (i === naming.cursor ? <u key={i}>{char}</u> : <span key={i}>{char}</span>))}
    </b>
  ) : (
    <b className={`oled-name${xl}`} data-testid="oled-name-line">
      {programs.storePending ? programs.storePending.captured.name : currentSlot.name}
    </b>
  )
  const chainForFocused = state.fxSection === 'organ' ? state.organChain : state.chains[state.focusedLayer]
  const clockRows = state.clockEdit
    ? [
        <span key="ck1" className="oled-slot" data-testid="oled-clock-line">
          ♩ MST CLK {state.masterClock.bpm} BPM — DELAY {chainForFocused.delay.mstClk ? '●' : '○'} · MOD1{' '}
          {chainForFocused.mod1.mstClk ? '●' : '○'}
        </span>,
        <span key="ck2" className="oled-slot">
          dial: BPM · TAP: 4+ taps · PROG 1/2: sync
        </span>,
      ]
    : null
  const transposeRows = state.transposeEdit
    ? [
        <span key="tr1" className="oled-slot" data-testid="oled-transpose-line">
          ± TRANSPOSE {state.transpose.on ? 'ON' : 'OFF'} {state.transpose.semitones >= 0 ? '+' : ''}
          {state.transpose.semitones} st
        </span>,
        <span key="tr2" className="oled-slot">
          dial: −6…+6 · TRANSP: on/off
        </span>,
      ]
    : null
  const splitEdit = state.splitEdit
  const splitRows = splitEdit
    ? (() => {
        const point = state.split.points[splitEdit.point]
        const positionIndex = SPLIT_POSITIONS.indexOf(point.note)
        return [
          <span key="se1" className="oled-slot" data-testid="oled-split-line">
            ⇅ SPLIT {state.split.on ? 'ON' : 'OFF'} — {SPLIT_POINT_NAMES[splitEdit.point]} {point.active ? '●' : '○'}{' '}
            {SPLIT_POSITION_NAMES[positionIndex] ?? '—'} · XF {point.xf === 0 ? 'Off' : `±${point.xf}`}
          </span>,
          <span key="se2" className="oled-slot">
            dial: position · PAGE: point · PROG 1/2: on/xfade
          </span>,
        ]
      })()
    : null
  // PRESET LIBRARY browse (manual p. 41-42): the section name, the list rows
  // around the focused preset, and the manual's "E" coupling on the focused
  // row until the dial first loads it. PROGRAM 1 is the Cancel soft button
  // (of the manual's Num/Cat/Cancel row, only Cancel is implemented). Organ
  // presets never browse single-layer (manual p. 41 note).
  const browse = state.presetBrowse
  const presetRows = browse
    ? (() => {
        const bank = PRESET_BANKS[browse.section]
        const count = bank.length
        const presetStart = Math.max(0, Math.min(browse.index - 1, count - 2))
        const focusedPresetLayer = browse.section === 'piano' ? state.focusedLayer : state.synth.focusedLayer
        return [
          <span key="pb" className="oled-slot" data-testid="oled-preset-line">
            ♪ {browse.section.toUpperCase()} PRESET{browse.singleLayer ? ` — LAYER ${focusedPresetLayer}` : ''} · PROG 1:
            Cancel · SHIFT: keep
          </span>,
          ...[presetStart, presetStart + 1].map((i) => (
            <span key={i} className="oled-slot" data-testid={`oled-preset-list-${i}`}>
              {i === browse.index ? '▸' : ' '} {i + 1}/{count} {bank[i]!.name}
              {i === browse.index && !browse.loaded ? ' E' : ''}
            </span>
          )),
        ]
      })()
    : null
  // LAYER INIT screen (Shift + Section Edit, manual p. 43): PROGRAM 1-4 act
  // as the four soft buttons; Pno/Syn name the focused layer they reset.
  const layerInitRows = state.layerInitEdit
    ? [
        <span key="li1" className="oled-slot" data-testid="oled-layer-init-line">
          ⌂ LAYER INIT — 1 All · 2 Org AB · 3 Pno {state.focusedLayer} · 4 Syn {state.synth.focusedLayer}
        </span>,
        <span key="li2" className="oled-slot">
          PROG 1-4: soft buttons · SHIFT: exit
        </span>,
      ]
    : null
  const listStart = Math.max(0, Math.min(reference - 1, activeBank.length - 2))
  const listRows = [listStart, listStart + 1].map((i) => (
    <span key={i} className="oled-slot" data-testid={`oled-list-${i}`}>
      {i === reference ? '▸' : ' '} {programLabel(i, programs.liveMode)} {activeBank[i]!.name}
    </span>
  ))
  // Model list view (Shift + Piano Model dial, spec.scope.optional): shows
  // every bundled model for the focused layer's type, same list-row shape as
  // the program numeric list view above.
  const modelListRows = state.modelListView
    ? models.map((m, i) => (
        <span key={m.id} className="oled-slot" data-testid={`oled-model-list-${i}`}>
          {i === focused.model ? '▸' : ' '} {focused.type} / {m.name}
        </span>
      ))
    : null
  // PROG VIEW mode 2 (manual p. 42): the complete program configuration —
  // every layer's on/off plus its sound name, all read from canonical state.
  // PRESET NAME switches each name to its fully-qualified source form.
  const layerMark = (on: boolean) => (on ? '●' : '○')
  const pianoLayerName = (id: 'A' | 'B') => {
    const layer = state.layers[id]
    const m = instrumentsOfType(layer.type)[layer.model]
    return m ? `${presetNameOn ? `${layer.type}/` : ''}${m.name}` : '—'
  }
  const synthLayerName = (id: 'A' | 'B' | 'C') => {
    const layer = state.synth.layers[id]
    if (layer.mode === 'Samples') {
      const set = SYNTH_SAMPLE_SETS[Math.min(layer.waveform, SYNTH_SAMPLE_SETS.length - 1)] ?? SYNTH_SAMPLE_SETS[0]!
      return `${presetNameOn ? 'Smp/' : ''}${set.name}`
    }
    const wave = SYNTH_WAVEFORMS[layer.waveform] ?? SYNTH_WAVEFORMS[0]!
    return `${presetNameOn ? 'Wave/' : ''}${wave.name}`
  }
  const configRows =
    programs.progView === 2
      ? [
          <span key="cfg-p" className="oled-slot" data-testid="oled-config-piano">
            Pno A{layerMark(state.layers.A.enabled)} {pianoLayerName('A')} · B{layerMark(state.layers.B.enabled)} {pianoLayerName('B')}
          </span>,
          <span key="cfg-o" className="oled-slot" data-testid="oled-config-organ">
            Org A{layerMark(state.organ.layers.A.enabled)} {organModelLabel(state.organ.layers.A.model)} · B
            {layerMark(state.organ.layers.B.enabled)} {organModelLabel(state.organ.layers.B.model)}
          </span>,
          <span key="cfg-s" className="oled-slot" data-testid="oled-config-synth">
            Syn A{layerMark(state.synth.layers.A.enabled)} {synthLayerName('A')} · B{layerMark(state.synth.layers.B.enabled)}{' '}
            {synthLayerName('B')} · C{layerMark(state.synth.layers.C.enabled)} {synthLayerName('C')}
          </span>,
        ]
      : null
  // PROG VIEW mode 3 (manual p. 42): the current page's eight programs as
  // list rows (same row markup as the numeric list view), current one marked.
  const pageStart = Math.floor(reference / 8) * 8
  const pageRows =
    programs.progView === 3
      ? Array.from({ length: 8 }, (_, i) => pageStart + i).map((i) => (
          <span key={i} className="oled-slot" data-testid={`oled-page-list-${i}`}>
            {i === reference ? '▸' : ' '} {programLabel(i, programs.liveMode)} {activeBank[i]!.name}
          </span>
        ))
      : null
  return (
    <SectionShell id="program">
      <div className="program-layout">
        <div className="program-top-row">
          <GroupBox title="Morph Assign" className="morph-box">
            {/* Printed LED + label row above the blank caps (reference); each
                LED lights truthfully from the same morph-arming latch its
                button toggles (A.T. is spec-excluded, so its LED stays dark). */}
            <span className="morph-legend-row" aria-hidden="true">
              <span className="tiny-led-row">
                <Led color="green" on={state.morphArming === 'wheel'} />
                <Legend>WHEEL ⇟</Legend>
              </span>
              <span className="tiny-led-row">
                <Led color="green" />
                <Legend>A.T. ⇟</Legend>
              </span>
              <span className="tiny-led-row">
                <Led color="green" on={state.morphArming === 'pedal'} />
                <Legend>CTRLPED ⇟</Legend>
              </span>
            </span>
            <div className="morph-buttons">
              <PanelButton store={store} id="morph-wheel" className="dark tiny" />
              <PanelButton store={store} id="morph-at" className="dark tiny" />
              <PanelButton store={store} id="morph-ctrlped" className="dark tiny" />
            </div>
            <Legend className="legend-rule">CLEAR MORPH</Legend>
          </GroupBox>
          <GroupBox title="Split" className="split-box">
            {/* One LED per split point — split.points[0..2] = Low/Mid/High
                (manual p. 39); a LED lights while the split is on and that
                point is active. */}
            <span className="split-leds" aria-hidden="true">
              {state.split.points.map((point, i) => (
                <Led key={i} color="yellow" on={state.split.on && point.active} />
              ))}
            </span>
            <Legend>ON/SET ▽</Legend>
            <PanelButton store={store} id="split-onset" className="dark tiny" />
            <Legend className="dim">SET KEY</Legend>
          </GroupBox>
          <GroupBox title="Mst Clk" className="clk-box">
            {/* TAP/SET LED lights while the Mst Clk edit view is latched on
                the OLED (our latched dial-edit convention). */}
            <span className="tiny-led-row">
              <Led color="green" on={state.clockEdit} />
              <Legend>TAP/SET ▽</Legend>
            </span>
            <PanelButton store={store} id="mstclk-tap" className="dark tiny" />
            {/* No pedal-tap input is implemented, so this LED never lights. */}
            <span className="tiny-led-row">
              <Led color="green" />
              <Legend className="dim">PEDAL TAP</Legend>
            </span>
          </GroupBox>
          <GroupBox title="Transp" className="transp-box">
            <span className="tiny-led-row">
              <Led color="yellow" on={state.transpose.on} />
              <Legend>ON/SET ▽</Legend>
            </span>
            <PanelButton store={store} id="transpose-onset" className="dark tiny" />
            {/* Declared deviation: on the reference PANIC is the Shift print
                under the single ON/SET button; we keep a separate functional
                panic button, blank its cap, and print PANIC beneath it. */}
            <PanelButton store={store} id="panic" className="dark tiny" />
            <Legend className="dim">PANIC</Legend>
          </GroupBox>
        </div>
        <div className="program-mid">
          <div className="program-mid-left">
            <span className="store-cluster">
              <span className="store-main">
                <span className="tiny-led-row">
                  <Led color="red" on={!!programs.storePending} className={programs.storePending ? 'flash' : ''} />
                  <Legend>STORE</Legend>
                </span>
                {/* ONE red button — STORE AS… is Shift + Store (manual
                    p. 41); the STORE AS… / PAGE NAME lines are panel print. */}
                <PanelButton store={store} id="store" className="red small" />
                <Legend>STORE AS…</Legend>
                <Legend className="dim">PAGE NAME</Legend>
              </span>
              {/* Printed MIDI / EXTERN indicators beside Store (reference). */}
              <span className="store-side" aria-hidden="true">
                <span className="tiny-led-row">
                  <Led color="green" />
                  <Legend>MIDI</Legend>
                </span>
                <span className="tiny-led-row">
                  <Led color="red" />
                  <Legend>EXTERN</Legend>
                </span>
              </span>
            </span>
            <div className="program-dial-block">
              <Encoder store={store} id="program-dial" className="large" />
              <Legend>
                PROGRAM <b className="list-tag">LIST</b>
              </Legend>
            </div>
            <div className="page-block">
              <Legend>◂ PAGE/CAT ▸</Legend>
              <span className="page-buttons">
                <PanelButton store={store} id="page-left" className="dark tiny">
                  ◂
                </PanelButton>
                <PanelButton store={store} id="page-right" className="dark tiny">
                  ▸
                </PanelButton>
              </span>
              <Legend className="dim">◂ BANK ▸</Legend>
            </div>
            <div className="mode-block">
              <span className="mode-cell">
                <span className="tiny-led-row">
                  <Led color="red" on={programs.liveMode} />
                  <Legend>LIVE MODE</Legend>
                </span>
                <PanelButton store={store} id="live-mode" className="pill small" />
                {/* NUM PAD = Shift + Live Mode (manual p. 44): the LED lights
                    while two-digit page.slot entry is active. */}
                <span className="tiny-led-row">
                  <Led color="red" on={programs.numPad} />
                  <Legend className="dim">NUM PAD</Legend>
                </span>
              </span>
              {/* Reference: LAYER SCENE II sits in its own outlined box. */}
              <span className="mode-cell rail-box scene-box">
                <span className="tiny-led-row">
                  <Led color="green" on={state.scenes.active === 'II'} />
                  <Legend>LAYER SCENE II</Legend>
                </span>
                <PanelButton store={store} id="layer-scene" className="dark tiny" />
                {/* No scene-pedal input is implemented; the LED never lights. */}
                <span className="tiny-led-row">
                  <Led color="green" />
                  <Legend className="dim">PEDAL</Legend>
                </span>
              </span>
            </div>
          </div>
          <div className="program-center">
            <GroupBox title="Preset Library" className="preset-box">
              {/* Each section's LED lights while its bank is being browsed
                  (manual p. 41). */}
              <span className="preset-legend-row" aria-hidden="true">
                <span className="tiny-led-row">
                  <Led color="green" on={browse?.section === 'organ'} />
                  <Legend>ORGAN</Legend>
                </span>
                <span className="tiny-led-row">
                  <Led color="green" on={browse?.section === 'piano'} />
                  <Legend>PIANO</Legend>
                </span>
                <span className="tiny-led-row">
                  <Led color="green" on={browse?.section === 'synth'} />
                  <Legend>SYNTH</Legend>
                </span>
              </span>
              <div className="preset-buttons">
                <PanelButton store={store} id="preset-organ" className="dark tiny" />
                <PanelButton store={store} id="preset-piano" className="dark tiny" />
                <PanelButton store={store} id="preset-synth" className="dark tiny" />
              </div>
              <Legend className="legend-rule">SINGLE LAYER</Legend>
            </GroupBox>
            <div className="display-block">
            <Oled
              section="program"
              lines={[
                <span key="p" className={`oled-program${xl}`} data-testid="oled-program-line">{programReadout}</span>,
                <span key="n">{nameLine}</span>,
                ...(presetRows ??
                  layerInitRows ??
                  splitRows ??
                  clockRows ??
                  transposeRows ??
                  modelListRows ??
                  (programs.listView
                    ? listRows
                    : configRows ??
                      pageRows ??
                      (programs.progView === 1
                        ? [] // PROG VIEW mode 1: large name/number only
                        : [
                          <span key="piano" className="oled-slot" data-testid="oled-piano-line">
                            ▤ {pianoLine}
                          </span>,
                          <span key="status" className="oled-slot" data-testid="oled-status-line">
                            {statusLine || '〜 Piano · FX ready'}
                          </span>,
                        ]))),
                <span key="edit" className="oled-slot oled-edit" data-testid="oled-edit-line">
                  {state.lastEdit || '◫ —'}
                </span>,
              ]}
            />
            {/* Display bezel tick marks under the OLED (reference). */}
            <span className="oled-ticks" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            </div>
            <GroupBox title="Program" className="program-grid-box">
              <div className="program-grid">
                {PROGRAM_BUTTON_LEGENDS.map((legend, i) => (
                  <span key={legend} className="program-cell">
                    <span className="prog-num" aria-hidden="true">
                      <Led
                        color="red"
                        on={reference % 8 === i}
                        className={programs.storePending && reference % 8 === i ? 'flash' : ''}
                      />
                      {i + 1}
                    </span>
                    <PanelButton store={store} id={`program-${i + 1}`} className="dark tiny" />
                    <Legend className="dim">{legend.toUpperCase()}</Legend>
                  </span>
                ))}
              </div>
            </GroupBox>
          </div>
          {/* Right utility rail (reference photo): Prog View down to the
              Program section's own Shift/Exit at the keybed edge. */}
          <div className="program-rail">
            <span className="rail-cell">
              <Legend>PROG VIEW</Legend>
              <PanelButton store={store} id="prog-view" className="dark tiny" />
              <Legend className="dim">PRESET NAME</Legend>
            </span>
            {/* Reference: SOLO through PASTE share one outlined box; the SOLO
                LED truthfully lights while a discarded edit is recoverable
                (the button performs the single-level SOLO UNDO). */}
            <span className="rail-box">
              <span className="rail-cell">
                <span className="tiny-led-row">
                  <Led color="yellow" on={programs.undo !== null} />
                  <Legend>SOLO</Legend>
                </span>
                <PanelButton store={store} id="solo-undo" className="dark tiny" />
                <Legend className="dim">UNDO</Legend>
              </span>
              <span className="rail-cell">
                <Legend>SECTION EDIT ⇕</Legend>
                <PanelButton store={store} id="section-edit" className="dark tiny" />
                {/* LAYER INIT = Shift + Section Edit (manual p. 43). The
                    printed ▽ shift-legend below the cap is itself clickable
                    and opens the same init screen (the panel's hold-to-shift
                    convention, manual p. 44). */}
                <button
                  type="button"
                  className="legend-button"
                  aria-label="Layer Init"
                  onClick={() => instrument.setLayerInitEdit(!state.layerInitEdit)}
                >
                  <Legend className="dim">LAYER INIT ▽</Legend>
                </button>
              </span>
              <span className="rail-cell">
                {/* Lit while the Mon/Copy or Paste latch is on (manual
                    p. 43) — the tiny-led-row convention for latched modes
                    on push buttons. */}
                <span className="tiny-led-row">
                  <Led color="yellow" on={state.monCopy !== null} className="mon-copy-led" />
                  <Legend>MON/COPY</Legend>
                </span>
                <PanelButton store={store} id="mon-copy" className="dark tiny" />
                {/* PASTE = Shift + Mon/Copy (manual p. 43). The printed ⇕
                    shift-legend below the cap is itself clickable and
                    latches Paste mode directly (the panel's hold-to-shift
                    convention, manual p. 44). */}
                <button
                  type="button"
                  className="legend-button"
                  aria-label="Paste"
                  onClick={() => instrument.setMonCopyMode(state.monCopy === 'paste' ? null : 'paste')}
                >
                  <Legend className="dim">PASTE ⇕</Legend>
                </button>
              </span>
            </span>
            <span className="shift-cluster">
              <Legend>SHIFT</Legend>
              <PanelButton store={store} id="shift" className="rocker" />
              <Legend className="dim">EXIT</Legend>
            </span>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/* ---------------------------------------------------------------- Synth -- */

export function SynthSection({ store, instrument, onZoom }: BoundSectionProps) {
  const state = useInstrumentState(instrument)
  const synth = state.synth
  const focused = synth.layers[synth.focusedLayer]
  const isSamplesMode = focused.mode === 'Samples'
  const wave = SYNTH_WAVEFORMS[focused.waveform] ?? SYNTH_WAVEFORMS[0]!
  // Samples mode reuses the `waveform` index field, clamped to the 2-item
  // SYNTH_SAMPLE_SETS list (spec.scope.optional Samples mode): the OLED WAVE
  // list shows sample-set names instead of the Analog waveform list.
  const sampleSet = SYNTH_SAMPLE_SETS[Math.min(focused.waveform, SYNTH_SAMPLE_SETS.length - 1)] ?? SYNTH_SAMPLE_SETS[0]!
  const displayName = isSamplesMode ? sampleSet.name : wave.name
  const envelope = focused.ampEnvelope
  const filter = focused.filter
  const oscEnvelope = focused.oscEnvelope
  const lfo = focused.lfo
  // The three OLED dials edit whichever envelope's A/D/R is currently
  // latched (manual p. 27: one shared dial trio for every menu).
  const editedEnvelope =
    state.synthEnvEdit === 'amp'
      ? { label: 'AMP ENVELOPE', ...envelope }
      : state.synthEnvEdit === 'filter'
        ? { label: 'FILTER ENVELOPE', ...filter.envelope }
        : state.synthEnvEdit === 'osc'
          ? { label: 'OSC ENVELOPE', ...oscEnvelope }
          : null
  return (
    <SectionShell id="synth">
      <div className="plate">
        <SectionHeader title="SYNTH" store={store} onId="synth-on" onZoom={onZoom} onSoloHold={() => instrument.soloSection('synth')} />
        <div className="synth-body">
          <div className="levels-column">
            <div className="layer-pair triple">
              <LayerFaderColumn
                store={store}
                faderId="synth-level-a"
                buttonId="synth-layer-a"
                letter="A"
                focused={synth.focusedLayer === 'A'}
              />
              <LayerFaderColumn
                store={store}
                faderId="synth-level-b"
                buttonId="synth-layer-b"
                letter="B"
                focused={synth.focusedLayer === 'B'}
              />
              <LayerFaderColumn
                store={store}
                faderId="synth-level-c"
                buttonId="synth-layer-c"
                letter="C"
                focused={synth.focusedLayer === 'C'}
              />
            </div>
            <span className="tiny-led-row">
              {/* SUSTPED lights RED on the reference photo. */}
              <Led color="red" on={synth.sustped} />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" on={synth.pstick} />
              <Legend>PSTICK/RNG ▿</Legend>
            </span>
            <span className="hold-row">
              <span className="hold-cell">
                <span className="tiny-led-row" aria-hidden="true">
                  <Led color="red" on={state.kbHold} />
                  <Legend>KB HOLD</Legend>
                </span>
                <PanelButton store={store} id="kb-hold" className="dark tiny" />
                <Legend className="dim">EXCLUDE ▿</Legend>
              </span>
              <span className="hold-cell">
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>ARP RUN</Legend>
                </span>
                <PanelButton store={store} id="arp-run" className="red tiny" />
                <Legend className={`dim ${synth.arp.mstClk ? 'lit' : ''}`}>◂ MST CLK</Legend>
              </span>
            </span>
            <span className="octave-row">
              <Legend>◂ OCTAVE SHIFT ▸</Legend>
              <span className="octave-buttons">
                <PanelButton store={store} id="synth-octave-down" className="dark tiny" />
                <PanelButton store={store} id="synth-octave-up" className="dark tiny" />
              </span>
            </span>
            <ZoneLeds state={state} section="synth" />
          </div>
          <div className="synth-main">
            <div className="synth-top">
              <div className="synth-display-block">
                <Oled
                  section="synth"
                  lines={
                    state.synthOscPitchEdit
                      ? [
                          <span key="t" className="oled-dim">
                            OSC PITCH
                          </span>,
                          <b key="w" className="oled-name" data-testid="oled-synth-name-line">
                            {displayName}
                          </b>,
                          <span key="op" data-testid="oled-synth-osc-pitch-line">
                            OSC PITCH {fmtSigned(focused.oscPitch.semis)} st · {fmtSigned(focused.oscPitch.cents)} c
                          </span>,
                          <span key="m" className="oled-menu">
                            <span>
                              {fmtSigned(focused.oscPitch.semis)} st <b>PITCH</b>
                            </span>
                            <span>
                              {fmtSigned(focused.oscPitch.cents)} c <b>FINE TUNE</b>
                            </span>
                            <span>
                              {synth.focusedLayer} <b>LAYER</b>
                            </span>
                          </span>,
                        ]
                      : state.synthVibratoEdit
                      ? [
                          <span key="t" className="oled-dim">
                            VIBRATO
                          </span>,
                          <b key="w" className="oled-name" data-testid="oled-synth-name-line">
                            {displayName}
                          </b>,
                          <span key="vib" data-testid="oled-synth-vibrato-line">
                            VIBRATO Rate {mappings.vibratoRateHz(focused.voice.vibratoRate).toFixed(1)} Hz · Amt{' '}
                            {mappings.vibratoAmountDisplay(focused.voice.vibratoAmount).toFixed(1)}
                          </span>,
                          <span key="m" className="oled-menu">
                            <span>
                              {mappings.vibratoRateHz(focused.voice.vibratoRate).toFixed(1)} Hz <b>RATE</b>
                            </span>
                            <span>
                              {mappings.vibratoAmountDisplay(focused.voice.vibratoAmount).toFixed(1)} <b>AMOUNT</b>
                            </span>
                            <span>
                              {synth.focusedLayer} <b>LAYER</b>
                            </span>
                          </span>,
                        ]
                      : editedEnvelope
                      ? [
                          <span key="t" className="oled-dim">
                            {editedEnvelope.label}
                          </span>,
                          <b key="w" className="oled-name" data-testid="oled-synth-name-line">
                            {displayName}
                          </b>,
                          <span key="adr" data-testid="oled-synth-envelope-line">
                            A {editedEnvelope.attack} · D {editedEnvelope.decay === 127 ? 'HOLD' : editedEnvelope.decay} · R{' '}
                            {editedEnvelope.release}
                          </span>,
                          <span key="m" className="oled-menu">
                            <span>
                              {editedEnvelope.attack} <b>ATTACK</b>
                            </span>
                            <span>
                              {editedEnvelope.decay === 127 ? 'HOLD' : editedEnvelope.decay} <b>DECAY</b>
                            </span>
                            <span>
                              {editedEnvelope.release} <b>RELEASE</b>
                            </span>
                          </span>,
                        ]
                      : [
                          <span key="t" className="oled-dim">
                            OSC WAVEFORM
                          </span>,
                          <b key="w" className="oled-name" data-testid="oled-synth-name-line">
                            {displayName}
                          </b>,
                          <span key="d" data-testid="oled-synth-ctrl-line">
                            OSC CTRL: {isSamplesMode ? '—' : (focused.oscCtrl / 12.7).toFixed(1)}
                          </span>,
                          <span key="m" className="oled-menu">
                            <span>
                              {isSamplesMode ? 'SAMPLES' : 'ANALOG'} <b>TYPE</b>
                            </span>
                            <span>
                              {isSamplesMode ? '—' : synthCategoryLabel(wave.category)} <b>CAT</b>
                            </span>
                            <span>
                              {synth.focusedLayer} <b>LAYER</b>
                            </span>
                          </span>,
                        ]
                  }
                />
                <div className="synth-dials">
                  <span className="synth-dial">
                    <Encoder store={store} id="synth-dial-1" className="small" />
                    <Legend className="dim">{editedEnvelope ? 'ATTACK' : 'INFO'}</Legend>
                  </span>
                  <span className="synth-dial">
                    <Encoder store={store} id="synth-dial-2" className="small" />
                    <Legend className="dim">{editedEnvelope ? 'DECAY' : 'WAVE'}</Legend>
                  </span>
                  <span className="synth-dial">
                    <Encoder store={store} id="synth-dial-3" className="small" />
                    <Legend className="dim">{editedEnvelope ? 'RELEASE' : 'LFO DEST'}</Legend>
                  </span>
                </div>
              </div>
              <div className="mode-column">
                <GroupBox title="Mode" className="mode-box">
                  {/* Reference order: SAMPLES, ANALOG, the selector button,
                      then EXTERN below it. */}
                  <span className="tiny-led-row">
                    <Led color="yellow" on={isSamplesMode} />
                    <Legend>SAMPLES</Legend>
                  </span>
                  <span className="tiny-led-row">
                    <Led color="red" on={!isSamplesMode} />
                    <Legend>ANALOG</Legend>
                  </span>
                  <PanelButton store={store} id="synth-mode" className="dark small" />
                  <span className="tiny-led-row">
                    <Led color="red" />
                    <Legend>EXTERN</Legend>
                  </span>
                </GroupBox>
                <span className="waveform-cluster">
                  {/* ONE red-framed button: WAVEFORM on press, SOUND INIT on
                      Shift + press (manual p. 37: "SOUND INIT (Shift+Waveform)"). */}
                  <Legend>WAVEFORM</Legend>
                  <Legend className="dim">KEEP EDITS ▿</Legend>
                  <PanelButton store={store} id="waveform-select" className="framed tiny" />
                  <Legend className="dim">SOUND INIT</Legend>
                </span>
              </div>
              <div className="arp-column">
                <GroupBox title="Arpeggiator/Gate" className="arp-box">
                  <div className="arp-row">
                    <span className="knob-cell">
                      <Knob store={store} id="arp-rate" className="small" />
                      <Legend>RATE/<wbr />TIME</Legend>
                      <Legend className={`dim red-tag ${synth.arp.mstClk ? 'lit' : ''}`}>◂ MST CLK</Legend>
                    </span>
                    <span className="arp-mode-cell">
                      <span className="tiny-led-row" aria-hidden="true">
                        <Legend>POLY</Legend>
                        <Led color="red" on={synth.arp.mode === 'Poly'} />
                      </span>
                      <span className="tiny-led-row" aria-hidden="true">
                        {/* The LED beside the GATE tag lights in Gate mode;
                            Arp is the unlit base mode (reference print). */}
                        <Legend>ARP</Legend>
                        <Led color="red" on={synth.arp.mode === 'Gate'} />
                        <Legend>GATE</Legend>
                      </span>
                      <PanelButton store={store} id="arp-mode" className="dark tiny" led="green" />
                      {/* PATTERN LED stays dark: arp patterns are not
                          implemented (Shift + this button cycles Direction
                          instead, printed on the readout below). */}
                      <span className="tiny-led-row" aria-hidden="true">
                        <Led color="red" />
                        <Legend className="dim">PATTERN ▿</Legend>
                      </span>
                      <Legend className="dim">{synth.arp.direction} ▿</Legend>
                    </span>
                    <span className="knob-cell">
                      <Knob store={store} id="arp-range" className="small" />
                      <Legend>{synth.arp.mode === 'Gate' ? 'HARDNESS' : 'RANGE'} ENV</Legend>
                    </span>
                    <span className="arp-mode-cell">
                      {/* LED binds to the menu latch when the Arp Menu
                          feature lands; dark until then. */}
                      <span className="tiny-led-row" aria-hidden="true">
                        <Led color="red" />
                        <Legend>MENU</Legend>
                      </span>
                      <PanelButton store={store} id="arp-menu" className="framed tiny" />
                      <Legend className="dim">GROUP ▿</Legend>
                    </span>
                  </div>
                </GroupBox>
                <div className="voice-vibrato-row">
                  <GroupBox title="Voice" className="voice-box">
                    {/* Reference: mode LEDs + button LEFT, the GLIDE knob
                        RIGHT — a wide, short box, not a tall stack. */}
                    <span className="voice-cols">
                      <span className="voice-mode-col">
                        <span className="tiny-led-row" aria-hidden="true">
                          <Led color="red" on={focused.voice.mode === 'Mono'} />
                          <Legend>MONO</Legend>
                        </span>
                        <span className="tiny-led-row" aria-hidden="true">
                          <Led color="red" on={focused.voice.mode === 'Legato'} />
                          <Legend>LEGATO</Legend>
                        </span>
                        <PanelButton store={store} id="voice-mode" className="dark tiny" />
                        <Legend className="dim">PRI {focused.voice.priority} ▿</Legend>
                      </span>
                      <span className="knob-cell">
                        <Knob store={store} id="glide" className="small" />
                        <Legend>GLIDE</Legend>
                        <Legend className="dim">LO ▿ HI ▿</Legend>
                      </span>
                    </span>
                  </GroupBox>
                  <GroupBox title="Vibrato" className="vibrato-box">
                    {/* Reference layout: WHL/DLY/ON LED column, A.T./PED LED
                        column, MENU legend + red-framed button at the right.
                        LEDs light truthfully from the layer's vibrato mode;
                        A.T. stays unlit — aftertouch is spec-excluded (no
                        browser aftertouch input). */}
                    <span className="vibrato-grid">
                      <span className="vibrato-led-col" aria-hidden="true">
                        <span className="tiny-led-row">
                          <Legend>WHL</Legend>
                          <Led color="red" on={focused.voice.vibrato === 'Wheel'} />
                        </span>
                        <span className="tiny-led-row">
                          <Legend>DLY</Legend>
                          <Led color="red" on={focused.voice.vibrato === 'Delayed'} />
                        </span>
                        <span className="tiny-led-row">
                          <Legend>ON</Legend>
                          <Led color="red" on={focused.voice.vibrato === 'On'} />
                        </span>
                      </span>
                      <span className="vibrato-led-col" aria-hidden="true">
                        <span className="tiny-led-row">
                          <Led color="red" />
                          <Legend>A.T.</Legend>
                        </span>
                        <span className="tiny-led-row">
                          <Led color="red" on={focused.voice.vibrato === 'Pedal'} />
                          <Legend>PED</Legend>
                        </span>
                      </span>
                      <span className="vibrato-menu-cell">
                        <span className="tiny-led-row" aria-hidden="true">
                          <Led color="red" on={state.synthVibratoEdit} />
                          <Legend>MENU</Legend>
                        </span>
                        <PanelButton store={store} id="vibrato-menu" className="framed tiny" />
                      </span>
                    </span>
                    {/* Blank cap: the LED columns above show the mode. */}
                    <PanelButton store={store} id="vibrato-mode" className="dark tiny vibrato-mode-button" />
                  </GroupBox>
                </div>
              </div>
            </div>
            <div className="synth-bottom">
              <GroupBox title="LFO" className="lfo-box">
                <span className="tiny-led-row" aria-hidden="true">
                  <Led color="green" on={lfo.destination !== null} />
                  <Legend>{lfo.waveform.toUpperCase()}</Legend>
                </span>
                <span className="tiny-led-row" aria-hidden="true">
                  <Led color="red" />
                  <Legend>WAVEFORM</Legend>
                </span>
                <PanelButton store={store} id="lfo-waveform" className="framed tiny" />
                <Legend className="dim">{lfo.destination ?? 'OFF'} ▿</Legend>
                {/* Reference: the two LFO knobs sit side by side (RATE/TIME
                    left, MOD AMT right), not stacked. */}
                <span className="lfo-knob-row">
                  <span className="knob-cell">
                    <Knob store={store} id="lfo-rate" className="small" />
                    <Legend>RATE/<wbr />TIME</Legend>
                    <Legend className={`dim red-tag ${lfo.mstClk ? 'lit' : ''}`}>◂ MST CLK</Legend>
                  </span>
                  <span className="knob-cell">
                    <Knob store={store} id="lfo-mod-amt" className="small" />
                    <Legend>MOD AMT</Legend>
                  </span>
                </span>
                <Legend className="dim">OSC PITCH · OSC CTRL · FILTER</Legend>
              </GroupBox>
              <GroupBox title="Oscillators" className="osc-box">
                {/* Reference: '\u25cf PITCH/SMP  \u25cf ENVELOPE' printed above two
                    plain black buttons; the LEDs light while that OLED dial
                    edit is latched. */}
                <span className="button-cell-legends" aria-hidden="true">
                  <span className="tiny-led-row">
                    <Led color="red" on={state.synthOscPitchEdit} />
                    <Legend>PITCH/SMP</Legend>
                  </span>
                  <span className="tiny-led-row">
                    <Led color="red" on={state.synthEnvEdit === 'osc'} />
                    <Legend>ENVELOPE</Legend>
                  </span>
                </span>
                <span className="button-cell">
                  <PanelButton store={store} id="osc-pitch-smp" className="framed tiny" />
                  <PanelButton store={store} id="osc-envelope" className="framed tiny" />
                </span>
                <Legend className={`dim ${oscEnvelope.toPitch ? 'lit' : ''}`}>
                  ENV TO PITCH {oscEnvelope.toPitch ? '●' : '○'} · VELOCITY {oscEnvelope.velocity ? '●' : '○'}
                </Legend>
                <span className="knob-pair">
                  <span className="knob-cell">
                    <Knob store={store} id="osc-ctrl" />
                    <Legend>
                      OSC CTRL <b>{(focused.oscCtrl / 12.7).toFixed(1)}</b>
                    </Legend>
                  </span>
                  <span className="knob-cell">
                    <Knob store={store} id="osc-env-amt" className="small" scale={['-10', null, '-5', '0', '5', null, '10']} />
                    <Legend>ENV AMT</Legend>
                  </span>
                </span>
              </GroupBox>
              <GroupBox title="Filter" className="filter-box">
                <span className="button-cell-legends" aria-hidden="true">
                  <span className="tiny-led-row">
                    <Led color="red" />
                    <Legend>TYPE</Legend>
                  </span>
                  <span className="tiny-led-row">
                    <Led color="red" on={state.synthEnvEdit === 'filter'} />
                    <Legend>ENVELOPE</Legend>
                  </span>
                </span>
                <span className="button-cell">
                  <PanelButton store={store} id="filter-type" className="framed tiny" />
                  <PanelButton store={store} id="filter-envelope" className="framed tiny" />
                </span>
                <TokenRow tokens={[...SYNTH_FILTER_TYPES]} active={filter.type} />
                <Legend className="dim">
                  TRACK {['OFF', '1/3', '2/3', '1'][filter.tracking]} ▿ · DRIVE {['OFF', '1', '2', '3'][filter.drive]} ▿
                </Legend>
                <span className="knob-pair">
                  <span className="knob-cell">
                    <Knob store={store} id="filter-freq" />
                    <Legend>FREQ</Legend>
                  </span>
                  <span className="knob-cell">
                    <Knob store={store} id="filter-res" className="small" />
                    <Legend>RES/FREQ HP</Legend>
                  </span>
                  <span className="knob-cell">
                    <Knob store={store} id="filter-env-amt" className="small" />
                    <Legend>ENV AMT</Legend>
                  </span>
                </span>
                <span className="filter-on-cell">
                  <Legend>FILTER ON</Legend>
                  <PanelButton store={store} id="filter-on" className="dark tiny" led="red" />
                </span>
              </GroupBox>
              <div className="amp-unison-column">
                <GroupBox title="Amp" className="amp-box">
                  <span className="tiny-led-row" aria-hidden="true">
                    <Led color="red" on={state.synthEnvEdit === 'amp'} />
                    <Legend>ENVELOPE</Legend>
                  </span>
                  <PanelButton store={store} id="amp-envelope" className="framed tiny" />
                  {/* VELOCITY ▿ = Shift + ENVELOPE cycles Off/1/2/3.
                      Two-LED encoding (reference print "1 ● 2 ●"): level 1
                      lights LED 1, level 2 lights LED 2, level 3 lights
                      both, Off lights none. */}
                  <Legend className="dim">VELOCITY ▿</Legend>
                  <span className="tiny-led-row" aria-hidden="true">
                    <Legend>1</Legend>
                    <Led color="red" on={envelope.velocity === 1 || envelope.velocity === 3} />
                    <Legend>2</Legend>
                    <Led color="red" on={envelope.velocity === 2 || envelope.velocity === 3} />
                  </span>
                </GroupBox>
                <GroupBox title="Unison" className="unison-box">
                  <span className="tiny-led-row" aria-hidden="true">
                    <Legend>2</Legend>
                    <Led color="red" on={focused.voice.unison === 2} />
                    <Legend>3</Legend>
                    <Led color="red" on={focused.voice.unison === 3} />
                  </span>
                  <span className="tiny-led-row" aria-hidden="true">
                    <Legend>1</Legend>
                    <Led color="red" on={focused.voice.unison === 1} />
                  </span>
                  <PanelButton store={store} id="synth-unison" className="dark tiny" />
                </GroupBox>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/** OLED CAT display label (spec.scope.optional's "Shape"/"Shape Sine" are
 *  separate categories internally, printed with a space like the panel's
 *  other two-word category names). */
function synthCategoryLabel(category: string): string {
  return category === 'ShapeSine' ? 'SHAPE SINE' : category.toUpperCase()
}

/** Signed Osc Pitch readout: leading '+' for >= 0 (e.g. '+7', '-24', '+0'). */
function fmtSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`
}

/* -------------------------------------------------------------- Effects -- */

/** Reference-style effect type selector: two label columns with a central
 *  pair of triangular LED arrows per row (like the Organ Model / Piano Select
 *  grids). `on` names the lit side; `rightTag` boxes the right label the way
 *  the panel prints A-WAH / TO ROTARY / LP FILTER. */
interface SelectorRow {
  left?: string
  right?: string
  on?: 'left' | 'right' | null
  rightTag?: 'gray' | 'red'
}

function SelectorLedGrid({ rows }: { rows: SelectorRow[] }) {
  return (
    <span className="sel-grid" aria-hidden="true">
      {rows.map((row, i) => (
        <span key={i} className="sel-row">
          <Legend className="sel-left">{row.left ?? ''}</Legend>
          <span className="sel-leds">
            <Led color="red" on={row.on === 'left'} className="led-tri-left" />
            <Led color="red" on={row.on === 'right'} className="led-tri-right" />
          </span>
          <Legend className={`sel-right ${row.rightTag ? `sel-tag sel-tag-${row.rightTag}` : ''}`}>{row.right ?? ''}</Legend>
        </span>
      ))}
    </span>
  )
}

function TokenRow({ tokens, active }: { tokens: string[]; active?: string }) {
  return (
    <Legend className="dim token-row">
      {tokens.map((token, i) => (
        <span key={token} className="type-token" data-on={active !== undefined && token === active ? 'true' : undefined}>
          {i > 0 ? ' · ' : ''}
          {token}
        </span>
      ))}
    </Legend>
  )
}

export function EffectsSection({ store, instrument, onZoom }: BoundSectionProps) {
  const state = useInstrumentState(instrument)
  const chain = state.fxSection === 'organ' ? state.organChain : state.chains[state.focusedLayer]
  return (
    <SectionShell id="effects">
      <div className="effects-wrap">
        {/* FX FOCUS is a standalone strip on exposed red chassis between the
            Synth and Layer Effects plates (reference photo), not part of the
            effects plate. The organ entry has ONE focus LED captioned "A B":
            both organ layers share a single FX chain. */}
        <div className="fx-strip" role="group" aria-label="FX Focus">
          <span className="fx-strip-tab">FX FOCUS</span>
          <span className="focus-cell">
            <Legend>ORGAN</Legend>
            <span className="tiny-led-row" aria-hidden="true">
              <Led color="yellow" on={state.fxSection === 'organ'} />
            </span>
            <Legend className="focus-caption" aria-hidden="true">
              A B
            </Legend>
            <PanelButton store={store} id="all-fx-off" className="dark tiny" />
            <Legend className="dim">ALL FX OFF</Legend>
          </span>
          <span className="focus-cell">
            <Legend>PIANO</Legend>
            <span className="tiny-led-row" aria-hidden="true">
              <Led color="yellow" on={state.fxSection === 'piano' && (state.focusedLayer === 'A' || state.fxGroupPiano)} />
              <Led color="yellow" on={state.fxSection === 'piano' && (state.focusedLayer === 'B' || state.fxGroupPiano)} />
            </span>
            <Legend className="focus-caption" aria-hidden="true">
              A B
            </Legend>
            <PanelButton store={store} id="fx-focus-piano" className="dark tiny" />
            <Legend className="dim">GROUP ▿</Legend>
          </span>
          <span className="focus-cell">
            <Legend>SYNTH</Legend>
            <span className="tiny-led-row" aria-hidden="true">
              <Led color="yellow" on={state.fxSection === 'synth' && (state.synth.focusedLayer === 'A' || state.fxGroupSynth)} />
              <Led color="yellow" on={state.fxSection === 'synth' && (state.synth.focusedLayer === 'B' || state.fxGroupSynth)} />
              <Led color="yellow" on={state.fxSection === 'synth' && (state.synth.focusedLayer === 'C' || state.fxGroupSynth)} />
            </span>
            <Legend className="focus-caption" aria-hidden="true">
              A B C
            </Legend>
            <PanelButton store={store} id="fx-focus-synth" className="dark tiny" />
            <Legend className="dim">GROUP ▿</Legend>
          </span>
          <span className="shift-cluster fx-shift">
            <Legend>SHIFT</Legend>
            <PanelButton store={store} id="shift-2" className="rocker" />
            <Legend className="dim">EXIT</Legend>
          </span>
        </div>
        <div className="plate">
          <div className="plate-header">
            <PlateTitle title="LAYER EFFECTS" onZoom={onZoom} />
            <span className="on-cluster">
              <Legend>ON</Legend>
              <PanelButton store={store} id="effects-on" className="pill" led="green" />
            </span>
          </div>
          <div className="effects-grid">
            <GroupBox title="Mod 1" className="fx-box mod1-box">
              <span className="knob-cell">
                <Knob store={store} id="mod1-rate" className="small" />
                <Legend>RATE <i className="dim">SENS</i></Legend>
                <Legend className={`dim red-tag ${chain.mod1.mstClk ? 'lit' : ''}`}>◂ MST CLK</Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="mod1-amount" className="small" />
                <Legend>AMOUNT</Legend>
              </span>
              <span className="variation-cell">
                <SelectorLedGrid
                  rows={selectorRows(
                    [
                      ['RM', 'A-WAH', 'gray'],
                      ['TREM', 'WAH', 'gray'],
                      ['A-PAN', 'PUMP', 'gray'],
                    ],
                    MOD1_POS,
                    chain.mod1.type,
                  )}
                />
                <span className="variation-row">
                  <PanelButton store={store} id="mod1-variation" className="dark tiny" />
                  <Legend className="dim">
                    VARIATION <i>PED</i> ▿
                  </Legend>
                </span>
              </span>
              {/* Reference: vertical light rocker at the box's right edge,
                  ON ● printed above it. */}
              <span className="fx-on-cell">
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>ON</Legend>
                  <Led color="red" on={chain.mod1.on} />
                </span>
                <PanelButton store={store} id="mod1-on" className="rocker fx-on-rocker" />
              </span>
            </GroupBox>
            {/* Cell placement mirrors the reference photo: TEMPO over the
                light TAP/SET sub-box (left), EFFECTS + DRY WET (center),
                FEEDBACK over FILTER over ON (right). */}
            <GroupBox title="Delay" className="fx-box delay-box">
              <span className="knob-cell delay-tempo-cell">
                <Knob store={store} id="delay-tempo" className="small" />
                <Legend>TEMPO</Legend>
                <Legend className={`dim red-tag ${chain.delay.mstClk ? 'lit' : ''}`}>◂ MST CLK</Legend>
              </span>
              <span className="variation-cell delay-effects-cell">
                <Legend className="dim">EFFECTS</Legend>
                {/* Reference: round LEDs beside each type word here — the ◀▶
                    arrow-pair grids belong only to Mod 1/2, Amp Sim and
                    Reverb. Staggered two-column print, LEDs on the inner side. */}
                <span className="led-word-cols" aria-hidden="true">
                  <span className="led-word-col">
                    <span className="tiny-led-row">
                      <Legend>CHOR</Legend>
                      <Led color="red" on={chain.delay.effect === 'Chorus'} />
                    </span>
                    <span className="tiny-led-row">
                      <Legend>VIBE</Legend>
                      <Led color="red" on={chain.delay.effect === 'Vibe'} />
                    </span>
                    <span className="tiny-led-row">
                      <Legend>ENS</Legend>
                      <Led color="red" on={chain.delay.effect === 'Ensemble'} />
                    </span>
                  </span>
                  <span className="led-word-col">
                    <span className="tiny-led-row">
                      <Led color="red" on={chain.delay.effect === 'Flam'} />
                      <Legend>FLAM</Legend>
                    </span>
                    <span className="tiny-led-row">
                      <Led color="red" on={chain.delay.effect === 'Space'} />
                      <Legend>SPACE</Legend>
                    </span>
                  </span>
                </span>
                <PanelButton store={store} id="delay-variation" className="dark tiny" />
                <Legend className="dim">VARIATION ▿</Legend>
              </span>
              <span className="knob-cell delay-feedback-cell">
                <Knob store={store} id="delay-feedback" className="small" />
                <Legend>FEEDBACK</Legend>
              </span>
              <span className="variation-cell tap-box delay-tap-cell">
                <span className="tiny-led-row">
                  {/* The hardware blinks this LED with the delay tempo; no
                      blink state is modeled, so it is truthfully an unlit print. */}
                  <Led color="red" on={false} />
                  <Legend>TAP/SET ▾</Legend>
                </span>
                {/* ONE physical button (reference): TAP/SET on press, ANALOG
                    on Shift + press — the ▿-marked print below. */}
                <PanelButton store={store} id="delay-tap" className="dark tap-button" />
                <span className="tiny-led-row">
                  <Led color="red" on={chain.delay.analog} />
                  <Legend className="dim">ANALOG ▿</Legend>
                </span>
              </span>
              <span className="knob-cell delay-mix-cell">
                <Knob store={store} id="delay-mix" className="small" />
                <Legend>DRY WET</Legend>
              </span>
              <span className="variation-cell delay-filter-cell">
                <Legend className="dim">FILTER</Legend>
                <span className="led-word-cols" aria-hidden="true">
                  <span className="led-word-col">
                    <span className="tiny-led-row">
                      <Legend>HP</Legend>
                      <Led color="red" on={chain.delay.filter === 'High Pass'} />
                    </span>
                    <span className="tiny-led-row">
                      <Legend>LP</Legend>
                      <Led color="red" on={chain.delay.filter === 'Low Pass'} />
                    </span>
                  </span>
                  <span className="led-word-col">
                    <span className="tiny-led-row">
                      <Led color="red" on={chain.delay.filter === 'Band Pass'} />
                      <Legend>BP</Legend>
                    </span>
                  </span>
                </span>
                <PanelButton store={store} id="delay-filter" className="dark tiny" />
                <Legend className="dim">PING PONG ▿</Legend>
              </span>
              <span className="fx-on-cell delay-on-cell">
                <Legend>ON</Legend>
                <PanelButton store={store} id="delay-on" className="pill small blank" led="red" />
                <Legend className={`dim red-tag ${state.fxGlobal.delay ? 'lit' : ''}`}>GLOBAL ▿</Legend>
              </span>
            </GroupBox>
            <GroupBox title="Mod 2" className="fx-box mod2-box">
              <span className="knob-cell">
                <Knob store={store} id="mod2-rate" className="small" />
                <Legend>RATE</Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="mod2-amount" className="small" />
                <Legend>AMOUNT</Legend>
              </span>
              <span className="variation-cell">
                <SelectorLedGrid
                  rows={selectorRows(
                    [
                      ['CHOR', 'VIBE'],
                      ['FLANG', 'ENS'],
                      ['PHAS', 'SPIN'],
                    ],
                    MOD2_POS,
                    chain.mod2.type,
                  )}
                />
                <span className="variation-row">
                  <PanelButton store={store} id="mod2-variation" className="dark tiny" />
                  <Legend className="dim">VARIATION ▿</Legend>
                </span>
              </span>
              <span className="fx-on-cell">
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>ON</Legend>
                  <Led color="red" on={chain.mod2.on} />
                </span>
                <PanelButton store={store} id="mod2-on" className="rocker fx-on-rocker" />
              </span>
            </GroupBox>
            <GroupBox title="Comp" className="fx-box comp-box">
              <span className="knob-cell">
                <span className="tiny-led-row" aria-hidden="true">
                  {/* ACTIVE is the hardware's live gain-reduction indicator;
                      no such signal state is modeled, so the LED is
                      truthfully an unlit print. */}
                  <Led color="red" on={false} />
                  <Legend>ACTIVE</Legend>
                </span>
                <Knob store={store} id="comp-amount" className="small" />
                <Legend>AMOUNT</Legend>
                <span className="tiny-led-row" aria-hidden="true">
                  <Led color="red" on={chain.comp.fast} />
                  <Legend>FAST</Legend>
                </span>
              </span>
              <span className="fx-on-cell comp-on-cell">
                <span className="comp-on-row">
                  <span className="tiny-led-row" aria-hidden="true">
                    <Legend>ON</Legend>
                    <Led color="red" on={chain.comp.on} />
                  </span>
                  <PanelButton store={store} id="comp-on" className="dark tiny" />
                </span>
                <Legend className={`dim red-tag ${state.fxGlobal.comp ? 'lit' : ''}`}>GLOBAL ▿</Legend>
              </span>
            </GroupBox>
            <GroupBox title="Amp Sim/EQ" className="fx-box amp-sim-box">
              <span className="knob-cell">
                <Knob store={store} id="amp-drive" className="small" />
                <Legend>DRIVE</Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="amp-freq" className="small" scale={['200', '250', '400', '600', '1K', '2K', '4K', '6K', '8K']} />
                <Legend>FREQ <i className="dim">MID</i></Legend>
              </span>
              <span className="variation-cell">
                <SelectorLedGrid
                  rows={selectorRows(
                    [
                      ['SMALL', 'TO ROTARY', 'red'],
                      ['JC', 'LP FILTER', 'gray'],
                      ['TWIN', 'HP FILTER', 'gray'],
                    ],
                    AMP_POS,
                    chain.ampEq.type,
                  )}
                />
                <span className="variation-row">
                  <PanelButton store={store} id="amp-variation" className="dark tiny" />
                  <Legend className="dim">VARIATION ▿</Legend>
                </span>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="eq-bass" className="small" scale={['-15', null, '-5', '0', '5', null, '15']} />
                <Legend>BASS</Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="eq-mid" className="small" scale={['-15', null, '-5', '0', '5', null, '15']} />
                <Legend>MID <i className="dim">▿</i></Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="eq-treble" className="small" scale={['-15', null, '-5', '0', '5', null, '15']} />
                <Legend>TREBLE</Legend>
              </span>
              <span className="fx-on-cell">
                <span className="tiny-led-row" aria-hidden="true">
                  <Legend>ON</Legend>
                  <Led color="red" on={chain.ampEq.on} />
                </span>
                <PanelButton store={store} id="amp-on" className="rocker fx-on-rocker" />
              </span>
            </GroupBox>
            <GroupBox title="Reverb" className="fx-box reverb-box">
              <span className="variation-cell">
                {/* Reference: BRIGHT / DARK LED legends + their dark button
                    sit LEFT of the type selector grid. */}
                <span className="reverb-top-row">
                  <span className="reverb-tone">
                    <span className="reverb-tone-leds" aria-hidden="true">
                      <span className="tiny-led-row">
                        <Led color="red" on={chain.reverb.bright} />
                        <Legend>BRIGHT</Legend>
                      </span>
                      <span className="tiny-led-row">
                        <Led color="red" on={!chain.reverb.bright} />
                        <Legend>DARK</Legend>
                      </span>
                    </span>
                    <PanelButton store={store} id="reverb-bright" className="dark tiny" />
                  </span>
                  <SelectorLedGrid
                    rows={selectorRows(
                      [
                        ['ROOM', 'STAGE'],
                        ['BOOTH', 'HALL'],
                        ['SPRING', 'CATH'],
                      ],
                      REVERB_POS,
                      chain.reverb.type,
                    )}
                  />
                </span>
                <span className="variation-row">
                  <PanelButton store={store} id="reverb-variation" className="dark tiny" />
                  <Legend className="dim">VAR|CHORALE ▿</Legend>
                </span>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="reverb-mix" className="small" />
                <Legend>DRY WET</Legend>
              </span>
              <span className="fx-on-cell">
                <Legend>ON</Legend>
                <PanelButton store={store} id="reverb-on" className="pill small blank" led="red" />
                <Legend className={`dim red-tag ${state.fxGlobal.reverb ? 'lit' : ''}`}>GLOBAL ▿</Legend>
              </span>
            </GroupBox>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/* ---------------------------------------- effect type selector positions -- */

/** Row index + lit side for each canonical type, matching the panel print. */
type SelectorPos = Record<string, [number, 'left' | 'right']>

const MOD1_POS: SelectorPos = {
  'Ring Mod': [0, 'left'],
  'A-Wah': [0, 'right'],
  Tremolo: [1, 'left'],
  Wah: [1, 'right'],
  'A-Pan': [2, 'left'],
  Pump: [2, 'right'],
}

const MOD2_POS: SelectorPos = {
  Chorus: [0, 'left'],
  Vibe: [0, 'right'],
  Flanger: [1, 'left'],
  Ensemble: [1, 'right'],
  Phaser: [2, 'left'],
  Spin: [2, 'right'],
}

const AMP_POS: SelectorPos = {
  Small: [0, 'left'],
  'To Rotary': [0, 'right'],
  JC: [1, 'left'],
  'LP24 Filter': [1, 'right'],
  Twin: [2, 'left'],
  'HP24 Filter': [2, 'right'],
}

const REVERB_POS: SelectorPos = {
  Room: [0, 'left'],
  Stage: [0, 'right'],
  Booth: [1, 'left'],
  Hall: [1, 'right'],
  Spring: [2, 'left'],
  Cathedral: [2, 'right'],
}

function selectorRows(
  labels: [string | undefined, string | undefined, ('gray' | 'red')?][],
  positions: SelectorPos,
  active: string,
): SelectorRow[] {
  const pos = positions[active]
  return labels.map(([left, right, rightTag], i) => ({
    left,
    right,
    rightTag,
    on: pos && pos[0] === i ? pos[1] : null,
  }))
}
