import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  computerKeyMap,
  createControlState,
  decorativeControls,
  getMidiNote,
  isBlackKey,
  keyboard,
  sections,
  whiteKeyCount,
  type Control,
  type ControlState,
  type KeyModel,
} from './hardware'
import {
  ampEqTypes,
  createPianoEngine,
  mod1Types,
  mod2Types,
  pianoTypes,
  reverbTypes,
  type DynComp,
  type EffectUnit,
  type EffectsState,
  type KbTouch,
  type LayerId,
  type PianoEngine,
  type PianoPerformanceState,
  type PianoStatus,
  type PianoType,
  type Timbre,
  type Unison,
} from './pianoEngine'
import { applyStage3Control, createStage3State, panic, renderOrganProbe, renderSynthProbe, type Stage3State } from './stage3System'
import './styles.css'

type PointerMap = Map<number, string>

const pressedClass = (active: boolean) => (active ? ' is-active' : '')

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function nextControlValue(control: Control, current: number) {
  if (control.kind === 'button') return current > 0 ? 0 : 1
  if (control.kind === 'knob' || control.kind === 'wheel') return current >= 0.95 ? 0 : clamp(current + 0.12)
  if (control.kind === 'encoder') return (current + 0.14) % 1
  return current >= 0.95 ? 0 : clamp(current + 0.14)
}

function controlValueText(control: Control, value: number) {
  if (control.kind === 'button') return value > 0 ? 'on' : 'off'
  return `${Math.round(value * 100)} percent`
}

const kbTouchValues: KbTouch[] = ['Heavy', 'Medium', 'Light']
const dynCompValues: DynComp[] = ['Off', '1', '2', '3']
const unisonValues: Unison[] = ['Off', '1', '2', '3']
const acousticTimbres: Timbre[] = ['Off', 'Soft', 'Mid', 'Bright']
const electricTimbres: Timbre[] = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2']

const functionalControlIds = new Set([
  'performance.master-level',
  'performance.mod-wheel',
  'performance.organ-level',
  'performance.octave-down',
  'performance.octave-up',
  'performance.transpose',
  ...decorativeControls.filter((control) => control.section === 'organ' || control.section === 'program' || control.section === 'synth').map((control) => control.id),
  'piano.section-on',
  'piano.layer-a',
  'piano.layer-b',
  'piano.layer-a-focus',
  'piano.layer-b-focus',
  'piano.layer-a-level',
  'piano.layer-b-level',
  'piano.layer-a-octave-down',
  'piano.layer-a-octave-up',
  'piano.layer-b-octave-down',
  'piano.layer-b-octave-up',
  'piano.sustped-a',
  'piano.sustped-b',
  'piano.pstick-a',
  'piano.pstick-b',
  'piano.grand',
  'piano.upright',
  'piano.electric',
  'piano.clav',
  'piano.digital',
  'piano.misc',
  'piano.model-select',
  'piano.kb-touch',
  'piano.dyn-comp',
  'piano.timbre',
  'piano.unison',
  'piano.soft-release',
  'piano.string-res',
  'effects.focus-piano',
  'effects.focus-organ',
  'effects.focus-synth',
  'effects.all-on',
  'effects.piano-group',
  'effects.mod1-rate',
  'effects.mod1-amount',
  'effects.mod1-on',
  'effects.mod1-type',
  'effects.mod2-rate',
  'effects.mod2-amount',
  'effects.mod2-on',
  'effects.mod2-type',
  'effects.delay-time',
  'effects.delay-feedback',
  'effects.delay-mix',
  'effects.delay-on',
  'effects.delay-global',
  'effects.delay-filter',
  'effects.amp-drive',
  'effects.amp-on',
  'effects.amp-type',
  'effects.eq-bass',
  'effects.eq-mid',
  'effects.eq-treble',
  'effects.compressor',
  'effects.compressor-on',
  'effects.compressor-global',
  'effects.reverb-amount',
  'effects.reverb-on',
  'effects.reverb-type',
  'effects.reverb-global',
  'effects.rotary',
  'effects.rotary-fast',
  'effects.rotary-drive',
])
functionalControlIds.delete('program.morph-aftertouch')
functionalControlIds.delete('effects.delay-tempo')

