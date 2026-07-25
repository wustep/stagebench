import { VARIANT } from '../../model/variant'
import { deriveSettings } from '../../state/settings'
import { useControl, useDeck } from '../../state/HardwareContext'
import { At } from '../Primitives'
import { KNOB_TICKS_0_10, Knob, Led, ModWheel, PanelButton, PitchStick } from '../controls/PanelControls'

/**
 * Performance controls. Exposed red chassis only — no inset plate and no OLED, as required by
 * `sectionLandmarks.performance` in the visual spec.
 */
export function PerformanceSection() {
  const deck = useDeck()
  // The rotary ON indicator reports the truth: some layer is actually routed into it.
  const settings = deriveSettings(deck)
  const rotaryActive =
    settings.effectsOn &&
    (['a', 'b'] as const).some(
      (id) =>
        settings.layers[id].enabled &&
        settings.layers[id].chain.amp.on &&
        settings.layers[id].chain.amp.type === 'rotary',
    )
  const source = useControl('perf.rotary.source')
  const stopMode = useControl('perf.rotary.stop-mode')
  const speed = useControl('perf.rotary.speed')

  return (
    <>
      <At l={74} t={20.5} w={26} h={4} className="row-centre">
        <span className="legend legend--head">MASTER LEVEL</span>
      </At>
      <At l={80} t={24} w={13} h={8}>
        <Knob id="perf.master-level" size="lg" />
      </At>

      <At l={23} t={28.9} w={21} h={9}>
        <PitchStick id="perf.pitch-stick" />
      </At>
      <At l={50} t={37.5} w={14} h={27}>
        <ModWheel id="perf.mod-wheel" />
      </At>

      <div className="brand">
        <span className="brand__name">nord stage 4</span>
        <span className="brand__sub">{VARIANT.keyAction.toUpperCase().split('').join(' ')} 7 3</span>
      </div>

      <At l={79} t={38} w={18} h={54} className="rotary">
        <span className="rotary__title">
          ROTARY
          <br />
          SPEAKER
        </span>
        <At l={52} t={9} w={48} h={7} className="row-end">
          <span className="legend">ON</span>
          <Led on={rotaryActive} />
        </At>
        <At l={14} t={15} w={70} h={22}>
          <Knob id="perf.rotary.drive" size="md" ticks={KNOB_TICKS_0_10} />
        </At>
        <At l={4} t={37} w={92} h={5} className="row-centre">
          <span className="legend">DRIVE</span>
        </At>
        <At l={4} t={42} w={92} h={5} className="row-start">
          <Led on={source.value === 0} />
          <span className="legend">ORGAN</span>
        </At>
        <At l={4} t={47} w={70} h={9}>
          <PanelButton id="perf.rotary.source" variant="light" className="pbtn--wide" />
        </At>
        <At l={4} t={56} w={92} h={5} className="row-start">
          <Led on={source.value === 1} />
          <span className="legend">CLOSE MIC ▽</span>
        </At>
        <At l={4} t={62} w={92} h={5} className="row-start">
          <Led on={stopMode.value === 1} />
          <span className="legend">STOP MODE</span>
        </At>
        <At l={4} t={67} w={70} h={9}>
          <PanelButton id="perf.rotary.stop-mode" variant="dark" className="pbtn--wide" />
        </At>
        <At l={4} t={76} w={92} h={5} className="row-centre">
          <span className="legend">ANGLE</span>
        </At>
        <At l={4} t={81} w={92} h={5} className="row-start">
          <Led on={speed.value === 0} color="green" />
          <span className="legend">SLOW</span>
          <Led on={speed.value === 1} />
          <span className="legend">FAST</span>
        </At>
        <At l={4} t={86} w={70} h={9}>
          <PanelButton id="perf.rotary.speed" variant="dark" className="pbtn--wide" />
        </At>
        <At l={4} t={95} w={92} h={5} className="row-start">
          <Led on={speed.value === 2} />
          <span className="legend">MORPH</span>
        </At>
      </At>
    </>
  )
}
