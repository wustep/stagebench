import type {
  LayerEnableSnapshot,
  LayerScenesState,
  MasterClockState,
  OrganSectionState,
  SynthSectionState,
  TransposeState,
} from './organSynthTypes'
import {
  createDefaultMasterClockState,
  createDefaultOrganLayer,
  createDefaultOrganSection,
  createDefaultSynthLayer,
  createDefaultSynthSection,
  createDefaultTransposeState,
} from './organSynthTypes'
import type { MorphState } from './morphs'
import { createEmptyMorphState } from './morphs'
import type { SplitState } from './splits'
import { createDefaultSplitState, FULL_KEYBOARD_ZONE } from './splits'
import type { EffectsSectionState, PianoSectionState } from './instrumentState'
import { createDefaultEffectChain } from './instrumentState'

export interface ProgramPatch {
  readonly version: 3
  readonly organ: OrganSectionState
  readonly piano: PianoSectionState
  readonly synth: SynthSectionState
  readonly effects: Omit<EffectsSectionState, 'shiftActive' | 'lastTapTimestampMs'>
  readonly split: SplitState
  readonly scenes: LayerScenesState
  readonly morphs: MorphState
  readonly masterClock: MasterClockState
  readonly transpose: TransposeState
}

export interface ProgramSlot {
  readonly index: number // 0..31 (Page 1..4, Button 1..8)
  readonly name: string
  readonly patch: ProgramPatch
}

export interface LiveSlot {
  readonly index: number // 0..7 (Live 1..8)
  readonly name: string
  readonly patch: ProgramPatch
}

export interface PersistedProgramBank {
  readonly version: 3
  readonly programs: readonly ProgramSlot[]
  readonly liveSlots: readonly LiveSlot[]
}

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const PROGRAM_STORAGE_KEY = 'ns4-stage-programs-v3'

export const browserStorageAdapter: StorageAdapter = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key)
      }
    } catch {
      // ignore sandbox/private-mode storage errors
    }
    return null
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value)
      }
    } catch {
      // ignore quota/sandbox errors
    }
  },
}

export function createMemoryStorageAdapter(): StorageAdapter & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

export function formatProgramSlotCode(index: number): string {
  const clamped = Math.max(0, Math.min(31, Math.floor(index)))
  const page = Math.floor(clamped / 8) + 1
  const btn = (clamped % 8) + 1
  return `${page}.${btn}`
}

export function formatLiveSlotCode(index: number): string {
  const clamped = Math.max(0, Math.min(7, Math.floor(index)))
  return `L:${clamped + 1}`
}

export function snapshotLayerEnables(
  organ: OrganSectionState,
  piano: PianoSectionState,
  synth: SynthSectionState,
): LayerEnableSnapshot {
  return {
    organSectionOn: organ.sectionOn,
    organA: organ.layers.A.enabled,
    organB: organ.layers.B.enabled,
    pianoSectionOn: piano.sectionOn,
    pianoA: piano.layers.A.enabled,
    pianoB: piano.layers.B.enabled,
    synthSectionOn: synth.sectionOn,
    synthA: synth.layers.A.enabled,
    synthB: synth.layers.B.enabled,
    synthC: synth.layers.C.enabled,
  }
}

export function createBasePianoSection(
  overrides: Partial<PianoSectionState> = {},
): PianoSectionState {
  return {
    sectionOn: true,
    focusedLayer: 'A',
    sustped: true,
    pstick: true,
    layers: {
      A: {
        enabled: true,
        level: 92,
        octave: 0,
        zone: FULL_KEYBOARD_ZONE,
        type: 'Grand',
        modelIndex: 0,
        timbre: 'Off',
        kbTouch: 'Medium',
        dynComp: 0,
        unison: 0,
        softRelease: false,
        stringRes: true,
      },
      B: {
        enabled: false,
        level: 70,
        octave: 0,
        zone: FULL_KEYBOARD_ZONE,
        type: 'Electric',
        modelIndex: 0,
        timbre: 'Off',
        kbTouch: 'Medium',
        dynComp: 0,
        unison: 0,
        softRelease: false,
        stringRes: false,
      },
    },
    ...overrides,
  }
}

