import { describe, expect, it } from 'vitest'
import { CONTROLS } from '../hardware/layout'
import { createHardwareStore } from '../hardware/store'
import { FakeScheduler, MemoryStorage } from '../test-utils/fakes'
import { bindPanel, CONTROL_AUDIT, EXCLUDED_IDS, EXCLUDED_REASONS, FUNCTIONAL_IDS, HOLD_MS, PARTIAL_NOTES, syncPanel } from './panelBindings'
import { createProgramSystem } from './programs'
import { createEngineStore, defaultState, focusedFx } from './state'
import { createUiModeStore } from './uiMode'
import { resolveMorph } from './morph'
import { FACTORY_PROGRAMS } from './factory'
import { SYNTH_WAVEFORMS } from './synth'

const rig = (storage: MemoryStorage | null = new MemoryStorage()) => {
  const store = createHardwareStore(CONTROLS)
  const engine = createEngineStore(defaultState())
  const scheduler = new FakeScheduler()
  const ui = createUiModeStore()
  let clock = 0
  const programs = createProgramSystem({ engine, storage, scheduler })
  const notes = new Set<(n: number) => void>()
  let panics = 0
  syncPanel(store, engine.get())
  const unbind = bindPanel({
    store,
    engine,
    scheduler,
    now: () => clock,
    programs,
    ui,
    panic: () => panics++,
    observeNotes: (fn) => {
      notes.add(fn)
      return () => notes.delete(fn)
    },
  })
  const tap = (id: string, mods = {}) => {
    store.press(id, mods)
    store.release(id)
  }
  const hold = (id: string, ms = HOLD_MS + 50) => {
    store.press(id)
    scheduler.advance(ms)
    store.release(id)
  }
  const turn = (id: string, by: number) => store.set(id, (store.get(id).value + by + 32) % 32)
  const shift = <T,>(fn: () => T): T => {
    store.press('program-shift')
    try {
      return fn()
    } finally {
      store.release('program-shift')
    }
  }
  return {
    store,
    engine,
    scheduler,
    programs,
    ui,
    tap,
    hold,
    turn,
    shift,
    unbind,
    v: (id: string) => store.get(id).value,
    advance: (ms: number) => (clock += ms),
    key: (n: number) => notes.forEach((f) => f(n)),
    get panics() {
      return panics
    },
    get s() {
      return engine.get()
    },
    get snap() {
      return programs.getSnapshot()
    },
  }
}

describe('programs.navigation — the Program section on the panel', () => {
  it('program buttons select slots on the current page; the LED follows; page buttons change the page', () => {
    const r = rig()
    expect(r.v('program-button-1')).toBe(1)
    r.tap('program-button-4')
    expect(r.snap.programIndex).toBe(3)
    expect(r.v('program-button-4')).toBe(1)
    expect(r.v('program-button-1')).toBe(0)
    r.tap('program-page-next')
    expect(r.snap.page).toBe(1)
    expect(r.v('program-button-4')).toBe(0) // the selected program is on page 1, we are looking at page 2
    r.tap('program-button-2')
    expect(r.snap.programIndex).toBe(9)
    expect(r.s.layers.A.type).toBe(r.programs.slot('program', 9).data.layers.A.type)
    r.tap('program-page-prev')
    r.tap('program-page-prev')
    expect(r.snap.page).toBe(3)
    expect(r.store.get('program-button-1').note).toMatch(/^Program 4\.1 /)
  })

  it('the Program dial browses programs; Shift + dial opens the numeric list', () => {
    const r = rig()
    r.turn('program-dial', 1)
    expect(r.snap.programIndex).toBe(1)
    r.turn('program-dial', -3)
    expect(r.snap.programIndex).toBe(30) // wraps below 1.1
    r.shift(() => r.turn('program-dial', 1))
    expect(r.snap.listView).toBe(true)
    expect(r.snap.programIndex).toBe(31)
    expect(r.programs.pendingTimerCount()).toBeGreaterThan(0)
  })

  it('an edited program shows E, the program LED blinks, and choosing another discards the edits', () => {
    const r = rig()
    r.store.set('fx-reverb-dry-wet', 0.9)
    expect(r.snap.dirty).toBe(true)
    expect(r.store.get('program-button-1').focused).toBe(true)
    r.tap('program-button-2')
    expect(r.snap.dirty).toBe(false)
    expect(r.store.get('program-button-2').focused).toBeUndefined()
    r.tap('program-button-1')
    expect(r.s.fx.A.reverb.dryWet).toBe(defaultState().fx.A.reverb.dryWet)
  })

  it('SOLO with Shift is Undo: it brings back the edits discarded by the last program change', () => {
    const r = rig()
    r.store.set('fx-reverb-dry-wet', 0.9)
    r.tap('program-button-3')
    expect(r.snap.undoAvailable).toBe(true)
    r.tap('program-solo', { shift: true })
    expect(r.snap.programIndex).toBe(0)
    expect(r.s.fx.A.reverb.dryWet).toBeCloseTo(0.9)
    expect(r.s.solo).toBeNull() // Shift+SOLO did not solo anything
  })

  it('LIVE MODE switches the buttons to the Live slots; edits are stored on the spot', () => {
    const r = rig()
    r.tap('program-live-mode')
    expect(r.v('program-live-mode')).toBe(1)
    expect(r.snap.mode).toBe('live')
    r.tap('program-button-6')
    expect(r.snap.slotLabel).toBe('L6')
    r.store.set('fx-reverb-dry-wet', 0.77)
    expect(r.snap.dirty).toBe(false)
    const reverb = () => focusedFx(r.s).reverb.dryWet // Live slots start as copies of the factory programs, each with its own effect focus
    r.tap('program-button-1')
    r.tap('program-button-6')
    expect(reverb()).toBeCloseTo(0.77)
    r.tap('program-live-mode')
    expect(r.snap.mode).toBe('program')
  })
})

