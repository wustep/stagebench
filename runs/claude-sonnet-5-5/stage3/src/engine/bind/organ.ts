import { DRAWBAR_NAMES, ORGAN_MODELS, VIB_MODES, drawbarActive, drawbarGraph } from '../organ'
import {
  setDrawbar,
  setOrganLevel,
  setOrganModel,
  setOrganOn,
  setOrganPitchStick,
  setOrganSustPed,
  setPercussion,
  setVibModeIndex,
  setVibOn,
  shiftOrganOctave,
  stepZone,
} from '../edits'
import { setRotary, type EngineState } from '../state'
import { LAYER_IDS } from '../state'
import type { Binder, BindCtx } from './types'
import { octaveText } from './types'
import { zoneRangeLabel } from '../zones'

export const ORGAN_LAYER_BUTTON = { A: 'organ-layer-a-onoff', B: 'organ-layer-b-onoff' } as const
const LEVEL_FADER = { A: 'organ-level-a', B: 'organ-level-b' } as const
const DRAWBAR_IDS = Array.from({ length: 9 }, (_, i) => `organ-drawbar-${i + 1}`)

const IDS = [
  'organ-on',
  'organ-level-a',
  'organ-level-b',
  'organ-layer-a-onoff',
  'organ-layer-b-onoff',
  'organ-sustain-pedal',
  'organ-pitch-stick',
  'organ-octave-down',
  'organ-octave-up',
  'organ-model',
  'organ-vib-chorus-mode',
  'organ-vib-chorus-on',
  'organ-perc-volume',
  'organ-perc-decay',
  'organ-perc-harmonic',
  'organ-perc-poly',
  'organ-perc-on',
  ...DRAWBAR_IDS,
  'rotary-organ',
  'rotary-stop-mode',
] as const

export function organBinder(): Binder {
  const continuous: Binder['continuous'] = {
    'organ-level-a': (s, v) => setOrganLevel(s, 'A', v),
    'organ-level-b': (s, v) => setOrganLevel(s, 'B', v),
  }
  DRAWBAR_IDS.forEach((id, i) => {
    continuous[id] = (s, v) => setDrawbar(s, i, v)
  })

  return {
    ids: IDS,
    continuous,
    press(a, ctx) {
      const value = ctx.store.get(a.id).value
      const zoneEdit = ctx.shiftHeld(a) || ctx.ui.get().splitEdit !== null
      switch (a.id) {
        case 'organ-on':
          ctx.edit((s) => setOrganOn(s, value > 0))
          return true
        case 'organ-sustain-pedal':
          ctx.edit((s) => setOrganSustPed(s, value > 0))
          return true
        case 'organ-pitch-stick':
          ctx.edit((s) => setOrganPitchStick(s, value > 0))
          return true
        case 'organ-octave-down':
          ctx.edit((s) => (zoneEdit ? stepZone(s, 'organ', -1) : shiftOrganOctave(s, -1)))
          return true
        case 'organ-octave-up':
          ctx.edit((s) => (zoneEdit ? stepZone(s, 'organ', 1) : shiftOrganOctave(s, 1)))
          return true
        case 'organ-model':
          ctx.edit((s) => setOrganModel(s, ORGAN_MODELS[value] ?? 'B3'))
          return true
        case 'organ-vib-chorus-mode':
          ctx.edit((s) => setVibModeIndex(s, value))
          return true
        case 'organ-vib-chorus-on':
          ctx.edit((s) => setVibOn(s, value > 0))
          return true
        case 'organ-perc-volume':
          ctx.edit((s) => setPercussion(s, { soft: value > 0 }))
          return true
        case 'organ-perc-decay':
          ctx.edit((s) => setPercussion(s, { fast: value > 0 }))
          return true
        case 'organ-perc-harmonic':
          ctx.edit((s) => setPercussion(s, { third: value > 0 }))
          return true
        case 'organ-perc-poly':
          ctx.edit((s) => setPercussion(s, { poly: value > 0 }))
          return true
        case 'organ-perc-on':
          ctx.edit((s) => setPercussion(s, { on: value > 0 }))
          return true
        case 'rotary-organ':
          ctx.edit((s) => setRotary(s, { organ: value > 0 }))
          return true
        case 'rotary-stop-mode':
          ctx.edit((s) => setRotary(s, { stopMode: value > 0 }))
          return true
      }
      return false
    },
    sync(s: EngineState, ctx: BindCtx) {
      const { store } = ctx
      const layer = s.organ.layers[s.organFocus]
      const on = (id: string, v: boolean) => store.set(id, v ? 1 : 0)
      on('organ-on', s.organOn)
      for (const id of LAYER_IDS) {
        store.set(LEVEL_FADER[id], s.organ.layers[id].level)
        on(ORGAN_LAYER_BUTTON[id], s.organ.layers[id].enabled)
      }
      const both = LAYER_IDS.every((id) => s.organ.layers[id].enabled)
      for (const id of LAYER_IDS) {
        store.patch(ORGAN_LAYER_BUTTON[id], {
          focused: both && s.organFocus === id ? true : undefined,
          note: `${s.organFocus === id ? `Organ layer ${id} has the focus${both ? '' : '; it is the only active layer'}. ` : ''}Tap: focus or switch to this layer. Hold half a second: turn it off. Shift+press, or press both layer buttons together: add it.`,
        })
      }
      on('organ-sustain-pedal', layer.sustPed)
      on('organ-pitch-stick', layer.pitchStick)
      const range = s.zones[`organ.${s.organFocus}`]
      const octave = `Organ layer ${s.organFocus}: octave ${octaveText(layer.octave)}, ${zoneRangeLabel(range)}. Shift+press, or hold Split to edit zones: moves the KB zone range`
      store.patch('organ-octave-down', { note: octave })
      store.patch('organ-octave-up', { note: octave })
      store.set('organ-model', ORGAN_MODELS.indexOf(layer.model))
      store.patch('organ-model', { note: `Organ layer ${s.organFocus}: ${layer.model}` })
      store.set('organ-vib-chorus-mode', VIB_MODES.indexOf(s.organ.vibMode))
      on('organ-vib-chorus-on', layer.vibOn)
      store.patch('organ-vib-chorus-on', { note: `Vibrato/chorus ${s.organ.vibMode} for organ layer ${s.organFocus}` })
      const perc = s.organ.perc
      on('organ-perc-volume', perc.soft)
      on('organ-perc-decay', perc.fast)
      on('organ-perc-harmonic', perc.third)
      on('organ-perc-poly', perc.poly)
      on('organ-perc-on', perc.on)
      store.patch('organ-perc-on', { note: layer.model === 'B3' ? 'B3 percussion' : `B3 percussion applies to the B3 model only; layer ${s.organFocus} is ${layer.model}` })
      DRAWBAR_IDS.forEach((id, i) => {
        store.set(id, layer.drawbars[i])
        const active = drawbarActive(layer.model, i)
        store.patch(id, {
          graph: active ? drawbarGraph(layer.model, layer.drawbars[i]) : 0,
          note: `${layer.model}: ${DRAWBAR_NAMES[layer.model][i]}${active ? '' : ' (this model does not use this drawbar)'}`,
        })
      })
      on('rotary-organ', s.rotary.organ)
      on('rotary-stop-mode', s.rotary.stopMode)
    },
  }
}
