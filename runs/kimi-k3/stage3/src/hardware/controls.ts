/**
 * Normalized hardware control model.
 *
 * Every visible physical input on the deck is declared here exactly once with
 * a stable ID and an accessible name. Phase 1 honesty contract: these
 * controls are decorative — moving them updates presentation state only and
 * never touches audio or system state.
 */

export type ControlKind = 'knob' | 'fader' | 'drawbar' | 'wheel' | 'pitchstick' | 'button'

export interface ControlDef {
  id: string
  section: string
  kind: ControlKind
  /** Accessible name (aria-label). */
  label: string
  /** Small printed legend shown near the control. */
  legend?: string
  min: number
  max: number
  step: number
  defaultValue: number
  /** True for momentary buttons (no persistent value semantics beyond pressed flash). */
  momentary?: boolean
  /** Options printed next to a selector button (LED cycles). */
  options?: readonly string[]
  /** True when the control drives real engine state (Phase 2 honesty split). */
  functional?: boolean
}

function knob(id: string, section: string, label: string, legend?: string): ControlDef {
  return { id, section, kind: 'knob', label, legend, min: 0, max: 127, step: 1, defaultValue: 64 }
}

function fader(id: string, label: string): ControlDef {
  const section = id.split('.')[0]
  return { id, section, kind: 'fader', label, min: 0, max: 127, step: 1, defaultValue: 100 }
}

function drawbar(id: string, section: string, label: string): ControlDef {
  // Drawbars run 0 (in) .. 8 (fully out), like the hardware.
  return { id, section, kind: 'drawbar', label, min: 0, max: 8, step: 1, defaultValue: 0 }
}

function button(id: string, section: string, label: string, opts?: { legend?: string; options?: readonly string[]; momentary?: boolean }): ControlDef {
  return { id, section, kind: 'button', label, legend: opts?.legend, min: 0, max: 1, step: 1, defaultValue: 0, options: opts?.options, momentary: opts?.momentary }
}

const DRAWBAR_NAMES = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'] as const

