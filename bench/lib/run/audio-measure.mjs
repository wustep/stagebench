// Harness-measured audio: load a candidate's built app in Chromium, feed it a
// fixed list of notes through a fake Web MIDI input, record what it renders
// through a tap on its AudioContext, and turn that into numbers (tuning,
// velocity, release, clicks, sustain, latency, polyphony, clipping) the rubric
// can score instead of a grader's listening claims.
//
// This file and ./audio-analysis.mjs are copied together into a box's /tools/
// directory and run there with the image's own Playwright passed in as
// `chromium`, so nothing here may import a package or another relative file.
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { analyzeSegment, envelope, summarizeSegments, toDb } from './audio-analysis.mjs'

export const AUDIO_PLAN_ID = 'stagebench-audio-1'

const TUNING_NOTES = [33, 45, 57, 60, 69, 81, 93]
const SCORED_TUNING_NOTES = [45, 57, 60, 69, 81]
const VELOCITIES = [16, 32, 48, 64, 80, 96, 112, 127]
const RELEASE_NOTES = [40, 64, 84]
// Ten distinct pitch classes; no tone sits on another's 2nd-8th harmonic, so
// each one's fundamental can only come from that tone.
const CHORD_NOTES = [48, 50, 52, 55, 57, 59, 61, 63, 65, 68]

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const held = (note, velocity, offMs) => [
  { atMs: 0, type: 'on', note, velocity },
  { atMs: offMs, type: 'off', note },
]

// The fixed plan, as data. Times are milliseconds at timeScale 1. MIDI goes
// out on channel 1; note-off is 0x80 with velocity 64; the pedal is CC64.
export const AUDIO_TEST_PLAN = deepFreeze({
  id: AUDIO_PLAN_ID,
  channel: 1,
  noteOffVelocity: 64,
  warmup: { note: 60, velocity: 100, offMs: 500, listenMs: 1200, maxTries: 25, soundingDbfs: -60, settleMs: 1000, networkIdleMs: 30_000 },
  segments: [
    ...TUNING_NOTES.map((note) => ({ id: `tuning-${note}`, kind: 'tuning', notes: [note], velocity: 96, scored: SCORED_TUNING_NOTES.includes(note), lengthMs: 2500, events: held(note, 96, 1200) })),
    ...VELOCITIES.map((velocity) => ({ id: `velocity-${velocity}`, kind: 'velocity', notes: [60], velocity, lengthMs: 1500, events: held(60, velocity, 600) })),
    ...RELEASE_NOTES.map((note) => ({ id: `release-${note}`, kind: 'release', notes: [note], velocity: 96, lengthMs: 4500, events: held(note, 96, 1500) })),
    {
      id: 'sustain',
      kind: 'sustain',
      notes: [64],
      velocity: 96,
      lengthMs: 4200,
      events: [
        { atMs: 0, type: 'cc', controller: 64, value: 127 },
        { atMs: 200, type: 'on', note: 64, velocity: 96 },
        { atMs: 700, type: 'off', note: 64 },
        { atMs: 2200, type: 'cc', controller: 64, value: 0 },
      ],
    },
    // A long hold, to catch sample-loop clicks.
    { id: 'hold-52', kind: 'hold', notes: [52], velocity: 96, lengthMs: 5000, events: held(52, 96, 4000) },
    {
      id: 'chord',
      kind: 'chord',
      notes: CHORD_NOTES,
      velocity: 100,
      lengthMs: 3500,
      events: [...CHORD_NOTES.map((note) => ({ atMs: 0, type: 'on', note, velocity: 100 })), ...CHORD_NOTES.map((note) => ({ atMs: 2000, type: 'off', note }))],
    },
  ],
})

export function midiBytes(event, plan = AUDIO_TEST_PLAN) {
  const channel = (plan.channel - 1) & 0x0f
  if (event.type === 'on') return [0x90 | channel, event.note, event.velocity]
  if (event.type === 'off') return [0x80 | channel, event.note, plan.noteOffVelocity]
  if (event.type === 'cc') return [0xb0 | channel, event.controller, event.value]
  throw new Error(`Unknown MIDI event type ${event.type}`)
}

