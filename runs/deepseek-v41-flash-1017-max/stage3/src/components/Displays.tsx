import { VARIANT } from '../hardware/variant'
import { keybedRangeLabel } from '../hardware/keybed'
import type { MidiStatusReport } from '../input/midi'
import type { PianoSnapshot } from '../audio/noteSession'
import type { PianoState } from '../audio/pianoState'
import type { OrganState } from '../audio/organState'
import type { SynthState } from '../audio/synthState'
import type { EffectState } from '../audio/effectState'
import { modelById, timbreLabelFor, typeLabel } from '../audio/pianoLibrary'
import { effectiveChain } from '../audio/effectState'
import type { LibraryStatus } from '../audio/webAudioEngine'
import { organModelLabel } from '../audio/organModel'
import { categoryForWaveform } from '../audio/synthModel'
import type { ProgramSnapshot } from '../audio/programStore'
import type { ProgramState } from '../audio/programState'

/**
 * The two OLEDs.
 *
 * They are the only displays on the instrument (visual spec: Program and Synth are the only
 * primary OLED locations; the performance band and the effects band carry none).
 *
 * Both are truthful by construction. The Program display prints the real program slot and
 * name, the real dirty state, the real piano/organ/synth selection, the real FX focus, the
 * real split and scene, and the real sample-library state — and nothing it does not. The
 * Synth display prints the selected waveform, its category and its Osc Ctrl meaning, which
 * is what the hardware's synth OLED shows.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteLabel(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

function audioLine(snapshot: PianoSnapshot): { label: string; tone: string } {
  const { status } = snapshot.audio
  switch (status) {
    case 'ready':
      return { label: 'AUDIO READY', tone: 'ok' }
    case 'loading':
      return { label: 'AUDIO LOADING', tone: 'warn' }
    case 'suspended':
      return { label: 'AUDIO SUSPENDED', tone: 'warn' }
    case 'fallback':
      return { label: 'NO AUDIO OUTPUT', tone: 'warn' }
    case 'error':
      return { label: 'AUDIO ERROR', tone: 'bad' }
    default:
      return { label: 'AUDIO IDLE', tone: 'warn' }
  }
}

function midiLine(midi: MidiStatusReport): { label: string; tone: string } {
  switch (midi.state) {
    case 'ready':
      return { label: `MIDI ${midi.inputCount} IN`, tone: 'ok' }
    case 'denied':
      return { label: 'MIDI DENIED', tone: 'warn' }
    case 'disconnected':
      return { label: 'MIDI LOST', tone: 'warn' }
    case 'unsupported':
      return { label: 'NO WEB MIDI', tone: 'warn' }
    case 'error':
      return { label: 'MIDI ERROR', tone: 'bad' }
    case 'requesting':
      return { label: 'MIDI…', tone: 'warn' }
    default:
      return { label: 'MIDI IDLE', tone: 'warn' }
  }
}

/** The library line: says "recorded" only when a recording is really loaded. */
function libraryLine(library: LibraryStatus): { label: string; tone: string } {
  switch (library.state) {
    case 'ready':
      return { label: library.loadedFiles > 0 ? 'SAMPLES READY' : 'MODELLED', tone: 'ok' }
    case 'loading':
      return { label: 'LOADING SAMPLES', tone: 'warn' }
    case 'fallback':
      return { label: 'PIANO NOT FOUND', tone: 'bad' }
    case 'error':
      return { label: 'PIANO NOT FOUND', tone: 'bad' }
    default:
      return { label: 'LIBRARY IDLE', tone: 'warn' }
  }
}

export interface ProgramDisplayProps {
  snapshot: PianoSnapshot
  midi: MidiStatusReport
  /** Number of physical keys currently under a pointer or key. */
  heldCount: number
  piano?: PianoState
  organ?: OrganState
  synth?: SynthState
  /** Layer Effects state, for the real FX focus readout. */
  effects?: EffectState
  /** Truthful piano-library status. */
  library?: LibraryStatus
  /** The program system's snapshot: slot, name, dirty flag, store flow. */
  programs?: ProgramSnapshot
  /** The live program state, for split and scene readouts. */
  program?: ProgramState
}

/**
 * Primary program OLED. Reads the real engine, MIDI, voice, piano, organ, synth, effect and
 * program state.
 */
