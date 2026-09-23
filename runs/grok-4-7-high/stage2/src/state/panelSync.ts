import type { PianoEngine } from '../audio/engine'
import { PIANO_TYPES, TIMBRES, TOUCHES, type LayerId } from '../audio/labels'
import type { PanelAction, PresentationStore } from './presentation'

function shifted(store: PresentationStore) {
  return store.getToggle('shift') || store.getToggle('shift-2')
}

function focusedLayer(engine: PianoEngine): LayerId {
  return engine.getFocus()
}

/** Push the focused layer and the effect editor back onto the panel LEDs and knobs. */
export function presentInstrument(store: PresentationStore, engine: PianoEngine) {
  const layer = engine.getLayer(focusedLayer(engine))
  store.presentToggle('piano-on', engine.isSectionOn())
  store.presentToggle('piano-layer-a', engine.getLayer('A').enabled)
  store.presentToggle('piano-layer-b', engine.getLayer('B').enabled)
  store.presentCycle('piano-type', PIANO_TYPES.indexOf(layer.type))
  store.presentCycle('piano-timbre', TIMBRES.indexOf(layer.timbre))
  store.presentCycle('piano-unison', layer.unison)
  store.presentCycle('piano-acoustics', layer.stringRes ? 2 : layer.softRelease ? 1 : 0)
  store.presentCycle('piano-kb-touch', TOUCHES.indexOf(engine.getKbTouch()))
  store.presentCycle('piano-dyn-comp', engine.getDynComp())
  store.presentValue('piano-level-a', engine.getLayer('A').level)
  store.presentValue('piano-level-b', engine.getLayer('B').level)
  store.presentToggle('fx-focus-organ', engine.getManualFocus() === 'organ')
  store.presentToggle('fx-focus-piano', engine.getManualFocus() === 'piano')
  store.presentToggle('fx-focus-synth', engine.getManualFocus() === 'synth')
  store.presentToggle('effects-on', engine.isEffectsOn())
  const fx = engine.readFx()
  store.presentCycle('mod1-variation', fx.mod1Type)
  store.presentValue('mod1-rate', fx.mod1Rate)
  store.presentValue('mod1-amount', fx.mod1Amount)
  store.presentToggle('mod1-on', fx.mod1On)
  store.presentCycle('mod2-variation', fx.mod2Type)
  store.presentValue('mod2-rate', fx.mod2Rate)
  store.presentValue('mod2-amount', fx.mod2Amount)
  store.presentToggle('mod2-on', fx.mod2On)
  store.presentValue('delay-tempo', fx.delay.tempo)
  store.presentValue('delay-feedback', fx.delay.feedback)
  store.presentValue('delay-mix', fx.delay.mix)
  store.presentCycle('delay-filter', fx.delay.filter)
  store.presentToggle('delay-on', fx.delay.on)
  store.presentCycle('amp-variation', fx.ampType)
  store.presentValue('amp-drive', fx.ampDrive)
  store.presentValue('amp-freq', fx.ampFreq)
  store.presentValue('eq-bass', fx.ampBass)
  store.presentValue('eq-mid', fx.ampMid)
  store.presentValue('eq-treble', fx.ampTreble)
  store.presentToggle('amp-on', fx.ampOn)
  store.presentValue('comp-amount', fx.comp.amount)
  store.presentToggle('comp-on', fx.comp.on)
  store.presentToggle('reverb-bright', fx.reverb.bright)
  store.presentCycle('reverb-variation', fx.reverb.type)
  store.presentValue('reverb-mix', fx.reverb.mix)
  store.presentToggle('reverb-on', fx.reverb.on)
}

