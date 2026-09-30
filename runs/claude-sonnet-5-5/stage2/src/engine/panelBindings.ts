import { MODELS, PIANO_TYPES, TIMBRES, softReleaseAvailable, stringResAvailable } from '../audio/library/catalog'
import { tempoFromSeconds } from '../audio/params'
import type { Scheduler } from '../audio/types'
import { CONTROLS } from '../hardware/layout'
import type { ControlAction, HardwareStore } from '../hardware/store'
import {
  AMP_TYPES,
  DELAY_FILTERS,
  KB_TOUCH_ORDER,
  LAYER_IDS,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  cycleAcoustics,
  cycleTimbre,
  editFx,
  focusedFx,
  focusedLayer,
  otherLayer,
  pressLayer,
  pressPianoFxFocus,
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
  type FxUnit,
  type GlobalUnit,
  type LayerId,
} from './state'

/**
 * Binds the panel (presentation store) to the canonical instrument state for the controls that are functional in
 * Phase 2: the Piano section, the Layer Effects section, Master Level, the rotary speaker and the pitch stick.
 *
 *  panel → state : button presses (`onAction`, with Shift) and knob/fader/encoder moves become canonical edits
 *  state → panel : after every change, `syncPanel` writes the canonical values (and LEDs) back, so what the panel
 *                  shows is always what the audio does — a refused edit simply snaps back
 *
 * Every other control keeps its Phase 1 behaviour and is annotated as decorative.
 */

export const HOLD_MS = 500
const TAP_WINDOW_MS = 2000

const LAYER_BUTTON: Record<LayerId, string> = { A: 'piano-layer-a-onoff', B: 'piano-layer-b-onoff' }
const LEVEL_FADER: Record<LayerId, string> = { A: 'piano-level-a', B: 'piano-level-b' }

/** controls whose behaviour is real in Phase 2 */
export const FUNCTIONAL_IDS: ReadonlySet<string> = new Set([
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
])

/** controls the specs list as excluded from every phase: they move and light, and do nothing */
export const EXCLUDED_IDS: ReadonlySet<string> = new Set([
  'piano-ped-noise',
  'fx-delay-effect',
  'fx-delay-variation',
  'fx-delay-analog',
  'fx-reverb-variation',
  'rotary-close-mic',
])

/** effect focus for Organ and Synth chains does not exist yet: these buttons press but never light */
const NO_FOCUS_IDS: ReadonlySet<string> = new Set(['effects-focus-organ', 'effects-focus-synth'])

