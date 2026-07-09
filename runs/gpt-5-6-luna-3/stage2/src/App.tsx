import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES, PianoAudioEngine, type EffectSettings, type EngineState, type LayerName, type PianoType } from './audio'

type HardwareValue = number | boolean | string
type HardwareState = Record<string, HardwareValue>

const WHITE_NAMES = ['E', 'F', 'G', 'A', 'B', 'C', 'D'] as const
const BLACK_AFTER = new Set(['F', 'G', 'A', 'C', 'D'])
const COMPUTER_KEYS: Record<string, number> = {
  z: 52, s: 53, x: 54, d: 55, c: 56, v: 57, g: 58, b: 59, h: 60, n: 61, j: 62, m: 63,
  ',': 64, l: 65, '.': 66, ';': 67, '/': 68,
  q: 64, '2': 65, w: 66, '3': 67, e: 68, r: 69, '5': 70, t: 71, '6': 72, y: 73, '7': 74, u: 75,
}
function useHardwareState() {
  const [hardware, setHardwareState] = useState<HardwareState>({})
  const setHardware = useCallback((id: string, value: HardwareValue) => {
    setHardwareState((previous) => ({ ...previous, [id]: value }))
  }, [])
  const getHardware = useCallback((id: string, fallback: HardwareValue) => hardware[id] ?? fallback, [hardware])
  return { hardware, setHardware, getHardware }
}

const makeEffect = (overrides: Partial<EffectSettings> = {}): EffectSettings => ({ on: false, amount: 0.35, rate: 0.3, dryWet: 0.35, feedback: 0.25, bright: 0.5, drive: 0.2, global: false, fast: false, ...overrides })

const INITIAL_ENGINE_STATE: EngineState = {
  sectionOn: true,
  type: 'Grand',
  kbTouch: 'Medium',
  dynComp: 0,
  timbre: 0.5,
  unison: 0,
  softRelease: false,
  stringRes: false,
  masterLevel: 0.72,
  pianoGroup: false,
  effectsBypass: false,
  rotaryOn: false,
  rotaryDrive: 0.25,
  layers: {
    A: { enabled: true, focus: true, level: 0.8, octave: 0, sustainPed: true, pitchStick: false },
    B: { enabled: false, focus: false, level: 0.55, octave: 0, sustainPed: true, pitchStick: false },
  },
  effects: {
    A: { mod1: makeEffect({ type: 'A-Pan' }), mod2: makeEffect({ type: 'Chorus' }), delay: makeEffect({ dryWet: 0.28 }), ampEq: makeEffect({ type: 'EQ only' }), compressor: makeEffect({ dryWet: 0.5 }), reverb: makeEffect({ type: 'Room', dryWet: 0.22 }) },
    B: { mod1: makeEffect({ type: 'A-Pan' }), mod2: makeEffect({ type: 'Chorus' }), delay: makeEffect({ dryWet: 0.28 }), ampEq: makeEffect({ type: 'EQ only' }), compressor: makeEffect({ dryWet: 0.5 }), reverb: makeEffect({ type: 'Room', dryWet: 0.22 }) },
  },
}

function SelectControl({ id, label, value, options, onChange }: { id: string; label: string; value: string | number; options: readonly (string | number)[]; onChange: (value: string) => void }) {
  return <label className="select-cell" htmlFor={id}><span className="control-label">{label}</span><select id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
}

function Knob({ id, label, value, onChange, size = 'normal' }: { id: string; label: string; value: number; onChange: (value: number) => void; size?: 'small' | 'normal' }) {
  const angle = -132 + value * 264
  const change = (delta: number) => onChange(Math.max(0, Math.min(1, value + delta)))
  return (
    <div className={`control-cell knob-cell ${size}`}>
      <button
        id={id}
        type="button"
        role="slider"
        className="knob-control"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        style={{ '--knob-angle': `${angle}deg` } as CSSProperties}
        onClick={() => change(0.08)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); change(0.05) }
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); change(-0.05) }
          if (event.key === 'Home') { event.preventDefault(); onChange(0) }
          if (event.key === 'End') { event.preventDefault(); onChange(1) }
        }}
      >
        <span className="knob-marker" />
      </button>
      <span className="control-label">{label}</span>
    </div>
  )
}

function Fader({ id, label, value, onChange, compact = false }: { id: string; label: string; value: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className={`fader-cell ${compact ? 'compact' : ''}`} htmlFor={id}>
      <span className="fader-track"><input id={id} type="range" min="0" max="100" value={Math.round(value * 100)} aria-label={label} onChange={(event) => onChange(Number(event.target.value) / 100)} /></span>
      <span className="control-label">{label}</span>
    </label>
  )
}

