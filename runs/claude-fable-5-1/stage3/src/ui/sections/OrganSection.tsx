import { Led } from '../controls/Led'
import { Drawbar, Fader } from '../controls/Fader'
import { PanelButton, SelectorLeds } from '../controls/PanelButton'
import { useInstrumentState } from '../context'
import { At, Group, Lgd, SectionStrip } from '../layout'
import { ZoneLeds } from '../ZoneLeds'

const DRAWBARS: [string, string][] = [
  ['organ.drawbar.16', 'BASS16\n16′'],
  ['organ.drawbar.5-1-3', 'STR16\n8′'],
  ['organ.drawbar.8', 'FLUTE8\n4′'],
  ['organ.drawbar.4', 'OBOE8\n2′'],
  ['organ.drawbar.2-2-3', 'TRMP8\nII'],
  ['organ.drawbar.2', 'STR8\nIII'],
  ['organ.drawbar.1-3-5', 'FLUTE4\nIV'],
  ['organ.drawbar.1-1-3', 'STR4\n'],
  ['organ.drawbar.1', '2 2/3\n∿-∿'],
]

/**
 * Dark inset plate: layer faders, organ model / vib-chorus / percussion switches, nine drawbars.
 * Phase 3: every control is functional through src/audio/instrumentController.ts; the LEDs show the focused layer
 * (blinking ON/OFF LED when both layers are on), its SUSTPED / PSTICK, its KB zones and, for Farf, the register state.
 */
export function OrganSection() {
  const organ = useInstrumentState((s) => s.organ)
  const fxFocus = useInstrumentState((s) => s.effects.focus)
  const focused = organ.layers[organ.focus]
  const bothOn = organ.layers.A.on && organ.layers.B.on
  const farf = focused.model === 2
  return (
    <>
      <At x={0} y={9} w={100} className="rail-legends rail-legends-organ">
        <Lgd>OUT 1</Lgd>
        <Lgd>—</Lgd>
        <Lgd>OUT 2</Lgd>
        <Lgd>OUT 3</Lgd>
        <Lgd>—</Lgd>
        <Lgd>OUT 4</Lgd>
        <Lgd>CONTROL PEDAL</Lgd>
        <Lgd>ORGAN SWELL</Lgd>
        <Lgd>SUSTAIN PEDAL</Lgd>
        <Lgd>TRIPLE PEDAL</Lgd>
      </At>
      <div className="panel" style={{ left: '0.5%', width: '98%' }}>
        <SectionStrip title="ORGAN" onId="organ.on" fxLit={fxFocus === 'organ'} />
      </div>
      <At x={1.5} y={25} w={17} h={23} className="faders">
        <Fader id="organ.layer-a.level" />
        <Fader id="organ.layer-b.level" />
      </At>
      <At x={1} y={50} w={18.5} className="layer-row">
        <span className="layer-cell" data-section-layer="A" data-focus={organ.focus === 'A'}>
          <span className="layer-name">
            <b>A</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="organ.layer-a.on" led="above" ledLegend="ON/OFF ▾" className={bothOn && organ.focus === 'A' ? 'is-focus' : ''} legendBelow={<Led legend="SUSTPED" small lit={focused.sustped} className="led-organ-sustped" />} />
        </span>
        <span className="layer-cell" data-section-layer="B" data-focus={organ.focus === 'B'}>
          <span className="layer-name">
            <b>B</b> <Lgd>AUX KB</Lgd> <Led small />
          </span>
          <PanelButton id="organ.layer-b.on" led="above" ledLegend="ON/OFF ▾" className={bothOn && organ.focus === 'B' ? 'is-focus' : ''} legendBelow={<Led legend="PSTICK" small lit={focused.pstick} className="led-organ-pstick" />} />
        </span>
      </At>
      <At x={4} y={66} w={12} className="center">
        <PanelButton id="organ.preset" led="above" ledLegend="PRESET" legendBelow="SYNC ▽" />
      </At>
      <At x={1} y={80} w={18.5} className="octave-block">
        <Lgd>◀ OCTAVE SHIFT ▶</Lgd>
        <span className="octave-btns">
          <PanelButton id="organ.octave-down" led="none" />
          <PanelButton id="organ.octave-up" led="none" />
        </span>
        <Lgd>◀ KB ZONE ▶</Lgd>
        <ZoneLeds layer={organ.focus === 'A' ? 'organA' : 'organB'} />
      </At>
      <Group title="ORGAN MODEL" x={21.5} y={26} w={13.5} h={20}>
        <At x={3} y={16} w={94} h={50}>
          <SelectorLeds id="organ.model" layout="matrix" labels={['B3', 'VOX', 'FARF', 'PIPE1', 'PIPE2', 'B3 BASS']} />
        </At>
        <At x={20} y={70} w={60} className="center">
          <PanelButton id="organ.model" led="none" />
        </At>
      </Group>
      <Group title="VIB/CHORUS" x={36} y={26} w={22} h={20}>
        <At x={4} y={24} w={40} className="center">
          <PanelButton id="organ.vibrato.mode" led="none" />
        </At>
        <At x={48} y={14} w={50} h={50}>
          <SelectorLeds id="organ.vibrato.mode" layout="matrix" labels={['V1', 'V2', 'V3', 'C1', 'C2', 'C3']} order={[0, 2, 4, 1, 3, 5]} className="sel-matrix-tight" />
        </At>
        <At x={28} y={68} w={50} className="center">
          <PanelButton id="organ.vibrato.on" led="left" ledLegend="ON" />
        </At>
      </Group>
      <Group title="B3 PERCUSSION" x={59.5} y={26} w={38.5} h={20}>
        <At x={3} y={12} w={94} className="perc-row">
          <PanelButton id="organ.percussion.volume" legendAbove="VOLUME" led="above" ledLegend="SOFT" />
          <PanelButton id="organ.percussion.decay" legendAbove="DECAY" led="above" ledLegend="FAST" />
          <PanelButton id="organ.percussion.harmonic" legendAbove="HARMONIC" led="above" ledLegend="THIRD" />
        </At>
        <At x={4} y={74} w={30}>
          <Led legend="POLY ▽" small lit={organ.percussion.poly} className="led-perc-poly" />
        </At>
        <At x={60} y={68} w={36} className="center">
          <PanelButton id="organ.percussion.on" led="left" ledLegend="ON" />
        </At>
      </Group>
      <At x={21} y={48} w={77.5} h={42} className="drawbars" data-model={focused.model}>
        {DRAWBARS.map(([id, top]) => (
          <Drawbar key={id} id={id} topLegend={top} farf={farf} />
        ))}
      </At>
    </>
  )
}
