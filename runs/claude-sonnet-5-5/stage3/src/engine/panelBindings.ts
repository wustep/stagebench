import { MODELS, PIANO_TYPES, TIMBRES, softReleaseAvailable, stringResAvailable } from '../audio/library/catalog'
import { tempoFromSeconds } from '../audio/params'
import type { Scheduler } from '../audio/types'
import { CONTROLS } from '../hardware/layout'
import type { ControlAction, HardwareStore } from '../hardware/store'
import { stepZone } from './edits'
import { MORPH_CONTROL_IDS, destForControl } from './controlMap'
import { DIVISIONS, divisionFromKnob, knobFromDivision } from './synth'
import { assignMorph, assignmentFor, morphDest, morphRange } from './morph'
import { organBinder, ORGAN_LAYER_BUTTON } from './bind/organ'
import { programBinder } from './bind/program'
import { synthBinder, SYNTH_LAYER_BUTTON } from './bind/synth'
import { octaveText, shortestDelta, type Binder, type BindCtx } from './bind/types'
import type { ProgramSystem } from './programs'
import { createUiModeStore, type UiModeStore } from './uiMode'
import { pressOrganLayer, pressSynthLayer } from './edits'
import {
  AMP_TYPES,
  DELAY_FILTERS,
  KB_TOUCH_ORDER,
  LAYER_IDS,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  CHAIN_IDS,
  cycleAcoustics,
  cycleTimbre,
  editFx,
  focusedFx,
  focusedLayer,
  getChain,
  pressLayer,
  pressOrganFxFocus,
  pressPianoFxFocus,
  pressSynthFxFocus,
  setDynComp,
  setEffectsOn,
  setGlobal,
  setGroup,
  setKbTouch,
  setLevel,
  setMaster,
  setModelFromDetent,
  setPianoOn,
  setPitchBend,
  setPitchStickRouting,
  setRotary,
  setSoftRelease,
  setStringRes,
  setSustPed,
  setType,
  setUnison,
  shiftOctave,
  type EngineState,
  type EngineStore,
  type FxSection,
  type FxUnit,
  type GlobalUnit,
  type LayerId,
} from './state'
import { SYNTH_LAYER_IDS, type SynthLayerId } from './synth'
import { zoneRangeLabel, type ZoneRange } from './zones'

/**
 * Binds the panel (presentation store) to the canonical instrument state for every control that is functional:
 * the Piano, Organ and Synth sections, the Layer Effects section, the Program/performance section, Master Level, the rotary
 * speaker, the wheels and the pitch stick.
 *
 *  panel → state : button presses (`onAction`, with Shift) and knob/fader/encoder moves become canonical edits
 *  state → panel : after every change, `syncPanel` writes the canonical values (and LEDs) back, so what the panel
 *                  shows is always what the audio does — a refused edit simply snaps back
 *
 * Controls the specs list as excluded keep their Phase 1 behaviour (they move and light) and say so in their accessible
 * description. There is no third kind: `CONTROL_AUDIT` (tested) puts every control in exactly one of the two.
 */

export const HOLD_MS = 500
const TAP_WINDOW_MS = 2000

type PianoLayerButton = { section: 'piano' | 'organ' | 'synth'; layer: string }
const LAYER_BUTTONS: Record<string, PianoLayerButton> = {
  'piano-layer-a-onoff': { section: 'piano', layer: 'A' },
  'piano-layer-b-onoff': { section: 'piano', layer: 'B' },
  [ORGAN_LAYER_BUTTON.A]: { section: 'organ', layer: 'A' },
  [ORGAN_LAYER_BUTTON.B]: { section: 'organ', layer: 'B' },
  [SYNTH_LAYER_BUTTON.A]: { section: 'synth', layer: 'A' },
  [SYNTH_LAYER_BUTTON.B]: { section: 'synth', layer: 'B' },
  [SYNTH_LAYER_BUTTON.C]: { section: 'synth', layer: 'C' },
}
const LAYER_BUTTON: Record<LayerId, string> = { A: 'piano-layer-a-onoff', B: 'piano-layer-b-onoff' }
const LEVEL_FADER: Record<LayerId, string> = { A: 'piano-level-a', B: 'piano-level-b' }

