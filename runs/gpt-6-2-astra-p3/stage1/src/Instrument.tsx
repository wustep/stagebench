import { memo } from 'react'
import { keys } from './hardware'
import { Materials, Panel } from './Panel'
import type { Piano } from './piano'
const Deck = memo(Panel)
const white = 1696 / 43
const keyOrder = [...keys].sort((a, b) => Number(a.black) - Number(b.black))
export function Instrument({
  piano,
  pressed,
}: {
  piano: Piano | null
  pressed: Set<number>
}) {
  return (
    <svg
      id="instrument"
      className="instrument"
      viewBox="0 0 1800 582"
      role="group"
      aria-label="Nord Stage 4 73 hammer-action keyboard"
    >
      <Materials />
      <g fill="#282728">
        {[
          56, 107, 286, 308, 332, 357, 399, 444, 469, 539, 619, 899, 1164, 1243,
          1458, 1687, 1743,
        ].map((x, i) => (
          <rect
            key={x}
            x={x}
            y={i === 7 || i === 11 ? 1 : 11}
            width={i === 7 || i === 11 ? 45 : 13}
            height="18"
            rx="5"
          />
        ))}
      </g>
      <rect
        x="1"
        y="15"
        width="1798"
        height="565"
        rx="13"
        fill="url(#mat-metal)"
      />
      <rect x="33" y="291" width="1734" height="283" rx="6" fill="#1e1114" />
      <path
        d="M24 23H1776V309Q1769 315 1750 313H48Q27 315 24 309Z"
        fill="url(#deck-paint)"
      />
      <path d="M29 26 H1771" stroke="#ce6d70" opacity=".47" strokeWidth="2" />
      <path d="M32 304H1766" stroke="#4a111b" strokeWidth="5" />
      <g
        fill="#f1d9d3"
        fontFamily="Arial"
        fontWeight="bold"
        textAnchor="middle"
        fontSize="4.4"
      >
        {[
          'MONITOR IN',
          'HEADPHONES',
          'OUT 1',
          'OUT 2',
          'OUT 3',
          'OUT 4',
          'CONTROL PEDAL',
          'ORGAN SWELL',
          'SUSTAIN PEDAL',
          'TRIPLE PEDAL',
          'MIDI IN',
          'MIDI OUT',
          'ROTOR PEDAL',
          'USB',
          'FOOT SWITCH',
          'AC IN',
          'POWER ON/OFF',
        ].map((s, i) => (
          <text
            key={s}
            x={
              [
                244, 275, 303, 325, 350, 375, 404, 432, 461, 491, 658, 686, 717,
                748, 778, 1108, 1184,
              ][i]
            }
            y="50"
          >
            {s}
          </text>
        ))}
      </g>
      <Deck />
      <g fill="#454246" stroke="#ab6261" strokeWidth=".7">
        {[247, 365, 523, 644, 805, 994, 1086, 1393, 1603].map((x) => (
          <circle key={x} cx={x} cy="291" r="2" />
        ))}
      </g>
      {[1, 1768].map((x) => (
        <g key={x}>
          <rect
            x={x}
            y="15"
            width="31"
            height="563"
            rx="8"
            fill="url(#mat-cheek)"
          />
          <path d={`M${x + 28} 24v544`} stroke="#441019" opacity=".8" />
          <path d={`M${x + 4} 32v528`} stroke="#af4045" opacity=".6" />
        </g>
      ))}
      <g id="keybed" role="group" aria-label="73 piano keys, E1 to E7">
        <rect
          x="0"
          y="311"
          width="1800"
          height="271"
          fill="none"
          pointerEvents="none"
        />
        {keyOrder.map((k) => {
          const w = k.black ? white * 0.62 : white - 1.25,
            h = k.black ? 156 : 256,
            x = 53 + k.index * white - (k.black ? w / 2 : 0),
            active = pressed.has(k.midi)
          const off = (id: number) => piano?.off('pointer:' + id)
          return (
            <g
              key={k.id}
              role="button"
              aria-label={k.name}
              aria-pressed={active}
              tabIndex={0}
              id={k.id}
              data-note={k.midi}
              data-color={k.black ? 'black' : 'white'}
              className="piano-key"
              transform={`translate(${x} 311)`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                piano?.on(
                  'pointer:' + e.pointerId,
                  k.midi,
                  e.pointerType === 'pen'
                    ? Math.max(24, Math.round(e.pressure * 127))
                    : 96,
                )
              }}
              onPointerUp={(e) => off(e.pointerId)}
              onPointerCancel={(e) => off(e.pointerId)}
              onLostPointerCapture={(e) => off(e.pointerId)}
              onKeyDown={(e) => {
                if ([' ', 'Enter'].includes(e.key)) {
                  e.preventDefault()
                  if (!e.repeat) piano?.on(k.id, k.midi, 94)
                }
              }}
              onKeyUp={(e) => {
                if ([' ', 'Enter'].includes(e.key)) {
                  e.preventDefault()
                  piano?.off(k.id)
                }
              }}
              onBlur={() => piano?.off(k.id)}
              onClick={(e) => {
                if (
                  e.detail === 0 &&
                  !active &&
                  e.nativeEvent.type === 'click'
                ) {
                  piano?.on('assist:' + k.id, k.midi, 94)
                  piano?.off('assist:' + k.id)
                }
              }}
            >
              <title>{k.name}</title>
              <rect
                width={w}
                height={h - (active ? 4 : 0)}
                rx={k.black ? 1.6 : 2.6}
                fill={
                  active
                    ? k.black
                      ? '#1b191b'
                      : '#cbc7be'
                    : k.black
                      ? '#0c0b0c'
                      : 'url(#key-white)'
                }
              />
              {k.black && (
                <path
                  d={`M2 1 H${w - 2} L${w - 3.6} ${h - 11} Q${w - 4} ${h - 5} ${w - 5} ${h - 4} H4 Z`}
                  fill={active ? '#222021' : 'url(#key-black)'}
                  stroke="#47413e"
                  strokeWidth=".7"
                />
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
