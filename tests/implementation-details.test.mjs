import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { collectImplementationDetails, validateImplementationManifest } from '../evaluation/lib/implementation-details.mjs'

test('implementation inventory combines package declarations, audio files, and provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-details-'))
  try {
    const phaseDir = path.join(root, 'runs', 'details-test', 'stage2')
    fs.mkdirSync(path.join(phaseDir, 'public', 'audio'), { recursive: true })
    fs.writeFileSync(path.join(phaseDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^19.0.0' },
      devDependencies: { vitest: '^3.0.0' },
    }))
    fs.writeFileSync(path.join(phaseDir, 'public', 'audio', 'C4.wav'), 'wave-data')
    fs.writeFileSync(path.join(phaseDir, 'IMPLEMENTATION_DETAILS.json'), JSON.stringify({
      version: 1,
      phase: 2,
      audio: {
        strategy: 'Bundled recorded samples',
        generatedSources: [],
        sampleSources: [{ name: 'Test piano', source: 'https://example.test/piano', license: 'CC0', files: ['public/audio/C4.wav'] }],
      },
    }))

    const details = collectImplementationDetails(root, {
      id: 'details-test',
      stages: [{ number: 1, status: 'complete' }, { number: 2, status: 'complete' }, { number: 3, status: 'queued' }],
    })
    assert.equal(details.phases.length, 1)
    assert.deepEqual(details.phases[0].libraries.application, [{ name: 'react', version: '^19.0.0' }])
    assert.deepEqual(details.phases[0].libraries.development, [{ name: 'vitest', version: '^3.0.0' }])
    assert.equal(details.phases[0].audio.sampleSources[0].license, 'CC0')
    assert.deepEqual(details.phases[0].audio.detectedFiles, [{ path: 'public/audio/C4.wav', bytes: 9 }])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('implementation manifest requires source and license for every recorded sample', () => {
  assert.throws(() => validateImplementationManifest({
    version: 1,
    phase: 2,
    audio: {
      strategy: 'Bundled samples',
      sampleSources: [{ name: 'Mystery sample', source: '', license: '' }],
    },
  }, 2), /source must be a non-empty string/)
})
