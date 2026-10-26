// Run against the Vite server in a browser: await (await import('/tests/stage2-audio-browser.mjs')).verifyStage2Audio()
// Uses OfflineAudioContext, the bundled decoded samples, and the real delay graph.
export async function verifyStage2Audio() {
  const { WebAudioBackend, LayeredPiano } = await import('/src/audio.ts')
  const { DelayUnit } = await import('/src/delay.ts')
  const { ToneEffects } = await import('/src/tone-effects.ts')
  const { Mod1 } = await import('/src/mod1.ts')
  const { Mod2 } = await import('/src/mod2.ts')
  const { Rotary } = await import('/src/rotary.ts')
  async function piano(type, velocity, master = 1, settings = {}) {
    const ctx = new OfflineAudioContext(1, 44100, 44100)
    const backend = new WebAudioBackend(ctx, master)
    for (const [key, value] of Object.entries(settings)) backend.setPianoSetting(0, key, value)
    let status = ''
    await backend.selectType(type, value => { status = value })
    backend.start(60, velocity)
    const samples = (await ctx.startRendering()).getChannelData(0)
    const slice = samples.slice(0, 22050)
    return { status, rms: Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length), signature: Array.from(samples.slice(4000, 4100)) }
  }
  const types = await Promise.all(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'].map(type => piano(type, 100)))
  if (types.some(x => x.rms < .001)) throw Error('A piano type is silent')
  if (new Set(types.map(x => JSON.stringify(x.signature))).size !== 6) throw Error('Piano types are identical')
  if (types.slice(0, 3).some(x => !x.status.includes('recorded samples ready'))) throw Error('Recorded samples did not load')
  const soft = await piano('Grand', 30), muted = await piano('Grand', 100, 0)
  if (!(soft.rms < types[0].rms && muted.rms === 0)) throw Error('Velocity or master gain did not change output')
  const heavy = await piano('Grand', 30, 1, { touch: 0 }), compressed = await piano('Grand', 30, 1, { compression: 3 }), dark = await piano('Grand', 100, 1, { timbre: 1 })
  const unison = await piano('Grand', 100, 1, { unison: 3 })
  if (JSON.stringify(unison.signature) === JSON.stringify(types[0].signature)) throw Error('Unison did not change output')
  if (!(heavy.rms < soft.rms && compressed.rms > soft.rms && JSON.stringify(dark.signature) !== JSON.stringify(types[0].signature))) throw Error('Piano settings did not affect audio')
  async function delay(on, filter) {
    const ctx = new OfflineAudioContext(1, 88200, 44100)
    const unit = new DelayUnit(ctx); unit.output.connect(ctx.destination)
    unit.setOn(on); unit.setAmount(1); unit.setFeedback(.7); unit.setTempo(.2); unit.setFilter(filter)
    const buffer = ctx.createBuffer(1, 441, 44100); buffer.getChannelData(0)[0] = 1
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(unit.input); source.start(.2)
    const data = (await ctx.startRendering()).getChannelData(0)
    return [0, 1, 2].map(n => { const start = Math.floor((.2 + n * .264) * 44100); return Math.max(...data.slice(start, start + 500).map(Math.abs)) })
  }
  const dry = await delay(false, 'off'), wet = await delay(true, 'off'), filtered = await delay(true, 'lowpass')
  if (!(dry[0] > .9 && dry[1] === 0 && wet[0] < .01 && wet[1] > .1 && wet[2] > .01 && filtered[2] < wet[2] * .5)) throw Error('Delay bypass, wet path or feedback filtering failed')
  async function tone(unitIndex, active, type = 0) {
    const ctx = new OfflineAudioContext(1, 44100 * 2, 44100)
    const unit = new ToneEffects(ctx); unit.output.connect(ctx.destination)
    unit.setEq('treble', 1); unit.setCompression(1); unit.setReverbType(type); unit.setReverbMix(1); unit.setOn(unitIndex, active)
    const osc = ctx.createOscillator(); osc.frequency.value = 3000
    const level = ctx.createGain(); level.gain.value = .5; osc.connect(level); level.connect(unit.input); osc.start(.2); osc.stop(.5)
    const data = (await ctx.startRendering()).getChannelData(0)
    return Math.sqrt(data.slice(11000, 40000).reduce((sum, value) => sum + value * value, 0) / 29000)
  }
  const eqOff = await tone(0, false), eqOn = await tone(0, true), compOn = await tone(1, true)
  const reverbs = await Promise.all([0, 1, 2, 3, 4, 5].map(type => tone(2, true, type)))
  if (!(eqOn > eqOff * 1.1 && compOn < eqOff && new Set(reverbs.map(value => value.toFixed(6))).size === 6)) throw Error('EQ, compression or reverb processing failed')
  async function modulation(Unit, type, enabled, amount = .8, rate = .5) {
    const ctx = new OfflineAudioContext(2, 44100, 44100), effect = new Unit(ctx)
    effect.output.connect(ctx.destination); effect.setType(type); effect.setRate(rate); effect.setAmount(amount); effect.setOn(enabled)
    const osc = ctx.createOscillator(); osc.frequency.value = 440; osc.connect(effect.input); osc.start(.1); osc.stop(.9)
    const data = (await ctx.startRendering()).getChannelData(0)
    return Array.from(data.slice(10000, 10100))
  }
  for (const Unit of [Mod1, Mod2]) {
    const signals = await Promise.all([0, 1, 2, 3, 4, 5].map(type => modulation(Unit, type, true)))
    const bypass = await modulation(Unit, 0, false), zero = await modulation(Unit, 0, true, 0), slow = await modulation(Unit, 0, true, .8, .1)
    if (new Set(signals.map(JSON.stringify)).size !== 6 || JSON.stringify(signals[0]) === JSON.stringify(bypass) || JSON.stringify(signals[0]) === JSON.stringify(zero) || JSON.stringify(signals[0]) === JSON.stringify(slow)) throw Error('Modulation types, bypass or amount did not change output')
  }
  async function amplifier(type, drive = .8) {
    const ctx = new OfflineAudioContext(1, 44100, 44100), effect = new ToneEffects(ctx); effect.output.connect(ctx.destination)
    effect.setAmpType(type); effect.setDrive(drive); effect.setFrequency(.35); effect.setOn(0, true)
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 700; osc.connect(effect.input); osc.start(.1); osc.stop(.9)
    const data = (await ctx.startRendering()).getChannelData(0); return Array.from(data.slice(10000, 10100))
  }
  const amps = await Promise.all([0, 1, 2, 3, 4, 5].map(amplifier))
  if (new Set(amps.map(JSON.stringify)).size !== 6 || JSON.stringify(amps[1]) === JSON.stringify(await amplifier(1, 0))) throw Error('Amp/filter types or drive are identical')
  async function rotary(enabled, drive = 0) {
    const ctx = new OfflineAudioContext(2, 44100, 44100), unit = new Rotary(ctx); unit.outputs[0].connect(ctx.destination); unit.setOn(0, enabled); unit.setFast(true); unit.setDrive(drive)
    const osc = ctx.createOscillator(); osc.frequency.value = 440; osc.connect(unit.inputs[0]); osc.start(.1); osc.stop(.9)
    return Array.from((await ctx.startRendering()).getChannelData(0).slice(10000, 10100))
  }
  if (JSON.stringify(await rotary(false)) === JSON.stringify(await rotary(true)) || JSON.stringify(await rotary(true)) === JSON.stringify(await rotary(true, .8))) throw Error('Rotary did not change output')
  async function layered(bEnabled, pedal, bSustain) {
    const ctx = new OfflineAudioContext(1, 88200, 44100); let now = 0
    const clock = new Proxy(ctx, { get(target, key) { if (key === 'currentTime') return now; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value } })
    const backend = new WebAudioBackend(clock, 1); await backend.selectType('Digital', () => {}, 0); await backend.selectType('Digital', () => {}, 1)
    const instrument = new LayeredPiano(backend); instrument.setEnabled(1, bEnabled); instrument.setSustainEnabled(1, bSustain); instrument.sustain(pedal)
    instrument.on('key', 60, 100); now = .2; instrument.off('key'); now = .9; instrument.sustain(false)
    const samples = (await ctx.startRendering()).getChannelData(0)
    const rms = (a, b) => Math.sqrt(samples.slice(a * 44100, b * 44100).reduce((sum, value) => sum + value * value, 0) / ((b - a) * 44100))
    return { early: rms(.05, .15), tail: rms(.6, .8), stats: backend.diagnostics() }
  }
  const one = await layered(false, false, false), two = await layered(true, false, false), held = await layered(true, true, false), bothHeld = await layered(true, true, true)
  if (!(Math.abs(two.early - one.early) > .001 && held.tail > two.tail * 2 && bothHeld.tail > held.tail * 1.1 && [one,two,held,bothHeld].every(x => x.stats.activeVoices === 0 && x.stats.pitchParameters === 0))) throw Error('Layer ownership, sustain or voice cleanup failed: ' + JSON.stringify({one,two,held,bothHeld}))
  async function graph(bypassed) {
    const ctx = new OfflineAudioContext(2, 44100, 44100), backend = new WebAudioBackend(ctx, 1)
    await backend.selectType('Clav', () => {}); backend.setMod1(0, 'type', 2); backend.setMod1(0, 'amount', .8); backend.setMod1(0, 'on', 1); backend.setEffectsEnabled(0, !bypassed); backend.start(60, 100)
    return Array.from((await ctx.startRendering()).getChannelData(0).slice(10000, 10100))
  }
  if (JSON.stringify(await graph(false)) === JSON.stringify(await graph(true))) throw Error('All-effects bypass did not change output')
  async function detail(key, value) {
    const ctx = new OfflineAudioContext(2, 52920, 44100); let now = 0
    const clock = new Proxy(ctx, { get(target, prop) { if (prop === 'currentTime') return now; const result = Reflect.get(target, prop, target); return typeof result === 'function' ? result.bind(target) : result } })
    const backend = new WebAudioBackend(clock, 1); await backend.selectType('Digital', () => {})
    if (key === 'pitch') backend.setPitch(value)
    else if (key === 'layer') backend.setLayerLevel(0, value)
    else { backend.setPianoSetting(0, key, value); if (key === 'stringRes') backend.setPedal(0, true) }
    const voice = backend.start(60, 100); now = .2; voice.release()
    const data = (await ctx.startRendering()).getChannelData(0)
    const rms = (a,b) => Math.sqrt(data.slice(a*44100,b*44100).reduce((sum,x)=>sum+x*x,0) / ((b-a)*44100))
    return { early: rms(.05,.15), tail: rms(.5,.7), signature: Array.from(data.slice(4000,4100)) }
  }
  const plain = await detail('softRelease', 0), softRelease = await detail('softRelease', 1), resonance = await detail('stringRes', 1), shifted = await detail('pitch', 200), quietLayer = await detail('layer', .1)
  if (!(softRelease.tail > plain.tail * 2 && quietLayer.early < plain.early && JSON.stringify(resonance.signature) !== JSON.stringify(plain.signature) && JSON.stringify(shifted.signature) !== JSON.stringify(plain.signature))) throw Error('Release, resonance, pitch or layer level did not alter audio')
  async function settingsSignal(settings) {
    const ctx = new OfflineAudioContext(1, 88200, 44100), unit = new ToneEffects(ctx); unit.output.connect(ctx.destination)
    unit.setOn(settings.unit, true)
    if (settings.unit === 0) { unit.setEq('bass', settings.bass ?? .5); unit.setEq('mid', settings.mid ?? (settings.frequency === undefined ? .5 : .8)); unit.setEq('treble', settings.treble ?? .5); unit.setFrequency(settings.frequency ?? .5) }
    if (settings.unit === 1) { unit.setCompression(settings.compression ?? .7); unit.setFast(settings.fast ?? false) }
    if (settings.unit === 2) { unit.setReverbType(4); unit.setReverbMix(settings.mix ?? 1); unit.setBrightness(settings.bright ?? true) }
    const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = 'sawtooth'; osc.frequency.value = 250; gain.gain.value = .7; osc.connect(gain); gain.connect(unit.input); osc.start(.1); osc.stop(.4)
    return Array.from((await ctx.startRendering()).getChannelData(0).slice(14000, 14500))
  }
  const signature = value => JSON.stringify(value)
  for (const option of ['bass','mid','treble','frequency']) {
    if (signature(await settingsSignal({unit: 0, [option]: 0})) === signature(await settingsSignal({unit: 0, [option]: 1}))) throw Error(`EQ ${option} did not change audio`)
  }
  if (signature(await settingsSignal({unit: 1, compression: .2})) === signature(await settingsSignal({unit: 1, compression: 1}))) throw Error('Compressor amount did not change audio')
  if (signature(await settingsSignal({unit: 1, fast: false})) === signature(await settingsSignal({unit: 1, fast: true}))) throw Error('Compressor speed did not change audio')
  if (signature(await settingsSignal({unit: 2, bright: false})) === signature(await settingsSignal({unit: 2, bright: true})) || signature(await settingsSignal({unit: 2, mix: 0})) === signature(await settingsSignal({unit: 2, mix: 1}))) throw Error('Reverb color or mix did not change audio')
  // Capture actual node connections at construction to verify ordering and the feedback loop.
  const connections = [], originalConnect = AudioNode.prototype.connect
  let graphContext, graphBackend
  try {
    AudioNode.prototype.connect = function(destination, ...rest) { connections.push([this, destination]); return originalConnect.call(this, destination, ...rest) }
    graphContext = new OfflineAudioContext(2, 4410, 44100); graphBackend = new WebAudioBackend(graphContext)
  } finally { AudioNode.prototype.connect = originalConnect }
  const connected = (a, b) => connections.some(([source, destination]) => source === a && destination === b)
  for (let layer = 0; layer < 2; layer++) {
    const b = graphBackend, m1 = b.mod1[layer], m2 = b.mod2[layer], delay = b.delays[layer], tone = b.toneEffects[layer], rotary = b.rotary
    const expected = [[b.layerInputs[layer], m1.input], [m1.output, m2.input], [m2.output, delay.input], [delay.output, tone.input], [tone.output, rotary.inputs[layer]], [rotary.outputs[layer], b.layerBuses[layer]], [b.layerBuses[layer], b.master], [delay.delay, delay.filter], [delay.filter, delay.feedback], [delay.feedback, delay.delay]]
    if (expected.some(([source, destination]) => !connected(source, destination))) throw Error('Layer effect order or delay feedback path is incorrect')
  }
  if (!connected(graphBackend.master, graphBackend.limiter) || !connected(graphBackend.limiter, graphContext.destination)) throw Error('Master limiter path is incorrect')
  await graphContext.startRendering()
  const originalFetch = window.fetch
  try {
    window.fetch = async () => { throw Error('injected failure') }
    const ctx = new OfflineAudioContext(1, 44100, 44100), backend = new WebAudioBackend(ctx, 1); let status = ''
    await backend.selectType('Grand', value => { status = value }); backend.start(60, 100)
    const data = (await ctx.startRendering()).getChannelData(0)
    if (!status.includes('error') || !status.includes('fallback') || !data.some(value => Math.abs(value) > .001)) throw Error('Fallback was not labeled and playable')
  } finally { window.fetch = originalFetch }
  const liveContext = new AudioContext(), live = new WebAudioBackend(liveContext)
  await live.selectType('Digital', () => {}); live.start(60, 100); live.close()
  await new Promise(resolve => setTimeout(resolve, 30))
  const closed = live.diagnostics()
  if (liveContext.state !== 'closed' || closed.activeVoices || closed.pitchParameters) throw Error('Context or voices not cleaned up')
  return { one, two, held, bothHeld, eqOff, eqOn, compOn, reverbs, rms: types.map(x => x.rms), soft: soft.rms, muted: muted.rms, dry, wet, filtered }
}