function Toggle({ id, label, pressed, onChange, accent = false }: { id: string; label: string; pressed: boolean; onChange: (value: boolean) => void; accent?: boolean }) {
  return <button id={id} type="button" className={`toggle-control ${pressed ? 'is-active' : ''} ${accent ? 'accent' : ''}`} aria-label={label} aria-pressed={pressed} onClick={() => onChange(!pressed)}><span className="toggle-light" />{label}</button>
}

function DotLeds({ count = 5, active = 2 }: { count?: number; active?: number }) {
  return <span className="dot-leds" aria-hidden="true">{Array.from({ length: count }, (_, index) => <i key={index} className={index < active ? 'on' : ''} />)}</span>
}

function SectionHeader({ eyebrow, title, id, on }: { eyebrow: string; title: string; id: string; on?: boolean }) {
  return <div className="section-header"><span className="section-eyebrow">{eyebrow}</span><h2 id={id}>{title}</h2>{on !== undefined && <span className={`section-state ${on ? 'on' : ''}`}>{on ? 'ON' : 'OFF'}</span>}</div>
}

function DecorativeKnob({ id, label, getHardware, setHardware, value = 0.5, size }: { id: string; label: string; getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void; value?: number; size?: 'small' | 'normal' }) {
  return <Knob id={id} label={label} value={Number(getHardware(id, value))} onChange={(next) => setHardware(id, next)} size={size} />
}

function PerformanceSection({ getHardware, setHardware, sustain, setSustain, masterLevel, setMasterLevel }: { getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void; sustain: boolean; setSustain: (value: boolean) => void; masterLevel: number; setMasterLevel: (value: number) => void }) {
  return <section className="instrument-section performance" aria-labelledby="section-performance">
    <SectionHeader eyebrow="NORD" title="STAGE 4" id="section-performance" />
    <div className="performance-brand">73 <span>HAMMER ACTION</span></div>
    <div className="performance-top"><Knob id="performance-master-level" label="MASTER LEVEL" value={masterLevel} onChange={setMasterLevel} /><div className="master-led"><DotLeds count={8} active={Math.round(masterLevel * 8)} /><span>LEVEL</span></div></div>
    <div className="wheels" aria-label="Pitch stick and modulation wheel">
      <div className="wheel-wrap"><div id="performance-pitch-stick" className="wheel-stick" role="slider" tabIndex={0} aria-label="Pitch stick" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Number(getHardware('performance-pitch-stick', 0))} onKeyDown={(event) => { if (event.key === 'ArrowUp') setHardware('performance-pitch-stick', 100); if (event.key === 'ArrowDown') setHardware('performance-pitch-stick', -100) }} /><span>PITCH</span></div>
      <div className="wheel-wrap"><div id="performance-mod-wheel" className="wheel" role="slider" tabIndex={0} aria-label="Modulation wheel" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(getHardware('performance-mod-wheel', 0.2)) * 100} onClick={() => setHardware('performance-mod-wheel', 0.7)} /><span>MOD</span></div>
    </div>
    <div className="sustain-block"><Toggle id="performance-sustain" label="SUSTAIN" pressed={sustain} onChange={setSustain} accent /><span className="micro-copy">UI / SPACE / CC64</span></div>
  </section>
}

