import { useSyncExternalStore, type ReactNode } from 'react'
import { DRAWBAR_FOOTAGES, DRAWBAR_LEGENDS, PROGRAM_BUTTON_LEGENDS } from '../model/hardware'
import { SECTIONS } from '../model/variant'
import type { PresentationStore } from '../state/presentation'
import { usePresentationValue } from '../state/presentation'
import { timbreListFor, useInstrumentState, type InstrumentStore } from '../state/instrument'
import { instrumentsOfType } from '../audio/library'
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
}

function useEngineInfo(engine: PianoEngine): EngineStatusInfo {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getStatus(),
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
}: {
  title: string
  store: PresentationStore
  onId: string
  fxFocusLit?: boolean
}) {
  return (
    <div className="plate-header">
      <span className="plate-title">
        {title}
        <span className="plate-subtitle">SECTION</span>
      </span>
      <span className="fx-focus">
        <Led color="yellow" on={fxFocusLit} />
        <Legend>FX FOCUS</Legend>
      </span>
      <span className="on-cluster">
        <Legend>ON</Legend>
        <PanelButton store={store} id={onId} className="pill" led="green" />
        <Legend className="dim">SOLO ▾</Legend>
      </span>
    </div>
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
  return (
    <div className="layer-column" data-focused={focused ? 'true' : undefined}>
      <div className="layer-fader-row">
        <LedLadder count={9} lit={Math.round((level / 127) * 9)} />
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
  const anyRouted =
    !state.allFxOff &&
    (['A', 'B'] as const).some((layer) => state.chains[layer].ampEq.on && state.chains[layer].ampEq.type === 'To Rotary')
  return (
    <SectionShell id="performance">
      <div className="perf-layout">
        <div className="perf-main">
          <div className="perf-master">
            <Legend>MASTER LEVEL</Legend>
            <Knob store={store} id="perf-master-level" className="large" />
          </div>
          <div className="perf-wheels">
            <div className="perf-wheel-slot">
              <PitchStick store={store} id="perf-pitch-stick" />
            </div>
            <div className="perf-wheel-slot">
              <Wheel store={store} id="perf-mod-wheel" />
            </div>
          </div>
          <div className="branding" aria-hidden="true">
            <span className="brand-script">nord</span>
            <span className="brand-model">stage 4</span>
            <span className="brand-sub">HAMMER ACTION 73</span>
          </div>
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
            <Led color="yellow" />
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
    </SectionShell>
  )
}

/* ---------------------------------------------------------------- Organ -- */

function DrawbarColumn({ store, index }: { store: PresentationStore; index: number }) {
  const id = `organ-drawbar-${index + 1}`
  const value = usePresentationValue(store, id)
  const color = [0, 1].includes(index) ? 'brown' : [2, 3, 5, 8].includes(index) ? 'white' : 'black'
  return (
    <div className="drawbar-column">
      <Legend className="drawbar-name">{DRAWBAR_LEGENDS[index]}</Legend>
      <div className="drawbar-row">
        <LedLadder count={8} lit={value} color="red" fill="down" className="drawbar-ladder" />
        <Drawbar store={store} id={id} className={`cap-${color}`} />
      </div>
      <Legend className="drawbar-footage">{DRAWBAR_FOOTAGES[index]}</Legend>
    </div>
  )
}

export function OrganSection({ store }: SectionProps) {
  return (
    <SectionShell id="organ">
      <div className="plate">
        <SectionHeader title="ORGAN" store={store} onId="organ-on" />
        <div className="organ-body">
          <div className="levels-column">
            <div className="layer-pair">
              <LayerFaderColumn store={store} faderId="organ-level-a" buttonId="organ-layer-a" letter="A" />
              <LayerFaderColumn store={store} faderId="organ-level-b" buttonId="organ-layer-b" letter="B" />
            </div>
            <span className="tiny-led-row">
              <Led color="yellow" />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" />
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
            <span className="kb-zone" aria-hidden="true">
              <Legend>◂ KB ZONE ▸</Legend>
              <span className="zone-leds">
                <Led color="green" on />
                <Led color="green" />
                <Led color="green" />
                <Led color="green" />
              </span>
            </span>
          </div>
          <div className="organ-main">
            <div className="organ-groups">
              <GroupBox title="Organ Model" className="organ-model">
                <div className="model-led-grid" aria-hidden="true">
                  <span>
                    <Legend>FARF</Legend>
                    <Led color="red" />
                    <Led color="red" />
                    <Legend>PIPE1</Legend>
                  </span>
                  <span>
                    <Legend>VOX</Legend>
                    <Led color="red" />
                    <Led color="red" />
                    <Legend>PIPE2</Legend>
                  </span>
                  <span>
                    <Legend>B3</Legend>
                    <Led color="red" on />
                    <Led color="red" />
                    <Legend>B3 BASS</Legend>
                  </span>
                </div>
                <PanelButton store={store} id="organ-model" className="dark small" />
              </GroupBox>
              <GroupBox title="Vib/Chorus" className="organ-vib">
                <div className="model-led-grid" aria-hidden="true">
                  <span>
                    <Led color="red" />
                    <Legend>C1 V1</Legend>
                  </span>
                  <span>
                    <Led color="red" />
                    <Legend>C2 V2</Legend>
                  </span>
                  <span>
                    <Led color="red" />
                    <Legend>C3 V3</Legend>
                  </span>
                </div>
                <PanelButton store={store} id="organ-vib-select" className="dark small" />
                <span className="tiny-led-row">
                  <Led color="green" />
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

export function PianoSection({ store, instrument, engine }: BoundSectionProps & { engine: PianoEngine }) {
  const state = useInstrumentState(instrument)
  useEngineInfo(engine) // re-render on load-status changes for the SUSTPED/selection feedback
  const focused = state.layers[state.focusedLayer]
  const timbreList = timbreListFor(focused.type)
  const timbre = timbreList[Math.min(state.piano.timbre, timbreList.length - 1)]!
  const sustainDown = engine.isSustainDown()
  return (
    <SectionShell id="piano">
      <div className="plate">
        <SectionHeader title="PIANO" store={store} onId="piano-on" fxFocusLit />
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
              <Led color="yellow" on={sustainDown} />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" on={engine.pitchBendValue() !== 0} />
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
            <span className="kb-zone" aria-hidden="true">
              <Legend>◂ KB ZONE ▸</Legend>
              <span className="zone-leds">
                <Led color="green" on />
                <Led color="green" />
                <Led color="green" />
                <Led color="green" />
              </span>
            </span>
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
                  <Led color="red" on={focused.type === 'Electric'} />
                  <Led color="red" on={focused.type === 'Clav'} className={state.pianoNotFound === 'Clav' ? 'flash' : ''} />
                  <Legend>CLAV</Legend>
                </span>
                <span>
                  <Legend>UPRIGHT</Legend>
                  <Led color="red" on={focused.type === 'Upright'} />
                  <Led
                    color="red"
                    on={focused.type === 'Digital'}
                    className={state.pianoNotFound === 'Digital' ? 'flash' : ''}
                  />
                  <Legend>DIGITAL</Legend>
                </span>
                <span>
                  <Legend>GRAND</Legend>
                  <Led color="red" on={focused.type === 'Grand'} />
                  <Led color="red" on={focused.type === 'Misc'} className={state.pianoNotFound === 'Misc' ? 'flash' : ''} />
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
  return (
    <SectionShell id="program">
      <div className="program-layout">
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
        <div className="program-top-row">
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
              <Legend>STORE</Legend>
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
          </div>
          <div className="program-mid-right">
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
                <span key="p" className="oled-program">A:11</span>,
                <b key="n" className="oled-name">Nord Stage 4</b>,
                <span key="piano" className="oled-slot" data-testid="oled-piano-line">
                  ▤ {pianoLine}
                </span>,
                <span key="status" className="oled-slot" data-testid="oled-status-line">
                  {statusLine || '〜 Piano · FX ready'}
                </span>,
                <span key="edit" className="oled-slot oled-edit" data-testid="oled-edit-line">
                  {state.lastEdit || '◫ —'}
                </span>,
              ]}
            />
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
        </div>
        <GroupBox title="Program" className="program-grid-box">
          <div className="program-grid">
            {PROGRAM_BUTTON_LEGENDS.map((legend, i) => (
              <span key={legend} className="program-cell">
                <span className="prog-num" aria-hidden="true">
                  <Led color="red" on={i === 0} />
                  {i + 1}
                </span>
                <PanelButton store={store} id={`program-${i + 1}`} className="dark tiny" />
                <Legend className="dim">{legend.toUpperCase()}</Legend>
              </span>
            ))}
          </div>
        </GroupBox>
        <div className="program-utility">
          <PanelButton store={store} id="prog-view" className="dark tiny">
            PROG VIEW
          </PanelButton>
          <PanelButton store={store} id="solo-undo" className="dark tiny">
            SOLO UNDO
          </PanelButton>
          <PanelButton store={store} id="section-edit" className="dark tiny">
            SECTION EDIT ⇕
          </PanelButton>
          <PanelButton store={store} id="layer-init" className="dark tiny">
            LAYER INIT
          </PanelButton>
          <PanelButton store={store} id="mon-copy" className="dark tiny">
            MON|COPY PASTE ⇕
          </PanelButton>
          <span className="shift-cluster">
            <Legend>SHIFT</Legend>
            <PanelButton store={store} id="shift" className="rocker" />
            <Legend className="dim">EXIT</Legend>
          </span>
        </div>
      </div>
    </SectionShell>
  )
}

/* ---------------------------------------------------------------- Synth -- */

export function SynthSection({ store }: SectionProps) {
  return (
    <SectionShell id="synth">
      <div className="plate">
        <SectionHeader title="SYNTH" store={store} onId="synth-on" />
        <div className="synth-body">
          <div className="levels-column">
            <div className="layer-pair triple">
              <LayerFaderColumn store={store} faderId="synth-level-a" buttonId="synth-layer-a" letter="A" />
              <LayerFaderColumn store={store} faderId="synth-level-b" buttonId="synth-layer-b" letter="B" />
              <LayerFaderColumn store={store} faderId="synth-level-c" buttonId="synth-layer-c" letter="C" />
            </div>
            <span className="tiny-led-row">
              <Led color="red" />
              <Legend>SUSTPED</Legend>
              <Led color="yellow" />
              <Legend>PSTICK/RNG ▿</Legend>
            </span>
            <span className="hold-row">
              <span className="hold-cell">
                <span className="tiny-led-row">
                  <Led color="red" />
                  <Legend>KB HOLD</Legend>
                </span>
                <PanelButton store={store} id="kb-hold" className="dark tiny" />
                <Legend className="dim">EXCLUDE ▿</Legend>
              </span>
              <span className="hold-cell">
                <span className="tiny-led-row">
                  <Legend>ARP RUN</Legend>
                </span>
                <PanelButton store={store} id="arp-run" className="red tiny" />
                <Legend className="dim">KB SYNC ▿</Legend>
              </span>
            </span>
            <span className="octave-row">
              <Legend>◂ OCTAVE SHIFT ▸</Legend>
              <span className="octave-buttons">
                <PanelButton store={store} id="synth-octave-down" className="dark tiny" />
                <PanelButton store={store} id="synth-octave-up" className="dark tiny" />
              </span>
            </span>
            <span className="kb-zone" aria-hidden="true">
              <Legend>◂ KB ZONE ▸</Legend>
              <span className="zone-leds">
                <Led color="green" on />
                <Led color="green" on />
                <Led color="green" />
              </span>
            </span>
          </div>
          <div className="synth-main">
            <div className="synth-top">
              <div className="synth-display-block">
                <Oled
                  section="synth"
                  lines={[
                    <span key="t" className="oled-dim">OSC WAVEFORM</span>,
                    <b key="w" className="oled-name">Super Saw</b>,
                    <span key="d">DETUNE: 3.4</span>,
                    <span key="m" className="oled-menu">
                      <span>ANALOG <b>TYPE</b></span>
                      <span>SUPER <b>CAT</b></span>
                      <span>1(S) <b>WAVE</b></span>
                    </span>,
                  ]}
                />
                <div className="synth-dials">
                  <span className="synth-dial">
                    <Encoder store={store} id="synth-dial-1" className="small" />
                    <Legend className="dim">INFO</Legend>
                  </span>
                  <span className="synth-dial">
                    <Encoder store={store} id="synth-dial-2" className="small" />
                    <Legend className="dim">LIST</Legend>
                  </span>
                  <span className="synth-dial">
                    <Encoder store={store} id="synth-dial-3" className="small" />
                    <Legend className="dim">LIST</Legend>
                  </span>
                </div>
              </div>
              <div className="mode-column">
                <GroupBox title="Mode" className="mode-box">
                  <span className="tiny-led-row">
                    <Led color="yellow" on />
                    <Legend>SAMPLES</Legend>
                  </span>
                  <span className="tiny-led-row">
                    <Led color="red" />
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
                      <Legend className="dim red-tag">◂ MST CLK</Legend>
                    </span>
                    <span className="arp-mode-cell">
                      <span className="tiny-led-row">
                        <Legend>POLY ▾</Legend>
                        <Led color="green" />
                        <Legend>GATE</Legend>
                      </span>
                      <PanelButton store={store} id="arp-mode" className="dark tiny" led="green" />
                      <Legend className="dim">PATTERN ▿</Legend>
                    </span>
                    <span className="knob-cell">
                      <Knob store={store} id="arp-range" className="small" />
                      <Legend>RANGE ENV</Legend>
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
                    <span className="tiny-led-row">
                      <Led color="red" />
                      <Legend>MONO</Legend>
                    </span>
                    <span className="tiny-led-row">
                      <Led color="red" />
                      <Legend>LEGATO</Legend>
                    </span>
                    <PanelButton store={store} id="voice-mode" className="dark tiny" />
                    <span className="knob-cell">
                      <Knob store={store} id="glide" className="small" />
                      <Legend>GLIDE</Legend>
                      <Legend className="dim">LO ▿ HI ▿</Legend>
                    </span>
                  </GroupBox>
                  <GroupBox title="Vibrato" className="vibrato-box">
                    <span className="tiny-led-row">
                      <Legend>WHL DLY A.T. PED</Legend>
                    </span>
                    <PanelButton store={store} id="vibrato-mode" className="dark tiny" led="green">
                      ON
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
                <PanelButton store={store} id="lfo-waveform" className="dark tiny" led="green">
                  WAVEFORM
                </PanelButton>
                <Legend className="dim">GROUP ▿</Legend>
                <span className="knob-cell">
                  <Knob store={store} id="lfo-rate" className="small" />
                  <Legend>RATE/<wbr />TIME</Legend>
                  <Legend className="dim red-tag">◂ MST CLK</Legend>
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
                  <PanelButton store={store} id="osc-envelope" className="red tiny">
                    ENVELOPE
                  </PanelButton>
                </span>
                <Legend className="dim">ENV TO PITCH ▿ · VELOCITY ▿</Legend>
                <span className="knob-pair">
                  <span className="knob-cell">
                    <Knob store={store} id="osc-ctrl" />
                    <Legend>OSC CTRL</Legend>
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
                  <PanelButton store={store} id="filter-envelope" className="red tiny">
                    ENVELOPE
                  </PanelButton>
                </span>
                <Legend className="dim">GROUP ▿ · VELOCITY ▿</Legend>
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
                  <PanelButton store={store} id="amp-envelope" className="red tiny">
                    ENVELOPE
                  </PanelButton>
                  <Legend className="dim">VELOCITY ▿</Legend>
                </GroupBox>
                <GroupBox title="Unison" className="unison-box">
                  <span className="tiny-led-row" aria-hidden="true">
                    <Legend>2</Legend>
                    <Led color="red" />
                    <Legend>3</Legend>
                  </span>
                  <span className="tiny-led-row" aria-hidden="true">
                    <Legend>1</Legend>
                    <Led color="red" />
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

export function EffectsSection({ store, instrument }: BoundSectionProps) {
  const state = useInstrumentState(instrument)
  const chain = state.chains[state.focusedLayer]
  return (
    <SectionShell id="effects">
      <div className="plate">
        <div className="plate-header">
          <span className="plate-title">LAYER EFFECTS</span>
          <span className="on-cluster">
            <Legend>ON</Legend>
            <PanelButton store={store} id="effects-on" className="pill" led="green" />
          </span>
        </div>
        <div className="effects-body">
          <div className="fx-focus-column" role="group" aria-label="FX Focus">
            <Legend className="group-label">FX FOCUS</Legend>
            <span className="focus-cell">
              <Legend>ORGAN</Legend>
              <span className="tiny-led-row" aria-hidden="true">
                <Led color="green" />
                <Legend>A</Legend>
                <Led color="green" />
                <Legend>B</Legend>
              </span>
              <PanelButton store={store} id="all-fx-off" className="dark tiny">
                ALL FX OFF
              </PanelButton>
            </span>
            <span className="focus-cell">
              <Legend>PIANO</Legend>
              <span className="tiny-led-row" aria-hidden="true">
                <Led color="green" on={state.focusedLayer === 'A' || state.fxGroupPiano} />
                <Legend>A</Legend>
                <Led color="green" on={state.focusedLayer === 'B' || state.fxGroupPiano} />
                <Legend>B</Legend>
              </span>
              <PanelButton store={store} id="fx-focus-piano" className="dark tiny">
                GROUP ▿
              </PanelButton>
            </span>
            <span className="focus-cell">
              <Legend>SYNTH</Legend>
              <span className="tiny-led-row" aria-hidden="true">
                <Led color="green" />
                <Legend>A</Legend>
                <Led color="green" />
                <Legend>B</Legend>
                <Led color="green" />
                <Legend>C</Legend>
              </span>
              <PanelButton store={store} id="fx-focus-synth" className="dark tiny">
                GROUP ▿
              </PanelButton>
            </span>
          </div>
          <div className="effects-grid">
            <GroupBox title="Mod 1" className="fx-box mod1-box">
              <span className="knob-cell">
                <Knob store={store} id="mod1-rate" className="small" />
                <Legend>RATE <i className="dim">SENS</i></Legend>
                <Legend className="dim red-tag">◂ MST CLK</Legend>
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
                <Legend className="dim red-tag">◂ MST CLK</Legend>
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
