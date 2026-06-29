import { useEffect, useMemo, useRef, useState } from 'react';
import { HardwarePanel } from './components/HardwarePanel';
import { Keyboard } from './components/Keyboard';
import { PianoAudioEngine, pianoParamsFromState, type PianoAudioStatus } from './audio';
import { allControls, createKeyModel, sections } from './hardware';
import { connectMidi, requestMidi, type MidiEvent } from './midi';
import { initialPianoState, reducePianoState, touchVelocity, type PianoAction, type PianoState, type PianoType, type Timbre, type TouchCurve } from './pianoState';
import './styles.css';

const computerKeyMap: Record<string, number> = { a: 1, w: 2, s: 3, e: 4, d: 5, f: 6, t: 7, g: 8, y: 9, h: 10, u: 11, j: 12, k: 13, o: 14, l: 15, p: 16 };
const typeButtons: Record<string, PianoType> = { 'piano-acoustic': 'Grand', 'piano-electric': 'Electric', 'piano-clav': 'Clav' };
const touchButtons: Record<string, TouchCurve> = { 'piano-touch-heavy': 'Heavy', 'piano-touch-medium': 'Medium', 'piano-touch-light': 'Light' };
const timbres: Timbre[] = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'];

export default function App() {
  const initialValues = useMemo(() => Object.fromEntries(allControls.map((control) => [control.id, control.value ?? false])), []);
  const keyModel = useMemo(() => createKeyModel(), []);
  const engineRef = useRef<PianoAudioEngine | null>(null);
  const midiCleanupRef = useRef<(() => void) | null>(null);
  const [values, setValues] = useState<Record<string, number | boolean>>(initialValues);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [piano, setPiano] = useState<PianoState>(initialPianoState);
  const [displayText, setDisplayText] = useState('Grand Imperial');
  const [interactionNote, setInteractionNote] = useState('READY · PIANO ENGINE');
  const [audioStatus, setAudioStatus] = useState<PianoAudioStatus>({ mode: 'loading', label: 'LOADING PIANO', loadedRoots: [] });
  const [midiStatus, setMidiStatus] = useState('MIDI UNAVAILABLE');

  const dispatchPiano = (action: PianoAction) => setPiano((current) => reducePianoState(current, action));

  useEffect(() => {
    const engine = new PianoAudioEngine();
    engineRef.current = engine;
    setAudioStatus(engine.status);
    void engine.prepare().then(setAudioStatus);
    let cancelled = false;
    void requestMidi().then((result) => {
      if (cancelled) return;
      setMidiStatus(result.status === 'connected' ? 'MIDI READY' : result.status === 'denied' ? 'MIDI DENIED' : 'MIDI UNAVAILABLE');
      if (result.access) midiCleanupRef.current = connectMidi(result.access, handleMidiEvent);
    });
    const handleBlur = () => {
      engine.allNotesOff();
      setPressedKeys(new Set());
      dispatchPiano({ type: 'set-half-pedal', value: 0 });
      setInteractionNote('FOCUS LOST · PANIC RELEASE');
    };
    window.addEventListener('blur', handleBlur);
    return () => {
      cancelled = true;
      midiCleanupRef.current?.();
      engine.allNotesOff();
      window.removeEventListener('blur', handleBlur);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setParams(pianoParamsFromState(piano, numericValue(values['performance-master-level'], 0.68), numericValue(values['effects-reverb-mix'], 0.22)));
    engineRef.current?.setSustain(piano.sustain ? Math.max(0.55, piano.halfPedal) : piano.halfPedal);
    engineRef.current?.setSostenuto(piano.sostenuto);
  }, [piano, values]);

  useEffect(() => {
    if (piano.modelAvailable) setDisplayText(`${piano.type} · ${piano.model}`);
    else setDisplayText('Piano not found');
  }, [piano]);

  function handleMidiEvent(event: MidiEvent) {
    if (event.type === 'note-on') {
      const key = keyModel.keys.find((candidate) => candidate.midi === event.note);
      if (key) pressKey(key.id, event.velocity, 'midi');
      else engineRef.current?.noteOn(event.note, event.velocity, focusedLayer(piano));
      setInteractionNote(`MIDI NOTE ON · ${event.note}`);
    } else if (event.type === 'note-off') {
      const key = keyModel.keys.find((candidate) => candidate.midi === event.note);
      if (key) releaseKey(key.id, 'midi');
      else engineRef.current?.noteOff(event.note);
    } else if (event.type === 'sustain') {
      dispatchPiano({ type: 'set-half-pedal', value: event.value });
      dispatchPiano({ type: 'toggle', key: 'sustain' });
    } else if (event.type === 'sostenuto') {
      dispatchPiano({ type: 'toggle', key: 'sostenuto' });
    } else if (event.type === 'soft-pedal') {
      dispatchPiano({ type: 'toggle', key: 'softPedal' });
    }
  }

  function focusedLayer(state: PianoState): 'A' | 'B' {
    return state.layerB.focused ? 'B' : 'A';
  }

  function keyForId(id: string) {
    return keyModel.keys.find((key) => key.id === id);
  }

  function pressKey(id: string, velocity = 0.82, source: 'pointer' | 'touch' | 'computer' | 'midi' = 'pointer') {
    const key = keyForId(id);
    if (!key) return;
    const layerState = focusedLayerState(piano);
    setPressedKeys((current) => new Set(current).add(id));
    if (piano.on) engineRef.current?.noteOn(key.midi + layerState.octave * 12, touchVelocity(piano.touch, velocity), focusedLayer(piano));
    setInteractionNote(`${source.toUpperCase()} · ${key.note} · ${Math.round(velocity * 127)}`);
  }

  function releaseKey(id: string, _source: 'pointer' | 'touch' | 'computer' | 'midi' = 'pointer') {
    const key = keyForId(id);
    if (!key) return;
    const layerState = focusedLayerState(piano);
    setPressedKeys((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    engineRef.current?.noteOff(key.midi + layerState.octave * 12);
  }

  function setControlValue(id: string, value: number | boolean) {
    setValues((current) => ({ ...current, [id]: value }));
    if (id === 'performance-master-level' && typeof value === 'number') engineRef.current?.setParams({ masterVolume: value });
    if (id === 'effects-reverb-mix' && typeof value === 'number') engineRef.current?.setParams({ reverbMix: value });
    if (id === 'piano-level' && typeof value === 'number') dispatchPiano({ type: 'set-layer-level', layer: 'A', value });
    if (id === 'piano-layer-b-level' && typeof value === 'number') dispatchPiano({ type: 'set-layer-level', layer: 'B', value });
    if (id === 'piano-on') dispatchPiano({ type: 'toggle-on' });
    if (id === 'piano-layer-a') dispatchPiano({ type: 'toggle-layer', layer: 'A' });
    if (id === 'piano-layer-b') dispatchPiano({ type: 'toggle-layer', layer: 'B' });
    if (id in typeButtons) {
      dispatchPiano({ type: 'set-type', value: typeButtons[id] });
      setDisplayText(`${typeButtons[id]} · MODEL SELECT`);
    }
    if (id === 'piano-model') dispatchPiano({ type: 'set-model', value: 'A4 Concert Grand', available: true });
    if (id in touchButtons) dispatchPiano({ type: 'set-touch', value: touchButtons[id] });
    if (id === 'piano-dyn-comp' && value === true) dispatchPiano({ type: 'set-dynamic-compression', value: ((piano.dynamicCompression + 1) % 4) as 0 | 1 | 2 | 3 });
    if (id === 'piano-timbre' && value === true) dispatchPiano({ type: 'set-timbre', value: timbres[(timbres.indexOf(piano.timbre) + 1) % timbres.length] });
    if (id === 'piano-soft') dispatchPiano({ type: 'toggle', key: 'softRelease' });
    if (id === 'piano-string') dispatchPiano({ type: 'toggle', key: 'stringResonance' });
    if (id === 'piano-sustain' || id === 'performance-sustain') {
      dispatchPiano({ type: 'toggle', key: 'sustain' });
      engineRef.current?.setSustain(value ? 1 : 0);
    }
    if (id === 'piano-unison' && value === true) dispatchPiano({ type: 'set-unison', value: ((piano.unison + 1) % 4) as 0 | 1 | 2 | 3 });
    if (id === 'performance-panic' && value === true) {
      engineRef.current?.allNotesOff();
      setPressedKeys(new Set());
      setInteractionNote('PANIC · ALL NOTES OFF');
    }
    if (id.startsWith('program-live-') && value) setDisplayText(`Live ${id.slice(-1)} · Stage 4`);
    if (id.startsWith('synth-') && value === true) setDisplayText('Analog Lead');
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const index = computerKeyMap[event.key.toLowerCase()];
      if (!index || event.repeat) return;
      pressKey(`key-${index}`, event.shiftKey ? 0.98 : 0.76, 'computer');
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const index = computerKeyMap[event.key.toLowerCase()];
      if (index) releaseKey(`key-${index}`, 'computer');
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  });

  return (
    <main className="study-shell">
      <div className="study-meta"><span>HARDWARE STUDY / 02</span><span>STAGE 4 88 · 88 KEYS · HAMMER ACTION</span><span>{interactionNote}</span></div>
      <article className="instrument" aria-label="Nord Stage 4 88 visual recreation with Piano instrument">
        <div className="top-rail" />
        <div className="control-deck" style={{ gridTemplateColumns: sections.map((section) => `${section.fraction}fr`).join(' ') }}>
          {sections.map((section) => (
            <HardwarePanel key={section.id} section={section} values={values} onChange={setControlValue} displayText={displayText} audioStatus={audioStatus.label} pianoState={piano} />
          ))}
        </div>
        <div className="brand-mark">nord <strong>stage 4</strong><small>HAMMER ACTION 88</small></div>
        <Keyboard pressedKeys={pressedKeys} onPress={pressKey} onRelease={releaseKey} />
        <div className="bottom-rail" />
      </article>
      <div className="study-footer"><span>CLAVIA / SWEDEN</span><span>PROGRAM · ORGAN · PIANO · SYNTH · LAYER EFFECTS</span><span>{audioStatus.label} · {midiStatus}</span></div>
    </main>
  );
}

function numericValue(value: number | boolean | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function focusedLayerState(state: PianoState) {
  return state.layerB.focused ? state.layerB : state.layerA;
}