/** controls whose behaviour is real: bound to the canonical state (Piano, Effects, Master, Organ, Synth, Program, performance) */
const PHASE2_IDS = [
  'master-level',
  'pitch-stick',
  'rotary-speed',
  'rotary-drive',
  'piano-on',
  ...Object.values(LAYER_BUTTON),
  ...Object.values(LEVEL_FADER),
  'piano-select',
  'piano-model-dial',
  'piano-kb-touch',
  'piano-dyn-comp',
  'piano-unison',
  'piano-timbre',
  'piano-soft-release',
  'piano-string-res',
  'piano-acoustics',
  'piano-sustain-pedal',
  'piano-pitch-stick',
  'piano-octave-down',
  'piano-octave-up',
  'effects-on',
  'effects-focus-piano',
  'effects-focus-organ',
  'effects-focus-synth',
  'fx-mod1-rate',
  'fx-mod1-amount',
  'fx-mod1-type',
  'fx-mod1-on',
  'fx-mod2-rate',
  'fx-mod2-amount',
  'fx-mod2-type',
  'fx-mod2-on',
  'fx-amp-drive',
  'fx-amp-frequency',
  'fx-eq-bass',
  'fx-eq-mid',
  'fx-eq-treble',
  'fx-amp-model',
  'fx-amp-on',
  'fx-delay-tempo',
  'fx-delay-feedback',
  'fx-delay-dry-wet',
  'fx-delay-filter',
  'fx-delay-ping-pong',
  'fx-delay-tap',
  'fx-delay-on',
  'fx-delay-global',
  'fx-comp-amount',
  'fx-comp-fast',
  'fx-comp-on',
  'fx-comp-global',
  'fx-comp-active',
  'fx-reverb-type',
  'fx-reverb-dry-wet',
  'fx-reverb-bright',
  'fx-reverb-dark',
  'fx-reverb-on',
  'fx-reverb-global',
]

/** Controls the specs list as excluded: they move and light, and do nothing. Each maps to the spec line that excludes it. */
export const EXCLUDED_REASONS: Readonly<Record<string, string>> = {
  'piano-ped-noise': 'piano spec: pedal noise and half-pedaling are excluded',
  'fx-delay-effect': 'effects spec: delay feedback-loop effects (Chor/Vibe/Ens/Flam/Space) are excluded',
  'fx-delay-variation': 'effects spec: per-type Variations are excluded',
  'fx-delay-analog': 'effects spec: delay Analog mode is excluded',
  'fx-reverb-variation': 'effects spec: per-type Variations and Reverb Chorale are excluded',
  'rotary-close-mic': 'effects spec: rotary close mic and stop angle are excluded',
  'organ-preset-sync': 'organ spec: Preset/Drawbar Live modes and drawbar sync are excluded',
  'program-morph-at': 'programs spec: aftertouch as a morph source is excluded',
  'program-pedal-tap': 'programs spec: external MIDI clock sync and pedal tap are excluded',
  'program-library-organ': 'programs spec: the preset library is excluded',
  'program-library-piano': 'programs spec: the preset library is excluded',
  'program-library-synth': 'programs spec: the preset library is excluded',
  'program-section-edit': 'programs spec: Section Edit and Layer Init are excluded',
  'program-copy': 'programs spec: Monitor/Copy/Paste/Swap are excluded',
  'synth-exclude': 'synth spec: per-layer KB Hold exclude is excluded',
  'synth-keep-edits': 'synth spec: the synth preset library (Keep Edits) is excluded',
  'synth-arp-pattern': 'synth spec: arpeggiator pattern editing is excluded',
  'synth-arp-group': 'synth spec: Arp Group mode is excluded',
  'synth-arp-group-rocker': 'synth spec: Arp Group mode is excluded',
  'synth-lfo-group': 'synth spec: LFO Group mode is excluded',
  'synth-filter-group': 'synth spec: Filter Group mode is excluded',
}
export const EXCLUDED_IDS: ReadonlySet<string> = new Set(Object.keys(EXCLUDED_REASONS))

const BINDERS = () => [organBinder(), synthBinder(), programBinder()]
const binderIds = BINDERS().flatMap((b) => [...b.ids])

/** controls whose behaviour is real */
export const FUNCTIONAL_IDS: ReadonlySet<string> = new Set([...PHASE2_IDS, ...binderIds])

/** every control is either functional or spec-excluded; nothing is in between (checked by tests) */
export const CONTROL_AUDIT: Readonly<Record<string, 'functional' | 'unsupported'>> = Object.fromEntries(CONTROLS.map((c) => [c.id, EXCLUDED_IDS.has(c.id) ? 'unsupported' : 'functional']))

