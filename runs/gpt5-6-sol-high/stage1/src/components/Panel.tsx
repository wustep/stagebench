import { useState, type ReactNode } from 'react'
import { Drawbar, Fader, Indicator, Knob, OLED, PanelButton, Wheel } from './Controls'

function Section({ title, subtitle, className = '', children }: { title: string; subtitle?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`panel-section ${className}`}>
      <header className="section-header">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </header>
      {children}
    </section>
  )
}

const drawbarLabels = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′']

function PerformanceControls() {
  return (
    <div className="performance-controls">
      <button className="power-rocker" type="button" aria-label="Power"><span /></button>
      <Knob label="MASTER LEVEL" initial={65} size="large" />
      <div className="wheels">
        <Wheel label="PITCH STICK" pitch />
        <Wheel label="MOD WHEEL" />
      </div>
      <div className="brand" aria-label="Nord Stage 4"><span>nord</span> stage <b>4</b></div>
    </div>
  )
}

function OrganSection() {
  return (
    <Section title="ORGAN" subtitle="B3 · VOX · FARF · PIPE" className="organ-section">
      <div className="organ-top control-row">
        <div className="button-stack">
          <PanelButton label="ON" initial red compact />
          <PanelButton label="KB ZONE" compact />
          <PanelButton label="SUSTPED" compact />
        </div>
        <Fader label="A" initial={82} />
        <div className="organ-model">
          <span className="group-label">MODEL</span>
          <PanelButton label="B3" initial compact />
          <PanelButton label="VOX" compact />
          <PanelButton label="FARF" compact />
          <PanelButton label="PIPE" compact />
        </div>
        <Fader label="B" initial={69} />
        <div className="button-stack">
          <PanelButton label="ON" initial red compact />
          <PanelButton label="KB ZONE" compact />
          <PanelButton label="SUSTPED" compact />
        </div>
      </div>
      <div className="organ-preset-bar">
        <PanelButton label="PRESET I" compact />
        <PanelButton label="PRESET II" compact />
        <PanelButton label="PERCUSSION" compact initial />
      </div>
      <div className="drawbars">
        {drawbarLabels.map((label, index) => <Drawbar key={label} label={label} initial={[8, 5, 7, 6, 4, 3, 2, 1, 1][index]} dark={index !== 3 && index !== 6} />)}
      </div>
      <div className="organ-bottom">
        <div className="button-stack"><PanelButton label="VIBRATO / CHORUS" compact /><PanelButton label="C1 C2 C3" compact /></div>
        <Knob label="DRIVE" initial={30} size="small" morph />
        <div className="button-stack"><PanelButton label="ROTARY SLOW / FAST" compact initial /><PanelButton label="STOP MODE" compact /></div>
      </div>
    </Section>
  )
}

function PianoSection() {
  return (
    <Section title="PIANO" subtitle="NORD PIANO LIBRARY" className="piano-section">
      <div className="engine-strip">
        <div className="button-stack"><PanelButton label="ON" initial red compact /><PanelButton label="KB ZONE" compact /><PanelButton label="SUSTPED" compact /></div>
        <Fader label="A" initial={78} />
        <div className="button-stack"><PanelButton label="ON" initial red compact /><PanelButton label="KB ZONE" compact /><PanelButton label="SUSTPED" compact /></div>
        <Fader label="B" initial={55} />
      </div>
      <div className="piano-select">
        <div className="piano-types">
          <span className="group-label">TYPE</span>
          {['GRAND', 'UPRIGHT', 'E.PIANO', 'CLAV / HPS', 'DIGITAL', 'MISC'].map((label, index) => <PanelButton key={label} label={label} compact initial={index === 0} />)}
        </div>
        <Knob label="SELECT" encoder initial={42} size="medium" />
      </div>
      <div className="piano-tools grid-2">
        <div><span className="group-label">PIANO INFO</span><PanelButton label="MONO" compact /><PanelButton label="STRING RES" initial compact /></div>
        <div><span className="group-label">TIMBRE</span><PanelButton label="SOFT / MID / BRIGHT" compact /><PanelButton label="DYN COMP" compact /></div>
        <div><span className="group-label">PEDALS</span><PanelButton label="PEDAL NOISE" initial compact /><PanelButton label="SOFT REL" compact /></div>
        <Knob label="UNISON" initial={24} size="small" morph />
      </div>
      <div className="piano-preset"><PanelButton label="PIANO PRESET" compact /><Knob label="PRESET" encoder initial={58} size="small" /></div>
    </Section>
  )
}

