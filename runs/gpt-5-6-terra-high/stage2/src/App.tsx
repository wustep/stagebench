import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type ControlKind = 'knob' | 'button' | 'fader' | 'drawbar' | 'wheel'
type HardwareState = Record<string, number | boolean>
type LayerId = 'A' | 'B'
type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
type EffectUnit = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb' | 'rotary'

const START_NOTE = 28, KEY_COUNT = 73, MAX_VOICES = 24
const pianoTypes: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
const typeModels: Record<PianoType, string> = { Grand: 'Salamander Grand', Upright: 'Felt Upright', Electric: 'Tine Electric', Clav: 'Clavinet', Digital: 'DX Layer', Misc: 'Vibraphone' }
const effectTypes: Record<EffectUnit, readonly string[]> = {
  mod1: ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'],
  mod2: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'],
  delay: ['Digital'], ampEq: ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'],
  compressor: ['Soft'], reverb: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'], rotary: ['Horn + drum'],
}
const keyboardNotes: Record<string, number> = { z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59, ',': 60, l: 61, '.': 62, ';': 63, '/': 64 }
const blackPitchClasses = new Set([1, 3, 6, 8, 10])
const noteName = (midi: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`

interface LayerSettings { enabled: boolean; level: number; octave: number; sustainPedal: boolean; pitchStick: boolean; type: PianoType }
interface EffectSettings { on: boolean; type: string; amount: number; rate: number; wet: number; feedback: number; global: boolean }
interface PianoSettings { touch: 'Heavy' | 'Medium' | 'Light'; dynComp: number; timbre: string; unison: number; softRelease: boolean; stringRes: boolean; master: number; allEffects: boolean; group: boolean }
type EffectState = Record<LayerId, Record<EffectUnit, EffectSettings>>
interface Voice { note: number; layer: LayerId; started: number; release: () => void }

const defaultEffect = (unit: EffectUnit): EffectSettings => ({ on: false, type: effectTypes[unit][0], amount: 40, rate: 35, wet: unit === 'reverb' ? 28 : 35, feedback: 32, global: false })
const makeEffects = (): EffectState => ({ A: Object.fromEntries((Object.keys(effectTypes) as EffectUnit[]).map((u) => [u, defaultEffect(u)])) as EffectState['A'], B: Object.fromEntries((Object.keys(effectTypes) as EffectUnit[]).map((u) => [u, defaultEffect(u)])) as EffectState['B'] })

/** One context; source nodes are owned by a layer graph and never connect to the destination directly. */
class LayeredAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private layerInput = new Map<LayerId, GainNode>()
  private layerOutput = new Map<LayerId, GainNode>()
  private voices = new Map<number, Voice[]>()
  private sustained = new Set<number>()
  private sustain = false
  private counter = 0
  private timer: number | undefined

  private ensure() {
    if (this.context) return
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    this.context = new AudioCtor()
    this.master = this.context.createGain(); this.master.gain.value = .52
    this.limiter = this.context.createDynamicsCompressor(); this.limiter.threshold.value = -7; this.limiter.knee.value = 8; this.limiter.ratio.value = 12
    this.master.connect(this.limiter); this.limiter.connect(this.context.destination)
    ;(['A', 'B'] as LayerId[]).forEach((layer) => this.buildLayer(layer, makeEffects()[layer], true))
  }

  private buildLayer(layer: LayerId, fx: Record<EffectUnit, EffectSettings>, initial = false) {
    if (!this.context || !this.master) return
    const oldInput = this.layerInput.get(layer), oldOutput = this.layerOutput.get(layer)
    if (!initial) { try { oldInput?.disconnect() } catch { /* detached graph */ }; try { oldOutput?.disconnect() } catch { /* detached graph */ } }
    const input = this.context.createGain(), mod1 = this.context.createGain(), mod2 = this.context.createBiquadFilter(), delay = this.context.createDelay(1.5), feedback = this.context.createGain(), amp = this.context.createBiquadFilter(), compressor = this.context.createDynamicsCompressor(), reverb = this.context.createConvolver(), rotary = this.context.createStereoPanner(), output = this.context.createGain()
    const now = this.context.currentTime
    const enabled = (unit: EffectUnit) => fx[unit].on
    const m1 = fx.mod1, m2 = fx.mod2, d = fx.delay, a = fx.ampEq, c = fx.compressor, r = fx.reverb, rot = fx.rotary
    mod1.gain.setValueAtTime(enabled('mod1') ? (m1.type === 'Pump' ? 1 - m1.amount / 180 : 1 - m1.amount / 300) : 1, now)
    mod2.type = m2.type === 'Phaser' || m2.type === 'Vibe' ? 'allpass' : 'lowpass'; mod2.frequency.setValueAtTime(enabled('mod2') ? 700 + m2.rate * 25 : 18000, now); mod2.Q.setValueAtTime(enabled('mod2') ? m2.amount / 9 : .0001, now)
    delay.delayTime.setValueAtTime(.08 + d.rate / 150, now); feedback.gain.setValueAtTime(enabled('delay') ? d.feedback / 150 : 0, now); delay.connect(feedback); feedback.connect(delay)
    amp.type = a.type === 'HP24 Filter' ? 'highpass' : a.type === 'LP24 Filter' ? 'lowpass' : 'peaking'; amp.frequency.setValueAtTime(a.type.includes('Filter') ? 300 + a.rate * 30 : 1200, now); amp.gain.setValueAtTime(enabled('ampEq') ? (a.type === 'Twin' ? 4 : a.type === 'JC' ? 7 : a.type === 'Small' ? -5 : a.amount / 9 - 3) : 0, now); amp.Q.setValueAtTime(a.type.includes('Filter') ? 8 : .7, now)
    compressor.threshold.setValueAtTime(enabled('compressor') ? -8 - c.amount / 3 : 0, now); compressor.ratio.setValueAtTime(enabled('compressor') ? 2 + c.amount / 14 : 1, now); compressor.attack.setValueAtTime(c.rate > 50 ? .003 : .03, now)
    reverb.buffer = this.impulse(r.type, r.wet); rotary.pan.setValueAtTime(enabled('rotary') && a.type === 'To Rotary' ? (rot.rate / 100) * .75 - .37 : 0, now)
    input.connect(mod1); mod1.connect(mod2); mod2.connect(delay); delay.connect(amp); mod2.connect(amp); amp.connect(compressor); compressor.connect(reverb); compressor.connect(output); reverb.connect(output); output.connect(this.master)
    output.gain.setValueAtTime(1, now); this.layerInput.set(layer, input); this.layerOutput.set(layer, output)
  }

  private impulse(type: string, wet: number) {
    if (!this.context) return null
    const length = Math.max(1, Math.round(this.context.sampleRate * (.05 + wet / 100 * (type === 'Cathedral' ? 2.1 : type === 'Spring' ? .75 : .9))))
    const buffer = this.context.createBuffer(2, length, this.context.sampleRate)
    for (let ch = 0; ch < 2; ch++) { const data = buffer.getChannelData(ch); for (let i = 0; i < length; i++) data[i] = (Math.sin(i * (type === 'Spring' ? .19 : .041)) * (Math.random() * 2 - 1)) * (1 - i / length) ** (type === 'Booth' ? 5 : 2) * wet / 100 }
    return buffer
  }

  configure(layers: Record<LayerId, LayerSettings>, fx: EffectState, piano: PianoSettings) {
    this.ensure(); if (!this.context || !this.master) return
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now); this.master.gain.linearRampToValueAtTime(Math.max(.01, piano.master / 100) * .62, now + .025)
    ;(['A', 'B'] as LayerId[]).forEach((layer) => { this.buildLayer(layer, piano.allEffects ? Object.fromEntries((Object.keys(effectTypes) as EffectUnit[]).map((u) => [u, { ...fx[layer][u], on: false }])) as Record<EffectUnit, EffectSettings> : fx[layer]); this.layerOutput.get(layer)?.gain.linearRampToValueAtTime(layers[layer].enabled ? layers[layer].level / 100 : .0001, now + .02) })
  }

  noteOn(note: number, velocity: number, layers: Record<LayerId, LayerSettings>, piano: PianoSettings) {
    this.ensure(); if (!this.context) return; void this.context.resume()
    const all = [...this.voices.values()].flat(); if (all.length >= MAX_VOICES) all.sort((a, b) => a.started - b.started)[0]?.release()
    ;(['A', 'B'] as LayerId[]).forEach((layer) => { if (layers[layer].enabled) this.createVoice(note, velocity, layer, layers[layer], piano) })
  }

  private createVoice(note: number, rawVelocity: number, layer: LayerId, settings: LayerSettings, piano: PianoSettings) {
    if (!this.context || !this.layerInput.get(layer)) return
    const now = this.context.currentTime, touch = piano.touch === 'Heavy' ? rawVelocity ** 1.65 : piano.touch === 'Light' ? rawVelocity ** .65 : rawVelocity
    const velocity = Math.min(1, touch + (1 - touch) * piano.dynComp * .11), freq = 440 * 2 ** ((note + settings.octave - 69) / 12)
    const env = this.context.createGain(), osc = this.context.createOscillator(), color = this.context.createOscillator(), filter = this.context.createBiquadFilter()
    const shapes: Record<PianoType, OscillatorType> = { Grand: 'triangle', Upright: 'sine', Electric: 'sine', Clav: 'square', Digital: 'sawtooth', Misc: 'sine' }
    osc.type = shapes[settings.type]; osc.frequency.value = freq; color.type = settings.type === 'Electric' ? 'sine' : settings.type === 'Clav' ? 'square' : 'triangle'; color.frequency.value = freq * (settings.type === 'Electric' ? 2.01 : settings.type === 'Misc' ? 3 : 2)
    filter.type = 'lowpass'; filter.frequency.value = piano.timbre === 'Soft' ? 1500 : piano.timbre === 'Bright' || piano.timbre.startsWith('Dyno') ? 9200 : piano.timbre === 'Mid' ? 3700 : 6200
    env.gain.setValueAtTime(.0001, now); env.gain.exponentialRampToValueAtTime(Math.max(.015, velocity) * .34, now + .009); env.gain.exponentialRampToValueAtTime(Math.max(.008, velocity) * (settings.type === 'Electric' ? .18 : .12), now + .42)
    osc.connect(filter); color.connect(filter); filter.connect(env); env.connect(this.layerInput.get(layer)!)
    const unisons: OscillatorNode[] = []
    for (let i = 0; i < piano.unison; i++) { const u = this.context.createOscillator(); u.type = osc.type; u.frequency.value = freq * (1 + (i + 1) * .0025); u.connect(filter); u.start(now); unisons.push(u) }
    osc.start(now); color.start(now)
    let ended = false
    const release = () => { if (ended || !this.context) return; ended = true; const at = this.context.currentTime, releaseTime = piano.softRelease ? .34 : .13; env.gain.cancelScheduledValues(at); env.gain.setTargetAtTime(.0001, at, releaseTime); [osc, color, ...unisons].forEach((node) => node.stop(at + releaseTime * 6)); const group = this.voices.get(note) ?? []; this.voices.set(note, group.filter((voice) => voice.release !== release)) }
    this.voices.set(note, [...(this.voices.get(note) ?? []), { note, layer, started: ++this.counter, release }])
  }

  noteOff(note: number) { if (this.sustain) { this.sustained.add(note); return }; (this.voices.get(note) ?? []).forEach((voice) => voice.release()) }
  setSustain(down: boolean, layers: Record<LayerId, LayerSettings>, piano: PianoSettings) { this.sustain = down && (layers.A.sustainPedal || layers.B.sustainPedal); if (!this.sustain) { [...this.sustained].forEach((n) => { this.sustained.delete(n); this.noteOff(n) }) }; if (down && piano.stringRes) this.timer = window.setTimeout(() => undefined, 1) }
  allNotesOff() { this.sustained.clear(); this.sustain = false; [...this.voices.values()].flat().forEach((voice) => voice.release()); this.voices.clear(); if (this.timer) window.clearTimeout(this.timer) }
  dispose() { this.allNotesOff(); void this.context?.close(); this.context = null; this.layerInput.clear(); this.layerOutput.clear() }
}

const control = (id: string, label: string, kind: ControlKind, value = kind === 'button' ? false : 50) => ({ id, label, kind, value })
const sections = [
  { id: 'performance', title: 'PERFORMANCE', controls: [control('master-level-decorative', 'Master Level', 'knob', 68), control('pitch-stick', 'Pitch Stick', 'wheel', 50), control('mod-wheel', 'Modulation Wheel', 'wheel', 50), control('performance-octave-down', 'Octave Down', 'button'), control('performance-octave-up', 'Octave Up', 'button')] },
  { id: 'organ', title: 'ORGAN', controls: [...Array.from({ length: 9 }, (_, i) => control(`organ-drawbar-${i + 1}`, `Organ drawbar ${i + 1}`, 'drawbar', 28 + (i % 4) * 14)), control('organ-layer-a', 'Organ Layer A', 'button'), control('organ-layer-b', 'Organ Layer B', 'button'), control('organ-model', 'Organ Model', 'button'), control('organ-percussion', 'Organ Percussion', 'button'), control('organ-rotary', 'Organ Rotary', 'knob', 42)] },
  { id: 'piano', title: 'PIANO', controls: [] },
  { id: 'program', title: 'PROGRAM', controls: [control('program-dial', 'Program Dial', 'knob', 36), ...Array.from({ length: 8 }, (_, i) => control(`program-button-${i + 1}`, `Program button ${i + 1}`, 'button')), control('program-page-up', 'Program Page Up', 'button'), control('program-page-down', 'Program Page Down', 'button'), control('program-live', 'Live Mode', 'button'), control('program-store', 'Store', 'button'), control('program-split', 'Split', 'button'), control('morph-wheel', 'Wheel Morph Assign', 'button'), control('morph-pedal', 'Control Pedal Morph Assign', 'button'), control('morph-aftertouch', 'Aftertouch Morph Assign', 'button')] },
  { id: 'synth', title: 'SYNTH', controls: [control('synth-layer-a', 'Synth Layer A', 'button'), control('synth-layer-b', 'Synth Layer B', 'button'), control('synth-layer-c', 'Synth Layer C', 'button'), control('synth-level-a', 'Synth Layer A Level', 'fader', 57), control('synth-level-b', 'Synth Layer B Level', 'fader', 47), ...['Oscillator Shape', 'Oscillator Control', 'Filter Frequency', 'Filter Resonance', 'Filter Drive', 'Amp Attack', 'Amp Decay', 'Amp Release', 'LFO Rate', 'LFO Amount', 'Arpeggiator Rate'].map((label, i) => control(`synth-${i}`, label, 'knob', 30 + i * 5)), control('synth-filter-type', 'Synth Filter Type', 'button'), control('synth-arp', 'Synth Arpeggiator', 'button')] },
  { id: 'effects', title: 'LAYER EFFECTS', controls: [] },
]

function PanelControl({ item, value, update }: { item: ReturnType<typeof control>; value: number | boolean; update: (value: number | boolean) => void }) {
  if (item.kind === 'button') return <button id={item.id} className={`hardware-button ${value ? 'lit' : ''}`} aria-pressed={Boolean(value)} onClick={() => update(!value)}><i />{item.label}</button>
  if (item.kind === 'drawbar' || item.kind === 'fader') return <label className={`${item.kind} control-label`} htmlFor={item.id}><span>{item.kind === 'drawbar' ? '' : item.label}</span><input id={item.id} aria-label={item.label} type="range" min="0" max="100" value={Number(value)} onChange={(e) => update(Number(e.target.value))} /></label>
  if (item.kind === 'wheel') return <label className="wheel control-label" htmlFor={item.id}><span>{item.label}</span><input id={item.id} aria-label={item.label} type="range" min="0" max="100" value={Number(value)} onChange={(e) => update(Number(e.target.value))} /></label>
  return <label className="knob control-label" htmlFor={item.id} title={item.label}><span className="knob-face" style={{ '--turn': `${Number(value) * 2.7 - 135}deg` } as React.CSSProperties} /><input id={item.id} aria-label={item.label} type="range" min="0" max="100" value={Number(value)} onChange={(e) => update(Number(e.target.value))} /><small>{item.label}</small></label>
}

function Toggle({ id, label, pressed, onClick }: { id: string; label: string; pressed: boolean; onClick: () => void }) { return <button id={id} className={`hardware-button ${pressed ? 'lit' : ''}`} aria-pressed={pressed} onClick={onClick}><i />{label}</button> }

export default function App() {
  const [hardware, setHardware] = useState<HardwareState>(() => Object.fromEntries(sections.flatMap((section) => section.controls.map((item) => [item.id, item.value]))))
  const [layers, setLayers] = useState<Record<LayerId, LayerSettings>>({ A: { enabled: true, level: 68, octave: 0, sustainPedal: true, pitchStick: false, type: 'Grand' }, B: { enabled: false, level: 55, octave: 0, sustainPedal: true, pitchStick: false, type: 'Electric' } })
  const [piano, setPiano] = useState<PianoSettings>({ touch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false, master: 68, allEffects: false, group: false })
  const [effects, setEffects] = useState<EffectState>(makeEffects)
  const [focus, setFocus] = useState<LayerId>('A'), [pressed, setPressed] = useState<Set<number>>(new Set()), [status, setStatus] = useState('Sample assets unavailable · playable synthesis fallback'), [sustain, setSustain] = useState(false)
  const audio = useRef<LayeredAudio | null>(null), activePointers = useRef(new Map<number, number>()), pressedKeyboard = useRef(new Set<string>())
  const notes = useMemo(() => Array.from({ length: KEY_COUNT }, (_, i) => START_NOTE + i), [])
  const update = useCallback((id: string, value: number | boolean) => setHardware((old) => ({ ...old, [id]: value })), [])
  const getAudio = useCallback(() => (audio.current ??= new LayeredAudio()), [])
  const configure = useCallback((nextLayers = layers, nextEffects = effects, nextPiano = piano) => getAudio().configure(nextLayers, nextEffects, nextPiano), [effects, getAudio, layers, piano])
  const patchLayer = (layer: LayerId, patch: Partial<LayerSettings>) => setLayers((old) => { const next = { ...old, [layer]: { ...old[layer], ...patch } }; configure(next); return next })
  const patchPiano = (patch: Partial<PianoSettings>) => setPiano((old) => { const next = { ...old, ...patch }; configure(layers, effects, next); return next })
  const patchEffect = (unit: EffectUnit, patch: Partial<EffectSettings>) => setEffects((old) => { const targets: LayerId[] = piano.group || old[focus][unit].global ? ['A', 'B'] : [focus]; const next = { ...old, A: { ...old.A }, B: { ...old.B } }; targets.forEach((layer) => { next[layer][unit] = { ...old[layer][unit], ...patch } }); configure(layers, next); return next })
  const play = useCallback((note: number, velocity = .78) => { if (note < START_NOTE || note >= START_NOTE + KEY_COUNT) return; setPressed((old) => new Set(old).add(note)); getAudio().configure(layers, effects, piano); getAudio().noteOn(note, velocity, layers, piano) }, [effects, getAudio, layers, piano])
  const release = useCallback((note: number) => { setPressed((old) => { const next = new Set(old); next.delete(note); return next }); audio.current?.noteOff(note) }, [])
  const setPedal = useCallback((down: boolean) => { setSustain(down); getAudio().setSustain(down, layers, piano) }, [getAudio, layers, piano])

  useEffect(() => { const stop = () => { pressedKeyboard.current.clear(); activePointers.current.clear(); setPressed(new Set()); audio.current?.allNotesOff(); setSustain(false) }; const down = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) setPedal(true); return }; const n = keyboardNotes[e.key.toLowerCase()]; if (n === undefined || e.repeat || pressedKeyboard.current.has(e.code)) return; e.preventDefault(); pressedKeyboard.current.add(e.code); play(n, .74) }; const up = (e: KeyboardEvent) => { if (e.code === 'Space') { setPedal(false); return }; const n = keyboardNotes[e.key.toLowerCase()]; if (n !== undefined) { pressedKeyboard.current.delete(e.code); release(n) } }; window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', stop); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', stop); stop(); audio.current?.dispose() } }, [play, release, setPedal])
  useEffect(() => { const midi = navigator.requestMIDIAccess; if (!midi) { setStatus('Sample assets unavailable · playable synthesis fallback · MIDI unavailable'); return }; let access: MIDIAccess | undefined; const message = (e: MIDIMessageEvent) => { if (!e.data) return; const [cmd, key, vel] = e.data; if ((cmd & 240) === 144 && vel > 0) play(key, vel / 127); else if ((cmd & 240) === 128 || ((cmd & 240) === 144 && vel === 0)) release(key); else if ((cmd & 240) === 176 && key === 64) setPedal(vel >= 64) }; void midi.call(navigator).then((result) => { access = result; result.inputs.forEach((input) => { input.onmidimessage = message }); result.onstatechange = () => setStatus([...result.inputs.values()].some((x) => x.state === 'connected') ? 'Fallback · MIDI connected' : 'Fallback · MIDI disconnected') }).catch(() => setStatus('Sample assets unavailable · playable synthesis fallback · MIDI permission denied')); return () => { access?.inputs.forEach((input) => { input.onmidimessage = null }) } }, [play, release, setPedal])

  const active = layers[focus], effect = (unit: EffectUnit) => effects[focus][unit]
  const cycle = <T,>(values: readonly T[], value: T) => values[(values.indexOf(value) + 1) % values.length]
  return <main className="product-study"><div className="instrument-shell" aria-label="Nord Stage 4 73 virtual instrument"><div className="top-rail" /><section className="deck" aria-label="Nord Stage 4 control deck">
    {sections.map((section) => <section className={`panel panel-${section.id}`} key={section.id} aria-label={section.title}>
      {section.id === 'performance' && <><div className="brand"><strong>nord stage 4</strong><span>HAMMER ACTION 73</span></div><div className="status-dot">{status}</div></>}
      <h2>{section.title}</h2>
      {section.id === 'program' && <div className="oled program-oled" role="status"><b>{typeModels[active.type]}</b><span>Piano {focus} · {active.type}</span><small>Program controls decorative</small></div>}
      {section.id === 'synth' && <div className="oled synth-oled" role="status"><b>OSC SHAPE</b><span>Analog · Saw</span></div>}
      {section.id === 'organ' && <div className="led-ladders" aria-label="Organ level LED ladders">{Array.from({ length: 9 }, (_, i) => <span key={i}>{Array.from({ length: 6 }, (_, led) => <i className={led < 3 + i % 3 ? 'on' : ''} key={led} />)}</span>)}</div>}
      {section.id === 'performance' && <label className="master-live control-label" htmlFor="master-level"><span>MASTER LEVEL</span><input id="master-level" aria-label="Master Level" type="range" min="0" max="100" value={piano.master} onChange={(e) => patchPiano({ master: Number(e.target.value) })} /></label>}
      {section.id === 'piano' ? <div className="functional-bank piano-live">
        <div className="layer-row"><Toggle id="piano-layer-a" label="A" pressed={layers.A.enabled} onClick={() => { setFocus('A'); patchLayer('A', { enabled: !layers.A.enabled }) }} /><Toggle id="piano-layer-b" label="B" pressed={layers.B.enabled} onClick={() => { setFocus('B'); patchLayer('B', { enabled: !layers.B.enabled }) }} /></div>
        <button id="piano-type" className="hardware-button lit" aria-label="Piano Type" onClick={() => patchLayer(focus, { type: cycle(pianoTypes, active.type) })}><i />{active.type}</button>
        <span className="model-readout" aria-label="Piano Model">{typeModels[active.type]}</span>
        <label className="live-range" htmlFor="piano-level"><span>{focus} LEVEL</span><input id="piano-level" aria-label={`Piano Layer ${focus} Level`} type="range" min="0" max="100" value={active.level} onChange={(e) => patchLayer(focus, { level: Number(e.target.value) })} /></label>
        <div className="tiny-row"><button id="piano-octave-down" onClick={() => patchLayer(focus, { octave: Math.max(-12, active.octave - 12) })}>OCT−</button><span aria-label="Piano Octave">{active.octave / 12}</span><button id="piano-octave-up" onClick={() => patchLayer(focus, { octave: Math.min(12, active.octave + 12) })}>OCT+</button></div>
        <div className="tiny-row"><Toggle id="piano-sustain-pedal" label="SUSTPED" pressed={active.sustainPedal} onClick={() => patchLayer(focus, { sustainPedal: !active.sustainPedal })} /><Toggle id="piano-pstick" label="PSTICK" pressed={active.pitchStick} onClick={() => patchLayer(focus, { pitchStick: !active.pitchStick })} /></div>
        <button id="piano-kb-touch" className="hardware-button" aria-label="Piano Keyboard Touch" onClick={() => patchPiano({ touch: cycle(['Heavy', 'Medium', 'Light'] as const, piano.touch) })}><i />TOUCH {piano.touch}</button>
        <button id="piano-dyn-comp" className="hardware-button" onClick={() => patchPiano({ dynComp: (piano.dynComp + 1) % 4 })}><i />DYN {piano.dynComp || 'OFF'}</button>
        <button id="piano-timbre" className="hardware-button" onClick={() => patchPiano({ timbre: cycle(active.type === 'Electric' ? ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] : ['Off', 'Soft', 'Mid', 'Bright'], piano.timbre) })}><i />TIMBRE {piano.timbre}</button>
        <button id="piano-unison" className="hardware-button" onClick={() => patchPiano({ unison: (piano.unison + 1) % 4 })}><i />UNISON {piano.unison || 'OFF'}</button>
        <div className="tiny-row"><Toggle id="piano-soft-release" label="SOFT REL" pressed={piano.softRelease} onClick={() => patchPiano({ softRelease: !piano.softRelease })} /><Toggle id="piano-string-res" label="STR RES" pressed={piano.stringRes} onClick={() => patchPiano({ stringRes: !piano.stringRes })} /></div>
      </div> : section.id === 'effects' ? <div className="functional-bank effects-live">
        <div className="layer-row"><Toggle id="effects-focus-a" label="PIANO A" pressed={focus === 'A'} onClick={() => setFocus('A')} /><Toggle id="effects-focus-b" label="PIANO B" pressed={focus === 'B'} onClick={() => setFocus('B')} /><Toggle id="effects-group" label="GROUP" pressed={piano.group} onClick={() => patchPiano({ group: !piano.group })} /></div>
        <Toggle id="effects-all-bypass" label="LAYER FX ON" pressed={!piano.allEffects} onClick={() => patchPiano({ allEffects: !piano.allEffects })} />
        {(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb', 'rotary'] as EffectUnit[]).map((unit) => <div className="fx-unit" key={unit}><Toggle id={`effects-${unit}-on`} label={unit === 'ampEq' ? 'AMP/EQ' : unit.toUpperCase()} pressed={effect(unit).on} onClick={() => patchEffect(unit, { on: !effect(unit).on })} /><select aria-label={`${unit} type`} value={effect(unit).type} onChange={(e) => patchEffect(unit, { type: e.target.value })}>{effectTypes[unit].map((x) => <option key={x}>{x}</option>)}</select><input aria-label={`${unit} amount`} type="range" min="0" max="100" value={effect(unit).amount} onChange={(e) => patchEffect(unit, { amount: Number(e.target.value), wet: Number(e.target.value) })} />{(['delay', 'compressor', 'reverb'] as EffectUnit[]).includes(unit) && <Toggle id={`effects-${unit}-global`} label="G" pressed={effect(unit).global} onClick={() => patchEffect(unit, { global: !effect(unit).global })} />}</div>)}
      </div> : <div className={`control-bank ${section.id}`}>{section.controls.map((item) => <PanelControl key={item.id} item={item} value={hardware[item.id]} update={(value) => update(item.id, value)} />)}</div>}
    </section>)}
  </section><section className="keybed" aria-label="73 key E to E hammer action keyboard"><div className="sustain-bar"><button id="sustain-pedal" className={sustain ? 'lit' : ''} aria-pressed={sustain} onPointerDown={() => setPedal(true)} onPointerUp={() => setPedal(false)} onPointerCancel={() => setPedal(false)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPedal(!sustain) } }}>SUSTAIN · SPACE</button><span>Computer keys: Z–M</span></div><div className="keys" role="group" aria-label="Playable piano keys">{notes.filter((n) => !blackPitchClasses.has(n % 12)).map((n) => <button key={n} id={`key-${n}`} className={`key white ${pressed.has(n) ? 'pressed' : ''}`} aria-label={`${noteName(n)} piano key`} aria-pressed={pressed.has(n)} onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); activePointers.current.set(e.pointerId, n); play(n, Math.max(.2, 1 - e.nativeEvent.offsetY / Math.max(1, e.currentTarget.clientHeight))) }} onPointerUp={(e) => { release(activePointers.current.get(e.pointerId) ?? n); activePointers.current.delete(e.pointerId) }} onPointerCancel={(e) => { release(activePointers.current.get(e.pointerId) ?? n); activePointers.current.delete(e.pointerId) }} onKeyDown={(e) => { if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); play(n) } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') release(n) }}>{noteName(n)}</button>)}{notes.filter((n) => blackPitchClasses.has(n % 12)).map((n) => { const before = notes.filter((x) => x < n && !blackPitchClasses.has(x % 12)).length; return <button key={n} id={`key-${n}`} className={`key black ${pressed.has(n) ? 'pressed' : ''}`} style={{ left: `calc(${before} * (100% / 43) - 1.14%)` }} aria-label={`${noteName(n)} piano key`} aria-pressed={pressed.has(n)} onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); activePointers.current.set(e.pointerId, n); play(n, .82) }} onPointerUp={(e) => { release(activePointers.current.get(e.pointerId) ?? n); activePointers.current.delete(e.pointerId) }} onPointerCancel={(e) => { release(activePointers.current.get(e.pointerId) ?? n); activePointers.current.delete(e.pointerId) }} onKeyDown={(e) => { if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); play(n) } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') release(n) }} /> })}</div></section></div></main>
}
