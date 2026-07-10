import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import {
  INITIAL_HARDWARE_STATE, KEYS, ORGAN_DRAWBARS,
  PERFORMANCE_CONTROLS, PROGRAM_CONTROLS, SECTION_WIDTHS, SYNTH_CONTROLS,
  type HardwareControl, type HardwareState, type SectionId,
} from './hardware'
import { PianoInputController, type MidiAccessLike, type MidiInputLike } from './inputs'
import { type NoteSnapshot, type PianoStatus, type PlayablePianoEngine } from './piano'
import { StagePianoEngine } from './stage-engine'
import {
  AMP_TYPES, ARP_DIRECTIONS, ARP_MODES, FEEDBACK_FILTERS, FILTER_TRACKING, FILTER_TYPES,
  KB_TOUCHES, LFO_DESTINATIONS, LFO_WAVEFORMS, MOD1_TYPES, MOD2_TYPES, NOTE_PRIORITIES,
  PIANO_TYPES, REVERB_TYPES, SYNTH_CATEGORIES, SYNTH_WAVEFORMS, TIMBRES,
  VIBRATO_CHORUS, VOICE_MODES, createInitialInstrumentState, cycle, effectTargetForFocus,
  getEffectChain, updateEffectTarget, type EffectTarget, type EffectUnitId, type InstrumentState,
  type LayerAddress, type LayerId, type MorphDestination, type MorphSource, type OrganLayerState,
  type SynthLayerId, type SynthLayerState, type ZoneRange,
} from './instrument'
import {
  assignMorph, autoStoreLive, clearMorph, currentSlot, cycleSplitPosition,
  isProgramDirty, loadProgramMemory, restoreProgram, saveProgramMemory, selectLive, selectProgram, setLayerEnabled,
  splitPositionMidi, storeAt, switchScene, tempoFromTaps, type ProgramMemoryState,
} from './programs'

interface AppProps {
  engine?: PlayablePianoEngine
  requestMidiAccess?: () => Promise<MidiAccessLike>
}

type SetInstrument = (update: (state: InstrumentState) => InstrumentState) => void

function FunctionalButton({ id, label, pressed, onClick, onDoubleClick, valueText, compact = true, unsupported = false }: {
  id: string
  label: string
  pressed: boolean
  onClick: () => void
  onDoubleClick?: () => void
  valueText?: string
  compact?: boolean
  unsupported?: boolean
}) {
  return (
    <button
      type="button" id={id} className={`panel-button ${pressed ? 'is-on' : ''} ${compact ? 'compact' : ''}`}
      aria-label={unsupported ? `${label} (unsupported)` : valueText ? `${label}: ${valueText}` : label}
      aria-pressed={pressed} data-control-id={id} data-functional={unsupported ? 'false' : 'true'}
      onClick={onClick} onDoubleClick={onDoubleClick}
    >
      <span className="button-led" aria-hidden="true" />
      <span>{valueText ?? label.replace(/^(Organ|Piano|Synth|Effects|Shared) /, '')}</span>
    </button>
  )
}

function FunctionalRange({ id, label, value, onChange, compact = true, morphAssigned = false, kind = 'knob' }: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  compact?: boolean
  morphAssigned?: boolean
  kind?: 'knob' | 'fader' | 'drawbar' | 'wheel'
}) {
  const normalized = Math.max(0, Math.min(100, value))
  const rotation = -138 + normalized * 2.76
  return (
    <label className={`continuous-control ${kind} ${compact ? 'compact' : ''} ${morphAssigned ? 'has-morph' : ''}`} htmlFor={id}>
      <span>{label.replace(/^(Organ|Piano|Synth|Effects|Shared) /, '')}</span>
      <span className="control-shell" style={{ '--control-turn': `${rotation}deg`, '--control-position': `${82 - normalized * .72}%`, '--wheel-position': `${(50 - normalized) * .055}em` } as CSSProperties}>
        <input id={id} type="range" min="0" max="100" value={Math.round(normalized)} aria-label={label}
          data-control-id={id} data-functional="true" data-morph-assigned={morphAssigned ? 'true' : 'false'}
          onChange={(event) => onChange(Number(event.currentTarget.value))} />
        {kind === 'knob' ? <span className="knob-face" aria-hidden="true" /> : null}
        {kind === 'wheel' ? <span className="wheel-face" aria-hidden="true" /> : null}
      </span>
    </label>
  )
}

const EMPTY_NOTES: NoteSnapshot = { activeNotes: [], activeVoiceCount: 0, sustain: false }

function hardwareReducer(state: HardwareState, action: { id: string; value: number }): HardwareState {
  return { ...state, [action.id]: action.value }
}

function DecorativeControl({ control, value, onChange, compact = false }: {
  control: HardwareControl
  value: number
  onChange: (id: string, value: number) => void
  compact?: boolean
}) {
  if (control.kind === 'button') {
    const pressed = value === 1
    return <FunctionalButton id={control.id} label={control.label} pressed={pressed} compact={compact} unsupported onClick={() => onChange(control.id, pressed ? 0 : 1)} />
  }
  const rotation = -138 + (value / control.max) * 276
  return (
    <label className={`continuous-control ${control.kind} ${compact ? 'compact' : ''}`} htmlFor={control.id}>
      <span>{control.label.replace(/^(Organ|Piano|Synth|Effects) /, '')}</span>
      <span className="control-shell" style={{
        '--control-turn': `${rotation}deg`, '--control-position': `${82 - value * .72}%`, '--wheel-position': `${(50 - value) * .055}em`,
      } as CSSProperties}>
        <input id={control.id} type="range" min={control.min} max={control.max} step={control.step} value={value}
          aria-label={`${control.label} (unsupported)`} data-control-id={control.id} data-functional="false"
          onChange={(event) => onChange(control.id, Number(event.currentTarget.value))} />
        {(control.kind === 'knob' || control.kind === 'encoder') ? <span className="knob-face" aria-hidden="true" /> : null}
        {control.kind === 'wheel' ? <span className="wheel-face" aria-hidden="true" /> : null}
      </span>
    </label>
  )
}

function Section({ id, title, children }: { id: SectionId; title: string; children: React.ReactNode }) {
  return (
    <section className={`instrument-section section-${id}`} data-section={id} aria-label={`${title} section`}
      style={{ '--section-width': `${SECTION_WIDTHS[id]}%` } as CSSProperties}>
      <h2>{title}</h2>{children}
    </section>
  )
}

const hasMorph = (state: InstrumentState, destination: MorphDestination) =>
  state.morphs.assignments.wheel.some((item) => item.destination === destination)
  || state.morphs.assignments.controlPedal.some((item) => item.destination === destination)

function setMorphable(state: InstrumentState, destination: MorphDestination, current: number, next: number, apply: (state: InstrumentState, value: number) => InstrumentState): InstrumentState {
  const source = state.morphs.editing
  if (source) return assignMorph(state, source, destination, current, next)
  return apply(state, next)
}

function PerformanceSection({ state, onChange, instrument, setInstrument }: {
  state: HardwareState; onChange: (id: string, value: number) => void; instrument: InstrumentState; setInstrument: SetInstrument
}) {
  return (
    <Section id="performance" title="Performance">
      <div className="brand-lockup" aria-label="Nord Stage 4 73"><strong>nord</strong><span>STAGE 4</span><small>73</small></div>
      <div className="performance-knobs">
        <FunctionalRange id="performance-master-level" label="Master level" value={instrument.masterLevel * 100} compact={false}
          onChange={(value) => setInstrument((current) => ({ ...current, masterLevel: value / 100 }))} />
        <DecorativeControl control={PERFORMANCE_CONTROLS[3]} value={state['performance-monitor-level']} onChange={onChange} />
        <DecorativeControl control={PERFORMANCE_CONTROLS[4]} value={state['performance-panel-lock']} onChange={onChange} />
      </div>
      <div className="performance-wheels">
        <FunctionalRange id="performance-pitch-stick" label="Pitch stick" value={(instrument.pitchBend + 1) * 50} compact={false} kind="wheel"
          onChange={(value) => setInstrument((current) => ({ ...current, pitchBend: (value - 50) / 50 }))} />
        <FunctionalRange id="performance-mod-wheel" label="Modulation wheel" value={instrument.morphs.values.wheel * 100} compact={false} kind="wheel"
          onChange={(value) => setInstrument((current) => ({ ...current, morphs: { ...current.morphs, values: { ...current.morphs.values, wheel: value / 100 } } }))} />
      </div>
    </Section>
  )
}