function ProgramSection({ powered }: { powered: boolean }) {
  return (
    <Section title="PROGRAM" subtitle="LAYER SCENE" className="program-section">
      <div className="program-top-row">
        <PanelButton label="SHIFT" compact />
        <PanelButton label="STORE" red compact />
        <Knob label="PROGRAM" encoder initial={36} size="medium" />
        <PanelButton label="LIVE MODE" compact />
      </div>
      <OLED lit={powered} title="Main program display" className="program-oled">
        <div className="display-number">A:11</div>
        <div className="display-title">Nord Stage 4</div>
        <div className="display-line selected">B3 Soft · Pearl Upright</div>
        <div className="display-line">Super Saw · Warm Pad</div>
      </OLED>
      <div className="program-nav">
        <PanelButton label="PAGE ◀" compact /><PanelButton label="PAGE ▶" compact />
        <PanelButton label="LIST" compact /><PanelButton label="SONG" compact />
      </div>
      <div className="program-buttons">
        {Array.from({ length: 8 }, (_, index) => <PanelButton key={index} label={`${index + 1}`} compact initial={index === 0} />)}
      </div>
      <div className="layer-scene">
        <span className="group-label">LAYER SCENE</span>
        <PanelButton label="I" compact initial /><PanelButton label="II" compact />
        <PanelButton label="KEYBOARD SPLIT" compact /><PanelButton label="MONITOR" compact />
      </div>
      <div className="morph-row"><span className="group-label">MORPH ASSIGN</span><PanelButton label="WHEEL" compact /><PanelButton label="A.T." compact /><PanelButton label="CTRL PED" compact /></div>
    </Section>
  )
}

function SynthSection({ powered }: { powered: boolean }) {
  return (
    <Section title="SYNTH" subtitle="SYNTHESIZER · EXTERN" className="synth-section">
      <div className="engine-strip synth-layers">
        <div className="button-stack"><PanelButton label="ON" initial red compact /><PanelButton label="KB ZONE" compact /></div><Fader label="A" initial={68} />
        <div className="button-stack"><PanelButton label="ON" initial red compact /><PanelButton label="KB ZONE" compact /></div><Fader label="B" initial={42} />
        <div className="button-stack"><PanelButton label="ON" red compact /><PanelButton label="KB ZONE" compact /></div><Fader label="C" initial={30} />
      </div>
      <OLED lit={powered} title="Synth oscillator display" className="synth-oled">
        <div className="waveform"><svg viewBox="0 0 180 28" aria-hidden="true"><path d="M0 20 L12 20 L17 5 L25 24 L34 4 L43 23 L51 7 L59 20 L76 20 L82 4 L91 23 L99 7 L108 21 L119 8 L128 20 L145 20 L151 4 L160 23 L169 7 L180 20" /></svg></div>
        <div className="display-title">Super Saw</div>
        <div className="display-line">DETUNE 4.5 · ANALOG MULTI</div>
      </OLED>
      <div className="synth-selectors">
        <Knob label="TYPE" encoder initial={22} size="small" />
        <Knob label="CATEGORY" encoder initial={48} size="small" />
        <Knob label="WAVE" encoder initial={65} size="small" />
        <PanelButton label="SAMPLE" compact /><PanelButton label="ANALOG" initial compact /><PanelButton label="WAVE" compact />
      </div>
      <div className="synth-parameters">
        <div className="parameter-box"><span className="group-label">LFO</span><Knob label="RATE" initial={32} size="small" morph /><PanelButton label="MASTER CLOCK" compact /></div>
        <div className="parameter-box"><span className="group-label">OSCILLATOR</span><Knob label="CONTROL" initial={58} size="small" morph /><PanelButton label="PITCH MOD" compact /></div>
        <div className="parameter-box"><span className="group-label">FILTER</span><Knob label="FREQ" initial={72} size="small" morph /><Knob label="RES" initial={28} size="small" morph /></div>
        <div className="parameter-box"><span className="group-label">AMP ENV</span><Knob label="ATTACK" initial={18} size="small" /><Knob label="DEC / REL" initial={46} size="small" /></div>
      </div>
      <div className="synth-bottom"><PanelButton label="UNISON" initial compact /><Knob label="GLIDE" initial={14} size="small" /><PanelButton label="VIBRATO" compact /><PanelButton label="ARP RUN" compact /></div>
    </Section>
  )
}

