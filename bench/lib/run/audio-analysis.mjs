// Harness-measured audio: the pure DSP half. Everything here operates on one
// mono Float32Array plus its sample rate and returns plain numbers, so the
// same code scores a candidate's recorded output and the synthetic signals in
// tests/audio-measure.test.mjs. No imports: this file is copied next to
// audio-measure.mjs into a box's /tools/ directory and must run there alone.
//
// Thresholds, and why they are what they are:
//
// - Envelope: RMS over 10 ms windows every 5 ms. Short enough to resolve an
//   attack or the end of a release, long enough to average a full period of
//   anything above 100 Hz so the envelope does not ripple with the waveform.
//   A frame's time is its window centre. dB values are floored at -120 dBFS
//   (DB_FLOOR) so silence is a number in the record, not -Infinity.
// - Sounding: the envelope peaks at >= -60 dBFS within 500 ms of note-on.
//   -60 dBFS is quiet but plainly audible on a normal monitoring chain; 500 ms
//   allows lazy sample decoding without crediting a note that arrives absurdly
//   late (that is a latency problem the latency number shows anyway).
// - Onset: the first frame at or after dispatch whose envelope reaches
//   max(peak - 30 dB, 2 x the level just before dispatch). Peak - 30 dB finds
//   the start of the attack whatever its shape; the 2x (+6 dB) guard stops the
//   previous note's tail from counting as this note. A note that never rises
//   6 dB above what was already sounding has no onset and is not "sounding".
// - Level (velocity test): the loudest 50 ms RMS in [onset, onset + 300 ms],
//   i.e. the attack body, which is what velocity drives. A step between
//   adjacent velocities rises if it gains >= 0.5 dB and is an inversion if it
//   loses > 0.5 dB: 0.5 dB is about the smallest level change a listener
//   reliably hears on a sustained sound, so anything flatter is "no response".
// - Tuning: YIN (de Cheveigne & Kawahara 2002) with its recommended 0.15
//   threshold, ~85 ms frames, searching 25-4200 Hz with no bias toward the
//   expected note so octave errors and resampling bugs are visible. Analysis
//   starts 150 ms after onset (past hammer noise and attack transients) and
//   ends at note-off or 1 s after onset. The median of confident frames is
//   the coarse pitch; it is then refined to the measured frequency of the
//   lowest strong partial near it (see deviations). Tuning error is reported
//   per note in cents and folded into (-600, 600] so an octave error shows as
//   octaveError, not as 1200 cents. The scored error is the mean of min(|folded|, 100) over the mid
//   notes: about 10 cents is the just-noticeable difference for complex tones
//   and covers mid-range piano stretch tuning; 147 cents (1200*log2(48000/
//   44100)) is the classic bug of playing 44.1 kHz samples at 48 kHz; one
//   wildly wrong note is capped at 100 so it cannot dominate the mean.
// - Release: held = RMS of [off - 60 ms, off - 10 ms]; the release ends at the
//   first frame after note-off whose envelope is 30 dB below held, or below
//   -70 dBFS. 30 dB is the usual "decay time" span (RT30-style) and -70 dBFS is
//   effectively inaudible. A release is clean if it ends within the segment
//   and no click lands in [off - 5 ms, off + 40 ms].
// - Clicks: the second difference d2[n] = x[n] - 2x[n-1] + x[n-2] is tiny for
//   smooth band-limited audio and large at a step or a slope break. Each sample
//   is compared to the RMS of d2 over 5 ms on either side, excluding +/-16
//   samples so the click does not raise its own reference: a click is
//   |d2| > 10 x local + 1e-4 and |d2| > 2e-3. The ratio makes the test level-
//   and timbre-independent (noise and bright partials raise the local RMS);
//   the 2e-3 floor is what separates a fade from a cut. A 5 ms linear fade
//   (240 samples at 48 kHz) breaks the slope by |x|/240, which stays under
//   2e-3 for any signal below about -6 dBFS, while a hard cutoff is a step of
//   |x| itself (or, at a zero crossing, a slope break of 2*pi*f*|x|/sr, still
//   far above the local d2 of a smooth tone). Attacks are excluded by starting
//   30 ms after onset: a hammer attack is legitimately sharp. Detections
//   within 10 ms merge into one click.
// - Chord: Hann FFT of [onset + 200 ms, onset + 1200 ms] (ended at note-off if
//   that comes first), zero-padded to >= 2^16 bins. A tone is heard if the
//   strongest bin within +/-25 cents of f0 (or of 2*f0) is >= 12 dB above the
//   median of +/-150 cents around f0 (centre excluded), and within 50 dB of the
//   loudest bin. Chord tones are >= 200 cents apart, so the floor never sits
//   on a neighbour; 12 dB is clearly a partial rather than noise or leakage;
//   50 dB below the loudest component is masked in practice. 2*f0 rescues
//   tones whose fundamental is weak, but it is only consulted when no other
//   chord tone has a harmonic (2nd-8th) within 25 cents of it (see deviations).
// - Cut to silence: a sound that stops dead into digital silence (|x| <= 1e-5
//   for 10 ms) is a click when the last 1 ms before the silence still peaks at
//   >= 22% of the 20 ms before it (and that was audible, >= -60 dBFS). A 5 ms
//   linear fade can reach at most 20% in its last millisecond, so it never
//   qualifies. A hard-stopped sine above ~90 Hz always qualifies (1 ms is then
//   over a twelfth of a period, sin(pi/12) > 0.22); for rich low tones the d2
//   test catches most of what this misses. Together they flagged 99-100% of
//   simulated hard stops on notes 40-84 at random phase; what escapes is a
//   stop where waveform and slope are both near zero, which is nearly silent.
// - Sustain: with the pedal down, the level just before key-off minus the
//   50 ms RMS 500 ms later must not drop more than 20 dB (a held piano note
//   loses well under that to natural decay; a damped note falls >= 30 dB, the
//   release threshold, within that time in every build measured). After
//   pedal-up the level 1 s later must be <= min(pre-up - 20, -70) dBFS, i.e.
//   both 20 dB down and inaudible (already below -70 dBFS before pedal-up
//   counts as released).
//
// timeScale: the driver may compress the plan's timing for fast tests. Only
// windows that are tied to the plan's own event spacing scale with it (the
// sustain checks' "500 ms after key-off" and "1 s after pedal-up"); everything
// that describes the sound itself (envelope, onset, level, YIN frames, click
// detector, chord FFT length) stays absolute.
//
// Deviations from the first draft of these rules, each forced by evidence:
// - Chord: the 2*f0 fallback is skipped for tones whose octave coincides with
//   another chord tone's harmonic (G3's octave G4 is C3's 3rd harmonic, 2 cents
//   away), otherwise a missing tone is "heard" through its neighbour. The FFT
//   window also ends at note-off so a compressed timeScale does not measure
//   release tails.
// - Clicks: the cut-to-silence rule above was added. On its own the d2 test
//   catches a hard stop only when the waveform is far enough from zero at the
//   cut relative to the tone's own d2: a bright synthetic note 84 cut at random
//   phase was flagged 66-74% of the time, and a real build that hard-stops
//   every note (muse-spark-1-3 stage 1, rich piano samples) had about half its
//   cuts flagged, a different half on each run. Clicks within 4 ms (a 128-frame
//   render quantum plus margin) of a gap in the tap's timeline (frames no
//   audio block covered) are dropped, and the gap is counted in tapGapFrames:
//   under load Chromium occasionally skips the tap for one quantum, mostly
//   just after note-on, and the neighbouring quantum can carry a one-sample
//   spike (seen on claude-sonnet-5-5 stage 1's chord); neither is the app's.
// - Tuning: YIN's period estimate is pulled sharp by stretched (inharmonic)
//   partials. claude-sonnet-5-5 stage 1 plays fundamentals within 1.4 cents
//   of equal temperament, but YIN read +7 to +17 cents because its upper
//   partials run up to +50 cents sharp. YIN still picks the octave (so octave
//   errors and resampling bugs show), then a zero-padded Hann FFT of the same
//   window measures partials 1-4 within +/-50 cents of k x the YIN pitch, and
//   the lowest partial within 20 dB of the strongest gives pitch = its
//   frequency / k (normally the fundamental itself).
// - Sustain hold limit 12 -> 20 dB: muse-spark-1-3 stage 1 holds the note
//   with the pedal but its fast natural decay drops 12.5 dB in the 500 ms.
// - Level: measured whenever a note has an onset, even under -60 dBFS (it is
//   then not "sounding"), so a soft-but-present velocity-16 note still gives
//   a velocity range (claude-opus-5-5 stage 3 plays it at -65 dBFS). Anything
//   under -90 dBFS is treated as no onset at all (rounding noise).

