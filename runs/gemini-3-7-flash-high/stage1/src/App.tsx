import React, { useState, useEffect } from 'react';
import { INITIAL_HARDWARE_STATE, HardwareState } from './model/hardware';
import { PianoEngine } from './audio/PianoEngine';
import { AudioStatus } from './audio/types';
import { MidiController, MidiStatus } from './input/MidiController';
import { NoteLifecycle } from './input/NoteLifecycle';
import { Instrument } from './components/Instrument';
import { StatusBar } from './components/StatusBar';

export default function App() {
  const [hardwareState, setHardwareState] = useState<HardwareState>(INITIAL_HARDWARE_STATE);
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('uninitialized');
  const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
  const [activeVoiceCount, setActiveVoiceCount] = useState<number>(0);
  const [isSustained, setIsSustained] = useState<boolean>(false);

  const [services] = useState(() => {
    const engine = new PianoEngine();
    const lifecycle = new NoteLifecycle({
      engine,
      onActiveKeysChange: (keys) => setActiveKeys(new Set(keys)),
      onSustainChange: (sustained) => setIsSustained(sustained),
    });
    return { engine, lifecycle };
  });

  const { engine, lifecycle } = services;

  const handleInitAudio = () => {
    engine.init();
  };

  const handleToggleSustain = () => {
    lifecycle.toggleSustain();
  };

  useEffect(() => {
    const unsubStatus = engine.subscribeStatus(setAudioStatus);
    const unsubVoices = engine.subscribeVoiceCount(setActiveVoiceCount);

    const midiController = new MidiController({
      onNoteOn: (midi, vel) => lifecycle.noteOn(midi, 'midi', vel),
      onNoteOff: (midi) => lifecycle.noteOff(midi, 'midi'),
      onSustainChange: (down) => lifecycle.setSustain(down),
      onStatusChange: (status) => setMidiStatus(status),
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      lifecycle.handleKeyDown(e);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      lifecycle.handleKeyUp(e);
    };

    const handleBlur = () => {
      lifecycle.allNotesOff();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        lifecycle.allNotesOff();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubStatus();
      unsubVoices();
      midiController.dispose();
      lifecycle.dispose();
      engine.dispose();
    };
  }, [engine, lifecycle]);

  return (
    <main className="app-viewport">
      <div className="instrument-stage">
        <Instrument
          state={hardwareState}
          updateState={setHardwareState}
          lifecycle={lifecycle}
          activeKeys={activeKeys}
        />
      </div>

      <StatusBar
        audioStatus={audioStatus}
        midiStatus={midiStatus}
        activeVoiceCount={activeVoiceCount}
        isSustained={isSustained}
        onInitAudio={handleInitAudio}
        onToggleSustain={handleToggleSustain}
      />
    </main>
  );
}
