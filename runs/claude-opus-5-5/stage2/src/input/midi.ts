import type { PlayEngine } from '../audio/layeredEngine'
import { HIGHEST_NOTE, LOWEST_NOTE } from '../model/keys'

// Structural subset of Web MIDI, so tests can pass fakes.
export interface MidiMessageEventLike {
  data: Uint8Array | number[] | null
}

export interface MidiInputLike {
  id: string
  name?: string | null
  state?: string
  onmidimessage: ((event: MidiMessageEventLike) => void) | null
}

export interface MidiConnectionEventLike {
  port: { id: string; type: string; state: string } | null
}

export interface MidiAccessLike {
  inputs: { forEach(cb: (input: MidiInputLike) => void): void }
  onstatechange: ((event: MidiConnectionEventLike) => void) | null
}

export type MidiStatus =
  | { state: 'unsupported' }
  | { state: 'idle' }
  | { state: 'requesting' }
  | { state: 'denied'; message: string }
  | { state: 'no-inputs' }
  | { state: 'connected'; inputs: string[] }
  | { state: 'disconnected'; message: string }

export interface MidiConnection {
  detach: () => void
}

/**
 * Route every MIDI input into the shared note lifecycle: note on/off (velocity 0 = off),
 * CC64 sustain, CC120/123 all sound/notes off. A disconnected input releases everything it held.
 */
export async function connectMidi(
  request: (() => Promise<MidiAccessLike>) | null,
  engine: () => PlayEngine | null,
  onStatus: (status: MidiStatus) => void,
  onUserGesture?: () => void,
): Promise<MidiConnection | null> {
  if (!request) {
    onStatus({ state: 'unsupported' })
    return null
  }
  onStatus({ state: 'requesting' })
  let access: MidiAccessLike
  try {
    access = await request()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onStatus({ state: 'denied', message })
    return null
  }

  const attached = new Map<string, MidiInputLike>()
  let detached = false

  const handle = (inputId: string) => (event: MidiMessageEventLike) => {
    const data = event.data
    if (!data || data.length < 2) return
    const status = data[0] & 0xf0
    const channel = data[0] & 0x0f
    const d1 = data[1]
    const d2 = data.length > 2 ? data[2] : 0
    const eng = engine()
    if (!eng) return
    const source = `midi:${inputId}:${channel}`
    if (status === 0x90 && d2 > 0) {
      if (d1 < LOWEST_NOTE || d1 > HIGHEST_NOTE) return
      onUserGesture?.()
      eng.noteOn(d1, d2, source)
    } else if (status === 0x80 || (status === 0x90 && d2 === 0)) {
      eng.noteOff(d1, source)
    } else if (status === 0xb0) {
      if (d1 === 64) eng.setSustain(d2 >= 64, `midi:${inputId}:sustain`)
      else if (d1 === 123) eng.releaseSources(`midi:${inputId}:`)
      else if (d1 === 120) eng.allNotesOff()
    }
  }

  const scan = () => {
    const seen = new Set<string>()
    access.inputs.forEach((input) => {
      if (input.state === 'disconnected') return
      seen.add(input.id)
      if (!attached.has(input.id)) {
        input.onmidimessage = handle(input.id)
        attached.set(input.id, input)
      }
    })
    let lost = false
    for (const [id, input] of attached) {
      if (!seen.has(id)) {
        input.onmidimessage = null
        attached.delete(id)
        engine()?.releaseSources(`midi:${id}:`)
        lost = true
      }
    }
    const names: string[] = []
    attached.forEach((input) => names.push(input.name || input.id))
    if (names.length > 0) onStatus({ state: 'connected', inputs: names })
    else if (lost) onStatus({ state: 'disconnected', message: 'MIDI input disconnected; its notes were released.' })
    else onStatus({ state: 'no-inputs' })
  }

  access.onstatechange = (event) => {
    if (detached) return
    if (event.port && event.port.type !== 'input') return
    scan()
  }
  scan()

  return {
    detach: () => {
      detached = true
      access.onstatechange = null
      for (const [id, input] of attached) {
        input.onmidimessage = null
        engine()?.releaseSources(`midi:${id}:`)
      }
      attached.clear()
    },
  }
}
