import { clamp, envelopeTime, synthPeriod, waves } from '../instrument/parameters'
import type { Envelope, SynthLayer } from '../instrument/parameters'
import { connect, curve, Insert } from './graph'
import { frequency, noiseBuffer, NoteGraph } from './noteGraph'

const syncRatios = [1, 1.48, 2.13, 2.92, 4.16, 5.87, 8.27]
const syncCurves = syncRatios.map((_, index) =>
  curve((value) => Math.max(0, 1 - Math.abs(clamp(value, 0, 1) * (syncRatios.length - 1) - index))))
const controlCurve = curve((value) => clamp(value, 0, 1))
const driveCurve = curve((value) => Math.tanh(value * 2.4) / Math.tanh(2.4))

export class SynthWaves {
  readonly noise: AudioBuffer
  private readonly periodic = new Map<string, PeriodicWave>()
  private readonly modulation = new Map<SynthLayer['lfo']['wave'], AudioBuffer>()

  constructor(private readonly context: BaseAudioContext) {
    this.noise = noiseBuffer(context, Math.round(context.sampleRate * 1.37), 291835)
  }

  pulse(width: number) {
    return this.table(`Pulse ${width}`, (phase) => Number(phase < width) * 2 - 1)
  }

  sync(shape: number, ratio: number) {
    return this.table(`Sync ${shape} ${ratio}`, (phase) => {
      const cycle = (phase * ratio) % 1
      return shape ? Number(cycle < 0.5) * 2 - 1 : 2 * cycle - 1
    })
  }

  lfo(wave: SynthLayer['lfo']['wave']) {
    let buffer = this.modulation.get(wave)
    if (buffer) return buffer
    // 512 samples at the context rate; playback rate is scaled to the desired period.
    const table = this.context.createBuffer(1, 512, this.context.sampleRate)
    const out = table.getChannelData(0)
    let seed = 75861
    for (let i = 0; i < out.length; i++) {
      const phase = i / out.length
      switch (wave) {
        case 'Triangle': out[i] = 1 - 4 * Math.abs(phase - 0.5); break
        case 'Saw down': out[i] = 1 - 2 * phase; break
        case 'Saw up': out[i] = 2 * phase - 1; break
        case 'Square': out[i] = phase < 0.5 ? 1 : -1; break
        case 'Sample & Hold':
          if (i % 32 === 0) seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          out[i] = seed / 2147483648 - 1
      }
    }
    this.modulation.set(wave, table)
    return table
  }

  private table(key: string, signal: (phase: number) => number) {
    let wave = this.periodic.get(key)
    if (wave) return wave
    const size = 512
    const samples = Array.from({ length: size }, (_, i) => signal((i + 0.5) / size))
    const real = new Float32Array(81)
    const imaginary = new Float32Array(real.length)
    for (let order = 1; order < real.length; order++) {
      for (let i = 0; i < size; i++) {
        const phase = 2 * Math.PI * order * (i + 0.5) / size
        real[order] += 2 / size * samples[i] * Math.cos(phase)
        imaginary[order] += 2 / size * samples[i] * Math.sin(phase)
      }
      const window = 0.5 + 0.5 * Math.cos(Math.PI * order / real.length)
      real[order] *= window
      imaginary[order] *= window
    }
    wave = this.context.createPeriodicWave(real, imaginary)
    this.periodic.set(key, wave)
    return wave
  }
}

class Contour {
  private start = 0
  private attack = 0
  private decay = 0
  private level = 0
  private from = 0
  private releasedAt = Infinity
  private tail = 0
  private releaseLevel = 0

  constructor(private readonly parameter: AudioParam) {}

  trigger(time: number, settings: Envelope, peak: number) {
    const previous = this.value(time)
    this.releasedAt = Infinity
    this.start = time
    this.from = previous
    this.attack = envelopeTime(settings.attack)
    this.decay = settings.decay === 10 ? Infinity : envelopeTime(settings.decay)
    this.level = peak
    this.parameter.cancelScheduledValues(time)
    this.parameter.setValueAtTime(previous, time)
    this.parameter.linearRampToValueAtTime(peak, time + this.attack)
    if (Number.isFinite(this.decay)) this.parameter.setTargetAtTime(0, time + this.attack, this.decay / 3)
  }

