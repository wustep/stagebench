import { Led } from '../controls/Led'
import { Dial } from '../controls/Knob'
import { Fader } from '../controls/Fader'
import { PanelButton, SelectorLeds } from '../controls/PanelButton'
import { useEngineStatus, useInstrumentState } from '../context'
import { At, Group, Lgd, SectionStrip } from '../layout'
import { ZoneLeds } from '../ZoneLeds'

/**
 * Dark inset plate: layer faders, timbre, acoustics / kb touch / unison / dyn comp, piano select.
 * Every control here is functional through src/audio/instrumentController.ts; the LEDs show the canonical state
 * (focused layer blinks, SUSTPED / PSTICK, KB zones, type LED flashes when a model failed to load).
 */
export function PianoSection() {
  const piano = useInstrumentState((s) => s.piano)
  const fxFocus = useInstrumentState((s) => s.effects.focus)
  const status = useEngineStatus()
  const focusedStatus = status.layers[piano.focus]
  const bothOn = piano.layers.A.on && piano.layers.B.on
  return (
    <>
      <At x={30} y={9} w={70} className="rail-legends">
        <Lgd>MIDI IN</Lgd>
        <Lgd>MIDI OUT</Lgd>
      </At>
      <div className="panel" style={{ left: '1.5%', width: '97%' }}>
        <SectionStrip title="PIANO" onId="piano.on" compact fxLit={fxFocus === 'piano'} />
      </div>
      <At x={2.5} y={25} w={27} h={22} className="faders faders-wide">
        <Fader id="piano.layer-a.level" />
        <Fader id="piano.layer-b.level" />
      </At>
      <At x={1} y={48} w={31} className="layer-row">
        <span className="layer-cell" data-layer="A" data-focus={piano.focus === 'A'}>
          <span className="layer-name">
            <b>A</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="piano.layer-a.on" led="above" ledLegend="ON/OFF ▾" className={bothOn && piano.focus === 'A' ? 'is-focus' : ''} legendBelow={<Led legend="SUSTPED" small lit={piano.sustped} className="led-sustped" />} />
        </span>
        <span className="layer-cell" data-layer="B" data-focus={piano.focus === 'B'}>
          <span className="layer-name">
            <b>B</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="piano.layer-b.on" led="above" ledLegend="ON/OFF ▾" className={bothOn && piano.focus === 'B' ? 'is-focus' : ''} legendBelow={<Led legend="PSTICK" small lit={piano.pstick} className="led-pstick" />} />
        </span>
      </At>
      <At x={1} y={64.5} w={30} h={13} className="timbre">
        <span className="center">
          <Lgd>TIMBRE</Lgd>
        </span>
        <span className="timbre-body">
          <PanelButton id="piano.timbre" led="none" className="timbre-btn" />
          <SelectorLeds id="piano.timbre" layout="stack-right" labels={[null, 'SOFT', 'MID', 'BRIGHT', 'DYNO1', 'DYNO2']} className="timbre-leds" />
        </span>
      </At>
      <At x={1.5} y={81} w={30} className="octave-block">
        <Lgd>◀ OCTAVE SHIFT ▶</Lgd>
        <span className="octave-btns">
          <PanelButton id="piano.octave-down" led="none" />
          <PanelButton id="piano.octave-up" led="none" />
        </span>
        <Lgd>◀ KB ZONE ▶</Lgd>
        <ZoneLeds layer={piano.focus === 'A' ? 'pianoA' : 'pianoB'} />
      </At>
      <At x={33} y={25} w={31} className="stack-block">
        <Lgd>ACOUSTICS</Lgd>
        <SelectorLeds id="piano.acoustics" layout="stack" labels={[null, 'SOFT REL', 'STRING RES', null]} className="acoustics-leds" bits />
        <PanelButton id="piano.acoustics" led="none" />
        <Led legend="PED NOISE ▽" small />
      </At>
      <At x={66} y={25} w={32} className="stack-block">
        <Lgd>UNISON</Lgd>
        <SelectorLeds id="piano.unison" layout="stack" labels={[null, '1', '2', '3']} className="num-leds" />
        <PanelButton id="piano.unison" led="none" />
      </At>
      <At x={33} y={45} w={31} className="stack-block">
        <Lgd>KB TOUCH</Lgd>
        <SelectorLeds id="piano.kb-touch" layout="stack" labels={['HEAVY', 'MED', 'LIGHT']} className="touch-leds" />
        <PanelButton id="piano.kb-touch" led="none" />
      </At>
      <At x={66} y={45} w={32} className="stack-block">
        <Lgd>DYN COMP</Lgd>
        <SelectorLeds id="piano.dyn-comp" layout="stack" labels={[null, '1', '2', '3']} className="num-leds" />
        <PanelButton id="piano.dyn-comp" led="none" />
      </At>
      <Group title="PIANO SELECT" x={33} y={60} w={65} h={30.5} className="piano-select">
        <At x={3} y={10} w={94} h={30}>
          {/* printed order on the panel (photo): ELECTRIC / UPRIGHT / GRAND on the left, CLAV / DIGITAL / MISC on the right */}
          <SelectorLeds id="piano.type" layout="matrix" labels={['GRAND', 'UPRIGHT', 'ELECTRIC', 'CLAV', 'DIGITAL', 'MISC']} order={[2, 1, 0, 3, 4, 5]} className={`piano-type-leds${focusedStatus.state === 'fallback' ? ' is-flashing' : ''}`} />
        </At>
        <At x={20} y={43} w={60} className="center">
          <PanelButton id="piano.type" led="none" legendBelow="INFO" />
        </At>
        <At x={15} y={68} w={70} h={30} className="center">
          <Dial id="piano.model" size="medium" legend="MODEL" legendBox="LIST" />
        </At>
      </Group>
    </>
  )
}
