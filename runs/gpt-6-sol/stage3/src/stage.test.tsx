import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { StageAudio, StagePianoEngine, createEffectUnit, initialStageState, nearestRoot, pianoTypes, recordedTypes, routeStageMidi, sampleRoots, unitTypes, velocityGain } from './stage'
import type { LayerId, StageState } from './stage'
import type { Voice } from './piano'

afterEach(() => { cleanup(); vi.useRealTimers() })

function fakeLayerEngine(state: StageState) {
  const started: { layer: LayerId; note: number; velocity: number; released: number; stopped: number }[] = []
  const engine = new StagePianoEngine((layer, note, velocity): Voice => {
    const entry = { layer, note, velocity, released: 0, stopped: 0 }; started.push(entry)
    return { release() { entry.released++ }, stop() { entry.stopped++ } }
  }, () => state)
  return { engine, started }
}

describe('Phase 2 piano ownership and performance', () => {
  it('plays enabled layers at independent octave offsets and stops only the disabled layer', () => {
    const state = initialStageState(); state.layers.B.enabled = true; state.layers.B.octave = 12
    const { engine, started } = fakeLayerEngine(state)
    engine.noteOn('keyboard:a', 60, 50)
    expect(started.map(v => [v.layer, v.note, v.velocity])).toEqual([['A', 60, 50], ['B', 72, 50]])
    engine.stopLayer('B')
    expect(started[1].stopped).toBe(1)
    expect(started[0].stopped).toBe(0)
    engine.noteOff('keyboard:a', 60)
    expect(started[0].released).toBe(1)
    expect(engine.soundingCount).toBe(0)
  })

  it('routes sustain only through SUSTPED, including MIDI CC64 and keyboard-like sources', () => {
    const state = initialStageState(); state.layers.B.enabled = true; state.layers.B.sustped = false
    const { engine, started } = fakeLayerEngine(state)
    routeStageMidi(engine, 'midi:1', [0x90, 61, 110])
    routeStageMidi(engine, 'midi:1', [0xb0, 64, 127])
    routeStageMidi(engine, 'midi:1', [0x80, 61, 0])
    expect(started[0].released).toBe(0)
    expect(started[1].released).toBe(1)
    routeStageMidi(engine, 'midi:1', [0xb0, 64, 0])
    expect(started[0].released).toBe(1)
    engine.noteOn('keyboard:a', 60)
    engine.setSustain('keyboard:sustain', true)
    engine.noteOff('keyboard:a', 60)
    expect(started[2].released).toBe(0)
    engine.setSustain('keyboard:sustain', false)
    expect(started[2].released).toBe(1)
  })

  it('shapes dynamics in the expected direction without changing velocity-selected source identity', () => {
    const state = initialStageState(), layer = state.layers.A
    const mediumSoft = velocityGain(30, layer), mediumHard = velocityGain(110, layer)
    expect(mediumHard).toBeGreaterThan(mediumSoft)
    layer.kbTouch = 'Heavy'; const heavySoft = velocityGain(30, layer)
    layer.kbTouch = 'Light'; const lightSoft = velocityGain(30, layer)
    expect(heavySoft).toBeLessThan(mediumSoft)
    expect(lightSoft).toBeGreaterThan(mediumSoft)
    layer.dynComp = 3
    expect(velocityGain(30, layer)).toBeGreaterThan(lightSoft)
  })

  it('has six selectable playable types and bounded recorded roots for every key', () => {
    expect(pianoTypes).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    for (const type of recordedTypes) {
      expect(sampleRoots[type].length).toBeGreaterThanOrEqual(8)
      for (const note of [28, 36, 48, 60, 72, 84, 100]) expect(Math.abs(nearestRoot(type, note).note - note)).toBeLessThanOrEqual(10)
    }
  })
})

function pcm(type: 'grand' | 'upright' | 'electric', dynamic: 'soft' | 'hard'): Float32Array {
  const bytes = readFileSync(`tests/fixtures/pcm/${type}-${dynamic}.f32`)
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)

