import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
const manifest = readJson('specs/benchmark-phases.json')

test('phase manifest defines a complete three-phase cumulative target contract', () => {
  assert.equal(manifest.version, '3.0.0')
  assert.equal(manifest.phaseCount, 3)
  assert.equal(manifest.selectionMode, 'cumulative-target')
  assert.deepEqual(manifest.selection, { '1': [1], '2': [1, 2], '3': [1, 2, 3] })
  assert.deepEqual(manifest.phases.map((phase) => phase.number), [1, 2, 3])
  assert.deepEqual(manifest.phases.map((phase) => phase.title), [
    'Complete surface and basic piano',
    'Piano library and working effects',
    'Complete Stage 4 system',
  ])
  // The manual is fetched on demand into ./reference (gitignored, not redistributed),
  // so assert the contract path rather than the binary's presence.
  assert.match(manifest.manual.path, /^reference\/manual\.pdf$/, 'manual path must point at fetched reference')
  assert.ok(manifest.sharedCompletionGates.length >= 6)

  let inheritedSpecs = []
  for (const phase of manifest.phases) {
    assert.equal(phase.directory, `stage${phase.number}`)
    assert.equal(phase.prompt, `prompts/stage${phase.number}.md`)
    assert.ok(phase.hardGates.length >= 4, `Phase ${phase.number} needs explicit hard gates`)
    assert.ok(phase.included.length >= 4, `Phase ${phase.number} needs explicit included scope`)
    assert.ok(phase.excluded.length >= 2, `Phase ${phase.number} needs explicit excluded scope`)
    assert.ok(fs.existsSync(path.join(root, phase.prompt)), `missing ${phase.prompt}`)
    assert.ok(inheritedSpecs.every((spec) => phase.specs.includes(spec)), `Phase ${phase.number} must inherit prior specs`)

    const prompt = fs.readFileSync(path.join(root, phase.prompt), 'utf8')
    assert.match(prompt, /IMPLEMENTATION_PLAN\.md/)
    assert.match(prompt, /Hard gates/)
    for (const specPath of phase.specs) {
      assert.ok(fs.existsSync(path.join(root, specPath)), `missing ${specPath}`)
      assert.match(prompt, new RegExp(specPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('specs/', 'specs/')))
    }
    inheritedSpecs = phase.specs
  }
})

test('variant registry defines the three Nord Stage 4 modes with a valid default', () => {
  assert.match(manifest.variants, /^specs\/nord-stage-4\.variants\.json$/)
  const registry = readJson(manifest.variants)
  const ids = registry.variants.map((variant) => variant.id)
  assert.deepEqual(ids, ['stage-4-88', 'stage-4-73', 'stage-4-compact-73'])
  assert.ok(ids.includes(registry.default), 'default must be one of the defined variants')
  assert.equal(manifest.defaultVariant, registry.default)
  for (const variant of registry.variants) {
    assert.ok(variant.label && variant.fullName && variant.keyAction, `${variant.id} needs label/fullName/keyAction`)
    assert.match(variant.referenceImage, /^reference\//, `${variant.id} referenceImage must be a fetched reference path`)
    assert.equal(variant.keyboard.whiteKeys + variant.keyboard.blackKeys, variant.keyboard.totalKeys, `${variant.id} key counts must sum`)
  }
  // The shared visual spec points at the registry and a real default.
  const visual = readJson('specs/nord-stage-4.visual.json')
  assert.equal(visual.variantsSpec, manifest.variants)
  assert.ok(ids.includes(visual.defaultVariant))
})

test('manual-derived domain specs have page citations and acceptance gates', () => {
  const domainSpecs = [
    ['specs/nord-stage-4.piano.json', [23, 24, 25, 26]],
    ['specs/nord-stage-4.programs.json', [37, 38, 39, 40, 41, 42, 43, 44]],
    ['specs/nord-stage-4.effects.json', [47, 48, 49, 50, 51, 52]],
    ['specs/nord-stage-4.organ.json', [18, 19, 20, 21, 22]],
    ['specs/nord-stage-4.synth.json', [27, 28, 29, 30, 31, 32, 33, 34, 35, 36]],
  ]

  for (const [specPath, pages] of domainSpecs) {
    const spec = readJson(specPath)
    assert.equal(spec.version, '1.0.0')
    assert.equal(spec.source.manual, manifest.manual.path)
    assert.deepEqual(spec.source.pages, pages)
    assert.ok(Array.isArray(spec.acceptance) && spec.acceptance.length >= 4, `${specPath} needs acceptance gates`)
  }
})

test('active rubric and phase manifest stay aligned', () => {
  const rubric = readJson('evaluation/rubrics/v3.json')
  assert.equal(rubric.version, manifest.version)
  assert.deepEqual(Object.keys(rubric.stages), manifest.phases.map(({ number }) => String(number)))
  assert.equal(Object.values(rubric.aggregateStageWeights).reduce((sum, weight) => sum + weight, 0), 100)
  for (const phase of manifest.phases) {
    assert.equal(rubric.stages[String(phase.number)].name.toLowerCase(), phase.title.toLowerCase())
  }
})
