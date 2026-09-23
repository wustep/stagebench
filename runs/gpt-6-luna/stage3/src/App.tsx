import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { createPianoOutput, NoteLifecycle, type AudioConfiguration, type EffectUnitId, type EffectUnitState, type LayerId, type PianoOutput, type PianoType } from './audio'
import { defaultConfiguration, EFFECT_TYPE_OPTIONS } from './audio-graph'
import {
  activeRoutesForPatch,
  buildArpeggioSequence,
  clonePatch,
  editPatch,
  getPatchPathNumber,
  morphValue,
  persistStage3State,
  readStage3State,
  selectLive,
  selectProgram,
  SPLIT_MIDI,
  setPatchPathNumber,
  STAGE3_STORAGE_KEY,
  storeProgram,
  SYNTH_WAVEFORMS,
  type InstrumentPatch,
  type MorphAssignment,
  type MorphSource,
  type Stage3State,
  type SynthLayerId,
  zoneGainsForNote,
} from './stage3'
import {
  COMPUTER_KEY_MAP,
  CONTROL_GROUPS,
  HARDWARE_CONTROLS,
  INITIAL_HARDWARE_STATE,
  KEY_MODEL,
  SECTIONS,
  WHITE_KEY_COUNT,
  type ControlDefinition,
  type KeyDefinition,
  type SectionDefinition,
} from './hardware'

interface MidiMessageLike {
  data: Uint8Array
}

interface MidiPortLike {
  id?: string
  name?: string
  state?: string
  onmidimessage: ((event: MidiMessageLike) => void) | null
}

interface MidiStateChangeLike {
  port?: { id?: string; state?: string; type?: string }
}

export interface MidiAccessLike {
  inputs: Map<string, MidiPortLike>
  addEventListener?(type: 'statechange', listener: (event: MidiStateChangeLike) => void): void
  removeEventListener?(type: 'statechange', listener: (event: MidiStateChangeLike) => void): void
}

export interface AppProps {
  audioOutputFactory?: () => PianoOutput
  midiAccessFactory?: () => Promise<MidiAccessLike>
}

type AudioState = 'loading' | 'ready' | 'error' | 'fallback'
type MidiState = 'disconnected' | 'connecting' | 'connected' | 'denied' | 'unavailable'

const midiFactoryFromBrowser = (): Promise<MidiAccessLike> => {
  const navigatorWithMidi = navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }
  if (!navigatorWithMidi.requestMIDIAccess) return Promise.reject(new Error('Web MIDI is not supported by this browser'))
  return navigatorWithMidi.requestMIDIAccess().then((access) => access as unknown as MidiAccessLike)
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

const CONTROL_CYCLES: Record<string, string[]> = {
  'piano-kb-touch': ['Heavy', 'Medium', 'Light'],
  'piano-dyn-comp': ['Off', '1', '2', '3'],
  'piano-timbre': ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'],
  'piano-unison': ['Off', '1', '2', '3'],
  'effects-effect-1-type': EFFECT_TYPE_OPTIONS.mod1,
  'effects-effect-2-type': EFFECT_TYPE_OPTIONS.mod2,
  'effects-amp-mode': EFFECT_TYPE_OPTIONS.ampEq,
  'effects-delay-filter': ['Off', 'LP', 'HP', 'BP'],
  'effects-reverb-type': EFFECT_TYPE_OPTIONS.reverb,
  'organ-vibrato-mode': ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'],
  'synth-oscillator-category': ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'],
  'synth-filter-type': ['LP12', 'LP24', 'HP', 'BP'],
  'synth-filter-tracking': ['Off', '1/3', '2/3', '1'],
  'synth-lfo-waveform': ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'],
  'synth-lfo-destination': ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'],
  'synth-voice-mode': ['Poly', 'Mono', 'Legato'],
  'synth-voice-priority': ['Off', 'Low', 'High'],
  'synth-unison': ['Off', '1', '2', '3'],
  'synth-vibrato-mode': ['Wheel', 'On'],
  'synth-arp-mode': ['Off', 'Arp', 'Poly', 'Gate'],
  'synth-arp-range': ['1', '2', '3', '4'],
  'synth-arp-direction': ['Up', 'Down', 'Up/Down', 'Random'],
  'program-zone-count': ['1', '2', '3', '4'],
}

const SELECTABLE_CONTROLS = new Set([
  'piano-type-grand', 'piano-type-upright', 'piano-type-electric', 'piano-type-clav', 'piano-type-digital', 'piano-type-misc',
  'piano-layer-a-focus', 'piano-layer-b-focus',
  'effects-focus-a', 'effects-focus-b', 'effects-focus-organ', 'effects-focus-piano', 'effects-focus-synth',
  'organ-model-b3', 'organ-model-vox', 'organ-model-farfisa', 'organ-model-pipe',
  'synth-focus-a', 'synth-focus-b', 'synth-focus-c',
])

function effectHardwareState(hardware: Record<string, number>, configuration: Pick<AudioConfiguration, 'effects'>, focus: LayerId, override?: AudioConfiguration['effects']['units']['A']): Record<string, number> {
  const units = override ?? configuration.effects.units[focus]
  const indexOf = (options: string[], value: string) => Math.max(0, options.indexOf(value))
  return {
    ...hardware,
    'effects-focus-a': focus === 'A' ? 1 : 0,
    'effects-focus-b': focus === 'B' ? 1 : 0,
    'piano-layer-a-focus': focus === 'A' ? 1 : 0,
    'piano-layer-b-focus': focus === 'B' ? 1 : 0,
    'effects-effect-1-rate': Math.round(units.mod1.rate * 100),
    'effects-effect-1-depth': Math.round(units.mod1.amount * 100),
    'effects-effect-1-type': indexOf(EFFECT_TYPE_OPTIONS.mod1, units.mod1.type),
    'effects-effect-1-on': units.mod1.on ? 1 : 0,
    'effects-effect-2-rate': Math.round(units.mod2.rate * 100),
    'effects-effect-2-depth': Math.round(units.mod2.amount * 100),
    'effects-effect-2-type': indexOf(EFFECT_TYPE_OPTIONS.mod2, units.mod2.type),
    'effects-effect-2-on': units.mod2.on ? 1 : 0,
    'effects-amp-mode': indexOf(EFFECT_TYPE_OPTIONS.ampEq, units.ampEq.type),
    'effects-amp-on': units.ampEq.on ? 1 : 0,
    'effects-amp-drive': Math.round(units.ampEq.drive * 100),
    'effects-eq-bass': Math.round(units.ampEq.bass * 100),
    'effects-eq-mid': Math.round(units.ampEq.mid * 100),
    'effects-eq-mid-frequency': Math.round(units.ampEq.midFrequency * 100),
    'effects-eq-treble': Math.round(units.ampEq.treble * 100),
    'effects-delay-time': Math.round(units.delay.time * 100),
    'effects-delay-feedback': Math.round(units.delay.feedback * 100),
    'effects-delay-mix': Math.round(units.delay.mix * 100),
    'effects-delay-filter': indexOf(CONTROL_CYCLES['effects-delay-filter'] ?? [], units.delay.filter),
    'effects-delay-global': units.delay.global ? 1 : 0,
    'effects-delay-on': units.delay.on ? 1 : 0,
    'effects-compressor-amount': Math.round(units.compressor.amount * 100),
    'effects-compressor-fast': units.compressor.fast ? 1 : 0,
    'effects-compressor-global': units.compressor.global ? 1 : 0,
    'effects-compressor-on': units.compressor.on ? 1 : 0,
    'effects-reverb-depth': Math.round(units.reverb.mix * 100),
    'effects-reverb-time': Math.round(units.reverb.decay * 100),
    'effects-reverb-type': indexOf(EFFECT_TYPE_OPTIONS.reverb, units.reverb.type),
    'effects-reverb-brightness': Math.round(units.reverb.brightness * 100),
    'effects-reverb-global': units.reverb.global ? 1 : 0,
    'effects-reverb-on': units.reverb.on ? 1 : 0,
  }
}

