import { useSyncExternalStore, type ReactNode } from 'react'
import { DRAWBAR_FOOTAGES, DRAWBAR_LEGENDS, PROGRAM_BUTTON_LEGENDS } from '../model/hardware'
import { SECTIONS } from '../model/variant'
import type { PresentationStore } from '../state/presentation'
import { usePresentationMorphRange, usePresentationValue } from '../state/presentation'
import {
  mappings,
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
  return (
    <div className="layer-column" data-focused={focused ? 'true' : undefined}>
      <div className="layer-fader-row">
        <LedLadder count={9} lit={Math.round((level / 127) * 9)} rangeLit={range ?? undefined} />
        <Fader store={store} id={faderId} />
      </div>
      <Legend className="layer-letter">
        <b>{letter}</b> AUX KB
      </Legend>
      <PanelButton store={store} id={buttonId} className="pill small" led="yellow">
        ON/OFF ▾
      </PanelButton>
    </div>
  )
}

/* ---------------------------------------------------------- Performance -- */

export function PerformanceSection({ store, instrument }: BoundSectionProps) {
  const state = useInstrumentState(instrument)
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
            <Knob store={store} id="perf-master-level" className="large" />
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
          <PanelButton store={store} id="rotary-source" className="pill small">
            CLOSE MIC ▿
          </PanelButton>
          <span className="rotary-led-row">
            <Led color="yellow" on={state.rotary.speed === 'stop'} />
            <Legend>STOP MODE</Legend>
          </span>
          <PanelButton store={store} id="rotary-stop-mode" className="dark small">
            ANGLE
          </PanelButton>
          <span className="rotary-led-row">
            <Led color="green" on={state.rotary.speed === 'slow'} />
            <Legend>SLOW</Legend>
            <Led color="red" on={state.rotary.speed === 'fast'} />
            <Legend>FAST</Legend>
          </span>
          <PanelButton store={store} id="rotary-speed" className="dark small" />
          <PanelButton store={store} id="rotary-morph" className="dark small">
            MORPH
          </PanelButton>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/* ---------------------------------------------------------------- Organ -- */

function DrawbarColumn({ store, index }: { store: PresentationStore; index: number }) {
  const id = `organ-drawbar-${index + 1}`
  const value = usePresentationValue(store, id)
  const range = usePresentationMorphRange(store, id, 8)
  const color = [0, 1].includes(index) ? 'brown' : [2, 3, 5, 8].includes(index) ? 'white' : 'black'
  return (
    <div className="drawbar-column">
      <Legend className="drawbar-name">{DRAWBAR_LEGENDS[index]}</Legend>
      <div className="drawbar-row">
        <LedLadder count={8} lit={value} color="red" fill="down" className="drawbar-ladder" rangeLit={range ?? undefined} />
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
  const vibLevel = Number(organ.vibratoType[1]) // 1..3 lights the C/V pair LED
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
              <Led color="yellow" on={organ.sustped} />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" on={organ.pstick} />
              <Legend>PSTICK</Legend>
            </span>
            <PanelButton store={store} id="organ-preset" className="dark small">
              PRESET
            </PanelButton>
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
                <div className="model-led-grid" aria-hidden="true">
                  <span>
                    <Led color="red" on={vibLevel === 1} />
                    <Legend>C1 V1</Legend>
                  </span>
                  <span>
                    <Led color="red" on={vibLevel === 2} />
                    <Legend>C2 V2</Legend>
                  </span>
                  <span>
                    <Led color="red" on={vibLevel === 3} />
                    <Legend>C3 V3</Legend>
                  </span>
                </div>
                <PanelButton store={store} id="organ-vib-select" className="dark small" />
                <span className="tiny-led-row">
                  <Led color="green" on={focused.vibrato} />
                  <Legend>ON</Legend>
                </span>
                <PanelButton store={store} id="organ-vib-on" className="pill small" led="green" />
              </GroupBox>
              <GroupBox title="B3 Percussion" className="organ-perc">
                <div className="perc-grid">
                  <span className="perc-cell">
                    <Legend>VOLUME</Legend>
                    <Legend className="dim">SOFT</Legend>
                    <PanelButton store={store} id="organ-perc-volume" className="dark tiny" led="yellow" />
                  </span>
                  <span className="perc-cell">
                    <Legend>DECAY</Legend>
                    <Legend className="dim">FAST</Legend>
                    <PanelButton store={store} id="organ-perc-decay" className="dark tiny" led="yellow" />
                  </span>
                  <span className="perc-cell">
                    <Legend>HARMONIC</Legend>
                    <Legend className="dim">THIRD</Legend>
                    <PanelButton store={store} id="organ-perc-harmonic" className="dark tiny" led="yellow" />
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
                <DrawbarColumn key={i} store={store} index={i} />
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
              <Led color="yellow" on={state.piano.sustped} />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" on={state.piano.pstick} />
              <Legend>PSTICK</Legend>
            </span>
            <GroupBox title="Timbre" className="timbre-box">
              <div className="timbre-leds" aria-hidden="true">
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
              <PanelButton store={store} id="piano-timbre" className="rocker" />
            </GroupBox>
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
              <PanelButton store={store} id="piano-type" className="dark small" />
              <Legend className="dim">INFO</Legend>
              <PanelButton store={store} id="piano-info" className="dark tiny" />
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
  const pianoLine = state.pianoNotFound
    ? `Piano not found (${state.pianoNotFound})`
    : model
      ? `${state.focusedLayer}: ${model.name}${loadStatus === 'loading' ? ' — loading…' : loadStatus === 'error' ? ' — FALLBACK' : ''}`
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
  const programReadout = `${programLabel(programs.current, programs.liveMode)}${programs.dirty ? ' E' : ''}${
    programs.storePending ? ` ▸ STORE ${programLabel(reference, programs.liveMode)}?` : ''
  }`
  const nameLine = naming ? (
    <b className="oled-name" data-testid="oled-name-line">
      {naming.name
        .padEnd(naming.cursor + 1, ' ')
        .split('')
        .map((char, i) => (i === naming.cursor ? <u key={i}>{char}</u> : <span key={i}>{char}</span>))}
    </b>
  ) : (
    <b className="oled-name" data-testid="oled-name-line">
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
  return (
    <SectionShell id="program">
      <div className="program-layout">
        <div className="program-top-row">
          <GroupBox title="Morph Assign" className="morph-box">
            <div className="morph-buttons">
              <PanelButton store={store} id="morph-wheel" className="dark tiny" led="yellow">
                WHEEL
              </PanelButton>
              <PanelButton store={store} id="morph-at" className="dark tiny" led="yellow">
                A.T.
              </PanelButton>
              <PanelButton store={store} id="morph-ctrlped" className="dark tiny" led="yellow">
                CTRLPED
              </PanelButton>
            </div>
            <Legend className="dim">CLEAR MORPH ▾</Legend>
          </GroupBox>
          <GroupBox title="Split" className="split-box">
            <PanelButton store={store} id="split-onset" className="dark tiny" led="yellow">
              ON/SET ▾
            </PanelButton>
          </GroupBox>
          <GroupBox title="Mst Clk" className="clk-box">
            <PanelButton store={store} id="mstclk-tap" className="dark tiny">
              TAP/SET ▾
            </PanelButton>
          </GroupBox>
          <GroupBox title="Transp" className="transp-box">
            <PanelButton store={store} id="transpose-onset" className="dark tiny" led="yellow">
              ON/SET ▾
            </PanelButton>
            <PanelButton store={store} id="panic" className="dark tiny">
              PANIC
            </PanelButton>
          </GroupBox>
        </div>
        <div className="program-mid">
          <div className="program-mid-left">
            <span className="store-cluster">
              <span className="tiny-led-row">
                <Led color="red" on={!!programs.storePending} className={programs.storePending ? 'flash' : ''} />
                <Legend>STORE</Legend>
              </span>
              <PanelButton store={store} id="store" className="red small" />
              <PanelButton store={store} id="store-as" className="dark tiny">
                STORE AS…
              </PanelButton>
            </span>
            <div className="program-dial-block">
              <Encoder store={store} id="program-dial" className="large" />
              <Legend>
                PROGRAM <b className="list-tag">LIST</b>
              </Legend>
            </div>
            <div className="page-block">
              <span className="page-buttons">
                <PanelButton store={store} id="page-left" className="dark tiny">
                  ◂
                </PanelButton>
                <PanelButton store={store} id="page-right" className="dark tiny">
                  ▸
                </PanelButton>
              </span>
              <Legend>◂ PAGE/CAT ▸</Legend>
              <Legend className="dim">◂ BANK ▸</Legend>
            </div>
            <div className="mode-block">
              <span className="mode-cell">
                <PanelButton store={store} id="live-mode" className="pill small" led="red">
                  LIVE MODE
                </PanelButton>
                <Legend className="dim">NUM PAD ▿</Legend>
              </span>
              <span className="mode-cell">
                <PanelButton store={store} id="layer-scene" className="dark tiny" led="green">
                  LAYER SCENE II
                </PanelButton>
                <Legend className="dim">PEDAL ▿</Legend>
              </span>
            </div>
          </div>
          <div className="program-center">
            <GroupBox title="Preset Library" className="preset-box">
              <div className="preset-buttons">
                <PanelButton store={store} id="preset-organ" className="dark tiny">
                  ORGAN
                </PanelButton>
                <PanelButton store={store} id="preset-piano" className="dark tiny">
                  PIANO
                </PanelButton>
                <PanelButton store={store} id="preset-synth" className="dark tiny">
                  SYNTH
                </PanelButton>
              </div>
              <Legend className="dim">SINGLE LAYER ▾</Legend>
            </GroupBox>
            <Oled
              section="program"
              lines={[
                <span key="p" className="oled-program" data-testid="oled-program-line">{programReadout}</span>,
                <span key="n">{nameLine}</span>,
                ...(splitRows ??
                  clockRows ??
                  transposeRows ??
                  modelListRows ??
                  (programs.listView
                    ? listRows
                    : [
                      <span key="piano" className="oled-slot" data-testid="oled-piano-line">
                        ▤ {pianoLine}
                      </span>,
                      <span key="status" className="oled-slot" data-testid="oled-status-line">
                        {statusLine || '〜 Piano · FX ready'}
                      </span>,
                    ])),
                <span key="edit" className="oled-slot oled-edit" data-testid="oled-edit-line">
                  {state.lastEdit || '◫ —'}
                </span>,
              ]}
            />
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
            </span>
            <span className="rail-cell">
              <Legend>SOLO</Legend>
              <PanelButton store={store} id="solo-undo" className="dark tiny" />
              <Legend className="dim">UNDO</Legend>
            </span>
            <span className="rail-cell">
              <Legend>SECTION EDIT ⇕</Legend>
              <PanelButton store={store} id="section-edit" className="dark tiny" />
            </span>
            <span className="rail-cell">
              <Legend>LAYER INIT</Legend>
              <PanelButton store={store} id="layer-init" className="dark tiny" />
            </span>
            <span className="rail-cell">
              <Legend>MON|COPY</Legend>
              <PanelButton store={store} id="mon-copy" className="dark tiny" />
              <Legend className="dim">PASTE ⇕</Legend>
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
              <Led color="yellow" on={synth.sustped} />
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
                    state.synthVibratoEdit
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
                  <span className="tiny-led-row">
                    <Led color="yellow" on={isSamplesMode} />
                    <Legend>SAMPLES</Legend>
                  </span>
                  <span className="tiny-led-row">
                    <Led color="red" on={!isSamplesMode} />
                    <Legend>ANALOG</Legend>
                  </span>
                  <span className="tiny-led-row">
                    <Led color="red" />
                    <Legend>EXTERN</Legend>
                  </span>
                  <PanelButton store={store} id="synth-mode" className="dark small" />
                </GroupBox>
                <span className="waveform-cluster">
                  <Legend>WAVEFORM</Legend>
                  <Legend className="dim">KEEP EDITS ▿</Legend>
                  <PanelButton store={store} id="waveform-select" className="red tiny" />
                  <Legend>SOUND INIT</Legend>
                  <PanelButton store={store} id="sound-init" className="dark tiny" />
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
                        <Legend>{synth.arp.mode === 'Poly' ? 'POLY ▾' : synth.arp.mode}</Legend>
                        <Led color="green" on={synth.arp.mode === 'Gate'} />
                        <Legend>GATE</Legend>
                      </span>
                      <PanelButton store={store} id="arp-mode" className="dark tiny" led="green" />
                      <Legend className="dim">{synth.arp.direction} ▿</Legend>
                    </span>
                    <span className="knob-cell">
                      <Knob store={store} id="arp-range" className="small" />
                      <Legend>{synth.arp.mode === 'Gate' ? 'HARDNESS' : 'RANGE'} ENV</Legend>
                    </span>
                    <span className="arp-mode-cell">
                      <PanelButton store={store} id="arp-menu" className="red tiny">
                        MENU
                      </PanelButton>
                      <Legend className="dim">GROUP ▿</Legend>
                    </span>
                  </div>
                </GroupBox>
                <div className="voice-vibrato-row">
                  <GroupBox title="Voice" className="voice-box">
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
                    <span className="knob-cell">
                      <Knob store={store} id="glide" className="small" />
                      <Legend>GLIDE</Legend>
                      <Legend className="dim">LO ▿ HI ▿</Legend>
                    </span>
                  </GroupBox>
                  <GroupBox title="Vibrato" className="vibrato-box">
                    <span className="tiny-led-row" aria-hidden="true">
                      <Legend>WHL DLY A.T. PED</Legend>
                    </span>
                    <PanelButton store={store} id="vibrato-mode" className="dark tiny" led="green">
                      {focused.voice.vibrato === 'Off' ? 'OFF' : focused.voice.vibrato.toUpperCase()}
                    </PanelButton>
                    <PanelButton store={store} id="vibrato-menu" className="red tiny">
                      MENU
                    </PanelButton>
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
                <PanelButton store={store} id="lfo-waveform" className="dark tiny">
                  WAVEFORM
                </PanelButton>
                <Legend className="dim">{lfo.destination ?? 'OFF'} ▿</Legend>
                <span className="knob-cell">
                  <Knob store={store} id="lfo-rate" className="small" />
                  <Legend>RATE/<wbr />TIME</Legend>
                  <Legend className={`dim red-tag ${lfo.mstClk ? 'lit' : ''}`}>◂ MST CLK</Legend>
                </span>
                <span className="knob-cell">
                  <Knob store={store} id="lfo-mod-amt" className="small" />
                  <Legend>MOD AMT</Legend>
                  <Legend className="dim">OSC PITCH · OSC CTRL · FILTER</Legend>
                </span>
              </GroupBox>
              <GroupBox title="Oscillators" className="osc-box">
                <span className="button-cell">
                  <PanelButton store={store} id="osc-pitch-smp" className="red tiny">
                    PITCH/SMP
                  </PanelButton>
                  <PanelButton store={store} id="osc-envelope" className="red tiny" led="red">
                    ENVELOPE
                  </PanelButton>
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
                    <Knob store={store} id="osc-env-amt" className="small" />
                    <Legend>ENV AMT</Legend>
                  </span>
                </span>
              </GroupBox>
              <GroupBox title="Filter" className="filter-box">
                <span className="button-cell">
                  <PanelButton store={store} id="filter-type" className="red tiny">
                    TYPE
                  </PanelButton>
                  <PanelButton store={store} id="filter-envelope" className="red tiny" led="red">
                    ENVELOPE
                  </PanelButton>
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
                  <PanelButton store={store} id="amp-envelope" className="red tiny" led="red">
                    ENVELOPE
                  </PanelButton>
                  <span className="tiny-led-row" aria-hidden="true">
                    <Legend>VEL</Legend>
                    <Led color="red" on={envelope.velocity >= 1} />
                    <Legend>{envelope.velocity}</Legend>
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

/* -------------------------------------------------------------- Effects -- */

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
                <TokenRow tokens={['RM', 'TREM', 'A-PAN']} active={mod1Token(chain.mod1.type, 0)} />
                <TokenRow tokens={['A-WAH', 'WAH', 'PUMP']} active={mod1Token(chain.mod1.type, 1)} />
                <PanelButton store={store} id="mod1-variation" className="dark tiny">
                  VARIATION <i>PED</i> ▿
                </PanelButton>
              </span>
              <span className="fx-on-cell">
                <PanelButton store={store} id="mod1-on" className="pill small" led="green">
                  ON
                </PanelButton>
              </span>
            </GroupBox>
            <GroupBox title="Delay" className="fx-box delay-box">
              <span className="knob-cell">
                <Knob store={store} id="delay-tempo" className="small" />
                <Legend>TEMPO</Legend>
                <Legend className={`dim red-tag ${chain.delay.mstClk ? 'lit' : ''}`}>◂ MST CLK</Legend>
              </span>
              <span className="variation-cell">
                <TokenRow
                  tokens={['CHOR', 'VIBE', 'ENS', 'FLAM', 'SPACE']}
                  active={delayEffectToken(chain.delay.effect)}
                />
                <PanelButton store={store} id="delay-variation" className="dark tiny">
                  VARIATION ▿
                </PanelButton>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="delay-feedback" className="small" />
                <Legend>FEEDBACK</Legend>
                <TokenRow tokens={['HP', 'BP', 'LP']} active={delayFilterToken(chain.delay.filter)} />
                <PanelButton store={store} id="delay-filter" className="dark tiny">
                  FILTER ▿
                </PanelButton>
              </span>
              <span className="variation-cell">
                <PanelButton store={store} id="delay-tap" className="dark tiny">
                  TAP/SET ▾
                </PanelButton>
                <PanelButton store={store} id="delay-analog" className="dark tiny">
                  ANALOG ▿
                </PanelButton>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="delay-mix" className="small" />
                <Legend>DRY WET</Legend>
              </span>
              <span className="fx-on-cell">
                <PanelButton store={store} id="delay-on" className="pill small" led="green">
                  ON
                </PanelButton>
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
                <TokenRow tokens={['CHOR', 'FLANG', 'PHAS']} active={mod2Token(chain.mod2.type, 0)} />
                <TokenRow tokens={['VIBE', 'ENS', 'SPIN']} active={mod2Token(chain.mod2.type, 1)} />
                <PanelButton store={store} id="mod2-variation" className="dark tiny">
                  VARIATION ▿
                </PanelButton>
              </span>
              <span className="fx-on-cell">
                <PanelButton store={store} id="mod2-on" className="pill small" led="green">
                  ON
                </PanelButton>
              </span>
            </GroupBox>
            <GroupBox title="Comp" className="fx-box comp-box">
              <span className="knob-cell">
                <Knob store={store} id="comp-amount" className="small" />
                <Legend>AMOUNT</Legend>
                <Legend className="dim">ACTIVE · FAST ▿</Legend>
              </span>
              <span className="fx-on-cell">
                <PanelButton store={store} id="comp-on" className="pill small" led="green">
                  ON
                </PanelButton>
                <Legend className={`dim red-tag ${state.fxGlobal.comp ? 'lit' : ''}`}>GLOBAL ▿</Legend>
              </span>
            </GroupBox>
            <GroupBox title="Amp Sim/EQ" className="fx-box amp-sim-box">
              <span className="knob-cell">
                <Knob store={store} id="amp-drive" className="small" />
                <Legend>DRIVE</Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="amp-freq" className="small" />
                <Legend>FREQ <i className="dim">MID</i></Legend>
              </span>
              <span className="variation-cell">
                <TokenRow tokens={['SMALL', 'JC', 'TWIN']} active={ampToken(chain.ampEq.type, 0)} />
                <TokenRow tokens={['TO ROTARY', 'LP', 'HP FILTER']} active={ampToken(chain.ampEq.type, 1)} />
                <PanelButton store={store} id="amp-variation" className="dark tiny">
                  VARIATION ▿
                </PanelButton>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="eq-bass" className="small" />
                <Legend>BASS</Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="eq-mid" className="small" />
                <Legend>MID <i className="dim">▿</i></Legend>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="eq-treble" className="small" />
                <Legend>TREBLE</Legend>
              </span>
              <span className="fx-on-cell">
                <PanelButton store={store} id="amp-on" className="pill small" led="green">
                  ON
                </PanelButton>
              </span>
            </GroupBox>
            <GroupBox title="Reverb" className="fx-box reverb-box">
              <span className="variation-cell">
                <PanelButton store={store} id="reverb-bright" className="dark tiny" led="yellow">
                  BRIGHT DARK
                </PanelButton>
                <TokenRow
                  tokens={['ROOM', 'STAGE', 'BOOTH', 'HALL', 'SPRING', 'CATH']}
                  active={reverbToken(chain.reverb.type)}
                />
                <PanelButton store={store} id="reverb-variation" className="dark tiny">
                  VAR|CHORALE ▿
                </PanelButton>
              </span>
              <span className="knob-cell">
                <Knob store={store} id="reverb-mix" className="small" />
                <Legend>DRY WET</Legend>
              </span>
              <span className="fx-on-cell">
                <PanelButton store={store} id="reverb-on" className="pill small" led="green">
                  ON
                </PanelButton>
                <Legend className={`dim red-tag ${state.fxGlobal.reverb ? 'lit' : ''}`}>GLOBAL ▿</Legend>
              </span>
            </GroupBox>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

/* ----------------------------------------------- effect type LED tokens -- */

function mod1Token(type: string, row: 0 | 1): string | undefined {
  const map: Record<string, [number, string]> = {
    'Ring Mod': [0, 'RM'],
    Tremolo: [0, 'TREM'],
    'A-Pan': [0, 'A-PAN'],
    'A-Wah': [1, 'A-WAH'],
    Wah: [1, 'WAH'],
    Pump: [1, 'PUMP'],
  }
  const entry = map[type]
  return entry && entry[0] === row ? entry[1] : undefined
}

function mod2Token(type: string, row: 0 | 1): string | undefined {
  const map: Record<string, [number, string]> = {
    Chorus: [0, 'CHOR'],
    Flanger: [0, 'FLANG'],
    Phaser: [0, 'PHAS'],
    Vibe: [1, 'VIBE'],
    Ensemble: [1, 'ENS'],
    Spin: [1, 'SPIN'],
  }
  const entry = map[type]
  return entry && entry[0] === row ? entry[1] : undefined
}

function ampToken(type: string, row: 0 | 1): string | undefined {
  const map: Record<string, [number, string]> = {
    Small: [0, 'SMALL'],
    JC: [0, 'JC'],
    Twin: [0, 'TWIN'],
    'To Rotary': [1, 'TO ROTARY'],
    'LP24 Filter': [1, 'LP'],
    'HP24 Filter': [1, 'HP FILTER'],
  }
  const entry = map[type]
  return entry && entry[0] === row ? entry[1] : undefined
}

function delayEffectToken(effect: string): string | undefined {
  const map: Record<string, string> = { Chorus: 'CHOR', Vibe: 'VIBE', Ensemble: 'ENS', Flam: 'FLAM', Space: 'SPACE' }
  return map[effect]
}

function delayFilterToken(filter: string): string | undefined {
  const map: Record<string, string> = { 'High Pass': 'HP', 'Band Pass': 'BP', 'Low Pass': 'LP' }
  return map[filter]
}

function reverbToken(type: string): string {
  return type === 'Cathedral' ? 'CATH' : type.toUpperCase()
}