describe('programs.store-live — Store, Store As and cancelling on the panel', () => {
  it('STORE flashes, program buttons choose the destination, STORE again writes; Shift cancels', () => {
    const r = rig()
    r.store.set('fx-reverb-dry-wet', 0.61)
    r.tap('program-store')
    expect(r.store.get('program-store').focused).toBe(true)
    expect(r.snap.store?.step).toBe('dest')
    r.tap('program-button-8')
    expect(r.snap.store?.dest.index).toBe(7)
    r.tap('program-shift') // Shift cancels
    expect(r.snap.store).toBeNull()
    expect(r.s.fx.A.reverb.dryWet).toBeCloseTo(0.61) // back to the edited sound
    r.tap('program-store')
    r.tap('program-button-8')
    r.tap('program-store')
    expect(r.snap.store).toBeNull()
    expect(r.snap.programIndex).toBe(7)
    expect(r.s.fx.A.reverb.dryWet).toBeCloseTo(0.61)
    expect(r.snap.dirty).toBe(false)
  })

  it('Shift + STORE is Store As: the dial types characters, the buttons insert and delete, PAGE moves the cursor', () => {
    const r = rig()
    r.tap('program-store', { shift: true })
    expect(r.snap.store).toMatchObject({ as: true, step: 'name' })
    const start = r.snap.store!.name
    expect(r.snap.store!.cursor).toBe(0)
    r.turn('program-dial', 1)
    expect(r.snap.store!.name[0]).not.toBe(start[0])
    r.tap('program-page-next')
    expect(r.snap.store!.cursor).toBe(1)
    r.tap('program-button-1') // insert
    expect(r.snap.store!.name.length).toBe(start.length + 1)
    r.tap('program-button-2') // delete
    expect(r.snap.store!.name.length).toBe(start.length)
    r.tap('program-store') // accept the name
    expect(r.snap.store!.step).toBe('dest')
    r.tap('program-live-mode') // destination bank: Live
    expect(r.snap.store!.dest.mode).toBe('live')
    r.tap('program-button-3')
    r.tap('program-store')
    expect(r.snap.mode).toBe('live')
    expect(r.snap.liveIndex).toBe(2)
  })

  it('Shift + a program button is a Shift-menu, which is not built: it says so and changes nothing', () => {
    const r = rig()
    r.tap('program-button-5', { shift: true })
    expect(r.snap.programIndex).toBe(0)
    expect(r.snap.message).toMatch(/not built/)
  })
})

