import { Led } from '../controls/Led'
import { Knob } from '../controls/Knob'
import { PanelButton, SelectorLeds } from '../controls/PanelButton'
import { At, Group, Lgd, SectionStrip } from '../layout'

/** Dark inset plate: FX focus column, Mod 1 / Mod 2, Amp Sim/EQ, Delay, Comp, Reverb. */
export function EffectsSection() {
  return (
    <>
      <div className="panel" style={{ left: '0.5%', width: '87.5%' }}>
        <SectionStrip title="LAYER EFFECTS" onId="effects.on" fxFocus={false} wide />
      </div>
      <At x={1.5} y={24.5} w={10} h={66} className="fx-focus">
        <Lgd>FX FOCUS</Lgd>
        <span className="fx-item">
          <Led legend="ORGAN" small side="above" />
          <span className="fx-ab">
            <Lgd>A</Lgd>
            <Lgd>B</Lgd>
          </span>
          <PanelButton id="effects.focus.organ" led="none" legendBelow="ALL FX OFF" />
        </span>
        <span className="fx-item">
          <Lgd>PIANO</Lgd>
          <span className="fx-ab">
            <Led small lit legend="A" side="above" />
            <Led small legend="B" side="above" />
          </span>
          <PanelButton id="effects.focus.piano" led="none" legendBelow="GROUP ▽" />
        </span>
        <span className="fx-item">
          <Lgd>SYNTH</Lgd>
          <span className="fx-ab">
            <Led small color="yellow" lit legend="A" side="above" />
            <Led small color="yellow" lit legend="B" side="above" />
            <Led small color="yellow" lit legend="C" side="above" />
          </span>
          <PanelButton id="effects.focus.synth" led="none" legendBelow="GROUP ▽" />
        </span>
        <span className="group light-frame shift-frame center fx-shift">
          <PanelButton id="effects.shift" led="none" legendAbove="SHIFT" legendBelow="EXIT" />
        </span>
      </At>
      <Group title="MOD 1" x={12} y={25} w={40} h={18.5}>
        <At x={1} y={8} w={24} h={72} className="center">
          <Knob id="effects.mod1.rate" size="small" legend="RATE" legendBox="SENS" />
          <Lgd red>MST CLK</Lgd>
        </At>
        <At x={25} y={8} w={24} h={72} className="center">
          <Knob id="effects.mod1.amount" size="small" legend="AMOUNT" />
        </At>
        <At x={50} y={10} w={37} h={48}>
          <SelectorLeds id="effects.mod1.type" layout="matrix" labels={['RM', 'TREM', 'A-PAN', 'A-WAH', 'WAH', 'PUMP']} />
        </At>
        <At x={53} y={62} w={32} className="center">
          <PanelButton id="effects.mod1.type" led="left" ledLegend="" legendBelow={<span className="lgd-tight">VARIATION PED ▽</span>} />
        </At>
        <At x={88} y={18} w={11} className="center">
          <PanelButton id="effects.mod1.on" led="above" ledLegend="ON" />
        </At>
      </Group>
      <Group title="MOD 2" x={12} y={44} w={40} h={17}>
        <At x={1} y={8} w={24} h={72} className="center">
          <Knob id="effects.mod2.rate" size="small" legend="RATE" />
        </At>
        <At x={25} y={8} w={24} h={72} className="center">
          <Knob id="effects.mod2.amount" size="small" legend="AMOUNT" />
        </At>
        <At x={50} y={10} w={37} h={48}>
          <SelectorLeds id="effects.mod2.type" layout="matrix" labels={['CHOR', 'FLANG', 'PHAS', 'VIBE', 'ENS', 'SPIN']} />
        </At>
        <At x={53} y={63} w={32} className="center">
          <PanelButton id="effects.mod2.type" led="left" ledLegend="" legendBelow="VARIATION ▽" />
        </At>
        <At x={88} y={18} w={11} className="center">
          <PanelButton id="effects.mod2.on" led="above" ledLegend="ON" />
        </At>
      </Group>
      <Group title="AMP SIM/EQ" x={12} y={61.5} w={40} h={29}>
        <At x={1} y={5} w={24} h={44} className="center">
          <Knob id="effects.amp.drive" size="small" legend="DRIVE" />
        </At>
        <At x={25} y={5} w={24} h={44} className="center">
          <Knob id="effects.amp.freq" size="small" legend="FREQ" legendBox="FREQ" />
        </At>
        <At x={50} y={6} w={37} h={34}>
          <SelectorLeds id="effects.amp.model" layout="matrix" labels={['SMALL', 'JC', 'TWIN', 'TO ROTARY', 'LP FILTER', 'HP FILTER']} />
        </At>
        <At x={53} y={42} w={32} className="center">
          <PanelButton id="effects.amp.model" led="left" ledLegend="" legendBelow="VARIATION ▽" />
        </At>
        <At x={1} y={54} w={30} h={44} className="center">
          <Knob id="effects.amp.bass" size="small" legend="BASS" />
        </At>
        <At x={30} y={54} w={30} h={44} className="center">
          <Knob id="effects.amp.mid" size="small" legend="MID" legendBox="RES" />
        </At>
        <At x={59} y={54} w={30} h={44} className="center">
          <Knob id="effects.amp.treble" size="small" legend="TREBLE" />
        </At>
        <At x={88} y={58} w={11} className="center">
          <PanelButton id="effects.amp.on" led="above" ledLegend="ON" />
        </At>
      </Group>
      <Group title="DELAY" x={53} y={25} w={34.5} h={36}>
        <At x={2} y={8} w={30} h={40} className="center">
          <Knob id="effects.delay.tempo" size="small" legend="TEMPO" />
          <Lgd red>MST CLK</Lgd>
        </At>
        <At x={34} y={5} w={34} className="center">
          <Lgd>EFFECTS</Lgd>
          <span className="delay-fx">
            <SelectorLeds id="effects.delay.effect" layout="stack" labels={[null, 'CHOR', 'VIBE', 'ENS', null, null]} />
            <SelectorLeds id="effects.delay.effect" layout="stack" labels={[null, null, null, null, 'FLAM', 'SPACE']} />
          </span>
          <PanelButton id="effects.delay.effect" led="none" legendBelow={<Led legend="VARIATION ▽" small />} />
        </At>
        <At x={68} y={4} w={30} h={34} className="center">
          <Knob id="effects.delay.feedback" size="small" legend="FEEDBACK" />
        </At>
        <At x={68} y={40} w={30} className="center">
          <Lgd>FILTER</Lgd>
          <span className="delay-fx">
            <SelectorLeds id="effects.delay.filter" layout="stack" labels={[null, 'HP', null, 'LP']} />
            <SelectorLeds id="effects.delay.filter" layout="stack" labels={[null, null, 'BP', null]} />
          </span>
          <PanelButton id="effects.delay.filter" led="none" legendBelow={<span className="lgd-xs">PING PONG ▽</span>} />
        </At>
        <At x={2} y={56} w={30} h={40} className="group light-frame center tap-frame">
          <PanelButton id="effects.delay.tap" led="above" ledLegend="TAP/SET ▾" legendBelow={<Led legend="ANALOG ▽" small />} />
        </At>
        <At x={34} y={54} w={34} h={42} className="center">
          <Knob id="effects.delay.dry-wet" size="small" legend="DRY WET" />
        </At>
        <At x={68} y={74} w={30} className="center">
          <PanelButton id="effects.delay.on" led="left" ledLegend="ON" legendBelow={<Led legend="GLOBAL ▽" small />} />
        </At>
      </Group>
      <Group title="COMP" x={53} y={61.5} w={12.5} h={29}>
        <At x={2} y={9} w={96} h={52} className="center">
          <Led legend="ACTIVE" small />
          <Knob id="effects.comp.amount" size="small" legend="AMOUNT" />
          <Led legend="FAST" small />
        </At>
        <At x={2} y={66} w={96} className="center">
          <PanelButton id="effects.comp.on" led="left" ledLegend="ON" legendBelow={<Led legend="GLOBAL ▽" small />} />
        </At>
      </Group>
      <Group title="REVERB" x={66.5} y={61.5} w={21} h={29}>
        <At x={0} y={8} w={38} className="center reverb-tone">
          <SelectorLeds id="effects.reverb.tone" layout="stack" labels={[null, 'BRIGHT', 'DARK']} />
          <PanelButton id="effects.reverb.tone" led="none" />
        </At>
        <At x={39} y={6} w={61} h={38}>
          <SelectorLeds id="effects.reverb.type" layout="matrix" labels={['ROOM', 'BOOTH', 'SPRING', 'STAGE', 'HALL', 'CATH']} />
        </At>
        <At x={44} y={45} w={54} className="center">
          <PanelButton id="effects.reverb.type" led="right" ledLegend="" legendBelow={<span className="lgd-xs">VAR | CHORALE ▽</span>} />
        </At>
        <At x={2} y={56} w={44} h={42} className="center">
          <Knob id="effects.reverb.dry-wet" size="small" legend="DRY WET" />
        </At>
        <At x={50} y={64} w={48} className="center">
          <PanelButton id="effects.reverb.on" led="left" ledLegend="ON" legendBelow={<Led legend="GLOBAL ▽" small />} />
        </At>
      </Group>
      <At x={88.3} y={26} w={2} h={64} className="handmade" aria-hidden="true">
        HANDMADE IN SWEDEN BY CLAVIA DMI AB · v2.0 Rev.B
      </At>
    </>
  )
}