export function createBaseEffectsPayload(
  overrides: Partial<ProgramPatch['effects']> = {},
): ProgramPatch['effects'] {
  const chainA = createDefaultEffectChain(true)
  const chainB = createDefaultEffectChain(false)
  const organChain = createDefaultEffectChain(true)
  const synthA = createDefaultEffectChain(true)
  const synthB = createDefaultEffectChain(false)
  const synthC = createDefaultEffectChain(false)

  return {
    allOn: true,
    focusedChain: 'pianoA',
    pianoGroupMode: false,
    synthGroupMode: false,
    chains: {
      pianoA: chainA,
      pianoB: chainB,
      organ: organChain,
      synthA,
      synthB,
      synthC,
    },
    global: {
      delayGlobal: false,
      compGlobal: false,
      reverbGlobal: false,
      delay: { ...chainA.delay, on: true, dryWet: 34 },
      comp: { ...chainA.comp, on: true, amount: 45 },
      reverb: { ...chainA.reverb, on: true, type: 'Hall', dryWet: 35 },
    },
    rotary: {
      on: true,
      organRouted: true,
      speed: 'Slow',
      stopMode: false,
      drive: 35,
      driveOn: false,
    },
    ...overrides,
  }
}

function makePatch(opts: {
  organ?: OrganSectionState
  piano?: PianoSectionState
  synth?: SynthSectionState
  effects?: ProgramPatch['effects']
  split?: SplitState
  sceneII?: Partial<LayerEnableSnapshot>
  morphs?: MorphState
  masterClock?: MasterClockState
  transpose?: TransposeState
}): ProgramPatch {
  const organ = opts.organ ?? createDefaultOrganSection()
  const piano = opts.piano ?? createBasePianoSection()
  const synth = opts.synth ?? createDefaultSynthSection()
  const effects = opts.effects ?? createBaseEffectsPayload()
  const split = opts.split ?? createDefaultSplitState()
  const sceneI = snapshotLayerEnables(organ, piano, synth)
  const sceneII: LayerEnableSnapshot = {
    ...sceneI,
    ...opts.sceneII,
  }

  return {
    version: 3,
    organ,
    piano,
    synth,
    effects,
    split,
    scenes: {
      activeScene: 'I',
      sceneI,
      sceneII,
    },
    morphs: opts.morphs ?? createEmptyMorphState(),
    masterClock: opts.masterClock ?? createDefaultMasterClockState(),
    transpose: opts.transpose ?? createDefaultTransposeState(),
  }
}

/**
 * Ships 12 factory programs + clean initialized slots to fill all 32 program slots (4 pages x 8).
 * Slot 0 (1.1 Concert Grand) is clean Piano A Salamander Grand with Organ & Synth off, Splits off,
 * Transpose 0, and subtle Booth reverb for accurate startup tuning/velocity behavior.
 */