export const DB_FLOOR = -120

export const ENVELOPE = { windowSeconds: 0.01, hopSeconds: 0.005 }
export const SOUNDING = { dbfs: -60, withinSeconds: 0.5, measurableDbfs: -90 }
export const ONSET = { belowPeakDb: 30, overPriorRatio: 2 }
export const LEVEL = { windowSeconds: 0.05, spanSeconds: 0.3 }
export const VELOCITY = { stepDb: 0.5 }
export const PITCH = { threshold: 0.15, minHz: 25, maxHz: 4200, startSeconds: 0.15, spanSeconds: 1, frameSeconds: 4096 / 48000, capCents: 100, refineFftSize: 131072, refineCents: 50, refinePartials: 4, refineWithinDb: 20 }
export const RELEASE = { heldFromSeconds: 0.06, heldToSeconds: 0.01, dropDb: 30, floorDbfs: -70, clickBeforeSeconds: 0.005, clickAfterSeconds: 0.04 }
export const CLICK = { ratio: 10, bias: 1e-4, floor: 2e-3, sideSeconds: 0.005, guardSamples: 16, mergeSeconds: 0.01, afterOnsetSeconds: 0.03, gapGuardSeconds: 0.004 }
export const CUT = { silence: 1e-5, silentSeconds: 0.01, levelSeconds: 0.02, tailSeconds: 0.001, tailRatio: 0.22, minPeak: 1e-3 }
export const CHORD = { fromSeconds: 0.2, toSeconds: 1.2, minFftSize: 65536, centreCents: 25, floorCents: 150, overFloorDb: 12, underMaxDb: 50, harmonics: 8 }
export const SUSTAIN = { maxHoldDropDb: 20, holdAfterSeconds: 0.5, releaseAfterSeconds: 1, minReleaseDropDb: 20, silentDbfs: -70, windowSeconds: 0.05 }