function readPanelIntoEngine(store: PresentationStore, engine: PianoEngine) {
  engine.setMasterLevel(store.getValue('perf-master-level'))
  engine.setPitchStick(store.getValue('perf-pitch-stick'))
  engine.setSectionOn(store.getToggle('piano-on'))
  engine.setLayerLevel('A', store.getValue('piano-level-a'))
  engine.setLayerLevel('B', store.getValue('piano-level-b'))
  engine.setLayerEnabled('A', store.getToggle('piano-layer-a'))
  engine.setLayerEnabled('B', store.getToggle('piano-layer-b'))
  const type = PIANO_TYPES[store.getCycle('piano-type')] ?? 'Grand'
  engine.setFocusedType(type)
  const timbre = TIMBRES[store.getCycle('piano-timbre')] ?? 'Off'
  engine.setFocusedTimbre(timbre)
  const touch = TOUCHES[store.getCycle('piano-kb-touch')] ?? 'Medium'
  engine.setKbTouch(touch)
  engine.setDynComp(store.getCycle('piano-dyn-comp') as 0 | 1 | 2 | 3)
  engine.setFocusedUnison(store.getCycle('piano-unison') as 0 | 1 | 2 | 3)
  engine.setFocusedAcoustics(store.getCycle('piano-acoustics'))
  engine.setEffectsOn(store.getToggle('effects-on'))
  engine.setRotary(store.getToggle('rotary-speed'), store.getToggle('rotary-stop-mode'), store.getValue('rotary-drive'))
  engine.writeFx({
    mod1Type: store.getCycle('mod1-variation'),
    mod1Rate: store.getValue('mod1-rate'),
    mod1Amount: store.getValue('mod1-amount'),
    mod1On: store.getToggle('mod1-on'),
    mod2Type: store.getCycle('mod2-variation'),
    mod2Rate: store.getValue('mod2-rate'),
    mod2Amount: store.getValue('mod2-amount'),
    mod2On: store.getToggle('mod2-on'),
    delay: {
      tempo: store.getValue('delay-tempo'),
      feedback: store.getValue('delay-feedback'),
      mix: store.getValue('delay-mix'),
      filter: store.getCycle('delay-filter'),
      on: store.getToggle('delay-on'),
    },
    ampType: store.getCycle('amp-variation'),
    ampDrive: store.getValue('amp-drive'),
    ampFreq: store.getValue('amp-freq'),
    ampBass: store.getValue('eq-bass'),
    ampMid: store.getValue('eq-mid'),
    ampTreble: store.getValue('eq-treble'),
    ampOn: store.getToggle('amp-on'),
    comp: {
      amount: store.getValue('comp-amount'),
      on: store.getToggle('comp-on'),
      fast: store.getValue('comp-amount') >= 110,
    },
    reverb: {
      type: store.getCycle('reverb-variation'),
      mix: store.getValue('reverb-mix'),
      bright: store.getToggle('reverb-bright'),
      on: store.getToggle('reverb-on'),
    },
  })
}

/**
 * Mirror panel gestures into the engine. Organ, Synth, and Program controls
 * fall through and stay presentation-only. Returns true to swallow a toggle
 * that should not flip the hardware latch (Shift chords).
 */
export function bindPanel(store: PresentationStore, engine: PianoEngine) {
  return store.setPanelListener((action: PanelAction, id: string) => {
    if (action === 'before-toggle') {
      if (shifted(store) && id === 'piano-layer-a') {
        engine.toggleSustped('A')
        return true
      }
      if (shifted(store) && id === 'piano-layer-b') {
        engine.togglePstick('B')
        return true
      }
      if (shifted(store) && (id === 'delay-on' || id === 'comp-on' || id === 'reverb-on')) {
        engine.toggleGlobal(id === 'delay-on' ? 'delay' : id === 'comp-on' ? 'comp' : 'reverb')
        return true
      }
      if (id === 'fx-focus-organ' || id === 'fx-focus-piano' || id === 'fx-focus-synth') {
        if (id === 'fx-focus-piano' && shifted(store)) engine.togglePianoGroup()
        else if (id === 'fx-focus-organ') engine.setManualFocus('organ')
        else if (id === 'fx-focus-synth') engine.setManualFocus('synth')
        else engine.setManualFocus('piano')
        presentInstrument(store, engine)
        return true
      }
      if (id === 'piano-layer-a' || id === 'piano-layer-b') {
        engine.pressLayer(id === 'piano-layer-a' ? 'A' : 'B')
        presentInstrument(store, engine)
        return true
      }
      return false
    }
    if (action === 'pulse') {
      if (id === 'piano-octave-up') engine.nudgeOctave(1)
      else if (id === 'piano-octave-down') engine.nudgeOctave(-1)
      else if (id === 'all-fx-off') {
        engine.setEffectsOn(false)
        store.presentToggle('effects-on', false)
      } else if (id === 'delay-tap') engine.tapDelay(performance.now() / 1000)
      return false
    }
    if (action === 'toggle' || action === 'value' || action === 'cycle') {
      readPanelIntoEngine(store, engine)
    }
    return false
  })
}
