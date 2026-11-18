import { Grand } from '../src/piano'
import { effective } from '../src/programs'
import { defaults } from '../src/settings'
export async function renderStage(part: 'organ' | 'synth', variant = 'base') {
  const rate = 24000,
    ctx = new OfflineAudioContext(2, rate * 0.6, rate)
  let contexts = 0
  const grand = new Grand(() => {}, {
    context: () => {
      contexts++
      return ctx as unknown as AudioContext
    },
    load: async () => {
      throw Error('no samples')
    },
  })
  const s = defaults()
  s.section = false
  s.organOn = part === 'organ'
  s.synthOn = part === 'synth'
  s.rotary = variant === 'rotary' || variant === 'fast'
  s.speed = variant === 'fast'
  const layer = s[part][0]
  if (variant === 'master') s.master = 0
  if (variant === 'level') layer.level = 0
  if (variant === 'fx') {
    s.target = part === 'organ' ? 'Organ' : 'Synth'
    layer.fx.mod1.on = true
    layer.fx.mod1.type = 2
  }
  if (variant === 'zone') {
    s.split = true
    layer.zone = [1, 1]
    s.points[1].note = 72
  }
  if (variant === 'crossfade') {
    s.split = true
    layer.zone = [1, 1]
    s.points[1].note = 60
    s.points[1].width = 6
  }
  if (variant === 'morph') {
    s.morphs = [
      { path: part + '.0.level', source: 'wheel', start: layer.level, end: 0 },
    ]
    s.wheel = 100
  }
  if (variant === 'scene') layer.enabled = false
  if (variant === 'second') {
    layer.enabled = false
    s[part][1].enabled = true
  }
  if (variant === 'third' && part === 'synth') {
    layer.enabled = false
    s.synth[2].enabled = true
  }
  grand.settings = effective(s)
  await grand.load()
  if (grand.generatorError) throw Error(grand.generatorError)
  grand.on('probe', 60, 99)
  await grand.synchronize()
  const cut = ctx.suspend(0.27),
    rendering = ctx.startRendering()
  await cut
  grand.clear()
  await grand.synchronize()
  await ctx.resume()
  const data = (await rendering).getChannelData(0)
  grand.dispose()
  const rms = (from: number, to: number) =>
    Math.sqrt(data.slice(from, to).reduce((n, v) => n + v * v, 0) / (to - from))
  return {
    contexts,
    level: rms(1500, 5800),
    tail: rms(10000, 14000),
    signature: Array.from(data.slice(2500, 2600)),
  }
}