function nextFromList<T>(values: T[], current: T) {
  return values[(values.indexOf(current) + 1) % values.length]
}

function layerFromControl(id: string): LayerId {
  return id.includes('layer-b') || id.includes('sustped-b') || id.includes('pstick-b') ? 'B' : 'A'
}

function pianoTypeFromControl(id: string): PianoType | null {
  const type = pianoTypes.find((entry) => id === `piano.${entry.toLowerCase()}`)
  return type ?? null
}

function rms(samples: Float32Array) {
  return Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / Math.max(samples.length, 1))
}

function updateChain(effects: EffectsState, unit: EffectUnit, patch: Record<string, unknown>) {
  const apply = (layer: LayerId) => ({
    ...effects.chains[layer],
    [unit]: { ...effects.chains[layer][unit], ...patch },
  })
  if (effects.pianoGroup) return { ...effects, chains: { A: apply('A'), B: apply('A') } }
  return { ...effects, chains: { ...effects.chains, [effects.focusedLayer]: apply(effects.focusedLayer) } }
}

function ControlView({
  control,
  value,
  onChange,
  functional,
}: {
  control: Control
  value: number
  onChange: (id: string, value: number) => void
  functional: boolean
}) {
  const style = { '--value': String(value) } as React.CSSProperties

  const activate = useCallback(() => {
    onChange(control.id, nextControlValue(control, value))
  }, [control, onChange, value])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      onChange(control.id, clamp(value + 0.08))
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      onChange(control.id, clamp(value - 0.08))
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onChange(control.id, 0)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onChange(control.id, 1)
    }
  }

  return (
    <button
      type="button"
      className={`control control-${control.kind}${pressedClass(value > 0.5)}`}
      style={style}
      data-control-id={control.id}
      data-section={control.section}
      aria-label={`${control.label} ${functional ? 'control' : 'decorative control'}`}
      aria-pressed={control.kind === 'button' ? value > 0 : undefined}
      aria-valuenow={control.kind === 'button' ? undefined : Math.round(value * 100)}
      aria-valuemin={control.kind === 'button' ? undefined : 0}
      aria-valuemax={control.kind === 'button' ? undefined : 100}
      aria-valuetext={controlValueText(control, value)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        activate()
      }}
      onKeyDown={onKeyDown}
    >
      <span className="control-face" aria-hidden="true">
        {control.kind === 'fader' || control.kind === 'drawbar' ? <span className="cap" /> : null}
      </span>
      <span className="control-label">{control.label}</span>
    </button>
  )
}

function LedLadder({ count = 8, value = 0.65 }: { count?: number; value?: number }) {
  return (
    <span className="led-ladder" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={index / count < value ? 'on' : ''} />
      ))}
    </span>
  )
}

