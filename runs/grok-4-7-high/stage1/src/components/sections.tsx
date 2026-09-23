import { useSyncExternalStore, type ReactNode } from 'react'
import type { PianoEngine } from '../audio/engine'
import type { MidiInput } from '../input/midi'
import { DRAWBAR_COLORS, DRAWBAR_FOOTAGES, PROGRAM_BUTTON_LEGENDS } from '../model/hardware'
import { SECTIONS, VARIANT, type SectionId } from '../model/variant'
import type { PresentationStore } from '../state/presentation'
import { CycleLeds, Drawbar, Encoder, Fader, Knob, PanelButton, PitchStick, Wheel } from './controls'

const emptySubscribe = () => () => {}

function useStatus(engine: PianoEngine | null) {
  const status = useSyncExternalStore(
    engine ? engine.subscribe : emptySubscribe,
    () => engine?.getStatus() ?? 'idle',
    () => 'idle' as const,
  )
  const detail = useSyncExternalStore(
    engine ? engine.subscribe : emptySubscribe,
    () => engine?.getDetail() ?? 'tap a key to play',
    () => 'tap a key to play',
  )
  const voices = useSyncExternalStore(
    engine ? engine.subscribe : emptySubscribe,
    () => engine?.activeVoiceCount() ?? 0,
    () => 0,
  )
  return { status, detail, voices }
}

function useMidi(midi: MidiInput | null) {
  return useSyncExternalStore(
    midi ? midi.subscribe : emptySubscribe,
    () => midi?.getStatus() ?? 'idle',
    () => 'idle' as const,
  )
}

function ProgramOled({ engine, midi }: { engine: PianoEngine | null; midi: MidiInput | null }) {
  const { status, detail, voices } = useStatus(engine)
  const midiStatus = useMidi(midi)
  const word = status === 'idle' ? 'IDLE' : status.toUpperCase()
  return (
    <div
      className="oled program-oled"
      data-oled="program"
      role="status"
      aria-label="Program OLED"
      data-testid="engine-status"
      data-status={status}
      data-voices={voices}
      data-midi={midiStatus}
    >
      <p>STAGE 4 73</p>
      <p>PIANO {word}</p>
      <p>{detail}</p>
    </div>
  )
}

function SynthOled() {
  return (
    <div className="oled synth-oled" data-oled="synth" aria-label="Synth OLED">
      <p>SYNTH</p>
      <p>OFF</p>
      <p>decorative</p>
    </div>
  )
}

function SectionFrame({
  id,
  children,
}: {
  id: SectionId
  children: ReactNode
}) {
  const spec = SECTIONS.find((section) => section.id === id)!
  return (
    <section
      className={`section section-${id}`}
      data-section={id}
      data-fraction={spec.fraction}
      data-oled={spec.hasOled ? 'true' : 'false'}
      style={{ width: `${spec.fraction * 100}%` }}
      aria-label={spec.label}
    >
      {spec.insetPlate ? <div className="plate">{children}</div> : children}
    </section>
  )
}

function Performance({ store }: { store: PresentationStore }) {
  return (
    <SectionFrame id="performance">
      <div className="brand" aria-hidden="true">
        <span className="brand-nord">nord</span>
        <span className="brand-stage">stage 4</span>
      </div>
      <Knob store={store} id="perf-master-level" className="knob-lg">
        Master Level
      </Knob>
      <div className="wheel-row">
        <PitchStick store={store} id="perf-pitch-stick" />
        <Wheel store={store} id="perf-mod-wheel" />
      </div>
      <div className="rotary-block">
        <span className="group-tab">Rotary Speaker</span>
        <div className="rotary-row">
          <Knob store={store} id="rotary-drive" className="knob-sm">
            Drive
          </Knob>
          <PanelButton store={store} id="rotary-speed" className="btn-tiny">
            Slow/Fast
          </PanelButton>
          <PanelButton store={store} id="rotary-stop-mode" className="btn-tiny">
            Stop
          </PanelButton>
          <PanelButton store={store} id="rotary-source" className="btn-tiny">
            Organ
          </PanelButton>
        </div>
      </div>
    </SectionFrame>
  )
}

