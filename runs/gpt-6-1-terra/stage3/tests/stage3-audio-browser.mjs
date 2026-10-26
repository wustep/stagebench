// Run in a browser served by Vite: await (await import('/tests/stage3-audio-browser.mjs')).verifyStage3Audio()
// This is a partial audit, not a complete Phase 3 acceptance test.
export async function verifyStage3Audio() {
  const { ExtraAudio, defaultOrgan, defaultSynth } = await import('/src/extra-audio.ts?audit=3')
  const { WebAudioBackend } = await import('/src/audio.ts?audit=3')
  async function render(kind, model, master = 1) {
    const context = new OfflineAudioContext(2, 44100, 44100)
    const backend = new WebAudioBackend(context, master)
    const target = backend.extraAudioTarget()
    const voices = new ExtraAudio(target.context, target.input)
    const organ = defaultOrgan(), synth = defaultSynth()
    organ.model = model; synth.waveform = model
    voices.on('note', 60, 100, kind === 'organ' ? [organ] : [], kind === 'synth' ? [synth] : [])
    const data = (await context.startRendering()).getChannelData(0)
    return { rms: Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length), signature: JSON.stringify(Array.from(data.slice(10000, 10064))) }
  }
  const organ = await Promise.all(['B3', 'Vox', 'Farf', 'Pipe 1'].map(model => render('organ', model)))
  const synth = await Promise.all(['Sine', 'Saw', 'Multi Saw', 'Super Square', 'FM 2-op'].map(model => render('synth', model)))
  const muted = await render('organ', 'B3', 0)
  if ([...organ, ...synth].some(result => result.rms < .0001) || new Set(organ.map(result => result.signature)).size !== 4 || new Set(synth.map(result => result.signature)).size !== 5 || muted.rms !== 0) throw Error('Partial organ/synth or shared master rendering failed')
  return { organ: organ.map(x => x.rms), synth: synth.map(x => x.rms), muted: muted.rms }
}

