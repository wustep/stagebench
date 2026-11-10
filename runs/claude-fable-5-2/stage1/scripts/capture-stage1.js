/**
 * Stage 1 capture: screenshots at the two canonical viewports plus measured geometry.
 *
 * This is a Playwright snippet: a single async function that receives a `page`.
 * It was run through a Playwright session against `vite preview` of the production build
 * (`pnpm build && pnpm exec vite preview --port 4317 --strictPort`). The parent capture
 * harness named in the phase prompt was not reachable from the workspace; if it is run
 * later it may overwrite the files this produces.
 *
 * Output (paths relative to the Playwright working directory, the stage1 workspace):
 *   candidate/evidence/stage1-desktop.png
 *   candidate/evidence/stage1-narrow.png
 *   candidate/evidence/stage1-capture.json
 *
 * Every number in the JSON is read from the live DOM with getBoundingClientRect() or
 * getComputedStyle(); nothing is copied from the source data.
 */
async (page) => {
  const BASE_URL = 'http://localhost:4317/'
  const OUT_DIR = 'candidate/evidence'
  const VIEWPORTS = [
    ['desktop', { width: 1440, height: 900 }],
    ['narrow', { width: 390, height: 844 }],
  ]

  const measure = () => {
    const round = (n) => Math.round(n * 1000) / 1000
    const inst = document.querySelector('#instrument')
    const ir = inst.getBoundingClientRect()
    const de = document.documentElement
    const deck = inst.querySelector('[data-region="deck"]').getBoundingClientRect()
    const keybed = inst.querySelector('[data-region="keybed"]').getBoundingClientRect()

    // The visual spec's displayElement rule: id, class, accessible name, or data attribute
    // containing "oled", "display", or "screen".
    const displayPattern = /oled|display|screen/i
    const isDisplay = (e) =>
      [
        e.id,
        e.getAttribute('class') || '',
        e.getAttribute('aria-label') || '',
        ...[...e.attributes].filter((a) => a.name.startsWith('data-')).flatMap((a) => [a.name, a.value]),
      ].some((v) => displayPattern.test(v))

    const sections = [...inst.querySelectorAll('section[data-section]')].map((s) => {
      const r = s.getBoundingClientRect()
      const controls = [...s.querySelectorAll('[data-control-id]')]
      const kinds = {}
      for (const c of controls) kinds[c.dataset.kind] = (kinds[c.dataset.kind] || 0) + 1
      // Reachability: the element under each control's centre must be that control.
      let unreachable = 0
      for (const c of controls) {
        const b = c.getBoundingClientRect()
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
        if (!(hit && (hit === c || c.contains(hit)))) unreachable += 1
      }
      const darkPlateArea = [...s.querySelectorAll('.plate--dark')].reduce((sum, p) => {
        const b = p.getBoundingClientRect()
        return sum + b.width * b.height
      }, 0)
      return {
        id: s.dataset.section,
        label: s.getAttribute('aria-label'),
        x: round(r.x - ir.x),
        width: round(r.width),
        fraction: round(r.width / ir.width),
        specFraction: Number(s.dataset.fraction),
        controls: controls.length,
        kinds,
        leds: s.querySelectorAll('.led').length,
        displayElements: [...s.querySelectorAll('*')].filter(isDisplay).map((d) => ({
          id: d.id,
          widthFractionOfSection: round(d.getBoundingClientRect().width / r.width),
        })),
        tallControls: controls.filter((c) => {
          const b = c.getBoundingClientRect()
          return b.height >= 3 * b.width
        }).length,
        darkPlateFractionOfSection: round(darkPlateArea / (r.width * r.height)),
        unreachableControls: unreachable,
      }
    })

    const keys = [...inst.querySelectorAll('.key')]
    const whites = keys.filter((k) => k.dataset.keyColor === 'white')
    const blacks = keys.filter((k) => k.dataset.keyColor === 'black')
    const w0 = whites[0].getBoundingClientRect()
    const wN = whites[whites.length - 1].getBoundingClientRect()
    const b0 = blacks[0].getBoundingClientRect()
    const has = (selector, property, rgb) =>
      getComputedStyle(inst.querySelector(selector))[property].includes(rgb) ? `${rgb} present` : 'missing'

    const above = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect()
      return (
        r.width > 2 &&
        r.height > 2 &&
        r.bottom > 0 &&
        r.bottom <= ir.y &&
        !inst.contains(e) &&
        !e.contains(inst) &&
        getComputedStyle(e).visibility !== 'hidden'
      )
    })

    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      document: {
        scrollWidth: de.scrollWidth,
        scrollHeight: de.scrollHeight,
        horizontalOverflow: de.scrollWidth > innerWidth,
        verticalOverflow: de.scrollHeight > innerHeight,
      },
      instrument: {
        x: round(ir.x),
        y: round(ir.y),
        width: round(ir.width),
        height: round(ir.height),
        widthFractionOfViewport: round(ir.width / innerWidth),
        aspectRatio: round(ir.width / ir.height),
        fullyInsideViewport: ir.x >= 0 && ir.y >= 0 && ir.right <= innerWidth && ir.bottom <= innerHeight,
        visibleElementsAboveInstrument: above.map((e) => e.className || e.tagName),
      },
      split: {
        deckHeight: round(deck.height),
        keybedHeight: round(keybed.height),
        deckFraction: round(deck.height / ir.height),
        keybedFraction: round(keybed.height / ir.height),
        gapBetweenDeckAndKeybed: round(keybed.y - (deck.y + deck.height)),
      },
      sections,
      sectionsContiguous: sections.every(
        (s, i) => i === 0 || Math.abs(s.x - (sections[i - 1].x + sections[i - 1].width)) < 0.01,
      ),
      keys: {
        total: keys.length,
        white: whites.length,
        black: blacks.length,
        first: keys[0].dataset.noteName,
        last: keys[keys.length - 1].dataset.noteName,
        firstNote: Number(keys[0].dataset.note),
        lastNote: Number(keys[keys.length - 1].dataset.note),
        whiteKeyWidth: round(w0.width),
        keybedSpanFractionOfInstrument: round((wN.right - w0.x) / ir.width),
        blackKeyHeightFraction: round(b0.height / w0.height),
        blackKeyWidthFraction: round(b0.width / w0.width),
      },
      controls: {
        total: inst.querySelectorAll('[data-control-id]').length,
        buttons: inst.querySelectorAll('[data-kind="button"]').length,
        sliders: inst.querySelectorAll('[role="slider"]').length,
        withoutAccessibleName: [...inst.querySelectorAll('[data-control-id]')].filter(
          (c) => !c.getAttribute('aria-label'),
        ).length,
      },
      oleds: [...inst.querySelectorAll('.oled')].map((o) => ({
        id: o.id,
        section: o.closest('section').dataset.section,
        text: [...o.children].map((child) => child.textContent).filter(Boolean),
      })),
      colors: {
        chassisMid: has('.chassis__deck', 'backgroundImage', 'rgb(133, 26, 37)'),
        panelBlueGray: has('.plate--dark', 'backgroundImage', 'rgb(60, 66, 77)'),
        keyWhite: has('.key--white', 'backgroundImage', 'rgb(220, 220, 220)'),
        keyBlack: has('.key--black', 'backgroundImage', 'rgb(11, 11, 11)'),
        pageBackground: getComputedStyle(de).backgroundColor,
      },
      status: {
        audio: document.querySelector('[data-testid=audio-status]').textContent,
        midi: document.querySelector('[data-testid=midi-status]').textContent,
      },
      imagesOnPage: document.querySelectorAll('img, picture, video, canvas').length,
    }
  }

  const result = {
    stage: 1,
    variant: 'stage-4-73',
    capturedWith:
      'Playwright (Chromium) session running candidate/scripts/capture-stage1.js against `vite preview` of dist/. The parent capture harness was not reachable from the workspace.',
    capturedAt: new Date().toISOString(),
    state: 'Fresh page load, no interaction: panel in its initial (reference-photo) state, audio idle.',
    captures: {},
  }

  for (const [name, viewport] of VIEWPORTS) {
    const consoleErrors = []
    const onPageError = (error) => consoleErrors.push(`pageerror: ${error.message}`)
    const onConsole = (message) => {
      if (message.type() === 'error') consoleErrors.push(`console.error: ${message.text()}`)
    }
    page.on('pageerror', onPageError)
    page.on('console', onConsole)
    await page.setViewportSize(viewport)
    await page.goto(BASE_URL)
    await page.waitForSelector('#instrument')
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT_DIR}/stage1-${name}.png` })
    result.captures[name] = { file: `stage1-${name}.png`, ...(await page.evaluate(measure)), consoleErrors }
    page.off('pageerror', onPageError)
    page.off('console', onConsole)
  }
  result.userAgent = await page.evaluate(() => navigator.userAgent)

  const json = `${JSON.stringify(result, null, 2)}\n`
  let written = false
  try {
    const fs = await import('node:fs')
    fs.writeFileSync(`${OUT_DIR}/stage1-capture.json`, json)
    written = true
  } catch {
    // No filesystem access from this Playwright host: the caller saves the returned JSON.
  }
  return written ? `wrote ${OUT_DIR}/stage1-capture.json` : json
}