function SectionView({
  section,
  controls,
  state,
  onChange,
  stage3,
}: {
  section: (typeof sections)[number]
  controls: Control[]
  state: ControlState
  onChange: (id: string, value: number) => void
  stage3: Stage3State
}) {
  const drawbars = controls.filter((control) => control.kind === 'drawbar')
  const otherControls = controls.filter((control) => control.kind !== 'drawbar')
  return (
    <section
      className={`section section-${section.id}`}
      style={{ '--section-width': `${section.fraction * 100}%` } as React.CSSProperties}
      aria-label={section.label}
      data-section-id={section.id}
    >
      <div className="section-title">{section.label}</div>
      {section.id === 'performance' ? (
        <div className="brand-block" aria-hidden="true">
          <strong>nord stage 4</strong>
          <span>hammer action 73</span>
        </div>
      ) : null}
      {section.hasOled ? (
        <div className="oled" aria-label={`${section.label} primary OLED`}>
          {section.id === 'program' ? (
            <>
              <span>{stage3.liveMode ? `LIVE ${stage3.liveSlot + 1}` : `${stage3.currentPage + 1}.${(stage3.currentSlot % 8) + 1}`}</span>
              <strong>{stage3.editName}{stage3.dirty ? ' E' : ''}</strong>
              <span>
                Scene {stage3.working.activeScene} / {stage3.working.split.enabled ? `Split ${stage3.working.split.points.join('-')}` : 'Split Off'} /{' '}
                {stage3.working.clock.bpm} BPM
              </span>
            </>
          ) : (
            <>
              <span>
                {stage3.working.synth.layers.A.category} / {stage3.working.synth.layers.A.filter.type}
              </span>
              <strong>{stage3.working.synth.layers.A.waveform}</strong>
              <span>
                LFO {stage3.working.synth.layers.A.lfo.waveform} / Arp {stage3.working.synth.layers.A.arp.run ? 'Run' : 'Stop'}
              </span>
            </>
          )}
        </div>
      ) : null}
      {drawbars.length > 0 ? (
        <div className="drawbar-bank" aria-label="Nine functional organ drawbars">
          {drawbars.map((control, index) => (
            <div className="drawbar-slot" key={control.id}>
              <LedLadder value={(9 - index) / 10} />
              <ControlView
                control={control}
                value={state[control.id] ?? 0}
                onChange={onChange}
                functional={functionalControlIds.has(control.id)}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className={`control-grid grid-${section.id}`}>
        {otherControls.map((control) => (
          <ControlView
            key={control.id}
            control={control}
            value={state[control.id] ?? 0}
            onChange={onChange}
            functional={functionalControlIds.has(control.id)}
          />
        ))}
      </div>
    </section>
  )
}

function KeyView({
  keyModel,
  active,
  onNoteStart,
  onNoteEnd,
  registerPointer,
}: {
  keyModel: KeyModel
  active: boolean
  onNoteStart: (keyId: string, velocity: number) => void
  onNoteEnd: (keyId: string) => void
  registerPointer: (pointerId: number, keyId: string | null) => void
}) {
  const whiteIndex = keyModel.whiteIndex ?? 0
  const style = keyModel.black
    ? ({ '--white-index': String(whiteIndex), '--black-left': `${(whiteIndex / whiteKeyCount) * 100}%` } as React.CSSProperties)
    : ({ '--white-index': String(whiteIndex) } as React.CSSProperties)

  return (
    <button
      type="button"
      className={`piano-key ${keyModel.black ? 'black' : 'white'}${pressedClass(active)}`}
      style={style}
      data-key-id={keyModel.id}
      data-midi={keyModel.midi}
      aria-label={`${keyModel.note} piano key`}
      aria-pressed={active}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        registerPointer(event.pointerId, keyModel.id)
        const rect = event.currentTarget.getBoundingClientRect()
        const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
        onNoteStart(keyModel.id, clamp(0.45 + y * 0.5, 0.2, 1))
      }}
      onPointerUp={(event) => {
        event.preventDefault()
        registerPointer(event.pointerId, null)
        onNoteEnd(keyModel.id)
      }}
      onPointerCancel={(event) => {
        registerPointer(event.pointerId, null)
        onNoteEnd(keyModel.id)
      }}
      onLostPointerCapture={(event) => {
        registerPointer(event.pointerId, null)
        onNoteEnd(keyModel.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onNoteStart(keyModel.id, 0.8)
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onNoteEnd(keyModel.id)
        }
      }}
    />
  )
}

export default function App() {
  const engineRef = useRef<PianoEngine | null>(null)
  const pointers = useRef<PointerMap>(new Map())
  const heldComputerKeys = useRef<Map<string, string>>(new Map())
  const [controlState, setControlState] = useState<ControlState>(() => createControlState())
  const [stage3, setStage3] = useState<Stage3State>(() => createStage3State())
  const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set())
  const [status, setStatus] = useState<PianoStatus>({ state: 'loading', message: 'Preparing complete Stage 4 system' })
  const [midiStatus, setMidiStatus] = useState('MIDI not requested')
  const [focusedLayer, setFocusedLayer] = useState<LayerId>('A')
  const [performanceState, setPerformanceState] = useState<PianoPerformanceState>({
    kbTouch: 'Medium',
    dynComp: 'Off',
    timbre: 'Off',
    unison: 'Off',
    softRelease: false,
    stringRes: false,
    masterLevel: 0.72,
  })
  const controlBySection = useMemo(
    () =>
      sections.map((section) => ({
        section,
        controls: decorativeControls.filter((control) => control.section === section.id),
      })),
    [],
  )

  useEffect(() => {
    const engine = createPianoEngine({
      onStatus: setStatus,
      maxVoices: 18,
    })
    engineRef.current = engine
    engine.prepare()
    return () => {
      engine.allNotesOff()
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  const setKeyActive = useCallback((keyId: string, active: boolean) => {
    setActiveKeys((current) => {
      const next = new Set(current)
      if (active) next.add(keyId)
      else next.delete(keyId)
      return next
    })
  }, [])

  const startKey = useCallback(
    (keyId: string, velocity = 0.76) => {
      const key = keyboard.find((entry) => entry.id === keyId)
      if (!key) return
      setKeyActive(keyId, true)
      engineRef.current?.noteOn(key.midi + stage3.working.transpose, velocity, keyId)
    },
    [setKeyActive, stage3.working.transpose],
  )

  const endKey = useCallback(
    (keyId: string) => {
      const key = keyboard.find((entry) => entry.id === keyId)
      if (!key) return
      setKeyActive(keyId, false)
      engineRef.current?.noteOff(key.midi + stage3.working.transpose, keyId)
    },
    [setKeyActive, stage3.working.transpose],
  )

  const cleanupAll = useCallback(() => {
    pointers.current.clear()
    heldComputerKeys.current.clear()
    setActiveKeys(new Set())
    engineRef.current?.allNotesOff()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.key === 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return
      const mapped = computerKeyMap[event.key.toLowerCase()]
      if (!mapped) return
      event.preventDefault()
      if (mapped === 'sustain') {
        engineRef.current?.setSustain(true)
        setStatus((current) => ({ ...current, message: 'Stage 4 system ready - sustain held from keyboard' }))
        return
      }
      if (heldComputerKeys.current.has(event.key)) return
      heldComputerKeys.current.set(event.key, mapped)
      startKey(mapped, 0.82)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const mapped = computerKeyMap[event.key.toLowerCase()]
      if (!mapped) return
      event.preventDefault()
      if (mapped === 'sustain') {
        engineRef.current?.setSustain(false)
        setStatus((current) => ({ ...current, message: 'Stage 4 system ready - generated engines declared' }))
        return
      }
      const keyId = heldComputerKeys.current.get(event.key)
      if (!keyId) return
      heldComputerKeys.current.delete(event.key)
      endKey(keyId)
    }
    const onBlur = () => cleanupAll()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [cleanupAll, endKey, startKey])

  useEffect(() => {
    let access: MIDIAccess | null = null
    const onMidiMessage = (event: MIDIMessageEvent) => {
      const [statusByte = 0, note = 0, value = 0] = Array.from(event.data ?? [])
      const command = statusByte & 0xf0
      if (command === 0x90 && value > 0) {
        const key = keyboard.find((entry) => entry.midi === note)
        if (key) {
          setKeyActive(key.id, true)
          engineRef.current?.noteOn(note, value / 127, `midi-${note}`)
        }
      } else if (command === 0x80 || (command === 0x90 && value === 0)) {
        const key = keyboard.find((entry) => entry.midi === note)
        if (key) setKeyActive(key.id, false)
        engineRef.current?.noteOff(note, `midi-${note}`)
      } else if (command === 0xb0 && note === 64) {
        engineRef.current?.setSustain(value >= 64)
      }
    }
    const attachInputs = () => {
      if (!access) return
      const inputs = Array.from(access.inputs.values())
      for (const input of inputs) input.onmidimessage = onMidiMessage
      setMidiStatus(inputs.length > 0 ? `${inputs.length} MIDI input${inputs.length === 1 ? '' : 's'} connected` : 'MIDI ready - no inputs connected')
    }
    if (!('requestMIDIAccess' in navigator)) {
      setMidiStatus('Web MIDI unavailable in this browser')
      return
    }
    navigator
      .requestMIDIAccess({ sysex: false })
      .then((midiAccess) => {
        access = midiAccess
        access.onstatechange = () => {
          cleanupAll()
          attachInputs()
        }
        attachInputs()
      })
      .catch(() => setMidiStatus('MIDI permission denied or unavailable'))
    return () => {
      if (access) {
        for (const input of access.inputs.values()) input.onmidimessage = null
        access.onstatechange = null
      }
      cleanupAll()
    }
  }, [cleanupAll, setKeyActive])

  const changeControl = useCallback(
    (id: string, value: number) => {
      const nextValue = clamp(value)
      if (id === 'performance.transpose' && nextValue > 0.5 && controlState['performance.transpose'] > 0.5) {
        cleanupAll()
        setStage3((current) => panic(current))
        setStatus((current) => ({ ...current, message: 'Panic: all notes off, held inputs cleared, transpose reset' }))
        return
      }
      if (functionalControlIds.has(id)) {
        setStage3((current) => applyStage3Control(current, id, nextValue))
      }
      setControlState((current) => {
        const next = { ...current, [id]: nextValue }
        const type = pianoTypeFromControl(id)
        if (type) {
          for (const pianoType of pianoTypes) next[`piano.${pianoType.toLowerCase()}`] = pianoType === type ? 1 : 0
        }
        if (id === 'piano.layer-a-focus' || id === 'piano.layer-b-focus') {
          next['piano.layer-a-focus'] = id === 'piano.layer-a-focus' ? 1 : 0
          next['piano.layer-b-focus'] = id === 'piano.layer-b-focus' ? 1 : 0
        }
        return next
      })

      if (!functionalControlIds.has(id)) return

      const engine = engineRef.current
      const type = pianoTypeFromControl(id)
      if (type) {
        engine?.updateLayer(focusedLayer, { type })
        setStatus((current) => ({ ...current, message: `${type} selected for Piano ${focusedLayer}` }))
        return
      }

      if (id === 'performance.master-level') {
        engine?.updatePerformance({ masterLevel: nextValue })
        setPerformanceState((current) => ({ ...current, masterLevel: nextValue }))
        return
      }

      if (id === 'effects.focus-organ' || id === 'effects.focus-synth') {
        setStatus((current) => ({ ...current, message: `${id === 'effects.focus-organ' ? 'Organ' : 'Synth'} routed through the shared Stage 4 effects graph` }))
        return
      }

      if (id === 'piano.layer-a' || id === 'piano.layer-b') {
        engine?.updateLayer(layerFromControl(id), { enabled: nextValue > 0.5 })
        return
      }
      if (id === 'piano.layer-a-focus' || id === 'piano.layer-b-focus') {
        const layer = layerFromControl(id)
        setFocusedLayer(layer)
        engine?.updateLayer(layer, { focused: true })
        return
      }
      if (id.includes('octave-down') || id.includes('octave-up')) {
        const layer = layerFromControl(id)
        engine?.updateLayer(layer, { octave: id.includes('octave-up') ? 12 : -12 })
        return
      }
      if (id.includes('sustped')) {
        engine?.updateLayer(layerFromControl(id), { sustainPedal: nextValue > 0.5 })
        return
      }
      if (id.includes('pstick')) {
        engine?.updateLayer(layerFromControl(id), { pitchStick: nextValue > 0.5 })
        return
      }
      if (id === 'piano.layer-a-level' || id === 'piano.layer-b-level') {
        engine?.updateLayer(layerFromControl(id), { level: nextValue })
        return
      }
      if (id === 'piano.kb-touch') {
        const nextTouch = nextFromList(kbTouchValues, performanceState.kbTouch)
        engine?.updatePerformance({ kbTouch: nextTouch })
        setPerformanceState((current) => ({ ...current, kbTouch: nextTouch }))
        return
      }
      if (id === 'piano.dyn-comp') {
        const nextDyn = nextFromList(dynCompValues, performanceState.dynComp)
        engine?.updatePerformance({ dynComp: nextDyn })
        setPerformanceState((current) => ({ ...current, dynComp: nextDyn }))
        return
      }
      if (id === 'piano.timbre') {
        const timbres = controlState['piano.electric'] > 0.5 ? electricTimbres : acousticTimbres
        const nextTimbre = nextFromList(timbres, performanceState.timbre)
        engine?.updatePerformance({ timbre: nextTimbre })
        setPerformanceState((current) => ({ ...current, timbre: nextTimbre }))
        return
      }
      if (id === 'piano.unison') {
        const nextUnison = nextFromList(unisonValues, performanceState.unison)
        engine?.updatePerformance({ unison: nextUnison })
        setPerformanceState((current) => ({ ...current, unison: nextUnison }))
        return
      }
      if (id === 'piano.soft-release') {
        const softRelease = nextValue > 0.5
        engine?.updatePerformance({ softRelease })
        setPerformanceState((current) => ({ ...current, softRelease }))
        return
      }
      if (id === 'piano.string-res') {
        const stringRes = nextValue > 0.5
        engine?.updatePerformance({ stringRes })
        setPerformanceState((current) => ({ ...current, stringRes }))
        return
      }

      engine?.updateEffects((current) => {
        if (id === 'effects.all-on') return { ...current, allBypass: nextValue <= 0.5 }
        if (id === 'effects.piano-group') return { ...current, pianoGroup: nextValue > 0.5 }
        if (id === 'effects.rotary') return { ...current, rotaryOn: nextValue > 0.5 }
        if (id === 'effects.rotary-fast') return { ...current, rotaryFast: nextValue > 0.5 }
        if (id === 'effects.rotary-drive') return { ...current, rotaryDrive: nextValue }
        if (id === 'effects.mod1-on') return updateChain(current, 'mod1', { on: nextValue > 0.5 })
        if (id === 'effects.mod1-type') return updateChain(current, 'mod1', { typeIndex: (current.chains[current.focusedLayer].mod1.typeIndex + 1) % mod1Types.length })
        if (id === 'effects.mod1-rate') return updateChain(current, 'mod1', { rate: nextValue })
        if (id === 'effects.mod1-amount') return updateChain(current, 'mod1', { amount: nextValue, mix: nextValue })
        if (id === 'effects.mod2-on') return updateChain(current, 'mod2', { on: nextValue > 0.5 })
        if (id === 'effects.mod2-type') return updateChain(current, 'mod2', { typeIndex: (current.chains[current.focusedLayer].mod2.typeIndex + 1) % mod2Types.length })
        if (id === 'effects.mod2-rate') return updateChain(current, 'mod2', { rate: nextValue })
        if (id === 'effects.mod2-amount') return updateChain(current, 'mod2', { amount: nextValue, mix: nextValue })
        if (id === 'effects.delay-on') return updateChain(current, 'delay', { on: nextValue > 0.5 })
        if (id === 'effects.delay-time') return updateChain(current, 'delay', { rate: nextValue })
        if (id === 'effects.delay-feedback') return updateChain(current, 'delay', { feedback: nextValue })
        if (id === 'effects.delay-mix') return updateChain(current, 'delay', { mix: nextValue })
        if (id === 'effects.delay-global') return updateChain(current, 'delay', { global: nextValue > 0.5 })
        if (id === 'effects.delay-filter') {
          const filters = ['Off', 'LP', 'HP', 'BP'] as const
          const currentFilter = current.chains[current.focusedLayer].delay.filter
          return updateChain(current, 'delay', { filter: filters[(filters.indexOf(currentFilter) + 1) % filters.length] })
        }
        if (id === 'effects.amp-on') return updateChain(current, 'ampEq', { on: nextValue > 0.5 })
        if (id === 'effects.amp-type') return updateChain(current, 'ampEq', { typeIndex: (current.chains[current.focusedLayer].ampEq.typeIndex + 1) % ampEqTypes.length })
        if (id === 'effects.amp-drive') return updateChain(current, 'ampEq', { drive: nextValue })
        if (id === 'effects.eq-bass') return updateChain(current, 'ampEq', { bass: nextValue })
        if (id === 'effects.eq-mid') return updateChain(current, 'ampEq', { mid: nextValue })
        if (id === 'effects.eq-treble') return updateChain(current, 'ampEq', { treble: nextValue })
        if (id === 'effects.compressor-on') return updateChain(current, 'compressor', { on: nextValue > 0.5 })
        if (id === 'effects.compressor') return updateChain(current, 'compressor', { amount: nextValue })
        if (id === 'effects.compressor-global') return updateChain(current, 'compressor', { global: nextValue > 0.5 })
        if (id === 'effects.reverb-on') return updateChain(current, 'reverb', { on: nextValue > 0.5 })
        if (id === 'effects.reverb-type') return updateChain(current, 'reverb', { typeIndex: (current.chains[current.focusedLayer].reverb.typeIndex + 1) % reverbTypes.length })
        if (id === 'effects.reverb-amount') return updateChain(current, 'reverb', { mix: nextValue, amount: nextValue })
        if (id === 'effects.reverb-global') return updateChain(current, 'reverb', { global: nextValue > 0.5 })
        return current
      })
    },
    [cleanupAll, controlState, focusedLayer, performanceState],
  )

  const registerPointer = useCallback(
    (pointerId: number, keyId: string | null) => {
      const previous = pointers.current.get(pointerId)
      if (previous && previous !== keyId) endKey(previous)
      if (keyId) pointers.current.set(pointerId, keyId)
      else pointers.current.delete(pointerId)
    },
    [endKey],
  )

  return (
    <main className="stage-page">
      <div className="instrument-shell" aria-label="Nord Stage 4 73 Phase 3 complete system recreation">
        <div className="top-rail" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="control-deck">
          {controlBySection.map(({ section, controls }) => (
              <SectionView key={section.id} section={section} controls={controls} state={controlState} onChange={changeControl} stage3={stage3} />
          ))}
        </div>
        <div className="keybed" aria-label="73 key E to E hammer action keybed">
          <div className="white-key-row">
            {keyboard
              .filter((key) => !key.black)
              .map((key) => (
                <KeyView
                  key={key.id}
                  keyModel={key}
                  active={activeKeys.has(key.id)}
                  onNoteStart={startKey}
                  onNoteEnd={endKey}
                  registerPointer={registerPointer}
                />
              ))}
          </div>
          <div className="black-key-row" aria-hidden="false">
            {keyboard
              .filter((key) => key.black)
              .map((key) => (
                <KeyView
                  key={key.id}
                  keyModel={key}
                  active={activeKeys.has(key.id)}
                  onNoteStart={startKey}
                  onNoteEnd={endKey}
                  registerPointer={registerPointer}
                />
              ))}
          </div>
        </div>
        <div className="bottom-rail" aria-hidden="true" />
      </div>
      <aside className="status-strip" aria-live="polite">
        <span data-testid="piano-status">{status.message}</span>
        <span>{status.state === 'ready' ? `Audio: piano + organ ${rms(renderOrganProbe(stage3.working)).toFixed(3)} + synth ${rms(renderSynthProbe(stage3.working)).toFixed(3)}` : `Audio: ${status.state}`}</span>
        <span>
          Piano {focusedLayer} / Program {stage3.liveMode ? `Live ${stage3.liveSlot + 1}` : `${stage3.currentPage + 1}.${(stage3.currentSlot % 8) + 1}`} / Transpose{' '}
          {stage3.working.transpose}
        </span>
        <span>{midiStatus}</span>
        <span>{stage3.unsupported[0]}</span>
      </aside>
      <dl className="sr-only">
        <dt>Variant</dt>
        <dd>Nord Stage 4 73, hammer action, E to E, 73 total keys, 43 white keys, 30 black keys.</dd>
        <dt>Decorative contract</dt>
        <dd>
          Piano, Organ, Synth, Layer Effects, Programs, Live slots, splits, scenes, morphs, master clock, transpose, and Panic are functional in Phase 3.
          Unsupported spec-excluded controls: {stage3.unsupported.join(' ')}
        </dd>
        <dt>Rendered probe RMS</dt>
        <dd>{rms(engineRef.current?.renderProbe() ?? new Float32Array()).toFixed(4)}</dd>
        <dt>Black key pattern</dt>
        <dd>{keyboard.filter(isBlackKey).map((key) => key.note).join(', ')}</dd>
        <dt>Middle C MIDI note</dt>
        <dd>{getMidiNote('C4')}</dd>
      </dl>
    </main>
  )
}
