import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('visual surface interactions', () => {
  it('depresses and releases a key with pointer and computer keyboard input', () => {
    render(<App />);
    const key = screen.getByRole('button', { name: 'A1 white key' });
    fireEvent.pointerDown(key);
    expect(key).toHaveClass('is-pressed');
    fireEvent.pointerUp(key);
    expect(key).not.toHaveClass('is-pressed');
    fireEvent.keyDown(window, { key: 'a' });
    expect(key).toHaveClass('is-pressed');
    fireEvent.keyUp(window, { key: 'a' });
    expect(key).not.toHaveClass('is-pressed');
  });

  it('toggles buttons and illuminates the program display state', () => {
    render(<App />);
    const liveButton = screen.getByRole('button', { name: 'Live program 1' });
    expect(liveButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(liveButton);
    expect(liveButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Live 1 · Stage 4')).toBeInTheDocument();
  });

  it('changes a knob with arrow keys and keeps the value in bounds', () => {
    render(<App />);
    const knob = screen.getByRole('slider', { name: /Master level/ });
    const initial = Number(knob.getAttribute('aria-valuenow'));
    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(Number(knob.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(knob).toHaveAttribute('aria-valuenow', '100');
    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(knob, { key: 'ArrowDown' });
    expect(knob).toHaveAttribute('aria-valuenow', '0');
  });

  it('exposes named controls, focusable performance controls, and no hero region', () => {
    render(<App />);
    expect(screen.getByRole('main')).toHaveTextContent('STAGE 4 88');
    expect(screen.getByRole('slider', { name: 'Pitch stick' })).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Modulation wheel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Organ on' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});
