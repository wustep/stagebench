import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('Nord Stage 4 Application', () => {
  it('renders the complete Nord Stage 4 instrument and status bar', () => {
    render(<App />);
    expect(screen.getByRole('application', { name: /nord stage 4/i })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: /instrument status/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /nord stage 4 73-key/i })).toBeInTheDocument();
  });
});
