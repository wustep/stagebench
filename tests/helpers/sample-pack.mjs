// A tiny stand-in for the sample pack, for tests that need a checkout to have
// one (the real pack is about 500 MB of fetched audio). Same manifest shape, a few
// kilobytes of made-up bytes.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

export const FIXTURE_SOURCES = [
  { id: 'fixture-grand', name: 'Fixture Grand', role: 'Grand', license: 'CC-BY-3.0', directory: 'grand/fixture-grand', repository: 'example/fixture-grand', commit: 'a'.repeat(40) },
  { id: 'fixture-upright', name: 'Fixture Upright', role: 'Upright', license: 'CC0-1.0', directory: 'upright/fixture-upright', repository: 'example/fixture-upright', commit: 'b'.repeat(40) },
]

// Deterministic bytes that start like a FLAC file, so content sniffing agrees
// with the extension.
export function fixtureRecording(seed, bytes = 3000) {
  const body = crypto.createHash('sha512').update(String(seed)).digest()
  return Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(bytes - 4, 0).map((_, index) => body[index % body.length] ^ (index & 0xff))])
}

export function writeFixtureSamplePack(root) {
  const packDir = path.join(root, 'sample-pack')
  const files = []
  const add = (source, upstreamPath, content) => {
    const relative = `${source.directory}/${upstreamPath}`
    const target = path.join(packDir, 'files', relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    files.push({ path: relative, source: source.id, upstreamPath, bytes: content.length, sha256: sha256(content) })
  }
  const [grand, upright] = FIXTURE_SOURCES
  for (const name of ['A4v7', 'A4v10', 'C5v7']) add(grand, `Samples/${name}.flac`, fixtureRecording(`grand-${name}`))
  add(grand, 'LICENSE', Buffer.from('Creative Commons Attribution 3.0 Unported\n'))
  for (const name of ['A4vH', 'A4vL']) add(upright, `samples/${name}.flac`, fixtureRecording(`upright-${name}`))
  const manifest = {
    id: 'fixture-samples',
    version: '0.0.1',
    description: 'Test fixture',
    totals: { sources: 2, files: files.length, recordings: files.filter((file) => file.path.endsWith('.flac')).length, bytes: files.reduce((total, file) => total + file.bytes, 0) },
    sources: FIXTURE_SOURCES.map((source) => ({ ...source, attribution: `${source.name}, ${source.license}`, files: files.filter((file) => file.source === source.id).length })),
    files,
  }
  fs.writeFileSync(path.join(packDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`)
  fs.writeFileSync(path.join(packDir, 'README.md'), '# Fixture sample pack\n')
  fs.writeFileSync(path.join(packDir, 'LICENSES.md'), '# Licenses\n')
  fs.writeFileSync(path.join(packDir, 'ATTRIBUTION.md'), '# Attribution\n')
  fs.writeFileSync(path.join(packDir, 'sample-sources.json'), `${JSON.stringify({ sampleSources: FIXTURE_SOURCES.map((source) => ({ id: source.id, name: source.name, source: `fixture ${source.directory}`, license: source.license, attribution: `${source.name}, ${source.license}` })) }, null, 2)}\n`)
  return manifest
}