/** controls that work but only partly: what is not built, stated on the control */
export const PARTIAL_NOTES: Readonly<Record<string, string>> = {
  'synth-mode': 'Analog is the only mode built: Samples is optional and not built, Extern is excluded; the selector stays on Analog',
}

const CONTINUOUS: Record<string, (s: EngineState, v: number, ctx: BindCtx) => EngineState> = {
  'master-level': (s, v) => setMaster(s, v),
  'pitch-stick': (s, v) => setPitchBend(s, (v - 0.5) * 2),
  'rotary-drive': (s, v) => setRotary(s, { drive: v }),
  'piano-level-a': (s, v) => setLevel(s, 'A', v),
  'piano-level-b': (s, v) => setLevel(s, 'B', v),
  'piano-model-dial': (s, v) => setModelFromDetent(s, v),
  'fx-mod1-rate': (s, v, ctx) => editFx(s, 'mod1', ctx.shiftHeld() ? { sync: true, division: divisionFromKnob(v) } : { sync: false, rate: v }),
  'fx-mod1-amount': (s, v) => editFx(s, 'mod1', { amount: v }),
  'fx-mod2-rate': (s, v) => editFx(s, 'mod2', { rate: v }),
  'fx-mod2-amount': (s, v) => editFx(s, 'mod2', { amount: v }),
  'fx-amp-drive': (s, v) => editFx(s, 'amp', { drive: v }),
  'fx-amp-frequency': (s, v) => editFx(s, 'amp', { freq: v }),
  'fx-eq-bass': (s, v) => editFx(s, 'amp', { bass: v }),
  'fx-eq-mid': (s, v) => editFx(s, 'amp', { mid: v }),
  'fx-eq-treble': (s, v) => editFx(s, 'amp', { treble: v }),
  'fx-delay-tempo': (s, v, ctx) => editFx(s, 'delay', ctx.shiftHeld() ? { sync: true, division: divisionFromKnob(v) } : { sync: false, tempo: v }),
  'fx-delay-feedback': (s, v) => editFx(s, 'delay', { feedback: v }),
  'fx-delay-dry-wet': (s, v) => editFx(s, 'delay', { dryWet: v }),
  'fx-comp-amount': (s, v) => editFx(s, 'comp', { amount: v }),
  'fx-reverb-dry-wet': (s, v) => editFx(s, 'reverb', { dryWet: v }),
}

/** unit "on" buttons and the global-capable ones (Shift + On toggles global mode) */
const UNIT_ON: Record<string, FxUnit> = {
  'fx-mod1-on': 'mod1',
  'fx-mod2-on': 'mod2',
  'fx-amp-on': 'amp',
  'fx-delay-on': 'delay',
  'fx-comp-on': 'comp',
  'fx-reverb-on': 'reverb',
}
const GLOBAL_OF: Record<string, GlobalUnit> = { 'fx-delay-on': 'delay', 'fx-comp-on': 'comp', 'fx-reverb-on': 'reverb', 'fx-delay-global': 'delay', 'fx-comp-global': 'comp', 'fx-reverb-global': 'reverb' }

const sectionOfControl = (id: string): 'piano' | 'organ' | 'synth' | null => (id.startsWith('piano-') ? 'piano' : id.startsWith('organ-') ? 'organ' : id.startsWith('synth-') ? 'synth' : null)

// ---------------------------------------------------------------------------------------------------------------
// state → panel
// ---------------------------------------------------------------------------------------------------------------
export interface SyncExtras {
  ui?: UiModeStore
}

