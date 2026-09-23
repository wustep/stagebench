// Page helpers: audio tap, DOM surgery (piano only), Grand/reverb setup, keybed driving.

export const LAUNCH_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--disable-gesture-requirement-for-media-playback',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
];

// Runs before any page script: tap every AudioContext and tolerate synthetic pointer capture.
export function initScript() {
  window.__etude = { contexts: [], analysers: [], notes: [] };
  const origCapture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) {
    try { return origCapture.call(this, id); } catch { /* synthetic pointer ids */ }
  };
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) return;
  window.AudioContext = class extends Orig {
    constructor(...args) {
      super(...args);
      try {
        const realDest = this.destination;
        const split = this.createGain();
        split.connect(realDest);
        const tap = this.createMediaStreamDestination();
        split.connect(tap);
        const an = this.createAnalyser();
        an.fftSize = 2048;
        split.connect(an);
        Object.defineProperty(this, 'destination', { configurable: true, get: () => split });
        window.__etude.contexts.push({ ctx: this, stream: tap.stream });
        window.__etude.analysers.push(an);
      } catch (e) { window.__etude.notes.push('wrap fail ' + e); }
    }
  };
  window.webkitAudioContext = window.AudioContext;
}

// Find the instrument root for any of the six previews.
export function findInstrument() {
  const sels = ['[data-testid=chassis]', '#instrument', '.instrument', '.stage', '[class*=instrument]'];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el && el.querySelector('[data-note],[data-midi]')) return s;
  }
  // Fallback: smallest wide ancestor containing all keys and a control deck.
  return null;
}

// Hide everything except the instrument, black background, center it in the viewport.
export function pianoOnly({ sel, bg }) {
  const inst = document.querySelector(sel);
  if (!inst) return { ok: false, error: 'no instrument ' + sel };
  const style = document.createElement('style');
  style.id = 'etude-surgery';
  style.textContent = `
    html, body { background: ${bg} !important; overflow: hidden !important; margin: 0 !important; scrollbar-width: none !important; }
    ::-webkit-scrollbar { display: none !important; }
    .etude-hidden { display: none !important; }
    .etude-ancestor { background: transparent !important; box-shadow: none !important; border-color: transparent !important;
      overflow: visible !important; max-height: none !important; }
  `;
  document.head.appendChild(style);
  // Hide all siblings along the ancestor chain; keep the chain itself.
  let node = inst;
  const hidden = [];
  while (node && node !== document.body) {
    const parent = node.parentElement;
    if (!parent) break;
    for (const sib of parent.children) {
      if (sib === node || sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') continue;
      sib.classList.add('etude-hidden');
      hidden.push(sib.tagName.toLowerCase() + (sib.className && typeof sib.className === 'string' ? '.' + sib.className.split(' ')[0] : ''));
    }
    if (parent !== document.body) parent.classList.add('etude-ancestor');
    node = parent;
  }
  // Floating chrome that lives inside the instrument subtree but is not hardware.
  for (const el of inst.querySelectorAll('[class*=tooltip],[class*=toast],[role=tooltip],[class*=notice]')) el.classList.add('etude-hidden');
  // Center by translation only (no scaling, so key geometry stays native).
  inst.style.transform = '';
  const r0 = inst.getBoundingClientRect();
  const dx = window.innerWidth / 2 - (r0.left + r0.width / 2);
  const dy = window.innerHeight / 2 - (r0.top + r0.height / 2);
  inst.style.transform = `translate(${dx}px, ${dy}px)`;
  inst.style.transformOrigin = 'center';
  window.scrollTo(0, 0);
  const r = inst.getBoundingClientRect();
  return { ok: true, hidden, rect: [r.left, r.top, r.width, r.height], vw: window.innerWidth, vh: window.innerHeight };
}

// Union of the instrument box and any visible hardware overhanging it (knobs, cheeks).
export function hardwareBox(sel) {
  const inst = document.querySelector(sel);
  const base = inst.getBoundingClientRect();
  let [l, t, r, b] = [base.left, base.top, base.right, base.bottom];
  // Overhang clipped by the instrument itself (or any ancestor inside it) never paints; skip it.
  const clips = (el) => /hidden|clip/.test(getComputedStyle(el).overflow);
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== inst.parentElement; p = p.parentElement) if (clips(p)) return p;
    return null;
  };
  for (const el of inst.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const clipper = clipped(el);
    if (clipper) {
      const c = clipper.getBoundingClientRect(), q = el.getBoundingClientRect();
      if (q.bottom > c.bottom + 1 || q.top < c.top - 1 || q.left < c.left - 1 || q.right > c.right + 1) continue;
    }
    const q = el.getBoundingClientRect();
    if (q.width < 2 || q.height < 2) continue;
    // Only accept modest overhang; ignore offscreen popovers.
    if (q.left > base.left - 60) l = Math.min(l, q.left);
    if (q.top > base.top - 60) t = Math.min(t, q.top);
    if (q.right < base.right + 60) r = Math.max(r, q.right);
    if (q.bottom < base.bottom + 60) b = Math.max(b, q.bottom);
  }
  return [l, t, r - l, b - t];
}

