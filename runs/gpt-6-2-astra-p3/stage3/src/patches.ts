export const registrations = [
  'B3',
  'Vox',
  'Farf',
  'Pipe 1',
  'B3 Bass',
  'Pipe 2',
]
export const vibratos = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3']
export const waves = [
  'Sine',
  'Triangle',
  'Saw',
  'Square',
  'Pulse 33',
  'Pulse 10',
  'White Noise',
  'Sync Saw',
  'Sync Square',
  'Multi Saw',
  'Multi Saw 8ve',
  'Super Saw',
  'Super Square',
  'FM 2-op (algorithm A)',
]
export const waveGroups = [0, 7, 9, 11, 13]
export const categories = ['Pure', 'Sync', 'Multi', 'Super', 'FM-H']
export const divisions = [2, 4 / 3, 1, 2 / 3, 1 / 2, 1 / 3, 1 / 4, 1 / 6]
export function organPatch() {
  return {
    model: 0,
    bars: [8, 0, 8, 6, 0, 0, 0, 0, 0],
    percussion: false,
    soft: false,
    fast: false,
    third: false,
    click: true,
    vibrato: false,
    vibMode: 0,
  }
}
const envelope = () => ({ attack: 1, decay: 100, release: 12, velocity: 0 })
export function synthPatch() {
  return {
    wave: 2,
    ctrl: 35,
    coarse: 0,
    fine: 0,
    filter: true,
    filterType: 0,
    cutoff: 66,
    resonance: 12,
    tracking: 0,
    drive: 0,
    filterAmt: 35,
    oscAmt: 50,
    toPitch: false,
    oscEnv: envelope(),
    filterEnv: envelope(),
    ampEnv: { ...envelope(), velocity: 2 },
    lfoWave: 0,
    lfoDest: 0,
    lfoRate: 30,
    lfoAmt: 0,
    lfoSync: false,
    mode: 0,
    priority: 0,
    glide: 0,
    unison: 0,
    vibrato: 0,
    vibRate: 5,
    vibAmt: 4,
    arp: false,
    arpMode: 0,
    arpRate: 48,
    arpSync: false,
    range: 1,
    direction: 0,
    hold: false,
  }
}
export type OrganPatch = ReturnType<typeof organPatch>
export type SynthPatch = ReturnType<typeof synthPatch>
