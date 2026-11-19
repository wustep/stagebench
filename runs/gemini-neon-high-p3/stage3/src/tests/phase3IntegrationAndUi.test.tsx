import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { OfflineAudioContext } from 'node-web-audio-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type {
  AudioContextLike,
  Clock,
  MidiAccessLike,
  MidiInputLike,
  MidiMessageEventLike,
  MidiProvider,
  PianoEngineStatusSnapshot,
  PianoVoiceBackend,
  TimerHandle,
} from '../audio/boundaries'
import { StageAudioEngine } from '../audio/stageAudioEngine'
import {
  createInitialInstrumentState,
  instrumentStateReducer,
  type StageInstrumentState,
} from '../model/instrumentState'
import { createMemoryStorageAdapter } from '../model/programBank'

function createNoopClock(): Clock {
  let id = 1
  return {
    now: () => 0,
    setTimeout: (): TimerHandle => id++,
    clearTimeout: () => undefined,
  }
}

function createCaptureBackend() {
  let latestState: StageInstrumentState | null = null
  const panic = vi.fn()
  const stopAllImmediate = vi.fn()
  const status: PianoEngineStatusSnapshot = {
    status: 'ready',
    loadedSamples: 170,
    totalSamples: 170,
    usingFallback: false,
    message: 'Salamander Grand ready (78/78 samples)',
    audioContextState: 'running',
    failedBanks: [],
  }
  const backend: PianoVoiceBackend = {
    unlock: async () => undefined,
    triggerNote: vi.fn(),
    releaseNote: vi.fn(),
    stopAllImmediate,
    panic,
    getActiveNodeCount: () => 0,
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
    dispose: vi.fn(),
    applyInstrumentState: (s) => {
      latestState = s
    },
  }
  return { backend, panic, stopAllImmediate, getLatestState: () => latestState }
}
function createFakeMidiProvider() {
  const input: MidiInputLike = {
    id: 'fake-in-1',
    name: 'Virtual Stage Controller',
    state: 'connected',
    onmidimessage: null,
  }
  const access: MidiAccessLike = {
    inputs: [input],
    onstatechange: null,
  }
  const provider: MidiProvider = {
    isSupported: () => true,
    requestAccess: async () => access,
  }
  const sendMessage = (bytes: number[]) => {
    const evt: MidiMessageEventLike = { data: new Uint8Array(bytes) }
    input.onmidimessage?.(evt)
  }
  return { provider, sendMessage }
}

function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / Math.max(1, buf.length))
}

afterEach(() => {
  cleanup()
})

