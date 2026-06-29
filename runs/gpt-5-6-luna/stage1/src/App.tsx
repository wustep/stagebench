import { useEffect, useMemo, useState } from 'react';
import { HardwarePanel } from './components/HardwarePanel';
import { Keyboard } from './components/Keyboard';
import { allControls, sections } from './hardware';
import './styles.css';

const computerKeyMap: Record<string, number> = { a: 1, w: 2, s: 3, e: 4, d: 5, f: 6, t: 7, g: 8, y: 9, h: 10, u: 11, j: 12, k: 13, o: 14, l: 15, p: 16 };

export default function App() {
  const initialValues = useMemo(() => Object.fromEntries(allControls.map((control) => [control.id, control.value ?? false])), []);
  const [values, setValues] = useState<Record<string, number | boolean>>(initialValues);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [displayText, setDisplayText] = useState('Grand Imperial');
  const [interactionNote, setInteractionNote] = useState('READY · VISUAL STUDY');

  const setControlValue = (id: string, value: number | boolean) => {
    setValues((current) => ({ ...current, [id]: value }));
    if (id.startsWith('program-live-') && value) setDisplayText(`Live ${id.slice(-1)} · Stage 4`);
    if (id.startsWith('synth-') && value === true) setDisplayText('Analog Lead');
  };

  const pressKey = (id: string) => {
    setPressedKeys((current) => new Set(current).add(id));
    setInteractionNote('KEY ACTIVE · HAMMER ACTION');
  };
  const releaseKey = (id: string) => {
    setPressedKeys((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const index = computerKeyMap[event.key.toLowerCase()];
      if (!index || event.repeat) return;
      pressKey(`key-${index}`);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const index = computerKeyMap[event.key.toLowerCase()];
      if (index) releaseKey(`key-${index}`);
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
      <div className="study-meta"><span>HARDWARE STUDY / 01</span><span>STAGE 4 88 · 88 KEYS · HAMMER ACTION</span><span>{interactionNote}</span></div>
      <article className="instrument" aria-label="Nord Stage 4 88 visual recreation">
        <div className="top-rail" />
        <div className="control-deck" style={{ gridTemplateColumns: sections.map((section) => `${section.fraction}fr`).join(' ') }}>
          {sections.map((section) => (
            <HardwarePanel key={section.id} section={section} values={values} onChange={setControlValue} displayText={displayText} />
          ))}
        </div>
        <div className="brand-mark">nord <strong>stage 4</strong><small>HAMMER ACTION 88</small></div>
        <Keyboard pressedKeys={pressedKeys} onPress={pressKey} onRelease={releaseKey} />
        <div className="bottom-rail" />
      </article>
      <div className="study-footer"><span>CLAVIA / SWEDEN</span><span>PROGRAM · ORGAN · PIANO · SYNTH · LAYER EFFECTS</span><span>PHASE 1 / VISUAL ONLY</span></div>
    </main>
  );
}