// Snapshot of controls relevant to Grand/reverb for logging.
export function controlReport() {
  const items = [...document.querySelectorAll('button,[role=button],[role=switch],input,select,[role=slider]')];
  const out = [];
  for (const e of items) {
    const name = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().replace(/\s+/g, ' ');
    if (!/grand|piano type|piano model|reverb|type select/i.test(name)) continue;
    out.push({
      tag: e.tagName.toLowerCase(), name: name.slice(0, 80),
      pressed: e.getAttribute('aria-pressed'), checked: e.getAttribute('aria-checked') ?? (e.type === 'checkbox' ? String(e.checked) : null),
      value: e.value ?? e.getAttribute('aria-valuenow'), valuetext: e.getAttribute('aria-valuetext'),
      options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.text).slice(0, 10) : undefined,
    });
  }
  return out;
}

// Keybed driver installed into the page. Velocity is expressed three ways at once so every
// model's mapping sees it: pointer pressure, strike depth along the key (front = louder),
// and a data attribute for handlers that read it. Mode chosen per model from the velocity probe.
export function installDriver() {
  const findKey = (note) => document.querySelector(`[data-note="${note}"]`) || document.querySelector(`[data-midi="${note}"]`);
  const pid = (note) => 100 + note;
  window.__etudeKey = {
    down(note, vel, mode) {
      const el = findKey(note);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const v = Math.max(1, Math.min(127, vel)) / 127;
      let y = r.top + r.height * 0.5;
      if (mode.y === 'front-loud') y = r.top + r.height * (0.12 + 0.83 * v);
      if (mode.y === 'back-loud') y = r.bottom - r.height * (0.12 + 0.83 * v);
      const x = r.left + r.width / 2;
      const init = { bubbles: true, cancelable: true, composed: true, pointerId: pid(note), pointerType: mode.pointerType || 'mouse', isPrimary: false,
        button: 0, buttons: 1, clientX: x, clientY: y, pressure: mode.pressure ? Math.max(0.05, v) : 0.5, width: 1, height: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      if (mode.mouse) el.dispatchEvent(new MouseEvent('mousedown', init));
      return true;
    },
    up(note, mode) {
      const el = findKey(note);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, composed: true, pointerId: pid(note), pointerType: mode.pointerType || 'mouse', isPrimary: false,
        button: 0, buttons: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pressure: 0 };
      el.dispatchEvent(new PointerEvent('pointerup', init));
      if (mode.mouse) el.dispatchEvent(new MouseEvent('mouseup', init));
      return true;
    },
    peak() {
      let m = 0;
      const buf = new Float32Array(2048);
      for (const an of window.__etude.analysers) {
        an.getFloatTimeDomainData(buf);
        for (const s of buf) m = Math.max(m, Math.abs(s));
      }
      return m;
    },
  };
}
