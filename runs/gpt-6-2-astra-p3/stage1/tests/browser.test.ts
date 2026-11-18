// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { controls } from '../src/hardware'

let browser: Browser, server: ViteDevServer, url: string, page: Page
let errors: string[]
beforeAll(async () => {
  server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  })
  await server.listen()
  url = server.resolvedUrls!.local[0]
  browser = await chromium.launch({ headless: true })
})
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(url)
  await page.getByText(/Piano ready/).waitFor()
})
afterEach(async () => {
  await page.close()
  expect(errors).toEqual([])
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
})

it('fits the complete chassis at both viewports with an inspectable mobile zoom', async () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    const instrument = (await page.locator('#instrument').boundingBox())!
    expect(instrument.width / instrument.height).toBeCloseTo(3.0951, 2)
    expect(instrument.width / viewport.width).toBeGreaterThanOrEqual(0.88)
    expect(instrument.width / viewport.width).toBeLessThanOrEqual(0.97)
    expect(instrument.x).toBeGreaterThan(0)
    expect(instrument.x + instrument.width).toBeLessThan(viewport.width)
    expect(instrument.y + instrument.height).toBeLessThan(viewport.height)
    const keybed = (await page.locator('#keybed').boundingBox())!
    expect((keybed.y - instrument.y) / instrument.height).toBeCloseTo(0.54, 1)
    expect(await page.locator('[data-note]').count()).toBe(73)
    expect(
      await page
        .locator('#control-deck [id$="-oled"]')
        .evaluateAll((els) => els.map((e) => e.id)),
    ).toEqual(['program-oled', 'synth-oled'])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width)
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(viewport.height)
  }
  await page.getByRole('button', { name: 'Zoom in' }).click()
  expect(
    await page
      .locator('.viewport')
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
})
it('gives every physical input an exposed hit area, name, keyboard value and focus indication', async () => {
  const unreachable = await page.locator('.physical').evaluateAll((nodes) =>
    nodes
      .filter((el) => {
        const box = el.querySelector('.hit')!.getBoundingClientRect()
        return !el.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        )
      })
      .map((el) => el.id),
  )
  expect(unreachable).toEqual([])
  const nameBefore = await page.locator('#program-oled').textContent()
  for (const c of controls) {
    const el = page.locator('#' + c.id)
    expect(await el.getAttribute('aria-label')).toBe(c.section + ' ' + c.name)
    await el.focus()
    await page.keyboard.press(c.kind === 'button' ? 'Enter' : 'End')
    expect(
      await el.getAttribute(
        c.kind === 'button' ? 'aria-pressed' : 'aria-valuenow',
      ),
    ).toBe(c.kind === 'button' ? 'true' : '100')
  }
  await page.keyboard.press('Tab')
  expect(await page.locator(':focus-visible').count()).toBe(1)
  expect(await page.locator('#program-oled').textContent()).toBe(nameBefore)
  expect(await page.locator('#keybed [aria-pressed=true]').count()).toBe(0)
}, 30000)
it('handles actual pointer drags, independent touches, cancel, sustain and blur', async () => {
  const master = page.locator('#performance-master-level'),
    box = (await master.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 13)
  await page.mouse.up()
  expect(Number(await master.getAttribute('aria-valuenow'))).toBeLessThan(81)
  const cdp = await page.context().newCDPSession(page)
  const keys = page.locator('#key-60,#key-64')
  const points = await keys.evaluateAll((els) =>
    els.map((el, i) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.bottom - 15, id: i + 1 }
    }),
  )
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points,
  })
  expect(await page.locator('#keybed [aria-pressed=true]').count()).toBe(2)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [points[1]],
  })
  expect(await page.locator('#keybed [aria-pressed=true]').count()).toBe(1)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  })
  expect(await page.locator('#keybed [aria-pressed=true]').count()).toBe(0)
  await page.keyboard.down('a')
  expect(await page.locator('#key-60').getAttribute('aria-pressed')).toBe(
    'true',
  )
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  expect(await page.locator('#keybed [aria-pressed=true]').count()).toBe(0)
  const pedal = page.getByRole('button', { name: 'Sustain', exact: true })
  await pedal.click()
  expect(await pedal.getAttribute('aria-pressed')).toBe('true')
  await pedal.click()
  expect(await pedal.getAttribute('aria-pressed')).toBe('false')
})
it('renders the recorded grand through its actual graph with dynamics, release and sustained tails', async () => {
  await page.addScriptTag({
    type: 'module',
    content:
      "import * as library from '/src/piano.ts'; window.pianoLibrary = library",
  })
  await page.waitForFunction(() => 'pianoLibrary' in window)
  const result = await page.evaluate(async () => {
    const { Grand, Piano } = (
      window as unknown as { pianoLibrary: typeof import('../src/piano') }
    ).pianoLibrary
    async function render(velocity: number, pedal: boolean, fail = false) {
      const rate = 32000,
        ctx = new OfflineAudioContext(2, rate, rate)
      const states: string[] = []
      const grand = new Grand((s: string) => states.push(s), {
        context: () => ctx as unknown as AudioContext,
        load: async (path: string) => {
          if (fail) throw Error('Test decode unavailable')
          return (await fetch(path)).arrayBuffer()
        },
      })
      await grand.load()
      const piano = new Piano(grand, () => {})
      piano.on('test', 69, velocity)
      piano.pedal('global', pedal)
      const atRelease = ctx.suspend(0.17),
        atLift = ctx.suspend(0.65)
      const rendering = ctx.startRendering()
      await atRelease
      piano.off('test')
      void ctx.resume()
      await atLift
      piano.pedal('global', false)
      void ctx.resume()
      const result = await rendering
      await new Promise((r) => setTimeout(r, 10))
      const data = result.getChannelData(0)
      function rms(from: number, to: number) {
        const segment = data.subarray(from * rate, to * rate)
        return Math.sqrt(
          segment.reduce((s: number, v: number) => s + v * v, 0) /
            segment.length,
        )
      }
      return {
        attack: rms(0.015, 0.12),
        tail: rms(0.4, 0.55),
        after: rms(0.9, 0.98),
        count: piano.count,
        states,
      }
    }
    return {
      soft: await render(30, false),
      hard: await render(110, false),
      held: await render(110, true),
      fallback: await render(95, false, true),
    }
  })
  expect(result.soft.attack).toBeGreaterThan(0.00005)
  expect(result.hard.attack).toBeGreaterThan(result.soft.attack * 2)
  expect(result.hard.tail).toBeLessThan(0.00002)
  expect(result.held.tail).toBeGreaterThan(0.001)
  expect(result.held.after).toBeLessThan(0.00002)
  expect(result.fallback.states.some((s) => s.includes('Sample error'))).toBe(
    true,
  )
  expect(result.fallback.attack).toBeGreaterThan(0.005)
  for (const run of Object.values(result)) expect(run.count).toBe(0)
}, 30000)

