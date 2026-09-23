// piano.instrument-library, piano.velocity-controls and piano.fallback — rendered through the
// real Phase 2 engine (bundled sample packs read from public/, simulated Web Audio graph).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { modelsOfType, PIANO_MODELS, PIANO_TYPES, timbresFor, type PianoType } from '../audio/instruments'
import { PACK_FILES, packOf } from '../audio/library'
import { parsePack } from '../audio/samplePack'
import { masterGain } from '../audio/stageAudio'
import { updateLayer, type SoundState } from '../model/sound'
import { readPublicAsset } from '../testing/fakes'
import { brightness, difference, peak, rms } from '../testing/simAudio'
import { makeStageRig } from '../testing/stageRig'

const SR = 16000
const withLayer = (patch: Parameters<typeof updateLayer>[2]) => (s: SoundState) => updateLayer(s, 'A', patch)

/** Render one note with layer A set up by `patch` (fresh engine per render). */
async function note(patch: Parameters<typeof updateLayer>[2], n = 60, velocity = 100, hold = 0.35, tail = 0.15) {
  const rig = await makeStageRig({ sound: withLayer(patch) })
  return rig.play(n, velocity, hold, tail)
}

describe('piano.instrument-library — six types, recorded Grand/Upright/Electric', () => {
  it('declares six selectable types with at least one model each; Grand/Upright/Electric are recorded packs', () => {
    expect(PIANO_TYPES).toEqual(['grand', 'upright', 'electric', 'clav', 'digital', 'misc'])
    for (const t of PIANO_TYPES) expect(modelsOfType(t).length).toBeGreaterThan(0)
    for (const t of ['grand', 'upright', 'electric'] as const) for (const m of modelsOfType(t)) expect(m.source.kind).toBe('recorded')
    for (const t of ['clav', 'digital', 'misc'] as const) for (const m of modelsOfType(t)) expect(m.source.kind).toBe('generated')
  })

  it('bundled packs have enough roots and velocity layers to avoid obvious pitch shifting', () => {
    // Largest shift from any E1–E7 key to its nearest recorded root. The Wurlitzer source was only
    // recorded at 20 pitches (33…92), so its extreme keys shift further; this is declared in
    // IMPLEMENTATION_DETAILS.json rather than hidden.
    const maxShift = { grand: 2, upright: 2, electric: 8 }
    for (const key of ['grand', 'upright', 'electric'] as const) {
      const pack = parsePack(readPublicAsset(PACK_FILES[key]))
      const roots = [...new Set(pack.header.zones.map((z) => z.root))].sort((a, b) => a - b)
      const layers = new Set(pack.header.zones.map((z) => z.layer))
      expect(roots.length, key).toBeGreaterThanOrEqual(20)
      expect(layers.size, key).toBeGreaterThanOrEqual(2)
      let worst = 0
      let inside = 0
      for (let n = 28; n <= 100; n++) {
        const d = Math.min(...roots.map((r) => Math.abs(r - n)))
        worst = Math.max(worst, d)
        if (n >= roots[0] && n <= roots[roots.length - 1]) inside = Math.max(inside, d)
      }
      expect(worst, key).toBeLessThanOrEqual(maxShift[key])
      expect(inside, key).toBeLessThanOrEqual(key === 'electric' ? 4 : 2)
      // Every velocity range 1…127 maps to a layer.
      for (let v = 1; v <= 127; v++) expect(pack.header.zones.some((z) => v >= z.velLo && v <= z.velHi)).toBe(true)
      expect(pack.header.license).toMatch(/^CC/)
      expect(pack.header.recordedInstrument.length).toBeGreaterThan(3)
    }
  })

  it('every type plays a real, non-silent note offline (no network: packs come from the bundle)', async () => {
    for (const type of PIANO_TYPES) {
      const out = await note({ type })
      expect(rms(out), type).toBeGreaterThan(0.003)
    }
  })

  it('Grand, Upright and Electric are audibly distinct recordings (not one pitch-shifted source)', async () => {
    const outs = await Promise.all((['grand', 'upright', 'electric'] as PianoType[]).map((type) => note({ type })))
    expect(difference(outs[0], outs[1])).toBeGreaterThan(0.3)
    expect(difference(outs[0], outs[2])).toBeGreaterThan(0.3)
    expect(difference(outs[1], outs[2])).toBeGreaterThan(0.3)
  })

  it('synthesized types (Clav, Digital, Misc) are distinct from each other and from the recordings', async () => {
    const types: PianoType[] = ['grand', 'clav', 'digital', 'misc']
    const outs = await Promise.all(types.map((type) => note({ type })))
    for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) expect(difference(outs[i], outs[j]), `${types[i]}/${types[j]}`).toBeGreaterThan(0.3)
  })

  it('the model dial selects within a type: second models play different sources', async () => {
    for (const type of ['electric', 'clav', 'digital', 'misc'] as PianoType[]) {
      expect(modelsOfType(type).length).toBeGreaterThan(1)
      const a = await note({ type, models: { grand: 0, upright: 0, electric: 0, clav: 0, digital: 0, misc: 0 } })
      const b = await note({ type, models: { grand: 0, upright: 0, electric: 1, clav: 1, digital: 1, misc: 1 } })
      expect(difference(a, b), type).toBeGreaterThan(0.2)
    }
  })

  it('recorded velocity layers: a soft and a hard note use different recordings', async () => {
    const rig = await makeStageRig()
    const pack = rig.library.pack('grand')!
    const zSoft = rig.library.zoneFor(rig.ctx, PIANO_MODELS[0], 60, 20)!
    const zHard = rig.library.zoneFor(rig.ctx, PIANO_MODELS[0], 60, 120)!
    expect(zSoft.layer).not.toBe(zHard.layer)
    expect(pack.header.zones.some((z) => z.layer === zSoft.layer)).toBe(true)
    // Hard notes are brighter as recorded, not just louder.
    const soft = rig.play(60, 30, 0.3, 0.05)
    rig.engine.allNotesOff()
    rig.render(0.3)
    const hard = rig.play(60, 120, 0.3, 0.05)
    expect(rms(hard)).toBeGreaterThan(rms(soft) * 1.5)
    expect(brightness(hard, 0, 3000) / brightness(soft, 0, 3000)).toBeGreaterThan(1.05)
  })

  it('provenance: IMPLEMENTATION_DETAILS.json lists every bundled pack with license, roots and layers', () => {
    const details = JSON.parse(readFileSync(resolve(__dirname, '../../IMPLEMENTATION_DETAILS.json'), 'utf8'))
    // Phase 3 regenerates the same file (phase 3); the piano provenance must stay intact.
    expect(details.phase).toBeGreaterThanOrEqual(2)
    const sources = details.audio.sampleSources as { name: string; files: string[]; license: string; source: string; zones: { root: number; layer: string; file: string }[] }[]
    for (const key of Object.keys(PACK_FILES) as (keyof typeof PACK_FILES)[]) {
      const pack = parsePack(readPublicAsset(PACK_FILES[key]))
      const entry = sources.find((s) => s.files.includes(`public/${PACK_FILES[key]}`))
      expect(entry, key).toBeDefined()
      expect(entry!.license).toBe(pack.header.license)
      expect(entry!.zones.length).toBe(pack.header.zones.length)
      for (const z of pack.header.zones) expect(entry!.zones.some((e) => e.root === z.root && e.layer === z.layer && e.file === z.source)).toBe(true)
      expect(readFileSync(resolve(__dirname, `../../public/samples/licenses/${key}-LICENSE.txt`), 'utf8')).toMatch(/License/i)
    }
    // Generated sources are declared as generated, never as recordings.
    const generated = details.audio.generatedSources as { name: string; kind: string }[]
    for (const m of PIANO_MODELS.filter((x) => x.source.kind === 'generated')) expect(generated.some((g) => g.name.includes(m.name) && g.kind === 'generated-buffer')).toBe(true)
    expect(generated.some((g) => /reverb/i.test(g.name))).toBe(true)
    for (const m of PIANO_MODELS) if (packOf(m)) expect(sources.some((s) => s.name.includes(m.name))).toBe(true)
  })
})

