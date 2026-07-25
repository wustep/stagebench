import { useControl } from '../../state/HardwareContext'
import { At, LayerColumn, SectionHeader } from '../Primitives'
import { Encoder, Fader, KNOB_TICKS_0_10, Knob, Led, PanelButton } from '../controls/PanelControls'

const RANGE_TICKS = ['0', '1', '2', '3', '4'] as const

/**
 * Synth section. Owns the second — and last — primary OLED.
 *
 * Honesty note: there is no synth engine in Phase 1, so the display says so instead of showing an
 * oscillator name that nothing would play.
 */
export function SynthSection() {
  const mode = useControl('synth.mode')
  const filterOn = useControl('synth.filter.on')
  const arpMode = useControl('synth.arp.mode')
  const voiceMode = useControl('synth.voice.mode')
  const vibrato = useControl('synth.vibrato.source')
  const lfoWave = useControl('synth.lfo.waveform')
  const lfoDest = useControl('synth.lfo.destination')
  const filterType = useControl('synth.filter.type')
  const unison = useControl('synth.unison')
  const kbHold = useControl('synth.kb-hold')
  const arpRun = useControl('synth.arp-run')

  return (
    <>
      <div className="section__header-slot">
        <SectionHeader title="SYNTH" onId="synth.section-on" fxFocus fxFocusOn />
      </div>
      <div className="section__plate">
        <At l={0.7} t={1} w={20} h={98}>
          <LayerColumn
            layers={[
              { id: 'a', letter: 'A', onId: 'synth.a.on' },
              { id: 'b', letter: 'B', onId: 'synth.b.on' },
              { id: 'c', letter: 'C', onId: 'synth.c.on' },
            ]}
            faders={
              <>
                <Fader id="synth.a.level" />
                <Fader id="synth.b.level" />
                <Fader id="synth.c.level" />
              </>
            }
            octaveDownId="synth.octave-down"
            octaveUpId="synth.octave-up"
            secondRow={[
              { label: 'SUSTPED', on: true },
              { label: 'PSTICK/RNG ▾', on: true },
              { label: 'PAN ▾', on: false },
            ]}
            extras={
              <>
                <At l={0} t={61} w={100} h={4} className="layer-row">
                  <span className="row-start boxed-red">
                    <Led on={kbHold.value >= 0.5} />
                    <span className="legend">KB HOLD</span>
                  </span>
                  <span className="row-start">
                    <Led on={arpRun.value >= 0.5} />
                    <span className="legend">ARP RUN</span>
                  </span>
                </At>
                <At l={0} t={65} w={70} h={6} className="layer-row">
                  <PanelButton id="synth.kb-hold" variant="dark" className="pbtn--wide" />
                  <PanelButton id="synth.arp-run" variant="red" className="pbtn--wide" />
                </At>
                <At l={0} t={71} w={100} h={3.5} className="layer-row">
                  <span className="legend">EXCLUDE ▽</span>
                  <span className="legend">KB SYNC ▽</span>
                </At>
              </>
            }
          />
        </At>

        <div
          className="oled oled--synth"
          style={{ left: '29.8%', top: '1.3%', width: '25%', height: '25.2%' }}
          aria-label="Synth display"
          data-oled="synth"
        >
          <span className="oled__line oled__line--head">OSC WAVEFORM</span>
          <span className="oled__line oled__line--big">— — —</span>
          <span className="oled__line">SYNTH ENGINE:</span>
          <span className="oled__line">NOT IMPLEMENTED (PHASE 1)</span>
        </div>

        <div className="light-plate" style={{ left: '56.3%', top: '1.3%', width: '8%', height: '25.2%' }}>
          <h3 className="light-plate__title">MODE</h3>
          <span className="row-start">
            <Led on={mode.value === 0} />
            <span className="legend">SAMPLES</span>
          </span>
          <span className="row-start">
            <Led on={mode.value === 1} />
            <span className="legend">ANALOG</span>
          </span>
          <PanelButton id="synth.mode" variant="dark" className="pbtn--wide" />
          <span className="row-start">
            <Led on={mode.value === 2} />
            <span className="legend">EXTERN</span>
          </span>
        </div>

        <div className="plate-group" style={{ left: '65.8%', top: '1.3%', width: '33.5%', height: '25.2%' }}>
          <h3 className="plate-group__title">ARPEGGIATOR/GATE</h3>
          <div className="row-spread">
            <Knob id="synth.arp.rate" size="md" ticks={KNOB_TICKS_0_10} caption="RATE/TIME" />
            <span className="stack-centre">
              <span className="row-start">
                <span className="legend">POLY</span>
                <Led on={arpMode.value === 0} />
              </span>
              <span className="row-start">
                <span className="legend">ARP</span>
                <Led on={arpMode.value === 1} />
                <span className="legend boxed">GATE</span>
              </span>
              <PanelButton id="synth.arp.mode" variant="dark" className="pbtn--wide" />
              <span className="legend">PATTERN ▽</span>
            </span>
            <Knob id="synth.arp.range" size="md" ticks={RANGE_TICKS} caption="RANGE" className="knob-wrap--red" />
            <span className="stack-centre">
              <span className="row-start">
                <Led />
                <span className="legend">MENU</span>
              </span>
              <PanelButton id="synth.arp.menu" variant="dark" className="pbtn--tall" />
              <span className="legend">GROUP ▽</span>
            </span>
          </div>
          <span className="legend legend--corner boxed-red">MST CLK</span>
        </div>

        <div className="plate-group" style={{ left: '65.8%', top: '27.1%', width: '18.6%', height: '24.5%' }}>
          <h3 className="plate-group__title">VOICE</h3>
          <div className="row-spread">
            <span className="stack-start">
              <span className="row-start">
                <Led on={voiceMode.value === 1} />
                <span className="legend">MONO</span>
              </span>
              <span className="row-start">
                <Led on={voiceMode.value === 2} />
                <span className="legend">LEGATO</span>
              </span>
              <PanelButton id="synth.voice.mode" variant="dark" className="pbtn--wide" />
              <span className="row-start">
                <Led />
                <span className="legend">LO ▽</span>
                <Led />
                <span className="legend">HI ▽</span>
              </span>
            </span>
            <Knob id="synth.voice.glide" size="md" ticks={KNOB_TICKS_0_10} caption="GLIDE" />
          </div>
        </div>

        <div className="plate-group" style={{ left: '85%', top: '27.1%', width: '14.3%', height: '24.5%' }}>
          <h3 className="plate-group__title">VIBRATO</h3>
          <div className="row-spread">
            <span className="stack-start">
              <span className="row-start">
                <span className="legend">WHL</span>
                <Led on={vibrato.value === 1} />
              </span>
              <span className="row-start">
                <span className="legend">DLY</span>
                <Led on={vibrato.value === 2} />
                <span className="legend">A.T.</span>
                <Led on={vibrato.value === 3} />
              </span>
              <span className="row-start">
                <span className="legend">ON</span>
                <Led on={vibrato.value !== 0} />
                <span className="legend">PED</span>
                <Led on={vibrato.value === 4} />
              </span>
              <PanelButton id="synth.vibrato.source" variant="dark" className="pbtn--wide" />
            </span>
            <span className="stack-centre">
              <span className="row-start">
                <Led />
                <span className="legend">MENU</span>
              </span>
              <PanelButton id="synth.vibrato.menu" variant="dark" className="pbtn--tall" />
            </span>
          </div>
        </div>

        <At l={28.2} t={34} w={35.2} h={20} className="row-spread synth-dials">
          <Encoder id="synth.osc.type" size="md" caption="INFO" />
          <Encoder id="synth.osc.category" size="md" caption="LIST" />
          <Encoder id="synth.osc.waveform" size="md" caption="LIST" />
          <span className="stack-centre">
            <span className="legend">WAVEFORM</span>
            <span className="row-start">
              <Led />
              <span className="legend">KEEP EDITS ▾</span>
            </span>
            <PanelButton id="synth.sound-init" variant="dark" className="pbtn--tall" />
            <span className="legend">SOUND INIT</span>
          </span>
        </At>

        <div className="plate-group" style={{ left: '17.4%', top: '54.6%', width: '21.3%', height: '38.3%' }}>
          <h3 className="plate-group__title">LFO</h3>
          <div className="row-spread">
            <span className="stack-start">
              <span className="row-start">
                <Led on={lfoWave.value === 0} />
                <span className="legend">WAVEFORM</span>
              </span>
              <PanelButton id="synth.lfo.waveform" variant="dark" className="pbtn--wide" />
              <span className="row-start">
                <Led />
                <span className="legend">GROUP ▽</span>
              </span>
            </span>
            <Knob id="synth.lfo.mod-amt" size="md" ticks={KNOB_TICKS_0_10} caption="MOD AMT" />
          </div>
          <div className="row-spread">
            <Knob id="synth.lfo.rate" size="md" ticks={KNOB_TICKS_0_10} caption="RATE/TIME" />
            <span className="stack-start">
              <span className="row-start">
                <span className="legend">OSC PITCH</span>
                <Led on={lfoDest.value === 0} />
              </span>
              <span className="row-start">
                <span className="legend">OSC CTRL</span>
                <Led on={lfoDest.value === 1} />
                <span className="legend">FILTER</span>
              </span>
              <PanelButton id="synth.lfo.destination" variant="dark" className="pbtn--wide" />
            </span>
          </div>
          <span className="legend legend--corner boxed-red">MST CLK</span>
        </div>

        <div className="plate-group" style={{ left: '39%', top: '54.6%', width: '22.2%', height: '38.3%' }}>
          <h3 className="plate-group__title">OSCILLATORS</h3>
          <div className="row-spread">
            <span className="stack-start">
              <span className="row-start">
                <Led />
                <span className="legend">PITCH/SMP</span>
              </span>
              <PanelButton id="synth.osc.pitch-smp" variant="dark" className="pbtn--wide pbtn--framed" />
              <span className="legend">ENV TO PITCH ▽</span>
            </span>
            <span className="stack-start">
              <span className="row-start">
                <Led />
                <span className="legend">ENVELOPE</span>
              </span>
              <PanelButton id="synth.osc.envelope" variant="dark" className="pbtn--wide pbtn--framed" />
              <span className="legend">VELOCITY ▽</span>
            </span>
          </div>
          <div className="row-spread">
            <Knob id="synth.osc.ctrl" size="md" ticks={KNOB_TICKS_0_10} caption="OSC CTRL" />
            <Knob id="synth.osc.env-amt" size="md" ticks={['-10', '-5', '0', '5', '10']} caption="ENV AMT" />
          </div>
        </div>

        <div className="plate-group" style={{ left: '61.9%', top: '54.6%', width: '28.6%', height: '38.3%' }}>
          <h3 className="plate-group__title">FILTER</h3>
          <div className="row-spread">
            <span className="stack-start">
              <span className="row-start">
                <Led on={filterType.value === 0} />
                <span className="legend">TYPE</span>
              </span>
              <PanelButton id="synth.filter.type" variant="dark" className="pbtn--wide" />
              <span className="legend">GROUP ▽</span>
            </span>
            <span className="stack-start">
              <span className="row-start">
                <Led />
                <span className="legend">ENVELOPE</span>
              </span>
              <PanelButton id="synth.filter.envelope" variant="dark" className="pbtn--wide pbtn--framed" />
              <span className="legend">VELOCITY ▽</span>
            </span>
            <Knob id="synth.filter.env-amt" size="md" ticks={KNOB_TICKS_0_10} caption="ENV AMT" />
          </div>
          <div className="row-spread">
            <Knob id="synth.filter.freq" size="md" ticks={KNOB_TICKS_0_10} caption="FREQ" />
            <Knob id="synth.filter.res" size="md" ticks={KNOB_TICKS_0_10} caption="RES/FREQ HP" />
            <span className="stack-centre">
              <span className="row-start">
                <span className="legend">FILTER</span>
                <Led on={filterOn.value >= 0.5} />
              </span>
              <span className="legend">ON</span>
              <PanelButton id="synth.filter.on" variant="dark" className="pbtn--tall" />
            </span>
          </div>
        </div>

        <div className="plate-group" style={{ left: '91.2%', top: '54.6%', width: '8.1%', height: '18%' }}>
          <h3 className="plate-group__title">AMP</h3>
          <span className="row-start">
            <Led />
            <span className="legend">ENVELOPE</span>
          </span>
          <PanelButton id="synth.amp.envelope" variant="dark" className="pbtn--wide pbtn--framed" />
          <span className="legend">VELOCITY ▽</span>
        </div>

        <div className="plate-group" style={{ left: '91.2%', top: '73.6%', width: '8.1%', height: '19.3%' }}>
          <h3 className="plate-group__title">UNISON</h3>
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
          <PanelButton id="synth.unison" variant="dark" className="pbtn--wide" />
        </div>
      </div>
    </>
  )
}