describe('splits.zones — split editing from the panel', () => {
  it('a tap on SPLIT switches a Mid split at C4 on and off; the LED follows', () => {
    const r = rig()
    r.tap('program-split')
    expect(r.s.split.mid).toMatchObject({ active: true, position: 4 })
    expect(r.v('program-split')).toBe(1)
    r.tap('program-split')
    expect(r.s.split.mid.active).toBe(false)
    expect(r.v('program-split')).toBe(0)
  })

  it('holding SPLIT edits the points: buttons 1-3 pick Low/Mid/High, the dial and a key move them, 4 switches, 5 sets the crossfade', () => {
    const r = rig()
    r.hold('program-split')
    expect(r.ui.get().splitEdit).toBe('mid')
    expect(r.s.split.mid.active).toBe(true)
    expect(r.store.get('program-split').focused).toBe(true)
    r.turn('program-dial', 1)
    expect(r.s.split.mid.position).toBe(5) // F4
    r.key(53) // SET KEY: F3
    expect(r.s.split.mid.position).toBe(3)
    r.tap('program-button-1') // Low
    expect(r.ui.get().splitEdit).toBe('low')
    r.turn('program-dial', 1)
    expect(r.s.split.low.active).toBe(true) // moving an inactive point switches it on
    r.tap('program-button-5')
    expect(r.s.split.low.crossfade).toBe(6)
    r.tap('program-button-5')
    expect(r.s.split.low.crossfade).toBe(12)
    r.tap('program-button-4')
    expect(r.s.split.low.active).toBe(false)
    r.tap('program-button-3')
    r.key(96)
    expect(r.s.split.high).toMatchObject({ active: true, position: 10 })
    expect(r.store.get('program-button-3').note).toMatch(/High/)
    r.tap('program-split') // a tap leaves edit mode and keeps the split
    expect(r.ui.get().splitEdit).toBeNull()
    expect(r.s.split.mid.active).toBe(true)
    // outside edit mode a key press is just a note
    r.key(60)
    expect(r.s.split.mid.position).toBe(3)
  })

  it('KB ZONE: Shift + the octave buttons (or the octave buttons while editing a split) move the focused layer through the zone ranges', () => {
    const r = rig()
    r.tap('piano-octave-up', { shift: true })
    expect(r.s.zones['piano.A']).toEqual([1, 1])
    expect(r.s.layers.A.octave).toBe(0)
    expect(r.store.getIndicator('led-piano-zone-1')).toBe(false)
    expect(r.store.getIndicator('led-piano-zone-2')).toBe(true)
    r.tap('piano-octave-up')
    expect(r.s.layers.A.octave).toBe(1) // without Shift it is the octave shift
    r.tap('organ-layer-a-onoff')
    r.tap('organ-octave-down', { shift: true })
    expect(r.s.zones['organ.A']).toEqual([0, 2])
    expect(r.store.getIndicator('led-organ-zone-3')).toBe(true)
    expect(r.store.getIndicator('led-organ-zone-4')).toBe(false)
    r.hold('program-split')
    r.tap('synth-octave-up') // editing a split: the octave buttons are KB ZONE arrows
    expect(r.s.zones['synth.A']).toEqual([1, 1])
    expect(r.s.synth.A.octave).toBe(0)
  })
})

describe('scenes.switching — the LAYER SCENE II button', () => {
  it('toggles between the two enable configurations and lights for scene II', () => {
    const r = rig()
    r.tap('program-layer-scene')
    expect(r.s.scene).toBe(1)
    expect(r.v('program-layer-scene')).toBe(1)
    r.tap('piano-on') // scene II: the piano section off …
    r.tap('organ-layer-a-onoff') // … and the organ on instead
    expect(r.s.organ.layers.A.enabled).toBe(true)
    r.tap('program-layer-scene')
    expect(r.s.scene).toBe(0)
    expect(r.s.organ.layers.A.enabled).toBe(false)
    expect(r.s.pianoOn).toBe(true)
    r.tap('program-layer-scene')
    expect(r.s.organ.layers.A.enabled).toBe(true)
    expect(r.s.pianoOn).toBe(false)
    expect(r.s.layers.A.enabled).toBe(true) // its layer settings are untouched
  })
})

