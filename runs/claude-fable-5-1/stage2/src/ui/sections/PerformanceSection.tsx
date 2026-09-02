import { InstrumentController } from '../../audio/instrumentController'
import { Led } from '../controls/Led'
import { Knob } from '../controls/Knob'
import { PitchStick, Wheel } from '../controls/Fader'
import { PanelButton, SelectorLeds } from '../controls/PanelButton'
import { useInstrumentState } from '../context'
import { At, Lgd } from '../layout'

/**
 * Exposed red chassis: pitch stick, mod wheel, master level, rotary speaker block, branding.
 * Phase 2: Master Level, the rotary Slow/Fast and Drive, and the pitch stick (for Piano layers with PSTICK)
 * are functional; the mod wheel, ORGAN routing and STOP MODE stay decorative until Phase 3.
 */
export function PerformanceSection() {
  const rotaryOn = useInstrumentState((s) => InstrumentController.routedToRotary(s, 'A') || InstrumentController.routedToRotary(s, 'B'))
  return (
    <>
      <At x={62} y={9} w={38} className="rail-legends">
        <Lgd>MONITOR IN</Lgd>
        <Lgd>HEADPHONES</Lgd>
      </At>
      <At x={72} y={15.5} w={24} className="center">
        <Lgd>MASTER LEVEL</Lgd>
      </At>
      <At x={76} y={20.5} w={16} h={13} className="center">
        <Knob id="performance.master-level" size="medium" legend="" />
      </At>
      <At x={21} y={28} w={22} h={12}>
        <PitchStick id="performance.pitch-stick" />
      </At>
      <At x={48.5} y={38} w={12} h={27}>
        <Wheel id="performance.mod-wheel" />
      </At>
      <At x={75} y={40} w={19.5} h={51} className="rotary">
        <span className="rotary-title">
          ROTARY
          <br />
          SPEAKER
        </span>
        <span className="rotary-on">
          <Lgd>ON</Lgd>
          <Led color="red" small lit={rotaryOn} className="led-rotary-on" />
        </span>
        <At x={6} y={9} w={88} h={22} className="center">
          <Knob id="performance.rotary.drive" size="small" legend="DRIVE" />
        </At>
        <At x={4} y={34} w={92} className="rotary-stack">
          <PanelButton id="performance.rotary.organ" led="above" ledLegend="ORGAN" legendBelow={<Led legend="CLOSE MIC ▽" small />} />
          <PanelButton id="performance.rotary.stop-mode" led="above" ledLegend="STOP MODE" legendBelow="ANGLE" />
          <SelectorLeds id="performance.rotary.speed" layout="row" color="green" labels={['SLOW', 'FAST']} />
          <PanelButton id="performance.rotary.speed" led="none" legendBelow={<Led legend="MORPH" small />} />
        </At>
      </At>
      <At x={20} y={78} w={55} className="logo">
        <span className="logo-word">
          nord <span className="logo-light">stage</span> <span className="logo-num">4</span>
        </span>
        <span className="logo-sub">HAMMER ACTION 73</span>
      </At>
    </>
  )
}
