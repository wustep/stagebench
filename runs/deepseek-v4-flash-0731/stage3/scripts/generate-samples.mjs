// Generates the bundled, redistributable WAV sample assets under public/samples
// from the SAME deterministic DSP generator used at runtime (samples.ts), so
// the on-disk bundle and the in-engine sample tables are byte-identical.
//
// These are GENERATED sample tables (not field recordings); IMPLEMENTATION_DETAILS.json
// declares them truthfully as such. Run: node scripts/generate-samples.mjs

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const here = new URL('.', import.meta.url)
const samplesSrc = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/audio/samples.ts')
const outRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/samples')

function loadModule(file) {
  const source = fs.readFileSync(file, 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(out).toString('base64')
  return import(dataUrl)
}

function writeWav(file, samples, sampleRate) {
  // 16-bit mono little-endian PCM
  const bytes = new Uint8Array(44 + samples.length * 2)
  const dv = new DataView(bytes.buffer)
  dv.setUint32(0, 0x46464952, false) // "RIFF"
  dv.setUint32(4, 36 + samples.length * 2, true)
  dv.setUint32(8, 0x57415645, false) // "WAVE"
  dv.setUint32(12, 0x666d7420, false) // "fmt "
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true) // byte rate
  dv.setUint16(32, 2, true) // block align
  dv.setUint16(34, 16, true) // bits
  dv.setUint32(36, 0x64617461, false) // "data"
  dv.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  fs.writeFileSync(file, Buffer.from(bytes))
}

const SAMPLE_RATE = 44_100
const { SampleLibrary } = await loadModule(samplesSrc)
const library = new SampleLibrary(SAMPLE_RATE, [0.2, 0.55, 0.95])
let count = 0
for (const entry of library.entries()) {
  const rel = entry.asset.replace(/^public\//, '')
  const outPath = path.join(outRoot, rel.replace(/^samples\//, ''))
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  writeWav(outPath, entry.data, SAMPLE_RATE)
  count++
}
console.log(`Wrote ${count} sample assets under public/samples/`)
void here
