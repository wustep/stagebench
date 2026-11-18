// @vitest-environment node
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sectionBands, variant } from './model'
import { panelControls } from './panels'

let browser: Browser
const url = 'https://stage4.test/'
const files = new Map<string, string | Buffer>()
const contentTypes: Record<string, string> = {
  html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png',
}

beforeAll(async () => {
  const result = await build({ build: { write: false }, logLevel: 'silent' })
  for (const output of Array.isArray(result) ? result : [result]) {
    if (!('output' in output)) throw new Error('Expected a Vite bundle')
    for (const file of output.output) {
      const content = file.type === 'chunk' ? file.code : file.source
      files.set(file.fileName, typeof content === 'string' ? content : Buffer.from(content))
    }
  }
  browser = await chromium.launch({ args: ['--mute-audio'] })
}, 25000)

afterAll(async () => {
  await browser?.close()
})

async function newPage(options: Parameters<Browser['newPage']>[0]) {
  const page = await browser.newPage(options)
  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url()
    if (!requestUrl.startsWith(url)) return route.abort()
    const file = requestUrl.slice(url.length) || 'index.html'
    const body = files.get(file)
    if (body !== undefined) {
      return route.fulfill({ body, contentType: contentTypes[file.split('.').at(-1) ?? ''] })
    }
    if (/^samples\/(upright|grand|electric)\/\d+-(soft|firm|v\d+|single)\.ogg$/.test(file)) {
      return route.fulfill({ path: `public/${file}`, contentType: 'audio/ogg' })
    }
    return route.fulfill({ status: 404 })
  })
  return page
}

async function bounds(page: Page) {
  return page.evaluate(() => {
    function rect(selector: string) {
      const box = document.querySelector(selector)!.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
    }
    return {
      instrument: rect('#instrument'),
      deck: rect('.control-deck'),
      controlArea: rect('.deck-sections'),
      keybed: rect('.keybed'),
      whiteKey: rect('.piano-key--white'),
      blackKey: rect('.piano-key--black'),
      sections: Array.from(document.querySelectorAll('.deck-section'), (section) => ({
        id: section.id, width: section.getBoundingClientRect().width,
      })),
      viewport: [innerWidth, innerHeight],
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    }
  })
}