function OrganSection({ instrument, setInstrument }: { instrument: InstrumentState; setInstrument: SetInstrument }) {
  const focusedId = instrument.organ.focus
  const focused = instrument.organ.layers[focusedId]
  const setLayer = (layerId: LayerId, patch: Partial<OrganLayerState>) => setInstrument((state) => ({ ...state, organ: { ...state.organ, layers: { ...state.organ.layers, [layerId]: { ...state.organ.layers[layerId], ...patch } } } }))
  const chooseLayer = (layerId: LayerId) => setInstrument((state) => {
    const address = `organ:${layerId}` as LayerAddress
    if (!state.organ.layers[layerId].enabled) {
      const enabled = setLayerEnabled(state, address, true)
      return { ...enabled, organ: { ...enabled.organ, focus: layerId }, effectsFocus: { section: 'organ', layer: layerId } }
    }
    if (state.organ.focus !== layerId) return { ...state, organ: { ...state.organ, focus: layerId }, effectsFocus: { section: 'organ', layer: layerId } }
    return setLayerEnabled(state, address, false)
  })
  const modelButton = (id: string, model: 'B3' | 'Vox' | 'Farf' | 'Pipe 1') => (
    <FunctionalButton id={id} label={`${model} organ model`} pressed={model === 'B3' ? focused.model.startsWith('B3') : model === 'Pipe 1' ? focused.model.startsWith('Pipe') : focused.model === model}
      valueText={model === 'Pipe 1' ? focused.model.startsWith('Pipe') ? focused.model : 'PIPE' : model}
      onClick={() => setLayer(focusedId, { model: model === 'B3' && focused.model === 'B3' ? 'B3 Bass' : model === 'Pipe 1' && focused.model === 'Pipe 1' ? 'Pipe 2' : model })} />
  )
  return (
    <Section id="organ" title="Organ">
      <div className="section-top-row">
        {(['A', 'B'] as LayerId[]).map((id) => <FunctionalButton key={id} id={`organ-layer-${id.toLowerCase()}`} label={`Organ layer ${id}`} pressed={focusedId === id && instrument.organ.layers[id].enabled} valueText={`${id}${instrument.organ.layers[id].enabled ? '' : ' OFF'}`} onClick={() => chooseLayer(id)} />)}
        {(['A', 'B'] as LayerId[]).map((id) => <FunctionalRange key={id} id={`organ-level-${id.toLowerCase()}`} label={`Organ layer ${id} level`} value={instrument.organ.layers[id].level * 100} kind="fader"
          morphAssigned={hasMorph(instrument, `organ:${id}`)} onChange={(value) => setInstrument((state) => setMorphable(state, `organ:${id}`, state.organ.layers[id].level, value / 100, (next, level) => ({ ...next, organ: { ...next.organ, layers: { ...next.organ.layers, [id]: { ...next.organ.layers[id], level } } } })))} />)}
        {modelButton('organ-model-b3', 'B3')}{modelButton('organ-model-vox', 'Vox')}{modelButton('organ-model-farf', 'Farf')}{modelButton('organ-model-pipe', 'Pipe 1')}
      </div>
      <div className="drawbar-bank" aria-label="Nine organ drawbars">
        {ORGAN_DRAWBARS.map((control, index) => <FunctionalRange key={control.id} id={control.id} label={control.label} value={(focused.drawbars[index] / 8) * 100} kind="drawbar"
          morphAssigned={hasMorph(instrument, `organ:${focusedId}:drawbar:${index}`)}
          onChange={(value) => setInstrument((state) => {
            const current = state.organ.layers[focusedId].drawbars[index] / 8
            return setMorphable(state, `organ:${focusedId}:drawbar:${index}`, current, value / 100, (next, amount) => {
              const drawbars = next.organ.layers[focusedId].drawbars.slice(); drawbars[index] = Math.round(amount * 8)
              return { ...next, organ: { ...next.organ, layers: { ...next.organ.layers, [focusedId]: { ...next.organ.layers[focusedId], drawbars } } } }
            })
          })} />)}
      </div>
      <div className="section-bottom-row organ-bottom">
        <FunctionalButton id="organ-percussion" label="Organ percussion" pressed={focused.percussion} onClick={() => setLayer(focusedId, { percussion: !focused.percussion })} />
        <FunctionalButton id="organ-percussion-soft" label="Percussion soft" pressed={focused.percussionSoft} valueText="SOFT" onClick={() => setLayer(focusedId, { percussionSoft: !focused.percussionSoft })} />
        <FunctionalButton id="organ-percussion-fast" label="Percussion fast" pressed={focused.percussionFast} valueText="FAST" onClick={() => setLayer(focusedId, { percussionFast: !focused.percussionFast })} />
        <FunctionalButton id="organ-percussion-third" label="Percussion third harmonic" pressed={focused.percussionThird} valueText="3RD" onClick={() => setLayer(focusedId, { percussionThird: !focused.percussionThird })} />
        <FunctionalButton id="organ-vibrato" label="Organ vibrato chorus" pressed={focused.vibratoOn} valueText="VIB/CHOR" onClick={() => setLayer(focusedId, { vibratoOn: !focused.vibratoOn })} />
        <FunctionalButton id="organ-vibrato-type" label="Organ vibrato type" pressed={focused.vibratoOn} valueText={focused.vibrato} onClick={() => setLayer(focusedId, { vibrato: cycle(VIBRATO_CHORUS, focused.vibrato) })} />
        <FunctionalButton id="organ-rotary-speed" label="Rotary speed" pressed={instrument.rotaryFast} valueText={instrument.rotaryStopped ? 'STOP' : instrument.rotaryFast ? 'FAST' : 'SLOW'} onClick={() => setInstrument((state) => state.morphs.editing
          ? assignMorph(state, state.morphs.editing, 'rotary:speed', state.rotaryFast ? 1 : 0, state.rotaryFast ? 0 : 1)
          : ({ ...state, rotaryFast: !state.rotaryFast, rotaryStopped: false }))} />
        <FunctionalRange id="organ-rotary-drive" label="Rotary drive" value={instrument.rotaryDrive * 100} onChange={(value) => setInstrument((state) => ({ ...state, rotaryDrive: value / 100 }))} />
        <FunctionalButton id="organ-sustped" label="Organ sustain pedal routing" pressed={focused.sustped} valueText="SUSTPED" onClick={() => setLayer(focusedId, { sustped: !focused.sustped })} />
        <FunctionalButton id="organ-pstick" label="Organ pitch stick routing" pressed={focused.pstick} valueText="PSTICK" onClick={() => setLayer(focusedId, { pstick: !focused.pstick })} />
        <FunctionalButton id="organ-key-click" label="Organ key click" pressed={focused.keyClick} valueText="CLICK" onClick={() => setLayer(focusedId, { keyClick: !focused.keyClick })} />
        <FunctionalButton id="organ-octave-down" label="Organ octave down" pressed={focused.octave === -12} valueText="OCT −" onClick={() => setLayer(focusedId, { octave: focused.octave === -12 ? 0 : -12 })} />
        <FunctionalButton id="organ-octave-up" label="Organ octave up" pressed={focused.octave === 12} valueText="OCT +" onClick={() => setLayer(focusedId, { octave: focused.octave === 12 ? 0 : 12 })} />
        <FunctionalButton id="organ-section-on" label="Organ section on" pressed={instrument.organ.sectionOn} valueText="ON" onClick={() => setInstrument((state) => ({ ...state, organ: { ...state.organ, sectionOn: !state.organ.sectionOn } }))} />
        <FunctionalButton id="organ-rotary-route" label="Organ rotary routing" pressed={instrument.organ.rotaryRouted} valueText="TO ROTARY" onClick={() => setInstrument((state) => ({ ...state, organ: { ...state.organ, rotaryRouted: !state.organ.rotaryRouted } }))} />
        <FunctionalButton id="organ-rotary-stop" label="Rotary stop" pressed={instrument.rotaryStopped} valueText="STOP" onClick={() => setInstrument((state) => ({ ...state, rotaryStopped: !state.rotaryStopped, rotaryFast: false }))} />
      </div>
    </Section>
  )
}