// Page-side instrumentation, installed with context.addInitScript so it runs
// before any app script. It must be self-contained: it is stringified.
function instrumentPage() {
  const KEY = '__stagebenchAudio'
  if (window[KEY]) return
  const state = { midi: { requested: 0, listeners: 0, everListened: false }, taps: [], errors: [] }
  Object.defineProperty(window, KEY, { value: state, enumerable: false })
  const note = (error) => {
    if (state.errors.length < 20) state.errors.push(String((error && error.message) || error))
  }

  // ---- Fake Web MIDI: one connected input the harness can play. ----
  const registered = []
  let handler = null
  const captureOf = (options) => (typeof options === 'boolean' ? options : Boolean(options && options.capture))
  const syncListeners = () => {
    state.midi.listeners = registered.length + (handler ? 1 : 0)
    if (state.midi.listeners > 0) state.midi.everListened = true
  }
  class StagebenchMIDIInput extends EventTarget {
    constructor() {
      super()
      Object.assign(this, { id: 'stagebench-midi-in-1', name: 'Stagebench MIDI', manufacturer: 'Stagebench', version: '1.0', type: 'input', state: 'connected', connection: 'open', onstatechange: null })
      // The onmidimessage attribute fires during dispatch, like a real handler.
      EventTarget.prototype.addEventListener.call(this, 'midimessage', (event) => {
        if (handler) handler.call(this, event)
      })
    }
    get onmidimessage() {
      return handler
    }
    set onmidimessage(value) {
      handler = typeof value === 'function' ? value : null
      syncListeners()
    }
    addEventListener(type, listener, options) {
      super.addEventListener(type, listener, options)
      const capture = captureOf(options)
      if (type === 'midimessage' && listener && !registered.some((entry) => entry.listener === listener && entry.capture === capture)) {
        registered.push({ listener, capture })
        syncListeners()
      }
    }
    removeEventListener(type, listener, options) {
      super.removeEventListener(type, listener, options)
      const capture = captureOf(options)
      const index = registered.findIndex((entry) => entry.listener === listener && entry.capture === capture)
      if (type === 'midimessage' && index >= 0) {
        registered.splice(index, 1)
        syncListeners()
      }
    }
    open() {
      return Promise.resolve(this)
    }
    close() {
      return Promise.resolve(this)
    }
  }
  const input = new StagebenchMIDIInput()
  class StagebenchMIDIAccess extends EventTarget {
    constructor(sysex) {
      super()
      Object.assign(this, { inputs: new Map([[input.id, input]]), outputs: new Map(), sysexEnabled: sysex, onstatechange: null })
    }
  }
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function requestMIDIAccess(options) {
      state.midi.requested++
      return Promise.resolve(new StagebenchMIDIAccess(Boolean(options && options.sysex)))
    },
  })
  if (window.Permissions && Permissions.prototype.query) {
    const query = Permissions.prototype.query
    Permissions.prototype.query = function (descriptor, ...rest) {
      if (descriptor && descriptor.name === 'midi') return Promise.resolve({ name: 'midi', state: 'granted', onchange: null, addEventListener() {}, removeEventListener() {} })
      return query.call(this, descriptor, ...rest)
    }
  }
  const midiEvent = (bytes) => {
    const data = new Uint8Array(bytes)
    if (typeof MIDIMessageEvent === 'function') {
      try {
        return new MIDIMessageEvent('midimessage', { data })
      } catch {
        // Fall through to a plain Event carrying the same data.
      }
    }
    const event = new Event('midimessage')
    Object.defineProperty(event, 'data', { value: data, enumerable: true })
    return event
  }

  // ---- Audio tap: mirror everything that reaches a destination. ----
  const RealAudioContext = window.AudioContext
  const RealGainNode = window.GainNode
  const RealAudioWorkletNode = window.AudioWorkletNode
  if (!RealAudioContext || !window.AudioNode) return
  const nodeProto = AudioNode.prototype
  const originalConnect = nodeProto.connect
  const originalDisconnect = nodeProto.disconnect
  const tapsByContext = new WeakMap()
  const edges = new WeakMap()
  const CHUNK = 2048
  // Runs on the audio thread: batches ~2048 frames of the mixed-down input and
  // posts them with their start frame. Silent blocks still post (mono: null)
  // so the timeline has no unexplained gaps.
  const TAP_SOURCE = `
    class StagebenchTap extends AudioWorkletProcessor {
      constructor() { super(); this.buffer = new Float32Array(${CHUNK}); this.reset(); this.start = 0 }
      reset() { this.count = 0; this.clipped = 0; this.peak = 0; this.live = false }
      flush() {
        if (this.count === 0) return
        const mono = this.live ? this.buffer.slice(0, this.count) : null
        this.port.postMessage({ startFrame: this.start, frames: this.count, mono, clippedFrames: this.clipped, peakAbs: this.peak }, mono ? [mono.buffer] : [])
        this.reset()
      }
      process(inputs) {
        const channels = inputs[0] || []
        const frames = channels.length ? channels[0].length : 128
        if (this.count > 0 && (currentFrame !== this.start + this.count || this.count + frames > ${CHUNK})) this.flush()
        if (this.count === 0) this.start = currentFrame
        for (let i = 0; i < frames; i++) {
          let sum = 0
          let clip = false
          for (let c = 0; c < channels.length; c++) {
            const value = channels[c][i]
            const magnitude = value < 0 ? -value : value
            sum += value
            if (magnitude >= 0.999) clip = true
            if (magnitude > this.peak) this.peak = magnitude
          }
          const mono = channels.length ? sum / channels.length : 0
          if (mono !== 0) this.live = true
          this.buffer[this.count + i] = mono
          if (clip) this.clipped++
        }
        this.count += frames
        if (this.count >= ${CHUNK}) this.flush()
        return true
      }
    }
    registerProcessor('stagebench-tap', StagebenchTap)
  `
  let moduleUrl = null
  const tapModuleUrl = () => (moduleUrl ??= URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' })))

  const receive = (tap, chunk) => {
    let energy = 0
    if (chunk.mono) for (let i = 0; i < chunk.mono.length; i++) energy += chunk.mono[i] * chunk.mono[i]
    chunk.energy = energy
    tap.chunks.push(chunk)
    tap.lastFrame = Math.max(tap.lastFrame, chunk.startFrame + chunk.frames)
    if (chunk.peakAbs > tap.maxPeak) tap.maxPeak = chunk.peakAbs
    // Memory guard (~4 minutes per context); the harness prunes far sooner.
    if (tap.chunks.length > 6000) tap.chunks.splice(0, tap.chunks.length - 6000)
  }
  const wire = (tap, node) => {
    // collector -> tap -> silence -> destination, with the original connect so
    // the mirror never mirrors itself.
    const mute = new RealGainNode(tap.context, { gain: 0 })
    originalConnect.call(tap.collector, node)
    originalConnect.call(node, mute)
    originalConnect.call(mute, tap.context.destination)
  }
  const attachTap = async (tap) => {
    const { context } = tap
    try {
      await context.audioWorklet.addModule(tapModuleUrl())
      const node = new RealAudioWorkletNode(context, 'stagebench-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      node.port.onmessage = (event) => receive(tap, event.data)
      wire(tap, node)
      tap.kind = 'audio-worklet'
    } catch (error) {
      tap.error = String((error && error.message) || error)
      try {
        const node = context.createScriptProcessor(CHUNK, 2, 1)
        node.onaudioprocess = (event) => {
          const buffer = event.inputBuffer
          const channels = []
          for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
          const mono = new Float32Array(buffer.length)
          let clipped = 0
          let peak = 0
          let live = false
          for (let i = 0; i < buffer.length; i++) {
            let sum = 0
            let clip = false
            for (const channel of channels) {
              const magnitude = Math.abs(channel[i])
              sum += channel[i]
              if (magnitude >= 0.999) clip = true
              if (magnitude > peak) peak = magnitude
            }
            mono[i] = channels.length ? sum / channels.length : 0
            if (mono[i] !== 0) live = true
            if (clip) clipped++
          }
          // The input block was captured one buffer before its playbackTime;
          // approximate, which is why the record names the tap in use.
          const startFrame = Math.max(0, Math.round(event.playbackTime * context.sampleRate) - buffer.length)
          receive(tap, { startFrame, frames: buffer.length, mono: live ? mono : null, clippedFrames: clipped, peakAbs: peak })
        }
        wire(tap, node)
        tap.kind = 'script-processor'
      } catch (fallbackError) {
        tap.error += `; ${String((fallbackError && fallbackError.message) || fallbackError)}`
      }
    }
  }
  const register = (context) => {
    const tap = { index: state.taps.length, context, sampleRate: context.sampleRate, kind: null, error: null, chunks: [], lastFrame: 0, maxPeak: 0, collector: new RealGainNode(context) }
    state.taps.push(tap)
    tapsByContext.set(context, tap)
    attachTap(tap)
  }
  // Real-time contexts only: OfflineAudioContext renders are not output.
  const wrap = (Real) =>
    new Proxy(Real, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget)
        try {
          register(context)
        } catch (error) {
          note(error)
        }
        return context
      },
    })
  const webkit = window.webkitAudioContext
  window.AudioContext = wrap(RealAudioContext)
  if (webkit) window.webkitAudioContext = webkit === RealAudioContext ? window.AudioContext : wrap(webkit)

  const isSink = (node) => node instanceof AudioDestinationNode || (typeof MediaStreamAudioDestinationNode === 'function' && node instanceof MediaStreamAudioDestinationNode)
  const mirroredOutputs = (map) => {
    const outputs = new Set()
    for (const set of map.values()) for (const output of set) outputs.add(output)
    return outputs
  }
  nodeProto.connect = function connect(...args) {
    const result = originalConnect.apply(this, args)
    try {
      const [destination, output] = args
      const tap = destination && isSink(destination) ? tapsByContext.get(this.context) : null
      if (tap) {
        const out = output === undefined ? 0 : Number(output)
        let map = edges.get(this)
        if (!map) edges.set(this, (map = new Map()))
        const before = mirroredOutputs(map)
        if (!map.has(destination)) map.set(destination, new Set())
        map.get(destination).add(out)
        if (!before.has(out)) originalConnect.call(this, tap.collector, out, 0)
      }
    } catch (error) {
      note(error)
    }
    return result
  }
  nodeProto.disconnect = function disconnect(...args) {
    const result = originalDisconnect.apply(this, args)
    try {
      const map = edges.get(this)
      if (map && map.size) {
        const [target, output] = args
        if (args.length === 0 || target === undefined) {
          // disconnect() dropped every connection, the mirror included.
          map.clear()
        } else if (typeof target === 'number') {
          // disconnect(output) dropped that output's mirror too.
          for (const [sink, set] of map) {
            set.delete(target)
            if (!set.size) map.delete(sink)
          }
        } else if (map.has(target)) {
          const before = mirroredOutputs(map)
          if (output === undefined) map.delete(target)
          else {
            const set = map.get(target)
            set.delete(Number(output))
            if (!set.size) map.delete(target)
          }
          const after = mirroredOutputs(map)
          const tap = tapsByContext.get(this.context)
          for (const out of before) if (!after.has(out)) originalDisconnect.call(this, tap.collector, out, 0)
        }
      }
    } catch (error) {
      note(error)
    }
    return result
  }

  // ---- Harness API (called from Node through page.evaluate). ----
  const stamp = () => state.taps.map((tap) => (tap.context.state === 'closed' ? null : Math.round(tap.context.currentTime * tap.sampleRate)))
  state.runSegment = (events, lengthMs) =>
    new Promise((resolve) => {
      const t0 = performance.now()
      const startFrames = stamp()
      const log = []
      const groups = new Map()
      events.forEach((event, index) => {
        if (!groups.has(event.at)) groups.set(event.at, [])
        groups.get(event.at).push({ ...event, index })
      })
      for (const [at, group] of groups) {
        setTimeout(() => {
          for (const event of group) {
            // Stamp before dispatch: the app's handler runs synchronously inside it.
            const frames = stamp()
            const time = performance.now() - t0
            try {
              input.dispatchEvent(midiEvent(event.bytes))
            } catch (error) {
              note(error)
            }
            log.push({ index: event.index, time, frames })
          }
        }, Math.max(0, at - (performance.now() - t0)))
      }
      setTimeout(() => resolve({ startFrames, endFrames: stamp(), sampleRates: state.taps.map((tap) => tap.sampleRate), log, elapsedMs: performance.now() - t0 }), Math.max(0, lengthMs - (performance.now() - t0)))
    })
  state.waitForFrames = (targets, timeoutMs) =>
    new Promise((resolve) => {
      const deadline = performance.now() + timeoutMs
      const check = () => {
        const ready = targets.every((target, index) => {
          const tap = state.taps[index]
          return target === null || target === undefined || !tap || !tap.kind || tap.context.state !== 'running' || tap.lastFrame >= target
        })
        if (ready || performance.now() > deadline) resolve(ready)
        else setTimeout(check, 10)
      }
      check()
    })
  const overlapping = (tap, from, to) => tap.chunks.filter((chunk) => chunk.startFrame < to && chunk.startFrame + chunk.frames > from)
  state.windowStats = (index, from, to) => {
    const tap = state.taps[index]
    if (!tap) return null
    let energy = 0
    let clippedFrames = 0
    let peakAbs = 0
    let live = false
    for (const chunk of overlapping(tap, from, to)) {
      // Chunk granularity (~43 ms) is plenty for totals.
      if (chunk.startFrame >= from) {
        clippedFrames += chunk.clippedFrames
        peakAbs = Math.max(peakAbs, chunk.peakAbs)
      }
      energy += chunk.energy
      if (chunk.mono) live = true
    }
    return { sampleRate: tap.sampleRate, energy, clippedFrames, peakAbs, live }
  }
  state.readWindow = (index, from, to) => {
    const tap = state.taps[index]
    const out = new Float32Array(Math.max(0, to - from))
    // Frames no block covered (the render clock skipped, or a block never
    // arrived) read as zeros; report them so analysis can tell a gap from a cut.
    const gaps = []
    let cursor = from
    for (const chunk of overlapping(tap, from, to).sort((a, b) => a.startFrame - b.startFrame)) {
      const a = Math.max(from, chunk.startFrame)
      const b = Math.min(to, chunk.startFrame + chunk.frames)
      if (a > cursor) gaps.push([cursor - from, a - from])
      cursor = Math.max(cursor, b)
      if (chunk.mono) out.set(chunk.mono.subarray(a - chunk.startFrame, b - chunk.startFrame), a - from)
    }
    if (cursor < to) gaps.push([cursor - from, to - from])
    const bytes = new Uint8Array(out.buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return { from, frames: out.length, gaps, audio: btoa(binary) }
  }
  state.prune = (index, beforeFrame) => {
    const tap = state.taps[index]
    if (tap) tap.chunks = tap.chunks.filter((chunk) => chunk.startFrame + chunk.frames > beforeFrame)
  }
  state.snapshot = () => ({
    midi: { ...state.midi },
    errors: state.errors.slice(),
    taps: state.taps.map((tap) => ({ index: tap.index, sampleRate: tap.sampleRate, kind: tap.kind, error: tap.error, state: tap.context.state, maxPeak: tap.maxPeak, lastFrame: tap.lastFrame })),
  })
}

