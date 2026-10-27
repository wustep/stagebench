import type {
  BlockSpec,
  ControlSpec,
  NumericControl,
  SectionId,
  SelectorControl,
  SurfaceKind,
  SwitchControl,
} from './types'

/**
 * The six ordered sections of the shared Nord Stage 4 control deck.
 *
 * Widths are the photo-measured fractions from specs/nord-stage-4.visual.json
 * (`horizontalSectionsNote` records that 0.15/0.09/0.21 were superseded by these).
 * A cross-check against this run's reference photograph is recorded in
 * `stage1-visual-audit.md`.
 */
export interface SectionSpec {
  id: SectionId
  label: string
  fraction: number
  surface: SurfaceKind
  /** Legend printed above the section on the chassis, where the photo has one. */
  printedLabel?: string
}

export const SECTIONS: readonly SectionSpec[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, surface: 'exposed-chassis' },
  { id: 'organ', label: 'Organ', fraction: 0.2, surface: 'inset-plate', printedLabel: 'ORGAN SECTION' },
  { id: 'piano', label: 'Piano', fraction: 0.085, surface: 'inset-plate', printedLabel: 'PIANO SECTION' },
  { id: 'program', label: 'Program and morph', fraction: 0.125, surface: 'red-and-dark', printedLabel: 'PROGRAM' },
  { id: 'synth', label: 'Synth', fraction: 0.25, surface: 'inset-plate', printedLabel: 'SYNTH SECTION' },
  { id: 'effects', label: 'Layer effects', fraction: 0.2, surface: 'inset-plate', printedLabel: 'EFFECTS' },
]

interface CommonArgs {
  id: string
  section: SectionId
  block: string
  legend: string
  name: string
  hint?: string
}

function knob(
  a: CommonArgs,
  value: number,
  min: number,
  max: number,
  step: number,
  extra: Partial<NumericControl> = {},
): NumericControl {
  return { kind: 'knob', ...a, min, max, step, value, size: 'md', ...extra }
}

function fader(a: CommonArgs, value: number, extra: Partial<NumericControl> = {}): NumericControl {
  return { kind: 'fader', ...a, min: 0, max: 100, step: 1, value, leds: 8, cap: 'grey', ...extra }
}

function drawbar(a: CommonArgs, value: number, color: 'brown' | 'white' | 'black', footage: string): NumericControl {
  return {
    kind: 'drawbar',
    ...a,
    min: 0,
    max: 8,
    step: 1,
    value,
    leds: 8,
    cap: color,
    scale: ['0', '8'],
    hint: footage,
  }
}

function toggle(a: CommonArgs, on = false, extra: Partial<SwitchControl> = {}): SwitchControl {
  return { kind: 'toggle', ...a, value: on ? 1 : 0, led: 'red', ...extra }
}

function button(a: CommonArgs, extra: Partial<SwitchControl> = {}): SwitchControl {
  return { kind: 'button', ...a, value: 0, momentary: true, led: 'none', ...extra }
}

function selector(
  a: CommonArgs,
  options: string[],
  value = 0,
  extra: Partial<SelectorControl> = {},
): SelectorControl {
  return { kind: 'selector', ...a, options, value, led: 'red', ...extra }
}

function block(
  id: string,
  section: SectionId,
  spec: Omit<BlockSpec, 'id' | 'section' | 'controls'>,
  controls: ControlSpec[],
): BlockSpec {
  return { id, section, ...spec, controls }
}

/* ------------------------------------------------------------------ */
/* performance — exposed red chassis, no inset plate, no display       */
/* ------------------------------------------------------------------ */

const performance: BlockSpec[] = [
  block('performance.wheels', 'performance', { area: 'wheels' }, [
    {
      ...knob(
        {
          id: 'performance.pitch-stick',
          section: 'performance',
          block: 'performance.wheels',
          legend: 'PITCH STICK',
          name: 'Performance — Pitch stick',
        },
        0,
        -1,
        1,
        0.05,
      ),
      kind: 'pitch-stick',
      spring: true,
      restValue: 0,
      size: 'lg',
      scale: ['DOWN', 'UP'],
    },
    {
      ...knob(
        {
          id: 'performance.mod-wheel',
          section: 'performance',
          block: 'performance.wheels',
          legend: 'MOD WHEEL',
          name: 'Performance — Modulation wheel',
        },
        0,
        0,
        100,
        1,
      ),
      kind: 'wheel',
      size: 'lg',
      scale: ['MIN', 'MAX'],
    },
  ]),
  block('performance.master', 'performance', { area: 'master' }, [
    knob(
      {
        id: 'performance.master-level',
        section: 'performance',
        block: 'performance.master',
        legend: 'MASTER LEVEL',
        name: 'Performance — Master level',
      },
      78,
      0,
      100,
      1,
      { size: 'lg', scale: ['0', '10'] },
    ),
    toggle(
      {
        id: 'performance.monitor-head',
        section: 'performance',
        block: 'performance.master',
        legend: 'MONITOR HEAD IN',
        name: 'Performance — Monitor head input',
      },
      false,
      { led: 'none', size: 'sm' },
    ),
  ]),
  block(
    'performance.rotary',
    'performance',
    { area: 'rotary', legend: 'ROTARY SPEAKER', columns: 2 },
    [
      knob(
        {
          id: 'performance.rotary.drive',
          section: 'performance',
          block: 'performance.rotary',
          legend: 'DRIVE',
          name: 'Rotary speaker — Drive',
        },
        3,
        0,
        10,
        0.1,
        { size: 'sm', scale: ['0', '10'] },
      ),
      toggle(
        {
          id: 'performance.rotary.on',
          section: 'performance',
          block: 'performance.rotary',
          legend: 'ON',
          name: 'Rotary speaker — On',
        },
        false,
        { size: 'sm' },
      ),
      toggle(
        {
          id: 'performance.rotary.organ',
          section: 'performance',
          block: 'performance.rotary',
          legend: 'ORGAN',
          name: 'Rotary speaker — Organ routing',
        },
        false,
        { size: 'sm' },
      ),
      toggle(
        {
          id: 'performance.rotary.close-mic',
          section: 'performance',
          block: 'performance.rotary',
          legend: 'CLOSE MIC',
          name: 'Rotary speaker — Close mic',
        },
        false,
        { size: 'sm' },
      ),
      toggle(
        {
          id: 'performance.rotary.stop-mode',
          section: 'performance',
          block: 'performance.rotary',
          legend: 'STOP MODE',
          name: 'Rotary speaker — Stop mode',
        },
        false,
        { size: 'sm' },
      ),
      selector(
        {
          id: 'performance.rotary.speed',
          section: 'performance',
          block: 'performance.rotary',
          legend: 'SLOW / FAST',
          name: 'Rotary speaker — Speed',
        },
        ['SLOW', 'FAST'],
        0,
        { led: 'green', orientation: 'row' },
      ),
      button(
        {
          id: 'performance.rotary.morph',
          section: 'performance',
          block: 'performance.rotary',
          legend: 'MORPH',
          name: 'Rotary speaker — Morph assign',
        },
        { size: 'sm' },
      ),
    ],
  ),
]

