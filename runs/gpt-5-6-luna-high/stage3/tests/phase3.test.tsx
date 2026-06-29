import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/main';

describe('Phase 3 rendered Program/effect boundaries', () => {
  it('renders canonical Program metadata and updates it through Store/scene controls', () => {
    render(<App/>);
    const display = screen.getByRole('status', { name: 'Program Display' });
    expect(display).toHaveTextContent('01 GRAND PIANO');
    fireEvent.click(screen.getByRole('button', { name: 'Scene II' }));
    expect(screen.getAllByText(/Scene\s*II/).length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Store As' }));
    expect(display).toHaveTextContent(/PROGRAM/);
  });

  it('updates effect status and canonical wet/dry display from rendered controls', () => {
    render(<App/>);
    fireEvent.click(screen.getByRole('button', { name: 'Delay' }));
    expect(screen.getByRole('region', { name: 'LAYER EFFECTS' })).toHaveTextContent(/delay:/i);
  });
});
