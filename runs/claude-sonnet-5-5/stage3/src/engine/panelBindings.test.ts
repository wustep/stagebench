import { describe, expect, it } from 'vitest'
import { delaySeconds } from '../audio/params'
import { CONTROLS } from '../hardware/layout'
import { createHardwareStore } from '../hardware/store'
import { FakeScheduler } from '../test-utils/fakes'
import { bindPanel, CONTROL_AUDIT, EXCLUDED_IDS, FUNCTIONAL_IDS, HOLD_MS, syncPanel } from './panelBindings'
import { createEngineStore, defaultState } from './state'

const rig = () => {
  const store = createHardwareStore(CONTROLS)
  const engine = createEngineStore(defaultState())
  const scheduler = new FakeScheduler()
  let clock = 0
  syncPanel(store, engine.get())
  const unbind = bindPanel({ store, engine, scheduler, now: () => clock })
  const tap = (id: string, mods = {}) => {
    store.press(id, mods)
    store.release(id)
  }
  const hold = (id: string, ms: number) => {
    store.press(id)
    scheduler.advance(ms)
    store.release(id)
  }
  const v = (id: string) => store.get(id).value
  return { store, engine, scheduler, unbind, tap, hold, v, advance: (ms: number) => (clock += ms), get s() { return engine.get() } }
}

