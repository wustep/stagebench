import {
  AmpType,
  ArpDirection,
  ArpMode,
  Chain,
  ENV_STEPS,
  FilterType,
  LfoDest,
  LfoWave,
  Mod1Type,
  Mod2Type,
  NotePriority,
  OrganModel,
  ReverbType,
  SynthWave,
  Timbre,
  VibType,
  VibratoMode,
  VoiceMode,
} from '../audio/dsp/params'
import {
  LIVE_COUNT,
  PROGRAM_COUNT,
  PROGRAMS_PER_PAGE,
  createInitialState,
  extractProgram,
  sceneEnables,
  type ProgramData,
  type StageState,
} from '../state/model'

/**
 * The factory content: one bank of 32 programs and the 8 Live slots.
 *
 * Sixteen of the programs are set up by hand to show the instrument — pianos, each organ
 * model, synth leads, pads and arpeggios, splits, layers, Layer Scenes, and morphs. The other
 * sixteen are plainly named "Init" programs: the start-up piano, ready to be overwritten.
 * None of this is Nord factory content; the names are this project's own.
 */

type Setup = (state: StageState) => void

function build(name: string, setup: Setup): ProgramData {
  const state = createInitialState()
  state.name = name
  // Factory programs start from silence in every section and switch on what they use.
  state.piano.on = false
  setup(state)
  // Unless a program sets up Layer Scene II itself, both scenes start out the same.
  if (!customScene.has(setup)) state.scene.other = sceneEnables(state)
  return extractProgram(state)
}

const customScene = new WeakSet<Setup>()
function withScene(setup: Setup): Setup {
  customScene.add(setup)
  return setup
}

const organOn = (state: StageState, model: number, drawbars: number[]) => {
  state.organ.on = true
  state.organ.focus = 0
  state.organ.layers[0].model = model
  state.organ.layers[0].drawbars = drawbars
  state.ui.section = 'organ'
  state.fx.focus = Chain.Organ
}

const synthOn = (state: StageState) => {
  state.synth.on = true
  state.synth.focus = 0
  state.fx.focus = Chain.SynthA
  return state.synth.layers[0]
}

const pianoOn = (state: StageState, type = 0) => {
  state.piano.on = true
  state.piano.layers[0].type = type
  state.fx.focus = Chain.PianoA
  return state.piano.layers[0]
}

const reverb = (state: StageState, chain: number, type: number, mix: number) => {
  state.fx.chains[chain].reverb = { on: true, type, tone: 0, mix }
}

