import { fireEvent, screen } from '@testing-library/react'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from './boundaries'
import type { PianoEngine } from './engine'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES, SIGNAL_ORDER } from './labels'
import { renderApp } from '../test/renderApp'
import { meanAbsDiff, renderPiano, rms } from '../test/renderAudio'

async function played(setup: (engine: PianoEngine) => void, seconds = 1.1, channels = 2) {
  return renderPiano((engine) => {
    engine.setMasterLevel(45)
    engine.setEffectsOn(true)
    setup(engine)
    engine.noteOn(60, 0.9, 0)
    engine.noteOff(60, 0.18)
  }, seconds, undefined, channels)
}

describe('effects.graph', () => {
  it('uses one context, one destination feed, and returns to a quiet graph after cleanup', async () => {
    const rendered = await renderPiano((engine) => {
      engine.noteOn(60, 0.8)
      engine.noteOn(64, 0.8)
      expect(engine.contextCount()).toBe(1)
      expect(engine.destinationFeedCount()).toBe(1)
      expect(engine.getSignalOrder()).toEqual([...SIGNAL_ORDER])
    }, 0.3)
    expect(rms(rendered.channel, 200, 4000)).toBeGreaterThan(0.002)
    rendered.engine.allNotesOff()
    rendered.timers.advance(1000)
    expect(rendered.engine.activeVoiceCount()).toBe(0)
    rendered.engine.dispose()
    expect(rendered.engine.activeVoiceCount()).toBe(0)
  })
})

describe('effects.routing', () => {
  it('follows layer focus, manual focus, group, and global routing', async () => {
    const routed = await renderPiano((engine) => {
      engine.pressLayer('B')
      engine.setEffectsOn(true)
      engine.writeFx({ delay: { on: true, mix: 120, tempo: 30, feedback: 100 } })
      expect(engine.readFx('B').delay.on).toBe(true)
      expect(engine.readFx('A').delay.on).toBe(false)
      engine.setManualFocus('organ')
      engine.writeFx({ delay: { on: true, mix: 127, tempo: 10, feedback: 110 } })
      expect(engine.readFx('organ').delay.on).toBe(true)
      expect(engine.readFx('A').delay.on).toBe(false)
      expect(engine.editTarget()).toBe('organ')
    }, 0.2)

    const grouped = await played((engine) => {
      engine.setLayerEnabled('B', true)
      engine.togglePianoGroup()
      engine.writeFx({ delay: { on: true, mix: 127, tempo: 12, feedback: 110 } })
      expect(engine.isPianoGroup()).toBe(true)
      expect(engine.readFx('B').delay.on).toBe(true)
      engine.setLayerEnabled('A', false)
    }, 1.3)
    const dryB = await played((engine) => {
      engine.setLayerEnabled('B', true)
      engine.setLayerEnabled('A', false)
      engine.focusLayer('B')
    }, 1.3)
    expect(rms(grouped.channel, 30000, 50000)).toBeGreaterThan(rms(dryB.channel, 30000, 50000) * 1.4)

    const globalDelay = await played((engine) => {
      engine.setLayerEnabled('B', true)
      engine.toggleGlobal('delay')
      engine.writeFx({ delay: { on: true, mix: 127, tempo: 8, feedback: 100 } })
      expect(engine.readFx('A').delay.global).toBe(true)
      expect(engine.readFx('B').delay.on).toBe(true)
      engine.setLayerEnabled('A', false)
      engine.focusLayer('B')
    }, 1.3)
    expect(rms(globalDelay.channel, 28000, 48000)).toBeGreaterThan(rms(dryB.channel, 28000, 48000) * 1.3)
    expect(routed.engine.getManualFocus()).toBe('organ')
  })

  it('bypasses a unit, bypasses every effect, and keeps delay feedback in the loop', async () => {
    const dry = await played(() => undefined, 1.2)
    const wet = await played((engine) => {
      engine.writeFx({ delay: { on: true, mix: 127, tempo: 20, feedback: 40, filter: 0 } })
    }, 1.2)
    const bypassed = await played((engine) => {
      engine.writeFx({ delay: { on: false, mix: 127, tempo: 20, feedback: 40 } })
    }, 1.2)
    const allOff = await played((engine) => {
      engine.writeFx({ delay: { on: true, mix: 127, tempo: 20, feedback: 90 } })
      engine.setEffectsOn(false)
    }, 1.2)
    expect(meanAbsDiff(dry.channel, wet.channel)).toBeGreaterThan(0.01)
    expect(meanAbsDiff(dry.channel, bypassed.channel)).toBeLessThan(0.004)
    expect(meanAbsDiff(dry.channel, allOff.channel)).toBeLessThan(0.004)

    const lowFeedback = await played((engine) => {
      engine.writeFx({ delay: { on: true, mix: 90, tempo: 100, feedback: 0, filter: 1 } })
    }, 1.2)
    const highFeedback = await played((engine) => {
      engine.writeFx({ delay: { on: true, mix: 90, tempo: 100, feedback: 120, filter: 1 } })
    }, 1.2)
    expect(meanAbsDiff(lowFeedback.channel, highFeedback.channel)).toBeGreaterThan(0.004)
    expect(rms(highFeedback.channel, 18000, 42000)).toBeGreaterThan(rms(lowFeedback.channel, 18000, 42000))

    const direct = await played((engine) => {
      engine.writeFx({ ampOn: true, ampType: 0, ampDrive: 80 })
    }, 0.6)
    const rotary = await played((engine) => {
      engine.writeFx({ ampOn: true, ampType: AMP_TYPES.indexOf('Rotary'), ampDrive: 90 })
      engine.setRotary(true, false, 100)
    }, 0.6)
    expect(meanAbsDiff(direct.channel, rotary.channel)).toBeGreaterThan(0.008)
  })
})