function PianoSection({ instrument, setInstrument }: { instrument: InstrumentState; setInstrument: SetInstrument }) {
  const focused = instrument.layers[instrument.focus]
  const setLayer = (layerId: LayerId, patch: Partial<InstrumentState['layers']['A']>) => setInstrument((state) => ({ ...state, layers: { ...state.layers, [layerId]: { ...state.layers[layerId], ...patch } } }))
  const chooseLayer = (layerId: LayerId) => setInstrument((state) => {
    if (!state.layers[layerId].enabled) {
      const enabled = setLayerEnabled(state, `piano:${layerId}`, true)
      return { ...enabled, focus: layerId, effectsFocus: { section: 'piano', layer: layerId } }
    }
    if (state.focus !== layerId) return { ...state, focus: layerId, effectsFocus: { section: 'piano', layer: layerId } }
    return setLayerEnabled(state, `piano:${layerId}`, false)
  })
  return (
    <Section id="piano" title="Piano">
      <div className="piano-levels">
        {(['A', 'B'] as LayerId[]).map((id) => <FunctionalButton key={id} id={`piano-layer-${id.toLowerCase()}`} label={`Piano layer ${id}`} pressed={instrument.layers[id].enabled && instrument.focus === id} valueText={`${id}${instrument.layers[id].enabled ? '' : ' OFF'}`} onClick={() => chooseLayer(id)} />)}
        {(['A', 'B'] as LayerId[]).map((id) => <FunctionalRange key={id} id={`piano-level-${id.toLowerCase()}`} label={`Piano layer ${id} level`} value={instrument.layers[id].level * 100} kind="fader"
          morphAssigned={hasMorph(instrument, `piano:${id}`)} onChange={(value) => setInstrument((state) => setMorphable(state, `piano:${id}`, state.layers[id].level, value / 100, (next, level) => ({ ...next, layers: { ...next.layers, [id]: { ...next.layers[id], level } } })))} />)}
      </div>
      <div className="type-stack" aria-label="Piano type selectors">
        {PIANO_TYPES.map((type) => <FunctionalButton key={type} id={`piano-type-${type === 'Misc' ? 'misc' : type.toLowerCase()}`} label={`${type} piano type`} pressed={focused.type === type} valueText={type} onClick={() => setLayer(instrument.focus, { type, model: `${type} 1` })} />)}
      </div>
      <div className="piano-detail">
        <FunctionalRange id="piano-model" label="Piano model selector" value={PIANO_TYPES.indexOf(focused.type) * 20} onChange={(value) => { const type = PIANO_TYPES[Math.min(5, Math.round(value / 20))]; setLayer(instrument.focus, { type, model: `${type} 1` }) }} />
        <FunctionalButton id="piano-timbre" label="Piano timbre" pressed={focused.timbre !== 'Off'} valueText={focused.timbre} onClick={() => setLayer(instrument.focus, { timbre: cycle(focused.type === 'Electric' ? TIMBRES : TIMBRES.slice(0, 4), focused.timbre) })} />
        <FunctionalButton id="piano-kb-touch" label="Keyboard touch" pressed valueText={focused.kbTouch} onClick={() => setLayer(instrument.focus, { kbTouch: cycle(KB_TOUCHES, focused.kbTouch) })} />
        <FunctionalButton id="piano-dyn-comp" label="Dynamic compression" pressed={focused.dynComp > 0} valueText={focused.dynComp ? String(focused.dynComp) : 'OFF'} onClick={() => setLayer(instrument.focus, { dynComp: ((focused.dynComp + 1) % 4) as 0 | 1 | 2 | 3 })} />
        <FunctionalButton id="piano-unison" label="Piano unison" pressed={focused.unison > 0} valueText={focused.unison ? String(focused.unison) : 'OFF'} onClick={() => setLayer(instrument.focus, { unison: ((focused.unison + 1) % 4) as 0 | 1 | 2 | 3 })} />
        <FunctionalButton id="piano-soft-release" label="Soft release" pressed={focused.softRelease} onClick={() => setLayer(instrument.focus, { softRelease: !focused.softRelease })} />
        <FunctionalButton id="piano-string-res" label="String resonance" pressed={focused.stringRes} onClick={() => setLayer(instrument.focus, { stringRes: !focused.stringRes })} />
        <FunctionalButton id="piano-sustped" label="Piano sustain pedal routing" pressed={focused.sustped} valueText="SUSTPED" onClick={() => setLayer(instrument.focus, { sustped: !focused.sustped })} />
        <FunctionalButton id="piano-pstick" label="Piano pitch stick routing" pressed={focused.pstick} valueText="PSTICK" onClick={() => setLayer(instrument.focus, { pstick: !focused.pstick })} />
        <FunctionalButton id="piano-octave-down" label="Piano octave down" pressed={focused.octave === -12} valueText="OCT −" onClick={() => setLayer(instrument.focus, { octave: focused.octave === -12 ? 0 : -12 })} />
        <FunctionalButton id="piano-octave-up" label="Piano octave up" pressed={focused.octave === 12} valueText="OCT +" onClick={() => setLayer(instrument.focus, { octave: focused.octave === 12 ? 0 : 12 })} />
        <FunctionalButton id="piano-section-on" label="Piano section on" pressed={instrument.sectionOn} valueText="ON" onClick={() => setInstrument((state) => ({ ...state, sectionOn: !state.sectionOn }))} />
      </div>
    </Section>
  )
}

const zoneRanges: ZoneRange[] = [{ from: 0, to: 3 }, { from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 3 }, { from: 0, to: 1 }, { from: 2, to: 3 }]