/* ------------------------------------------------------------------ */
/* organ — dark inset plate, nine drawbars, no display                 */
/* ------------------------------------------------------------------ */

const organModels = ['FARF', 'VOX', 'B3', 'PIPE 1', 'PIPE 2', 'B3 BASS']

const organ: BlockSpec[] = [
  block('organ.layer', 'organ', { area: 'layer', legend: 'LAYER', columns: 2 }, [
    fader(
      { id: 'organ.layer.a.level', section: 'organ', block: 'organ.layer', legend: 'A', name: 'Organ — Layer A level' },
      72,
    ),
    fader(
      { id: 'organ.layer.b.level', section: 'organ', block: 'organ.layer', legend: 'B', name: 'Organ — Layer B level' },
      0,
    ),
    toggle(
      { id: 'organ.layer.a.on', section: 'organ', block: 'organ.layer', legend: 'A ON', name: 'Organ — Layer A on' },
      true,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'organ.layer.b.on', section: 'organ', block: 'organ.layer', legend: 'B ON', name: 'Organ — Layer B on' },
      false,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'organ.section.on', section: 'organ', block: 'organ.layer', legend: 'ON', name: 'Organ — Section on' },
      true,
      { size: 'sm' },
    ),
    toggle(
      { id: 'organ.sustped', section: 'organ', block: 'organ.layer', legend: 'SUSTPED', name: 'Organ — Sustain pedal routing' },
      true,
      { size: 'sm' },
    ),
    toggle(
      { id: 'organ.pstick', section: 'organ', block: 'organ.layer', legend: 'PSTICK', name: 'Organ — Pitch stick routing' },
      false,
      { size: 'sm' },
    ),
    toggle(
      { id: 'organ.aux-kb.a', section: 'organ', block: 'organ.layer', legend: 'A AUX KB', name: 'Organ — Layer A aux keyboard' },
      false,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'organ.aux-kb.b', section: 'organ', block: 'organ.layer', legend: 'B AUX KB', name: 'Organ — Layer B aux keyboard' },
      false,
      { led: 'green', size: 'sm' },
    ),
    button(
      { id: 'organ.preset', section: 'organ', block: 'organ.layer', legend: 'PRESET', name: 'Organ — Preset' },
      { size: 'sm' },
    ),
    button(
      { id: 'organ.sync', section: 'organ', block: 'organ.layer', legend: 'SYNC', name: 'Organ — Vibrato sync' },
      { size: 'sm' },
    ),
    button(
      { id: 'organ.octave.down', section: 'organ', block: 'organ.layer', legend: 'OCTAVE ▼', name: 'Organ — Octave shift down' },
      { size: 'sm' },
    ),
    button(
      { id: 'organ.octave.up', section: 'organ', block: 'organ.layer', legend: 'OCTAVE ▲', name: 'Organ — Octave shift up' },
      { size: 'sm' },
    ),
    toggle(
      { id: 'organ.kb-zone.1', section: 'organ', block: 'organ.layer', legend: 'KB ZONE 1', name: 'Organ — Keyboard zone 1' },
      true,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'organ.kb-zone.2', section: 'organ', block: 'organ.layer', legend: 'KB ZONE 2', name: 'Organ — Keyboard zone 2' },
      true,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'organ.kb-zone.3', section: 'organ', block: 'organ.layer', legend: 'KB ZONE 3', name: 'Organ — Keyboard zone 3' },
      false,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'organ.kb-zone.4', section: 'organ', block: 'organ.layer', legend: 'KB ZONE 4', name: 'Organ — Keyboard zone 4' },
      false,
      { led: 'green', size: 'sm' },
    ),
  ]),
  block('organ.model', 'organ', { area: 'model', legend: 'ORGAN MODEL', columns: 1 }, [
    selector(
      {
        id: 'organ.model.select',
        section: 'organ',
        block: 'organ.model',
        legend: 'MODEL',
        name: 'Organ — Model',
      },
      organModels,
      2,
      { orientation: 'column', led: 'red' },
    ),
  ]),
  block('organ.vib', 'organ', { area: 'vib', legend: 'VIB / CHORUS', columns: 1 }, [
    toggle(
      { id: 'organ.vib-chorus.on', section: 'organ', block: 'organ.vib', legend: 'ON', name: 'Organ — Vibrato/chorus on' },
      false,
      { size: 'sm' },
    ),
    selector(
      {
        id: 'organ.vib-chorus.type',
        section: 'organ',
        block: 'organ.vib',
        legend: 'V1 V2 V3 / C1 C2 C3',
        name: 'Organ — Vibrato/chorus type',
      },
      ['V1', 'V2', 'V3', 'C1', 'C2', 'C3'],
      3,
      { orientation: 'column', led: 'red' },
    ),
  ]),
  block('organ.percussion', 'organ', { area: 'perc', legend: 'B3 PERCUSSION', columns: 1 }, [
    toggle(
      {
        id: 'organ.percussion.volume',
        section: 'organ',
        block: 'organ.percussion',
        legend: 'VOLUME / SOFT',
        name: 'Organ — Percussion volume',
      },
      false,
      { size: 'sm' },
    ),
    toggle(
      {
        id: 'organ.percussion.decay',
        section: 'organ',
        block: 'organ.percussion',
        legend: 'DECAY / FAST',
        name: 'Organ — Percussion decay',
      },
      false,
      { size: 'sm' },
    ),
    toggle(
      {
        id: 'organ.percussion.harmonic',
        section: 'organ',
        block: 'organ.percussion',
        legend: 'HARMONIC / THIRD',
        name: 'Organ — Percussion harmonic',
      },
      false,
      { size: 'sm' },
    ),
    toggle(
      {
        id: 'organ.percussion.poly',
        section: 'organ',
        block: 'organ.percussion',
        legend: 'POLY',
        name: 'Organ — Percussion poly',
      },
      false,
      { size: 'sm' },
    ),
  ]),
  block('organ.drawbars', 'organ', { area: 'drawbars', columns: 9 }, [
    drawbar(
      {
        id: 'organ.drawbar.16',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "16' / BASS 16'",
        name: "Organ — Drawbar 16 foot",
      },
      8,
      'brown',
      "16'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.5-1-3',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "5⅓' / STR 16'",
        name: "Organ — Drawbar 5 1/3 foot",
      },
      0,
      'brown',
      "5⅓'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.8',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "8' / FLUTE 8'",
        name: "Organ — Drawbar 8 foot",
      },
      8,
      'white',
      "8'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.4',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "4' / OBOE 8'",
        name: "Organ — Drawbar 4 foot",
      },
      6,
      'white',
      "4'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.2-2-3',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "2⅔' / TRMP 8' II",
        name: "Organ — Drawbar 2 2/3 foot",
      },
      3,
      'black',
      "2⅔'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.2',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "2' / STR 8' III",
        name: "Organ — Drawbar 2 foot",
      },
      0,
      'white',
      "2'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.1-3-5',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "1⅗' / FLUTE 4' IV",
        name: "Organ — Drawbar 1 3/5 foot",
      },
      0,
      'black',
      "1⅗'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.1-1-3',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "1⅓' / STR 4'",
        name: "Organ — Drawbar 1 1/3 foot",
      },
      0,
      'white',
      "1⅓'",
    ),
    drawbar(
      {
        id: 'organ.drawbar.1',
        section: 'organ',
        block: 'organ.drawbars',
        legend: "1' / SINE",
        name: "Organ — Drawbar 1 foot",
      },
      0,
      'white',
      "1'",
    ),
  ]),
]