export function ProgramDisplay({
  snapshot,
  midi,
  heldCount,
  piano,
  organ,
  synth,
  effects,
  library,
  programs,
  program,
}: ProgramDisplayProps) {
  const audio = audioLine(snapshot)
  const midiStatus = midiLine(midi)
  const sounding = snapshot.sounding
  const focusedLayer = piano?.layers[piano.focused]
  const model = focusedLayer ? modelById(focusedLayer.model) : undefined

  // The model line names the selected piano model and its *declared* source. Synthesised
  // model names already end in "(modelled)", so the suffix is only printed for recordings.
  const sourceWord = model ? (model.source === 'recorded' ? 'recorded' : '') : ''
  const voiceLine =
    sounding.length === 0 ? 'Idle' : `${sounding.length} voice${sounding.length === 1 ? '' : 's'}`
  const lib = library ? libraryLine(library) : null

  // The slot line, exactly as the hardware prints it: "3.2 Tine Stack", plus the E
  // indicator the manual describes when the program has been edited.
  const slotLine = programs
    ? `${programSlotLabel(programs)} ${programs.name}${programs.dirty ? ' · E' : ''}`
    : null
  const bankLine = programs ? (programs.liveMode ? 'LIVE' : `BANK 1 · PAGE ${programs.page}`) : 'PHASE 3'

  const focusChip = effects ? `${effectFocusLabel(effects)}${effects.pianoGroup ? ' GRP' : ''}` : ''
  const engines = [
    piano?.sectionOn ? 'PIANO' : null,
    organ?.sectionOn ? 'ORGAN' : null,
    synth?.sectionOn ? 'SYNTH' : null,
  ].filter(Boolean)
  const splitChip = program
    ? program.split.on
      ? `SPLIT ${program.split.points.Low.position}/${program.split.points.Mid.position}/${program.split.points.High.position}`
      : 'SPLIT OFF'
    : null
  const sceneChip = program ? `SCENE ${program.scenes.second ? 'II' : 'I'}` : null
  const transposeChip =
    program && program.transposeOn
      ? `TRANSP ${program.transpose > 0 ? '+' : ''}${program.transpose}`
      : null

  return (
    <div
      className="oled glass-program"
      data-testid="program-display"
      data-display-id="program.display"
      data-display-root="true"
      role="status"
      // Only state transitions are announced. A live region that re-announced on every
      // key press would read a wall of text at a player, so the region is polite and
      // carries the stable status line rather than the per-note readout.
      aria-live="polite"
      aria-atomic="false"
      aria-label={`Program display: ${slotLine ?? ''}. ${audio.label}. ${midiStatus.label}. ${snapshot.audio.detail}${
        model ? `. Piano ${model.name}, ${model.source === 'recorded' ? 'recorded' : 'modelled'}` : ''
      }`}
    >
      <div className="glass-row glass-head">
        <span className="glass-bank" data-testid="program-bank-line">
          {bankLine}
        </span>
        <span className={`glass-status tone-${audio.tone}`}>{audio.label}</span>
      </div>
      {slotLine ? (
        <div className="glass-title" data-testid="program-slot-line">
          <span>{slotLine}</span>
        </div>
      ) : (
        <div className="glass-title">
          <span>{VARIANT.fullName}</span>
        </div>
      )}
      <div className="glass-row glass-voice">
        <span className="glass-icon" aria-hidden="true">
          {piano?.sectionOn ? 'PIANO' : organ?.sectionOn ? 'ORGAN' : 'SYNTH'}
        </span>
        <span className="glass-value" data-testid="piano-model-line">
          {piano?.sectionOn
            ? model
              ? `${typeLabel(model.type)} · ${model.name}${sourceWord ? ` (${sourceWord})` : ''}`
              : 'Modelled piano'
            : organ?.sectionOn
              ? `${organModelLabel(organ.layers[organ.focused].model)} · ${organ.layers[organ.focused].drawbars.join('')}`
              : synth
                ? `${synth.layers[synth.focused].waveform} · ${categoryForWaveform(synth.layers[synth.focused].waveform)}`
                : 'No engine'}
        </span>
      </div>
      {organ?.sectionOn ? (
        <div className="glass-row glass-meta">
          <span className="glass-chip" data-testid="organ-model-line">
            {organModelLabel(organ.layers[organ.focused].model)}
          </span>
          <span className="glass-chip" data-testid="organ-drawbars-line">
            {organ.layers[organ.focused].drawbars.join(' ')}
          </span>
          {organ.layers[organ.focused].percussion.on ? (
            <span className="glass-chip tone-ok">
              PERC {organ.layers[organ.focused].percussion.third ? '3RD' : '2ND'}
            </span>
          ) : null}
          {organ.layers[organ.focused].vibratoOn ? (
            <span className="glass-chip tone-ok">{organ.layers[organ.focused].vibratoType}</span>
          ) : null}
        </div>
      ) : null}
      {synth?.sectionOn ? (
        <div className="glass-row glass-meta">
          <span className="glass-chip" data-testid="synth-wave-line">
            {synth.layers[synth.focused].waveform}
          </span>
          <span className="glass-chip">{synth.layers[synth.focused].filterType}</span>
          <span className="glass-chip">{synth.layers[synth.focused].voiceMode}</span>
          {synth.layers[synth.focused].arp.mode !== 'Poly' ? (
            <span className={`glass-chip ${synth.layers[synth.focused].arp.run ? 'tone-ok' : ''}`}>
              {synth.layers[synth.focused].arp.mode}
              {synth.layers[synth.focused].arp.run ? ' RUN' : ''}
            </span>
          ) : null}
        </div>
      ) : null}
      {piano && piano.sectionOn ? (
        <div className="glass-row glass-meta">
          {(['piano.a', 'piano.b'] as const).map((id) => {
            const layer = piano.layers[id]
            const layerModel = modelById(layer.model)
            const letter = id === 'piano.a' ? 'A' : 'B'
            return (
              <span
                key={id}
                className={`glass-chip ${layer.enabled ? 'tone-ok' : ''} ${
                  piano.focused === id ? 'is-focused' : ''
                }`}
                data-testid={`layer-chip-${letter.toLowerCase()}`}
              >
                {letter} {layer.enabled ? `${Math.round(layer.level)}` : 'off'}
                {layer.octave !== 0 ? ` ${layer.octave > 0 ? '+' : ''}${layer.octave}` : ''}
                {piano.focused === id ? ' ◂' : ''}
                {layerModel && piano.focused === id ? ` ${timbreLabelFor(layer.type, piano.timbre)}` : ''}
              </span>
            )
          })}
        </div>
      ) : null}
      <div className="glass-row glass-meta">
        <span className={`glass-chip tone-${midiStatus.tone}`}>{midiStatus.label}</span>
        <span className="glass-chip">SUSTAIN {snapshot.sustainPedal ? 'DOWN' : 'UP'}</span>
        <span className="glass-chip">
          {heldCount}/{VARIANT.totalKeys} KEYS
        </span>
        {lib ? (
          <span className={`glass-chip tone-${lib.tone}`} data-testid="library-line">
            {lib.label}
          </span>
        ) : null}
      </div>
      <div className="glass-row glass-meta">
        {engines.length > 0 ? (
          <span className="glass-chip tone-ok" data-testid="engines-line">
            {engines.join(' + ')}
          </span>
        ) : null}
        {effects ? (
          <span className="glass-chip" data-testid="fx-focus-line">
            FX {focusChip}
          </span>
        ) : null}
        {effects ? (
          <span className="glass-chip" data-testid="fx-active-line">
            {activeUnitList(effects)}
          </span>
        ) : null}
        {splitChip ? (
          <span className={`glass-chip ${program?.split.on ? 'tone-ok' : ''}`} data-testid="split-line">
            {splitChip}
          </span>
        ) : null}
        {sceneChip ? <span className="glass-chip">{sceneChip}</span> : null}
        {transposeChip ? <span className="glass-chip tone-ok">{transposeChip}</span> : null}
      </div>
      {program && (program.morph.wheel.length > 0 || program.morph.pedal.length > 0) ? (
        <div className="glass-row glass-meta">
          <span className="glass-chip" data-testid="morph-line">
            MORPH {program.morph.wheel.length}W {program.morph.pedal.length}P
          </span>
        </div>
      ) : null}
      <div className="glass-row glass-meta">
        <span className="glass-chip">
          {snapshot.byEngine.piano}P / {snapshot.byEngine.organ}O / {snapshot.byEngine.synth}S
        </span>
        <span className="glass-chip">{voiceLine}</span>
      </div>
      <div className="glass-foot">
        <span>{snapshot.audio.detail}</span>
      </div>
      <div className="glass-foot glass-note">
        <span>
          {keybedRangeLabel()} · {VARIANT.totalKeys} keys · {VARIANT.keyAction}
        </span>
        <span>
          {sounding.length > 0 ? sounding.slice(0, 6).map(noteLabel).join(' ') : '—'}
          {snapshot.stolen > 0 ? ` · ${snapshot.stolen} stolen` : ''}
        </span>
      </div>
      {library && library.detail ? (
        <div className="glass-foot glass-note">
          <span data-testid="library-detail">{library.detail}</span>
        </div>
      ) : null}
    </div>
  )
}

