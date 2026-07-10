import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import {
  EFFECTS_CONTROLS, INITIAL_HARDWARE_STATE, KEYS, ORGAN_CONTROLS, ORGAN_DRAWBARS,
  PERFORMANCE_CONTROLS, PROGRAM_CONTROLS, SECTION_WIDTHS,
  SYNTH_CONTROLS, type HardwareControl, type HardwareState, type SectionId,
} from './hardware'
import { PianoInputController, type MidiAccessLike, type MidiInputLike } from './inputs'
import { type NoteSnapshot, type PianoStatus, type PlayablePianoEngine } from './piano'
import { StagePianoEngine } from './stage-engine'
import {
  AMP_TYPES, FEEDBACK_FILTERS, KB_TOUCHES, MOD1_TYPES, MOD2_TYPES, PIANO_TYPES, REVERB_TYPES,
  TIMBRES, createInitialInstrumentState, cycle, updateEffectUnit,
  type EffectUnitId, type InstrumentState, type LayerId,
} from './instrument'

interface AppProps {
  engine?: PlayablePianoEngine
  requestMidiAccess?: () => Promise<MidiAccessLike>
}

function FunctionalButton({ id, label, pressed, onClick, valueText, compact = true }: {
  id: string
  label: string
  pressed: boolean
  onClick: () => void
  valueText?: string
  compact?: boolean
}) {
  return (
    <button
      type="button" id={id} className={`panel-button ${pressed ? 'is-on' : ''} ${compact ? 'compact' : ''}`}
      aria-label={valueText ? `${label}: ${valueText}` : label} aria-pressed={pressed}
      data-control-id={id} data-functional="true" onClick={onClick}
    >
      <span className="button-led" aria-hidden="true" />
      <span>{valueText ?? label.replace(/^(Piano|Effects|Shared) /, '')}</span>
    </button>
  )
}

function FunctionalRange({ id, label, value, onChange, compact = true }: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  compact?: boolean
}) {
  const rotation = -138 + value * 2.76
  return (
    <label className={`continuous-control knob ${compact ? 'compact' : ''}`} htmlFor={id}>
      <span>{label.replace(/^(Piano|Effects|Shared) /, '')}</span>
      <span className="control-shell" style={{ '--control-turn': `${rotation}deg` } as CSSProperties}>
        <input id={id} type="range" min="0" max="100" value={Math.round(value)} aria-label={label}
          data-control-id={id} data-functional="true" onChange={(event) => onChange(Number(event.currentTarget.value))} />
        <span className="knob-face" aria-hidden="true" />
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
    return (
      <button
        type="button"
        id={control.id}
        className={`panel-button ${pressed ? 'is-on' : ''} ${compact ? 'compact' : ''}`}
        aria-label={`${control.label} (decorative)`}
        aria-pressed={pressed}
        data-control-id={control.id}
        data-functional="false"
        onClick={() => onChange(control.id, pressed ? 0 : 1)}
      >
        <span className="button-led" aria-hidden="true" />
        <span>{control.label.replace(/^(Organ|Piano|Synth|Effects) /, '')}</span>
      </button>
    )
  }

  const rotation = -138 + (value / control.max) * 276
  return (
    <label className={`continuous-control ${control.kind} ${compact ? 'compact' : ''}`} htmlFor={control.id}>
      <span>{control.label.replace(/^(Organ|Piano|Synth|Effects) /, '')}</span>
      <span className="control-shell" style={{
        '--control-turn': `${rotation}deg`,
        '--control-position': `${82 - value * 0.72}%`,
        '--wheel-position': `${(50 - value) * 0.055}em`,
      } as CSSProperties}>
        <input
          id={control.id}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          aria-label={`${control.label} (decorative)`}
          data-control-id={control.id}
          data-functional="false"
          onChange={(event) => onChange(control.id, Number(event.currentTarget.value))}
        />
        {(control.kind === 'knob' || control.kind === 'encoder') && <span className="knob-face" aria-hidden="true" />}
        {control.kind === 'wheel' && <span className="wheel-face" aria-hidden="true" />}
      </span>
    </label>
  )
}

