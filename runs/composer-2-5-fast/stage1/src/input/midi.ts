export interface MidiInputEvent {
  type: 'noteon' | 'noteoff' | 'cc'
  note?: number
  velocity?: number
  controller?: number
  value?: number
}

export interface MidiInputPort {
  readonly state: 'connected' | 'disconnected' | 'denied'
  onEvent: ((event: MidiInputEvent) => void) | null
  simulateEvent(event: MidiInputEvent): void
}

export function createMockMidiPort(state: MidiInputPort['state'] = 'connected'): MidiInputPort {
  let handler: ((event: MidiInputEvent) => void) | null = null
  return {
    state,
    get onEvent() {
      return handler
    },
    set onEvent(fn) {
      handler = fn
    },
    simulateEvent(event) {
      handler?.(event)
    },
  }
}

export function attachMidiHandlers(port: MidiInputPort, handlers: {
  onNoteOn: (note: number, velocity: number) => void
  onNoteOff: (note: number) => void
  onSustain: (on: boolean) => void
}): () => void {
  if (port.state !== 'connected') return () => {}
  port.onEvent = (event) => {
    if (event.type === 'noteon' && event.note != null) {
      const vel = event.velocity ?? 0
      if (vel > 0) handlers.onNoteOn(event.note, vel)
      else handlers.onNoteOff(event.note)
    } else if (event.type === 'noteoff' && event.note != null) {
      handlers.onNoteOff(event.note)
    } else if (event.type === 'cc' && event.controller === 64) {
      handlers.onSustain((event.value ?? 0) >= 64)
    }
  }
  return () => {
    port.onEvent = null
  }
}
