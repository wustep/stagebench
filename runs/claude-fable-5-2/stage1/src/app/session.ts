import { PianoEngine } from '../audio/engine'
import { VARIANT } from '../hardware/geometry'
import { HardwareStore } from '../hardware/store'
import { KeyboardInput } from '../input/keyboard'
import { MidiInput } from '../input/midi'
import { NoteLifecycle } from '../input/noteLifecycle'
import type { Platform, Unsubscribe } from '../platform/types'

/**
 * Everything with a lifetime: the engine, the note lifecycle, the input adapters, and the
 * panel's presentation store. One session is created per mounted app and disposed on unmount.
 *
 * Note that `hardware` is wired to nothing. Panel controls are presentation-only in Phase 1.
 */
export interface Session {
  platform: Platform
  engine: PianoEngine
  lifecycle: NoteLifecycle
  keyboard: KeyboardInput
  midi: MidiInput
  hardware: HardwareStore
  /** Call from any user gesture that should make sound. */
  wake(): void
  /** Stop every voice and forget every held key and the pedal. */
  panic(): void
  dispose(): void
}

export function createSession(platform: Platform): Session {
  const engine = new PianoEngine(platform.audio, platform.timing)
  const lifecycle = new NoteLifecycle(engine, {
    lowNote: VARIANT.keyboard.lowNote,
    highNote: VARIANT.keyboard.highNote,
  })
  const wake = () => {
    void engine.start()
  }
  const keyboard = new KeyboardInput(platform.events, lifecycle, platform.storage, { onGesture: wake })
  const midi = new MidiInput(platform.midi, lifecycle, { onActivity: wake })
  const hardware = new HardwareStore()

  const panic = () => {
    keyboard.reset()
    lifecycle.allNotesOff()
  }

  keyboard.attach()
  // A window that loses focus stops receiving key-up and pointer-up events, so any note
  // still held would hang. Stop everything instead.
  const subscriptions: Unsubscribe[] = [platform.events.onBlur(panic), platform.events.onHidden(panic)]

  let disposed = false
  return {
    platform,
    engine,
    lifecycle,
    keyboard,
    midi,
    hardware,
    wake,
    panic,
    dispose() {
      if (disposed) return
      disposed = true
      for (const unsubscribe of subscriptions) unsubscribe()
      keyboard.dispose()
      midi.dispose()
      lifecycle.allNotesOff()
      engine.dispose()
    },
  }
}