describe('built instrument in Chromium', () => {
  it('fits the desktop with the measured chassis, ordered bands, and the exact keybed', async () => {
    const page = await newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await page.goto(url)
      await page.locator('.piano-key').first().waitFor()
      const layout = await bounds(page)
      expect(layout.document).toEqual(layout.viewport)
      expect(layout.instrument.width / 1440).toBeGreaterThanOrEqual(0.88)
      expect(layout.instrument.width / 1440).toBeLessThanOrEqual(0.97)
      expect(layout.instrument.width / layout.instrument.height).toBeCloseTo(variant.aspect, 3)
      expect(layout.deck.height / layout.instrument.height).toBeCloseTo(0.54, 3)
      expect(layout.keybed.height / layout.instrument.height).toBeCloseTo(0.46, 3)
      expect(layout.deck.bottom).toBeCloseTo(layout.keybed.y, 2)
      expect(layout.keybed.bottom).toBeCloseTo(layout.instrument.bottom, 1)
      expect(layout.blackKey.height / layout.whiteKey.height).toBeCloseTo(0.61, 2)
      expect(layout.sections.map(({ id }) => id)).toEqual(sectionBands.map(({ id }) => id))
      for (const [index, item] of layout.sections.entries()) {
        expect(item.width / layout.controlArea.width).toBeCloseTo(sectionBands[index].fraction, 3)
      }
      expect(await page.locator('.piano-key--white').count()).toBe(43)
      expect(await page.locator('.piano-key--black').count()).toBe(30)
      const pattern = await page.locator('.piano-key').evaluateAll((items) =>
        items.map((item) => [Number(item.getAttribute('data-note')), item.classList.contains('piano-key--black')]))
      expect(pattern).toEqual(Array.from({ length: 73 }, (_, index) => {
        const note = index + 28
        return [note, [1, 3, 6, 8, 10].includes(note % 12)]
      }))
      expect(await page.locator('#key-28').getAttribute('aria-label')).toBe('E1')
      expect(await page.locator('#key-100').getAttribute('aria-label')).toBe('E7')
      expect(await page.locator('.studio > h1, .studio > header').count()).toBe(0)
    } finally {
      await page.close()
    }
  })

  it('keeps all controls reachable, with two OLEDs and keyboard-visible focus', async () => {
    const page = await newPage({ viewport: { width: 1440, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    try {
      await page.goto(url)
      await page.locator('[data-audio-state="ready"]').waitFor()
      const controls = await page.locator('[data-control-id]').evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect()
          const reachable = [0.2, 0.5, 0.8].some((x) => [0.2, 0.5, 0.8].some((y) => {
            const target = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)
            return element.contains(target)
          }))
          return {
            id: element.id, name: element.getAttribute('aria-label'), reachable,
            tabIndex: (element as HTMLElement).tabIndex,
            kind: element.getAttribute('data-control-kind'),
          }
        }))
      expect(new Set(controls.map(({ id }) => id)).size).toBe(panelControls.length + 73)
      expect(controls.filter((control) => !control.name || !control.reachable || control.tabIndex !== 0)).toEqual([])
      expect(controls.filter(({ kind }) => kind === 'drawbar')).toHaveLength(9)
      expect(await page.locator('[data-display]').evaluateAll((items) =>
        items.map((item) => item.closest('[data-section]')?.id))).toEqual(['program', 'synth'])
      for (const id of ['master-level', 'organ-model', 'piano-type', 'program-dial', 'synth-mode', 'effects-delay-on']) {
        expect(controls.some((control) => control.id === id)).toBe(true)
      }

      await page.keyboard.press('Tab')
      const master = page.getByRole('slider', { name: 'Master Level' })
      expect(await master.evaluate((element) => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none')).toBe(true)
      await page.keyboard.press('ArrowRight')
      expect(await master.getAttribute('aria-valuenow')).toBe('4')
      const dial = await master.boundingBox()
      if (!dial) throw new Error('Missing master knob')
      await page.mouse.move(dial.x + dial.width / 2, dial.y + dial.height / 2)
      await page.mouse.down()
      await page.mouse.move(dial.x + dial.width / 2, dial.y - 24, { steps: 4 })
      await page.mouse.up()
      expect(Number(await master.getAttribute('aria-valuenow'))).toBeGreaterThan(4)

      const slot = page.getByRole('button', { name: 'Program 2' })
      await slot.focus()
      await page.keyboard.press('Space')
      expect(await slot.getAttribute('aria-pressed')).toBe('true')

      const note = page.getByRole('button', { name: 'E7' })
      await note.hover()
      await page.mouse.down()
      await expect.poll(() => note.getAttribute('data-held')).toBe('true')
      await page.mouse.up()
      await expect.poll(() => note.getAttribute('data-held')).toBe('false')
      expect(errors).toEqual([])
    } finally {
      await page.close()
    }
  })

  it('fits the complete instrument on mobile and provides a scrollable detail view', async () => {
    const page = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    try {
      await page.goto(url)
      await page.locator('.piano-key').first().waitFor()
      const layout = await bounds(page)
      expect(layout.document).toEqual(layout.viewport)
      expect(layout.instrument.x).toBeGreaterThanOrEqual(0)
      expect(layout.instrument.right).toBeLessThanOrEqual(390)
      expect(layout.instrument.bottom).toBeLessThanOrEqual(844)
      expect(await page.locator('.piano-key').count()).toBe(73)
      await page.getByRole('button', { name: 'Inspect controls' }).tap()
      const scroller = page.locator('.instrument-view')
      expect(await scroller.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(900)
      const highKey = page.getByRole('button', { name: 'E7' })
      await highKey.scrollIntoViewIfNeeded()
      expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(900)
      const high = await highKey.boundingBox()
      expect(high?.x).toBeGreaterThan(0)
      expect((high?.x ?? 390) + (high?.width ?? 1)).toBeLessThan(390)
      await page.getByRole('button', { name: 'Fit instrument' }).tap()
      expect((await bounds(page)).document).toEqual(layout.viewport)
    } finally {
      await page.close()
    }
  })

  it('plays audible Web MIDI after the first page click and releases on pedal up', async () => {
    const page = await newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await page.addInitScript(() => {
        const input = Object.assign(new EventTarget(), { id: 'test-input', state: 'connected' })
        const access = Object.assign(new EventTarget(), { inputs: new Map([[input.id, input]]) })
        Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access })
        document.addEventListener('test-midi', (event) => {
          const data = (event as CustomEvent<number[]>).detail
          input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(data) }))
        })

        let probe: AnalyserNode | undefined
        const originalConnect = AudioNode.prototype.connect
        AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...channels: number[]) {
          if (destination === this.context.destination && this.context instanceof AudioContext) {
            probe = this.context.createAnalyser()
            Reflect.apply(originalConnect, this, [probe])
            return Reflect.apply(originalConnect, probe, [destination])
          }
          return Reflect.apply(originalConnect, this, [destination, ...channels])
        } as typeof originalConnect
        Object.assign(window, {
          pianoSignal() {
            if (!probe) return 0
            const samples = new Float32Array(probe.fftSize)
            probe.getFloatTimeDomainData(samples)
            return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
          },
        })
      })
      await page.goto(url)
      await page.locator('[data-audio-state="ready"]').waitFor()
      await page.locator('[data-midi-state="connected"]').waitFor()
      await page.mouse.click(5, 5)
      const message = (data: number[]) => page.evaluate((detail) => {
        document.dispatchEvent(new CustomEvent('test-midi', { detail }))
      }, data)
      const signal = () => page.evaluate(() => (
        window as Window & { pianoSignal?: () => number }
      ).pianoSignal?.() ?? 0)
      const note = page.getByRole('button', { name: 'C4' })
      await message([0xb0, 64, 127])
      await message([0x90, 60, 110])
      await expect.poll(() => note.getAttribute('data-held')).toBe('true')
      await expect.poll(signal).toBeGreaterThan(0.005)
      await message([0x80, 60, 0])
      await expect.poll(() => note.getAttribute('data-sustained')).toBe('true')
      expect(await signal()).toBeGreaterThan(0.001)
      await message([0xb0, 64, 0])
      await expect.poll(() => note.getAttribute('data-sustained')).toBe('false')
      await expect.poll(signal).toBeLessThan(0.00001)
    } finally {
      await page.close()
    }
  })
})