// Additional partial checks of rendered settings and individual effect inputs.
export async function verifyStage3Parameters() {
  const { ExtraAudio, defaultOrgan, defaultSynth } = await import('/src/extra-audio.ts?audit=3')
  const { WebAudioBackend } = await import('/src/audio.ts?audit=3')
  async function render(settings, kind = 'synth', configure = () => {}) {
    const c = new OfflineAudioContext(2, 44100, 44100), b = new WebAudioBackend(c, 1), t = b.extraAudioTarget(), engine = new ExtraAudio(c, t.inputs)
    configure(b)
    const organ = {...defaultOrgan(), ...settings}, synth = {...defaultSynth(), ...settings}
    engine.on('n', 60, 100, kind === 'organ' ? [organ] : [], kind === 'synth' ? [synth] : [])
    const data = (await c.startRendering()).getChannelData(0)
    return JSON.stringify(Array.from(data.slice(9000, 9100)))
  }
  const base = await render({})
  for (const settings of [{filter: 'lp24'}, {filter: 'highpass'}, {filter: 'bandpass'}, {cutoff: 400}, {resonance: 10}, {drive: 1}, {attack: .4}, {oscEnv: .5}, {filterEnv: .8}, {lfoAmount: .8}]) if (await render(settings) === base) throw Error(`Synth setting did not affect audio: ${JSON.stringify(settings)}`)
  const organBase = await render({}, 'organ')
  for (const settings of [{model: 'Vox'}, {drawbars: [0, 0, 0, 0, 0, 0, 0, 0, 8]}, {percussion: true}, {chorus: 1}]) if (await render(settings, 'organ') === organBase) throw Error(`Organ setting did not affect audio: ${JSON.stringify(settings)}`)
  return 'partial parameter renders passed'
}
export async function verifyStage3Cleanup() {
  const { ExtraAudio, defaultOrgan, defaultSynth } = await import('/src/extra-audio.ts?audit=4')
  const { WebAudioBackend } = await import('/src/audio.ts?audit=4')
  const c = new AudioContext(), backend = new WebAudioBackend(c, 1), target = backend.extraAudioTarget(), extra = new ExtraAudio(c, target.inputs)
  extra.on('held', 60, 100, [defaultOrgan()], [defaultSynth()]); extra.on('released', 64, 100, [], [defaultSynth()]); extra.off('released'); extra.allOff()
  await new Promise(resolve => setTimeout(resolve, 150))
  const result = extra.diagnostics()
  backend.close()
  if (result.activeVoices !== 0 || result.heldNotes !== 0) throw Error(`Voice cleanup failed: ${JSON.stringify(result)}`)
  return result
}
export async function verifyProgramPerformanceAudio() {
 const { ExtraAudio, defaultOrgan } = await import('/src/extra-audio.ts?audit=5')
 const { WebAudioBackend } = await import('/src/audio.ts?audit=5')
 const { ProgramBank } = await import('/src/programs.ts')
 const { zoneGains, morphValue } = await import('/src/performance.ts')
 async function render(state, note = 60) {
  const c = new OfflineAudioContext(1, 22050, 44100), backend = new WebAudioBackend(c, 1), target = backend.extraAudioTarget(), engine = new ExtraAudio(c, target.inputs)
  const gain = zoneGains(note, state.splits)[0] * morphValue(state.morph, state.wheel) * Number(state.scene)
  engine.on('test', note, 100, [{...defaultOrgan(), model: state.model, level: gain}], [])
  const data = (await c.startRendering()).getChannelData(0)
  return Math.sqrt(data.reduce((sum, x) => sum + x*x, 0) / data.length)
 }
 const initial = {model:'B3', splits:[{note:60,width:6}], morph:{start:.2,end:.8}, wheel:0, scene:true}
 const bank = new ProgramBank(initial); bank.edit({...initial, model:'Farf', wheel:1}); bank.store(17, 'Stored'); const before = await render(bank.current)
 bank.edit({...initial, scene:false}); const silent = await render(bank.current); const after = await render(bank.select(17))
 const low = await render({...initial, wheel:0}, 54), high = await render({...initial, wheel:0}, 66), louder = await render({...initial, wheel:1}, 54)
 if (!(before > 0 && Math.abs(before - after) < before * .001 && silent < before * .01 && low > high * 10 && louder > low * 2)) throw Error(`Program/split/morph render failed: ${JSON.stringify({before, after, silent, low, high, louder})}`)
 return {before, after, silent, low, high, louder}
}
export async function verifyVoiceModes() {
 const {ExtraAudio, defaultSynth} = await import('/src/extra-audio.ts?audit=6')
 const {WebAudioBackend} = await import('/src/audio.ts?audit=6')
 async function render(settings) {
  const c = new OfflineAudioContext(1, 22050, 44100), b = new WebAudioBackend(c, 1), t = b.extraAudioTarget(), extra = new ExtraAudio(c, t.inputs), s = {...defaultSynth(), ...settings}
  extra.on('low', 48, 100, [], [s]); extra.on('high', 72, 100, [], [s])
  const data = (await c.startRendering()).getChannelData(0)
  return JSON.stringify(Array.from(data.slice(10000, 10100)))
 }
 const poly = await render({mode:'Poly'}), mono = await render({mode:'Mono'}), legato = await render({mode:'Legato', glide:.5}), low = await render({mode:'Mono',priority:'Low'}), unison = await render({unison:3}), vibrato = await render({vibrato:true})
 if (new Set([poly, mono, legato, low, unison, vibrato]).size !== 6) throw Error('Voice modes or settings failed to change audio')
 return 'voice mode renders differ'
}
export async function verifySources() {
 const { ExtraAudio, defaultSynth, waveforms } = await import('/src/extra-audio.ts?audit=7')
 const { WebAudioBackend } = await import('/src/audio.ts?audit=7')
 async function render(waveform, control) {
  const c = new OfflineAudioContext(1, 22050, 44100), b = new WebAudioBackend(c, 1), target = b.extraAudioTarget(), engine = new ExtraAudio(c, target.inputs)
  engine.on('n',60,100,[],[{...defaultSynth(),waveform,control}]); const data = (await c.startRendering()).getChannelData(0)
  return Array.from(data.slice(9000, 9100)).map(x => x.toFixed(6)).join(',')
 }
 const signals = await Promise.all(waveforms.map(w => render(w, .5)))
 if (new Set(signals).size !== waveforms.length) throw Error('Two required sources rendered identically')
 for (const waveform of ['Sync Saw', 'Sync Square', 'Multi Saw', 'Multi Saw 8ve', 'Super Saw', 'Super Square', 'FM 2-op']) if (await render(waveform, 0) === await render(waveform, 1)) throw Error(`${waveform} ignores Osc Ctrl`)
 if (await render('Saw', 0) !== await render('Saw', 1)) throw Error('Pure Saw incorrectly uses Osc Ctrl')
 return {sources: waveforms.length, distinct: new Set(signals).size}
}
export async function verifySeparateEffects() {
 const {ExtraAudio, defaultOrgan, defaultSynth} = await import('/src/extra-audio.ts?audit=8')
 const {WebAudioBackend} = await import('/src/audio.ts?audit=8')
 async function render(layer, effect) {
  const c = new OfflineAudioContext(2, 44100, 44100), b = new WebAudioBackend(c, 1), target = b.extraAudioTarget(), extra = new ExtraAudio(c, target.inputs)
  b.setMod1(3, 'type', 1); b.setMod1(3, 'rate', .6); b.setMod1(3, 'amount', .9); b.setMod1(3, 'on', effect ? 1 : 0)
  const synths = [null,null,null]; if (layer > 0) synths[layer - 1] = defaultSynth()
  extra.on('n', 60, 100, layer === 0 ? [defaultOrgan()] : [], synths)
  const d = (await c.startRendering()).getChannelData(0); return JSON.stringify(Array.from(d.slice(12000, 12100), x => x.toFixed(5)))
 }
 const [organ0,organ1,a0,a1,b0,b1] = await Promise.all([render(0,false),render(0,true),render(1,false),render(1,true),render(2,false),render(2,true)])
 if (organ0 !== organ1 || a0 === a1 || b0 !== b1) throw Error('Effect targeting is not isolated')
 return 'effect targeting isolated'
}
export async function verifyArpAudio() {
 const { Arpeggiator, defaultArp } = await import('/src/arp.ts')
 const { ExtraAudio, defaultSynth } = await import('/src/extra-audio.ts?audit=9')
 const { WebAudioBackend } = await import('/src/audio.ts?audit=9')
 let tick = () => {}, cleared = false; const sequence = []
 const arp = new Arpeggiator(notes => sequence.push(notes[0]), () => {}, {set: fn => {tick = fn; return 1}, clear: () => {cleared = true}})
 arp.configure({...defaultArp(), run:true, range:2, direction:'Up'}, 120); arp.on('c',60); arp.on('e',64); tick(); tick(); tick(); arp.off('c'); arp.off('e')
 if (JSON.stringify(sequence) !== JSON.stringify([60,64,72,76]) || !cleared) throw Error(`Unexpected arp sequence: ${sequence}`)
 const sounds = await Promise.all(sequence.map(async note => { const c = new OfflineAudioContext(1, 22050, 44100), b = new WebAudioBackend(c, 1), t = b.extraAudioTarget(), x = new ExtraAudio(c, t.inputs); x.on('n',note,100,[],[defaultSynth()]); const d=(await c.startRendering()).getChannelData(0); return JSON.stringify(Array.from(d.slice(9000,9100), v=>v.toFixed(5))) }))
 if (new Set(sounds).size !== sequence.length) throw Error('Arpeggiated notes did not produce distinct audio')
 return sequence
}
export async function verifyExtraSustain() {
 const { ExtraAudio, defaultOrgan, defaultSynth } = await import('/src/extra-audio.ts?audit=10')
 const { WebAudioBackend } = await import('/src/audio.ts?audit=10')
 const c = new AudioContext(), b = new WebAudioBackend(c, 1), target = b.extraAudioTarget(), extra = new ExtraAudio(c, target.inputs)
 extra.on('n', 60, 100, [defaultOrgan()], [defaultSynth()]); extra.off('n', true, false)
 const held = extra.diagnostics(); await new Promise(resolve => setTimeout(resolve, 300)); const after = extra.diagnostics()
 extra.off('n'); await new Promise(resolve => setTimeout(resolve, 150)); const released = extra.diagnostics(); b.close()
 if (held.heldNotes !== 1 || after.activeVoices !== 1 || released.heldNotes !== 0 || released.activeVoices !== 0) throw Error(`Sustain routing or cleanup failed: ${JSON.stringify({held,after,released})}`)
 return {held,after,released}
}
export async function verifyOrganRotary() {
 const {ExtraAudio, defaultOrgan} = await import('/src/extra-audio.ts?audit=11')
 const {WebAudioBackend} = await import('/src/audio.ts?audit=11')
 async function render(routed, speed) { const c=new OfflineAudioContext(2,88200,44100), b=new WebAudioBackend(c,1), t=b.extraAudioTarget(), e=new ExtraAudio(c,t.inputs); b.setOrganRotary(routed); b.setRotary('fast',speed); b.setRotary('drive',.8); e.on('n',60,100,[defaultOrgan()],[]); const d=(await c.startRendering()).getChannelData(0); return JSON.stringify(Array.from(d.slice(60000,60100), x=>x.toFixed(5))) }
 const dry=await render(false,0), slow=await render(true,0), fast=await render(true,1), stop=await render(true,-1)
 if (new Set([dry,slow,fast,stop]).size !== 4) throw Error('Organ rotary routing or speed did not alter output')
 return 'organ rotary render passed'
}
export async function verifyLfoShapes() {
 const {ExtraAudio, defaultSynth} = await import('/src/extra-audio.ts?audit=12')
 const {WebAudioBackend} = await import('/src/audio.ts?audit=12')
 async function render(wave, destination) { const c=new OfflineAudioContext(1,44100,44100), b=new WebAudioBackend(c,1), t=b.extraAudioTarget(), x=new ExtraAudio(c,t.inputs); x.on('n',60,100,[],[{...defaultSynth(),waveform:'FM 2-op',lfoWave:wave,lfoDestination:destination,lfoAmount:1,lfoRate:5}]); const d=(await c.startRendering()).getChannelData(0); return JSON.stringify(Array.from(d.slice(22000,22100), v=>v.toFixed(5))) }
 const shapes=await Promise.all(['triangle','saw-down','saw-up','square','sample-hold'].map(w=>render(w,'pitch'))), destinations=await Promise.all(['pitch','filter','control'].map(d=>render('triangle',d)))
 if (new Set(shapes).size!==5 || new Set(destinations).size!==3) throw Error('LFO shapes or destinations are not distinct')
 return 'LFO shapes and destinations render distinctly'
}
