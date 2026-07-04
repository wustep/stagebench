import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { createFakeBackend } from '../src/audio/fakeBackend';
import type { FakeMidiAccess, FakeMidiInput } from '../src/input/midi';

afterEach(cleanup);

function fakeMidi(): { access: FakeMidiAccess; input: FakeMidiInput } {
  const input: FakeMidiInput = { onmidimessage: null, state: 'connected' };
  return { access: { inputs: new Map([['in-1', input]]), onstatechange: null }, input };
}

// feature: piano.basic-inputs (MIDI through the app) + status
describe('MIDI integration (piano.basic-inputs)', () => {
  it('plays notes from MIDI and reports connected status', async () => {
    const backend = createFakeBackend();
    const { access, input } = fakeMidi();
    await act(async () => {
      render(
        <App
          audioBackend={backend}
          enableComputerKeyboard={false}
          midiProvider={async () => access}
        />,
      );
    });
    expect(screen.getByText(/MIDI connected/i)).toBeTruthy();
    await act(async () => {
      input.onmidimessage!({ data: [0x90, 60, 100] });
    });
    expect(backend.tones).toHaveLength(1);
    await act(async () => {
      input.onmidimessage!({ data: [0x80, 60, 0] });
    });
    expect(backend.tones[0].stopped).toBe(true);
  });

  it('reports MIDI unsupported when there is no provider', () => {
    const backend = createFakeBackend();
    render(<App audioBackend={backend} enableComputerKeyboard={false} midiProvider={undefined} />);
    expect(screen.getByText(/MIDI unsupported/i)).toBeTruthy();
  });

  it('reports denied when the provider rejects', async () => {
    const backend = createFakeBackend();
    await act(async () => {
      render(
        <App
          audioBackend={backend}
          enableComputerKeyboard={false}
          midiProvider={async () => {
            throw new Error('denied');
          }}
        />,
      );
    });
    expect(screen.getByText(/MIDI denied/i)).toBeTruthy();
  });
});

// feature: piano.basic-inputs (computer keyboard with repeat suppression + blur)
describe('computer keyboard integration (piano.basic-inputs)', () => {
  it('maps a computer key to a note and suppresses OS autorepeat', () => {
    const backend = createFakeBackend();
    render(<App audioBackend={backend} enableComputerKeyboard={true} />);
    // KeyA is not mapped; KeyZ maps to base note. Fire keydown twice with repeat.
    fireEvent.keyDown(window, { code: 'KeyZ' });
    fireEvent.keyDown(window, { code: 'KeyZ', repeat: true }); // repeat: ignored
    expect(backend.tones).toHaveLength(1);
    fireEvent.keyUp(window, { code: 'KeyZ' });
    expect(backend.tones[0].stopped).toBe(true);
  });

  it('releases keyboard notes on window blur', () => {
    const backend = createFakeBackend();
    render(<App audioBackend={backend} enableComputerKeyboard={true} />);
    fireEvent.keyDown(window, { code: 'KeyX' });
    expect(backend.activeToneCount).toBe(1);
    fireEvent.blur(window);
    expect(backend.activeToneCount).toBe(0);
  });

  it('ignores modifier-key chords (e.g. Cmd+Z)', () => {
    const backend = createFakeBackend();
    render(<App audioBackend={backend} enableComputerKeyboard={true} />);
    fireEvent.keyDown(window, { code: 'KeyZ', metaKey: true });
    expect(backend.tones).toHaveLength(0);
  });
});
