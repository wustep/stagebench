import { useEffect, useState, useRef, useCallback } from 'react'
import './styles.css'
import { PianoAudio } from './audio'
import { calculateLayout, KEYBOARD_MAP, STAGE4_73_SPEC, isBlackKey, getNoteForKeyIndex } from './hardware'
import type { HardwareState, InstrumentLayout } from './types'

export default function App() {
  const [layout, setLayout] = useState<InstrumentLayout | null>(null)
  const [state, setState] = useState<HardwareState>({
    notes: new Map(),
    keyboard: {},
    sustain: false,
    masterLevel: 0.5,
    controls: new Map(),
    audioReady: false,
    audioError: null,
  })

  const audioRef = useRef<PianoAudio | null>(null)
  const activePointersRef = useRef<Map<string, number>>(new Map()) // pointer ID -> MIDI note
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Initialize audio and layout
  useEffect(() => {
    audioRef.current = new PianoAudio()

    const updateLayout = () => {
      setLayout(calculateLayout(window.innerWidth, window.innerHeight))
    }
    updateLayout()

    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [])

  // Update audio ready state
  useEffect(() => {
    if (audioRef.current) {
      const checkReady = () => {
        setState((prev) => ({
          ...prev,
          audioReady: audioRef.current!.isReady(),
          audioError: audioRef.current!.getError(),
        }))
      }

      checkReady()
      const interval = setInterval(checkReady, 100)
      return () => clearInterval(interval)
    }
  }, [])

  // Handle MIDI input
  useEffect(() => {
    const onMIDISuccess = (midiAccess: MIDIAccess) => {
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = (event: MIDIMessageEvent) => {
          if (!event.data || event.data.length < 3) return

          const cmd = event.data[0]
          const note = event.data[1]
          const velocity = event.data[2]
          const type = cmd & 0xf0

          if (type === 0x90 && velocity > 0) {
            // Note on
            audioRef.current?.noteOn(note, velocity)
          } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
            // Note off
            audioRef.current?.noteOff(note)
          } else if (type === 0xb0 && note === 64) {
            // Sustain pedal (CC 64)
            const sustain = velocity >= 64
            audioRef.current?.setSustain(sustain)
            setState((prev) => ({ ...prev, sustain }))
          }
        }
      }
    }

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(onMIDISuccess).catch(() => {
        // MIDI not available, continue without it
      })
    }
  }, [])

  // Keyboard input handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (KEYBOARD_MAP[key] !== undefined && !e.repeat) {
        const note = KEYBOARD_MAP[key]
        audioRef.current?.noteOn(note, 80)
      }

      // Sustain pedal
      if (key === ' ' && !e.repeat) {
        e.preventDefault()
        setState((prev) => {
          const newSustain = !prev.sustain
          audioRef.current?.setSustain(newSustain)
          return { ...prev, sustain: newSustain }
        })
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (KEYBOARD_MAP[key] !== undefined) {
        const note = KEYBOARD_MAP[key]
        audioRef.current?.noteOff(note)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Pointer input handler (mouse and touch)
  const getPointFromEvent = useCallback((e: PointerEvent | React.PointerEvent, layout: InstrumentLayout): number | null => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const keybed = layout.keybed
    if (x < keybed.x || x > keybed.x + keybed.width || y < keybed.y || y > keybed.y + keybed.height) {
      return null
    }

    // Calculate which key was touched
    const relX = x - keybed.x
    const keyIndex = Math.floor(relX / layout.keyGeometry.keySpacing)

    if (keyIndex >= 0 && keyIndex < STAGE4_73_SPEC.totalKeys) {
      return getNoteForKeyIndex(keyIndex)
    }

    return null
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!layout) return
      const note = getPointFromEvent(e as any, layout)
      if (note !== null) {
        activePointersRef.current.set(e.pointerId.toString(), note)
        audioRef.current?.noteOn(note, 80)
      }
    },
    [layout, getPointFromEvent]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!layout) return
      const pointerId = e.pointerId.toString()
      const oldNote = activePointersRef.current.get(pointerId)
      const newNote = getPointFromEvent(e as any, layout)

      if (oldNote !== newNote) {
        if (oldNote !== undefined) {
          audioRef.current?.noteOff(oldNote)
        }
        if (newNote !== null) {
          activePointersRef.current.set(pointerId, newNote)
          audioRef.current?.noteOn(newNote, 80)
        } else {
          activePointersRef.current.delete(pointerId)
        }
      }
    },
    [layout, getPointFromEvent]
  )

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const pointerId = e.pointerId.toString()
    const note = activePointersRef.current.get(pointerId)
    if (note !== undefined) {
      audioRef.current?.noteOff(note)
      activePointersRef.current.delete(pointerId)
    }
  }, [])

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    const pointerId = e.pointerId.toString()
    const note = activePointersRef.current.get(pointerId)
    if (note !== undefined) {
      audioRef.current?.noteOff(note)
      activePointersRef.current.delete(pointerId)
    }
  }, [])

  // Handle window blur - cleanup all notes
  useEffect(() => {
    const handleBlur = () => {
      audioRef.current?.allNotesOff()
      activePointersRef.current.clear()
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [])

  if (!layout) {
    return <div className="loading">Initializing layout...</div>
  }

  return (
    <main
      className="instrument-container"
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
        margin: 0,
        padding: 0,
      }}
    >
      <canvas
        ref={canvasRef}
        width={layout.viewport.x + layout.instrument.width + 50}
        height={layout.viewport.y + layout.instrument.height + 50}
        style={{
          display: 'block',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />

      <InstrumentRenderer canvas={canvasRef.current} layout={layout} state={state} />

      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          fontSize: '12px',
          color: '#666',
          fontFamily: 'monospace',
        }}
      >
        <div>Audio: {state.audioReady ? '✓ Ready' : '✗ Initializing'}</div>
        {state.audioError && <div style={{ color: 'red' }}>Error: {state.audioError}</div>}
        <div>Active notes: {state.notes.size}</div>
        <div>Sustain: {state.sustain ? 'ON' : 'OFF'}</div>
      </div>
    </main>
  )
}