export function createFactoryProgramSlots(): readonly ProgramSlot[] {
  const basePiano = createBasePianoSection()
  const baseFx = createBaseEffectsPayload()

  const factoryDefs: Array<{ name: string; patch: ProgramPatch }> = [
    // 1.1 Concert Grand (Default startup program)
    {
      name: 'Concert Grand',
      patch: makePatch({
        piano: basePiano,
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({ sectionOn: false }),
        effects: baseFx,
        sceneII: { pianoB: true, synthSectionOn: true, synthA: true },
      }),
    },

    // 1.2 B3 Soul Rotary (Organ B3 with percussion, C3, Rotary slow + morphable speed)
    {
      name: 'B3 Soul Rotary',
      patch: makePatch({
        piano: createBasePianoSection({ sectionOn: false }),
        organ: createDefaultOrganSection({
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: createDefaultOrganLayer('A', {
              enabled: true,
              level: 86,
              model: 'B3',
              drawbars: [8, 8, 8, 4, 0, 0, 0, 0, 0],
              vibChorusType: 'C3',
              vibChorusOn: true,
              percussion: { on: true, soft: false, fast: true, third: true },
              keyClick: true,
            }),
            B: createDefaultOrganLayer('B', {
              enabled: false,
              level: 68,
              model: 'B3',
              drawbars: [0, 0, 8, 6, 4, 4, 0, 0, 0],
            }),
          },
        }),
        synth: createDefaultSynthSection({ sectionOn: false }),
        effects: createBaseEffectsPayload({
          focusedChain: 'organ',
          rotary: {
            on: true,
            organRouted: true,
            speed: 'Slow',
            stopMode: false,
            drive: 48,
            driveOn: true,
          },
        }),
        morphs: {
          wheel: [{ target: 'rotary:speed', start: 0, end: 1 }],
          controlPedal: [{ target: 'organ:A:level', start: 50, end: 95 }],
        },
        sceneII: { organB: true },
      }),
    },

    // 1.3 Analog SuperLead (Synth Super Saw + LP24 + Filter Env + LFO)
    {
      name: 'Analog SuperLead',
      patch: makePatch({
        piano: createBasePianoSection({ sectionOn: false }),
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: createDefaultSynthLayer('A', {
              enabled: true,
              level: 88,
              oscCategory: 'Super',
              oscWaveform: 'Super Saw',
              oscCtrl: 56,
              filter: {
                on: true,
                type: 'LP24',
                freq: 52,
                res: 36,
                envAmt: 55,
                kbTrack: 2,
                drive: 1,
              },
              lfo: {
                waveform: 'Triangle',
                destination: 'Filter Freq',
                rate: 38,
                amount: 22,
                clockSync: false,
              },
              voice: { mode: 'Poly', priority: 'Off', glide: 24, unison: 1 },
            }),
            B: createDefaultSynthLayer('B', { enabled: false }),
            C: createDefaultSynthLayer('C', { enabled: false }),
          },
        }),
        effects: createBaseEffectsPayload({
          focusedChain: 'synthA',
          chains: {
            ...baseFx.chains,
            synthA: {
              ...createDefaultEffectChain(true),
              delay: {
                on: true,
                tempo: 50,
                feedback: 38,
                dryWet: 28,
                filter: 'LP',
                pingPong: true,
                bpm: 120,
                clockSync: true,
              },
              reverb: { on: true, type: 'Hall', tone: 'Normal', dryWet: 32 },
            },
          },
        }),
        morphs: {
          wheel: [
            { target: 'synth:A:filterFreq', start: 52, end: 92 },
            { target: 'synth:A:oscCtrl', start: 56, end: 88 },
          ],
          controlPedal: [],
        },
      }),
    },

    // 1.4 Tine & Warm Pad (Layered Rhodes + Multi Saw Pad with Scene II solo Rhodes & Wheel morph)
    {
      name: 'Tine & Warm Pad',
      patch: makePatch({
        piano: createBasePianoSection({
          sectionOn: true,
          layers: {
            A: {
              ...basePiano.layers.A,
              enabled: true,
              type: 'Electric',
              modelIndex: 0,
              timbre: 'Dyno 1',
              level: 90,
            },
            B: { ...basePiano.layers.B, enabled: false },
          },
        }),
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: createDefaultSynthLayer('A', {
              enabled: true,
              level: 62,
              oscCategory: 'Multi',
              oscWaveform: 'Multi Saw',
              oscCtrl: 48,
              filter: {
                on: true,
                type: 'LP12',
                freq: 36,
                res: 18,
                envAmt: 26,
                kbTrack: 1,
                drive: 0,
              },
              ampEnv: { attack: 42, decay: 100, release: 58, velocity: 1 },
            }),
            B: createDefaultSynthLayer('B', { enabled: false }),
            C: createDefaultSynthLayer('C', { enabled: false }),
          },
        }),
        effects: createBaseEffectsPayload({
          focusedChain: 'pianoA',
          chains: {
            ...baseFx.chains,
            pianoA: {
              ...createDefaultEffectChain(true),
              mod1: { on: true, type: 'A-Pan', rate: 36, amount: 52, clockSync: false },
              reverb: { on: true, type: 'Stage', tone: 'Normal', dryWet: 28 },
            },
          },
        }),
        morphs: {
          wheel: [
            { target: 'synth:A:level', start: 62, end: 96 },
            { target: 'synth:A:filterFreq', start: 36, end: 78 },
          ],
          controlPedal: [{ target: 'piano:A:level', start: 90, end: 60 }],
        },
        sceneII: { synthSectionOn: false, synthA: false },
      }),
    },

    // 1.5 Jazz Split B3/Pno (Split at C4 ±6 crossfade: Lower B3 Bass, Upper Grand Piano)
    {
      name: 'Jazz Split B3',
      patch: makePatch({
        piano: createBasePianoSection({
          sectionOn: true,
          layers: {
            A: { ...basePiano.layers.A, enabled: true, zone: { lowZone: 1, highZone: 1 } },
            B: { ...basePiano.layers.B, enabled: false, zone: { lowZone: 1, highZone: 1 } },
          },
        }),
        organ: createDefaultOrganSection({
          sectionOn: true,
          layers: {
            A: createDefaultOrganLayer('A', {
              enabled: true,
              model: 'B3 Bass',
              level: 84,
              zone: { lowZone: 0, highZone: 0 },
              drawbars: [8, 0, 6, 0, 0, 0, 0, 0, 0],
              vibChorusOn: false,
            }),
            B: createDefaultOrganLayer('B', { enabled: false }),
          },
        }),
        synth: createDefaultSynthSection({ sectionOn: false }),
        split: {
          enabled: true,
          points: {
            low: { active: false, note: 'C3', crossfade: 0 },
            mid: { active: true, note: 'C4', crossfade: 6 },
            high: { active: false, note: 'C5', crossfade: 0 },
          },
        },
        effects: createBaseEffectsPayload({ focusedChain: 'pianoA' }),
      }),
    },

    // 1.6 Vox & Farf Combo (Two distinct transistor organs layered on A and B)
    {
      name: 'Vox & Farf Combo',
      patch: makePatch({
        piano: createBasePianoSection({ sectionOn: false }),
        organ: createDefaultOrganSection({
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: createDefaultOrganLayer('A', {
              enabled: true,
              level: 80,
              model: 'Vox',
              drawbars: [6, 8, 6, 4, 5, 3, 2, 7, 5],
              vibChorusType: 'V2',
              vibChorusOn: true,
            }),
            B: createDefaultOrganLayer('B', {
              enabled: true,
              level: 66,
              model: 'Farf',
              drawbars: [0, 6, 8, 6, 7, 0, 6, 0, 6],
              vibChorusType: 'V1',
              vibChorusOn: false,
            }),
          },
        }),
        synth: createDefaultSynthSection({ sectionOn: false }),
        effects: createBaseEffectsPayload({
          focusedChain: 'organ',
          rotary: {
            on: true,
            organRouted: false,
            speed: 'Slow',
            stopMode: false,
            drive: 30,
            driveOn: false,
          },
          chains: {
            ...baseFx.chains,
            organ: {
              ...createDefaultEffectChain(true),
              ampEq: {
                on: true,
                type: 'Twin',
                drive: 34,
                bass: 52,
                mid: 56,
                midFreq: 55,
                treble: 58,
              },
              reverb: { on: true, type: 'Spring', tone: 'Normal', dryWet: 30 },
            },
          },
        }),
      }),
    },

    // 1.7 Cathedral Pipe (Pipe 1 + Pipe 2 with Cathedral Reverb)
    {
      name: 'Cathedral Pipe',
      patch: makePatch({
        piano: createBasePianoSection({ sectionOn: false }),
        organ: createDefaultOrganSection({
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: createDefaultOrganLayer('A', {
              enabled: true,
              level: 84,
              model: 'Pipe 1',
              drawbars: [7, 4, 8, 7, 5, 6, 3, 2, 4],
              vibChorusType: 'C2',
              vibChorusOn: true,
            }),
            B: createDefaultOrganLayer('B', {
              enabled: true,
              level: 62,
              model: 'Pipe 2',
              drawbars: [4, 2, 7, 8, 6, 7, 5, 4, 6],
              vibChorusType: 'C1',
              vibChorusOn: true,
            }),
          },
        }),
        synth: createDefaultSynthSection({ sectionOn: false }),
        effects: createBaseEffectsPayload({
          focusedChain: 'organ',
          rotary: {
            on: true,
            organRouted: false,
            speed: 'Slow',
            stopMode: false,
            drive: 20,
            driveOn: false,
          },
          chains: {
            ...baseFx.chains,
            organ: {
              ...createDefaultEffectChain(true),
              reverb: { on: true, type: 'Cathedral', tone: 'Normal', dryWet: 52 },
            },
          },
        }),
      }),
    },

    // 1.8 FM-H Bell Arp (FM 2-op + Arpeggiator synced to 124 BPM Master Clock)
    {
      name: 'FM-H Bell Arp',
      patch: makePatch({
        piano: createBasePianoSection({ sectionOn: false }),
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: createDefaultSynthLayer('A', {
              enabled: true,
              level: 86,
              oscCategory: 'FM-H',
              oscWaveform: 'FM 2-op',
              oscCtrl: 64,
              oscEnv: {
                attack: 2,
                decay: 36,
                release: 32,
                velocity: true,
                toPitch: false,
                amount: 76,
              },
              filter: {
                on: true,
                type: 'LP12',
                freq: 78,
                res: 18,
                envAmt: 20,
                kbTrack: 2,
                drive: 0,
              },
              ampEnv: { attack: 2, decay: 44, release: 38, velocity: 2 },
              arp: {
                run: true,
                kbHold: false,
                mode: 'Arp',
                rate: 56, // 1/8 note when synced
                clockSync: true,
                range: 2,
                gateEnv: 60,
                direction: 'Up',
              },
            }),
            B: createDefaultSynthLayer('B', { enabled: false }),
            C: createDefaultSynthLayer('C', { enabled: false }),
          },
        }),
        masterClock: { bpm: 124, kbSync: true },
        effects: createBaseEffectsPayload({
          focusedChain: 'synthA',
          chains: {
            ...baseFx.chains,
            synthA: {
              ...createDefaultEffectChain(true),
              delay: {
                on: true,
                tempo: 56,
                feedback: 42,
                dryWet: 32,
                filter: 'HP',
                pingPong: true,
                bpm: 124,
                clockSync: true,
              },
              reverb: { on: true, type: 'Hall', tone: 'Bright', dryWet: 36 },
            },
          },
        }),
      }),
    },

    // 2.1 Upright & Sync Split
    {
      name: 'Upright & Sync',
      patch: makePatch({
        piano: createBasePianoSection({
          sectionOn: true,
          layers: {
            A: {
              ...basePiano.layers.A,
              enabled: true,
              type: 'Upright',
              modelIndex: 0,
              zone: { lowZone: 0, highZone: 0 },
            },
            B: { ...basePiano.layers.B, enabled: false },
          },
        }),
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({
          sectionOn: true,
          layers: {
            A: createDefaultSynthLayer('A', {
              enabled: true,
              level: 80,
              zone: { lowZone: 1, highZone: 1 },
              oscCategory: 'Sync',
              oscWaveform: 'Sync Saw',
              oscCtrl: 58,
              oscEnv: {
                attack: 6,
                decay: 48,
                release: 30,
                velocity: true,
                toPitch: false,
                amount: 82,
              },
              filter: {
                on: true,
                type: 'LP24',
                freq: 64,
                res: 32,
                envAmt: 35,
                kbTrack: 1,
                drive: 2,
              },
            }),
            B: createDefaultSynthLayer('B', { enabled: false }),
            C: createDefaultSynthLayer('C', { enabled: false }),
          },
        }),
        split: {
          enabled: true,
          points: {
            low: { active: false, note: 'C3', crossfade: 0 },
            mid: { active: true, note: 'F4', crossfade: 0 },
            high: { active: false, note: 'C5', crossfade: 0 },
          },
        },
        effects: createBaseEffectsPayload({ focusedChain: 'synthA' }),
      }),
    },

    // 2.2 Wurli Tremolo
    {
      name: 'Wurli Tremolo',
      patch: makePatch({
        piano: createBasePianoSection({
          sectionOn: true,
          layers: {
            A: {
              ...basePiano.layers.A,
              enabled: true,
              type: 'Electric',
              modelIndex: 1,
              timbre: 'Mid',
              level: 92,
            },
            B: { ...basePiano.layers.B, enabled: false },
          },
        }),
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({ sectionOn: false }),
        effects: createBaseEffectsPayload({
          focusedChain: 'pianoA',
          chains: {
            ...baseFx.chains,
            pianoA: {
              ...createDefaultEffectChain(true),
              mod1: { on: true, type: 'Tremolo', rate: 48, amount: 58, clockSync: false },
              ampEq: {
                on: true,
                type: 'Small',
                drive: 36,
                bass: 54,
                mid: 52,
                midFreq: 48,
                treble: 52,
              },
              reverb: { on: true, type: 'Spring', tone: 'Normal', dryWet: 24 },
            },
          },
        }),
      }),
    },

    // 2.3 Triple Synth 4-Zone Split
    {
      name: 'Triple Synth 4Z',
      patch: makePatch({
        piano: createBasePianoSection({ sectionOn: false }),
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({
          sectionOn: true,
          focusedLayer: 'A',
          layers: {
            A: createDefaultSynthLayer('A', {
              enabled: true,
              level: 85,
              zone: { lowZone: 0, highZone: 0 },
              oscCategory: 'Pure',
              oscWaveform: 'Square',
              voice: { mode: 'Mono', priority: 'Low', glide: 25, unison: 0 },
            }),
            B: createDefaultSynthLayer('B', {
              enabled: true,
              level: 78,
              zone: { lowZone: 1, highZone: 2 },
              oscCategory: 'Multi',
              oscWaveform: 'Multi Saw 8ve',
              oscCtrl: 50,
            }),
            C: createDefaultSynthLayer('C', {
              enabled: true,
              level: 82,
              zone: { lowZone: 3, highZone: 3 },
              oscCategory: 'Super',
              oscWaveform: 'Super Square',
              oscCtrl: 60,
            }),
          },
        }),
        split: {
          enabled: true,
          points: {
            low: { active: true, note: 'C3', crossfade: 0 },
            mid: { active: true, note: 'C4', crossfade: 6 },
            high: { active: true, note: 'C5', crossfade: 0 },
          },
        },
        effects: createBaseEffectsPayload({ focusedChain: 'synthA' }),
      }),
    },

    // 2.4 Funk Clav & Mono Bass
    {
      name: 'Funk Clav & Bass',
      patch: makePatch({
        piano: createBasePianoSection({
          sectionOn: true,
          layers: {
            A: {
              ...basePiano.layers.A,
              enabled: true,
              type: 'Clav',
              modelIndex: 0,
              zone: { lowZone: 1, highZone: 1 },
            },
            B: { ...basePiano.layers.B, enabled: false },
          },
        }),
        organ: createDefaultOrganSection({ sectionOn: false }),
        synth: createDefaultSynthSection({
          sectionOn: true,
          layers: {
            A: createDefaultSynthLayer('A', {
              enabled: true,
              level: 88,
              zone: { lowZone: 0, highZone: 0 },
              oscCategory: 'Pure',
              oscWaveform: 'Pulse 33',
              voice: { mode: 'Legato', priority: 'Low', glide: 48, unison: 1 },
              filter: {
                on: true,
                type: 'LP24',
                freq: 38,
                res: 48,
                envAmt: 62,
                kbTrack: 1,
                drive: 2,
              },
            }),
            B: createDefaultSynthLayer('B', { enabled: false }),
            C: createDefaultSynthLayer('C', { enabled: false }),
          },
        }),
        split: {
          enabled: true,
          points: {
            low: { active: false, note: 'C3', crossfade: 0 },
            mid: { active: true, note: 'C4', crossfade: 0 },
            high: { active: false, note: 'C5', crossfade: 0 },
          },
        },
        effects: createBaseEffectsPayload({
          focusedChain: 'pianoA',
          chains: {
            ...baseFx.chains,
            pianoA: {
              ...createDefaultEffectChain(true),
              mod1: { on: true, type: 'A-Wah', rate: 62, amount: 74, clockSync: false },
              reverb: { on: true, type: 'Room', tone: 'Normal', dryWet: 18 },
            },
          },
        }),
      }),
    },
  ]

  const slots: ProgramSlot[] = []
  for (let i = 0; i < 32; i++) {
    const def = factoryDefs[i]
    if (def) {
      slots.push({ index: i, name: def.name, patch: def.patch })
    } else {
      slots.push({
        index: i,
        name: `Init ${formatProgramSlotCode(i)}`,
        patch: factoryDefs[0].patch,
      })
    }
  }
  return slots
}

