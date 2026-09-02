import { Led } from '../controls/Led'
import { Dial } from '../controls/Knob'
import { Fader } from '../controls/Fader'
import { PanelButton, SelectorLeds } from '../controls/PanelButton'
import { At, Group, Lgd, SectionStrip } from '../layout'

/** Dark inset plate: layer faders, timbre, acoustics / kb touch / unison / dyn comp, piano select. */
export function PianoSection() {
  return (
    <>
      <At x={30} y={9} w={70} className="rail-legends">
        <Lgd>MIDI IN</Lgd>
        <Lgd>MIDI OUT</Lgd>
      </At>
      <div className="panel" style={{ left: '1.5%', width: '97%' }}>
        <SectionStrip title="PIANO" onId="piano.on" compact />
      </div>
      <At x={2.5} y={25} w={27} h={22} className="faders faders-wide">
        <Fader id="piano.layer-a.level" />
        <Fader id="piano.layer-b.level" />
      </At>
      <At x={1} y={48} w={31} className="layer-row">
        <span className="layer-cell">
          <span className="layer-name">
            <b>A</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="piano.layer-a.on" led="above" ledLegend="ON/OFF ▾" legendBelow={<Led legend="SUSTPED" small lit />} />
        </span>
        <span className="layer-cell">
          <span className="layer-name">
            <b>B</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="piano.layer-b.on" led="above" ledLegend="ON/OFF ▾" legendBelow={<Led legend="PSTICK" small />} />
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
        <span className="zone-leds">
          <Led small color="green" lit />
          <Led small color="green" lit />
          <Led small color="green" lit />
          <Led small color="green" lit />
        </span>
      </At>
      <At x={33} y={25} w={31} className="stack-block">
        <Lgd>ACOUSTICS</Lgd>
        <SelectorLeds id="piano.acoustics" layout="stack" labels={[null, 'SOFT REL', 'STRING RES', null]} className="acoustics-leds" />
        <PanelButton id="piano.acoustics" led="none" />
        <Led legend="PED NOISE ▽" small lit />
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
          <SelectorLeds id="piano.type" layout="matrix" labels={['ELECTRIC', 'UPRIGHT', 'GRAND', 'CLAV', 'DIGITAL', 'MISC']} />
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