/* ------------------------------------------------------------------ */
/* piano — dark inset plate, no display, no drawbar bank               */
/* ------------------------------------------------------------------ */

const piano: BlockSpec[] = [
  block('piano.layer', 'piano', { area: 'layer', legend: 'LAYER', columns: 2 }, [
    fader(
      { id: 'piano.layer.a.level', section: 'piano', block: 'piano.layer', legend: 'A', name: 'Piano — Layer A level' },
      80,
    ),
    fader(
      { id: 'piano.layer.b.level', section: 'piano', block: 'piano.layer', legend: 'B', name: 'Piano — Layer B level' },
      0,
    ),
    toggle(
      { id: 'piano.layer.a.on', section: 'piano', block: 'piano.layer', legend: 'A ON', name: 'Piano — Layer A on' },
      true,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'piano.layer.b.on', section: 'piano', block: 'piano.layer', legend: 'B ON', name: 'Piano — Layer B on' },
      false,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'piano.section.on', section: 'piano', block: 'piano.layer', legend: 'ON', name: 'Piano — Section on' },
      true,
      { size: 'sm' },
    ),
    toggle(
      { id: 'piano.sustped', section: 'piano', block: 'piano.layer', legend: 'SUSTPED', name: 'Piano — Sustain pedal routing' },
      true,
      { size: 'sm' },
    ),
    toggle(
      { id: 'piano.pstick', section: 'piano', block: 'piano.layer', legend: 'PSTICK', name: 'Piano — Pitch stick routing' },
      false,
      { size: 'sm' },
    ),
    button(
      { id: 'piano.octave.down', section: 'piano', block: 'piano.layer', legend: 'OCTAVE ▼', name: 'Piano — Octave shift down' },
      { size: 'sm' },
    ),
    button(
      { id: 'piano.octave.up', section: 'piano', block: 'piano.layer', legend: 'OCTAVE ▲', name: 'Piano — Octave shift up' },
      { size: 'sm' },
    ),
    toggle(
      { id: 'piano.kb-zone.1', section: 'piano', block: 'piano.layer', legend: 'ZONE 1', name: 'Piano — Keyboard zone 1' },
      true,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'piano.kb-zone.2', section: 'piano', block: 'piano.layer', legend: 'ZONE 2', name: 'Piano — Keyboard zone 2' },
      true,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'piano.kb-zone.3', section: 'piano', block: 'piano.layer', legend: 'ZONE 3', name: 'Piano — Keyboard zone 3' },
      false,
      { led: 'green', size: 'sm' },
    ),
    toggle(
      { id: 'piano.kb-zone.4', section: 'piano', block: 'piano.layer', legend: 'ZONE 4', name: 'Piano — Keyboard zone 4' },
      false,
      { led: 'green', size: 'sm' },
    ),
  ]),
  block('piano.acoustics', 'piano', { area: 'acoustics', legend: 'ACOUSTICS', columns: 2 }, [
    toggle(
      { id: 'piano.soft-release', section: 'piano', block: 'piano.acoustics', legend: 'SOFT REL', name: 'Piano — Soft release' },
      false,
      { size: 'sm' },
    ),
    toggle(
      { id: 'piano.string-res', section: 'piano', block: 'piano.acoustics', legend: 'STRING RES', name: 'Piano — String resonance' },
      false,
      { size: 'sm' },
    ),
    toggle(
      { id: 'piano.ped-noise', section: 'piano', block: 'piano.acoustics', legend: 'PED NOISE', name: 'Piano — Pedal noise' },
      false,
      { size: 'sm' },
    ),
    selector(
      { id: 'piano.unison', section: 'piano', block: 'piano.acoustics', legend: 'UNISON', name: 'Piano — Unison' },
      ['OFF', '1', '2', '3'],
      0,
      { orientation: 'row' },
    ),
  ]),
  block('piano.dynamics', 'piano', { area: 'dynamics', legend: 'KB TOUCH / DYN COMP', columns: 2 }, [
    selector(
      { id: 'piano.kb-touch', section: 'piano', block: 'piano.dynamics', legend: 'KB TOUCH', name: 'Piano — Keyboard touch' },
      ['HEAVY', 'MED', 'LIGHT'],
      1,
      { orientation: 'row' },
    ),
    selector(
      { id: 'piano.dyn-comp', section: 'piano', block: 'piano.dynamics', legend: 'DYN COMP', name: 'Piano — Dynamic compression' },
      ['OFF', '1', '2', '3'],
      0,
      { orientation: 'row' },
    ),
  ]),
  block('piano.select', 'piano', { area: 'select', legend: 'PIANO SELECT', columns: 2 }, [
    selector(
      { id: 'piano.type', section: 'piano', block: 'piano.select', legend: 'TYPE', name: 'Piano — Type' },
      ['GRAND', 'UPRIGHT', 'ELECTRIC', 'CLAV', 'DIGITAL', 'MISC'],
      0,
      { orientation: 'row' },
    ),
    button(
      { id: 'piano.info', section: 'piano', block: 'piano.select', legend: 'INFO', name: 'Piano — Info' },
      { size: 'sm' },
    ),
    {
      ...knob(
        {
          id: 'piano.model',
          section: 'piano',
          block: 'piano.select',
          legend: 'MODEL / LIST',
          name: 'Piano — Model select',
        },
        1,
        1,
        9,
        1,
      ),
      kind: 'dial',
      size: 'sm',
      scale: ['1', '9'],
    },
  ]),
  block('piano.timbre', 'piano', { area: 'timbre', legend: 'TIMBRE', columns: 1 }, [
    selector(
      { id: 'piano.timbre', section: 'piano', block: 'piano.timbre', legend: 'TIMBRE', name: 'Piano — Timbre' },
      ['SOFT', 'MID', 'BRIGHT', 'DYNO 1', 'DYNO 2'],
      1,
      { orientation: 'column' },
    ),
  ]),
]