/** "3.2" for a bank slot, "L3" for a Live slot. */
function programSlotLabel(programs: ProgramSnapshot): string {
  if (programs.liveMode) return `L${programs.slot}`
  const page = Math.floor((programs.slot - 1) / 8) + 1
  const button = ((programs.slot - 1) % 8) + 1
  return `${page}.${button}`
}

/** The FX focus chip. The Organ's two layers share one chain, so it prints ORGAN. */
function effectFocusLabel(effects: EffectState): string {
  switch (effects.focusedLayer) {
    case 'organ':
      return 'ORGAN'
    case 'piano.a':
      return 'PIANO A'
    case 'piano.b':
      return 'PIANO B'
    case 'synth.a':
      return 'SYNTH A'
    case 'synth.b':
      return 'SYNTH B'
    case 'synth.c':
      return 'SYNTH C'
    default:
      return 'PIANO A'
  }
}

function activeUnitList(effects: EffectState): string {
  const chain = effectiveChain(effects, effects.focusedLayer)
  const on = [
    chain.mod1.on ? 'MOD1' : null,
    chain.mod2.on ? 'MOD2' : null,
    chain.delay.on ? 'DLY' : null,
    chain.ampEq.on ? 'AMP' : null,
    chain.compressor.on ? 'CMP' : null,
    chain.reverb.on ? 'REV' : null,
    effects.rotary.on ? 'ROT' : null,
  ].filter(Boolean)
  return on.length > 0 ? on.join(' ') : 'FX OFF'
}