export const INSTRUMENT_SOURCE = `(${instrumentPage.toString()})();`

const PREROLL_SECONDS = 0.1
const SIGNAL_PEAK = 10 ** (-60 / 20)

class CandidateFailure extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind
  }
}

function emptyRecord(phase, timeScale) {
  return {
    version: 1,
    plan: AUDIO_PLAN_ID,
    phase: phase === undefined || phase === null ? null : Number(phase),
    measuredAt: new Date().toISOString(),
    browser: null,
    timeScale,
    status: 'failed',
    failure: null,
    environment: {
      sampleRate: null,
      audioContexts: 0,
      contextsWithSignal: 0,
      tap: null,
      midi: { requested: 0, listeners: 0 },
      unlockClick: null,
      consoleErrors: [],
      pageErrors: [],
    },
    segments: [],
    summary: null,
    scores: null,
  }
}

// In-flight request tracking: Playwright's own 'networkidle' only fires once
// per navigation, and the harness needs it again after the warm-up notes.
function trackNetwork(page) {
  const inflight = new Set()
  let lastChange = Date.now()
  page.on('request', (request) => {
    inflight.add(request)
    lastChange = Date.now()
  })
  const done = (request) => {
    inflight.delete(request)
    lastChange = Date.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return {
    async waitForIdle(timeoutMs, quietMs = 500) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (inflight.size === 0 && Date.now() - lastChange >= quietMs) return true
        await sleep(50)
      }
      return false
    },
  }
}