  value(time: number) {
    if (time >= this.releasedAt) return this.releaseLevel * Math.exp(-6 * (time - this.releasedAt) / this.tail)
    const elapsed = Math.max(0, time - this.start)
    if (elapsed < this.attack) return this.from + (this.level - this.from) * elapsed / this.attack
    return this.level * Math.exp(-3 * (elapsed - this.attack) / (this.decay || 1))
  }

  release(time: number, seconds: number) {
    this.releaseLevel = this.value(time)
    this.parameter.cancelScheduledValues(time)
    if (time < this.start + this.attack) this.parameter.linearRampToValueAtTime(this.releaseLevel, time)
    else this.parameter.setValueAtTime(this.releaseLevel, time)
    this.parameter.setTargetAtTime(0, time, Math.max(0.0005, seconds / 6))
    this.releasedAt = time
    this.tail = seconds
  }
}

export const cutoffHz = (position: number) => 38 * 420 ** (position / 10)
export const synthWaveName = (state: SynthLayer) => waves[state.category][state.wave]

interface VoiceInputs { bend: number; wheel: number; tempo: number; epoch: number }

export class SynthVoice {
  private readonly graph: NoteGraph
  private readonly pitches: { oscillator: OscillatorNode; multiplier: number }[] = []
  private readonly fmDepth: { gain: AudioParam; ratio: number }[] = []
  private readonly oscContour: Contour
  private readonly filterContour: Contour
  private readonly ampContour: Contour
  private readonly amp: GainNode
  private readonly placement: GainNode
  private readonly gateGain: GainNode
  private gateRamp = { from: 1, to: 1, start: 0, duration: 1 }
  private readonly bend: ConstantSourceNode
  private readonly oscControl: ConstantSourceNode
  private readonly vibrato: { oscillator: OscillatorNode; gain: AudioParam }
  private readonly tracking: BiquadFilterNode[]
  private readonly filter: Insert
  private readonly filterSecond: Insert
  private readonly drive: Insert
  private readonly driveGain: AudioParam
  private readonly oscPitchAmount: AudioParam
  private readonly oscControlAmount: AudioParam
  private readonly filterEnvAmount: AudioParam
  private readonly lfo: {
    waves: Record<SynthLayer['lfo']['wave'], { source: AudioBufferSourceNode; level: GainNode }>
    pitch: AudioParam; control: AudioParam; filter: AudioParam
  }
  private readonly started: number
  private end = Infinity
  private note: number
  private velocity: number
  private zone: number
  private portamento?: { from: number; to: number; started: number; duration: number }
  private patch: SynthLayer