function Controls({ items, state, onChange, compact }: {
  items: HardwareControl[]
  state: HardwareState
  onChange: (id: string, value: number) => void
  compact?: boolean
}) {
  return <>{items.map((item) => <DecorativeControl key={item.id} control={item} value={state[item.id]} onChange={onChange} compact={compact} />)}</>
}

function Section({ id, title, children }: { id: SectionId; title: string; children: React.ReactNode }) {
  return (
    <section
      className={`instrument-section section-${id}`}
      data-section={id}
      aria-label={`${title} section`}
      style={{ '--section-width': `${SECTION_WIDTHS[id]}%` } as CSSProperties}
    >
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function PerformanceSection({ state, onChange, instrument, setInstrument }: {
  state: HardwareState
  onChange: (id: string, value: number) => void
  instrument: InstrumentState
  setInstrument: (update: (state: InstrumentState) => InstrumentState) => void
}) {
  return (
    <Section id="performance" title="Performance">
      <div className="brand-lockup" aria-label="Nord Stage 4 73"><strong>nord</strong><span>STAGE 4</span><small>73</small></div>
      <div className="performance-knobs">
        <FunctionalRange id="performance-master-level" label="Master level" value={instrument.masterLevel * 100} compact={false}
          onChange={(value) => setInstrument((current) => ({ ...current, masterLevel: value / 100 }))} />
        <Controls items={[PERFORMANCE_CONTROLS[3], PERFORMANCE_CONTROLS[4]]} state={state} onChange={onChange} />
      </div>
      <div className="performance-wheels">
        <FunctionalRange id="performance-pitch-stick" label="Pitch stick" value={(instrument.pitchBend + 1) * 50} compact={false}
          onChange={(value) => setInstrument((current) => ({ ...current, pitchBend: (value - 50) / 50 }))} />
        <Controls items={[PERFORMANCE_CONTROLS[2]]} state={state} onChange={onChange} />
      </div>
    </Section>
  )
}

function OrganSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="organ" title="Organ">
      <div className="section-top-row"><Controls items={ORGAN_CONTROLS.slice(0, 8)} state={state} onChange={onChange} compact /></div>
      <div className="drawbar-bank" aria-label="Nine organ drawbars">
        <Controls items={ORGAN_DRAWBARS} state={state} onChange={onChange} compact />
      </div>
      <div className="section-bottom-row organ-bottom"><Controls items={ORGAN_CONTROLS.slice(8)} state={state} onChange={onChange} compact /></div>
    </Section>
  )
}