describe('morph.assignments — hold or double-tap a source, move controls, clear', () => {
  it('holding WHEEL enters assign mode; moving a fader records its end value and leaves the stored start alone', () => {
    const r = rig()
    r.store.press('program-morph-wheel')
    r.scheduler.advance(HOLD_MS + 20)
    expect(r.ui.get().morph).toEqual({ source: 'wheel', latched: false })
    expect(r.store.get('program-morph-wheel').focused).toBe(true)
    r.store.set('piano-level-a', 0.25)
    r.store.release('program-morph-wheel')
    expect(r.ui.get().morph).toBeNull()
    expect(r.s.morph.wheel).toEqual([{ dest: 'level.piano.A', to: 0.25 }])
    expect(r.s.layers.A.level).toBeCloseTo(0.95) // the stored start
    expect(r.v('piano-level-a')).toBeCloseTo(0.95) // the panel shows the start again
    expect(r.store.get('piano-level-a').morph).toEqual({ from: expect.closeTo(0.95), to: expect.closeTo(0.25) })
    expect(r.v('program-morph-wheel')).toBe(1) // steady: something is assigned
    // the wheel drives it
    r.store.set('mod-wheel', 1)
    expect(resolveMorph(r.s).layers.A.level).toBeCloseTo(0.25)
    r.store.set('mod-wheel', 0.5)
    expect(resolveMorph(r.s).layers.A.level).toBeCloseTo(0.6)
  })

  it('double-tap latches assign mode; several destinations, including drawbars, the rotary speed and effects, one going down while another goes up', () => {
    const r = rig()
    r.tap('program-morph-ctrlped')
    r.advance(200)
    r.tap('program-morph-ctrlped')
    expect(r.ui.get().morph).toEqual({ source: 'pedal', latched: true })
    r.store.set('organ-drawbar-4', 8)
    r.store.set('piano-level-a', 0.2)
    r.tap('rotary-speed') // slow → fast
    r.store.set('fx-delay-dry-wet', 0.9)
    r.store.set('synth-filter-frequency', 0.9)
    expect(r.s.morph.pedal.map((a) => a.dest).sort()).toEqual(['drawbar.organ.A.3', 'fx.delayDryWet.A', 'level.piano.A', 'rotary.speed', 'synth.filterFreq.A'].sort())
    expect(r.s.rotary.fast).toBe(false) // pressing the button in assign mode assigned the end speed, it did not switch the rotary
    expect(r.store.getIndicator('led-rotary-morph')).toBe(true)
    r.tap('program-morph-ctrlped') // a third press leaves the latched mode
    expect(r.ui.get().morph).toBeNull()
    expect(r.store.get('organ-drawbar-4').morph).toEqual({ from: 0, to: 8 })
    expect(r.store.get('fx-delay-dry-wet').morph).toBeDefined()
    expect(r.store.get('synth-filter-frequency').morph).toBeDefined() // the green LED is lit by the presence of a morph
    const resolved = resolveMorph({ ...r.s, pedalPos: 1 })
    expect(resolved.organ.layers.A.drawbars[3]).toBe(8)
    expect(resolved.layers.A.level).toBeCloseTo(0.2)
    expect(resolved.rotary.speed).toBe(1)
  })

  it('while a source is latched the panel shows the end values; re-holding and moving a control back to its start removes that one assignment', () => {
    const r = rig()
    r.tap('program-morph-wheel')
    r.advance(100)
    r.tap('program-morph-wheel')
    r.store.set('piano-level-a', 0.3)
    r.store.set('fx-reverb-dry-wet', 0.8)
    expect(r.v('piano-level-a')).toBeCloseTo(0.3) // end value shown in assign mode
    r.store.set('piano-level-a', 0.95) // back to the start
    expect(r.s.morph.wheel.map((a) => a.dest)).toEqual(['fx.reverbDryWet.A'])
    r.tap('program-morph-wheel')
    expect(r.v('piano-level-a')).toBeCloseTo(0.95)
  })

  it('Shift + a source button clears every assignment of that source only', () => {
    const r = rig()
    r.hold('program-morph-wheel', 1) // a short press is not assign mode
    expect(r.ui.get().morph).toBeNull()
    r.store.press('program-morph-wheel')
    r.scheduler.advance(HOLD_MS + 20)
    r.store.set('piano-level-a', 0.4)
    r.store.release('program-morph-wheel')
    r.store.press('program-morph-ctrlped')
    r.scheduler.advance(HOLD_MS + 20)
    r.store.set('piano-level-b', 0.9)
    r.store.release('program-morph-ctrlped')
    expect(r.s.morph.wheel).toHaveLength(1)
    expect(r.s.morph.pedal).toHaveLength(1)
    r.tap('program-morph-wheel', { shift: true })
    expect(r.s.morph.wheel).toHaveLength(0)
    expect(r.s.morph.pedal).toHaveLength(1)
    expect(r.store.get('piano-level-a').morph).toBeUndefined()
    expect(r.v('program-morph-wheel')).toBe(0)
    expect(r.v('program-morph-ctrlped')).toBe(1)
  })

  it('destinations follow the focus: the same knob assigns to the focused effect chain or synth layer', () => {
    const r = rig()
    r.tap('synth-layer-b-onoff')
    r.tap('program-morph-wheel')
    r.advance(100)
    r.tap('program-morph-wheel')
    r.store.set('synth-osc-control', 0.9)
    r.tap('effects-focus-organ')
    r.store.set('fx-mod1-amount', 0.05)
    expect(r.s.morph.wheel.map((a) => a.dest).sort()).toEqual(['fx.mod1Amount.organ', 'synth.oscCtrl.B'])
  })

  it('AT (aftertouch morph) is excluded: it lights and moves but assigns nothing', () => {
    const r = rig()
    r.tap('program-morph-at')
    expect(r.ui.get().morph).toBeNull()
    expect(r.store.get('program-morph-at').note).toMatch(/Unsupported/)
  })
})