interface PhaseTwoProbe {
  contexts: number
  destinations: number
  signal(): number
  midi(bytes: number[]): void
}

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const input = Object.assign(new EventTarget(), { id: 'phase-two-input', state: 'connected' })
    const access = Object.assign(new EventTarget(), { inputs: new Map([[input.id, input]]) })
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access })

    const NativeAudio = AudioContext
    const NativeOffline = OfflineAudioContext
    let probe: AnalyserNode | undefined
    const state: PhaseTwoProbe = {
      contexts: 0,
      destinations: 0,
      signal() {
        if (!probe) return 0
        const buffer = new Float32Array(probe.fftSize)
        probe.getFloatTimeDomainData(buffer)
        return Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length)
      },
      midi(bytes) {
        input.dispatchEvent(Object.assign(new Event('midimessage'), { data: Uint8Array.from(bytes) }))
      },
    }
    Object.assign(window, {
      AudioContext: class extends NativeAudio {
        constructor(options?: AudioContextOptions) {
          super(options)
          state.contexts++
        }
      },
      OfflineAudioContext: class extends NativeOffline {
        constructor(options: OfflineAudioContextOptions) {
          super(options)
          state.contexts++
        }
      },
      phaseTwoProbe: state,
    })

    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...channels: number[]) {
      if (destination === this.context.destination && this.context instanceof NativeAudio) {
        state.destinations++
        probe = this.context.createAnalyser()
        Reflect.apply(connect, this, [probe])
        return Reflect.apply(connect, probe, [destination])
      }
      return Reflect.apply(connect, this, [destination, ...channels])
    } as typeof connect
  })
  const midi = (bytes: number[]) => page.evaluate((data) => (
    window as Window & { phaseTwoProbe?: PhaseTwoProbe }
  ).phaseTwoProbe!.midi(data), bytes)
  const signal = () => page.evaluate(() => (window as Window & { phaseTwoProbe?: PhaseTwoProbe }).phaseTwoProbe!.signal())
  return { midi, signal }
}