interface InstrumentRendererProps {
  canvas: HTMLCanvasElement | null
  layout: InstrumentLayout
  state: HardwareState
}

function InstrumentRenderer({ canvas, layout, state }: InstrumentRendererProps) {
  useEffect(() => {
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.fillStyle = '#f5f5f5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw chassis
    drawChassis(ctx, layout)

    // Draw control deck sections
    drawControlDeck(ctx, layout)

    // Draw keybed
    drawKeybed(ctx, layout, state)

    // Draw status overlay
    drawStatusOverlay(ctx, canvas, state)
  }, [canvas, layout, state])

  return null
}

function drawChassis(ctx: CanvasRenderingContext2D, layout: InstrumentLayout) {
  const inst = layout.instrument

  // Main chassis body
  ctx.fillStyle = '#79232c'
  ctx.fillRect(inst.x, inst.y, inst.width, inst.height)

  // Top rail
  ctx.fillStyle = '#721f29'
  ctx.fillRect(inst.x, inst.y, inst.width, inst.height * 0.03)

  // Bottom rail
  ctx.fillRect(inst.x, inst.y + inst.height - inst.height * 0.03, inst.width, inst.height * 0.03)

  // End cheeks (left and right)
  ctx.fillRect(inst.x, inst.y, inst.width * 0.02, inst.height)
  ctx.fillRect(inst.x + inst.width - inst.width * 0.02, inst.y, inst.width * 0.02, inst.height)
}

function drawControlDeck(ctx: CanvasRenderingContext2D, layout: InstrumentLayout) {
  const sections = layout.sections

  // Draw control deck background
  ctx.fillStyle = '#3c424d'
  for (const [name, rect] of Object.entries(sections)) {
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

    // Section border
    ctx.strokeStyle = '#79232c'
    ctx.lineWidth = 2
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

    // Section label
    ctx.fillStyle = '#ccc'
    ctx.font = 'bold 10px sans-serif'
    ctx.fillText(name.toUpperCase(), rect.x + 5, rect.y + 15)
  }

  // Draw simplified control representations
  drawControlRepresentations(ctx, layout)
}

function drawControlRepresentations(ctx: CanvasRenderingContext2D, layout: InstrumentLayout) {
  const sections = layout.sections

  // Performance section
  const perf = sections.performance
  drawKnob(ctx, perf.x + perf.width * 0.5, perf.y + perf.height * 0.3, 15, 'Master')
  drawWheel(ctx, perf.x + perf.width * 0.3, perf.y + perf.height * 0.65, 12, 'Pitch')
  drawWheel(ctx, perf.x + perf.width * 0.7, perf.y + perf.height * 0.65, 12, 'Mod')

  // Organ section
  const organ = sections.organ
  for (let i = 0; i < 9; i++) {
    const x = organ.x + (i + 1) * (organ.width / 10)
    drawDrawbar(ctx, x, organ.y + organ.height * 0.4, 8, organ.height * 0.35)
  }

  // Piano section
  const piano = sections.piano
  drawButton(ctx, piano.x + piano.width * 0.3, piano.y + piano.height * 0.3, 12, 'A')
  drawButton(ctx, piano.x + piano.width * 0.7, piano.y + piano.height * 0.3, 12, 'B')
  drawKnob(ctx, piano.x + piano.width * 0.5, piano.y + piano.height * 0.65, 10, 'Level')

  // Program section
  const program = sections.program
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(program.x + program.width * 0.1, program.y + program.height * 0.1, program.width * 0.8, program.height * 0.4)
  ctx.fillStyle = '#00ff00'
  ctx.font = '10px monospace'
  ctx.fillText('PROGRAM', program.x + program.width * 0.15, program.y + program.height * 0.3)
  drawKnob(ctx, program.x + program.width * 0.5, program.y + program.height * 0.7, 12, '')

  // Synth section
  const synth = sections.synth
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(synth.x + synth.width * 0.1, synth.y + synth.height * 0.1, synth.width * 0.8, synth.height * 0.4)
  ctx.fillStyle = '#00ff00'
  ctx.fillText('SYNTH', synth.x + synth.width * 0.15, synth.y + synth.height * 0.3)

  // Effects section
  const effects = sections.effects
  drawKnob(ctx, effects.x + effects.width * 0.25, effects.y + effects.height * 0.4, 10, 'Delay')
  drawKnob(ctx, effects.x + effects.width * 0.5, effects.y + effects.height * 0.4, 10, 'Reverb')
  drawKnob(ctx, effects.x + effects.width * 0.75, effects.y + effects.height * 0.4, 10, 'Comp')
}