describe('piano.layers — panel ↔ state (Piano section)', () => {
  it('starts in the canonical state: section on, layer A on and focused, B off, faders at their levels', () => {
    const r = rig()
    expect(r.v('piano-on')).toBe(1)
    expect(r.v('piano-layer-a-onoff')).toBe(1)
    expect(r.v('piano-layer-b-onoff')).toBe(0)
    expect(r.v('piano-level-a')).toBeCloseTo(0.95)
    expect(r.v('piano-select')).toBe(0)
    expect(r.v('effects-on')).toBe(1)
    expect(r.store.getIndicator('led-piano-fx-focus')).toBe(true)
    expect(r.store.getIndicator('led-fx-focus-piano-a')).toBe(true)
    expect(r.store.getIndicator('led-fx-focus-piano-b')).toBe(false)
  })

  it('tapping layer B switches to it, the panel shows B’s settings and the effects focus follows', () => {
    const r = rig()
    r.store.press('piano-select') // A: Grand → Upright
    r.store.release('piano-select')
    expect(r.s.layers.A.type).toBe('Upright')
    r.tap('piano-layer-b-onoff')
    expect(r.s.layers.B.enabled).toBe(true)
    expect(r.s.layers.A.enabled).toBe(false)
    expect(r.s.focus).toBe('B')
    expect(r.v('piano-layer-b-onoff')).toBe(1)
    expect(r.v('piano-layer-a-onoff')).toBe(0)
    expect(r.v('piano-select')).toBe(2) // B is Electric by default
    expect(r.store.getIndicator('led-fx-focus-piano-b')).toBe(true)
    expect(r.store.getIndicator('led-fx-focus-piano-a')).toBe(false)
  })

  it('pressing both buttons together adds the layer; the focused layer blinks while both are on', () => {
    const r = rig()
    r.store.press('piano-layer-a-onoff')
    r.store.press('piano-layer-b-onoff')
    r.store.release('piano-layer-b-onoff')
    r.store.release('piano-layer-a-onoff')
    expect(r.s.layers.A.enabled && r.s.layers.B.enabled).toBe(true)
    expect(r.s.focus).toBe('B')
    expect(r.store.get('piano-layer-b-onoff').focused).toBe(true)
    expect(r.store.get('piano-layer-a-onoff').focused).toBeUndefined()
    r.tap('piano-layer-a-onoff')
    expect(r.s.focus).toBe('A')
    expect(r.store.get('piano-layer-a-onoff').focused).toBe(true)
    expect(r.store.get('piano-layer-b-onoff').focused).toBeUndefined()
    expect(r.scheduler.pending).toBe(0)
  })

  it('Shift+press adds a layer without a second finger; holding turns a layer off; the last layer stays', () => {
    const r = rig()
    r.tap('piano-layer-b-onoff', { shift: true })
    expect(r.s.layers.B.enabled && r.s.layers.A.enabled).toBe(true)
    r.hold('piano-layer-b-onoff', HOLD_MS + 20)
    expect(r.s.layers.B.enabled).toBe(false)
    expect(r.s.focus).toBe('A')
    r.hold('piano-layer-a-onoff', HOLD_MS + 20)
    expect(r.s.layers.A.enabled).toBe(true) // last layer cannot be switched off
    expect(r.v('piano-layer-a-onoff')).toBe(1)
    // a hold is not also a tap
    r.tap('piano-layer-b-onoff', { shift: true })
    r.hold('piano-layer-a-onoff', HOLD_MS + 20)
    expect(r.s.layers.A.enabled).toBe(false)
    expect(r.s.focus).toBe('B')
    expect(r.scheduler.pending).toBe(0)
  })

  it('type, model, KB touch, dyn comp, unison, timbre, sustped and pstick edit the focused layer and light the panel', () => {
    const r = rig()
    r.tap('piano-select')
    r.tap('piano-select') // Electric
    expect(r.s.layers.A.type).toBe('Electric')
    r.store.set('piano-model-dial', 1)
    expect(r.s.layers.A.models.Electric).toBe(1)
    expect(r.store.get('piano-model-dial').note).toMatch(/Pianet T, model 2 of 2/)
    r.tap('piano-kb-touch')
    expect(r.s.layers.A.kbTouch).toBe('Light')
    r.tap('piano-kb-touch')
    r.tap('piano-kb-touch')
    expect(r.s.layers.A.kbTouch).toBe('Medium')
    r.tap('piano-dyn-comp')
    r.tap('piano-dyn-comp')
    expect(r.s.layers.A.dynComp).toBe(2)
    r.tap('piano-unison')
    r.tap('piano-unison')
    r.tap('piano-unison')
    expect(r.s.layers.A.unison).toBe(3)
    r.tap('piano-unison')
    expect(r.s.layers.A.unison).toBe(0)
    for (let i = 0; i < 5; i++) r.tap('piano-timbre')
    expect(r.s.layers.A.timbre).toBe('Dyno 2')
    expect(r.v('piano-timbre')).toBe(5)
    r.tap('piano-sustain-pedal')
    r.tap('piano-pitch-stick')
    expect(r.s.layers.A.sustPed).toBe(false)
    expect(r.s.layers.A.pitchStick).toBe(false)
    expect(r.v('piano-sustain-pedal')).toBe(0)
    // the other layer is untouched
    expect(r.s.layers.B.sustPed).toBe(true)
    expect(r.s.layers.B.kbTouch).toBe('Medium')
  })

  it('unavailable features snap back and say why: Dyno on an acoustic type, Soft Release for Clav, String Res for Electric', () => {
    const r = rig()
    for (let i = 0; i < 6; i++) r.tap('piano-timbre')
    expect(r.s.layers.A.timbre).toBe('Mid') // Off → Soft → Mid → Bright → wraps (no Dyno on Grand) → Off → Soft → Mid
    r.tap('piano-select')
    r.tap('piano-select')
    r.tap('piano-select') // Clav
    r.tap('piano-soft-release')
    expect(r.s.layers.A.softRelease).toBe(false)
    expect(r.v('piano-soft-release')).toBe(0)
    expect(r.store.get('piano-soft-release').note).toMatch(/Unavailable for Clav/)
    r.tap('piano-string-res')
    expect(r.v('piano-string-res')).toBe(0)
    expect(r.store.get('piano-string-res').note).toMatch(/Grand and Upright only/)
    r.tap('piano-select')
    r.tap('piano-select')
    r.tap('piano-select') // Grand
    expect(r.store.get('piano-string-res').note).toBeUndefined()
    r.tap('piano-string-res')
    expect(r.s.layers.A.stringRes).toBe(true)
    r.tap('piano-select') // Upright keeps it, Electric drops it
    expect(r.v('piano-string-res')).toBe(1)
    r.tap('piano-select')
    expect(r.s.layers.A.stringRes).toBe(false)
    expect(r.v('piano-string-res')).toBe(0)
  })

  it('ACOUSTICS steps soft release / string res; octave shift moves ±1 octave and is described for assistive tech', () => {
    const r = rig()
    r.tap('piano-acoustics')
    expect(r.s.layers.A.softRelease).toBe(true)
    expect(r.v('piano-soft-release')).toBe(1)
    r.tap('piano-acoustics')
    expect(r.s.layers.A.stringRes).toBe(true)
    r.tap('piano-octave-up')
    r.tap('piano-octave-up')
    expect(r.s.layers.A.octave).toBe(1)
    expect(r.store.get('piano-octave-up').note).toMatch(/^Layer A octave \+1/) // Phase 3 appends the KB zone range
    r.tap('piano-octave-down')
    r.tap('piano-octave-down')
    r.tap('piano-octave-down')
    expect(r.s.layers.A.octave).toBe(-1)
  })

  it('faders, the section button, Master Level and the pitch stick reach the state', () => {
    const r = rig()
    r.store.set('piano-level-b', 0.2)
    expect(r.s.layers.B.level).toBeCloseTo(0.2)
    r.store.set('master-level', 0.4)
    expect(r.s.master).toBeCloseTo(0.4)
    r.tap('piano-on')
    expect(r.s.pianoOn).toBe(false)
    r.store.set('pitch-stick', 1)
    expect(r.s.pitchBend).toBe(1)
    r.store.release('pitch-stick')
    expect(r.s.pitchBend).toBe(0)
  })
})