export function toDb(value) {
  if (!(value > 0)) return DB_FLOOR
  return Math.max(DB_FLOOR, 20 * Math.log10(value))
}

export function noteHz(note) {
  return 440 * 2 ** ((note - 69) / 12)
}

export function centsBetween(hz, referenceHz) {
  return 1200 * Math.log2(hz / referenceHz)
}

// Fold into (-600, 600] so an octave error reads as 0 here and as octaveError.
export function foldCents(cents) {
  let folded = cents % 1200
  if (folded > 600) folded -= 1200
  if (folded <= -600) folded += 1200
  return folded
}

export function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

function prefixSquares(x) {
  const sums = new Float64Array(x.length + 1)
  for (let i = 0; i < x.length; i++) sums[i + 1] = sums[i] + x[i] * x[i]
  return sums
}

function clampIndex(index, length) {
  return Math.max(0, Math.min(length, Math.round(index)))
}

// RMS of x[from, to), 0 for an empty range.
export function rms(x, from, to) {
  const a = clampIndex(from, x.length)
  const b = clampIndex(to, x.length)
  if (b <= a) return 0
  let sum = 0
  for (let i = a; i < b; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / (b - a))
}

export function peakAbs(x, from = 0, to = x.length) {
  const a = clampIndex(from, x.length)
  const b = clampIndex(to, x.length)
  let peak = 0
  for (let i = a; i < b; i++) {
    const value = Math.abs(x[i])
    if (value > peak) peak = value
  }
  return peak
}

// The 10 ms / 5 ms RMS envelope. Frame i covers [i*hop, i*hop + win) and is
// timed at its centre.
export function envelope(x, sampleRate) {
  const win = Math.max(1, Math.round(ENVELOPE.windowSeconds * sampleRate))
  const hop = Math.max(1, Math.round(ENVELOPE.hopSeconds * sampleRate))
  const count = x.length >= win ? Math.floor((x.length - win) / hop) + 1 : 0
  const sums = prefixSquares(x)
  const values = new Float64Array(count)
  for (let i = 0; i < count; i++) values[i] = Math.sqrt((sums[i * hop + win] - sums[i * hop]) / win)
  return {
    win,
    hop,
    values,
    centre: (i) => i * hop + win / 2,
    // First frame whose centre is at or after sample index s.
    firstAtOrAfter: (s) => Math.max(0, Math.ceil((s - win / 2) / hop)),
  }
}

// Largest RMS over any `windowSeconds` window lying inside [from, to).
export function maxWindowRms(x, sampleRate, from, to, windowSeconds = LEVEL.windowSeconds) {
  const win = Math.max(1, Math.round(windowSeconds * sampleRate))
  const a = clampIndex(from, x.length)
  const b = clampIndex(to, x.length)
  if (b - a < win) return rms(x, a, b)
  let sum = 0
  for (let i = a; i < a + win; i++) sum += x[i] * x[i]
  let best = sum
  for (let i = a + win; i < b; i++) {
    sum += x[i] * x[i] - x[i - win] * x[i - win]
    if (sum > best) best = sum
  }
  return Math.sqrt(Math.max(0, best) / win)
}

// Sounding, onset and latency of a note dispatched at sample `on`.
export function detectOnset(x, sampleRate, on, env = envelope(x, sampleRate)) {
  const { values, win, hop } = env
  const first = env.firstAtOrAfter(on)
  const last = Math.min(values.length - 1, Math.floor((on + SOUNDING.withinSeconds * sampleRate - win / 2) / hop))
  let peak = 0
  for (let i = first; i <= last; i++) if (values[i] > peak) peak = values[i]
  // The level already present: the last frame whose window ends at or before
  // dispatch (a frame straddling dispatch would include this note's attack).
  const priorIndex = Math.floor((on - win) / hop)
  const prior = priorIndex >= 0 && priorIndex < values.length ? values[priorIndex] : 0
  const threshold = Math.max(peak * 10 ** (-ONSET.belowPeakDb / 20), ONSET.overPriorRatio * prior)
  let onsetFrame = -1
  if (toDb(peak) >= SOUNDING.measurableDbfs) {
    for (let i = first; i <= last; i++) {
      if (values[i] >= threshold) {
        onsetFrame = i
        break
      }
    }
  }
  const peakDbfs = toDb(peak)
  const sounding = onsetFrame >= 0 && peakDbfs >= SOUNDING.dbfs
  const onset = onsetFrame >= 0 ? env.centre(onsetFrame) : null
  return {
    sounding,
    peakDbfs,
    priorDbfs: toDb(prior),
    onset,
    latencyMs: onset === null ? null : ((onset - on) / sampleRate) * 1000,
  }
}