function Organ({ store }: { store: PresentationStore }) {
  return (
    <SectionFrame id="organ">
      <header className="title-band">
        <span>Organ</span>
        <PanelButton store={store} id="organ-on" className="btn-on">
          On
        </PanelButton>
      </header>
      <div className="organ-top">
        <div className="layer-pair">
          <Fader store={store} id="organ-level-a">
            A
          </Fader>
          <PanelButton store={store} id="organ-layer-a" className="btn-layer">
            A
          </PanelButton>
          <Fader store={store} id="organ-level-b">
            B
          </Fader>
          <PanelButton store={store} id="organ-layer-b" className="btn-layer">
            B
          </PanelButton>
        </div>
        <div className="organ-selectors">
          <div className="selector-block">
            <span className="group-tab">Model</span>
            <CycleLeds store={store} id="organ-model" />
            <PanelButton store={store} id="organ-model" className="btn-tiny">
              Model
            </PanelButton>
          </div>
          <div className="selector-block">
            <span className="group-tab">Vibrato</span>
            <CycleLeds store={store} id="organ-vib-select" />
            <div className="btn-row">
              <PanelButton store={store} id="organ-vib-select" className="btn-tiny">
                Select
              </PanelButton>
              <PanelButton store={store} id="organ-vib-on" className="btn-tiny">
                On
              </PanelButton>
            </div>
          </div>
          <div className="selector-block">
            <span className="group-tab">Percussion</span>
            <div className="btn-row">
              <PanelButton store={store} id="organ-perc-volume" className="btn-tiny">
                Soft
              </PanelButton>
              <PanelButton store={store} id="organ-perc-decay" className="btn-tiny">
                Fast
              </PanelButton>
              <PanelButton store={store} id="organ-perc-harmonic" className="btn-tiny">
                Third
              </PanelButton>
              <PanelButton store={store} id="organ-perc-on" className="btn-tiny">
                On
              </PanelButton>
            </div>
          </div>
        </div>
        <div className="octave-col">
          <PanelButton store={store} id="organ-octave-up" className="btn-tiny">
            Oct+
          </PanelButton>
          <PanelButton store={store} id="organ-preset" className="btn-tiny">
            Preset
          </PanelButton>
          <PanelButton store={store} id="organ-octave-down" className="btn-tiny">
            Oct−
          </PanelButton>
        </div>
      </div>
      <div className="drawbar-row">
        {DRAWBAR_FOOTAGES.map((footage, index) => (
          <Drawbar
            key={footage}
            store={store}
            id={`organ-drawbar-${index + 1}`}
            color={DRAWBAR_COLORS[index]}
          >
            {footage}
          </Drawbar>
        ))}
      </div>
    </SectionFrame>
  )
}

function Piano({ store }: { store: PresentationStore }) {
  return (
    <SectionFrame id="piano">
      <header className="title-band">
        <span>Piano</span>
        <PanelButton store={store} id="piano-on" className="btn-on">
          On
        </PanelButton>
      </header>
      <div className="layer-pair piano-layers">
        <Fader store={store} id="piano-level-a">
          A
        </Fader>
        <PanelButton store={store} id="piano-layer-a" className="btn-layer">
          A
        </PanelButton>
        <Fader store={store} id="piano-level-b">
          B
        </Fader>
        <PanelButton store={store} id="piano-layer-b" className="btn-layer">
          B
        </PanelButton>
      </div>
      <div className="piano-select">
        <span className="group-tab">Piano Select</span>
        <CycleLeds store={store} id="piano-type" className="cycle-stack" />
        <PanelButton store={store} id="piano-type" className="btn-tiny">
          Type
        </PanelButton>
        <Encoder store={store} id="piano-model" className="encoder-sm">
          Model
        </Encoder>
      </div>
      <div className="piano-details">
        <PanelButton store={store} id="piano-timbre" className="btn-tiny">
          Timbre
        </PanelButton>
        <PanelButton store={store} id="piano-kb-touch" className="btn-tiny">
          KB Touch
        </PanelButton>
        <PanelButton store={store} id="piano-dyn-comp" className="btn-tiny">
          Dyn Comp
        </PanelButton>
        <PanelButton store={store} id="piano-acoustics" className="btn-tiny">
          Acoustics
        </PanelButton>
        <PanelButton store={store} id="piano-unison" className="btn-tiny">
          Unison
        </PanelButton>
        <PanelButton store={store} id="piano-octave-down" className="btn-tiny">
          Oct−
        </PanelButton>
        <PanelButton store={store} id="piano-octave-up" className="btn-tiny">
          Oct+
        </PanelButton>
      </div>
    </SectionFrame>
  )
}

