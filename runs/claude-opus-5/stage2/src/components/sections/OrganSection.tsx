import { DRAWBARS } from '../../model/controls'
import { useControl } from '../../state/HardwareContext'
import { At, LayerColumn, SectionHeader } from '../Primitives'
import { Drawbar, Fader, Led, PanelButton, SelectorPad } from '../controls/PanelControls'

const MODEL_LEFT = ['FARF', 'VOX', 'B3'] as const
const MODEL_RIGHT = ['PIPE1', 'PIPE2', 'B3 BASS'] as const
/** Printed order on the panel: left column top-to-bottom, then right column. */
const MODEL_ORDER = ['Farf', 'Vox', 'B3', 'Pipe1', 'Pipe2', 'B3 Bass'] as const

const VIB_TOP = ['C2', 'V3', 'C3'] as const
const VIB_BOTTOM = ['V2', 'C1', 'V1'] as const

export function OrganSection() {
  const model = useControl('organ.model')
  const vibType = useControl('organ.vibchorus.type')
  const vibOn = useControl('organ.vibchorus.on')
  const percVolume = useControl('organ.perc.volume')
  const percDecay = useControl('organ.perc.decay')
  const percHarmonic = useControl('organ.perc.harmonic')
  const percOn = useControl('organ.perc.on')
  const preset = useControl('organ.preset')
  const modelIndex = MODEL_ORDER.indexOf(model.valueText as (typeof MODEL_ORDER)[number])

  return (
    <>
      <div className="section__header-slot">
        <SectionHeader title="ORGAN" onId="organ.section-on" fxFocus />
      </div>
      <div className="section__plate">
        <At l={1} t={1} w={20} h={98}>
          <LayerColumn
            layers={[
              { id: 'a', letter: 'A', onId: 'organ.a.on' },
              { id: 'b', letter: 'B', onId: 'organ.b.on' },
            ]}
            faders={
              <>
                <Fader id="organ.a.level" />
                <Fader id="organ.b.level" />
              </>
            }
            octaveDownId="organ.octave-down"
            octaveUpId="organ.octave-up"
            secondRow={[
              { label: 'SUSTPED', on: false },
              { label: 'PSTICK', on: false },
            ]}
            extras={
              <>
                <At l={0} t={62} w={100} h={5} className="layer-row layer-row--centre">
                  <Led on={preset.value === 0} />
                  <span className="legend">PRESET</span>
                </At>
                <At l={20} t={66} w={60} h={7}>
                  <PanelButton id="organ.preset" variant="dark" className="pbtn--wide" />
                </At>
              </>
            }
          />
        </At>

        <div className="plate-group" style={{ left: '24.6%', top: '1%', width: '16.2%', height: '31%' }}>
          <h3 className="plate-group__title">
            ORGAN
            <br />
            MODEL
          </h3>
          <div className="model-select">
            <span className="model-select__col">
              {MODEL_LEFT.map((label, index) => (
                <span key={label} className={`legend${modelIndex === index ? ' legend--active' : ''}`}>
                  {label}
                </span>
              ))}
            </span>
            <SelectorPad count={6} active={modelIndex} />
            <span className="model-select__col">
              {MODEL_RIGHT.map((label, index) => (
                <span key={label} className={`legend${modelIndex === index + 3 ? ' legend--active' : ''}`}>
                  {label}
                </span>
              ))}
            </span>
          </div>
          <div className="plate-group__footer">
            <PanelButton id="organ.model" variant="dark" className="pbtn--wide" />
          </div>
        </div>

        <div className="plate-group" style={{ left: '41.5%', top: '1%', width: '23%', height: '31%' }}>
          <h3 className="plate-group__title">VIB/CHORUS</h3>
          <div className="vib-body">
            <PanelButton id="organ.vibchorus.type" variant="dark" className="pbtn--wide" />
            <span className="vib-matrix">
              <span className="vib-matrix__row">
                {VIB_TOP.map((label) => (
                  <span key={label} className="legend">
                    {label}
                  </span>
                ))}
              </span>
              <SelectorPad count={6} active={vibType.value} rows={3} />
              <span className="vib-matrix__row">
                {VIB_BOTTOM.map((label) => (
                  <span key={label} className="legend">
                    {label}
                  </span>
                ))}
              </span>
            </span>
          </div>
          <div className="plate-group__footer plate-group__footer--split">
            <span className="row-start">
              <span className="legend">ON</span>
              <Led on={vibOn.value >= 0.5} />
            </span>
            <PanelButton id="organ.vibchorus.on" variant="light" className="pbtn--wide" />
          </div>
        </div>

        <div className="plate-group" style={{ left: '65.2%', top: '1%', width: '33.5%', height: '31%' }}>
          <h3 className="plate-group__title">B3 PERCUSSION</h3>
          <div className="perc-grid">
            <span className="perc-grid__cell">
              <span className="legend legend--head">VOLUME</span>
              <span className="row-start">
                <Led on={percVolume.value >= 0.5} />
                <span className="legend">SOFT</span>
              </span>
              <PanelButton id="organ.perc.volume" variant="dark" className="pbtn--wide" />
            </span>
            <span className="perc-grid__cell">
              <span className="legend legend--head">DECAY</span>
              <span className="row-start">
                <Led on={percDecay.value >= 0.5} />
                <span className="legend">FAST</span>
              </span>
              <PanelButton id="organ.perc.decay" variant="dark" className="pbtn--wide" />
            </span>
            <span className="perc-grid__cell">
              <span className="legend legend--head">HARMONIC</span>
              <span className="row-start">
                <Led on={percHarmonic.value >= 0.5} />
                <span className="legend">THIRD</span>
              </span>
              <PanelButton id="organ.perc.harmonic" variant="dark" className="pbtn--wide" />
            </span>
          </div>
          <div className="plate-group__footer plate-group__footer--split">
            <span className="row-start">
              <Led />
              <span className="legend">POLY ▽</span>
            </span>
            <span className="row-start">
              <span className="legend">ON</span>
              <Led on={percOn.value >= 0.5} />
              <PanelButton id="organ.perc.on" variant="light" className="pbtn--wide" />
            </span>
          </div>
        </div>

        <At l={20.5} t={34.7} w={78.2} h={58} className="drawbank">
          {DRAWBARS.map((bar) => (
            <Drawbar key={bar.id} id={bar.id} upper={bar.upper} lower={bar.lower} footage={bar.footage} />
          ))}
        </At>
      </div>
    </>
  )
}
