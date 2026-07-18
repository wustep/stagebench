import { it } from 'vitest'
import { FakeAudioBackend, rms } from '../audio/fake-backend'
import { renderGraph } from '../audio/render'
import { renderRecordedTake } from '../audio/piano-models'

function corr(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, ea = 0, eb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; ea += a[i] * a[i]; eb += b[i] * b[i] }
  return dot / Math.max(1e-12, Math.sqrt(ea * eb))
}

it('debug takes', () => {
  const g = renderRecordedTake('grand', 58, 0.9, 8000)
  const u = renderRecordedTake('upright', 58, 0.9, 8000)
  const e = renderRecordedTake('electric', 58, 0.9, 8000)
  console.log('take rms', rms(g).toFixed(3), rms(u).toFixed(3), rms(e).toFixed(3))
  console.log('take corr g/u', corr(g, u).toFixed(3), 'g/e', corr(g, e).toFixed(3))

  const backend = new FakeAudioBackend()
  const params = backend.buildRenderParams({}, 0.8)
  params.layers[0].level = 0.9
  console.log('layer type', params.layers[0].type, 'has takeFor', params.layers[0].takeFor !== null)
  if (params.layers[0].takeFor) {
    const take = params.layers[0].takeFor(60, 0.8)
    console.log('take root', take.root, 'layer', take.layer, 'len', take.data.length, 'rms', rms(take.data).toFixed(3))
  }
  const notes = new Map([['pianoA' as const, [{ note: 60, velocity: 0.8, start: 0, release: null, stop: null }]]])
  const frame = renderGraph(params, notes)
  console.log('frame rms', rms(frame.l).toFixed(4))
  console.log('first 6 frame', Array.from(frame.l.slice(100, 106)).map((x) => x.toFixed(4)).join(' '))
  console.log('first 6 take ', Array.from(g.slice(100, 106)).map((x) => x.toFixed(4)).join(' '))
})