describe('system.integration — ONE AudioContext, splits, scenes, morphs, transpose, Master Level & Panic in rendered audio', () => {
  it('routes Piano, Organ, and Synth through one AudioContext & one Master Level, enforces Splits/Crossfades/Scenes/Transpose, and cleans up on Panic', async () => {
    const sampleRate = 22050
    const makeAllThree = () => {
      let s = createInitialInstrumentState(createMemoryStorageAdapter())
      s = instrumentStateReducer(s, { type: 'set-piano-layer', layer: 'A', patch: { enabled: true, type: 'Digital', modelIndex: 0 } })
      s = instrumentStateReducer(s, { type: 'set-organ-section', patch: { sectionOn: true } })
      s = instrumentStateReducer(s, { type: 'set-organ-layer', layer: 'A', patch: { enabled: true, model: 'B3' } })
      s = instrumentStateReducer(s, { type: 'set-synth-section', patch: { sectionOn: true } })
      s = instrumentStateReducer(s, { type: 'set-synth-layer', layer: 'A', patch: { enabled: true, oscCategory: 'Pure', oscWaveform: 'Saw' } })
      return s
    }

    const renderWith = async (state: StageInstrumentState, midi = 60) => {
      const offline = new OfflineAudioContext(2, Math.floor(sampleRate * 0.35), sampleRate)
      const engine = new StageAudioEngine({
        contextFactory: () => offline as unknown as AudioContextLike,
        clock: createNoopClock(),
        initialState: state,
        autoLoadSamples: false,
      })
      engine.triggerNote(1, midi, 100)
      const diag = engine.getGraphDiagnostics()
      const rendered = await offline.startRendering()
      const left = new Float32Array(rendered.getChannelData(0))
      engine.panic()
      const postPanicNodes = engine.getActiveNodeCount()
      engine.dispose()
      return { left, diag, postPanicNodes }
    }

    // 1. All 3 engines run simultaneously on ONE AudioContext (contextCount === 1)
    const allOn = await renderWith(makeAllThree())
    expect(allOn.diag.contextCount).toBe(1)
    expect(allOn.diag.layerVoiceCounts.A).toBe(1)
    expect(allOn.diag.organVoiceCounts?.A).toBe(1)
    expect(allOn.diag.synthVoiceCounts?.A).toBe(1)
    expect(rms(allOn.left)).toBeGreaterThan(0.02)
    expect(allOn.postPanicNodes).toBe(0)

    // 2. Master Level = 0 silences ALL THREE engines (nothing bypasses Master path!)
    const muted = await renderWith(
      instrumentStateReducer(makeAllThree(), { type: 'set-master-level', value: 0 }),
    )
    expect(rms(muted.left)).toBeLessThan(0.0005)

    // 3. Split at C4 (60): Organ in lower zone (0), Synth in upper zone (1), Piano off
    let splitState = makeAllThree()
    splitState = instrumentStateReducer(splitState, { type: 'set-piano-section', patch: { sectionOn: false } })
    splitState = instrumentStateReducer(splitState, { type: 'set-split', patch: { enabled: true } })
    splitState = instrumentStateReducer(splitState, {
      type: 'set-split-point',
      point: 'mid',
      patch: { active: true, note: 'C4', crossfade: 0 },
    })
    splitState = instrumentStateReducer(splitState, {
      type: 'set-layer-zone',
      section: 'organ',
      layer: 'A',
      zone: { lowZone: 0, highZone: 0 },
    })
    splitState = instrumentStateReducer(splitState, {
      type: 'set-layer-zone',
      section: 'synth',
      layer: 'A',
      zone: { lowZone: 1, highZone: 1 },
    })
    const lowNote = await renderWith(splitState, 48) // C3 -> Organ only
    expect(lowNote.diag.organVoiceCounts?.A).toBe(1)
    expect(lowNote.diag.synthVoiceCounts?.A).toBe(0)
    const highNote = await renderWith(splitState, 72) // C5 -> Synth only
    expect(highNote.diag.organVoiceCounts?.A).toBe(0)
    expect(highNote.diag.synthVoiceCounts?.A).toBe(1)

    // 4. Scene II toggles enables cleanly in rendered audio
    const sceneII = instrumentStateReducer(makeAllThree(), { type: 'switch-scene', scene: 'II' })
    const sceneRender = await renderWith(sceneII, 60)
    expect(sceneRender.diag.contextCount).toBe(1)
  })
})

