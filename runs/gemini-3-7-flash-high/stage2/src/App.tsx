import React, { useState, useEffect } from 'react';
import {
  INITIAL_HARDWARE_STATE,
  HardwareState,
  EFFECT_1_TYPES,
  EFFECT_2_TYPES,
  AMP_TYPES,
  REVERB_TYPES,
  DELAY_FILTER_MODES,
} from './model/hardware';
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

  // Sync HardwareState to AudioEngine in real-time
  useEffect(() => {
    engine.setMasterLevel(hardwareState.master_level);
    engine.setPianoSectionOn(hardwareState.piano_on);
    engine.setPitchStick(hardwareState.pitch_stick);
    engine.setAllEffectsBypass(!hardwareState.layer_effects_on);
    engine.setGroupModePiano(hardwareState.effects_group_piano);

    // Sync focused layer
    const focused = hardwareState.piano_layer_b_focus ? 'B' : 'A';
    engine.setFocusedLayer(focused);

    // Sync Layer A
    if (engine.layerA) {
      engine.layerA.updateState({
        enabled: hardwareState.piano_layer_a_on,
        level: hardwareState.piano_layer_a_level,
        octave: hardwareState.piano_layer_a_octave,
        type: hardwareState.piano_type,
        model: hardwareState.piano_model,
        kbTouch: hardwareState.piano_kb_touch,
        timbre: hardwareState.piano_timbre,
        dynComp: hardwareState.piano_dyn_comp,
        unison: hardwareState.piano_unison,
        softRelease: hardwareState.piano_soft_release,
        stringRes: hardwareState.piano_string_res,
        sustainPedal: hardwareState.piano_sustain,
        pitchStick: hardwareState.piano_pstick,
      });
    }

    // Sync Layer B
    if (engine.layerB) {
      engine.layerB.updateState({
        enabled: hardwareState.piano_layer_b_on,
        level: hardwareState.piano_layer_b_level,
        octave: hardwareState.piano_layer_b_octave,
        type: hardwareState.piano_type,
        model: hardwareState.piano_model,
        kbTouch: hardwareState.piano_kb_touch,
        timbre: hardwareState.piano_timbre,
        dynComp: hardwareState.piano_dyn_comp,
        unison: hardwareState.piano_unison,
        softRelease: hardwareState.piano_soft_release,
        stringRes: hardwareState.piano_string_res,
        sustainPedal: hardwareState.piano_sustain,
        pitchStick: hardwareState.piano_pstick,
      });
    }

    // Sync Effect Units
    engine.updateMod1({
      on: hardwareState.effect_1_on,
      type: EFFECT_1_TYPES[hardwareState.effect_1_type] as import('./audio/effects/types').Mod1Type,
      rate: hardwareState.effect_1_rate,
      amount: hardwareState.effect_1_amount,
    });

    engine.updateMod2({
      on: hardwareState.effect_2_on,
      type: EFFECT_2_TYPES[hardwareState.effect_2_type] as import('./audio/effects/types').Mod2Type,
      rate: hardwareState.effect_2_rate,
      amount: hardwareState.effect_2_amount,
    });

    engine.updateDelay({
      on: hardwareState.delay_on,
      tempo: hardwareState.delay_tempo,
      feedback: hardwareState.delay_feedback,
      amount: hardwareState.delay_amount,
      pingPong: hardwareState.delay_pingpong,
      filter: DELAY_FILTER_MODES[hardwareState.delay_filter ?? 0] as import('./audio/effects/types').DelayFilterType,
      global: hardwareState.delay_global,
    });

    engine.updateAmpEq({
      on: hardwareState.amp_eq_on,
      type: AMP_TYPES[hardwareState.amp_type] as import('./audio/effects/types').AmpType,
      drive: hardwareState.amp_drive,
      bass: hardwareState.eq_bass,
      mid: hardwareState.eq_mid,
      midFreq: hardwareState.eq_mid_freq,
      treble: hardwareState.eq_treble,
    });

    engine.updateCompressor({
      on: hardwareState.compressor_on,
      amount: hardwareState.compressor_amount,
      fast: hardwareState.compressor_fast,
      global: hardwareState.compressor_global,
    });

    engine.updateReverb({
      on: hardwareState.reverb_on,
      type: REVERB_TYPES[hardwareState.reverb_type] as import('./audio/effects/types').ReverbType,
      decay: hardwareState.reverb_decay,
      amount: hardwareState.reverb_amount,
      bright: hardwareState.reverb_bright,
      global: hardwareState.reverb_global,
    });

    engine.updateRotary({
      on: hardwareState.rotary_on,
      speed: hardwareState.rotary_speed ? 'fast' : 'slow',
      stop: hardwareState.rotary_stop,
      drive: hardwareState.rotary_drive,
    });
  }, [hardwareState, engine]);

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