  constructor(
    context: BaseAudioContext, output: AudioNode, bank: SynthWaves, state: SynthLayer,
    note: number, velocity: number, zone: number, inputs: VoiceInputs,
    private readonly clock: () => number, ended: () => void,
  ) {
    const start = this.started = clock()
    this.note = note
    this.velocity = velocity
    this.zone = zone
    this.patch = state
    const graph = this.graph = new NoteGraph(context, clock, ended, start)
    const sourceBus = graph.gain()
    const pitchBus = graph.gain()
    const filterMod = graph.gain()
    this.bend = graph.source(context.createConstantSource(), start)
    this.bend.connect(pitchBus)
    this.oscControl = graph.source(context.createConstantSource(), start)
    const controlBus = graph.gain()
    this.oscControl.connect(controlBus)
    const oscEnvelope = graph.source(context.createConstantSource(), start)
    oscEnvelope.offset.value = 0
    this.oscContour = new Contour(oscEnvelope.offset)
    // Connect the envelope to independent pitch/control paths so changing the target preserves its shape.
    const envelopePitch = graph.gain(0)
    oscEnvelope.connect(envelopePitch)
    envelopePitch.connect(pitchBus)
    this.oscPitchAmount = envelopePitch.gain
    const envelopeControl = graph.gain(0)
    connect(oscEnvelope, envelopeControl, controlBus)
    this.oscControlAmount = envelopeControl.gain

    const filterEnvelope = graph.source(context.createConstantSource(), start)
    filterEnvelope.offset.value = 0
    this.filterContour = new Contour(filterEnvelope.offset)
    const filterEnvGain = graph.gain(0)
    connect(filterEnvelope, filterEnvGain, filterMod)
    this.filterEnvAmount = filterEnvGain.gain

    const vibrato = graph.oscillator('sine', state.vibrato.rate)
    const vibratoGain = graph.gain(0)
    connect(vibrato, vibratoGain, pitchBus)
    this.vibrato = { oscillator: vibrato, gain: vibratoGain.gain }

    const lfoBus = graph.gain()
    const lfoSources = {} as typeof this.lfo.waves
    const period = synthPeriod(state.lfo.rate, state.lfo.sync, inputs.tempo)
    for (const wave of ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const) {
      const source = context.createBufferSource()
      source.buffer = bank.lfo(wave)
      source.loop = true
      // Sample & Hold steps at the selected rate and repeats a seeded sequence of sixteen steps.
      const cycle = wave === 'Sample & Hold' ? period * 16 : period
      const phase = state.lfo.sync ? ((start - inputs.epoch) % cycle + cycle) % cycle / cycle : 0
      const level = graph.gain(0)
      connect(source, level, lfoBus)
      source.playbackRate.value = source.buffer.duration / cycle
      graph.bufferSource(source, start, source.buffer.duration * phase)
      lfoSources[wave] = { source, level }
    }
    const lfoPitch = graph.gain(0)
    const lfoControl = graph.gain(0)
    const lfoFilter = graph.gain(0)
    connect(lfoBus, lfoPitch, pitchBus)
    connect(lfoBus, lfoControl, controlBus)
    connect(lfoBus, lfoFilter, filterMod)
    this.lfo = { waves: lfoSources, pitch: lfoPitch.gain, control: lfoControl.gain, filter: lfoFilter.gain }

    const boundedControl = graph.shape(controlCurve)
    controlBus.connect(boundedControl)
    this.sources(state, bank, sourceBus, pitchBus, boundedControl)
    this.drive = new Insert(graph)
    const preamp = graph.gain()
    const postamp = graph.gain()
    this.driveGain = preamp.gain
    connect(sourceBus, this.drive.input)
    connect(this.drive.send, preamp, graph.shape(driveCurve, '2x'), postamp, this.drive.wet)
    postamp.gain.value = 0.45

    this.filter = new Insert(graph)
    this.filterSecond = new Insert(graph)
    const first = graph.filter('lowpass', 1000)
    const second = graph.filter('lowpass', 1000)
    filterMod.connect(first.detune)
    filterMod.connect(second.detune)
    this.tracking = [first, second]
    connect(this.drive.output, this.filter.input)
    connect(this.filter.send, first, this.filterSecond.input)
    connect(this.filterSecond.send, second, this.filterSecond.wet)
    connect(this.filterSecond.output, this.filter.wet)
    this.amp = graph.gain(0)
    this.ampContour = new Contour(this.amp.gain)
    this.placement = graph.gain(zone)
    this.gateGain = graph.gain()
    connect(this.filter.output, this.amp, this.placement, this.gateGain, output)
    this.update(state, inputs)
    this.trigger(start)
  }

