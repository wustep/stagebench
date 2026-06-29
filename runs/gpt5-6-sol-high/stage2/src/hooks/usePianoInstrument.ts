import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PianoEngine, type PianoAudioSettings, type PianoTimbre, type PianoType, type ReverbType } from '../audio/PianoEngine'

const hasMidiSupport = () => typeof navigator !== 'undefined' && typeof (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function'

export type PianoState = PianoAudioSettings & {
  activeLayer: 0 | 1
  status: string
  midiStatus: string
}

const INITIAL_STATE: PianoState = {
  layers: [
    { enabled: true, level: 78, sustain: true, type: 'Grand', variation: 42 },
    { enabled: true, level: 55, sustain: true, type: 'Upright', variation: 58 },
  ],
  activeLayer: 0,
  masterLevel: 65,
  mono: false,
  stringResonance: true,
  dynComp: false,
  pedalNoise: true,
  softRelease: false,
  timbre: 'Mid',
  unison: 24,
  reverbOn: true,
  reverbMix: 37,
  reverbSize: 56,
  reverbType: 'Stage',
  status: 'Ready · play a key to start audio',
  midiStatus: hasMidiSupport() ? 'MIDI · checking' : 'MIDI · unsupported',
}

const TYPE_NAMES: Record<PianoType, string[]> = {
  Grand: ['Royal Grand 3D', 'White Grand', 'Studio Grand 2', 'Soft Grand'],
  Upright: ['Pearl Upright', 'Amber Upright', 'Bambino Upright', 'Felt Upright'],
  'E.Piano': ['EP Mk I', 'EP Mk II', 'Wurlitzer 2', 'Digital EP'],
  'Clav / Hps': ['Clavinet D6', 'Harpsichord 1', 'Clav Wah', 'Italian Harpsichord'],
  Digital: ['Digital Grand', 'DX Tines', 'Layer Piano', 'Glass Piano'],
  Misc: ['Felt Piano', 'Toy Piano', 'Pianet N', 'Prepared Piano'],
}

export const COMPUTER_KEY_MAP: Readonly<Record<string, number>> = {
  KeyZ: 48, KeyS: 49, KeyX: 50, KeyD: 51, KeyC: 52, KeyV: 53,
  KeyG: 54, KeyB: 55, KeyH: 56, KeyN: 57, KeyJ: 58, KeyM: 59,
  KeyQ: 60, Digit2: 61, KeyW: 62, Digit3: 63, KeyE: 64, KeyR: 65,
  Digit5: 66, KeyT: 67, Digit6: 68, KeyY: 69, Digit7: 70, KeyU: 71,
  KeyI: 72, Digit9: 73, KeyO: 74, Digit0: 75, KeyP: 76,
}

const KEY_LABELS = Object.fromEntries(Object.entries(COMPUTER_KEY_MAP).map(([code, note]) => [note, code.replace('Key', '').replace('Digit', '')])) as Record<number, string>

export function getComputerKeyLabel(note: number) {
  return KEY_LABELS[note]
}

export function getPianoName(type: PianoType, variation: number) {
  const names = TYPE_NAMES[type]
  const index = Math.min(names.length - 1, Math.floor((variation / 101) * names.length))
  return names[index]
}

type ActiveInput = { note: number; velocity: number }

export function usePianoInstrument() {
  const [state, setState] = useState<PianoState>(INITIAL_STATE)
  const [activeNotes, setActiveNotes] = useState<Set<number>>(() => new Set())
  const stateRef = useRef(state)
  const engineRef = useRef<PianoEngine | null>(null)
  const enginePromiseRef = useRef<Promise<PianoEngine> | null>(null)
  const activeInputs = useRef(new Map<string, ActiveInput>())
  const heldCounts = useRef(new Map<number, number>())
  const sustainSources = useRef(new Set<string>())

  useEffect(() => { stateRef.current = state }, [state])

  const setContext = useCallback((status: string) => {
    setState((current) => ({ ...current, status }))
  }, [])

  const ensureEngine = useCallback(() => {
    if (enginePromiseRef.current) return enginePromiseRef.current
    const promise = Promise.resolve().then(async () => {
      const engine = engineRef.current ?? new PianoEngine(stateRef.current)
      engineRef.current = engine
      await engine.resume()
      engine.setSustain(sustainSources.current.size > 0)
      setContext('Audio ready · sampled piano')
      return engine
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Audio could not start'
      setContext(message)
      throw error
    }).finally(() => {
      if (enginePromiseRef.current === promise) enginePromiseRef.current = null
    })
    enginePromiseRef.current = promise
    return promise
  }, [setContext])

  useEffect(() => {
    engineRef.current?.updateSettings(state)
  }, [state])

  useEffect(() => {
    const prime = () => {
      if (engineRef.current || enginePromiseRef.current) return
      try {
        engineRef.current = new PianoEngine(stateRef.current)
      } catch {
        // A visible status is supplied when a user explicitly tries to start audio.
      }
    }
    const idleWindow = window as Window & { requestIdleCallback?: Window['requestIdleCallback'] }
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const id = idleWindow.requestIdleCallback(prime, { timeout: 1200 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(prime, 180)
    return () => window.clearTimeout(id)
  }, [])

  const refreshActiveNotes = useCallback(() => {
    setActiveNotes(new Set([...heldCounts.current.entries()].filter(([, count]) => count > 0).map(([note]) => note)))
  }, [])

  const noteOff = useCallback((sourceId: string) => {
    const active = activeInputs.current.get(sourceId)
    if (!active) return
    activeInputs.current.delete(sourceId)
    const nextCount = (heldCounts.current.get(active.note) ?? 1) - 1
    if (nextCount <= 0) heldCounts.current.delete(active.note)
    else heldCounts.current.set(active.note, nextCount)
    refreshActiveNotes()
    engineRef.current?.noteOff(sourceId)
  }, [refreshActiveNotes])

  const noteOn = useCallback((note: number, velocity = 0.82, sourceId = `note:${note}`) => {
    const previous = activeInputs.current.get(sourceId)
    if (previous) noteOff(sourceId)
    const normalizedVelocity = Math.min(1, Math.max(0.02, velocity))
    activeInputs.current.set(sourceId, { note, velocity: normalizedVelocity })
    heldCounts.current.set(note, (heldCounts.current.get(note) ?? 0) + 1)
    refreshActiveNotes()
    void ensureEngine().then((engine) => {
      if (activeInputs.current.get(sourceId)?.note === note) engine.noteOn(note, normalizedVelocity, sourceId)
    }).catch(() => undefined)
  }, [ensureEngine, noteOff, refreshActiveNotes])

  const allNotesOff = useCallback((immediate = false) => {
    activeInputs.current.clear()
    heldCounts.current.clear()
    sustainSources.current.clear()
    setActiveNotes(new Set())
    engineRef.current?.allNotesOff(immediate)
  }, [])

  const setSustain = useCallback((source: string, down: boolean) => {
    if (down) sustainSources.current.add(source)
    else sustainSources.current.delete(source)
    engineRef.current?.setSustain(sustainSources.current.size > 0)
    setContext(down ? 'Sustain pedal · down' : 'Sustain pedal · released')
  }, [setContext])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        setSustain('computer-pedal', true)
        return
      }
      const note = COMPUTER_KEY_MAP[event.code]
      if (note === undefined) return
      event.preventDefault()
      noteOn(note, event.shiftKey ? 1 : 0.78, `computer:${event.code}`)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSustain('computer-pedal', false)
        return
      }
      if (COMPUTER_KEY_MAP[event.code] !== undefined) noteOff(`computer:${event.code}`)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [noteOff, noteOn, setSustain])

  useEffect(() => {
    const safeStop = () => allNotesOff(true)
    const onVisibility = () => { if (document.hidden) safeStop() }
    window.addEventListener('blur', safeStop)
    window.addEventListener('pagehide', safeStop)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', safeStop)
      window.removeEventListener('pagehide', safeStop)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [allNotesOff])

  useEffect(() => {
    if (!hasMidiSupport()) return
    let cancelled = false
    let access: MIDIAccess | undefined
    const boundInputs = new Set<MIDIInput>()
    const onMessage = (event: MIDIMessageEvent) => {
      const status = event.data?.[0] ?? 0
      const data1 = event.data?.[1] ?? 0
      const data2 = event.data?.[2] ?? 0
      const command = status & 0xf0
      const channel = status & 0x0f
      const inputId = (event.currentTarget as MIDIInput | null)?.id ?? 'input'
      if (command === 0x90 && data2 > 0) noteOn(data1, data2 / 127, `midi:${inputId}:${channel}:${data1}`)
      else if (command === 0x80 || (command === 0x90 && data2 === 0)) noteOff(`midi:${inputId}:${channel}:${data1}`)
      else if (command === 0xb0 && data1 === 64) setSustain(`midi-pedal:${inputId}:${channel}`, data2 >= 64)
      else if (command === 0xb0 && (data1 === 120 || data1 === 123)) allNotesOff(true)
    }
    const bindInputs = () => {
      if (!access) return
      for (const input of boundInputs) input.onmidimessage = null
      boundInputs.clear()
      for (const input of access.inputs.values()) {
        input.onmidimessage = onMessage
        boundInputs.add(input)
      }
      if (!cancelled) setState((current) => ({ ...current, midiStatus: access && access.inputs.size > 0 ? `MIDI · ${access.inputs.size} input${access.inputs.size === 1 ? '' : 's'}` : 'MIDI · no device' }))
    }
    void navigator.requestMIDIAccess({ sysex: false }).then((midiAccess) => {
      if (cancelled) return
      access = midiAccess
      bindInputs()
      access.onstatechange = bindInputs
    }).catch(() => {
      if (!cancelled) setState((current) => ({ ...current, midiStatus: 'MIDI · permission unavailable' }))
    })
    return () => {
      cancelled = true
      if (access) access.onstatechange = null
      for (const input of boundInputs) input.onmidimessage = null
    }
  }, [allNotesOff, noteOff, noteOn, setSustain])

  useEffect(() => () => engineRef.current?.destroy(), [])

  const updateState = useCallback((updater: (current: PianoState) => PianoState, context: string) => {
    setState((current) => ({ ...updater(current), status: context }))
  }, [])

  const controls = useMemo(() => ({
    setMasterLevel: (value: number) => updateState((current) => ({ ...current, masterLevel: value }), `Master level · ${Math.round(value)}%`),
    setLayerEnabled: (layer: 0 | 1, enabled: boolean) => updateState((current) => ({ ...current, layers: current.layers.map((item, index) => index === layer ? { ...item, enabled } : item) as PianoState['layers'] }), `Piano ${layer ? 'B' : 'A'} · ${enabled ? 'on' : 'off'}`),
    setLayerLevel: (layer: 0 | 1, level: number) => updateState((current) => ({ ...current, layers: current.layers.map((item, index) => index === layer ? { ...item, level } : item) as PianoState['layers'] }), `Piano ${layer ? 'B' : 'A'} level · ${Math.round(level)}%`),
    setLayerSustain: (layer: 0 | 1, sustain: boolean) => updateState((current) => ({ ...current, layers: current.layers.map((item, index) => index === layer ? { ...item, sustain } : item) as PianoState['layers'] }), `Piano ${layer ? 'B' : 'A'} sustain · ${sustain ? 'enabled' : 'disabled'}`),
    setActiveLayer: (activeLayer: 0 | 1) => updateState((current) => ({ ...current, activeLayer }), `Editing Piano ${activeLayer ? 'B' : 'A'}`),
    setType: (type: PianoType) => updateState((current) => ({ ...current, layers: current.layers.map((item, index) => index === current.activeLayer ? { ...item, type } : item) as PianoState['layers'] }), `${type} · ${getPianoName(type, stateRef.current.layers[stateRef.current.activeLayer].variation)}`),
    setVariation: (variation: number) => updateState((current) => ({ ...current, layers: current.layers.map((item, index) => index === current.activeLayer ? { ...item, variation } : item) as PianoState['layers'] }), `${getPianoName(stateRef.current.layers[stateRef.current.activeLayer].type, variation)} · variation ${Math.round(variation)}`),
    setMono: (mono: boolean) => updateState((current) => ({ ...current, mono }), `Mono mode · ${mono ? 'on' : 'off'}`),
    setStringResonance: (stringResonance: boolean) => updateState((current) => ({ ...current, stringResonance }), `String resonance · ${stringResonance ? 'on' : 'off'}`),
    setDynComp: (dynComp: boolean) => updateState((current) => ({ ...current, dynComp }), `Dynamic compression · ${dynComp ? 'on' : 'off'}`),
    setPedalNoise: (pedalNoise: boolean) => updateState((current) => ({ ...current, pedalNoise }), `Pedal noise · ${pedalNoise ? 'on' : 'off'}`),
    setSoftRelease: (softRelease: boolean) => updateState((current) => ({ ...current, softRelease }), `Soft release · ${softRelease ? 'on' : 'off'}`),
    cycleTimbre: () => updateState((current) => ({ ...current, timbre: ({ Soft: 'Mid', Mid: 'Bright', Bright: 'Soft' } as Record<PianoTimbre, PianoTimbre>)[current.timbre] }), 'Timbre changed'),
    setUnison: (unison: number) => updateState((current) => ({ ...current, unison }), `Unison · ${Math.round(unison)}%`),
    setReverbOn: (reverbOn: boolean) => updateState((current) => ({ ...current, reverbOn }), `Reverb · ${reverbOn ? 'on' : 'off'}`),
    setReverbMix: (reverbMix: number) => updateState((current) => ({ ...current, reverbMix }), `Reverb mix · ${Math.round(reverbMix)}%`),
    setReverbSize: (reverbSize: number) => updateState((current) => ({ ...current, reverbSize }), `Reverb size · ${Math.round(reverbSize)}%`),
    setReverbType: (reverbType: ReverbType) => updateState((current) => ({ ...current, reverbType }), `Reverb type · ${reverbType}`),
  }), [updateState])

  return { state, activeNotes, noteOn, noteOff, allNotesOff, ensureEngine, controls }
}
