import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { StageAudio, StagePianoEngine, initialStageState } from './stage'
import { arpStep, factoryPrograms, loadPrograms, morphed, programSnapshot, waveforms, zoneGain } from './system'
import type { Voice } from './piano'

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Phase 3 canonical system', () => {
  it('ships 32 numbered programs and eight different factory voices; snapshots exclude performance level', () => {
    const state = initialStageState(), programs = factoryPrograms(state)
    expect(programs).toHaveLength(32)
    expect(new Set(programs.slice(0, 8).map(p => p.name)).size).toBe(8)
    expect(programs[3].state.organOn).toBe(true)
    expect(programs[6].state.synthOn).toBe(true)
    const before = programSnapshot(state)
    state.master = .01; state.pitch = .9; state.wheel = 1; state.pedal = 1
    expect(programSnapshot(state)).toEqual(before)
    const bank = loadPrograms(initialStageState(), localStorage)
    expect(bank.live).toHaveLength(8)
    bank.slots[31] = { name: 'Edited', state: programSnapshot(state) as Record<string, unknown> }
    localStorage.setItem('stage4-programs-v3', JSON.stringify(bank))
    expect(loadPrograms(initialStageState(), localStorage).slots[31]).toEqual(bank.slots[31])
  })

  it('routes four zones and fades linearly around all active split positions', () => {
    const splits = [{ on: true, note: 48, fade: 0 }, { on: true, note: 60, fade: 6 }, { on: true, note: 72, fade: 12 }] as ReturnType<typeof initialStageState>['splits']
    expect(zoneGain(40, [0, 0], splits)).toBe(1)
    expect(zoneGain(50, [0, 0], splits)).toBe(0)
    expect(zoneGain(60, [1, 1], splits)).toBeCloseTo(.5)
    expect(zoneGain(60, [2, 2], splits)).toBeCloseTo(.5)
    expect(zoneGain(84, [3, 3], splits)).toBe(1)
  })

  it('interpolates and clears independent Wheel and Control Pedal destinations', () => {
    const state = initialStageState()
    state.morphs.Wheel['organ.A.level'] = { from: .3, to: .8 }
    state.morphs['Control Pedal']['organ.A.level'] = { from: .3, to: .1 }
    expect(morphed(.3, state.morphs, 'organ.A.level', .5, 0)).toBeCloseTo(.55)
    expect(morphed(.3, state.morphs, 'organ.A.level', 0, 1)).toBeCloseTo(.1)
    state.morphs.Wheel = {}
    expect(morphed(.3, state.morphs, 'organ.A.level', 1, 0)).toBeCloseTo(.3)
  })

  it('has distinct required source names and deterministic arp direction and range', () => {
    expect(waveforms).toHaveLength(14)
    expect(waveforms).toContain('FM 2-op (algorithm A)')
    expect([0,1,2,3].map(step => arpStep([60,64], step, 'Up', 2))).toEqual([60,64,72,76])
    expect([0,1,2].map(step => arpStep([60,64], step, 'Down', 1))).toEqual([64,60,64])
    expect([0,1,2,3].map(step => arpStep([60,64,67], step, 'Up/Down', 1))).toEqual([60,64,67,64])
    expect(arpStep([], 0, 'Random', 4)).toBeNull()
  })

  it('routes organ and synth notes through owned voices and releases on Panic', () => {
    const state = initialStageState(); state.pianoOn = false; state.organOn = true; state.organ.A.enabled = true; state.synthOn = true; state.synth.C.enabled = true
    const started: string[] = [], stopped: string[] = []
    const make = (key: string): Voice => { started.push(key); return { release() {}, stop() { stopped.push(key) } } }
    const engine = new StagePianoEngine((key) => make(`Piano:${key}`), () => state, 24, key => make(key))
    engine.noteOn('test', 60)
    expect(started).toEqual(['Organ:A', 'Synth:C'])
    engine.allNotesOff()
    expect(stopped).toEqual(started)
    expect(engine.soundingCount).toBe(0)
  })

  it('steps a synced running arpeggiator and cancels its timers on Panic', () => {
    vi.useFakeTimers()
    const state = initialStageState(); state.pianoOn = false; state.synthOn = true; state.synth.A.enabled = true; state.synth.A.arpRun = true; state.synth.A.arpSync = true; state.tempo = 120
    const notes: number[] = [], stopped: number[] = []
    const engine = new StagePianoEngine(() => ({ release() {}, stop() {} }), () => state, 24, (_key, note) => { notes.push(note); return { release() {}, stop() { stopped.push(note) } } })
    engine.noteOn('one', 60); engine.noteOn('two', 64)
    vi.advanceTimersByTime(1500)
    expect(notes.length).toBeGreaterThan(2)
    engine.allNotesOff()
    const count = notes.length
    vi.advanceTimersByTime(2000)
    expect(notes).toHaveLength(count)
    expect(stopped.length).toBeGreaterThan(0)
  })

  it('builds distinct Organ and Synth voice graphs inside one shared context and closes them', async () => {
    vi.useFakeTimers()
    class Param { value = 0; setValueAtTime(v: number) { this.value = v } linearRampToValueAtTime(v: number) { this.value = v } exponentialRampToValueAtTime(v: number) { this.value = v } cancelScheduledValues() {} }
    class Node { connects: unknown[] = []; gain = new Param(); frequency = new Param(); detune = new Param(); pan = new Param(); threshold = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); Q = new Param(); delayTime = new Param(); playbackRate = new Param(); type = ''; curve: Float32Array | null = null; buffer: unknown; loop = false; onended: unknown; constructor(readonly label: string) {} connect(target: unknown) { this.connects.push(target); return target as Node } disconnect() { this.connects = [] } start() {} stop() {} }
    class Context { state = 'running'; currentTime = 0; sampleRate = 8000; destination = new Node('destination'); nodes: Node[] = []; closed = false; make(label: string) { const n = new Node(label); this.nodes.push(n); return n } createGain() { return this.make('gain') } createDynamicsCompressor() { return this.make('limiter') } createStereoPanner() { return this.make('pan') } createWaveShaper() { return this.make('drive') } createOscillator() { return this.make('oscillator') } createBufferSource() { return this.make('buffer') } createBiquadFilter() { return this.make('filter') } createDelay() { return this.make('delay') } createConvolver() { return this.make('reverb') } createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) } } resume() { return Promise.resolve() } close() { this.closed = true; return Promise.resolve() } decodeAudioData() { return Promise.resolve({}) } }
    const ctx = new Context(), state = initialStageState(), audio = new StageAudio(() => state, () => {}, async () => ({ ok: false }) as Response, () => ctx as unknown as AudioContext)
    const fingerprints: string[] = []
    for (const model of ['B3','Vox','Farf','Pipe 1'] as const) { state.organ.A.model = model; const before = ctx.nodes.length; audio.startLayer('Organ:A', 60, 100); fingerprints.push(JSON.stringify(ctx.nodes.slice(before).filter(n => n.label === 'oscillator').map(n => [n.type, n.frequency.value, n.gain.value]))) }
    expect(new Set(fingerprints).size).toBe(4)
    const synthPrints: string[] = []
    for (const waveform of ['Sine','Sync Saw','Multi Saw','Super Saw','FM 2-op (algorithm A)'] as const) { state.synth.A.waveform = waveform; const before = ctx.nodes.length; audio.startLayer('Synth:A', 60, 100); synthPrints.push(JSON.stringify(ctx.nodes.slice(before).filter(n => n.label === 'oscillator').map(n => [n.type, n.frequency.value, n.detune.value]))) }
    expect(new Set(synthPrints).size).toBe(5)
    expect(ctx.nodes.filter(n => n.connects.includes(ctx.destination))).toHaveLength(1)
    expect(audio.contextCount).toBe(1)
    await audio.close()
    expect(ctx.closed).toBe(true)
    expect(audio.liveVoiceCount).toBe(0)
  })
})

