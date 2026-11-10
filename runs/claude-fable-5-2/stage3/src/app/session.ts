import { PianoEngine, type EngineSnapshot } from '../audio/engine'
import type { SoundState } from '../audio/dsp/params'
import { VARIANT } from '../hardware/geometry'
import { HardwareStore } from '../hardware/store'
import { KeyboardInput } from '../input/keyboard'
import { MidiInput } from '../input/midi'
import { NoteLifecycle } from '../input/noteLifecycle'
import { modelsOf, PIANO_TYPES } from '../piano/catalog'
import type { Platform, Unsubscribe } from '../platform/types'
import { PanelBinder, type EngineView } from '../state/binding'
import { deriveSound } from '../state/model'
import { StageStore } from '../state/store'

/**
 * Everything with a lifetime: the engine, the note lifecycle, the input adapters, the panel's
 * presentation store, the canonical state, and the binder between the last two. One session is
 * created per mounted app and disposed on unmount.
 *
 *   panel hardware ⇄ binder ⇄ canonical state → sound state → engine → audio host
 *
 * The hardware store itself is still wired to nothing: the few controls the specs exclude end there.
 */
export interface Session {
  platform: Platform
  engine: PianoEngine
  lifecycle: NoteLifecycle
  keyboard: KeyboardInput
  midi: MidiInput
  hardware: HardwareStore
  /** Canonical state of the functional sections. */
  stage: StageStore
  binder: PanelBinder
  /** Call from any user gesture that should make sound. */
  wake(): void
  /** Stop every voice and forget every held key and the pedal. */
  panic(): void
  dispose(): void
}

/** Piano types whose recorded sample set failed to load. */
function failedTypes(snapshot: EngineSnapshot): number[] {
  const failed: number[] = []
  PIANO_TYPES.forEach((_, type) => {
    for (const model of modelsOf(type)) {
      if (model.source.kind === 'samples' && snapshot.library[model.source.set] === 'failed' && !failed.includes(type)) {
        failed.push(type)
      }
    }
  })
  return failed
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
  const hardware = new HardwareStore()
  // Stored programs and the Live slots are kept in the storage boundary.
  const stage = new StageStore({ storage: platform.storage })
  const panic = () => {
    keyboard.reset()
    lifecycle.allNotesOff()
  }
  const binder = new PanelBinder(hardware, stage, platform.timing.now, { panic: () => panic() })
  const keyboard: KeyboardInput = new KeyboardInput(platform.events, lifecycle, platform.storage, {
    onGesture: wake,
    onShift: (down) => binder.setShiftKey(down),
  })
  const midi = new MidiInput(platform.midi, lifecycle, {
    onActivity: wake,
    // The two morph sources: modulation wheel (CC1) and control pedal (CC11).
    onController: (controller, value) => {
      if (controller === 1) stage.setWheel(value / 127)
      else stage.setPedal(value / 127)
    },
  })

  // Canonical state → engine. Only real changes of the sound are sent (a notice is not one).
  let sent = ''
  const pushSound = () => {
    const sound: SoundState = deriveSound(stage.getState())
    const key = JSON.stringify(sound)
    if (key === sent) return
    sent = key
    engine.setSound(sound)
  }
  pushSound()

  // Engine → panel: failed sample sets flash their type LED; the compressor drives its ACTIVE LED.
  let viewKey = ''
  const pushView = () => {
    const snapshot = engine.getSnapshot()
    const view: EngineView = { failedTypes: failedTypes(snapshot), compressor: snapshot.compressor }
    const key = JSON.stringify(view)
    if (key === viewKey) return
    viewKey = key
    binder.setEngineView(view)
  }

  binder.attach()
  keyboard.attach()
  // A window that loses focus stops receiving key-up and pointer-up events, so any note
  // still held would hang. Stop everything instead.
  const subscriptions: Unsubscribe[] = [
    platform.events.onBlur(panic),
    platform.events.onHidden(panic),
    stage.subscribe(pushSound),
    engine.subscribe(pushView),
  ]

  let disposed = false
  return {
    platform,
    engine,
    lifecycle,
    keyboard,
    midi,
    hardware,
    stage,
    binder,
    wake,
    panic,
    dispose() {
      if (disposed) return
      disposed = true
      for (const unsubscribe of subscriptions) unsubscribe()
      binder.dispose()
      keyboard.dispose()
      midi.dispose()
      lifecycle.allNotesOff()
      engine.dispose()
    },
  }
}
