import { useEffect, useMemo, useRef } from 'react';
import type { AudioBackend } from './audio/types';
import type { AudioEngine } from './audio/audioEngine';
import type { MidiAccessProvider } from './input/midi';
import { ControlStore } from './state/controlStore';
import { useControls } from './hooks/useControls';
import { usePiano } from './hooks/usePiano';
import { useAudioEngine } from './hooks/useAudioEngine';
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
  /**
   * Phase-1 injected audio backend (fake backend for regression tests). When
   * present, the app uses the simple Phase-1 PianoEngine path and panel controls
   * stay decorative — this keeps every inherited test green.
   */
  audioBackend?: AudioBackend;
  /** Phase-2 injected AudioEngine (OfflineAudioContext-backed in tests). */
  audioEngine?: AudioEngine;
  /** Injected MIDI provider for tests. */
  midiProvider?: MidiAccessProvider;
  /** Disable computer-keyboard listeners (tests that don't want global handlers). */
  enableComputerKeyboard?: boolean;
}

/**
 * The complete Nord Stage 4 (73-key) surface. In Phase 2 the Piano section, the
 * Layer Effects section, and the Master Level knob are functional through one
 * AudioContext (layer buses -> ordered effects -> master gain/limiter -> one
 * destination). Organ, Synth, and Program controls remain honestly decorative.
 */
export default function App({
  audioBackend,
  audioEngine,
  midiProvider,
  enableComputerKeyboard = true,
}: AppProps = {}) {
  const store = useMemo(() => new ControlStore(), []);
  const ctl = useControls(store);

  // Phase-1 regression path (fake backend injected) vs. Phase-2 engine path.
  // In the engine path we hand usePiano a silent no-op backend so it does NOT
  // open a second AudioContext — the AudioEngine owns the one and only context.
  const usePhase1 = audioBackend !== undefined && audioEngine === undefined;
  const silentBackend = useMemo<AudioBackend>(
    () => ({
      now: 0,
      state: 'suspended',
      resume: async () => {},
      createTone: () => ({ start() {}, rampGain() {}, holdGain() {}, stop() {}, stopped: false }),
      activeToneCount: 0,
      close: async () => {},
    }),
    [],
  );
  const phase1 = usePiano(usePhase1 ? audioBackend : silentBackend);
  const engineApi = useAudioEngine(store, { injectedEngine: audioEngine });

  const piano = usePhase1 ? phase1 : engineApi;
  const shiftOctave = usePhase1 ? () => {} : engineApi.shiftOctave;

  const midiState = useMidiInput(piano.router, midiProvider);
  const chassisRef = useRef<HTMLDivElement>(null);

  useKeyboardInput(piano.router, enableComputerKeyboard, piano.ensureRunning);

  // Cleanup: stop every owned voice on unmount (handled in the hook) and on blur.
  useEffect(() => {
    const onBlur = () => piano.router.releaseOwner('midi');
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [piano.router]);

  const deckStyle = SECTIONS.map((s) => `${(s.fraction * 100).toFixed(2)}fr`).join(' ');

  return (
    <div className="stage-app" onPointerDown={piano.ensureRunning}>
      <div className="chassis" ref={chassisRef} data-variant="stage-4-73">
        <div className="deck" style={{ gridTemplateColumns: deckStyle }}>
          <PerformanceSection ctl={ctl} />
          <OrganSection ctl={ctl} />
          <PianoSection ctl={ctl} onOctave={shiftOctave} />
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
      <StatusBar
        pianoStatus={piano.status}
        midiState={midiState}
        activeCount={piano.activeNotes.size}
        soundSource={usePhase1 ? 'synthesized' : 'recorded'}
      />
    </div>
  );
}