/** write every bound control from the canonical state (idempotent: the store ignores unchanged values) */
export function syncPanel(store: HardwareStore, s: EngineState, extras: SyncExtras = {}): void {
  const layer = focusedLayer(s)
  const fx = focusedFx(s)
  const both = LAYER_IDS.every((id) => s.layers[id].enabled)
  const set = (id: string, v: number) => store.set(id, v)
  const on = (id: string, v: boolean) => store.set(id, v ? 1 : 0)

  set('master-level', s.master)
  set('pitch-stick', (s.pitchBend + 1) / 2)
  on('piano-on', s.pianoOn)
  for (const id of LAYER_IDS) {
    on(LAYER_BUTTON[id], s.layers[id].enabled)
    store.patch(LAYER_BUTTON[id], { focused: both && s.focus === id ? true : undefined, note: `${s.focus === id ? `Layer ${id} has the focus${both ? '' : '; it is the only active layer'}. ` : ''}Tap: focus or switch to this layer. Hold half a second: turn it off. Shift+press, or press both layer buttons together: add it.` })
    set(LEVEL_FADER[id], s.layers[id].level)
  }

  // focused-layer controls
  set('piano-select', PIANO_TYPES.indexOf(layer.type))
  const count = MODELS[layer.type].length
  const index = layer.models[layer.type]
  if (store.get('piano-model-dial').value % count !== index) set('piano-model-dial', index)
  store.patch('piano-model-dial', { note: `${MODELS[layer.type][index].name}, model ${index + 1} of ${count}` })
  set('piano-kb-touch', KB_TOUCH_ORDER.indexOf(layer.kbTouch))
  set('piano-dyn-comp', layer.dynComp)
  set('piano-unison', layer.unison)
  set('piano-timbre', TIMBRES.indexOf(layer.timbre))
  on('piano-soft-release', layer.softRelease)
  store.patch('piano-soft-release', { note: softReleaseAvailable(layer.type) ? undefined : 'Unavailable for Clav sounds' })
  on('piano-string-res', layer.stringRes)
  store.patch('piano-string-res', { note: stringResAvailable(layer.type) ? undefined : 'Unavailable: Grand and Upright only' })
  on('piano-sustain-pedal', layer.sustPed)
  on('piano-pitch-stick', layer.pitchStick)
  const octave = `Layer ${s.focus} octave ${octaveText(layer.octave)}, ${zoneRangeLabel(s.zones[`piano.${s.focus}`])}. Shift+press, or hold Split to edit zones: moves the KB zone range`
  store.patch('piano-octave-down', { note: octave })
  store.patch('piano-octave-up', { note: octave })

  // effects
  on('effects-on', s.effectsOn)
  const group = s.group
  const pianoFx = s.fxSection === 'piano'
  store.setIndicator('led-piano-fx-focus', pianoFx)
  store.setIndicator('led-organ-fx-focus', s.fxSection === 'organ')
  store.setIndicator('led-synth-fx-focus', s.fxSection === 'synth')
  store.setIndicator('led-fx-focus-piano-a', pianoFx && (group || s.fxFocus === 'A'))
  store.setIndicator('led-fx-focus-piano-b', pianoFx && (group || s.fxFocus === 'B'))
  store.patch('effects-focus-piano', { note: `Piano effects focus${pianoFx ? '' : ' (not focused)'}: ${group ? 'group, layers A and B share one chain' : `layer ${s.fxFocus}`}. Tap to focus, then to swap A/B. Shift or long press toggles group mode` })
  set('effects-focus-organ', s.fxSection === 'organ' ? 1 : 0)
  store.patch('effects-focus-organ', { note: `Organ effects focus${s.fxSection === 'organ' ? '' : ' (not focused)'}: layers A and B share one chain. Shift+press: all effects off/on` })
  set('effects-focus-synth', s.fxSection !== 'synth' ? 3 : s.synthGroup ? 4 : SYNTH_LAYER_IDS.indexOf(s.synthFxFocus))
  store.patch('effects-focus-synth', { note: `Synth effects focus${s.fxSection === 'synth' ? '' : ' (not focused)'}: ${s.synthGroup ? 'group, layers A, B and C share one chain' : `layer ${s.synthFxFocus}`}. Tap to focus, then to step A, B, C. Shift or long press toggles group mode` })

  set('fx-mod1-rate', fx.mod1.sync ? knobFromDivision(fx.mod1.division) : fx.mod1.rate)
  store.patch('fx-mod1-rate', { note: fx.mod1.sync ? `Synced to the master clock: ${DIVISIONS[fx.mod1.division].name} at ${s.clock.bpm} BPM (LFO types only). Turn without Shift for a free rate` : 'Free rate. Shift+turn syncs to the master clock' })
  store.setIndicator('led-fx-mod1-clk', fx.mod1.sync)
  set('fx-mod1-amount', fx.mod1.amount)
  set('fx-mod1-type', MOD1_TYPES.indexOf(fx.mod1.type))
  on('fx-mod1-on', fx.mod1.on)
  set('fx-mod2-rate', fx.mod2.rate)
  set('fx-mod2-amount', fx.mod2.amount)
  set('fx-mod2-type', MOD2_TYPES.indexOf(fx.mod2.type))
  on('fx-mod2-on', fx.mod2.on)
  set('fx-amp-drive', fx.amp.drive)
  set('fx-amp-frequency', fx.amp.freq)
  set('fx-eq-bass', fx.amp.bass)
  set('fx-eq-mid', fx.amp.mid)
  set('fx-eq-treble', fx.amp.treble)
  set('fx-amp-model', AMP_TYPES.indexOf(fx.amp.type))
  on('fx-amp-on', fx.amp.on)
  set('fx-delay-tempo', fx.delay.sync ? knobFromDivision(fx.delay.division) : fx.delay.tempo)
  store.patch('fx-delay-tempo', { note: fx.delay.sync ? `Synced to the master clock: ${DIVISIONS[fx.delay.division].name} at ${s.clock.bpm} BPM. Turn without Shift for a free time` : 'Free time. Shift+turn syncs to the master clock' })
  store.setIndicator('led-fx-delay-clk', fx.delay.sync)
  set('fx-delay-feedback', fx.delay.feedback)
  set('fx-delay-dry-wet', fx.delay.dryWet)
  set('fx-delay-filter', DELAY_FILTERS.indexOf(fx.delay.filter))
  on('fx-delay-ping-pong', fx.delay.pingPong)
  on('fx-delay-on', fx.delay.on)
  on('fx-delay-global', s.globals.delay)
  set('fx-comp-amount', fx.comp.amount)
  on('fx-comp-fast', fx.comp.fast)
  on('fx-comp-on', fx.comp.on)
  on('fx-comp-global', s.globals.comp)
  on('fx-comp-active', s.effectsOn && fx.comp.on)
  set('fx-reverb-type', REVERB_TYPES.indexOf(fx.reverb.type))
  set('fx-reverb-dry-wet', fx.reverb.dryWet)
  on('fx-reverb-bright', fx.reverb.tone === 'bright')
  on('fx-reverb-dark', fx.reverb.tone === 'dark')
  on('fx-reverb-on', fx.reverb.on)
  on('fx-reverb-global', s.globals.reverb)

  set('rotary-speed', s.rotary.fast ? 1 : 0)
  set('rotary-drive', s.rotary.drive)
  store.patch('rotary-speed', { note: s.rotary.stopMode ? 'Stop mode is on: Slow stops the rotors, Fast spins them' : undefined })
  const routed = s.rotary.organ || CHAIN_IDS.some((id) => s.effectsOn && getChain(s, id).amp.on && getChain(s, id).amp.type === 'To Rotary')
  store.setIndicator('led-rotary-on', routed)

  // zone LEDs: the zone range of each section's focused layer
  const zoneLeds = (section: 'piano' | 'organ' | 'synth', range: ZoneRange) => {
    for (let z = 0; z < 4; z++) store.setIndicator(`led-${section}-zone-${z + 1}`, z >= range[0] && z <= range[1])
  }
  zoneLeds('piano', s.zones[`piano.${s.focus}`])
  zoneLeds('organ', s.zones[`organ.${s.organFocus}`])
  zoneLeds('synth', s.zones[`synth.${s.synthFocus}`])

  // morph: assigned destinations light their morph LED / show their range; in assign mode they show the end values
  const ui = extras.ui?.get()
  const assigning = ui?.morph ?? null
  for (const id of MORPH_CONTROL_IDS) {
    const dest = destForControl(id, s)
    const range = dest ? morphRange(s.morph, dest, s) : null
    store.patch(id, { morph: range ? range : undefined })
    if (dest && assigning) {
      const a = assignmentFor(s.morph, assigning.source, dest)
      if (a && !id.startsWith('synth-osc-env')) set(id, a.to)
    }
  }
  const rotaryMorph = morphRange(s.morph, 'rotary.speed', s)
  store.setIndicator('led-rotary-morph', rotaryMorph !== null)
}

