// @vitest-environment node
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { beforeAll, afterAll, it, expect } from 'vitest'
let server: ViteDevServer, browser: Browser, p: Page
beforeAll(async () => {
  server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  })
  await server.listen()
  browser = await chromium.launch()
  p = await browser.newPage()
  p.setDefaultTimeout(4000)
  await p.goto(server.resolvedUrls!.local[0])
  await p.addScriptTag({
    type: 'module',
    content:
      "import {renderStage} from '/tests/stage-audio.ts';window.stageAudio=renderStage",
  })
  await p.waitForFunction(() => 'stageAudio' in window)
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
})
declare global {
  interface Window {
    stageAudio: typeof import('./stage-audio').renderStage
  }
}
it('renders both new sections through their effect lanes, split and morph gains, shared rotary and single master', async () => {
  for (const part of ['organ', 'synth'] as const) {
    const render = (v: string) =>
      p.evaluate(
        ([part, v]) => window.stageAudio(part as 'organ' | 'synth', v),
        [part, v],
      )
    const base = await render('base')
    expect(base.level, part).toBeGreaterThan(0.005)
    expect(base.tail).toBeLessThan(1e-5)
    expect(base.contexts).toBe(1)
    for (const v of ['scene', 'zone', 'level', 'master', 'morph'])
      expect((await render(v)).level, v).toBeLessThan(1e-6)
    expect((await render('crossfade')).level / base.level).toBeCloseTo(0.5, 1)
    for (const v of ['second', ...(part === 'synth' ? ['third'] : [])])
      expect((await render(v)).level).toBeGreaterThan(0.002)
    expect((await render('fx')).signature).not.toEqual(base.signature)
    if (part === 'organ')
      expect((await render('rotary')).signature).not.toEqual(
        (await render('fast')).signature,
      )
  }
}, 30000)
it('plays factory organ and synth, edits scenes and morphs, auditions Store As, recalls Live edits and panics from the panel', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.addInitScript(() => {
    const port = {
      id: 'performance',
      state: 'connected',
      onmidimessage: null as null | ((e: { data: number[] }) => void),
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => ({ inputs: new Map([[port.id, port]]) }),
    })
    let meter: AnalyserNode
    class Measured extends AudioContext {
      createGain() {
        const gain = super.createGain()
        if (!meter) {
          meter = this.createAnalyser()
          gain.connect(meter)
        }
        return gain
      }
    }
    window.AudioContext = Measured
    Object.assign(window, {
      send: (data: number[]) => port.onmidimessage?.({ data }),
      energy: () => {
        const data = new Float32Array(meter.fftSize)
        meter.getFloatTimeDomainData(data)
        return data.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
      },
    })
  })
  const ctrl = (id: string) => page.locator('#' + id)
  const click = (id: string) => ctrl(id).click()
  const text = () => ctrl('program-oled').textContent()
  try {
    await page.goto(server.resolvedUrls!.local[0])
    await page.getByText(/Piano ready/).waitFor()
    await click('program-program-2')
    expect(await text()).toContain('Sunday Drawbars')
    await page.keyboard.down('a')
    await page.waitForFunction(() => window.energy() > 0.005)
    await page.keyboard.up('a')
    await click('program-layer-scene')
    expect(await text()).toContain('SCENE II')
    await click('program-layer-scene')
    await click('program-morph-ctrlped')
    await ctrl('organ-layer-a-level').press('Home')
    await click('program-morph-ctrlped')
    expect(await ctrl('organ-layer-a-level').getAttribute('data-morph')).toBe(
      'true',
    )
    await page.evaluate(() => window.send([0xb0, 11, 127]))
    await expect
      .poll(() => ctrl('organ-layer-a-level').getAttribute('aria-valuenow'))
      .toBe('0')
    await ctrl('program-morph-ctrlped').click({ modifiers: ['Shift'] })
    expect(
      await ctrl('organ-layer-a-level').getAttribute('data-morph'),
    ).toBeNull()
    await ctrl('program-split').click({ modifiers: ['Shift'] })
    await page.getByLabel('Split enabled').check()
    await page.getByLabel('Crossfade').nth(1).selectOption('12')
    await page.getByLabel('Organ A zone range').selectOption('0-0')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    expect(await page.getByLabel('Split at C4').count()).toBe(1)
    await ctrl('program-store').click({ modifiers: ['Shift'] })
    await page.getByLabel('Program name').fill('Evening registers')
    await page.getByRole('button', { name: 'Choose destination' }).click()
    await click('program-page-next')
    await click('program-program-8')
    await click('program-store')
    expect(await text()).toContain('2.8')
    expect(await text()).toContain('Evening registers')
    await click('program-page-previous')
    await click('program-program-3')
    expect(await text()).toContain('Copper Lead')
    await page.keyboard.down('a')
    await page.waitForFunction(() => window.energy() > 0.005)
    await ctrl('program-transpose').click({ modifiers: ['Shift'] })
    expect(await ctrl('key-60').getAttribute('aria-pressed')).toBe('false')
    await page.waitForFunction(() => window.energy() < 0.00001)
    await page.keyboard.up('a')
    await click('program-prog-view')
    await page.getByRole('button', { name: '2.8 Evening registers' }).click()
    expect(await ctrl('program-split').getAttribute('aria-pressed')).toBe(
      'true',
    )
    await click('program-live-mode')
    await click('program-program-5')
    await ctrl('synth-layer-c-level').press('End')
    await page.reload()
    await page.getByText(/Piano ready/).waitFor()
    expect(await text()).toContain('LIVE 5')
    expect(
      await ctrl('synth-layer-c-level').getAttribute('aria-valuenow'),
    ).toBe('100')
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
}, 30000)
declare global {
  interface Window {
    send: (data: number[]) => void
    energy: () => number
  }
}

it('edits tempo, transpose and synth envelope pages with hardware dials and cancels a pending store', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(server.resolvedUrls!.local[0])
    await page.getByText(/Piano ready/).waitFor()
    const dial = page.locator('#program-program-dial')
    await dial.press('ArrowUp')
    expect(await page.locator('#program-oled').textContent()).toContain(
      'Sunday Drawbars',
    )
    await page.locator('#program-master-clock').click()
    await dial.press('End')
    expect(await dial.getAttribute('aria-valuetext')).toBe('300 BPM')
    await dial.press('ArrowDown')
    expect(await dial.getAttribute('aria-valuetext')).toBe('299 BPM')
    await page.locator('#program-transpose').click()
    await dial.press('Home')
    expect(await dial.getAttribute('aria-valuetext')).toBe('-6 st')
    await page.locator('#synth-amp-envelope').click()
    await page.locator('#synth-waveform-list').press('End')
    expect(await page.locator('#synth-oled').textContent()).toContain('100')
    await page.locator('#program-store').click()
    await page.locator('#program-program-3').click()
    await page.locator('#program-shift').click()
    expect(await page.locator('#program-oled').textContent()).toContain(
      'Sunday Drawbars',
    )
    expect(
      await page
        .locator('#program-master-clock')
        .getAttribute('aria-description'),
    ).toBe('299 BPM')
  } finally {
    await page.close()
  }
})