function stage3HardwareState(hardware: Record<string, number>, state: Stage3State, page: number): Record<string, number> {
  const patch = state.patch
  const next = { ...hardware }
  const set = (id: string, value: number) => { next[id] = value }
  set('piano-model-selector', Math.round(patch.piano.modelVariant / 2 * 100))
  for (const layer of ['A', 'B'] as const) {
    const organ = patch.organ.layers[layer]
    set(`organ-layer-${layer.toLowerCase()}`, organ.enabled ? 1 : 0)
    set(`organ-layer-${layer.toLowerCase()}-level`, Math.round(organ.level * 100))
    set(`organ-layer-${layer.toLowerCase()}-focus`, patch.organ.focus === layer ? 1 : 0)
  }
  const focusedOrgan = patch.organ.layers[patch.organ.focus]
  focusedOrgan.drawbars.forEach((value, index) => set(`organ-drawbar-${index + 1}`, Math.round(value / 8 * 100)))
  set('organ-section-on', patch.organ.sectionOn ? 1 : 0)
  set('organ-level', Math.round(focusedOrgan.level * 100))
  set('organ-model-b3', focusedOrgan.model === 'B3' ? 1 : 0)
  set('organ-model-vox', focusedOrgan.model === 'Vox' ? 1 : 0)
  set('organ-model-farfisa', focusedOrgan.model === 'Farf' ? 1 : 0)
  set('organ-model-pipe', focusedOrgan.model === 'Pipe 1' ? 1 : 0)
  set('organ-percussion-on', focusedOrgan.percussionOn ? 1 : 0)
  set('organ-percussion-soft', focusedOrgan.percussionSoft ? 1 : 0)
  set('organ-percussion-fast', focusedOrgan.percussionFast ? 1 : 0)
  set('organ-percussion-third', focusedOrgan.percussionThird ? 1 : 0)
  set('organ-key-click', focusedOrgan.keyClick ? 1 : 0)
  set('organ-vibrato-on', focusedOrgan.vibratoOn ? 1 : 0)
  set('organ-vibrato-mode', ['C1', 'C2', 'C3', 'V1', 'V2', 'V3'].indexOf(focusedOrgan.vibratoMode))
  set('organ-sustain-pedal', focusedOrgan.sustainPedal ? 1 : 0)
  set('organ-rotary-route', patch.organ.rotaryRoute ? 1 : 0)
  for (const layer of ['A', 'B', 'C'] as const) {
    const synth = patch.synth.layers[layer]
    set(`synth-layer-${layer.toLowerCase()}`, synth.enabled ? 1 : 0)
    set(`synth-layer-${layer.toLowerCase()}-level`, Math.round(synth.level * 100))
    set(`synth-focus-${layer.toLowerCase()}`, patch.synth.focus === layer ? 1 : 0)
  }
  const focusedSynth = patch.synth.layers[patch.synth.focus]
  set('synth-oscillator-control', Math.round(focusedSynth.oscCtrl * 100))
  set('synth-oscillator-pitch', Math.round(focusedSynth.pitch / 24 * 50 + 50))
  set('synth-oscillator-fine', Math.round(focusedSynth.fine / 50 * 50 + 50))
  set('synth-oscillator-sub', Math.round(focusedSynth.subLevel * 100))
  set('synth-oscillator-noise', Math.round(focusedSynth.noiseLevel * 100))
  set('synth-filter-cutoff', Math.round(focusedSynth.cutoff * 100))
  set('synth-filter-resonance', Math.round(focusedSynth.resonance * 100))
  set('synth-filter-drive', Math.round(focusedSynth.drive / 3 * 100))
  set('synth-filter-envelope', Math.round(focusedSynth.filterEnvelope.amount * 100))
  set('synth-filter-type', ['LP12', 'LP24', 'HP', 'BP'].indexOf(focusedSynth.filterType))
  set('synth-filter-tracking', focusedSynth.tracking)
  set('synth-amp-attack', Math.round(focusedSynth.amplifierEnvelope.attack * 100))
  set('synth-amp-decay', Math.round(focusedSynth.amplifierEnvelope.decay * 100))
  set('synth-amp-sustain', Math.round(focusedSynth.amplifierEnvelope.sustain * 100))
  set('synth-amp-release', Math.round(focusedSynth.amplifierEnvelope.release * 100))
  set('synth-osc-attack', Math.round(focusedSynth.oscillatorEnvelope.attack * 100))
  set('synth-osc-decay', Math.round(focusedSynth.oscillatorEnvelope.decay * 100))
  set('synth-osc-release', Math.round(focusedSynth.oscillatorEnvelope.release * 100))
  set('synth-osc-env-amount', Math.round(focusedSynth.oscillatorEnvelope.amount * 100))
  set('synth-osc-env-velocity', focusedSynth.oscillatorEnvelope.velocity ? 1 : 0)
  set('synth-osc-env-to-pitch', focusedSynth.oscillatorEnvelope.toPitch ? 1 : 0)
  set('synth-filter-attack', Math.round(focusedSynth.filterEnvelope.attack * 100))
  set('synth-filter-decay', Math.round(focusedSynth.filterEnvelope.decay * 100))
  set('synth-filter-sustain', Math.round(focusedSynth.filterEnvelope.sustain * 100))
  set('synth-filter-release', Math.round(focusedSynth.filterEnvelope.release * 100))
  set('synth-filter-env-velocity', focusedSynth.filterEnvelope.velocity ? 1 : 0)
  set('synth-mod-attack', Math.round(focusedSynth.oscillatorEnvelope.attack * 100))
  set('synth-mod-decay', Math.round(focusedSynth.oscillatorEnvelope.decay * 100))
  set('synth-mod-sustain', Math.round(focusedSynth.oscillatorEnvelope.sustain * 100))
  set('synth-mod-release', Math.round(focusedSynth.oscillatorEnvelope.release * 100))
  set('synth-lfo-rate', Math.round(focusedSynth.lfoRate * 100))
  set('synth-lfo-amount', Math.round(focusedSynth.lfoAmount * 100))
  set('synth-lfo-waveform', ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'].indexOf(focusedSynth.lfoWaveform))
  set('synth-lfo-destination', ['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'].indexOf(focusedSynth.lfoDestination))
  set('synth-lfo-sync', focusedSynth.lfoSync ? 1 : 0)
  set('synth-voice-mode', ['Poly', 'Mono', 'Legato'].indexOf(focusedSynth.voiceMode))
  set('synth-voice-priority', ['Off', 'Low', 'High'].indexOf(focusedSynth.priority))
  set('synth-glide', Math.round(focusedSynth.glide * 100))
  set('synth-unison', focusedSynth.unison)
  set('synth-vibrato-mode', focusedSynth.vibratoMode === 'On' ? 1 : 0)
  set('synth-vibrato-rate', Math.round(focusedSynth.vibratoRate * 100))
  set('synth-vibrato-amount', Math.round(focusedSynth.vibratoAmount * 100))
  set('synth-arp-mode', ['Off', 'Arp', 'Poly', 'Gate'].indexOf(focusedSynth.arpMode))
  set('synth-arp-rate', Math.round(focusedSynth.arpRate * 100))
  set('synth-arp-range', focusedSynth.arpRange - 1)
  set('synth-arp-direction', ['Up', 'Down', 'Up/Down', 'Random'].indexOf(focusedSynth.arpDirection))
  set('synth-arp-hold', focusedSynth.arpHold ? 1 : 0)
  set('synth-arp-on', focusedSynth.arpRun ? 1 : 0)
  set('synth-oscillator-category', ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'].indexOf(focusedSynth.category))
  set('synth-oscillator-shape', ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'].indexOf(focusedSynth.category) * 25)
  set('synth-oscillator-wave', Math.round(SYNTH_WAVEFORMS[focusedSynth.category].indexOf(focusedSynth.waveform) / Math.max(1, SYNTH_WAVEFORMS[focusedSynth.category].length - 1) * 100))
  set('program-program-dial', Math.round(state.selectedProgram / 31 * 100))
  set('program-live-mode', state.mode === 'live' ? 1 : 0)
  set('program-split', patch.splits.enabled ? 1 : 0)
  set('program-zone-count', patch.splits.zoneCount - 1)
  set('program-layer-scene', patch.scenes.active === 'II' ? 1 : 0)
  set('program-clock-tempo', Math.round((patch.clockBpm - 30) / 270 * 100))
  set('program-clock-sync', patch.clockSync ? 1 : 0)
  set('performance-modulation-wheel', Math.round(patch.morph.positions.Wheel * 100))
  set('performance-control-pedal', Math.round(patch.morph.positions['Control Pedal'] * 100))
  set('program-store', state.storeFlow === 'destination' || state.storeFlow === 'store-as-destination' ? 1 : 0)
  set('effects-focus-piano', patch.piano.effects.manualSection === 'Piano' ? 1 : 0)
  set('effects-focus-organ', patch.piano.effects.manualSection === 'Organ' ? 1 : 0)
  set('effects-focus-synth', patch.piano.effects.manualSection === 'Synth' ? 1 : 0)
  set('effects-piano-group', patch.piano.effects.group ? 1 : 0)
  set('effects-effects-on', patch.piano.effects.allBypass ? 0 : 1)
  set('performance-rotary-on', patch.piano.effects.rotaryOn ? 1 : 0)
  set('effects-rotary-on', patch.piano.effects.rotaryOn ? 1 : 0)
  set('performance-rotary-speed', Math.round(patch.piano.effects.rotaryRate * 100))
  set('performance-rotary-fast', patch.piano.effects.rotarySpeed === 'Fast' ? 1 : 0)
  set('performance-rotary-stop', patch.piano.effects.rotarySpeed === 'Stop' ? 1 : 0)
  set('effects-rotary-drive', Math.round(patch.piano.effects.rotaryDrive * 100))
  const effectLayer = patch.piano.effects.focus
  const displayedEffectUnits = patch.piano.effects.manualSection === 'Synth' ? focusedSynth.effects : patch.piano.effects.manualSection === 'Organ' ? patch.piano.effects.units.A : patch.piano.effects.units[effectLayer]
  Object.assign(next, effectHardwareState(next, patch.piano, effectLayer, displayedEffectUnits))
  for (let index = 0; index < 8; index += 1) set(`program-program-${index + 1}`, state.mode === 'live' ? state.selectedLive === index ? 1 : 0 : Math.floor(state.selectedProgram / 8) === page && state.selectedProgram % 8 === index ? 1 : 0)
  return next
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], button'))
}

function Control({
  control,
  value,
  cycleOptions,
  onChange,
}: {
  control: ControlDefinition
  value: number
  cycleOptions?: string[]
  onChange: (next: number) => void
}) {
  const isButton = control.kind === 'button'
  const cycle = cycleOptions ?? CONTROL_CYCLES[control.id]
  const cycleValue = cycle?.[Math.round(value)]
  const selectable = SELECTABLE_CONTROLS.has(control.id)
  const rotation = -138 + value * 2.76
  const shapeClass = `hardware-control hardware-${control.kind}`
  if (isButton) {
    return (
      <button
        type="button"
        className={`${shapeClass}${value ? ' is-active' : ''}`}
        data-control-id={control.id}
        data-control-kind={control.kind}
        aria-label={cycle && cycleValue ? `${control.name}: ${cycleValue}` : control.name}
        aria-pressed={value > 0}
        onClick={() => onChange(cycle ? (Math.round(value) + 1) % cycle.length : selectable ? 1 : value > 0 ? 0 : 1)}
      >
        <span className="button-lamp" aria-hidden="true" />
        <span className="control-legend">{cycleValue ?? control.legend}</span>
      </button>
    )
  }

  return (
    <label
      className={shapeClass}
      data-control-id={control.id}
      data-control-kind={control.kind}
      style={{ '--control-rotation': `${rotation}deg`, '--control-position': `${100 - value}%` } as CSSProperties}
    >
      <span className="control-name">{control.legend}</span>
      {control.kind === 'drawbar' && <span className="drawbar-leds" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i className={index < Math.round(value / 100 * 8) ? 'lit' : ''} key={index} />)}</span>}
      <span className="control-visual" aria-hidden="true"><i /></span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        aria-label={control.name}
        aria-valuetext={control.kind === 'drawbar' ? `${Math.round(value / 100 * 8)} of 8` : control.id === 'piano-model-selector' ? (['Studio', 'Warm', 'Bright'] as const)[Math.round(value / 50)] ?? 'Studio' : `${Math.round(value)} percent`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="control-value" aria-hidden="true">{Math.round(value)}</span>
    </label>
  )
}

function InstrumentSection({
  section,
  hardware,
  audioConfiguration,
  stage3,
  onControlChange,
  onProgramAction,
  onPatchChange,
  onMorphPosition,
}: {
  section: SectionDefinition
  hardware: Record<string, number>
  audioConfiguration: AudioConfiguration
  stage3: Stage3State
  onControlChange: (control: ControlDefinition, next: number) => void
  onProgramAction: (action: string, value?: string | number) => void
  onPatchChange: (patch: InstrumentPatch) => void
  onMorphPosition: (source: MorphSource, position: number) => void
}) {
  const groups = CONTROL_GROUPS(section.id)
  const sectionControls = HARDWARE_CONTROLS.filter((control) => control.section === section.id)
  const content = groups.map((group) => {
    const controls = sectionControls.filter((control) => control.group === group)
    return (
      <div className={`control-group group-${group.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`} key={group}>
        <h3>{group}</h3>
        <div className="group-controls">
          {controls.map((control) => (
            <Control
              key={control.id}
              control={control}
              value={hardware[control.id] ?? control.initial}
              cycleOptions={control.id === 'piano-timbre' && audioConfiguration.pianoType !== 'Electric' ? CONTROL_CYCLES[control.id]?.slice(0, 4) : CONTROL_CYCLES[control.id]}
              onChange={(next) => onControlChange(control, next)}
            />
          ))}
        </div>
      </div>
    )
  })

  const pianoModel = {
    Grand: 'Salamander Grand Piano', Upright: 'Upright Piano KW', Electric: 'jRhodes3d Rhodes',
    Clav: 'Synth Clav', Digital: 'Digital Piano', Misc: 'Mallet Piano',
  }[audioConfiguration.pianoType] + ` · ${(['Studio', 'Warm', 'Bright'] as const)[audioConfiguration.modelVariant]}`
  const focusMessage = audioConfiguration.effects.manualSection === 'Piano'
    ? `Piano effects · Layer ${audioConfiguration.effects.focus}`
    : `${audioConfiguration.effects.manualSection} focus · engine is decorative in Phase 2`

  return (
    <section
      className={`instrument-section section-${section.id}${section.panel ? ' inset-panel' : ''}`}
      data-section-id={section.id}
      aria-label={`${section.label} section`}
      style={{ flexBasis: `${Number((section.fraction * 100).toFixed(4))}%` }}
    >
      <h2 className="section-heading">{section.label}</h2>
      {section.id === 'program' && <ProgramDisplay modelName={pianoModel} stage3={stage3} onProgramAction={onProgramAction} onPatchChange={onPatchChange} onMorphPosition={onMorphPosition} />}
      {section.id === 'synth' && <SynthDisplay state={stage3.patch.synth.layers[stage3.patch.synth.focus]} />}
      {section.id === 'organ' && <div className="organ-state-readout" aria-live="polite">{stage3.patch.organ.layers[stage3.patch.organ.focus].model} · Layer {stage3.patch.organ.focus}</div>}
      {content}
      {section.id === 'piano' && <div className="piano-state-readout" aria-label={`Layer A octave ${audioConfiguration.layers.A.octave}, layer B octave ${audioConfiguration.layers.B.octave}`}>
        <span>A {audioConfiguration.layers.A.octave > 0 ? '+' : ''}{audioConfiguration.layers.A.octave} OCT</span>
        <span>B {audioConfiguration.layers.B.octave > 0 ? '+' : ''}{audioConfiguration.layers.B.octave} OCT</span>
      </div>}
      {section.id === 'effects' && <div className="effects-state-readout" role="status" aria-live="polite">{focusMessage}</div>}
      {section.id === 'performance' && <div className="nord-mark" aria-label="Nord Stage 4 branding"><strong>nord stage 4</strong><span>PERFORMANCE KEYBOARD</span></div>}
    </section>
  )
}

const MORPH_DESTINATIONS = [
  { label: 'Organ Layer A Level', path: 'organ.layers.A.level', max: 1 },
  { label: 'Organ Drawbar 1', path: 'organ.layers.A.drawbars.0', max: 8 },
  { label: 'Organ Rotary Speed', path: 'piano.effects.rotaryRate', max: 1 },
  { label: 'Piano Layer A Level', path: 'piano.layers.A.level', max: 1 },
  { label: 'Synth Layer A Level', path: 'synth.layers.A.level', max: 1 },
  { label: 'Synth LFO Rate', path: 'synth.layers.A.lfoRate', max: 1 },
  { label: 'Synth Osc Ctrl', path: 'synth.layers.A.oscCtrl', max: 1 },
  { label: 'Synth LFO Amount', path: 'synth.layers.A.lfoAmount', max: 1 },
  { label: 'Synth Filter Frequency', path: 'synth.layers.A.cutoff', max: 1 },
  { label: 'Synth Filter Resonance', path: 'synth.layers.A.resonance', max: 1 },
  { label: 'Synth Arpeggiator Rate', path: 'synth.layers.A.arpRate', max: 1 },
  { label: 'Mod 1 Rate', path: 'piano.effects.units.A.mod1.rate', max: 1 },
  { label: 'Mod 1 Amount', path: 'piano.effects.units.A.mod1.amount', max: 1 },
  { label: 'Mod 2 Amount', path: 'piano.effects.units.A.mod2.amount', max: 1 },
  { label: 'Delay Tempo', path: 'piano.effects.units.A.delay.time', max: 1 },
  { label: 'Delay Feedback', path: 'piano.effects.units.A.delay.feedback', max: 1 },
  { label: 'Delay Dry Wet', path: 'piano.effects.units.A.delay.mix', max: 1 },
  { label: 'EQ Mid Frequency', path: 'piano.effects.units.A.ampEq.midFrequency', max: 1 },
  { label: 'Drive Amount', path: 'piano.effects.units.A.ampEq.drive', max: 1 },
  { label: 'Reverb Dry Wet', path: 'piano.effects.units.A.reverb.mix', max: 1 },
]

function morphControlDestination(controlId: string, patch: InstrumentPatch): { path: string; max: number } | null {
  const organLayer = patch.organ.focus
  const synthLayer = patch.synth.focus
  const effectLayer = patch.piano.effects.manualSection === 'Organ' ? 'A' : patch.piano.effects.manualSection === 'Synth' ? (synthLayer === 'B' ? 'B' : 'A') : patch.piano.effects.focus
  if (controlId === 'piano-layer-a-level') return { path: 'piano.layers.A.level', max: 1 }
  if (controlId === 'piano-layer-b-level') return { path: 'piano.layers.B.level', max: 1 }
  if (controlId === 'organ-level') return { path: `organ.layers.${organLayer}.level`, max: 1 }
  if (controlId === 'organ-layer-a-level') return { path: 'organ.layers.A.level', max: 1 }
  if (controlId === 'organ-layer-b-level') return { path: 'organ.layers.B.level', max: 1 }
  if (/^organ-drawbar-[1-9]$/.test(controlId)) return { path: `organ.layers.${organLayer}.drawbars.${Number(controlId.at(-1)) - 1}`, max: 8 }
  if (['performance-rotary-speed', 'performance-rotary-fast', 'performance-rotary-stop'].includes(controlId)) return { path: 'piano.effects.rotaryRate', max: 1 }
  if (controlId === 'effects-rotary-drive') return { path: 'piano.effects.rotaryDrive', max: 1 }
  if (/^synth-layer-[abc]-level$/.test(controlId)) return { path: `synth.layers.${controlId.split('-')[2]!.toUpperCase()}.level`, max: 1 }
  if (controlId === 'synth-oscillator-control') return { path: `synth.layers.${synthLayer}.oscCtrl`, max: 1 }
  if (controlId === 'synth-filter-cutoff') return { path: `synth.layers.${synthLayer}.cutoff`, max: 1 }
  if (controlId === 'synth-filter-resonance') return { path: `synth.layers.${synthLayer}.resonance`, max: 1 }
  if (controlId === 'synth-lfo-rate') return { path: `synth.layers.${synthLayer}.lfoRate`, max: 1 }
  if (controlId === 'synth-lfo-amount') return { path: `synth.layers.${synthLayer}.lfoAmount`, max: 1 }
  if (controlId === 'synth-arp-rate') return { path: `synth.layers.${synthLayer}.arpRate`, max: 1 }
  const effectPaths: Record<string, string> = {
    'effects-effect-1-rate': 'mod1.rate', 'effects-effect-1-depth': 'mod1.amount',
    'effects-effect-2-depth': 'mod2.amount', 'effects-delay-time': 'delay.time', 'effects-delay-tap': 'delay.time',
    'effects-delay-feedback': 'delay.feedback', 'effects-delay-mix': 'delay.mix', 'effects-eq-mid': 'ampEq.mid',
    'effects-eq-mid-frequency': 'ampEq.midFrequency', 'effects-amp-drive': 'ampEq.drive', 'effects-reverb-depth': 'reverb.mix',
  }
  const effectPath = effectPaths[controlId]
  return effectPath ? { path: patch.piano.effects.manualSection === 'Synth' ? `synth.layers.${synthLayer}.effects.${effectPath}` : `piano.effects.units.${effectLayer}.${effectPath}`, max: 1 } : null
}

function recordMorphControl(before: InstrumentPatch, after: InstrumentPatch, controlId: string): void {
  const source = before.morph.assigningSource
  const destination = source ? morphControlDestination(controlId, before) : null
  if (!source || !destination) return
  const oldValue = getPatchPathNumber(before, destination.path)
  const movedValue = getPatchPathNumber(after, destination.path)
  if (oldValue === null || movedValue === null) return
  const position = clamp(before.morph.positions[source], 0, 1)
  let start = oldValue
  let end = oldValue
  if (position <= 0.5) start = (movedValue - oldValue * position) / (1 - position)
  else end = (movedValue - oldValue * (1 - position)) / position
  start = clamp(start, 0, destination.max)
  end = clamp(end, 0, destination.max)
  const assignment: MorphAssignment = { path: destination.path, start, end, value: position }
  after.morph.assignments[source] = [...after.morph.assignments[source].filter((item) => item.path !== destination.path), assignment]
  setPatchPathNumber(after, destination.path, morphValue(assignment, position))
}

function updateSynthEffectControl(patch: InstrumentPatch, controlId: string, nextValue: number, tappedDelayValue?: number): boolean {
  if (controlId === 'effects-piano-group') { patch.piano.effects.group = nextValue > 0; return true }
  if (controlId === 'effects-effects-on') { patch.piano.effects.allBypass = nextValue === 0; return true }
  const unitId: EffectUnitId | null = controlId.startsWith('effects-effect-1-') ? 'mod1'
    : controlId.startsWith('effects-effect-2-') ? 'mod2'
      : controlId.startsWith('effects-amp-') || controlId.startsWith('effects-eq-') ? 'ampEq'
        : controlId.startsWith('effects-delay-') ? 'delay'
          : controlId.startsWith('effects-compressor-') ? 'compressor'
            : controlId.startsWith('effects-reverb-') ? 'reverb' : null
  if (!unitId) return false
  const selected = patch.synth.focus
  const selectedUnit = patch.synth.layers[selected].effects[unitId]
  const allLayers = patch.piano.effects.group || selectedUnit.global || controlId.endsWith('-global')
  const targets: SynthLayerId[] = allLayers ? ['A', 'B', 'C'] : [selected]
  const change = (fields: Partial<EffectUnitState>) => {
    for (const layer of targets) patch.synth.layers[layer].effects[unitId] = { ...patch.synth.layers[layer].effects[unitId], ...fields }
  }
  if (controlId === 'effects-effect-1-rate') change({ rate: nextValue / 100 })
  else if (controlId === 'effects-effect-1-depth') change({ amount: nextValue / 100 })
  else if (controlId === 'effects-effect-1-on') change({ on: nextValue > 0 })
  else if (controlId === 'effects-effect-1-type') change({ type: EFFECT_TYPE_OPTIONS.mod1[Math.round(nextValue)] ?? 'A-Pan' })
  else if (controlId === 'effects-effect-2-rate') change({ rate: nextValue / 100 })
  else if (controlId === 'effects-effect-2-depth') change({ amount: nextValue / 100 })
  else if (controlId === 'effects-effect-2-on') change({ on: nextValue > 0 })
  else if (controlId === 'effects-effect-2-type') change({ type: EFFECT_TYPE_OPTIONS.mod2[Math.round(nextValue)] ?? 'Chorus' })
  else if (controlId === 'effects-amp-mode') {
    const type = EFFECT_TYPE_OPTIONS.ampEq[Math.round(nextValue)] ?? 'EQ only'
    change({ type, on: type === 'To Rotary' || selectedUnit.on })
  } else if (controlId === 'effects-amp-on') change({ on: nextValue > 0 })
  else if (controlId === 'effects-amp-drive') change({ drive: nextValue / 100 })
  else if (controlId === 'effects-eq-bass') change({ bass: nextValue / 100 })
  else if (controlId === 'effects-eq-mid') change({ mid: nextValue / 100 })
  else if (controlId === 'effects-eq-mid-frequency') change({ midFrequency: nextValue / 100 })
  else if (controlId === 'effects-eq-treble') change({ treble: nextValue / 100 })
  else if (controlId === 'effects-delay-time') change({ time: nextValue / 100 })
  else if (controlId === 'effects-delay-tap') { if (tappedDelayValue !== undefined) change({ time: tappedDelayValue / 100 }) }
  else if (controlId === 'effects-delay-feedback') change({ feedback: nextValue / 100 })
  else if (controlId === 'effects-delay-mix') change({ mix: nextValue / 100 })
  else if (controlId === 'effects-delay-filter') change({ filter: (['Off', 'LP', 'HP', 'BP'] as const)[Math.round(nextValue)] ?? 'Off' })
  else if (controlId === 'effects-delay-global') change({ global: nextValue > 0 })
  else if (controlId === 'effects-delay-on') change({ on: nextValue > 0 })
  else if (controlId === 'effects-compressor-amount') change({ amount: nextValue / 100 })
  else if (controlId === 'effects-compressor-fast') change({ fast: nextValue > 0 })
  else if (controlId === 'effects-compressor-global') change({ global: nextValue > 0 })
  else if (controlId === 'effects-compressor-on') change({ on: nextValue > 0 })
  else if (controlId === 'effects-reverb-depth') change({ mix: nextValue / 100 })
  else if (controlId === 'effects-reverb-time') change({ decay: nextValue / 100 })
  else if (controlId === 'effects-reverb-type') change({ type: EFFECT_TYPE_OPTIONS.reverb[Math.round(nextValue)] ?? 'Room' })
  else if (controlId === 'effects-reverb-brightness') change({ brightness: nextValue / 100 })
  else if (controlId === 'effects-reverb-global') change({ global: nextValue > 0 })
  else if (controlId === 'effects-reverb-on') change({ on: nextValue > 0 })
  else return false
  return true
}

function ProgramDisplay({
  modelName, stage3, onProgramAction, onPatchChange, onMorphPosition,
}: {
  modelName: string
  stage3: Stage3State
  onProgramAction: (action: string, value?: string | number) => void
  onPatchChange: (patch: InstrumentPatch) => void
  onMorphPosition: (source: MorphSource, position: number) => void
}) {
  const [toolsOpen, setToolsOpen] = useState(false)
  const [zoneTarget, setZoneTarget] = useState('organ-A')
  const [morphPath, setMorphPath] = useState(MORPH_DESTINATIONS[0]!.path)
  const [morphStart, setMorphStart] = useState(0.2)
  const [morphEnd, setMorphEnd] = useState(0.8)
  const patch = stage3.patch
  const slot = stage3.mode === 'live' ? stage3.liveSlots[stage3.selectedLive]! : stage3.programs[stage3.selectedProgram]!
  const selectedMorph = MORPH_DESTINATIONS.find((destination) => destination.path === morphPath) ?? MORPH_DESTINATIONS[0]!
  const updateSplit = (index: number, field: 'note' | 'crossfade', value: string | number) => {
    const next = clonePatch(patch)
    if (field === 'note') next.splits.points[index]!.note = value as InstrumentPatch['splits']['points'][number]['note']
    else next.splits.points[index]!.crossfade = Number(value) as InstrumentPatch['splits']['points'][number]['crossfade']
    next.splits.points[index]!.enabled = index < next.splits.zoneCount - 1
    onPatchChange(next)
  }
  const updateZone = (field: 'start' | 'end', value: number) => {
    const [engine, layer] = zoneTarget.split('-') as ['piano' | 'organ' | 'synth', 'A' | 'B' | 'C']
    const next = clonePatch(patch)
    if (engine === 'piano') next.pianoZones[layer as 'A' | 'B'][field] = value
    else if (engine === 'organ') next.organ.layers[layer as 'A' | 'B'][field === 'start' ? 'zoneStart' : 'zoneEnd'] = value
    else next.synth.layers[layer as SynthLayerId][field === 'start' ? 'zoneStart' : 'zoneEnd'] = value
    onPatchChange(next)
  }
  const assignMorph = (source: MorphSource) => {
    const next = clonePatch(patch)
    next.morph.assignments[source] = [
      ...next.morph.assignments[source].filter((assignment) => assignment.path !== morphPath),
      { path: morphPath, start: morphStart * selectedMorph.max, end: morphEnd * selectedMorph.max, value: next.morph.positions[source] },
    ]
    onPatchChange(next)
  }
  const confirmStoreName = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onProgramAction('store-as-name', stage3.draftName)
  }
  return (
    <div className="oled-screen program-oled" data-primary-display="program" aria-label="Program OLED, current program and instrument state">
      <span>STAGE 4 · {stage3.mode === 'live' ? `LIVE ${stage3.selectedLive + 1}` : `${Math.floor(stage3.selectedProgram / 8) + 1}.${stage3.selectedProgram % 8 + 1}`}</span>
      <strong>{slot.name}{stage3.dirty ? ' · E' : ''}</strong>
      <small>{modelName} · {patch.organ.layers[patch.organ.focus].model} · {patch.synth.layers[patch.synth.focus].waveform}</small>
      {stage3.storeFlow === 'destination' && <small role="status">Choose a destination, then press STORE again</small>}
      {stage3.storeFlow === 'store-as-destination' && <small role="status">Choose a destination for “{stage3.draftName}”</small>}
      {stage3.storeFlow === 'name' && <form className="program-name-form" onSubmit={confirmStoreName}>
        <input aria-label="Program name" value={stage3.draftName} maxLength={24} onChange={(event) => onProgramAction('draft-name', event.currentTarget.value)} />
        <button type="submit">Set name</button><button type="button" onClick={() => onProgramAction('cancel-store')}>Cancel</button>
      </form>}
      {stage3.listOpen && <label className="program-list-control">Numeric program list
        <select aria-label="Program numeric list" value={stage3.selectedProgram} onChange={(event) => onProgramAction('select-program', Number(event.currentTarget.value))}>
          {stage3.programs.map((program, index) => <option key={index} value={index}>{String(index + 1).padStart(2, '0')} · {program.name}</option>)}
        </select>
      </label>}
      <button type="button" className="program-tools-trigger" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>Split, zones & morph</button>
      {toolsOpen && createPortal(<div className="program-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setToolsOpen(false) }}><section className="program-editors" role="dialog" aria-modal="true" aria-label="Program split, zones and morph editor">
        <header><strong>Program tools</strong><button type="button" aria-label="Close program tools" onClick={() => setToolsOpen(false)}>Close</button></header>
        <fieldset><legend>Split points and zones</legend>
          {[0, 1, 2].map((index) => <label key={index}>Point {index + 1}
            <select aria-label={`Split point ${index + 1}`} value={patch.splits.points[index]!.note} onChange={(event) => updateSplit(index, 'note', event.currentTarget.value)}>
              {['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'].map((note) => <option key={note}>{note}</option>)}
            </select>
            <select aria-label={`Split crossfade ${index + 1}`} value={patch.splits.points[index]!.crossfade} onChange={(event) => updateSplit(index, 'crossfade', event.currentTarget.value)}>
              <option value="0">Off</option><option value="6">±6</option><option value="12">±12</option>
            </select>
          </label>)}
          <label>Zones <select aria-label="Split zone count" value={patch.splits.zoneCount} onChange={(event) => { const next = clonePatch(patch); next.splits.zoneCount = Number(event.currentTarget.value) as 1 | 2 | 3 | 4; next.splits.points.forEach((point, index) => { point.enabled = index < next.splits.zoneCount - 1 }); onPatchChange(next) }}>
            {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
          </select></label>
          <label>Layer zone <select aria-label="Zone assignment layer" value={zoneTarget} onChange={(event) => setZoneTarget(event.currentTarget.value)}>
            {['piano-A', 'piano-B', 'organ-A', 'organ-B', 'synth-A', 'synth-B', 'synth-C'].map((target) => <option key={target}>{target}</option>)}
          </select></label>
          <label>From <select aria-label="Layer zone start" value={zoneTarget.startsWith('piano') ? patch.pianoZones[zoneTarget.endsWith('B') ? 'B' : 'A'].start : zoneTarget.startsWith('organ') ? patch.organ.layers[zoneTarget.endsWith('B') ? 'B' : 'A'].zoneStart : patch.synth.layers[zoneTarget.endsWith('C') ? 'C' : zoneTarget.endsWith('B') ? 'B' : 'A'].zoneStart} onChange={(event) => updateZone('start', Number(event.currentTarget.value))}>{[0, 1, 2, 3].map((zone) => <option key={zone} value={zone}>{zone + 1}</option>)}</select></label>
          <label>To <select aria-label="Layer zone end" value={zoneTarget.startsWith('piano') ? patch.pianoZones[zoneTarget.endsWith('B') ? 'B' : 'A'].end : zoneTarget.startsWith('organ') ? patch.organ.layers[zoneTarget.endsWith('B') ? 'B' : 'A'].zoneEnd : patch.synth.layers[zoneTarget.endsWith('C') ? 'C' : zoneTarget.endsWith('B') ? 'B' : 'A'].zoneEnd} onChange={(event) => updateZone('end', Number(event.currentTarget.value))}>{[0, 1, 2, 3].map((zone) => <option key={zone} value={zone}>{zone + 1}</option>)}</select></label>
        </fieldset>
        <fieldset><legend>Morph assignment</legend>
          <label>Destination <select aria-label="Morph destination" value={morphPath} onChange={(event) => setMorphPath(event.currentTarget.value)}>{MORPH_DESTINATIONS.map((destination) => <option key={destination.path} value={destination.path}>{destination.label}</option>)}</select></label>
          <label>Start <input aria-label="Morph start value" type="range" min="0" max="100" value={morphStart * 100} onChange={(event) => setMorphStart(Number(event.currentTarget.value) / 100)} /></label>
          <label>End <input aria-label="Morph end value" type="range" min="0" max="100" value={morphEnd * 100} onChange={(event) => setMorphEnd(Number(event.currentTarget.value) / 100)} /></label>
          <button type="button" onClick={() => assignMorph('Wheel')}>Assign Wheel</button><button type="button" onClick={() => assignMorph('Control Pedal')}>Assign Control Pedal</button>
          <button type="button" onClick={() => onProgramAction('clear-morph', 'Wheel')}>Clear Wheel</button><button type="button" onClick={() => onProgramAction('clear-morph', 'Control Pedal')}>Clear Pedal</button>
          <label>Control Pedal <input aria-label="Control Pedal position" type="range" min="0" max="100" value={patch.morph.positions['Control Pedal'] * 100} onChange={(event) => onMorphPosition('Control Pedal', Number(event.currentTarget.value) / 100)} /></label>
        </fieldset>
      </section></div>, document.body)}
    </div>
  )
}

function SynthDisplay({ state }: { state: InstrumentPatch['synth']['layers'][SynthLayerId] }) {
  return (
    <div className="oled-screen synth-oled" data-primary-display="synth" aria-label="Synth OLED showing selected oscillator and envelope">
      <span>ANALOG · {state.category}</span>
      <strong>{state.waveform}</strong>
      <small>{state.filterType} · CUTOFF {Math.round(state.cutoff * 100)} · LFO {state.lfoWaveform}</small>
    </div>
  )
}

function PianoKey({
  keyDefinition,
  pressed,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onKeyboardDown,
  onKeyboardUp,
}: {
  keyDefinition: KeyDefinition
  pressed: boolean
  onPointerDown: (key: KeyDefinition, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyboardDown: (key: KeyDefinition, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onKeyboardUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  const style = keyDefinition.color === 'black'
    ? { left: `${(keyDefinition.blackKeyOffset ?? 0) / 43 * 100}%` }
    : { left: `${keyDefinition.whiteIndex / 43 * 100}%`, width: `${100 / 43}%` }

  return (
    <button
      type="button"
      className={`piano-key key-${keyDefinition.color}${pressed ? ' is-pressed' : ''}`}
      data-key-id={keyDefinition.id}
      data-midi={keyDefinition.midi}
      data-key-color={keyDefinition.color}
      aria-label={`${keyDefinition.note} piano key`}
      aria-pressed={pressed}
      style={style}
      onPointerDown={(event) => onPointerDown(keyDefinition, event)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onKeyDown={(event) => onKeyboardDown(keyDefinition, event)}
      onKeyUp={onKeyboardUp}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}

function PianoKeybed({
  pressedMidi,
  patch,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onKeyboardDown,
  onKeyboardUp,
}: {
  pressedMidi: Record<number, number>
  patch: InstrumentPatch
  onPointerDown: (key: KeyDefinition, event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyboardDown: (key: KeyDefinition, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onKeyboardUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  return (
    <section className="keybed" aria-label="73-key hammer action keybed, E2 to E8" data-key-count={KEY_MODEL.length}>
      <div className="keybed-inner" role="group" aria-label="73-key keyboard, E2 to E8">
        {patch.splits.enabled && patch.splits.zoneCount > 1 && <div className="split-markers" aria-label="Active split points">
          {patch.splits.points.filter((point) => point.enabled).map((point, index) => {
            const midi = SPLIT_MIDI[point.note]
            const key = KEY_MODEL.find((item) => item.midi === midi)
            const left = key ? key.whiteIndex / (WHITE_KEY_COUNT - 1) * 100 : midi < KEY_MODEL[0]!.midi ? 0 : 100
            return <span key={`${point.note}-${index}`} className="split-marker" data-split-note={point.note} aria-label={`Split ${index + 1} at ${point.note}${point.crossfade ? `, ±${point.crossfade}` : ''}`} style={{ left: `${left}%` }}><i />{index + 1}</span>
          })}
        </div>}
        {KEY_MODEL.filter((key) => key.color === 'white').map((key) => (
          <PianoKey key={key.id} keyDefinition={key} pressed={(pressedMidi[key.midi] ?? 0) > 0} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyboardDown={onKeyboardDown} onKeyboardUp={onKeyboardUp} />
        ))}
        {KEY_MODEL.filter((key) => key.color === 'black').map((key) => (
          <PianoKey key={key.id} keyDefinition={key} pressed={(pressedMidi[key.midi] ?? 0) > 0} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyboardDown={onKeyboardDown} onKeyboardUp={onKeyboardUp} />
        ))}
      </div>
    </section>
  )
}

function midiFactoryErrorIsDenied(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'NotAllowedError' || error.name === 'SecurityError' : error instanceof Error && /denied|not allowed|permission/i.test(error.message)
}

export default function App({ audioOutputFactory = createPianoOutput, midiAccessFactory = midiFactoryFromBrowser }: AppProps) {
  const output = useMemo(audioOutputFactory, [audioOutputFactory])
  const lifecycle = useMemo(() => new NoteLifecycle(output, 32), [output])
  const [hardware, setHardware] = useState(INITIAL_HARDWARE_STATE)
  const [stage3, setStage3] = useState<Stage3State>(() => {
    const base = defaultConfiguration()
    try { return readStage3State(window.localStorage.getItem(STAGE3_STORAGE_KEY), base) } catch { return readStage3State(null, base) }
  })
  const [audioConfiguration, setAudioConfiguration] = useState<AudioConfiguration>(() => ({
    ...stage3.patch.piano,
    masterLevel: defaultConfiguration().masterLevel,
  }))
  const audioConfigurationRef = useRef(audioConfiguration)
  audioConfigurationRef.current = audioConfiguration
  const stage3Ref = useRef(stage3)
  stage3Ref.current = stage3
  const [pressedMidi, setPressedMidi] = useState<Record<number, number>>({})
  const [audioState, setAudioState] = useState<AudioState>('loading')
  const [audioError, setAudioError] = useState('')
  const [midiState, setMidiState] = useState<MidiState>('disconnected')
  const [midiError, setMidiError] = useState('')
  const [sustainDown, setSustainDown] = useState(false)
  const sourceNotes = useRef(new Map<string, number>())
  const stage3RouteNotes = useRef(new Map<string, string[]>())
  const stage3SustainedIds = useRef(new Set<string>())
  const arpHeldNotes = useRef(new Map<string, { midi: number; velocity: number; routes: string[] }>())
  const arpStepIndices = useRef(new Map<SynthLayerId, number>())
  const arpTimers = useRef(new Map<SynthLayerId, number>())
  const pointerNotes = useRef(new Map<number, string>())
  const keybedNotes = useRef(new Map<string, string>())
  const computerNotes = useRef(new Map<string, string>())
  const midiNotes = useRef(new Map<string, string[]>())
  const midiSourceIds = useRef(new Map<string, Set<string>>())
  const midiSustainSources = useRef(new Set<string>())
  const sustainSources = useRef(new Set<string>())
  const sustainLayerRouting = useRef<LayerId[]>([])
  const midiSequence = useRef(0)
  const delayTapTime = useRef<number | null>(null)
  const clockTapTime = useRef<number | null>(null)
  const clockTapIntervals = useRef<number[]>([])
  const pendingMorphControl = useRef('')
  const [programPage, setProgramPage] = useState(Math.floor(stage3.selectedProgram / 8))
  const programPageRef = useRef(programPage)
  programPageRef.current = programPage
  const midiAccess = useRef<MidiAccessLike | null>(null)
  const midiHandlers = useRef(new Map<string, (event: MidiMessageLike) => void>())
  const midiStateHandler = useRef<((event: MidiStateChangeLike) => void) | null>(null)

  const commitStage3 = useCallback((next: Stage3State) => {
    stage3Ref.current = next
    setStage3(next)
    const configuration = { ...next.patch.piano, masterLevel: audioConfigurationRef.current.masterLevel } as AudioConfiguration
    if (JSON.stringify(configuration) !== JSON.stringify(audioConfigurationRef.current)) {
      audioConfigurationRef.current = configuration
      setAudioConfiguration(configuration)
    }
    setHardware((current) => stage3HardwareState(current, next, programPageRef.current))
  }, [])

  const commitPatch = useCallback((patch: InstrumentPatch) => commitStage3(editPatch(stage3Ref.current, patch)), [commitStage3])

  const tickArpeggiator = useCallback((layerId: SynthLayerId) => {
    const patch = stage3Ref.current.patch
    const state = patch.synth.layers[layerId]
    const route = `synth-${layerId}`
    const voiceId = `arp:${layerId}`
    const notes = [...arpHeldNotes.current.values()].filter((note) => note.routes.includes(route))
    if (!state.enabled || !state.arpRun || !['Arp', 'Gate'].includes(state.arpMode) || notes.length === 0) {
      output.noteOffStage3?.(voiceId, 0.018, [route])
      arpStepIndices.current.set(layerId, 0)
      return
    }
    const sequence = buildArpeggioSequence(notes.map((note) => note.midi), state.arpRange, state.arpDirection)
    if (!sequence.length) return
    const step = arpStepIndices.current.get(layerId) ?? 0
    const midi = sequence[step % sequence.length]!
    arpStepIndices.current.set(layerId, step + 1)
    output.noteOffStage3?.(voiceId, 0.012, [route])
    output.noteOnStage3?.(voiceId, midi, Math.max(...notes.map((note) => note.velocity)), [route], patch)
  }, [output])

  const enabledLayers = useCallback((midi: number): { layers: LayerId[]; gains: Partial<Record<LayerId, number>> } => {
    const patch = stage3Ref.current.patch
    const zoneGains = zoneGainsForNote(midi + patch.transpose, patch.splits)
    const layers = patch.piano.sectionOn ? (['A', 'B'] as LayerId[]).filter((layer) => {
      const zone = patch.pianoZones[layer]
      return patch.piano.layers[layer].enabled && Object.entries(zoneGains).some(([index, gain]) => Number(index) >= zone.start && Number(index) <= zone.end && gain > 0.0001)
    }) : []
    const gains: Partial<Record<LayerId, number>> = {}
    for (const layer of layers) {
      const zone = patch.pianoZones[layer]
      gains[layer] = Math.max(0, ...Object.entries(zoneGains).filter(([index]) => Number(index) >= zone.start && Number(index) <= zone.end).map(([, gain]) => gain))
    }
    return { layers, gains }
  }, [])

  const applySustainRouting = useCallback((isDown: boolean) => {
    const current = audioConfigurationRef.current
    const next = isDown && current.sectionOn
      ? (['A', 'B'] as LayerId[]).filter((layer) => current.layers[layer].enabled && current.layers[layer].sustainPedal)
      : []
    const previous = sustainLayerRouting.current
    const released = previous.filter((layer) => !next.includes(layer))
    const added = next.filter((layer) => !previous.includes(layer))
    if (released.length > 0) lifecycle.setSustain(false, released)
    if (added.length > 0) lifecycle.setSustain(true, added)
    sustainLayerRouting.current = next
  }, [lifecycle])

  const startNote = useCallback((id: string, midi: number, velocity: number) => {
    sourceNotes.current.set(id, midi)
    setPressedMidi((current) => ({ ...current, [midi]: (current[midi] ?? 0) + 1 }))
    try {
      const routes = activeRoutesForPatch(stage3Ref.current.patch, midi + stage3Ref.current.patch.transpose)
      const pianoRoutes = enabledLayers(midi)
      lifecycle.noteOn(id, midi + stage3Ref.current.patch.transpose, velocity, pianoRoutes.layers, pianoRoutes.gains)
      const patch = stage3Ref.current.patch
      const heldMidis = [...sourceNotes.current].filter(([noteId]) => noteId !== id).map(([, note]) => note)
      const instrumentRoutes = routes.filter((route) => {
        if (route.startsWith('piano-')) return false
        if (!route.startsWith('synth-') || heldMidis.length === 0) return true
        const layer = patch.synth.layers[route.endsWith('-C') ? 'C' : route.endsWith('-B') ? 'B' : 'A']
        if (layer.priority === 'Low') return midi <= Math.min(...heldMidis)
        if (layer.priority === 'High') return midi >= Math.max(...heldMidis)
        return true
      })
      const arpRoutes = instrumentRoutes.filter((route) => {
        if (!route.startsWith('synth-')) return false
        const layer = patch.synth.layers[route.endsWith('-C') ? 'C' : route.endsWith('-B') ? 'B' : 'A']
        return layer.arpRun && (layer.arpMode === 'Arp' || layer.arpMode === 'Gate')
      })
      const directRoutes = instrumentRoutes.filter((route) => !arpRoutes.includes(route))
      stage3RouteNotes.current.set(id, directRoutes)
      if (directRoutes.length) output.noteOnStage3?.(id, midi, velocity, directRoutes, patch)
      if (arpRoutes.length) arpHeldNotes.current.set(id, { midi, velocity, routes: arpRoutes })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The piano voice could not start.'
      setAudioState(/unavailable/i.test(message) ? 'fallback' : 'error')
      setAudioError(message)
    }
  }, [enabledLayers, lifecycle, output])

  const releaseNote = useCallback((id: string) => {
    const midi = sourceNotes.current.get(id)
    if (midi === undefined) return
    sourceNotes.current.delete(id)
    lifecycle.noteOff(id)
    const arpNotes = arpHeldNotes.current.get(id)
    if (arpNotes) {
      const patch = stage3Ref.current.patch
      const held = arpNotes.routes.filter((route) => patch.synth.layers[route.endsWith('-C') ? 'C' : route.endsWith('-B') ? 'B' : 'A'].arpHold)
      if (held.length) arpHeldNotes.current.set(id, { ...arpNotes, routes: held })
      else arpHeldNotes.current.delete(id)
    }
    const currentPatch = stage3Ref.current.patch
    const routes = stage3RouteNotes.current.get(id) ?? []
    const sustainIsDown = sustainSources.current.size > 0
    const sustained = routes.filter((route) => sustainIsDown && (route.startsWith('organ-')
      ? currentPatch.organ.layers[route.endsWith('-B') ? 'B' : 'A'].sustainPedal
      : currentPatch.synth.layers[route.endsWith('-C') ? 'C' : route.endsWith('-B') ? 'B' : 'A'].sustainPedal))
    const released = routes.filter((route) => !sustained.includes(route))
    if (released.length) output.noteOffStage3?.(id, undefined, released)
    if (sustained.length) {
      stage3RouteNotes.current.set(id, sustained)
      stage3SustainedIds.current.add(id)
    } else {
      stage3RouteNotes.current.delete(id)
      stage3SustainedIds.current.delete(id)
    }
    setPressedMidi((current) => {
      const nextCount = (current[midi] ?? 1) - 1
      if (nextCount <= 0) {
        const next = { ...current }
        delete next[midi]
        return next
      }
      return { ...current, [midi]: nextCount }
    })
  }, [lifecycle, output])

  const setSustainSource = useCallback((id: string, isDown: boolean) => {
    if (isDown) sustainSources.current.add(id)
    else sustainSources.current.delete(id)
    const down = sustainSources.current.size > 0
    applySustainRouting(down)
    setSustainDown(down)
    const patch = stage3Ref.current.patch
    for (const noteId of stage3SustainedIds.current) {
      const routes = stage3RouteNotes.current.get(noteId) ?? []
      const released = routes.filter((route) => !down || !(route.startsWith('organ-')
        ? patch.organ.layers[route.endsWith('-B') ? 'B' : 'A'].sustainPedal
        : patch.synth.layers[route.endsWith('-C') ? 'C' : route.endsWith('-B') ? 'B' : 'A'].sustainPedal))
      if (released.length) output.noteOffStage3?.(noteId, undefined, released)
      const held = routes.filter((route) => !released.includes(route))
      if (held.length) stage3RouteNotes.current.set(noteId, held)
      else {
        stage3RouteNotes.current.delete(noteId)
        stage3SustainedIds.current.delete(noteId)
      }
    }
  }, [applySustainRouting, output])

  const releaseAll = useCallback(() => {
    sourceNotes.current.clear()
    stage3RouteNotes.current.clear()
    stage3SustainedIds.current.clear()
    arpHeldNotes.current.clear()
    pointerNotes.current.clear()
    keybedNotes.current.clear()
    computerNotes.current.clear()
    midiNotes.current.clear()
    midiSourceIds.current.clear()
    midiSustainSources.current.clear()
    sustainSources.current.clear()
    sustainLayerRouting.current = []
    setPressedMidi({})
    setSustainDown(false)
    lifecycle.allNotesOff()
  }, [lifecycle])

  const disconnectMidiPort = useCallback((portId: string) => {
    const prefix = `${portId}:`
    for (const [key, ids] of midiNotes.current) {
      if (!key.startsWith(prefix)) continue
      ids.forEach(releaseNote)
      midiNotes.current.delete(key)
    }
    midiSourceIds.current.delete(portId)
    for (const source of midiSustainSources.current) {
      if (source.startsWith(`midi:${portId}:`)) {
        midiSustainSources.current.delete(source)
        setSustainSource(source, false)
      }
    }
    let connected = false
    for (const [id, input] of midiAccess.current?.inputs ?? []) {
      if (id !== portId && input.state === 'connected') connected = true
    }
    if (!connected) setMidiState('disconnected')
  }, [releaseNote, setSustainSource])

  const handleMidiMessage = useCallback((portId: string, event: MidiMessageLike) => {
    const [status = 0, data1 = 0, data2 = 0] = event.data
    const command = status & 0xf0
    const channel = status & 0x0f
    if (command === 0x90 && data2 > 0) {
      const key = `${portId}:${channel}:${data1}`
      const id = `midi:${key}:${midiSequence.current++}`
      const notes = midiNotes.current.get(key) ?? []
      notes.push(id)
      midiNotes.current.set(key, notes)
      const portNotes = midiSourceIds.current.get(portId) ?? new Set<string>()
      portNotes.add(id)
      midiSourceIds.current.set(portId, portNotes)
      startNote(id, data1, data2)
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      const key = `${portId}:${channel}:${data1}`
      const notes = midiNotes.current.get(key)
      const id = notes?.shift()
      if (id) {
        releaseNote(id)
        midiSourceIds.current.get(portId)?.delete(id)
      }
      if (notes && notes.length === 0) midiNotes.current.delete(key)
    } else if (command === 0xb0 && data1 === 64) {
      const source = `midi:${portId}:${channel}`
      const down = data2 >= 64
      if (down) midiSustainSources.current.add(source)
      else midiSustainSources.current.delete(source)
      setSustainSource(source, down)
    } else if (command === 0xb0 && data1 === 11) {
      const patch = clonePatch(stage3Ref.current.patch)
      const position = data2 / 127
      patch.morph.positions['Control Pedal'] = position
      for (const assignment of patch.morph.assignments['Control Pedal']) {
        assignment.value = position
        setPatchPathNumber(patch, assignment.path, morphValue(assignment, position))
      }
      commitPatch(patch)
    }
  }, [commitPatch, releaseNote, setSustainSource, startNote])

  const connectMidi = useCallback(async () => {
    setMidiState('connecting')
    setMidiError('')
    try {
      const access = await midiAccessFactory()
      midiAccess.current = access
      for (const [id, input] of access.inputs) {
        if (input.state === 'disconnected') continue
        const handler = (event: MidiMessageLike) => handleMidiMessage(id, event)
        input.onmidimessage = handler
        midiHandlers.current.set(id, handler)
      }
      const stateHandler = (event: MidiStateChangeLike) => {
        const port = event.port
        if (!port || port.type === 'output') return
        const id = port.id ?? ''
        if (port.state === 'disconnected') disconnectMidiPort(id)
        else if (port.state === 'connected') setMidiState('connected')
      }
      access.addEventListener?.('statechange', stateHandler)
      midiStateHandler.current = stateHandler
      setMidiState('connected')
    } catch (error) {
      if (midiFactoryErrorIsDenied(error)) setMidiState('denied')
      else if (error instanceof Error && /not supported/i.test(error.message)) setMidiState('unavailable')
      else setMidiState('unavailable')
      setMidiError(error instanceof Error ? error.message : 'Web MIDI connection failed.')
    }
  }, [disconnectMidiPort, handleMidiMessage, midiAccessFactory])

  const updateMorphPosition = (source: MorphSource, position: number) => {
    const patch = clonePatch(stage3Ref.current.patch)
    const bounded = clamp(position, 0, 1)
    patch.morph.positions[source] = bounded
    for (const assignment of patch.morph.assignments[source]) {
      assignment.value = bounded
      setPatchPathNumber(patch, assignment.path, morphValue(assignment, bounded))
    }
    commitPatch(patch)
  }

  const handleProgramAction = (action: string, value?: string | number) => {
    const current = stage3Ref.current
    if (action === 'select-program') {
      const index = Number(value)
      if (current.storeFlow === 'destination' || current.storeFlow === 'store-as-destination') {
        programPageRef.current = Math.floor(index / 8)
        setProgramPage(programPageRef.current)
        commitStage3({ ...current, selectedProgram: index, dirty: true })
      } else {
        const next = selectProgram(current, index)
        programPageRef.current = Math.floor(index / 8)
        setProgramPage(programPageRef.current)
        commitStage3(next)
      }
    } else if (action === 'select-live') {
      commitStage3(selectLive(current, Number(value)))
    } else if (action === 'toggle-list') {
      commitStage3({ ...current, listOpen: !current.listOpen })
    } else if (action === 'store') {
      if (current.storeFlow === 'destination' || current.storeFlow === 'store-as-destination') {
        commitStage3(storeProgram(current, current.selectedProgram, current.storeFlow === 'store-as-destination' ? current.draftName : undefined))
      } else commitStage3({ ...current, storeFlow: 'destination', draftName: '' })
    } else if (action === 'store-as') {
      commitStage3({ ...current, storeFlow: 'name', draftName: current.mode === 'live' ? current.liveSlots[current.selectedLive]!.name : current.programs[current.selectedProgram]!.name })
    } else if (action === 'store-as-name') {
      commitStage3({ ...current, storeFlow: 'store-as-destination', draftName: String(value ?? '').trim().slice(0, 24) || `Program ${current.selectedProgram + 1}` })
    } else if (action === 'draft-name') {
      commitStage3({ ...current, draftName: String(value ?? '').slice(0, 24) })
    } else if (action === 'cancel-store') {
      commitStage3({ ...current, storeFlow: 'idle', draftName: '' })
    } else if (action === 'clear-morph') {
      const patch = clonePatch(current.patch)
      patch.morph.assignments[value as MorphSource] = []
      if (patch.morph.assigningSource === value) patch.morph.assigningSource = null
      commitPatch(patch)
    }
  }

  const changeProgramButton = (slot: number) => {
    const current = stage3Ref.current
    const index = programPage * 8 + slot
    if (current.storeFlow === 'destination' || current.storeFlow === 'store-as-destination') {
      commitStage3({ ...current, selectedProgram: index, dirty: true })
    } else if (current.mode === 'live') commitStage3(selectLive(current, slot))
    else {
      const next = selectProgram(current, index)
      programPageRef.current = Math.floor(index / 8)
      setProgramPage(programPageRef.current)
      commitStage3(next)
    }
  }

  const changeStage3Control = (control: ControlDefinition, nextValue: number): boolean => {
    const id = control.id
    const currentPatch = stage3Ref.current.patch
    const patch = clonePatch(stage3Ref.current.patch)
    const updateOrganLayer = (layerId: 'A' | 'B', update: (layer: InstrumentPatch['organ']['layers']['A']) => void) => update(patch.organ.layers[layerId])
    const updateSynthLayer = (layerId: SynthLayerId, update: (layer: InstrumentPatch['synth']['layers'][SynthLayerId]) => void) => update(patch.synth.layers[layerId])
    const updateSceneEnabled = (route: string, enabled: boolean) => { patch.scenes.enabled[patch.scenes.active][route] = enabled }
    if (id.startsWith('organ-')) {
      const focus = patch.organ.focus
      if (id === 'organ-section-on') patch.organ.sectionOn = nextValue > 0
      else if (id === 'organ-layer-a' || id === 'organ-layer-b') {
        const layer = id.endsWith('-b') ? 'B' : 'A'; patch.organ.layers[layer].enabled = nextValue > 0; updateSceneEnabled(`organ-${layer}`, nextValue > 0)
      } else if (id === 'organ-layer-a-focus' || id === 'organ-layer-b-focus') patch.organ.focus = id.endsWith('-b-focus') ? 'B' : 'A'
      else if (id === 'organ-layer-a-level' || id === 'organ-layer-b-level') updateOrganLayer(id.includes('layer-b') ? 'B' : 'A', (layer) => { layer.level = nextValue / 100 })
      else if (id === 'organ-level') updateOrganLayer(focus, (layer) => { layer.level = nextValue / 100 })
      else if (id.endsWith('-octave-up') || id.endsWith('-octave-down')) {
        const layer = id.includes('layer-b') ? 'B' : 'A'; updateOrganLayer(layer, (state) => { state.octave = clamp(state.octave + (id.endsWith('-up') ? 1 : -1), -1, 1) as -1 | 0 | 1 })
      } else if (id.startsWith('organ-model-')) {
        const model = id.endsWith('-b3') ? 'B3' : id.endsWith('-vox') ? 'Vox' : id.endsWith('-farfisa') ? 'Farf' : 'Pipe 1'
        updateOrganLayer(focus, (layer) => { layer.model = model })
      } else if (id.startsWith('organ-drawbar-')) {
        const index = Number(id.slice('organ-drawbar-'.length)) - 1
        updateOrganLayer(focus, (layer) => { layer.drawbars[index] = Math.round(nextValue / 100 * 8) })
      } else if (id === 'organ-percussion-on') updateOrganLayer(focus, (layer) => { layer.percussionOn = nextValue > 0 })
      else if (id === 'organ-percussion-soft') updateOrganLayer(focus, (layer) => { layer.percussionSoft = nextValue > 0 })
      else if (id === 'organ-percussion-fast') updateOrganLayer(focus, (layer) => { layer.percussionFast = nextValue > 0 })
      else if (id === 'organ-percussion-third') updateOrganLayer(focus, (layer) => { layer.percussionThird = nextValue > 0 })
      else if (id === 'organ-key-click') updateOrganLayer(focus, (layer) => { layer.keyClick = nextValue > 0 })
      else if (id === 'organ-vibrato-on') updateOrganLayer(focus, (layer) => { layer.vibratoOn = nextValue > 0 })
      else if (id === 'organ-vibrato-mode') updateOrganLayer(focus, (layer) => { layer.vibratoMode = (['C1', 'C2', 'C3', 'V1', 'V2', 'V3'] as const)[Math.round(nextValue)] ?? 'C1' })
      else if (id === 'organ-sustain-pedal') updateOrganLayer(focus, (layer) => { layer.sustainPedal = nextValue > 0 })
      else if (id === 'organ-rotary-route') patch.organ.rotaryRoute = nextValue > 0
      else return false
      recordMorphControl(currentPatch, patch, id)
      commitPatch(patch)
      return true
    }
    if (id.startsWith('synth-')) {
      const focus = patch.synth.focus
      const focused = patch.synth.layers[focus]
      if (/^synth-layer-[abc]$/.test(id)) {
        const layer = id.endsWith('-c') ? 'C' : id.endsWith('-b') ? 'B' : 'A'; patch.synth.layers[layer].enabled = nextValue > 0; updateSceneEnabled(`synth-${layer}`, nextValue > 0)
      } else if (id === 'synth-focus-a' || id === 'synth-focus-b' || id === 'synth-focus-c') patch.synth.focus = id.endsWith('-c') ? 'C' : id.endsWith('-b') ? 'B' : 'A'
      else if (/^synth-layer-[abc]-level$/.test(id)) { const layer = id.includes('-c-') ? 'C' : id.includes('-b-') ? 'B' : 'A'; updateSynthLayer(layer, (state) => { state.level = nextValue / 100 }) }
      else if (/^synth-layer-[abc]-octave-(up|down)$/.test(id)) { const layer = id.includes('-c-') ? 'C' : id.includes('-b-') ? 'B' : 'A'; updateSynthLayer(layer, (state) => { state.octave = clamp(state.octave + (id.endsWith('-up') ? 1 : -1), -1, 1) as -1 | 0 | 1 }) }
      else if (id === 'synth-oscillator-category' || id === 'synth-oscillator-shape') {
        const categories = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H'] as const
        const category = categories[clamp(Math.round(id.endsWith('shape') ? nextValue / 25 : nextValue), 0, categories.length - 1)]!
        focused.category = category
        focused.waveform = SYNTH_WAVEFORMS[category][0]!
      } else if (id === 'synth-oscillator-wave') {
        const waves = SYNTH_WAVEFORMS[focused.category]
        focused.waveform = waves[Math.round(clamp(nextValue, 0, 100) / 100 * Math.max(0, waves.length - 1))]!
      } else if (id === 'synth-oscillator-control') focused.oscCtrl = nextValue / 100
      else if (id === 'synth-oscillator-pitch') focused.pitch = Math.round((nextValue - 50) / 50 * 24)
      else if (id === 'synth-oscillator-fine') focused.fine = Math.round((nextValue - 50) / 50 * 50)
      else if (id === 'synth-oscillator-sub') focused.subLevel = nextValue / 100
      else if (id === 'synth-oscillator-noise') focused.noiseLevel = nextValue / 100
      else if (id === 'synth-filter-cutoff') focused.cutoff = nextValue / 100
      else if (id === 'synth-filter-resonance') focused.resonance = nextValue / 100
      else if (id === 'synth-filter-drive') focused.drive = Math.round(nextValue / 100 * 3) as 0 | 1 | 2 | 3
      else if (id === 'synth-filter-envelope') focused.filterEnvelope.amount = nextValue / 100
      else if (id === 'synth-filter-type') focused.filterType = (['LP12', 'LP24', 'HP', 'BP'] as const)[Math.round(nextValue)] ?? 'LP24'
      else if (id === 'synth-filter-tracking') focused.tracking = Math.round(nextValue) as 0 | 1 | 2 | 3
      else if (id.startsWith('synth-amp-')) {
        const key = id.slice('synth-amp-'.length)
        if (key === 'attack' || key === 'decay' || key === 'sustain' || key === 'release' || key === 'amount') focused.amplifierEnvelope[key] = nextValue / 100
      } else if (id.startsWith('synth-osc-')) {
        const key = id.slice('synth-osc-'.length)
        if (key === 'env-velocity') focused.oscillatorEnvelope.velocity = nextValue > 0
        else if (key === 'env-to-pitch') focused.oscillatorEnvelope.toPitch = nextValue > 0
        else if (key === 'env-amount') focused.oscillatorEnvelope.amount = nextValue / 100
        else if (key === 'attack' || key === 'decay' || key === 'release') focused.oscillatorEnvelope[key] = nextValue / 100
        else return false
      } else if (id.startsWith('synth-filter-env-')) {
        const key = id.slice('synth-filter-env-'.length)
        if (key === 'velocity') focused.filterEnvelope.velocity = nextValue > 0
        else if (key === 'attack' || key === 'decay' || key === 'sustain' || key === 'release') focused.filterEnvelope[key] = nextValue / 100
        else return false
      } else if (id.startsWith('synth-mod-')) {
        const key = id.slice('synth-mod-'.length)
        if (key === 'attack' || key === 'decay' || key === 'sustain' || key === 'release') focused.oscillatorEnvelope[key] = nextValue / 100
        else return false
      } else if (id === 'synth-lfo-rate') focused.lfoRate = nextValue / 100
      else if (id === 'synth-lfo-amount') focused.lfoAmount = nextValue / 100
      else if (id === 'synth-lfo-waveform') focused.lfoWaveform = (['Triangle', 'Saw down', 'Saw up', 'Square', 'Sample & Hold'] as const)[Math.round(nextValue)] ?? 'Triangle'
      else if (id === 'synth-lfo-destination') focused.lfoDestination = (['Off', 'Osc Pitch', 'Osc Ctrl', 'Filter Freq'] as const)[Math.round(nextValue)] ?? 'Off'
      else if (id === 'synth-lfo-sync') focused.lfoSync = nextValue > 0
      else if (id === 'synth-voice-mode') focused.voiceMode = (['Poly', 'Mono', 'Legato'] as const)[Math.round(nextValue)] ?? 'Poly'
      else if (id === 'synth-voice-priority') focused.priority = (['Off', 'Low', 'High'] as const)[Math.round(nextValue)] ?? 'Off'
      else if (id === 'synth-glide') focused.glide = nextValue / 100
      else if (id === 'synth-unison') focused.unison = Math.round(nextValue) as 0 | 1 | 2 | 3
      else if (id === 'synth-vibrato-mode') focused.vibratoMode = nextValue > 0 ? 'On' : 'Wheel'
      else if (id === 'synth-vibrato-rate') focused.vibratoRate = nextValue / 100
      else if (id === 'synth-vibrato-amount') focused.vibratoAmount = nextValue / 100
      else if (id === 'synth-arp-mode') focused.arpMode = (['Off', 'Arp', 'Poly', 'Gate'] as const)[Math.round(nextValue)] ?? 'Off'
      else if (id === 'synth-arp-rate') focused.arpRate = nextValue / 100
      else if (id === 'synth-arp-range') focused.arpRange = (Math.round(nextValue) + 1) as 1 | 2 | 3 | 4
      else if (id === 'synth-arp-direction') focused.arpDirection = (['Up', 'Down', 'Up/Down', 'Random'] as const)[Math.round(nextValue)] ?? 'Up'
      else if (id === 'synth-arp-hold') focused.arpHold = nextValue > 0
      else if (id === 'synth-arp-on') focused.arpRun = nextValue > 0
      else return false
      recordMorphControl(currentPatch, patch, id)
      commitPatch(patch)
      return true
    }
    if (id === 'performance-modulation-wheel') { updateMorphPosition('Wheel', nextValue / 100); return true }
    if (id === 'performance-control-pedal') { updateMorphPosition('Control Pedal', nextValue / 100); return true }
    if (id === 'program-program-dial') {
      const target = Math.round(nextValue / 100 * 31)
      handleProgramAction('select-program', target)
      return true
    }
    if (id.startsWith('program-program-')) { changeProgramButton(Number(id.slice('program-program-'.length)) - 1); return true }
    if (id === 'program-page-up' || id === 'program-page-down') {
      const page = clamp(programPage + (id.endsWith('up') ? 1 : -1), 0, 3)
      programPageRef.current = page
      setProgramPage(page)
      if (stage3Ref.current.mode === 'program') commitStage3({ ...stage3Ref.current, selectedProgram: page * 8 + stage3Ref.current.selectedProgram % 8 })
      return true
    }
    if (id === 'program-live-mode') {
      const current = stage3Ref.current
      if (current.mode === 'live') commitStage3(selectProgram(current, current.selectedProgram))
      else commitStage3(selectLive(current, current.selectedLive))
      return true
    }
    if (id === 'program-layer-scene') {
      const scene = stage3Ref.current.patch.scenes.active === 'I' ? 'II' : 'I'
      patch.scenes.enabled[patch.scenes.active] = {
        'piano-A': patch.piano.layers.A.enabled, 'piano-B': patch.piano.layers.B.enabled,
        'organ-A': patch.organ.layers.A.enabled, 'organ-B': patch.organ.layers.B.enabled,
        'synth-A': patch.synth.layers.A.enabled, 'synth-B': patch.synth.layers.B.enabled, 'synth-C': patch.synth.layers.C.enabled,
      }
      patch.scenes.active = scene
      const enabled = patch.scenes.enabled[scene]
      for (const layer of ['A', 'B'] as const) { patch.piano.layers[layer].enabled = enabled[`piano-${layer}`] ?? false; patch.organ.layers[layer].enabled = enabled[`organ-${layer}`] ?? false }
      for (const layer of ['A', 'B', 'C'] as const) patch.synth.layers[layer].enabled = enabled[`synth-${layer}`] ?? false
      commitPatch(patch)
      return true
    }
    if (id === 'program-store') { handleProgramAction('store'); return true }
    if (id === 'program-store-as') { handleProgramAction('store-as'); return true }
    if (id === 'program-list-view') { handleProgramAction('toggle-list'); return true }
    if (id === 'program-split') {
      patch.splits.enabled = nextValue > 0
      if (patch.splits.enabled && patch.splits.zoneCount === 1) {
        patch.splits.zoneCount = 2
        patch.splits.points[0]!.note = 'C4'
        patch.splits.points[0]!.enabled = true
        patch.pianoZones.A = { start: 0, end: 0 }
        patch.pianoZones.B = { start: 1, end: 1 }
      }
      commitPatch(patch)
      return true
    }
    if (id === 'program-zone-count') { patch.splits.zoneCount = (Math.round(nextValue) + 1) as 1 | 2 | 3 | 4; patch.splits.points.forEach((point, index) => { point.enabled = index < patch.splits.zoneCount - 1 }); commitPatch(patch); return true }
    if (id === 'program-clock-tempo') { patch.clockBpm = Math.round(30 + nextValue / 100 * 270); commitPatch(patch); return true }
    if (id === 'program-clock-tap') {
      const now = Date.now(); const previous = clockTapTime.current; clockTapTime.current = now
      if (previous !== null) {
        clockTapIntervals.current = [...clockTapIntervals.current.slice(-3), clamp(now - previous, 200, 2000)]
        if (clockTapIntervals.current.length >= 3) { const bpm = 60_000 / (clockTapIntervals.current.reduce((sum, value) => sum + value, 0) / clockTapIntervals.current.length); patch.clockBpm = Math.round(clamp(bpm, 30, 300)); commitPatch(patch) }
      }
      return true
    }
    if (id === 'program-clock-sync') { patch.clockSync = nextValue > 0; commitPatch(patch); return true }
    if (id === 'performance-transpose-up' || id === 'performance-transpose-down') { patch.transpose = clamp(patch.transpose + (id.endsWith('up') ? 1 : -1), -6, 6); commitPatch(patch); return true }
    if (id === 'program-morph-wheel' || id === 'program-morph-control') {
      const source: MorphSource = id.endsWith('wheel') ? 'Wheel' : 'Control Pedal'
      patch.morph.assigningSource = nextValue > 0 ? source : null
      commitPatch(patch)
      return true
    }
    if (id === 'program-morph-aftertouch') return true
    if (id === 'program-panic') { releaseAll(); return true }
    return false
  }

  const changeControl = (control: ControlDefinition, next: number) => {
    const cycle = CONTROL_CYCLES[control.id]
    const isDelayTap = control.id === 'effects-delay-tap'
    const momentary = control.id.endsWith('-octave-up') || control.id.endsWith('-octave-down') || isDelayTap
    const selectingLayerA = control.id === 'effects-focus-a' || control.id === 'piano-layer-a-focus'
    const selectingLayerB = control.id === 'effects-focus-b' || control.id === 'piano-layer-b-focus'
    const resyncEffectPanel = selectingLayerA || selectingLayerB || control.id === 'effects-focus-piano'
    let tappedDelayValue: number | undefined
    if (isDelayTap) {
      const now = Date.now()
      const previous = delayTapTime.current
      delayTapTime.current = now
      if (previous !== null) {
        const seconds = clamp((now - previous) / 1000, 0.08, 0.98)
        tappedDelayValue = Math.round(((seconds - 0.08) / 0.9) * 100)
      }
    }
    const typeSelection = control.id.startsWith('piano-type-')
      ? (['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as PianoType[]).find((type) => type.toLowerCase() === control.id.slice('piano-type-'.length))
      : undefined
    setHardware((current) => {
      const nextHardware = { ...current, [control.id]: cycle ? clamp(Math.round(next), 0, cycle.length - 1) : momentary ? 0 : clamp(next, control.min, control.max) }
      if (typeSelection) {
        for (const type of ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const) nextHardware[`piano-type-${type.toLowerCase()}`] = type === typeSelection ? 1 : 0
      }
      if (tappedDelayValue !== undefined) nextHardware['effects-delay-time'] = tappedDelayValue
      if (control.id === 'performance-rotary-on' || control.id === 'effects-rotary-on') {
        nextHardware['performance-rotary-on'] = next > 0 ? 1 : 0
        nextHardware['effects-rotary-on'] = next > 0 ? 1 : 0
      }
      if (control.id === 'performance-rotary-fast') {
        nextHardware['performance-rotary-fast'] = next > 0 ? 1 : 0
        nextHardware['performance-rotary-stop'] = 0
        nextHardware['performance-rotary-speed'] = next > 0 ? 92 : 35
      } else if (control.id === 'performance-rotary-stop') {
        nextHardware['performance-rotary-stop'] = next > 0 ? 1 : 0
        nextHardware['performance-rotary-fast'] = 0
        nextHardware['performance-rotary-speed'] = next > 0 ? 0 : 35
      } else if (control.id === 'performance-rotary-speed') {
        nextHardware['performance-rotary-stop'] = 0
        nextHardware['performance-rotary-fast'] = next >= 60 ? 1 : 0
      }
      if (control.id === 'effects-focus-a' || control.id === 'effects-focus-b' || control.id === 'piano-layer-a-focus' || control.id === 'piano-layer-b-focus') {
        const selectingA = control.id.endsWith('-a') || control.id.endsWith('-a-focus')
        nextHardware['effects-focus-a'] = selectingA ? 1 : 0
        nextHardware['effects-focus-b'] = selectingA ? 0 : 1
        nextHardware['piano-layer-a-focus'] = selectingA ? 1 : 0
        nextHardware['piano-layer-b-focus'] = selectingA ? 0 : 1
        nextHardware['effects-focus-piano'] = 1
      }
      if (control.id === 'effects-focus-organ' || control.id === 'effects-focus-piano' || control.id === 'effects-focus-synth') {
        for (const section of ['organ', 'piano', 'synth']) nextHardware[`effects-focus-${section}`] = control.id.endsWith(section) ? 1 : 0
      }
      if (resyncEffectPanel) {
        const focus = selectingLayerA ? 'A' : selectingLayerB ? 'B' : audioConfigurationRef.current.effects.focus
        Object.assign(nextHardware, effectHardwareState(nextHardware, audioConfigurationRef.current, focus))
      }
      if (momentary) nextHardware[control.id] = 0
      return nextHardware
    })
    if (typeSelection && typeSelection !== 'Electric' && audioConfigurationRef.current.performance.timbre.startsWith('Dyno')) {
      setHardware((current) => ({ ...current, 'piano-timbre': 0 }))
    }
    if (changeStage3Control(control, next)) return
    const currentPatch = stage3Ref.current.patch
    if (control.section === 'effects' && currentPatch.piano.effects.manualSection === 'Synth') {
      const patch = clonePatch(currentPatch)
      if (updateSynthEffectControl(patch, control.id, next, tappedDelayValue)) {
        recordMorphControl(currentPatch, patch, control.id)
        commitPatch(patch)
        return
      }
    }
    const performanceAudioControl = ['performance-master-level', 'performance-pitch-stick', 'performance-rotary-on', 'performance-rotary-speed', 'performance-rotary-fast', 'performance-rotary-stop'].includes(control.id)
    if (control.section !== 'piano' && control.section !== 'effects' && !performanceAudioControl) return
    pendingMorphControl.current = control.id
    setAudioConfiguration((current) => {
      const nextConfiguration: AudioConfiguration = {
        ...current,
        layers: { A: { ...current.layers.A }, B: { ...current.layers.B } },
        performance: { ...current.performance },
        effects: {
          ...current.effects,
          units: {
            A: Object.fromEntries(Object.entries(current.effects.units.A).map(([id, state]) => [id, { ...state }])) as AudioConfiguration['effects']['units']['A'],
            B: Object.fromEntries(Object.entries(current.effects.units.B).map(([id, state]) => [id, { ...state }])) as AudioConfiguration['effects']['units']['B'],
          },
        },
      }
      const focusedLayer = current.effects.focus
      const setLayer = (layer: LayerId, change: Partial<AudioConfiguration['layers'][LayerId]>) => {
        nextConfiguration.layers[layer] = { ...nextConfiguration.layers[layer], ...change }
      }
      const targetsFor = (unit: EffectUnitId): LayerId[] => {
        if (current.effects.group || current.effects.units[focusedLayer][unit].global) return ['A', 'B']
        if (current.effects.manualSection === 'Piano') return [focusedLayer]
        if (current.effects.manualSection === 'Organ') return ['A']
        return stage3Ref.current.patch.synth.focus === 'B' ? ['B'] : ['A']
      }
      const setUnit = (unit: EffectUnitId, change: Partial<EffectUnitState>, targets = targetsFor(unit)) => {
        for (const layer of targets) nextConfiguration.effects.units[layer][unit] = { ...nextConfiguration.effects.units[layer][unit], ...change }
      }
      if (control.id === 'performance-master-level') nextConfiguration.masterLevel = clamp(next, 0, 100) / 100
      else if (control.id === 'performance-pitch-stick') nextConfiguration.pitchBend = ((clamp(next, 0, 100) - 50) / 50) * 2
      else if (control.id === 'piano-model-selector') nextConfiguration.modelVariant = clamp(Math.round(next / 50), 0, 2) as 0 | 1 | 2
      else if (control.id === 'piano-section-on') nextConfiguration.sectionOn = next > 0
      else if (control.id === 'piano-layer-a') setLayer('A', { enabled: next > 0 })
      else if (control.id === 'piano-layer-b') setLayer('B', { enabled: next > 0 })
      else if (control.id === 'piano-layer-a-level') setLayer('A', { level: clamp(next, 0, 100) / 100 })
      else if (control.id === 'piano-layer-b-level') setLayer('B', { level: clamp(next, 0, 100) / 100 })
      else if (control.id === 'piano-layer-a-octave-up') setLayer('A', { octave: clamp(current.layers.A.octave + 1, -1, 1) })
      else if (control.id === 'piano-layer-a-octave-down') setLayer('A', { octave: clamp(current.layers.A.octave - 1, -1, 1) })
      else if (control.id === 'piano-layer-b-octave-up') setLayer('B', { octave: clamp(current.layers.B.octave + 1, -1, 1) })
      else if (control.id === 'piano-layer-b-octave-down') setLayer('B', { octave: clamp(current.layers.B.octave - 1, -1, 1) })
      else if (control.id === 'piano-sustain-pedal') {
        setLayer('A', { sustainPedal: next > 0 })
        setLayer('B', { sustainPedal: next > 0 })
      } else if (control.id === 'piano-pitch-stick-enable') {
        setLayer('A', { pitchStick: next > 0 })
        setLayer('B', { pitchStick: next > 0 })
      } else if (typeSelection) {
        nextConfiguration.pianoType = typeSelection
        nextConfiguration.modelVariant = 0
        if (typeSelection !== 'Electric' && current.performance.timbre.startsWith('Dyno')) {
          nextConfiguration.performance.timbre = 'Off'
        }
      } else if (control.id === 'piano-kb-touch') nextConfiguration.performance.touch = (['Heavy', 'Medium', 'Light'] as const)[Math.round(next)] ?? 'Medium'
      else if (control.id === 'piano-dyn-comp') nextConfiguration.performance.dynComp = clamp(Math.round(next), 0, 3) as 0 | 1 | 2 | 3
      else if (control.id === 'piano-timbre') nextConfiguration.performance.timbre = (['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const)[Math.round(next)] ?? 'Off'
      else if (control.id === 'piano-unison') nextConfiguration.performance.unison = clamp(Math.round(next), 0, 3) as 0 | 1 | 2 | 3
      else if (control.id === 'piano-soft-release') nextConfiguration.performance.softRelease = next > 0
      else if (control.id === 'piano-string-res') nextConfiguration.performance.stringRes = next > 0
      else if (control.id === 'effects-focus-a' || control.id === 'effects-focus-b' || control.id === 'piano-layer-a-focus' || control.id === 'piano-layer-b-focus') {
        nextConfiguration.effects.focus = control.id.endsWith('-a') || control.id.endsWith('-a-focus') ? 'A' : 'B'
        nextConfiguration.effects.manualSection = 'Piano'
      } else if (control.id === 'effects-focus-organ' || control.id === 'effects-focus-piano' || control.id === 'effects-focus-synth') {
        nextConfiguration.effects.manualSection = control.id.endsWith('organ') ? 'Organ' : control.id.endsWith('synth') ? 'Synth' : 'Piano'
      } else if (control.id === 'effects-piano-group') nextConfiguration.effects.group = next > 0
      else if (control.id === 'effects-effects-on') nextConfiguration.effects.allBypass = next === 0
      else if (control.id === 'performance-rotary-on' || control.id === 'effects-rotary-on') nextConfiguration.effects.rotaryOn = next > 0
      else if (control.id === 'performance-rotary-speed') {
        nextConfiguration.effects.rotaryRate = clamp(next, 0, 100) / 100
        nextConfiguration.effects.rotarySpeed = next >= 60 ? 'Fast' : 'Slow'
      } else if (control.id === 'performance-rotary-fast') {
        nextConfiguration.effects.rotaryRate = next > 0 ? 0.92 : 0.35
        nextConfiguration.effects.rotarySpeed = next > 0 ? 'Fast' : 'Slow'
      } else if (control.id === 'performance-rotary-stop') {
        nextConfiguration.effects.rotaryRate = next > 0 ? 0 : 0.35
        nextConfiguration.effects.rotarySpeed = next > 0 ? 'Stop' : 'Slow'
      }
      else if (control.id === 'effects-rotary-drive') nextConfiguration.effects.rotaryDrive = clamp(next, 0, 100) / 100
      else if (control.id === 'effects-effect-1-rate') setUnit('mod1', { rate: next / 100 })
      else if (control.id === 'effects-effect-1-depth') setUnit('mod1', { amount: next / 100 })
      else if (control.id === 'effects-effect-1-on') setUnit('mod1', { on: next > 0 })
      else if (control.id === 'effects-effect-1-type') setUnit('mod1', { type: EFFECT_TYPE_OPTIONS.mod1[Math.round(next)] ?? 'A-Pan' })
      else if (control.id === 'effects-effect-2-rate') setUnit('mod2', { rate: next / 100 })
      else if (control.id === 'effects-effect-2-depth') setUnit('mod2', { amount: next / 100 })
      else if (control.id === 'effects-effect-2-on') setUnit('mod2', { on: next > 0 })
      else if (control.id === 'effects-effect-2-type') setUnit('mod2', { type: EFFECT_TYPE_OPTIONS.mod2[Math.round(next)] ?? 'Chorus' })
      else if (control.id === 'effects-amp-mode') {
        const type = EFFECT_TYPE_OPTIONS.ampEq[Math.round(next)] ?? 'EQ only'
        setUnit('ampEq', { type, on: type === 'To Rotary' || current.effects.units[focusedLayer].ampEq.on })
      } else if (control.id === 'effects-amp-on') setUnit('ampEq', { on: next > 0 })
      else if (control.id === 'effects-amp-drive') setUnit('ampEq', { drive: next / 100 })
      else if (control.id === 'effects-eq-bass') setUnit('ampEq', { bass: next / 100 })
      else if (control.id === 'effects-eq-mid') setUnit('ampEq', { mid: next / 100 })
      else if (control.id === 'effects-eq-mid-frequency') setUnit('ampEq', { midFrequency: next / 100 })
      else if (control.id === 'effects-eq-treble') setUnit('ampEq', { treble: next / 100 })
      else if (control.id === 'effects-delay-time') setUnit('delay', { time: next / 100 })
      else if (control.id === 'effects-delay-tap' && tappedDelayValue !== undefined) setUnit('delay', { time: tappedDelayValue / 100 })
      else if (control.id === 'effects-delay-feedback') setUnit('delay', { feedback: next / 100 })
      else if (control.id === 'effects-delay-mix') setUnit('delay', { mix: next / 100 })
      else if (control.id === 'effects-delay-filter') setUnit('delay', { filter: (['Off', 'LP', 'HP', 'BP'] as const)[Math.round(next)] ?? 'Off' })
      else if (control.id === 'effects-delay-global') setUnit('delay', { global: next > 0 }, ['A', 'B'])
      else if (control.id === 'effects-delay-on') setUnit('delay', { on: next > 0 })
      else if (control.id === 'effects-compressor-amount') setUnit('compressor', { amount: next / 100 })
      else if (control.id === 'effects-compressor-fast') setUnit('compressor', { fast: next > 0 })
      else if (control.id === 'effects-compressor-global') setUnit('compressor', { global: next > 0 }, ['A', 'B'])
      else if (control.id === 'effects-compressor-on') setUnit('compressor', { on: next > 0 })
      else if (control.id === 'effects-reverb-depth') setUnit('reverb', { mix: next / 100 })
      else if (control.id === 'effects-reverb-time') setUnit('reverb', { decay: next / 100 })
      else if (control.id === 'effects-reverb-type') setUnit('reverb', { type: EFFECT_TYPE_OPTIONS.reverb[Math.round(next)] ?? 'Room' })
      else if (control.id === 'effects-reverb-brightness') setUnit('reverb', { brightness: next / 100 })
      else if (control.id === 'effects-reverb-global') setUnit('reverb', { global: next > 0 }, ['A', 'B'])
      else if (control.id === 'effects-reverb-on') setUnit('reverb', { on: next > 0 })
      return nextConfiguration
    })
  }

  const onPointerDown = useCallback((key: KeyDefinition, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const pointerId = event.pointerId ?? 0
    const old = pointerNotes.current.get(pointerId)
    if (old) releaseNote(old)
    const id = `pointer:${pointerId}`
    pointerNotes.current.set(pointerId, id)
    try { event.currentTarget.setPointerCapture(pointerId) } catch { /* Pointer capture is not available in every browser. */ }
    startNote(id, key.midi, 96)
  }, [releaseNote, startNote])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointerId = event.pointerId ?? 0
    const id = pointerNotes.current.get(pointerId)
    if (id) releaseNote(id)
    pointerNotes.current.delete(pointerId)
  }, [releaseNote])

  const onPointerCancel = onPointerUp

  const onKeybedDown = useCallback((key: KeyDefinition, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return
    event.preventDefault()
    const token = `${key.id}:${event.key}`
    if (keybedNotes.current.has(token)) return
    const id = `keybed:${token}`
    keybedNotes.current.set(token, id)
    startNote(id, key.midi, 96)
  }, [startNote])

  const onKeybedUp = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const token = `${(event.currentTarget as HTMLButtonElement).dataset.keyId}:${event.key}`
    const id = keybedNotes.current.get(token)
    if (id) releaseNote(id)
    keybedNotes.current.delete(token)
  }, [releaseNote])

  useEffect(() => {
    try {
      output.configure?.(audioConfiguration)
    } catch (error) {
      setAudioState('fallback')
      setAudioError(error instanceof Error ? error.message : 'Web Audio is unavailable; generated source fallback remains playable')
    }
  }, [audioConfiguration, output])

  useEffect(() => {
    output.configureStage3?.(stage3.patch)
  }, [output, stage3.patch])

  useEffect(() => {
    const active = new Set<SynthLayerId>()
    for (const layer of ['A', 'B', 'C'] as const) {
      const state = stage3.patch.synth.layers[layer]
      if (state.enabled && state.arpRun && (state.arpMode === 'Arp' || state.arpMode === 'Gate')) active.add(layer)
    }
    for (const [layer, timer] of arpTimers.current) {
      window.clearInterval(timer)
      if (!active.has(layer)) {
        output.noteOffStage3?.(`arp:${layer}`, 0.018, [`synth-${layer}`])
        arpTimers.current.delete(layer)
        arpStepIndices.current.set(layer, 0)
      }
    }
    const subdivisions = [0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12, 0.75, 1]
    for (const layer of active) {
      const state = stage3.patch.synth.layers[layer]
      const beat = 60_000 / (stage3.patch.clockSync ? stage3.patch.clockBpm : 40 + state.arpRate * 260)
      const interval = stage3.patch.clockSync ? beat * subdivisions[Math.round(state.arpRate * (subdivisions.length - 1))]! : beat
      const timer = window.setInterval(() => tickArpeggiator(layer), Math.max(35, interval))
      arpTimers.current.set(layer, timer)
    }
    return () => {
      for (const timer of arpTimers.current.values()) window.clearInterval(timer)
      arpTimers.current.clear()
    }
  }, [output, stage3.patch.clockBpm, stage3.patch.clockSync, stage3.patch.synth, tickArpeggiator])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { persistStage3State(window.localStorage, stage3) } catch { /* Storage may be unavailable in a private browser context. */ }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [stage3])

  useEffect(() => {
    const piano = Object.fromEntries(Object.entries(audioConfiguration).filter(([key]) => key !== 'masterLevel')) as Omit<AudioConfiguration, 'masterLevel'>
    const controlId = pendingMorphControl.current
    pendingMorphControl.current = ''
    if (JSON.stringify(piano) === JSON.stringify(stage3Ref.current.patch.piano)) return
    const currentPatch = stage3Ref.current.patch
    const nextPatch = clonePatch(currentPatch)
    nextPatch.piano = piano
    nextPatch.scenes.enabled[nextPatch.scenes.active]['piano-A'] = piano.layers.A.enabled
    nextPatch.scenes.enabled[nextPatch.scenes.active]['piano-B'] = piano.layers.B.enabled
    recordMorphControl(currentPatch, nextPatch, controlId)
    const next = editPatch(stage3Ref.current, nextPatch)
    stage3Ref.current = next
    setStage3(next)
    setHardware((current) => stage3HardwareState(current, next, programPage))
  }, [audioConfiguration, programPage])

  useEffect(() => {
    setHardware((current) => stage3HardwareState(current, stage3, programPage))
  }, [programPage])

  useEffect(() => {
    let current = true
    setAudioError('')
    if (!output.prepare) {
      setAudioState('ready')
      return () => { current = false }
    }
    setAudioState('loading')
    void output.prepare(audioConfiguration.pianoType).then((result) => {
      if (!current) return
      setAudioState(result)
      if (result === 'fallback') setAudioError(`${audioConfiguration.pianoType} sample files could not load; generated synthesis remains playable`)
    }).catch((error: unknown) => {
      if (!current) return
      setAudioState('fallback')
      setAudioError(error instanceof Error ? error.message : 'Sample files could not load; generated synthesis remains playable')
    })
    return () => { current = false }
  }, [audioConfiguration.pianoType, output])

  useEffect(() => {
    applySustainRouting(sustainSources.current.size > 0)
  }, [audioConfiguration, applySustainRouting])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (!event.repeat) setSustainSource('computer-sustain', true)
        return
      }
      const midi = COMPUTER_KEY_MAP[event.code]
      if (midi === undefined || event.repeat || computerNotes.current.has(event.code)) return
      const id = `computer:${event.code}`
      computerNotes.current.set(event.code, id)
      startNote(id, midi, 88)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSustainSource('computer-sustain', false)
        return
      }
      const id = computerNotes.current.get(event.code)
      if (id) releaseNote(id)
      computerNotes.current.delete(event.code)
    }
    const onBlur = () => releaseAll()
    const onVisibility = () => { if (document.visibilityState === 'hidden') releaseAll() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const [id, handler] of midiHandlers.current) {
        const input = midiAccess.current?.inputs.get(id)
        if (input?.onmidimessage === handler) input.onmidimessage = null
      }
      if (midiStateHandler.current) midiAccess.current?.removeEventListener?.('statechange', midiStateHandler.current)
      lifecycle.allNotesOff()
      output.dispose()
    }
  }, [lifecycle, output, releaseAll, releaseNote, setSustainSource, startNote])

  const toggleUiSustain = () => setSustainSource('ui-sustain', !sustainSources.current.has('ui-sustain'))
  const audioLabel = audioState === 'ready'
    ? output.prepare
      ? ['Grand', 'Upright', 'Electric'].includes(audioConfiguration.pianoType)
        ? `Ready · bundled ${audioConfiguration.pianoType} recordings`
        : `Ready · generated ${audioConfiguration.pianoType} synthesis`
      : 'Ready · injected test audio output'
    : audioState === 'loading'
      ? `Loading ${audioConfiguration.pianoType} sound…`
    : audioState === 'fallback'
        ? `Fallback · ${audioError || 'Web Audio is unavailable; note keys still respond'}`
        : `Audio error · ${audioError || 'check browser audio permission'}`
  const midiLabel: Record<MidiState, string> = {
    disconnected: 'MIDI disconnected', connecting: 'MIDI connecting…', connected: 'MIDI connected', denied: 'MIDI permission denied', unavailable: 'MIDI unavailable',
  }

  return (
    <main className="stage-page">
      <header className="page-heading">
        <span className="page-model">NORD STAGE 4</span>
        <span className="variant-tag">73 · HAMMER ACTION</span>
      </header>
      <div className="instrument" data-instrument="stage-4-73" aria-label="Nord Stage 4 73">
        <div className="instrument-top-rail" aria-hidden="true">
          <span>PROGRAM</span><span>ORGAN</span><span>PIANO</span><span>PERFORMANCE</span><span>SYNTH</span><span>LAYER EFFECTS</span>
        </div>
        <div className="deck-sections">
          {SECTIONS.map((section) => <InstrumentSection key={section.id} section={section} hardware={hardware} audioConfiguration={audioConfiguration} stage3={stage3} onControlChange={changeControl} onProgramAction={handleProgramAction} onPatchChange={commitPatch} onMorphPosition={updateMorphPosition} />)}
        </div>
        <div className="deck-front-rail" aria-hidden="true"><span>NORD STAGE 4</span><span>73</span></div>
        <PianoKeybed
          pressedMidi={pressedMidi}
          patch={stage3.patch}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyboardDown={onKeybedDown}
          onKeyboardUp={onKeybedUp}
        />
      </div>
      <footer className="instrument-status">
        <span className={`status-light audio-${audioState}`} aria-label={`Audio status: ${audioState}`} />
        <span className="audio-status" role="status" aria-live="polite">{audioLabel}</span>
        <button type="button" className={`pedal-switch${sustainDown ? ' is-active' : ''}`} aria-label="Sustain pedal" aria-pressed={sustainDown} onClick={toggleUiSustain}>
          <span className="button-lamp" aria-hidden="true" />
          <span>SUSTAIN</span>
        </button>
        <span className={`midi-status midi-${midiState}`} role="status" aria-live="polite">{midiLabel[midiState]}</span>
        <button type="button" className="midi-connect" onClick={() => void connectMidi()} disabled={midiState === 'connecting'}>
          {midiState === 'connected' ? 'Reconnect MIDI' : 'Connect MIDI'}
        </button>
        {midiError && <span className="midi-error" aria-live="polite">{midiError}</span>}
        <span className="keyboard-hint">A W S E D F T G H U J I K · hold Space for sustain</span>
      </footer>
      <div className="unsupported-note">Unsupported by spec: Program banks beyond one 32-slot bank, the 512-program layout, Organize move/swap, Organ/Piano/Synth preset libraries, aftertouch morph, Num Pad, Monitor/Copy/Paste/Swap, Section Edit, Layer Init, Aux KB, Extern, memory protection, Shift menus, external MIDI clock, and pedal tap; piano pedal noise, half-pedaling, Triple Pedal configuration, size classes, INFO, and Sound Manager downloads; effect variations, Reverb Chorale, delay feedback-loop modes, Analog delay, Pump/Wah pedal modes, rotary close mic/stop angle, and post-rotary global reverb; Organ Drawbar Live/sync, swell pedal, tonewheel wear, trigger point, and rotary tuning menus; Synth MIDI-out, pattern editing, zig-zag, accent, pan, per-layer KB Hold, Group modes, and sample downloads. Other visible controls update canonical program, engine, routing, or audio state.</div>
    </main>
  )
}
