import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createHardwareModel } from './model/hardware';
import { PianoVoiceEngine } from './audio/synth-voice';
import { NoteLifecycle } from './audio/note-lifecycle';
import { Keyboard } from './components/keyboard';
import { ControlPanel } from './components/control-panel';
import './styles/app.css';

export default function App() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<PianoVoiceEngine | null>(null);
  const noteLifecycleRef = useRef<NoteLifecycle | null>(null);
  const pressedKeysRef = useRef<Set<number>>(new Set());

  const [hardware, setHardware] = useState(() =>
    createHardwareModel('stage-4-73')
  );
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Initialize audio context and engine
  useEffect(() => {
    try {
      const audioContext =
        audioContextRef.current ||
        new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Create master gain
      const masterGain = audioContext.createGain();
      masterGain.gain.value = 0.3;
      masterGain.connect(audioContext.destination);

      // Create engine
      const engine = new PianoVoiceEngine(audioContext, masterGain);
      engineRef.current = engine;

      // Create note lifecycle
      const noteLifecycle = new NoteLifecycle(engine);
      noteLifecycleRef.current = noteLifecycle;

      setAudioReady(true);
      setAudioError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to initialize audio';
      setAudioError(message);
      setAudioReady(false);
    }
  }, []);

  // Handle sustain pedal changes from UI
  const handleControlChange = useCallback(
    (controlId: string, value: number) => {
      const engine = engineRef.current;
      if (!engine) return;

      // Update hardware state
      setHardware((prev) => {
        const updated = { ...prev };
        // Find and update the control in the sections
        updated.sections = updated.sections.map((section) => ({
          ...section,
          controls: section.controls.map((control) =>
            control.id === controlId ? { ...control, value } : control
          ),
        }));
        return updated;
      });

      // Handle specific control logic
      if (controlId === 'sustain-pedal' || controlId.includes('sustain')) {
        const lifecycle = noteLifecycleRef.current;
        if (lifecycle) {
          lifecycle.setSustainPedal(value > 0.5);
        }
      }
    },
    []
  );

  // Handle keyboard input for notes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const lifecycle = noteLifecycleRef.current;
      if (!lifecycle || !audioReady) return;

      // Map computer keyboard to notes
      // QWERTY row as white keys starting from C4
      const keyMap: Record<string, number> = {
        z: 36, // C3
        x: 38, // D3
        c: 40, // E3
        v: 41, // F3
        b: 43, // G3
        n: 45, // A3
        m: 47, // B3
        ',': 48, // C4
        q: 48, // C4
        w: 50, // D4
        e: 52, // E4
        r: 53, // F4
        t: 55, // G4
        y: 57, // A4
        u: 59, // B4
        i: 60, // C5
      };

      const note = keyMap[e.key.toLowerCase()];
      if (note !== undefined && !pressedKeysRef.current.has(note)) {
        pressedKeysRef.current.add(note);
        lifecycle.keyboardNoteOn(e.keyCode, note, 64);
        setPressedKeys(new Set(pressedKeysRef.current));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const lifecycle = noteLifecycleRef.current;
      if (!lifecycle) return;

      const keyMap: Record<string, number> = {
        z: 36,
        x: 38,
        c: 40,
        v: 41,
        b: 43,
        n: 45,
        m: 47,
        ',': 48,
        q: 48,
        w: 50,
        e: 52,
        r: 53,
        t: 55,
        y: 57,
        u: 59,
        i: 60,
      };

      const note = keyMap[e.key.toLowerCase()];
      if (note !== undefined) {
        pressedKeysRef.current.delete(note);
        lifecycle.keyboardNoteOff(e.keyCode);
        setPressedKeys(new Set(pressedKeysRef.current));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [audioReady]);

  // Handle window blur (all notes off)
  useEffect(() => {
    const handleBlur = () => {
      noteLifecycleRef.current?.allNotesOff();
      pressedKeysRef.current.clear();
      setPressedKeys(new Set());
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      noteLifecycleRef.current?.cleanup();
      engineRef.current?.cleanup();
    };
  }, []);

  return (
    <div className="app">
      <div className="instrument" role="main" aria-label="Nord Stage 4">
        <div className="control-deck-container">
          <ControlPanel
            hardware={hardware}
            onControlChange={handleControlChange}
          />
        </div>
        <div className="keyboard-container-wrapper">
          <Keyboard
            variant={hardware.variant}
            noteLifecycle={noteLifecycleRef.current!}
            pressedKeys={pressedKeys}
          />
        </div>
      </div>

      {!audioReady && (
        <div className="audio-status error">
          {audioError ? `Audio Error: ${audioError}` : 'Initializing audio...'}
        </div>
      )}

      {audioReady && (
        <div className="audio-status ready">Audio Ready</div>
      )}
    </div>
  );
}
