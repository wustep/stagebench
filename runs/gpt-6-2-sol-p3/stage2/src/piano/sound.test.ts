// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it, vi } from 'vitest'
import { NoteLifecycle } from './notes'
import { PianoAudio, PianoRack } from './sound'
import type { PianoSample } from './sound'
import assets from './upright-bank.json'

const sampleRate = 44100
const arrayBuffer = async (file: string) => Uint8Array.from(
  await readFile(new URL(`../../public/samples/upright/${file}`, import.meta.url)),
).buffer

function rms(channel: Float32Array, from: number, to: number) {
  const window = channel.subarray(Math.round(from * sampleRate), Math.round(to * sampleRate))
  return Math.sqrt(window.reduce((sum, signal) => sum + signal * signal, 0) / window.length)
}

async function renderPiano(velocity: number, pedal: boolean, chord: number[] = [69], recorded = true) {
  const context = new OfflineAudioContext(2, sampleRate, sampleRate)
  const bank: PianoSample[] = []
  if (recorded) {
    for (const { root, layer, file } of assets) {
      if (!chord.some((note) => Math.abs(note - root) <= 2)) continue
      const buffer = await context.decodeAudioData(await arrayBuffer(file))
      bank.push({ root, layer: layer as PianoSample['layer'], buffer: buffer as unknown as AudioBuffer })
    }
  }

  let time = 0.012
  const output = new PianoRack(context as unknown as BaseAudioContext, () => time)
  output.setBank(bank)
  const ended = vi.fn()
  const play = output.play.bind(output)
  const life = new NoteLifecycle({
    play: (note, strike, onEnd) => play(note, strike, () => { ended(); onEnd() }),
    stopAll: () => output.stopAll(),
  }, () => {})

  for (const note of chord) life.press(`test-${note}`, note, velocity)
  life.sustain('local', pedal)
  time = 0.18
  for (const note of chord) life.release(`test-${note}`)
  time = 0.60
  life.sustain('local', false)

  const rendered = await context.startRendering()
  await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(chord.length))
  life.allNotesOff()
  output.dispose()
  expect(ended).toHaveBeenCalledTimes(chord.length)
  return rendered.getChannelData(0)
}

describe('offline piano signal', () => {
  it('renders a pitched recording with usable velocity response and transient headroom', async () => {
    const [soft, firm] = await Promise.all([renderPiano(38, false), renderPiano(112, false)])
    const low = rms(soft, 0.035, 0.15)
    const high = rms(firm, 0.035, 0.15)
    expect(low).toBeGreaterThan(0.001)
    expect(high).toBeGreaterThan(low * 2)
    expect(high).toBeLessThan(0.3)
    const amplitudeAt = (frequency: number) => {
      let real = 0
      let imaginary = 0
      for (let index = 2000; index < 7400; index++) {
        const angle = 2 * Math.PI * frequency * index / sampleRate
        real += firm[index] * Math.cos(angle)
        imaginary += firm[index] * Math.sin(angle)
      }
      return Math.hypot(real, imaginary)
    }
    expect(Math.max(amplitudeAt(438), amplitudeAt(440), amplitudeAt(442))).toBeGreaterThan(amplitudeAt(420) * 3)
  })

  it('sustains the recorded signal and returns to silence after pedal up', async () => {
    const [dry, held] = await Promise.all([renderPiano(100, false), renderPiano(100, true)])
    expect(rms(held, 0.37, 0.50)).toBeGreaterThan(0.002)
    expect(rms(dry, 0.37, 0.50)).toBeLessThan(0.00001)
    expect(rms(held, 0.8, 0.94)).toBeLessThan(0.00001)
  })

  it('renders a ten-note chord below clipping and an audible synthesized fallback', async () => {
    const chord = await renderPiano(127, false, [45, 48, 52, 55, 57, 60, 64, 67, 69, 72])
    expect(rms(chord, 0.035, 0.15)).toBeGreaterThan(0.02)
    expect(chord.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)).toBeLessThan(0.97)
    const fallback = await renderPiano(95, false, [69], false)
    expect(rms(fallback, 0.03, 0.12)).toBeGreaterThan(0.01)
    expect(rms(fallback, 0.38, 0.50)).toBeLessThan(0.00001)
  })

  it('ignores late sample results after disposal and surfaces an unavailable audio context', async () => {
    const context = vi.fn(() => { throw new Error('No Web Audio') })
    const update = vi.fn()
    let finish: ((bank: PianoSample[]) => void) | undefined
    const audio = new PianoAudio(update, {
      createContext: context,
      loadBank: () => new Promise((resolve) => { finish = resolve }),
    })
    audio.prepare()
    audio.activate()
    expect(update).toHaveBeenLastCalledWith('error')
    audio.dispose()
    finish?.([])
    await Promise.resolve()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