describe('system.integration — master clock, transpose, Panic', () => {
  it('four taps on MST CLK set the tempo; holding it and turning the dial sets it by hand', () => {
    const r = rig()
    for (let i = 0; i < 4; i++) {
      r.tap('program-master-clock-tap')
      r.advance(500) // 120 BPM
    }
    expect(r.s.clock.bpm).toBe(120)
    r.advance(3000)
    for (let i = 0; i < 5; i++) {
      r.tap('program-master-clock-tap')
      r.advance(400) // 150 BPM
    }
    expect(r.s.clock.bpm).toBe(150)
    r.store.press('program-master-clock-tap')
    r.turn('program-dial', 5)
    r.store.release('program-master-clock-tap')
    expect(r.s.clock.bpm).toBe(155)
    expect(r.snap.programIndex).toBe(0) // the dial did not change the program
    // range 30-300
    r.store.press('program-master-clock-tap')
    for (let i = 0; i < 20; i++) r.turn('program-dial', -31)
    r.store.release('program-master-clock-tap')
    expect(r.s.clock.bpm).toBeGreaterThanOrEqual(30)
  })

  it('Transpose: ON/SET toggles it, holding it and turning the dial sets ±6 semitones; the LED follows', () => {
    const r = rig()
    r.store.press('program-transpose')
    r.turn('program-dial', 2)
    r.store.release('program-transpose')
    expect(r.s.transpose).toEqual({ on: true, semitones: 2 })
    expect(r.v('program-transpose')).toBe(1)
    r.store.press('program-transpose')
    r.turn('program-dial', 30) // 30 detents forward is -2 on a 32-detent ring
    r.turn('program-dial', 30)
    r.turn('program-dial', 30)
    r.turn('program-dial', 30)
    r.turn('program-dial', 30)
    r.store.release('program-transpose')
    expect(r.s.transpose.semitones).toBe(-6) // clamped at −6
    r.tap('program-transpose')
    expect(r.s.transpose.on).toBe(false)
    expect(r.snap.programIndex).toBe(0)
  })

  it('Shift + Transpose is Panic: notes stop, the pitch stick recentres, and the transpose is untouched', () => {
    const r = rig()
    r.store.set('pitch-stick', 1)
    expect(r.s.pitchBend).toBeCloseTo(1)
    r.tap('program-transpose', { shift: true })
    expect(r.panics).toBe(1)
    expect(r.s.pitchBend).toBe(0)
    expect(r.s.transpose.on).toBe(false)
    expect(r.v('program-transpose')).toBe(0)
  })

  it('Shift + turning a rate knob syncs it to the master clock (Mod 1, Delay, LFO, Arp); turning without Shift frees it', () => {
    const r = rig()
    const syncTurn = (id: string, value: number) => {
      r.store.press('program-shift')
      r.store.set(id, value)
      r.store.release('program-shift')
    }
    syncTurn('fx-delay-tempo', 1)
    expect(r.s.fx.A.delay).toMatchObject({ sync: true, division: 7 })
    expect(r.store.getIndicator('led-fx-delay-clk')).toBe(true)
    r.store.set('fx-delay-tempo', 0.2)
    expect(r.s.fx.A.delay).toMatchObject({ sync: false })
    expect(r.s.fx.A.delay.tempo).toBeCloseTo(0.2)
    syncTurn('fx-mod1-rate', 0)
    expect(r.s.fx.A.mod1).toMatchObject({ sync: true, division: 0 })
    syncTurn('synth-lfo-rate', 0.5)
    expect(r.s.synth.A.patch.lfo.sync).toBe(true)
    expect(r.store.getIndicator('led-synth-lfo-clk')).toBe(true)
    syncTurn('synth-arp-rate', 1)
    expect(r.s.synth.A.patch.arp).toMatchObject({ sync: true, division: 7 })
    expect(r.store.getIndicator('led-synth-arp-clk')).toBe(true)
    expect(r.store.get('synth-arp-rate').note).toMatch(/master clock/)
  })

  it('the delay tap tempo switches the delay back to a free time', () => {
    const r = rig()
    r.store.press('program-shift')
    r.store.set('fx-delay-tempo', 1)
    r.store.release('program-shift')
    r.tap('fx-delay-tap')
    r.advance(500)
    r.tap('fx-delay-tap')
    expect(r.s.fx.A.delay.sync).toBe(false)
  })

  it('SOLO isolates the section touched last; PROG VIEW switches the display view', () => {
    const r = rig()
    r.tap('organ-on')
    r.tap('program-solo')
    expect(r.s.solo).toBe('organ')
    r.tap('program-solo')
    expect(r.s.solo).toBeNull()
    r.tap('program-prog-view')
    expect(r.ui.get().progView).toBe('detail')
    r.tap('program-prog-view')
    expect(r.ui.get().progView).toBe('main')
  })

  it('the modulation wheel and the pitch stick are performance inputs: they are not program state and do not dirty the program', () => {
    const r = rig()
    r.store.set('mod-wheel', 0.7)
    r.store.set('master-level', 0.2)
    expect(r.s.modWheel).toBeCloseTo(0.7)
    expect(r.snap.dirty).toBe(false)
    r.tap('program-button-2')
    expect(r.s.modWheel).toBeCloseTo(0.7)
    expect(r.v('mod-wheel')).toBeCloseTo(0.7)
  })
})

