import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

type HardwareValue = number | boolean | string
type HardwareState = Record<string, HardwareValue>

const WHITE_NAMES = ['E', 'F', 'G', 'A', 'B', 'C', 'D'] as const
const BLACK_AFTER = new Set(['F', 'G', 'A', 'C', 'D'])
const COMPUTER_KEYS: Record<string, number> = {
  z: 52, s: 53, x: 54, d: 55, c: 56, v: 57, g: 58, b: 59, h: 60, n: 61, j: 62, m: 63,
  ',': 64, l: 65, '.': 66, ';': 67, '/': 68,
  q: 64, '2': 65, w: 66, '3': 67, e: 68, r: 69, '5': 70, t: 71, '6': 72, y: 73, '7': 74, u: 75,
}
const MAX_VOICES = 24

type Voice = {
  id: number
  note: number
  oscillators: OscillatorNode[]
  gain: GainNode
  released: boolean
  sustained: boolean
  startedAt: number
}

type AudioStatus = 'ready' | 'error'

class BasicPianoEngine {
  private context: AudioContext | null = null
  private voices: Voice[] = []
  private nextId = 1
  private sustain = false
  private readonly onStatus: (status: AudioStatus, message: string) => void

  constructor(onStatus: (status: AudioStatus, message: string) => void) {
    this.onStatus = onStatus
  }

  private getContext() {
    if (this.context) return this.context
    const windowWithWebkit = window as Window & { webkitAudioContext?: typeof AudioContext }
    const AudioContextConstructor = window.AudioContext ?? windowWithWebkit.webkitAudioContext
    if (!AudioContextConstructor) throw new Error('Web Audio is not available; keyboard remains available without output.')
    this.context = new AudioContextConstructor()
    return this.context
  }

  noteOn(note: number, velocity: number) {
    try {
      const context = this.getContext()
      void context.resume()
      while (this.voices.length >= MAX_VOICES) this.releaseVoice(this.voices[0], 0.018)
      const now = context.currentTime
      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.015, velocity / 127 * 0.18), now + 0.012)
      gain.connect(context.destination)
      const oscillators = [
        { type: 'triangle' as OscillatorType, ratio: 1, level: 1 },
        { type: 'sine' as OscillatorType, ratio: 2.01, level: 0.24 },
        { type: 'sine' as OscillatorType, ratio: 3.99, level: 0.08 },
      ].map(({ type, ratio, level }) => {
        const oscillator = context.createOscillator()
        const partialGain = context.createGain()
        oscillator.type = type
        oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12) * ratio
        partialGain.gain.value = level
        oscillator.connect(partialGain).connect(gain)
        oscillator.start(now)
        return oscillator
      })
      this.voices.push({ id: this.nextId++, note, oscillators, gain, released: false, sustained: false, startedAt: now })
      this.onStatus('ready', 'ready · generated piano')
    } catch (error) {
      this.onStatus('error', error instanceof Error ? error.message : 'Audio unavailable; keyboard input remains active.')
    }
  }

  noteOff(note: number) {
    const voice = [...this.voices].reverse().find((candidate) => candidate.note === note && !candidate.released)
    if (!voice) return
    if (this.sustain) voice.sustained = true
    else this.releaseVoice(voice, 0.35)
  }

  setSustain(pressed: boolean) {
    this.sustain = pressed
    if (!pressed) this.voices.filter((voice) => voice.sustained && !voice.released).forEach((voice) => this.releaseVoice(voice, 0.35))
  }

  allNotesOff() {
    this.sustain = false
    this.voices.slice().forEach((voice) => this.releaseVoice(voice, 0.025))
  }

  dispose() {
    this.allNotesOff()
    const context = this.context
    this.context = null
    if (context) void context.close()
  }

  private releaseVoice(voice: Voice | undefined, duration: number) {
    if (!voice || voice.released) return
    voice.released = true
    const context = this.context
    if (!context) return
    const now = context.currentTime
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now)
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + duration + 0.02))
    window.setTimeout(() => {
      voice.oscillators.forEach((oscillator) => oscillator.disconnect())
      voice.gain.disconnect()
      this.voices = this.voices.filter((candidate) => candidate.id !== voice.id)
    }, (duration + 0.04) * 1000)
  }
}