// Velocity level: the loudest 50 ms RMS in [onset, onset + 300 ms].
export function attackLevelDb(x, sampleRate, onset) {
  if (onset === null || onset === undefined) return null
  return toDb(maxWindowRms(x, sampleRate, onset, onset + LEVEL.spanSeconds * sampleRate))
}

// YIN over one frame. Returns { hz, aperiodicity } or null when no lag dips
// under the threshold (not confident).
function yinFrame(x, offset, w, tauMin, tauMax, sampleRate, diff) {
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0
    for (let j = 0; j < w; j++) {
      const delta = x[offset + j] - x[offset + j + tau]
      sum += delta * delta
    }
    diff[tau] = sum
  }
  let running = 0
  let found = -1
  const cmnd = new Float64Array(tauMax + 1)
  cmnd[0] = 1
  for (let tau = 1; tau <= tauMax; tau++) {
    running += diff[tau]
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1
  }
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau] < PITCH.threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++
      found = tau
      break
    }
  }
  if (found < 0) return null
  // Parabolic interpolation on the raw difference (quadratic around a period).
  let refined = found
  if (found > 1 && found < tauMax) {
    const a = diff[found - 1]
    const b = diff[found]
    const c = diff[found + 1]
    const denominator = a - 2 * b + c
    if (denominator > 0) refined = found + (0.5 * (a - c)) / denominator
  }
  return { hz: sampleRate / refined, aperiodicity: cmnd[found] }
}

// Pitch of x[from, to): median of confident YIN frames, unbiased by any
// expected note.
export function detectPitch(x, sampleRate, from, to) {
  const tauMin = Math.max(2, Math.floor(sampleRate / PITCH.maxHz))
  const tauMax = Math.ceil(sampleRate / PITCH.minHz)
  const frameLength = Math.max(tauMax * 2, Math.round(PITCH.frameSeconds * sampleRate))
  const w = frameLength - tauMax
  const a = clampIndex(from, x.length)
  const b = clampIndex(to, x.length)
  const frames = []
  if (b - a >= frameLength) {
    const available = b - a - frameLength
    const count = Math.min(16, Math.floor(available / Math.round(w / 2)) + 1)
    const step = count > 1 ? available / (count - 1) : 0
    const diff = new Float64Array(tauMax + 1)
    for (let k = 0; k < count; k++) {
      const offset = a + Math.round(k * step)
      // Skip frames of near-silence: YIN on rounding noise is meaningless.
      if (rms(x, offset, offset + frameLength) < 1e-5) continue
      const result = yinFrame(x, offset, w, tauMin, tauMax, sampleRate, diff)
      if (result) frames.push(result.hz)
    }
  }
  return { hz: median(frames), confidentFrames: frames.length }
}

// Measured frequency of the partial nearest k x coarseHz, or null.
function partialPeak(magnitudes, size, sampleRate, hz) {
  const [low, high] = bandBins(hz, PITCH.refineCents, sampleRate, size)
  let best = -1
  for (let i = Math.max(low, 1); i <= Math.min(high, magnitudes.length - 2); i++) if (best < 0 || magnitudes[i] > magnitudes[best]) best = i
  if (best < 0) return null
  const a = magnitudes[best - 1]
  const b = magnitudes[best]
  const c = magnitudes[best + 1]
  const denominator = a - 2 * b + c
  const offset = denominator < 0 ? (0.5 * (a - c)) / denominator : 0
  return { hz: ((best + offset) * sampleRate) / size, db: b }
}

// Refine a coarse (YIN) pitch to the frequency of the lowest strong partial.
export function refinePitch(x, sampleRate, from, to, coarseHz) {
  const { size, magnitudes } = spectrumDb(x, from, to, PITCH.refineFftSize)
  const partials = []
  for (let k = 1; k <= PITCH.refinePartials; k++) {
    if (k * coarseHz >= sampleRate / 2) break
    const peak = partialPeak(magnitudes, size, sampleRate, k * coarseHz)
    if (peak) partials.push({ k, ...peak })
  }
  if (partials.length === 0) return null
  const strongest = Math.max(...partials.map((partial) => partial.db))
  const chosen = partials.find((partial) => partial.db >= strongest - PITCH.refineWithinDb)
  return { hz: chosen.hz / chosen.k, partial: chosen.k }
}

