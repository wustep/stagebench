import { cycleCrossfade, clearMorphSource, setBpm, setModWheel, setSplitKey, setSplitPoint, setTransposeOn, setTransposeSemitones, stepSplitPosition, toggleScene, toggleSplit } from '../edits'
import { MORPH_SOURCES, morphCount, type MorphSource } from '../morph'
import { slotLabel, BUTTONS_PER_PAGE } from '../programs'
import type { EngineState } from '../state'
import { SPLIT_POINT_IDS, SPLIT_POINT_NAMES, positionName, splitIsOn } from '../zones'
import type { Binder, BindCtx } from './types'

const BUTTON_IDS = Array.from({ length: 8 }, (_, i) => `program-button-${i + 1}`)
const MORPH_BUTTON: Record<MorphSource, string> = { wheel: 'program-morph-wheel', pedal: 'program-morph-ctrlped' }
const TAP_WINDOW_MS = 2000
const DOUBLE_TAP_MS = 450

const IDS = [
  'program-dial',
  'program-page-prev',
  'program-page-next',
  'program-live-mode',
  'program-store',
  'program-layer-scene',
  'program-split',
  'program-master-clock-tap',
  'program-transpose',
  'program-prog-view',
  'program-solo',
  'program-shift',
  'effects-shift',
  'program-morph-wheel',
  'program-morph-ctrlped',
  'mod-wheel',
  ...BUTTON_IDS,
] as const