describe('organ.models-drawbars — the Organ section on the panel', () => {
  it('layer buttons: tap replaces, Shift adds, hold removes; the section switches on with its first layer; faders and octave', () => {
    const r = rig()
    expect(r.v('organ-on')).toBe(0)
    r.tap('organ-layer-b-onoff')
    expect(r.s.organOn).toBe(true)
    expect(r.s.organFocus).toBe('B')
    expect(r.v('organ-on')).toBe(1)
    r.tap('organ-layer-a-onoff', { shift: true })
    expect(r.s.organ.layers.A.enabled && r.s.organ.layers.B.enabled).toBe(true)
    expect(r.store.get('organ-layer-a-onoff').focused).toBe(true)
    r.hold('organ-layer-a-onoff')
    expect(r.s.organ.layers.A.enabled).toBe(false)
    r.store.set('organ-level-a', 0.4)
    expect(r.s.organ.layers.A.level).toBeCloseTo(0.4)
    r.tap('organ-octave-up')
    expect(r.s.organ.layers.B.octave).toBe(1)
    expect(r.store.get('organ-octave-up').note).toMatch(/Organ layer B: octave \+1/)
  })

  it('model button cycles B3, Vox, Farf, Pipe 1, Pipe 2, B3 Bass and loads that model’s registration into the drawbars and their LED graphs', () => {
    const r = rig()
    r.tap('organ-layer-a-onoff')
    r.tap('organ-model')
    expect(r.s.organ.layers.A.model).toBe('Vox')
    expect(r.v('organ-drawbar-1')).toBe(6)
    expect(r.store.get('organ-drawbar-8').note).toMatch(/Vox: filtered mix/)
    r.tap('organ-model')
    expect(r.s.organ.layers.A.model).toBe('Farf')
    expect(r.store.get('organ-drawbar-2').graph).toBe(8) // register switch on: the LED graph is full
    expect(r.store.get('organ-drawbar-1').graph).toBe(0) // off: dark
    r.tap('organ-model')
    r.tap('organ-model')
    r.tap('organ-model')
    expect(r.s.organ.layers.A.model).toBe('B3 Bass')
    expect(r.store.get('organ-drawbar-4').note).toMatch(/does not use/)
    expect(r.store.get('organ-drawbar-4').graph).toBe(0)
    r.tap('organ-model')
    expect(r.s.organ.layers.A.model).toBe('B3')
    r.store.set('organ-drawbar-5', 5)
    expect(r.s.organ.layers.A.drawbars[4]).toBe(5)
    expect(r.store.get('organ-drawbar-5').graph).toBe(5)
  })

  it('percussion, vibrato/chorus and rotary controls edit their state', () => {
    const r = rig()
    r.tap('organ-layer-a-onoff')
    r.tap('organ-perc-on')
    r.tap('organ-perc-volume')
    r.tap('organ-perc-decay')
    r.tap('organ-perc-harmonic')
    r.tap('organ-perc-poly')
    expect(r.s.organ.perc).toEqual({ on: true, soft: true, fast: false, third: true, poly: true })
    r.tap('organ-vib-chorus-mode')
    r.tap('organ-vib-chorus-mode')
    expect(r.s.organ.vibMode).toBe('V2')
    r.tap('organ-vib-chorus-on')
    expect(r.s.organ.layers.A.vibOn).toBe(true)
    r.tap('rotary-organ')
    r.tap('rotary-stop-mode')
    expect(r.s.rotary).toMatchObject({ organ: true, stopMode: true })
    expect(r.store.getIndicator('led-rotary-on')).toBe(true)
    r.tap('rotary-speed')
    expect(r.s.rotary.fast).toBe(true)
  })
})

