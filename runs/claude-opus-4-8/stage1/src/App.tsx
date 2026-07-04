import { useEffect, useMemo, useRef } from 'react';
import type { AudioBackend } from './audio/types';
import type { MidiAccessProvider } from './input/midi';
import { ControlStore } from './state/controlStore';
import { useControls } from './hooks/useControls';
import { usePiano } from './hooks/usePiano';
import { useKeyboardInput } from './hooks/useKeyboardInput';
import { useMidiInput } from './hooks/useMidiInput';
import { PerformanceSection } from './components/sections/PerformanceSection';
import { OrganSection } from './components/sections/OrganSection';
import { PianoSection } from './components/sections/PianoSection';
import { ProgramSection } from './components/sections/ProgramSection';
import { SynthSection } from './components/sections/SynthSection';
import { EffectsSection } from './components/sections/EffectsSection';
import { Keybed } from './components/Keybed';
import { StatusBar } from './components/StatusBar';
import { SECTIONS } from './model/controls';

export interface AppProps {
  /** Injected audio backend for tests. */
  audioBackend?: AudioBackend;
  /** Injected MIDI provider for tests. */
  midiProvider?: MidiAccessProvider;
  /** Disable computer-keyboard listeners (tests that don't want global handlers). */
  enableComputerKeyboard?: boolean;
}

/**
 * The complete Nord Stage 4 (73-key) surface. Two things are functional: the
 * keybed plays one piano voice, and every visible control moves/presses. Every
 * panel control is honestly decorative (presentation state only).
 */
export default function App({
  audioBackend,
  midiProvider,
  enableComputerKeyboard = true,
}: AppProps = {}) {
  const store = useMemo(() => new ControlStore(), []);
  const ctl = useControls(store);
  const piano = usePiano(audioBackend);
  const midiState = useMidiInput(piano.router, midiProvider);
  const chassisRef = useRef<HTMLDivElement>(null);

  useKeyboardInput(piano.router, enableComputerKeyboard, piano.ensureRunning);

  // Cleanup: stop every owned voice on unmount (handled in usePiano) and on blur.
  useEffect(() => {
    const onBlur = () => piano.router.releaseOwner('midi');
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [piano.router]);

  // Deck / keybed split from the visual spec (54 / 46).
  const deckStyle = SECTIONS.map((s) => `${(s.fraction * 100).toFixed(2)}fr`).join(' ');

  return (
    <div className="stage-app" onPointerDown={piano.ensureRunning}>
      <div className="chassis" ref={chassisRef} data-variant="stage-4-73">
        <div className="deck" style={{ gridTemplateColumns: deckStyle }}>
          <PerformanceSection ctl={ctl} />
          <OrganSection ctl={ctl} />
          <PianoSection ctl={ctl} />
          <ProgramSection ctl={ctl} />
          <SynthSection ctl={ctl} />
          <EffectsSection ctl={ctl} />
        </div>
        <div className="keybed-rail">
          <Keybed
            activeNotes={piano.activeNotes}
            onNoteDown={(owner, midi, vel) => {
              piano.ensureRunning();
              piano.router.noteOn(owner, midi, vel);
            }}
            onNoteUp={(owner, midi) => piano.router.noteOff(owner, midi)}
          />
        </div>
      </div>
      <StatusBar pianoStatus={piano.status} midiState={midiState} activeCount={piano.activeNotes.size} />
    </div>
  );
}