const CONTINUOUS: Record<string, (s: EngineState, v: number) => EngineState> = {
  'master-level': (s, v) => setMaster(s, v),
  'pitch-stick': (s, v) => setPitchBend(s, (v - 0.5) * 2),
  'rotary-drive': (s, v) => setRotary(s, { drive: v }),
  'piano-level-a': (s, v) => setLevel(s, 'A', v),
  'piano-level-b': (s, v) => setLevel(s, 'B', v),
  'piano-model-dial': (s, v) => setModelFromDetent(s, v),
  'fx-mod1-rate': (s, v) => editFx(s, 'mod1', { rate: v }),
  'fx-mod1-amount': (s, v) => editFx(s, 'mod1', { amount: v }),
  'fx-mod2-rate': (s, v) => editFx(s, 'mod2', { rate: v }),
  'fx-mod2-amount': (s, v) => editFx(s, 'mod2', { amount: v }),
  'fx-amp-drive': (s, v) => editFx(s, 'amp', { drive: v }),
  'fx-amp-frequency': (s, v) => editFx(s, 'amp', { freq: v }),
  'fx-eq-bass': (s, v) => editFx(s, 'amp', { bass: v }),
  'fx-eq-mid': (s, v) => editFx(s, 'amp', { mid: v }),
  'fx-eq-treble': (s, v) => editFx(s, 'amp', { treble: v }),
  'fx-delay-tempo': (s, v) => editFx(s, 'delay', { tempo: v }),
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

// ---------------------------------------------------------------------------------------------------------------
// state → panel
// ---------------------------------------------------------------------------------------------------------------
const octaveText = (n: number) => (n > 0 ? `+${n}` : String(n))

/** write every bound control from the canonical state (idempotent: the store ignores unchanged values) */
export function syncPanel(store: HardwareStore, s: EngineState): void {
  const layer = focusedLayer(s)
  const fx = focusedFx(s)
  const both = LAYER_IDS.every((id) => s.layers[id].enabled)
  const set = (id: string, v: number) => store.set(id, v)
  const on = (id: string, v: boolean) => store.set(id, v ? 1 : 0)

  set('master-level', s.master)
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
  const octave = `Layer ${s.focus} octave ${octaveText(layer.octave)}`
  store.patch('piano-octave-down', { note: octave })
  store.patch('piano-octave-up', { note: octave })

  // effects
  on('effects-on', s.effectsOn)
  const group = s.group
  store.setIndicator('led-piano-fx-focus', true)
  store.setIndicator('led-fx-focus-piano-a', group || s.fxFocus === 'A')
  store.setIndicator('led-fx-focus-piano-b', group || s.fxFocus === 'B')
  store.patch('effects-focus-piano', { note: `Piano effects focus: ${group ? 'group, layers A and B share one chain' : `layer ${s.fxFocus}`}. Shift or long press toggles group mode` })
  for (const id of ['effects-focus-organ', 'effects-focus-synth']) {
    set(id, 0)
    store.patch(id, { note: 'Organ and Synth effect chains arrive in a later phase; this button does not change the focus' })
  }

  set('fx-mod1-rate', fx.mod1.rate)
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
  set('fx-delay-tempo', fx.delay.tempo)
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
  const routed = LAYER_IDS.some((id) => s.effectsOn && s.fx[id].amp.on && s.fx[id].amp.type === 'To Rotary')
  store.setIndicator('led-rotary-on', routed)
}

/** one-time accessible notes: what each control does or does not do in this phase */
export function annotatePanel(store: HardwareStore): void {
  for (const spec of CONTROLS) {
    if (EXCLUDED_IDS.has(spec.id)) store.patch(spec.id, { note: 'Unsupported in this build (excluded feature): it moves but does nothing' })
    else if (!FUNCTIONAL_IDS.has(spec.id) && !NO_FOCUS_IDS.has(spec.id)) store.patch(spec.id, { note: 'Decorative in this phase: it moves but does not change the sound' })
  }
  store.patch('fx-comp-active', { note: 'Indicator: the compressor is engaged. Not a switch' })
  store.patch('piano-acoustics', { note: 'Steps through soft release and string resonance' })
  store.patch('rotary-organ', { note: 'Organ routing arrives with the Organ section; decorative in this phase' })
  store.patch('rotary-stop-mode', { note: 'Stop mode is not supported; decorative' })
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
}

export function bindPanel(opts: BindOptions): () => void {
  const { store, engine, scheduler } = opts
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  let syncing = false
  const disposers: Array<() => void> = []
  const holds = new Map<string, { timer: number | null; consumed: boolean }>()
  let taps: number[] = []

  const reflect = () => {
    syncing = true
    try {
      syncPanel(store, engine.get())
    } finally {
      syncing = false
    }
  }
  const edit = (fn: (s: EngineState) => EngineState) => {
    engine.update(fn)
    reflect()
  }
  const shiftHeld = (a?: ControlAction) => !!a?.shift || store.get('effects-shift').held || store.get('program-shift').held

  // continuous controls: the store already holds the new value
  for (const [id, apply] of Object.entries(CONTINUOUS)) {
    disposers.push(
      store.subscribe(id, () => {
        if (syncing) return
        edit((s) => apply(s, store.get(id).value))
      }),
    )
  }

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

  const onPress = (a: ControlAction) => {
    const id = a.id
    const value = store.get(id).value
    // layer buttons: tap / hold / Shift / both together (manual p. 23)
    const layerId = LAYER_IDS.find((l) => LAYER_BUTTON[l] === id)
    if (layerId) {
      const other = otherLayer(layerId)
      if (store.get(LAYER_BUTTON[other]).held) {
        const otherHold = holds.get(LAYER_BUTTON[other])
        if (otherHold) otherHold.consumed = true
        if (otherHold?.timer != null) scheduler.clearTimeout(otherHold.timer)
        edit((s) => pressLayer(s, layerId, 'both'))
        holds.set(id, { timer: null, consumed: true })
      } else if (shiftHeld(a)) {
        edit((s) => pressLayer(s, layerId, 'shift'))
        holds.set(id, { timer: null, consumed: true })
      } else {
        startHold(id, () => edit((s) => pressLayer(s, layerId, 'hold')))
        reflect()
      }
      return
    }
    switch (id) {
      case 'effects-focus-piano':
        if (shiftHeld(a)) {
          edit((s) => setGroup(s, !s.group))
          holds.set(id, { timer: null, consumed: true })
        } else {
          startHold(id, () => edit((s) => setGroup(s, !s.group)))
        }
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
        return edit((s) => shiftOctave(s, -1))
      case 'piano-octave-up':
        return edit((s) => shiftOctave(s, 1))
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
    if (NO_FOCUS_IDS.has(id)) reflect()
  }

  const onRelease = (a: ControlAction) => {
    const id = a.id
    const layerId = LAYER_IDS.find((l) => LAYER_BUTTON[l] === id)
    if (layerId) {
      if (!endHold(id)) edit((s) => pressLayer(s, layerId, 'tap'))
      else reflect()
    } else if (id === 'effects-focus-piano') {
      if (!endHold(id)) edit((s) => pressPianoFxFocus(s))
    } else if (NO_FOCUS_IDS.has(id)) {
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
      edit((s) => editFx(s, 'delay', { tempo: tempoFromSeconds(seconds) }))
    }
  }

  disposers.push(
    store.onAction((a) => {
      if (a.type === 'press') onPress(a)
      else onRelease(a)
    }),
  )
  disposers.push(engine.subscribe(reflect))
  annotatePanel(store)
  reflect()

  return () => {
    for (const d of disposers) d()
    for (const id of Array.from(holds.keys())) endHold(id)
  }
}