function useHardwareState() {
  const [hardware, setHardwareState] = useState<HardwareState>({})
  const setHardware = useCallback((id: string, value: HardwareValue) => {
    setHardwareState((previous) => ({ ...previous, [id]: value }))
  }, [])
  const getHardware = useCallback((id: string, fallback: HardwareValue) => hardware[id] ?? fallback, [hardware])
  return { hardware, setHardware, getHardware }
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

function PerformanceSection({ getHardware, setHardware, sustain, setSustain }: { getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void; sustain: boolean; setSustain: (value: boolean) => void }) {
  return <section className="instrument-section performance" aria-labelledby="section-performance">
    <SectionHeader eyebrow="NORD" title="STAGE 4" id="section-performance" />
    <div className="performance-brand">73 <span>HAMMER ACTION</span></div>
    <div className="performance-top"><DecorativeKnob id="performance-master-level" label="MASTER LEVEL" getHardware={getHardware} setHardware={setHardware} value={0.72} /><div className="master-led"><DotLeds count={8} active={6} /><span>LEVEL</span></div></div>
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

function PianoSection({ getHardware, setHardware }: { getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void }) {
  const layers = ['A', 'B']
  return <section className="instrument-section dark-panel piano" aria-labelledby="section-piano">
    <SectionHeader eyebrow="PIANO" title="PIANO" id="section-piano" on={Boolean(getHardware('piano-section-on', true))} />
    <div className="piano-layers">{layers.map((layer, index) => <div className="piano-layer" key={layer}><Toggle id={`piano-layer-${layer.toLowerCase()}-on`} label={`LAYER ${layer}`} pressed={Boolean(getHardware(`piano-layer-${layer.toLowerCase()}-on`, index === 0))} onChange={(value) => setHardware(`piano-layer-${layer.toLowerCase()}-on`, value)} /><Fader id={`piano-layer-${layer.toLowerCase()}-level`} label="LEVEL" value={Number(getHardware(`piano-layer-${layer.toLowerCase()}-level`, index === 0 ? 0.8 : 0.55))} onChange={(value) => setHardware(`piano-layer-${layer.toLowerCase()}-level`, value)} compact /><Toggle id={`piano-layer-${layer.toLowerCase()}-focus`} label="FOCUS" pressed={Boolean(getHardware(`piano-layer-${layer.toLowerCase()}-focus`, index === 0))} onChange={(value) => setHardware(`piano-layer-${layer.toLowerCase()}-focus`, value)} /></div>)}</div>
    <div className="piano-type-row">{['GRAND', 'UPRIGHT', 'ELECTRIC', 'CLAV', 'DIGITAL', 'MISC'].map((name, index) => <Toggle key={name} id={`piano-type-${name.toLowerCase()}`} label={name} pressed={Boolean(getHardware(`piano-type-${name.toLowerCase()}`, index === 0))} onChange={(value) => setHardware(`piano-type-${name.toLowerCase()}`, value)} />)}</div>
    <div className="piano-controls"><Toggle id="piano-section-on" label="ON" pressed={Boolean(getHardware('piano-section-on', true))} onChange={(value) => setHardware('piano-section-on', value)} /><DecorativeKnob id="piano-model" label="MODEL" getHardware={getHardware} setHardware={setHardware} value={0.22} /><DecorativeKnob id="piano-timbre" label="TIMBRE" getHardware={getHardware} setHardware={setHardware} value={0.55} /><Toggle id="piano-sustain-ped" label="SUSTPED" pressed={Boolean(getHardware('piano-sustain-ped', true))} onChange={(value) => setHardware('piano-sustain-ped', value)} /><Toggle id="piano-pstick" label="PSTICK" pressed={Boolean(getHardware('piano-pstick', false))} onChange={(value) => setHardware('piano-pstick', value)} /></div>
    <div className="piano-details"><span className="mini-heading">PIANO DETAIL</span><Toggle id="piano-soft-release" label="SOFT RELEASE" pressed={Boolean(getHardware('piano-soft-release', false))} onChange={(value) => setHardware('piano-soft-release', value)} /><Toggle id="piano-string-res" label="STRING RES" pressed={Boolean(getHardware('piano-string-res', false))} onChange={(value) => setHardware('piano-string-res', value)} /><Toggle id="piano-unison" label="UNISON" pressed={Boolean(getHardware('piano-unison', false))} onChange={(value) => setHardware('piano-unison', value)} /></div>
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

function EffectsSection({ getHardware, setHardware }: { getHardware: (id: string, fallback: HardwareValue) => HardwareValue; setHardware: (id: string, value: HardwareValue) => void }) {
  return <section className="instrument-section dark-panel effects" aria-labelledby="section-effects">
    <SectionHeader eyebrow="LAYER FX" title="EFFECTS" id="section-effects" />
    <div className="effects-focus"><Toggle id="effects-focus-a" label="LAYER A" pressed={Boolean(getHardware('effects-focus-a', true))} onChange={(value) => setHardware('effects-focus-a', value)} /><Toggle id="effects-focus-b" label="LAYER B" pressed={Boolean(getHardware('effects-focus-b', false))} onChange={(value) => setHardware('effects-focus-b', value)} /></div>
    <div className="effects-matrix"><div className="effect-column"><span className="group-label">MOD 1 / 2</span><DecorativeKnob id="effects-mod-rate" label="RATE" getHardware={getHardware} setHardware={setHardware} value={0.25} size="small" /><DecorativeKnob id="effects-mod-amount" label="AMOUNT" getHardware={getHardware} setHardware={setHardware} value={0.4} size="small" /><Toggle id="effects-mod-on" label="ON" pressed={Boolean(getHardware('effects-mod-on', false))} onChange={(value) => setHardware('effects-mod-on', value)} /></div><div className="effect-column"><span className="group-label">DELAY</span><DecorativeKnob id="effects-delay-time" label="TIME" getHardware={getHardware} setHardware={setHardware} value={0.35} size="small" /><DecorativeKnob id="effects-delay-feedback" label="FEEDBACK" getHardware={getHardware} setHardware={setHardware} value={0.28} size="small" /><Toggle id="effects-delay-on" label="ON" pressed={Boolean(getHardware('effects-delay-on', false))} onChange={(value) => setHardware('effects-delay-on', value)} /></div><div className="effect-column"><span className="group-label">AMP / EQ</span><DecorativeKnob id="effects-amp-drive" label="DRIVE" getHardware={getHardware} setHardware={setHardware} value={0.2} size="small" /><DecorativeKnob id="effects-eq-treble" label="TREBLE" getHardware={getHardware} setHardware={setHardware} value={0.55} size="small" /><Toggle id="effects-amp-on" label="ON" pressed={Boolean(getHardware('effects-amp-on', false))} onChange={(value) => setHardware('effects-amp-on', value)} /></div><div className="effect-column"><span className="group-label">COMP / REVERB</span><DecorativeKnob id="effects-comp-amount" label="COMP" getHardware={getHardware} setHardware={setHardware} value={0.3} size="small" /><DecorativeKnob id="effects-reverb-amount" label="REVERB" getHardware={getHardware} setHardware={setHardware} value={0.32} size="small" /><Toggle id="effects-reverb-on" label="ON" pressed={Boolean(getHardware('effects-reverb-on', false))} onChange={(value) => setHardware('effects-reverb-on', value)} /></div></div>
    <div className="effects-footer"><Toggle id="effects-rotary" label="TO ROTARY" pressed={Boolean(getHardware('effects-rotary', false))} onChange={(value) => setHardware('effects-rotary', value)} /><Toggle id="effects-bypass" label="BYPASS ALL" pressed={Boolean(getHardware('effects-bypass', false))} onChange={(value) => setHardware('effects-bypass', value)} /></div>
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
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set())
  const [sustain, setSustainState] = useState(false)
  const [audioStatus, setAudioStatus] = useState('ready · generated piano')
  const [midiStatus, setMidiStatus] = useState('not connected')
  const engineRef = useRef<BasicPianoEngine | null>(null)
  const activeSources = useRef(new Map<string, number>())
  const heldComputerKeys = useRef(new Set<string>())
  const midiAccessRef = useRef<MIDIAccess | null>(null)

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new BasicPianoEngine((status, message) => setAudioStatus(status === 'error' ? `error · ${message}` : message))
    return engineRef.current
  }, [])

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
        <PerformanceSection getHardware={getHardware} setHardware={setHardware} sustain={sustain} setSustain={setSustain} />
        <OrganSection getHardware={getHardware} setHardware={setHardware} />
        <PianoSection getHardware={getHardware} setHardware={setHardware} />
        <ProgramSection getHardware={getHardware} setHardware={setHardware} />
        <SynthSection getHardware={getHardware} setHardware={setHardware} />
        <EffectsSection getHardware={getHardware} setHardware={setHardware} />
      </div>
      <Keybed onNoteOn={pressNote} onNoteOff={releaseNote} pressedKeys={pressedKeys} />
      <div className="bottom-rail"><span>STAGE 4 73</span><span>HA · E—E</span><span>{Object.keys(hardware).length} PRESENTATION CONTROLS</span><span>PHASE 1 / BASIC PIANO</span></div>
    </div>
    <p className="product-caption">NORD STAGE 4 · STAGEBENCH PHASE 1 · DECORATIVE CONTROL SURFACE / GENERATED BASIC PIANO</p>
  </main>
}

export default App
