"""Repeatable Phase 1 browser capture and geometry/interaction audit."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:5173/"


def metrics(page):
    return page.evaluate("""() => {
      const box = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
      };
      const instrument = box('.instrument');
      const sections = [...document.querySelectorAll('.deck-section')].map(el => {
        const r = el.getBoundingClientRect();
        return {id:el.dataset.section,width:r.width,fraction:r.width / box('.control-deck').width};
      });
      return {
        viewport:{width:innerWidth,height:innerHeight},
        instrument,
        instrumentWidthFraction:instrument.width / innerWidth,
        deck:box('.control-deck'),
        keybed:box('.keybed'),
        keybedStartFraction:(box('.keybed').y-instrument.y)/instrument.height,
        sections,
        keys:{total:document.querySelectorAll('.piano-key').length,
          white:document.querySelectorAll('.piano-key.white').length,
          black:document.querySelectorAll('.piano-key.black').length,
          first:document.querySelector('.piano-key').getAttribute('aria-label'),
          last:[...document.querySelectorAll('.piano-key')].at(-1).getAttribute('aria-label')},
        controls:document.querySelectorAll('[data-control-id]').length,
        oleds:document.querySelectorAll('.oled').length,
        verticalScroll:document.documentElement.scrollHeight > innerHeight,
        horizontalPan:document.querySelector('.instrument-scroll').scrollWidth >
          document.querySelector('.instrument-scroll').clientWidth
      };
    }""")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox"])
    result = {"url": URL, "browser": "Google Chrome via Playwright", "captures": {}, "interactions": {}, "consoleErrors": []}
    for name, width, height in [("desktop", 1440, 900), ("narrow", 390, 844)]:
        page = browser.new_page(viewport={"width": width, "height": height})
        page.on("pageerror", lambda error: result["consoleErrors"].append(str(error)))
        page.on("console", lambda message: result["consoleErrors"].append(message.text) if message.type == "error" else None)
        page.goto(URL)
        page.locator(".instrument").wait_for()
        page.screenshot(path=str(ROOT / f"stage1-{name}.png"))
        result["captures"][name] = metrics(page)
        if name == "desktop":
            knob = page.get_by_role("slider", name="Master Level")
            before = knob.input_value()
            knob.focus()
            page.keyboard.press("ArrowRight")
            result["interactions"]["knobKeyboard"] = {"before": before, "after": knob.input_value()}
            button = page.get_by_role("button", name="Piano On")
            button.click()
            result["interactions"]["decorativeButtonPressed"] = button.get_attribute("aria-pressed")
            key = page.locator('[data-midi="60"]')
            key.scroll_into_view_if_needed()
            page.mouse.move(key.bounding_box()["x"] + 5, key.bounding_box()["y"] + 90)
            page.mouse.down()
            result["interactions"]["pointerKeyPressed"] = key.get_attribute("aria-pressed")
            page.mouse.up()
            result["interactions"]["pointerKeyReleased"] = key.get_attribute("aria-pressed")
            page.keyboard.down("a")
            result["interactions"]["computerKeyPressed"] = page.locator('[data-midi="48"]').get_attribute("aria-pressed")
            page.keyboard.up("a")
            page.wait_for_timeout(100)
            result["interactions"]["audioStatus"] = page.get_by_role("status").inner_text()
        else:
            page.evaluate("document.querySelector('.instrument-scroll').scrollLeft = 99999")
            result["interactions"]["narrowPanReachesRightEdge"] = page.evaluate("""() => {
              const host = document.querySelector('.instrument-scroll');
              return host.scrollLeft > 0 && host.scrollLeft + host.clientWidth >= host.scrollWidth - 1;
            }""")
        page.close()
    browser.close()
    (ROOT / "stage1-capture.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"captures": list(result["captures"]), "consoleErrors": result["consoleErrors"], "interactions": result["interactions"]}, indent=2))