describe('piano.velocity-controls — every performance control changes rendered audio', () => {
  it('KB Touch: Heavy is quieter than Light for the same played velocity', async () => {
    const heavy = await note({ kbTouch: 'heavy' }, 60, 70)
    const medium = await note({ kbTouch: 'medium' }, 60, 70)
    const light = await note({ kbTouch: 'light' }, 60, 70)
    expect(rms(light)).toBeGreaterThan(rms(medium) * 1.1)
    expect(rms(medium)).toBeGreaterThan(rms(heavy) * 1.1)
  })

  it('Dyn Comp raises soft strokes and narrows the dynamic range (Off/1/2/3)', async () => {
    const range = async (dynComp: number) => rms(await note({ dynComp }, 60, 110)) / rms(await note({ dynComp }, 60, 25))
    const r0 = await range(0)
    const r1 = await range(1)
    const r3 = await range(3)
    expect(r1).toBeLessThan(r0)
    expect(r3).toBeLessThan(r1)
    const soft0 = rms(await note({ dynComp: 0 }, 60, 25))
    const soft3 = rms(await note({ dynComp: 3 }, 60, 25))
    expect(soft3).toBeGreaterThan(soft0 * 1.5)
  })

  it('Timbre: Soft darkens, Bright brightens, Mid differs; Dyno settings exist only for electric', async () => {
    const off = await note({ timbre: 'off' })
    const soft = await note({ timbre: 'soft' })
    const bright = await note({ timbre: 'bright' })
    const mid = await note({ timbre: 'mid' })
    expect(brightness(soft)).toBeLessThan(brightness(off))
    expect(brightness(bright)).toBeGreaterThan(brightness(off))
    expect(difference(mid, off)).toBeGreaterThan(0.1)
    expect(timbresFor('acoustic')).not.toContain('dyno1')
    const eOff = await note({ type: 'electric', timbre: 'off' })
    const d1 = await note({ type: 'electric', timbre: 'dyno1' })
    const d2 = await note({ type: 'electric', timbre: 'dyno2' })
    expect(difference(d1, eOff)).toBeGreaterThan(0.1)
    expect(difference(d2, d1)).toBeGreaterThan(0.1)
  })

  it('Unison adds detuned stereo voices: 1 is subtle, 3 is wide', async () => {
    const width = async (unison: number) => {
      const rig = await makeStageRig({ sound: withLayer({ unison }) })
      rig.engine.noteOn(60, 100, 't')
      const { left, right } = rig.ctx.renderStereo(0.4)
      return { width: difference(left, right), mono: Float32Array.from(left, (l, i) => (l + right[i]) / 2), voices: rig.ctx.liveSourceCount() }
    }
    const off = await width(0)
    const u1 = await width(1)
    const u3 = await width(3)
    expect(off.width).toBeLessThan(1e-6)
    expect(u1.width).toBeGreaterThan(0.05)
    expect(u3.width).toBeGreaterThan(u1.width)
    expect(u3.voices).toBe(3)
    expect(difference(u3.mono, off.mono)).toBeGreaterThan(0.1)
  })

  it('Soft Release lengthens the release (not for Clav); String Res adds sympathetic resonance', async () => {
    const tail = (x: Float32Array) => rms(x, Math.round(0.37 * SR), Math.round(0.5 * SR))
    const normal = await note({ softRelease: false }, 60, 100, 0.35, 0.15)
    const softRel = await note({ softRelease: true }, 60, 100, 0.35, 0.15)
    expect(tail(softRel)).toBeGreaterThan(tail(normal) * 1.5)
    const clav = await note({ type: 'clav', softRelease: false })
    const clavSoft = await note({ type: 'clav', softRelease: true })
    expect(difference(clav, clavSoft)).toBeLessThan(1e-6)
    const dry = await note({ stringRes: false })
    const res = await note({ stringRes: true })
    expect(difference(res, dry)).toBeGreaterThan(0.01)
  })

  it('Master Level scales the output (0 = silence) and layer level scales the layer', async () => {
    const at = async (master: number, level = 110) => {
      const rig = await makeStageRig({ sound: (s) => ({ ...updateLayer(s, 'A', { level }), master }) })
      return rig.play(60, 100, 0.3, 0.05)
    }
    const full = await at(127)
    const ref = await at(96)
    const zero = await at(0)
    expect(rms(full)).toBeGreaterThan(rms(ref) * 1.3)
    expect(peak(zero)).toBe(0)
    expect(masterGain(0)).toBe(0)
    expect(rms(await at(96, 50))).toBeLessThan(rms(ref) * 0.5)
  })
})

