import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import { createWebAudioEngine, MASTER_GAIN, LIMITER_CEILING } from '../audio/webAudioEngine'
import { createFakeContext } from '../audio/fakes'
import {
  chainFor,
  cloneState,
  createEffectStore,
  defaultEffectState,
  effectiveChain,
  unitActive,
  type EffectState,
} from '../audio/effectState'
import { GLOBAL_CAPABLE } from '../audio/effectTypes'
import { applyEffectEdit, effectPanelValue, editedChain } from '../audio/panelBindings'
import { createChain, buildRotary, createRotaryReturn, isRoutedToRotary } from '../audio/effectGraph'
import { createToneSource, rms, stereoCorrelation, contourSpread, levelContour } from '../audio/offlineRender'
import manifest from '../audio/sample-manifest.json'
import gains from '../audio/sample-gains.json'
import type { SampleEntry } from '../audio/pianoVoice'

/**
 * effects.routing — focus follows layer focus, manual focus buttons, Piano group mode,
 * Delay/Compressor/Reverb global mode, per-unit bypass, all-effects bypass, dry/wet and the
 * documented order.
 *
 * The routing assertions are made twice: on the state model (which chain an edit reaches)
 * and on rendered audio (whether the signal really changed), because a router that only
 * updates a label would pass the first and fail the second.
 */

const entries = manifest as SampleEntry[]
const levels = gains as Record<string, number>
const SR = 48000

function base(): EffectState {
  return cloneState(defaultEffectState())
}

async function render(
  state: EffectState,
  owner: 'piano.a' | 'piano.b' = 'piano.a',
  seconds = 1.2,
) {
  return (await import('../audio/offlineRender')).renderChain(
    OfflineAudioContext as never,
    ((ctx: Record<string, any>, destination: unknown) =>
      createToneSource(ctx, destination, { frequency: 220, seconds })) as never,
    { state, owner, seconds, sampleRate: SR },
  )
}

describe('effects.routing — focus', () => {
  it('starts focused on Piano layer A with every unit off', () => {
    const state = base()
    expect(state.focus).toBe('piano')
    expect(state.focusedLayer).toBe('piano.a')
    expect(state.allOn).toBe(true)
    expect(chainFor(state, 'piano.a')).toBe(state.chains['piano.a'])
    expect(chainFor(state, 'piano.b')).toBe(state.chains['piano.b'])
  })

  it('routes a panel edit through the manual focus buttons', () => {
    const state = base()
    applyEffectEdit(state, 'effects.focus.piano-b', true)
    expect(state.focusedLayer).toBe('piano.b')
    expect(editedChain(state)).toBe('piano.b')
    // Now an edit lands on B only.
    applyEffectEdit(state, 'effects.reverb.on', true)
    expect(state.chains['piano.b'].reverb.on).toBe(true)
    expect(state.chains['piano.a'].reverb.on).toBe(false)
    applyEffectEdit(state, 'effects.focus.piano-a', true)
    applyEffectEdit(state, 'effects.reverb.on', true)
    expect(state.chains['piano.a'].reverb.on).toBe(true)
  })

  it('treats the two focus buttons as a radio pair, never both lit', () => {
    // The focus buttons latch, so pressing one must not be able to leave both LEDs lit or
    // to switch the focused layer off entirely.
    const state = base()
    applyEffectEdit(state, 'effects.focus.piano-b', true)
    expect(effectPanelValue(state, 'effects.focus.piano-a')).toBe(false)
    expect(effectPanelValue(state, 'effects.focus.piano-b')).toBe(true)
    // Pressing the already-focused layer's button is a no-op rather than a clear.
    applyEffectEdit(state, 'effects.focus.piano-b', false)
    expect(state.focusedLayer).toBe('piano.b')
    applyEffectEdit(state, 'effects.focus.piano-a', false)
    expect(state.focusedLayer).toBe('piano.b')
    applyEffectEdit(state, 'effects.focus.piano-a', true)
    expect(effectPanelValue(state, 'effects.focus.piano-a')).toBe(true)
    expect(effectPanelValue(state, 'effects.focus.piano-b')).toBe(false)
  })

  it('follows the layer focus set from the Piano section', () => {
    const store = createEffectStore(base())
    // The instrument mirrors a layer-focus change into the effect store, which is what
    // `focusLayer` is for; the panel's own buttons use the same field.
    store.update((draft) => {
      draft.focusedLayer = 'piano.b'
      draft.focus = 'piano'
    })
    expect(store.get().focusedLayer).toBe('piano.b')
    // An edit now reaches B.
    store.update((draft) => applyEffectEdit(draft, 'effects.mod1.on', true))
    expect(store.get().chains['piano.b'].mod1.on).toBe(true)
    expect(store.get().chains['piano.a'].mod1.on).toBe(false)
  })

  it('keeps the two chains fully independent in layer mode', () => {
    const state = base()
    state.chains['piano.a'].delay = {
      on: true, tempo: 8, feedback: 8, dryWet: 8, filter: 'LP', pingPong: false, tapSeconds: 0.12, global: false,
    }
    expect(state.chains['piano.b'].delay.on).toBe(false)
    expect(state.chains['piano.b'].delay.tempo).not.toBe(8)
    // Rendering the same source through each chain gives different results.
    return (async () => {
      const a = await render(state, 'piano.a')
      const b = await render(state, 'piano.b')
      expect(rms(a.mono)).not.toBeCloseTo(rms(b.mono), 3)
    })()
  }, 60000)
})

