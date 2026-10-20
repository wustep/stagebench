// Printed displays and derived LEDs. Every readout here is computed from the instrument state, so a
// display can only say what the instrument is doing.

import { WAVEFORMS } from '../audio/synth/sources'
import { bpmFromKnob, programName, programEdited, type InstrumentState } from './instrument'
import { PROGRAM_PAGES, PROGRAM_SLOTS, slotLabel } from './program'
import { sceneOf, synthFocus, layerKey } from './hardware'

/** The Program display: the loaded program's number and name, with the edit and store states. */
export function programDisplayLines(state: InstrumentState): string[] {
  const { bank } = state
  if (state.storeAs) return ['STORE AS', `Name: ${state.storeAs.name}`]
  if (bank.storeArmed) return ['STORE', `Press a program, then STORE to save ${bank.liveMode ? '' : slotLabel(bank.selected)}`]
  if (bank.liveMode) return [`LIVE ${bank.liveSelected + 1}`, programName(state)]
  const edited = programEdited(state) ? ' E' : ''
  return [`${slotLabel(bank.selected)} ${programName(state)}${edited}`, `Page ${bank.page + 1} of ${PROGRAM_PAGES}`]
}

/** The Synth display: the selected layer, its waveform, and its key state. */
export function synthDisplayLines(state: InstrumentState): string[] {
  const focus = synthFocus(state.values)
  const waveform = WAVEFORMS[Math.round(state.values[layerKey('synth.osc-type', focus)] ?? 0)]?.name ?? 'Sine'
  const onKey = `synth.layer-${focus.toLowerCase()}-on`
  const onText = (state.values[onKey] ?? 0) >= 0.5 ? 'on' : 'off'
  const arp = (state.values['synth.arp-run'] ?? 0) >= 0.5 ? 'ARP RUN' : 'ARP STOP'
  return [`SYNTH ${focus}: ${waveform}`, `Layer ${onText} · ${arp}`]
}

/** Derived LED states that are not stored as presentation values: program buttons, Live, Store, scene, morph. */
export function derivedLeds(state: InstrumentState): Record<string, number> {
  const { bank } = state
  const leds: Record<string, number> = {}
  for (let button = 0; button < 8; button += 1) {
    const index = bank.liveMode ? bank.liveSelected : bank.page * 8 + button
    const lit = bank.liveMode ? button === bank.liveSelected : bank.selected === index
    leds[`program.button-${button + 1}`] = lit ? 1 : 0
  }
  leds['program.live-mode'] = bank.liveMode ? 1 : 0
  leds['program.store'] = bank.storeArmed ? 1 : 0
  leds['program.layer-scene'] = sceneOf(state.values)
  leds['program.morph-1'] = state.assign?.source === 'wheel' ? 1 : 0
  leds['program.morph-2'] = state.assign?.source === 'pedal' ? 1 : 0
  leds['program.dial'] = bank.selected / (PROGRAM_SLOTS - 1)
  leds['program.clock-bpm'] = (bpmFromKnob(state.values['program.clock-bpm'] ?? 0.4) - 30) / 270
  return leds
}

/** Which Program buttons show a stored program, for the list view and the page LEDs. */
export function storedSlotNames(state: InstrumentState): string[] {
  return Array.from({ length: PROGRAM_SLOTS }, (_, index) => `${slotLabel(index)} ${state.bank.slots[index]?.name ?? 'Init'}`)
}

