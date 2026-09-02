import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { INSTRUMENT_ASPECT, instrumentWidthFor } from '../src/hardware/sections'
import { mountApp, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('regression.chassis — no hero, no detached rails, no missing keys, no overflow or clipping', () => {
  it('has no marketing hero: the instrument is the first block of main, under a one-line header', async () => {
    mounted = await mountApp()
    expect(document.querySelector('h1, h2, .hero, img')).toBeNull()
    const main = document.querySelector('main')!
    expect(main.firstElementChild?.id).toBe('instrument')
    const header = document.querySelector('.page-header')!
    expect(header.textContent!.length).toBeLessThan(200)
  })

  it('keeps the deck, keybed, cheeks and every key inside one chassis element', async () => {
    mounted = await mountApp()
    const instrument = document.getElementById('instrument')!
    for (const id of ['deck', 'keybed', 'chassis', 'keys']) expect(instrument.contains(document.getElementById(id))).toBe(true)
    expect(document.querySelectorAll('#instrument .key')).toHaveLength(73)
    expect(document.querySelectorAll('#instrument .cheek')).toHaveLength(2)
    expect(document.querySelectorAll('#instrument .section')).toHaveLength(6)
    // the keybed spans the chassis width between the cheeks
    const inner = document.querySelector('.keybed-inner') as HTMLElement
    expect(inner.style.left).toBe('2.3%')
    expect(inner.style.right).toBe('2.3%')
  })

  it('sizes to 88–97% of a 1440x900 viewport without vertical scroll, and fits a 390 viewport width', () => {
    const css = readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf8')
    expect(css).toMatch(/\.instrument\s*\{[^}]*width:\s*min\(100%, 94vw, calc\(\(100vh - 150px\) \* 3\.0951\)\)/)
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/)
    expect(css).toMatch(/\.stage\[data-zoom='1'\]\s*\{[^}]*overflow-x:\s*hidden/)
    const desktop = instrumentWidthFor(1440, 900)
    expect(desktop / 1440).toBeGreaterThanOrEqual(0.88)
    expect(desktop / 1440).toBeLessThanOrEqual(0.97)
    expect(desktop / INSTRUMENT_ASPECT).toBeLessThan(900 - 150)
    expect(instrumentWidthFor(390, 844)).toBeLessThanOrEqual(390)
  })

  it('the canonical capture (when present) confirms the rendered geometry and a clean console', () => {
    const file = path.resolve(__dirname, '../evidence/stage1-capture.json')
    if (!existsSync(file)) return
    const capture = JSON.parse(readFileSync(file, 'utf8'))
    const d = capture.captures['stage1-desktop']
    expect(d.viewport).toEqual({ width: 1440, height: 900 })
    expect(d.instrument.widthFraction).toBeGreaterThanOrEqual(0.88)
    expect(d.instrument.widthFraction).toBeLessThanOrEqual(0.97)
    expect(d.document.scrollHeight).toBeLessThanOrEqual(900)
    expect(d.instrument.bottom).toBeLessThanOrEqual(900)
    expect(d.keys.total).toBe(73)
    expect(d.keys.white).toBe(43)
    expect(d.keys.black).toBe(30)
    expect(Math.abs(d.deck.fraction - 0.54)).toBeLessThanOrEqual(0.025)
    expect(Math.abs(d.keys.blackHeightFraction - 0.61)).toBeLessThanOrEqual(0.02)
    for (const s of d.sections) expect(Math.abs(s.measuredFraction - s.documentedFraction)).toBeLessThan(0.005)
    expect(d.consoleErrors).toEqual([])
    expect(d.pageErrors).toEqual([])
    const n = capture.captures['stage1-narrow']
    expect(n.viewport.width).toBe(390)
    expect(n.document.scrollWidth).toBeLessThanOrEqual(390)
    expect(n.instrument.x).toBeGreaterThanOrEqual(0)
    expect(n.instrument.x + n.instrument.width).toBeLessThanOrEqual(390)
    expect(n.consoleErrors).toEqual([])
    expect(capture.interaction.consoleErrors).toEqual([])
    expect(capture.interaction.pageErrors).toEqual([])
  })
})