function ProgramSection({ instrument, setInstrument, memory, setMemory, dirty, controller }: {
  instrument: InstrumentState; setInstrument: SetInstrument; memory: ProgramMemoryState; setMemory: React.Dispatch<React.SetStateAction<ProgramMemoryState>>; dirty: boolean; controller: PianoInputController
}) {
  const [nameDraft, setNameDraft] = useState('')
  const [pendingName, setPendingName] = useState<string | undefined>()
  const [splitIndex, setSplitIndex] = useState(1)
  const taps = useRef<number[]>([])
  const slot = currentSlot(memory)
  const page = memory.liveMode ? 0 : memory.page
  const loadProgram = (index: number) => {
    if (memory.storeTarget !== null) { setMemory((current) => ({ ...current, storeTarget: index })); return }
    const next = selectProgram(memory, index); setMemory(next); setInstrument((state) => restoreProgram(next.programs[index].state, state)); controller.allNotesOff()
  }
  const loadLive = (index: number) => {
    const next = selectLive(memory, index); setMemory(next); setInstrument((state) => restoreProgram(next.live[index].state, state)); controller.allNotesOff()
  }
  const selectButton = (button: number) => memory.liveMode ? loadLive(button) : loadProgram(page * 8 + button)
  const handleStore = () => {
    if (memory.storeTarget === null) setMemory((current) => ({ ...current, storeTarget: current.selectedProgram }))
    else { setMemory((current) => storeAt(current, current.storeTarget!, instrument, pendingName)); setPendingName(undefined) }
  }
  const submitName = (event: FormEvent) => { event.preventDefault(); setPendingName(nameDraft.trim() || slot.name); setMemory((current) => ({ ...current, naming: false, storeTarget: current.selectedProgram })) }
  const clockTap = () => {
    taps.current = [...taps.current, performance.now()].slice(-5)
    const bpm = tempoFromTaps(taps.current)
    if (bpm) setInstrument((state) => ({ ...state, masterClockBpm: bpm }))
  }
  const focusedAddress = `${instrument.effectsFocus.section}:${instrument.effectsFocus.section === 'organ' ? instrument.organ.focus : instrument.effectsFocus.section === 'piano' ? instrument.focus : instrument.synth.focus}` as LayerAddress
  const currentZone = instrument.effectsFocus.section === 'organ' ? instrument.organ.layers[instrument.organ.focus].zone
    : instrument.effectsFocus.section === 'piano' ? instrument.layers[instrument.focus].zone ?? zoneRanges[0] : instrument.synth.layers[instrument.synth.focus].zone
  const cycleZone = () => setInstrument((state) => {
    const next = zoneRanges[(zoneRanges.findIndex((range) => range.from === currentZone.from && range.to === currentZone.to) + 1) % zoneRanges.length]
    if (state.effectsFocus.section === 'organ') return { ...state, organ: { ...state.organ, layers: { ...state.organ.layers, [state.organ.focus]: { ...state.organ.layers[state.organ.focus], zone: next } } } }
    if (state.effectsFocus.section === 'piano') return { ...state, layers: { ...state.layers, [state.focus]: { ...state.layers[state.focus], zone: next } } }
    return { ...state, synth: { ...state.synth, layers: { ...state.synth.layers, [state.synth.focus]: { ...state.synth.layers[state.synth.focus], zone: next } } } }
  })
  const morphButton = (source: MorphSource, id: string, label: string) => <FunctionalButton id={id} label={label} pressed={instrument.morphs.editing === source}
    valueText={instrument.morphs.assignments[source].length ? `${source === 'wheel' ? 'WHEEL' : 'CTRL'} ${instrument.morphs.assignments[source].length}` : source === 'wheel' ? 'WHEEL' : 'CTRL PED'}
    onClick={() => setInstrument((state) => ({ ...state, morphs: { ...state.morphs, editing: state.morphs.editing === source ? null : source } }))}
    onDoubleClick={() => setInstrument((state) => clearMorph(state, source))} />
  return (
    <Section id="program" title="Program · Morph">
      <div className="primary-oled program-oled" data-primary-oled="program" aria-label="Program OLED">
        <span>{memory.liveMode ? `LIVE ${memory.selectedLive + 1}` : `${memory.page + 1}.${memory.selectedProgram % 8 + 1}`} {dirty ? 'E' : ''}</span>
        <strong>{slot.name}</strong><small>{memory.storeTarget === null ? `${instrument.masterClockBpm} BPM · ${instrument.transpose >= 0 ? '+' : ''}${instrument.transpose} ST` : `STORE TO ${Math.floor(memory.storeTarget / 8) + 1}.${memory.storeTarget % 8 + 1} · PRESS STORE`}</small>
      </div>
      <div className="program-dial"><FunctionalRange id="program-value-dial" label="Program value dial" value={(memory.selectedProgram / 31) * 100} onChange={(value) => loadProgram(Math.round(value / 100 * 31))} /></div>
      <div className="program-bank">
        {Array.from({ length: 8 }, (_, index) => <FunctionalButton key={index} id={`program-program-${index + 1}`} label={`Program button ${index + 1}`} pressed={memory.liveMode ? memory.selectedLive === index : memory.selectedProgram === page * 8 + index}
          valueText={String(index + 1)} onClick={() => selectButton(index)} />)}
      </div>
      <div className="program-actions">
        <FunctionalButton id="program-page-left" label="Previous program page" pressed={false} valueText="PAGE ‹" onClick={() => setMemory((current) => ({ ...current, page: (current.page + 3) % 4 }))} />
        <FunctionalButton id="program-page-right" label="Next program page" pressed={false} valueText="PAGE ›" onClick={() => setMemory((current) => ({ ...current, page: (current.page + 1) % 4 }))} />
        <FunctionalButton id="program-live-mode" label="Live mode" pressed={memory.liveMode} valueText="LIVE" onClick={() => memory.liveMode ? loadProgram(memory.selectedProgram) : loadLive(memory.selectedLive)} />
        <FunctionalButton id="program-scene-i" label="Layer scene one" pressed={instrument.scenes.active === 'I'} valueText="SCENE I" onClick={() => setInstrument((state) => switchScene(state, 'I'))} />
        <FunctionalButton id="program-scene-ii" label="Layer scene two" pressed={instrument.scenes.active === 'II'} valueText="SCENE II" onClick={() => setInstrument((state) => switchScene(state, 'II'))} />
        <FunctionalButton id="program-store" label="Store program" pressed={memory.storeTarget !== null} valueText="STORE" onClick={handleStore} />
        <FunctionalButton id="program-split" label="Keyboard split" pressed={instrument.splits.enabled} valueText="SPLIT" onClick={() => setInstrument((state) => ({ ...state, splits: { ...state.splits, enabled: !state.splits.enabled } }))} />
        <FunctionalButton id="program-shift" label="Shift and exit" pressed={false} valueText="EXIT" onClick={() => { setPendingName(undefined); setMemory((current) => ({ ...current, naming: false, storeTarget: null })) }} />
        {morphButton('wheel', 'program-morph-wheel', 'Wheel morph assign')}{morphButton('controlPedal', 'program-morph-control', 'Control pedal morph assign')}
        <DecorativeControl control={PROGRAM_CONTROLS.find((control) => control.id === 'program-morph-aftertouch')!} value={0} onChange={() => undefined} compact />
        <FunctionalButton id="program-transpose" label="Transpose" pressed={instrument.transpose !== 0} valueText={`TRANS ${instrument.transpose >= 0 ? '+' : ''}${instrument.transpose}`} onClick={() => setInstrument((state) => ({ ...state, transpose: state.transpose >= 6 ? -6 : state.transpose + 1 }))} />
        <FunctionalButton id="program-store-as" label="Store As" pressed={memory.naming} valueText="STORE AS" onClick={() => { setNameDraft(slot.name); setMemory((current) => ({ ...current, naming: true })) }} />
        <FunctionalButton id="program-list-view" label="Numeric program list view" pressed={memory.listOpen} valueText="LIST" onClick={() => setMemory((current) => ({ ...current, listOpen: !current.listOpen }))} />
        <FunctionalRange id="program-master-clock" label="Master clock" value={(instrument.masterClockBpm - 30) / 2.7} onChange={(value) => setInstrument((state) => ({ ...state, masterClockBpm: Math.round(30 + value * 2.7) }))} />
        <FunctionalButton id="program-clock-tap" label="Master clock tap" pressed={false} valueText="TAP" onClick={clockTap} />
        {instrument.splits.points.map((point, index) => <FunctionalButton key={index} id={`program-split-${['low', 'mid', 'high'][index]}`} label={`${['Low', 'Mid', 'High'][index]} split point`} pressed={point.enabled && splitIndex === index} valueText={`${point.position}${point.enabled ? '' : ' OFF'}`} onClick={() => { setSplitIndex(index); setInstrument((state) => { const points = [...state.splits.points] as InstrumentState['splits']['points']; points[index] = point.enabled ? { ...point, position: cycleSplitPosition(point.position) } : { ...point, enabled: true }; return { ...state, splits: { ...state.splits, enabled: true, points } } }) }} />)}
        <FunctionalButton id="program-split-crossfade" label="Split crossfade width" pressed={instrument.splits.points[splitIndex].crossfade > 0} valueText={`XFADE ${instrument.splits.points[splitIndex].crossfade || 'OFF'}`} onClick={() => setInstrument((state) => { const points = [...state.splits.points] as InstrumentState['splits']['points']; const current = points[splitIndex].crossfade; points[splitIndex] = { ...points[splitIndex], crossfade: current === 0 ? 6 : current === 6 ? 12 : 0 }; return { ...state, splits: { ...state.splits, points } } })} />
        <FunctionalButton id="program-zone-range" label="Focused layer keyboard zone" pressed={currentZone.from !== 0 || currentZone.to !== 3} valueText={`${focusedAddress} Z${currentZone.from + 1}–${currentZone.to + 1}`} onClick={cycleZone} />
        <FunctionalRange id="program-control-pedal" label="Control pedal" value={instrument.morphs.values.controlPedal * 100} kind="fader" onChange={(value) => setInstrument((state) => ({ ...state, morphs: { ...state.morphs, values: { ...state.morphs.values, controlPedal: value / 100 } } }))} />
        <FunctionalButton id="program-panic" label="Panic all notes off" pressed={false} valueText="PANIC" onClick={() => { controller.allNotesOff(); setInstrument((state) => ({ ...state, sustainDown: false, pitchBend: 0, morphs: { ...state.morphs, values: { wheel: 0, controlPedal: 0 } } })) }} />
        <FunctionalButton id="program-keyboard-sync" label="Master clock keyboard sync" pressed={instrument.keyboardSync} valueText="KB SYNC" onClick={() => setInstrument((state) => ({ ...state, keyboardSync: !state.keyboardSync }))} />
      </div>
      {memory.listOpen ? <div className="program-overlay program-list" role="dialog" aria-label="Numeric program list">{memory.programs.map((program) => <button type="button" key={program.id} onClick={() => loadProgram(program.id)}>{Math.floor(program.id / 8) + 1}.{program.id % 8 + 1} {program.name}</button>)}</div> : null}
      {memory.naming ? <form className="program-overlay naming" aria-label="Store As naming" onSubmit={submitName}><label>PROGRAM NAME<input autoFocus value={nameDraft} maxLength={18} onChange={(event) => setNameDraft(event.currentTarget.value)} /></label><button type="submit">NAME</button><button type="button" onClick={() => setMemory((current) => ({ ...current, naming: false }))}>CANCEL</button></form> : null}
    </Section>
  )
}

