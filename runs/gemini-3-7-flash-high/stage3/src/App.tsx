import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  INITIAL_HARDWARE_STATE,
  HardwareState,
  EFFECT_1_TYPES,
  EFFECT_2_TYPES,
  AMP_TYPES,
  REVERB_TYPES,
  DELAY_FILTER_MODES,
  ORGAN_MODELS,
  ORGAN_VIBRATO_MODES,
  SYNTH_OSC_CATEGORIES,
  SYNTH_FILTER_TYPES,
  SYNTH_LFO_WAVEFORMS,
  SYNTH_LFO_DESTINATIONS,
  SYNTH_VOICE_MODES,
  SYNTH_ARP_MODES,
  SYNTH_ARP_DIRECTIONS,
} from './model/hardware';
import { Stage4AudioEngine } from './audio/PianoEngine';
import { AudioStatus } from './audio/types';
import { MidiController, MidiStatus } from './input/MidiController';
import { NoteLifecycle } from './input/NoteLifecycle';
import { Instrument } from './components/Instrument';
import { StatusBar } from './components/StatusBar';
import { ProgramStore, ProgramData } from './model/programs';
import { hardwareStateToProgramData, applyProgramDataToHardwareState } from './model/stateConverter';
import { calculateMorphedValue } from './model/morph';
import { SplitConfig } from './model/splits';