function PianoSection({ instrument, setInstrument }: {
  instrument: InstrumentState
  setInstrument: (update: (state: InstrumentState) => InstrumentState) => void
}) {
  const focused = instrument.layers[instrument.focus]
  const setLayer = (layerId: LayerId, update: Partial<InstrumentState['layers']['A']>) => setInstrument((state) => ({
    ...state, layers: { ...state.layers, [layerId]: { ...state.layers[layerId], ...update } },
  }))
  const layerButton = (layerId: LayerId) => {
    const layer = instrument.layers[layerId]
    if (!layer.enabled) setInstrument((state) => ({ ...state, focus: layerId, layers: { ...state.layers, [layerId]: { ...layer, enabled: true } } }))
    else if (instrument.focus !== layerId) setInstrument((state) => ({ ...state, focus: layerId }))
    else setLayer(layerId, { enabled: false })
  }
  return (
    <Section id="piano" title="Piano">
      <div className="piano-levels">
        {(['A', 'B'] as LayerId[]).map((layerId) => <FunctionalButton key={layerId} id={`piano-layer-${layerId.toLowerCase()}`} label={`Piano layer ${layerId}`} pressed={instrument.layers[layerId].enabled && instrument.focus === layerId} valueText={`${layerId}${instrument.layers[layerId].enabled ? '' : ' OFF'}`} onClick={() => layerButton(layerId)} />)}
        {(['A', 'B'] as LayerId[]).map((layerId) => <FunctionalRange key={layerId} id={`piano-level-${layerId.toLowerCase()}`} label={`Piano layer ${layerId} level`} value={instrument.layers[layerId].level * 100} onChange={(value) => setLayer(layerId, { level: value / 100 })} />)}
      </div>
      <div className="type-stack" aria-label="Piano type selectors">
        {PIANO_TYPES.map((type) => <FunctionalButton key={type} id={`piano-type-${type === 'Misc' ? 'misc' : type.toLowerCase()}`} label={`${type} piano type`} pressed={focused.type === type} valueText={type} onClick={() => setLayer(instrument.focus, { type, model: `${type} 1` })} />)}
      </div>
      <div className="piano-detail">
        <FunctionalRange id="piano-model" label="Piano model selector" value={PIANO_TYPES.indexOf(focused.type) * 20} onChange={(value) => setLayer(instrument.focus, { type: PIANO_TYPES[Math.min(5, Math.round(value / 20))], model: `${PIANO_TYPES[Math.min(5, Math.round(value / 20))]} 1` })} />
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

function ProgramSection({ state, onChange, instrument }: { state: HardwareState; onChange: (id: string, value: number) => void; instrument: InstrumentState }) {
  return (
    <Section id="program" title="Program · Morph">
      <div className="primary-oled program-oled" data-primary-oled="program" aria-label="Program OLED, decorative">
        <span>PIANO {instrument.focus}</span><strong>{instrument.layers[instrument.focus].model}</strong><small>PROGRAM ENGINE OFF · LIVE SOUND</small>
      </div>
      <div className="program-dial"><Controls items={PROGRAM_CONTROLS.slice(0, 1)} state={state} onChange={onChange} /></div>
      <div className="program-bank"><Controls items={PROGRAM_CONTROLS.slice(1, 9)} state={state} onChange={onChange} compact /></div>
      <div className="program-actions"><Controls items={PROGRAM_CONTROLS.slice(9)} state={state} onChange={onChange} compact /></div>
    </Section>
  )
}

function SynthSection({ state, onChange }: { state: HardwareState; onChange: (id: string, value: number) => void }) {
  return (
    <Section id="synth" title="Synth">
      <div className="synth-head">
        <div className="primary-oled synth-oled" data-primary-oled="synth" aria-label="Synth OLED, decorative"><span>SYNTH</span><strong>ENGINE OFF</strong><small>DECORATIVE PANEL</small></div>
        <div className="synth-layers"><Controls items={SYNTH_CONTROLS.slice(0, 6)} state={state} onChange={onChange} compact /></div>
      </div>
      <div className="synth-groups">
        <div><b>OSC</b><Controls items={SYNTH_CONTROLS.slice(6, 12)} state={state} onChange={onChange} compact /></div>
        <div><b>FILTER · LFO</b><Controls items={SYNTH_CONTROLS.slice(12, 20)} state={state} onChange={onChange} compact /></div>
        <div><b>ENVELOPES</b><Controls items={SYNTH_CONTROLS.slice(20, 27)} state={state} onChange={onChange} compact /></div>
        <div><b>ARP · VOICE</b><Controls items={SYNTH_CONTROLS.slice(27)} state={state} onChange={onChange} compact /></div>
      </div>
    </Section>
  )
}

function EffectsSection({ state, onChange, instrument, setInstrument }: {
  state: HardwareState
  onChange: (id: string, value: number) => void
  instrument: InstrumentState
  setInstrument: (update: (state: InstrumentState) => InstrumentState) => void
}) {
  const chain = instrument.effects[instrument.focus]
  const lastTap = useRef<number | null>(null)
  const setUnit = (unitId: EffectUnitId, patch: Partial<(typeof chain)[EffectUnitId]>) => setInstrument((current) => updateEffectUnit(current, unitId, (unit) => ({ ...unit, ...patch })))
  const effectControls = (ids: string[]) => <Controls items={ids.map((id) => EFFECTS_CONTROLS.find((control) => control.id === id)!).filter(Boolean)} state={state} onChange={onChange} compact />
  const tapTempo = () => {
    const now = performance.now()
    if (lastTap.current !== null) {
      const seconds = Math.max(.08, Math.min(.765, (now - lastTap.current) / 1000))
      setUnit('delay', { rate: (seconds - .045) / .72 })
    }
    lastTap.current = now
  }
  return (
    <Section id="effects" title="Layer Effects">
      <div className="effects-focus"><span>FOCUS</span>
        {effectControls(['effects-focus-organ'])}
        <FunctionalButton id="effects-focus-piano" label="Effects focus Piano" pressed valueText="PIANO" onClick={() => undefined} />
        {effectControls(['effects-focus-synth'])}
        <FunctionalButton id="effects-focus-a" label="Effects focus Piano A" pressed={instrument.focus === 'A'} valueText="A" onClick={() => setInstrument((current) => ({ ...current, focus: 'A' }))} />
        <FunctionalButton id="effects-focus-b" label="Effects focus Piano B" pressed={instrument.focus === 'B'} valueText="B" onClick={() => setInstrument((current) => ({ ...current, focus: 'B' }))} />
        <FunctionalButton id="effects-piano-group" label="Piano effects group mode" pressed={instrument.group} valueText="GROUP" onClick={() => setInstrument((current) => ({ ...current, group: !current.group }))} />
      </div>
      <div className="effects-matrix">
        <div><b>MOD 1</b>
          <FunctionalButton id="effects-mod1-on" label="Modulation effect one on" pressed={chain.mod1.on} valueText="ON" onClick={() => setUnit('mod1', { on: !chain.mod1.on })} />
          <FunctionalButton id="effects-mod1-sync" label="Modulation effect one master clock sync" pressed={chain.mod1.fast} valueText="SYNC" onClick={() => setUnit('mod1', { fast: !chain.mod1.fast })} />
          <FunctionalButton id="effects-mod1-type" label="Modulation effect one type" pressed={chain.mod1.on} valueText={chain.mod1.type} onClick={() => setUnit('mod1', { type: cycle(MOD1_TYPES, chain.mod1.type as never) })} />
          <FunctionalRange id="effects-mod1-rate" label="Modulation effect one rate" value={chain.mod1.rate * 100} onChange={(value) => setUnit('mod1', { rate: value / 100 })} />
          <FunctionalRange id="effects-mod1-amount" label="Modulation effect one amount" value={chain.mod1.amount * 100} onChange={(value) => setUnit('mod1', { amount: value / 100 })} />
        </div>
        <div><b>MOD 2</b>
          <FunctionalButton id="effects-mod2-on" label="Modulation effect two on" pressed={chain.mod2.on} valueText="ON" onClick={() => setUnit('mod2', { on: !chain.mod2.on })} />
          <FunctionalButton id="effects-mod2-type" label="Modulation effect two type" pressed={chain.mod2.on} valueText={chain.mod2.type} onClick={() => setUnit('mod2', { type: cycle(MOD2_TYPES, chain.mod2.type as never) })} />
          <FunctionalRange id="effects-mod2-rate" label="Modulation effect two rate" value={chain.mod2.rate * 100} onChange={(value) => setUnit('mod2', { rate: value / 100 })} />
          <FunctionalRange id="effects-mod2-amount" label="Modulation effect two amount" value={chain.mod2.amount * 100} onChange={(value) => setUnit('mod2', { amount: value / 100 })} />
        </div>
        <div><b>AMP · EQ</b>
          <FunctionalButton id="effects-amp-on" label="Amp simulator and EQ on" pressed={chain.ampEq.on} valueText="ON" onClick={() => setUnit('ampEq', { on: !chain.ampEq.on })} />
          <FunctionalButton id="effects-amp-model" label="Amp simulator model" pressed={chain.ampEq.on} valueText={chain.ampEq.type} onClick={() => setUnit('ampEq', { type: cycle(AMP_TYPES, chain.ampEq.type as never) })} />
          <FunctionalRange id="effects-amp-drive" label="Amp simulator drive" value={chain.ampEq.amount * 100} onChange={(value) => setUnit('ampEq', { amount: value / 100 })} />
          <FunctionalRange id="effects-eq-bass" label="Equalizer bass" value={chain.ampEq.rate * 100} onChange={(value) => setUnit('ampEq', { rate: value / 100 })} />
          <FunctionalRange id="effects-eq-mid" label="Equalizer mid" value={chain.ampEq.bright * 100} onChange={(value) => setUnit('ampEq', { bright: value / 100 })} />
          <FunctionalRange id="effects-eq-mid-freq" label="Equalizer mid frequency" value={chain.ampEq.feedback * 100} onChange={(value) => setUnit('ampEq', { feedback: value / 100 })} />
          <FunctionalRange id="effects-eq-treble" label="Equalizer treble" value={chain.ampEq.mix * 100} onChange={(value) => setUnit('ampEq', { mix: value / 100 })} />
        </div>
        <div><b>DELAY</b>
          <FunctionalButton id="effects-delay-on" label="Delay on" pressed={chain.delay.on} valueText="ON" onClick={() => setUnit('delay', { on: !chain.delay.on })} />
          <FunctionalButton id="effects-delay-global" label="Delay global mode" pressed={chain.delay.global} valueText="GLOBAL" onClick={() => setUnit('delay', { global: !chain.delay.global })} />
          <FunctionalButton id="effects-delay-sync" label="Delay master clock sync" pressed={chain.delay.fast} valueText="SYNC" onClick={() => setUnit('delay', { fast: !chain.delay.fast })} />
          <FunctionalButton id="effects-delay-tap" label="Delay tap tempo" pressed={false} valueText="TAP" onClick={tapTempo} />
          <FunctionalRange id="effects-delay-tempo" label="Delay tempo" value={chain.delay.rate * 100} onChange={(value) => setUnit('delay', { rate: value / 100 })} />
          <FunctionalRange id="effects-delay-feedback" label="Delay feedback" value={chain.delay.feedback * 100} onChange={(value) => setUnit('delay', { feedback: value / 100 })} />
          <FunctionalRange id="effects-delay-mix" label="Delay mix" value={chain.delay.mix * 100} onChange={(value) => setUnit('delay', { mix: value / 100 })} />
          <FunctionalButton id="effects-delay-filter" label="Delay feedback filter" pressed={chain.delay.filter !== 'Off'} valueText={chain.delay.filter} onClick={() => setUnit('delay', { filter: cycle(FEEDBACK_FILTERS, chain.delay.filter) })} />
        </div>
        <div><b>COMP</b>
          <FunctionalButton id="effects-compressor-on" label="Compressor on" pressed={chain.compressor.on} valueText="ON" onClick={() => setUnit('compressor', { on: !chain.compressor.on })} />
          <FunctionalButton id="effects-compressor-global" label="Compressor global mode" pressed={chain.compressor.global} valueText="GLOBAL" onClick={() => setUnit('compressor', { global: !chain.compressor.global })} />
          <FunctionalButton id="effects-compressor-fast" label="Compressor fast mode" pressed={chain.compressor.fast} valueText="FAST" onClick={() => setUnit('compressor', { fast: !chain.compressor.fast })} />
          <FunctionalRange id="effects-compressor-amount" label="Compressor amount" value={chain.compressor.amount * 100} onChange={(value) => setUnit('compressor', { amount: value / 100 })} />
        </div>
        <div><b>REVERB</b>
          <FunctionalButton id="effects-reverb-on" label="Reverb on" pressed={chain.reverb.on} valueText="ON" onClick={() => setUnit('reverb', { on: !chain.reverb.on })} />
          <FunctionalButton id="effects-reverb-global" label="Reverb global mode" pressed={chain.reverb.global} valueText="GLOBAL" onClick={() => setUnit('reverb', { global: !chain.reverb.global })} />
          <FunctionalButton id="effects-reverb-type" label="Reverb type" pressed={chain.reverb.on} valueText={chain.reverb.type} onClick={() => setUnit('reverb', { type: cycle(REVERB_TYPES, chain.reverb.type as never) })} />
          <FunctionalRange id="effects-reverb-bright" label="Reverb brightness" value={chain.reverb.bright * 100} onChange={(value) => setUnit('reverb', { bright: value / 100 })} />
          <FunctionalRange id="effects-reverb-mix" label="Reverb mix" value={chain.reverb.mix * 100} onChange={(value) => setUnit('reverb', { mix: value / 100 })} />
        </div>
      </div>
      <div className="effects-footer">
        <FunctionalButton id="effects-rotary-on" label="Shared rotary on" pressed={instrument.rotaryOn} valueText="ROTARY" onClick={() => setInstrument((current) => ({ ...current, rotaryOn: !current.rotaryOn }))} />
        <FunctionalButton id="effects-rotary-speed" label="Shared rotary speed" pressed={instrument.rotaryFast} valueText={instrument.rotaryFast ? 'FAST' : 'SLOW'} onClick={() => setInstrument((current) => ({ ...current, rotaryFast: !current.rotaryFast }))} />
        <FunctionalRange id="effects-rotary-drive" label="Shared rotary drive" value={instrument.rotaryDrive * 100} onChange={(value) => setInstrument((current) => ({ ...current, rotaryDrive: value / 100 }))} />
        <FunctionalButton id="effects-all-bypass" label="All effects bypass" pressed={chain.allBypass} valueText="BYPASS" onClick={() => setInstrument((current) => {
          const effects = { ...current.effects }
          const targets: LayerId[] = current.group ? ['A', 'B'] : [current.focus]
          for (const layer of targets) effects[layer] = { ...effects[layer], allBypass: !effects[current.focus].allBypass }
          return { ...current, effects }
        })} />
      </div>
    </Section>
  )
}

function Keybed({ controller, activeNotes }: { controller: PianoInputController; activeNotes: number[] }) {
  const active = new Set(activeNotes)
  const whiteKeys = KEYS.filter((key) => !key.black)
  const blackKeys = KEYS.filter((key) => key.black)

  const accessibilityDown = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => {
    if ((event.code === 'Enter' || event.code === 'Space') && !event.repeat) {
      event.preventDefault()
      controller.pointerDown(10_000 + midi, midi, 0.76)
    }
  }
  const accessibilityUp = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => {
    if (event.code === 'Enter' || event.code === 'Space') {
      event.preventDefault()
      controller.pointerUp(10_000 + midi)
    }
  }
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, midi: number) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    const velocity = Math.max(0.2, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    controller.pointerDown(event.pointerId, midi, velocity)
  }
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => controller.pointerUp(event.pointerId)

  return (
    <div className="keybed" data-key-count={KEYS.length} data-range="E1–E7" aria-label="73 key hammer-action keybed">
      <div className="white-keys">
        {whiteKeys.map((key) => (
          <button
            type="button" key={key.id} id={key.id}
            className={`piano-key white-key ${active.has(key.midi) ? 'is-active' : ''}`}
            aria-label={`${key.note}${key.octave} piano key`}
            aria-pressed={active.has(key.midi)}
            data-midi={key.midi}
            onPointerDown={(event) => pointerDown(event, key.midi)}
            onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
            onKeyDown={(event) => accessibilityDown(event, key.midi)} onKeyUp={(event) => accessibilityUp(event, key.midi)}
            onBlur={() => controller.pointerUp(10_000 + key.midi)}
          />
        ))}
      </div>
      <div className="black-keys" aria-hidden="false">
        {blackKeys.map((key) => (
          <button
            type="button" key={key.id} id={key.id}
            className={`piano-key black-key ${active.has(key.midi) ? 'is-active' : ''}`}
            style={{ left: `${((key.blackOffset ?? 0) / 43) * 100}%` }}
            aria-label={`${key.note}${key.octave} piano key`}
            aria-pressed={active.has(key.midi)}
            data-midi={key.midi}
            onPointerDown={(event) => pointerDown(event, key.midi)}
            onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
            onKeyDown={(event) => accessibilityDown(event, key.midi)} onKeyUp={(event) => accessibilityUp(event, key.midi)}
            onBlur={() => controller.pointerUp(10_000 + key.midi)}
          />
        ))}
      </div>
    </div>
  )
}

function connectedMidiLabel(inputs: MidiInputLike[]): string {
  if (inputs.length === 0) return 'MIDI disconnected'
  return `MIDI connected · ${inputs.map((input) => input.name || input.id).join(', ')}`
}

export default function App({ engine: suppliedEngine, requestMidiAccess }: AppProps) {
  const initialInstrument = useMemo(createInitialInstrumentState, [])
  const [instrument, setInstrumentState] = useState<InstrumentState>(initialInstrument)
  const engine = useMemo(() => suppliedEngine ?? new StagePianoEngine(initialInstrument), [suppliedEngine, initialInstrument])
  const [notes, setNotes] = useState<NoteSnapshot>(EMPTY_NOTES)
  const [pianoStatus, setPianoStatus] = useState<PianoStatus>(() => engine.getStatus())
  const [midiStatus, setMidiStatus] = useState('MIDI not connected')
  const [hardware, dispatchHardware] = useReducer(hardwareReducer, INITIAL_HARDWARE_STATE)
  const controller = useMemo(
    () => new PianoInputController(engine, (inputs) => setMidiStatus(connectedMidiLabel(inputs))),
    [engine],
  )

  const setInstrument = (update: (state: InstrumentState) => InstrumentState) => setInstrumentState((current) => update(current))

  useEffect(() => engine.subscribe(setNotes), [engine])
  useEffect(() => engine.subscribeStatus(setPianoStatus), [engine])
  useEffect(() => { if (engine instanceof StagePianoEngine) engine.updateState(instrument) }, [engine, instrument])
  useEffect(() => {
    const keyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.matches('button, input, select, textarea')) return
      if (controller.keyDown(event.code, event.repeat)) event.preventDefault()
    }
    const keyUp = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.matches('button, input, select, textarea')) return
      if (controller.keyUp(event.code)) event.preventDefault()
    }
    const cleanup = () => controller.allNotesOff()
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', cleanup)
    document.addEventListener('visibilitychange', cleanup)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', cleanup)
      document.removeEventListener('visibilitychange', cleanup)
      controller.dispose()
    }
  }, [controller])

  const connectMidi = async () => {
    const request = requestMidiAccess ?? (navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }).requestMIDIAccess?.bind(navigator)
    if (!request) {
      setMidiStatus('Web MIDI unsupported in this browser')
      controller.allNotesOff()
      return
    }
    setMidiStatus('Requesting MIDI access…')
    try {
      controller.attachMidiAccess(await request())
    } catch {
      controller.allNotesOff()
      setMidiStatus('MIDI access denied')
    }
  }

  const changeHardware = (id: string, value: number) => dispatchHardware({ id, value })

  return (
    <main className="app-shell">
      <header className="utility-bar">
        <div><span className={`status-dot ${pianoStatus.state}`} /> <strong>{pianoStatus.label}</strong></div>
        <div><span>{notes.activeVoiceCount} voices</span><span>{notes.sustain ? 'Sustain on' : 'Sustain off'}</span></div>
        <button type="button" onClick={connectMidi}>{midiStatus}</button>
        <button type="button" aria-pressed={notes.sustain} onClick={() => engine.setSustain(!notes.sustain)}>Sustain pedal {notes.sustain ? 'on' : 'off'}</button>
        <p>A–' and Z–, play · Space sustains · Piano, Effects, and Master are live</p>
      </header>

      <div className="instrument-stage">
        <article className="instrument" aria-label="Nord Stage 4 73 browser instrument" data-variant="stage-4-73">
          <div className="top-rail"><span>NORD STAGE 4</span><span>73 · HAMMER ACTION</span></div>
          <div className="control-deck" data-deck-ratio="0.54">
            <PerformanceSection state={hardware} onChange={changeHardware} instrument={instrument} setInstrument={setInstrument} />
            <OrganSection state={hardware} onChange={changeHardware} />
            <PianoSection instrument={instrument} setInstrument={setInstrument} />
            <ProgramSection state={hardware} onChange={changeHardware} instrument={instrument} />
            <SynthSection state={hardware} onChange={changeHardware} />
            <EffectsSection state={hardware} onChange={changeHardware} instrument={instrument} setInstrument={setInstrument} />
          </div>
          <div className="keybed-deck" data-keybed-ratio="0.46">
            <div className="keybed-cheek left-cheek"><span>NS4</span></div>
            <Keybed controller={controller} activeNotes={notes.activeNotes} />
            <div className="keybed-cheek right-cheek"><span>73</span></div>
          </div>
          <div className="front-lip"><span>STAGE 4</span></div>
        </article>
      </div>

      <footer className="phase-note">PHASE 2 · Piano A/B, Layer Effects, sustain, and Master Level are live. Organ, Program, and Synth remain decorative.</footer>
    </main>
  )
}