function EffectsSection() {
  return (
    <Section title="LAYER EFFECTS" subtitle="PER-LAYER PROCESSING" className="effects-section">
      <div className="effects-grid">
        <div className="effect-unit"><span className="effect-title">MODULATION 1</span><Knob label="RATE" initial={34} size="small" morph /><Knob label="AMOUNT" initial={47} size="small" morph /><PanelButton label="TREM / PAN" compact initial /><PanelButton label="ON" red compact initial /></div>
        <div className="effect-unit"><span className="effect-title">MODULATION 2</span><Knob label="RATE" initial={25} size="small" morph /><Knob label="AMOUNT" initial={38} size="small" morph /><PanelButton label="CHORUS" compact /><PanelButton label="ON" red compact /></div>
        <div className="effect-unit delay-unit"><span className="effect-title">DELAY</span><Knob label="TEMPO" initial={44} size="small" morph /><Knob label="FEEDBACK" initial={36} size="small" morph /><Knob label="MIX" initial={32} size="small" morph /><PanelButton label="ANALOG" compact /><PanelButton label="ON" red compact initial /></div>
        <div className="effect-unit"><span className="effect-title">AMP SIM / EQ</span><Knob label="DRIVE" initial={28} size="small" morph /><Knob label="BASS" initial={48} size="small" /><Knob label="MID" initial={54} size="small" /><Knob label="TREBLE" initial={61} size="small" /><PanelButton label="ON" red compact initial /></div>
        <div className="effect-unit"><span className="effect-title">COMPRESSOR</span><Knob label="AMOUNT" initial={27} size="small" morph /><PanelButton label="FAST" compact /><PanelButton label="ON" red compact /></div>
        <div className="effect-unit"><span className="effect-title">REVERB</span><Knob label="SIZE" initial={56} size="small" morph /><Knob label="MIX" initial={37} size="small" morph /><PanelButton label="STAGE" initial compact /><PanelButton label="CHORALE" compact /><PanelButton label="ON" red compact initial /></div>
      </div>
      <div className="effect-focus"><span className="group-label">LAYER</span><PanelButton label="ORGAN" compact /><PanelButton label="PIANO A" compact initial /><PanelButton label="PIANO B" compact /><PanelButton label="SYNTH A" compact /><PanelButton label="SYNTH B" compact /><PanelButton label="SYNTH C" compact /></div>
    </Section>
  )
}

export function Panel() {
  const [powered, setPowered] = useState(true)
  return (
    <div className="control-deck">
      <div className="deck-highlight" />
      <PerformanceControls />
      <OrganSection />
      <PianoSection />
      <ProgramSection powered={powered} />
      <SynthSection powered={powered} />
      <EffectsSection />
      <button className={`main-power ${powered ? 'on' : ''}`} type="button" aria-label="Toggle display power" aria-pressed={powered} onClick={() => setPowered((value) => !value)}>
        <Indicator on={powered} color="red" /><span>POWER</span>
      </button>
    </div>
  )
}
