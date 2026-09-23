import type { PianoEngine } from '../audio/engine'
import { WAVEFORMS } from '../audio/synth'
import { MORPH_DESTINATIONS } from '../audio/performance'
import type { PresentationStore } from './presentation'

let lastProgramDial = 0

function view(engine: PianoEngine) {
  return engine.getProgramView()
}

export function presentPhase3(store: PresentationStore, engine: PianoEngine) {
  const snap = view(engine)
  store.presentToggle('live-mode', snap.live === true)
  store.presentToggle('layer-scene', snap.scene === 'II')
  store.presentToggle('split-onset', Array.isArray(snap.split) && snap.split.some((midi) => midi !== 0))
  store.presentToggle('transpose-onset', Number(snap.transpose) !== 0)
  const organ = engine.programDocument()?.organ
  const synth = engine.programDocument()?.synth
  if (!organ || !synth) return
  store.presentToggle('organ-on', organ.sectionOn)
  store.presentToggle('synth-on', synth.sectionOn)
  store.presentToggle('organ-layer-a', engine.getScene() && engine.programDocument()?.scenes[engine.getScene()].organA === true)
  const scene = engine.getScene()
  const enables = engine.programDocument()?.scenes[scene]
  if (enables) {
    store.presentToggle('organ-layer-a', enables.organA)
    store.presentToggle('organ-layer-b', enables.organB)
    store.presentToggle('synth-layer-a', enables.synthA)
    store.presentToggle('synth-layer-b', enables.synthB)
    store.presentToggle('synth-layer-c', enables.synthC)
  }
  const focus = organ.focus
  store.presentCycle('organ-model', organ.layers[focus].model)
  store.presentCycle('organ-vib-select', organ.vibIndex)
  store.presentToggle('organ-vib-on', organ.vibOn[focus])
  store.presentToggle('organ-perc-on', organ.percOn)
  store.presentToggle('organ-perc-volume', organ.percSoft)
  store.presentToggle('organ-perc-decay', organ.percFast)
  store.presentToggle('organ-perc-harmonic', organ.percThird)
  store.presentToggle('rotary-source', organ.rotarySource)
  store.presentValue('organ-level-a', organ.layers.A.level)
  store.presentValue('organ-level-b', organ.layers.B.level)
  organ.layers[focus].drawbars.forEach((value, index) => {
    store.presentValue(`organ-drawbar-${index + 1}`, value)
  })
  const layer = synth.layers[synth.focus]
  store.presentValue('synth-level-a', synth.layers.A.level)
  store.presentValue('synth-level-b', synth.layers.B.level)
  store.presentValue('synth-level-c', synth.layers.C.level)
  store.presentValue('osc-ctrl', layer.oscCtrl)
  store.presentValue('filter-freq', layer.filterFreq)
  store.presentValue('filter-res', layer.filterRes)
  store.presentValue('filter-env-amt', layer.filterEnvAmt)
  store.presentValue('lfo-rate', layer.lfoRate)
  store.presentValue('lfo-mod-amt', layer.lfoAmount)
  store.presentValue('arp-rate', layer.arpRate)
  store.presentValue('arp-range', layer.arpRange)
  store.presentValue('glide', layer.glide)
  store.presentCycle('filter-type', layer.filterType)
  store.presentCycle('voice-mode', layer.voiceMode)
  store.presentCycle('arp-mode', layer.arpDirection)
  store.presentCycle('lfo-waveform', layer.lfoWave)
  store.presentCycle('lfo-destination', layer.lfoDest === 3 ? 1 : layer.lfoDest === 2 ? 2 : 0)
  store.presentCycle('vibrato-mode', layer.vibratoMode)
  store.presentCycle('synth-unison', layer.unison)
  store.presentCycle('synth-mode', layer.samples ? 1 : 0)
  store.presentToggle('filter-on', layer.filterOn)
  store.presentToggle('arp-run', layer.arpRun)
  store.presentToggle('kb-hold', layer.arpHold)
  store.presentToggle('amp-envelope', synth.dialTarget === 'amp')
  for (let index = 1; index <= 8; index++) store.presentToggle(`program-${index}`, false)
  const button = Number(snap.button)
  if (snap.live === true || Number(snap.page) >= 0) store.presentToggle(`program-${button + 1}`, true)
  void WAVEFORMS
}

