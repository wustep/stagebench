#!/usr/bin/env node
/**
 * Fetch redistributable recorded piano/EP notes, convert to short mono WAVs,
 * and pack PCM into src/audio/recorded-pcm.json for offline loading.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dl = join(root, 'samples/_dl')
const outDir = join(root, 'public/samples')
mkdirSync(dl, { recursive: true })
mkdirSync(join(outDir, 'grand'), { recursive: true })
mkdirSync(join(outDir, 'upright'), { recursive: true })
mkdirSync(join(outDir, 'electric'), { recursive: true })

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const ROOTS = [36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84]

function midiJsName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

function uprightName(midi, vel) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}v${vel}`
}

async function download(url, dest) {
  if (existsSync(dest) && readFileSync(dest).length > 1000) return
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

function convert(src, dest) {
  execFileSync('ffmpeg', [
    '-y', '-i', src,
    '-ac', '1', '-ar', '22050', '-t', '0.78',
    '-af', 'loudnorm=I=-18:LRA=11:TP=-2,afade=t=out:st=0.68:d=0.1',
    dest,
  ], { stdio: 'pipe' })
}

function parseWavPcm16(buf) {
  const nch = buf.readUInt16LE(22)
  const rate = buf.readUInt32LE(24)
  const bps = buf.readUInt16LE(34)
  let offset = 12
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      const data = buf.subarray(offset + 8, offset + 8 + size)
      const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2))
      if (nch === 1 && bps === 16) return { rate, samples }
      throw new Error(`unexpected wav ${nch}ch ${bps}bit`)
    }
    offset += 8 + size
  }
  throw new Error('no data chunk')
}

const FLUID = 'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM'
const UPRIGHT = 'https://cdn.jsdelivr.net/gh/freepats/upright-piano-KW@master/samples'

const packed = { grand: [], upright: [], electric: [] }
const files = { grand: [], upright: [], electric: [] }

async function grabFluid(kind, patch) {
  for (const midi of ROOTS) {
    const name = midiJsName(midi)
    const mp3 = join(dl, `${kind}-${name}.mp3`)
    const wav = join(outDir, kind, `${midi}v1.wav`)
    process.stdout.write(`${kind} ${name}\n`)
    await download(`${FLUID}/${patch}-mp3/${name}.mp3`, mp3)
    convert(mp3, wav)
    const { rate, samples } = parseWavPcm16(readFileSync(wav))
    packed[kind].push({
      midi,
      vel: 1,
      rate,
      pcm: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64'),
    })
    files[kind].push(`samples/${kind}/${midi}v1.wav`)
  }
}

const UPRIGHT_EXIST = new Set([
  'C2vH','C2vL','C3vH','C3vL','C5vH','C5vL','C6vH','C6vL',
  'D#2vH','D#2vL','D#3vH','D#3vL','D#4vH','D#4vL','D#5vH','D#5vL','D#6vH','D#6vL',
  'F#2vH','F#2vL','F#3vH','F#3vL','F#4vH','F#4vL','F#5vH','F#5vL','F#6vH','F#6vL',
  'A3vH','A3vL','A4vH','A4vL','A5vH','A5vL','A2vL','C4vL',
])

await grabFluid('grand', 'acoustic_grand_piano')
await grabFluid('electric', 'electric_piano_1')

for (const midi of ROOTS) {
  for (const [velName, vel] of [['vL', 0], ['vH', 1]]) {
    const stem = uprightName(midi, velName === 'vL' ? 'L' : 'H')
    if (!UPRIGHT_EXIST.has(stem)) continue
    const flac = join(dl, `upright-${stem}.flac`)
    const wav = join(outDir, 'upright', `${midi}v${vel}.wav`)
    process.stdout.write(`upright ${stem}\n`)
    try {
    try {
      await download(`${UPRIGHT}/${encodeURIComponent(stem)}.flac`, flac)
    } catch {
      await download(
        `https://raw.githubusercontent.com/freepats/upright-piano-KW/master/samples/${encodeURIComponent(stem)}.flac`,
        flac,
      )
    }
      convert(flac, wav)
      const { rate, samples } = parseWavPcm16(readFileSync(wav))
      packed.upright.push({
        midi,
        vel,
        rate,
        pcm: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64'),
      })
      files.upright.push(`samples/upright/${midi}v${vel}.wav`)
    } catch (err) {
      process.stderr.write(`skip ${stem}: ${err.message}\n`)
    }
  }
}

writeFileSync(join(root, 'src/audio/recorded-pcm.json'), JSON.stringify(packed))
writeFileSync(join(outDir, 'MANIFEST.json'), JSON.stringify({ files, roots: ROOTS }, null, 2))
writeFileSync(
  join(outDir, 'LICENSES.md'),
  `# Sample licenses

## Grand — FluidR3 GM acoustic_grand_piano
Recorded piano samples from the FluidR3 GM soundfont (Frank Wen), packaged as MP3 notes by midi-js-soundfonts (MIT).
https://github.com/gleitz/midi-js-soundfonts

## Upright — Upright piano KW (Kawai living-room upright)
Recorded by Gonzalo and Roberto for FreePats. CC0 1.0.
https://github.com/freepats/upright-piano-KW

## Electric — FluidR3 GM electric_piano_1
Recorded tine electric piano from FluidR3 GM (MIT), same midi-js-soundfonts packaging.
`,
)
console.log('packed', {
  grand: packed.grand.length,
  upright: packed.upright.length,
  electric: packed.electric.length,
})
