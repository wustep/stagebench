import type { Keys } from './piano'
export const mapping: Record<string, number> = {
  KeyA: 60,
  KeyW: 61,
  KeyS: 62,
  KeyE: 63,
  KeyD: 64,
  KeyF: 65,
  KeyT: 66,
  KeyG: 67,
  KeyY: 68,
  KeyH: 69,
  KeyU: 70,
  KeyJ: 71,
  KeyK: 72,
  KeyO: 73,
  KeyL: 74,
  KeyP: 75,
  Semicolon: 76,
}
export function connectInputs(
  win: Window,
  piano: Keys,
  unlock: () => void,
  midi: () => Promise<MIDIAccess> | undefined,
  report: (s: string) => void,
) {
  let disposed = false,
    access: MIDIAccess | undefined
  const down = new Set<string>(),
    ports = new Map<string, MIDIInput>()
  function clear() {
    down.clear()
    piano.clear()
  }
  function keydown(e: KeyboardEvent) {
    if (
      e.defaultPrevented ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      win.document.querySelector('dialog[open]')
    )
      return
    if (
      e.code === 'Space' &&
      (e.target as Element)?.closest?.(
        'button,[role=button],[role=slider],summary',
      )
    )
      return
    if (e.code !== 'Space' && !(e.code in mapping)) return
    e.preventDefault()
    if (e.repeat || down.has(e.code)) return
    unlock()
    down.add(e.code)
    if (e.code === 'Space') piano.pedal('global', true)
    else piano.on(e.code, mapping[e.code], 94)
  }
  function keyup(e: KeyboardEvent) {
    if (!down.delete(e.code)) return
    if (e.code === 'Space') piano.pedal('global', false)
    else piano.off(e.code)
  }
  function sync() {
    if (!access || disposed) return
    const current = [...access.inputs.values()].filter(
      (p) => p.state !== 'disconnected',
    )
    let disconnected = false
    for (const [id, p] of ports)
      if (!current.includes(p)) {
        p.onmidimessage = null
        ports.delete(id)
        disconnected = true
      }
    if (disconnected) clear()
    for (const p of current) {
      ports.set(p.id, p)
      p.onmidimessage = (e) => {
        if (!e.data || e.data.length < 3) return
        const [cmd, n, v] = e.data,
          kind = cmd >> 4,
          domain = 'midi:' + p.id + ':' + (cmd & 15),
          key = domain + ':' + n
        if (kind === 9 && v > 0) piano.on(key, n, v, domain)
        else if (kind === 8 || kind === 9) piano.off(key)
        else if (kind === 11 && n === 64) piano.pedal(domain, v >= 64)
        else if (kind === 11 && (n === 120 || n === 123)) clear()
      }
    }
    report(
      current.length
        ? current.length +
            ' input' +
            (current.length === 1 ? '' : 's') +
            ' connected'
        : disconnected
          ? 'Disconnected'
          : 'No inputs',
    )
  }
  async function connect() {
    try {
      const request = midi()
      if (!request) {
        report('Unavailable')
        return
      }
      const result = await request
      if (disposed) return
      access = result
      access.onstatechange = sync
      sync()
    } catch {
      if (!disposed) report('Access denied')
    }
  }
  const hidden = () => {
    if (win.document.hidden) clear()
  }
  win.addEventListener('pointerdown', unlock, true)
  win.addEventListener('click', unlock, true)
  win.addEventListener('keydown', keydown)
  win.addEventListener('keyup', keyup)
  win.addEventListener('blur', clear)
  win.document.addEventListener('visibilitychange', hidden)
  void connect()
  return () => {
    disposed = true
    win.removeEventListener('pointerdown', unlock, true)
    win.removeEventListener('click', unlock, true)
    win.removeEventListener('keydown', keydown)
    win.removeEventListener('keyup', keyup)
    win.removeEventListener('blur', clear)
    win.document.removeEventListener('visibilitychange', hidden)
    if (access) access.onstatechange = null
    for (const p of ports.values()) p.onmidimessage = null
    ports.clear()
    clear()
  }
}