function OrganSection({ getHardware, setHardware }: { getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void }) {
  const drawbars = ['16', '5⅓', '8', '4', '2⅔', '2', '1⅗', '1⅓', '1']
  return <section className="instrument-section dark-panel organ" aria-labelledby="section-organ">
    <SectionHeader eyebrow="ORGAN" title="ORGAN" id="section-organ" />
    <div className="organ-row"><div className="model-buttons">{['B3', 'VOX', 'FARF', 'PIPE'].map((name, index) => <Toggle key={name} id={`organ-model-${name.toLowerCase()}`} label={name} pressed={Boolean(getHardware(`organ-model-${name.toLowerCase()}`, index === 0))} onChange={(value) => setHardware(`organ-model-${name.toLowerCase()}`, value)} />)}</div><div className="organ-mini-group"><span className="mini-heading">PERC</span><Toggle id="organ-percussion" label="ON" pressed={Boolean(getHardware('organ-percussion', false))} onChange={(value) => setHardware('organ-percussion', value)} /><DecorativeKnob id="organ-perc-level" label="LEVEL" getHardware={getHardware} setHardware={setHardware} value={0.4} size="small" /></div></div>
    <div className="drawbar-bank" aria-label="Nine decorative organ drawbars">{drawbars.map((name, index) => <label className="drawbar" key={name} htmlFor={`organ-drawbar-${index}`}><span className="drawbar-cap" style={{ transform: `translateY(${Number(getHardware(`organ-drawbar-${index}`, 0.35 + (index % 4) * 0.12)) * 16}px)` }} /><input id={`organ-drawbar-${index}`} type="range" min="0" max="100" value={Math.round(Number(getHardware(`organ-drawbar-${index}`, 0.35 + (index % 4) * 0.12)) * 100)} aria-label={`Organ drawbar ${name}`} onChange={(event) => setHardware(`organ-drawbar-${index}`, Number(event.target.value) / 100)} /><span className="drawbar-leds"><DotLeds count={6} active={index % 6} /></span><small>{name}</small></label>)}</div>
    <div className="organ-footer"><span className="mini-heading">VIBRATO / CHORUS</span><Toggle id="organ-vibrato" label="VIB/CH" pressed={Boolean(getHardware('organ-vibrato', false))} onChange={(value) => setHardware('organ-vibrato', value)} /><DecorativeKnob id="organ-rotary-drive" label="DRIVE" getHardware={getHardware} setHardware={setHardware} value={0.3} size="small" /><Toggle id="organ-rotary-speed" label="SLOW / FAST" pressed={Boolean(getHardware('organ-rotary-speed', false))} onChange={(value) => setHardware('organ-rotary-speed', value)} /></div>
  </section>
}

function PianoSection({ state, update }: { state: EngineState; update: <K extends keyof EngineState>(key: K, value: EngineState[K]) => void }) {
  const updateLayer = (layer: LayerName, patch: Partial<EngineState['layers'][LayerName]>) => update('layers', { ...state.layers, [layer]: { ...state.layers[layer], ...patch } })
  const selectLayer = (layer: LayerName) => update('layers', { A: { ...state.layers.A, focus: layer === 'A' }, B: { ...state.layers.B, focus: layer === 'B' } })
  const setType = (type: PianoType) => update('type', type)
  return <section className="instrument-section dark-panel piano" aria-labelledby="section-piano">
    <SectionHeader eyebrow="PIANO" title="PIANO" id="section-piano" on={state.sectionOn} />
    <div className="piano-layers">{(['A', 'B'] as LayerName[]).map((layer) => <div className="piano-layer" key={layer}>
      <Toggle id={`piano-layer-${layer.toLowerCase()}-on`} label={`LAYER ${layer}`} pressed={state.layers[layer].enabled} onChange={(value) => updateLayer(layer, { enabled: value })} />
      <Fader id={`piano-layer-${layer.toLowerCase()}-level`} label="LEVEL" value={state.layers[layer].level} onChange={(value) => updateLayer(layer, { level: value })} compact />
      <Toggle id={`piano-layer-${layer.toLowerCase()}-focus`} label="FOCUS" pressed={state.layers[layer].focus} onChange={() => selectLayer(layer)} />
      <div className="octave-row"><button type="button" aria-label={`Layer ${layer} octave down`} onClick={() => updateLayer(layer, { octave: -1 })}>−12</button><span>OCT {state.layers[layer].octave > 0 ? '+' : ''}{state.layers[layer].octave * 12}</span><button type="button" aria-label={`Layer ${layer} octave up`} onClick={() => updateLayer(layer, { octave: 1 })}>+12</button></div>
      <Toggle id={`piano-layer-${layer.toLowerCase()}-sustped`} label="SUSTPED" pressed={state.layers[layer].sustainPed} onChange={(value) => updateLayer(layer, { sustainPed: value })} />
    </div>)}</div>
    <div className="piano-type-row">{(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as PianoType[]).map((type) => <Toggle key={type} id={`piano-type-${type.toLowerCase()}`} label={type.toUpperCase()} pressed={state.type === type} onChange={() => setType(type)} />)}</div>
    <div className="piano-controls"><Toggle id="piano-section-on" label="ON" pressed={state.sectionOn} onChange={(value) => update('sectionOn', value)} /><SelectControl id="piano-model" label="MODEL" value="A" options={['A']} onChange={() => undefined} /><Knob id="piano-timbre" label="TIMBRE" value={state.timbre} onChange={(value) => update('timbre', value)} /><Toggle id="piano-pstick" label="PSTICK" pressed={state.layers.A.pitchStick} onChange={(value) => update('layers', { ...state.layers, A: { ...state.layers.A, pitchStick: value }, B: { ...state.layers.B, pitchStick: value } })} /></div>
    <div className="piano-details"><span className="mini-heading">PIANO DETAIL</span><SelectControl id="piano-kb-touch" label="KB TOUCH" value={state.kbTouch} options={['Heavy', 'Medium', 'Light']} onChange={(value) => update('kbTouch', value as EngineState['kbTouch'])} /><SelectControl id="piano-dyn-comp" label="DYN COMP" value={state.dynComp} options={['0', '1', '2', '3']} onChange={(value) => update('dynComp', Number(value) as EngineState['dynComp'])} /><SelectControl id="piano-unison" label="UNISON" value={state.unison} options={['0', '1', '2', '3']} onChange={(value) => update('unison', Number(value) as EngineState['unison'])} /><Toggle id="piano-soft-release" label="SOFT RELEASE" pressed={state.softRelease} onChange={(value) => update('softRelease', value)} /><Toggle id="piano-string-res" label="STRING RES" pressed={state.stringRes} onChange={(value) => update('stringRes', value)} /></div>
    <div className="piano-status" role="status">{state.type} · model A · {state.layers.A.focus ? 'A' : 'B'} focused · fallback-ready</div>
  </section>
}

