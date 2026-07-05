#!/usr/bin/env node
/**
 * Generate public/artifacts/nord-stage-4-recreation.svg — a from-scratch
 * vector recreation of reference/nord-stage-4-73.jpg, drawn on the photo's
 * own 11600x3866 pixel frame so it aligns 1:1 with the product shot.
 *
 * This is a standalone study artifact, NOT part of the showcase instrument.
 * The companion viewer (public/artifacts/nord-stage-4-recreation.html) stacks
 * this SVG under the real product photo (same frame, so no crop math) with an
 * opacity/blend overlay tool for eyeballing drift. The photo is served by the
 * dev-server /reference bridge (vite.config.ts) or, on production, by
 * middleware.js after /secret unlock — gitignored, never bundled.
 *
 * Every coordinate below was measured off the reference photo with pixel
 * scanline probes and connected-component blob detection (buttons, knobs,
 * LEDs, group-box outlines), not eyeballed. Anchors:
 *   - chassis (red-dominant bbox):        x 1296..10304, y 468..3312
 *   - plate header band:                  y  692..790
 *   - plate bodies:                       y  790..1835
 *   - deck front lip / shadow / felt:     y 1835..1940 / 1940..2004 / 2004..2027
 *   - keybed: 43 white keys               x 1565..10037, y 2027..3232
 *   - plates: organ 2516..4206, piano 4232..4950, synth 6068..8206,
 *             effects 8400..9878; program red 4950..6068; fx strip 8206..8400
 *
 * Usage: node scripts/generate-recreation.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'artifacts', 'nord-stage-4-recreation.svg')

/* ------------------------------------------------------------- palette -- */
const C = {
  red: '#79232c', // main deck (spec chassisMid)
  redRail: '#66202a', // rear rail band
  redRailHi: '#a25661', // rail bevel highlight
  redLip: '#7c232d', // front lip
  redDark: '#5d181f', // lip lower shading / seams
  cheek: '#671b21', // wooden side cheeks
  shadow: '#1d0d10', // gap under the deck lip
  felt: '#2c1216', // felt strip above the keys
  plate: '#3a404b', // control plates (spec panelBlueGray family)
  plateEdge: '#23272e',
  header: '#b7bdc7', // light section-header band
  headerText: '#191d24',
  boxLine: '#98a1ac', // printed group-box outlines
  print: '#e3e6ea', // panel print on plates
  printDim: '#b9bfc8',
  printOnRed: '#e8dfd6', // panel print on red chassis
  btn: '#141518', // dark button body
  btnFace: '#2e3237',
  btnGray: '#c6c6c0',
  btnGrayFace: '#e0e0da',
  btnRed: '#a03038', // store button
  frameRed: '#8e2b31', // red-framed quick-select buttons
  knob: '#17181b',
  knobEdge: '#3a3e44',
  pointer: '#e9e7e1',
  oledBezel: '#191511',
  oled: '#0d0b08',
  oledText: '#e6ddc6',
  ledRed: '#ff4033',
  ledRedOff: '#571a18',
  ledGreen: '#b9f04c',
  ledYellow: '#ffcf3d',
  ledOff: '#23262b',
  keyWhite: '#dcdcdc',
  keyWhiteFront: '#c2c0bc',
  keyGap: '#8f8f8b',
  keyBlack: '#101010',
  keyBlackHi: '#2e2e30',
  slot: '#0a0a0a',
  wood: '#b98850',
  wheel: '#b9babd',
}

const FONT = `'Roboto Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif`

/* ------------------------------------------------------------- helpers -- */
const out = []
const emit = (s) => out.push(s)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function text(x, y, s, { size = 30, fill = C.print, anchor = 'middle', weight = 600, spacing = 0.5, style = '' } = {}) {
  emit(
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" letter-spacing="${spacing}"${style ? ` style="${style}"` : ''}>${esc(s)}</text>`,
  )
}

/** Dark / gray / red-framed hardware button (photo: pill face on a body). */
function btn(x, y, w, h, kind = 'dark') {
  const body = kind === 'gray' ? C.btnGray : kind === 'red' ? C.btnRed : C.btn
  const face = kind === 'gray' ? C.btnGrayFace : kind === 'red' ? '#b8474e' : C.btnFace
  const frame = kind === 'redframe' ? ` stroke="${C.frameRed}" stroke-width="10"` : ` stroke="#0b0c0e" stroke-width="3"`
  emit(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(18, h / 4)}" fill="${body}"${frame}/>`)
  emit(
    `<rect x="${x + w * 0.13}" y="${y + h * 0.14}" width="${w * 0.74}" height="${h * 0.44}" rx="${h * 0.18}" fill="${face}" opacity="0.9"/>`,
  )
}

/** Round knob with pointer; deg 0 = up, clockwise. */
function knob(cx, cy, r, { deg = 35, scale = true } = {}) {
  if (scale) {
    // printed tick arc: 11 dots from -135deg to +135deg
    for (let i = 0; i <= 10; i++) {
      const a = ((-135 + 27 * i) * Math.PI) / 180
      const tr = r + 26
      emit(`<circle cx="${(cx + tr * Math.sin(a)).toFixed(0)}" cy="${(cy - tr * Math.cos(a)).toFixed(0)}" r="5" fill="${C.printDim}"/>`)
    }
  }
  emit(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.knob}" stroke="${C.knobEdge}" stroke-width="6"/>`)
  emit(`<circle cx="${cx}" cy="${cy}" r="${(r * 0.55).toFixed(0)}" fill="#101114"/>`)
  const a = (deg * Math.PI) / 180
  emit(
    `<line x1="${(cx + r * 0.25 * Math.sin(a)).toFixed(0)}" y1="${(cy - r * 0.25 * Math.cos(a)).toFixed(0)}" x2="${(cx + r * 0.92 * Math.sin(a)).toFixed(0)}" y2="${(cy - r * 0.92 * Math.cos(a)).toFixed(0)}" stroke="${C.pointer}" stroke-width="10" stroke-linecap="round"/>`,
  )
}

function led(cx, cy, color = 'red', lit = false, r = 11) {
  const fill = lit ? (color === 'red' ? C.ledRed : color === 'green' ? C.ledGreen : C.ledYellow) : color === 'red' ? C.ledRedOff : C.ledOff
  emit(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${lit ? ` stroke="${fill}" stroke-opacity="0.35" stroke-width="10"` : ''}/>`)
}

/** Printed group box with a title tab straddling the top edge. */
function box(x, y, w, h, title, { tabCx = x + w / 2, titleSize = 30 } = {}) {
  emit(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="none" stroke="${C.boxLine}" stroke-width="4"/>`)
  if (title) {
    const tw = title.length * titleSize * 0.62 + 40
    emit(`<rect x="${(tabCx - tw / 2).toFixed(0)}" y="${y - titleSize * 0.72}" width="${tw.toFixed(0)}" height="${titleSize * 1.45}" fill="${C.plate}"/>`)
    text(tabCx, y + titleSize * 0.38, title, { size: titleSize, fill: C.print, weight: 700, spacing: 2 })
  }
}

/** Vertical LED level ladder (housing + n cells). */
function ladder(x, y0, y1, n, lit, color = 'green') {
  emit(`<rect x="${x - 21}" y="${y0 - 12}" width="42" height="${y1 - y0 + 24}" rx="8" fill="#20242a"/>`)
  const pitch = (y1 - y0) / (n - 1)
  for (let i = 0; i < n; i++) {
    const on = i >= n - lit
    const fill = on ? (color === 'green' ? C.ledGreen : C.ledRed) : C.ledOff
    emit(`<rect x="${x - 12}" y="${(y0 + i * pitch - 8).toFixed(0)}" width="24" height="16" rx="3" fill="${fill}"/>`)
  }
}

/** Layer-level fader: dark track slot + gray cap. */
function fader(x, y0, y1, capCy) {
  emit(`<rect x="${x - 10}" y="${y0}" width="20" height="${y1 - y0}" rx="9" fill="#101114"/>`)
  emit(`<rect x="${x - 39}" y="${capCy - 27}" width="78" height="54" rx="8" fill="${C.btnGray}" stroke="#7c7d78" stroke-width="3"/>`)
  emit(`<rect x="${x - 39}" y="${capCy - 4}" width="78" height="8" fill="#8a8b86"/>`)
}

/** 2-column triangular selector-LED matrix (organ model, vib/chorus, fx). */
function triSelector(x, y, rows, activeRow = 0, activeCol = 0) {
  const rowH = 42
  emit(`<rect x="${x}" y="${y}" width="64" height="${rows * rowH}" rx="8" fill="#181b1f"/>`)
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < 2; c++) {
      const lit = i === activeRow && c === activeCol
      const tx = x + 12 + c * 30
      const ty = y + 10 + i * rowH
      const dir = c === 0 ? `${tx},${ty + 11} ${tx + 16},${ty} ${tx + 16},${ty + 22}` : `${tx + 16},${ty + 11} ${tx},${ty} ${tx},${ty + 22}`
      emit(`<polygon points="${dir}" fill="${lit ? C.ledRed : '#3a2426'}"/>`)
    }
  }
}