describe('Phase 3 panel', () => {
  const backend = { start: () => ({ release() {}, stop() {} }) }
  it('stores a renamed program, discards later edits on selection, and restores the name', () => {
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Store As' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Program name' }), { target: { value: 'My Stage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Store' }))
    expect(screen.getByRole('status').textContent).toContain('My Stage')
    fireEvent.change(screen.getByRole('combobox', { name: 'Piano type' }), { target: { value: 'Electric' } })
    expect(screen.getByRole('status').textContent).toContain(' E')
    fireEvent.click(screen.getByRole('button', { name: 'Next program' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous program' }))
    expect(screen.getByRole('combobox', { name: 'Piano type' })).toHaveValue('Grand')
    expect(screen.getByRole('status').textContent).toContain('My Stage')
  })

  it('edits splits, scenes, morph input, organ model and synth source from accessible controls', () => {
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mid split on' }))
    expect(screen.getByRole('button', { name: 'Mid split on' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByRole('combobox', { name: 'Mid split crossfade' }), { target: { value: '12' } })
    expect(screen.getByRole('combobox', { name: 'Mid split crossfade' })).toHaveValue('12')
    fireEvent.click(screen.getByRole('button', { name: 'Scene II' }))
    expect(screen.getByRole('button', { name: 'Scene II' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByRole('slider', { name: 'Morph Wheel' }), { target: { value: '80' } })
    expect(screen.getByRole('slider', { name: 'Morph Wheel' })).toHaveValue('80')
    fireEvent.change(screen.getByRole('combobox', { name: 'Organ model' }), { target: { value: 'Vox' } })
    expect(screen.getByRole('combobox', { name: 'Organ model' })).toHaveValue('Vox')
    fireEvent.change(screen.getByRole('combobox', { name: 'Synth waveform' }), { target: { value: 'Super Saw' } })
    expect(screen.getByRole('combobox', { name: 'Synth waveform' })).toHaveValue('Super Saw')
    fireEvent.click(screen.getByRole('button', { name: 'Panic' }))
    expect(screen.getByRole('slider', { name: 'Morph Wheel' })).toHaveValue('0')
  })
})