function ProgramSection({ getHardware, setHardware }: { getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void }) {
  return <section className="instrument-section program" aria-labelledby="section-program">
    <SectionHeader eyebrow="PROGRAM" title="PROGRAM" id="section-program" />
    <div className="program-screen" aria-label="Primary program display">P1 <strong>DECORATIVE</strong><small>P1 · BASIC PIANO</small></div>
    <div className="program-main"><DecorativeKnob id="program-dial" label="PROGRAM DIAL" getHardware={getHardware} setHardware={setHardware} value={0.45} /><div className="program-actions"><div className="program-grid">{Array.from({ length: 8 }, (_, index) => <Toggle key={index} id={`program-button-${index + 1}`} label={`${String(index + 1).padStart(2, '0')}`} pressed={Boolean(getHardware(`program-button-${index + 1}`, index === 0))} onChange={(value) => setHardware(`program-button-${index + 1}`, value)} />)}</div><div className="page-buttons"><Toggle id="program-page-left" label="PAGE ◀" pressed={Boolean(getHardware('program-page-left', false))} onChange={(value) => setHardware('program-page-left', value)} /><Toggle id="program-page-right" label="PAGE ▶" pressed={Boolean(getHardware('program-page-right', false))} onChange={(value) => setHardware('program-page-right', value)} /></div></div></div>
    <div className="program-bottom"><Toggle id="program-live-mode" label="LIVE MODE" pressed={Boolean(getHardware('program-live-mode', false))} onChange={(value) => setHardware('program-live-mode', value)} /><Toggle id="program-scene-one" label="SCENE I" pressed={Boolean(getHardware('program-scene-one', false))} onChange={(value) => setHardware('program-scene-one', value)} /><Toggle id="program-scene-two" label="SCENE II" pressed={Boolean(getHardware('program-scene-two', false))} onChange={(value) => setHardware('program-scene-two', value)} /><Toggle id="program-store" label="STORE" pressed={Boolean(getHardware('program-store', false))} onChange={(value) => setHardware('program-store', value)} /><Toggle id="program-split" label="SPLIT" pressed={Boolean(getHardware('program-split', false))} onChange={(value) => setHardware('program-split', value)} /></div>
    <div className="morph-row"><span className="mini-heading">MORPH ASSIGN</span>{['WHEEL', 'CTRL PED', 'AT'].map((name) => <Toggle key={name} id={`program-morph-${name.toLowerCase().replace(' ', '-')}`} label={name} pressed={Boolean(getHardware(`program-morph-${name.toLowerCase().replace(' ', '-')}`, false))} onChange={(value) => setHardware(`program-morph-${name.toLowerCase().replace(' ', '-')}`, value)} />)}</div>
  </section>
}