function decodeFloat32(base64) {
  const bytes = Buffer.from(base64, 'base64')
  const samples = new Float32Array(bytes.length / 4)
  new Uint8Array(samples.buffer).set(bytes)
  return samples
}

async function play(page, events, lengthMs) {
  const run = await page.evaluate(({ events: list, lengthMs: length }) => window.__stagebenchAudio.runSegment(list, length), { events, lengthMs })
  // Let the tap deliver the blocks that cover the segment's last frame.
  await page.evaluate((targets) => window.__stagebenchAudio.waitForFrames(targets, 1500), run.endFrames)
  return run
}

// Start frame of a segment on one context; a context born mid-segment is
// placed by its first stamped event.
function segmentStartFrame(run, index, sampleRate) {
  const start = run.startFrames[index]
  if (start !== null && start !== undefined) return start
  const first = run.log.find((entry) => entry.frames[index] !== null && entry.frames[index] !== undefined)
  return first ? Math.max(0, first.frames[index] - Math.round((first.time / 1000) * sampleRate)) : null
}

// Pull the audio of one played segment from every context that had signal.
async function collect(page, run) {
  const windows = []
  for (let index = 0; index < run.endFrames.length; index++) {
    const end = run.endFrames[index]
    const sampleRate = run.sampleRates[index]
    if (end === null || end === undefined || !sampleRate) continue
    const start = segmentStartFrame(run, index, sampleRate)
    if (start === null) continue
    const preroll = Math.round(PREROLL_SECONDS * sampleRate)
    const from = Math.max(0, start - preroll)
    const totals = await page.evaluate(([tap, a, b]) => window.__stagebenchAudio.windowStats(tap, a, b), [index, start, end])
    if (!totals) continue
    const entry = { tap: index, sampleRate, from, start, end, energy: totals.energy, clippedFrames: totals.clippedFrames, peakAbs: totals.peakAbs, samples: null }
    if (totals.live) {
      const read = await page.evaluate(([tap, a, b]) => window.__stagebenchAudio.readWindow(tap, a, b), [index, from, end])
      entry.samples = decodeFloat32(read.audio)
      entry.gaps = read.gaps
    }
    windows.push(entry)
    // Keep a little before this segment's end for the next segment's preroll.
    await page.evaluate(([tap, before]) => window.__stagebenchAudio.prune(tap, before), [index, end - 2 * preroll])
  }
  return windows
}