  private sources(
    state: SynthLayer, bank: SynthWaves, output: GainNode, pitchBus: GainNode, controlBus: AudioNode,
  ) {
    const g = this.graph
    const context = g.context
    const add = (shape: OscillatorType | PeriodicWave, multiple: number, cents: number, destination: AudioNode) => {
      const oscillator = context.createOscillator()
      if (typeof shape === 'string') oscillator.type = shape as OscillatorType
      else oscillator.setPeriodicWave(shape)
      oscillator.detune.value = cents
      pitchBus.connect(oscillator.detune)
      oscillator.connect(destination)
      this.pitches.push({ oscillator, multiplier: multiple })
      return oscillator
    }
    const category = state.category
    const wave = state.wave
    const unison = state.voice.unison
    const stacks = unison ? [[0, 0, 0.55], [-1, -1, 0.32], [1, 1, 0.32]] : [[0, 0, 1]]
    for (const [detune, pan, level] of stacks) {
      const bias = detune * [0, 4, 10, 19][unison]
      const channel = g.gain(level)
      const panner = g.pan(pan * (0.23 + unison * 0.22))
      connect(channel, panner, output)
      if (category === 'Pure' && wave === 6) {
        const noise = context.createBufferSource()
        noise.buffer = bank.noise
        noise.loop = true
        noise.connect(channel)
        const phase = (this.note * 0.043 + 0.31 * (detune + 1)) % 1
        g.bufferSource(noise, this.started, bank.noise.duration * phase)
      } else if (category === 'Pure') {
        const pure = ['sine', 'triangle', 'sawtooth', 'square'] as const
        add(pure[wave] ?? bank.pulse(wave === 4 ? 0.33 : 0.1), 1, bias, channel)
      } else if (category === 'Sync') {
        syncRatios.forEach((ratio, index) => {
          const gain = g.gain(0)
          const weight = g.shape(syncCurves[index])
          controlBus.connect(weight)
          weight.connect(gain.gain)
          gain.connect(channel)
          add(bank.sync(wave, ratio), 1, bias, gain)
        })
      } else if (category === 'FM-H') {
        const carrier = add('sine', 1, bias, channel)
        const mod = g.gain(0)
        const ratio = 2
        add('sine', ratio, bias, mod)
        mod.connect(carrier.frequency)
        const strength = g.gain(0)
        controlBus.connect(strength)
        strength.connect(mod.gain)
        this.fmDepth.push({ gain: strength.gain, ratio })
      } else {
        const spread = category === 'Multi' ? [-1, 0, 1] : [-1, -0.54, -0.21, 0, 0.26, 0.62, 1]
        spread.forEach((offset, index) => {
          const voice = g.gain(1 / spread.length)
          if (category === 'Super') {
            const stereo = g.pan()
            g.depth(controlBus, stereo.pan, offset * 0.72)
            connect(voice, stereo, channel)
          } else voice.connect(channel)
          const osc = add(category === 'Super' && wave === 1 ? 'square' : 'sawtooth',
            category === 'Multi' && wave === 1 && index !== 1 ? (index === 0 ? 0.5 : 2) : 1,
            bias + offset * 2, voice)
          g.depth(controlBus, osc.detune, offset * (category === 'Multi' ? 36 : 68))
        })
      }
    }
    for (const { oscillator } of this.pitches) g.source(oscillator, this.started)
  }