function SynthSection({ getHardware, setHardware }: { getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void }) {
  const knobs = [['OSC CTRL', 0.3], ['SHAPE', 0.55], ['FILTER', 0.65], ['RESONANCE', 0.25], ['ENV AMT', 0.5], ['ATTACK', 0.14], ['DECAY', 0.25], ['SUSTAIN', 0.75], ['RELEASE', 0.28]] as const
  return <section className="instrument-section dark-panel synth" aria-labelledby="section-synth">
    <SectionHeader eyebrow="SYNTH" title="SYNTH" id="section-synth" />
    <div className="synth-screen" aria-label="Primary synth display">SYNTH <strong>DECORATIVE</strong><small>OSC · FILTER · ENV</small></div>
    <div className="synth-layers"><Toggle id="synth-layer-a-on" label="LAYER A" pressed={Boolean(getHardware('synth-layer-a-on', true))} onChange={(value) => setHardware('synth-layer-a-on', value)} /><Fader id="synth-layer-a-level" label="LEVEL" value={Number(getHardware('synth-layer-a-level', 0.72))} onChange={(value) => setHardware('synth-layer-a-level', value)} compact /><Toggle id="synth-layer-b-on" label="LAYER B" pressed={Boolean(getHardware('synth-layer-b-on', false))} onChange={(value) => setHardware('synth-layer-b-on', value)} /><Fader id="synth-layer-b-level" label="LEVEL" value={Number(getHardware('synth-layer-b-level', 0.5))} onChange={(value) => setHardware('synth-layer-b-level', value)} compact /></div>
    <div className="synth-body"><div className="synth-group"><span className="group-label">OSCILLATOR</span><div className="wave-buttons"><Toggle id="synth-wave-sine" label="SINE" pressed={Boolean(getHardware('synth-wave-sine', true))} onChange={(value) => setHardware('synth-wave-sine', value)} /><Toggle id="synth-wave-saw" label="SAW" pressed={Boolean(getHardware('synth-wave-saw', false))} onChange={(value) => setHardware('synth-wave-saw', value)} /><Toggle id="synth-wave-square" label="SQR" pressed={Boolean(getHardware('synth-wave-square', false))} onChange={(value) => setHardware('synth-wave-square', value)} /></div>{knobs.slice(0, 2).map(([label, value]) => <DecorativeKnob key={label} id={`synth-${label.toLowerCase().replaceAll(' ', '-')}`} label={label} getHardware={getHardware} setHardware={setHardware} value={value} size="small" />)}</div><div className="synth-group"><span className="group-label">FILTER</span>{knobs.slice(2, 5).map(([label, value]) => <DecorativeKnob key={label} id={`synth-${label.toLowerCase().replaceAll(' ', '-')}`} label={label} getHardware={getHardware} setHardware={setHardware} value={value} size="small" />)}<Toggle id="synth-filter-type" label="LP / HP" pressed={Boolean(getHardware('synth-filter-type', false))} onChange={(value) => setHardware('synth-filter-type', value)} /></div><div className="synth-group envelope"><span className="group-label">ENVELOPE</span>{knobs.slice(5).map(([label, value]) => <DecorativeKnob key={label} id={`synth-${label.toLowerCase()}`} label={label} getHardware={getHardware} setHardware={setHardware} value={value} size="small" />)}</div></div>
    <div className="synth-footer"><Toggle id="synth-lfo" label="LFO" pressed={Boolean(getHardware('synth-lfo', false))} onChange={(value) => setHardware('synth-lfo', value)} /><Toggle id="synth-arp" label="ARP / GATE" pressed={Boolean(getHardware('synth-arp', false))} onChange={(value) => setHardware('synth-arp', value)} /><DecorativeKnob id="synth-rate" label="RATE" getHardware={getHardware} setHardware={setHardware} value={0.35} size="small" /></div>
  </section>
}