export function analyzeTuning(x, sampleRate, { onset, off, note }) {
  const expectedHz = noteHz(note)
  if (onset === null || onset === undefined) {
    return { expectedHz, hz: null, cents: null, foldedCents: null, octaveError: null, confidentFrames: 0 }
  }
  const from = onset + PITCH.startSeconds * sampleRate
  const to = Math.min(off, onset + PITCH.spanSeconds * sampleRate)
  const { hz: yinHz, confidentFrames } = detectPitch(x, sampleRate, from, to)
  if (yinHz === null) return { expectedHz, hz: null, yinHz: null, partial: null, cents: null, foldedCents: null, octaveError: null, confidentFrames }
  const refined = refinePitch(x, sampleRate, from, to, yinHz)
  const hz = refined?.hz ?? yinHz
  const cents = centsBetween(hz, expectedHz)
  return { expectedHz, hz, yinHz, partial: refined?.partial ?? null, cents, foldedCents: foldCents(cents), octaveError: Math.round(cents / 1200) || 0, confidentFrames }
}

// Click detector (see header). Returns merged clicks with sample index and
// the |d2| / local ratio that triggered them.
export function findClicks(x, sampleRate, from = 0, to = x.length) {
  const n = x.length
  const side = Math.max(1, Math.round(CLICK.sideSeconds * sampleRate))
  const guard = CLICK.guardSamples
  const d2 = new Float32Array(n)
  for (let i = 2; i < n; i++) d2[i] = x[i] - 2 * x[i - 1] + x[i - 2]
  const sums = prefixSquares(d2)
  const start = Math.max(Math.round(from), 2 + guard + side)
  const end = Math.min(Math.round(to), n - guard - side - 1)
  const raw = []
  for (let i = start; i < end; i++) {
    const magnitude = Math.abs(d2[i])
    if (magnitude <= CLICK.floor) continue
    const left = sums[i - guard] - sums[i - guard - side]
    const right = sums[i + guard + 1 + side] - sums[i + guard + 1]
    const local = Math.sqrt(Math.max(0, left + right) / (2 * side))
    if (magnitude > CLICK.ratio * local + CLICK.bias) raw.push({ index: i, magnitude, local })
  }
  const merge = Math.round(CLICK.mergeSeconds * sampleRate)
  const clicks = []
  for (const hit of raw) {
    const last = clicks[clicks.length - 1]
    if (last && hit.index - last.lastIndex <= merge) {
      last.lastIndex = hit.index
      if (hit.magnitude > last.magnitude) Object.assign(last, { index: hit.index, magnitude: hit.magnitude, local: hit.local })
    } else {
      clicks.push({ ...hit, lastIndex: hit.index })
    }
  }
  return clicks.map(({ index, magnitude, local }) => ({ index, magnitude, ratio: local > 0 ? magnitude / local : null }))
}

// Hard stops into digital silence (see header). Returns { index, magnitude,
// ratio } like findClicks, ratio being last-millisecond peak / 20 ms peak.
export function findCutsToSilence(x, sampleRate, from = 0, to = x.length) {
  const run = Math.max(1, Math.round(CUT.silentSeconds * sampleRate))
  const level = Math.round(CUT.levelSeconds * sampleRate)
  const tail = Math.max(1, Math.round(CUT.tailSeconds * sampleRate))
  const end = Math.min(Math.round(to), x.length)
  const cuts = []
  let runStart = -1
  for (let i = Math.max(Math.round(from), level); i < end; i++) {
    if (Math.abs(x[i]) > CUT.silence) {
      runStart = -1
      continue
    }
    if (runStart < 0) runStart = i
    if (i - runStart + 1 !== run) continue
    const peak = peakAbs(x, runStart - level, runStart)
    const last = peakAbs(x, runStart - tail, runStart)
    if (peak >= CUT.minPeak && last >= CUT.tailRatio * peak) cuts.push({ index: runStart, magnitude: last, ratio: last / peak })
  }
  return cuts
}

// Every click in [from, to): d2 steps and cuts to silence, merged within
// 10 ms, minus any that touch a gap in the tap's timeline ([start, end)
// sample ranges the harness could not fill).
export function detectClicks(x, sampleRate, from = 0, to = x.length, { gaps = [] } = {}) {
  const guard = CLICK.gapGuardSeconds * sampleRate
  const nearGap = (index) => gaps.some(([a, b]) => index >= a - guard && index < b + guard)
  const found = [...findClicks(x, sampleRate, from, to).map((click) => ({ ...click, kind: 'step' })), ...findCutsToSilence(x, sampleRate, from, to).map((click) => ({ ...click, kind: 'cut' }))]
    .filter((click) => !nearGap(click.index))
    .sort((a, b) => a.index - b.index)
  const merge = CLICK.mergeSeconds * sampleRate
  const merged = []
  for (const click of found) {
    const last = merged[merged.length - 1]
    if (last && click.index - last.index <= merge) {
      if (click.kind === 'cut') last.kind = 'cut'
      continue
    }
    merged.push({ ...click })
  }
  return merged
}

// Where a click sits relative to the release event that ends the note.
export function clickPlace(index, off, sampleRate) {
  if (off === null || off === undefined) return 'hold'
  if (index < off - RELEASE.clickBeforeSeconds * sampleRate) return 'hold'
  if (index <= off + RELEASE.clickAfterSeconds * sampleRate) return 'off'
  return 'tail'
}

