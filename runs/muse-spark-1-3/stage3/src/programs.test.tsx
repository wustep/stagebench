/**
 * programs.roundtrip / programs.store-live / programs.undo-cancel /
 * programs.navigation — 32 slots, Store/Store As with naming, truthful dirty
 * E, edit-discard on program change (with single-level undo), dial browsing,
 * numeric list view, pages, and the 8 auto-storing Live slots.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { PianoEngine } from './audio/engine';
import { FakeAudioContext } from './audio/fakes';
import { StageEngine } from './audio/stageEngine';
import { StageFakeContext } from './audio/stageFakes';
import { factoryPrograms, slotLabel } from './state/program';

function renderApp() {
  const legacy = new PianoEngine({ createContext: () => new FakeAudioContext() });
  const stage = new StageEngine({ createContext: () => new StageFakeContext(), fetchImpl: null });
  render(<App engineFactory={() => legacy} stageFactory={() => stage} midiProvider={() => Promise.resolve(null)} />);
  return stage;
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitReady(stage: StageEngine) {
  for (let i = 0; i < 50 && (stage.getStatus() === 'idle' || stage.getStatus() === 'loading'); i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

describe('programs.navigation', () => {
  it('ships 32 slots on 4 pages with dial browsing and a numeric list view', async () => {
    renderApp();
    await settled();
    expect(factoryPrograms().length).toBeGreaterThanOrEqual(8);
    // Page 1 shows slots 1.1..1.8.
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/1\.1/);
    fireEvent.pointerDown(screen.getByTestId('p3-program-page-2'));
    // Dial forward one slot → 2.1 region (slot 8).
    fireEvent.keyDown(screen.getByTestId('p3-program-dial'), { key: 'ArrowUp' });
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/1\.2/);
    // Numeric list view shows all 32 programs.
    fireEvent.pointerDown(screen.getByTestId('p3-list-view'));
    expect(screen.getByTestId('p3-program-list')).toBeInTheDocument();
    expect(within(screen.getByTestId('p3-program-list')).getAllByRole('option')).toHaveLength(32);
    fireEvent.pointerDown(screen.getByTestId('p3-program-list-17'));
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/3\.2/);
    expect(slotLabel(17)).toBe('3.2');
  });

  it('program buttons select slots on the current page', async () => {
    renderApp();
    await settled();
    fireEvent.pointerDown(screen.getByTestId('program-slot-3'));
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/1\.3/);
  });
});

describe('programs.roundtrip', () => {
  it('dirty E is truthful: edits flag it, loads clear it', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    expect(screen.getByTestId('p3-program-display').textContent).not.toMatch(/E/);
    // Edit: organ drawbar through the panel.
    fireEvent.pointerDown(screen.getByTestId('p3-organ-A-drawbar-1'));
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/E/);
    // Loading another program clears the flag (edit-discard).
    fireEvent.pointerDown(screen.getByTestId('program-slot-2'));
    expect(screen.getByTestId('p3-program-display').textContent).not.toMatch(/E/);
  });

  it('Store round-trips all supported state across slots', async () => {
    const stage = renderApp();
    await settled();
    await waitReady(stage);
    // Make distinctive edits: organ model + drawbar, synth wave, clock, split.
    fireEvent.pointerDown(screen.getByTestId('p3-organ-A-model-Farf'));
    fireEvent.pointerDown(screen.getByTestId('p3-synth-A-wave-Super-Saw'));
    fireEvent.pointerDown(screen.getByTestId('p3-split-on'));
    fireEvent.keyDown(screen.getByTestId('p3-clock-bpm'), { key: 'ArrowUp' });
    // Store to slot 2.5 (index 20).
    fireEvent.pointerDown(screen.getByTestId('p3-store'));
    expect(screen.getByTestId('p3-store-flash').textContent).toMatch(/select destination/i);
    fireEvent.pointerDown(screen.getByTestId('p3-program-page-3'));
    fireEvent.pointerDown(screen.getByTestId('p3-slot-20'));
    fireEvent.pointerDown(screen.getByTestId('p3-store'));
    expect(screen.getByTestId('p3-store-flash').textContent).toMatch(/Stored/);
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/3\.5/);
    // Move away and reload: the stored state round-trips.
    fireEvent.pointerDown(screen.getByTestId('program-slot-1'));
    expect(screen.getByTestId('p3-organ-A-model-B3')).toHaveAttribute('data-active', 'true');
    // Reload via dial/buttons: slot 20 keeps the Farf model + split + clock.
    fireEvent.pointerDown(screen.getByTestId('p3-program-page-3'));
    fireEvent.pointerDown(screen.getByTestId('p3-slot-20'));
    expect(screen.getByTestId('p3-organ-A-model-Farf')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('p3-synth-A-wave-Super-Saw')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('p3-split-on')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('p3-clock-bpm').getAttribute('aria-valuenow')).toBe('121');
  });

  it('Store As names the program (character entry, delete)', async () => {
    renderApp();
    await settled();
    fireEvent.pointerDown(screen.getByTestId('p3-store-as'));
    const name = screen.getByTestId('p3-store-name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'My Pad' } });
    fireEvent.pointerDown(screen.getByTestId('p3-store-del'));
    expect((screen.getByTestId('p3-store-name') as HTMLInputElement).value).toBe('My Pa');
    fireEvent.change(screen.getByTestId('p3-store-name'), { target: { value: 'My Pad X' } });
    fireEvent.pointerDown(screen.getByTestId('p3-store'));
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/My Pad X/);
  });

  it('canceling Store restores the auditioned-away edits', async () => {
    renderApp();
    await settled();
    fireEvent.keyDown(screen.getByTestId('p3-organ-A-drawbar-1'), { key: 'ArrowDown' }); // 8 → 7
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/E/);
    fireEvent.pointerDown(screen.getByTestId('p3-store'));
    fireEvent.pointerDown(screen.getByTestId('program-slot-4')); // audition dest (no cancel)
    expect(screen.getByTestId('p3-store-cancel')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('p3-store-cancel'));
    // Edits restored (still dirty, drawbar still moved).
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/E/);
    expect(screen.getByTestId('p3-organ-A-drawbar-1').getAttribute('aria-valuenow')).toBe('7');
  });
});

describe('programs.store-live', () => {
  it('Live slots auto-store edits and survive reload', async () => {
    renderApp();
    await settled();
    fireEvent.pointerDown(screen.getByTestId('p3-live-mode'));
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/L1/);
    // Edit in Live: transpose +2 (auto-stored, never dirty).
    fireEvent.keyDown(screen.getByTestId('p3-transpose'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByTestId('p3-transpose'), { key: 'ArrowUp' });
    expect(screen.getByTestId('p3-program-display').textContent).not.toMatch(/E/);
    expect(screen.getByTestId('p3-transpose-readout').textContent).toMatch(/\+2/);
    // Switch Live slot and back: the edit persisted.
    fireEvent.pointerDown(screen.getByTestId('p3-live-2'));
    fireEvent.pointerDown(screen.getByTestId('p3-live-1'));
    expect(screen.getByTestId('p3-transpose-readout').textContent).toMatch(/\+2/);
    // 8 live slots addressable.
    fireEvent.pointerDown(screen.getByTestId('p3-live-8'));
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/L8/);
  });
});

describe('programs.undo-cancel', () => {
  it('single-level undo restores edits discarded by a program change', async () => {
    renderApp();
    await settled();
    fireEvent.keyDown(screen.getByTestId('p3-organ-A-drawbar-1'), { key: 'ArrowDown' }); // 8 → 7
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/E/);
    fireEvent.pointerDown(screen.getByTestId('program-slot-2'));
    expect(screen.getByTestId('p3-undo')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('p3-undo'));
    expect(screen.getByTestId('p3-organ-A-drawbar-1').getAttribute('aria-valuenow')).toBe('7');
    expect(screen.getByTestId('p3-program-display').textContent).toMatch(/E/);
  });
});
