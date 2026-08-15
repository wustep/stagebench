import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'

describe('debug', () => {
  it('getChannelData write semantics in node-web-audio-api', async () => {
    const context = new OfflineAudioContext(1, 4410, 44100)
    const buffer = context.createBuffer(1, 1000, 44100)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < 1000; i++) data[i] = 0.5
    const readBack = buffer.getChannelData(0)
    console.log('same array?', data === readBack, 'readBack[10] =', readBack[10])
    // Now play it and render.
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start(0)
    const rendered = await context.startRendering()
    const out = rendered.getChannelData(0)
    console.log('rendered[10] =', out[10], 'rendered[500] =', out[500])
    expect(true).toBe(true)
  })
})