function shifted(store: PresentationStore) {
  return store.getToggle('shift') || store.getToggle('shift-2')
}

export function handlePhase3(store: PresentationStore, engine: PianoEngine, action: string, id: string): boolean {
  if (action === 'before-toggle') {
    if (id === 'split-onset' && shifted(store)) {
      engine.programDocument()
      const host = engine
      host.nudgeProgram(0)
      return false
    }
    if (shifted(store) && id === 'transpose-onset') {
      engine.panic()
      store.presentValue('perf-pitch-stick', 0)
      store.presentValue('perf-mod-wheel', 0)
      return true
    }
    if (id === 'morph-wheel' || id === 'morph-ctrlped') {
      const source = id === 'morph-wheel' ? 'wheel' : 'pedal'
      if (shifted(store)) {
        engine.clearMorph(source)
        return true
      }
      if (engine.morphSource() === source) engine.endMorph()
      else engine.beginMorph(source)
      return true
    }
    if (id === 'organ-layer-a' || id === 'organ-layer-b') {
      engine.pressOrganLayer(id.endsWith('a') ? 'A' : 'B')
      presentPhase3(store, engine)
      return true
    }
    if (id === 'synth-layer-a' || id === 'synth-layer-b' || id === 'synth-layer-c') {
      engine.pressSynthLayer(id.endsWith('a') ? 'A' : id.endsWith('b') ? 'B' : 'C')
      presentPhase3(store, engine)
      return true
    }
    return false
  }
  if (action === 'pulse') {
    if (id.startsWith('program-')) {
      const button = Number(id.slice(8)) - 1
      const page = Math.floor(Number(view(engine).index) / 8)
      const live = view(engine).live === true
      if (live || engine.storeMode() === 'dest' && view(engine).live === true) engine.selectLiveSlot(button)
      else engine.selectProgram(page * 8 + button)
      presentPhase3(store, engine)
      return true
    }
    if (id === 'store') {
      if (engine.storeMode() !== 'play' && shifted(store)) engine.cancelStore()
      else if (shifted(store)) engine.armStoreAs()
      else engine.armStore()
      return true
    }
    if (id === 'page-left' || id === 'page-right') {
      if (engine.storeMode() === 'name') {
        if (id === 'page-left') engine.deleteStoreChar()
        else engine.insertStoreChar()
        return true
      }
      const page = Math.floor(Number(view(engine).index) / 8)
      engine.setProgramPage(id === 'page-left' ? page - 1 : page + 1)
      return true
    }
    if (id === 'mstclk-tap') {
      if (shifted(store)) engine.toggleEffectClockSync()
      else engine.tapMasterClock(performance.now() / 1000)
      return true
    }
    if (id === 'prog-view') {
      engine.setProgramList(!(view(engine).listOpen === true))
      return true
    }
    if (id === 'solo-undo') {
      engine.undoProgram()
      presentPhase3(store, engine)
      return true
    }
    if (id === 'organ-octave-down' || id === 'organ-octave-up') {
      engine.nudgeOrganOctave(id.endsWith('up') ? 1 : -1)
      return true
    }
    if (id === 'synth-octave-down' || id === 'synth-octave-up') {
      engine.nudgeSynthOctave(id.endsWith('up') ? 1 : -1)
      return true
    }
    if (id === 'waveform-select') {
      const index = engine.programDocument()?.synth.layers[engine.programDocument()!.synth.focus].waveform ?? 0
      engine.patchSynth({ waveform: (index + 1) % WAVEFORMS.length })
      return true
    }
    if (id === 'arp-menu') {
      const mode = engine.programDocument()?.synth.layers[engine.programDocument()!.synth.focus].arpMode ?? 0
      engine.patchSynth({ arpMode: ((mode + 1) % 3) as 0 | 1 | 2 })
      return true
    }
    if (id === 'vibrato-menu') {
      engine.setDialTarget('vibrato')
      return true
    }
    if (id === 'osc-pitch-smp') {
      const focus = engine.programDocument()?.synth.focus ?? 'A'
      const coarse = engine.programDocument()?.synth.layers[focus].coarse ?? 0
      engine.patchSynth({ coarse: coarse >= 12 ? -12 : coarse + 1 })
      engine.setDialTarget('pitch')
      return true
    }
    if (id === 'amp-envelope') {
      engine.setDialTarget('amp')
      return true
    }
    return false
  }
  if (action === 'value' && id === 'program-dial') {
    const value = store.getValue(id)
    const delta = value === lastProgramDial ? 0 : value > lastProgramDial ? 1 : -1
    lastProgramDial = value
    if (delta === 0) return true
    if (store.getPressed('mstclk-tap')) {
      engine.setTempo(engine.getTempo() + delta)
      return true
    }
    if (store.getPressed('transpose-onset')) {
      const current = Number(engine.programDocument()?.transpose ?? 0)
      engine.setTranspose(current + delta, true)
      return true
    }
    if (shifted(store) && view(engine).listOpen !== true) engine.setProgramList(true)
    engine.nudgeProgram(delta)
    return true
  }
  if ((action === 'value' || action === 'toggle' || action === 'cycle') && isPhase3(id)) {
    const source = engine.morphSource()
    if (action === 'value' && source && MORPH_DESTINATIONS.has(id)) {
      const from = engine.baseValue(id)
      const to = store.getValue(id)
      engine.assignMorph(source, id, from, to)
    }
    applyPhase3(store, engine, id)
    return true
  }
  if (action === 'value' && id === 'perf-mod-wheel') {
    engine.setModWheel(store.getValue(id))
    return false
  }
  return false
}