const controls: ControlDef[] = [
  // ---------------------------------------------------------------- Performance
  { id: 'perf.pitchStick', section: 'performance', kind: 'pitchstick', label: 'Pitch stick', legend: 'PITCH STICK', min: -1, max: 1, step: 0.05, defaultValue: 0, functional: true },
  { id: 'perf.modWheel', section: 'performance', kind: 'wheel', label: 'Modulation wheel', legend: 'MOD WHEEL', min: 0, max: 127, step: 1, defaultValue: 0, functional: true },
  { id: 'perf.ctrlPedal', section: 'performance', kind: 'wheel', label: 'Control pedal (virtual)', legend: 'CTRL PEDAL', min: 0, max: 127, step: 1, defaultValue: 0, functional: true },
  { ...knob('perf.masterLevel', 'performance', 'Master level', 'MASTER LEVEL'), functional: true },

  // ---------------------------------------------------------------- Organ
  { ...button('organ.on', 'organ', 'Organ section on/off', { legend: 'ON' }), functional: true },
  ...DRAWBAR_NAMES.map((name, i) => ({ ...drawbar(`organ.drawbar.${i + 1}`, 'organ', `Organ drawbar ${i + 1} (${name})`), functional: true })),
  { ...button('organ.model', 'organ', 'Organ model selector', { options: ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'] }), functional: true },
  { ...button('organ.vibratoChorus', 'organ', 'Vibrato / Chorus selector', { options: ['V1', 'V2', 'V3', 'C1', 'C2', 'C3'] }), functional: true },
  { ...button('organ.vibratoChorusOn', 'organ', 'Vibrato / Chorus on/off'), functional: true },
  { ...button('organ.percussionOn', 'organ', 'Percussion on/off'), functional: true },
  { ...button('organ.percussionDecay', 'organ', 'Percussion decay (slow/fast)'), functional: true },
  { ...button('organ.percussionHarmonic', 'organ', 'Percussion harmonic (third)'), functional: true },
  { ...button('organ.percussionSoft', 'organ', 'Percussion soft/normal'), functional: true },
  { ...button('organ.rotarySpeed', 'organ', 'Rotary speed (slow/stop/fast)', { options: ['SLOW', 'STOP', 'FAST'] }), functional: true },
  { ...knob('organ.rotaryDrive', 'organ', 'Rotary drive', 'DRIVE'), functional: true },
  { ...button('organ.rotaryRoute', 'organ', 'Organ rotary routing', { legend: 'ROTARY' }), functional: true },
  { ...button('organ.layerA', 'organ', 'Organ layer A enable', { legend: 'A' }), defaultValue: 1, functional: true },
  { ...button('organ.layerB', 'organ', 'Organ layer B enable', { legend: 'B' }), functional: true },
  button('organ.panelASelect', 'organ', 'Organ panel A select'),
  button('organ.panelBSelect', 'organ', 'Organ panel B select'),
  { ...button('organ.sustainPedal', 'organ', 'Organ sustain pedal routing', { legend: 'SUST PED' }), defaultValue: 1, functional: true },
  { ...button('organ.pitchStick', 'organ', 'Organ pitch stick routing', { legend: 'P STICK' }), functional: true },
  { ...button('organ.octaveShift', 'organ', 'Organ octave shift', { legend: 'OCT', options: ['0', '+12', '-12'] }), functional: true },
  { ...fader('organ.level', 'Organ level'), functional: true },

  // ---------------------------------------------------------------- Piano
  { ...button('piano.on', 'piano', 'Piano section on/off', { legend: 'ON' }), defaultValue: 1, functional: true },
  { ...button('piano.layerA', 'piano', 'Piano layer A enable', { legend: 'A' }), defaultValue: 1, functional: true },
  { ...button('piano.layerB', 'piano', 'Piano layer B enable', { legend: 'B' }), functional: true },
  { ...fader('piano.level', 'Piano level'), functional: true },
  { ...button('piano.octaveShift', 'piano', 'Piano octave shift', { legend: 'OCT', options: ['0', '+12', '-12'] }), functional: true },
  { ...button('piano.type', 'piano', 'Piano type selector', { options: ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] }), functional: true },
  knob('piano.modelSelect', 'piano', 'Piano model selector', 'MODEL'),
  { ...button('piano.kbTouch', 'piano', 'KB Touch (key touch response)', { options: ['Heavy', 'Medium', 'Light'] }), defaultValue: 1, functional: true },
  { ...button('piano.dynComp', 'piano', 'Dyn Comp', { options: ['Off', '1', '2', '3'] }), functional: true },
  { ...button('piano.timbre', 'piano', 'Piano timbre selector', { options: ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] }), functional: true },
  { ...button('piano.unison', 'piano', 'Piano unison', { options: ['Off', '1', '2', '3'] }), functional: true },
  { ...button('piano.softRelease', 'piano', 'Soft release', { legend: 'SOFT REL' }), functional: true },
  { ...button('piano.stringRes', 'piano', 'String resonance', { legend: 'STRING RES' }), functional: true },
  { ...button('piano.sustainPedal', 'piano', 'Piano sustain pedal routing', { legend: 'SUST PED' }), defaultValue: 1, functional: true },
  { ...button('piano.pitchStick', 'piano', 'Piano pitch stick routing', { legend: 'P STICK' }), functional: true },

  // ---------------------------------------------------------------- Program / morph
  { id: 'program.dial', section: 'program', kind: 'knob', label: 'Program dial', min: 0, max: 127, step: 1, defaultValue: 0, functional: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ ...button(`program.button.${n}`, 'program', `Program ${n}`), functional: true })),
  { ...button('program.pageLeft', 'program', 'Page left', { legend: '◀ PAGE' }), functional: true },
  { ...button('program.pageRight', 'program', 'Page right', { legend: 'PAGE ▶' }), functional: true },
  { ...button('program.liveMode', 'program', 'Live Mode'), functional: true },
  { ...button('program.layerScene', 'program', 'Layer Scene', { options: ['I', 'II'] }), functional: true },
  { ...button('program.store', 'program', 'Store program', { legend: 'STORE' }), functional: true },
  { ...button('program.split', 'program', 'Split', { legend: 'SPLIT' }), functional: true },
  // Split point Low/Mid/High: short press toggles the point; long-press /
  // Shift edits position + crossfade via the OLED row buttons.
  { ...button('program.splitLow', 'program', 'Split point Low', { legend: 'LOW' }), functional: true },
  { ...button('program.splitMid', 'program', 'Split point Mid', { legend: 'MID' }), functional: true },
  { ...button('program.splitHigh', 'program', 'Split point High', { legend: 'HIGH' }), functional: true },
  // KB Zone: assign the focused layer's zone range while held.
  { ...button('program.kbZone', 'program', 'KB Zone assign', { legend: 'KB ZONE' }), functional: true },
  { ...button('program.morphWheel', 'program', 'Morph assign: wheel', { legend: 'WHEEL' }), functional: true },
  button('program.morphAftertouch', 'program', 'Morph assign: aftertouch', { legend: 'A.TOUCH' }),
  { ...button('program.morphCtrlPedal', 'program', 'Morph assign: control pedal', { legend: 'CTRL PED' }), functional: true },
  button('program.panelASelect', 'program', 'Program panel A select'),
  button('program.panelBSelect', 'program', 'Program panel B select'),
  { ...button('program.kbHold', 'program', 'Keyboard hold (synth arp hold)', { legend: 'KB HOLD' }), functional: true },
  { ...button('program.panic', 'program', 'Panic (all notes off)', { legend: 'PANIC', momentary: true }), functional: true },
  { ...button('program.transpose', 'program', 'Transpose', { legend: 'TRANSPOSE' }), functional: true },
  { ...button('program.shift', 'program', 'Shift (secondary functions)', { legend: 'SHIFT' }), functional: true },
  { ...button('program.mstClock', 'program', 'Master clock (tap / hold + dial)', { legend: 'MST CLK' }), functional: true },

  // ---------------------------------------------------------------- Synth
  { ...button('synth.on', 'synth', 'Synth section on/off', { legend: 'ON' }), functional: true },
  { ...button('synth.layerA', 'synth', 'Synth layer A enable', { legend: 'A' }), defaultValue: 1, functional: true },
  { ...button('synth.layerB', 'synth', 'Synth layer B enable', { legend: 'B' }), functional: true },
  { ...button('synth.layerC', 'synth', 'Synth layer C enable', { legend: 'C' }), functional: true },
  { ...fader('synth.level', 'Synth level'), functional: true },
  { ...button('synth.octaveShift', 'synth', 'Synth octave shift', { legend: 'OCT', options: ['0', '+12', '-12'] }), functional: true },
  { ...button('synth.sustainPedal', 'synth', 'Synth sustain pedal routing', { legend: 'SUST PED' }), defaultValue: 1, functional: true },
  { ...button('synth.pitchStick', 'synth', 'Synth pitch stick routing', { legend: 'P STICK' }), functional: true },
  { ...knob('synth.oscShape', 'synth', 'Osc Ctrl (shape)', 'OSC CTRL'), defaultValue: 0, functional: true },
  {
    ...button('synth.oscWave', 'synth', 'Oscillator wave selector', {
      options: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise', 'Sync Saw', 'Sync Square', 'Multi Saw', 'Multi Saw 8ve', 'Super Saw', 'Super Square', 'FM 2-op A'],
    }),
    defaultValue: 2,
    functional: true,
  },
  { ...knob('synth.oscCoarse', 'synth', 'Oscillator coarse tune', 'COARSE'), functional: true },
  { ...knob('synth.oscFine', 'synth', 'Oscillator fine tune', 'FINE'), functional: true },
  knob('synth.oscMix', 'synth', 'Oscillator mix', 'MIX'),
  { ...button('synth.envToPitch', 'synth', 'Osc envelope to pitch', { legend: 'ENV>PITCH' }), functional: true },
  { ...knob('synth.filterCutoff', 'synth', 'Filter cutoff', 'FREQ'), functional: true },
  { ...knob('synth.filterResonance', 'synth', 'Filter resonance', 'RES'), defaultValue: 0, functional: true },
  { ...button('synth.filterType', 'synth', 'Filter type selector', { options: ['LP12', 'LP24', 'HP', 'BP'] }), functional: true },
  { ...knob('synth.filterEnvAmount', 'synth', 'Filter envelope amount', 'ENV AMT'), defaultValue: 0, functional: true },
  { ...button('synth.filterKbTrack', 'synth', 'Filter keyboard tracking', { legend: 'KB TRK', options: ['Off', '1/3', '2/3', '1'] }), functional: true },
  { ...button('synth.filterDrive', 'synth', 'Filter drive', { legend: 'DRIVE', options: ['Off', '1', '2', '3'] }), functional: true },
  { ...knob('synth.ampAttack', 'synth', 'Amp envelope attack', 'ATTACK'), defaultValue: 0, functional: true },
  { ...knob('synth.ampDecay', 'synth', 'Amp envelope decay (max = sustain)', 'DECAY'), defaultValue: 127, functional: true },
  { ...knob('synth.ampRelease', 'synth', 'Amp envelope release', 'RELEASE'), defaultValue: 24, functional: true },
  { ...knob('synth.modAttack', 'synth', 'Mod envelope attack', 'ATTACK'), defaultValue: 0, functional: true },
  { ...knob('synth.modDecay', 'synth', 'Mod envelope decay (max = sustain)', 'DECAY'), defaultValue: 60, functional: true },
  { ...knob('synth.modRelease', 'synth', 'Mod envelope release', 'RELEASE'), defaultValue: 30, functional: true },
  { ...knob('synth.lfoRate', 'synth', 'LFO rate', 'RATE'), functional: true },
  { ...knob('synth.lfoAmount', 'synth', 'LFO amount', 'AMOUNT'), defaultValue: 0, functional: true },
  { ...button('synth.lfoWave', 'synth', 'LFO wave selector', { options: ['Tri', 'SawDn', 'SawUp', 'Sqr', 'S&H'] }), functional: true },
  { ...button('synth.lfoDest', 'synth', 'LFO destination', { options: ['Off', 'Pitch', 'Osc Ctrl', 'Filter'] }), functional: true },
  { ...knob('synth.arpRate', 'synth', 'Arp/Gate rate', 'RATE'), defaultValue: 90, functional: true },
  { ...button('synth.arpOn', 'synth', 'Arp/Gate run', { legend: 'ARP RUN' }), functional: true },
  { ...button('synth.arpMode', 'synth', 'Arp/Gate mode', { options: ['Arp', 'Poly', 'Gate'] }), functional: true },
  { ...button('synth.arpPattern', 'synth', 'Arpeggiator direction', { options: ['Up', 'Down', 'UpDn', 'Rnd'] }), functional: true },
  { ...button('synth.arpRange', 'synth', 'Arp range (octaves) / gate hardness', { options: ['1', '2', '3', '4'] }), functional: true },
  { ...button('synth.unison', 'synth', 'Synth unison', { legend: 'UNISON', options: ['Off', '1', '2', '3'] }), functional: true },
  { ...button('synth.voiceMode', 'synth', 'Voice mode (poly/mono/legato)', { options: ['Poly', 'Mono', 'Legato'] }), functional: true },
  { ...button('synth.priority', 'synth', 'Note priority', { options: ['Off', 'Low', 'High'] }), functional: true },
  { ...knob('synth.glideRate', 'synth', 'Glide rate (0 = off)', 'GLIDE'), defaultValue: 0, functional: true },
  { ...button('synth.vibrato', 'synth', 'Synth vibrato', { options: ['Off', 'On', 'Wheel'] }), functional: true },
  { ...button('synth.arpHold', 'synth', 'Arp keyboard hold', { legend: 'KB HOLD' }), functional: true },

  // ---------------------------------------------------------------- Layer effects
  { ...button('fx.on', 'effects', 'Layer effects on/off (bypass all)', { legend: 'ON' }), defaultValue: 1, functional: true },
  { ...button('fx.focusA', 'effects', 'Effects layer focus A', { legend: 'A' }), functional: true },
  { ...button('fx.focusB', 'effects', 'Effects layer focus B', { legend: 'B' }), functional: true },
  { ...button('fx.groupPiano', 'effects', 'Piano effects group mode', { legend: 'GROUP' }), functional: true },
  { ...button('fx.effect1Type', 'effects', 'Effect 1 type selector', { options: ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] }), functional: true },
  { ...knob('fx.effect1Rate', 'effects', 'Effect 1 rate', 'RATE'), functional: true },
  { ...knob('fx.effect1Amount', 'effects', 'Effect 1 amount', 'AMOUNT'), functional: true },
  { ...button('fx.effect1On', 'effects', 'Effect 1 on/off', { legend: 'ON' }), functional: true },
  { ...button('fx.effect2Type', 'effects', 'Effect 2 type selector', { options: ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] }), functional: true },
  { ...knob('fx.effect2Rate', 'effects', 'Effect 2 rate', 'RATE'), functional: true },
  { ...knob('fx.effect2Amount', 'effects', 'Effect 2 amount', 'AMOUNT'), functional: true },
  { ...button('fx.effect2On', 'effects', 'Effect 2 on/off', { legend: 'ON' }), functional: true },
  { ...knob('fx.eqBassGain', 'effects', 'EQ bass gain', 'BASS'), functional: true },
  { ...knob('fx.eqMidGain', 'effects', 'EQ mid gain / mid freq', 'MID'), functional: true },
  { ...knob('fx.eqMidFreq', 'effects', 'EQ mid frequency / filter freq', 'MID FREQ'), functional: true },
  { ...knob('fx.eqTrebleGain', 'effects', 'EQ treble gain', 'TREBLE'), functional: true },
  { ...button('fx.ampType', 'effects', 'Amp simulator type selector', { options: ['EQ only', 'Twin', 'JC', 'Small', 'LP24', 'HP24', 'To Rotary'] }), functional: true },
  { ...knob('fx.ampDrive', 'effects', 'Amp drive', 'DRIVE'), functional: true },
  { ...button('fx.ampOn', 'effects', 'Amp simulator on/off', { legend: 'AMP' }), functional: true },
  { ...knob('fx.delayRate', 'effects', 'Delay rate / time', 'RATE'), functional: true },
  { ...knob('fx.delayFeedback', 'effects', 'Delay feedback', 'FDBK'), functional: true },
  { ...knob('fx.delayMix', 'effects', 'Delay mix', 'MIX'), functional: true },
  { ...button('fx.delayOn', 'effects', 'Delay on/off', { legend: 'ON' }), functional: true },
  { ...button('fx.delayTempo', 'effects', 'Delay tap tempo', { legend: 'TAP', momentary: true }), functional: true },
  { ...button('fx.delayPingPong', 'effects', 'Delay ping-pong mode', { legend: 'P.PONG' }), functional: true },
  { ...button('fx.delayFilter', 'effects', 'Delay feedback filter', { options: ['Off', 'LP', 'HP', 'BP'] }), functional: true },
  { ...button('fx.delayGlobal', 'effects', 'Delay global mode', { legend: 'GLOBAL' }), functional: true },
  { ...knob('fx.compAmount', 'effects', 'Compressor amount', 'AMOUNT'), functional: true },
  { ...button('fx.compOn', 'effects', 'Compressor on/off', { legend: 'COMP' }), functional: true },
  { ...button('fx.compFast', 'effects', 'Compressor fast mode', { legend: 'FAST' }), functional: true },
  { ...button('fx.compGlobal', 'effects', 'Compressor global mode', { legend: 'GLOBAL' }), functional: true },
  { ...knob('fx.reverbAmount', 'effects', 'Reverb amount', 'AMOUNT'), functional: true },
  { ...button('fx.reverbType', 'effects', 'Reverb type selector', { options: ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] }), functional: true },
  { ...button('fx.reverbOn', 'effects', 'Reverb on/off', { legend: 'ON' }), functional: true },
  { ...button('fx.reverbBright', 'effects', 'Reverb bright mode', { legend: 'BRIGHT' }), functional: true },
  { ...button('fx.reverbGlobal', 'effects', 'Reverb global mode', { legend: 'GLOBAL' }), functional: true },
  { ...button('fx.rotaryOn', 'effects', 'Rotary on/off', { legend: 'ROTARY' }), functional: true },
  { ...button('fx.rotarySpeed', 'effects', 'Rotary speed (slow/fast)', { options: ['SLOW', 'FAST'] }), functional: true },
  { ...knob('fx.rotaryDrive', 'effects', 'Effects rotary drive', 'DRIVE'), functional: true },
]

export const CONTROLS: readonly ControlDef[] = controls
export const CONTROL_BY_ID: ReadonlyMap<string, ControlDef> = new Map(controls.map((c) => [c.id, c]))

export function controlsForSection(sectionId: string): ControlDef[] {
  return controls.filter((c) => c.section === sectionId)
}

/** Sections that host a primary OLED display. Program and Synth only. */
export const OLED_SECTIONS = new Set(['program', 'synth'])