export function createInitialLiveSlots(
  factoryPrograms: readonly ProgramSlot[],
): readonly LiveSlot[] {
  const slots: LiveSlot[] = []
  for (let i = 0; i < 8; i++) {
    const source = factoryPrograms[i] ?? factoryPrograms[0]
    slots.push({
      index: i,
      name: `Live ${i + 1} (${source.name})`,
      patch: source.patch,
    })
  }
  return slots
}

export function patchesEqual(a: ProgramPatch, b: ProgramPatch): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function serializeProgramBank(bank: PersistedProgramBank): string {
  return JSON.stringify(bank)
}

export function deserializeProgramBank(raw: string | null): PersistedProgramBank | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedProgramBank>
    if (
      parsed.version !== 3 ||
      !Array.isArray(parsed.programs) ||
      parsed.programs.length !== 32 ||
      !Array.isArray(parsed.liveSlots) ||
      parsed.liveSlots.length !== 8
    ) {
      return null
    }
    return parsed as PersistedProgramBank
  } catch {
    return null
  }
}

export function loadOrInitProgramBank(storage: StorageAdapter = browserStorageAdapter): PersistedProgramBank {
  const loaded = deserializeProgramBank(storage.getItem(PROGRAM_STORAGE_KEY))
  if (loaded) return loaded
  const programs = createFactoryProgramSlots()
  const liveSlots = createInitialLiveSlots(programs)
  return { version: 3, programs, liveSlots }
}