export function analyzeRelease(x, sampleRate, { off, clicks = [] }) {
  const held = rms(x, off - RELEASE.heldFromSeconds * sampleRate, off - RELEASE.heldToSeconds * sampleRate)
  const env = envelope(x, sampleRate)
  const threshold = Math.max(held * 10 ** (-RELEASE.dropDb / 20), 10 ** (RELEASE.floorDbfs / 20))
  let endFrame = -1
  for (let i = env.firstAtOrAfter(off); i < env.values.length; i++) {
    if (env.values[i] <= threshold) {
      endFrame = i
      break
    }
  }
  const ended = endFrame >= 0
  const clickAtOff = clicks.some((click) => clickPlace(click.index, off, sampleRate) === 'off')
  return {
    heldDbfs: toDb(held),
    seconds: ended ? (env.centre(endFrame) - off) / sampleRate : null,
    ended,
    clickAtOff,
    clean: ended && !clickAtOff,
  }
}

export function analyzeSustain(x, sampleRate, { off, pedalUp, timeScale = 1 }) {
  const win = SUSTAIN.windowSeconds * sampleRate
  const beforeOff = toDb(rms(x, off - win, off))
  const holdAt = off + SUSTAIN.holdAfterSeconds * timeScale * sampleRate
  const afterOff = toDb(rms(x, holdAt, holdAt + win))
  const holdDropDb = beforeOff - afterOff
  // Nothing sounding before key-off means there was nothing to hold.
  const holds = beforeOff >= SOUNDING.dbfs && holdDropDb <= SUSTAIN.maxHoldDropDb
  const preUp = toDb(rms(x, pedalUp - win, pedalUp))
  const releaseAt = pedalUp + SUSTAIN.releaseAfterSeconds * timeScale * sampleRate
  const afterUp = toDb(rms(x, releaseAt, releaseAt + win))
  const releases = preUp < SUSTAIN.silentDbfs || afterUp <= Math.min(preUp - SUSTAIN.minReleaseDropDb, SUSTAIN.silentDbfs)
  return { beforeOffDbfs: beforeOff, afterOffDbfs: afterOff, holdDropDb, holds, preUpDbfs: preUp, afterUpDbfs: afterUp, releaseDropDb: preUp - afterUp, releases }
}

// In-place iterative radix-2 FFT (re/im Float64Array, power-of-two length).
export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    const half = size >> 1
    for (let start = 0; start < n; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const a = start + k
        const b = a + half
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

// Magnitude spectrum (dB) of a Hann-windowed slice, zero-padded.
export function spectrumDb(x, from, to, minSize = CHORD.minFftSize) {
  const a = clampIndex(from, x.length)
  const b = clampIndex(to, x.length)
  const length = b - a
  let size = minSize
  while (size < length) size <<= 1
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < length; i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, length - 1)))
  fft(re, im)
  const magnitudes = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) magnitudes[i] = toDb(Math.hypot(re[i], im[i]))
  return { size, magnitudes }
}

function bandBins(hz, cents, sampleRate, size) {
  const low = Math.max(1, Math.floor((hz * 2 ** (-cents / 1200) * size) / sampleRate))
  const high = Math.min(size / 2 - 1, Math.ceil((hz * 2 ** (cents / 1200) * size) / sampleRate))
  return [low, high]
}

function nearHarmonicOfOthers(hz, note, notes) {
  return notes.some((other) => {
    if (other === note) return false
    for (let k = 1; k <= CHORD.harmonics; k++) {
      if (Math.abs(centsBetween(hz, noteHz(other) * k)) <= CHORD.centreCents) return true
    }
    return false
  })
}

export function analyzeChord(x, sampleRate, { onset, off, notes }) {
  const empty = { analyzed: false, heard: 0, notes: notes.map((note) => ({ note, heard: false, overFloorDb: null })) }
  if (onset === null || onset === undefined) return empty
  const from = onset + CHORD.fromSeconds * sampleRate
  const to = Math.min(onset + CHORD.toSeconds * sampleRate, off ?? Infinity, x.length)
  if (to - from < 0.1 * sampleRate) return empty
  const { size, magnitudes } = spectrumDb(x, from, to)
  let globalMax = DB_FLOOR
  const lowest = Math.ceil((20 * size) / sampleRate)
  for (let i = lowest; i < magnitudes.length; i++) if (magnitudes[i] > globalMax) globalMax = magnitudes[i]
  const results = notes.map((note) => {
    const f0 = noteHz(note)
    const centres = [f0]
    if (!nearHarmonicOfOthers(2 * f0, note, notes)) centres.push(2 * f0)
    let peak = DB_FLOOR
    for (const hz of centres) {
      const [low, high] = bandBins(hz, CHORD.centreCents, sampleRate, size)
      for (let i = low; i <= high; i++) if (magnitudes[i] > peak) peak = magnitudes[i]
    }
    const [centreLow, centreHigh] = bandBins(f0, CHORD.centreCents, sampleRate, size)
    const [floorLow, floorHigh] = bandBins(f0, CHORD.floorCents, sampleRate, size)
    const floorBins = []
    for (let i = floorLow; i <= floorHigh; i++) if (i < centreLow || i > centreHigh) floorBins.push(magnitudes[i])
    const floor = median(floorBins) ?? DB_FLOOR
    const heard = peak >= floor + CHORD.overFloorDb && peak >= globalMax - CHORD.underMaxDb
    return { note, heard, overFloorDb: round(peak - floor, 1), belowMaxDb: round(globalMax - peak, 1) }
  })
  return { analyzed: true, heard: results.filter((r) => r.heard).length, notes: results }
}

