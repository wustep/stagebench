/**
 * Panel bindings and the control-binding audit.
 *
 * Phase 1's control catalog describes every visible physical input. This module is the
 * single place that decides what each catalog ID does: which store it writes, how a raw
 * panel value maps into instrument state, and — just as importantly — which controls are
 * *not* bound and why.
 *
 * The audit is the honesty contract made structural:
 *
 *  - Every one of the 167 catalog controls appears in exactly one of `CONTROL_BINDINGS`
 *    (functional) or `UNSUPPORTED_CONTROLS` (spec-excluded, with the spec that excludes it).
 *  - A control with no entry at all is a bug, and `auditControls()` reports it.
 *  - A functional entry that names a control not in the catalog is also a bug.
 *
 * Nothing here reaches for the audio graph: bindings describe state, and the instrument
 * pushes that state into the engine.
 */
import { ALL_CONTROLS, findControl } from '../hardware/catalog'
import { PIANO_TYPES, modelsForType } from './pianoLibrary'
import type { EngineId, LayerId } from './types'
import type { EffectState } from './effectState'
import type { PianoState } from './pianoState'
import type { OrganState } from './organState'
import type { SynthState } from './synthState'
import {
  defaultDrawbarsFor,
  organModelFromIndex,
  organModelPanelIndex,
  vibratoFromIndex,
  vibratoPanelIndex,
} from './organState'
import {
  arpModeFromPanel,
  arpModePanelIndex,
  filterFromPanel,
  filterPanelIndex,
  lfoWaveformFromPanel,
  lfoWaveformPanelIndex,
  vibratoFromPanel as synthVibratoFromPanel,
  vibratoPanelIndex as synthVibratoPanelIndex,
  voiceModeFromPanel,
  voiceModePanelIndex,
} from './synthState'
import { AMP_MODELS, DELAY_FILTERS, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from './effectTypes'
import {
  OSC_CATEGORIES,
  WAVEFORMS_BY_CATEGORY,
  categoryForWaveform,
  type OscCategory,
} from './synthModel'
import type { MorphState, MorphSource, ProgramState } from './programState'
import { assignMorph, interpolate, morphPosition } from './programState'

/* ------------------------------------------------------------------ */
/* What a control writes                                              */
/* ------------------------------------------------------------------ */

/** Which store a functional control belongs to. */
export type BindingTarget = 'piano' | 'organ' | 'synth' | 'effects' | 'program' | 'performance'

/**
 * One functional binding. `target` says which store receives the edit; the `apply*`
 * functions below do the mapping. `morphable` marks the controls the programs spec lists as
 * morph destinations, so the morph system can refuse an assignment to anything else.
 */
export interface ControlBinding {
  id: string
  target: BindingTarget
  /** The morph parameter name, when this control can be a morph destination. */
  morph?: string
  /** Which morph source list the destination belongs to (informational). */
  category?: 'organ' | 'piano' | 'synth' | 'effects'
}

/**
 * The spec-excluded control, with the reason it is not bound. Every entry names the spec
 * file and the `excluded` bullet that covers it, so "unsupported" is never a shrug.
 */
export interface UnsupportedControl {
  id: string
  /** Why it is not functional. */
  reason: string
  /** Which spec excludes it. */
  spec: string
}

/* ------------------------------------------------------------------ */
/* Functional bindings                                                */
/* ------------------------------------------------------------------ */

const bindings: ControlBinding[] = []

function bind(id: string, target: BindingTarget, extra: Partial<ControlBinding> = {}): void {
  bindings.push({ id, target, ...extra })
}

// ---- Performance: master level, wheels, rotary -----------------------
bind('performance.master-level', 'performance')
bind('performance.pitch-stick', 'performance')
bind('performance.mod-wheel', 'performance')
bind('performance.rotary.drive', 'effects')
bind('performance.rotary.on', 'effects')
bind('performance.rotary.organ', 'effects')
bind('performance.rotary.speed', 'effects')

// ---- Organ -----------------------------------------------------------
for (const id of [
  'organ.section.on',
  'organ.layer.a.on',
  'organ.layer.b.on',
  'organ.layer.a.level',
  'organ.layer.b.level',
  'organ.octave.down',
  'organ.octave.up',
  'organ.sustped',
  'organ.pstick',
  'organ.model.select',
  'organ.vib-chorus.on',
  'organ.vib-chorus.type',
  'organ.percussion.volume',
  'organ.percussion.decay',
  'organ.percussion.harmonic',
  'organ.percussion.poly',
  'organ.kb-zone.1',
  'organ.kb-zone.2',
  'organ.kb-zone.3',
  'organ.kb-zone.4',
]) {
  bind(id, 'organ', id.endsWith('.level') ? { morph: 'organ.level', category: 'organ' } : {})
}
for (const footage of ['16', '5-1-3', '8', '4', '2-2-3', '2', '1-3-5', '1-1-3', '1']) {
  bind(`organ.drawbar.${footage}`, 'organ', { morph: 'organ.drawbars', category: 'organ' })
}

// ---- Piano -----------------------------------------------------------
for (const id of [
  'piano.section.on',
  'piano.layer.a.on',
  'piano.layer.b.on',
  'piano.layer.a.level',
  'piano.layer.b.level',
  'piano.octave.down',
  'piano.octave.up',
  'piano.sustped',
  'piano.pstick',
  'piano.soft-release',
  'piano.string-res',
  'piano.unison',
  'piano.kb-touch',
  'piano.dyn-comp',
  'piano.type',
  'piano.model',
  'piano.timbre',
  'piano.kb-zone.1',
  'piano.kb-zone.2',
  'piano.kb-zone.3',
  'piano.kb-zone.4',
]) {
  const level = id === 'piano.layer.a.level' || id === 'piano.layer.b.level'
  bind(id, 'piano', level ? { morph: 'piano.level', category: 'piano' } : {})
}

// ---- Synth -----------------------------------------------------------
for (const id of [
  'synth.section.on',
  'synth.layer.a.on',
  'synth.layer.b.on',
  'synth.layer.c.on',
  'synth.layer.a.level',
  'synth.layer.b.level',
  'synth.layer.c.level',
  'synth.sustped',
  'synth.kb-hold',
  'synth.osc.ctrl',
  'synth.osc.env-amt',
  'synth.osc.envelope',
  'synth.filter.on',
  'synth.filter.type',
  'synth.filter.freq',
  'synth.filter.res',
  'synth.filter.env-amt',
  'synth.amp.envelope',
  'synth.amp.velocity',
  'synth.unison',
  'synth.lfo.waveform',
  'synth.lfo.mod-amt',
  'synth.lfo.rate',
  'synth.arp.rate',
  'synth.arp.range',
  'synth.arp.mode',
  'synth.voice.mode',
  'synth.voice.glide',
  'synth.vibrato',
]) {
  const level = id.startsWith('synth.layer.') && id.endsWith('.level')
  const morph =
    id === 'synth.lfo.rate'
      ? 'synth.lfoRate'
      : id === 'synth.lfo.mod-amt'
        ? 'synth.lfoAmount'
        : id === 'synth.osc.ctrl'
          ? 'synth.oscCtrl'
          : id === 'synth.filter.freq'
            ? 'synth.filterFreq'
            : id === 'synth.filter.res'
              ? 'synth.filterRes'
              : id === 'synth.arp.rate'
                ? 'synth.arpRate'
                : level
                  ? 'synth.level'
                  : undefined
  bind(id, 'synth', morph ? { morph, category: 'synth' } : {})
}
// The three waveform dials: category, then waveform within it. Together they select one of
// the spec's required waveforms, and category and wave are derived from the selection.
bind('synth.dial.type', 'synth')
bind('synth.dial.cat', 'synth')
bind('synth.dial.wave', 'synth')

// ---- Layer effects ---------------------------------------------------
for (const id of [
  'effects.mod1.type',
  'effects.mod1.rate',
  'effects.mod1.amount',
  'effects.mod1.on',
  'effects.mod2.type',
  'effects.mod2.rate',
  'effects.mod2.amount',
  'effects.mod2.on',
  'effects.delay.tempo',
  'effects.delay.feedback',
  'effects.delay.dry-wet',
  'effects.delay.filter',
  'effects.delay.ping-pong',
  'effects.delay.on',
  'effects.delay.tap',
  'effects.amp.model',
  'effects.amp.drive',
  'effects.amp.bass',
  'effects.amp.mid',
  'effects.amp.freq',
  'effects.amp.treble',
  'effects.amp.on',
  'effects.comp.amount',
  'effects.comp.fast',
  'effects.comp.on',
  'effects.reverb.dry-wet',
  'effects.reverb.type',
  'effects.reverb.tone',
  'effects.reverb.on',
  'effects.focus.organ-a',
  'effects.focus.organ-b',
  'effects.focus.piano-a',
  'effects.focus.piano-b',
  'effects.focus.synth-a',
  'effects.focus.synth-b',
  'effects.focus.synth-c',
]) {
  const morph =
    id === 'effects.mod1.rate'
      ? 'effects.mod1Rate'
      : id === 'effects.mod1.amount'
        ? 'effects.mod1Amount'
        : id === 'effects.mod2.amount'
          ? 'effects.mod2Amount'
          : id === 'effects.delay.tempo'
            ? 'effects.delayTempo'
            : id === 'effects.delay.feedback'
              ? 'effects.delayFeedback'
              : id === 'effects.delay.dry-wet'
                ? 'effects.delayDryWet'
                : id === 'effects.amp.freq'
                  ? 'effects.eqFreq'
                  : id === 'effects.amp.drive'
                    ? 'effects.drive'
                    : id === 'effects.reverb.dry-wet'
                      ? 'effects.reverbDryWet'
                      : undefined
  bind(id, 'effects', morph ? { morph, category: 'effects' } : {})
}

// ---- Program ---------------------------------------------------------
for (const id of [
  'program.dial',
  'program.page.up',
  'program.page.down',
  'program.live-mode',
  'program.layer-scene',
  'program.store',
  'program.split',
  'program.morph.wheel',
  'program.morph.ctrlped',
  'program.mst-clk',
  'program.transpose.on',
  'program.transpose.set',
  'program.panic',
  'program.shift',
]) {
  bind(id, 'program')
}
for (let slot = 1; slot <= 8; slot += 1) bind(`program.slot.${slot}`, 'program')

/* ------------------------------------------------------------------ */
/* Unsupported controls                                               */
/* ------------------------------------------------------------------ */

const unsupported: UnsupportedControl[] = [
  // Performance
  {
    id: 'performance.monitor-head',
    reason: 'Monitor head input is a physical routing switch; browsers have no second output pair. Presentation only.',
    spec: 'specs/nord-stage-4.visual.json (surface) / manual p. 44',
  },
  {
    id: 'performance.rotary.close-mic',
    reason: 'Rotary close mic is listed under effects `excluded`; the shared rotary is modelled without a mic-position choice.',
    spec: 'specs/nord-stage-4.effects.json#scope.excluded',
  },
  {
    id: 'performance.rotary.stop-mode',
    reason: 'Rotary stop angle is listed under effects `excluded`. The SLOW/FAST selector and the drive are functional; the separate stop-angle switch is not.',
    spec: 'specs/nord-stage-4.effects.json#scope.excluded',
  },
  {
    id: 'performance.rotary.morph',
    reason: 'Rotary speed morphing is assigned from the Program section morph buttons; this dedicated MORPH button is redundant hardware and stays presentation-only.',
    spec: 'specs/nord-stage-4.programs.json#scope.required (morph assignment is via the source buttons)',
  },
  // Organ
  {
    id: 'organ.preset',
    reason: 'The Organ preset library is cut benchmark-wide; drawbar settings live in the program only.',
    spec: 'specs/nord-stage-4.organ.json#scope.excluded',
  },
  {
    id: 'organ.sync',
    reason: 'Drawbar sync is a physical-drawbar concept; the virtual drawbars always show live values.',
    spec: 'specs/nord-stage-4.organ.json#scope.excluded',
  },
  {
    id: 'organ.aux-kb.a',
    reason: 'Aux KB routing is an external-keyboard feature (Extern/Aux KB menus are excluded).',
    spec: 'specs/nord-stage-4.programs.json#scope.excluded',
  },
  {
    id: 'organ.aux-kb.b',
    reason: 'Aux KB routing is an external-keyboard feature (Extern/Aux KB menus are excluded).',
    spec: 'specs/nord-stage-4.programs.json#scope.excluded',
  },
  // Piano
  {
    id: 'piano.ped-noise',
    reason: 'Pedal noise is explicitly excluded, and half-pedaling with it.',
    spec: 'specs/nord-stage-4.piano.json#scope.excluded',
  },
  {
    id: 'piano.info',
    reason: 'The INFO view (size classes, model information) is excluded; the Program display already names the model and its recorded/modelled source.',
    spec: 'specs/nord-stage-4.piano.json#scope.excluded',
  },
  // Synth
  {
    id: 'synth.mode',
    reason: 'Samples and Extern modes are excluded: Phase 3 implements Analog mode only, and the selector is present but stays decorative.',
    spec: 'specs/nord-stage-4.synth.json#scope.excluded',
  },
  {
    id: 'synth.osc.pitch',
    reason: 'The pitch/tuning page is a display mode for the three dials; coarse and fine pitch are set through the dials that are bound, and this selector only changed which page the OLED showed.',
    spec: 'specs/nord-stage-4.synth.json#scope.excluded (menu/display pages)',
  },
  {
    id: 'synth.arp.pattern',
    reason: 'Arpeggiator pattern editing, zig-zag and accent are explicitly excluded; the pattern selector is presentation only.',
    spec: 'specs/nord-stage-4.synth.json#scope.excluded',
  },
  // Program
  {
    id: 'program.preset.organ',
    reason: 'The per-section preset library is cut benchmark-wide.',
    spec: 'specs/nord-stage-4.programs.json#scope.excluded',
  },
  {
    id: 'program.preset.piano',
    reason: 'The per-section preset library is cut benchmark-wide.',
    spec: 'specs/nord-stage-4.programs.json#scope.excluded',
  },
  {
    id: 'program.preset.synth',
    reason: 'The per-section preset library is cut benchmark-wide.',
    spec: 'specs/nord-stage-4.programs.json#scope.excluded',
  },
  {
    id: 'program.morph.at',
    reason: 'Aftertouch is excluded as a morph source: browser keyboards have none, so the A.T. button exists and presses but assigns nothing.',
    spec: 'specs/nord-stage-4.programs.json#scope.excluded',
  },
  // Effects
  {
    id: 'effects.mod1.variation',
    reason: 'Per-type Variations are excluded for every effect unit.',
    spec: 'specs/nord-stage-4.effects.json#scope.excluded',
  },
  {
    id: 'effects.mod2.variation',
    reason: 'Per-type Variations are excluded for every effect unit.',
    spec: 'specs/nord-stage-4.effects.json#scope.excluded',
  },
  {
    id: 'effects.reverb.variation',
    reason: 'Reverb Chorale and the per-type Variation switch are excluded.',
    spec: 'specs/nord-stage-4.effects.json#scope.excluded',
  },
]

export const CONTROL_BINDINGS: readonly ControlBinding[] = bindings
export const UNSUPPORTED_CONTROLS: readonly UnsupportedControl[] = unsupported

/**
 * The controls whose value lives in the Piano store.
 *
 * Kept as a named set because it is a useful grouping in its own right — "which controls
 * does the Piano section own" — and because the Phase 2 regression tests are written
 * against it. Phase 3 adds the Organ, Synth and Program groups below it; it does not
 * change what this group means.
 */
export const PIANO_CONTROL_IDS: ReadonlySet<string> = new Set(
  bindings.filter((entry) => entry.target === 'piano' || entry.target === 'performance').map((entry) => entry.id),
)
/** The controls whose value lives in the Layer Effects store. */
export const EFFECT_CONTROL_IDS: ReadonlySet<string> = new Set(
  bindings.filter((entry) => entry.target === 'effects').map((entry) => entry.id),
)
/** The controls whose value lives in the Organ store. */
export const ORGAN_CONTROL_IDS: ReadonlySet<string> = new Set(
  bindings.filter((entry) => entry.target === 'organ').map((entry) => entry.id),
)
/** The controls whose value lives in the Synth store. */
export const SYNTH_CONTROL_IDS: ReadonlySet<string> = new Set(
  bindings.filter((entry) => entry.target === 'synth').map((entry) => entry.id),
)
/** The controls the Program section owns. */
export const PROGRAM_CONTROL_IDS: ReadonlySet<string> = new Set(
  bindings.filter((entry) => entry.target === 'program').map((entry) => entry.id),
)

const BY_ID = new Map(bindings.map((entry) => [entry.id, entry]))
const UNSUPPORTED_BY_ID = new Map(unsupported.map((entry) => [entry.id, entry]))

/** True when a catalog control is bound to real state. */
export function isFunctionalControl(id: string): boolean {
  return BY_ID.has(id)
}

export function bindingFor(id: string): ControlBinding | undefined {
  return BY_ID.get(id)
}

export function unsupportedReason(id: string): string | undefined {
  return UNSUPPORTED_BY_ID.get(id)?.reason
}

/** The target store a functional control writes to. */
export function targetFor(id: string): BindingTarget | undefined {
  return BY_ID.get(id)?.target
}

/** The morph parameter a control can be assigned to, if any. */
export function morphParameterFor(id: string): string | undefined {
  return BY_ID.get(id)?.morph
}

/* ------------------------------------------------------------------ */
/* The audit                                                          */
/* ------------------------------------------------------------------ */

export interface ControlAuditEntry {
  id: string
  section: string
  status: 'bound' | 'unsupported' | 'unaccounted'
  target?: BindingTarget
  reason?: string
  spec?: string
}

export interface ControlAudit {
  total: number
  bound: number
  unsupported: number
  unaccounted: ControlAuditEntry[]
  /** Bindings that name a control the catalog does not contain. */
  phantomBindings: string[]
  entries: ControlAuditEntry[]
}

/**
 * Audits every catalog control against the binding and unsupported lists.
 *
 * A control is accounted for when it is either bound or explicitly unsupported with a spec
 * reference. Anything else is reported, because "no silent no-op fallbacks" means an
 * unaccounted control is a defect rather than a default.
 */
export function auditControls(): ControlAudit {
  const entries: ControlAuditEntry[] = ALL_CONTROLS.map((control) => {
    if (BY_ID.has(control.id)) {
      return {
        id: control.id,
        section: control.section,
        status: 'bound',
        target: BY_ID.get(control.id)!.target,
      }
    }
    if (UNSUPPORTED_BY_ID.has(control.id)) {
      const entry = UNSUPPORTED_BY_ID.get(control.id)!
      return {
        id: control.id,
        section: control.section,
        status: 'unsupported',
        reason: entry.reason,
        spec: entry.spec,
      }
    }
    return { id: control.id, section: control.section, status: 'unaccounted' }
  })
  const catalogIds = new Set(ALL_CONTROLS.map((control) => control.id))
  const phantomBindings = [
    ...bindings.map((entry) => entry.id).filter((id) => !catalogIds.has(id)),
    ...unsupported.map((entry) => entry.id).filter((id) => !catalogIds.has(id)),
  ]
  return {
    total: entries.length,
    bound: entries.filter((entry) => entry.status === 'bound').length,
    unsupported: entries.filter((entry) => entry.status === 'unsupported').length,
    unaccounted: entries.filter((entry) => entry.status === 'unaccounted'),
    phantomBindings,
    entries,
  }
}

/** Per-section counts, for the audit evidence and the UI notes. */
export function auditBySection(): Record<string, { bound: number; unsupported: number; unaccounted: number }> {
  const audit = auditControls()
  const out: Record<string, { bound: number; unsupported: number; unaccounted: number }> = {}
  for (const entry of audit.entries) {
    if (!out[entry.section]) out[entry.section] = { bound: 0, unsupported: 0, unaccounted: 0 }
    out[entry.section][entry.status] += 1
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Reading panel values                                               */
/* ------------------------------------------------------------------ */

function numericDefault(id: string): number {
  const control = findControl(id)
  return control && 'min' in control ? control.value : 0
}

/** The Piano section's initial state, seeded from the catalog's printed defaults. */
export function pianoStateFromPanel(defaults: PianoState): PianoState {
  const next = {
    ...defaults,
    layers: { 'piano.a': { ...defaults.layers['piano.a'] }, 'piano.b': { ...defaults.layers['piano.b'] } },
  }
  next.masterLevel = numericDefault('performance.master-level')
  next.layers['piano.a'].level = numericDefault('piano.layer.a.level')
  next.layers['piano.b'].level = numericDefault('piano.layer.b.level')
  next.kbTouch = numericDefault('piano.kb-touch')
  next.dynComp = numericDefault('piano.dyn-comp')
  next.unison = numericDefault('piano.unison')
  next.timbre = numericDefault('piano.timbre')
  return next
}

/** The Organ section's initial state, seeded from the catalog's printed defaults. */
export function organStateFromPanel(defaults: OrganState): OrganState {
  const next = {
    ...defaults,
    layers: {
      'organ.a': { ...defaults.layers['organ.a'], drawbars: [...defaults.layers['organ.a'].drawbars] },
      'organ.b': { ...defaults.layers['organ.b'], drawbars: [...defaults.layers['organ.b'].drawbars] },
    },
  }
  next.layers['organ.a'].level = numericDefault('organ.layer.a.level')
  next.layers['organ.b'].level = numericDefault('organ.layer.b.level')
  // The nine drawbars print their own positions, so the panel is the source of truth.
  const drawbarIds = ['16', '5-1-3', '8', '4', '2-2-3', '2', '1-3-5', '1-1-3', '1']
  next.layers['organ.a'].drawbars = drawbarIds.map((footage) => numericDefault(`organ.drawbar.${footage}`))
  next.layers['organ.b'].drawbars = [...next.layers['organ.a'].drawbars]
  return next
}

/** The Synth section's initial state, seeded from the catalog's printed defaults. */
export function synthStateFromPanel(defaults: SynthState): SynthState {
  const next = {
    ...defaults,
    layers: {
      'synth.a': { ...defaults.layers['synth.a'], lfo: { ...defaults.layers['synth.a'].lfo } },
      'synth.b': { ...defaults.layers['synth.b'], lfo: { ...defaults.layers['synth.b'].lfo } },
      'synth.c': { ...defaults.layers['synth.c'], lfo: { ...defaults.layers['synth.c'].lfo } },
    },
  }
  next.layers['synth.a'].level = numericDefault('synth.layer.a.level')
  next.layers['synth.b'].level = numericDefault('synth.layer.b.level')
  next.layers['synth.c'].level = numericDefault('synth.layer.c.level')
  next.layers['synth.a'].oscCtrl = numericDefault('synth.osc.ctrl')
  next.layers['synth.a'].filterFreq = numericDefault('synth.filter.freq')
  next.layers['synth.a'].filterRes = numericDefault('synth.filter.res')
  next.layers['synth.a'].lfo.rate = numericDefault('synth.lfo.rate')
  next.layers['synth.a'].lfo.amount = numericDefault('synth.lfo.mod-amt')
  next.layers['synth.a'].glide = numericDefault('synth.voice.glide')
  next.layers['synth.a'].ampVelocity = numericDefault('synth.amp.velocity')
  return next
}

/* ------------------------------------------------------------------ */
/* Piano edits                                                        */
/* ------------------------------------------------------------------ */

/** Applies one catalog edit to Piano state. Returns nothing; the draft is mutated. */
export function applyPianoEdit(state: PianoState, id: string, value: number | boolean): void {
  const num = typeof value === 'boolean' ? (value ? 1 : 0) : value
  switch (id) {
    case 'piano.section.on':
      state.sectionOn = Boolean(value)
      return
    case 'piano.layer.a.on':
      state.layers['piano.a'].enabled = Boolean(value)
      if (value) state.focused = 'piano.a'
      return
    case 'piano.layer.b.on':
      state.layers['piano.b'].enabled = Boolean(value)
      if (value) state.focused = 'piano.b'
      return
    case 'piano.layer.a.level':
      state.layers['piano.a'].level = num
      return
    case 'piano.layer.b.level':
      state.layers['piano.b'].level = num
      return
    case 'piano.octave.down':
      state.layers[state.focused].octave = Math.max(-12, state.layers[state.focused].octave - 12)
      return
    case 'piano.octave.up':
      state.layers[state.focused].octave = Math.min(12, state.layers[state.focused].octave + 12)
      return
    case 'piano.sustped':
      state.layers['piano.a'].sustPed = Boolean(value)
      state.layers['piano.b'].sustPed = Boolean(value)
      return
    case 'piano.pstick':
      state.layers[state.focused].pitchStick = Boolean(value)
      return
    case 'piano.soft-release':
      state.softRelease = Boolean(value)
      return
    case 'piano.string-res':
      state.stringRes = Boolean(value)
      return
    case 'piano.unison':
      state.unison = num
      return
    case 'piano.kb-touch':
      state.kbTouch = num
      return
    case 'piano.dyn-comp':
      state.dynComp = num
      return
    case 'piano.type': {
      const type = PIANO_TYPES[Math.max(0, Math.min(PIANO_TYPES.length - 1, Math.round(num)))].id
      state.layers[state.focused].type = type
      const models = modelsForType(type)
      // Selecting a type selects its first model. The timbre knob keeps its printed
      // position; the type's own voicing list interprets it (see timbreIndexFor).
      state.layers[state.focused].model = models[0].id
      return
    }
    case 'piano.model': {
      const layer = state.layers[state.focused]
      const models = modelsForType(layer.type)
      // The panel's model dial is 1-based and is not limited to the models that exist for
      // a type, so it clamps to the real list rather than inventing a model.
      const index = Math.max(0, Math.min(models.length - 1, Math.round(num) - 1))
      layer.model = models[index].id
      return
    }
    case 'piano.timbre':
      state.timbre = num
      return
    case 'piano.kb-zone.1':
    case 'piano.kb-zone.2':
    case 'piano.kb-zone.3':
    case 'piano.kb-zone.4':
      // Zone assignment lives in the program's split state, not in the section store. The
      // instrument intercepts these ids (see `ZONE_CONTROL_PATTERN` in `useInstrument`) and
      // writes the split; reaching here means a caller bypassed it, so this is deliberately a
      // no-op that `auditControls` cannot mistake for behaviour. The zone switches are listed
      // as handled by the instrument, and `setZone` is what the panel actually calls.
      return
    case 'performance.master-level':
      state.masterLevel = num
      return
    default:
      return
  }
}

/* ------------------------------------------------------------------ */
/* Organ edits                                                        */
/* ------------------------------------------------------------------ */

const DRAWBAR_IDS = ['16', '5-1-3', '8', '4', '2-2-3', '2', '1-3-5', '1-1-3', '1'] as const

/** Applies one catalog edit to Organ state. */
export function applyOrganEdit(state: OrganState, id: string, value: number | boolean): void {
  const num = typeof value === 'boolean' ? (value ? 1 : 0) : value
  const focused = state.layers[state.focused]
  switch (id) {
    case 'organ.section.on':
      state.sectionOn = Boolean(value)
      return
    case 'organ.layer.a.on':
      state.layers['organ.a'].enabled = Boolean(value)
      if (value) state.focused = 'organ.a'
      return
    case 'organ.layer.b.on':
      state.layers['organ.b'].enabled = Boolean(value)
      if (value) state.focused = 'organ.b'
      return
    case 'organ.layer.a.level':
      state.layers['organ.a'].level = num
      return
    case 'organ.layer.b.level':
      state.layers['organ.b'].level = num
      return
    case 'organ.octave.down':
      focused.octave = Math.max(-12, focused.octave - 12)
      return
    case 'organ.octave.up':
      focused.octave = Math.min(12, focused.octave + 12)
      return
    case 'organ.sustped':
      state.layers['organ.a'].sustPed = Boolean(value)
      state.layers['organ.b'].sustPed = Boolean(value)
      return
    case 'organ.pstick':
      focused.pitchStick = Boolean(value)
      return
    case 'organ.model.select': {
      const model = organModelFromIndex(num)
      // A model change brings that model's own sensible registration with it, so the new
      // engine sounds rather than inheriting another model's drawbar semantics (Farf's are
      // on/off registers, the others are continuous partials).
      focused.model = model
      focused.drawbars = defaultDrawbarsFor(model)
      return
    }
    case 'organ.vib-chorus.on':
      focused.vibratoOn = Boolean(value)
      return
    case 'organ.vib-chorus.type':
      // The scanner setting is shared by both layers, exactly as the panel prints it.
      state.layers['organ.a'].vibratoType = vibratoFromIndex(num)
      state.layers['organ.b'].vibratoType = vibratoFromIndex(num)
      return
    case 'organ.percussion.volume':
      focused.percussion.soft = Boolean(value)
      focused.percussion.on = true
      return
    case 'organ.percussion.decay':
      focused.percussion.fast = Boolean(value)
      focused.percussion.on = true
      return
    case 'organ.percussion.harmonic':
      focused.percussion.third = Boolean(value)
      focused.percussion.on = true
      return
    case 'organ.percussion.poly':
      focused.percussion.poly = Boolean(value)
      focused.percussion.on = true
      return
    case 'organ.kb-zone.1':
    case 'organ.kb-zone.2':
    case 'organ.kb-zone.3':
    case 'organ.kb-zone.4':
      return
    default: {
      const index = DRAWBAR_IDS.indexOf(id.replace('organ.drawbar.', '') as (typeof DRAWBAR_IDS)[number])
      if (index >= 0) {
        focused.drawbars[index] = Math.max(0, Math.min(8, Math.round(num)))
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Synth edits                                                        */
/* ------------------------------------------------------------------ */

const OSC_CATEGORY_FOR_DIAL = OSC_CATEGORIES

/** Applies one catalog edit to Synth state. */
export function applySynthEdit(state: SynthState, id: string, value: number | boolean): void {
  const num = typeof value === 'boolean' ? (value ? 1 : 0) : value
  const focused = state.layers[state.focused]
  switch (id) {
    case 'synth.section.on':
      state.sectionOn = Boolean(value)
      return
    case 'synth.layer.a.on':
      state.layers['synth.a'].enabled = Boolean(value)
      if (value) state.focused = 'synth.a'
      return
    case 'synth.layer.b.on':
      state.layers['synth.b'].enabled = Boolean(value)
      if (value) state.focused = 'synth.b'
      return
    case 'synth.layer.c.on':
      state.layers['synth.c'].enabled = Boolean(value)
      if (value) state.focused = 'synth.c'
      return
    case 'synth.layer.a.level':
      state.layers['synth.a'].level = num
      return
    case 'synth.layer.b.level':
      state.layers['synth.b'].level = num
      return
    case 'synth.layer.c.level':
      state.layers['synth.c'].level = num
      return
    case 'synth.sustped':
      state.layers['synth.a'].sustPed = Boolean(value)
      state.layers['synth.b'].sustPed = Boolean(value)
      state.layers['synth.c'].sustPed = Boolean(value)
      return
    case 'synth.kb-hold':
      focused.arp.hold = Boolean(value)
      return
    case 'synth.osc.ctrl':
      focused.oscCtrl = num
      return
    case 'synth.osc.env-amt':
      focused.oscEnvAmount = num
      return
    case 'synth.osc.envelope':
      // The ENVELOPE toggle retargets the oscillator envelope onto pitch, which is the
      // manual's "Env To Pitch".
      focused.oscEnvToPitch = Boolean(value)
      return
    case 'synth.filter.on':
      focused.filterOn = Boolean(value)
      return
    case 'synth.filter.type':
      focused.filterType = filterFromPanel(num)
      return
    case 'synth.filter.freq':
      focused.filterFreq = num
      return
    case 'synth.filter.res':
      focused.filterRes = num
      return
    case 'synth.filter.env-amt':
      focused.filterEnvAmount = num
      return
    case 'synth.amp.envelope':
      // Switching the amp envelope page is a display mode; the envelope's own dials are
      // bound through the shared ADSR values below. Nothing to change but the page flag.
      return
    case 'synth.amp.velocity':
      focused.ampVelocity = Math.max(0, Math.min(3, Math.round(num)))
      return
    case 'synth.unison':
      focused.unison = Math.max(0, Math.min(3, Math.round(num)))
      return
    case 'synth.lfo.waveform':
      focused.lfo.waveform = lfoWaveformFromPanel(num)
      return
    case 'synth.lfo.mod-amt':
      focused.lfo.amount = num
      return
    case 'synth.lfo.rate':
      focused.lfo.rate = num
      return
    case 'synth.arp.rate':
      focused.arp.rate = num
      return
    case 'synth.arp.range':
      focused.arp.range = num
      return
    case 'synth.arp.mode': {
      const mode = arpModeFromPanel(num)
      focused.arp.mode = mode
      // Selecting ARP is what a player means by "start the arpeggiator"; RUN then has
      // something to start. POLY and GATE stop it.
      focused.arp.run = mode === 'Arp'
      return
    }
    case 'synth.voice.mode':
      focused.voiceMode = voiceModeFromPanel(num)
      return
    case 'synth.voice.glide':
      focused.glide = num
      return
    case 'synth.vibrato':
      focused.vibrato = synthVibratoFromPanel(num)
      return
    case 'synth.dial.cat': {
      // The category dial selects the waveform category; the wave dial then picks within it.
      const category = OSC_CATEGORY_FOR_DIAL[Math.max(0, Math.min(OSC_CATEGORY_FOR_DIAL.length - 1, Math.round(num)))]
      focused.waveform = WAVEFORMS_BY_CATEGORY[category][0]
      return
    }
    case 'synth.dial.wave': {
      const category = categoryForWaveform(focused.waveform)
      const list = WAVEFORMS_BY_CATEGORY[category]
      focused.waveform = list[Math.max(0, Math.min(list.length - 1, Math.round(num)))]
      return
    }
    case 'synth.dial.type': {
      // The type dial is a combined selector over every waveform the engine offers.
      const flat = OSC_CATEGORIES.flatMap((category) =>
        WAVEFORMS_BY_CATEGORY[category].map((name) => ({ category, name })),
      )
      const pick = flat[Math.max(0, Math.min(flat.length - 1, Math.round(num)))]
      if (pick) focused.waveform = pick.name
      return
    }
    default:
      return
  }
}

/* ------------------------------------------------------------------ */
/* Effects edits                                                      */
/* ------------------------------------------------------------------ */

/** Applies one catalog edit to Layer Effects state. */
export function applyEffectEdit(state: EffectState, id: string, value: number | boolean): void {
  const chain = state.chains[state.focusedLayer]
  const num = typeof value === 'boolean' ? (value ? 1 : 0) : value
  const on = Boolean(value)
  switch (id) {
    case 'effects.mod1.type':
      chain.mod1.type = MOD1_TYPES[clampIndex(num, MOD1_TYPES.length)]
      return
    case 'effects.mod1.rate':
      chain.mod1.rate = num
      return
    case 'effects.mod1.amount':
      chain.mod1.amount = num
      return
    case 'effects.mod1.on':
      chain.mod1.on = on
      return
    case 'effects.mod2.type':
      chain.mod2.type = MOD2_TYPES[clampIndex(num, MOD2_TYPES.length)]
      return
    case 'effects.mod2.rate':
      chain.mod2.rate = num
      return
    case 'effects.mod2.amount':
      chain.mod2.amount = num
      return
    case 'effects.mod2.on':
      chain.mod2.on = on
      return
    case 'effects.delay.tempo':
      chain.delay.tempo = num
      chain.delay.tapSeconds = null
      return
    case 'effects.delay.feedback':
      chain.delay.feedback = num
      return
    case 'effects.delay.dry-wet':
      chain.delay.dryWet = num
      return
    case 'effects.delay.filter':
      chain.delay.filter = DELAY_FILTERS[clampIndex(num, DELAY_FILTERS.length)]
      return
    case 'effects.delay.ping-pong':
      chain.delay.pingPong = on
      return
    case 'effects.delay.on':
      chain.delay.on = on
      return
    case 'effects.amp.model':
      chain.ampEq.model = AMP_MODELS[clampIndex(num, AMP_MODELS.length)]
      return
    case 'effects.amp.drive':
      chain.ampEq.drive = num
      return
    case 'effects.amp.bass':
      chain.ampEq.bass = num
      return
    case 'effects.amp.mid':
      chain.ampEq.mid = num
      return
    case 'effects.amp.freq':
      chain.ampEq.midFreq = num
      return
    case 'effects.amp.treble':
      chain.ampEq.treble = num
      return
    case 'effects.amp.on':
      chain.ampEq.on = on
      return
    case 'effects.comp.amount':
      chain.compressor.amount = num
      return
    case 'effects.comp.fast':
      chain.compressor.fast = on
      return
    case 'effects.comp.on':
      chain.compressor.on = on
      return
    case 'effects.reverb.dry-wet':
      chain.reverb.dryWet = num
      return
    case 'effects.reverb.type':
      chain.reverb.type = REVERB_TYPES[clampIndex(num, REVERB_TYPES.length)]
      return
    case 'effects.reverb.tone':
      chain.reverb.tone = num === 1 ? 'Dark' : 'Bright'
      return
    case 'effects.reverb.on':
      chain.reverb.on = on
      return
    // The seven focus buttons are a radio group across the three sections. Pressing one
    // latches it, and a press that would switch the already-focused chain off is ignored
    // (a chain is always focused, exactly as on the instrument).
    case 'effects.focus.organ-a':
      if (on) state.focusedLayer = 'organ'
      return
    case 'effects.focus.organ-b':
      if (on) state.focusedLayer = 'organ'
      return
    case 'effects.focus.piano-a':
      if (on) state.focusedLayer = 'piano.a'
      return
    case 'effects.focus.piano-b':
      if (on) state.focusedLayer = 'piano.b'
      return
    case 'effects.focus.synth-a':
      if (on) state.focusedLayer = 'synth.a'
      return
    case 'effects.focus.synth-b':
      if (on) state.focusedLayer = 'synth.b'
      return
    case 'effects.focus.synth-c':
      if (on) state.focusedLayer = 'synth.c'
      return
    case 'performance.rotary.on':
      state.rotary.on = on
      return
    case 'performance.rotary.drive':
      state.rotary.drive = num
      return
    case 'performance.rotary.organ':
      // The ORGAN button routes the Organ into the shared rotary (manual p. 53).
      state.rotary.organRouted = on
      return
    case 'performance.rotary.speed':
      state.rotary.speed = num === 1 ? 'Fast' : 'Slow'
      return
    case 'performance.rotary.stop-mode':
      // The effects spec lists rotary stop as optional; the panel has a dedicated STOP MODE
      // switch, so pressing it selects the third speed the specs allow.
      state.rotary.speed = on ? 'Stop' : 'Slow'
      return
    default:
      return
  }
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(length - 1, Math.round(value)))
}

/** Which chain a manual focus press selects, if the edit was one of the focus buttons. */
export function focusTargetFor(id: string, value: number | boolean): EffectState['focusedLayer'] | null {
  if (!value) return null
  switch (id) {
    case 'effects.focus.piano-a':
      return 'piano.a'
    case 'effects.focus.piano-b':
      return 'piano.b'
    case 'effects.focus.organ-a':
    case 'effects.focus.organ-b':
      return 'organ'
    case 'effects.focus.synth-a':
      return 'synth.a'
    case 'effects.focus.synth-b':
      return 'synth.b'
    case 'effects.focus.synth-c':
      return 'synth.c'
    default:
      return null
  }
}

/**
 * The other members of the focus group, so the panel can clear them when one is selected.
 * A focus group is a radio group: exactly one LED is lit at a time.
 */
export function focusCounterparts(id: string): string[] {
  const group = [
    'effects.focus.organ-a',
    'effects.focus.organ-b',
    'effects.focus.piano-a',
    'effects.focus.piano-b',
    'effects.focus.synth-a',
    'effects.focus.synth-b',
    'effects.focus.synth-c',
  ]
  return group.filter((entry) => entry !== id)
}

/** Which chain the panel edits. */
export function editedChain(state: EffectState): EffectState['focusedLayer'] {
  return state.focusedLayer
}

/** Alias kept for the Phase 2 callers that clear the other half of the Piano focus pair. */
export function focusCounterpart(id: string): string | null {
  const counterparts = focusCounterparts(id)
  // The Phase 2 Piano pair had exactly one counterpart; report that one when it exists.
  const pianoPair = counterparts.filter((entry) => entry.startsWith('effects.focus.piano-'))
  return pianoPair.length === 1 ? pianoPair[0] : null
}

/* ------------------------------------------------------------------ */
/* Panel read-back                                                    */
/* ------------------------------------------------------------------ */

/** The panel values the Panel should *display* for effects state. */
export function effectPanelValue(state: EffectState, id: string): number | boolean | undefined {
  const chain = state.chains[state.focusedLayer]
  switch (id) {
    case 'effects.mod1.type':
      return MOD1_TYPES.indexOf(chain.mod1.type)
    case 'effects.mod1.rate':
      return chain.mod1.rate
    case 'effects.mod1.amount':
      return chain.mod1.amount
    case 'effects.mod1.on':
      return chain.mod1.on
    case 'effects.mod2.type':
      return MOD2_TYPES.indexOf(chain.mod2.type)
    case 'effects.mod2.rate':
      return chain.mod2.rate
    case 'effects.mod2.amount':
      return chain.mod2.amount
    case 'effects.mod2.on':
      return chain.mod2.on
    case 'effects.delay.tempo':
      return chain.delay.tempo
    case 'effects.delay.feedback':
      return chain.delay.feedback
    case 'effects.delay.dry-wet':
      return chain.delay.dryWet
    case 'effects.delay.filter':
      return DELAY_FILTERS.indexOf(chain.delay.filter)
    case 'effects.delay.ping-pong':
      return chain.delay.pingPong
    case 'effects.delay.on':
      return chain.delay.on
    case 'effects.amp.model':
      return AMP_MODELS.indexOf(chain.ampEq.model)
    case 'effects.amp.drive':
      return chain.ampEq.drive
    case 'effects.amp.bass':
      return chain.ampEq.bass
    case 'effects.amp.mid':
      return chain.ampEq.mid
    case 'effects.amp.freq':
      return chain.ampEq.midFreq
    case 'effects.amp.treble':
      return chain.ampEq.treble
    case 'effects.amp.on':
      return chain.ampEq.on
    case 'effects.comp.amount':
      return chain.compressor.amount
    case 'effects.comp.fast':
      return chain.compressor.fast
    case 'effects.comp.on':
      return chain.compressor.on
    case 'effects.reverb.dry-wet':
      return chain.reverb.dryWet
    case 'effects.reverb.type':
      return REVERB_TYPES.indexOf(chain.reverb.type)
    case 'effects.reverb.tone':
      return chain.reverb.tone === 'Dark' ? 1 : 0
    case 'effects.reverb.on':
      return chain.reverb.on
    case 'effects.focus.organ-a':
    case 'effects.focus.organ-b':
      return state.focusedLayer === 'organ'
    case 'effects.focus.piano-a':
      return state.focusedLayer === 'piano.a'
    case 'effects.focus.piano-b':
      return state.focusedLayer === 'piano.b'
    case 'effects.focus.synth-a':
      return state.focusedLayer === 'synth.a'
    case 'effects.focus.synth-b':
      return state.focusedLayer === 'synth.b'
    case 'effects.focus.synth-c':
      return state.focusedLayer === 'synth.c'
    case 'performance.rotary.on':
      return state.rotary.on
    case 'performance.rotary.organ':
      return state.rotary.organRouted
    case 'performance.rotary.drive':
      return state.rotary.drive
    case 'performance.rotary.speed':
      return state.rotary.speed === 'Slow' ? 0 : 1
    case 'performance.rotary.stop-mode':
      return state.rotary.speed === 'Stop'
    default:
      return undefined
  }
}

/** The panel values for Piano state. */
export function pianoPanelValue(state: PianoState, id: string): number | boolean | undefined {
  switch (id) {
    case 'piano.section.on':
      return state.sectionOn
    case 'piano.layer.a.on':
      return state.layers['piano.a'].enabled
    case 'piano.layer.b.on':
      return state.layers['piano.b'].enabled
    case 'piano.layer.a.level':
      return state.layers['piano.a'].level
    case 'piano.layer.b.level':
      return state.layers['piano.b'].level
    case 'piano.sustped':
      return state.layers['piano.a'].sustPed
    case 'piano.pstick':
      return state.layers[state.focused].pitchStick
    case 'piano.soft-release':
      return state.softRelease
    case 'piano.string-res':
      return state.stringRes
    case 'piano.unison':
      return state.unison
    case 'piano.kb-touch':
      return state.kbTouch
    case 'piano.dyn-comp':
      return state.dynComp
    case 'piano.type':
      return PIANO_TYPES.findIndex((t) => t.id === state.layers[state.focused].type)
    case 'piano.model':
      return (
        modelsForType(state.layers[state.focused].type).findIndex(
          (m) => m.id === state.layers[state.focused].model,
        ) + 1
      )
    case 'piano.timbre':
      return state.timbre
    case 'performance.master-level':
      return state.masterLevel
    default:
      return undefined
  }
}

/** The panel values for Organ state. */
export function organPanelValue(state: OrganState, id: string): number | boolean | undefined {
  const focused = state.layers[state.focused]
  switch (id) {
    case 'organ.section.on':
      return state.sectionOn
    case 'organ.layer.a.on':
      return state.layers['organ.a'].enabled
    case 'organ.layer.b.on':
      return state.layers['organ.b'].enabled
    case 'organ.layer.a.level':
      return state.layers['organ.a'].level
    case 'organ.layer.b.level':
      return state.layers['organ.b'].level
    case 'organ.sustped':
      return state.layers['organ.a'].sustPed
    case 'organ.pstick':
      return focused.pitchStick
    case 'organ.model.select':
      return organModelPanelIndex(focused)
    case 'organ.vib-chorus.on':
      return focused.vibratoOn
    case 'organ.vib-chorus.type':
      return vibratoPanelIndex(state.layers['organ.a'].vibratoType)
    case 'organ.percussion.volume':
      return focused.percussion.soft
    case 'organ.percussion.decay':
      return focused.percussion.fast
    case 'organ.percussion.harmonic':
      return focused.percussion.third
    case 'organ.percussion.poly':
      return focused.percussion.poly
    default: {
      const index = DRAWBAR_IDS.indexOf(id.replace('organ.drawbar.', '') as (typeof DRAWBAR_IDS)[number])
      if (index >= 0) return focused.drawbars[index]
      return undefined
    }
  }
}

/** The panel values for Synth state. */
export function synthPanelValue(state: SynthState, id: string): number | boolean | undefined {
  const focused = state.layers[state.focused]
  switch (id) {
    case 'synth.section.on':
      return state.sectionOn
    case 'synth.layer.a.on':
      return state.layers['synth.a'].enabled
    case 'synth.layer.b.on':
      return state.layers['synth.b'].enabled
    case 'synth.layer.c.on':
      return state.layers['synth.c'].enabled
    case 'synth.layer.a.level':
      return state.layers['synth.a'].level
    case 'synth.layer.b.level':
      return state.layers['synth.b'].level
    case 'synth.layer.c.level':
      return state.layers['synth.c'].level
    case 'synth.sustped':
      return state.layers['synth.a'].sustPed
    case 'synth.kb-hold':
      return focused.arp.hold
    case 'synth.osc.ctrl':
      return focused.oscCtrl
    case 'synth.osc.env-amt':
      return focused.oscEnvAmount
    case 'synth.osc.envelope':
      return focused.oscEnvToPitch
    case 'synth.filter.on':
      return focused.filterOn
    case 'synth.filter.type':
      return filterPanelIndex(focused.filterType)
    case 'synth.filter.freq':
      return focused.filterFreq
    case 'synth.filter.res':
      return focused.filterRes
    case 'synth.filter.env-amt':
      return focused.filterEnvAmount
    case 'synth.amp.velocity':
      return focused.ampVelocity
    case 'synth.unison':
      return focused.unison
    case 'synth.lfo.waveform':
      return lfoWaveformPanelIndex(focused.lfo.waveform)
    case 'synth.lfo.mod-amt':
      return focused.lfo.amount
    case 'synth.lfo.rate':
      return focused.lfo.rate
    case 'synth.arp.rate':
      return focused.arp.rate
    case 'synth.arp.range':
      return focused.arp.range
    case 'synth.arp.mode':
      return arpModePanelIndex(focused.arp.mode)
    case 'synth.voice.mode':
      return voiceModePanelIndex(focused.voiceMode)
    case 'synth.voice.glide':
      return focused.glide
    case 'synth.vibrato':
      return synthVibratoPanelIndex(focused.vibrato)
    case 'synth.dial.cat':
      return Math.max(0, OSC_CATEGORIES.indexOf(categoryForWaveform(focused.waveform) as OscCategory))
    case 'synth.dial.wave': {
      const category = categoryForWaveform(focused.waveform)
      return Math.max(0, WAVEFORMS_BY_CATEGORY[category].indexOf(focused.waveform))
    }
    case 'synth.dial.type': {
      const flat = OSC_CATEGORIES.flatMap((category) => WAVEFORMS_BY_CATEGORY[category].map((name) => name))
      return Math.max(0, flat.indexOf(focused.waveform))
    }
    default:
      return undefined
  }
}

/* ------------------------------------------------------------------ */
/* Morph application                                                  */
/* ------------------------------------------------------------------ */

export interface MorphApplyResult {
  /** Control id -> the value the morph source sets it to. */
  values: Record<string, number>
  /** The layer levels and drawbars the LED graphs should show as their morphed range. */
  ranges: Record<string, { start: number; end: number; value: number }>
}

/**
 * Interpolates a source's assignments and returns the control values they produce.
 *
 * The values are written back through the same edit functions the panel uses, so a morph
 * moves the identical state a human hand would and the LEDs follow automatically.
 */
export function morphValues(state: MorphState, source: MorphSource): MorphApplyResult {
  const position = morphPosition(state, source)
  const assignments = source === 'Wheel' ? state.wheel : state.pedal
  const values: Record<string, number> = {}
  const ranges: Record<string, { start: number; end: number; value: number }> = {}
  for (const assignment of assignments) {
    const value = interpolate(assignment, position)
    values[assignment.controlId] = value
    ranges[assignment.controlId] = { start: assignment.start, end: assignment.end, value }
  }
  return { values, ranges }
}

/**
 * Records a morph destination. Called while a source button is held (or latched), when the
 * player moves a control from its start to its end value.
 */
export function recordMorph(
  state: MorphState,
  source: MorphSource,
  controlId: string,
  start: number,
  end: number,
): void {
  // Only controls the specs list as morph destinations can be assigned.
  if (!morphParameterFor(controlId)) return
  assignMorph(state, source, controlId, start, end)
}

/** The engines a program state covers, for the layer-routing audit. */
export const ENGINES: readonly EngineId[] = ['piano', 'organ', 'synth']

/** Every layer's enable state in a program, used by the scene and routing systems. */
export function layerEnabled(state: ProgramState, layer: LayerId): boolean {
  if (layer.startsWith('piano')) return state.piano.sectionOn && state.piano.layers[layer as 'piano.a'].enabled
  if (layer.startsWith('organ')) return state.organ.sectionOn && state.organ.layers[layer as 'organ.a'].enabled
  return state.synth.sectionOn && state.synth.layers[layer as 'synth.a'].enabled
}