describe('Phase 2 controls in Chromium', () => {
  it('loads every recorded model offline, follows Piano layer focus and keeps one master output', async () => {
    const page = await newPage({ viewport: { width: 1440, height: 900 } })
    try {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      const { midi, signal } = await observeAudio(page)
      await page.goto(url)
      const status = page.locator('[data-audio-state="ready"]')
      await status.waitFor()
      await page.locator('[data-midi-state="connected"]').waitFor()
      await page.mouse.click(5, 5)
      const models = ['Rhodes Mark I', 'Clavinet', 'FM Stage Piano', 'Rosewood Marimba', 'Salamander C5', 'Upright Piano KW']
      for (const model of models) {
        await page.locator('#piano-type').click()
        await expect.poll(() => status.textContent(), { timeout: 10000 }).toContain(model)
        expect(await page.locator('[data-piano-model]').getAttribute('data-piano-model')).toBe(model)
        await midi([0x90, 60, 109])
        await expect.poll(signal).toBeGreaterThan(0.003)
        await midi([0x80, 60, 0])
        await expect.poll(signal).toBeLessThan(0.00001)
      }

      await page.locator('#piano-layer-b-on').click()
      expect(await page.locator('[data-piano-layer]').getAttribute('data-piano-layer')).toBe('B')
      expect(await page.locator('#effects-focus-piano').getAttribute('aria-description')).toBe('Piano B')
      await page.locator('#piano-octave-up').click()
      await page.locator('#piano-sustped').click()
      await page.locator('#piano-layer-a-focus').click()
      expect(await page.locator('#effects-focus-piano').getAttribute('aria-description')).toBe('Piano A')
      await page.locator('#effects-focus-piano').click({ modifiers: ['Shift'] })
      expect(await page.locator('#effects-focus-piano').getAttribute('aria-description')).toBe('Piano group')
      await page.locator('#effects-delay-on').click({ modifiers: ['Shift'] })
      expect(await page.locator('#effects-delay-on').getAttribute('aria-description')).toBe('Global on')
      await page.locator('#effects-delay-mix').press('End')
      await midi([0x90, 64, 110])
      await page.waitForTimeout(155)
      expect(await signal()).toBeLessThan(0.00001)
      await midi([0x80, 64, 0])
      await expect.poll(signal, { interval: 30 }).toBeGreaterThan(0.0005)
      await page.locator('#effects-section-on').click()
      await expect.poll(signal).toBeLessThan(0.00001)

      const pedal = page.getByRole('button', { name: 'Sustain pedal', exact: true })
      await pedal.click()
      await midi([0x90, 69, 113])
      await expect.poll(signal).toBeGreaterThan(0.004)
      await midi([0x80, 69, 0])
      expect(await page.locator('#key-69').getAttribute('data-sustained')).toBe('true')
      await pedal.click()
      await expect.poll(signal).toBeLessThan(0.00001)

      const master = page.locator('#master-level')
      await master.press('Home')
      await midi([0x90, 60, 110])
      await expect.poll(signal).toBeLessThan(0.00001)
      await master.press('End')
      await expect.poll(signal).toBeGreaterThan(0.012)
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await expect.poll(signal).toBeLessThan(0.00001)
      const graph = await page.evaluate(() => {
        const { contexts, destinations } = (window as Window & { phaseTwoProbe?: PhaseTwoProbe }).phaseTwoProbe!
        return { contexts, destinations }
      })
      expect(graph).toEqual({ contexts: 1, destinations: 1 })
      expect(errors).toEqual([])
    } finally {
      await page.close()
    }
  }, 30000)

  it('shows the failed model on the panel and sounds the fallback after a sample fails', async () => {
    const page = await newPage({ viewport: { width: 1440, height: 900 } })
    try {
      const { midi, signal } = await observeAudio(page)
      await page.route('**/samples/electric/29-single.ogg', (route) => route.fulfill({ status: 404 }))
      await page.goto(url)
      await page.locator('[data-audio-state="ready"]').waitFor()
      await page.locator('[data-midi-state="connected"]').waitFor()
      await page.locator('#piano-type').click()
      await page.locator('[data-audio-state="fallback"]').waitFor()
      expect(await page.locator('#program-oled [data-piano-status]').textContent()).toContain('Synth fallback')
      expect(await page.locator('.legend-lamp--failed').count()).toBe(1)
      await midi([0x90, 60, 110])
      await expect.poll(signal).toBeGreaterThan(0.008)
      await midi([0x80, 60, 0])
      await expect.poll(signal).toBeLessThan(0.00001)
      await page.locator('#piano-layer-b-focus').click()
      await page.locator('[data-audio-state="ready"]').waitFor()
      expect(await page.locator('[data-piano-model]').getAttribute('data-piano-model')).toBe('Upright Piano KW')
    } finally {
      await page.close()
    }
  })
})
