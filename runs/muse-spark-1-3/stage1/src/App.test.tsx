/**
 * App smoke test: the full Phase 1 surface mounts with keybed, deck,
 * status bar, and honest loading status.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';

describe('app surface', () => {
  it('mounts the Nord Stage 4 surface with keybed and status', () => {
    const ctx = new FakeAudioContext();
    const engine = new PianoEngine({ createContext: () => ctx });
    render(<App engineFactory={() => engine} midiProvider={() => Promise.resolve(null)} />);
    expect(screen.getByTestId('instrument')).toHaveAccessibleName(/nord stage 4 73/i);
    expect(screen.getByTestId('control-deck')).toBeInTheDocument();
    expect(screen.getByTestId('keybed')).toBeInTheDocument();
    expect(screen.getByTestId('engine-status')).toBeInTheDocument();
    expect(screen.getByTestId('sustain-pedal')).toBeInTheDocument();
    expect(screen.getByTestId('panic')).toBeInTheDocument();
  });
});