function Program({
  store,
  engine,
  midi,
}: {
  store: PresentationStore
  engine: PianoEngine | null
  midi: MidiInput | null
}) {
  return (
    <SectionFrame id="program">
      <ProgramOled engine={engine} midi={midi} />
      <div className="program-body">
        <div className="morph-row">
          <PanelButton store={store} id="morph-wheel" className="btn-tiny">
            Wheel
          </PanelButton>
          <PanelButton store={store} id="morph-at" className="btn-tiny">
            A.T.
          </PanelButton>
          <PanelButton store={store} id="morph-ctrlped" className="btn-tiny">
            Pedal
          </PanelButton>
        </div>
        <Encoder store={store} id="program-dial" className="encoder-lg">
          Program
        </Encoder>
        <div className="program-grid">
          {PROGRAM_BUTTON_LEGENDS.map((legend, index) => (
            <PanelButton key={legend} store={store} id={`program-${index + 1}`} className="btn-program">
              <b>{index + 1}</b>
              <small>{legend}</small>
            </PanelButton>
          ))}
        </div>
        <div className="program-nav">
          <PanelButton store={store} id="page-left" className="btn-tiny">
            Page−
          </PanelButton>
          <PanelButton store={store} id="live-mode" className="btn-tiny">
            Live
          </PanelButton>
          <PanelButton store={store} id="layer-scene" className="btn-tiny">
            Scene II
          </PanelButton>
          <PanelButton store={store} id="page-right" className="btn-tiny">
            Page+
          </PanelButton>
          <PanelButton store={store} id="store" className="btn-store">
            Store
          </PanelButton>
          <PanelButton store={store} id="split-onset" className="btn-tiny">
            Split
          </PanelButton>
          <PanelButton store={store} id="prog-view" className="btn-tiny">
            View
          </PanelButton>
          <PanelButton store={store} id="mstclk-tap" className="btn-tiny">
            Mst Clk
          </PanelButton>
          <PanelButton store={store} id="transpose-onset" className="btn-tiny">
            Transp
          </PanelButton>
          <PanelButton store={store} id="preset-organ" className="btn-tiny">
            Org
          </PanelButton>
          <PanelButton store={store} id="preset-piano" className="btn-tiny">
            Pno
          </PanelButton>
          <PanelButton store={store} id="preset-synth" className="btn-tiny">
            Syn
          </PanelButton>
          <PanelButton store={store} id="solo-undo" className="btn-tiny">
            Undo
          </PanelButton>
          <PanelButton store={store} id="section-edit" className="btn-tiny">
            Edit
          </PanelButton>
          <PanelButton store={store} id="mon-copy" className="btn-tiny">
            Copy
          </PanelButton>
          <PanelButton store={store} id="shift" className="btn-shift">
            Shift
          </PanelButton>
        </div>
      </div>
    </SectionFrame>
  )
}