function EffectsSection({ state, update }: { state: EngineState; update: <K extends keyof EngineState>(key: K, value: EngineState[K]) => void }) {
  const focused: LayerName = state.layers.B.focus ? 'B' : 'A'
  const effects = state.effects[focused]
  const patchEffect = (unit: keyof typeof effects, patch: Partial<EffectSettings>) => {
    const nextFocused = { ...effects, [unit]: { ...effects[unit], ...patch } }
    const nextEffects = { ...state.effects, [focused]: nextFocused }
    if (state.pianoGroup || (['delay', 'compressor', 'reverb'] as string[]).includes(unit as string) && patch.global !== undefined) {
      nextEffects.A = { ...nextEffects.A, [unit]: { ...nextEffects.A[unit], ...patch } }
      nextEffects.B = { ...nextEffects.B, [unit]: { ...nextEffects.B[unit], ...patch } }
    }
    update('effects', nextEffects)
  }
  const toggle = (unit: keyof typeof effects) => patchEffect(unit, { on: !effects[unit].on })
  return <section className="instrument-section dark-panel effects" aria-labelledby="section-effects">
    <SectionHeader eyebrow="LAYER FX" title="EFFECTS" id="section-effects" />
    <div className="effects-focus"><Toggle id="effects-focus-a" label="LAYER A" pressed={focused === 'A'} onChange={() => update('layers', { A: { ...state.layers.A, focus: true }, B: { ...state.layers.B, focus: false } })} /><Toggle id="effects-focus-b" label="LAYER B" pressed={focused === 'B'} onChange={() => update('layers', { A: { ...state.layers.A, focus: false }, B: { ...state.layers.B, focus: true } })} /><Toggle id="effects-group-piano" label="PIANO GROUP" pressed={state.pianoGroup} onChange={(value) => update('pianoGroup', value)} /></div>
    <div className="effects-matrix">
      <div className="effect-column"><span className="group-label">MOD 1</span><SelectControl id="effects-mod1-type" label="TYPE" value={effects.mod1.type ?? 'A-Pan'} options={MOD1_TYPES} onChange={(value) => patchEffect('mod1', { type: value })} /><Knob id="effects-mod1-amount" label="AMOUNT" value={effects.mod1.amount} onChange={(value) => patchEffect('mod1', { amount: value, dryWet: value })} size="small" /><Toggle id="effects-mod1-on" label="ON" pressed={effects.mod1.on} onChange={() => toggle('mod1')} /></div>
      <div className="effect-column"><span className="group-label">MOD 2</span><SelectControl id="effects-mod2-type" label="TYPE" value={effects.mod2.type ?? 'Chorus'} options={MOD2_TYPES} onChange={(value) => patchEffect('mod2', { type: value })} /><Knob id="effects-mod2-amount" label="AMOUNT" value={effects.mod2.amount} onChange={(value) => patchEffect('mod2', { amount: value, dryWet: value })} size="small" /><Toggle id="effects-mod2-on" label="ON" pressed={effects.mod2.on} onChange={() => toggle('mod2')} /></div>
      <div className="effect-column"><span className="group-label">DELAY</span><Knob id="effects-delay-time" label="TIME" value={effects.delay.rate} onChange={(value) => patchEffect('delay', { rate: value, dryWet: Math.max(effects.delay.dryWet, 0.2) })} size="small" /><Knob id="effects-delay-feedback" label="FEEDBACK" value={effects.delay.feedback} onChange={(value) => patchEffect('delay', { feedback: value })} size="small" /><Toggle id="effects-delay-on" label="ON" pressed={effects.delay.on} onChange={() => toggle('delay')} /><Toggle id="effects-delay-global" label="GLOBAL" pressed={effects.delay.global} onChange={() => patchEffect('delay', { global: !effects.delay.global })} /></div>
      <div className="effect-column"><span className="group-label">AMP / EQ</span><SelectControl id="effects-amp-type" label="TYPE" value={effects.ampEq.type ?? 'EQ only'} options={AMP_TYPES} onChange={(value) => patchEffect('ampEq', { type: value, toRotary: value === 'To Rotary' })} /><Knob id="effects-amp-drive" label="DRIVE" value={effects.ampEq.drive} onChange={(value) => patchEffect('ampEq', { drive: value, amount: value, dryWet: value })} size="small" /><Toggle id="effects-amp-on" label="ON" pressed={effects.ampEq.on} onChange={() => toggle('ampEq')} /></div>
      <div className="effect-column"><span className="group-label">COMP</span><Knob id="effects-comp-amount" label="AMOUNT" value={effects.compressor.amount} onChange={(value) => patchEffect('compressor', { amount: value, dryWet: value })} size="small" /><Toggle id="effects-comp-on" label="ON" pressed={effects.compressor.on} onChange={() => toggle('compressor')} /><Toggle id="effects-comp-global" label="GLOBAL" pressed={effects.compressor.global} onChange={() => patchEffect('compressor', { global: !effects.compressor.global })} /></div>
      <div className="effect-column"><span className="group-label">REVERB</span><SelectControl id="effects-reverb-type" label="TYPE" value={effects.reverb.type ?? 'Room'} options={REVERB_TYPES} onChange={(value) => patchEffect('reverb', { type: value })} /><Knob id="effects-reverb-amount" label="DRY / WET" value={effects.reverb.dryWet} onChange={(value) => patchEffect('reverb', { dryWet: value, amount: value })} size="small" /><Toggle id="effects-reverb-on" label="ON" pressed={effects.reverb.on} onChange={() => toggle('reverb')} /><Toggle id="effects-reverb-global" label="GLOBAL" pressed={effects.reverb.global} onChange={() => patchEffect('reverb', { global: !effects.reverb.global })} /></div>
    </div>
    <div className="effects-footer"><Toggle id="effects-rotary" label="TO ROTARY" pressed={state.rotaryOn} onChange={(value) => update('rotaryOn', value)} /><Knob id="effects-rotary-drive" label="DRIVE" value={state.rotaryDrive} onChange={(value) => update('rotaryDrive', value)} size="small" /><Toggle id="effects-bypass" label="BYPASS ALL" pressed={state.effectsBypass} onChange={(value) => update('effectsBypass', value)} /></div>
  </section>
}