describe('recorded offline sample boundary', () => {
  it('bundles every referenced sample with exact file provenance and decodable non-silent PCM', () => {
    const details = JSON.parse(readFileSync('IMPLEMENTATION_DETAILS.json', 'utf8'))
    const sets = details.audio.sampleSources as { name: string; source: string; license: string; files: string[] }[]
    expect(sets).toHaveLength(3)
    for (const set of sets) {
      expect(set.name.length).toBeGreaterThan(0)
      expect(set.source.length).toBeGreaterThan(0)
      expect(set.license.length).toBeGreaterThan(0)
      expect(set.files.length).toBeGreaterThan(0)
    }
    const documented = new Set(sets.flatMap(set => set.files))
    const actual = readdirSync('public/samples', { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => `public/${item.parentPath.replace(/^public\//, '')}/${item.name}`)
    expect(new Set(actual)).toEqual(documented)
    for (const type of recordedTypes) for (const root of sampleRoots[type]) for (const path of [root.soft, root.hard]) {
      expect(existsSync(`public/${path}`)).toBe(true)
      const file = `public/${path}`
      expect(documented.has(file)).toBe(true)
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(details.audio.sampleChecksums[file])
      expect(Number.isInteger(details.audio.sampleRootNotes[file])).toBe(true)
      expect(typeof details.audio.sampleVelocityLayers[file]).toBe('string')
    }
    for (const type of recordedTypes) {
      const root = nearestRoot(type, 60)
      const soft = pcm(type.toLowerCase() as 'grand' | 'upright' | 'electric', 'soft'), hard = pcm(type.toLowerCase() as 'grand' | 'upright' | 'electric', 'hard')
      expect(rms(soft)).toBeGreaterThan(0.0001)
      expect(rms(hard)).toBeGreaterThan(0.0001)
      expect(readFileSync(`public/${root.soft}`).equals(readFileSync(`public/${root.hard}`))).toBe(false)
    }
  })

  it('renders distinct Grand, Upright, and Electric recorded waveforms', () => {
    const waves = recordedTypes.map(type => pcm(type.toLowerCase() as 'grand' | 'upright' | 'electric', 'hard'))
    const energies = waves.map(rms)
    expect(energies.every(value => value > 0.0001)).toBe(true)
    for (let i = 0; i < waves.length; i++) for (let j = i + 1; j < waves.length; j++) {
      const length = Math.min(waves[i].length, waves[j].length)
      let difference = 0
      for (let n = 0; n < length; n++) difference += Math.abs(waves[i][n] - waves[j][n])
      expect(difference / length).toBeGreaterThan(0.0001)
    }
  })
})

describe('Phase 2 panel bindings', () => {
  const backend = { start: () => ({ release() {}, stop() {} }) }
  it('changes canonical Piano layer controls and effects focus from visible inputs', () => {
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Focus Piano B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Piano B' }))
    expect(screen.getByRole('button', { name: 'Enable Piano B' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Focus effects Piano B' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByRole('combobox', { name: 'Piano type' }), { target: { value: 'Electric' } })
    expect(screen.getByRole('combobox', { name: 'Piano type' })).toHaveValue('Electric')
    fireEvent.change(screen.getByRole('combobox', { name: 'Piano octave shift' }), { target: { value: '12' } })
    expect(screen.getByRole('combobox', { name: 'Piano octave shift' })).toHaveValue('12')
    fireEvent.change(screen.getByRole('combobox', { name: 'Dyn Comp' }), { target: { value: '3' } })
    expect(screen.getByRole('combobox', { name: 'Dyn Comp' })).toHaveValue('3')
    fireEvent.click(screen.getByRole('button', { name: 'mod1 bypass' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'mod1 type' }), { target: { value: 'Ring Mod' } })
    expect(screen.getByRole('combobox', { name: 'mod1 type' })).toHaveValue('Ring Mod')
    fireEvent.click(screen.getByRole('button', { name: 'All effects' }))
    expect(screen.getByRole('button', { name: 'All effects' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('exposes every required effect type and global capable unit', () => {
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    for (const [unit, types] of Object.entries(unitTypes)) if (types.length > 1) {
      const select = screen.getByRole('combobox', { name: `${unit} type` })
      expect([...select.querySelectorAll('option')].map(o => o.value)).toEqual(types)
    }
    for (const unit of ['delay', 'compressor', 'reverb']) expect(screen.getByRole('button', { name: `${unit} global` })).toBeInTheDocument()
  })
})

describe('production Web Audio graph lifecycle', () => {
  it('constructs distinct processing graphs for every effect type and changes wet and feedback nodes', () => {
    class Param { value = 0; setValueAtTime(v: number) { this.value = v } linearRampToValueAtTime(v: number) { this.value = v } exponentialRampToValueAtTime(v: number) { this.value = v } cancelScheduledValues() {} }
    class Node { connects: unknown[] = []; type = ''; frequency = new Param(); gain = new Param(); delayTime = new Param(); Q = new Param(); pan = new Param(); threshold = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); curve?: Float32Array; buffer?: { length: number }; constructor(readonly label: string) {} connect(target: unknown) { this.connects.push(target); return target as Node } disconnect() {} start() {} stop() {} }
    class Context { currentTime = 0; sampleRate = 1000; nodes: Node[] = []; make(label: string) { const node = new Node(label); this.nodes.push(node); return node } createGain() { return this.make('gain') } createStereoPanner() { return this.make('pan') } createOscillator() { return this.make('osc') } createBiquadFilter() { return this.make('filter') } createDelay() { return this.make('delay') } createWaveShaper() { return this.make('drive') } createDynamicsCompressor() { return this.make('compressor') } createConvolver() { return this.make('reverb') } createBuffer(_channels: number, length: number) { return { length, getChannelData: () => new Float32Array(length) } } }
    const state = initialStageState()
    for (const id of ['mod1', 'mod2', 'ampEq', 'reverb'] as const) {
      const fingerprints: string[] = []
      for (const type of unitTypes[id]) {
        if (type === 'To Rotary') continue // selected routing is tested at the layer graph
        const ctx = new Context(), setting = { ...state.layers.A.units[id], type }
        const unit = createEffectUnit(ctx as unknown as AudioContext, id, setting)
        expect((unit.input as unknown as Node).connects.length).toBeGreaterThan(0)
        const fingerprint = JSON.stringify(ctx.nodes.map(n => [n.label, n.type, n.frequency.value, n.gain.value, n.delayTime.value, n.Q.value, n.pan.value, n.curve?.[700], n.buffer?.length]))
        fingerprints.push(fingerprint)
        unit.dispose()
      }
      expect(new Set(fingerprints).size).toBe(fingerprints.length)
    }
    const dryCtx = new Context(), wetCtx = new Context()
    createEffectUnit(dryCtx as unknown as AudioContext, 'delay', { ...state.layers.A.units.delay, wet: 0, feedback: 0.1, filter: 'Off' })
    createEffectUnit(wetCtx as unknown as AudioContext, 'delay', { ...state.layers.A.units.delay, wet: 1, feedback: 0.8, filter: 'LP' })
    expect(dryCtx.nodes.map(n => n.gain.value)).not.toEqual(wetCtx.nodes.map(n => n.gain.value))
    expect(wetCtx.nodes.find(n => n.type === 'lowpass')?.frequency.value).toBe(1100)
  })

  it('creates one context, one limiter destination and cleans all owned voices on close', async () => {
    vi.useFakeTimers()
    class Param { value = 0; setValueAtTime(v: number) { this.value = v } linearRampToValueAtTime(v: number) { this.value = v } exponentialRampToValueAtTime(v: number) { this.value = v } cancelScheduledValues() {} }
    class Node { connects: unknown[] = []; gain = new Param(); frequency = new Param(); detune = new Param(); pan = new Param(); threshold = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); Q = new Param(); delayTime = new Param(); playbackRate = new Param(); type = ''; curve: Float32Array | null = null; buffer: unknown; onended?: () => void; connect(target: unknown) { this.connects.push(target); return target as Node } disconnect() { this.connects = [] } start() {} stop() {} }
    class Context { state = 'running'; currentTime = 0; sampleRate = 8000; destination = new Node(); nodes: Node[] = []; closed = false; make() { const n = new Node(); this.nodes.push(n); return n } createGain() { return this.make() } createDynamicsCompressor() { return this.make() } createStereoPanner() { return this.make() } createWaveShaper() { return this.make() } createOscillator() { return this.make() } createBiquadFilter() { return this.make() } createDelay() { return this.make() } createConvolver() { return this.make() } createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) } } resume() { return Promise.resolve() } close() { this.closed = true; return Promise.resolve() } decodeAudioData() { return Promise.resolve({}) } }
    const ctx = new Context(), state = initialStageState(), statuses: string[] = []
    const audio = new StageAudio(() => state, s => statuses.push(s), async () => ({ ok: false }) as Response, () => ctx as unknown as AudioContext)
    audio.startLayer('A', 60, 30)
    audio.startLayer('A', 64, 120)
    await audio.whenLoaded()
    expect(audio.contextCount).toBe(1)
    expect(audio.liveVoiceCount).toBe(2)
    expect(ctx.nodes.filter(n => n.connects.includes(ctx.destination))).toHaveLength(1)
    const graph = audio as unknown as { levels: Record<LayerId, Node>; rotary: { input: Node }; master: Node }
    state.rotaryOn = true; state.layers.A.units.ampEq.on = true; state.layers.A.units.ampEq.type = 'To Rotary'; audio.applyState()
    expect(graph.levels.A.connects).toContain(graph.rotary.input)
    state.effectsOn = false; audio.applyState()
    expect(graph.levels.A.connects).toContain(graph.master)
    expect(graph.levels.A.connects).not.toContain(graph.rotary.input)
    state.master = 0.15; audio.applyState()
    await audio.close()
    expect(audio.liveVoiceCount).toBe(0)
    expect(ctx.closed).toBe(true)
    expect(statuses).toContain('loading')
    expect(statuses).toContain('fallback')
  })
})