// levels: [{ velocity, db }] in ascending velocity order (db may be null).
export function velocityResponse(levels) {
  let risingSteps = 0
  let inversions = 0
  for (let i = 1; i < levels.length; i++) {
    const previous = levels[i - 1].db
    const current = levels[i].db
    if (previous === null || current === null) continue
    if (current - previous >= VELOCITY.stepDb) risingSteps++
    else if (previous - current > VELOCITY.stepDb) inversions++
  }
  const first = levels[0]?.db ?? null
  const last = levels[levels.length - 1]?.db ?? null
  return {
    levelsDb: levels.map(({ velocity, db }) => ({ velocity, db: round(db) })),
    risingSteps,
    steps: Math.max(0, levels.length - 1),
    inversions,
    rangeDb: first === null || last === null ? null : round(last - first),
  }
}

// One plan segment, analysed. `spec` is the plan entry ({ id, kind, notes,
// velocity, scored }); `marks` are sample indices into x: start (the segment's
// t = 0), on, off, pedalUp/pedalDown when present. Times in the result are
// seconds from the segment start.
export function analyzeSegment(spec, x, sampleRate, marks, { timeScale = 1, gaps = [] } = {}) {
  const { start, on, off } = marks
  const seconds = (index) => (index === null || index === undefined ? null : round((index - start) / sampleRate, 4))
  const env = envelope(x, sampleRate)
  const onsetInfo = detectOnset(x, sampleRate, on, env)
  // The event that actually ends the note: pedal-up when the pedal held it.
  const releaseAt = spec.kind === 'sustain' ? marks.pedalUp : off
  const scanFrom = (onsetInfo.onset ?? on) + CLICK.afterOnsetSeconds * sampleRate
  const clicks = detectClicks(x, sampleRate, scanFrom, x.length, { gaps })
  const dispatch = { on: seconds(on), off: seconds(off) }
  if (marks.pedalDown !== undefined) dispatch.pedalDown = seconds(marks.pedalDown)
  if (marks.pedalUp !== undefined) dispatch.pedalUp = seconds(marks.pedalUp)
  const segment = {
    id: spec.id,
    kind: spec.kind,
    ...(spec.notes.length === 1 ? { note: spec.notes[0] } : { notes: [...spec.notes] }),
    velocity: spec.velocity,
    dispatch,
    onsetSeconds: seconds(onsetInfo.onset),
    latencyMs: round(onsetInfo.latencyMs, 1),
    sounding: onsetInfo.sounding,
    peakDbfs: round(toDb(peakAbs(x, start, x.length))),
    envelopePeakDbfs: round(onsetInfo.peakDbfs),
    levelDb: onsetInfo.onset === null ? null : round(attackLevelDb(x, sampleRate, onsetInfo.onset)),
    clicks: clicks.map((click) => ({ seconds: seconds(click.index), where: clickPlace(click.index, releaseAt, sampleRate), kind: click.kind, magnitude: round(click.magnitude, 4), ratio: round(click.ratio, 2) })),
    tapGapFrames: gaps.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, x.length) - Math.max(a, start)), 0),
  }
  if (spec.kind === 'tuning') {
    const tuning = onsetInfo.sounding ? analyzeTuning(x, sampleRate, { onset: onsetInfo.onset, off, note: spec.notes[0] }) : analyzeTuning(x, sampleRate, { onset: null, off, note: spec.notes[0] })
    Object.assign(segment, {
      scored: Boolean(spec.scored),
      expectedHz: round(tuning.expectedHz, 3),
      hz: round(tuning.hz, 3),
      yinHz: round(tuning.yinHz, 3),
      partial: tuning.partial,
      cents: round(tuning.cents, 1),
      foldedCents: round(tuning.foldedCents, 1),
      octaveError: tuning.octaveError,
      confidentFrames: tuning.confidentFrames,
    })
  }
  if (spec.kind === 'release') {
    const release = analyzeRelease(x, sampleRate, { off, clicks })
    Object.assign(segment, { heldDbfs: round(release.heldDbfs), releaseSeconds: round(release.seconds, 3), ended: release.ended, clickAtOff: release.clickAtOff, clean: release.clean })
  }
  if (spec.kind === 'sustain') {
    const sustain = analyzeSustain(x, sampleRate, { off, pedalUp: marks.pedalUp, timeScale })
    Object.assign(segment, {
      holdDropDb: round(sustain.holdDropDb),
      releaseDropDb: round(sustain.releaseDropDb),
      beforeOffDbfs: round(sustain.beforeOffDbfs),
      preUpDbfs: round(sustain.preUpDbfs),
      afterUpDbfs: round(sustain.afterUpDbfs),
      holds: sustain.holds,
      releases: sustain.releases,
    })
  }
  if (spec.kind === 'chord') {
    const chord = analyzeChord(x, sampleRate, { onset: onsetInfo.onset, off, notes: spec.notes })
    Object.assign(segment, { heard: chord.heard, tones: chord.notes })
  }
  return segment
}