describe('piano.fallback — asset failure is labelled, playable, and never reported ready', () => {
  it('a failed Grand pack reports fallback (not ready), names the failure, and still plays', async () => {
    const rig = await makeStageRig({ failAssets: ['samples/grand.nspk'] })
    const status = rig.stage.status
    expect(status.voice).toBe('fallback')
    expect(status.detail).toMatch(/Grand samples failed to load/)
    expect(status.detail).toMatch(/labelled synthesized fallback/)
    expect(status.fallbackModels).toContain('Salamander Grand')
    const out = rig.play(60)
    expect(rms(out)).toBeGreaterThan(0.003)
    // Other recorded models still play their own samples.
    rig.set((s) => updateLayer(s, 'A', { type: 'upright' }))
    expect(rig.library.modelStatus(modelsOfType('upright')[0])).toBe('ready')
    expect(rig.stage.status.fallbackModels).toEqual([])
  })

  it('with every asset failing, the keybed still sounds and the status never says ready', async () => {
    const rig = await makeStageRig({ failAssets: Object.values(PACK_FILES) })
    expect(rig.stage.status.voice).toBe('fallback')
    for (const type of ['grand', 'upright', 'electric'] as PianoType[]) {
      rig.set((s) => updateLayer(s, 'A', { type }))
      expect(rms(rig.play(60, 100, 0.2, 0.05))).toBeGreaterThan(0.003)
    }
  })

  it('reports loading before the library is ready', async () => {
    const { PianoLibrary } = await import('../audio/library')
    const { StageAudio } = await import('../audio/stageAudio')
    const lib = new PianoLibrary({ fetchAsset: () => new Promise(() => undefined), lowNote: 28, highNote: 100, yieldToEventLoop: () => Promise.resolve() })
    const stage = new StageAudio({ createContext: null, library: lib })
    expect(stage.status.voice).toBe('error')
    const stage2 = new StageAudio({ createContext: () => ({}) as never, library: lib })
    void lib.load()
    expect(stage2.status.voice).toBe('loading')
    lib.dispose()
  })
})