/* ------------------------------------------------------------------ */
/* program — primary OLED plus the eight program buttons               */
/* ------------------------------------------------------------------ */

const program: BlockSpec[] = [
  block('program.presets', 'program', { area: 'presets', legend: 'PRESET LIBRARY', columns: 3 }, [
    button({ id: 'program.preset.organ', section: 'program', block: 'program.presets', legend: 'ORGAN', name: 'Program — Organ preset library' }, { size: 'sm' }),
    button({ id: 'program.preset.piano', section: 'program', block: 'program.presets', legend: 'PIANO', name: 'Program — Piano preset library' }, { size: 'sm' }),
    button({ id: 'program.preset.synth', section: 'program', block: 'program.presets', legend: 'SYNTH', name: 'Program — Synth preset library' }, { size: 'sm' }),
  ]),
  block('program.morph', 'program', { area: 'morph', legend: 'MORPH ASSIGN', columns: 3 }, [
    button({ id: 'program.morph.wheel', section: 'program', block: 'program.morph', legend: 'WHEEL', name: 'Program — Morph assign wheel' }, { size: 'sm' }),
    button({ id: 'program.morph.at', section: 'program', block: 'program.morph', legend: 'A.T.', name: 'Program — Morph assign aftertouch' }, { size: 'sm' }),
    button({ id: 'program.morph.ctrlped', section: 'program', block: 'program.morph', legend: 'CTRLPED', name: 'Program — Morph assign control pedal' }, { size: 'sm' }),
  ]),
  block('program.nav', 'program', { area: 'nav', columns: 2 }, [
    {
      ...knob(
        { id: 'program.dial', section: 'program', block: 'program.nav', legend: 'PROGRAM DIAL', name: 'Program — Program dial' },
        11,
        1,
        32,
        1,
      ),
      kind: 'dial',
      size: 'lg',
      scale: ['1', '32'],
    },
    button({ id: 'program.page.up', section: 'program', block: 'program.nav', legend: 'PAGE ▲', name: 'Program — Page up' }, { size: 'sm' }),
    button({ id: 'program.page.down', section: 'program', block: 'program.nav', legend: 'PAGE ▼', name: 'Program — Page down' }, { size: 'sm' }),
    toggle({ id: 'program.live-mode', section: 'program', block: 'program.nav', legend: 'LIVE MODE', name: 'Program — Live mode' }, false, { size: 'sm' }),
    toggle({ id: 'program.layer-scene', section: 'program', block: 'program.nav', legend: 'LAYER SCENE II', name: 'Program — Layer scene II' }, false, { size: 'sm' }),
    button({ id: 'program.store', section: 'program', block: 'program.nav', legend: 'STORE', name: 'Program — Store' }, { size: 'sm' }),
    toggle({ id: 'program.split', section: 'program', block: 'program.nav', legend: 'SPLIT', name: 'Program — Split' }, false, { led: 'amber', size: 'sm' }),
  ]),
  block('program.slots', 'program', { area: 'slots', legend: 'PROGRAM', columns: 4 }, [
    button({ id: 'program.slot.1', section: 'program', block: 'program.slots', legend: '1 SYSTEM', name: 'Program — Program button 1' }, { size: 'sm', led: 'red' }),
    button({ id: 'program.slot.2', section: 'program', block: 'program.slots', legend: '2 SOUND', name: 'Program — Program button 2' }, { size: 'sm' }),
    button({ id: 'program.slot.3', section: 'program', block: 'program.slots', legend: '3 ORGANIZE', name: 'Program — Program button 3' }, { size: 'sm' }),
    button({ id: 'program.slot.4', section: 'program', block: 'program.slots', legend: '4 AUX KB', name: 'Program — Program button 4' }, { size: 'sm' }),
    button({ id: 'program.slot.5', section: 'program', block: 'program.slots', legend: '5 OUTPUT', name: 'Program — Program button 5' }, { size: 'sm' }),
    button({ id: 'program.slot.6', section: 'program', block: 'program.slots', legend: '6 PEDAL', name: 'Program — Program button 6' }, { size: 'sm' }),
    button({ id: 'program.slot.7', section: 'program', block: 'program.slots', legend: '7 MIDI', name: 'Program — Program button 7' }, { size: 'sm' }),
    button({ id: 'program.slot.8', section: 'program', block: 'program.slots', legend: '8 EXTERN', name: 'Program — Program button 8' }, { size: 'sm' }),
  ]),
  block('program.global', 'program', { area: 'global', columns: 2 }, [
    toggle({ id: 'program.mst-clk', section: 'program', block: 'program.global', legend: 'MST CLK TAP', name: 'Program — Master clock tap' }, false, { size: 'sm' }),
    toggle({ id: 'program.transpose.on', section: 'program', block: 'program.global', legend: 'TRANSP ON', name: 'Program — Transpose on' }, false, { size: 'sm' }),
    button({ id: 'program.transpose.set', section: 'program', block: 'program.global', legend: 'SET KEY', name: 'Program — Transpose set key' }, { size: 'sm' }),
    button({ id: 'program.panic', section: 'program', block: 'program.global', legend: 'PANIC', name: 'Program — Panic' }, { size: 'sm' }),
    button({ id: 'program.shift', section: 'program', block: 'program.global', legend: 'SHIFT / EXIT', name: 'Program — Shift and exit' }, { size: 'md' }),
  ]),
]

