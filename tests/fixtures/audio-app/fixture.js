// A tiny Web MIDI instrument for tests/audio-measure.test.mjs: an additive
// "piano-ish" voice per note on one AudioContext, with switches for the faults
// the audio harness has to catch.
export function startSynth({ detuneCents = 0, velocitySensitive = true, smoothRelease = true, sustainPedal = true, listen = 'property' } = {}) {
  const context = new AudioContext()
  const master = new GainNode(context, { gain: 0.4 })
  master.connect(context.destination)
  // Five harmonics, falling off like a struck string; no normalisation so the
  // level is exactly what the gains say.
  const wave = context.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.5, 0.25, 0.12, 0.06]), { disableNormalization: true })
  const voices = []
  let pedalDown = false

  const finish = (voice) => {
    voice.amp.disconnect()
    voices.splice(voices.indexOf(voice), 1)
  }
  const release = (voice, seconds = 0.15) => {
    if (voice.releasing) return
    voice.releasing = true
    const now = context.currentTime
    voice.osc.onended = () => finish(voice)
    if (!smoothRelease) {
      // The fault: stop dead, mid-waveform.
      voice.osc.stop()
      return
    }
    // Hold the current level by hand: in Chromium, cancelAndHoldAtTime followed
    // by a linear ramp jumps straight to the ramp's end (a click).
    const gain = voice.amp.gain
    const level = gain.value
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(level, now)
    gain.linearRampToValueAtTime(0, now + seconds)
    voice.osc.stop(now + seconds + 0.01)
  }
  const noteOn = (note, velocity) => {
    for (const voice of voices) if (voice.note === note && !voice.releasing) release(voice)
    const sounding = voices.filter((voice) => !voice.releasing)
    if (sounding.length >= 16) release(sounding[0], 0.01)
    const now = context.currentTime
    const peak = 0.3 * ((velocitySensitive ? velocity : 100) / 127) ** 2
    const osc = new OscillatorNode(context, { frequency: 440 * 2 ** ((note - 69) / 12 + detuneCents / 1200) })
    osc.setPeriodicWave(wave)
    const amp = new GainNode(context, { gain: 0 })
    amp.gain.setValueAtTime(0, now)
    amp.gain.linearRampToValueAtTime(peak, now + 0.008)
    amp.gain.setTargetAtTime(peak * 0.25, now + 0.008, 1.2)
    osc.connect(amp).connect(master)
    osc.start(now)
    voices.push({ note, osc, amp, keyDown: true, releasing: false })
  }
  const noteOff = (note) => {
    for (const voice of voices) {
      if (voice.note !== note || voice.releasing || !voice.keyDown) continue
      voice.keyDown = false
      if (!pedalDown) release(voice)
    }
  }
  const onMessage = (event) => {
    const [status, data1, data2] = event.data
    const type = status & 0xf0
    if (type === 0x90 && data2 > 0) noteOn(data1, data2)
    else if (type === 0x80 || type === 0x90) noteOff(data1)
    else if (type === 0xb0 && data1 === 64 && sustainPedal) {
      pedalDown = data2 >= 64
      if (!pedalDown) for (const voice of voices.slice()) if (!voice.keyDown) release(voice)
    }
  }
  navigator.requestMIDIAccess().then((access) => {
    for (const input of access.inputs.values()) {
      if (listen === 'event') input.addEventListener('midimessage', onMessage)
      else input.onmidimessage = onMessage
    }
  })
  return context
}