function Synth({ store }: { store: PresentationStore }) {
  return (
    <SectionFrame id="synth">
      <header className="title-band">
        <span>Synth</span>
        <PanelButton store={store} id="synth-on" className="btn-on">
          On
        </PanelButton>
      </header>
      <div className="synth-layout">
        <div className="synth-col synth-layers">
          <SynthOled />
          <div className="layer-trio">
            <Fader store={store} id="synth-level-a">
              A
            </Fader>
            <Fader store={store} id="synth-level-b">
              B
            </Fader>
            <Fader store={store} id="synth-level-c">
              C
            </Fader>
          </div>
          <div className="btn-row">
            <PanelButton store={store} id="synth-layer-a" className="btn-layer">
              A
            </PanelButton>
            <PanelButton store={store} id="synth-layer-b" className="btn-layer">
              B
            </PanelButton>
            <PanelButton store={store} id="synth-layer-c" className="btn-layer">
              C
            </PanelButton>
          </div>
          <div className="dial-row">
            <Encoder store={store} id="synth-dial-1" className="encoder-xs" />
            <Encoder store={store} id="synth-dial-2" className="encoder-xs" />
            <Encoder store={store} id="synth-dial-3" className="encoder-xs" />
          </div>
        </div>
        <div className="synth-col synth-osc">
          <span className="group-tab">Oscillator</span>
          <PanelButton store={store} id="waveform-select" className="btn-wide">
            Waveform
          </PanelButton>
          <Knob store={store} id="osc-ctrl" className="knob-md">
            Osc Ctrl
          </Knob>
          <div className="btn-row">
            <PanelButton store={store} id="osc-pitch-smp" className="btn-tiny">
              Pitch
            </PanelButton>
            <PanelButton store={store} id="osc-envelope" className="btn-tiny">
              Env
            </PanelButton>
            <PanelButton store={store} id="synth-mode" className="btn-tiny">
              Mode
            </PanelButton>
          </div>
          <Knob store={store} id="osc-env-amt" className="knob-sm">
            Env Amt
          </Knob>
          <div className="btn-row">
            <PanelButton store={store} id="voice-mode" className="btn-tiny">
              Voice
            </PanelButton>
            <PanelButton store={store} id="synth-unison" className="btn-tiny">
              Unison
            </PanelButton>
          </div>
          <Knob store={store} id="glide" className="knob-sm">
            Glide
          </Knob>
        </div>
        <div className="synth-col synth-filter">
          <span className="group-tab">Filter</span>
          <Knob store={store} id="filter-freq" className="knob-lg">
            Freq
          </Knob>
          <div className="knob-pair">
            <Knob store={store} id="filter-res" className="knob-sm">
              Res
            </Knob>
            <Knob store={store} id="filter-env-amt" className="knob-sm">
              Env
            </Knob>
          </div>
          <div className="btn-row">
            <PanelButton store={store} id="filter-type" className="btn-tiny">
              Type
            </PanelButton>
            <PanelButton store={store} id="filter-on" className="btn-tiny">
              On
            </PanelButton>
            <PanelButton store={store} id="filter-envelope" className="btn-tiny">
              Env
            </PanelButton>
          </div>
          <span className="group-tab">Amp</span>
          <PanelButton store={store} id="amp-envelope" className="btn-wide">
            Amp Env
          </PanelButton>
          <div className="btn-row">
            <PanelButton store={store} id="synth-octave-down" className="btn-tiny">
              Oct−
            </PanelButton>
            <PanelButton store={store} id="synth-octave-up" className="btn-tiny">
              Oct+
            </PanelButton>
          </div>
        </div>
        <div className="synth-col synth-lfo">
          <span className="group-tab">LFO</span>
          <Knob store={store} id="lfo-rate" className="knob-md">
            Rate
          </Knob>
          <Knob store={store} id="lfo-mod-amt" className="knob-sm">
            Amount
          </Knob>
          <div className="btn-row">
            <PanelButton store={store} id="lfo-waveform" className="btn-tiny">
              Wave
            </PanelButton>
            <PanelButton store={store} id="lfo-destination" className="btn-tiny">
              Dest
            </PanelButton>
          </div>
          <div className="btn-row">
            <PanelButton store={store} id="vibrato-mode" className="btn-tiny">
              Vibrato
            </PanelButton>
            <PanelButton store={store} id="vibrato-menu" className="btn-tiny">
              Menu
            </PanelButton>
          </div>
          <span className="group-tab">Arp / Gate</span>
          <div className="knob-pair">
            <Knob store={store} id="arp-rate" className="knob-sm">
              Rate
            </Knob>
            <Knob store={store} id="arp-range" className="knob-sm">
              Range
            </Knob>
          </div>
          <div className="btn-row">
            <PanelButton store={store} id="arp-mode" className="btn-tiny">
              Mode
            </PanelButton>
            <PanelButton store={store} id="arp-menu" className="btn-tiny">
              Menu
            </PanelButton>
            <PanelButton store={store} id="arp-run" className="btn-tiny">
              Run
            </PanelButton>
            <PanelButton store={store} id="kb-hold" className="btn-tiny">
              Hold
            </PanelButton>
          </div>
        </div>
      </div>
    </SectionFrame>
  )
}