function drawKnob(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, label: string) {
  ctx.fillStyle = '#222'
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#555'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.fillStyle = '#888'
  ctx.fillRect(x - 2, y - radius + 2, 4, radius - 4)

  if (label) {
    ctx.fillStyle = '#aaa'
    ctx.font = '8px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, x, y + radius + 10)
  }
}

function drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, label: string) {
  ctx.fillStyle = '#333'
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#666'
  ctx.lineWidth = 2
  ctx.stroke()

  if (label) {
    ctx.fillStyle = '#aaa'
    ctx.font = '8px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, x, y + radius + 10)
  }
}

function drawDrawbar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = '#444'
  ctx.fillRect(x - width / 2, y, width, height)

  ctx.strokeStyle = '#666'
  ctx.lineWidth = 1
  ctx.strokeRect(x - width / 2, y, width, height)
}

function drawButton(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, label: string) {
  ctx.fillStyle = '#333'
  ctx.fillRect(x - size / 2, y - size / 2, size, size)

  ctx.strokeStyle = '#666'
  ctx.lineWidth = 1
  ctx.strokeRect(x - size / 2, y - size / 2, size, size)

  ctx.fillStyle = '#aaa'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y)
}

function drawKeybed(ctx: CanvasRenderingContext2D, layout: InstrumentLayout, state: HardwareState) {
  const keybed = layout.keybed
  const keyGeom = layout.keyGeometry

  // Keybed background
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(keybed.x, keybed.y, keybed.width, keybed.height)

  // Draw white keys first
  ctx.fillStyle = '#dcdcdc'
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1

  let xPos = keybed.x
  for (let i = 0; i < STAGE4_73_SPEC.totalKeys; i++) {
    const note = getNoteForKeyIndex(i)
    if (!isBlackKey(note)) {
      const keyWidth = keyGeom.keySpacing
      ctx.fillRect(xPos, keybed.y, keyWidth, keyGeom.keyHeight)
      ctx.strokeRect(xPos, keybed.y, keyWidth, keyGeom.keyHeight)

      // Pressed state
      if (state.notes.size > 0) {
        const noteArray = Array.from(state.notes.values())
        if (noteArray.some((n) => n.midiNote === note)) {
          ctx.fillStyle = '#aaa'
          ctx.fillRect(xPos, keybed.y + keyGeom.keyHeight * 0.9, keyWidth, keyGeom.keyHeight * 0.1)
        }
      }

      ctx.fillStyle = '#dcdcdc'
    }
    xPos += keyGeom.keySpacing
  }

  // Draw black keys
  ctx.fillStyle = '#0b0b0b'
  xPos = keybed.x
  for (let i = 0; i < STAGE4_73_SPEC.totalKeys; i++) {
    const note = getNoteForKeyIndex(i)
    if (isBlackKey(note)) {
      const keyWidth = keyGeom.keySpacing * 0.65
      const blackX = xPos - keyWidth / 2
      ctx.fillRect(blackX, keybed.y, keyWidth, keyGeom.blackKeyHeight)
      ctx.strokeRect(blackX, keybed.y, keyWidth, keyGeom.blackKeyHeight)
    }
    xPos += keyGeom.keySpacing
  }
}

function drawStatusOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: HardwareState) {
  // Bottom status bar
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.fillRect(0, canvas.height - 30, canvas.width, 30)

  ctx.fillStyle = '#fff'
  ctx.font = '12px monospace'
  ctx.fillText(`Notes: ${state.notes.size} | Sustain: ${state.sustain ? 'ON' : 'OFF'} | Audio: ${state.audioReady ? 'Ready' : 'Loading'}`, 10, canvas.height - 12)
}