/* ------------------------------------------------------------------ */
/* synth — single narrow OLED, no wide display                        */
/* ------------------------------------------------------------------ */

const synth: BlockSpec[] = [
  block('synth.layer', 'synth', { area: 'layer', legend: 'LAYER', columns: 3 }, [
    fader({ id: 'synth.layer.a.level', section: 'synth', block: 'synth.layer', legend: 'A', name: 'Synth — Layer A level' }, 66),
    fader({ id: 'synth.layer.b.level', section: 'synth', block: 'synth.layer', legend: 'B', name: 'Synth — Layer B level' }, 0),
    fader({ id: 'synth.layer.c.level', section: 'synth', block: 'synth.layer', legend: 'C', name: 'Synth — Layer C level' }, 0),
    toggle({ id: 'synth.layer.a.on', section: 'synth', block: 'synth.layer', legend: 'A ON', name: 'Synth — Layer A on' }, true, { led: 'green', size: 'sm' }),
    toggle({ id: 'synth.layer.b.on', section: 'synth', block: 'synth.layer', legend: 'B ON', name: 'Synth — Layer B on' }, false, { led: 'green', size: 'sm' }),
    toggle({ id: 'synth.layer.c.on', section: 'synth', block: 'synth.layer', legend: 'C ON', name: 'Synth — Layer C on' }, false, { led: 'green', size: 'sm' }),
    toggle({ id: 'synth.section.on', section: 'synth', block: 'synth.layer', legend: 'ON', name: 'Synth — Section on' }, true, { size: 'sm' }),
    toggle({ id: 'synth.sustped', section: 'synth', block: 'synth.layer', legend: 'SUSTPED', name: 'Synth — Sustain pedal routing' }, true, { size: 'sm' }),
    toggle({ id: 'synth.kb-hold', section: 'synth', block: 'synth.layer', legend: 'KB HOLD', name: 'Synth — Keyboard hold' }, false, { size: 'sm' }),
  ]),
  block('synth.dials', 'synth', { area: 'dials', legend: 'OSC WAVEFORM', columns: 3 }, [
    {
      ...knob({ id: 'synth.dial.type', section: 'synth', block: 'synth.dials', legend: 'TYPE', name: 'Synth — Osc waveform type dial' }, 0, 0, 10, 1),
      kind: 'dial',
      size: 'sm',
    },
    {
      ...knob({ id: 'synth.dial.cat', section: 'synth', block: 'synth.dials', legend: 'CAT', name: 'Synth — Osc waveform category dial' }, 0, 0, 10, 1),
      kind: 'dial',
      size: 'sm',
    },
    {
      ...knob({ id: 'synth.dial.wave', section: 'synth', block: 'synth.dials', legend: 'WAVE', name: 'Synth — Osc waveform wave dial' }, 0, 0, 10, 1),
      kind: 'dial',
      size: 'sm',
    },
  ]),
  block('synth.mode', 'synth', { area: 'mode', legend: 'MODE', columns: 1 }, [
    selector(
      { id: 'synth.mode', section: 'synth', block: 'synth.mode', legend: 'MODE', name: 'Synth — Mode' },
      ['SAMPLES', 'ANALOG', 'EXTERN'],
      1,
      { orientation: 'column' },
    ),
  ]),
  block('synth.osc', 'synth', { area: 'osc', legend: 'OSCILLATORS', columns: 3 }, [
    toggle({ id: 'synth.osc.pitch', section: 'synth', block: 'synth.osc', legend: 'PITCH / SMP', name: 'Synth — Oscillator pitch and sample' }, false, { size: 'sm' }),
    toggle({ id: 'synth.osc.envelope', section: 'synth', block: 'synth.osc', legend: 'ENVELOPE', name: 'Synth — Oscillator envelope' }, false, { size: 'sm' }),
    knob({ id: 'synth.osc.ctrl', section: 'synth', block: 'synth.osc', legend: 'OSC CTRL', name: 'Synth — Oscillator control' }, 0, -10, 10, 0.1, { size: 'md' }),
    knob({ id: 'synth.osc.env-amt', section: 'synth', block: 'synth.osc', legend: 'ENV AMT', name: 'Synth — Oscillator envelope amount' }, 0, -10, 10, 0.1, { size: 'sm' }),
  ]),
  block('synth.filter', 'synth', { area: 'filter', legend: 'FILTER', columns: 3 }, [
    toggle({ id: 'synth.filter.on', section: 'synth', block: 'synth.filter', legend: 'FILTER ON', name: 'Synth — Filter on' }, true, { size: 'sm', led: 'green' }),
    selector(
      { id: 'synth.filter.type', section: 'synth', block: 'synth.filter', legend: 'TYPE', name: 'Synth — Filter type' },
      ['LP 12', 'LP 24', 'HP', 'BP'],
      1,
      { orientation: 'row' },
    ),
    knob({ id: 'synth.filter.freq', section: 'synth', block: 'synth.filter', legend: 'FREQ', name: 'Synth — Filter frequency' }, 6.4, 0, 10, 0.1, { size: 'lg', scale: ['0', '10'] }),
    knob({ id: 'synth.filter.res', section: 'synth', block: 'synth.filter', legend: 'RES', name: 'Synth — Filter resonance' }, 1.2, 0, 10, 0.1, { size: 'md', scale: ['0', '10'] }),
    knob({ id: 'synth.filter.env-amt', section: 'synth', block: 'synth.filter', legend: 'ENV AMT', name: 'Synth — Filter envelope amount' }, 0, 0, 10, 0.1, { size: 'sm' }),
  ]),
  block('synth.amp', 'synth', { area: 'amp', legend: 'AMP', columns: 2 }, [
    toggle({ id: 'synth.amp.envelope', section: 'synth', block: 'synth.amp', legend: 'ENVELOPE', name: 'Synth — Amp envelope' }, false, { size: 'sm' }),
    selector(
      { id: 'synth.amp.velocity', section: 'synth', block: 'synth.amp', legend: 'VELOCITY', name: 'Synth — Amp velocity' },
      ['OFF', '1', '2', '3'],
      2,
      { orientation: 'row' },
    ),
    selector(
      { id: 'synth.unison', section: 'synth', block: 'synth.amp', legend: 'UNISON', name: 'Synth — Unison' },
      ['OFF', '1', '2', '3'],
      0,
      { orientation: 'row' },
    ),
  ]),
  block('synth.lfo', 'synth', { area: 'lfo', legend: 'LFO', columns: 2 }, [
    selector(
      { id: 'synth.lfo.waveform', section: 'synth', block: 'synth.lfo', legend: 'WAVEFORM', name: 'Synth — LFO waveform' },
      ['TRI', 'SAW', 'SQR', 'S&H'],
      0,
      { orientation: 'row', led: 'green' },
    ),
    knob({ id: 'synth.lfo.mod-amt', section: 'synth', block: 'synth.lfo', legend: 'MOD AMT', name: 'Synth — LFO modulation amount' }, 2, 0, 10, 0.1, { size: 'sm' }),
    knob({ id: 'synth.lfo.rate', section: 'synth', block: 'synth.lfo', legend: 'RATE / TIME', name: 'Synth — LFO rate' }, 3.2, 0, 10, 0.1, { size: 'md' }),
  ]),
  block('synth.arp', 'synth', { area: 'arp', legend: 'ARPEGGIATOR / GATE', columns: 2 }, [
    knob({ id: 'synth.arp.rate', section: 'synth', block: 'synth.arp', legend: 'RATE / TIME', name: 'Synth — Arpeggiator rate' }, 7, 0, 10, 0.1, { size: 'md' }),
    knob({ id: 'synth.arp.range', section: 'synth', block: 'synth.arp', legend: 'RANGE / ENV', name: 'Synth — Arpeggiator range' }, 0, 0, 10, 0.1, { size: 'sm' }),
    selector(
      { id: 'synth.arp.mode', section: 'synth', block: 'synth.arp', legend: 'POLY / ARP / GATE', name: 'Synth — Arpeggiator mode' },
      ['POLY', 'ARP', 'GATE'],
      0,
      { orientation: 'row', led: 'green' },
    ),
    button({ id: 'synth.arp.pattern', section: 'synth', block: 'synth.arp', legend: 'PATTERN', name: 'Synth — Arpeggiator pattern' }, { size: 'sm' }),
  ]),
  block('synth.voice', 'synth', { area: 'voice', legend: 'VOICE / VIBRATO', columns: 2 }, [
    selector(
      { id: 'synth.voice.mode', section: 'synth', block: 'synth.voice', legend: 'MONO / LEGATO', name: 'Synth — Voice mode' },
      ['POLY', 'MONO', 'LEGATO'],
      0,
      { orientation: 'row', led: 'green' },
    ),
    knob({ id: 'synth.voice.glide', section: 'synth', block: 'synth.voice', legend: 'GLIDE', name: 'Synth — Voice glide' }, 0, 0, 10, 0.1, { size: 'sm' }),
    selector(
      { id: 'synth.vibrato', section: 'synth', block: 'synth.voice', legend: 'WHL / DLY / ON / A.T.', name: 'Synth — Vibrato source' },
      ['WHL', 'DLY', 'ON', 'A.T.'],
      0,
      { orientation: 'row', led: 'green' },
    ),
  ]),
]