function loudestEnvelopeDb(windows) {
  let best = -Infinity
  for (const entry of windows) {
    if (!entry.samples) continue
    const { values } = envelope(entry.samples, entry.sampleRate)
    let peak = 0
    for (const value of values) if (value > peak) peak = value
    best = Math.max(best, toDb(peak))
  }
  return best
}

function scaleEvents(segment, timeScale, plan) {
  return segment.events.map((event) => ({ at: event.atMs * timeScale, bytes: midiBytes(event, plan) }))
}

// Sample index (into the window) of each plan event on the chosen context.
function eventMarks(segment, run, entry, timeScale) {
  const marks = { start: entry.start - entry.from }
  const at = (eventIndex) => {
    const logged = run.log.find((item) => item.index === eventIndex)
    const frame = logged?.frames[entry.tap]
    if (frame !== null && frame !== undefined) return frame - entry.from
    return marks.start + Math.round(((segment.events[eventIndex].atMs * timeScale) / 1000) * entry.sampleRate)
  }
  segment.events.forEach((event, index) => {
    if (event.type === 'on' && marks.on === undefined) marks.on = at(index)
    if (event.type === 'off' && marks.off === undefined) marks.off = at(index)
    if (event.type === 'cc' && event.controller === 64 && event.value >= 64 && marks.pedalDown === undefined) marks.pedalDown = at(index)
    if (event.type === 'cc' && event.controller === 64 && event.value < 64 && marks.pedalUp === undefined) marks.pedalUp = at(index)
  })
  return marks
}

