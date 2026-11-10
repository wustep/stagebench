import { defaultSoundState, type SoundState, type SynthLayerSound, type OrganLayerSound } from '../../src/audio/dsp/params'
import { StageKernel } from '../../src/audio/dsp/stage'
import { HardwareStore, type LedMode } from '../../src/hardware/store'
import { INVENTORY } from '../../src/hardware/inventory'
import type { StorageBoundary } from '../../src/platform/types'
import { PanelBinder } from '../../src/state/binding'
import { deriveSound, type StageState } from '../../src/state/model'
import { StageStore } from '../../src/state/store'
import { SR, magnitudeAt, type Stereo } from './signal'

/**
 * Phase 3 test rig: the real panel hardware store, the real binder, the real canonical store,
 * and the real DSP kernel, wired exactly as the session wires them — only without React and
 * without an AudioContext. Tests work the panel by control ID and render real audio.
 */
export interface Rig {
  hardware: HardwareStore
  stage: StageStore
  binder: PanelBinder
  kernel: StageKernel
  /** Milliseconds on the rig's clock (tap tempo reads it). */
  clock: { now: number }
  panics: number
  state(): StageState
  sound(): SoundState
  press(id: string): void
  /** Hold Shift, press `id`, let Shift go. */
  shiftPress(id: string): void
  /** Press Shift alone (Exit on an editing page). */
  exit(): void
  /** Move a knob, fader, or drawbar to a value. */
  set(id: string, value: number): void
  /** Turn a knob to a value with Shift held (clock sync, compressor Fast). */
  shiftSet(id: string, value: number): void
  /** Turn an endless dial by detents (positive is clockwise). */
  turn(id: string, detents: number): void
  shiftTurn(id: string, detents: number): void
  value(id: string): number
  step(id: string): number
  led(slug: string): LedMode
  meter(id: string): number | undefined
  text(id: string): string | undefined
  down(note: number, velocity?: number): void
  up(note: number): void
  render(seconds: number): Stereo
  dispose(): void
}

export function makeRig(storage: StorageBoundary | null = null): Rig {
  const hardware = new HardwareStore()
  const stage = new StageStore({ storage })
  const clock = { now: 0 }
  const kernel = new StageKernel({ sampleRate: SR })
  const rig = { panics: 0 }
  const binder = new PanelBinder(hardware, stage, () => clock.now, {
    panic: () => {
      rig.panics += 1
      kernel.allNotesOff()
    },
  })
  binder.attach()
  const push = () => kernel.setState(deriveSound(stage.getState()))
  push()
  const unsubscribe = stage.subscribe(push)
  const ledById = new Map(INVENTORY.leds.map((led) => [led.id, led]))

  const turn = (id: string, detents: number) => {
    // One detent at a time, as a hand turns it.
    for (let i = 0; i < Math.abs(detents); i += 1) hardware.nudge(id, Math.sign(detents))
  }
  return {
    hardware,
    stage,
    binder,
    kernel,
    clock,
    get panics() {
      return rig.panics
    },
    state: () => stage.getState(),
    sound: () => deriveSound(stage.getState()),
    press: (id) => hardware.activate(id),
    shiftPress(id) {
      hardware.press('shift')
      hardware.activate(id)
      hardware.release('shift', true)
    },
    exit: () => hardware.activate('shift'),
    set: (id, value) => hardware.setValue(id, value),
    shiftSet(id, value) {
      hardware.press('shift')
      hardware.setValue(id, value)
      hardware.release('shift', true)
    },
    turn,
    shiftTurn(id, detents) {
      hardware.press('shift')
      turn(id, detents)
      hardware.release('shift', true)
    },
    value: (id) => hardware.getValue(id),
    step: (id) => hardware.getValue(id),
    led(slug) {
      const led = ledById.get(`led-${slug}`)
      if (!led) throw new Error(`No LED led-${slug}`)
      return hardware.getLedMode(led)
    },
    meter: (id) => hardware.getMeter(id),
    text: (id) => hardware.getValueText(id),
    down: (note, velocity = 0.8) => kernel.noteOn(note, velocity),
    up: (note) => kernel.noteOff(note),
    render: (seconds) => renderKernel(kernel, seconds),
    dispose() {
      unsubscribe()
      binder.dispose()
    },
  }
}

export function renderKernel(kernel: StageKernel, seconds: number): Stereo {
  const frames = Math.round((seconds * kernel.sampleRate) / 128) * 128
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let offset = 0; offset < frames; offset += 128) {
    kernel.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128))
  }
  return { left, right }
}

