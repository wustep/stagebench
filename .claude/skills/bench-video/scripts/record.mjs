#!/usr/bin/env node
// Record one phase-N preview per run: full-screen video + real Web Audio, playing
// a chosen song. Writes <out>/<slug>.webm, <slug>.audio.webm, <slug>.meta.json.
//
// Usage:
//   node record.mjs --runs kimi-k3,claude-fable-5 --phase 2 --song bach-prelude-c \
//     --out ./raw --repo /path/to/stagebench [--base http://127.0.0.1:4173] [--fx fx.json]
//
// Notes are addressed by MIDI number via each key button's data-note/aria-label,
// so accidentals work and we never depend on white-key ordinal positions.

import { chromium } from 'playwright'
import { mkdirSync, renameSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
// Keys may be <button> or an ARIA-correct <div role="button"> — never assume the
// tag. Both the pre-flight count and the note mapping must use this same rule.
const KEY_SELECTOR = 'button,[role="button"]'
const KEY_CLASS_RE = String.raw`/(^|[ -])key/i`

const RUNS = (arg('runs') || '').split(',').map((s) => s.trim()).filter(Boolean)
const PHASE = Number(arg('phase', '2'))
const SONG_ID = arg('song', 'bach-prelude-c')
const OUT = resolve(arg('out', './raw'))
const REPO = resolve(arg('repo', process.cwd()))
const BASE = arg('base', 'http://127.0.0.1:4173')
const FX_FILE = arg('fx')
if (!RUNS.length) throw new Error('--runs is required (comma-separated run ids)')

const songsPath = new URL('../assets/songs.json', import.meta.url).pathname
const SONG = JSON.parse(readFileSync(songsPath, 'utf8')).songs.find((s) => s.id === SONG_ID)
if (!SONG) throw new Error(`unknown song "${SONG_ID}"`)

// Per-run "make it a dry piano" steps, matched on aria-label. want: on|off|click.
// Labels differ per artifact; extend here (or pass --fx with the same shape).
// An entry of [] means "verified: this artifact has nothing to bypass" and is
// treated as covered. A run MISSING from this map is filmed with effects live
// and warns. Labels were confirmed identical on phases 2 and 3 for every run.
const FX_DEFAULTS = {
  'gpt-5-6-sol-high': [
    { label: 'All effects bypass: BYPASS', want: 'on' },
    { label: 'Shared rotary on: ROTARY', want: 'off' },
  ],
  'claude-fable-5': [
    { label: 'All FX Off', want: 'click' },
    { label: 'Layer Effects On', want: 'off' },
  ],
  'kimi-k3': [{ label: 'Layer effects on/off (bypass all)', want: 'off' }],
  'gpt-5-6-luna-3': [{ label: 'BYPASS ALL', want: 'on' }],
  'gpt5-5-high': [{ label: 'Layer Effects On control', want: 'off' }],
  'claude-opus-4-8': [
    { label: 'All effects off', want: 'click' },
    { label: 'Layer effects on', want: 'off' },
  ],
  // DECORATIVE bypass: the control exists but never changes state. Verified with
  // a real mouse click, a synthetic el.click(), and a full pointer/mouse event
  // dispatch — all three leave aria-pressed untouched. Both are additionally
  // covered by another element (grok's sits under a piano key, haiku's under a
  // deck container). Kept so the attempt is logged and warns every run: these two
  // ALWAYS film with effects live and cannot be made comparable.
  'grok-4-5': [{ label: 'Effects Bypass', want: 'on' }],
  'claude-haiku-4-5-20251001': [{ label: 'All Bypass', want: 'on' }],
  // No global bypass — each unit is toggled individually, and none expose
  // aria-pressed, so the resulting state cannot be verified from the DOM.
  'composer-2-5-fast': [
    { label: 'Mod 1 Bypass', want: 'click' },
    { label: 'Mod 2 Bypass', want: 'click' },
    { label: 'Delay Bypass', want: 'click' },
    { label: 'Amp Sim Bypass', want: 'click' },
    { label: 'Compressor Bypass', want: 'click' },
    { label: 'Reverb Bypass', want: 'click' },
  ],
  // Exposes no bypass-like control on either phase; its effects are decorative,
  // so it is already dry and needs no steps.
  'gpt-5-6-terra-high': [],
}
const FX = FX_FILE ? JSON.parse(readFileSync(resolve(FX_FILE), 'utf8')) : FX_DEFAULTS

// Framing targets (see SKILL.md "Normalize the framing"): instrument fills this
// fraction of frame width, with its top edge here so the title card clears it.
const TARGET_WIDTH_FRAC = 0.94
const TITLE_CLEAR_Y = 228

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Tee everything bound for the speakers into a MediaStreamDestination we can record.
const TEE = `(() => {
  const orig = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest && dest.constructor && dest.constructor.name === 'AudioDestinationNode') {
        const ctx = this.context
        if (ctx && typeof ctx.createMediaStreamDestination === 'function') {
          if (!ctx.__cap) {
            ctx.__cap = ctx.createMediaStreamDestination()
            ;(window.__captureStreams = window.__captureStreams || []).push(ctx.__cap.stream)
          }
          orig.call(this, ctx.__cap)
        }
      }
    } catch (e) {}
    return orig.call(this, dest, ...rest)
  }
})()`

// rAF ticker installed before app JS so a frozen first paint is visible to us.
const FRAME_PROBE = `window.__frames=[];(function loop(){window.__frames.push(performance.now());requestAnimationFrame(loop)})();`

const NOTE_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function fmtTokens(t) {
  const n = t?.totalTokens ?? ((t?.inputTokens ?? 0) + (t?.outputTokens ?? 0))
  if (!n) return null
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M tokens` : `${Math.round(n / 1e3)}K tokens`
}
function fmtCost(t) {
  return typeof t?.costUsd === 'number' ? `$${t.costUsd.toFixed(2)}` : null
}
function fmtTime(s) {
  if (!s) return null
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

// Per-PHASE telemetry — never the whole-run total. This is the single easiest
// number to get wrong; a phase-2 video must show phase-2 cost and wall time.
function metricsFor(runId) {
  const p = join(REPO, 'runs', runId, 'run.json')
  if (!existsSync(p)) return { title: runId, metrics: '', warn: `no run.json at ${p}` }
  const run = JSON.parse(readFileSync(p, 'utf8'))
  const stage = (run.stages || []).find((s) => s.number === PHASE)
  const t = stage?.telemetry ?? null
  const parts = [fmtTokens(t), fmtCost(t), fmtTime(t?.wallTimeSeconds)].filter(Boolean)
  // Warn on every missing field, not just cost — a phase carrying only
  // wallTimeSeconds yields a one-token overlay like "9m", which reads as a
  // rendering bug in the finished video rather than the data gap it is.
  const warns = []
  if (!t) warns.push(`no phase-${PHASE} telemetry in run.json`)
  else {
    if (!fmtTokens(t)) warns.push('no token counts')
    if (typeof t.costUsd !== 'number') warns.push('costUsd is null — supply an estimate manually (e.g. "~$25 est.")')
    if (!t.wallTimeSeconds) warns.push('no wallTimeSeconds')
  }
  if (parts.length < 2) warns.push(`overlay would read only "${parts.join(' · ')}" — fill it in by hand or drop the run`)
  return { title: run.title || runId, metrics: parts.join(' · '), warn: warns.length ? `phase-${PHASE}: ${warns.join('; ')}` : null }
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const summary = []

for (const runId of RUNS) {
  // Must match compose.sh's `tr -c 'a-zA-Z0-9' '-'` exactly (per-char, no
  // run-collapsing) or the two disagree on filenames for some ids.
  const slug = runId.replace(/[^a-z0-9]/gi, '-')
  const url = `${BASE}/previews/${runId}/stage${PHASE}/index.html`
  const { title, metrics, warn } = metricsFor(runId)
  if (warn) console.warn(`[${runId}] WARN: ${warn}`)

  // ---------------------------------------------------------------- pre-flight
  // Load once WITHOUT recording and confirm the artifact actually paints. A
  // frozen artifact (e.g. a multi-second blocking init) yields a useless capture,
  // and the driver's own evaluate() calls will silently absorb the stall.
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const page = await ctx.newPage()
    await page.addInitScript(FRAME_PROBE)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await sleep(4000)
    const f = await page.evaluate(() => {
      const a = window.__frames, gaps = []
      for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] > 100) gaps.push(Math.round(a[i] - a[i - 1]))
      return { n: a.length, maxGap: gaps.length ? Math.max(...gaps) : 0 }
    })
    const keyCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, `${KEY_SELECTOR}`.split(',').map((s) => `${s}[class*="key" i]`).join(','))
    await ctx.close()
    console.log(`[${runId}] pre-flight: ${f.n} frames/4s, maxGap ${f.maxGap}ms, ${keyCount} key elements`)
    // Two distinct failure modes — keep them separate. A paint stall is the
    // artifact's problem; zero keys is almost always our selector's problem.
    if (f.n < 100 || f.maxGap > 750) {
      throw new Error(
        `[${runId}] artifact does not paint smoothly (${f.n} frames/4s, ${f.maxGap}ms stall). ` +
          `Recording it would capture a frozen page. Investigate the ARTIFACT before filming — do not "fix" it in the capture.`,
      )
    }
    if (!keyCount) {
      throw new Error(
        `[${runId}] no key elements matched at ${url}. The page painted fine, so suspect THIS TOOL first: ` +
          `keys may use a tag or class this selector misses (we match ${KEY_SELECTOR} with a class matching ${KEY_CLASS_RE}). ` +
          `Inspect the DOM and widen the selector rather than assuming the artifact lacks a keybed.`,
      )
    }
    if (errors.length) console.warn(`[${runId}] page errors: ${errors.slice(0, 3).join(' | ')}`)
  }

  // ------------------------------------------------------------------ recording
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  })
  const page = await ctx.newPage()
  const tPage = Date.now()
  await page.addInitScript(TEE)
  await page.goto(url, { waitUntil: 'networkidle' })
  await sleep(1500)

  // Map MIDI -> key button. data-note/data-midi first; else parse the aria-label.
  const keyInfo = await page.evaluate(([pcMap, sel]) => {
    const btns = [...document.querySelectorAll(sel)].filter((b) => /(^|[ -])key/i.test(String(b.className)))
    const map = new Map()
    for (const b of btns) {
      const raw = b.getAttribute('data-note') ?? b.getAttribute('data-midi') ?? b.getAttribute('data-key')
      let midi = raw != null && /^\d+$/.test(raw) ? Number(raw) : null
      if (midi == null) {
        const m = (b.getAttribute('aria-label') || '').match(/\b([A-G])(#|b)?(-?\d)\b/)
        if (m) {
          let pc = pcMap[m[1]]
          if (m[2] === '#') pc += 1
          if (m[2] === 'b') pc -= 1
          midi = (Number(m[3]) + 1) * 12 + pc
        }
      }
      if (midi != null && !map.has(midi)) map.set(midi, b)
    }
    window.__keys = map
    const isBlack = (el) => /black|sharp|accidental/i.test(String(el.className))
    window.__pt = (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height * (isBlack(el) ? 0.5 : 0.8) }
    }
    return { count: map.size, lo: Math.min(...map.keys()), hi: Math.max(...map.keys()) }
  }, [NOTE_TO_PC, KEY_SELECTOR])
  console.log(`[${runId}] mapped ${keyInfo.count} keys, MIDI ${keyInfo.lo}–${keyInfo.hi}`)

  const needed = [...new Set(SONG.phrases.flatMap((p) => p.seq.flat()).concat(SONG.finalChord?.notes ?? []))]
  const missing = needed.filter((n) => n < keyInfo.lo || n > keyInfo.hi)
  if (missing.length) throw new Error(`[${runId}] song needs MIDI ${missing.join(',')} outside keybed range`)

  const pointOf = async (midi) => page.evaluate((n) => window.__pt(window.__keys.get(n)), midi)

  // Wake audio with a real gesture.
  const first = await pointOf(needed[0])
  await page.mouse.click(first.x, first.y)
  await sleep(300)

  // Dry piano: bypass layer effects so the comparison is of the instrument.
  if (FX[runId] === undefined) {
    console.warn(
      `[${runId}] WARN: no effects-bypass entry in FX_DEFAULTS — filming with effects LIVE. ` +
        `Its audio is not directly comparable to bypassed runs; add an entry or pass --fx. ` +
        `(Use [] to record that a run genuinely has nothing to bypass.)`,
    )
  }
  for (const step of FX[runId] ?? []) {
    const target = await page.evaluate((label) => {
      const els = [...document.querySelectorAll('button,[role="button"]')]
      const el =
        els.find((b) => (b.getAttribute('aria-label') || '').trim() === label) ||
        els.find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes(label))
      if (!el) return null
      const r = el.getBoundingClientRect()
      const x = r.x + r.width / 2, y = r.y + r.height / 2
      const top = document.elementFromPoint(x, y)
      return {
        x, y,
        pressed: el.getAttribute('aria-pressed'),
        // A covered control cannot receive a coordinate click; report what is on
        // top so a failure is diagnosable rather than mysterious.
        covered: !(top === el || el.contains(top)),
        coveredBy: top ? top.tagName + '.' + String(top.className).slice(0, 24) : null,
      }
    }, step.label)
    if (!target) {
      console.warn(`[${runId}] FX control not found: "${step.label}" — check the label, it changes per artifact`)
      continue
    }
    const needsClick =
      step.want === 'click' ||
      (step.want === 'on' && target.pressed !== 'true') ||
      (step.want === 'off' && target.pressed === 'true')
    if (needsClick) {
      await page.mouse.click(target.x, target.y)
      await sleep(200)
    }
    const after = await page.evaluate((label) => {
      const els = [...document.querySelectorAll('button,[role="button"]')]
      const el =
        els.find((b) => (b.getAttribute('aria-label') || '').trim() === label) ||
        els.find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes(label))
      return el ? el.getAttribute('aria-pressed') : 'gone'
    }, step.label)
    // Verify the toggle actually landed. A label existing proves nothing — several
    // artifacts expose a bypass control that never changes state (decorative, which
    // the honesty contract permits). Claiming coverage without checking is worse
    // than no entry, because the log reads as handled while effects stay live.
    const expected = step.want === 'on' ? 'true' : step.want === 'off' ? 'false' : null
    if (expected !== null && after !== expected) {
      console.warn(
        `[${runId}] WARN: fx "${step.label}" stayed ${after} (wanted ${expected}) — the control did not take ` +
          `effect${target.covered ? `; it is covered by ${target.coveredBy}` : ''}. It is likely decorative or ` +
          `does not reflect aria-pressed; this segment is filming with effects LIVE and is not audio-comparable ` +
          `to runs where bypass works.`,
      )
    } else if (expected === null) {
      console.log(`[${runId}] fx "${step.label}": clicked (state not verifiable — no aria-pressed)`)
    } else {
      console.log(`[${runId}] fx "${step.label}": ${target.pressed} -> ${after} (want ${step.want})`)
    }
  }
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await sleep(400)

  // Verify the sustain pedal actually responds to Space. We press it blindly
  // during the performance; if an artifact ignores it, that segment differs
  // from the others in a way nothing else would reveal.
  if (SONG.phrases.some((p) => p.pedal)) {
    // Collect EVERY sustain-ish snippet, not just the first: many panels carry a
    // static "Sustain pedal" label ahead of the live indicator, and matching only
    // the first produced a false "pedal ignored" warning on every run.
    const readPedal = () =>
      page.evaluate(() => {
        const t = document.body.innerText || ''
        const m = [...t.matchAll(/sustain[^\n]{0,30}/gi)].map((x) => x[0].toLowerCase().replace(/\s+/g, ' ').trim())
        return m.length ? m.join(' | ') : null
      })
    const before = await readPedal()
    await page.keyboard.down('Space')
    await sleep(250)
    const during = await readPedal()
    await page.keyboard.up('Space')
    await sleep(250)
    if (before === null) console.warn(`[${runId}] WARN: no sustain indicator in the DOM — pedal response could not be verified`)
    else if (before === during) {
      console.warn(
        `[${runId}] WARN: sustain indicator did not change on Space ("${before}") — the pedal may be ignored. ` +
          `This segment's note tails will differ from runs where sustain works.`,
      )
    } else {
      console.log(`[${runId}] sustain pedal: "${before}" -> "${during}" on Space`)
    }
  }

  // Instrument bounding box -> per-artifact crop, so every model fills the frame
  // the same amount regardless of how large it chose to render.
  const box = await page.evaluate((sel) => {
    const keys = [...document.querySelectorAll(sel)].filter((b) => /(^|[ -])key/i.test(String(b.className)))
    const rects = keys.map((k) => k.getBoundingClientRect()).filter((r) => r.width > 2 && r.height > 20)
    const x0 = Math.min(...rects.map((r) => r.left)), x1 = Math.max(...rects.map((r) => r.right))
    const y1 = Math.max(...rects.map((r) => r.bottom)), y0 = Math.min(...rects.map((r) => r.top))
    let node = keys[0], best = null
    while (node && node !== document.body) {
      const r = node.getBoundingClientRect()
      if (r.width > (x1 - x0) * 0.9 && r.width < 1900 && r.height > y1 - y0) best = r
      node = node.parentElement
    }
    return best ? { x: best.left, y: best.top, w: best.width, h: best.height } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }, KEY_SELECTOR)
  let crop = null
  {
    const s = (1920 * TARGET_WIDTH_FRAC) / box.w
    let W = Math.round(1920 / s)
    if (W < 1920) {
      W = Math.min(W, 1920)
      const H = Math.round((W * 9) / 16)
      const sa = 1920 / W
      const cx = Math.round(box.x + box.w / 2 - W / 2)
      const cy = Math.round(box.y - TITLE_CLEAR_Y / sa)
      crop = {
        w: W,
        h: H,
        x: Math.max(0, Math.min(cx, 1920 - W)),
        y: Math.max(0, Math.min(cy, 1080 - H)),
      }
    }
  }
  console.log(`[${runId}] instrument ${Math.round(box.w)}x${Math.round(box.h)} -> crop ${crop ? `${crop.w}:${crop.h}:${crop.x}:${crop.y}` : 'none (already fills frame)'}`)
  if (box.w > 1920 || box.x < 0 || box.x + box.w > 1920) {
    console.warn(
      `[${runId}] WARN: instrument measures ${Math.round(box.w)}px wide in a 1920px viewport — its keybed ` +
        `overflows, so the box is unreliable and no crop is applied. This segment will NOT match the framing ` +
        `of well-formed runs. That is an honest capture of a broken layout; call it out rather than hand-cropping.`,
    )
  }

  // Start audio capture and note the offset so compose can align A/V.
  // Every await below is bounded in-page: a MediaRecorder that never fires
  // onstart/onstop would otherwise hang this script forever with no output.
  const started = await page.evaluate(
    () =>
      new Promise((res) => {
        let settled = false
        const done = (v) => { if (!settled) { settled = true; res(v) } }
        const s = (window.__captureStreams || [])[0]
        if (!s) return done('no-stream')
        if (!s.getAudioTracks || s.getAudioTracks().length === 0) return done('no-audio-track')
        window.__chunks = []
        let rec
        try {
          rec = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus' })
        } catch (e) {
          return done('threw:' + (e && e.name ? e.name : String(e)))
        }
        window.__rec = rec
        rec.ondataavailable = (e) => window.__chunks.push(e.data)
        rec.onerror = (e) => done('error:' + (e?.error?.name || 'unknown'))
        rec.onstart = () => done('started')
        try {
          rec.start(250)
        } catch (e) {
          return done('threw:' + (e && e.name ? e.name : String(e)))
        }
        // `onstart` does not reliably fire for MediaStreamDestination streams in
        // headless Chromium — one artifact reached state 'recording' yet never
        // dispatched the event, hanging the capture. The state is authoritative.
        const t0 = Date.now()
        const poll = () => {
          if (settled) return
          if (rec.state === 'recording') return done('started')
          if (Date.now() - t0 > 5000) return done('start-timeout:' + rec.state)
          setTimeout(poll, 50)
        }
        poll()
      }),
  )
  const tRec = Date.now()
  console.log(`[${runId}] recorder: ${started}, offset ${tRec - tPage}ms`)
  if (started !== 'started') {
    // A silent segment in a comparison video misrepresents the artifact, so stop
    // rather than quietly filming one.
    throw new Error(
      `[${runId}] audio capture did not start (${started}). Nothing reached the Web Audio destination, ` +
        `or the artifact produces no audio at all. Filming would yield a silent segment that reads as a ` +
        `recording failure rather than the artifact's real behaviour — investigate before filming.`,
    )
  }
  await sleep(600)

  // Perform.
  const noteMs = SONG.noteMs, gate = SONG.gateRatio ?? 0.82
  for (const phrase of SONG.phrases) {
    if (phrase.pedal) await page.keyboard.down('Space')
    for (let rep = 0; rep < (phrase.repeat ?? 1); rep++) {
      for (const chord of phrase.seq) {
        if (chord.length === 1) {
          const pt = await pointOf(chord[0])
          await page.mouse.move(pt.x, pt.y)
          await page.mouse.down()
          await sleep(noteMs * gate)
          await page.mouse.up()
        } else {
          await page.evaluate((ns) => {
            ns.forEach((n, i) => {
              const el = window.__keys.get(n), r = el.getBoundingClientRect()
              el.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true, pointerId: 20 + i, isPrimary: i === 0,
                pointerType: 'touch', button: 0, buttons: 1,
                clientX: r.x + r.width / 2, clientY: r.y + r.height * 0.8,
              }))
            })
          }, chord)
          await sleep(noteMs * gate)
          await page.evaluate((ns) => {
            ns.forEach((n, i) => {
              const el = window.__keys.get(n), r = el.getBoundingClientRect()
              el.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true, cancelable: true, pointerId: 20 + i, isPrimary: i === 0,
                pointerType: 'touch', button: 0, buttons: 0,
                clientX: r.x + r.width / 2, clientY: r.y + r.height * 0.8,
              }))
            })
          }, chord)
        }
        await sleep(noteMs * (1 - gate))
      }
    }
    if (phrase.pedal) await page.keyboard.up('Space')
  }

  // Final chord via independent pointer ids (true simultaneity, not a fast roll).
  if (SONG.finalChord) {
    const notes = SONG.finalChord.notes
    await page.keyboard.down('Space')
    await page.evaluate((ns) => {
      ns.forEach((n, i) => {
        const el = window.__keys.get(n), r = el.getBoundingClientRect()
        el.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerId: 10 + i, isPrimary: i === 0,
          pointerType: 'touch', button: 0, buttons: 1,
          clientX: r.x + r.width / 2, clientY: r.y + r.height * 0.8,
        }))
      })
    }, notes)
    await sleep(SONG.finalChord.holdMs ?? 2400)
    await page.evaluate((ns) => {
      ns.forEach((n, i) => {
        const el = window.__keys.get(n), r = el.getBoundingClientRect()
        el.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, pointerId: 10 + i, isPrimary: i === 0,
          pointerType: 'touch', button: 0, buttons: 0,
          clientX: r.x + r.width / 2, clientY: r.y + r.height * 0.8,
        }))
      })
    }, notes)
    await page.keyboard.up('Space')
  }
  await sleep(1200)

  const b64 = await page.evaluate(
    () =>
      new Promise((res) => {
        const t = setTimeout(() => res(''), 8000) // never hang on a stuck flush
        try {
          window.__rec.onstop = () => {
            clearTimeout(t)
            const blob = new Blob(window.__chunks, { type: 'audio/webm' })
            const fr = new FileReader()
            fr.onload = () => res(String(fr.result).split(',')[1] || '')
            fr.onerror = () => res('')
            fr.readAsDataURL(blob)
          }
          window.__rec.stop()
        } catch (e) {
          clearTimeout(t)
          res('')
        }
      }),
  )
  const audioBytes = Buffer.from(b64, 'base64')
  writeFileSync(join(OUT, `${slug}.audio.webm`), audioBytes)
  writeFileSync(
    join(OUT, `${slug}.meta.json`),
    JSON.stringify({ runId, slug, phase: PHASE, song: SONG.id, title, metrics, offsetMs: tRec - tPage, crop, instrument: box, segmentSeconds: SONG.segmentSeconds }, null, 2) + '\n',
  )

  const video = page.video()
  await ctx.close()
  renameSync(await video.path(), join(OUT, `${slug}.webm`))
  console.log(`[${runId}] saved ${slug}.webm (audio ${audioBytes.length} bytes)`)
  summary.push({ runId, slug, audioBytes: audioBytes.length })
}

await browser.close()
console.log('\nrecorded:', summary.map((s) => `${s.slug}${s.audioBytes < 5000 ? ' (SILENT?)' : ''}`).join(', '))