function Keybed({ onNoteOn, onNoteOff, pressedKeys }: { onNoteOn: (note: number, source: string, velocity: number) => void; onNoteOff: (note: number, source: string) => void; pressedKeys: Set<number> }) {
  const whiteKeys = Array.from({ length: 43 }, (_, index) => ({ index, name: WHITE_NAMES[index % WHITE_NAMES.length], note: 40 + index }))
  const blackKeys = whiteKeys.slice(0, -1).filter((key) => BLACK_AFTER.has(key.name)).map((key, index) => ({ ...key, index }))
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, note: number, source: string) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onNoteOn(note, source, Math.round(48 + event.pressure * 79))
  }
  return <section className="keybed" aria-label="73-key hammer-action keybed, E to E">
    <div className="keybed-heading"><span>HAMMER ACTION</span><strong>73</strong><span>E — E</span><small>TOUCH RESPONSE / GENERATED PIANO</small></div>
    <div className="keybed-frame"><div className="white-keys">{whiteKeys.map((key) => <button key={key.note} type="button" className={`key white-key ${pressedKeys.has(key.note) ? 'pressed' : ''}`} data-key-id={`key-${key.note}`} aria-label={`${key.name} key ${key.note}`} onPointerDown={(event) => handlePointerDown(event, key.note, `pointer-${event.pointerId}-${key.note}`)} onPointerUp={(event) => onNoteOff(key.note, `pointer-${event.pointerId}-${key.note}`)} onPointerCancel={(event) => onNoteOff(key.note, `pointer-${event.pointerId}-${key.note}`)}><span>{key.index === 0 || key.name === 'C' ? key.name : ''}</span></button>)}</div><div className="black-keys">{blackKeys.map((key) => <button key={`black-${key.note}`} type="button" className={`key black-key ${pressedKeys.has(key.note + 1) ? 'pressed' : ''}`} data-key-id={`key-black-${key.note + 1}`} aria-label={`Black key ${key.note + 1}`} style={{ left: `calc(${((key.index + 1) / 43) * 100}% - 0.28rem)` }} onPointerDown={(event) => handlePointerDown(event, key.note + 1, `pointer-${event.pointerId}-black-${key.note + 1}`)} onPointerUp={(event) => onNoteOff(key.note + 1, `pointer-${event.pointerId}-black-${key.note + 1}`)} onPointerCancel={(event) => onNoteOff(key.note + 1, `pointer-${event.pointerId}-black-${key.note + 1}`)} />)}</div></div>
  </section>
}