describe('effects.routing — panel ↔ state (Layer Effects section)', () => {
  it('every effect knob and selector edits the focused chain and is reflected back', () => {
    const r = rig()
    r.tap('fx-mod1-on')
    r.tap('fx-mod1-type')
    r.store.set('fx-mod1-rate', 0.8)
    r.store.set('fx-mod1-amount', 0.1)
    expect(r.s.fx.A.mod1).toMatchObject({ on: true, type: 'A-Wah', rate: 0.8, amount: 0.1 })
    r.tap('fx-mod2-on')
    r.tap('fx-mod2-type')
    expect(r.s.fx.A.mod2).toMatchObject({ on: true, type: 'Flanger' })
    r.tap('fx-amp-on')
    for (let i = 0; i < 4; i++) r.tap('fx-amp-model')
    expect(r.s.fx.A.amp.type).toBe('To Rotary')
    r.store.set('fx-amp-drive', 0.9)
    r.store.set('fx-eq-bass', 1)
    r.store.set('fx-eq-mid', 0)
    r.store.set('fx-eq-treble', 0.25)
    r.store.set('fx-amp-frequency', 0.1)
    expect(r.s.fx.A.amp).toMatchObject({ drive: 0.9, bass: 1, mid: 0, treble: 0.25, freq: 0.1 })
    r.tap('fx-delay-on')
    r.tap('fx-delay-filter')
    r.tap('fx-delay-ping-pong')
    r.store.set('fx-delay-tempo', 0.6)
    r.store.set('fx-delay-feedback', 0.2)
    r.store.set('fx-delay-dry-wet', 0.9)
    expect(r.s.fx.A.delay).toMatchObject({ on: true, filter: 'LP', pingPong: true, tempo: 0.6, feedback: 0.2, dryWet: 0.9 })
    r.tap('fx-comp-on')
    r.tap('fx-comp-fast')
    r.store.set('fx-comp-amount', 0.3)
    expect(r.s.fx.A.comp).toMatchObject({ on: true, fast: true, amount: 0.3 })
    r.tap('fx-reverb-on')
    r.tap('fx-reverb-type')
    r.tap('fx-reverb-bright')
    r.store.set('fx-reverb-dry-wet', 1)
    expect(r.s.fx.A.reverb).toMatchObject({ on: true, type: 'Cathedral', tone: 'bright', dryWet: 1 })
    r.tap('fx-reverb-dark')
    expect(r.s.fx.A.reverb.tone).toBe('dark')
    expect(r.v('fx-reverb-bright')).toBe(0) // Bright and Dark exclude each other
    expect(r.v('fx-reverb-dark')).toBe(1)
    // knobs on the panel show exactly what was set
    expect(r.v('fx-eq-bass')).toBe(1)
    expect(r.v('fx-comp-active')).toBe(1)
    // the rotary block, reached through To Rotary
    expect(r.store.getIndicator('led-rotary-on')).toBe(true)
    r.tap('rotary-speed')
    r.store.set('rotary-drive', 0.9)
    expect(r.s.rotary).toMatchObject({ fast: true, drive: 0.9 }) // Phase 3 adds the organ routing and stop-mode flags
    r.tap('effects-on')
    expect(r.s.effectsOn).toBe(false)
    expect(r.store.getIndicator('led-rotary-on')).toBe(false)
    expect(r.v('fx-comp-active')).toBe(0)
  })

  it('effect focus follows the layer focus; the panel then shows that layer’s chain', () => {
    const r = rig()
    r.tap('fx-reverb-on')
    r.tap('piano-layer-b-onoff', { shift: true })
    expect(r.s.fxFocus).toBe('B')
    expect(r.v('fx-reverb-on')).toBe(0) // B's chain is independent
    r.tap('fx-mod1-on')
    expect(r.s.fx.B.mod1.on).toBe(true)
    expect(r.s.fx.A.mod1.on).toBe(false)
    r.tap('piano-layer-a-onoff')
    expect(r.v('fx-reverb-on')).toBe(1)
    expect(r.v('fx-mod1-on')).toBe(0)
  })

  it('the Piano FX FOCUS button swaps A/B chains; Shift or a long press toggles group mode; LEDs show layer or group', () => {
    const r = rig()
    r.tap('effects-focus-piano')
    expect(r.s.fxFocus).toBe('B')
    expect(r.s.focus).toBe('A') // manual FX focus does not move the layer focus
    expect(r.store.getIndicator('led-fx-focus-piano-b')).toBe(true)
    expect(r.store.getIndicator('led-fx-focus-piano-a')).toBe(false)
    r.tap('effects-focus-piano', { shift: true })
    expect(r.s.group).toBe(true)
    expect(r.store.getIndicator('led-fx-focus-piano-a') && r.store.getIndicator('led-fx-focus-piano-b')).toBe(true)
    r.tap('effects-focus-piano') // no swapping in group mode
    expect(r.s.fxFocus).toBe('B')
    r.hold('effects-focus-piano', HOLD_MS + 10)
    expect(r.s.group).toBe(false)
    // the panel Shift button works too
    r.store.press('effects-shift')
    r.tap('effects-focus-piano')
    r.store.release('effects-shift')
    expect(r.s.group).toBe(true)
    r.tap('fx-reverb-on')
    expect(r.s.fx.A.reverb.on && r.s.fx.B.reverb.on).toBe(true)
  })

  it('Global on Delay, Compressor and Reverb (tag or Shift+ON) applies to every layer', () => {
    const r = rig()
    r.tap('fx-reverb-global')
    expect(r.s.globals.reverb).toBe(true)
    r.tap('fx-reverb-on')
    expect(r.s.fx.B.reverb.on).toBe(true)
    r.tap('fx-delay-on', { shift: true }) // Shift+ON: global instead of on
    expect(r.s.globals.delay).toBe(true)
    expect(r.s.fx.A.delay.on).toBe(false)
    expect(r.v('fx-delay-global')).toBe(1)
    r.tap('fx-comp-global')
    r.tap('fx-comp-on')
    expect(r.s.fx.B.comp.on).toBe(true)
    // units that cannot be global ignore Shift+ON's global meaning
    r.tap('fx-mod1-on', { shift: true })
    expect(r.s.fx.A.mod1.on).toBe(true)
    expect(r.s.fx.B.mod1.on).toBe(false)
  })

  it('tap tempo sets the delay time from the taps and moves the tempo knob (tap and knob agree)', () => {
    const r = rig()
    r.tap('fx-delay-tap')
    r.advance(400)
    r.tap('fx-delay-tap')
    r.advance(400)
    r.tap('fx-delay-tap')
    expect(delaySeconds(r.s.fx.A.delay.tempo)).toBeCloseTo(0.4, 1)
    expect(r.v('fx-delay-tempo')).toBeCloseTo(r.s.fx.A.delay.tempo, 2)
    r.advance(5000) // a long pause starts a new measurement
    r.tap('fx-delay-tap')
    expect(delaySeconds(r.s.fx.A.delay.tempo)).toBeCloseTo(0.4, 1)
  })

  it('Organ and Synth effect focus buttons focus their own chains (Phase 3): the Piano LEDs go dark and the Piano button brings the focus back', () => {
    // Phase 2 asserted that these buttons never lit because no such chains existed; the chains exist now
    const r = rig()
    r.tap('effects-focus-organ')
    expect(r.s.fxSection).toBe('organ')
    expect(r.v('effects-focus-organ')).toBe(1)
    expect(r.store.getIndicator('led-fx-focus-piano-a')).toBe(false)
    r.tap('effects-focus-synth')
    expect(r.s.fxSection).toBe('synth')
    expect(r.v('effects-focus-synth')).toBe(0) // synth layer A
    expect(r.v('effects-focus-organ')).toBe(0)
    r.tap('effects-focus-piano')
    expect(r.s.fxSection).toBe('piano')
    expect(r.s.fxFocus).toBe('A') // the first press only takes the focus, it does not swap A/B
    expect(r.store.getIndicator('led-fx-focus-piano-a')).toBe(true)
  })
})

