import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Chain, clockDivision, defaultSoundState } from '../src/audio/dsp/params'
import { StageKernel } from '../src/audio/dsp/stage'
import { PROGRAM_STORAGE_KEY } from '../src/programs/bank'
import { createInitialState, deriveSound, extractProgram, programSignature } from '../src/state/model'
import { mountApp } from './support/app'
import { FakeMidiPort } from './support/fakes'
import { down, kernelOf, keys, led, oled, press, render, shiftPress, start, up } from './support/panel'
import { makeRig, noteHz, renderKernel, scramble, slice } from './support/rig'
import { SR, equal, magnitudeAt, mono, peak, rms } from './support/signal'

/**
 * Feature: system.integration
 * All engines share programs, scenes, zones, morphs, clock, effects, one AudioContext, one
 * master path, and Panic.
 */

/** Everything on: one layer of each engine, plain steady sounds. */
function allThree() {
  const rig = makeRig()
  rig.press('organ-on')
  rig.press('synth-on')
  rig.stage.setOrganLayer(0, (layer) => {
    layer.drawbars = [0, 0, 8, 0, 0, 0, 0, 0, 0]
    layer.vibOn = false
  })
  rig.stage.setSynthLayer(0, (layer) => {
    layer.wave = 0
    layer.filter.on = false
    layer.voice.unison = 0
    layer.oscEnv.amount = 0
    layer.octave = 1
  })
  return rig
}
/** Which engines are sounding: [piano, organ, synth]. */
const census = (rig: ReturnType<typeof makeRig>) => [rig.kernel.layerVoiceCount(0), rig.kernel.organLayer(0).keyCount, rig.kernel.synthLayer(0).voiceCount].map((count) => (count > 0 ? 1 : 0))

describe('system.integration: one AudioContext, one node, one master path', () => {
  it('playing organ, piano, and synth together still uses one context and one connection to its destination', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'organ-on')
    press(app, 'synth-on')
    press(app, 'rotary-source')
    for (const id of ['fx-reverb-on', 'fx-delay-on']) press(app, id)
    down(app, 48)
    down(app, 64)
    const kernel = kernelOf(app)
    expect([kernel.layerVoiceCount(0) > 0, kernel.organLayer(0).keyCount, kernel.synthLayer(0).voiceCount]).toEqual([true, 2, 2])
    expect(rms(render(app, 0.4).left)).toBeGreaterThan(0.01)
    press(app, 'program-3')
    press(app, 'live-mode')
    press(app, 'layer-scene')
    await app.settle()
    const { audio } = app.fake
    expect(audio.contexts).toHaveLength(1)
    expect(audio.workletNodes).toHaveLength(1)
    expect(audio.context.scriptNodes).toHaveLength(0)
    expect(audio.connections).toHaveLength(1)
    expect(audio.connections[0].to).toBe(audio.context.destination)
    expect(audio.context.addModuleCalls).toHaveLength(1)
  })

  it('the organ and synth engines are plain code inside the kernel: no Web Audio nodes, no second context', () => {
    const walk = (dir: string, out: string[] = []) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path, out)
        else if (/\.tsx?$/.test(entry)) out.push(path)
      }
      return out
    }
    const files = walk(join(process.cwd(), 'src'))
    expect(files.length).toBeGreaterThan(40)
    const creators = files.filter((file) => /new (?:webkit)?AudioContext|new Ctor\(|new OfflineAudioContext/.test(readFileSync(file, 'utf8')))
    expect(creators.map((file) => file.replace(process.cwd(), ''))).toEqual(['/src/platform/browser.ts'])
    for (const name of ['organ.ts', 'synth.ts', 'stage.ts']) {
      const source = readFileSync(join(process.cwd(), 'src', 'audio', 'dsp', name), 'utf8')
      expect(source, name).not.toMatch(/AudioContext|createOscillator|createGain|createBiquadFilter|AudioWorkletNode|window\.|document\./)
    }
    const engine = readFileSync(join(process.cwd(), 'src', 'audio', 'engine.ts'), 'utf8')
    expect(engine.match(/\.connect\(context\.destination\)/g)).toHaveLength(2)
  })

  it('every engine goes through the master gain: Master Level scales all three and silences all three', () => {
    const level = (master: number) => {
      const rig = allThree()
      rig.set('perf-master-level', master)
      rig.down(57)
      const out = slice(mono(rig.render(0.4)), 0.1, 0.4)
      rig.dispose()
      return [magnitudeAt(out, noteHz(57)), magnitudeAt(out, noteHz(69))]
    }
    const full = level(7)
    const half = level(3.5)
    // Organ (220 Hz) and synth (440 Hz) both drop by the same factor: the master law is a square.
    expect(half[0] / full[0]).toBeCloseTo(0.25, 1)
    expect(half[1] / full[1]).toBeCloseTo(0.25, 1)
    const rig = allThree()
    rig.set('perf-master-level', 0)
    rig.down(57)
    expect(peak(rig.render(0.3).left)).toBe(0)
    expect(census(rig)).toEqual([1, 1, 1])
    rig.dispose()
  })

  it('nothing gets past the limiter: every engine at once, everything turned up, stays inside full scale', () => {
    const kernel = new StageKernel({ sampleRate: SR })
    const sound = defaultSoundState()
    sound.master = 1
    for (const layer of sound.layers) {
      layer.on = true
      layer.level = 1
    }
    for (const layer of sound.organ.layers) {
      layer.on = true
      layer.level = 1
      layer.drawbars = [8, 8, 8, 8, 8, 8, 8, 8, 8]
    }
    for (const layer of sound.synth.layers) {
      layer.on = true
      layer.level = 1
      layer.osc.wave = 11
      layer.filter.on = false
    }
    kernel.setState(sound)
    for (let note = 36; note < 84; note += 3) kernel.noteOn(note, 1)
    const out = renderKernel(kernel, 0.6)
    expect(peak(out.left)).toBeLessThanOrEqual(1)
    expect(peak(out.right)).toBeLessThanOrEqual(1)
    expect(rms(out.left)).toBeGreaterThan(0.3)
  })
})