describe('synth.sources / synth.filter-envelopes / synth.voice-modes / synth.arp-gate — the Synth section on the panel', () => {
  it('waveform rocker steps through the 14 required waveforms and back; Osc Ctrl notes its category', () => {
    const r = rig()
    r.tap('synth-layer-a-onoff')
    const start = r.s.synth.A.patch.waveform
    for (let i = 0; i < SYNTH_WAVEFORMS.length; i++) r.tap('synth-waveform')
    expect(r.s.synth.A.patch.waveform).toBe(start)
    r.tap('synth-waveform', { shift: true })
    expect(r.s.synth.A.patch.waveform).toBe(start - 1)
    r.store.set('synth-osc-control', 0.5)
    expect(r.s.synth.A.patch.oscCtrl).toBeCloseTo(0.5)
    expect(r.store.get('synth-osc-control').note).toMatch(/Pure/)
    expect(r.store.get('synth-waveform').note).toMatch(/\(Pure\)/)
  })

  it('filter type, keyboard tracking and drive (menu dials), resonance, frequency, envelope amount, on/off', () => {
    const r = rig()
    r.tap('synth-layer-a-onoff')
    const types = [] as string[]
    for (let i = 0; i < 4; i++) {
      r.tap('synth-filter-type')
      types.push(r.s.synth.A.patch.filter.type)
    }
    expect(types).toEqual(['HP', 'BP', 'LP12', 'LP24'])
    r.turn('synth-list-dial-1', 1) // key tracking (filter page)
    r.turn('synth-list-dial-2', 1) // drive
    expect(r.s.synth.A.patch.filter).toMatchObject({ tracking: 3, drive: 1 })
    r.store.set('synth-filter-frequency', 0.1)
    r.store.set('synth-filter-resonance', 0.8)
    r.store.set('synth-filter-env-amount', 0.9)
    expect(r.s.synth.A.patch.filter).toMatchObject({ freq: 0.1, res: 0.8, envAmount: 0.9 })
    r.tap('synth-filter-on')
    expect(r.s.synth.A.patch.filter.on).toBe(false)
    r.tap('synth-filter-velocity')
    expect(r.s.synth.A.patch.filter.velocity).toBe(true)
  })

  it('the three dials under the Synth display edit attack, decay and release on the envelope pages', () => {
    const r = rig()
    r.tap('synth-layer-a-onoff')
    for (const [button, key] of [
      ['synth-osc-envelope', 'oscEnv'],
      ['synth-filter-envelope', 'filter'],
      ['synth-amp-envelope', 'amp'],
    ] as const) {
      r.tap(button)
      const patch = () => r.s.synth.A.patch[key] as unknown as { attack: number; decay: number; release: number }
      const before = { ...patch() }
      r.turn('synth-info-dial', 3)
      r.turn('synth-list-dial-1', -2)
      r.turn('synth-list-dial-2', 1)
      expect(patch().attack).toBeGreaterThan(before.attack)
      expect(patch().decay).toBeLessThan(before.decay)
      expect(patch().release).toBeGreaterThan(before.release)
    }
    expect(r.s.synth.A.patch.amp.velocity).toBe(3) // the AMP ENVELOPE button also steps the velocity level (2 → 3)
  })

  it('oscillator envelope: amount is bipolar, ENV TO PITCH retargets, velocity toggles; coarse and fine pitch from the display dials', () => {
    const r = rig()
    r.tap('synth-layer-a-onoff')
    r.store.set('synth-osc-env-amount', 1)
    expect(r.s.synth.A.patch.oscEnv.amount).toBe(1)
    r.store.set('synth-osc-env-amount', 0)
    expect(r.s.synth.A.patch.oscEnv.amount).toBe(-1)
    r.tap('synth-osc-env-to-pitch')
    r.tap('synth-osc-velocity')
    expect(r.s.synth.A.patch.oscEnv).toMatchObject({ toPitch: true, velocity: true })
    r.tap('synth-osc-pitch')
    r.turn('synth-list-dial-1', 7)
    r.turn('synth-list-dial-2', -3)
    expect(r.s.synth.A.patch).toMatchObject({ coarse: 7, fine: -3 })
  })

  it('LFO waveform, destination (with Off), rate, amount; vibrato source, menu and amount rocker; glide, priority, unison, voice mode', () => {
    const r = rig()
    r.tap('synth-layer-a-onoff')
    for (let i = 0; i < 5; i++) r.tap('synth-lfo-waveform')
    expect(r.s.synth.A.patch.lfo.waveform).toBe(0)
    expect(r.s.synth.A.patch.lfo.dest).toBe('off')
    r.tap('synth-lfo-destination') // Off → Osc pitch → Filter → Osc control → Off
    expect(r.s.synth.A.patch.lfo.dest).toBe('pitch')
    r.tap('synth-lfo-destination')
    expect(r.s.synth.A.patch.lfo.dest).toBe('filter')
    r.tap('synth-lfo-destination')
    r.tap('synth-lfo-destination')
    expect(r.s.synth.A.patch.lfo.dest).toBe('off')
    r.tap('synth-vibrato-source')
    expect(r.s.synth.A.patch.voice.vibrato.mode).toBe('wheel')
    r.tap('synth-vibrato-rocker')
    expect(r.s.synth.A.patch.voice.vibrato.amount).toBe(4)
    r.tap('synth-vibrato-rocker', { shift: true })
    r.tap('synth-vibrato-rocker', { shift: true })
    expect(r.s.synth.A.patch.voice.vibrato.amount).toBe(2)
    r.turn('synth-list-dial-1', 5) // the rocker opened the vibrato page: the dials edit mode, rate and amount
    expect(r.s.synth.A.patch.voice.vibrato.rate).toBeCloseTo(5.5)
    r.tap('synth-voice-mode')
    r.tap('synth-voice-lo')
    r.store.set('synth-glide', 0.4)
    r.tap('synth-unison')
    r.tap('synth-unison')
    expect(r.s.synth.A.patch.voice).toMatchObject({ mode: 'mono', priority: 'low', glide: 0.4, unison: 2 })
    r.tap('synth-voice-hi')
    expect(r.s.synth.A.patch.voice.priority).toBe('high')
    expect(r.v('synth-voice-lo')).toBe(0)
  })

  it('arpeggiator/gate: run, hold, mode, range, and the menu page for direction, master-clock sync and division', () => {
    const r = rig()
    r.tap('synth-layer-a-onoff')
    r.tap('synth-arp-run')
    r.tap('synth-kb-hold')
    r.tap('synth-kb-sync')
    r.tap('synth-arp-mode')
    r.tap('synth-arp-mode')
    r.store.set('synth-arp-range', 0.9)
    expect(r.s.synth.A.patch.arp).toMatchObject({ run: true, hold: true, mode: 'gate', range: 0.9 })
    expect(r.s.synth.A.patch.kbSync).toBe(true)
    r.tap('synth-arp-menu')
    r.turn('synth-info-dial', 2)
    r.turn('synth-list-dial-1', 1)
    r.turn('synth-list-dial-2', 2)
    expect(r.s.synth.A.patch.arp).toMatchObject({ direction: 'updown', sync: true, division: 6 })
    expect(r.store.getIndicator('led-synth-arp-clk')).toBe(true)
  })

  it('MODE stays on Analog (Samples is not built, Extern is excluded) and says so', () => {
    const r = rig()
    r.tap('synth-mode')
    expect(r.v('synth-mode')).toBe(1)
    expect(r.store.get('synth-mode').note).toBe(PARTIAL_NOTES['synth-mode'])
  })

  it('effects focus for the Organ and Synth chains; group mode for the synth; the FX knobs then edit that chain', () => {
    const r = rig()
    r.tap('synth-layer-c-onoff')
    expect(r.s.fxSection).toBe('synth')
    r.store.set('fx-reverb-dry-wet', 0.9)
    expect(r.s.synthFx.C.reverb.dryWet).toBeCloseTo(0.9)
    expect(r.s.fx.A.reverb.dryWet).toBeCloseTo(defaultState().fx.A.reverb.dryWet)
    r.tap('effects-focus-synth') // next chain
    expect(r.s.synthFxFocus).toBe('A')
    r.hold('effects-focus-synth')
    expect(r.s.synthGroup).toBe(true)
    expect(r.v('effects-focus-synth')).toBe(4)
    r.store.set('fx-mod2-amount', 0.66)
    expect(['A', 'B', 'C'].map((k) => r.s.synthFx[k as 'A'].mod2.amount)).toEqual([0.66, 0.66, 0.66])
    r.tap('effects-focus-organ')
    r.store.set('fx-mod2-amount', 0.11)
    expect(r.s.organFx.mod2.amount).toBeCloseTo(0.11)
    expect(r.s.synthFx.A.mod2.amount).toBeCloseTo(0.66)
    r.tap('effects-focus-organ', { shift: true }) // ALL FX OFF
    expect(r.s.effectsOn).toBe(false)
  })
})

