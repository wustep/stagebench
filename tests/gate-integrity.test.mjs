// Two ways the harness can measure something other than what it reports, both
// found by re-scoring the field and neither visible from an exit code.
//
// The lint gate can pass while inspecting nothing: an artifact shipping no
// ignore config lets the linter walk node_modules, report on bundled
// dependencies, and exit 0. The probe below detects it with a deliberate
// violation planted beside a real source file, which an honest lint script
// names and a vacuous one never sees.
//
// And the starter shipped a document fragment, so most candidates built a page
// browsers render in quirks mode with no viewport — corrupting exactly the
// geometry the panel-fidelity axis computes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { __internals } from '../bench/lib/eval/evaluate.mjs'

const { probeLintCoverage, lintProbePathFor, findSourceSample, LINT_PROBE_STEM } = __internals

const roots = []
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }) })

// A fixture artifact whose `lint` script is a plain node program, so the test
// needs no install and no real linter to exercise the probe end to end.
function fixture(lintBody, { sourceDir = 'src', sourceName = 'app.ts' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-lint-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, sourceDir), { recursive: true })
  fs.writeFileSync(path.join(root, sourceDir, sourceName), 'export const value = 1\n')
  fs.mkdirSync(path.join(root, 'node_modules', 'typescript'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', 'typescript', 'typescript.js'), 'var unused = 1\n')
  fs.writeFileSync(path.join(root, 'lint.mjs'), lintBody)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '0.0.0', private: true, type: 'module', scripts: { lint: 'node lint.mjs' },
  }, null, 2))
  return root
}

// Reads every file under src/ and names the ones carrying an unused binding —
// what a correctly configured linter does.
const HONEST_LINT = `import fs from 'node:fs'
import path from 'node:path'
for (const name of fs.readdirSync('src')) {
  const file = path.join('src', name)
  if (fs.readFileSync(file, 'utf8').includes('stagebenchProbeUnused')) {
    console.log(file + ':2:5: warning eslint(no-unused-vars): unused variable')
  }
}
process.exit(0)
`

// Walks node_modules instead, reports on a vendored dependency, and exits 0 —
// the observed failure mode.
const VACUOUS_LINT = `console.log('node_modules/typescript/typescript.js:1:5: warning eslint(no-unused-vars): unused variable')
process.exit(0)
`

test('lint coverage passes when the lint script reads the candidate sources', async () => {
  const root = fixture(HONEST_LINT)
  const check = await probeLintCoverage(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')))
  assert.equal(check.id, 'lint-coverage')
  assert.equal(check.passed, true)
  assert.equal(check.advisory, true, 'the check must stay advisory so it never re-caps an older score')
  assert.match(check.detail, /src\//)
})

test('lint coverage fails when the lint script exits 0 having scanned only dependencies', async () => {
  const root = fixture(VACUOUS_LINT)
  const check = await probeLintCoverage(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')))
  assert.equal(check.passed, false)
  assert.equal(check.advisory, true)
  assert.equal(check.scannedDependencies, true)
  assert.match(check.detail, /node_modules/, 'the detail should name the dependency scan as the cause')
})

// The observed case in this benchmark: every flagged artifact runs bare
// `oxlint`, which walks the working directory and so lints src/ *and*
// node_modules. Coverage is real, but the gate's verdict turns partly on
// vendored code — one artifact's lint exits non-zero purely from dependency
// noise. Both facts have to survive into the record, not just the pass.
test('a lint that covers sources but also walks dependencies passes and says so', async () => {
  const root = fixture(`${HONEST_LINT.replace('process.exit(0)', '')}
console.log('node_modules/typescript/typescript.js:1:5: warning eslint(no-unused-vars): unused variable')
process.exit(0)
`)
  const check = await probeLintCoverage(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')))
  assert.equal(check.passed, true)
  assert.equal(check.scannedDependencies, true)
  assert.match(check.detail, /vendored dependencies/)
})

test('the probe is removed whether or not the lint script names it', async () => {
  for (const body of [HONEST_LINT, VACUOUS_LINT]) {
    const root = fixture(body)
    await probeLintCoverage(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')))
    const leaked = fs.readdirSync(path.join(root, 'src')).filter((name) => name.startsWith(LINT_PROBE_STEM))
    assert.deepEqual(leaked, [], 'the probe must never survive into a sealed artifact copy')
  }
})

test('an artifact with no lint script is not probed at all', async () => {
  const root = fixture(HONEST_LINT)
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  delete packageJson.scripts.lint
  assert.equal(lintProbePathFor(root, packageJson), null)
  assert.equal(await probeLintCoverage(root, packageJson), null)
})

test('the probe lands beside a real source file and matches its extension', () => {
  const root = fixture(HONEST_LINT, { sourceName: 'main.jsx' })
  const relative = lintProbePathFor(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')))
  assert.equal(relative, `src/${LINT_PROBE_STEM}.jsx`)
})

// Without this the probe would be planted in a vendored dependency, where a
// correctly configured lint script is supposed to ignore it — reporting an
// honest artifact as vacuous.
test('source discovery never descends into node_modules or dist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-lint-'))
  roots.push(root)
  for (const dir of ['node_modules/pkg', 'dist', '.git']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
    fs.writeFileSync(path.join(root, dir, 'index.js'), 'var a = 1\n')
  }
  assert.equal(findSourceSample(root), null)
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'real.ts'), 'export const a = 1\n')
  assert.equal(findSourceSample(root), path.join(root, 'src', 'real.ts'))
})

// Every candidate clones bench/starter/. It shipped a bare fragment —
// `<div id="root"></div><script …>` with no doctype and no viewport meta — so
// ten of fourteen runs built a document a browser renders in quirks mode, at
// 980px CSS width under the 390x844 narrow profile. Both facts silently
// corrupt the panel-fidelity geometry the rubric computes, so the starter is
// pinned rather than trusted.
test('the starter ships a standards-mode document with a viewport', () => {
  const starter = fs.readFileSync(path.join(import.meta.dirname, '..', 'bench', 'starter', 'index.html'), 'utf8')
  assert.match(starter.trimStart(), /^<!doctype html>/i, 'a missing doctype puts every candidate build in quirks mode')
  assert.match(starter, /<meta\s+name="viewport"\s+content="width=device-width/, 'without a viewport meta the narrow profile lays out at 980px')
  assert.match(starter, /<meta\s+charset=/i)
  assert.match(starter, /<div id="root"><\/div>/, 'the mount point the starter app expects')
  assert.match(starter, /src="\/src\/main\.tsx"/, 'the entry point the starter app expects')
})