function SynthSection({ state, onChange, instrument, setInstrument }: { state: HardwareState; onChange: (id: string, value: number) => void; instrument: InstrumentState; setInstrument: SetInstrument }) {
  const focusedId = instrument.synth.focus
  const focused = instrument.synth.layers[focusedId]
  const setLayer = (layerId: SynthLayerId, patch: Partial<SynthLayerState>) => setInstrument((state) => ({ ...state, synth: { ...state.synth, layers: { ...state.synth.layers, [layerId]: { ...state.synth.layers[layerId], ...patch } } } }))
  const setEnvelope = (kind: 'oscEnvelope' | 'filterEnvelope' | 'ampEnvelope', patch: Partial<SynthLayerState['ampEnvelope']>) => setLayer(focusedId, { [kind]: { ...focused[kind], ...patch } })
  const chooseLayer = (layerId: SynthLayerId) => setInstrument((current) => {
    if (!current.synth.layers[layerId].enabled) {
      const enabled = setLayerEnabled(current, `synth:${layerId}`, true)
      return { ...enabled, synth: { ...enabled.synth, focus: layerId }, effectsFocus: { section: 'synth', layer: layerId } }
    }
    if (current.synth.focus !== layerId) return { ...current, synth: { ...current.synth, focus: layerId }, effectsFocus: { section: 'synth', layer: layerId } }
    return setLayerEnabled(current, `synth:${layerId}`, false)
  })
  const range = (id: string, label: string, value: number, update: (value: number) => void, destination?: MorphDestination) => <FunctionalRange id={id} label={label} value={value * 100} morphAssigned={destination ? hasMorph(instrument, destination) : false} onChange={(next) => {
    if (destination && instrument.morphs.editing) setInstrument((state) => assignMorph(state, instrument.morphs.editing!, destination, value, next / 100))
    else update(next / 100)
  }} />
  const envRange = (id: string, label: string, kind: 'oscEnvelope' | 'filterEnvelope' | 'ampEnvelope', key: 'attack' | 'decay' | 'release') => <FunctionalRange id={id} label={label} value={focused[kind][key] * 100} onChange={(value) => setEnvelope(kind, { [key]: value / 100 })} />
  return (
    <Section id="synth" title="Synth">
      <div className="synth-head">
        <div className="primary-oled synth-oled" data-primary-oled="synth" aria-label="Synth OLED"><span>{focused.category} · {focused.filterType}</span><strong>{focused.waveform}</strong><small>{focused.voiceMode} · {focused.arpRun ? `${focused.arpMode} ${focused.arpDirection}` : 'ARP OFF'}</small></div>
        <div className="synth-layers">
          {(['A', 'B', 'C'] as SynthLayerId[]).map((id) => <FunctionalButton key={id} id={`synth-layer-${id.toLowerCase()}`} label={`Synth layer ${id}`} pressed={focusedId === id && instrument.synth.layers[id].enabled} valueText={`${id}${instrument.synth.layers[id].enabled ? '' : ' OFF'}`} onClick={() => chooseLayer(id)} />)}
          {(['A', 'B', 'C'] as SynthLayerId[]).map((id) => <FunctionalRange key={id} id={`synth-level-${id.toLowerCase()}`} label={`Synth layer ${id} level`} value={instrument.synth.layers[id].level * 100} kind="fader"
            morphAssigned={hasMorph(instrument, `synth:${id}`)} onChange={(value) => setInstrument((current) => setMorphable(current, `synth:${id}`, current.synth.layers[id].level, value / 100, (next, level) => ({ ...next, synth: { ...next.synth, layers: { ...next.synth.layers, [id]: { ...next.synth.layers[id], level } } } })))} />)}
        </div>
      </div>
      <div className="synth-groups">
        <div><b>OSC</b>
          <FunctionalButton id="synth-osc-category" label="Oscillator category" pressed valueText={focused.category} onClick={() => { const category = cycle(SYNTH_CATEGORIES, focused.category); setLayer(focusedId, { category, waveform: SYNTH_WAVEFORMS[category][0] }) }} />
          {range('synth-osc-control', 'Oscillator control', focused.oscCtrl, (value) => setLayer(focusedId, { oscCtrl: value }), `synth:${focusedId}:oscCtrl`)}
          <FunctionalButton id="synth-osc-wave" label="Oscillator waveform" pressed valueText={focused.waveform} onClick={() => setLayer(focusedId, { waveform: cycle(SYNTH_WAVEFORMS[focused.category], focused.waveform) })} />
          <FunctionalRange id="synth-pitch" label="Oscillator pitch" value={(focused.coarse + 24) / 48 * 100} onChange={(value) => setLayer(focusedId, { coarse: Math.round(value / 100 * 48 - 24) })} />
          <FunctionalRange id="synth-fine" label="Oscillator fine tune" value={(focused.fine + 50)} onChange={(value) => setLayer(focusedId, { fine: Math.round(value - 50) })} />
          <DecorativeControl control={SYNTH_CONTROLS.find((control) => control.id === 'synth-shape')!} value={state['synth-shape']} onChange={onChange} compact />
          <FunctionalButton id="synth-unison" label="Synth unison" pressed={focused.unison > 0} valueText={focused.unison ? String(focused.unison) : 'OFF'} onClick={() => setLayer(focusedId, { unison: ((focused.unison + 1) % 4) as 0 | 1 | 2 | 3 })} />
          {envRange('synth-osc-env-attack', 'Oscillator envelope attack', 'oscEnvelope', 'attack')}{envRange('synth-osc-env-decay', 'Oscillator envelope decay', 'oscEnvelope', 'decay')}{envRange('synth-osc-env-release', 'Oscillator envelope release', 'oscEnvelope', 'release')}
          <FunctionalButton id="synth-osc-env-velocity" label="Oscillator envelope velocity" pressed={focused.oscEnvelope.velocity > 0} valueText={`VEL ${focused.oscEnvelope.velocity}`} onClick={() => setEnvelope('oscEnvelope', { velocity: ((focused.oscEnvelope.velocity + 1) % 4) as 0 | 1 | 2 | 3 })} />
        </div>
        <div><b>FILTER · LFO</b>
          {range('synth-filter-frequency', 'Filter frequency', focused.filterFreq, (value) => setLayer(focusedId, { filterFreq: value }), `synth:${focusedId}:filterFreq`)}
          {range('synth-filter-resonance', 'Filter resonance', focused.filterResonance, (value) => setLayer(focusedId, { filterResonance: value }), `synth:${focusedId}:filterResonance`)}
          <FunctionalRange id="synth-filter-drive" label="Filter drive" value={focused.filterDrive / 3 * 100} onChange={(value) => setLayer(focusedId, { filterDrive: Math.round(value / 100 * 3) as 0 | 1 | 2 | 3 })} />
          <FunctionalButton id="synth-filter-type" label="Filter type" pressed valueText={focused.filterType} onClick={() => setLayer(focusedId, { filterType: cycle(FILTER_TYPES, focused.filterType) })} />
          <FunctionalButton id="synth-filter-tracking" label="Filter keyboard tracking" pressed={focused.filterTracking !== 'Off'} valueText={focused.filterTracking} onClick={() => setLayer(focusedId, { filterTracking: cycle(FILTER_TRACKING, focused.filterTracking) })} />
          {range('synth-lfo-rate', 'LFO rate', focused.lfoRate, (value) => setLayer(focusedId, { lfoRate: value }), `synth:${focusedId}:lfoRate`)}
          {range('synth-lfo-amount', 'LFO amount', focused.lfoAmount, (value) => setLayer(focusedId, { lfoAmount: value }), `synth:${focusedId}:lfoAmount`)}
          <FunctionalButton id="synth-lfo-wave" label="LFO waveform" pressed={focused.lfoDestination !== 'Off'} valueText={focused.lfoWaveform} onClick={() => setLayer(focusedId, { lfoWaveform: cycle(LFO_WAVEFORMS, focused.lfoWaveform) })} />
          <FunctionalButton id="synth-lfo-destination" label="LFO destination" pressed={focused.lfoDestination !== 'Off'} valueText={focused.lfoDestination} onClick={() => setLayer(focusedId, { lfoDestination: cycle(LFO_DESTINATIONS, focused.lfoDestination) })} />
          <FunctionalButton id="synth-lfo-sync" label="LFO master clock sync" pressed={focused.lfoSync} valueText="SYNC" onClick={() => setLayer(focusedId, { lfoSync: !focused.lfoSync })} />
          {envRange('synth-filter-env-attack', 'Filter envelope attack', 'filterEnvelope', 'attack')}{envRange('synth-filter-env-decay', 'Filter envelope decay', 'filterEnvelope', 'decay')}{envRange('synth-filter-env-release', 'Filter envelope release', 'filterEnvelope', 'release')}
          <FunctionalButton id="synth-filter-env-velocity" label="Filter envelope velocity" pressed={focused.filterEnvelope.velocity > 0} valueText={`VEL ${focused.filterEnvelope.velocity}`} onClick={() => setEnvelope('filterEnvelope', { velocity: ((focused.filterEnvelope.velocity + 1) % 4) as 0 | 1 | 2 | 3 })} />
          <FunctionalRange id="synth-filter-env-amount" label="Filter envelope amount" value={focused.filterEnvelope.amount * 100} onChange={(value) => setEnvelope('filterEnvelope', { amount: value / 100 })} />
        </div>
        <div><b>ENVELOPES</b>
          {envRange('synth-amp-attack', 'Amplifier envelope attack', 'ampEnvelope', 'attack')}{envRange('synth-amp-decay', 'Amplifier envelope decay', 'ampEnvelope', 'decay')}
          <FunctionalRange id="synth-amp-sustain" label="Amplifier envelope sustain" value={focused.ampEnvelope.amount * 100} onChange={(value) => setEnvelope('ampEnvelope', { amount: value / 100 })} />
          {envRange('synth-amp-release', 'Amplifier envelope release', 'ampEnvelope', 'release')}
          {envRange('synth-mod-attack', 'Modulation envelope attack', 'oscEnvelope', 'attack')}{envRange('synth-mod-decay', 'Modulation envelope decay', 'oscEnvelope', 'decay')}
          <FunctionalRange id="synth-mod-amount" label="Modulation envelope amount" value={focused.oscEnvelope.amount * 100} onChange={(value) => setEnvelope('oscEnvelope', { amount: value / 100 })} />
          <FunctionalButton id="synth-amp-env-velocity" label="Amplifier envelope velocity" pressed={focused.ampEnvelope.velocity > 0} valueText={`VEL ${focused.ampEnvelope.velocity}`} onClick={() => setEnvelope('ampEnvelope', { velocity: ((focused.ampEnvelope.velocity + 1) % 4) as 0 | 1 | 2 | 3 })} />
          <FunctionalButton id="synth-vibrato-mode" label="Synth vibrato mode" pressed valueText={focused.vibratoMode} onClick={() => setLayer(focusedId, { vibratoMode: focused.vibratoMode === 'On' ? 'Wheel' : 'On' })} />
          <FunctionalRange id="synth-vibrato-rate" label="Synth vibrato rate" value={(focused.vibratoRate - 2) / 6 * 100} onChange={(value) => setLayer(focusedId, { vibratoRate: 2 + value / 100 * 6 })} />
          <FunctionalRange id="synth-vibrato-amount" label="Synth vibrato amount" value={focused.vibratoAmount * 100} onChange={(value) => setLayer(focusedId, { vibratoAmount: value / 100 })} />
        </div>
        <div><b>ARP · VOICE</b>
          <FunctionalButton id="synth-arp-run" label="Arpeggiator run" pressed={focused.arpRun} valueText="RUN" onClick={() => setLayer(focusedId, { arpRun: !focused.arpRun })} />
          {range('synth-arp-rate', 'Arpeggiator rate', focused.arpRate, (value) => setLayer(focusedId, { arpRate: value }), `synth:${focusedId}:arpRate`)}
          <FunctionalButton id="synth-arp-range" label="Arpeggiator range" pressed={focused.arpRange > 1} valueText={`${focused.arpRange} OCT`} onClick={() => setLayer(focusedId, { arpRange: (focused.arpRange === 4 ? 1 : focused.arpRange + 1) as 1 | 2 | 3 | 4 })} />
          <FunctionalButton id="synth-voice-mode" label="Synth voice mode" pressed={focused.voiceMode !== 'Poly'} valueText={focused.voiceMode} onClick={() => setLayer(focusedId, { voiceMode: cycle(VOICE_MODES, focused.voiceMode) })} />
          <FunctionalRange id="synth-glide" label="Synth glide" value={focused.glide * 100} onChange={(value) => setLayer(focusedId, { glide: value / 100 })} />
          <FunctionalButton id="synth-voice-priority" label="Synth note priority" pressed={focused.priority !== 'Off'} valueText={focused.priority} onClick={() => setLayer(focusedId, { priority: cycle(NOTE_PRIORITIES, focused.priority) })} />
          <FunctionalButton id="synth-arp-mode" label="Arpeggiator mode" pressed={focused.arpRun} valueText={focused.arpMode} onClick={() => setLayer(focusedId, { arpMode: cycle(ARP_MODES, focused.arpMode) })} />
          <FunctionalButton id="synth-arp-sync" label="Arpeggiator master clock sync" pressed={focused.arpSync} valueText="SYNC" onClick={() => setLayer(focusedId, { arpSync: !focused.arpSync })} />
          <FunctionalButton id="synth-arp-direction" label="Arpeggiator direction" pressed={focused.arpRun} valueText={focused.arpDirection} onClick={() => setLayer(focusedId, { arpDirection: cycle(ARP_DIRECTIONS, focused.arpDirection) })} />
          <FunctionalButton id="synth-arp-hold" label="Arpeggiator keyboard hold" pressed={focused.arpHold} valueText="HOLD" onClick={() => setLayer(focusedId, { arpHold: !focused.arpHold })} />
          <FunctionalButton id="synth-section-on" label="Synth section on" pressed={instrument.synth.sectionOn} valueText="ON" onClick={() => setInstrument((current) => ({ ...current, synth: { ...current.synth, sectionOn: !current.synth.sectionOn } }))} />
          <FunctionalButton id="synth-sustped" label="Synth sustain pedal routing" pressed={focused.sustped} valueText="SUSTPED" onClick={() => setLayer(focusedId, { sustped: !focused.sustped })} />
          <FunctionalButton id="synth-pstick" label="Synth pitch stick routing" pressed={focused.pstick} valueText="PSTICK" onClick={() => setLayer(focusedId, { pstick: !focused.pstick })} />
          <FunctionalButton id="synth-octave-down" label="Synth octave down" pressed={focused.octave === -12} valueText="OCT −" onClick={() => setLayer(focusedId, { octave: focused.octave === -12 ? 0 : -12 })} />
          <FunctionalButton id="synth-octave-up" label="Synth octave up" pressed={focused.octave === 12} valueText="OCT +" onClick={() => setLayer(focusedId, { octave: focused.octave === 12 ? 0 : 12 })} />
        </div>
      </div>
    </Section>
  )
}

