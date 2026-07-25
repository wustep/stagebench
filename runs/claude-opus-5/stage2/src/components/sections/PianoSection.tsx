import { pianoModel } from '../../audio/pianoTypes'
import { layerTypeId } from '../../state/hardware'
import { useControl, useDeck } from '../../state/HardwareContext'
import { At, LayerColumn, SectionHeader } from '../Primitives'
import { Encoder, Fader, Led, PanelButton, SelectorPad } from '../controls/PanelControls'

const TYPE_LEFT = ['ELECTRIC', 'UPRIGHT', 'GRAND'] as const
const TYPE_RIGHT = ['CLAV', 'DIGITAL', 'MISC'] as const
/** Panel order, top-to-bottom on the left column then the right column. */
const TYPE_ORDER = ['Electric', 'Upright', 'Grand', 'Clav', 'Digital', 'Misc'] as const

export function PianoSection() {
  const deck = useDeck()
  const sustped = useControl('piano.sustped')
  const acoustics = useControl('piano.acoustics')
  const unison = useControl('piano.unison')
  const kbTouch = useControl('piano.kb-touch')
  const dynComp = useControl('piano.dyn-comp')
  const timbre = useControl('piano.timbre')
  const type = useControl('piano.type')
  const model = useControl('piano.model')
  const typeIndex = TYPE_ORDER.indexOf(type.valueText as (typeof TYPE_ORDER)[number])
  const modelName = pianoModel(layerTypeId(deck.values), model.value).name
  const octave = deck.octaves[deck.focus] / 12

  return (
    <>
      <div className="section__header-slot">
        <SectionHeader title="PIANO" onId="piano.section-on" fxFocus fxFocusOn />
      </div>
      <div className="section__plate">
        <At l={2} t={1} w={45} h={98}>
          <LayerColumn
            layers={[
              { id: 'a', letter: 'A', onId: 'piano.a.on' },
              { id: 'b', letter: 'B', onId: 'piano.b.on' },
            ]}
            faders={
              <>
                <Fader id="piano.a.level" />
                <Fader id="piano.b.level" />
              </>
            }
            octaveDownId="piano.octave-down"
            octaveUpId="piano.octave-up"
            focused={deck.focus}
            octaveLabel={octave === 0 ? undefined : `${octave > 0 ? '+' : ''}${octave}`}
            secondRow={[
              { label: 'SUSTPED', on: sustped.value >= 0.5, controlId: 'piano.sustped' },
              { label: 'PSTICK', on: false },
            ]}
            extras={
              <>
                <At l={0} t={60} w={100} h={4} className="layer-row layer-row--centre">
                  <span className="legend legend--head">TIMBRE</span>
                </At>
                <At l={0} t={64} w={100} h={9} className="timbre">
                  <PanelButton id="piano.timbre" variant="dark" className="pbtn--tall" />
                  <span className="timbre__leds">
                    <span className="row-start">
                      <span className="legend">BRIGHT</span>
                      <Led on={timbre.value === 3} />
                      <span className="legend">DYNO1</span>
                      <Led on={timbre.value === 4} />
                    </span>
                    <span className="row-start">
                      <span className="legend">MID</span>
                      <Led on={timbre.value === 2} />
                      <span className="legend">DYNO2</span>
                      <Led on={timbre.value === 5} />
                    </span>
                    <span className="row-start">
                      <span className="legend">SOFT</span>
                      <Led on={timbre.value === 1} />
                    </span>
                  </span>
                </At>
              </>
            }
          />
        </At>

        <At l={52} t={1} w={46} h={20} className="piano-pair">
          <span className="piano-pair__col">
            <span className="legend legend--head">ACOUSTICS</span>
            <span className="row-start">
              <Led on={acoustics.value === 1 || acoustics.value === 3} />
              <span className="legend">SOFT REL</span>
            </span>
            <span className="row-start">
              <Led on={acoustics.value === 2 || acoustics.value === 3} />
              <span className="legend">STRING RES</span>
            </span>
            <PanelButton id="piano.acoustics" variant="dark" className="pbtn--wide" />
            <span className="row-start">
              <Led />
              <span className="legend">PED NOISE ▽</span>
            </span>
          </span>
          <span className="piano-pair__col">
            <span className="legend legend--head">UNISON</span>
            <span className="row-start">
              <span className="legend">2</span>
              <Led on={unison.value === 2} />
              <span className="legend">3</span>
            </span>
            <span className="row-start">
              <span className="legend">1</span>
              <Led on={unison.value === 1} />
              <Led on={unison.value === 3} />
            </span>
            <PanelButton id="piano.unison" variant="dark" className="pbtn--wide" />
          </span>
        </At>

        <At l={52} t={23} w={46} h={17} className="piano-pair">
          <span className="piano-pair__col">
            <span className="legend legend--head">KB TOUCH</span>
            <span className="row-start">
              <span className="legend">MED</span>
              <Led on={kbTouch.value === 2} />
              <span className="legend">LIGHT</span>
              <Led on={kbTouch.value === 3} />
            </span>
            <span className="row-start">
              <span className="legend">HEAVY</span>
              <Led on={kbTouch.value === 1} />
            </span>
            <PanelButton id="piano.kb-touch" variant="dark" className="pbtn--wide" />
          </span>
          <span className="piano-pair__col">
            <span className="legend legend--head">DYN COMP</span>
            <span className="row-start">
              <span className="legend">2</span>
              <Led on={dynComp.value === 2} />
              <span className="legend">3</span>
            </span>
            <span className="row-start">
              <span className="legend">1</span>
              <Led on={dynComp.value === 1} />
              <Led on={dynComp.value === 3} />
            </span>
            <PanelButton id="piano.dyn-comp" variant="dark" className="pbtn--wide" />
          </span>
        </At>

        <div className="plate-group piano-select" style={{ left: '52%', top: '42%', width: '46%', height: '55%' }}>
          <h3 className="plate-group__title">PIANO SELECT</h3>
          <div className="model-select">
            <span className="model-select__col">
              {TYPE_LEFT.map((label, index) => (
                <span key={label} className={`legend${typeIndex === index ? ' legend--active' : ''}`}>
                  {label}
                </span>
              ))}
            </span>
            <SelectorPad count={6} active={typeIndex} />
            <span className="model-select__col">
              {TYPE_RIGHT.map((label, index) => (
                <span key={label} className={`legend${typeIndex === index + 3 ? ' legend--active' : ''}`}>
                  {label}
                </span>
              ))}
            </span>
          </div>
          <div className="piano-select__info">
            <PanelButton id="piano.type" variant="dark" className="pbtn--wide" />
            <span className="legend">INFO</span>
          </div>
          <div className="piano-select__model">
            <Encoder id="piano.model" size="md" />
            <span className="legend">
              MODEL <span className="boxed">LIST</span>
            </span>
            <span className="legend legend--active piano-select__model-name">{modelName}</span>
          </div>
        </div>
      </div>
    </>
  )
}