/* ---------------------------------------------------------------- start -- */
emit(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11600 3866" font-family="${FONT}">`)
emit(`<!-- Generated by scripts/generate-recreation.mjs - edit that script, not this file. -->`)
emit(`<defs>
  <linearGradient id="railGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.redRail}"/><stop offset="0.75" stop-color="#6f222b"/><stop offset="1" stop-color="${C.redRailHi}"/>
  </linearGradient>
  <linearGradient id="lipGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.redLip}"/><stop offset="0.8" stop-color="#6e1f28"/><stop offset="1" stop-color="${C.redDark}"/>
  </linearGradient>
  <linearGradient id="keyFront" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.keyWhite}"/><stop offset="0.82" stop-color="${C.keyWhite}"/><stop offset="0.84" stop-color="${C.keyWhiteFront}"/><stop offset="1" stop-color="#aeaca8"/>
  </linearGradient>
  <linearGradient id="blackKey" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.keyBlackHi}"/><stop offset="0.85" stop-color="${C.keyBlack}"/><stop offset="1" stop-color="#000"/>
  </linearGradient>
  <linearGradient id="wheelGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#5d5e61"/><stop offset="0.5" stop-color="${C.wheel}"/><stop offset="1" stop-color="#4c4d50"/>
  </linearGradient>
</defs>`)

/* ------------------------------------------------------------- chassis -- */
emit(`<g id="chassis">`)
// rear-edge brackets poking above the chassis line (music-stand mounts)
emit(`<path d="M 3986 468 L 4016 404 L 4114 404 L 4144 468 Z" fill="#181818"/>`)
emit(`<path d="M 7452 468 L 7482 404 L 7580 404 L 7610 468 Z" fill="#181818"/>`)
// chassis body
emit(`<rect x="1296" y="468" width="9008" height="2844" rx="60" fill="${C.red}"/>`)
// rear rail band with bevel highlight
emit(`<path d="M 1296 528 Q 1296 468 1356 468 L 10244 468 Q 10304 468 10304 528 L 10304 692 L 1296 692 Z" fill="url(#railGrad)"/>`)
emit(`<rect x="1296" y="688" width="9008" height="10" fill="${C.redRailHi}" opacity="0.55"/>`)
// front lip below the plates, then shadow gap, then felt strip
emit(`<rect x="1296" y="1835" width="9008" height="105" fill="url(#lipGrad)"/>`)
emit(`<rect x="1296" y="1940" width="9008" height="64" fill="${C.shadow}"/>`)
emit(`<rect x="1565" y="2004" width="8472" height="23" fill="${C.felt}"/>`)
// side cheeks beside the keybed
emit(`<rect x="1296" y="1940" width="269" height="1372" fill="${C.cheek}"/>`)
emit(`<rect x="10037" y="1940" width="267" height="1372" fill="${C.cheek}"/>`)
emit(`<rect x="1296" y="1940" width="14" height="1372" fill="#7e2830" opacity="0.6"/>`)
emit(`<rect x="10290" y="1940" width="14" height="1372" fill="#7e2830" opacity="0.6"/>`)
// base strip under the key slot
emit(`<rect x="1565" y="3295" width="8472" height="17" fill="${C.redDark}"/>`)
emit(`</g>`)

/* ------------------------------------------------- rear connector print -- */
// Printed on the rail band above the plates. Positions are the left%
// values already measured for the showcase's REAR_LEGENDS (src/App.tsx),
// mapped onto the chassis width; \n stacks like the reference print.
emit(`<g id="rear-print">`)
const rearLegends = [
  ['MONITOR\nIN', 15], ['HEAD\nPHONES', 16.5], ['OUT 1 — OUT 2', 18.5], ['OUT 3 — OUT 4', 21.4],
  ['CONTROL\nPEDAL', 23.5], ['ORGAN\nSWELL', 25.1], ['SUSTAIN\nPEDAL', 26.7], ['TRIPLE\nPEDAL', 28.3],
  ['MIDI IN', 33.4], ['MIDI OUT', 38.1], ['ROTOR\nPEDAL', 40.3], ['USB', 41.9], ['FOOT\nSWITCH', 43.4],
  ['AC IN', 61], ['POWER ON/OFF', 65.3],
]
for (const [label, pct] of rearLegends) {
  const x = 1296 + (pct / 100) * 9008
  const lines = label.split('\n')
  lines.forEach((line, i) => {
    const y = lines.length === 1 ? 640 : 622 + i * 34
    text(x, y, line, { size: 26, fill: C.printOnRed, weight: 700, spacing: 1 })
  })
}
emit(`</g>`)

/* ---------------------------------------------------------- plates ------ */
emit(`<g id="plates">`)
// header band + body for each plate. Organ/piano/synth/effects share the
// same vertical extents (header 692..790, body 790..1835).
const plates = [
  { x: 2516, w: 1690 }, // organ
  { x: 4232, w: 718 }, // piano
  { x: 6068, w: 2138 }, // synth
  { x: 8400, w: 1478 }, // effects
]
for (const p of plates) {
  emit(`<rect x="${p.x}" y="692" width="${p.w}" height="1143" rx="14" fill="${C.plate}" stroke="${C.plateEdge}" stroke-width="6"/>`)
  emit(`<path d="M ${p.x} 706 Q ${p.x} 692 ${p.x + 14} 692 L ${p.x + p.w - 14} 692 Q ${p.x + p.w} 692 ${p.x + p.w} 706 L ${p.x + p.w} 790 L ${p.x} 790 Z" fill="${C.header}"/>`)
}
// rotary-speaker sub-column in the performance section
emit(`<rect x="2282" y="1014" width="238" height="821" rx="16" fill="${C.plate}" stroke="${C.plateEdge}" stroke-width="5"/>`)
emit(`<rect x="2282" y="1014" width="238" height="66" rx="16" fill="${C.header}"/>`)
emit(`</g>`)

/* --------------------------------------------------------- performance -- */
emit(`<g id="performance">`)
// pitch stick: angled cutout with a wooden stick
emit(`<g transform="rotate(-18 1705 940)">`)
emit(`<rect x="1584" y="890" width="270" height="112" rx="14" fill="#0c0c0c"/>`)
emit(`<rect x="1614" y="902" width="150" height="88" rx="10" fill="${C.wood}"/>`)
emit(`<rect x="1614" y="902" width="150" height="30" rx="10" fill="#d3a56b" opacity="0.7"/>`)
emit(`</g>`)
// mod wheel: vertical cutout with a rubber wheel
emit(`<rect x="1936" y="1026" width="156" height="408" rx="60" fill="#0c0c0c"/>`)
emit(`<rect x="1972" y="1052" width="84" height="356" rx="38" fill="url(#wheelGrad)"/>`)
emit(`<rect x="1976" y="1218" width="76" height="10" fill="#3d3e41"/>`)
// master level
text(2412, 768, 'MASTER LEVEL', { size: 30, fill: C.printOnRed, weight: 700 })
knob(2412, 888, 62, { deg: 55, scale: false })
emit(`<path d="M 2486 831 A 92 92 0 0 1 2504 901" fill="none" stroke="${C.printOnRed}" stroke-width="8" stroke-linecap="round"/>`)
// nord stage 4 logotype (glyphs measured: nord 1538.., stage 1936.., 4 ..2300)
text(1530, 1798, 'nord', { size: 158, fill: '#f4f1ec', anchor: 'start', weight: 700, spacing: 1, style: 'font-style:italic' })
text(1925, 1798, 'stage 4', { size: 138, fill: '#f4f1ec', anchor: 'start', weight: 300, spacing: 2 })
text(1538, 1848, 'H A M M E R   A C T I O N   7 3', { size: 28, fill: '#d8c9c6', anchor: 'start', weight: 400, spacing: 6 })

// rotary speaker column (plate drawn above)
text(2401, 1044, 'ROTARY', { size: 32, fill: C.headerText, weight: 700, spacing: 2 })
text(2401, 1076, 'SPEAKER', { size: 32, fill: C.headerText, weight: 700, spacing: 2 })
led(2488, 1100, 'red', true) // ON
text(2452, 1108, 'ON', { size: 26, anchor: 'end', weight: 700 })
knob(2380, 1180, 56, { deg: -40 })
text(2380, 1272, 'DRIVE', { size: 26, weight: 700 })
led(2330, 1302, 'red', false, 9)
text(2352, 1311, 'ORGAN', { size: 26, anchor: 'start', weight: 700 })
btn(2346, 1332, 118, 52, 'gray')
led(2330, 1426, 'red', false, 9)
text(2352, 1435, 'CLOSE MIC \u25BD', { size: 26, anchor: 'start', weight: 700 })
led(2330, 1476, 'red', false, 9)
text(2352, 1485, 'STOP MODE', { size: 26, anchor: 'start', weight: 700 })
btn(2336, 1506, 138, 76, 'dark')
text(2405, 1612, 'ANGLE', { size: 26, weight: 700 })
led(2320, 1666, 'green', true, 9)
text(2338, 1675, 'SLOW', { size: 26, anchor: 'start', weight: 700 })
led(2432, 1666, 'red', false, 9)
text(2450, 1675, 'FAST', { size: 26, anchor: 'start', weight: 700 })
btn(2338, 1700, 138, 76, 'dark')
led(2320, 1812, 'red', false, 9)
text(2338, 1821, 'MORPH', { size: 26, anchor: 'start', weight: 700 })
emit(`</g>`)

/* --------------------------------------------------------------- organ -- */
emit(`<g id="organ">`)
// header
text(2572, 752, 'ORGAN', { size: 56, fill: C.headerText, anchor: 'start', weight: 700, spacing: 3 })
text(2572, 782, 'SECTION', { size: 26, fill: C.headerText, anchor: 'start', weight: 600, spacing: 3 })
text(2830, 742, 'FX FOCUS', { size: 26, fill: C.headerText, weight: 700 })
led(2830, 768, 'yellow', false, 9)
text(2946, 730, 'ON', { size: 26, fill: C.headerText, weight: 700 })
led(2954, 756, 'red', true, 9)
btn(2978, 706, 136, 72, 'dark')
text(3190, 748, 'SOLO \u25BD', { size: 26, fill: C.headerText, anchor: 'start', weight: 700 })

// top boxes: ORGAN MODEL / VIB CHORUS / B3 PERCUSSION
box(2925, 826, 288, 326, 'ORGAN MODEL')
triSelector(3036, 894, 3, 2, 0)
text(3020, 918, 'FARF', { size: 26, anchor: 'end', weight: 700 })
text(3020, 960, 'VOX', { size: 26, anchor: 'end', weight: 700 })
text(3020, 1002, 'B3', { size: 26, anchor: 'end', weight: 700 })
text(3116, 918, 'PIPE1', { size: 26, anchor: 'start', weight: 700 })
text(3116, 960, 'PIPE2', { size: 26, anchor: 'start', weight: 700 })
text(3116, 994, 'B3', { size: 26, anchor: 'start', weight: 700 })
text(3116, 1022, 'BASS', { size: 26, anchor: 'start', weight: 700 })
btn(2996, 1034, 142, 86, 'dark')

box(3213, 826, 399, 326, 'VIB/CHORUS')
btn(3270, 904, 142, 84, 'dark')
// 3x2 mode matrix: C2 V3 C3 over V2 C1 V1 (blob: 3434..3558 x 910..972)
text(3496, 898, 'C2  V3  C3', { size: 26, weight: 700 })
emit(`<rect x="3434" y="908" width="124" height="66" rx="8" fill="#181b1f"/>`)
for (let c = 0; c < 3; c++)
  for (let r = 0; r < 2; r++)
    emit(`<polygon points="${3450 + c * 40},${918 + r * 32} ${3466 + c * 40},${926 + r * 32} ${3450 + c * 40},${934 + r * 32}" fill="${c === 1 && r === 1 ? C.ledRed : '#3a2426'}"/>`)
text(3496, 1010, 'V2  C1  V1', { size: 26, weight: 700 })
text(3316, 1097, 'ON', { size: 26, anchor: 'end', weight: 700 })
led(3332, 1088, 'red', true, 9)
btn(3354, 1058, 128, 60, 'gray')

box(3612, 826, 552, 326, 'B3 PERCUSSION')
text(3730, 872, 'VOLUME', { size: 26, weight: 700 })
text(3890, 872, 'DECAY', { size: 26, weight: 700 })
text(4050, 872, 'HARMONIC', { size: 26, weight: 700 })
led(3672, 900, 'red', false, 9); text(3690, 909, 'SOFT', { size: 26, anchor: 'start', weight: 700 })
led(3836, 890, 'red', true, 9); text(3854, 899, 'FAST', { size: 26, anchor: 'start', weight: 700 })
led(3996, 890, 'red', true, 9); text(4014, 899, 'THIRD', { size: 26, anchor: 'start', weight: 700 })
btn(3660, 922, 140, 82, 'dark')
btn(3820, 920, 140, 84, 'dark')
btn(3980, 920, 140, 84, 'dark')
led(3672, 1062, 'red', false, 9); text(3690, 1071, 'POLY \u25BD', { size: 26, anchor: 'start', weight: 700 })
text(3934, 1097, 'ON', { size: 26, anchor: 'end', weight: 700 }); led(3950, 1088, 'red', true, 9)
btn(3986, 1058, 128, 60, 'gray')

// drawbars: labels, numbered LED ladders, slots, caps
const DRAWBAR = {
  ladderX: [2998, 3144, 3290, 3436, 3582, 3728, 3874, 4018, 4164],
  labels: [['BASS16', "16'"], ['STR16', "8'"], ['FLUTE8', "4'"], ['OBOE8', "2'"], ['TRMP8', 'II'], ['STR8', 'III'], ['FLUTE4', 'IV'], ['STR4', ''], ['2 2/3', '\u2307']],
  foot: ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"],
  values: [8, 6, 8, 4, 3, 3, 6, 3, 5],
  colors: ['#6b4a35', '#6b4a35', '#e6e4de', '#e6e4de', '#181818', '#e6e4de', '#181818', '#181818', '#e6e4de'],
}
DRAWBAR.ladderX.forEach((lx, i) => {
  const [top, sub] = DRAWBAR.labels[i]
  text(lx, 1158, top, { size: 27, weight: 700 })
  if (sub) text(lx, 1196, sub, { size: 24, weight: 600, fill: C.printDim })
  // 8-cell red ladder with 1..8 numerals at its left
  for (let c = 0; c < 8; c++) {
    const cy = 1244 + c * 42
    const lit = c < DRAWBAR.values[i]
    emit(`<rect x="${lx - 18}" y="${cy}" width="36" height="26" rx="4" fill="${lit ? C.ledRed : C.ledRedOff}"/>`)
    text(lx - 40, cy + 22, String(c + 1), { size: 24, anchor: 'end', fill: C.printDim, weight: 600 })
  }
  // drawbar shaft + cap, centered 73px left of the ladder
  // (cap top measured: value 8 -> y 1526)
  const cx = lx - 73
  const capTop = 1398 + DRAWBAR.values[i] * 16
  emit(`<rect x="${cx - 12}" y="1240" width="24" height="570" rx="10" fill="#0e0f11"/>`)
  emit(`<rect x="${cx - 54}" y="${capTop}" width="108" height="170" rx="14" fill="${DRAWBAR.colors[i]}" stroke="#0a0a0a" stroke-width="4"/>`)
  emit(`<rect x="${cx - 54}" y="${capTop + 74}" width="108" height="10" fill="#000" opacity="0.35"/>`)
  text(cx, 1838, DRAWBAR.foot[i], { size: 24, fill: C.printDim, weight: 600 })
})

// layer levels (left edge of the plate)
fader(2557, 800, 1180, 921)
ladder(2658, 815, 1170, 13, 10)
fader(2734, 800, 1180, 993)
ladder(2834, 815, 1170, 13, 6)
text(2557, 1240, 'A', { size: 34, weight: 700 })
text(2610, 1240, 'AUX KB', { size: 24, anchor: 'start', weight: 600 })
led(2712, 1232, 'red', false, 8)
text(2734, 1240, 'B', { size: 34, weight: 700 })
text(2786, 1240, 'AUX KB', { size: 24, anchor: 'start', weight: 600 })
for (const bx of [2536, 2710]) {
  emit(`<rect x="${bx}" y="1258" width="146" height="34" rx="17" fill="none" stroke="${C.boxLine}" stroke-width="3"/>`)
  led(bx + 24, 1275, 'green', true, 9)
  text(bx + 84, 1284, 'ON/OFF \u25BE', { size: 23, weight: 700 })
}
btn(2544, 1310, 126, 58, 'gray')
btn(2718, 1310, 128, 58, 'gray')
led(2530, 1404, 'red', true, 9); text(2548, 1413, 'SUSTPED', { size: 24, anchor: 'start', weight: 700 })
led(2704, 1404, 'red', false, 9); text(2722, 1413, 'PSTICK', { size: 24, anchor: 'start', weight: 700 })
led(2606, 1466, 'red', false, 9); text(2624, 1475, 'PRESET', { size: 26, anchor: 'start', weight: 700 })
btn(2624, 1494, 146, 90, 'dark')
text(2697, 1620, 'SYNC \u25BD', { size: 25, weight: 700 })
text(2665, 1668, '\u25C0 OCTAVE SHIFT \u25B6', { size: 26, weight: 700 })
btn(2530, 1690, 126, 72, 'dark')
btn(2668, 1690, 126, 72, 'dark')
text(2665, 1806, '\u25C0 KB ZONE \u25B6', { size: 25, weight: 700 })
for (let i = 0; i < 4; i++) led(2588 + i * 52, 1826, 'green', i === 0, 9)
emit(`</g>`)

/* --------------------------------------------------------------- piano -- */
emit(`<g id="piano">`)
text(4287, 752, 'PIANO', { size: 56, fill: C.headerText, anchor: 'start', weight: 700, spacing: 3 })
text(4287, 782, 'SECTION', { size: 26, fill: C.headerText, anchor: 'start', weight: 600, spacing: 3 })
text(4520, 742, 'FX FOCUS', { size: 26, fill: C.headerText, weight: 700 })
led(4520, 768, 'yellow', false, 9)
text(4662, 730, 'ON', { size: 26, fill: C.headerText, weight: 700 })
led(4662, 756, 'red', false, 9)
btn(4694, 706, 136, 72, 'gray')
text(4862, 748, 'SOLO \u25BD', { size: 26, fill: C.headerText, anchor: 'start', weight: 700 })

fader(4281, 800, 1180, 819)
ladder(4373, 815, 1155, 13, 12)
fader(4457, 800, 1180, 1016)
ladder(4548, 815, 1155, 13, 5)

text(4700, 868, 'ACOUSTICS', { size: 27, weight: 700 })
led(4628, 894, 'red', false, 9); text(4646, 903, 'SOFT REL', { size: 25, anchor: 'start', weight: 700 })
led(4623, 934, 'red', true, 9); text(4641, 943, 'STRING RES', { size: 25, anchor: 'start', weight: 700 })
text(4872, 868, 'UNISON', { size: 27, weight: 700 })
led(4850, 896, 'red', false, 8); text(4832, 903, '2', { size: 24, anchor: 'end', weight: 700 })
led(4896, 910, 'red', false, 8); text(4914, 917, '3', { size: 24, anchor: 'start', weight: 700 })
led(4850, 938, 'red', false, 8); text(4832, 945, '1', { size: 24, anchor: 'end', weight: 700 })
btn(4614, 936, 140, 80, 'dark')
btn(4790, 934, 140, 82, 'dark')
led(4623, 1037, 'red', true, 9); text(4641, 1046, 'PED NOISE \u25BD', { size: 25, anchor: 'start', weight: 700 })
text(4700, 1092, 'KB TOUCH', { size: 27, weight: 700 })
text(4666, 1126, 'MED', { size: 25, anchor: 'end', weight: 700 }); led(4687, 1118, 'red', true, 8)
text(4644, 1160, 'HEAVY', { size: 25, anchor: 'end', weight: 700 }); led(4665, 1152, 'red', false, 8)
text(4718, 1146, 'LIGHT', { size: 25, anchor: 'start', weight: 700 })
text(4872, 1092, 'DYN COMP', { size: 27, weight: 700 })
led(4850, 1120, 'red', false, 8); text(4832, 1127, '2', { size: 24, anchor: 'end', weight: 700 })
led(4896, 1134, 'red', false, 8); text(4914, 1141, '3', { size: 24, anchor: 'start', weight: 700 })
led(4850, 1162, 'red', false, 8); text(4832, 1169, '1', { size: 24, anchor: 'end', weight: 700 })
btn(4616, 1192, 140, 86, 'dark')
btn(4792, 1192, 140, 84, 'dark')

text(4285, 1240, 'A', { size: 34, weight: 700 }); text(4338, 1240, 'AUX KB', { size: 24, anchor: 'start', weight: 600 })
text(4460, 1240, 'B', { size: 34, weight: 700 }); text(4513, 1240, 'AUX KB', { size: 24, anchor: 'start', weight: 600 })
for (const bx of [4250, 4424]) {
  emit(`<rect x="${bx}" y="1256" width="146" height="34" rx="17" fill="none" stroke="${C.boxLine}" stroke-width="3"/>`)
  led(bx + 24, 1273, 'green', true, 9)
  text(bx + 84, 1282, 'ON/OFF \u25BE', { size: 23, weight: 700 })
}
btn(4258, 1308, 128, 60, 'gray')
btn(4434, 1306, 128, 62, 'gray')
led(4271, 1403, 'red', true, 9); text(4289, 1412, 'SUSTPED', { size: 24, anchor: 'start', weight: 700 })
led(4448, 1403, 'red', false, 9); text(4466, 1412, 'PSTICK', { size: 24, anchor: 'start', weight: 700 })

text(4460, 1458, 'TIMBRE', { size: 27, weight: 700 })
btn(4268, 1474, 76, 152, 'dark')
text(4444, 1502, 'BRIGHT', { size: 25, anchor: 'end', weight: 700 }); led(4465, 1494, 'red', false, 8)
text(4420, 1544, 'MID', { size: 25, anchor: 'end', weight: 700 }); led(4441, 1536, 'red', false, 8)
text(4432, 1586, 'SOFT', { size: 25, anchor: 'end', weight: 700 }); led(4453, 1578, 'red', false, 8)
text(4500, 1522, 'DYNO1', { size: 25, anchor: 'start', weight: 700 })
text(4500, 1564, 'DYNO2', { size: 25, anchor: 'start', weight: 700 })
text(4420, 1668, '\u25C0 OCTAVE SHIFT \u25B6', { size: 26, weight: 700 })
btn(4290, 1686, 126, 62, 'dark')
btn(4428, 1686, 126, 62, 'dark')
text(4420, 1786, '\u25C0 KB ZONE \u25B6', { size: 25, weight: 700 })
for (let i = 0; i < 4; i++) led(4342 + i * 52, 1812, 'green', i > 0, 9)

box(4620, 1300, 310, 522, 'PIANO SELECT')
triSelector(4744, 1332, 3, 2, 0)
text(4728, 1356, 'ELECTRIC', { size: 25, anchor: 'end', weight: 700 })
text(4728, 1398, 'UPRIGHT', { size: 25, anchor: 'end', weight: 700 })
text(4728, 1440, 'GRAND', { size: 25, anchor: 'end', weight: 700 })
text(4824, 1356, 'CLAV', { size: 25, anchor: 'start', weight: 700 })
text(4824, 1398, 'DIGITAL', { size: 25, anchor: 'start', weight: 700 })
text(4824, 1440, 'MISC', { size: 25, anchor: 'start', weight: 700 })
btn(4704, 1464, 140, 86, 'dark')
text(4774, 1594, 'INFO', { size: 25, weight: 700 })
knob(4765, 1741, 68, { deg: 20, scale: false })
text(4740, 1836, 'MODEL', { size: 25, anchor: 'end', weight: 700 })
emit(`<rect x="4756" y="1812" width="86" height="32" rx="8" fill="none" stroke="${C.boxLine}" stroke-width="3"/>`)
text(4799, 1836, 'LIST', { size: 24, weight: 700 })
emit(`</g>`)

/* ------------------------------------------------------------- program -- */
emit(`<g id="program">`)
// morph assign (light sub-box on red)
emit(`<rect x="5006" y="692" width="441" height="196" rx="14" fill="${C.header}"/>`)
text(5226, 726, 'MORPH ASSIGN', { size: 28, fill: C.headerText, weight: 700, spacing: 1 })
text(5090, 762, 'WHEEL \u2963', { size: 23, fill: C.headerText, weight: 700 })
text(5228, 762, 'A.T. \u2963', { size: 23, fill: C.headerText, weight: 700 })
text(5366, 762, 'CTRLPED \u2963', { size: 23, fill: C.headerText, weight: 700 })
btn(5024, 780, 128, 82, 'dark')
btn(5162, 780, 128, 82, 'dark')
btn(5300, 780, 132, 82, 'dark')
text(5226, 884, '\u2014 CLEAR MORPH \u2014', { size: 24, fill: C.headerText, weight: 700 })
// split / mst clk / transp: light title tabs with dark text (photo)
function redTab(cx, y, w, label) {
  emit(`<rect x="${cx - w / 2}" y="${y}" width="${w}" height="44" rx="10" fill="${C.header}"/>`)
  text(cx, y + 33, label, { size: 27, fill: C.headerText, weight: 700, spacing: 1 })
}
redTab(5569, 700, 176, 'SPLIT')
for (let i = 0; i < 3; i++) led(5529 + i * 40, 766, i === 1 ? 'yellow' : 'red', i === 1, 9)
text(5569, 800, 'ON/SET \u25BE', { size: 24, fill: C.printOnRed, weight: 700 })
btn(5500, 810, 138, 76, 'dark')
text(5569, 928, 'SET KEY', { size: 24, fill: C.printOnRed, weight: 700 })
redTab(5760, 700, 190, 'MST CLK')
text(5760, 772, 'TAP/SET \u25BE', { size: 24, fill: C.printOnRed, weight: 700 })
btn(5692, 780, 136, 76, 'dark')
led(5702, 900, 'red', false, 9); text(5722, 909, 'PEDAL TAP', { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
redTab(5951, 700, 176, 'TRANSP')
text(5951, 772, 'ON/SET \u25BE', { size: 24, fill: C.printOnRed, weight: 700 })
btn(5882, 780, 138, 76, 'dark')
text(5951, 909, 'PANIC', { size: 24, fill: C.printOnRed, weight: 700 })
// prog view / preset name
text(5951, 922, 'PROG VIEW', { size: 24, fill: C.printOnRed, weight: 700 })
btn(5882, 936, 138, 76, 'dark')
text(5951, 1048, 'PRESET NAME', { size: 24, fill: C.printOnRed, weight: 700 })
// store
led(5024, 944, 'red', false, 9); text(5044, 953, 'STORE', { size: 25, fill: C.printOnRed, anchor: 'start', weight: 700 })
btn(5034, 978, 130, 62, 'red')
text(5099, 1072, 'STORE AS\u2026', { size: 24, fill: C.printOnRed, weight: 700 })
text(5099, 1102, 'PAGE NAME', { size: 24, fill: '#c8a9a5', weight: 700 })
text(5218, 946, 'MIDI', { size: 24, fill: C.printOnRed, weight: 700 }); led(5218, 970, 'red', false, 8)
text(5218, 1010, 'EXTERN', { size: 24, fill: C.printOnRed, weight: 700 }); led(5218, 1034, 'red', false, 8)
// preset library
emit(`<rect x="5240" y="905" width="560" height="200" rx="16" fill="none" stroke="#c9a9a4" stroke-width="4"/>`)
emit(`<rect x="5386" y="882" width="270" height="46" rx="10" fill="${C.header}"/>`)
text(5520, 916, 'PRESET LIBRARY', { size: 28, fill: C.headerText, weight: 700, spacing: 1 })
led(5354, 958, 'red', false, 8); text(5372, 966, 'ORGAN', { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
led(5504, 958, 'red', false, 8); text(5522, 966, 'PIANO', { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
led(5644, 958, 'red', false, 8); text(5662, 966, 'SYNTH', { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
btn(5330, 998, 126, 74, 'dark')
btn(5470, 998, 126, 74, 'dark')
btn(5608, 998, 126, 74, 'dark')
text(5520, 1132, '\u2014 SINGLE LAYER \u2014', { size: 24, fill: C.printOnRed, weight: 700 })
// OLED
emit(`<rect x="5284" y="1134" width="498" height="256" rx="10" fill="${C.oledBezel}"/>`)
emit(`<rect x="5306" y="1154" width="454" height="216" rx="6" fill="${C.oled}"/>`)
text(5330, 1204, 'A:11', { size: 44, fill: C.oledText, anchor: 'start', weight: 600, style: 'font-family:monospace' })
text(5330, 1258, 'Nord Stage 4', { size: 46, fill: C.oledText, anchor: 'start', weight: 700, style: 'font-family:monospace' })
emit(`<line x1="5320" y1="1276" x2="5748" y2="1276" stroke="${C.oledText}" stroke-width="3" opacity="0.7"/>`)
text(5330, 1310, '\u25A4 1:02 B3 Soulful', { size: 30, fill: C.oledText, anchor: 'start', style: 'font-family:monospace' })
text(5330, 1344, '\u25A5 White Grand      XL', { size: 30, fill: C.oledText, anchor: 'start', style: 'font-family:monospace' })
text(5330, 1378, '\u25A7 2:35 Vista Pad Whl', { size: 30, fill: C.oledText, anchor: 'start', style: 'font-family:monospace' })
// dial + page/bank
knob(5124, 1240, 84, { deg: 140, scale: false })
text(5074, 1338, 'PROGRAM', { size: 25, fill: C.printOnRed, anchor: 'end', weight: 700 })
emit(`<rect x="5086" y="1314" width="84" height="32" rx="8" fill="none" stroke="${C.printOnRed}" stroke-width="3"/>`)
text(5128, 1338, 'LIST', { size: 24, fill: C.printOnRed, weight: 700 })
text(5126, 1330, '\u25C0 PAGE/CAT \u25B6', { size: 25, fill: C.printOnRed, weight: 700 })
btn(4990, 1344, 128, 78, 'dark')
btn(5130, 1344, 130, 78, 'dark')
text(5126, 1462, '\u25C0    BANK    \u25B6', { size: 25, fill: C.printOnRed, weight: 700 })
// live mode / num pad / layer scene
led(5008, 1481, 'red', false, 9); text(5028, 1490, 'LIVE MODE', { size: 25, fill: C.printOnRed, anchor: 'start', weight: 700 })
btn(5028, 1508, 136, 78, 'gray')
text(5096, 1636, 'NUM PAD', { size: 24, fill: C.printOnRed, weight: 700 })
text(5044, 1672, 'LAYER', { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
text(5044, 1700, 'SCENE II', { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
led(5020, 1690, 'red', false, 9)
btn(5024, 1704, 142, 88, 'dark')
led(5020, 1830, 'red', false, 9); text(5040, 1839, 'PEDAL', { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
// program buttons box
emit(`<rect x="5230" y="1478" width="608" height="352" rx="16" fill="none" stroke="#c9a9a4" stroke-width="4"/>`)
emit(`<rect x="5410" y="1456" width="250" height="46" rx="10" fill="${C.header}"/>`)
text(5535, 1490, 'PROGRAM', { size: 28, fill: C.headerText, weight: 700, spacing: 2 })
const progBtnX = [5244, 5388, 5532, 5676]
progBtnX.forEach((bx, i) => {
  led(bx + 24, 1532, 'red', i === 0, 9)
  text(bx + 46, 1541, String(i + 1), { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
  btn(bx, 1562, 132, 86, 'dark')
  text(bx + 66, 1682, ['SYSTEM', 'SOUND', 'ORGANIZE', 'AUX KB'][i], { size: 22, fill: C.printOnRed, weight: 700 })
  led(bx + 24, 1700, 'red', false, 9)
  text(bx + 46, 1709, String(i + 5), { size: 24, fill: C.printOnRed, anchor: 'start', weight: 700 })
  btn(bx, 1714, 132, 88, 'dark')
  text(bx + 66, 1826, ['OUTPUT', 'PEDAL', 'MIDI', 'EXTERN'][i], { size: 22, fill: C.printOnRed, weight: 700 })
})
// solo / edit column
emit(`<rect x="5864" y="1062" width="174" height="516" rx="20" fill="none" stroke="#c9a9a4" stroke-width="4"/>`)
led(5906, 1092, 'red', false, 9); text(5926, 1101, 'SOLO', { size: 25, fill: C.printOnRed, anchor: 'start', weight: 700 })
btn(5882, 1122, 138, 76, 'dark')
text(5951, 1238, 'UNDO', { size: 24, fill: C.printOnRed, weight: 700 })
led(5888, 1270, 'red', false, 9)
text(5906, 1272, 'SECTION', { size: 23, fill: C.printOnRed, anchor: 'start', weight: 700 })
text(5906, 1296, 'EDIT \u2963', { size: 23, fill: C.printOnRed, anchor: 'start', weight: 700 })
btn(5882, 1302, 138, 78, 'dark')
text(5951, 1420, 'LAYER INIT', { size: 23, fill: C.printOnRed, weight: 700 })
text(5951, 1450, 'MON/COPY', { size: 23, fill: C.printOnRed, weight: 700 })
btn(5882, 1462, 138, 78, 'dark')
text(5951, 1572, 'PASTE \u2963', { size: 23, fill: C.printOnRed, weight: 700 })
// shift
emit(`<rect x="5910" y="1610" width="110" height="216" rx="16" fill="none" stroke="#c9a9a4" stroke-width="4"/>`)
text(5965, 1646, 'SHIFT', { size: 25, fill: C.printOnRed, weight: 700 })
btn(5936, 1660, 60, 130, 'gray')
text(5965, 1816, 'EXIT', { size: 24, fill: C.printOnRed, weight: 700 })
emit(`</g>`)

/* --------------------------------------------------------------- synth -- */
emit(`<g id="synth">`)
text(6119, 752, 'SYNTH', { size: 56, fill: C.headerText, anchor: 'start', weight: 700, spacing: 3 })
text(6119, 782, 'SECTION', { size: 26, fill: C.headerText, anchor: 'start', weight: 600, spacing: 3 })
text(6560, 742, 'FX FOCUS', { size: 26, fill: C.headerText, weight: 700 })
led(6560, 768, 'yellow', false, 9)
text(6684, 730, 'ON', { size: 26, fill: C.headerText, weight: 700 })
led(6684, 756, 'red', true, 9)
btn(6714, 702, 136, 72, 'dark')
text(6890, 748, 'SOLO \u25BD', { size: 26, fill: C.headerText, anchor: 'start', weight: 700 })

// layer levels A/B/C
fader(6129, 800, 1160, 826)
ladder(6213, 810, 1136, 12, 12)
fader(6303, 800, 1160, 1090)
ladder(6389, 810, 1136, 12, 3)
fader(6480, 800, 1160, 914)
ladder(6563, 810, 1136, 12, 8)
const synthAux = [
  [6092, 'A'], [6266, 'B'], [6442, 'C'],
]
synthAux.forEach(([bx, l]) => {
  text(bx + 12, 1240, l, { size: 34, weight: 700 })
  text(bx + 64, 1240, 'AUX KB', { size: 24, anchor: 'start', weight: 600 })
  emit(`<rect x="${bx}" y="1252" width="146" height="34" rx="17" fill="none" stroke="${C.boxLine}" stroke-width="3"/>`)
  led(bx + 24, 1269, 'yellow', true, 9)
  text(bx + 84, 1278, 'ON/OFF \u25BE', { size: 23, weight: 700 })
  btn(bx + 10, 1304, 128, 62, 'gray')
})
led(6098, 1390, 'red', true, 9); text(6116, 1399, 'SUSTPED', { size: 24, anchor: 'start', weight: 700 })
led(6256, 1390, 'red', true, 9); text(6274, 1399, 'PSTICK/RNG \u25BD', { size: 24, anchor: 'start', weight: 700 })
text(6500, 1399, 'PAN \u25BE', { size: 24, anchor: 'start', weight: 700 })

// kb hold / arp run / octave shift
emit(`<rect x="6076" y="1456" width="180" height="40" rx="8" fill="none" stroke="${C.frameRed}" stroke-width="4"/>`)
led(6098, 1476, 'red', false, 9); text(6116, 1485, 'KB HOLD', { size: 24, anchor: 'start', weight: 700 })
text(6290, 1485, 'ARP RUN', { size: 24, anchor: 'start', weight: 700 })
btn(6094, 1502, 142, 86, 'dark')
btn(6276, 1508, 130, 60, 'red')
led(6098, 1624, 'red', false, 9); text(6116, 1633, 'EXCLUDE \u25BD', { size: 23, anchor: 'start', weight: 700 })
led(6280, 1624, 'red', false, 9); text(6298, 1633, 'KB SYNC \u25BD', { size: 23, anchor: 'start', weight: 700 })
text(6253, 1668, '\u25C0 OCTAVE SHIFT \u25B6', { size: 26, weight: 700 })
btn(6116, 1680, 130, 86, 'dark')
btn(6258, 1680, 132, 86, 'dark')
text(6253, 1800, '\u25C0 KB ZONE \u25B6', { size: 25, weight: 700 })
for (let i = 0; i < 4; i++) led(6175 + i * 52, 1824, 'green', i > 1, 9)

// synth OLED + soft encoders
emit(`<rect x="6726" y="808" width="498" height="258" rx="10" fill="${C.oledBezel}"/>`)
emit(`<rect x="6748" y="828" width="454" height="218" rx="6" fill="${C.oled}"/>`)
emit(`<rect x="6800" y="842" width="350" height="38" rx="4" fill="${C.oledText}" opacity="0.85"/>`)
text(6975, 872, 'OSC WAVEFORM', { size: 28, fill: C.oled, weight: 700, style: 'font-family:monospace' })
text(6772, 936, 'Super Saw', { size: 42, fill: C.oledText, anchor: 'start', weight: 700, style: 'font-family:monospace' })
text(6772, 982, 'DETUNE: 3.4', { size: 28, fill: C.oledText, anchor: 'start', style: 'font-family:monospace' })
text(6810, 1032, 'ANALOG', { size: 24, fill: C.oledText, style: 'font-family:monospace' })
text(6975, 1032, 'SUPER', { size: 24, fill: C.oledText, style: 'font-family:monospace' })
text(7140, 1032, '1 (5)', { size: 24, fill: C.oledText, style: 'font-family:monospace' })
// waveform staircase glyph
for (let i = 0; i < 5; i++) emit(`<rect x="${7050 + i * 22}" y="${986 - i * 14}" width="16" height="${14 + i * 14}" fill="${C.oledText}" opacity="0.8"/>`)
// leader lines from screen to encoders
emit(`<path d="M 6880 1066 Q 6820 1160 6748 1230" fill="none" stroke="${C.printDim}" stroke-width="4"/>`)
emit(`<path d="M 6975 1066 L 6975 1230" fill="none" stroke="${C.printDim}" stroke-width="4"/>`)
emit(`<path d="M 7080 1066 Q 7150 1160 7208 1230" fill="none" stroke="${C.printDim}" stroke-width="4"/>`)
knob(6738, 1338, 62, { deg: 0, scale: false })
knob(6977, 1337, 62, { deg: 0, scale: false })
knob(7213, 1336, 62, { deg: 0, scale: false })
text(6738, 1432, 'INFO', { size: 24, weight: 700 })
text(6977, 1432, 'LIST', { size: 24, weight: 700 })
text(7213, 1432, 'LIST', { size: 24, weight: 700 })

// mode box
box(7275, 830, 185, 250, 'MODE')
led(7310, 876, 'red', false, 8); text(7328, 885, 'SAMPLES', { size: 24, anchor: 'start', weight: 700 })
led(7310, 921, 'red', true, 8); text(7328, 930, 'ANALOG', { size: 24, anchor: 'start', weight: 700 })
btn(7286, 950, 136, 74, 'dark')
led(7310, 1056, 'red', false, 8); text(7328, 1065, 'EXTERN', { size: 24, anchor: 'start', weight: 700 })

// arpeggiator / gate
box(7478, 830, 722, 272, 'ARPEGGIATOR/GATE')
knob(7580, 978, 54, { deg: -30 })
text(7590, 1064, 'RATE/TIME', { size: 24, weight: 700 })
led(7532, 1056, 'red', true, 8)
emit(`<rect x="7506" y="1070" width="150" height="34" rx="6" fill="${C.frameRed}"/>`)
text(7581, 1096, 'MST CLK', { size: 23, fill: '#fff', weight: 700 })
led(7700, 890, 'red', false, 8); text(7718, 899, 'POLY', { size: 24, anchor: 'start', weight: 700 })
led(7700, 932, 'red', true, 8); text(7718, 941, 'ARP', { size: 24, anchor: 'start', weight: 700 })
emit(`<rect x="7800" y="912" width="86" height="32" rx="6" fill="#20242a" stroke="${C.boxLine}" stroke-width="2"/>`)
text(7843, 936, 'GATE', { size: 23, weight: 700 })
btn(7698, 950, 140, 82, 'dark')
text(7768, 1064, 'PATTERN \u25BD', { size: 23, weight: 700 })
// range knob wears a red printed arc (photo: red ring segments at its top)
emit(`<path d="M 7906 924 A 88 88 0 0 1 8034 924" fill="none" stroke="${C.frameRed}" stroke-width="14"/>`)
knob(7970, 978, 54, { deg: 40 })
text(7930, 1062, 'RANGE', { size: 24, anchor: 'end', weight: 700 })
emit(`<rect x="7944" y="1038" width="76" height="30" rx="6" fill="#20242a" stroke="${C.boxLine}" stroke-width="2"/>`)
text(7982, 1061, 'ENV', { size: 22, weight: 700 })
led(8106, 880, 'red', false, 8); text(8124, 889, 'MENU', { size: 24, anchor: 'start', weight: 700 })
btn(8094, 906, 70, 144, 'redframe')
text(8129, 1084, 'GROUP \u25BD', { size: 23, weight: 700 })

// voice + vibrato
box(7478, 1125, 416, 260, 'VOICE')
led(7530, 1176, 'red', false, 8); text(7548, 1185, 'MONO', { size: 24, anchor: 'start', weight: 700 })
led(7530, 1218, 'red', false, 8); text(7548, 1227, 'LEGATO', { size: 24, anchor: 'start', weight: 700 })
btn(7500, 1248, 140, 84, 'dark')
text(7526, 1364, 'LO \u25BD', { size: 22, anchor: 'start', weight: 700 })
text(7620, 1364, 'HI \u25BD', { size: 22, anchor: 'start', weight: 700 })
knob(7773, 1272, 58, { deg: 10 })
text(7773, 1370, 'GLIDE', { size: 24, weight: 700 })
box(7906, 1125, 294, 260, 'VIBRATO')
led(7932, 1170, 'red', false, 8); text(7950, 1179, 'WHL', { size: 23, anchor: 'start', weight: 700 })
led(7932, 1208, 'red', false, 8); text(7950, 1217, 'DLY', { size: 23, anchor: 'start', weight: 700 })
led(7932, 1246, 'red', false, 8); text(7950, 1255, 'ON', { size: 23, anchor: 'start', weight: 700 })
text(8030, 1179, 'A.T.', { size: 23, anchor: 'start', weight: 700 })
text(8030, 1217, 'PED', { size: 23, anchor: 'start', weight: 700 })
btn(7912, 1258, 140, 84, 'dark')
led(8104, 1190, 'red', false, 8); text(8122, 1199, 'MENU', { size: 23, anchor: 'start', weight: 700 })
btn(8092, 1200, 72, 144, 'redframe')
text(8128, 1378, 'GROUP \u25BD', { size: 23, weight: 700 })

// waveform / sound init column
text(7388, 1128, 'WAVEFORM', { size: 24, weight: 700 })
led(7312, 1150, 'red', true, 8)
text(7330, 1158, 'KEEP EDITS \u25BE', { size: 22, anchor: 'start', weight: 700 })
btn(7352, 1166, 72, 144, 'redframe')
text(7388, 1348, 'SOUND', { size: 23, weight: 700 })
text(7388, 1376, 'INIT', { size: 23, weight: 700 })

// bottom boxes: LFO / OSCILLATORS / FILTER / AMP / UNISON
box(6450, 1410, 432, 414, 'LFO')
led(6462, 1452, 'red', false, 8); text(6480, 1461, 'WAVEFORM', { size: 24, anchor: 'start', weight: 700 })
btn(6478, 1470, 136, 78, 'redframe')
led(6462, 1584, 'red', false, 8); text(6480, 1593, 'GROUP \u25BD', { size: 23, anchor: 'start', weight: 700 })
knob(6785, 1520, 52, { deg: 60 })
text(6785, 1608, 'MOD AMT', { size: 23, weight: 700 })
led(6740, 1590, 'red', false, 8)
knob(6566, 1700, 52, { deg: -70 })
led(6504, 1754, 'red', true, 8)
emit(`<rect x="6490" y="1770" width="150" height="34" rx="6" fill="${C.frameRed}"/>`)
text(6565, 1796, 'MST CLK', { size: 23, fill: '#fff', weight: 700 })
text(6700, 1650, 'RATE/TIME', { size: 22, anchor: 'start', weight: 700 })
text(6700, 1698, 'OSC PITCH', { size: 22, anchor: 'start', weight: 700 })
text(6700, 1726, 'OSC CTRL', { size: 22, anchor: 'start', weight: 700 })
text(6700, 1754, 'FILTER', { size: 22, anchor: 'start', weight: 700 })
btn(6716, 1738, 136, 76, 'dark')

box(6906, 1410, 476, 414, 'OSCILLATORS')
led(6930, 1452, 'red', true, 8); text(6948, 1461, 'PITCH/SMP', { size: 24, anchor: 'start', weight: 700 })
btn(6954, 1478, 138, 76, 'redframe')
led(6930, 1592, 'red', false, 8); text(6948, 1601, 'ENV TO PITCH \u25BD', { size: 21, anchor: 'start', weight: 700 })
led(7180, 1452, 'red', false, 8); text(7198, 1461, 'ENVELOPE', { size: 24, anchor: 'start', weight: 700 })
btn(7198, 1476, 138, 78, 'redframe')
led(7180, 1592, 'red', false, 8); text(7198, 1601, 'VELOCITY \u25BD', { size: 21, anchor: 'start', weight: 700 })
knob(7022, 1741, 56, { deg: 0 })
text(7022, 1836, 'OSC CTRL', { size: 22, weight: 700 })
knob(7269, 1735, 48, { deg: -45 })
text(7269, 1836, 'OSC PITCH', { size: 22, weight: 700 })

box(7404, 1408, 586, 416, 'FILTER')
led(7412, 1452, 'red', true, 8); text(7430, 1461, 'TYPE', { size: 24, anchor: 'start', weight: 700 })
btn(7430, 1476, 136, 78, 'redframe')
led(7412, 1592, 'red', false, 8); text(7430, 1601, 'GROUP \u25BD', { size: 22, anchor: 'start', weight: 700 })
led(7614, 1452, 'red', false, 8); text(7632, 1461, 'ENVELOPE', { size: 24, anchor: 'start', weight: 700 })
btn(7632, 1476, 136, 78, 'redframe')
led(7614, 1592, 'red', false, 8); text(7632, 1601, 'VELOCITY \u25BD', { size: 22, anchor: 'start', weight: 700 })
knob(7903, 1521, 52, { deg: 30 })
text(7903, 1608, 'ENV AMT', { size: 22, weight: 700 })
knob(7536, 1742, 60, { deg: -20 })
text(7536, 1840, 'FREQ', { size: 23, weight: 700 })
knob(7779, 1730, 50, { deg: 15 })
text(7779, 1836, 'RES/FREQHP', { size: 22, weight: 700 })
led(7886, 1652, 'red', true, 8); text(7904, 1638, 'FILTER', { size: 22, anchor: 'start', weight: 700 }); text(7904, 1662, 'ON', { size: 22, anchor: 'start', weight: 700 })
btn(7892, 1672, 70, 142, 'gray')

box(8012, 1408, 184, 206, 'AMP')
led(8024, 1452, 'red', false, 8); text(8042, 1461, 'ENVELOPE', { size: 23, anchor: 'start', weight: 700 })
btn(8036, 1476, 136, 78, 'redframe')
text(8100, 1590, 'VELOCITY \u25BD', { size: 21, weight: 700 })
led(8046, 1606, 'red', false, 7); text(8060, 1613, '1', { size: 21, anchor: 'start', weight: 700 })
led(8134, 1592, 'red', true, 7); text(8148, 1599, '2', { size: 21, anchor: 'start', weight: 700 })
box(8010, 1634, 184, 188, 'UNISON')
led(8060, 1676, 'red', true, 8); text(8042, 1683, '2', { size: 22, anchor: 'end', weight: 700 })
led(8114, 1690, 'red', false, 8); text(8132, 1697, '3', { size: 22, anchor: 'start', weight: 700 })
led(8060, 1712, 'red', false, 8); text(8042, 1719, '1', { size: 22, anchor: 'end', weight: 700 })
btn(8032, 1738, 144, 80, 'dark')
emit(`</g>`)

/* ------------------------------------------------------ fx focus strip -- */
emit(`<g id="fx-strip">`)
text(8303, 800, 'FX FOCUS', { size: 30, fill: C.printOnRed, weight: 700, spacing: 2 })
text(8303, 906, 'ORGAN', { size: 26, fill: C.printOnRed, weight: 700 })
text(8303, 940, 'A    B', { size: 24, fill: C.printOnRed, weight: 700 })
led(8262, 933, 'yellow', false, 8); led(8344, 933, 'yellow', false, 8)
btn(8244, 958, 136, 76, 'dark')
text(8303, 1066, 'ALL FX OFF', { size: 24, fill: C.printOnRed, weight: 700 })
text(8303, 1146, 'PIANO', { size: 26, fill: C.printOnRed, weight: 700 })
text(8303, 1180, 'A    B', { size: 24, fill: C.printOnRed, weight: 700 })
led(8262, 1173, 'yellow', false, 8); led(8344, 1173, 'yellow', false, 8)
btn(8242, 1204, 138, 78, 'dark')
text(8303, 1312, 'GROUP \u25BD', { size: 24, fill: C.printOnRed, weight: 700 })
text(8303, 1392, 'SYNTH', { size: 26, fill: C.printOnRed, weight: 700 })
text(8303, 1426, 'A   B   C', { size: 24, fill: C.printOnRed, weight: 700 })
led(8252, 1419, 'yellow', true, 8); led(8303, 1419, 'yellow', true, 8); led(8354, 1419, 'yellow', true, 8)
btn(8240, 1452, 138, 78, 'dark')
text(8303, 1560, 'GROUP \u25BD', { size: 24, fill: C.printOnRed, weight: 700 })
emit(`<rect x="8252" y="1616" width="110" height="210" rx="16" fill="none" stroke="#c9a9a4" stroke-width="4"/>`)
text(8307, 1652, 'SHIFT', { size: 25, fill: C.printOnRed, weight: 700 })
btn(8280, 1664, 60, 126, 'gray')
text(8307, 1818, 'EXIT', { size: 24, fill: C.printOnRed, weight: 700 })
emit(`</g>`)

/* ------------------------------------------------------------- effects -- */
emit(`<g id="effects">`)
text(8470, 752, 'LAYER EFFECTS', { size: 50, fill: C.headerText, anchor: 'start', weight: 700, spacing: 3 })
text(8480, 800, 'FX FOCUS', { size: 24, fill: C.print, anchor: 'start', weight: 700 })
led(8778, 746, 'red', true, 9)
btn(8802, 700, 136, 72, 'dark')
text(8970, 748, 'ON', { size: 26, fill: C.headerText, anchor: 'start', weight: 700 })

/** one MOD row (MOD1/MOD2): rate + amount knobs, selector, variation, on */
function modRow(y, title, names, tags, tagBoxed, selRow) {
  box(8414, y, 782, title === 'MOD 1' ? 293 : 265, title)
  knob(8516, y + 122, 62, { deg: -25 })
  text(8516, y + 236, 'RATE', { size: 24, weight: 700 })
  knob(8754, y + 120, 62, { deg: 20 })
  text(8754, y + 236, 'AMOUNT', { size: 24, weight: 700 })
  led(8470, y + 218, 'red', false, 8)
  led(8706, y + 218, 'red', false, 8)
  triSelector(8930, y + 36, 3, selRow, 0)
  names.forEach((n, i) => text(8916, y + 62 + i * 42, n, { size: 24, anchor: 'end', weight: 700 }))
  tags.forEach((t, i) => {
    if (tagBoxed[i]) {
      emit(`<rect x="9002" y="${y + 40 + i * 42}" width="${t.length * 15 + 24}" height="34" rx="6" fill="#20242a" stroke="${C.boxLine}" stroke-width="2"/>`)
      text(9002 + (t.length * 15 + 24) / 2, y + 66 + i * 42, t, { size: 22, weight: 700 })
    } else {
      text(9006, y + 66 + i * 42, t, { size: 24, anchor: 'start', weight: 700 })
    }
  })
  btn(8892, y + 172, 140, 84, 'dark')
  text(8962, y + 292 - 8, `\u2514 VARIATION ${title === 'MOD 1' ? 'PED \u25BD' : '\u25BD'}`, { size: 22, weight: 700 })
  text(9146, y + 92, 'ON', { size: 24, anchor: 'end', weight: 700 })
  led(9162, y + 86, 'red', true, 8)
  btn(9116, y + 124, 60, 128, 'gray')
}
modRow(792, 'MOD 1', ['RM', 'TREM', 'A-PAN'], ['A-WAH', 'WAH', 'PUMP'], [true, true, true], 2)
modRow(1085, 'MOD 2', ['CHOR', 'FLANG', 'PHAS'], ['VIBE', 'ENS', 'SPIN'], [false, false, false], 0)

// AMP SIM / EQ
box(8414, 1350, 782, 469, 'AMP SIM/EQ')
knob(8520, 1518, 64, { deg: -15 })
text(8520, 1634, 'DRIVE', { size: 24, weight: 700 })
led(8474, 1614, 'red', false, 8)
knob(8759, 1520, 64, { deg: 30 })
text(8722, 1638, 'FREQ', { size: 24, anchor: 'end', weight: 700 })
emit(`<rect x="8734" y="1614" width="76" height="32" rx="6" fill="#20242a" stroke="${C.boxLine}" stroke-width="2"/>`)
text(8772, 1638, 'FREQ', { size: 22, weight: 700 })
triSelector(8962, 1382, 3, 2, 0)
text(8948, 1408, 'SMALL', { size: 24, anchor: 'end', weight: 700 })
text(8948, 1450, 'JC', { size: 24, anchor: 'end', weight: 700 })
text(8948, 1492, 'TWIN', { size: 24, anchor: 'end', weight: 700 })
emit(`<rect x="9034" y="1386" width="160" height="34" rx="6" fill="${C.frameRed}"/>`)
text(9114, 1412, 'TO ROTARY', { size: 22, fill: '#fff', weight: 700 })
emit(`<rect x="9034" y="1428" width="140" height="34" rx="6" fill="#20242a" stroke="${C.boxLine}" stroke-width="2"/>`)
text(9104, 1454, 'LP FILTER', { size: 22, weight: 700 })
emit(`<rect x="9034" y="1470" width="140" height="34" rx="6" fill="#20242a" stroke="${C.boxLine}" stroke-width="2"/>`)
text(9104, 1496, 'HP FILTER', { size: 22, weight: 700 })
btn(8922, 1506, 146, 86, 'dark')
text(8996, 1628, '\u2514 VARIATION \u25BD', { size: 22, weight: 700 })
knob(8526, 1745, 56, { deg: -10 })
text(8526, 1842, 'BASS', { size: 23, weight: 700 })
knob(8762, 1744, 56, { deg: 25 })
text(8730, 1842, 'MID', { size: 23, anchor: 'end', weight: 700 })
emit(`<rect x="8744" y="1818" width="66" height="30" rx="6" fill="#20242a" stroke="${C.boxLine}" stroke-width="2"/>`)
text(8777, 1841, 'RES', { size: 21, weight: 700 })
knob(8999, 1743, 56, { deg: 10 })
text(8999, 1842, 'TREBLE', { size: 23, weight: 700 })
text(9152, 1608, 'ON', { size: 24, anchor: 'end', weight: 700 })
led(9168, 1602, 'red', true, 8)
btn(9096, 1630, 82, 146, 'gray')

// DELAY
box(9199, 792, 667, 556, 'DELAY')
knob(9333, 989, 62, { deg: -35 })
text(9333, 1096, 'TEMPO', { size: 24, weight: 700 })
led(9287, 1078, 'red', false, 8)
emit(`<rect x="9258" y="1112" width="150" height="34" rx="6" fill="${C.frameRed}"/>`)
text(9333, 1138, 'MST CLK', { size: 23, fill: '#fff', weight: 700 })
text(9548, 852, 'EFFECTS', { size: 24, weight: 700 })
triSelector(9520, 870, 3, 1, 0)
text(9506, 896, 'CHOR', { size: 23, anchor: 'end', weight: 700 })
text(9506, 938, 'VIBE', { size: 23, anchor: 'end', weight: 700 })
text(9506, 980, 'ENS', { size: 23, anchor: 'end', weight: 700 })
text(9598, 916, 'FLAM', { size: 23, anchor: 'start', weight: 700 })
text(9598, 958, 'SPACE', { size: 23, anchor: 'start', weight: 700 })
btn(9468, 998, 144, 86, 'dark')
text(9540, 1118, 'VARIATION \u25BD', { size: 22, weight: 700 })
knob(9779, 922, 56, { deg: 45 })
text(9779, 1022, 'FEEDBACK', { size: 23, weight: 700 })
text(9756, 1064, 'FILTER', { size: 24, weight: 700 })
led(9718, 1088, 'red', false, 7); text(9732, 1095, 'HP', { size: 22, anchor: 'start', weight: 700 })
led(9798, 1102, 'red', false, 7); text(9812, 1109, 'BP', { size: 22, anchor: 'start', weight: 700 })
led(9718, 1128, 'red', true, 7); text(9732, 1135, 'LP', { size: 22, anchor: 'start', weight: 700 })
btn(9674, 1152, 144, 84, 'dark')
text(9746, 1272, 'PING PONG \u25BD', { size: 22, weight: 700 })
// tap/set sub-box
emit(`<rect x="9236" y="1134" width="178" height="190" rx="14" fill="none" stroke="${C.boxLine}" stroke-width="4"/>`)
led(9262, 1168, 'red', false, 8); text(9280, 1177, 'TAP/SET \u25BE', { size: 23, anchor: 'start', weight: 700 })
btn(9256, 1194, 136, 74, 'dark')
led(9262, 1296, 'red', false, 8); text(9280, 1305, 'ANALOG \u25BD', { size: 23, anchor: 'start', weight: 700 })
knob(9554, 1258, 56, { deg: 20, scale: false })
led(9500, 1318, 'red', false, 8); text(9518, 1327, 'DRY', { size: 22, anchor: 'start', weight: 700 })
text(9590, 1327, 'WET', { size: 22, anchor: 'start', weight: 700 })
text(9700, 1288, 'ON', { size: 23, anchor: 'end', weight: 700 })
led(9672, 1296, 'red', true, 8)
btn(9708, 1254, 128, 60, 'gray')
emit(`<rect x="9694" y="1322" width="150" height="32" rx="6" fill="${C.frameRed}"/>`)
text(9769, 1346, 'GLOBAL \u25BD', { size: 21, fill: '#fff', weight: 700 })

// COMP
box(9199, 1348, 225, 470, 'COMP')
led(9240, 1398, 'red', false, 8); text(9258, 1407, 'ACTIVE', { size: 23, anchor: 'start', weight: 700 })
knob(9332, 1574, 66, { deg: -20 })
text(9332, 1690, 'AMOUNT', { size: 22, weight: 700 })
led(9250, 1716, 'red', false, 7); text(9264, 1723, 'FAST', { size: 21, anchor: 'start', weight: 700 })
btn(9252, 1732, 146, 66, 'dark')
text(9310, 1814, 'GLOBAL \u25BD', { size: 20, weight: 700 })

// REVERB
box(9424, 1381, 442, 437, 'REVERB')
led(9448, 1424, 'red', false, 8); text(9466, 1433, 'BRIGHT', { size: 23, anchor: 'start', weight: 700 })
led(9448, 1466, 'red', false, 8); text(9466, 1475, 'DARK', { size: 23, anchor: 'start', weight: 700 })
triSelector(9702, 1408, 3, 2, 0)
text(9688, 1434, 'ROOM', { size: 23, anchor: 'end', weight: 700 })
text(9688, 1476, 'BOOTH', { size: 23, anchor: 'end', weight: 700 })
text(9688, 1518, 'SPRING', { size: 23, anchor: 'end', weight: 700 })
text(9780, 1434, 'STAGE', { size: 23, anchor: 'start', weight: 700 })
text(9780, 1476, 'HALL', { size: 23, anchor: 'start', weight: 700 })
text(9780, 1518, 'CATH', { size: 23, anchor: 'start', weight: 700 })
btn(9460, 1496, 148, 88, 'dark')
btn(9664, 1538, 146, 90, 'dark')
text(9737, 1662, 'VAR|CHORALE \u25BD', { size: 22, weight: 700 })
knob(9551, 1744, 60, { deg: 15, scale: false })
text(9482, 1840, 'DRY', { size: 22, anchor: 'end', weight: 700 })
text(9620, 1840, 'WET', { size: 22, anchor: 'start', weight: 700 })
led(9660, 1732, 'red', true, 8); text(9678, 1712, 'ON', { size: 23, anchor: 'start', weight: 700 })
btn(9692, 1690, 148, 66, 'gray')
emit(`<rect x="9684" y="1770" width="150" height="32" rx="6" fill="${C.frameRed}"/>`)
text(9759, 1794, 'GLOBAL \u25BD', { size: 21, fill: '#fff', weight: 700 })
emit(`</g>`)

// vertical made-in print on the right margin
emit(`<text x="9920" y="1830" font-size="26" fill="${C.printOnRed}" font-weight="600" letter-spacing="2" transform="rotate(-90 9920 1830)">HANDMADE IN SWEDEN BY CLAVIA DMI AB   v2.0 Rev.B</text>`)

/* -------------------------------------------------------------- keybed -- */
emit(`<g id="keybed">`)
const KEY_X0 = 1565
const KEY_X1 = 10037
const N_WHITE = 43
const PITCH = (KEY_X1 - KEY_X0) / N_WHITE
const KEY_TOP = 2027
const KEY_BOT = 3232
const BLACK_H = 762
const BLACK_W = 118
// white keys (E1..E7): separators as gaps over a dark base
emit(`<rect x="${KEY_X0}" y="${KEY_TOP}" width="${KEY_X1 - KEY_X0}" height="${KEY_BOT - KEY_TOP}" fill="${C.keyGap}"/>`)
for (let i = 0; i < N_WHITE; i++) {
  const x = KEY_X0 + i * PITCH
  emit(`<rect x="${(x + 3).toFixed(1)}" y="${KEY_TOP}" width="${(PITCH - 6).toFixed(1)}" height="${KEY_BOT - KEY_TOP}" rx="6" fill="url(#keyFront)"/>`)
}
// black keys: E-to-E layout. A black key sits on the boundary after white
// index i (E=0): F#,G#,A# at boundaries 1,2,3 and C#,D# at 5,6 — with the
// real acoustic offsets: F#/C# lean left, A#/D# lean right, G# centered.
const blackOffsets = new Map([
  [1, -0.16], // F#
  [2, 0], // G#
  [3, 0.16], // A#
  [5, -0.14], // C#
  [6, 0.14], // D#
])
for (let i = 1; i < N_WHITE; i++) {
  const off = blackOffsets.get(i % 7)
  if (off === undefined) continue
  const bx = KEY_X0 + i * PITCH - BLACK_W / 2 + off * PITCH
  emit(`<rect x="${bx.toFixed(1)}" y="${KEY_TOP}" width="${BLACK_W}" height="${BLACK_H}" rx="8" fill="url(#blackKey)"/>`)
  emit(`<rect x="${(bx + 16).toFixed(1)}" y="${KEY_TOP}" width="${BLACK_W - 32}" height="${BLACK_H - 90}" rx="6" fill="${C.keyBlackHi}" opacity="0.35"/>`)
}
// front slot under the keys
emit(`<rect x="1565" y="${KEY_BOT}" width="8472" height="63" fill="${C.slot}"/>`)
emit(`</g>`)

/* ------------------------------------- benchmark section splits (hidden) */
emit(`<g id="sections" display="none">`)
const DECK_X0 = 1296
const DECK_W = 9008
const fractions = [
  ['performance', 0.14], ['organ', 0.2], ['piano', 0.085], ['program', 0.125], ['synth', 0.25], ['effects', 0.2],
]
let acc = 0
for (const [name, f] of fractions) {
  const x0 = DECK_X0 + acc * DECK_W
  acc += f
  const x1 = DECK_X0 + acc * DECK_W
  emit(`<line x1="${x1.toFixed(0)}" y1="468" x2="${x1.toFixed(0)}" y2="2004" stroke="#00e5ff" stroke-width="6" stroke-dasharray="28 22"/>`)
  emit(`<text x="${((x0 + x1) / 2).toFixed(0)}" y="440" font-size="52" fill="#00e5ff" text-anchor="middle" font-weight="700">${name} ${f}</text>`)
}
emit(`</g>`)

emit(`</svg>`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, out.join('\n') + '\n')
console.log(`wrote ${OUT} (${(out.join('\n').length / 1024).toFixed(1)} KB)`)