/** one-time accessible notes: what each control does or does not do */
export function annotatePanel(store: HardwareStore): void {
  for (const spec of CONTROLS) {
    if (EXCLUDED_IDS.has(spec.id)) store.patch(spec.id, { note: `Unsupported (${EXCLUDED_REASONS[spec.id]}): it moves but does nothing` })
  }
  store.patch('fx-comp-active', { note: 'Indicator: the compressor is engaged. Not a switch' })
  store.patch('piano-acoustics', { note: 'Steps through soft release and string resonance' })
  store.patch('rotary-organ', { note: 'Routes the organ through the shared rotary speaker' })
  store.patch('rotary-stop-mode', { note: 'Stop mode: the Slow position stops the rotors' })
  store.patch('program-shift', { note: 'Shift: modifier for other controls; pressed alone while storing it cancels' })
  store.patch('effects-shift', { note: 'Shift: modifier for other controls; pressed alone while storing it cancels' })
  for (const [id, text] of Object.entries(PARTIAL_NOTES)) store.patch(id, { note: text })
}

// ---------------------------------------------------------------------------------------------------------------
// panel → state
// ---------------------------------------------------------------------------------------------------------------
export interface BindOptions {
  store: HardwareStore
  engine: EngineStore
  scheduler: Scheduler
  /** monotonic milliseconds, injectable for tap tempo tests */
  now?: () => number
  /** the program system (Store, Live, list view…); without it the Program buttons that need it do nothing */
  programs?: ProgramSystem | null
  ui?: UiModeStore
  /** Panic: stop every note (the instrument) — the bindings also reset held performance inputs */
  panic?: () => void
  /** key-press observer for SET KEY */
  observeNotes?: (observer: (note: number) => void) => () => void
}

