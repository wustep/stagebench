// Run in a browser with /audio-check.js generated from src/audio.ts using TypeScript.
// OfflineAudioContext renders the actual WebAudioBackend; no device is required.
export async function verifyAudio() {
  const { WebAudioBackend, PianoEngine } = await import('/audio-check.js')
  async function render(velocity, sustain) {
    const context = new OfflineAudioContext(1, 44100, 44100)
    let time = 0
    const clockedContext = new Proxy(context, { get(target, key) {
      if (key === 'currentTime') return time
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const piano = new PianoEngine(new WebAudioBackend(clockedContext))
    piano.on('note', 60, velocity)
    if (sustain) piano.sustain(true)
    time = 0.2
    piano.off('note')
    const samples = (await context.startRendering()).getChannelData(0)
    const rms = (a, b) => Math.sqrt(samples.slice(a * 44100, b * 44100).reduce((sum, x) => sum + x * x, 0) / ((b - a) * 44100))
    return { early: rms(0.05, 0.15), tail: rms(0.6, 0.8) }
  }
  const soft = await render(30, false), loud = await render(120, false), held = await render(120, true)
  if (!(soft.early > 0.001 && loud.early > soft.early * 2 && held.tail > loud.tail * 5)) throw new Error('Audio relationships failed')
  return { soft, loud, held }
}