function App() {
  const { hardware, setHardware, getHardware } = useHardwareState()
  const [engineState, setEngineState] = useState<EngineState>(INITIAL_ENGINE_STATE)
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set())
  const [sustain, setSustainState] = useState(false)
  const [audioStatus, setAudioStatus] = useState('ready · model library / fallback available')
  const [midiStatus, setMidiStatus] = useState('not connected')
  const engineRef = useRef<PianoAudioEngine | null>(null)
  const engineStateRef = useRef(engineState)
  engineStateRef.current = engineState
  const activeSources = useRef(new Map<string, number>())
  const heldComputerKeys = useRef(new Set<string>())
  const midiAccessRef = useRef<MIDIAccess | null>(null)

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new PianoAudioEngine(engineStateRef.current, (message) => setAudioStatus(message))
    return engineRef.current
  }, [])

  const updateEngineState = useCallback(<K extends keyof EngineState>(key: K, value: EngineState[K]) => {
    setEngineState((previous) => ({ ...previous, [key]: value }))
  }, [])

  useEffect(() => { engineRef.current?.setState(engineState) }, [engineState])

  const pressNote = useCallback((note: number, source: string, velocity: number) => {
    if (activeSources.current.has(source)) return
    activeSources.current.set(source, note)
    setPressedKeys((previous) => new Set(previous).add(note))
    getEngine().noteOn(note, velocity)
  }, [getEngine])

  const releaseNote = useCallback((note: number, source: string) => {
    if (!activeSources.current.has(source)) return
    activeSources.current.delete(source)
    setPressedKeys((previous) => {
      const next = new Set(previous)
      if (![...activeSources.current.values()].includes(note)) next.delete(note)
      return next
    })
    getEngine().noteOff(note)
  }, [getEngine])

  const setSustain = useCallback((pressed: boolean) => {
    setSustainState(pressed)
    getEngine().setSustain(pressed)
  }, [getEngine])

  const stopEverything = useCallback(() => {
    activeSources.current.clear()
    heldComputerKeys.current.clear()
    setPressedKeys(new Set())
    engineRef.current?.allNotesOff()
    setSustainState(false)
    engineRef.current?.setSustain(false)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') { event.preventDefault(); setSustain(true); return }
      const note = COMPUTER_KEYS[event.key.toLowerCase()]
      if (note === undefined || event.repeat || heldComputerKeys.current.has(event.key.toLowerCase())) return
      heldComputerKeys.current.add(event.key.toLowerCase())
      pressNote(note, `computer-${event.key.toLowerCase()}`, 92)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') { event.preventDefault(); setSustain(false); return }
      const key = event.key.toLowerCase()
      const note = COMPUTER_KEYS[key]
      if (note === undefined) return
      heldComputerKeys.current.delete(key)
      releaseNote(note, `computer-${key}`)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stopEverything)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', stopEverything); stopEverything(); engineRef.current?.dispose() }
  }, [pressNote, releaseNote, setSustain, stopEverything])

  const handleMidiMessage = useCallback((event: MIDIMessageEvent) => {
    const [status, data1, data2] = event.data ?? []
    const command = status & 0xf0
    if (command === 0x90 && data2 > 0) pressNote(data1, `midi-${data1}`, data2)
    if (command === 0x80 || (command === 0x90 && data2 === 0)) releaseNote(data1, `midi-${data1}`)
    if (command === 0xb0 && data1 === 64) setSustain(data2 >= 64)
  }, [pressNote, releaseNote, setSustain])

  const connectMidi = async () => {
    if (!navigator.requestMIDIAccess) { setMidiStatus('unavailable · no Web MIDI API'); return }
    try {
      const access = await navigator.requestMIDIAccess()
      midiAccessRef.current = access
      const connectInputs = () => {
        let count = 0
        access.inputs.forEach((input) => { input.onmidimessage = handleMidiMessage; count += 1 })
        setMidiStatus(count ? `${count} input${count === 1 ? '' : 's'} connected` : 'ready · no inputs')
      }
      access.onstatechange = () => { connectInputs(); if (access.inputs.size === 0) { stopEverything(); setMidiStatus('disconnected · notes cleared') } }
      connectInputs()
    } catch { setMidiStatus('denied · MIDI permission unavailable') }
  }

  useEffect(() => () => { if (midiAccessRef.current) midiAccessRef.current.onstatechange = null }, [])

  return <main className="stagebench-app">
    <div className="instrument-shell" data-variant="stage-4-73" data-key-count="73">
      <div className="top-rail"><span>NORD</span><span>STAGE 4</span><span className="rail-status"><i />{audioStatus}</span><button type="button" className="midi-status" onClick={connectMidi} aria-label={`Enable MIDI, ${midiStatus}`}>MIDI · {midiStatus}</button></div>
      <div className="control-deck" style={{ '--deck-columns': '0.14fr 0.20fr 0.085fr 0.125fr 0.25fr 0.20fr' } as CSSProperties}>
        <PerformanceSection getHardware={getHardware} setHardware={setHardware} sustain={sustain} setSustain={setSustain} masterLevel={engineState.masterLevel} setMasterLevel={(value) => updateEngineState('masterLevel', value)} />
        <OrganSection getHardware={getHardware} setHardware={setHardware} />
        <PianoSection state={engineState} update={updateEngineState} />
        <ProgramSection getHardware={getHardware} setHardware={setHardware} />
        <SynthSection getHardware={getHardware} setHardware={setHardware} />
        <EffectsSection state={engineState} update={updateEngineState} />
      </div>
      <Keybed onNoteOn={pressNote} onNoteOff={releaseNote} pressedKeys={pressedKeys} />
      <div className="bottom-rail"><span>STAGE 4 73</span><span>HA · E—E</span><span>{Object.keys(hardware).length} PRESENTATION CONTROLS</span><span>PHASE 2 / PIANOS + FX</span></div>
    </div>
    <p className="product-caption">NORD STAGE 4 · STAGEBENCH PHASE 2 · PIANO LIBRARY / LAYER EFFECTS / FALLBACK READY</p>
  </main>
}

export default App