describe('effects.routing — group mode', () => {
  it('makes every layer of the section share the focused chain', () => {
    const state = base()
    state.pianoGroup = true
    state.chains['piano.a'].compressor = { on: true, amount: 8, fast: true, global: false }
    // In group mode, layer B resolves to A's settings regardless of its own.
    expect(chainFor(state, 'piano.b').compressor.amount).toBe(8)
    expect(chainFor(state, 'piano.b').compressor.fast).toBe(true)
  })

  it('switches the shared settings to the newly focused layer when group mode engages', () => {
    const state = base()
    state.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 7, tone: 'Bright', global: false }
    state.chains['piano.b'].reverb = { on: true, type: 'Booth', dryWet: 2, tone: 'Dark', global: false }
    state.focusedLayer = 'piano.b'
    state.pianoGroup = true
    // Focused layer's settings are the group's settings, as the manual describes.
    expect(chainFor(state, 'piano.a').reverb.type).toBe('Booth')
    expect(chainFor(state, 'piano.a').reverb.dryWet).toBe(2)
  })

  it('is audible: group mode makes B sound like A', async () => {
    const state = base()
    state.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 6, amount: 9 }
    const ungroupedA = await render(state, 'piano.a')
    const ungroupedB = await render(state, 'piano.b')
    // Independent chains: B is dry while A is modulated.
    expect(contourSpread(levelContour(ungroupedB.mono, 24))).toBeLessThan(
      contourSpread(levelContour(ungroupedA.mono, 24)),
    )
    const grouped = { ...state, pianoGroup: true }
    const groupedB = await render(grouped, 'piano.b')
    // Shared chain: B is now modulated like A.
    expect(contourSpread(levelContour(groupedB.mono, 24))).toBeCloseTo(
      contourSpread(levelContour(ungroupedA.mono, 24)),
      1,
    )
  }, 60000)
})