/**
 * Synth OLED.
 *
 * The hardware's synth display shows the selected waveform, the envelope curves and the menu
 * values for the three dials below it. This one shows the waveform, its category and what Osc
 * Ctrl means for that category, plus the envelope values — all of which are real state, and
 * none of which claims a page that does not exist.
 */
export function SynthDisplay({ midi, synth }: { midi: MidiStatusReport; synth?: SynthState }) {
  const layer = synth?.layers[synth.focused]
  if (!synth || !layer) {
    return (
      <div
        className="oled glass-synth"
        data-testid="synth-display"
        data-display-id="synth.display"
        data-display-root="true"
        aria-label="Synth display: no synth layer"
      >
        <div className="glass-row glass-head">
          <span className="glass-bank">OSC WAVEFORM</span>
          <span className={`glass-status tone-${midiLine(midi).tone}`}>{midiLine(midi).label}</span>
        </div>
        <div className="glass-foot">
          <span>Synth section unavailable.</span>
        </div>
      </div>
    )
  }
  const category = categoryForWaveform(layer.waveform)
  const off = !synth.sectionOn || !layer.enabled
  return (
    <div
      className="oled glass-synth"
      data-testid="synth-display"
      data-display-id="synth.display"
      data-display-root="true"
      aria-label={`Synth display: ${layer.waveform}, ${category} category, layer ${synth.focused.replace('synth.', '').toUpperCase()}${off ? ', off' : ''}`}
    >
      <div className="glass-row glass-head">
        <span className="glass-bank">OSC WAVEFORM</span>
        <span className={`glass-status ${off ? 'tone-warn' : 'tone-ok'}`}>
          {off ? 'LAYER OFF' : `LAYER ${synth.focused.replace('synth.', '').toUpperCase()}`}
        </span>
      </div>
      <div className="glass-title glass-title-sm">
        <span data-testid="synth-waveform">{layer.waveform}</span>
      </div>
      <div className="glass-row glass-voice">
        <span className="glass-icon" aria-hidden="true">
          {category.toUpperCase()}
        </span>
        <span className="glass-value" data-testid="synth-oscctrl-line">
          OSC CTRL {layer.oscCtrl.toFixed(1)} · {oscCtrlMeaning(category)}
        </span>
      </div>
      <div className="glass-row glass-meta">
        <span className="glass-chip">{layer.filterType}</span>
        <span className="glass-chip">{layer.filterFreq.toFixed(1)}</span>
        <span className="glass-chip">{layer.voiceMode}</span>
        <span className="glass-chip">
          A{layer.ampEnv.attack.toFixed(1)} D{layer.ampEnv.decay.toFixed(1)} R
          {layer.ampEnv.release.toFixed(1)}
        </span>
      </div>
      <div className="glass-row glass-meta">
        <span className="glass-chip">{layer.lfo.waveform}</span>
        <span className="glass-chip">LFO {layer.lfo.rate.toFixed(1)}</span>
        <span className="glass-chip">{layer.arp.mode}</span>
        {layer.unison > 0 ? <span className="glass-chip">UNI {layer.unison}</span> : null}
        {layer.glide > 0 ? <span className="glass-chip">GLIDE</span> : null}
      </div>
      <div className="glass-foot">
        <span>{off ? 'Layer is switched off.' : 'Analog mode · three dials select the waveform.'}</span>
      </div>
    </div>
  )
}

function oscCtrlMeaning(category: string): string {
  switch (category) {
    case 'Pure':
      return 'no effect'
    case 'Sync':
      return 'sync pitch'
    case 'Multi':
      return 'detune'
    case 'Super':
      return 'width'
    case 'FM-H':
      return 'FM amount'
    default:
      return 'no effect'
  }
}