function Effects({ store }: { store: PresentationStore }) {
  return (
    <SectionFrame id="effects">
      <header className="title-band">
        <span>Layer Effects</span>
        <PanelButton store={store} id="effects-on" className="btn-on">
          On
        </PanelButton>
      </header>
      <div className="fx-focus">
        <PanelButton store={store} id="fx-focus-piano" className="btn-tiny">
          Piano
        </PanelButton>
        <PanelButton store={store} id="fx-focus-synth" className="btn-tiny">
          Synth
        </PanelButton>
        <PanelButton store={store} id="all-fx-off" className="btn-tiny">
          All Off
        </PanelButton>
        <PanelButton store={store} id="shift-2" className="btn-shift">
          Shift
        </PanelButton>
      </div>
      <div className="fx-groups">
        <div className="fx-group" data-group="modulators">
          <div className="fx-unit">
            <span className="group-tab">Mod 1</span>
            <div className="knob-pair">
              <Knob store={store} id="mod1-rate" className="knob-sm">
                Rate
              </Knob>
              <Knob store={store} id="mod1-amount" className="knob-sm">
                Amt
              </Knob>
            </div>
            <div className="btn-row">
              <PanelButton store={store} id="mod1-variation" className="btn-tiny">
                Var
              </PanelButton>
              <PanelButton store={store} id="mod1-on" className="btn-tiny">
                On
              </PanelButton>
            </div>
          </div>
          <div className="fx-unit">
            <span className="group-tab">Mod 2</span>
            <div className="knob-pair">
              <Knob store={store} id="mod2-rate" className="knob-sm">
                Rate
              </Knob>
              <Knob store={store} id="mod2-amount" className="knob-sm">
                Amt
              </Knob>
            </div>
            <div className="btn-row">
              <PanelButton store={store} id="mod2-variation" className="btn-tiny">
                Var
              </PanelButton>
              <PanelButton store={store} id="mod2-on" className="btn-tiny">
                On
              </PanelButton>
            </div>
          </div>
        </div>
        <div className="fx-gap" data-separator="effects" />
        <div className="fx-group" data-group="amp-space">
          <div className="fx-unit fx-amp">
            <span className="group-tab">Amp Sim / EQ</span>
            <div className="knob-pair">
              <Knob store={store} id="amp-drive" className="knob-sm">
                Drive
              </Knob>
              <Knob store={store} id="amp-freq" className="knob-sm">
                Freq
              </Knob>
            </div>
            <div className="eq-row">
              <Knob store={store} id="eq-bass" className="knob-xs">
                Bass
              </Knob>
              <Knob store={store} id="eq-mid" className="knob-xs">
                Mid
              </Knob>
              <Knob store={store} id="eq-treble" className="knob-xs">
                Treble
              </Knob>
            </div>
            <div className="btn-row">
              <PanelButton store={store} id="amp-variation" className="btn-tiny">
                Amp
              </PanelButton>
              <PanelButton store={store} id="amp-on" className="btn-tiny">
                On
              </PanelButton>
            </div>
          </div>
          <div className="fx-bottom">
            <div className="fx-unit">
              <span className="group-tab">Delay</span>
              <Knob store={store} id="delay-tempo" className="knob-sm">
                Tempo
              </Knob>
              <div className="knob-pair">
                <Knob store={store} id="delay-feedback" className="knob-xs">
                  Fdbk
                </Knob>
                <Knob store={store} id="delay-mix" className="knob-xs">
                  Mix
                </Knob>
              </div>
              <div className="btn-row">
                <PanelButton store={store} id="delay-variation" className="btn-tiny">
                  Var
                </PanelButton>
                <PanelButton store={store} id="delay-tap" className="btn-tiny">
                  Tap
                </PanelButton>
                <PanelButton store={store} id="delay-filter" className="btn-tiny">
                  Filter
                </PanelButton>
                <PanelButton store={store} id="delay-on" className="btn-tiny">
                  On
                </PanelButton>
              </div>
            </div>
            <div className="fx-unit fx-comp">
              <span className="group-tab">Comp</span>
              <Knob store={store} id="comp-amount" className="knob-sm">
                Amount
              </Knob>
              <PanelButton store={store} id="comp-on" className="btn-tiny">
                On
              </PanelButton>
            </div>
            <div className="fx-unit">
              <span className="group-tab">Reverb</span>
              <Knob store={store} id="reverb-mix" className="knob-sm">
                Mix
              </Knob>
              <div className="btn-row">
                <PanelButton store={store} id="reverb-bright" className="btn-tiny">
                  Bright
                </PanelButton>
                <PanelButton store={store} id="reverb-variation" className="btn-tiny">
                  Var
                </PanelButton>
                <PanelButton store={store} id="reverb-on" className="btn-tiny">
                  On
                </PanelButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionFrame>
  )
}

export function ControlDeck({
  store,
  engine,
  midi,
}: {
  store: PresentationStore
  engine: PianoEngine | null
  midi: MidiInput | null
}) {
  return (
    <div className="control-deck" data-testid="control-deck" data-split={VARIANT.vertical.controlDeck}>
      <Performance store={store} />
      <Organ store={store} />
      <Piano store={store} />
      <Program store={store} engine={engine} midi={midi} />
      <Synth store={store} />
      <Effects store={store} />
    </div>
  )
}