export function persistProgramBank(
  bank: PersistedProgramBank,
  storage: StorageAdapter = browserStorageAdapter,
): void {
  storage.setItem(PROGRAM_STORAGE_KEY, serializeProgramBank(bank))
}

export interface UnsupportedControlEntry {
  readonly id: string
  readonly label: string
  readonly spec: string
  readonly reason: string
}

/**
 * Complete audit list of spec-excluded panel controls that remain visibly movable/pressable
 * and honestly unsupported per the assigned Phase 3 specs.
 */
export const UNSUPPORTED_CONTROLS_AUDIT: readonly UnsupportedControlEntry[] = [
  {
    id: 'program-morph-at',
    label: 'Morph Assign Aftertouch (A.T.)',
    spec: 'nord-stage-4.programs.json',
    reason: 'Browser keyboards have no channel/poly aftertouch; spec-excluded.',
  },
  {
    id: 'program-preset-organ',
    label: 'Preset Library Organ',
    spec: 'nord-stage-4.programs.json / nord-stage-4.organ.json',
    reason: 'Per-section preset library is cut benchmark-wide.',
  },
  {
    id: 'program-preset-piano',
    label: 'Preset Library Piano',
    spec: 'nord-stage-4.programs.json / nord-stage-4.piano.json',
    reason: 'Per-section preset library is cut benchmark-wide.',
  },
  {
    id: 'program-preset-synth',
    label: 'Preset Library Synth',
    spec: 'nord-stage-4.programs.json / nord-stage-4.synth.json',
    reason: 'Per-section preset library is cut benchmark-wide.',
  },
  {
    id: 'program-section-edit',
    label: 'Section Edit / Layer Init',
    spec: 'nord-stage-4.programs.json',
    reason: 'Section Edit and Layer Init are explicitly excluded in programs spec.',
  },
  {
    id: 'program-mon-copy',
    label: 'Monitor / Copy / Paste / Swap',
    spec: 'nord-stage-4.programs.json',
    reason: 'Monitor/Copy/Paste/Swap and Num Pad mode are explicitly excluded in programs spec.',
  },
  {
    id: 'organ-preset',
    label: 'Organ Preset / Drawbar Sync',
    spec: 'nord-stage-4.organ.json',
    reason: 'Preset/Drawbar Live modes and physical drawbar sync are excluded; virtual drawbars always reflect live values.',
  },
  {
    id: 'synth-mode (Samples / Extern)',
    label: 'Synth Samples & Extern Modes',
    spec: 'nord-stage-4.synth.json',
    reason: 'Analog mode (Pure/Sync/Multi/Super) + FM-H are live; Extern MIDI-out and sample library downloads are excluded.',
  },
  {
    id: 'program-btn-1..8 (Shift Menus)',
    label: 'System / Sound / Organize / Aux KB / Output / Pedal / MIDI / Extern Menus',
    spec: 'nord-stage-4.programs.json',
    reason: 'All hardware Shift-menus, banks beyond 1, external MIDI clock sync, and memory protection are excluded.',
  },
  {
    id: 'fx-variations / rotary-close-mic',
    label: 'FX Per-Type Variations, Reverb Chorale, Delay Feedback FX/Analog, Rotary Close Mic',
    spec: 'nord-stage-4.effects.json',
    reason: 'Excluded per effects spec; Rotary Drive/Organ routing, Stop, and Slow/Fast acceleration are active.',
  },
]