async function snapshot(page) {
  try {
    return await page.evaluate(() => window.__stagebenchAudio?.snapshot() ?? null)
  } catch {
    return null
  }
}

async function runMeasurement(browser, record, { url, timeScale, midiWaitMs, log, plan, onSegmentAudio }) {
  const environment = record.environment
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' })
  await context.addInitScript(INSTRUMENT_SOURCE)
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error' && environment.consoleErrors.length < 10) environment.consoleErrors.push(message.text().slice(0, 500))
  })
  page.on('pageerror', (error) => {
    if (environment.pageErrors.length < 10) environment.pageErrors.push(String(error?.message ?? error).slice(0, 500))
  })
  let crashed = false
  page.on('crash', () => {
    crashed = true
  })
  const network = trackNetwork(page)
  const refresh = async () => {
    const snap = await snapshot(page)
    if (!snap) return null
    environment.midi = { requested: snap.midi.requested, listeners: snap.midi.listeners }
    environment.audioContexts = snap.taps.length
    environment.contextsWithSignal = snap.taps.filter((tap) => tap.maxPeak >= SIGNAL_PEAK).length
    return snap
  }
  try {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
    } catch (error) {
      throw new CandidateFailure('page-error', `Navigation failed: ${error.message.split('\n')[0]}`)
    }
    await network.waitForIdle(20_000)
    log('page loaded')

    // One real click in the corner, the only UI interaction: enough to satisfy
    // an app that waits for a gesture before starting its AudioContext.
    const target = await page.evaluate(() => {
      const element = document.elementFromPoint(2, 2)
      if (!element) return null
      const className = typeof element.className === 'string' ? element.className : element.getAttribute('class') || ''
      return { tag: element.tagName.toLowerCase(), id: element.id || null, class: className.slice(0, 120) || null }
    })
    await page.mouse.click(2, 2)
    environment.unlockClick = { x: 2, y: 2, target }

    const listening = await page
      .waitForFunction(() => window.__stagebenchAudio?.midi.listeners > 0, null, { timeout: midiWaitMs, polling: 50 })
      .then(
        () => true,
        () => false,
      )
    await refresh()
    if (crashed) throw new CandidateFailure('page-error', 'The page crashed')
    if (!listening) {
      const asked = environment.midi.requested ? 'requested MIDI access but never listened for midimessage' : 'never requested MIDI access'
      throw new CandidateFailure('no-midi', `Within ${midiWaitMs} ms the app ${asked}`)
    }
    log('MIDI listener attached')

    // Warm-up: repeat middle C until something sounds (lazy sample loading).
    const { warmup } = plan
    let attempts = 0
    let sounded = false
    while (attempts < warmup.maxTries && !sounded) {
      attempts++
      const events = [
        { atMs: 0, type: 'on', note: warmup.note, velocity: warmup.velocity },
        { atMs: warmup.offMs, type: 'off', note: warmup.note },
      ]
      const run = await play(page, events.map((event) => ({ at: event.atMs * timeScale, bytes: midiBytes(event, plan) })), warmup.listenMs * timeScale)
      const windows = await collect(page, run)
      sounded = loudestEnvelopeDb(windows) >= warmup.soundingDbfs
      if (crashed) throw new CandidateFailure('page-error', 'The page crashed')
    }
    environment.warmupAttempts = attempts
    if (!sounded) {
      const snap = await refresh()
      const detail = snap?.taps.length ? `${snap.taps.length} AudioContext(s) created, tap ${snap.taps.map((tap) => tap.kind ?? tap.error ?? 'pending').join(', ')}` : 'no AudioContext was created'
      throw new CandidateFailure('no-audio', `Middle C never reached ${warmup.soundingDbfs} dBFS in ${attempts} tries (${detail})`)
    }
    log(`warm-up sounded after ${attempts} tr${attempts === 1 ? 'y' : 'ies'}`)
    await network.waitForIdle(warmup.networkIdleMs)
    await sleep(warmup.settleMs * timeScale)

    const played = []
    for (const segment of plan.segments) {
      const run = await play(page, scaleEvents(segment, timeScale, plan), segment.lengthMs * timeScale)
      played.push({ segment, run, windows: await collect(page, run) })
      if (crashed) throw new CandidateFailure('page-error', 'The page crashed')
      log(`played ${segment.id}`)
    }

    const snap = await refresh()
    // The primary context is the one that rendered the most energy.
    const energy = new Map()
    for (const { windows } of played) for (const entry of windows) energy.set(entry.tap, (energy.get(entry.tap) ?? 0) + entry.energy)
    let primary = null
    for (const [tap, total] of energy) if (primary === null || total > energy.get(primary)) primary = tap
    if (primary === null) throw new CandidateFailure('no-audio', 'No AudioContext was running during the test segments')
    const primaryTap = snap?.taps[primary]
    environment.sampleRate = primaryTap?.sampleRate ?? null
    environment.tap = primaryTap?.kind ?? null
    environment.primaryContext = primary

    let clippedFrames = 0
    let peak = 0
    record.segments = played.map(({ segment, run, windows }) => {
      let entry = windows.find((item) => item.tap === primary)
      if (!entry) {
        // The primary context existed but had nothing for this segment.
        const sampleRate = environment.sampleRate
        const start = segmentStartFrame(run, primary, sampleRate) ?? 0
        const end = run.endFrames[primary] ?? start + Math.round(((segment.lengthMs * timeScale) / 1000) * sampleRate)
        const from = Math.max(0, start - Math.round(PREROLL_SECONDS * sampleRate))
        entry = { tap: primary, sampleRate, from, start, end, clippedFrames: 0, peakAbs: 0, samples: null }
      }
      const samples = entry.samples ?? new Float32Array(Math.max(0, entry.end - entry.from))
      clippedFrames += entry.clippedFrames
      peak = Math.max(peak, entry.peakAbs)
      const marks = eventMarks(segment, run, entry, timeScale)
      const analyzed = analyzeSegment(segment, samples, entry.sampleRate, marks, { timeScale, gaps: entry.gaps ?? [] })
      if (onSegmentAudio) {
        try {
          onSegmentAudio({ id: segment.id, samples, sampleRate: entry.sampleRate, marks })
        } catch {
          // An evidence hook must not break a measurement.
        }
      }
      analyzed.clippedMs = Math.round((entry.clippedFrames / entry.sampleRate) * 10_000) / 10
      return analyzed
    })
    environment.tapGapFrames = record.segments.reduce((sum, segment) => sum + segment.tapGapFrames, 0)
    const { summary, scores } = summarizeSegments(record.segments, { sampleRate: environment.sampleRate, contextsWithSignal: environment.contextsWithSignal, clippedFrames, peakAbs: peak })
    record.summary = summary
    record.scores = scores
    record.status = 'measured'
  } catch (error) {
    // A crash mid-evaluate surfaces as Playwright's "Target closed".
    if (crashed && !(error instanceof CandidateFailure)) throw new CandidateFailure('page-error', 'The page crashed')
    throw error
  } finally {
    await refresh().catch(() => null)
    await context.close().catch(() => {})
  }
}