const allEffectTargets: EffectTarget[] = ['organ', 'piano:A', 'piano:B', 'synth:A', 'synth:B', 'synth:C']

function EffectsSection({ instrument, setInstrument }: { instrument: InstrumentState; setInstrument: SetInstrument }) {
  const target = effectTargetForFocus(instrument)
  const chain = getEffectChain(instrument, target)
  const lastTap = useRef<number | null>(null)
  const setUnit = (unitId: EffectUnitId, patch: Partial<(typeof chain)[EffectUnitId]>) => setInstrument((current) => {
    const currentTarget = effectTargetForFocus(current)
    const currentUnit = getEffectChain(current, currentTarget)[unitId]
    const makeGlobal = patch.global === true || currentUnit.global
    const targets = makeGlobal ? allEffectTargets
      : current.effectsFocus.section === 'piano' && current.group ? ['piano:A', 'piano:B'] as EffectTarget[]
        : current.effectsFocus.section === 'synth' && current.synth.group ? ['synth:A', 'synth:B', 'synth:C'] as EffectTarget[] : [currentTarget]
    return targets.reduce((next, item) => updateEffectTarget(next, item, unitId, (unit) => ({ ...unit, ...patch, global: makeGlobal ? patch.global ?? unit.global : unit.global })), current)
  })
  const parameter = (id: string, label: string, unitId: EffectUnitId, key: 'rate' | 'amount' | 'mix' | 'feedback' | 'bright') => {
    const destination = `${target}:${unitId}:${key}` as MorphDestination
    return <FunctionalRange id={id} label={label} value={chain[unitId][key] * 100} morphAssigned={hasMorph(instrument, destination)} onChange={(value) => setInstrument((state) => setMorphable(state, destination, getEffectChain(state, effectTargetForFocus(state))[unitId][key], value / 100, (next, amount) => {
      const currentTarget = effectTargetForFocus(next); return updateEffectTarget(next, currentTarget, unitId, (unit) => ({ ...unit, [key]: amount }))
    }))} />
  }
  const focusSection = (section: 'organ' | 'piano' | 'synth') => setInstrument((state) => ({ ...state, effectsFocus: { section, layer: section === 'organ' ? state.organ.focus : section === 'piano' ? state.focus : state.synth.focus } }))
  const focusLayer = (layer: SynthLayerId) => setInstrument((state) => state.effectsFocus.section === 'piano'
    ? { ...state, focus: layer === 'C' ? 'A' : layer, effectsFocus: { ...state.effectsFocus, layer: layer === 'C' ? 'A' : layer } }
    : state.effectsFocus.section === 'synth' ? { ...state, synth: { ...state.synth, focus: layer }, effectsFocus: { ...state.effectsFocus, layer } }
      : { ...state, organ: { ...state.organ, focus: layer === 'C' ? 'A' : layer }, effectsFocus: { ...state.effectsFocus, layer: layer === 'C' ? 'A' : layer } })
  const tapTempo = () => { const now = performance.now(); if (lastTap.current !== null) setUnit('delay', { rate: Math.max(.05, Math.min(1, (now - lastTap.current) / 720)) }); lastTap.current = now }
  const labelLayer = instrument.effectsFocus.section === 'synth' ? instrument.synth.focus : instrument.effectsFocus.section === 'piano' ? instrument.focus : 'A'
  return (
    <Section id="effects" title="Layer Effects">
      <div className="effects-focus"><span>FOCUS</span>
        <FunctionalButton id="effects-focus-organ" label="Effects focus Organ" pressed={instrument.effectsFocus.section === 'organ'} valueText="ORGAN" onClick={() => focusSection('organ')} />
        <FunctionalButton id="effects-focus-piano" label="Effects focus Piano" pressed={instrument.effectsFocus.section === 'piano'} valueText="PIANO" onClick={() => focusSection('piano')} />
        <FunctionalButton id="effects-focus-synth" label="Effects focus Synth" pressed={instrument.effectsFocus.section === 'synth'} valueText="SYNTH" onClick={() => focusSection('synth')} />
        <FunctionalButton id="effects-focus-a" label={`Effects focus ${instrument.effectsFocus.section === 'synth' ? 'Synth' : 'Piano'} A`} pressed={labelLayer === 'A'} valueText="A" onClick={() => focusLayer('A')} />
        <FunctionalButton id="effects-focus-b" label={`Effects focus ${instrument.effectsFocus.section === 'synth' ? 'Synth' : 'Piano'} B`} pressed={labelLayer === 'B'} valueText="B" onClick={() => focusLayer('B')} />
        <FunctionalButton id="effects-piano-group" label="Piano effects group mode" pressed={instrument.group} valueText="P GROUP" onClick={() => setInstrument((state) => ({ ...state, group: !state.group }))} />
        <FunctionalButton id="effects-focus-c" label="Effects focus Synth C" pressed={instrument.effectsFocus.section === 'synth' && labelLayer === 'C'} valueText="C" onClick={() => { focusSection('synth'); focusLayer('C') }} />
        <FunctionalButton id="effects-synth-group" label="Synth effects group mode" pressed={instrument.synth.group} valueText="S GROUP" onClick={() => setInstrument((state) => ({ ...state, synth: { ...state.synth, group: !state.synth.group } }))} />
      </div>
      <div className="effects-matrix">
        <div><b>MOD 1</b>
          <FunctionalButton id="effects-mod1-on" label="Modulation effect one on" pressed={chain.mod1.on} valueText="ON" onClick={() => setUnit('mod1', { on: !chain.mod1.on })} />
          <FunctionalButton id="effects-mod1-sync" label="Modulation effect one master clock sync" pressed={chain.mod1.fast} valueText="SYNC" onClick={() => setUnit('mod1', { fast: !chain.mod1.fast })} />
          <FunctionalButton id="effects-mod1-type" label="Modulation effect one type" pressed={chain.mod1.on} valueText={chain.mod1.type} onClick={() => setUnit('mod1', { type: cycle(MOD1_TYPES, chain.mod1.type as never) })} />
          {parameter('effects-mod1-rate', 'Modulation effect one rate', 'mod1', 'rate')}{parameter('effects-mod1-amount', 'Modulation effect one amount', 'mod1', 'amount')}
        </div>
        <div><b>MOD 2</b>
          <FunctionalButton id="effects-mod2-on" label="Modulation effect two on" pressed={chain.mod2.on} valueText="ON" onClick={() => setUnit('mod2', { on: !chain.mod2.on })} />
          <FunctionalButton id="effects-mod2-type" label="Modulation effect two type" pressed={chain.mod2.on} valueText={chain.mod2.type} onClick={() => setUnit('mod2', { type: cycle(MOD2_TYPES, chain.mod2.type as never) })} />
          {parameter('effects-mod2-rate', 'Modulation effect two rate', 'mod2', 'rate')}{parameter('effects-mod2-amount', 'Modulation effect two amount', 'mod2', 'amount')}
        </div>
        <div><b>AMP · EQ</b>
          <FunctionalButton id="effects-amp-on" label="Amp simulator and EQ on" pressed={chain.ampEq.on} valueText="ON" onClick={() => setUnit('ampEq', { on: !chain.ampEq.on })} />
          <FunctionalButton id="effects-amp-model" label="Amp simulator model" pressed={chain.ampEq.on} valueText={chain.ampEq.type} onClick={() => setUnit('ampEq', { type: cycle(AMP_TYPES, chain.ampEq.type as never) })} />
          {parameter('effects-amp-drive', 'Amp simulator drive', 'ampEq', 'amount')}{parameter('effects-eq-bass', 'Equalizer bass', 'ampEq', 'rate')}{parameter('effects-eq-mid', 'Equalizer mid', 'ampEq', 'bright')}{parameter('effects-eq-mid-freq', 'Equalizer mid frequency', 'ampEq', 'feedback')}{parameter('effects-eq-treble', 'Equalizer treble', 'ampEq', 'mix')}
        </div>
        <div><b>DELAY</b>
          <FunctionalButton id="effects-delay-on" label="Delay on" pressed={chain.delay.on} valueText="ON" onClick={() => setUnit('delay', { on: !chain.delay.on })} />
          <FunctionalButton id="effects-delay-global" label="Delay global mode" pressed={chain.delay.global} valueText="GLOBAL" onClick={() => setUnit('delay', { global: !chain.delay.global })} />
          <FunctionalButton id="effects-delay-sync" label="Delay master clock sync" pressed={chain.delay.fast} valueText="SYNC" onClick={() => setUnit('delay', { fast: !chain.delay.fast })} />
          <FunctionalButton id="effects-delay-tap" label="Delay tap tempo" pressed={false} valueText="TAP" onClick={tapTempo} />
          {parameter('effects-delay-tempo', 'Delay tempo', 'delay', 'rate')}{parameter('effects-delay-feedback', 'Delay feedback', 'delay', 'feedback')}{parameter('effects-delay-mix', 'Delay mix', 'delay', 'mix')}
          <FunctionalButton id="effects-delay-filter" label="Delay feedback filter" pressed={chain.delay.filter !== 'Off'} valueText={chain.delay.filter} onClick={() => setUnit('delay', { filter: cycle(FEEDBACK_FILTERS, chain.delay.filter) })} />
        </div>
        <div><b>COMP</b>
          <FunctionalButton id="effects-compressor-on" label="Compressor on" pressed={chain.compressor.on} valueText="ON" onClick={() => setUnit('compressor', { on: !chain.compressor.on })} />
          <FunctionalButton id="effects-compressor-global" label="Compressor global mode" pressed={chain.compressor.global} valueText="GLOBAL" onClick={() => setUnit('compressor', { global: !chain.compressor.global })} />
          <FunctionalButton id="effects-compressor-fast" label="Compressor fast mode" pressed={chain.compressor.fast} valueText="FAST" onClick={() => setUnit('compressor', { fast: !chain.compressor.fast })} />
          {parameter('effects-compressor-amount', 'Compressor amount', 'compressor', 'amount')}
        </div>
        <div><b>REVERB</b>
          <FunctionalButton id="effects-reverb-on" label="Reverb on" pressed={chain.reverb.on} valueText="ON" onClick={() => setUnit('reverb', { on: !chain.reverb.on })} />
          <FunctionalButton id="effects-reverb-global" label="Reverb global mode" pressed={chain.reverb.global} valueText="GLOBAL" onClick={() => setUnit('reverb', { global: !chain.reverb.global })} />
          <FunctionalButton id="effects-reverb-type" label="Reverb type" pressed={chain.reverb.on} valueText={chain.reverb.type} onClick={() => setUnit('reverb', { type: cycle(REVERB_TYPES, chain.reverb.type as never) })} />
          {parameter('effects-reverb-bright', 'Reverb brightness', 'reverb', 'bright')}{parameter('effects-reverb-mix', 'Reverb mix', 'reverb', 'mix')}
        </div>
      </div>
      <div className="effects-footer">
        <FunctionalButton id="effects-rotary-on" label="Shared rotary on" pressed={instrument.rotaryOn} valueText="ROTARY" onClick={() => setInstrument((state) => ({ ...state, rotaryOn: !state.rotaryOn }))} />
        <FunctionalButton id="effects-rotary-speed" label="Shared rotary speed" pressed={instrument.rotaryFast} valueText={instrument.rotaryStopped ? 'STOP' : instrument.rotaryFast ? 'FAST' : 'SLOW'} onClick={() => setInstrument((state) => state.morphs.editing
          ? assignMorph(state, state.morphs.editing, 'rotary:speed', state.rotaryFast ? 1 : 0, state.rotaryFast ? 0 : 1)
          : ({ ...state, rotaryFast: !state.rotaryFast, rotaryStopped: false }))} />
        <FunctionalRange id="effects-rotary-drive" label="Shared rotary drive" value={instrument.rotaryDrive * 100} onChange={(value) => setInstrument((state) => ({ ...state, rotaryDrive: value / 100 }))} />
        <FunctionalButton id="effects-all-bypass" label="All effects bypass" pressed={chain.allBypass} valueText="BYPASS" onClick={() => setInstrument((state) => {
          const focused = effectTargetForFocus(state); const current = getEffectChain(state, focused)
          if (focused === 'organ') return { ...state, organ: { ...state.organ, effects: { ...state.organ.effects, allBypass: !current.allBypass } } }
          const [section, layer] = focused.split(':') as ['piano' | 'synth', SynthLayerId]
          if (section === 'piano') return { ...state, effects: { ...state.effects, [layer]: { ...state.effects[layer as LayerId], allBypass: !current.allBypass } } }
          return { ...state, synth: { ...state.synth, effects: { ...state.synth.effects, [layer]: { ...state.synth.effects[layer], allBypass: !current.allBypass } } } }
        })} />
      </div>
    </Section>
  )
}

