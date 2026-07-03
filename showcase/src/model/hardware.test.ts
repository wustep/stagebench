import { describe, expect, it } from 'vitest'
import { controlsForSection, FUNCTIONAL_CONTROL_IDS, getControl, HARDWARE_CONTROLS } from './hardware'
import { SECTIONS } from './variant'

describe('visual.control-inventory — normalized hardware model', () => {
  it('gives every control a unique stable id and accessible label', () => {
    const ids = new Set<string>()
    for (const control of HARDWARE_CONTROLS) {
      expect(control.id).toMatch(/^[a-z0-9-]+$/)
      expect(control.label.length).toBeGreaterThan(2)
      expect(ids.has(control.id)).toBe(false)
      ids.add(control.id)
    }
  })

  it('declares the truthful functional/decorative split', () => {
    // Functional: Piano section, Organ section, Layer Effects, Rotary,
    // Master Level, pitch stick, Panic, Shift, the Programs cluster, and now
    // the complete Synth section (sources, filters/envelopes/LFO, voice
    // modes, and the arpeggiator/gate — Part 3). Everything else stays
    // decorative until its engine exists — no control pretends to work.
    for (const control of HARDWARE_CONTROLS) {
      const functional = FUNCTIONAL_CONTROL_IDS.has(control.id)
      expect(control.decorative, control.id).toBe(!functional)
    }
    // Every Piano-, Organ- and Effects-section control is functional now,
    // including the Synth FX-focus group button (each synth layer now has
    // its own effect chain to focus). Only the Organ preset button stays
    // truthfully decorative (preset library is spec-excluded benchmark-wide).
    for (const control of HARDWARE_CONTROLS.filter(
      (c) => c.section === 'piano' || c.section === 'organ' || c.section === 'effects',
    )) {
      if (control.id === 'organ-preset') continue
      expect(control.decorative, control.id).toBe(false)
    }
    expect(getControl('fx-focus-synth').decorative).toBe(false)
    expect(getControl('organ-preset').decorative).toBe(true)
    // Synth scope: section on/off, three layers (level/enable/octave),
    // waveform selection (category button + dial 2), Osc Ctrl and the
    // Amp/Filter/Osc Envelope buttons (plus dials 1/2/3 while one is the
    // edit target), the filter (type/tracking/drive/on/freq/res/env amt,
    // now including the optional LP M/LP+HP types on the same cycle), the
    // oscillator envelope (amount + Env To Pitch), the LFO (waveform/rate/
    // mod amt/destination via dial 3/clock sync), voice modes (mode/
    // priority/glide/unison/vibrato, now including the optional Delayed/
    // Pedal vibrato modes on the same cycle), the arpeggiator/gate (run/
    // mode/direction/rate/range/hold via KB Hold), and the optional Sound
    // Init and Synth Mode (Analog<->Samples cycle) are all functional now.
    // Only Synth Mode's Extern position stays spec-excluded (unreachable
    // from the button, which cycles only the two real modes).
    const synthFunctional = new Set([
      'synth-on',
      'synth-level-a',
      'synth-level-b',
      'synth-level-c',
      'synth-layer-a',
      'synth-layer-b',
      'synth-layer-c',
      'synth-octave-down',
      'synth-octave-up',
      'waveform-select',
      'sound-init',
      'synth-mode',
      'synth-dial-1',
      'synth-dial-2',
      'synth-dial-3',
      'osc-ctrl',
      'amp-envelope',
      'filter-type',
      'filter-envelope',
      'filter-on',
      'filter-freq',
      'filter-res',
      'filter-env-amt',
      'osc-envelope',
      'osc-env-amt',
      'lfo-waveform',
      'lfo-rate',
      'lfo-mod-amt',
      'voice-mode',
      'glide',
      'synth-unison',
      'vibrato-mode',
      'arp-run',
      'arp-mode',
      'arp-rate',
      'arp-range',
      'kb-hold',
    ])
    for (const control of HARDWARE_CONTROLS.filter((c) => c.section === 'synth')) {
      expect(control.decorative, control.id).toBe(!synthFunctional.has(control.id))
    }
    expect(getControl('panic').decorative).toBe(false)
    expect(getControl('perf-master-level').decorative).toBe(false)
    // The Programs cluster (32 slots + 8 Live, store flows, navigation),
    // Layer Scenes and Split are functional; morphs, presets and the
    // spec-excluded menus remain decorative.
    for (const id of ['store', 'store-as', 'program-dial', 'page-left', 'page-right', 'live-mode', 'solo-undo', 'program-1', 'program-8', 'layer-scene', 'split-onset', 'mstclk-tap', 'transpose-onset', 'morph-wheel', 'morph-ctrlped', 'perf-mod-wheel']) {
      expect(getControl(id).decorative, id).toBe(false)
    }
    // morph-at stays decorative: aftertouch is spec-excluded (no browser aftertouch).
    for (const id of ['morph-at', 'preset-piano', 'prog-view', 'section-edit', 'layer-init', 'mon-copy']) {
      expect(getControl(id).decorative, id).toBe(true)
    }
  })

  it('orders the six sections with the measured width fractions', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(SECTIONS.map((s) => s.fraction)).toEqual([0.13, 0.21, 0.15, 0.09, 0.21, 0.21])
    expect(SECTIONS.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(1)
  })

  it('marks Program and Synth as the only primary OLED sections', () => {
    expect(SECTIONS.filter((s) => s.hasOled).map((s) => s.id)).toEqual(['program', 'synth'])
  })

  it('assigns every control to a valid section', () => {
    const valid = new Set(SECTIONS.map((s) => s.id))
    for (const control of HARDWARE_CONTROLS) expect(valid.has(control.section)).toBe(true)
  })

  it('has performance landmarks: master level, pitch stick, mod wheel, rotary strip', () => {
    const perf = controlsForSection('performance')
    expect(perf.find((c) => c.id === 'perf-master-level')?.type).toBe('knob')
    expect(perf.find((c) => c.id === 'perf-pitch-stick')?.type).toBe('stick')
    expect(perf.find((c) => c.id === 'perf-pitch-stick')?.springLoaded).toBe(true)
    expect(perf.find((c) => c.id === 'perf-mod-wheel')?.type).toBe('wheel')
    expect(perf.filter((c) => c.group === 'Rotary Speaker')).toHaveLength(5)
  })

  it('has exactly nine drawbars, all owned by the organ section', () => {
    const drawbars = HARDWARE_CONTROLS.filter((c) => c.type === 'drawbar')
    expect(drawbars).toHaveLength(9)
    for (const drawbar of drawbars) {
      expect(drawbar.section).toBe('organ')
      expect(drawbar.min).toBe(0)
      expect(drawbar.max).toBe(8)
    }
  })

  it('has organ landmarks: model select, vib/chorus, percussion, layer levels', () => {
    const organ = controlsForSection('organ')
    expect(organ.filter((c) => c.type === 'fader')).toHaveLength(2)
    expect(organ.some((c) => c.id === 'organ-model')).toBe(true)
    expect(organ.filter((c) => c.group === 'B3 Percussion')).toHaveLength(4)
    expect(organ.filter((c) => c.group === 'Vib/Chorus')).toHaveLength(2)
  })

  it('has compact piano selectors and no drawbars or displays in the piano section', () => {
    const piano = controlsForSection('piano')
    expect(piano.filter((c) => c.type === 'fader')).toHaveLength(2)
    expect(piano.some((c) => c.id === 'piano-type')).toBe(true)
    expect(piano.some((c) => c.id === 'piano-model' && c.type === 'encoder')).toBe(true)
    expect(piano.some((c) => c.id === 'piano-kb-touch')).toBe(true)
    expect(piano.some((c) => c.id === 'piano-timbre')).toBe(true)
    expect(piano.filter((c) => c.type === 'drawbar')).toHaveLength(0)
  })

  it('has program landmarks: large encoder, navigation, live mode, eight program buttons, morph controls', () => {
    const program = controlsForSection('program')
    expect(program.some((c) => c.id === 'program-dial' && c.type === 'encoder')).toBe(true)
    expect(program.some((c) => c.id === 'page-left')).toBe(true)
    expect(program.some((c) => c.id === 'page-right')).toBe(true)
    expect(program.some((c) => c.id === 'live-mode')).toBe(true)
    expect(program.filter((c) => c.group === 'Program')).toHaveLength(8)
    expect(program.filter((c) => c.group === 'Morph Assign')).toHaveLength(3)
    expect(program.some((c) => c.id === 'panic')).toBe(true)
  })

  it('has dense synth groups: mode, arp, voice, vibrato, LFO, oscillators, filter, amp, unison, three layers', () => {
    const synth = controlsForSection('synth')
    expect(synth.filter((c) => c.type === 'fader')).toHaveLength(3)
    for (const group of ['Mode', 'Arpeggiator/Gate', 'Voice', 'Vibrato', 'LFO', 'Oscillators', 'Filter', 'Amp', 'Unison']) {
      expect(synth.some((c) => c.group === group), `missing synth group ${group}`).toBe(true)
    }
    expect(synth.filter((c) => c.group === 'Filter')).toHaveLength(6)
  })

  it('has two effect groups per column plus amp/EQ, delay, comp, reverb landmarks', () => {
    const effects = controlsForSection('effects')
    for (const group of ['Mod 1', 'Mod 2', 'Amp Sim/EQ', 'Delay', 'Comp', 'Reverb']) {
      expect(effects.some((c) => c.group === group), `missing effects group ${group}`).toBe(true)
    }
    expect(effects.filter((c) => c.group === 'Amp Sim/EQ' && c.type === 'knob')).toHaveLength(5)
    expect(effects.filter((c) => c.group === 'Delay')).toHaveLength(8)
    expect(effects.some((c) => c.id === 'all-fx-off')).toBe(true)
  })

  it('keeps a reference-like control density (about 150 physical panel controls)', () => {
    expect(HARDWARE_CONTROLS.length).toBeGreaterThanOrEqual(120)
    expect(HARDWARE_CONTROLS.length).toBeLessThanOrEqual(200)
  })

  it('exposes lookup by id and rejects unknown ids', () => {
    expect(getControl('perf-master-level').label).toBe('Master Level')
    expect(() => getControl('nope')).toThrow(/Unknown hardware control/)
  })
})