const SINGLE_NOTE_KINDS = new Set(['tuning', 'velocity', 'release', 'hold'])

// The record's summary and scores from analysed segments. `environment`
// supplies sampleRate, contextsWithSignal, clippedFrames and peakAbs across
// the segment windows.
export function summarizeSegments(segments, { sampleRate, contextsWithSignal = 0, clippedFrames = 0, peakAbs: peak = 0 } = {}) {
  const singles = segments.filter((segment) => SINGLE_NOTE_KINDS.has(segment.kind))
  const tuningSegments = segments.filter((segment) => segment.kind === 'tuning')
  const tuning = tuningSegments.map((segment) => ({
    note: segment.note,
    expectedHz: segment.expectedHz,
    hz: segment.hz,
    cents: segment.cents,
    foldedCents: segment.foldedCents,
    octaveError: segment.octaveError,
    sounding: segment.sounding,
    scored: segment.scored,
  }))
  const scoredErrors = tuning.filter((entry) => entry.scored && entry.foldedCents !== null).map((entry) => Math.min(Math.abs(entry.foldedCents), PITCH.capCents))
  const tuningErrorCents = scoredErrors.length ? round(scoredErrors.reduce((sum, value) => sum + value, 0) / scoredErrors.length, 1) : null
  const velocity = velocityResponse(segments.filter((segment) => segment.kind === 'velocity').map((segment) => ({ velocity: segment.velocity, db: segment.levelDb })))
  const release = segments.filter((segment) => segment.kind === 'release').map((segment) => ({ note: segment.note, seconds: segment.releaseSeconds, ended: segment.ended, clickAtOff: segment.clickAtOff, clean: segment.clean }))
  const sustainSegment = segments.find((segment) => segment.kind === 'sustain')
  const sustain = sustainSegment
    ? { holds: sustainSegment.holds, releases: sustainSegment.releases, holdDropDb: sustainSegment.holdDropDb, releaseDropDb: sustainSegment.releaseDropDb }
    : { holds: null, releases: null, holdDropDb: null, releaseDropDb: null }
  const clickSegments = segments.filter((segment) => SINGLE_NOTE_KINDS.has(segment.kind) || segment.kind === 'sustain' || segment.kind === 'chord')
  const clickList = clickSegments.flatMap((segment) => segment.clicks.map((click) => ({ segment: segment.id, seconds: click.seconds, where: click.where })))
  const latencies = singles.map((segment) => segment.latencyMs).filter((value) => value !== null)
  const chordSegment = segments.find((segment) => segment.kind === 'chord')
  const chord = chordSegment
    ? { tones: chordSegment.notes.length, heard: chordSegment.heard, notes: chordSegment.tones.map(({ note, heard }) => ({ note, heard })), peakDbfs: chordSegment.peakDbfs }
    : { tones: 10, heard: null, notes: [], peakDbfs: null }
  const clippedMs = sampleRate ? round((clippedFrames / sampleRate) * 1000, 1) : null
  const summary = {
    notesSounding: singles.filter((segment) => segment.sounding).length,
    notesTotal: singles.length,
    tuning,
    tuningErrorCents,
    tuningNotesMeasured: scoredErrors.length,
    velocity,
    release,
    releasesClean: release.filter((entry) => entry.clean).length,
    releasesTotal: release.length,
    sustain,
    clicks: { count: clickList.length, at: clickList },
    latencyMs: { median: round(median(latencies), 1), p90: round(percentile(latencies, 90), 1), max: latencies.length ? round(Math.max(...latencies), 1) : null, samples: latencies.length },
    chord,
    clippedMs,
    peakDbfs: round(toDb(peak)),
  }
  const sustainChecksPassed = sustainSegment ? Number(Boolean(sustain.holds)) + Number(Boolean(sustain.releases)) : null
  const scores = {
    notesSounding: summary.notesSounding,
    notesTotal: summary.notesTotal,
    tuningErrorCents,
    velocityRisingSteps: velocity.risingSteps,
    velocityStepsTotal: velocity.steps,
    velocityRangeDb: velocity.rangeDb,
    releasesClean: summary.releasesClean,
    releasesTotal: summary.releasesTotal,
    clicks: clickList.length,
    sustainChecksPassed,
    sustainChecksTotal: 2,
    latencyMs: summary.latencyMs.median,
    chordTonesHeard: chord.heard,
    chordTones: chord.tones,
    clippedMs,
    extraAudioContexts: Math.max(0, contextsWithSignal - 1),
  }
  return { summary, scores }
}
