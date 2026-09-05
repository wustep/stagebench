import { describe, expect, it, vi } from 'vitest'
import { BrowserAudio, PianoEngine, pianoSignal, velocityGain, type AudioBoundary } from './audio'
export function fakeAudio() {
  const voices: { midi: number; velocity: number; release: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; ended: () => void }[] = []
  const audio: AudioBoundary = { start: vi.fn(async () => {}), voice: vi.fn((midi, velocity, ended) => { const voice = { midi, velocity, release: vi.fn(), stop: vi.fn(), ended }; voices.push(voice); return voice }), close: vi.fn() }
  return { audio, voices }
}
const energy = (signal: Float32Array) => signal.reduce((n, s) => n + s * s, 0) / signal.length

describe('basic generated piano signal', () => {
  it('is non-silent, deterministic, pitched and decaying with velocity response', () => {
    const soft = pianoSignal(60, 1), high = pianoSignal(72, 1)
    expect(energy(soft)).toBeGreaterThan(.005)
    expect([...soft]).toEqual([...pianoSignal(60, 1)])
    expect([...soft]).not.toEqual([...high])
    expect(energy(soft.slice(100, 1000))).toBeGreaterThan(energy(soft.slice(-2000)))
    expect(energy(soft) * velocityGain(120) ** 2).toBeGreaterThan(energy(soft) * velocityGain(40) ** 2 * 4)
    expect([...pianoSignal(100, .2)].every(Number.isFinite)).toBe(true)
  })
})
describe('owned note lifecycle', () => {
  it('supports overlapping same pitch, release and natural node cleanup', async () => {
    const { audio, voices } = fakeAudio(); const engine = new PianoEngine(audio)
    await engine.on('one', 60, 32); await engine.on('two', 60, 110)
    expect(voices.map(v => v.velocity)).toEqual([32, 110])
    engine.off('one'); expect(voices[0].release).toHaveBeenCalledOnce(); expect(voices[1].release).not.toHaveBeenCalled()
    voices[0].ended(); expect(engine.notes.size).toBe(1)
    engine.allOff(); expect(voices[1].stop).toHaveBeenCalledOnce(); expect(engine.notes.size).toBe(0)
  })
  it('retrigger stops only the old owner and an old callback cannot remove its replacement', async () => {
    const { audio, voices } = fakeAudio(); const engine = new PianoEngine(audio)
    await engine.on('a', 60); await engine.on('a', 60)
    expect(voices[0].stop).toHaveBeenCalledOnce(); voices[0].ended(); expect(engine.notes.size).toBe(1)
  })
  it('sustain combines independent sources and releases only after the final pedal is up', async () => {
    const { audio, voices } = fakeAudio(); const engine = new PianoEngine(audio)
    await engine.on('a', 60); engine.sustain('ui', true); engine.sustain('midi', true); engine.off('a')
    expect(voices[0].release).not.toHaveBeenCalled(); engine.sustain('ui', false); expect(voices[0].release).not.toHaveBeenCalled()
    engine.sustain('midi', false); expect(voices[0].release).toHaveBeenCalledOnce()
  })
  it('steals released then sustained then oldest held voices deterministically', async () => {
    const { audio, voices } = fakeAudio(); const engine = new PianoEngine(audio, 2)
    await engine.on('a', 60); await engine.on('b', 62); engine.off('b'); await engine.on('c', 64)
    expect(voices[1].stop).toHaveBeenCalledOnce(); expect([...engine.notes.keys()]).toEqual(['a', 'c'])
    engine.sustain('ui', true); engine.off('c'); await engine.on('d', 65); expect([...engine.notes.keys()]).toEqual(['a', 'd'])
    await engine.on('e', 67); expect([...engine.notes.keys()]).toEqual(['d', 'e'])
    engine.dispose(); expect(engine.notes.size).toBe(0); expect(engine.pedals.size).toBe(0); expect(audio.close).toHaveBeenCalledOnce()
  })
  it('does not start notes released or disposed during asynchronous activation', async () => {
    let ready!: () => void
    const { audio, voices } = fakeAudio(); audio.start = () => new Promise(resolve => { ready = resolve })
    const engine = new PianoEngine(audio); const on = engine.on('a', 60)
    expect(engine.status).toBe('loading'); engine.off('a'); ready(); await on
    expect(engine.status).toBe('ready'); expect(voices).toHaveLength(0)
    engine.dispose(); const later = engine.on('b', 61); engine.dispose(); ready(); await later
    expect(voices).toHaveLength(0); expect(engine.status).toBe('idle')
  })
  it('reports activation errors truthfully and supports retry', async () => {
    const { audio } = fakeAudio(); audio.start = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined)
    const engine = new PianoEngine(audio); await engine.on('a', 60)
    expect(engine.status).toBe('error'); expect(engine.error).toBe('denied'); expect(engine.notes.size).toBe(0)
    await engine.on('b', 60); expect(engine.status).toBe('ready')
  })
  it('disconnects all browser audio nodes, routes each source through master, and clears onended', async () => {
    const nodes: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended?: (() => void) | null; stop: ReturnType<typeof vi.fn> }[] = []
    const node = () => { const n = { connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn(), start: vi.fn(), gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, onended: null }; nodes.push(n); return n }
    const context = { state: 'running', currentTime: 0, destination: {}, createGain: node, createBufferSource: node, createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }), close: vi.fn(async () => {}) }
    const audio = new BrowserAudio(() => context as unknown as AudioContext); await audio.start()
    const ended = vi.fn(); const voice = audio.voice(60, 90, ended)
    expect(nodes[0].connect).toHaveBeenCalledWith(context.destination); expect(nodes[1].connect).toHaveBeenCalledWith(nodes[2]); expect(nodes[2].connect).toHaveBeenCalledWith(nodes[0])
    voice.release(); expect(nodes[1].stop).toHaveBeenCalledWith(.22)
    nodes[1].onended?.(); voice.stop(); expect(ended).toHaveBeenCalledOnce()
    audio.close(); expect(nodes.every(n => n.disconnect.mock.calls.length === 1)).toBe(true); expect(nodes[1].onended).toBeNull()
  })
})
