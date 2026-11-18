import type { NoteLifecycle } from './notes'

export type MidiStatus = 'connecting' | 'connected' | 'disconnected' | 'denied' | 'unavailable' | 'error'

export interface MidiSource {
  id: string
  state: string
  connection?: string
  open?(): Promise<unknown>
  close?(): Promise<unknown>
  addEventListener(name: 'midimessage', callback: (event: { data: ArrayLike<number> | null }) => void): void
  removeEventListener(name: 'midimessage', callback: (event: { data: ArrayLike<number> | null }) => void): void
}

export interface MidiAccess {
  inputs: { values(): Iterable<MidiSource> }
  addEventListener(name: 'statechange', callback: () => void): void
  removeEventListener(name: 'statechange', callback: () => void): void
}

export type RequestMidi = () => Promise<MidiAccess>
export const browserMidi = (): RequestMidi | undefined => navigator.requestMIDIAccess
  ? () => navigator.requestMIDIAccess({ sysex: false })
  : undefined

export function bindMidi(
  request: RequestMidi | undefined,
  notes: NoteLifecycle,
  update: (status: MidiStatus) => void,
  onDisconnect: () => void,
) {
  let access: MidiAccess | undefined
  let disposed = false
  let counter = 0
  const ports = new Map<MidiSource, () => void>()
  const outstanding = new Map<string, string[]>()

  const reset = () => outstanding.clear()

  function message(port: MidiSource, data: ArrayLike<number> | null) {
    if (!data || data.length < 3) return
    const [status, value, velocity] = [data[0], data[1], data[2]]
    const command = status & 0xf0
    const channel = `midi:${port.id}:${status & 15}`
    const key = `${channel}:${value}`
    if (command === 0x90 && velocity > 0) {
      const token = `${key}:${counter++}`
      const queue = outstanding.get(key) ?? []
      queue.push(token)
      outstanding.set(key, queue)
      notes.press(token, value, velocity, channel)
    } else if (command === 0x80 || command === 0x90) {
      const queue = outstanding.get(key)
      const token = queue?.shift()
      if (token) notes.release(token)
      if (!queue?.length) outstanding.delete(key)
    } else if (command === 0xb0 && value === 64) {
      notes.sustain(channel, velocity >= 64)
    }
  }

  function refresh() {
    if (!access || disposed) return
    const current = new Set(Array.from(access.inputs.values()).filter((source) => source.state !== 'disconnected'))
    let disconnected = false
    for (const [source, detach] of ports) {
      if (current.has(source)) continue
      ports.delete(source)
      detach()
      disconnected = true
    }
    if (disconnected) {
      reset()
      onDisconnect()
    }
    for (const source of current) {
      if (ports.has(source)) continue
      const listener = (event: { data: ArrayLike<number> | null }) => message(source, event.data)
      const opensPort = source.connection === 'closed' && Boolean(source.open)
      ports.set(source, () => {
        source.removeEventListener('midimessage', listener)
        if (opensPort) void source.close?.().catch(() => {})
      })
      source.addEventListener('midimessage', listener)
      if (opensPort) {
        void source.open?.().catch(() => {
          if (!disposed && ports.has(source)) update('error')
        })
      }
    }
    update(ports.size ? 'connected' : 'disconnected')
  }

  if (request) {
    update('connecting')
    void Promise.resolve().then(request).then((result) => {
      if (disposed) return
      access = result
      access.addEventListener('statechange', refresh)
      refresh()
    }).catch((error: unknown) => {
      if (disposed) return
      const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
      update(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error')
    })
  } else {
    update('unavailable')
  }

  return {
    reset,
    dispose() {
      disposed = true
      access?.removeEventListener('statechange', refresh)
      for (const detach of ports.values()) detach()
      ports.clear()
      reset()
    },
  }
}
