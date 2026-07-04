interface OledProps {
  variant: 'program' | 'synth';
}

/**
 * A primary OLED display. Only Program and Synth carry one (visual spec).
 * These are static, honest renderings of the panel — they display fixed panel
 * text and do NOT report any live/unimplemented state as working. Marked
 * decorative and aria-hidden from interaction (they are outputs, not controls).
 */
export function Oled({ variant }: OledProps) {
  if (variant === 'program') {
    return (
      <div className="oled program-oled" data-oled="program" role="img" aria-label="Program display">
        <div className="oled-line big">A:11</div>
        <div className="oled-line big">Nord Stage 4</div>
        <div className="oled-line small">▚ B3 Soulful</div>
        <div className="oled-line small">▤ White Grand</div>
        <div className="oled-line small">▧ Vista Pad Whl</div>
      </div>
    );
  }
  return (
    <div className="oled synth-oled" data-oled="synth" role="img" aria-label="Synth display">
      <div className="oled-line header">OSC WAVEFORM</div>
      <div className="oled-line big">Super Saw</div>
      <div className="oled-line small">DETUNE: 3.4</div>
      <div className="oled-tabs">
        <span>TYPE</span>
        <span>CAT</span>
        <span>WAVE</span>
      </div>
    </div>
  );
}
