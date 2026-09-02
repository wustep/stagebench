import { Led } from '../controls/Led'
import { Dial, Knob } from '../controls/Knob'
import { Fader } from '../controls/Fader'
import { PanelButton, SelectorLeds } from '../controls/PanelButton'
import { At, Group, Lgd, SectionStrip } from '../layout'
import { SynthOled } from '../Oled'

/** Dark inset plate: three layer faders, single narrow OLED with three dials, mode, waveform,
 *  arpeggiator/gate, voice, vibrato, LFO, oscillators, filter, amp, unison. */
export function SynthSection() {
  return (
    <>
      <At x={20} y={9} w={60} className="rail-legends rail-legends-synth">
        <Lgd>AC IN</Lgd>
        <Lgd>POWER ON/OFF</Lgd>
      </At>
      <div className="panel" style={{ left: '1%', width: '98%' }}>
        <SectionStrip title="SYNTH" onId="synth.on" fxLit />
      </div>
      <At x={1.5} y={25} w={23.5} h={23} className="faders">
        <Fader id="synth.layer-a.level" />
        <Fader id="synth.layer-b.level" />
        <Fader id="synth.layer-c.level" />
      </At>
      <At x={0.8} y={50} w={25.5} className="layer-row layer-row-3">
        <span className="layer-cell">
          <span className="layer-name">
            <b>A</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="synth.layer-a.on" led="above" ledLegend="ON/OFF ▾" legendBelow={<Led legend="SUSTPED" small lit />} />
        </span>
        <span className="layer-cell">
          <span className="layer-name">
            <b>B</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="synth.layer-b.on" led="above" ledLegend="ON/OFF ▾" legendBelow={<Led legend="PSTICK/RNG ▾" small lit />} />
        </span>
        <span className="layer-cell">
          <span className="layer-name">
            <b>C</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="synth.layer-c.on" led="above" ledLegend="ON/OFF ▾" legendBelow="PAN ▾" />
        </span>
      </At>
      <At x={1} y={65.5} w={16.5} className="hold-row">
        <PanelButton id="synth.kb-hold" led="above" ledLegend="KB HOLD" legendBelow={<Led legend="EXCLUDE ▽" small />} frame="red" />
        <PanelButton id="synth.arp-run" led="above" ledLegend="ARP RUN" legendBelow={<Led legend="KB SYNC ▾" small />} />
      </At>
      <At x={1.5} y={79} w={15} className="octave-block">
        <Lgd>◀ OCTAVE SHIFT ▶</Lgd>
        <span className="octave-btns">
          <PanelButton id="synth.octave-down" led="none" />
          <PanelButton id="synth.octave-up" led="none" />
        </span>
        <Lgd>◀ KB ZONE ▶</Lgd>
        <span className="zone-leds">
          <Led small />
          <Led small color="green" lit />
          <Led small color="green" lit />
          <Led small />
        </span>
      </At>
      <At x={31} y={25.5} w={23.5} h={16}>
        <SynthOled />
      </At>
      <At x={28} y={41.5} w={29} h={9} className="oled-lines" aria-hidden="true">
        <i />
        <i />
        <i />
      </At>
      <At x={29} y={50.5} w={28} h={12} className="dial-row">
        <Dial id="synth.dial-1" size="small" legend="INFO" />
        <Dial id="synth.dial-2" size="small" legend="LIST" />
        <Dial id="synth.dial-3" size="small" legend="LIST" />
      </At>
      <Group title="MODE" x={56} y={25} w={8.5} h={17} className="mode-group">
        <SelectorLeds id="synth.mode" layout="stack" labels={['ANALOG', 'SAMPLES', null]} className="mode-leds" />
        <PanelButton id="synth.mode" led="none" />
        <SelectorLeds id="synth.mode" layout="stack" labels={[null, null, 'EXTERN']} className="mode-leds" />
      </Group>
      <At x={56.5} y={44.5} w={8} className="center waveform-block">
        <Lgd>WAVEFORM</Lgd>
        <Led legend="KEEP EDITS ▾" small />
        <PanelButton id="synth.waveform" led="none" frame="red" legendBelow="SOUND INIT" />
      </At>
      <Group title="ARPEGGIATOR/GATE" x={66} y={25} w={33.5} h={18}>
        <At x={2} y={12} w={26} h={82} className="center">
          <Knob id="synth.arp.rate" size="small" legend="RATE/TIME" />
          <Lgd red>MST CLK</Lgd>
        </At>
        <At x={30} y={20} w={30} className="center">
          <SelectorLeds id="synth.arp.mode" layout="stack" labels={['ARP', 'POLY', 'GATE']} className="arp-leds" />
          <PanelButton id="synth.arp.mode" led="none" legendBelow={<Led legend="PATTERN ▽" small />} />
        </At>
        <At x={60} y={12} w={22} h={82} className="center">
          <Knob id="synth.arp.range" size="small" legend="RANGE" legendBox="ENV" />
        </At>
        <At x={82} y={16} w={17} className="center">
          <PanelButton id="synth.arp.menu" led="above" ledLegend="MENU" legendBelow="GROUP ▽" className="pbtn-vertical" />
        </At>
      </Group>
      <Group title="VOICE" x={66} y={44.5} w={18.5} h={18.5}>
        <At x={3} y={16} w={55} className="center">
          <SelectorLeds id="synth.voice.mode" layout="stack" labels={[null, 'MONO', 'LEGATO']} />
          <PanelButton id="synth.voice.mode" led="none" legendBelow={<span className="lo-hi"><Led legend="LO ▽" small /><Led legend="HI ▽" small /></span>} />
        </At>
        <At x={58} y={12} w={40} h={82} className="center">
          <Knob id="synth.voice.glide" size="small" legend="GLIDE" />
        </At>
      </Group>
      <Group title="VIBRATO" x={85.5} y={44.5} w={14} h={18.5}>
        <At x={2} y={14} w={66} className="center vib-block">
          <span className="vib-leds">
            <SelectorLeds id="synth.vibrato.mode" layout="stack" labels={[null, 'WHL', 'DLY', 'ON', null, null]} />
            <SelectorLeds id="synth.vibrato.mode" layout="stack" labels={[null, null, null, null, 'A.T.', 'PED']} />
          </span>
          <PanelButton id="synth.vibrato.mode" led="none" />
        </At>
        <At x={72} y={16} w={27} className="center">
          <PanelButton id="synth.vibrato.menu" led="above" ledLegend="MENU" className="pbtn-vertical" />
        </At>
      </Group>
      <Group title="LFO" x={18} y={65} w={20.5} h={25.5}>
        <At x={3} y={10} w={42} className="center">
          <PanelButton id="synth.lfo.waveform" led="above" ledLegend="WAVEFORM" frame="red" legendBelow={<Led legend="GROUP ▽" small />} />
        </At>
        <At x={54} y={6} w={44} h={42} className="center">
          <Knob id="synth.lfo.mod-amount" size="small" legend="MOD AMT" />
        </At>
        <At x={3} y={52} w={44} h={46} className="center">
          <Knob id="synth.lfo.rate" size="small" legend="RATE/TIME" />
          <Lgd red>MST CLK</Lgd>
        </At>
        <At x={52} y={52} w={46} className="center">
          <SelectorLeds id="synth.lfo.destination" layout="stack-right" labels={['OSC PITCH', 'OSC CTRL', 'FILTER']} />
          <PanelButton id="synth.lfo.destination" led="none" />
        </At>
      </Group>
      <Group title="OSCILLATORS" x={39.5} y={65} w={22.5} h={25.5}>
        <At x={2} y={10} w={48} className="center">
          <PanelButton id="synth.osc.pitch" led="above" ledLegend="PITCH/SMP" frame="red" legendBelow="ENV TO PITCH ▽" />
        </At>
        <At x={50} y={10} w={48} className="center">
          <PanelButton id="synth.osc.envelope" led="above" ledLegend="ENVELOPE" frame="red" legendBelow="VELOCITY ▽" />
        </At>
        <At x={2} y={52} w={48} h={46} className="center">
          <Knob id="synth.osc.ctrl" size="small" legend="OSC CTRL" />
        </At>
        <At x={50} y={52} w={48} h={46} className="center">
          <Knob id="synth.osc.env-amount" size="small" legend="ENV AMT" />
        </At>
      </Group>
      <Group title="FILTER" x={63} y={65} w={28} h={25.5}>
        <At x={2} y={10} w={30} className="center">
          <PanelButton id="synth.filter.type" led="above" ledLegend="TYPE" legendBelow="GROUP ▽" />
        </At>
        <At x={33} y={10} w={32} className="center">
          <PanelButton id="synth.filter.envelope" led="above" ledLegend="ENVELOPE" frame="red" legendBelow="VELOCITY ▽" />
        </At>
        <At x={66} y={4} w={30} h={46} className="center">
          <Knob id="synth.filter.env-amount" size="small" legend="ENV AMT" />
        </At>
        <At x={2} y={52} w={34} h={46} className="center">
          <Knob id="synth.filter.freq" size="small" legend="FREQ" />
        </At>
        <At x={36} y={52} w={34} h={46} className="center">
          <Knob id="synth.filter.resonance" size="small" legend="RES/FREQ HP" />
        </At>
        <At x={74} y={52} w={24} className="center">
          <PanelButton id="synth.filter.on" led="above" ledLegend="FILTER ON" />
        </At>
      </Group>
      <Group title="AMP" x={92} y={65} w={7.5} h={13.5}>
        <At x={2} y={10} w={96} className="center">
          <PanelButton id="synth.amp.envelope" led="above" ledLegend="ENVELOPE" frame="red" legendBelow={<span className="center"><Lgd>VELOCITY ▽</Lgd><span className="lo-hi"><Led small legend="1" /><Led small legend="2" lit /></span></span>} />
        </At>
      </Group>
      <Group title="UNISON" x={92} y={79.5} w={7.5} h={11}>
        <At x={2} y={10} w={96} className="center">
          <SelectorLeds id="synth.unison" layout="row" labels={[null, '1', '2', '3']} className="num-leds" />
          <PanelButton id="synth.unison" led="none" />
        </At>
      </Group>
    </>
  )
}