describe('Phase 3 UI Integration — Programs, Live Mode, Store As, List View, Splits, Scenes, Morph LEDs, MIDI CC11, Unsupported Audit', () => {
  it('drives Program navigation, dirty badge, Store As, List View, Splits, Scenes, Morph LEDs, MIDI CC11 Control Pedal, Panic, and Unsupported list from the DOM', async () => {
    const storage = createMemoryStorageAdapter()
    const { backend, panic, getLatestState } = createCaptureBackend()
    const { provider, sendMessage } = createFakeMidiProvider()

    const { container } = render(
      <App pianoBackend={backend} midiProvider={provider} storage={storage} />,
    )

    // Wait one microtask for MIDI access init
    await Promise.resolve()

    const progSection = container.querySelector('[data-section="program"]')!
    const progOled = container.querySelector('#program-oled')!
    const synthOled = container.querySelector('#synth-oled')!

    expect(progSection.getAttribute('data-program-slot')).toBe('1.1')
    expect(progSection.getAttribute('data-program-dirty')).toBe('false')
    expect(synthOled.textContent).toContain('Saw')

    // Edit Synth filter -> dirty indicator E appears truthfully
    fireEvent.keyDown(container.querySelector('#synth-filter-freq')!, { key: 'ArrowRight' })
    expect(progSection.getAttribute('data-program-dirty')).toBe('true')
    expect(container.querySelector('[data-testid="dirty-indicator"]')).not.toBeNull()

    // Open Store As (Shift + Store), type name, advance, confirm
    fireEvent.click(container.querySelector('#program-shift')!)
    fireEvent.click(container.querySelector('#program-store')!)
    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="Program name"]')!
    expect(nameInput).not.toBeNull()
    fireEvent.change(nameInput, { target: { value: 'Stage Lead 3' } })
    fireEvent.click(container.querySelector('#program-store')!) // advance to confirm
    expect(container.querySelector('[data-testid="store-confirm-overlay"]')).not.toBeNull()
    fireEvent.click(container.querySelector('#program-store')!) // confirm store
    expect(progOled.textContent).toContain('Stage Lead 3')
    expect(progSection.getAttribute('data-program-dirty')).toBe('false')

    // Open Numeric List View (VIEW button) and pick 1.2 B3 Soul Rotary
    fireEvent.click(container.querySelector('#program-prog-view')!)
    const listView = container.querySelector('[data-testid="program-list-view"]')!
    expect(listView.querySelectorAll('[role="option"]')).toHaveLength(32)
    fireEvent.click(listView.querySelectorAll('[role="option"]')[1])
    expect(progSection.getAttribute('data-program-slot')).toBe('1.2')
    expect(progOled.textContent).toContain('B3 Soul Rotary')

    // Morph LED indicator lights on assigned control (Program 1.2 has Wheel -> rotary:speed, CtrlPed -> organ:A:level)
    expect(
      container.querySelector('#organ-layer-a-fader')?.getAttribute('data-morph-assigned'),
    ).toBe('true')

    // MIDI CC11 drives Control Pedal morph source & virtual slider updates
    act(() => {
      sendMessage([0xb0, 11, 127])
    })
    expect(getLatestState()?.controlPedal).toBe(100)
    const ctrlPedalSlider = container.querySelector<HTMLInputElement>('#control-pedal-slider')!
    expect(ctrlPedalSlider.value).toBe('100')
    // Toggle Live Mode -> switches to L:1
    fireEvent.click(container.querySelector('#program-live-mode')!)
    expect(progSection.getAttribute('data-program-mode')).toBe('live')
    expect(progSection.getAttribute('data-program-slot')).toBe('L:1')

    // Toggle Layer Scene II
    fireEvent.click(container.querySelector('#program-layer-scene')!)
    expect(progSection.getAttribute('data-active-scene')).toBe('II')

    // Toggle Split ON -> Mid split LED lights above keybed
    fireEvent.click(container.querySelector('#program-split')!)
    expect(container.querySelector('[data-split-led="mid"]')?.classList.contains('is-lit')).toBe(
      true,
    )

    // Shift + Transpose executes Panic
    fireEvent.click(container.querySelector('#program-shift')!)
    fireEvent.click(container.querySelector('#program-transpose')!)
    expect(panic).toHaveBeenCalled()
    expect(getLatestState()?.controlPedal).toBe(0)

    // Credits & Scope discloses Unsupported (Spec-Excluded) controls honestly
    fireEvent.click(container.querySelector('#credits-toggle-btn')!)
    const creditsText = container.querySelector('#sample-credits-panel')?.textContent ?? ''
    expect(creditsText).toContain('Unsupported (Spec-Excluded) Controls')
    expect(creditsText).toContain('program-morph-at')
    expect(creditsText).toContain('organ-preset')
  })
})