describe('system.integration: shared by every engine', () => {
  it('programs: one program holds all three engines and restores them together', () => {
    const rig = makeRig()
    scramble(rig, 5)
    const signature = programSignature(extractProgram(rig.state()))
    const sound = JSON.stringify(rig.sound())
    rig.press('store')
    rig.turn('program-dial', 22)
    rig.press('store')
    rig.stage.load({ live: false, slot: 0 })
    expect(rig.sound().organ.layers[0].on).toBe(false)
    rig.stage.load({ live: false, slot: 22 })
    expect(programSignature(extractProgram(rig.state()))).toBe(signature)
    expect(JSON.stringify(rig.sound())).toBe(sound)
    // Each engine really is part of it.
    const stored = rig.sound()
    expect(stored.organ.layers.some((layer) => layer.on) || stored.synth.layers.some((layer) => layer.on)).toBe(true)
    expect(JSON.stringify(stored.organ)).not.toBe(JSON.stringify(deriveSound(createInitialState()).organ))
    expect(JSON.stringify(stored.synth)).not.toBe(JSON.stringify(deriveSound(createInitialState()).synth))
    expect(JSON.stringify(stored.layers)).not.toBe(JSON.stringify(deriveSound(createInitialState()).layers))
    rig.dispose()
  })

  it('zones and transpose: one split and one transpose route and move all three engines', () => {
    const rig = allThree()
    rig.press('split')
    rig.shiftPress('organ-octave-up') // organ: below C4
    rig.shiftPress('synth-octave-down') // synth: C4 and above
    rig.down(50)
    expect(census(rig)).toEqual([1, 1, 0])
    rig.up(50)
    rig.kernel.allNotesOff()
    rig.render(0.3)
    rig.down(70)
    expect(census(rig)).toEqual([1, 0, 1])
    rig.up(70)
    rig.kernel.allNotesOff()
    rig.render(0.3)
    // Transpose +3: piano, organ, and synth all sound three semitones up.
    rig.press('split')
    rig.press('piano-on')
    rig.stage.setTranspose(3)
    rig.down(57)
    const out = slice(mono(rig.render(0.4)), 0.1, 0.4)
    expect(magnitudeAt(out, noteHz(60))).toBeGreaterThan(magnitudeAt(out, noteHz(57)) * 10)
    expect(magnitudeAt(out, noteHz(72))).toBeGreaterThan(magnitudeAt(out, noteHz(69)) * 10)
    expect(rig.sound().keyboard.transpose).toBe(3)
    rig.press('transpose')
    expect(rig.sound().keyboard.transpose).toBe(0)
    expect(rig.led('transpose')).toBe('off')
    rig.dispose()
  })

  it('scenes: one Layer Scene switch turns layers of all three engines on and off', () => {
    const rig = allThree()
    // Scene II still holds the program's stored switches (piano alone); make it the synth alone.
    rig.press('layer-scene')
    expect([rig.state().organ.on, rig.state().piano.on, rig.state().synth.on]).toEqual([false, true, false])
    rig.press('piano-on')
    rig.press('synth-on')
    rig.down(60)
    expect(census(rig)).toEqual([0, 0, 1])
    rig.up(60)
    rig.press('layer-scene')
    rig.down(60)
    expect(census(rig)).toEqual([1, 1, 1])
    rig.dispose()
  })

  it('morphs: one wheel movement moves an organ, a piano, a synth, and an effect parameter', () => {
    const rig = allThree()
    rig.press('morph-wheel')
    rig.set('organ-drawbar-9', 6)
    rig.set('piano-layer-a-level', 10)
    rig.set('synth-osc-ctrl', 10)
    rig.set('fx-reverb-mix', 0.5)
    rig.set('organ-layer-a-level', 30)
    rig.press('morph-wheel')
    expect(rig.state().morph.wheel).toHaveLength(5)
    rig.set('perf-mod-wheel', 127)
    const sound = rig.sound()
    expect(sound.organ.layers[0].drawbars[8]).toBe(6)
    expect(sound.organ.layers[0].level).toBeCloseTo(0.3)
    expect(sound.layers[0].level).toBeCloseTo(0.1)
    expect(sound.synth.layers[0].osc.ctrl).toBe(1)
    expect(sound.synth.layers[0].fx.reverb.mix).toBeCloseTo(0.05)
    rig.dispose()
  })

  it('clock: the Master Clock drives the arpeggiator, the Synth LFO, the Delay, and Mod 1 together', () => {
    const rig = allThree()
    rig.set('synth-arp-rate', 5)
    rig.set('synth-lfo-rate', 1.7)
    rig.set('fx-delay-tempo', 5)
    rig.set('fx-mod1-rate', 1.7)
    rig.shiftSet('synth-arp-rate', 6)
    rig.shiftSet('synth-lfo-rate', 3)
    rig.shiftSet('fx-delay-tempo', 6)
    rig.shiftSet('fx-mod1-rate', 3)
    expect([rig.led('synth-arp-mst-clk'), rig.led('synth-lfo-mst-clk'), rig.led('fx-delay-mst-clk'), rig.led('fx-mod1-mst-clk')]).toEqual(['on', 'on', 'on', 'on'])
    expect(rig.text('fx-delay-tempo')).toBe('1/8 at 120 BPM')
    const read = () => {
      const layer = rig.sound().synth.layers[0]
      return { arp: layer.arp.rate, lfo: layer.lfo.rate, delay: layer.fx.delay.time }
    }
    // 120 BPM: an eighth note is 0.25 s, a quarter 0.5 s.
    expect(clockDivision(1.7).label).toBe('1/4')
    expect(read().arp).toBeCloseTo(4, 9)
    expect(read().lfo).toBeCloseTo(2, 9)
    expect(read().delay).toBeCloseTo(0.25, 9)
    // One tempo change moves all of them, in step.
    rig.stage.setBpm(60)
    expect(read().arp).toBeCloseTo(2, 9)
    expect(read().lfo).toBeCloseTo(1, 9)
    expect(read().delay).toBeCloseTo(0.5, 9)
    // Tap the tempo: four taps half a second apart is 120 BPM again.
    for (let tap = 0; tap < 4; tap += 1) {
      rig.clock.now = 1000 + tap * 500
      rig.press('mst-clk')
    }
    expect(rig.state().clock.bpm).toBe(120)
    expect(rig.state().ui.mode).toBe('clock')
    expect(read().delay).toBeCloseTo(0.25, 9)
    // And the tempo page's dial: 20 detents up.
    rig.turn('program-dial', 20)
    expect(rig.state().clock.bpm).toBe(140)
    rig.exit()
    // The synced delay is heard at the clock's time on a piano layer too.
    rig.press('fx-focus-piano')
    rig.press('fx-delay-on')
    rig.set('fx-delay-tempo', 1.7)
    rig.shiftSet('fx-delay-tempo', 3)
    expect(rig.sound().layers[0].fx.delay.time).toBeCloseTo(60 / 140, 9)
    rig.dispose()
  })

  it('the Master Clock holds at most 300 and at least 30 BPM, and three taps are not enough', () => {
    const rig = makeRig()
    rig.stage.setBpm(1000)
    expect(rig.state().clock.bpm).toBe(300)
    rig.stage.setBpm(1)
    expect(rig.state().clock.bpm).toBe(30)
    for (let tap = 0; tap < 3; tap += 1) {
      rig.clock.now = 5000 + tap * 400
      rig.press('mst-clk')
    }
    expect(rig.state().clock.bpm).toBe(30)
    expect(rig.state().notice).toBe('Master Clock tap 3 of 4')
    rig.clock.now = 5000 + 3 * 400
    rig.press('mst-clk')
    expect(rig.state().clock.bpm).toBe(150)
    // Keyboard Sync is a setting of the clock page.
    rig.press('program-1')
    expect(rig.state().clock.kbSync).toBe(true)
    rig.shiftPress('mst-clk')
    expect(rig.state().notice).toBe('Pedal Tap is not available')
    rig.dispose()
  })

  it('holding Mst Clk or Transp opens its page for the dial, without tapping a tempo or switching off', () => {
    const rig = makeRig()
    rig.hardware.press('mst-clk')
    rig.clock.now += 700
    rig.hardware.release('mst-clk', true)
    expect(rig.state().ui.mode).toBe('clock')
    rig.turn('program-dial', -20)
    expect(rig.state().clock.bpm).toBe(100)
    expect(rig.sound().synth.layers[0].arp.rate).toBeGreaterThan(0)
    rig.exit()
    rig.hardware.press('transpose')
    rig.clock.now += 700
    rig.hardware.release('transpose', true)
    expect(rig.state().ui.mode).toBe('transpose')
    expect(rig.state().transpose.on).toBe(true)
    rig.turn('program-dial', -4)
    expect(rig.sound().keyboard.transpose).toBe(-4)
    rig.turn('program-dial', -9)
    expect(rig.sound().keyboard.transpose).toBe(-6)
    // Held again while on: it stays on (a short press is what switches it off).
    rig.hardware.press('transpose')
    rig.clock.now += 700
    rig.hardware.release('transpose', true)
    expect(rig.state().transpose.on).toBe(true)
    rig.press('transpose')
    expect(rig.sound().keyboard.transpose).toBe(0)
    rig.dispose()
  })

  it('effects: each engine has the same six units, and All Effects Off bypasses them on every engine', () => {
    const rig = allThree()
    for (const focus of ['fx-focus-organ', 'fx-focus-piano', 'fx-focus-synth']) {
      rig.press(focus)
      rig.press('fx-reverb-on')
      rig.press('fx-mod2-on')
    }
    const chains = [rig.sound().organ.fx, rig.sound().layers[0].fx, rig.sound().synth.layers[0].fx]
    for (const chain of chains) expect([chain.reverb.on, chain.mod2.on]).toEqual([true, true])
    const tail = () => {
      rig.kernel.allNotesOff()
      rig.render(1)
      rig.down(60)
      rig.render(0.3)
      rig.up(60)
      rig.render(0.5)
      return rms(rig.render(0.4).left)
    }
    const wet = tail()
    rig.press('fx-on')
    expect(rig.sound().fxOn).toBe(false)
    const dry = tail()
    expect(wet).toBeGreaterThan(0.0005)
    expect(dry).toBeLessThan(wet * 0.05)
    expect(rig.state().fx.focus).toBe(Chain.SynthA)
    rig.dispose()
  })
})

