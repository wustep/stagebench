import fs from 'node:fs'
import path from 'node:path'

const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.webm'])
const IGNORED_DIRECTORIES = new Set(['.git', '.vite', 'dist', 'evidence', 'node_modules'])
const PHASE_NAMES = {
  1: 'Visual recreation',
  2: 'Piano instrument',
  3: 'Programs and effects',
  4: 'Organ and synth',
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function dependencyList(dependencies = {}) {
  return Object.entries(dependencies)
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function findAudioFiles(directory, current = directory) {
  if (!fs.existsSync(current)) return []
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return []
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) return findAudioFiles(directory, absolutePath)
    if (!entry.isFile() || !AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return []
    return [{
      path: path.relative(directory, absolutePath).split(path.sep).join('/'),
      bytes: fs.statSync(absolutePath).size,
    }]
  })
}

export function validateImplementationManifest(manifest, expectedPhase) {
  if (!manifest || typeof manifest !== 'object') throw new Error('IMPLEMENTATION_DETAILS.json must contain an object')
  if (manifest.version !== 1) throw new Error('IMPLEMENTATION_DETAILS.json version must be 1')
  if (manifest.phase !== expectedPhase) throw new Error(`IMPLEMENTATION_DETAILS.json phase must be ${expectedPhase}`)
  if (!manifest.audio || typeof manifest.audio !== 'object') throw new Error('IMPLEMENTATION_DETAILS.json must declare audio details')
  if (typeof manifest.audio.strategy !== 'string' || !manifest.audio.strategy.trim()) throw new Error('audio.strategy must be a non-empty string')
  if (!Array.isArray(manifest.audio.sampleSources)) throw new Error('audio.sampleSources must be an array')
  for (const [index, source] of manifest.audio.sampleSources.entries()) {
    for (const field of ['name', 'source', 'license']) {
      if (typeof source?.[field] !== 'string' || !source[field].trim()) throw new Error(`audio.sampleSources[${index}].${field} must be a non-empty string`)
    }
    if (source.files !== undefined && !Array.isArray(source.files)) throw new Error(`audio.sampleSources[${index}].files must be an array when present`)
  }
  if (manifest.audio.notes !== undefined && !Array.isArray(manifest.audio.notes)) throw new Error('audio.notes must be an array when present')
  return manifest
}

export function collectImplementationDetails(root, run) {
  const phases = run.stages.flatMap((phaseState) => {
    const phase = phaseState.number
    const phaseDir = path.join(root, 'runs', run.id, `stage${phase}`)
    const packagePath = path.join(phaseDir, 'package.json')
    if (!fs.existsSync(packagePath)) return []

    const packageJson = readJson(packagePath)
    const manifestPath = path.join(phaseDir, 'IMPLEMENTATION_DETAILS.json')
    const declared = fs.existsSync(manifestPath)
      ? validateImplementationManifest(readJson(manifestPath), phase)
      : {
          version: 1,
          phase,
          audio: {
            strategy: 'Not declared',
            sampleSources: [],
            notes: ['This phase predates the implementation-details contract.'],
          },
        }

    return [{
      phase,
      phaseName: PHASE_NAMES[phase] ?? `Phase ${phase}`,
      status: phaseState.status,
      artifactPath: path.relative(root, phaseDir).split(path.sep).join('/'),
      libraries: {
        application: dependencyList(packageJson.dependencies),
        development: dependencyList(packageJson.devDependencies),
      },
      audio: {
        strategy: declared.audio.strategy,
        generatedSources: declared.audio.generatedSources ?? [],
        sampleSources: declared.audio.sampleSources,
        detectedFiles: findAudioFiles(phaseDir),
        notes: declared.audio.notes ?? [],
      },
    }]
  })

  return {
    version: 1,
    runId: run.id,
    generatedAt: new Date().toISOString(),
    description: 'Generated from phase package manifests, detected audio assets, and benchmark-authored audio provenance.',
    phases,
  }
}
