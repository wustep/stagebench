import {
  editSynth,
  setSynthLevel,
  setSynthOn,
  setSynthPitchStick,
  setSynthSustPed,
  shiftSynthOctave,
  stepZone,
} from '../edits'
import {
  ARP_DIRECTIONS,
  ARP_MODES,
  DIVISIONS,
  FILTER_TRACKING,
  FILTER_TYPES,
  LFO_DESTS,
  LFO_WAVEFORMS,
  SYNTH_LAYER_IDS,
  SYNTH_WAVEFORMS,
  VIBRATO_MODES,
  VOICE_MODES,
  arpOctaves,
  divisionFromKnob,
  knobFromDivision,
  waveformInfo,
} from '../synth'
import type { EngineState, Level3 } from '../state'
import type { SynthPage } from '../uiMode'
import { zoneRangeLabel } from '../zones'
import type { Binder, BindCtx } from './types'
import { octaveText } from './types'

export const SYNTH_LAYER_BUTTON = { A: 'synth-layer-a-onoff', B: 'synth-layer-b-onoff', C: 'synth-layer-c-onoff' } as const
const LEVEL_FADER = { A: 'synth-level-a', B: 'synth-level-b', C: 'synth-level-c' } as const

/** what the three dials under the Synth OLED edit on each page: [Info dial, List dial 1, List dial 2] */
export const PAGE_DIALS: Record<SynthPage, [string, string, string]> = {
  osc: ['Waveform', 'Coarse pitch', 'Fine pitch'],
  oscEnv: ['Attack', 'Decay', 'Release'],
  filterEnv: ['Attack', 'Decay', 'Release'],
  ampEnv: ['Attack', 'Decay', 'Release'],
  filter: ['Type', 'Key tracking', 'Drive'],
  lfo: ['Waveform', 'Master clock sync', 'Division'],
  vibrato: ['Mode', 'Rate', 'Amount'],
  arp: ['Direction', 'Master clock sync', 'Division'],
}

const ENV_STEP = 0.02
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const stepIn = <T,>(list: readonly T[], current: T, delta: number): T => list[(list.indexOf(current) + delta + list.length * 4) % list.length]

const IDS = [
  'synth-on',
  'synth-level-a',
  'synth-level-b',
  'synth-level-c',
  'synth-layer-a-onoff',
  'synth-layer-b-onoff',
  'synth-layer-c-onoff',
  'synth-sustain-pedal',
  'synth-pitch-stick-range',
  'synth-kb-hold',
  'synth-arp-run',
  'synth-kb-sync',
  'synth-octave-down',
  'synth-octave-up',
  'synth-info-dial',
  'synth-list-dial-1',
  'synth-list-dial-2',
  'synth-mode',
  'synth-waveform',
  'synth-arp-rate',
  'synth-arp-mode',
  'synth-arp-range',
  'synth-arp-menu',
  'synth-voice-mode',
  'synth-voice-lo',
  'synth-voice-hi',
  'synth-glide',
  'synth-vibrato-source',
  'synth-vibrato-menu',
  'synth-vibrato-rocker',
  'synth-lfo-waveform',
  'synth-lfo-rate',
  'synth-lfo-amount',
  'synth-lfo-destination',
  'synth-osc-pitch',
  'synth-osc-env-to-pitch',
  'synth-osc-control',
  'synth-osc-envelope',
  'synth-osc-velocity',
  'synth-osc-env-amount',
  'synth-filter-type',
  'synth-filter-envelope',
  'synth-filter-velocity',
  'synth-filter-env-amount',
  'synth-filter-frequency',
  'synth-filter-resonance',
  'synth-filter-on',
  'synth-amp-envelope',
  'synth-unison',
] as const