export function programBinder(): Binder {
  let taps: number[] = []
  const lastTap: Record<MorphSource, number> = { wheel: -Infinity, pedal: -Infinity }
  const holdFired: Record<MorphSource, boolean> = { wheel: false, pedal: false }
  let unobserve: (() => void) | null = null
  let splitHoldFired = false

  const observe = (ctx: BindCtx) => {
    if (unobserve) return
    // SET KEY: while a split point is being edited, the next key pressed becomes its position
    unobserve = ctx.observeNotes((note) => {
      const point = ctx.ui.get().splitEdit
      if (point) ctx.edit((s) => setSplitKey(s, point, note))
    })
  }

  return {
    ids: IDS,
    dials: ['program-dial'],
    continuous: { 'mod-wheel': (s, v) => setModWheel(s, v) },
    press(a, ctx) {
      observe(ctx)
      const programs = ctx.programs
      const id = a.id
      const value = ctx.store.get(id).value
      const shift = ctx.shiftHeld(a)
      const snap = programs?.getSnapshot()
      if (id === 'program-shift' || id === 'effects-shift') {
        if (snap?.store) programs?.cancelStore() // Shift / Exit cancels the store flow (manual p. 13)
        return id === 'program-shift'
      }
      if (id === 'program-solo') {
        if (shift) programs?.undo()
        else ctx.edit((s) => (s.solo ? { ...s, solo: null } : { ...s, solo: ctx.lastSection() }))
        return true
      }
      if (!programs) return false
      switch (id) {
        case 'program-store':
          programs.pressStore(shift)
          return true
        case 'program-live-mode':
          programs.setMode(value > 0 ? 'live' : 'program')
          return true
        case 'program-page-prev':
        case 'program-page-next': {
          const dir = id === 'program-page-next' ? 1 : -1
          if (snap?.store?.step === 'name') programs.nameCursor(dir)
          else if (snap?.mode === 'live') programs.message('Live mode has one page of 8 slots')
          else programs.stepPage(dir)
          return true
        }
        case 'program-layer-scene':
          ctx.edit((s) => (value > 0 === (s.scene === 1) ? s : toggleScene(s)))
          return true
        case 'program-prog-view':
          ctx.ui.update({ progView: ctx.ui.get().progView === 'main' ? 'detail' : 'main' })
          return true
        case 'program-transpose':
          if (shift) {
            ctx.panic()
            ctx.reflect()
            return true
          }
          ctx.edit((s) => setTransposeOn(s, value > 0))
          return true
        case 'program-master-clock-tap': {
          const t = ctx.now()
          if (taps.length && t - taps[taps.length - 1] > TAP_WINDOW_MS) taps = []
          taps.push(t)
          taps = taps.slice(-8)
          if (taps.length >= 4) {
            const intervals = taps.slice(1).map((x, i) => x - taps[i])
            const bpm = 60000 / (intervals.reduce((x, y) => x + y, 0) / intervals.length)
            ctx.edit((s) => setBpm(s, bpm))
            ctx.flash(`Master clock ${ctx.engine.get().clock.bpm} BPM`)
          } else ctx.flash(`Master clock: tap ${taps.length} of 4`)
          return true
        }
        case 'program-split':
          splitHoldFired = false
          ctx.startHold(id, () => {
            splitHoldFired = true
            const editing = ctx.ui.get().splitEdit
            if (editing) ctx.ui.update({ splitEdit: null })
            else {
              ctx.edit((s) => (splitIsOn(s.split) ? s : toggleSplit(s)))
              ctx.ui.update({ splitEdit: 'mid' })
            }
            ctx.reflect()
          })
          return true
        case 'program-morph-wheel':
        case 'program-morph-ctrlped': {
          const source: MorphSource = id === 'program-morph-wheel' ? 'wheel' : 'pedal'
          holdFired[source] = false
          const morph = ctx.ui.get().morph
          if (shift) {
            ctx.edit((s) => clearMorphSource(s, source))
            if (morph?.source === source) ctx.ui.update({ morph: null })
            ctx.consume(id)
            programs.message(`${source === 'wheel' ? 'Wheel' : 'Control pedal'} morph cleared`)
            return true
          }
          if (morph?.source === source && morph.latched) {
            ctx.ui.update({ morph: null })
            ctx.consume(id)
            ctx.reflect()
            return true
          }
          ctx.startHold(id, () => {
            holdFired[source] = true
            ctx.ui.update({ morph: { source, latched: false } })
            ctx.reflect()
          })
          return true
        }
      }
      const n = BUTTON_IDS.indexOf(id)
      if (n >= 0 && snap) {
        const editing = ctx.ui.get().splitEdit
        if (editing) {
          if (n <= 2) ctx.ui.update({ splitEdit: SPLIT_POINT_IDS[n] })
          else if (n === 3) ctx.edit((s) => setSplitPoint(s, editing, { active: !s.split[editing].active }))
          else if (n === 4) ctx.edit((s) => cycleCrossfade(s, editing))
          return true
        }
        if (snap.store?.step === 'name') {
          if (n === 0) programs.nameInsert()
          else if (n === 1) programs.nameDelete()
          return true
        }
        if (shift) {
          programs.message('Shift menus (System, Sound, Organize, Output, Pedal, MIDI, Aux KB, Extern) are not built')
          return true
        }
        programs.select(snap.mode === 'live' ? n : snap.page * BUTTONS_PER_PAGE + n)
        return true
      }
      return false
    },
    release(a, ctx) {
      const id = a.id
      if (BUTTON_IDS.includes(id)) {
        // the program buttons are momentary: their LED shows the selection, so it is written back after the release
        ctx.reflect()
        return true
      }
      if (id === 'program-split') {
        const fired = ctx.endHold(id) || splitHoldFired
        splitHoldFired = false
        if (!fired) {
          if (ctx.ui.get().splitEdit) ctx.ui.update({ splitEdit: null })
          else ctx.edit((s) => toggleSplit(s))
        }
        ctx.reflect()
        return true
      }
      const source: MorphSource | null = id === 'program-morph-wheel' ? 'wheel' : id === 'program-morph-ctrlped' ? 'pedal' : null
      if (source) {
        const consumed = ctx.endHold(id)
        if (holdFired[source]) {
          holdFired[source] = false
          if (!ctx.ui.get().morph?.latched) ctx.ui.update({ morph: null })
        } else if (!consumed) {
          const t = ctx.now()
          if (t - lastTap[source] < DOUBLE_TAP_MS) {
            lastTap[source] = -Infinity
            ctx.ui.update({ morph: { source, latched: true } })
          } else {
            lastTap[source] = t
            ctx.programs?.message(`${source === 'wheel' ? 'Wheel' : 'Control pedal'} morph: hold, or double-tap to latch, then move a control to assign it`)
          }
        }
        ctx.reflect()
        return true
      }
      return false
    },
    dial(id, delta, ctx) {
      const programs = ctx.programs
      if (!programs) return false
      if (ctx.store.get('program-master-clock-tap').held) {
        ctx.edit((st) => setBpm(st, st.clock.bpm + delta))
        ctx.flash(`Master clock ${ctx.engine.get().clock.bpm} BPM`)
        return true
      }
      if (ctx.store.get('program-transpose').held) {
        ctx.edit((st) => setTransposeSemitones(st, st.transpose.semitones + delta))
        return true
      }
      const editing = ctx.ui.get().splitEdit
      if (editing) {
        ctx.edit((st) => stepSplitPosition(setSplitPoint(st, editing, { active: true }), editing, delta))
        return true
      }
      if (ctx.shiftHeld()) programs.openList()
      programs.step(delta)
      return true
    },
    sync(s: EngineState, ctx: BindCtx) {
      const { store, programs } = ctx
      const ui = ctx.ui.get()
      const on = (id: string, v: boolean) => store.set(id, v ? 1 : 0)
      store.set('mod-wheel', s.modWheel)
      on('program-layer-scene', s.scene === 1)
      store.patch('program-layer-scene', { note: `Layer scene ${s.scene === 0 ? 'I' : 'II'} is active. Press to switch scene: only which layers are on changes` })
      on('program-solo', s.solo !== null)
      store.patch('program-solo', { note: 'Solo isolates the section touched last. Shift+press: undo the edits discarded by the last program change' })
      on('program-transpose', s.transpose.on)
      store.patch('program-transpose', {
        note: `Transpose ${s.transpose.on ? 'on' : 'off'}, ${s.transpose.semitones >= 0 ? '+' : ''}${s.transpose.semitones} semitones. Hold and turn the Program dial to set it. Shift+press: Panic`,
      })
      on('program-split', splitIsOn(s.split))
      store.patch('program-split', {
        focused: ui.splitEdit ? true : undefined,
        note: ui.splitEdit
          ? `Editing the ${SPLIT_POINT_NAMES[ui.splitEdit]} split point: turn the Program dial or press a key to move it; program buttons 1-3 pick Low, Mid, High; 4 switches the point on or off; 5 steps the crossfade`
          : `Split ${splitIsOn(s.split) ? 'on' : 'off'}. Tap to switch a Mid split at C4 on or off; hold to edit the points`,
      })
      for (const source of MORPH_SOURCES) {
        const assigning = ui.morph?.source === source
        const assigned = morphCount(s.morph, source) > 0
        on(MORPH_BUTTON[source], assigning || assigned)
        store.patch(MORPH_BUTTON[source], {
          focused: assigning ? true : undefined,
          note: `${assigned ? `${morphCount(s.morph, source)} destination${morphCount(s.morph, source) > 1 ? 's' : ''} assigned. ` : 'Nothing assigned. '}Hold, or double-tap to latch, then move a control to assign it. Shift+press clears this source`,
        })
      }
      on('program-master-clock-tap', false)
      store.patch('program-master-clock-tap', { note: `Master clock ${s.clock.bpm} BPM. Tap four times to set it, or hold and turn the Program dial` })
      if (!programs) return
      const snap = programs.getSnapshot()
      on('program-live-mode', snap.store?.step === 'dest' ? snap.store.dest.mode === 'live' : snap.mode === 'live')
      store.patch('program-live-mode', { note: snap.mode === 'live' ? 'Live mode: all edits are stored automatically' : 'Switches the eight program buttons to the eight Live slots' })
      store.patch('program-store', { focused: snap.store ? true : undefined, note: snap.store ? `Storing: ${snap.store.step === 'name' ? 'press Store to accept the name' : `press Store again to write ${slotLabel(snap.store.dest.mode, snap.store.dest.index)}; Shift cancels`}` : 'Store the program; Shift+Store is Store As with naming' })
      store.patch('program-dial', { note: `Program ${snap.slotLabel} ${snap.name}. Turn to browse; Shift+turn opens the numeric list; hold Master Clock or Transpose to set them` })
      // the eight program buttons
      BUTTON_IDS.forEach((id, n) => {
        let lit = false
        let blink = false
        let text = ''
        if (ui.splitEdit) {
          const p = ui.splitEdit
          const pt = s.split[p]
          lit = n <= 2 ? SPLIT_POINT_IDS[n] === p : n === 3 ? pt.active : n === 4 ? pt.crossfade > 0 : false
          text = n <= 2 ? `Split point ${SPLIT_POINT_NAMES[SPLIT_POINT_IDS[n]]} (${positionName(s.split[SPLIT_POINT_IDS[n]].position)})` : n === 3 ? `Split point ${SPLIT_POINT_NAMES[p]} ${pt.active ? 'on' : 'off'}` : n === 4 ? `Crossfade ${pt.crossfade === 0 ? 'off' : `±${pt.crossfade}`}` : 'Unused while editing a split'
        } else if (snap.store?.step === 'name') {
          text = n === 0 ? 'Insert a space at the cursor' : n === 1 ? 'Delete the character at the cursor' : 'Unused while naming'
        } else {
          const dest = snap.store?.step === 'dest' ? snap.store.dest : null
          const shownMode = dest ? dest.mode : snap.mode
          const shownIndex = dest ? dest.index : snap.index
          const slot = shownMode === 'live' ? n : snap.page * BUTTONS_PER_PAGE + n
          const name = shownMode === 'live' ? snap.liveNames[n] : snap.names[slot]
          lit = shownMode === 'live' ? shownIndex === n : shownIndex === slot
          blink = lit && (dest !== null || (snap.dirty && !dest))
          text = `${shownMode === 'live' ? 'Live slot' : 'Program'} ${slotLabel(shownMode, slot)} ${name}`
        }
        store.set(id, lit ? 1 : 0)
        store.patch(id, { focused: blink ? true : undefined, note: text })
      })
      store.patch('program-page-prev', { note: snap.store?.step === 'name' ? 'Move the naming cursor left' : `Page ${snap.page + 1} of 4; press for the previous page` })
      store.patch('program-page-next', { note: snap.store?.step === 'name' ? 'Move the naming cursor right' : `Page ${snap.page + 1} of 4; press for the next page` })
    },
    dispose() {
      unobserve?.()
      unobserve = null
    },
  }
}
