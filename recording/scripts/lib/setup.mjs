// Runs a model's models.json setup steps on a loaded page and returns a log of what changed.
// Steps only use controls the preview ships:
//   pressIfOff / pressOffIfOn: <selector>          click to reach aria-pressed true / false
//   select: [<selector>, <option label>]
//   cycleTo: [<selector>, <aria-label regex>]      click a cycling button until its label matches
//   click: <selector>                              click once (for cycle buttons with no readable state)
//   setValue: [<selector>, <target>, <regex?>]     step a slider/knob with arrow keys until its value
//                                                  (aria-valuenow, or the number in aria-valuetext
//                                                  matched by the regex) reaches target
export async function runSetup(page, steps) {
  const log = [];
  for (const step of steps) {
    if (step.pressIfOff || step.pressOffIfOn) {
      const sel = step.pressIfOff || step.pressOffIfOn, want = step.pressIfOff ? 'true' : 'false';
      const b = page.locator(sel).first();
      if (!(await b.count())) { log.push(`missing ${sel}`); continue; }
      const pressed = String((await b.getAttribute('aria-pressed')) === 'true');
      if (pressed === want) log.push(`already ${want === 'true' ? 'on' : 'off'}: ${sel}`);
      else { await b.click({ timeout: 2000 }); log.push(`turned ${want === 'true' ? 'on' : 'off'}: ${sel}`); }
    } else if (step.cycleTo) {
      const [sel, re] = step.cycleTo;
      const b = page.locator(sel).first();
      if (!(await b.count())) { log.push(`missing ${sel}`); continue; }
      const from = await b.getAttribute('aria-label');
      for (let i = 0; i < 12 && !new RegExp(re).test((await b.getAttribute('aria-label')) || ''); i++) {
        await b.click({ timeout: 2000 });
        await page.waitForTimeout(150);
      }
      log.push(`${from} -> ${await b.getAttribute('aria-label')}`);
    } else if (step.select) {
      const [sel, val] = step.select;
      const s = page.locator(sel).first();
      if (!(await s.count())) { log.push(`missing ${sel}`); continue; }
      const cur = await s.evaluate((e) => e.options[e.selectedIndex]?.text);
      if (cur === val) log.push(`already ${val}: ${sel}`);
      else { await s.selectOption({ label: val }); log.push(`selected ${val} (was ${cur})`); }
    } else if (step.click) {
      const b = page.locator(step.click).first();
      if (!(await b.count())) { log.push(`missing ${step.click}`); continue; }
      await b.click({ timeout: 2000 });
      log.push(`clicked ${step.click}`);
    } else if (step.setValue) {
      const [sel, target, re] = step.setValue;
      const k = page.locator(sel).first();
      if (!(await k.count())) { log.push(`missing ${sel}`); continue; }
      const read = async () => {
        const [now, text, val] = await k.evaluate((e) => [e.getAttribute('aria-valuenow'), e.getAttribute('aria-valuetext'), e.value]);
        if (re) { const m = new RegExp(re).exec(text || ''); if (m) return Number(m[1]); }
        return Number(now ?? val);
      };
      const from = await read();
      await k.focus();
      for (let i = 0; i < 200; i++) {
        const v = await read();
        if (Math.abs(v - target) < 1e-9) break;
        await page.keyboard.press(v > target ? 'ArrowDown' : 'ArrowUp');
        const after = await read();
        if (after === v) break; // not keyboard-steppable
        if ((v > target && after < target) || (v < target && after > target)) break; // stepped past: stop at nearest
      }
      log.push(`${sel}: ${from} -> ${await read()} (target ${target})`);
    }
  }
  await page.waitForTimeout(600);
  return log;
}