export function bindPanel(opts: BindOptions): () => void {
  const { store, engine, scheduler } = opts
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const programs = opts.programs ?? null
  const ui = opts.ui ?? createUiModeStore()
  let syncing = false
  const disposers: Array<() => void> = []
  const holds = new Map<string, { timer: number | null; consumed: boolean }>()
  let taps: number[] = []
  const binders: Binder[] = BINDERS()
  let lastSection: 'piano' | 'organ' | 'synth' = 'piano'
  let flashTimer: number | null = null

  const reflect = () => {
    syncing = true
    try {
      const s = engine.get()
      syncPanel(store, s, { ui })
      for (const b of binders) b.sync(s, ctx)
    } finally {
      syncing = false
    }
  }
  const edit = (fn: (s: EngineState) => EngineState) => {
    engine.update(fn)
    reflect()
  }
  const shiftHeld = (a?: ControlAction) => !!a?.shift || store.get('effects-shift').held || store.get('program-shift').held

  const startHold = (id: string, onHold: () => void) => {
    const previous = holds.get(id)
    if (previous?.timer != null) scheduler.clearTimeout(previous.timer)
    const entry: { timer: number | null; consumed: boolean } = { timer: null, consumed: false }
    entry.timer = scheduler.setTimeout(() => {
      entry.timer = null
      entry.consumed = true
      onHold()
    }, HOLD_MS)
    holds.set(id, entry)
  }
  const endHold = (id: string): boolean => {
    const entry = holds.get(id)
    holds.delete(id)
    if (!entry) return false
    if (entry.timer !== null) scheduler.clearTimeout(entry.timer)
    return entry.consumed
  }
  const consume = (id: string) => {
    const entry = holds.get(id)
    if (entry?.timer != null) scheduler.clearTimeout(entry.timer)
    holds.set(id, { timer: null, consumed: true })
  }

  const ctx: BindCtx = {
    store,
    engine,
    programs,
    ui,
    scheduler,
    now,
    edit,
    reflect,
    shiftHeld,
    startHold,
    endHold,
    consume,
    flash: (text) => {
      if (flashTimer !== null) scheduler.clearTimeout(flashTimer)
      ui.update({ status: text })
      flashTimer = scheduler.setTimeout(() => {
        flashTimer = null
        ui.update({ status: null })
      }, 2500)
    },
    lastSection: () => lastSection,
    panic: () => {
      opts.panic?.()
      engine.update((s) => (s.pitchBend === 0 ? s : { ...s, pitchBend: 0 }))
      ui.update({ splitEdit: null, morph: null, status: null })
    },
    observeNotes: opts.observeNotes ?? (() => () => undefined),
  }

  const continuous: Record<string, (s: EngineState, v: number, c: BindCtx) => EngineState> = { ...CONTINUOUS }
  for (const b of binders) Object.assign(continuous, b.continuous ?? {})

  // continuous controls: the store already holds the new value. While a morph source is in assign mode, moving a morph
  // destination records the move as that source's end value instead of editing the stored (start) value.
  for (const [id, apply] of Object.entries(continuous)) {
    disposers.push(
      store.subscribe(id, () => {
        if (syncing) return
        const section = sectionOfControl(id)
        if (section) lastSection = section
        const morph = ui.get().morph
        const s = engine.get()
        const dest = morph ? destForControl(id, s) : null
        if (morph && dest) {
          const info = morphDest(dest)
          if (info) {
            const value = store.get(id).value
            edit((st) => ({ ...st, morph: assignMorph(st.morph, morph.source, dest, info.get(st), value) }))
            return
          }
        }
        edit((st) => apply(st, store.get(id).value, ctx))
      }),
    )
  }

  // endless encoders: turn deltas
  const dialPrev = new Map<string, number>()
  for (const b of binders) {
    for (const id of b.dials ?? []) {
      dialPrev.set(id, store.get(id).value)
      disposers.push(
        store.subscribe(id, () => {
          if (syncing) return
          const next = store.get(id).value
          const delta = shortestDelta(dialPrev.get(id) ?? next, next, 32)
          dialPrev.set(id, next)
          if (delta !== 0) b.dial?.(id, delta, ctx)
        }),
      )
    }
  }

  const layerPress = (id: string, a: ControlAction) => {
    const lb = LAYER_BUTTONS[id]
    const siblings = Object.keys(LAYER_BUTTONS).filter((k) => LAYER_BUTTONS[k].section === lb.section && k !== id)
    const gestureFor = (gesture: 'tap' | 'both' | 'shift' | 'hold') => (s: EngineState): EngineState =>
      lb.section === 'piano' ? pressLayer(s, lb.layer as LayerId, gesture) : lb.section === 'organ' ? pressOrganLayer(s, lb.layer as LayerId, gesture) : pressSynthLayer(s, lb.layer as SynthLayerId, gesture)
    const heldSibling = siblings.find((k) => store.get(k).held)
    if (heldSibling) {
      const otherHold = holds.get(heldSibling)
      if (otherHold) otherHold.consumed = true
      if (otherHold?.timer != null) scheduler.clearTimeout(otherHold.timer)
      edit(gestureFor('both'))
      holds.set(id, { timer: null, consumed: true })
    } else if (shiftHeld(a)) {
      edit(gestureFor('shift'))
      holds.set(id, { timer: null, consumed: true })
    } else {
      startHold(id, () => edit(gestureFor('hold')))
      reflect()
    }
  }
  const layerRelease = (id: string) => {
    const lb = LAYER_BUTTONS[id]
    if (!endHold(id)) {
      edit((s) => (lb.section === 'piano' ? pressLayer(s, lb.layer as LayerId, 'tap') : lb.section === 'organ' ? pressOrganLayer(s, lb.layer as LayerId, 'tap') : pressSynthLayer(s, lb.layer as SynthLayerId, 'tap')))
    } else reflect()
  }

  const focusFx = (section: FxSection) => (s: EngineState): EngineState => (s.fxSection === section ? s : { ...s, fxSection: section })

  const onPress = (a: ControlAction) => {
    const id = a.id
    const value = store.get(id).value
    const section = sectionOfControl(id)
    if (section) lastSection = section
    if (id in LAYER_BUTTONS) return layerPress(id, a)

    // morph assign mode: the rotary speed button is a morph destination too
    const morph = ui.get().morph
    if (morph && id === 'rotary-speed') {
      const info = morphDest('rotary.speed')!
      edit((st) => ({ ...st, morph: assignMorph(st.morph, morph.source, 'rotary.speed', info.get(st), value === 1 ? 1 : 0) }))
      return
    }

    for (const b of binders) if (b.press?.(a, ctx)) return
    switch (id) {
      case 'effects-focus-piano':
        if (shiftHeld(a)) {
          edit((s) => setGroup(focusFx('piano')(s), !focusFx('piano')(s).group))
          consume(id)
        } else startHold(id, () => edit((s) => setGroup(focusFx('piano')(s), !s.group)))
        return
      case 'effects-focus-organ':
        if (shiftHeld(a)) edit((s) => setEffectsOn(s, !s.effectsOn))
        else edit(pressOrganFxFocus)
        return
      case 'effects-focus-synth':
        if (shiftHeld(a)) {
          edit((s) => setGroup(focusFx('synth')(s), !s.synthGroup))
          consume(id)
        } else startHold(id, () => edit((s) => setGroup(focusFx('synth')(s), !s.synthGroup)))
        return
      case 'piano-on':
        return edit((s) => setPianoOn(s, value > 0))
      case 'piano-select':
        return edit((s) => setType(s, PIANO_TYPES[value] ?? s.layers[s.focus].type))
      case 'piano-kb-touch':
        return edit((s) => setKbTouch(s, KB_TOUCH_ORDER[value] ?? 'Medium'))
      case 'piano-dyn-comp':
        return edit((s) => setDynComp(s, value))
      case 'piano-unison':
        return edit((s) => setUnison(s, value))
      case 'piano-timbre':
        return edit((s) => cycleTimbre(s))
      case 'piano-soft-release':
        return edit((s) => setSoftRelease(s, value > 0))
      case 'piano-string-res':
        return edit((s) => setStringRes(s, value > 0))
      case 'piano-acoustics':
        return edit((s) => cycleAcoustics(s))
      case 'piano-sustain-pedal':
        return edit((s) => setSustPed(s, value > 0))
      case 'piano-pitch-stick':
        return edit((s) => setPitchStickRouting(s, value > 0))
      case 'piano-octave-down':
        return edit((s) => (shiftHeld(a) || ui.get().splitEdit ? stepZone(s, 'piano', -1) : shiftOctave(s, -1)))
      case 'piano-octave-up':
        return edit((s) => (shiftHeld(a) || ui.get().splitEdit ? stepZone(s, 'piano', 1) : shiftOctave(s, 1)))
      case 'effects-on':
        return edit((s) => setEffectsOn(s, value > 0))
      case 'fx-mod1-type':
        return edit((s) => editFx(s, 'mod1', { type: MOD1_TYPES[value] }))
      case 'fx-mod2-type':
        return edit((s) => editFx(s, 'mod2', { type: MOD2_TYPES[value] }))
      case 'fx-amp-model':
        return edit((s) => editFx(s, 'amp', { type: AMP_TYPES[value] }))
      case 'fx-delay-filter':
        return edit((s) => editFx(s, 'delay', { filter: DELAY_FILTERS[value] }))
      case 'fx-reverb-type':
        return edit((s) => editFx(s, 'reverb', { type: REVERB_TYPES[value] }))
      case 'fx-delay-ping-pong':
        return edit((s) => editFx(s, 'delay', { pingPong: value > 0 }))
      case 'fx-comp-fast':
        return edit((s) => editFx(s, 'comp', { fast: value > 0 }))
      case 'fx-reverb-bright':
        return edit((s) => editFx(s, 'reverb', { tone: value > 0 ? 'bright' : 'neutral' }))
      case 'fx-reverb-dark':
        return edit((s) => editFx(s, 'reverb', { tone: value > 0 ? 'dark' : 'neutral' }))
      case 'fx-delay-global':
      case 'fx-comp-global':
      case 'fx-reverb-global':
        return edit((s) => setGlobal(s, GLOBAL_OF[id], value > 0))
      case 'rotary-speed':
        return edit((s) => setRotary(s, { fast: value === 1 }))
      case 'fx-delay-tap':
        return tap()
      case 'fx-comp-active':
        return reflect() // read-only indicator
    }
    if (id in UNIT_ON) {
      const unit = UNIT_ON[id]
      const globalUnit = GLOBAL_OF[id]
      // Shift + ON on a global-capable unit toggles global mode instead of the unit (manual p. 48)
      if (globalUnit && shiftHeld(a)) return edit((s) => setGlobal(s, globalUnit, !s.globals[globalUnit]))
      return edit((s) => editFx(s, unit, { on: value > 0 } as never))
    }
  }

  const onRelease = (a: ControlAction) => {
    const id = a.id
    if (id in LAYER_BUTTONS) return layerRelease(id)
    for (const b of binders) if (b.release?.(a, ctx)) return
    if (id === 'effects-focus-piano') {
      if (!endHold(id)) edit((s) => pressPianoFxFocus(s))
    } else if (id === 'effects-focus-synth') {
      if (!endHold(id)) edit((s) => pressSynthFxFocus(s))
    } else if (id === 'effects-focus-organ') {
      reflect()
    }
  }

  /** tap tempo: the average of the last taps sets the delay time (and moves the tempo knob) */
  const tap = () => {
    const t = now()
    if (taps.length && t - taps[taps.length - 1] > TAP_WINDOW_MS) taps = []
    taps.push(t)
    taps = taps.slice(-5)
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((x, i) => x - taps[i])
      const seconds = intervals.reduce((a, b) => a + b, 0) / intervals.length / 1000
      edit((s) => editFx(s, 'delay', { tempo: tempoFromSeconds(seconds), sync: false }))
    }
  }

  disposers.push(
    store.onAction((a) => {
      if (a.type === 'press') onPress(a)
      else onRelease(a)
    }),
  )
  disposers.push(engine.subscribe(reflect))
  disposers.push(ui.subscribe(reflect))
  if (programs) disposers.push(programs.subscribe(reflect))
  annotatePanel(store)
  reflect()

  return () => {
    for (const d of disposers) d()
    for (const b of binders) b.dispose?.()
    for (const id of Array.from(holds.keys())) endHold(id)
    if (flashTimer !== null) scheduler.clearTimeout(flashTimer)
  }
}