it('sounds through Web MIDI after one page click and releases the signal on disconnect', async () => {
  await page.addInitScript(() => {
    const port = {
      id: 'piano',
      state: 'connected',
      onmidimessage: null as null | ((e: { data: number[] }) => void),
    }
    const access = {
      inputs: new Map([[port.id, port]]),
      onstatechange: null as null | (() => void),
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => access,
    })
    let analyser: AnalyserNode
    class TappedContext extends AudioContext {
      createGain() {
        const gain = super.createGain()
        if (!analyser) {
          analyser = this.createAnalyser()
          gain.connect(analyser)
        }
        return gain
      }
    }
    window.AudioContext = TappedContext
    Object.assign(window, {
      playMidi: (messages: number[][]) =>
        messages.forEach((data) => port.onmidimessage?.({ data })),
      disconnectMidi: () => {
        port.state = 'disconnected'
        access.onstatechange?.()
      },
      peak: () => {
        const samples = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(samples)
        return samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
      },
    })
  })
  await page.reload()
  await page.getByText('1 input connected').waitFor()
  await page.getByText(/Piano ready/).waitFor()
  await page.mouse.click(3, 3)
  const notes = [36, 43, 48, 52, 55, 60, 64, 67, 71, 76]
  await page.evaluate(
    (notes) =>
      (window as unknown as { playMidi: (m: number[][]) => void }).playMidi(
        notes.map((n) => [0x90, n, 120]),
      ),
    notes,
  )
  await expect
    .poll(() => page.locator('#keybed [aria-pressed=true]').count())
    .toBe(10)
  await page.waitForFunction(
    () => (window as unknown as { peak: () => number }).peak() > 0.01,
  )
  expect(
    await page.evaluate(() =>
      (window as unknown as { peak: () => number }).peak(),
    ),
  ).toBeLessThan(1)
  await page.evaluate(() =>
    (window as unknown as { disconnectMidi: () => void }).disconnectMidi(),
  )
  await page.getByText('Disconnected', { exact: true }).waitFor()
  expect(await page.locator('#keybed [aria-pressed=true]').count()).toBe(0)
  await page.waitForFunction(
    () => (window as unknown as { peak: () => number }).peak() < 0.00001,
  )
})