export default function App() {
  const programStoreRef = useRef<ProgramStore>(new ProgramStore());
  const [programsList, setProgramsList] = useState<ProgramData[]>(() =>
    programStoreRef.current.getAllPrograms()
  );

  // Initialize hardware state from Program 1
  const [hardwareState, setHardwareState] = useState<HardwareState>(() => {
    const p1 = programStoreRef.current.getProgram(1);
    if (p1) {
      return applyProgramDataToHardwareState(p1, INITIAL_HARDWARE_STATE);
    }
    return INITIAL_HARDWARE_STATE;
  });

  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('uninitialized');
  const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
  const [activeVoiceCount, setActiveVoiceCount] = useState<number>(0);
  const [isSustained, setIsSustained] = useState<boolean>(false);

  // Tap tempo timestamp buffer
  const tapTimesRef = useRef<number[]>([]);

  const [services] = useState(() => {
    const engine = new Stage4AudioEngine();
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

  // Program selection handler (handles edit discard if not stored)
  const handleSelectProgram = useCallback((slot: number) => {
    setHardwareState((prev) => {
      const targetProg = programStoreRef.current.getProgram(slot);
      if (!targetProg) return prev;

      const updated = applyProgramDataToHardwareState(targetProg, prev);
      const page = Math.floor((slot - 1) / 8) + 1;
      const btn = ((slot - 1) % 8) + 1;

      return {
        ...updated,
        program_number: slot,
        program_page: page,
        program_button: btn,
        live_mode: false,
        store_mode: false,
        store_as_mode: false,
        is_dirty: false,
      };
    });
  }, []);

  // Live slot selection handler
  const handleSelectLiveSlot = useCallback((liveSlot: number) => {
    setHardwareState((prev) => {
      const targetLive = programStoreRef.current.getLiveSlot(liveSlot);
      if (!targetLive) return prev;

      const updated = applyProgramDataToHardwareState(targetLive, prev);
      return {
        ...updated,
        live_mode: true,
        live_slot: liveSlot,
        store_mode: false,
        store_as_mode: false,
        is_dirty: false,
      };
    });
  }, []);

  // Store Confirm
  const handleStoreConfirm = useCallback(() => {
    setHardwareState((prev) => {
      const targetSlot = prev.store_target_slot || prev.program_number;
      const currentName =
        programStoreRef.current.getProgram(prev.program_number)?.name || `Program ${targetSlot}`;

      const progData = hardwareStateToProgramData(prev, targetSlot, currentName);
      programStoreRef.current.saveProgram(targetSlot, progData);

      setProgramsList(programStoreRef.current.getAllPrograms());

      const page = Math.floor((targetSlot - 1) / 8) + 1;
      const btn = ((targetSlot - 1) % 8) + 1;

      return {
        ...prev,
        program_number: targetSlot,
        program_page: page,
        program_button: btn,
        store_mode: false,
        store_as_mode: false,
        is_dirty: false,
      };
    });
  }, []);

  // Store As Confirm
  const handleStoreAsConfirm = useCallback((newName: string) => {
    setHardwareState((prev) => {
      const targetSlot = prev.store_target_slot || prev.program_number;
      const progData = hardwareStateToProgramData(prev, targetSlot, newName);
      programStoreRef.current.saveProgram(targetSlot, progData);

      setProgramsList(programStoreRef.current.getAllPrograms());

      const page = Math.floor((targetSlot - 1) / 8) + 1;
      const btn = ((targetSlot - 1) % 8) + 1;

      return {
        ...prev,
        program_number: targetSlot,
        program_page: page,
        program_button: btn,
        store_as_name: newName,
        store_mode: false,
        store_as_mode: false,
        is_dirty: false,
      };
    });
  }, []);

  const handleStoreCancel = useCallback(() => {
    setHardwareState((prev) => ({
      ...prev,
      store_mode: false,
      store_as_mode: false,
    }));
  }, []);

  // Tap Master Clock (30..300 BPM)
  const handleTapMasterClock = useCallback(() => {
    const now = performance.now();
    tapTimesRef.current.push(now);

    // Keep only last 4 taps
    if (tapTimesRef.current.length > 4) {
      tapTimesRef.current.shift();
    }

    if (tapTimesRef.current.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        diffs.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      }
      const avgIntervalMs = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      if (avgIntervalMs > 0) {
        const calculatedBpm = Math.round(60000 / avgIntervalMs);
        const clampedBpm = Math.max(30, Math.min(300, calculatedBpm));
        setHardwareState((prev) => ({ ...prev, tempo_bpm: clampedBpm }));
      }
    }
  }, []);

  // Panic handler
  const handlePanic = useCallback(() => {
    lifecycle.allNotesOff();
    engine.panic();
  }, [lifecycle, engine]);

  // Wrapped state updater to auto-save in Live mode and set dirty flag in regular mode
  const handleUpdateHardwareState = useCallback(
    (updater: (prev: HardwareState) => HardwareState) => {
      setHardwareState((prev) => {
        const next = updater(prev);
        if (next.live_mode) {
          const liveData = hardwareStateToProgramData(next, next.live_slot, `Live ${next.live_slot}`);
          programStoreRef.current.saveLiveSlot(next.live_slot, liveData);
          return { ...next, is_dirty: false };
        } else {
          // If in regular mode, mark dirty
          return { ...next, is_dirty: true };
        }
      });
    },
    []
  );

  // Sync HardwareState & Morphs to AudioEngine in real-time
  useEffect(() => {
    const morphState = {
      wheelValue: hardwareState.mod_wheel,
      ctrlPedValue: hardwareState.ctrl_pedal,
      activeMorphEditSource: hardwareState.morph_edit_source,
      assignments: hardwareState.morph_assignments,
    };

    // 1. Performance & Master
    engine.setMasterLevel(hardwareState.master_level);
    engine.setPitchStick(hardwareState.pitch_stick);
    engine.setModWheel(hardwareState.mod_wheel);
    engine.setTempoBpm(hardwareState.tempo_bpm);
    engine.setTranspose(hardwareState.transpose_active ? hardwareState.transpose : 0);

    // 2. Splits Config
    const splitConfig: SplitConfig = {
      enabled: hardwareState.split,
      lowSplitActive: hardwareState.split_low_active,
      lowPosition: hardwareState.split_low_pos,
      lowCrossfade: hardwareState.split_low_xfade,
      midSplitActive: hardwareState.split_mid_active,
      midPosition: hardwareState.split_mid_pos,
      midCrossfade: hardwareState.split_mid_xfade,
      highSplitActive: hardwareState.split_high_active,
      highPosition: hardwareState.split_high_pos,
      highCrossfade: hardwareState.split_high_xfade,
    };
    engine.setSplits(splitConfig);

    // 3. Section Enablers
    engine.setPianoSectionOn(hardwareState.piano_on);
    engine.setOrganSectionOn(hardwareState.organ_on);
    engine.setSynthSectionOn(hardwareState.synth_on);

    // 4. Layer Focus & Grouping
    let focusSec: 'piano' | 'organ' | 'synth' = 'piano';
    if (hardwareState.layer_focus_organ) focusSec = 'organ';
    if (hardwareState.layer_focus_synth) focusSec = 'synth';
    engine.setLayerFocusSection(focusSec);
    engine.setFocusedLayer(hardwareState.piano_layer_b_focus ? 'B' : 'A');
    engine.setFocusedSynthLayer(
      hardwareState.synth_layer_c_focus ? 'C' : hardwareState.synth_layer_b_focus ? 'B' : 'A'
    );
    engine.setGroupModePiano(hardwareState.effects_group_piano);
    engine.setGroupModeSynth(hardwareState.effects_group_synth);
    engine.setAllEffectsBypass(!hardwareState.layer_effects_on);

    // 5. Piano Layers Sync
    if (engine.layerA) {
      const pnoALevel = calculateMorphedValue(
        'piano_layer_a_level',
        hardwareState.piano_layer_a_level,
        morphState
      );
      engine.layerA.updateState({
        enabled: hardwareState.piano_layer_a_on,
        level: pnoALevel,
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
        zoneAssignment: hardwareState.piano_layer_a_zones,
      });
    }

    if (engine.layerB) {
      const pnoBLevel = calculateMorphedValue(
        'piano_layer_b_level',
        hardwareState.piano_layer_b_level,
        morphState
      );
      engine.layerB.updateState({
        enabled: hardwareState.piano_layer_b_on,
        level: pnoBLevel,
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
        zoneAssignment: hardwareState.piano_layer_b_zones,
      });
    }

    // 6. Organ Engine Sync
    if (engine.organEngine) {
      const orgModelName = ORGAN_MODELS[hardwareState.organ_model] || 'B3';
      const orgALevel = calculateMorphedValue(
        'organ_layer_a_level',
        hardwareState.organ_layer_a_level,
        morphState
      );
      const orgBLevel = calculateMorphedValue(
        'organ_layer_b_level',
        hardwareState.organ_layer_b_level,
        morphState
      );

      const dbValues: [number, number, number, number, number, number, number, number, number] = [
        calculateMorphedValue('organ_db_16', hardwareState.organ_db_16, morphState),
        calculateMorphedValue('organ_db_5_1_3', hardwareState.organ_db_5_1_3, morphState),
        calculateMorphedValue('organ_db_8', hardwareState.organ_db_8, morphState),
        calculateMorphedValue('organ_db_4', hardwareState.organ_db_4, morphState),
        calculateMorphedValue('organ_db_2_2_3', hardwareState.organ_db_2_2_3, morphState),
        calculateMorphedValue('organ_db_2', hardwareState.organ_db_2, morphState),
        calculateMorphedValue('organ_db_1_3_5', hardwareState.organ_db_1_3_5, morphState),
        calculateMorphedValue('organ_db_1_1_3', hardwareState.organ_db_1_1_3, morphState),
        calculateMorphedValue('organ_db_1', hardwareState.organ_db_1, morphState),
      ];

      engine.organEngine.setDrawbars(dbValues);
      engine.organEngine.setPercussion({
        on: hardwareState.organ_percussion_on,
        soft: hardwareState.organ_percussion_soft,
        fast: hardwareState.organ_percussion_fast,
        third: hardwareState.organ_percussion_third,
      });
      engine.organEngine.setVibratoMode(
        ORGAN_VIBRATO_MODES[hardwareState.organ_vibrato_mode] || 'C3',
        hardwareState.organ_vibrato_on
      );

      engine.organEngine.layerA.updateState({
        enabled: hardwareState.organ_layer_a_on,
        level: orgALevel,
        octave: hardwareState.organ_layer_a_octave,
        model: orgModelName,
        vibratoOn: hardwareState.organ_layer_a_vibrato,
        sustainPedal: hardwareState.organ_sustain,
        pitchStick: hardwareState.organ_pstick,
        zoneAssignment: hardwareState.organ_layer_a_zones,
      });

      engine.organEngine.layerB.updateState({
        enabled: hardwareState.organ_layer_b_on,
        level: orgBLevel,
        octave: hardwareState.organ_layer_b_octave,
        model: orgModelName,
        vibratoOn: hardwareState.organ_layer_b_vibrato,
        sustainPedal: hardwareState.organ_sustain,
        pitchStick: hardwareState.organ_pstick,
        zoneAssignment: hardwareState.organ_layer_b_zones,
      });
    }

    // 7. Synth Engine Sync
    if (engine.synthEngine) {
      const synthOscCategory = SYNTH_OSC_CATEGORIES[hardwareState.synth_osc_category] || 'Pure';
      const synthFilterType = SYNTH_FILTER_TYPES[hardwareState.synth_filter_type] || 'LP24';
      const synthLfoWaveform = SYNTH_LFO_WAVEFORMS[hardwareState.synth_lfo_waveform] || 'Tri';
      const synthLfoDestination =
        SYNTH_LFO_DESTINATIONS[hardwareState.synth_lfo_destination] || 'Off';
      const synthVoiceMode = SYNTH_VOICE_MODES[hardwareState.synth_voice_mode] || 'Poly';
      const synthArpMode = SYNTH_ARP_MODES[hardwareState.synth_arp_mode] || 'Arp';
      const synthArpDirection = SYNTH_ARP_DIRECTIONS[hardwareState.synth_arp_direction] || 'Up';

      const morphedOscCtrl = calculateMorphedValue(
        'synth_osc_mod',
        hardwareState.synth_osc_mod,
        morphState
      );
      const morphedCutoff = calculateMorphedValue(
        'synth_filter_cutoff',
        hardwareState.synth_filter_cutoff,
        morphState
      );
      const morphedRes = calculateMorphedValue(
        'synth_filter_resonance',
        hardwareState.synth_filter_resonance,
        morphState
      );
      const morphedLfoRate = calculateMorphedValue(
        'synth_lfo_rate',
        hardwareState.synth_lfo_rate,
        morphState
      );
      const morphedLfoAmt = calculateMorphedValue(
        'synth_lfo_amount',
        hardwareState.synth_lfo_amount,
        morphState
      );
      const morphedArpRate = calculateMorphedValue(
        'synth_arp_rate',
        hardwareState.synth_arp_rate,
        morphState
      );

      const synthCommonParams = {
        oscCategory: synthOscCategory,
        waveform: hardwareState.synth_waveform,
        oscCtrl: morphedOscCtrl,
        filterType: synthFilterType,
        filterCutoff: morphedCutoff,
        filterResonance: morphedRes,
        filterDrive: hardwareState.synth_filter_drive,
        filterEnvAmt: hardwareState.synth_filter_env_amt,
        filterKbTracking: hardwareState.synth_filter_kb_tracking,
        ampAttack: hardwareState.synth_amp_attack,
        ampDecay: hardwareState.synth_amp_decay,
        ampSustain: hardwareState.synth_amp_sustain,
        ampRelease: hardwareState.synth_amp_release,
        ampVelocity: hardwareState.synth_amp_velocity,
        modAttack: hardwareState.synth_mod_attack,
        modDecay: hardwareState.synth_mod_decay,
        modRelease: hardwareState.synth_mod_release,
        modVelocity: hardwareState.synth_mod_velocity,
        modToPitch: hardwareState.synth_mod_to_pitch,
        modEnvAmt: hardwareState.synth_mod_env_amt,
        lfoWaveform: synthLfoWaveform,
        lfoDestination: synthLfoDestination,
        lfoRate: morphedLfoRate,
        lfoAmount: morphedLfoAmt,
        lfoClockSync: hardwareState.synth_lfo_clock_sync,
        voiceMode: synthVoiceMode,
        voicePriority: (hardwareState.synth_voice_priority === 1 ? 'Low' : hardwareState.synth_voice_priority === 2 ? 'High' : 'Off') as import('./audio/synth/types').SynthVoicePriority,
        glide: hardwareState.synth_glide,
        unison: hardwareState.synth_unison_level,
        vibratoMode: (hardwareState.synth_vibrato_mode === 2 ? 'Wheel' : hardwareState.synth_vibrato_mode === 1 ? 'On' : 'Off') as 'Off' | 'On' | 'Wheel',
        vibratoRate: hardwareState.synth_vibrato_rate,
        vibratoAmount: hardwareState.synth_vibrato_amount,
        arpMode: synthArpMode,
        arpDirection: synthArpDirection,
        arpRange: hardwareState.synth_arp_range,
        arpRate: morphedArpRate,
        arpClockSync: hardwareState.synth_arp_clock_sync,
        arpKbHold: hardwareState.synth_arp_kb_hold,
        arpRun: hardwareState.synth_arp_run,
        tempoBpm: hardwareState.tempo_bpm,
      };

      const synALevel = calculateMorphedValue(
        'synth_layer_a_level',
        hardwareState.synth_layer_a_level,
        morphState
      );
      const synBLevel = calculateMorphedValue(
        'synth_layer_b_level',
        hardwareState.synth_layer_b_level,
        morphState
      );
      const synCLevel = calculateMorphedValue(
        'synth_layer_c_level',
        hardwareState.synth_layer_c_level,
        morphState
      );

      engine.synthEngine.layerA.updateParams(synthCommonParams);
      engine.synthEngine.layerA.updateState({
        enabled: hardwareState.synth_layer_a_on,
        level: synALevel,
        octave: hardwareState.synth_layer_a_octave,
        sustainPedal: hardwareState.synth_sustain,
        pitchStick: hardwareState.synth_pstick,
        zoneAssignment: hardwareState.synth_layer_a_zones,
      });

      engine.synthEngine.layerB.updateParams(synthCommonParams);
      engine.synthEngine.layerB.updateState({
        enabled: hardwareState.synth_layer_b_on,
        level: synBLevel,
        octave: hardwareState.synth_layer_b_octave,
        sustainPedal: hardwareState.synth_sustain,
        pitchStick: hardwareState.synth_pstick,
        zoneAssignment: hardwareState.synth_layer_b_zones,
      });

      engine.synthEngine.layerC.updateParams(synthCommonParams);
      engine.synthEngine.layerC.updateState({
        enabled: hardwareState.synth_layer_c_on,
        level: synCLevel,
        octave: hardwareState.synth_layer_c_octave,
        sustainPedal: hardwareState.synth_sustain,
        pitchStick: hardwareState.synth_pstick,
        zoneAssignment: hardwareState.synth_layer_c_zones,
      });
    }

    // 8. Effect Units Sync
    const morphedMod1Rate = calculateMorphedValue(
      'effect_1_rate',
      hardwareState.effect_1_rate,
      morphState
    );
    const morphedMod1Amt = calculateMorphedValue(
      'effect_1_amount',
      hardwareState.effect_1_amount,
      morphState
    );
    const morphedMod2Amt = calculateMorphedValue(
      'effect_2_amount',
      hardwareState.effect_2_amount,
      morphState
    );
    const morphedDelayTempo = calculateMorphedValue(
      'delay_tempo',
      hardwareState.delay_tempo,
      morphState
    );
    const morphedDelayFb = calculateMorphedValue(
      'delay_feedback',
      hardwareState.delay_feedback,
      morphState
    );
    const morphedDelayAmt = calculateMorphedValue(
      'delay_amount',
      hardwareState.delay_amount,
      morphState
    );
    const morphedAmpDrive = calculateMorphedValue(
      'amp_drive',
      hardwareState.amp_drive,
      morphState
    );
    const morphedEqMidFreq = calculateMorphedValue(
      'eq_mid_freq',
      hardwareState.eq_mid_freq,
      morphState
    );
    const morphedReverbAmt = calculateMorphedValue(
      'reverb_amount',
      hardwareState.reverb_amount,
      morphState
    );

    engine.updateMod1({
      on: hardwareState.effect_1_on,
      type: EFFECT_1_TYPES[hardwareState.effect_1_type] as import('./audio/effects/types').Mod1Type,
      rate: morphedMod1Rate,
      amount: morphedMod1Amt,
    });

    engine.updateMod2({
      on: hardwareState.effect_2_on,
      type: EFFECT_2_TYPES[hardwareState.effect_2_type] as import('./audio/effects/types').Mod2Type,
      rate: hardwareState.effect_2_rate,
      amount: morphedMod2Amt,
    });

    engine.updateDelay({
      on: hardwareState.delay_on,
      tempo: morphedDelayTempo,
      feedback: morphedDelayFb,
      amount: morphedDelayAmt,
      pingPong: hardwareState.delay_pingpong,
      filter: DELAY_FILTER_MODES[hardwareState.delay_filter ?? 0] as import('./audio/effects/types').DelayFilterType,
      global: hardwareState.delay_global,
    });

    engine.updateAmpEq({
      on: hardwareState.amp_eq_on,
      type: AMP_TYPES[hardwareState.amp_type] as import('./audio/effects/types').AmpType,
      drive: morphedAmpDrive,
      bass: hardwareState.eq_bass,
      mid: hardwareState.eq_mid,
      midFreq: morphedEqMidFreq,
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
      amount: morphedReverbAmt,
      bright: hardwareState.reverb_bright,
      global: hardwareState.reverb_global,
    });

    engine.updateRotary({
      on: hardwareState.rotary_on || hardwareState.rotary_organ_routed,
      speed: hardwareState.organ_rotary_speed || hardwareState.rotary_speed ? 'fast' : 'slow',
      stop: hardwareState.organ_rotary_stop || hardwareState.rotary_stop,
      drive: hardwareState.rotary_drive,
    });
  }, [hardwareState, engine]);

  // MIDI & Note Lifecycle Setup
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
          programsList={programsList}
          currentProgram={programStoreRef.current.getProgram(hardwareState.program_number)}
          updateState={handleUpdateHardwareState}
          onSelectProgram={handleSelectProgram}
          onSelectLiveSlot={handleSelectLiveSlot}
          onStoreConfirm={handleStoreConfirm}
          onStoreAsConfirm={handleStoreAsConfirm}
          onStoreCancel={handleStoreCancel}
          onTapMasterClock={handleTapMasterClock}
          onPanic={handlePanic}
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
