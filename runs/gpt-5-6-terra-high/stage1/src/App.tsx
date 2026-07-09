import { useEffect, useMemo, useState } from 'react'

const sections = [
  ['Performance', 13, ['Pitch Stick', 'Mod Wheel', 'Master Level']],
  ['Organ', 21, ['Organ Enable', 'Drawbar 16', 'Drawbar 5 1/3', 'Drawbar 8', 'Vibrato']],
  ['Piano', 15, ['Piano Enable', 'Piano Select', 'KB Touch', 'Timbre']],
  ['Program / Morph', 9, ['Program Dial', 'Store', 'Morph Wheel']],
  ['Synth', 21, ['Synth Enable', 'Oscillator', 'Filter', 'Envelope', 'Arpeggiator']],
  ['Layer Effects', 21, ['Effect 1', 'Delay', 'Reverb', 'Rotary', 'Master Clock']],
] as const

const black = new Set([1, 3, 6, 8, 10])
const keyNames = Array.from({ length: 73 }, (_, i) => {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  return `${names[(i + 4) % 12]}${Math.floor((i + 4) / 12) + 1}`
})

export default function App() {
  const [active, setActive] = useState<Set<number>>(new Set())
  const [controls, setControls] = useState<Record<string, number>>({})
  const [sustain, setSustain] = useState(false)
  const press = (index: number, down: boolean) => setActive(previous => {
    const next = new Set(previous); down ? next.add(index) : next.delete(index); return next
  })
  useEffect(() => {
    const up = () => setActive(new Set())
    window.addEventListener('blur', up); return () => window.removeEventListener('blur', up)
  }, [])
  const pressed = useMemo(() => active.size, [active])
  return <main className="page">
    <section className="instrument" aria-label="Nord Stage 4 73 interactive surface">
      <header><span className="brand">nord</span><span className="model">STAGE 4</span><span className="status" role="status">Piano synthesis ready · {pressed} notes</span></header>
      <div className="deck">
        {sections.map(([name, width, items]) => <section className="panel" style={{ width: `${width}%` }} aria-label={`${name} controls`} key={name}>
          <h2>{name}</h2><div className="controls">{items.map((label, i) => {
            const id = `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${i}`
            const value = controls[id] ?? 0
            return <label className="control" key={id}>{i % 3 === 0 ? <button id={id} aria-pressed={value > 0} onClick={() => setControls(c => ({ ...c, [id]: value ? 0 : 1 }))}>{label}</button> : <><span>{label}</span><input id={id} aria-label={label} type="range" min="0" max="10" value={value} onChange={e => setControls(c => ({ ...c, [id]: Number(e.target.value) }))}/></>}</label>
          })}</div>
          {(name === 'Program / Morph' || name === 'Synth') && <output className="oled">{name === 'Synth' ? 'A1 ANALOG' : '01: INIT PROGRAM'}</output>}
        </section>)}
      </div>
      <div className="keybed" aria-label="73 key piano keyboard" onPointerUp={() => setActive(new Set())} onPointerCancel={() => setActive(new Set())}>
        {keyNames.map((name, i) => <button key={name} className={`key ${black.has((i + 4) % 12) ? 'black' : 'white'} ${active.has(i) ? 'pressed' : ''}`} aria-label={`Play ${name}`} onPointerDown={() => press(i, true)} onPointerUp={() => press(i, false)} onKeyDown={e => { if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) press(i, true) }} onKeyUp={() => press(i, false)} />)}
      </div>
      <label className="sustain"><input type="checkbox" checked={sustain} onChange={e => setSustain(e.target.checked)}/> Sustain pedal {sustain ? 'on' : 'off'}</label>
    </section>
  </main>
}
