import { useEffect, useState } from 'react';
import type { NoteRouter } from '../input/noteRouter';
import {
  createMidiController,
  browserMidiProvider,
  type MidiAccessProvider,
  type MidiState,
} from '../input/midi';

/**
 * Web MIDI note input. Routes note/velocity and CC64 sustain into the shared
 * router. Handles denied/disconnected states truthfully (surfaced as status).
 * A provider can be injected for tests; in the browser it defaults to the real
 * Web MIDI API when available (undefined otherwise -> "unsupported").
 */
export function useMidiInput(
  router: NoteRouter,
  provider: MidiAccessProvider | undefined = browserMidiProvider(),
): MidiState {
  const [state, setState] = useState<MidiState>(provider ? 'requesting' : 'unsupported');

  useEffect(() => {
    const controller = createMidiController(provider, {
      noteOn: (midi, velocity) => router.noteOn('midi', midi, velocity),
      noteOff: (midi) => router.noteOff('midi', midi),
      sustain: (down) => router.setSustain(down),
    });
    const unsub = controller.onStateChange(setState);
    controller.connect().catch(() => {});
    setState(controller.getState());
    return () => {
      unsub();
      controller.disconnect();
      router.releaseOwner('midi');
    };
  }, [router, provider]);

  return state;
}