describe('effects.processing', () => {
  it('renders every Mod 1, Mod 2, amp, delay filter, and reverb type differently from dry and from its neighbor', async () => {
    const dry = await played(() => undefined, 0.7)
    const mod1: Float32Array[] = []
    for (const [index, type] of MOD1_TYPES.entries()) {
      const rendered = await played((engine) => {
        engine.writeFx({ mod1On: true, mod1Type: index, mod1Rate: 100, mod1Amount: 127 })
      }, 0.7)
      expect(meanAbsDiff(dry.channel, rendered.channel), type).toBeGreaterThan(0.004)
      mod1.push(rendered.channel)
    }
    for (let index = 1; index < mod1.length; index++) {
      expect(meanAbsDiff(mod1[index - 1]!, mod1[index]!), MOD1_TYPES[index]).toBeGreaterThan(0.003)
    }

    const mod2: Float32Array[] = []
    for (const [index, type] of MOD2_TYPES.entries()) {
      const rendered = await played((engine) => {
        engine.writeFx({ mod2On: true, mod2Type: index, mod2Rate: 90, mod2Amount: 127 })
      }, 0.7)
      expect(meanAbsDiff(dry.channel, rendered.channel), type).toBeGreaterThan(0.004)
      mod2.push(rendered.channel)
    }
    for (let index = 1; index < mod2.length; index++) {
      expect(meanAbsDiff(mod2[index - 1]!, mod2[index]!), MOD2_TYPES[index]).toBeGreaterThan(0.002)
    }

    const amps: Float32Array[] = []
    for (const [index, type] of AMP_TYPES.entries()) {
      if (type === 'Rotary') continue
      const rendered = await played((engine) => {
        engine.writeFx({
          ampOn: true,
          ampType: index,
          ampDrive: 110,
          ampBass: type === 'Small' ? 110 : 20,
          ampMid: type === 'Twin' ? 10 : 100,
          ampFreq: type === 'HP24' ? 110 : 15,
          ampTreble: type === 'JC' ? 120 : 20,
        })
      }, 0.45)
      expect(meanAbsDiff(dry.channel.subarray(0, rendered.channel.length), rendered.channel), type).toBeGreaterThan(0.004)
      amps.push(rendered.channel)
    }
    for (let index = 1; index < amps.length; index++) {
      expect(meanAbsDiff(amps[index - 1]!, amps[index]!), AMP_TYPES[index]).toBeGreaterThan(0.003)
    }

    const filters = []
    for (const filter of [0, 1, 2, 3]) {
      const rendered = await played((engine) => {
        engine.writeFx({ delay: { on: true, mix: 110, tempo: 112, feedback: 100, filter } })
      }, 1.1)
      filters.push(rendered.channel)
    }
    expect(meanAbsDiff(filters[0]!, filters[1]!)).toBeGreaterThan(0.002)
    expect(meanAbsDiff(filters[1]!, filters[2]!)).toBeGreaterThan(0.002)
    expect(meanAbsDiff(filters[2]!, filters[3]!)).toBeGreaterThan(0.002)

    const reverbs: Float32Array[] = []
    for (const [index, type] of REVERB_TYPES.entries()) {
      const rendered = await played((engine) => {
        engine.writeFx({ reverb: { on: true, type: index, mix: 127, bright: type !== 'Spring' } })
      }, 1.2)
      expect(meanAbsDiff(dry.channel, rendered.channel.subarray(0, dry.channel.length)), type).toBeGreaterThan(0.004)
      reverbs.push(rendered.channel)
    }
    expect(rms(reverbs[REVERB_TYPES.indexOf('Cathedral')]!, 35000, 50000)).toBeGreaterThan(
      rms(reverbs[REVERB_TYPES.indexOf('Booth')]!, 35000, 50000) * 1.2,
    )
    for (let index = 1; index < reverbs.length; index++) {
      expect(meanAbsDiff(reverbs[index - 1]!, reverbs[index]!), REVERB_TYPES[index]).toBeGreaterThan(0.0015)
    }

    const open = await played((engine) => {
      engine.writeFx({ comp: { on: false, amount: 127 } })
    }, 0.5)
    const squeezed = await played((engine) => {
      engine.writeFx({ comp: { on: true, amount: 127, fast: true } })
    }, 0.5)
    expect(meanAbsDiff(open.channel, squeezed.channel)).toBeGreaterThan(0.004)
  })

  it('agrees with Layer Effects panel buttons', () => {
    let engine: PianoEngine | null = null
    const timers = new ManualTimers()
    const context = new OfflineAudioContext(2, 44100, 44100)
    const audio: AudioBoundary = { createContext: () => context as unknown as AudioContextLike, timers }
    renderApp({
      audio,
      onEngine: (created) => {
        engine = created
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Layer Effects On' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mod 1 On' }))
    expect(engine!.isEffectsOn()).toBe(true)
    expect(engine!.readFx().mod1On).toBe(true)
    expect(screen.getByRole('button', { name: 'Mod 1 On' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'All FX Off' }))
    expect(engine!.isEffectsOn()).toBe(false)
    const comp = document.querySelector('[data-fx-unit="compressor"]')
    const reverb = document.querySelector('[data-fx-unit="reverb"]')
    expect(comp?.closest('.section-effects')).toBeTruthy()
    expect(reverb?.closest('.section-effects')).toBeTruthy()
    expect(comp?.closest('[data-testid="keybed-band"]')).toBeNull()
    expect(reverb?.closest('[data-testid="keybed-band"]')).toBeNull()
    expect(comp?.closest('.fx-bottom')).toBe(reverb?.closest('.fx-bottom'))
  })
})