describe('honesty — every control works or is a listed exclusion (Phase 3 replaces "decorative")', () => {
  it('no control is left decorative: each one is functional or spec-excluded, and functional ones do not claim to be decorative', () => {
    const r = rig()
    for (const c of CONTROLS) {
      const excluded = EXCLUDED_IDS.has(c.id)
      expect(FUNCTIONAL_IDS.has(c.id) !== excluded, `${c.id} must be exactly one of functional / excluded`).toBe(true)
      expect(r.store.get(c.id).note ?? '', c.id).not.toMatch(/Decorative/)
      if (excluded) expect(r.store.get(c.id).note, c.id).toMatch(/Unsupported/)
    }
    expect(Object.keys(CONTROL_AUDIT)).toHaveLength(CONTROLS.length)
  })

  it('excluded features move and light but change nothing, and are annotated as unsupported', () => {
    const r = rig()
    const before = JSON.stringify(r.s)
    for (const id of EXCLUDED_IDS) {
      const spec = CONTROLS.find((c) => c.id === id)!
      expect(r.store.get(id).note, id).toMatch(/Unsupported/)
      if (spec.kind === 'button') r.tap(id)
    }
    expect(JSON.stringify(r.s)).toBe(before)
    expect(r.v('piano-ped-noise')).toBe(1) // it lit up: presentation only
  })

  it('every functional control id exists on the panel', () => {
    const ids = new Set(CONTROLS.map((c) => c.id))
    for (const id of FUNCTIONAL_IDS) expect(ids.has(id), id).toBe(true)
    for (const id of EXCLUDED_IDS) expect(ids.has(id), id).toBe(true)
  })

  it('unbinding removes every listener and pending hold timer', () => {
    const r = rig()
    const listeners = r.store.listenerCount()
    r.store.press('piano-layer-b-onoff') // starts a hold timer
    expect(r.scheduler.pending).toBe(1)
    r.unbind()
    expect(r.scheduler.pending).toBe(0)
    expect(r.store.listenerCount()).toBeLessThan(listeners)
  })
})
