import { useSyncExternalStore } from 'react'
import { Led } from '../controls/Led'
import { Dial } from '../controls/Knob'
import { PanelButton } from '../controls/PanelButton'
import { useInstrumentState, useServices } from '../context'
import { At, Group, Lgd } from '../layout'
import { ProgramOled } from '../Oled'

/**
 * Red and dark central control area: morph assign, split/clock/transpose, store, preset library, program OLED,
 * program dial and buttons, solo/section edit, shift/exit. Phase 3: LEDs show morph assignments, the active split
 * points (L / M / H), the Master Clock beat, a pending Store, Transpose, Live Mode and Layer Scene II.
 */
export function ProgramSection() {
  const { midi } = useServices()
  const midiStatus = useSyncExternalStore(midi.subscribe, midi.getStatus, midi.getStatus)
  const split = useInstrumentState((s) => s.split)
  const morph = useInstrumentState((s) => s.morph)
  const morphArmed = useInstrumentState((s) => s.morphArmed)
  const bpm = useInstrumentState((s) => s.clock.bpm)
  const viewMode = useInstrumentState((s) => s.view.mode)
  const shiftArmed = useInstrumentState((s) => s.shiftArmed)
  const storePending = viewMode === 'store' || viewMode === 'storeAs'
  const wheelLit = morphArmed.source === 'wheel' || morph.wheel.length > 0
  const pedalLit = morphArmed.source === 'pedal' || morph.pedal.length > 0
  return (
    <>
      <At x={0} y={9} w={100} className="rail-legends rail-legends-program">
        <Lgd>ROTOR PEDAL</Lgd>
        <Lgd>USB</Lgd>
        <Lgd>FOOT SWITCH</Lgd>
      </At>
      <Group title="MORPH ASSIGN" x={4} y={18.5} w={41} h={12.5} className="light-group">
        <At x={2} y={18} w={96} className="morph-row">
          <PanelButton id="program.morph.wheel" led="above" ledLegend="WHEEL ▾" ledLit={wheelLit} ledClassName={morphArmed.source === 'wheel' ? 'led-morph-armed' : ''} className={morphArmed.source === 'wheel' ? 'is-armed' : ''} />
          <PanelButton id="program.morph.aftertouch" led="above" ledLegend="A.T. ▾" />
          <PanelButton id="program.morph.control-pedal" led="above" ledLegend="CTRLPED ▾" ledLit={pedalLit} ledClassName={morphArmed.source === 'pedal' ? 'led-morph-armed' : ''} className={morphArmed.source === 'pedal' ? 'is-armed' : ''} />
        </At>
        <span className="group-foot">CLEAR MORPH</span>
      </Group>
      <Group title="SPLIT" x={47.5} y={18.5} w={14} h={12.5} className="light-group group-red-title">
        <span className="split-leds" data-split={split.on}>
          <Led small color="yellow" lit={split.on && split.points.low.note !== null} className="led-split-low" />
          <Led small color="yellow" lit={split.on && split.points.mid.note !== null} className="led-split-mid" />
          <Led small color="yellow" lit={split.on && split.points.high.note !== null} className="led-split-high" />
        </span>
        <At x={4} y={34} w={92} className="center">
          <PanelButton id="program.split" led="above" ledLegend="ON/SET ▾" legendBelow="SET KEY" className={viewMode === 'split' ? 'is-page' : ''} />
        </At>
      </Group>
      <Group title="MST CLK" x={64.5} y={18.5} w={14.5} h={12.5} className="light-group group-red-title">
        <At x={3} y={22} w={94} className="center">
          <PanelButton id="program.master-clock" led="above" ledLegend="TAP/SET ▾" ledLit ledClassName="led-clock" style={{ ['--beat' as string]: `${(60 / bpm).toFixed(4)}s` }} legendBelow={<Led legend="PEDAL TAP" small />} className={viewMode === 'clock' ? 'is-page' : ''} />
        </At>
      </Group>
      <Group title="TRANSP" x={81.5} y={18.5} w={14.5} h={12.5} className="light-group group-red-title">
        <At x={3} y={22} w={94} className="center">
          <PanelButton id="program.transpose" led="above" ledLegend="ON/SET ▾" legendBelow="PANIC" className={viewMode === 'transpose' ? 'is-page' : ''} />
        </At>
      </Group>
      <At x={3} y={32.5} w={17} className="center">
        <PanelButton id="program.store" led="above" ledLegend="STORE" ledLit={storePending} ledClassName={storePending ? 'led-store-pending' : ''} legendBelow={<span className="lgd-xs">STORE AS… <span className="lgd-dim">PAGE NAME</span></span>} />
      </At>
      <At x={23} y={34.5} w={7} className="stack-leds">
        <Led legend="MIDI" small side="above" lit={midiStatus.state === 'ready'} className="led-midi" />
        <Led legend="EXTERN" small side="above" />
      </At>
      <Group title="PRESET LIBRARY" x={31} y={32} w={42} h={11.5} className="light-group">
        <At x={2} y={20} w={96} className="morph-row">
          <PanelButton id="program.preset-library.organ" led="above" ledLegend="ORGAN" />
          <PanelButton id="program.preset-library.piano" led="above" ledLegend="PIANO" />
          <PanelButton id="program.preset-library.synth" led="above" ledLegend="SYNTH" />
        </At>
        <span className="group-foot">SINGLE LAYER</span>
      </Group>
      <At x={81.5} y={31.5} w={14.5} className="center">
        <PanelButton id="program.prog-view" led="none" legendAbove="PROG VIEW" legendBelow={<span className="lgd-xs">PRESET NAME</span>} />
      </At>
      <At x={29.5} y={45.5} w={44.5} h={16}>
        <ProgramOled />
      </At>
      <At x={29.5} y={62.5} w={44.5} className="soft-ticks" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </At>
      <At x={6} y={45} w={17} h={12} className="center">
        <Dial id="program.dial" size="large" legend="PROGRAM" legendBox="LIST" />
      </At>
      <At x={3} y={61.5} w={23} className="page-block">
        <Lgd>◀ PAGE/CAT ▶</Lgd>
        <span className="octave-btns">
          <PanelButton id="program.page-prev" led="none" />
          <PanelButton id="program.page-next" led="none" />
        </span>
        <Lgd>◀ BANK ▶</Lgd>
      </At>
      <At x={4} y={71} w={20} className="center">
        <PanelButton id="program.live-mode" led="above" ledLegend="LIVE MODE" legendBelow={<Led legend="NUM PAD" small />} />
      </At>
      <At x={3} y={81} w={23} h={9.5} className="group light-frame center">
        <PanelButton id="program.layer-scene" led="above" ledLegend={'LAYER SCENE II'} legendBelow={<Led legend="PEDAL" small />} />
      </At>
      <Group title="PROGRAM" x={26} y={67.5} w={53.5} h={22.5} className="program-buttons">
        <At x={2} y={10} w={96} className="prog-row">
          {[1, 2, 3, 4].map((n) => (
            <PanelButton key={n} id={`program.button.${n}`} led="above" ledLegend={String(n)} legendBelow={['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB'][n - 1]} />
          ))}
        </At>
        <At x={2} y={54} w={96} className="prog-row">
          {[5, 6, 7, 8].map((n) => (
            <PanelButton key={n} id={`program.button.${n}`} led="above" ledLegend={String(n)} legendBelow={['OUTPUT', 'PEDAL', 'MIDI', 'EXTERN'][n - 5]} />
          ))}
        </At>
      </Group>
      <At x={81.5} y={44} w={15} h={28} className="group light-frame side-column">
        <PanelButton id="program.solo" led="above" ledLegend="SOLO" legendBelow="UNDO" />
        <PanelButton id="program.section-edit" led="above" ledLegend="SECTION EDIT ⇟" legendBelow="LAYER INIT" />
        <PanelButton id="program.mon-copy" led="none" legendAbove="MON/COPY" legendBelow="PASTE ⇟" />
      </At>
      <At x={85} y={75} w={11.5} h={15} className="group light-frame shift-frame center">
        <PanelButton id="program.shift" led="none" legendAbove="SHIFT" legendBelow="EXIT" className={shiftArmed ? 'is-armed' : ''} />
      </At>
    </>
  )
}