function Keybed({ controller, activeNotes, instrument }: { controller: PianoInputController; activeNotes: number[]; instrument: InstrumentState }) {
  const active = new Set(activeNotes)
  const accessibilityDown = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => { if ((event.code === 'Enter' || event.code === 'Space') && !event.repeat) { event.preventDefault(); controller.pointerDown(10_000 + midi, midi, .76) } }
  const accessibilityUp = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => { if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); controller.pointerUp(10_000 + midi) } }
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, midi: number) => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); controller.pointerDown(event.pointerId, midi, Math.max(.2, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))) }
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => controller.pointerUp(event.pointerId)
  const keys = (black: boolean) => KEYS.filter((key) => key.black === black).map((key) => <button type="button" key={key.id} id={key.id}
    className={`piano-key ${black ? 'black-key' : 'white-key'} ${active.has(key.midi) ? 'is-active' : ''}`}
    style={black ? { left: `${((key.blackOffset ?? 0) / 43) * 100}%` } : undefined} aria-label={`${key.note}${key.octave} piano key`} aria-pressed={active.has(key.midi)} data-midi={key.midi}
    onPointerDown={(event) => pointerDown(event, key.midi)} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
    onKeyDown={(event) => accessibilityDown(event, key.midi)} onKeyUp={(event) => accessibilityUp(event, key.midi)} onBlur={() => controller.pointerUp(10_000 + key.midi)} />)
  return <div className="keybed" data-key-count={KEYS.length} data-range="E1–E7" aria-label="73 key hammer-action keybed">
    <div className="split-led-strip" aria-label="Active split point LEDs">{instrument.splits.enabled ? instrument.splits.points.filter((point) => point.enabled).map((point) => <span key={point.position} data-split-led={point.position} title={`${point.position} split · ${point.crossfade || 'Off'} crossfade`} style={{ left: `${(splitPositionMidi(point.position) - 28) / 72 * 100}%` }} />) : null}</div>
    <div className="white-keys">{keys(false)}</div><div className="black-keys" aria-hidden="false">{keys(true)}</div></div>
}

