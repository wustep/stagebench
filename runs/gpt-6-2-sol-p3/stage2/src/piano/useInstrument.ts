import { useCallback, useEffect, useRef, useState } from 'react'
import { bindMidi, browserMidi } from './midi'
import type { MidiStatus, RequestMidi } from './midi'
import { emptyKeys, localChannel, NoteLifecycle, uiPedalChannel } from './notes'
import { PianoAudio } from './sound'
import type { AudioEngine, AudioStatus } from './sound'
import { initialSettings } from './settings'
import type { Settings } from './settings'

const lower = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash']
const upper = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft', 'Equal', 'BracketRight']
export const mappedKeys = new Map([
  ...lower.map((code, index): [string, number] => [code, 48 + index]),
  ...upper.map((code, index): [string, number] => [code, 60 + index]),
])

export interface InstrumentEnvironment {
  createAudio(status: (state: AudioStatus) => void): AudioEngine
  requestMidi(): RequestMidi | undefined
  window: Window
  document: Document
}

function isControl(target: EventTarget | null) {
  return target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable], summary, a, [role="slider"], button:not(.piano-key)'))
}

interface InstrumentRuntime {
  notes: NoteLifecycle
  output: AudioEngine
  tap(note: number): void
}

export function useInstrument(environment?: InstrumentEnvironment) {
  const engine = useRef<InstrumentRuntime | null>(null)
  const [settings, setSettings] = useState(initialSettings)
  const current = useRef(settings)
  const [pedal, setPedal] = useState(false)
  const [keys, setKeys] = useState(emptyKeys)
  const [audio, setAudio] = useState<AudioStatus>('loading')
  const [midi, setMidi] = useState<MidiStatus>('connecting')

  useEffect(() => {
    const doc = environment?.document ?? document
    const viewport = environment?.window ?? window
    const output = environment?.createAudio(setAudio) ?? new PianoAudio(setAudio)
    const request = environment ? environment.requestMidi() : browserMidi()
    const notes = new NoteLifecycle(output, setKeys)
    const taps = new Map<number, number>()
    const stop = () => {
      for (const timer of taps.values()) viewport.clearTimeout(timer)
      taps.clear()
      notes.allNotesOff()
      setPedal(false)
    }
    const tap = (note: number) => {
      if (taps.has(note)) return
      const token = `virtual:${note}`
      notes.press(token, note, 86)
      taps.set(note, viewport.setTimeout(() => {
        taps.delete(note)
        notes.release(token)
      }, 150))
    }
    engine.current = { notes, output, tap }
    output.configure?.(current.current)
    output.prepare()
    const midiConnection = bindMidi(request, notes, setMidi, stop)

    const activate = () => output.activate()
    const panic = () => {
      midiConnection.reset()
      stop()
    }
    const visibility = () => { if (doc.hidden) panic() }
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isControl(event.target)) return
      const note = mappedKeys.get(event.code)
      if (note === undefined && event.code !== 'Space') return
      event.preventDefault()
      if (event.repeat) return
      if (note === undefined) notes.sustain(localChannel, true)
      else notes.press(`computer:${event.code}`, note, 88)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') notes.sustain(localChannel, false)
      else if (mappedKeys.has(event.code)) notes.release(`computer:${event.code}`)
    }

    doc.addEventListener('pointerdown', activate, true)
    doc.addEventListener('click', activate, true)
    doc.addEventListener('visibilitychange', visibility)
    viewport.addEventListener('keydown', down)
    viewport.addEventListener('keyup', up)
    viewport.addEventListener('blur', panic)
    viewport.addEventListener('pagehide', panic)

    return () => {
      doc.removeEventListener('pointerdown', activate, true)
      doc.removeEventListener('click', activate, true)
      doc.removeEventListener('visibilitychange', visibility)
      viewport.removeEventListener('keydown', down)
      viewport.removeEventListener('keyup', up)
      viewport.removeEventListener('blur', panic)
      viewport.removeEventListener('pagehide', panic)
      midiConnection.dispose()
      stop()
      output.dispose()
      engine.current = null
    }
  }, [environment])

  const configure = useCallback((next: Settings) => {
    if (current.current === next) return
    current.current = next
    engine.current?.output.configure?.(next)
    engine.current?.notes.refreshSustain()
    setSettings(next)
  }, [])

  return {
    keys, audio, midi, settings, pedal,
    configure,
    togglePedal() {
      engine.current?.output.activate()
      engine.current?.notes.sustain(uiPedalChannel, !pedal)
      setPedal(!pedal)
    },
    press: (token: string, note: number, velocity: number) => engine.current?.notes.press(token, note, velocity),
    release: (token: string) => engine.current?.notes.release(token),
    tap: (note: number) => engine.current?.tap(note),
  }
}