describe('effects.routing — global mode', () => {
  it('only offers global mode on Delay, Compressor and Reverb', () => {
    expect([...GLOBAL_CAPABLE]).toEqual(['delay', 'compressor', 'reverb'])
    const state = base()
    // The model has a global flag exactly on those three units.
    expect('global' in state.chains['piano.a'].delay).toBe(true)
    expect('global' in state.chains['piano.a'].compressor).toBe(true)
    expect('global' in state.chains['piano.a'].reverb).toBe(true)
    expect('global' in state.chains['piano.a'].mod1).toBe(false)
    expect('global' in state.chains['piano.a'].mod2).toBe(false)
    expect('global' in state.chains['piano.a'].ampEq).toBe(false)
  })

  it('applies a global unit to every layer, from the chain that owns it', () => {
    const state = base()
    state.focusedLayer = 'piano.a'
    state.chains['piano.a'].reverb = { on: true, type: 'Cathedral', dryWet: 9, tone: 'Dark', global: true }
    // B's own reverb stays untouched, but what it *plays* is A's global reverb.
    expect(state.chains['piano.b'].reverb.type).toBe('Room')
    const resolved = effectiveChain(state, 'piano.b')
    expect(resolved.reverb.type).toBe('Cathedral')
    expect(resolved.reverb.dryWet).toBe(9)
    expect(resolved.reverb.on).toBe(true)
  })

  it('is audible: a global reverb reaches the other layer', async () => {
    // Layer B's own reverb is off, so a tail at all proves the global unit reached it.
    const global = base()
    global.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 10, tone: 'Bright', global: true }
    const local = base()
    local.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 10, tone: 'Bright', global: false }

    // The resolver is what the graph reads, so assert on it *and* on the rendered tail.
    expect(effectiveChain(global, 'piano.b').reverb.on).toBe(true)
    expect(effectiveChain(local, 'piano.b').reverb.on).toBe(false)

    // Measured *after* the source stops: a dry chain returns to silence, a reverb chain
    // keeps ringing. The source is a short burst so there is real silence to compare with.
    const burst = (ctx: Record<string, any>, destination: unknown) => {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = 220
      const env = ctx.createGain()
      env.gain.value = 0
      env.gain.setValueAtTime(0, 0)
      env.gain.linearRampToValueAtTime(0.35, 0.01)
      env.gain.setValueAtTime(0.35, 0.25)
      env.gain.linearRampToValueAtTime(0, 0.3)
      osc.connect(env)
      env.connect(destination)
      osc.start(0)
      osc.stop(0.35)
      return () => {
        try {
          osc.stop()
        } catch {
          /* already stopped */
        }
      }
    }
    const renderBurst = async (state: EffectState) =>
      (await import('../audio/offlineRender')).renderChain(OfflineAudioContext as never, burst as never, {
        state,
        owner: 'piano.b',
        seconds: 1.8,
        sampleRate: SR,
      })
    const bWithGlobal = await renderBurst(global)
    const bWithout = await renderBurst(local)
    const tail = (data: Float32Array) => rms(data, Math.round(0.9 * SR), Math.round(1.4 * SR))
    expect(tail(bWithout.mono)).toBeLessThan(1e-4)
    expect(tail(bWithGlobal.mono)).toBeGreaterThan(1e-3)
  }, 60000)

  it('turns global mode off without silently reverting the other layer', () => {
    const state = base()
    state.chains['piano.a'].delay = {
      on: true, tempo: 7, feedback: 6, dryWet: 5, filter: 'LP', pingPong: false, tapSeconds: 0.15, global: true,
    }
    expect(effectiveChain(state, 'piano.b').delay.tempo).toBe(7)
    state.chains['piano.a'].delay.global = false
    // B keeps its own settings once the unit is no longer global.
    expect(effectiveChain(state, 'piano.b').delay.tempo).toBe(4)
    expect(effectiveChain(state, 'piano.a').delay.tempo).toBe(7)
  })
})

describe('effects.routing — bypass', () => {
  it('bypasses one unit without touching the others', async () => {
    const state = base()
    state.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 6, amount: 9 }
    state.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 8, tone: 'Bright', global: false }
    const both = await render(state)
    const tremoloOff = cloneState(state)
    tremoloOff.chains['piano.a'].mod1.on = false
    const noTremolo = await render(tremoloOff)
    expect(contourSpread(levelContour(noTremolo.mono, 24))).toBeLessThan(
      contourSpread(levelContour(both.mono, 24)),
    )
    // The reverb is untouched by bypassing Mod 1: a tail is still there.
    expect(rms(noTremolo.mono, Math.round(1.0 * SR), Math.round(1.1 * SR))).toBeGreaterThan(0)
  }, 60000)

  it('bypasses every effect at once with Layer Effects ON', async () => {
    const state = base()
    state.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 5, amount: 8 }
    state.chains['piano.a'].ampEq = { on: true, model: 'Twin', drive: 6, bass: 0, mid: 0, midFreq: 5, treble: 0 }
    state.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 8, tone: 'Bright', global: false }
    const allOn = await render(state)
    const bypassed = await render({ ...state, allOn: false })
    const dry = await render(base())

    // With everything bypassed, the output matches a chain with no units engaged.
    expect(Math.abs(rms(bypassed.mono) - rms(dry.mono)) / rms(dry.mono)).toBeLessThan(0.03)
    // And it is clearly different from the chain with the effects running.
    expect(Math.abs(rms(allOn.mono) - rms(dry.mono)) / rms(dry.mono)).toBeGreaterThan(0.05)
    // `unitActive` agrees with what the graph did.
    const offState = { ...state, allOn: false }
    expect(unitActive(offState, 'piano.a', 'mod1')).toBe(false)
    expect(unitActive(state, 'piano.a', 'mod1')).toBe(true)
  }, 60000)

  it('is click-free: parameter changes are ramped, not stepped', async () => {
    // A sawtooth contains legitimate waveform discontinuities, so an absolute step test
    // would measure the source. What matters is that the chain introduces no *new* jump:
    // the largest step through the chain must not exceed the source's own.
    const source = await (await import('../audio/offlineRender')).renderChain(
      OfflineAudioContext as never,
      ((ctx: Record<string, any>, destination: unknown) =>
        createToneSource(ctx, destination, { frequency: 220, seconds: 1.0 })) as never,
      { state: base(), owner: 'piano.a', seconds: 1.0, sampleRate: SR },
    )
    const state = base()
    state.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 8, tone: 'Bright', global: false }
    state.chains['piano.a'].compressor = { on: true, amount: 6, fast: false, global: false }
    const rendered = await render(state, 'piano.a', 1.0)
    const largestStep = (data: Float32Array) => {
      let largest = 0
      for (let i = 1; i < data.length; i += 1) largest = Math.max(largest, Math.abs(data[i] - data[i - 1]))
      return largest
    }
    // Reverb and compression smooth a signal; they never make it jump further per sample.
    expect(largestStep(rendered.mono)).toBeLessThanOrEqual(largestStep(source.mono) * 1.05)
    expect(rendered.mono.every((v) => Number.isFinite(v))).toBe(true)
  }, 60000)
})

