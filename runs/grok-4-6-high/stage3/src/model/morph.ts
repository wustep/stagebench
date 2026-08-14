import {
  DRAWBAR_IDS,
  MORPH_DEST_IDS,
  cloneJson,
  type InstrumentState,
  type MorphAssignment,
  type MorphSource,
} from './instrument-state'

export function morphAmount(state: InstrumentState, source: MorphSource): number {
  return source === 'wheel' ? state.modWheel : state.ctrlPedal
}

export function soundingState(state: InstrumentState): InstrumentState {
  if (state.morphs.length === 0) return state
  const next = cloneJson(state)
  for (const assign of state.morphs) {
    const t = morphAmount(state, assign.source)
    const value = assign.start + (assign.end - assign.start) * t
    applyDestValue(next, assign.dest, value)
  }
  return next
}

export function applyDestValue(state: InstrumentState, dest: string, value: number): void {
  const v = Math.min(1, Math.max(0, value))
  if (dest === 'piano-layer-a-level') state.layers.A.level = v
  if (dest === 'piano-layer-b-level') state.layers.B.level = v
  if (dest === 'organ-layer-a-level') state.organ.A.level = v
  if (dest === 'organ-layer-b-level') state.organ.B.level = v
  if (dest === 'synth-layer-a-level') state.synth.A.level = v
  if (dest === 'synth-layer-b-level') state.synth.B.level = v
  if (dest === 'synth-layer-c-level') state.synth.C.level = v
  const db = DRAWBAR_IDS.indexOf(dest as (typeof DRAWBAR_IDS)[number])
  if (db >= 0) {
    const layer = state.organ.A.focus || !state.organ.B.focus ? state.organ.A : state.organ.B
    layer.drawbars[db] = Math.round(v * 8)
  }
  if (dest === 'rotary-speed' || dest === 'organ-rotary-fast') state.rotarySpeed = v
  if (dest === 'synth-lfo-rate') focusedSynth(state).lfoRate = v
  if (dest === 'synth-osc-shape') focusedSynth(state).oscCtrl = v
  if (dest === 'synth-lfo-amount') focusedSynth(state).lfoAmt = v
  if (dest === 'synth-filter-freq') focusedSynth(state).filterFreq = v
  if (dest === 'synth-filter-res') focusedSynth(state).filterRes = v
  if (dest === 'synth-arp-rate') focusedSynth(state).arpRate = v
  const fx = focusedFx(state)
  if (dest === 'fx1-rate') fx.mod1Rate = v
  if (dest === 'fx1-amount') fx.mod1Amount = v
  if (dest === 'fx2-amount') fx.mod2Amount = v
  if (dest === 'delay-tempo') fx.delayTempo = v
  if (dest === 'delay-feedback') fx.delayFeedback = v
  if (dest === 'delay-mix') fx.delayMix = v
  if (dest === 'amp-mid-freq') fx.ampMidFreq = v
  if (dest === 'amp-drive') fx.ampDrive = v
  if (dest === 'reverb-mix') fx.reverbMix = v
}

export function readDestValue(state: InstrumentState, dest: string): number {
  if (dest === 'piano-layer-a-level') return state.layers.A.level
  if (dest === 'piano-layer-b-level') return state.layers.B.level
  if (dest === 'organ-layer-a-level') return state.organ.A.level
  if (dest === 'organ-layer-b-level') return state.organ.B.level
  if (dest === 'synth-layer-a-level') return state.synth.A.level
  if (dest === 'synth-layer-b-level') return state.synth.B.level
  if (dest === 'synth-layer-c-level') return state.synth.C.level
  const db = DRAWBAR_IDS.indexOf(dest as (typeof DRAWBAR_IDS)[number])
  if (db >= 0) {
    const layer = state.organ.A.focus || !state.organ.B.focus ? state.organ.A : state.organ.B
    return (layer.drawbars[db] ?? 0) / 8
  }
  if (dest === 'rotary-speed' || dest === 'organ-rotary-fast') return state.rotarySpeed
  if (dest === 'synth-lfo-rate') return focusedSynth(state).lfoRate
  if (dest === 'synth-osc-shape') return focusedSynth(state).oscCtrl
  if (dest === 'synth-lfo-amount') return focusedSynth(state).lfoAmt
  if (dest === 'synth-filter-freq') return focusedSynth(state).filterFreq
  if (dest === 'synth-filter-res') return focusedSynth(state).filterRes
  if (dest === 'synth-arp-rate') return focusedSynth(state).arpRate
  const fx = focusedFx(state)
  if (dest === 'fx1-rate') return fx.mod1Rate
  if (dest === 'fx1-amount') return fx.mod1Amount
  if (dest === 'fx2-amount') return fx.mod2Amount
  if (dest === 'delay-tempo') return fx.delayTempo
  if (dest === 'delay-feedback') return fx.delayFeedback
  if (dest === 'delay-mix') return fx.delayMix
  if (dest === 'amp-mid-freq') return fx.ampMidFreq
  if (dest === 'amp-drive') return fx.ampDrive
  if (dest === 'reverb-mix') return fx.reverbMix
  return 0
}

export function recordMorph(state: InstrumentState, dest: string, value: number): void {
  if (state.morphLatch === 'off') return
  if (!MORPH_DEST_IDS.has(dest)) return
  const source = state.morphLatch
  const existing = state.morphs.find((m) => m.source === source && m.dest === dest)
  if (!existing) {
    state.morphs.push({ source, dest, start: readDestValue(state, dest), end: value })
    return
  }
  existing.end = value
  if (Math.abs(existing.end - existing.start) < 0.01) {
    state.morphs = state.morphs.filter((m) => m !== existing)
  }
}

export function clearMorphSource(state: InstrumentState, source: MorphSource): void {
  state.morphs = state.morphs.filter((m) => m.source !== source)
}

function focusedSynth(state: InstrumentState) {
  if (state.synth.C.focus && !state.synth.A.focus && !state.synth.B.focus) return state.synth.C
  if (state.synth.B.focus && !state.synth.A.focus) return state.synth.B
  return state.synth.A
}

function focusedFx(state: InstrumentState) {
  if (state.fxSectionFocus === 'organ') return state.organFx
  if (state.fxSectionFocus === 'synth') {
    if (state.synth.C.focus && !state.synth.A.focus && !state.synth.B.focus) return state.synth.C.fx
    if (state.synth.B.focus && !state.synth.A.focus) return state.synth.B.fx
    return state.synth.A.fx
  }
  if (state.layers.B.focus && !state.layers.A.focus) return state.layers.B.fx
  return state.layers.A.fx
}

export function morphAssigned(state: InstrumentState, dest: string): boolean {
  return state.morphs.some((m: MorphAssignment) => m.dest === dest)
}