export function synthBinder(): Binder {
  return {
    ids: IDS,
    dials: ['synth-info-dial', 'synth-list-dial-1', 'synth-list-dial-2'],
    continuous: {
      'synth-level-a': (s, v) => setSynthLevel(s, 'A', v),
      'synth-level-b': (s, v) => setSynthLevel(s, 'B', v),
      'synth-level-c': (s, v) => setSynthLevel(s, 'C', v),
      'synth-glide': (s, v) => editSynth(s, (p) => ({ ...p, voice: { ...p.voice, glide: v } })),
      'synth-lfo-rate': (s, v, ctx) => editSynth(s, (p) => ({ ...p, lfo: ctx.shiftHeld() ? { ...p.lfo, sync: true, division: divisionFromKnob(v) } : { ...p.lfo, sync: false, rate: v } })),
      'synth-lfo-amount': (s, v) => editSynth(s, (p) => ({ ...p, lfo: { ...p.lfo, amount: v } })),
      'synth-osc-control': (s, v) => editSynth(s, (p) => ({ ...p, oscCtrl: v })),
      'synth-osc-env-amount': (s, v) => editSynth(s, (p) => ({ ...p, oscEnv: { ...p.oscEnv, amount: Math.round((v - 0.5) * 2000) / 1000 } })),
      'synth-filter-env-amount': (s, v) => editSynth(s, (p) => ({ ...p, filter: { ...p.filter, envAmount: v } })),
      'synth-filter-frequency': (s, v) => editSynth(s, (p) => ({ ...p, filter: { ...p.filter, freq: v } })),
      'synth-filter-resonance': (s, v) => editSynth(s, (p) => ({ ...p, filter: { ...p.filter, res: v } })),
      'synth-arp-rate': (s, v, ctx) => editSynth(s, (p) => ({ ...p, arp: ctx.shiftHeld() ? { ...p.arp, sync: true, division: divisionFromKnob(v) } : { ...p.arp, sync: false, rate: v } })),
      'synth-arp-range': (s, v) => editSynth(s, (p) => ({ ...p, arp: { ...p.arp, range: v } })),
    },
    press(a, ctx) {
      const value = ctx.store.get(a.id).value
      const dir = ctx.shiftHeld(a) ? -1 : 1
      const page = (p: SynthPage) => ctx.ui.update({ synthPage: p })
      const zoneEdit = ctx.shiftHeld(a) || ctx.ui.get().splitEdit !== null
      switch (a.id) {
        case 'synth-on':
          ctx.edit((s) => setSynthOn(s, value > 0))
          return true
        case 'synth-sustain-pedal':
          ctx.edit((s) => setSynthSustPed(s, value > 0))
          return true
        case 'synth-pitch-stick-range':
          ctx.edit((s) => setSynthPitchStick(s, value > 0))
          return true
        case 'synth-kb-hold':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, arp: { ...p.arp, hold: value > 0 } })))
          return true
        case 'synth-arp-run':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, arp: { ...p.arp, run: value > 0 } })))
          return true
        case 'synth-kb-sync':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, kbSync: value > 0 })))
          return true
        case 'synth-octave-down':
          ctx.edit((s) => (zoneEdit ? stepZone(s, 'synth', -1) : shiftSynthOctave(s, -1)))
          return true
        case 'synth-octave-up':
          ctx.edit((s) => (zoneEdit ? stepZone(s, 'synth', 1) : shiftSynthOctave(s, 1)))
          return true
        case 'synth-mode':
          // only Analog mode exists: the selector snaps back (Samples is optional and not built, Extern is excluded)
          ctx.reflect()
          return true
        case 'synth-waveform':
          page('osc')
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, waveform: (p.waveform + dir + SYNTH_WAVEFORMS.length) % SYNTH_WAVEFORMS.length })))
          return true
        case 'synth-osc-pitch':
          page('osc')
          return true
        case 'synth-arp-mode':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, arp: { ...p.arp, mode: ARP_MODES[value] ?? 'arp' } })))
          return true
        case 'synth-arp-menu':
          page(ctx.ui.get().synthPage === 'arp' ? 'osc' : 'arp')
          return true
        case 'synth-voice-mode':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, voice: { ...p.voice, mode: VOICE_MODES[value] ?? 'poly' } })))
          return true
        case 'synth-voice-lo':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, voice: { ...p.voice, priority: value > 0 ? 'low' : 'off' } })))
          return true
        case 'synth-voice-hi':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, voice: { ...p.voice, priority: value > 0 ? 'high' : 'off' } })))
          return true
        case 'synth-vibrato-source':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, voice: { ...p.voice, vibrato: { ...p.voice.vibrato, mode: VIBRATO_MODES[value] ?? 'off' } } })))
          return true
        case 'synth-vibrato-menu':
          page(ctx.ui.get().synthPage === 'vibrato' ? 'osc' : 'vibrato')
          return true
        case 'synth-vibrato-rocker':
          page('vibrato')
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, voice: { ...p.voice, vibrato: { ...p.voice.vibrato, amount: Math.min(10, Math.max(0, p.voice.vibrato.amount + dir)) } } })))
          return true
        case 'synth-lfo-waveform':
          page('lfo')
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, lfo: { ...p.lfo, waveform: (p.lfo.waveform + dir + LFO_WAVEFORMS.length) % LFO_WAVEFORMS.length } })))
          return true
        case 'synth-lfo-destination':
          page('lfo')
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, lfo: { ...p.lfo, dest: LFO_DESTS[value] ?? 'off' } })))
          return true
        case 'synth-osc-env-to-pitch':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, oscEnv: { ...p.oscEnv, toPitch: value > 0 } })))
          return true
        case 'synth-osc-envelope':
          page('oscEnv')
          return true
        case 'synth-osc-velocity':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, oscEnv: { ...p.oscEnv, velocity: value > 0 } })))
          return true
        case 'synth-filter-type':
          page('filter')
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, filter: { ...p.filter, type: stepIn(FILTER_TYPES, p.filter.type, dir) } })))
          return true
        case 'synth-filter-envelope':
          page('filterEnv')
          return true
        case 'synth-filter-velocity':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, filter: { ...p.filter, velocity: value > 0 } })))
          return true
        case 'synth-filter-on':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, filter: { ...p.filter, on: value > 0 } })))
          return true
        case 'synth-amp-envelope':
          page('ampEnv')
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, amp: { ...p.amp, velocity: Math.min(3, Math.max(0, value)) as Level3 } })))
          return true
        case 'synth-unison':
          ctx.edit((s) => editSynth(s, (p) => ({ ...p, voice: { ...p.voice, unison: Math.min(3, Math.max(0, value)) as Level3 } })))
          return true
      }
      return false
    },
    dial(id, delta, ctx) {
      const which = id === 'synth-info-dial' ? 0 : id === 'synth-list-dial-1' ? 1 : 2
      const page = ctx.ui.get().synthPage
      ctx.edit((s) =>
        editSynth(s, (p) => {
          const env = (key: 'oscEnv' | 'filter' | 'amp') => {
            const k = (['attack', 'decay', 'release'] as const)[which]
            return { ...p, [key]: { ...p[key], [k]: clamp01(Math.round((p[key][k] + delta * ENV_STEP) * 1000) / 1000) } }
          }
          switch (page) {
            case 'osc':
              if (which === 0) return { ...p, waveform: (p.waveform + delta + SYNTH_WAVEFORMS.length * 8) % SYNTH_WAVEFORMS.length }
              if (which === 1) return { ...p, coarse: Math.min(24, Math.max(-24, p.coarse + delta)) }
              return { ...p, fine: Math.min(50, Math.max(-50, p.fine + delta)) }
            case 'oscEnv':
              return env('oscEnv')
            case 'filterEnv':
              return env('filter')
            case 'ampEnv':
              return env('amp')
            case 'filter':
              if (which === 0) return { ...p, filter: { ...p.filter, type: stepIn(FILTER_TYPES, p.filter.type, delta) } }
              if (which === 1) return { ...p, filter: { ...p.filter, tracking: Math.min(3, Math.max(0, p.filter.tracking + delta)) as Level3 } }
              return { ...p, filter: { ...p.filter, drive: Math.min(3, Math.max(0, p.filter.drive + delta)) as Level3 } }
            case 'lfo':
              if (which === 0) return { ...p, lfo: { ...p.lfo, waveform: (p.lfo.waveform + delta + LFO_WAVEFORMS.length * 8) % LFO_WAVEFORMS.length } }
              if (which === 1) return { ...p, lfo: { ...p.lfo, sync: delta > 0 } }
              return { ...p, lfo: { ...p.lfo, division: Math.min(DIVISIONS.length - 1, Math.max(0, p.lfo.division + delta)) } }
            case 'vibrato':
              if (which === 0) return { ...p, voice: { ...p.voice, vibrato: { ...p.voice.vibrato, mode: stepIn(VIBRATO_MODES, p.voice.vibrato.mode, delta) } } }
              if (which === 1) return { ...p, voice: { ...p.voice, vibrato: { ...p.voice.vibrato, rate: Math.min(8, Math.max(2, Math.round((p.voice.vibrato.rate + delta * 0.1) * 10) / 10)) } } }
              return { ...p, voice: { ...p.voice, vibrato: { ...p.voice.vibrato, amount: Math.min(10, Math.max(0, p.voice.vibrato.amount + delta)) } } }
            case 'arp':
              if (which === 0) return { ...p, arp: { ...p.arp, direction: stepIn(ARP_DIRECTIONS, p.arp.direction, delta) } }
              if (which === 1) return { ...p, arp: { ...p.arp, sync: delta > 0 } }
              return { ...p, arp: { ...p.arp, division: Math.min(DIVISIONS.length - 1, Math.max(0, p.arp.division + delta)) } }
          }
        }),
      )
      return true
    },
    sync(s: EngineState, ctx: BindCtx) {
      const { store } = ctx
      const layer = s.synth[s.synthFocus]
      const p = layer.patch
      const on = (id: string, v: boolean) => store.set(id, v ? 1 : 0)
      const note = (id: string, text: string | undefined) => store.patch(id, { note: text })
      on('synth-on', s.synthOn)
      for (const id of SYNTH_LAYER_IDS) {
        store.set(LEVEL_FADER[id], s.synth[id].level)
        on(SYNTH_LAYER_BUTTON[id], s.synth[id].enabled)
      }
      const many = SYNTH_LAYER_IDS.filter((id) => s.synth[id].enabled).length > 1
      for (const id of SYNTH_LAYER_IDS) {
        store.patch(SYNTH_LAYER_BUTTON[id], {
          focused: many && s.synthFocus === id ? true : undefined,
          note: `${s.synthFocus === id ? `Synth layer ${id} has the focus${many ? '' : '; it is the only active layer'}. ` : ''}Tap: focus or switch to this layer. Hold half a second: turn it off. Shift+press, or press two layer buttons together: add it.`,
        })
      }
      on('synth-sustain-pedal', layer.sustPed)
      on('synth-pitch-stick-range', layer.pitchStick)
      note('synth-pitch-stick-range', `Pitch stick bends synth layer ${s.synthFocus} by ±2 semitones when on`)
      on('synth-kb-hold', p.arp.hold)
      on('synth-arp-run', p.arp.run)
      on('synth-kb-sync', p.kbSync)
      const octave = `Synth layer ${s.synthFocus}: octave ${octaveText(layer.octave)}, ${zoneRangeLabel(s.zones[`synth.${s.synthFocus}`])}. Shift+press, or hold Split to edit zones: moves the KB zone range`
      note('synth-octave-down', octave)
      note('synth-octave-up', octave)

      const wave = waveformInfo(p.waveform)
      note('synth-waveform', `${wave.name} (${wave.category}). Press for the next waveform, Shift+press for the previous`)
      note('synth-osc-pitch', `Selects the pitch and waveform page of the Synth display: coarse ${p.coarse}, fine ${p.fine}`)
      store.set('synth-mode', 1)
      note('synth-mode', 'Analog is the only mode built: Samples is optional and not built, Extern is excluded; the selector stays on Analog')
      store.set('synth-arp-mode', ARP_MODES.indexOf(p.arp.mode))
      store.set('synth-arp-rate', p.arp.sync ? knobFromDivision(p.arp.division) : p.arp.rate)
      note('synth-arp-rate', p.arp.sync ? `Synced to the master clock: ${DIVISIONS[p.arp.division].name} at ${s.clock.bpm} BPM. Turn without Shift for a free rate` : 'Free rate. Shift+turn syncs to the master clock')
      ctx.store.setIndicator('led-synth-arp-clk', p.arp.sync)
      store.set('synth-arp-range', p.arp.range)
      note('synth-arp-range', p.arp.mode === 'gate' ? 'Gate hardness' : `${arpOctaves(p.arp.range)} octave${arpOctaves(p.arp.range) > 1 ? 's' : ''}`)
      on('synth-arp-menu', ctx.ui.get().synthPage === 'arp')
      note('synth-arp-menu', `Arpeggiator menu on the Synth display: direction ${p.arp.direction}, clock sync ${p.arp.sync ? 'on' : 'off'}`)

      store.set('synth-voice-mode', VOICE_MODES.indexOf(p.voice.mode))
      on('synth-voice-lo', p.voice.priority === 'low')
      on('synth-voice-hi', p.voice.priority === 'high')
      store.set('synth-glide', p.voice.glide)
      store.set('synth-unison', p.voice.unison)
      store.set('synth-vibrato-source', VIBRATO_MODES.indexOf(p.voice.vibrato.mode))
      on('synth-vibrato-menu', ctx.ui.get().synthPage === 'vibrato')
      note('synth-vibrato-rocker', `Vibrato amount ${p.voice.vibrato.amount} of 10, rate ${p.voice.vibrato.rate.toFixed(1)} Hz. Press for more, Shift+press for less`)

      note('synth-lfo-waveform', `LFO waveform: ${LFO_WAVEFORMS[p.lfo.waveform]}. Press for the next, Shift+press for the previous`)
      store.set('synth-lfo-rate', p.lfo.sync ? knobFromDivision(p.lfo.division) : p.lfo.rate)
      note('synth-lfo-rate', p.lfo.sync ? `Synced to the master clock: ${DIVISIONS[p.lfo.division].name} at ${s.clock.bpm} BPM. Turn without Shift for a free rate` : 'Free rate. Shift+turn syncs to the master clock')
      store.setIndicator('led-synth-lfo-clk', p.lfo.sync)
      store.set('synth-lfo-amount', p.lfo.amount)
      store.set('synth-lfo-destination', LFO_DESTS.indexOf(p.lfo.dest))

      store.set('synth-osc-control', p.oscCtrl)
      note('synth-osc-control', wave.category === 'Pure' ? 'Osc Ctrl has no effect on Pure waveforms' : `Osc Ctrl: ${wave.category} category`)
      store.set('synth-osc-env-amount', p.oscEnv.amount / 2 + 0.5)
      on('synth-osc-env-to-pitch', p.oscEnv.toPitch)
      on('synth-osc-velocity', p.oscEnv.velocity)
      store.set('synth-filter-env-amount', p.filter.envAmount)
      store.set('synth-filter-frequency', p.filter.freq)
      store.set('synth-filter-resonance', p.filter.res)
      on('synth-filter-velocity', p.filter.velocity)
      on('synth-filter-on', p.filter.on)
      note('synth-filter-type', `${p.filter.type}, key tracking ${FILTER_TRACKING[p.filter.tracking]}, drive ${p.filter.drive === 0 ? 'off' : p.filter.drive}. Press for the next type, Shift+press for the previous`)
      store.set('synth-amp-envelope', p.amp.velocity)
      note('synth-amp-envelope', `Amplifier velocity level ${p.amp.velocity === 0 ? 'off' : p.amp.velocity}; also shows the amplifier envelope on the Synth display`)
      for (const id of ['synth-osc-envelope', 'synth-filter-envelope']) note(id, 'Shows this envelope on the Synth display; the three dials edit attack, decay and release')
      const labels = PAGE_DIALS[ctx.ui.get().synthPage]
      ;(['synth-info-dial', 'synth-list-dial-1', 'synth-list-dial-2'] as const).forEach((id, i) => note(id, `${labels[i]} (${ctx.ui.get().synthPage} page of the Synth display)`))
    },
  }
}