const FACTORY: ReadonlyArray<readonly [string, Setup]> = [
  // 1.1 is exactly the start-up state.
  ['Grand Piano', (state) => void pianoOn(state)],
  [
    'Tonewheel B3',
    (state) => {
      organOn(state, OrganModel.B3, [8, 8, 8, 0, 0, 0, 0, 0, 0])
      state.organ.vibType = VibType.C3
      state.organ.layers[0].perc = { on: true, soft: false, fast: true, third: true }
      state.rotary.organ = true
      state.rotary.drive = 3
      // The wheel pulls out the upper drawbars; the pedal spins the rotor up.
      state.morph.wheel = [
        { path: 'organ.layers.0.drawbars.3', to: 6 },
        { path: 'organ.layers.0.drawbars.8', to: 7 },
      ]
      state.morph.pedal = [{ path: 'rotary.speed', to: 1 }]
    },
  ],
  [
    'Saw Lead',
    (state) => {
      const layer = synthOn(state)
      layer.wave = SynthWave.Saw
      layer.filter = { on: true, type: FilterType.LP24, freq: 6.2, res: 3, envAmt: 3, track: 3, drive: 1 }
      layer.filterEnv = { attack: 0, decay: 22, release: 16, velocity: true }
      layer.ampEnv = { attack: 2, decay: ENV_STEPS, release: 14, velocity: 2 }
      layer.voice = { mode: VoiceMode.Legato, priority: NotePriority.Last, glide: 3.5, unison: 1, vibrato: VibratoMode.Wheel, vibRate: 5.5, vibAmount: 6 }
      state.fx.chains[Chain.SynthA].delay = { ...state.fx.chains[Chain.SynthA].delay, on: true, mix: 2.5, feedback: 4 }
    },
  ],
  [
    'Bass/Piano Split',
    (state) => {
      pianoOn(state).zone = [2, 3]
      const bass = synthOn(state)
      bass.zone = [0, 1]
      bass.wave = SynthWave.Square
      bass.octave = -1
      bass.filter = { on: true, type: FilterType.LP24, freq: 4.2, res: 2.5, envAmt: 4, track: 2, drive: 2 }
      bass.filterEnv = { attack: 0, decay: 18, release: 12, velocity: false }
      bass.ampEnv = { attack: 1, decay: ENV_STEPS, release: 10, velocity: 1 }
      bass.voice = { ...bass.voice, mode: VoiceMode.Mono, priority: NotePriority.Low, glide: 0, unison: 0 }
      state.split.on = true
      state.fx.focus = Chain.PianoA
    },
  ],
  [
    'Piano + Pad',
    (state) => {
      pianoOn(state)
      const pad = synthOn(state)
      pad.level = 55
      pad.wave = SynthWave.SuperSaw
      pad.ctrl = 5.5
      pad.filter = { on: true, type: FilterType.LP12, freq: 5.6, res: 1.5, envAmt: 1.5, track: 2, drive: 0 }
      pad.filterEnv = { attack: 26, decay: ENV_STEPS, release: 28, velocity: false }
      pad.ampEnv = { attack: 27, decay: ENV_STEPS, release: 28, velocity: 1 }
      pad.voice = { ...pad.voice, unison: 0 }
      reverb(state, Chain.SynthA, ReverbType.Hall, 5)
      reverb(state, Chain.PianoA, ReverbType.Room, 2.5)
      state.fx.focus = Chain.PianoA
    },
  ],
  [
    'Reed EP Tremolo',
    (state) => {
      const layer = pianoOn(state, 2)
      layer.timbre = Timbre.Mid
      state.fx.chains[Chain.PianoA].mod1 = { on: true, type: Mod1Type.Tremolo, rate: 5.6, amount: 6, sync: false }
      state.fx.chains[Chain.PianoA].amp = { on: true, type: AmpType.Small, drive: 3, bass: 2, mid: 3, freq: 5, treble: 1 }
      reverb(state, Chain.PianoA, ReverbType.Spring, 3)
    },
  ],
  [
    'Vox Combo',
    (state) => {
      organOn(state, OrganModel.Vox, [0, 8, 6, 4, 6, 0, 0, 3, 8])
      state.organ.vibType = VibType.V2
      state.organ.layers[0].vibOn = true
      state.fx.chains[Chain.Organ].amp = { on: true, type: AmpType.JC, drive: 2, bass: 0, mid: 2, freq: 5.5, treble: 3 }
    },
  ],
  [
    'Clock Arp',
    (state) => {
      const layer = synthOn(state)
      layer.wave = SynthWave.Pulse33
      layer.filter = { on: true, type: FilterType.LP24, freq: 5, res: 4.5, envAmt: 4.5, track: 3, drive: 0 }
      layer.filterEnv = { attack: 0, decay: 15, release: 12, velocity: false }
      layer.ampEnv = { attack: 0, decay: 20, release: 12, velocity: 1 }
      layer.voice = { ...layer.voice, unison: 0 }
      // Rate 5.0 on a synced knob is the 1/8 subdivision; the delay echoes in 1/8 triplets.
      layer.arp = { run: true, mode: ArpMode.Arp, rate: 5, range: 4.2, direction: ArpDirection.UpDown, sync: true, kbSync: true }
      state.clock.bpm = 124
      state.fx.chains[Chain.SynthA].delay = { ...state.fx.chains[Chain.SynthA].delay, on: true, sync: true, tempo: 6.7, mix: 3.2, feedback: 5 }
    },
  ],
  [
    'Farf Compact',
    (state) => {
      organOn(state, OrganModel.Farf, [0, 8, 8, 0, 8, 8, 0, 8, 0])
      state.organ.vibType = VibType.V1
      state.organ.layers[0].vibOn = true
      reverb(state, Chain.Organ, ReverbType.Spring, 3)
    },
  ],
  [
    'Pipe Organ',
    (state) => {
      organOn(state, OrganModel.Pipe1, [6, 8, 6, 6, 4, 3, 4, 0, 2])
      state.organ.layers[0].vibOn = false
      reverb(state, Chain.Organ, ReverbType.Cathedral, 5.5)
    },
  ],
  [
    'Sync Sweep',
    (state) => {
      const layer = synthOn(state)
      layer.wave = SynthWave.SyncSaw
      layer.ctrl = 2
      layer.oscEnv = { attack: 0, decay: 26, release: 16, amount: 6, velocity: false, toPitch: false }
      layer.filter = { on: true, type: FilterType.LP12, freq: 8, res: 1, envAmt: 0, track: 2, drive: 0 }
      layer.voice = { ...layer.voice, mode: VoiceMode.Mono, glide: 2, unison: 0 }
      state.morph.wheel = [{ path: 'synth.layers.0.ctrl', to: 9 }]
    },
  ],
  [
    'FM Bells',
    (state) => {
      const layer = synthOn(state)
      layer.wave = SynthWave.Fm2Op
      layer.ctrl = 2
      layer.oscEnv = { attack: 0, decay: 22, release: 20, amount: 5, velocity: true, toPitch: false }
      layer.filter = { ...layer.filter, on: false }
      layer.ampEnv = { attack: 0, decay: 30, release: 26, velocity: 2 }
      layer.voice = { ...layer.voice, unison: 0 }
      reverb(state, Chain.SynthA, ReverbType.Hall, 4.5)
    },
  ],
  [
    'Upright+Strings',
    (state) => {
      pianoOn(state, 1)
      const strings = synthOn(state)
      strings.level = 45
      strings.wave = SynthWave.MultiSaw
      strings.ctrl = 4
      strings.filter = { on: true, type: FilterType.LP12, freq: 6, res: 0.5, envAmt: 0, track: 2, drive: 0 }
      strings.ampEnv = { attack: 24, decay: ENV_STEPS, release: 26, velocity: 1 }
      strings.voice = { ...strings.voice, unison: 1 }
      state.fx.chains[Chain.SynthA].mod2 = { on: true, type: Mod2Type.Ensemble, rate: 4, amount: 6 }
      // The pedal swells the strings in from nothing.
      strings.level = 0
      state.morph.pedal = [{ path: 'synth.layers.0.level', to: 70 }]
      state.fx.focus = Chain.PianoA
    },
  ],
  [
    'Three Zone Split',
    (state) => {
      organOn(state, OrganModel.B3Bass, [8, 6, 0, 0, 0, 0, 0, 0, 0])
      state.organ.layers[0].zone = [0, 1]
      state.organ.layers[0].vibOn = false
      pianoOn(state).zone = [2, 2]
      const lead = synthOn(state)
      lead.zone = [3, 3]
      lead.wave = SynthWave.Triangle
      lead.filter = { ...lead.filter, freq: 7, envAmt: 1 }
      lead.voice = { ...lead.voice, unison: 0 }
      state.split.on = true
      state.split.points = [
        { on: false, note: 48, xfade: 0 },
        { on: true, note: 53, xfade: 0 },
        { on: true, note: 72, xfade: 6 },
      ]
      state.ui.section = 'piano'
      state.fx.focus = Chain.PianoA
    },
  ],
  [
    'Two Scenes',
    withScene((state) => {
      // Layer Scene I: the piano alone. Layer Scene II: organ and pad, piano off.
      pianoOn(state)
      organOn(state, OrganModel.B3, [8, 8, 6, 0, 0, 0, 0, 0, 4])
      state.organ.on = false
      state.rotary.organ = true
      const pad = synthOn(state)
      pad.wave = SynthWave.SuperSquare
      pad.ctrl = 4
      pad.level = 50
      pad.filter = { on: true, type: FilterType.LP12, freq: 5, res: 1, envAmt: 0, track: 2, drive: 0 }
      pad.ampEnv = { attack: 22, decay: ENV_STEPS, release: 24, velocity: 1 }
      pad.voice = { ...pad.voice, unison: 0 }
      state.synth.on = false
      state.ui.section = 'piano'
      state.fx.focus = Chain.PianoA
      const second = sceneEnables(state)
      second.piano.on = false
      second.organ.on = true
      second.synth.on = true
      state.scene.other = second
    }),
  ],
  [
    'Gated Wobble',
    (state) => {
      const layer = synthOn(state)
      layer.wave = SynthWave.MultiSawOct
      layer.ctrl = 3
      layer.filter = { on: true, type: FilterType.BP, freq: 5.5, res: 5, envAmt: 0, track: 2, drive: 1 }
      layer.lfo = { wave: LfoWave.Triangle, dest: LfoDest.Filter, rate: 3.3, amount: 5, sync: true }
      layer.voice = { ...layer.voice, unison: 1 }
      layer.arp = { run: true, mode: ArpMode.Gate, rate: 8.3, range: 7, direction: ArpDirection.Up, sync: true, kbSync: true }
      state.clock.bpm = 110
    },
  ],
]

function initProgram(slot: number): ProgramData {
  const state = createInitialState()
  state.name = `Init ${Math.floor(slot / PROGRAMS_PER_PAGE) + 1}.${(slot % PROGRAMS_PER_PAGE) + 1}`
  return extractProgram(state)
}

/** The 32 factory programs, in slot order. */
export function factoryPrograms(): ProgramData[] {
  return Array.from({ length: PROGRAM_COUNT }, (_, slot) => {
    const entry = FACTORY[slot]
    return entry ? build(entry[0], entry[1]) : initProgram(slot)
  })
}

/** The 8 Live slots start as copies of the first page. */
export function factoryLive(): ProgramData[] {
  return factoryPrograms().slice(0, LIVE_COUNT)
}

/** How many of the 32 slots hold a hand-made factory program rather than an Init program. */
export const FACTORY_PROGRAM_COUNT = FACTORY.length