/** A kernel with the Piano silenced and one Organ layer on, configured by `configure`. */
export function organKernel(configure?: (layer: OrganLayerSound, sound: SoundState) => void): StageKernel {
  const kernel = new StageKernel({ sampleRate: SR })
  const sound = defaultSoundState()
  sound.layers[0].on = false
  sound.organ.layers[0].on = true
  sound.organ.layers[0].vibOn = false
  configure?.(sound.organ.layers[0], sound)
  kernel.setState(sound)
  return kernel
}

/** A kernel with the Piano silenced and Synth layer A on with a plain, open, static sound. */
export function synthKernel(configure?: (layer: SynthLayerSound, sound: SoundState) => void): StageKernel {
  const kernel = new StageKernel({ sampleRate: SR })
  kernel.setState(synthSound(configure))
  return kernel
}

export function synthSound(configure?: (layer: SynthLayerSound, sound: SoundState) => void): SoundState {
  const sound = defaultSoundState()
  sound.layers[0].on = false
  const layer = sound.synth.layers[0]
  layer.on = true
  layer.voice.unison = 0
  layer.voice.glide = 0
  layer.filter.on = false
  layer.oscEnv.amount = 0
  layer.ampEnv = { attack: 0.002, decay: 1, release: 0.05, sustain: true, velocity: 0 }
  configure?.(layer, sound)
  return sound
}

/** Change a kernel's sound state in place. */
export function retune(kernel: StageKernel, configure: (sound: SoundState) => void): void {
  const copy = structuredClone(kernel.getState())
  configure(copy)
  kernel.setState(copy)
}

/** Levels of harmonics 1..count of `fundamental` in a buffer. */
export function harmonics(buffer: Float32Array, fundamental: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => magnitudeAt(buffer, fundamental * (index + 1)))
}

export function noteHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/** The part of a buffer between two times, in seconds. */
export function slice(buffer: Float32Array, from: number, to: number): Float32Array {
  return buffer.subarray(Math.round(from * SR), Math.round(to * SR))
}

/** Strongest frequency among `candidates`. */
export function loudestOf(buffer: Float32Array, candidates: readonly number[]): number {
  let best = candidates[0]
  let level = -1
  for (const frequency of candidates) {
    const magnitude = magnitudeAt(buffer, frequency)
    if (magnitude > level) {
      level = magnitude
      best = frequency
    }
  }
  return best
}

/** Zero crossings per second: a crude pitch reading that works for simple waves. */
export function crossingRate(buffer: Float32Array): number {
  let crossings = 0
  for (let i = 1; i < buffer.length; i += 1) if (buffer[i - 1] < 0 && buffer[i] >= 0) crossings += 1
  return (crossings * SR) / buffer.length
}

/**
 * Work the panel into a state that differs from the start-up state in every part a program
 * stores: all three sections and their layers, every effect unit, the rotary, the split and
 * zones, both Layer Scenes, both morph sources, the clock, and transpose. `seed` varies the
 * values so that no two seeds give the same program.
 */
