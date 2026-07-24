import { useControl } from '../../state/HardwareContext'
import { At } from '../Primitives'
import { KNOB_TICKS_0_10, Knob, Led, PanelButton, SelectorPad } from '../controls/PanelControls'

const EQ_TICKS = ['-15', '-10', '-5', '0', '5', '10', '15'] as const
const FREQ_TICKS = ['200', '250', '400', '600', '1K', '2K', '4K', '6K', '8K'] as const

const MOD1_LEFT = ['RM', 'TREM', 'A-PAN'] as const
const MOD1_RIGHT = ['A-WAH', 'WAH', 'PUMP'] as const
const MOD2_LEFT = ['CHOR', 'FLANG', 'PHAS'] as const
const MOD2_RIGHT = ['VIBE', 'ENS', 'SPIN'] as const
const AMP_LEFT = ['SMALL', 'JC', 'TWIN'] as const
const AMP_RIGHT = ['TO ROTARY', 'LP FILTER', 'HP FILTER'] as const
const REVERB_LEFT = ['ROOM', 'BOOTH', 'SPRING'] as const
const REVERB_RIGHT = ['STAGE', 'HALL', 'CATH'] as const

/** Panel print order for the six-way selectors: left column top-down, then right column. */
const MOD1_ORDER = ['RM', 'Trem', 'A-Pan', 'A-Wah', 'Wah', 'Pump']
const MOD2_ORDER = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
const AMP_ORDER = ['Small', 'JC', 'Twin', 'To Rotary', 'LP Filter', 'HP Filter']
const REVERB_ORDER = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']

function SixWay({
  left,
  right,
  order,
  current,
}: {
  left: readonly string[]
  right: readonly string[]
  order: readonly string[]
  current: string
}) {
  const active = order.indexOf(current)
  return (
    <span className="model-select model-select--tight">
      <span className="model-select__col">
        {left.map((label, index) => (
          <span key={label} className={`legend${active === index ? ' legend--active' : ''}`}>
            {label}
          </span>
        ))}
      </span>
      <SelectorPad count={6} active={active} />
      <span className="model-select__col">
        {right.map((label, index) => (
          <span key={label} className={`legend boxed${active === index + 3 ? ' legend--active' : ''}`}>
            {label}
          </span>
        ))}
      </span>
    </span>
  )
}

/**
 * Layer Effects. Two effect groups (Mod 1, Mod 2), Amp Sim/EQ, Delay, Comp and Reverb, plus the
 * FX Focus column — the landmarks `sectionLandmarks.effects` requires. No OLED here, which the
 * same spec entry forbids.
 */
