import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../src/main';

describe('Phase 2 Piano surface', () => {
  it('keeps inherited key geometry and exposes Piano status', () => {
    render(<App/>);
    expect(screen.getAllByRole('button', { name: /White key/ })).toHaveLength(43);
    expect(screen.getAllByRole('button', { name: /Black key near/ })).toHaveLength(30);
    expect(screen.getByRole('region', { name: 'PIANO' })).toBeInTheDocument();
    expect(screen.getByText(/(piano|model) ready/i)).toBeInTheDocument();
    expect(screen.getByText(/MIDI unavailable/)).toBeInTheDocument();
  });

  it('routes pointer and touch key actions to the shared lifecycle', () => {
    render(<App/>);
    const key = screen.getByRole('button', { name: 'White key 1' });
    fireEvent.pointerDown(key, { pointerType: 'touch' });
    expect(key).toHaveClass('pressed');
    fireEvent.pointerUp(key, { pointerType: 'touch' });
    expect(key).not.toHaveClass('pressed');
  });

  it('updates canonical Piano controls and feedback', () => {
    render(<App/>);
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Touch Curve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Soft Release' }));
    fireEvent.click(screen.getByRole('button', { name: 'Soft Pedal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sostenuto' }));
    expect(screen.getByRole('button', { name: 'Soft Release' })).toHaveAttribute('aria-pressed', 'true');
  });
});