  update(patch: SynthLayer, inputs: VoiceInputs, glide = false) {
    const state = this.patch = patch
    const g = this.graph
    const now = this.clock()
    const hz = frequency(this.note + state.coarse + state.fine / 100)
    const slide = this.portamento
    if (hz !== slide?.to) {
      const progress = slide && slide.duration > 0 ? clamp((now - slide.started) / slide.duration, 0, 1) : 1
      const from = slide ? slide.from * (slide.to / slide.from) ** progress : hz
      const seconds = glide && state.voice.mode !== 'Poly' && state.voice.glide
        ? Math.abs(12 * Math.log2(hz / from)) / (96 / (1 + 2 * state.voice.glide)) : 0
      for (const { oscillator, multiplier } of this.pitches) {
        if (!slide) oscillator.frequency.value = hz * multiplier
        else {
          oscillator.frequency.cancelScheduledValues(now)
          oscillator.frequency.setValueAtTime(from * multiplier, now)
          oscillator.frequency.exponentialRampToValueAtTime(hz * multiplier, now + Math.max(0.001, seconds))
        }
      }
      this.portamento = { from, to: hz, started: now, duration: seconds }
    }
    for (const { gain, ratio } of this.fmDepth) g.set(gain, hz * ratio * 1.8)
    g.set(this.placement.gain, this.zone)
    g.set(this.bend.offset, inputs.bend)
    g.set(this.oscControl.offset, state.control / 10)
    g.set(this.oscPitchAmount, state.osc.toPitch ? (state.osc.amount - 5) * 280 : 0)
    g.set(this.oscControlAmount, state.osc.toPitch ? 0 : (state.osc.amount - 5) / 5)
    const filterEnv = (state.filter.amount - 5) * 660
    g.set(this.filterEnvAmount, filterEnv)
    g.set(this.vibrato.oscillator.frequency, state.vibrato.rate)
    g.set(this.vibrato.gain, state.vibrato.amount * 5 *
      (state.vibrato.mode === 'On' ? 1 : state.vibrato.mode === 'Wheel' ? inputs.wheel : 0))
    const period = synthPeriod(state.lfo.rate, state.lfo.sync, inputs.tempo)
    for (const [wave, { source, level }] of Object.entries(this.lfo.waves)) {
      g.set(source.playbackRate, source.buffer!.duration / (wave === 'Sample & Hold' ? period * 16 : period))
      g.set(level.gain, Number(wave === state.lfo.wave))
    }
    const amount = state.lfo.amount / 10
    g.set(this.lfo.pitch, state.lfo.target === 'Osc Pitch' ? 125 * amount : 0)
    g.set(this.lfo.control, state.lfo.target === 'Osc Ctrl' ? 0.65 * amount : 0)
    g.set(this.lfo.filter, state.lfo.target === 'Filter Freq' ? 2300 * amount : 0)
    this.drive.mix(state.filter.on && state.filter.drive > 0, state.filter.drive / 3)
    g.set(this.driveGain, 1 + state.filter.drive * 0.78)
    this.filter.mix(state.filter.on)
    this.filterSecond.mix(state.filter.type === 'LP24')
    const [first, second] = this.tracking
    first.type = state.filter.type === 'HP' ? 'highpass' : state.filter.type === 'BP' ? 'bandpass' : 'lowpass'
    const cutoff = clamp(cutoffHz(state.filter.frequency) * 2 ** ((this.note - 60) / 12 * state.filter.tracking / 3),
      23, this.graph.context.sampleRate * 0.43)
    g.set(first.frequency, cutoff)
    g.set(second.frequency, cutoff)
    g.set(first.Q, first.type === 'bandpass' ? 0.65 + state.filter.resonance * 0.59 : -3 + 1.45 * state.filter.resonance)
    g.set(second.Q, 1.5 + 0.3 * state.filter.resonance)
  }

  retarget(note: number, velocity: number, zone: number, patch: SynthLayer, inputs: VoiceInputs, legato: boolean) {
    this.note = note
    this.velocity = velocity
    this.zone = zone
    this.update(patch, inputs, true)
    if (!legato) this.trigger(this.clock())
  }

  gate(open: boolean, hardness: number, period: number) {
    // Separate gain from the ADSR so gating preserves every note's envelope and pitch.
    const now = this.clock()
    const gain = this.gateGain.gain
    const previous = this.gateRamp
    const elapsed = clamp((now - previous.start) / previous.duration, 0, 1)
    const from = previous.from + elapsed * (previous.to - previous.from)
    const to = Number(open)
    const duration = Math.max(0.005, period * (0.24 - hardness * 0.021))
    this.gateRamp = { from, to, start: now, duration }
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(from, now)
    gain.linearRampToValueAtTime(to, now + duration)
  }

  private trigger(now: number) {
    const velocity = this.velocity / 127
    this.oscContour.trigger(now, this.patch.osc, this.patch.osc.velocity ? velocity : 1)
    this.filterContour.trigger(now, this.patch.filter, this.patch.filter.velocity ? velocity : 1)
    this.ampContour.trigger(now, this.patch.amp, 0.44 * (this.patch.amp.velocity ? 0.07 + 0.93 * velocity ** (this.patch.amp.velocity * 0.65) : 1))
  }

  release(seconds?: number) {
    this.scheduleRelease(this.clock(), seconds)
  }

  scheduleRelease(time: number, seconds?: number) {
    const tail = seconds ?? envelopeTime(this.patch.amp.release) * 3.5
    if (time + tail >= this.end) return
    this.end = time + tail
    this.ampContour.release(time, tail)
    this.oscContour.release(time, seconds ?? envelopeTime(this.patch.osc.release) * 3.5)
    this.filterContour.release(time, seconds ?? envelopeTime(this.patch.filter.release) * 3.5)
    this.graph.finish(this.end)
  }

  stop() { this.graph.dispose() }
}