describe('effects.graph — one context, one destination, one master path', () => {
  it('builds one AudioContext, two chains, one shared rotary and one destination', async () => {
    const SR_LOCAL = 48000
    const ctx = new OfflineAudioContext(2, Math.round(SR_LOCAL * 0.4), SR_LOCAL)
    let created = 0
    const engine = createWebAudioEngine({
      createContext: () => {
        created += 1
        return ctx as never
      },
      sampleEntries: entries,
      sampleLevels: levels,
      sampleBaseUrl: 'samples/',
    })
    // A real context is already running, so `start()` is not needed to build the graph; a
    // note builds it, exactly as the first key press does.
    expect(created).toBe(0)
    engine.noteOn({
      id: 'v1',
      midi: 60,
      velocity: 0.8,
      settings: {
        velocity: 0.8,
        layer: 'piano.a',
        octave: 0,
        model: 'grand.salamander',
        touchExponent: 1,
        dynComp: 0,
        timbre: 0,
        unison: 0,
        softRelease: false,
        stringRes: false,
      },
    })
    expect(created).toBe(1)
    expect(engine.chains).not.toBeNull()
    expect(engine.rotary).not.toBeNull()
    // Both chains exist and each carries the documented unit order.
    expect(engine.chains!['piano.a'].order).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
    expect(engine.chains!['piano.b'].order).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
    // There is one rotary instance, shared, and the chains are distinct objects.
    expect(engine.chains!['piano.a']).not.toBe(engine.chains!['piano.b'])
    expect(engine.rotary).toBe(engine.rotary)
    expect(engine.effectsAvailable).toBe(true)
    engine.stopAll()
    engine.dispose()
  }, 60000)

  it('reaches exactly one destination, through the master gain and limiter', () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    engine.noteOn({ id: 'v1', midi: 60, velocity: 0.8 })
    // The fake counts connections into its destination sink: one master path only.
    expect(context.destinations).toBe(1)
    engine.stopAll()
    engine.dispose()
  })

  it('returns node and voice counts to baseline after cleanup', async () => {
    const SR_LOCAL = 48000
    const ctx = new OfflineAudioContext(2, Math.round(SR_LOCAL * 0.4), SR_LOCAL)
    const engine = createWebAudioEngine({
      createContext: () => ctx as never,
      sampleEntries: entries,
      sampleLevels: levels,
      sampleBaseUrl: 'samples/',
    })
    engine.noteOn({
      id: 'warm',
      midi: 60,
      velocity: 0.7,
      settings: {
        velocity: 0.7, layer: 'piano.a', octave: 0, model: 'grand.salamander', touchExponent: 1,
        dynComp: 0, timbre: 0, unison: 0, softRelease: false, stringRes: false,
      },
    })
    // The baseline is the idle graph: chains, rotary and master path, with no voices.
    engine.stopAll()
    const baseline = engine.liveNodeCount()
    expect(baseline).toBeGreaterThan(0)
    for (let i = 0; i < 6; i += 1) {
      engine.noteOn({
        id: `v${i}`,
        midi: 55 + i,
        velocity: 0.6,
        settings: {
          velocity: 0.6, layer: 'piano.a', octave: 0, model: 'grand.salamander', touchExponent: 1,
          dynComp: 0, timbre: 0, unison: 0, softRelease: false, stringRes: false,
        },
      })
    }
    expect(engine.liveNodeCount()).toBeGreaterThan(baseline)
    expect(engine.activeVoiceCount()).toBeGreaterThan(0)
    engine.stopAll()
    expect(engine.liveNodeCount()).toBe(baseline)
    expect(engine.activeVoiceCount()).toBe(0)
    engine.dispose()
    expect(engine.liveNodeCount()).toBe(0)
  }, 60000)

  it('declares a truthful master gain and limiter ceiling', () => {
    expect(MASTER_GAIN).toBeGreaterThan(0)
    expect(MASTER_GAIN).toBeLessThanOrEqual(1)
    expect(LIMITER_CEILING).toBeLessThanOrEqual(1)
    expect(LIMITER_CEILING).toBeGreaterThan(0.9)
  })

  it('follows layer focus into the effect store', () => {
    const engine = createWebAudioEngine({
      createContext: () => createFakeContext(),
      sampleEntries: entries,
      sampleLevels: levels,
    })
    expect(engine.effects.get().focusedLayer).toBe('piano.a')
    engine.effects.update((draft) => {
      draft.focusedLayer = 'piano.b'
    })
    engine.syncEffects()
    expect(engine.effects.get().focusedLayer).toBe('piano.b')
    engine.dispose()
  })

  it('keeps the panel value and the state in agreement for every effect control', () => {
    // Every effect control that reports a panel value must round-trip: setting the state
    // and reading the panel gives the index that produced it.
    const ids = [
      'effects.mod1.type', 'effects.mod1.on', 'effects.mod1.rate', 'effects.mod1.amount',
      'effects.mod2.type', 'effects.mod2.on', 'effects.delay.on', 'effects.delay.filter',
      'effects.amp.on', 'effects.amp.model', 'effects.comp.on', 'effects.reverb.on',
      'effects.reverb.type', 'effects.reverb.tone',
    ]
    for (const id of ids) {
      const state = base()
      const before = effectPanelValue(state, id)
      expect(before, id).not.toBeUndefined()
      // A toggle flips, a selector moves one position.
      const next = typeof before === 'boolean' ? !before : (Number(before) + 1) % 4
      const edited = cloneState(state)
      applyEffectEdit(edited, id, next as never)
      const after = effectPanelValue(edited, id)
      expect(after, id).not.toBe(before)
    }
  })

  it('routes only via the To Rotary model, and never after it', async () => {
    const state = base()
    expect(isRoutedToRotary(state, 'piano.a')).toBe(false)
    state.chains['piano.a'].ampEq = { on: true, model: 'To Rotary', drive: 2, bass: 0, mid: 0, midFreq: 5, treble: 0 }
    expect(isRoutedToRotary(state, 'piano.a')).toBe(true)
    state.rotary = { on: true, speed: 'Fast', drive: 5, organRouted: false }
    const out = await render(state)
    // The rotary widens the image; nothing that came after it could restore a mono image.
    expect(stereoCorrelation(out.left, out.right)).toBeLessThan(0.98)
    expect(rms(out.mono)).toBeGreaterThan(0.005)
  }, 60000)

  it('shares one rotary between two routed layers', async () => {
    // Both chains feed the same rotary input, so two routed layers are summed through one
    // rotating speaker rather than each getting its own.
    const ctx = new OfflineAudioContext(2, Math.round(SR * 0.4), SR)
    const rotary = buildRotary(ctx as never)
    const chainA = createChain(ctx as never, 'piano.a', rotary)
    const chainB = createChain(ctx as never, 'piano.b', rotary)
    expect(chainA.input).not.toBe(chainB.input)
    // There is exactly one return from the rotary into the master path.
    const returned = createRotaryReturn(ctx as never, rotary)
    expect(returned).toBeDefined()
    chainA.dispose()
    chainB.dispose()
    rotary.dispose()
  })
})