/* ------------------------------------------------------------------ */
/* effects — two visible effect groups, no display                     */
/* ------------------------------------------------------------------ */

const effects: BlockSpec[] = [
  block('effects.mod1', 'effects', { area: 'mod1', legend: 'MOD 1', columns: 2 }, [
    knob({ id: 'effects.mod1.rate', section: 'effects', block: 'effects.mod1', legend: 'RATE', name: 'Mod 1 — Rate' }, 4, 0, 10, 0.1, { size: 'sm' }),
    knob({ id: 'effects.mod1.amount', section: 'effects', block: 'effects.mod1', legend: 'AMOUNT', name: 'Mod 1 — Amount' }, 3, 0, 10, 0.1, { size: 'sm' }),
    selector(
      { id: 'effects.mod1.type', section: 'effects', block: 'effects.mod1', legend: 'RM / TREM / A-PAN / A-WAH / WAH / PUMP', name: 'Mod 1 — Type' },
      ['RM', 'TREM', 'A-PAN', 'A-WAH', 'WAH', 'PUMP'],
      1,
      { orientation: 'column' },
    ),
    button({ id: 'effects.mod1.variation', section: 'effects', block: 'effects.mod1', legend: 'VARIATION', name: 'Mod 1 — Variation' }, { size: 'sm' }),
    toggle({ id: 'effects.mod1.on', section: 'effects', block: 'effects.mod1', legend: 'ON', name: 'Mod 1 — On' }, false, { size: 'sm' }),
  ]),
  block('effects.mod2', 'effects', { area: 'mod2', legend: 'MOD 2', columns: 2 }, [
    knob({ id: 'effects.mod2.rate', section: 'effects', block: 'effects.mod2', legend: 'RATE', name: 'Mod 2 — Rate' }, 5, 0, 10, 0.1, { size: 'sm' }),
    knob({ id: 'effects.mod2.amount', section: 'effects', block: 'effects.mod2', legend: 'AMOUNT', name: 'Mod 2 — Amount' }, 4, 0, 10, 0.1, { size: 'sm' }),
    selector(
      { id: 'effects.mod2.type', section: 'effects', block: 'effects.mod2', legend: 'CHOR / FLANG / PHAS / VIBE / ENS / SPIN', name: 'Mod 2 — Type' },
      ['CHOR', 'FLANG', 'PHAS', 'VIBE', 'ENS', 'SPIN'],
      0,
      { orientation: 'column' },
    ),
    button({ id: 'effects.mod2.variation', section: 'effects', block: 'effects.mod2', legend: 'VARIATION', name: 'Mod 2 — Variation' }, { size: 'sm' }),
    toggle({ id: 'effects.mod2.on', section: 'effects', block: 'effects.mod2', legend: 'ON', name: 'Mod 2 — On' }, false, { size: 'sm' }),
  ]),
  block('effects.amp', 'effects', { area: 'amp', legend: 'AMP SIM / EQ', columns: 3 }, [
    knob({ id: 'effects.amp.drive', section: 'effects', block: 'effects.amp', legend: 'DRIVE', name: 'Amp sim — Drive' }, 2, 0, 10, 0.1, { size: 'md' }),
    knob({ id: 'effects.amp.freq', section: 'effects', block: 'effects.amp', legend: 'FREQ 200Hz–8K', name: 'Amp sim — Frequency' }, 5, 0, 10, 0.1, { size: 'md', scale: ['200Hz', '8K'] }),
    knob({ id: 'effects.amp.bass', section: 'effects', block: 'effects.amp', legend: 'BASS', name: 'Amp sim — Bass' }, 0, -15, 15, 0.5, { size: 'sm', scale: ['-15', '+15'] }),
    knob({ id: 'effects.amp.mid', section: 'effects', block: 'effects.amp', legend: 'MID', name: 'Amp sim — Mid' }, 0, -15, 15, 0.5, { size: 'sm', scale: ['-15', '+15'] }),
    knob({ id: 'effects.amp.treble', section: 'effects', block: 'effects.amp', legend: 'TREBLE', name: 'Amp sim — Treble' }, 0, -15, 15, 0.5, { size: 'sm', scale: ['-15', '+15'] }),
    selector(
      { id: 'effects.amp.model', section: 'effects', block: 'effects.amp', legend: 'SMALL / JC / TWIN / TO ROTARY / LP / HP', name: 'Amp sim — Model' },
      ['SMALL', 'JC', 'TWIN', 'TO ROTARY', 'LP FILTER', 'HP FILTER'],
      0,
      { orientation: 'column' },
    ),
    toggle({ id: 'effects.amp.on', section: 'effects', block: 'effects.amp', legend: 'ON', name: 'Amp sim — On' }, false, { size: 'sm' }),
  ]),
  block('effects.delay', 'effects', { area: 'delay', legend: 'DELAY', columns: 3 }, [
    knob({ id: 'effects.delay.tempo', section: 'effects', block: 'effects.delay', legend: 'TEMPO', name: 'Delay — Tempo' }, 4, 0, 10, 0.1, { size: 'md' }),
    knob({ id: 'effects.delay.feedback', section: 'effects', block: 'effects.delay', legend: 'FEEDBACK', name: 'Delay — Feedback' }, 3, 0, 10, 0.1, { size: 'sm' }),
    knob({ id: 'effects.delay.dry-wet', section: 'effects', block: 'effects.delay', legend: 'DRY WET', name: 'Delay — Dry wet' }, 2, 0, 10, 0.1, { size: 'sm' }),
    button({ id: 'effects.delay.tap', section: 'effects', block: 'effects.delay', legend: 'TAP / SET', name: 'Delay — Tap tempo' }, { size: 'sm' }),
    selector(
      { id: 'effects.delay.filter', section: 'effects', block: 'effects.delay', legend: 'HP / BP / LP', name: 'Delay — Filter' },
      ['HP', 'BP', 'LP'],
      2,
      { orientation: 'row', led: 'green' },
    ),
    toggle({ id: 'effects.delay.ping-pong', section: 'effects', block: 'effects.delay', legend: 'PING PONG', name: 'Delay — Ping pong' }, false, { size: 'sm' }),
    toggle({ id: 'effects.delay.on', section: 'effects', block: 'effects.delay', legend: 'ON', name: 'Delay — On' }, false, { size: 'sm' }),
  ]),
  block('effects.comp', 'effects', { area: 'comp', legend: 'COMP', columns: 2 }, [
    knob({ id: 'effects.comp.amount', section: 'effects', block: 'effects.comp', legend: 'AMOUNT', name: 'Compressor — Amount' }, 3, 0, 10, 0.1, { size: 'md' }),
    toggle({ id: 'effects.comp.fast', section: 'effects', block: 'effects.comp', legend: 'FAST', name: 'Compressor — Fast' }, false, { size: 'sm' }),
    toggle({ id: 'effects.comp.on', section: 'effects', block: 'effects.comp', legend: 'ON', name: 'Compressor — On' }, false, { size: 'sm' }),
  ]),
  block('effects.reverb', 'effects', { area: 'reverb', legend: 'REVERB', columns: 2 }, [
    knob({ id: 'effects.reverb.dry-wet', section: 'effects', block: 'effects.reverb', legend: 'DRY WET', name: 'Reverb — Dry wet' }, 3, 0, 10, 0.1, { size: 'md' }),
    selector(
      { id: 'effects.reverb.type', section: 'effects', block: 'effects.reverb', legend: 'ROOM / BOOTH / SPRING / STAGE / HALL / CATH', name: 'Reverb — Type' },
      ['ROOM', 'BOOTH', 'SPRING', 'STAGE', 'HALL', 'CATH'],
      4,
      { orientation: 'column' },
    ),
    selector(
      { id: 'effects.reverb.tone', section: 'effects', block: 'effects.reverb', legend: 'BRIGHT / DARK', name: 'Reverb — Tone' },
      ['BRIGHT', 'DARK'],
      0,
      { orientation: 'row', led: 'green' },
    ),
    button({ id: 'effects.reverb.variation', section: 'effects', block: 'effects.reverb', legend: 'VAR / CHORALE', name: 'Reverb — Variation' }, { size: 'sm' }),
    toggle({ id: 'effects.reverb.on', section: 'effects', block: 'effects.reverb', legend: 'ON', name: 'Reverb — On' }, false, { size: 'sm' }),
  ]),
  block('effects.focus', 'effects', { area: 'focus', legend: 'LAYER EFFECTS', columns: 2 }, [
    button({ id: 'effects.focus.organ-a', section: 'effects', block: 'effects.focus', legend: 'ORGAN A', name: 'Layer effects — Organ layer A focus' }, { size: 'sm' }),
    button({ id: 'effects.focus.organ-b', section: 'effects', block: 'effects.focus', legend: 'ORGAN B', name: 'Layer effects — Organ layer B focus' }, { size: 'sm' }),
    button({ id: 'effects.focus.piano-a', section: 'effects', block: 'effects.focus', legend: 'PIANO A', name: 'Layer effects — Piano layer A focus' }, { size: 'sm' }),
    button({ id: 'effects.focus.piano-b', section: 'effects', block: 'effects.focus', legend: 'PIANO B', name: 'Layer effects — Piano layer B focus' }, { size: 'sm' }),
    button({ id: 'effects.focus.synth-a', section: 'effects', block: 'effects.focus', legend: 'SYNTH A', name: 'Layer effects — Synth layer A focus' }, { size: 'sm' }),
    button({ id: 'effects.focus.synth-b', section: 'effects', block: 'effects.focus', legend: 'SYNTH B', name: 'Layer effects — Synth layer B focus' }, { size: 'sm' }),
    button({ id: 'effects.focus.synth-c', section: 'effects', block: 'effects.focus', legend: 'SYNTH C', name: 'Layer effects — Synth layer C focus' }, { size: 'sm' }),
  ]),
]

export const BLOCKS: readonly BlockSpec[] = [...performance, ...organ, ...piano, ...program, ...synth, ...effects]

export const ALL_CONTROLS: readonly ControlSpec[] = BLOCKS.flatMap((b) => b.controls)

export function controlsBySection(section: SectionId): ControlSpec[] {
  return ALL_CONTROLS.filter((c) => c.section === section)
}

export function blocksBySection(section: SectionId): BlockSpec[] {
  return BLOCKS.filter((b) => b.section === section)
}

export function findControl(id: string): ControlSpec | undefined {
  return ALL_CONTROLS.find((c) => c.id === id)
}

export function sectionFraction(section: SectionId): number {
  const found = SECTIONS.find((s) => s.id === section)
  if (!found) throw new Error(`unknown section ${section}`)
  return found.fraction
}