export function EffectsSection() {
  const mod1 = useControl('fx.mod1.type')
  const mod1On = useControl('fx.mod1.on')
  const mod2 = useControl('fx.mod2.type')
  const mod2On = useControl('fx.mod2.on')
  const ampType = useControl('fx.amp.type')
  const ampOn = useControl('fx.amp.on')
  const delayEffects = useControl('fx.delay.effects')
  const delayFilter = useControl('fx.delay.filter')
  const delayOn = useControl('fx.delay.on')
  const compOn = useControl('fx.comp.on')
  const reverbTone = useControl('fx.reverb.tone')
  const reverbType = useControl('fx.reverb.type')
  const reverbOn = useControl('fx.reverb.on')
  const focusOrgan = useControl('fx.focus.organ')
  const focusPiano = useControl('fx.focus.piano')
  const focusSynth = useControl('fx.focus.synth')
  const sectionOn = useControl('fx.section-on')

  return (
    <>
      <div className="section__header-slot section__header-slot--effects">
        <div className="section-header">
          <span className="section-header__title section-header__title--wide">LAYER EFFECTS</span>
          <span className="section-header__on">
            <span className="legend">ON</span>
            <Led on={sectionOn.value >= 0.5} />
          </span>
          <PanelButton id="fx.section-on" variant="dark" className="pbtn--section" />
        </div>
        <span className="legend fx-focus-caption">FX FOCUS</span>
      </div>

      <At l={0.4} t={24.4} w={9} h={70.4} className="fx-focus">
        <span className="stack-centre">
          <span className="legend legend--head">ORGAN</span>
          <Led on={focusOrgan.value === 0} />
          <span className="legend">A B</span>
          <PanelButton id="fx.focus.organ" variant="light" className="pbtn--wide" />
          <span className="legend">ALL FX OFF</span>
        </span>
        <span className="stack-centre">
          <span className="legend legend--head">PIANO</span>
          <span className="row-centre">
            <Led on={focusPiano.value === 0} />
            <Led on={focusPiano.value === 1} />
          </span>
          <span className="legend">A B</span>
          <PanelButton id="fx.focus.piano" variant="dark" className="pbtn--wide" />
          <span className="legend">GROUP ▽</span>
        </span>
        <span className="stack-centre">
          <span className="legend legend--head">SYNTH</span>
          <span className="row-centre">
            <Led on={focusSynth.value === 0} color="amber" />
            <Led on={focusSynth.value === 1} color="amber" />
            <Led on={focusSynth.value === 2} color="amber" />
          </span>
          <span className="legend">A B C</span>
          <PanelButton id="fx.focus.synth" variant="dark" className="pbtn--wide" />
          <span className="legend">GROUP ▽</span>
        </span>
        <span className="shift-plate shift-plate--fx">
          <span className="legend">SHIFT</span>
          <PanelButton id="fx.shift" variant="light" className="pbtn--tall" />
          <span className="legend">EXIT</span>
        </span>
      </At>

      <div className="section__plate section__plate--effects">
        <div className="plate-group" style={{ left: '0.5%', top: '0.5%', width: '52%', height: '24.4%' }}>
          <h3 className="plate-group__title">MOD 1</h3>
          <div className="row-spread">
            <Knob id="fx.mod1.rate" size="md" ticks={KNOB_TICKS_0_10} caption={<>RATE <span className="boxed">SENS</span></>} />
            <Knob id="fx.mod1.amount" size="md" ticks={KNOB_TICKS_0_10} caption="AMOUNT" />
            <SixWay left={MOD1_LEFT} right={MOD1_RIGHT} order={MOD1_ORDER} current={mod1.valueText} />
            <span className="stack-centre">
              <PanelButton id="fx.mod1.type" variant="dark" className="pbtn--wide" />
              <span className="row-start">
                <Led />
                <span className="legend">VARIATION</span>
              </span>
            </span>
            <span className="stack-centre">
              <span className="row-start">
                <span className="legend">ON</span>
                <Led on={mod1On.value >= 0.5} />
              </span>
              <PanelButton id="fx.mod1.on" variant="light" className="pbtn--tall" />
            </span>
          </div>
          <span className="legend legend--corner boxed-red">MST CLK</span>
        </div>

        <div className="plate-group" style={{ left: '0.5%', top: '25.4%', width: '52%', height: '25.5%' }}>
          <h3 className="plate-group__title">MOD 2</h3>
          <div className="row-spread">
            <Knob id="fx.mod2.rate" size="md" ticks={KNOB_TICKS_0_10} caption="RATE" />
            <Knob id="fx.mod2.amount" size="md" ticks={KNOB_TICKS_0_10} caption="AMOUNT" />
            <SixWay left={MOD2_LEFT} right={MOD2_RIGHT} order={MOD2_ORDER} current={mod2.valueText} />
            <span className="stack-centre">
              <PanelButton id="fx.mod2.type" variant="dark" className="pbtn--wide" />
              <span className="row-start">
                <Led />
                <span className="legend">VARIATION</span>
              </span>
            </span>
            <span className="stack-centre">
              <span className="row-start">
                <span className="legend">ON</span>
                <Led on={mod2On.value >= 0.5} />
              </span>
              <PanelButton id="fx.mod2.on" variant="light" className="pbtn--tall" />
            </span>
          </div>
        </div>

        <div className="plate-group" style={{ left: '0.5%', top: '51.4%', width: '52%', height: '41.7%' }}>
          <h3 className="plate-group__title">AMP SIM/EQ</h3>
          <div className="row-spread">
            <Knob id="fx.amp.drive" size="md" ticks={KNOB_TICKS_0_10} caption="DRIVE" />
            <Knob id="fx.amp.freq" size="md" ticks={FREQ_TICKS} caption={<>FREQ <span className="boxed">FREQ</span></>} />
            <SixWay left={AMP_LEFT} right={AMP_RIGHT} order={AMP_ORDER} current={ampType.valueText} />
            <span className="stack-centre">
              <PanelButton id="fx.amp.type" variant="dark" className="pbtn--wide" />
              <span className="legend">VARIATION ▽</span>
            </span>
          </div>
          <div className="row-spread">
            <Knob id="fx.amp.bass" size="md" ticks={EQ_TICKS} caption="BASS" />
            <Knob id="fx.amp.mid" size="md" ticks={EQ_TICKS} caption={<>MID <span className="boxed">RES</span></>} />
            <Knob id="fx.amp.treble" size="md" ticks={EQ_TICKS} caption="TREBLE" />
            <span className="stack-centre">
              <span className="row-start">
                <span className="legend">ON</span>
                <Led on={ampOn.value >= 0.5} />
              </span>
              <PanelButton id="fx.amp.on" variant="light" className="pbtn--tall" />
            </span>
          </div>
        </div>

        <div className="plate-group" style={{ left: '53.5%', top: '0.5%', width: '46%', height: '50.4%' }}>
          <h3 className="plate-group__title">DELAY</h3>
          <div className="row-spread">
            <Knob id="fx.delay.tempo" size="md" ticks={KNOB_TICKS_0_10} caption="TEMPO" />
            <span className="stack-start">
              <span className="legend legend--head">EFFECTS</span>
              <span className="row-start">
                <span className="legend">CHOR</span>
                <Led on={delayEffects.value === 1} />
                <span className="legend">FLAM</span>
              </span>
              <span className="row-start">
                <span className="legend">VIBE</span>
                <Led on={delayEffects.value === 2} />
                <span className="legend">SPACE</span>
              </span>
              <span className="row-start">
                <span className="legend">ENS</span>
                <Led on={delayEffects.value === 3} />
              </span>
              <PanelButton id="fx.delay.effects" variant="dark" className="pbtn--wide" />
              <span className="row-start">
                <Led />
                <span className="legend">VARIATION ▽</span>
              </span>
            </span>
            <span className="stack-centre">
              <Knob id="fx.delay.feedback" size="md" ticks={KNOB_TICKS_0_10} caption="FEEDBACK" />
              <span className="legend legend--head">FILTER</span>
              <span className="row-start">
                <span className="legend">HP</span>
                <Led on={delayFilter.value === 2} />
                <span className="legend">BP</span>
                <Led on={delayFilter.value === 1} />
              </span>
              <span className="row-start">
                <span className="legend">LP</span>
                <Led on={delayFilter.value === 0} />
              </span>
              <PanelButton id="fx.delay.filter" variant="dark" className="pbtn--wide" />
              <span className="legend">PING PONG ▽</span>
            </span>
          </div>
          <div className="row-spread">
            <span className="light-plate light-plate--inline">
              <span className="row-start">
                <Led />
                <span className="legend">TAP/SET ▾</span>
              </span>
              <PanelButton id="fx.delay.tap" variant="dark" className="pbtn--wide" />
              <span className="row-start">
                <Led />
                <span className="legend">ANALOG ▽</span>
              </span>
            </span>
            <Knob id="fx.delay.dry-wet" size="md" ticks={KNOB_TICKS_0_10} caption="DRY   WET" />
            <span className="stack-centre">
              <span className="row-start">
                <span className="legend">ON</span>
                <Led on={delayOn.value >= 0.5} />
              </span>
              <PanelButton id="fx.delay.on" variant="light" className="pbtn--tall" />
              <span className="legend boxed-red">GLOBAL ▽</span>
            </span>
          </div>
          <span className="legend legend--corner boxed-red">MST CLK</span>
        </div>

        <div className="plate-group" style={{ left: '53.5%', top: '51.4%', width: '13.6%', height: '41.7%' }}>
          <h3 className="plate-group__title">COMP</h3>
          <span className="row-start">
            <Led />
            <span className="legend">ACTIVE</span>
          </span>
          <Knob id="fx.comp.amount" size="md" ticks={KNOB_TICKS_0_10} caption="AMOUNT" />
          <span className="row-start">
            <Led />
            <span className="legend">FAST</span>
          </span>
          <span className="row-start">
            <span className="legend">ON</span>
            <Led on={compOn.value >= 0.5} />
            <PanelButton id="fx.comp.on" variant="dark" className="pbtn--wide" />
          </span>
          <span className="legend boxed-red">GLOBAL ▽</span>
        </div>

        <div className="plate-group" style={{ left: '68%', top: '51.4%', width: '31.5%', height: '41.7%' }}>
          <h3 className="plate-group__title">REVERB</h3>
          <div className="row-spread">
            <span className="stack-start">
              <span className="row-start">
                <Led on={reverbTone.value === 1} />
                <span className="legend">BRIGHT</span>
              </span>
              <span className="row-start">
                <Led on={reverbTone.value === 2} />
                <span className="legend">DARK</span>
              </span>
              <PanelButton id="fx.reverb.tone" variant="dark" className="pbtn--wide" />
            </span>
            <span className="stack-centre">
              <SixWay left={REVERB_LEFT} right={REVERB_RIGHT} order={REVERB_ORDER} current={reverbType.valueText} />
              <PanelButton id="fx.reverb.type" variant="dark" className="pbtn--wide" />
              <span className="legend">VAR | CHORALE ▽</span>
            </span>
          </div>
          <div className="row-spread">
            <Knob id="fx.reverb.dry-wet" size="md" ticks={KNOB_TICKS_0_10} caption="DRY   WET" />
            <span className="stack-centre">
              <span className="row-start">
                <span className="legend">ON</span>
                <Led on={reverbOn.value >= 0.5} />
              </span>
              <PanelButton id="fx.reverb.on" variant="light" className="pbtn--tall" />
              <span className="legend boxed-red">GLOBAL ▽</span>
            </span>
          </div>
        </div>
      </div>
      <span aria-hidden="true" className="made-in">
        HANDMADE IN SWEDEN BY CLAVIA DMI AB · v2.0 Rev.B
      </span>
    </>
  )
}