describe('system.integration: Panic', () => {
  it('Shift + Transpose stops every engine at once and resets the held inputs', async () => {
    const app = mountApp((fake) => fake.midi.plug(new FakeMidiPort('kb')))
    await start(app)
    fireEvent.click(app.getByRole('button', { name: 'Enable MIDI' }))
    await app.settle()
    press(app, 'organ-on')
    press(app, 'synth-on')
    press(app, 'synth-kb-hold')
    press(app, 'fx-reverb-on')
    shiftPress(app, 'organ-layer-a') // organ SUSTPED
    const kernel = kernelOf(app)
    // Keys held three ways, the pedal down, the stick pushed over.
    down(app, 48)
    app.fake.events.key('down', 'KeyA')
    app.fake.midi.ports.get('kb')!.send(0x90, 67, 100)
    app.fake.midi.ports.get('kb')!.send(0xb0, 64, 127)
    keys(app, 'perf-pitch-stick', 'End')
    await app.settle()
    expect(kernel.voiceCount).toBeGreaterThan(6)
    expect(app.container.querySelectorAll('.key.is-down').length).toBe(3)
    expect(rms(render(app, 0.3).left)).toBeGreaterThan(0.01)

    shiftPress(app, 'transpose')
    expect(oled(app, 'notice')).toBe('> PANIC: ALL NOTES OFF')
    expect(app.container.querySelectorAll('.key.is-down')).toHaveLength(0)
    expect(app.getByRole('button', { name: /Sustain pedal/ })).toHaveAttribute('aria-pressed', 'false')
    expect(kernel.organLayer(0).keyCount).toBe(0)
    expect(kernel.synthLayer(0).heldCount).toBe(0)
    // Transpose itself was not switched: Panic is the Shift function only.
    expect(led(app, 'transpose')).toBe('off')
    expect(kernel.getState().keyboard.transpose).toBe(0)
    render(app, 0.5)
    expect(kernel.voiceCount).toBe(0)
    expect(peak(render(app, 0.3).left)).toBe(0)
    // The reverb tail was dropped too, and the instrument plays normally afterwards.
    app.fake.events.key('up', 'KeyA')
    up(app, 48)
    down(app, 60)
    expect(rms(render(app, 0.2).left)).toBeGreaterThan(0.005)
    expect(app.fake.audio.contexts).toHaveLength(1)
  })

  it('in the kernel: all notes off reaches piano voices, organ keys, synth voices, latched notes, and the arpeggiator', () => {
    const rig = allThree()
    rig.press('synth-kb-hold')
    rig.press('synth-arp-run')
    for (const note of [48, 55, 62]) rig.down(note)
    rig.render(0.5)
    for (const note of [48, 55, 62]) rig.up(note)
    rig.render(0.3)
    expect(rig.kernel.synthLayer(0).heldCount).toBe(3)
    const steps = rig.kernel.synthLayer(0).arpSteps.length
    rig.shiftPress('transpose')
    expect(rig.panics).toBe(1)
    expect(rig.kernel.synthLayer(0).heldCount).toBe(0)
    rig.render(1)
    expect(rig.kernel.voiceCount).toBe(0)
    expect(rig.kernel.synthLayer(0).arpSteps.length).toBe(steps)
    for (let bus = 0; bus < rig.kernel.busCount; bus += 1) expect(rig.kernel.layerAsleep(bus), `bus ${bus}`).toBe(true)
    // KB Hold and Arp Run are still on: Panic drops notes, not settings.
    expect(rig.state().synth.hold).toBe(true)
    expect(rig.state().synth.layers[0].arp.run).toBe(true)
    rig.dispose()
  })
})

