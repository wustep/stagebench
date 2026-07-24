import { PROGRAM_BUTTONS } from '../../model/controls'
import { VARIANT } from '../../model/variant'
import { useControl } from '../../state/HardwareContext'
import { At } from '../Primitives'
import { Encoder, Led, PanelButton } from '../controls/PanelControls'

export interface ProgramDisplayState {
  readonly audioMessage: string
  readonly audioLabel: string
  readonly midiMessage: string
  readonly soundingVoices: number
}

/**
 * Program and morph area. This section owns one of the two primary OLEDs.
 *
 * Honesty note: there is no program system in Phase 1, so the display does not show a program
 * name, bank or layer sounds — that would be fabricated state. It shows the variant identity and
 * the real, live status of the only things that actually work: the audio engine, MIDI, and the
 * sounding voice count.
 */
export function ProgramSection({ display }: { display: ProgramDisplayState }) {
  const split = useControl('program.split')
  const transpose = useControl('program.transpose')
  const liveMode = useControl('program.live-mode')
  const layerScene = useControl('program.layer-scene')
  const solo = useControl('program.solo')
  const sectionEdit = useControl('program.section-edit')
  const morphWheel = useControl('program.morph.wheel')
  const morphAt = useControl('program.morph.aftertouch')
  const morphPedal = useControl('program.morph.ctrl-pedal')

  return (
    <div className="program">
      <div className="light-plate" style={{ left: '3.1%', top: '17.8%', width: '41.9%', height: '12.7%' }}>
        <h3 className="light-plate__title">MORPH ASSIGN</h3>
        <div className="morph-row">
          <span className="morph-row__cell">
            <Led on={morphWheel.value >= 0.5} />
            <span className="legend">WHEEL ▾</span>
          </span>
          <span className="morph-row__cell">
            <Led on={morphAt.value >= 0.5} />
            <span className="legend">A.T. ▾</span>
          </span>
          <span className="morph-row__cell">
            <Led on={morphPedal.value >= 0.5} />
            <span className="legend">CTRLPED ▾</span>
          </span>
        </div>
        <div className="morph-row">
          <PanelButton id="program.morph.wheel" variant="dark" className="pbtn--wide" />
          <PanelButton id="program.morph.aftertouch" variant="dark" className="pbtn--wide" />
          <PanelButton id="program.morph.ctrl-pedal" variant="dark" className="pbtn--wide" />
        </div>
        <span className="legend legend--rule">CLEAR MORPH</span>
      </div>

      <div className="light-plate light-plate--tab" style={{ left: '49%', top: '17.8%', width: '13.1%', height: '4%' }}>
        <h3 className="light-plate__title">SPLIT</h3>
      </div>
      <At l={49} t={22} w={13.1} h={4} className="row-centre led-strip">
        <Led />
        <Led on={split.value >= 0.5} color="amber" />
        <Led />
      </At>
      <At l={49} t={26} w={13.1} h={3.4} className="row-centre">
        <span className="legend">ON/SET ▾</span>
      </At>
      <At l={51} t={29} w={9} h={5.6}>
        <PanelButton id="program.split" variant="dark" className="pbtn--wide" />
      </At>
      <At l={49} t={35} w={13.1} h={3.4} className="row-centre">
        <span className="legend">SET KEY</span>
      </At>

      <div className="light-plate light-plate--tab" style={{ left: '66.1%', top: '17.8%', width: '13.2%', height: '4%' }}>
        <h3 className="light-plate__title">MST CLK</h3>
      </div>
      <At l={66.1} t={22.4} w={13.2} h={3.6} className="row-start">
        <Led />
        <span className="legend">TAP/SET ▾</span>
      </At>
      <At l={67} t={26} w={9} h={5.6}>
        <PanelButton id="program.mst-clk" variant="dark" className="pbtn--wide" />
      </At>
      <At l={66.1} t={32.4} w={13.2} h={3.6} className="row-start">
        <Led />
        <span className="legend">PEDAL TAP</span>
      </At>

      <div className="light-plate light-plate--tab" style={{ left: '83.5%', top: '17.8%', width: '12.8%', height: '4%' }}>
        <h3 className="light-plate__title">TRANSP</h3>
      </div>
      <At l={83.5} t={22.4} w={12.8} h={3.6} className="row-start">
        <Led on={transpose.value >= 0.5} />
        <span className="legend">ON/SET ▾</span>
      </At>
      <At l={84.5} t={26} w={9} h={5.6}>
        <PanelButton id="program.transpose" variant="dark" className="pbtn--wide" />
      </At>
      <At l={83.5} t={32.4} w={12.8} h={3.6} className="row-centre">
        <span className="legend">PANIC</span>
      </At>
      <At l={83.5} t={36.5} w={12.8} h={3.6} className="row-centre">
        <span className="legend">PROG VIEW</span>
      </At>
      <At l={84.5} t={40} w={9} h={5.6}>
        <PanelButton id="program.prog-view" variant="dark" className="pbtn--wide" />
      </At>
      <At l={83.5} t={46} w={12.8} h={3.6} className="row-centre">
        <span className="legend">PRESET NAME</span>
      </At>

      <At l={7.2} t={31.5} w={14} h={3.6} className="row-start">
        <Led />
        <span className="legend">STORE</span>
      </At>
      <At l={7.2} t={35} w={12.9} h={6} className="store">
        <PanelButton id="program.store" variant="red" className="pbtn--wide" />
      </At>
      <At l={7.2} t={41.2} w={16} h={5} className="stack-start">
        <span className="legend">STORE AS…</span>
        <span className="legend legend--dim">PAGE NAME</span>
      </At>
      <At l={23.9} t={33} w={8} h={4} className="row-start">
        <span className="legend">MIDI</span>
      </At>
      <At l={23.9} t={36.2} w={8} h={3.4} className="row-start">
        <Led />
      </At>
      <At l={23.9} t={39.4} w={8} h={4} className="row-start">
        <span className="legend">EXTERN</span>
      </At>
      <At l={23.9} t={42.6} w={8} h={3.4} className="row-start">
        <Led />
      </At>

      <div className="light-plate" style={{ left: '32.2%', top: '32.5%', width: '40.8%', height: '11.6%' }}>
        <h3 className="light-plate__title">PRESET LIBRARY</h3>
        <div className="morph-row">
          <span className="morph-row__cell">
            <Led />
            <span className="legend">ORGAN</span>
          </span>
          <span className="morph-row__cell">
            <Led />
            <span className="legend">PIANO</span>
          </span>
          <span className="morph-row__cell">
            <Led />
            <span className="legend">SYNTH</span>
          </span>
        </div>
        <div className="morph-row">
          <PanelButton id="program.preset.organ" variant="dark" className="pbtn--wide" />
          <PanelButton id="program.preset.piano" variant="dark" className="pbtn--wide" />
          <PanelButton id="program.preset.synth" variant="dark" className="pbtn--wide" />
        </div>
        <span className="legend legend--rule">SINGLE LAYER</span>
      </div>

      <div
        className="oled oled--program"
        style={{ left: '29.9%', top: '46.3%', width: '46.2%', height: '16.5%' }}
        role="status"
        aria-live="polite"
        aria-label="Program display"
        data-oled="program"
      >
        <span className="oled__line oled__line--head">STAGE 1 · {VARIANT.label.toUpperCase()}</span>
        <span className="oled__line oled__line--big">{display.audioLabel}</span>
        <span className="oled__rule" aria-hidden="true" />
        <span className="oled__line">PANEL CONTROLS: DECORATIVE</span>
        <span className="oled__line">PIANO: GENERATED VOICE</span>
        <span className="oled__line">
          VOICES {String(display.soundingVoices).padStart(2, '0')} · {display.midiMessage}
        </span>
      </div>

      <At l={11.2} t={47.2} w={9.4} h={7} className="row-centre">
        <Encoder id="program.dial" size="lg" />
      </At>
      <At l={4} t={54.5} w={24} h={3.6} className="row-centre">
        <span className="legend">
          PROGRAM <span className="boxed">LIST</span>
        </span>
      </At>
      <At l={4} t={57.9} w={24} h={3.4} className="row-centre">
        <span className="legend">◀ PAGE/CAT ▶</span>
      </At>
      <At l={3.4} t={59.4} w={24.8} h={5} className="row-centre">
        <PanelButton id="program.page-left" variant="dark" className="pbtn--wide" />
        <PanelButton id="program.page-right" variant="dark" className="pbtn--wide" />
      </At>
      <At l={4} t={64.6} w={24} h={3.4} className="row-centre">
        <span className="legend">◀ BANK ▶</span>
      </At>
      <At l={5.8} t={68} w={20} h={3.4} className="row-start">
        <Led on={liveMode.value >= 0.5} />
        <span className="legend">LIVE MODE</span>
      </At>
      <At l={5.8} t={69.7} w={15} h={5.5}>
        <PanelButton id="program.live-mode" variant="light" className="pbtn--wide" />
      </At>
      <At l={5.8} t={75.6} w={20} h={3.4} className="row-start">
        <Led />
        <span className="legend">NUM PAD</span>
      </At>

      <div className="dark-plate" style={{ left: '5.8%', top: '78.5%', width: '15.1%', height: '12.4%' }}>
        <span className="row-start">
          <Led />
          <span className="legend">LAYER SCENE {layerScene.value >= 0.5 ? 'II' : 'I'}</span>
        </span>
        <PanelButton id="program.layer-scene" variant="dark" className="pbtn--wide" />
        <span className="row-start">
          <Led />
          <span className="legend">PEDAL</span>
        </span>
      </div>

      <div className="dark-plate program-grid" style={{ left: '24.8%', top: '67.9%', width: '55.2%', height: '23%' }}>
        <h3 className="plate-group__title">PROGRAM</h3>
        <div className="program-grid__rows">
          {[0, 1].map((row) => (
            <div key={row} className="program-grid__row">
              {PROGRAM_BUTTONS.slice(row * 4, row * 4 + 4).map((slot) => (
                <span key={slot.id} className="program-grid__cell">
                  <span className="row-start">
                    <Led on={slot.index === 1} />
                    <span className="legend">{slot.index}</span>
                  </span>
                  <PanelButton id={slot.id} variant="dark" className="pbtn--wide" />
                  <span className="legend legend--dim">{slot.label.toUpperCase()}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="outline-group" style={{ left: '82%', top: '51%', width: '15.6%', height: '39%' }}>
        <span className="row-start">
          <Led on={solo.value >= 0.5} />
          <span className="legend">SOLO</span>
        </span>
        <PanelButton id="program.solo" variant="dark" className="pbtn--wide" />
        <span className="legend legend--centre">UNDO</span>
        <span className="row-start">
          <Led on={sectionEdit.value >= 0.5} />
          <span className="legend">SECTION EDIT ▾</span>
        </span>
        <PanelButton id="program.section-edit" variant="dark" className="pbtn--wide" />
        <span className="legend legend--centre">LAYER INIT</span>
        <span className="legend legend--centre">MON/COPY</span>
        <PanelButton id="program.mon-copy" variant="dark" className="pbtn--wide" />
        <span className="legend legend--centre">PASTE ▾</span>
      </div>

      <div className="shift-plate" style={{ left: '85.9%', top: '76.6%', width: '10.5%', height: '14.3%' }}>
        <span className="legend">SHIFT</span>
        <PanelButton id="program.shift" variant="light" className="pbtn--tall" />
        <span className="legend">EXIT</span>
      </div>
    </div>
  )
}