// Never throws for a candidate's failure: the record says what went wrong.
// onSegmentAudio({ id, samples, sampleRate, marks }) optionally receives each
// segment's recorded mono audio (marks are sample indices), e.g. to keep WAVs.
export async function measureAudio({ url, chromium, phase = null, timeScale = 1, midiWaitMs = 30_000, timeoutMs = 300_000, onLog, onSegmentAudio, plan = AUDIO_TEST_PLAN } = {}) {
  const log = (message) => {
    try {
      onLog?.(message)
    } catch {
      // A logging callback must not break a measurement.
    }
  }
  const record = emptyRecord(phase, timeScale)
  let browser = null
  let timedOut = false
  let timer = null
  try {
    if (!url) throw new Error('A URL is required')
    if (!(timeScale > 0)) throw new Error('timeScale must be positive')
    if (!chromium) {
      try {
        ;({ chromium } = await import('playwright'))
      } catch {
        throw new Error('Playwright is required: pass `chromium` or install playwright')
      }
    }
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
    record.browser = `Playwright Chromium ${browser.version()}`
    timer = setTimeout(() => {
      timedOut = true
      browser.close().catch(() => {})
    }, timeoutMs)
    await runMeasurement(browser, record, { url, timeScale, midiWaitMs, log, plan, onSegmentAudio })
  } catch (error) {
    record.status = 'failed'
    record.summary = null
    record.scores = null
    if (timedOut) record.failure = { kind: 'timeout', detail: `Measurement exceeded ${timeoutMs} ms` }
    else if (error instanceof CandidateFailure) record.failure = { kind: error.kind, detail: error.message }
    else record.failure = { kind: 'harness-error', detail: String(error?.message ?? error).split('\n')[0] }
    log(`failed: ${record.failure.kind}: ${record.failure.detail}`)
  } finally {
    clearTimeout(timer)
    await browser?.close().catch(() => {})
  }
  return record
}

export function writeMeasurementRecord(file, record) {
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
}