function isPhase3(id: string): boolean {
  return (
    id.startsWith('organ-') ||
    id.startsWith('synth-') ||
    id.startsWith('arp-') ||
    id.startsWith('lfo-') ||
    id.startsWith('filter-') ||
    id.startsWith('osc-') ||
    id.startsWith('voice-') ||
    id === 'glide' ||
    id === 'kb-hold' ||
    id === 'live-mode' ||
    id === 'layer-scene' ||
    id === 'split-onset' ||
    id === 'rotary-source' ||
    id === 'amp-envelope' ||
    id === 'vibrato-mode'
  )
}

function applyPhase3(store: PresentationStore, engine: PianoEngine, id: string) {
  if (id === 'organ-on') engine.setOrganOn(store.getToggle(id))
  if (id === 'organ-model') engine.setOrganModel(store.getCycle(id))
  if (id === 'organ-vib-select') engine.setOrganVibrato(store.getCycle(id))
  if (id === 'organ-vib-on') engine.setOrganVibrato(engine.programDocument()?.organ.vibIndex ?? 0, store.getToggle(id))
  if (id === 'organ-perc-on') engine.setOrganPercussion({ percOn: store.getToggle(id) })
  if (id === 'organ-perc-volume') engine.setOrganPercussion({ percSoft: store.getToggle(id) })
  if (id === 'organ-perc-decay') engine.setOrganPercussion({ percFast: store.getToggle(id) })
  if (id === 'organ-perc-harmonic') engine.setOrganPercussion({ percThird: store.getToggle(id) })
  if (id === 'organ-level-a' || id === 'organ-level-b') engine.setOrganLevel(id.endsWith('a') ? 'A' : 'B', store.getValue(id))
  if (id.startsWith('organ-drawbar-')) engine.setDrawbar(Number(id.slice(14)) - 1, store.getValue(id))
  if (id === 'rotary-source') engine.setRotarySource(store.getToggle(id))
  if (id === 'synth-on') engine.setSynthOn(store.getToggle(id))
  if (id === 'synth-mode') engine.patchSynth({ samples: store.getCycle(id) === 1 })
  if (id === 'osc-ctrl') engine.patchSynth({ oscCtrl: store.getValue(id) })
  if (id === 'filter-type') engine.patchSynth({ filterType: store.getCycle(id) })
  if (id === 'filter-on') engine.patchSynth({ filterOn: store.getToggle(id) })
  if (id === 'filter-freq') engine.patchSynth({ filterFreq: store.getValue(id) })
  if (id === 'filter-res') engine.patchSynth({ filterRes: store.getValue(id) })
  if (id === 'filter-env-amt') engine.patchSynth({ filterEnvAmt: store.getValue(id) })
  if (id === 'lfo-rate') engine.patchSynth({ lfoRate: store.getValue(id) })
  if (id === 'lfo-mod-amt') engine.patchSynth({ lfoAmount: store.getValue(id) })
  if (id === 'lfo-waveform') engine.patchSynth({ lfoWave: store.getCycle(id) })
  if (id === 'lfo-destination') engine.patchSynth({ lfoDest: ([1, 3, 2] as const)[store.getCycle(id)] ?? 1 })
  if (id === 'voice-mode') {
    if (shifted(store)) {
      const focus = engine.programDocument()?.synth.focus ?? 'A'
      const layer = engine.programDocument()?.synth.layers[focus]
      store.presentCycle('voice-mode', layer?.voiceMode ?? 0)
      const priority = ((layer?.priority ?? 0) + 1) % 3
      engine.patchSynth({ priority: priority as 0 | 1 | 2 })
    } else engine.patchSynth({ voiceMode: store.getCycle(id) as 0 | 1 | 2 })
  }
  if (id === 'glide') engine.patchSynth({ glide: store.getValue(id) })
  if (id === 'vibrato-mode') engine.patchSynth({ vibratoMode: store.getCycle(id) as 0 | 1 | 2 })
  if (id === 'synth-unison') engine.patchSynth({ unison: store.getCycle(id) as 0 | 1 | 2 | 3 })
  if (id === 'arp-rate') engine.patchSynth({ arpRate: store.getValue(id) })
  if (id === 'arp-range') engine.patchSynth({ arpRange: store.getValue(id) })
  if (id === 'arp-mode') engine.patchSynth({ arpDirection: store.getCycle(id) as 0 | 1 | 2 | 3 })
  if (id === 'arp-run') engine.patchSynth({ arpRun: store.getToggle(id) })
  if (id === 'kb-hold') engine.patchSynth({ arpHold: store.getToggle(id) })
  if (id === 'synth-level-a' || id === 'synth-level-b' || id === 'synth-level-c') {
    engine.setSynthLevel(id.endsWith('a') ? 'A' : id.endsWith('b') ? 'B' : 'C', store.getValue(id))
  }
  if (id === 'live-mode') engine.setLiveMode(store.getToggle(id))
  if (id === 'layer-scene') engine.setScene(store.getToggle(id) ? 'II' : 'I')
  if (id === 'split-onset') engine.setSplitEnabled(store.getToggle(id))
  if (id === 'osc-envelope') engine.setDialTarget('osc')
  if (id === 'filter-envelope') engine.setDialTarget('filter')
  if (id === 'amp-envelope') engine.setDialTarget('amp')
  if (id === 'synth-dial-1' || id === 'synth-dial-2' || id === 'synth-dial-3') {
    const env = engine.programDocument()?.synth.dialTarget ?? 'amp'
    const which = env === 'filter' ? 'filter' : env === 'osc' ? 'osc' : 'amp'
    const key = id.endsWith('1') ? 'attack' : id.endsWith('2') ? 'decay' : 'release'
    const layer = engine.programDocument()?.synth.layers[engine.programDocument()!.synth.focus]
    if (layer && (which === 'amp' || which === 'filter' || which === 'osc')) {
      engine.patchSynth({
        [which === 'osc' ? 'oscEnv' : which === 'filter' ? 'filterEnv' : 'ampEnv']: {
          ...(which === 'osc' ? layer.oscEnv : which === 'filter' ? layer.filterEnv : layer.ampEnv),
          [key]: store.getValue(id),
        },
      })
    }
  }
}