describe('system.integration: one serializable instrument', () => {
  it('the same panel actions give the same samples every time, across all engines', () => {
    const run = () => {
      const rig = makeRig()
      scramble(rig, 9)
      for (const note of [41, 52, 60, 67, 79]) rig.down(note)
      const first = rig.render(0.6)
      rig.set('perf-mod-wheel', 90)
      rig.stage.setPedal(0.4)
      const second = rig.render(0.4)
      rig.dispose()
      return { first, second }
    }
    const a = run()
    const b = run()
    expect(rms(a.first.left)).toBeGreaterThan(0.005)
    expect(equal(a.first.left, b.first.left)).toBe(true)
    expect(equal(a.first.right, b.first.right)).toBe(true)
    expect(equal(a.second.left, b.second.left)).toBe(true)
  })

  it('the whole sound state is plain data: it survives the message port unchanged', () => {
    const rig = makeRig()
    scramble(rig, 2)
    const sound = rig.sound()
    expect(JSON.parse(JSON.stringify(sound))).toEqual(sound)
    expect(structuredClone(sound)).toEqual(sound)
    expect(Object.keys(sound).sort()).toEqual(['fxOn', 'keyboard', 'layers', 'master', 'organ', 'rotary', 'synth'])
    rig.dispose()
  })

  it('in the app: a stored program that uses every engine is still there, and sounds, after a reload', async () => {
    const first = mountApp()
    await start(first)
    press(first, 'organ-on')
    press(first, 'synth-on')
    press(first, 'split')
    shiftPress(first, 'synth-octave-down')
    press(first, 'store')
    press(first, 'page-next')
    press(first, 'program-8')
    press(first, 'store')
    expect(oled(first, 'notice')).toBe('> STORED TO 2.8 GRAND PIANO')
    const saved = first.fake.storage.data.get(PROGRAM_STORAGE_KEY)!
    first.unmount()

    const second = mountApp((fake) => fake.storage.data.set(PROGRAM_STORAGE_KEY, saved))
    await start(second)
    press(second, 'page-next')
    press(second, 'program-8')
    const kernel = kernelOf(second)
    expect(kernel.getState().organ.layers[0].on).toBe(true)
    expect(kernel.getState().synth.layers[0].zone).toEqual([2, 3])
    expect(kernel.getState().keyboard.points[1].on).toBe(true)
    down(second, 50)
    expect([kernel.layerVoiceCount(0) > 0, kernel.organLayer(0).keyCount, kernel.synthLayer(0).voiceCount]).toEqual([true, 1, 0])
    down(second, 72)
    expect(kernel.synthLayer(0).voiceCount).toBe(1)
    expect(rms(render(second, 0.3).left)).toBeGreaterThan(0.005)
  })
})