describe('hardware.bindings — every control works or is a listed, spec-excluded exclusion', () => {
  it('the audit covers the whole panel exactly once', () => {
    const ids = CONTROLS.map((c) => c.id)
    expect(Object.keys(CONTROL_AUDIT).sort()).toEqual([...ids].sort())
    for (const id of ids) {
      const functional = FUNCTIONAL_IDS.has(id)
      const excluded = EXCLUDED_IDS.has(id)
      expect(functional !== excluded, id).toBe(true)
      expect(CONTROL_AUDIT[id]).toBe(excluded ? 'unsupported' : 'functional')
    }
    expect(EXCLUDED_IDS.size).toBe(Object.keys(EXCLUDED_REASONS).length)
  })

  it('every functional control changes canonical state or a panel mode when operated (no silent no-ops)', () => {
    const silent: string[] = []
    for (const c of CONTROLS) {
      if (!FUNCTIONAL_IDS.has(c.id)) continue
      // pure indicators and modifiers
      // (the sole active piano layer cannot be switched off or swapped: tapping it only takes the focus, which it already has)
      if (['fx-comp-active', 'program-shift', 'effects-shift', 'synth-mode', 'piano-layer-a-onoff'].includes(c.id)) continue
      // a fresh panel per control, with something to act on in every section
      const r = rig()
      r.tap('organ-layer-a-onoff')
      r.tap('synth-layer-a-onoff')
      r.tap('piano-layer-a-onoff')
      if (c.id === 'piano-model-dial') {
        r.tap('piano-select')
        r.tap('piano-select') // Electric has two models; Grand has one, so its dial has nothing to select
      }
      if (c.id === 'synth-osc-pitch') r.tap('synth-filter-type') // a page selector: start from another page
      const snapshot = () => JSON.stringify([r.engine.get(), r.ui.get(), r.snap.programIndex, r.snap.mode, r.snap.dirty, r.snap.page, r.snap.store, r.snap.message, r.snap.listView])
      const before = snapshot()
      if (c.kind === 'button') {
        r.tap(c.id)
        if (snapshot() === before) r.tap(c.id, { shift: true })
      } else if (c.kind === 'encoder') {
        r.turn(c.id, 3)
      } else if (c.kind === 'drawbar') {
        r.store.set(c.id, r.v(c.id) > 4 ? 1 : 7)
      } else {
        r.store.set(c.id, r.v(c.id) > 0.5 ? 0.13 : 0.87)
      }
      if (snapshot() === before) silent.push(c.id)
      r.unbind()
      r.programs.dispose()
    }
    expect(silent).toEqual([])
  })

  it('unbinding removes every listener, timer and observer', () => {
    const r = rig()
    const before = r.store.listenerCount()
    r.store.press('program-split') // starts a hold
    r.store.press('organ-layer-a-onoff')
    r.unbind()
    r.programs.dispose()
    expect(r.scheduler.pending).toBe(0)
    expect(r.store.listenerCount()).toBeLessThan(before)
    expect(r.ui.listenerCount()).toBe(0)
    expect(FACTORY_PROGRAMS().length).toBeGreaterThanOrEqual(8)
  })
})