function connectedMidiLabel(inputs: MidiInputLike[]): string {
  if (inputs.length === 0) return 'MIDI disconnected'
  return `MIDI connected · ${inputs.map((input) => input.name || input.id).join(', ')}`
}

export default function App({ engine: suppliedEngine, requestMidiAccess }: AppProps) {
  const initialInstrument = useMemo(createInitialInstrumentState, [])
  const [instrument, setInstrumentState] = useState<InstrumentState>(initialInstrument)
  const [memory, setMemory] = useState(() => loadProgramMemory(initialInstrument, typeof localStorage === 'undefined' ? undefined : localStorage))
  const engine = useMemo(() => suppliedEngine ?? new StagePianoEngine(initialInstrument), [suppliedEngine, initialInstrument])
  const [notes, setNotes] = useState<NoteSnapshot>(EMPTY_NOTES)
  const [pianoStatus, setPianoStatus] = useState<PianoStatus>(() => engine.getStatus())
  const [midiStatus, setMidiStatus] = useState('MIDI not connected')
  const [hardware, dispatchHardware] = useReducer(hardwareReducer, INITIAL_HARDWARE_STATE)
  const controller = useMemo(() => new PianoInputController(
    engine,
    (inputs) => setMidiStatus(connectedMidiLabel(inputs)),
    (value) => setInstrumentState((state) => ({ ...state, morphs: { ...state.morphs, values: { ...state.morphs.values, controlPedal: value } } })),
  ), [engine])
  const setInstrument: SetInstrument = (update) => setInstrumentState((current) => update(current))

  useEffect(() => engine.subscribe(setNotes), [engine])
  useEffect(() => engine.subscribeStatus(setPianoStatus), [engine])
  useEffect(() => { if (engine instanceof StagePianoEngine) engine.updateState(instrument) }, [engine, instrument])
  const liveMode = memory.liveMode
  const selectedLive = memory.selectedLive
  useEffect(() => { if (liveMode) setMemory((current) => autoStoreLive(current, instrument)) }, [instrument, liveMode, selectedLive])
  useEffect(() => saveProgramMemory(memory, typeof localStorage === 'undefined' ? undefined : localStorage), [memory])
  useEffect(() => {
    const keyDown = (event: globalThis.KeyboardEvent) => { const target = event.target; if (target instanceof Element && target.matches('button, input, select, textarea')) return; if (controller.keyDown(event.code, event.repeat)) event.preventDefault() }
    const keyUp = (event: globalThis.KeyboardEvent) => { const target = event.target; if (target instanceof Element && target.matches('button, input, select, textarea')) return; if (controller.keyUp(event.code)) event.preventDefault() }
    const cleanup = () => controller.allNotesOff()
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', cleanup); document.addEventListener('visibilitychange', cleanup)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', cleanup); document.removeEventListener('visibilitychange', cleanup); controller.dispose() }
  }, [controller])

  const connectMidi = async () => {
    const request = requestMidiAccess ?? (navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }).requestMIDIAccess?.bind(navigator)
    if (!request) { setMidiStatus('Web MIDI unsupported in this browser'); controller.allNotesOff(); return }
    setMidiStatus('Requesting MIDI access…')
    try { controller.attachMidiAccess(await request()) } catch { controller.allNotesOff(); setMidiStatus('MIDI access denied') }
  }
  const dirty = isProgramDirty(instrument, memory)
  return (
    <main className="app-shell">
      <header className="utility-bar">
        <div><span className={`status-dot ${pianoStatus.state}`} /> <strong>{pianoStatus.label}</strong></div>
        <div><span>{notes.activeVoiceCount} voices</span><span>{notes.sustain ? 'Sustain on' : 'Sustain off'}</span><span>{memory.liveMode ? `Live ${memory.selectedLive + 1}` : `${memory.page + 1}.${memory.selectedProgram % 8 + 1}`} {dirty ? 'E' : ''}</span></div>
        <button type="button" onClick={connectMidi}>{midiStatus}</button>
        <button type="button" aria-pressed={notes.sustain} onClick={() => engine.setSustain(!notes.sustain)}>Sustain pedal {notes.sustain ? 'on' : 'off'}</button>
        <p>A–' and Z–, play · Space sustains · all engines and programs are live</p>
      </header>
      <div className="instrument-stage">
        <article className="instrument" aria-label="Nord Stage 4 73 browser instrument" data-variant="stage-4-73">
          <div className="top-rail"><span>NORD STAGE 4</span><span>73 · HAMMER ACTION</span></div>
          <div className="control-deck" data-deck-ratio="0.54">
            <PerformanceSection state={hardware} onChange={(id, value) => dispatchHardware({ id, value })} instrument={instrument} setInstrument={setInstrument} />
            <OrganSection instrument={instrument} setInstrument={setInstrument} />
            <PianoSection instrument={instrument} setInstrument={setInstrument} />
            <ProgramSection instrument={instrument} setInstrument={setInstrument} memory={memory} setMemory={setMemory} dirty={dirty} controller={controller} />
            <SynthSection state={hardware} onChange={(id, value) => dispatchHardware({ id, value })} instrument={instrument} setInstrument={setInstrument} />
            <EffectsSection instrument={instrument} setInstrument={setInstrument} />
          </div>
          <div className="keybed-deck" data-keybed-ratio="0.46"><div className="keybed-cheek left-cheek"><span>NS4</span></div><Keybed controller={controller} activeNotes={notes.activeNotes} instrument={instrument} /><div className="keybed-cheek right-cheek"><span>73</span></div></div>
          <div className="front-lip"><span>STAGE 4</span></div>
        </article>
      </div>
      <footer className="phase-note"><span>PHASE 3 · COMPLETE SYSTEM · 32 PROGRAMS + 8 LIVE · ORGAN · PIANO · SYNTH · SPLITS · SCENES · MORPHS</span><details><summary>Unsupported controls</summary>Aftertouch morph; Monitor Level; Panel Lock; Synth Shape; preset libraries; Extern/Aux KB/MIDI menus; pattern editing; aftertouch; spec-excluded shift menus.</details></footer>
    </main>
  )
}