export function scramble(rig: Rig, seed: number): void {
  const k = (base: number, span: number) => base + (seed % span)
  // Organ: on, both layers, a model, drawbars, percussion, vibrato, rotary routing.
  rig.press('organ-on')
  for (let presses = 0; presses < (seed % 5) + 1; presses += 1) rig.press('organ-model')
  for (let bar = 1; bar <= 9; bar += 1) rig.set(`organ-drawbar-${bar}`, (bar * 3 + seed) % 9)
  rig.press('organ-perc-on')
  if (seed % 2) rig.press('organ-perc-volume-soft')
  rig.press('organ-perc-decay-fast')
  rig.press('organ-vibrato-type')
  rig.press('organ-layer-b')
  rig.press('organ-model')
  rig.press('organ-vibrato-on')
  rig.set('organ-layer-b-level', k(20, 60))
  rig.press('organ-octave-up')
  rig.shiftPress('organ-layer-a')
  rig.press('rotary-source')
  rig.press('rotary-speed')
  rig.set('rotary-drive', k(2, 7))

  // Piano: second layer, type, model details.
  rig.press('piano-layer-b')
  for (let presses = 0; presses < (seed % 5) + 1; presses += 1) rig.press('piano-type')
  rig.press('piano-timbre')
  rig.press('piano-kb-touch')
  rig.press('piano-dyn-comp')
  rig.press('piano-unison')
  rig.press('piano-octave-down')
  rig.set('piano-layer-a-level', k(30, 50))
  rig.shiftPress('piano-layer-b')

  // Synth: three layers, each a different sound.
  rig.press('synth-on')
  rig.turn('synth-osc-dial-1', (seed % 11) + 1)
  rig.set('synth-osc-ctrl', k(1, 8))
  rig.set('synth-filter-freq', k(2, 7))
  rig.set('synth-filter-res', k(1, 6))
  rig.set('synth-filter-env-amt', k(1, 8))
  rig.set('synth-osc-env-amt', k(-8, 7))
  rig.set('synth-lfo-rate', k(1, 8))
  rig.set('synth-lfo-amount', k(1, 8))
  rig.set('synth-glide', k(1, 6))
  rig.set('synth-arp-rate', k(1, 8))
  rig.set('synth-arp-range', k(1, 8))
  rig.press('synth-lfo-dest')
  rig.press('synth-voice-mode')
  rig.shiftPress('synth-voice-mode')
  rig.press('synth-unison')
  rig.press('synth-vibrato-mode')
  rig.press('synth-arp-mode')
  rig.shiftPress('synth-arp-run')
  rig.shiftSet('synth-arp-rate', 10)
  rig.press('synth-amp-envelope')
  rig.turn('synth-osc-dial-1', (seed % 7) + 1)
  rig.turn('synth-osc-dial-3', (seed % 5) + 2)
  rig.shiftPress('synth-amp-envelope')
  rig.press('synth-filter-envelope')
  rig.turn('synth-osc-dial-2', -((seed % 6) + 1))
  rig.shiftPress('synth-filter-envelope')
  rig.press('synth-osc-pitch')
  rig.turn('synth-osc-dial-1', (seed % 9) - 4 || 3)
  rig.turn('synth-osc-dial-2', (seed % 13) + 1)
  rig.press('synth-kb-hold')
  rig.press('synth-layer-b')
  rig.turn('synth-osc-dial-2', 2)
  rig.set('synth-layer-b-level', k(30, 60))
  rig.press('synth-octave-up')
  rig.press('synth-layer-c')
  rig.press('synth-filter-on')
  rig.shiftPress('synth-layer-a')

  // Effects: every unit of the focused Synth C chain, then one unit on each other section.
  for (const id of ['fx-mod1-on', 'fx-mod2-on', 'fx-delay-on', 'fx-amp-on', 'fx-comp-on', 'fx-reverb-on']) rig.press(id)
  for (const id of ['fx-mod1-type', 'fx-mod2-type', 'fx-amp-type', 'fx-reverb-type', 'fx-delay-filter', 'fx-reverb-tone']) {
    for (let presses = 0; presses < (seed % 3) + 1; presses += 1) rig.press(id)
  }
  for (const [id, value] of [
    ['fx-mod1-rate', k(1, 8)],
    ['fx-mod1-amount', k(2, 7)],
    ['fx-mod2-rate', k(1, 8)],
    ['fx-mod2-amount', k(2, 7)],
    ['fx-drive', k(1, 8)],
    ['fx-eq-bass', k(-10, 20)],
    ['fx-eq-mid', k(-12, 20)],
    ['fx-eq-mid-freq', k(1, 8)],
    ['fx-eq-treble', k(-9, 18)],
    ['fx-delay-tempo', k(1, 8)],
    ['fx-delay-feedback', k(1, 8)],
    ['fx-delay-mix', k(1, 8)],
    ['fx-comp-amount', k(3, 6)],
    ['fx-reverb-mix', k(1, 8)],
  ] as const) rig.set(id, value)
  rig.shiftPress('fx-delay-filter')
  rig.shiftSet('fx-comp-amount', 10)
  rig.shiftSet('fx-mod1-rate', 10)
  rig.press('fx-focus-organ')
  rig.press('fx-reverb-on')
  rig.press('fx-focus-piano')
  rig.press('fx-mod2-on')
  rig.shiftPress('fx-focus-piano')

  // Split with zones, clock, transpose, morphs, and a different Layer Scene II.
  rig.press('split')
  rig.shiftPress('split')
  rig.press('program-2')
  rig.turn('program-dial', (seed % 3) + 1)
  rig.press('program-4')
  rig.turn('program-dial', 9 + (seed % 3))
  rig.press('program-1')
  rig.turn('program-dial', (seed % 2) + 1)
  rig.exit()
  rig.shiftPress('piano-octave-up')
  rig.shiftPress('synth-octave-down')
  rig.stage.setBpm(70 + seed * 3)
  rig.stage.setTranspose((seed % 12) - 6 || 2)
  rig.press('morph-wheel')
  rig.set('synth-filter-freq', 9.5)
  rig.set('organ-drawbar-2', (seed + 5) % 9 === rig.state().organ.layers[rig.state().organ.focus].drawbars[1] ? (seed + 6) % 9 : (seed + 5) % 9)
  rig.press('morph-wheel')
  rig.press('morph-control-pedal')
  rig.set('piano-layer-b-level', k(5, 30))
  rig.set('fx-reverb-mix', 9.5)
  rig.press('morph-control-pedal')
  rig.press('layer-scene')
  rig.press('organ-on')
  rig.press('piano-layer-a')
  rig.press('layer-scene')
}
