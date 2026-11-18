import { useCallback, useEffect, useRef, useState } from 'react'
import { bindMidi, browserMidi } from './midi'
import type { MidiStatus, RequestMidi } from './midi'
import { emptyKeys, localChannel, NoteLifecycle, uiPedalChannel } from './notes'
import { PianoAudio } from './sound'
import type { AudioEngine, AudioStatus } from './sound'
import { initialSettings } from './settings'
import type { Settings } from './settings'
import type { ProgramStorage } from '../instrument/programs'

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
  storage?: ProgramStorage | null
}

function handlesKeyboard(target: EventTarget | null, code: string) {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable]')) return true
  return code === 'Space' && Boolean(target.closest('summary, a, [role="slider"], button:not(.piano-key)'))
}

interface InstrumentRuntime {
  notes: NoteLifecycle
  output: AudioEngine
  tap(note: number): void
  panic(): void
}

export function useInstrument(environment?: InstrumentEnvironment, initial = initialSettings) {
  const engine = useRef<InstrumentRuntime | null>(null)
  const [settings, setSettings] = useState(initial)
  const current = useRef(settings)
  const [resetVersion, setResetVersion] = useState(0)
  const [pedal, setPedal] = useState(false)
  const [keys, setKeys] = useState(emptyKeys)
  const [audio, setAudio] = useState<AudioStatus>('loading')
  const [midi, setMidi] = useState<MidiStatus>('connecting')

  const configure = useCallback((next: Settings) => {
    if (current.current === next) return
    current.current = next
    engine.current?.output.configure?.(next)
    engine.current?.notes.refreshSustain()
    setSettings(next)
  }, [])

  const setPerformance = useCallback((source: 'wheel' | 'pedal', value: number) => {
    const settings = current.current
    configure({ ...settings, performance: { ...settings.performance, [source]: value } })
  }, [configure])

  const panic = useCallback((reset = true) => {
    engine.current?.panic()
    if (reset) {
      const settings = current.current
      configure({ ...settings, pitch: 0, performance: { pedal: 0, wheel: 0 } })
    }
  }, [configure])

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
      setResetVersion((version) => version + 1)
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
    const setPitch = (position: number) => configure({ ...current.current, pitch: position * 10 })
    const midiConnection = bindMidi(request, notes, setMidi, () => panic(), setPerformance, setPitch)
    engine.current = { notes, output, tap, panic: () => { midiConnection.reset(); stop() } }
    output.configure?.(current.current)
    output.prepare()

    const activate = () => output.activate()
    const reset = () => panic()
    const visibility = () => { if (doc.hidden) reset() }
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || handlesKeyboard(event.target, event.code)) return
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
    viewport.addEventListener('blur', reset)
    viewport.addEventListener('pagehide', reset)

    return () => {
      doc.removeEventListener('pointerdown', activate, true)
      doc.removeEventListener('click', activate, true)
      doc.removeEventListener('visibilitychange', visibility)
      viewport.removeEventListener('keydown', down)
      viewport.removeEventListener('keyup', up)
      viewport.removeEventListener('blur', reset)
      viewport.removeEventListener('pagehide', reset)
      midiConnection.dispose()
      stop()
      output.dispose()
      engine.current = null
    }
  }, [environment, configure, panic, setPerformance])

  return {
    keys, audio, midi, settings, pedal, resetVersion,
    configure, panic, setPerformance,
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
