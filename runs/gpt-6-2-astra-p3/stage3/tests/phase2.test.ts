// @vitest-environment node
import { afterAll, beforeAll, it, expect } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import {
  defaults,
  groupMode,
  globalMode,
  editEffect,
  focus,
} from '../src/settings'
import { tap } from '../src/bindings'
let server: ViteDevServer, browser: Browser, page: Page
beforeAll(async () => {
  server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  })
  await server.listen()
  browser = await chromium.launch()
  page = await browser.newPage()
  await page.goto(server.resolvedUrls!.local[0])
  await page.addScriptTag({
    type: 'module',
    content:
      "import * as render from '/tests/render.ts';window.render = render",
  })
  await page.waitForFunction(() => 'render' in window)
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
})
declare global {
  interface Window {
    render: typeof import('./render')
  }
}
it('distinguishes every physical processor type from dry and its neighbours in stereo', async () => {
  const scores = await page.evaluate(() => window.render.processors())
  for (const [type, v] of Object.entries(scores)) {
    if (type.endsWith('error')) expect(v, type).toBeLessThan(0.00001)
    else expect(v, type).toBeGreaterThan(0.0001)
  }
})
it('moves the signal with rate, depth, tempo, feedback, sync, EQ, drive, dynamics and reverb tone', async () => {
  for (const [i, v] of (
    await page.evaluate(() => window.render.parameters())
  ).entries())
    expect(v, 'parameter ' + i).toBeGreaterThan(0.00001)
})
it('filters echoes progressively on feedback only', async () => {
  const { off, ratios } = await page.evaluate(() => window.render.echoes())
  expect(Math.min(...off)).toBeGreaterThan(0.00001)
  expect(ratios[0]).toBeCloseTo(1, 2)
  expect(ratios[1]).toBeLessThan(0.5)
  expect(ratios[2]).toBeLessThan(ratios[1])
})
it('keeps independent lanes through rotary, group and global processing, faders and the master', async () => {
  const r = await page.evaluate(() => window.render.routing())
  for (const k of ['laneA', 'group', 'global', 'speed', 'drive'] as const)
    expect(r[k], k).toBeGreaterThan(0.0001)
  for (const k of ['master', 'fader', 'laneB', 'allBypass'] as const)
    expect(r[k], k).toBeLessThan(0.00001)
})
it('routes layer editing, remembers targeting and quantizes tap to clock divisions', () => {
  const s = defaults()
  focus(s, 1)
  expect(s.fxFocus).toBe(1)
  editEffect(s, 'mod1', { rate: 88 })
  expect(s.layers[0].fx.mod1.rate).toBe(40)
  groupMode(s)
  expect(s.layers[0].fx.mod1.rate).toBe(88)
  groupMode(s)
  globalMode(s, 'delay')
  editEffect(s, 'delay', { sync: true })
  tap(s, 0.5)
  expect(s.layers[0].fx.delay).toEqual(s.layers[1].fx.delay)
  expect(Math.round(s.layers[0].fx.delay.rate * 0.06)).toBe(2)
})
it('renders six instruments, piano controls, ownership, pedal routing, master and labeled fallback', async () => {
  const r = await page.evaluate(() => window.render.instruments())
  for (const v of [
    ...r.scores,
    ...r.changes,
    r.resonance,
    r.dual,
    r.pedal,
    r.stick,
    r.fallback,
  ])
    expect(v).toBeGreaterThan(0.00002)
  for (const v of [r.noPedal, r.muteA, r.master, r.fader, r.stickOff])
    expect(v).toBeLessThan(0.00001)
  expect(r.louder).toBeGreaterThan(1.2)
  expect(r.count).toBe(0)
  expect(r.contexts).toBe(1)
  expect(r.states.at(-1)).toContain('Sample error')
}, 30000)

it('wires six processors in order, feeds the shared cabinet after reverb and disposes every connection', async () => {
  const t = await page.evaluate(() => window.render.topology())
  expect(t.serial).toBe(true)
  expect(t.postReverb).toBe(true)
  expect(t.limited).toBe(true)
  expect(t.live).toBeGreaterThan(0.001)
  expect(t.connections).toBe(0)
})

it('edits independent instruments, follows layer focus and shows group and global targeting on the panel', async () => {
  const p = await browser.newPage()
  p.setDefaultTimeout(3000)
  try {
    await p.goto(server.resolvedUrls!.local[0])
    await p.getByText(/Piano ready/).waitFor()
    await p.locator('#piano-layer-b-on').click()
    await p.locator('#piano-piano-type').click()
    await p.getByText(/Piano ready/).waitFor()
    expect(await p.locator('#program-oled').textContent()).toContain(
      'Kawai Upright',
    )
    await p.locator('#effects-reverb-on').click()
    await p.locator('#piano-layer-a-level').press('ArrowUp')
    expect(await p.locator('#program-oled').textContent()).toContain(
      'Yamaha C5',
    )
    expect(
      await p.locator('#effects-reverb-on').getAttribute('aria-pressed'),
    ).toBe('false')
    await p.locator('#effects-reverb-on').click({ modifiers: ['Shift'] })
    expect(
      await p.locator('#effects-reverb-on').getAttribute('aria-description'),
    ).toContain('global')
    await p
      .locator('#effects-layer-focus-piano')
      .click({ modifiers: ['Shift'] })
    await p.locator('#effects-mod-1-on').click()
    await p.locator('#piano-layer-b-level').press('ArrowUp')
    expect(
      await p.locator('#effects-mod-1-on').getAttribute('aria-pressed'),
    ).toBe('true')
    await p.getByTitle('Edit piano layers and effects').click()
    await p.getByLabel('SUSTPED', { exact: true }).uncheck()
    await p.getByLabel('Instrument', { exact: true }).selectOption('2')
    await p.getByLabel('Timbre', { exact: true }).selectOption('5')
    await p.getByRole('button', { name: 'Close', exact: true }).click()
    expect(
      await p.locator('#piano-timbre').getAttribute('aria-description'),
    ).toBe('Dyno 2')
    expect(await p.locator('#program-oled').textContent()).toContain(
      'Rhodes Mark I',
    )
  } finally {
    await p.close()
  }
})

it('identifies the missing library in the panel and recovers ready feedback on a synthesized model', async () => {
  const p = await browser.newPage()
  p.setDefaultTimeout(3000)
  try {
    await p.route('**/samples/upright-*.ogg', (route) =>
      route.fulfill({
        status: 200,
        body: 'invalid audio',
        contentType: 'audio/ogg',
      }),
    )
    await p.goto(server.resolvedUrls!.local[0])
    await p.getByText(/Piano ready/).waitFor()
    await p.locator('#piano-piano-type').click()
    await p.locator('.status').filter({ hasText: 'Sample error' }).waitFor()
    expect(await p.locator('.type-failure').count()).toBe(1)
    expect(await p.locator('#program-oled').textContent()).toContain(
      'Sample error',
    )
    await p.locator('#piano-piano-type').click()
    await p.locator('#piano-piano-type').click()
    await p.getByText(/Piano ready/).waitFor()
    expect(await p.locator('.type-failure').count()).toBe(0)
    expect(await p.locator('#program-oled').textContent()).toContain(
      'Plucked Clav',
    )
  } finally {
    await p.close()
  }
})
