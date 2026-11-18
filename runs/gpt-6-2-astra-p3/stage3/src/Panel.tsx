import { Performance, exclusions } from './performance'
import { address } from './programs'
import { waves } from './patches'
import { Live, binding, tap } from './bindings'
import { models, fxLayer } from './settings'
import { memo, useContext, useRef, useState, type KeyboardEvent } from 'react'
import {
  controls,
  groups,
  initialPanel,
  legends,
  sections,
  type Control,
} from './hardware'

const materials: Record<string, string[]> = {
  metal: ['#571119', '#a04448', '#96272f', '#891b29', '#74151e', '#4a0911'],
  cheek: ['#540e13', '#94262e', '#862028', '#62131c'],
  plate: ['#474e59', '#414954', '#353b45'],
  silver: ['#c1c6cd', '#a6afbc', '#7d8799'],
  rubber: ['#74716e', '#413e3b', '#2d2a28', '#1c1b1c', '#0b0a0c'],
  black: ['#535052', '#333134', '#232225', '#111114'],
  ivory: ['#eeece2', '#d6d3c8', '#bcbab0', '#8e8c84'],
  brown: ['#534440', '#382e2f', '#241f20', '#130f11'],
  red: ['#da6861', '#b64943', '#8b2529', '#561619'],
  wood: ['#976842', '#daa16a', '#e4b687', '#9a6949'],
  wheel: ['#232023', '#8f8588', '#ded5d1', '#5c5355', '#282326'],
}
export function Materials() {
  return (
    <defs>
      {Object.entries(materials).map(([id, colors]) => (
        <linearGradient
          id={'mat-' + id}
          key={id}
          x2={id === 'cheek' || id === 'wheel' ? '100%' : '0%'}
          y2={id === 'cheek' || id === 'wheel' ? '0%' : '100%'}
        >
          {colors.map((color, i) => (
            <stop key={i} offset={i / (colors.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      ))}
      <linearGradient id="deck-paint" x2="0" y2="1">
        <stop stopColor="#ae4e52" />
        <stop offset=".047" stopColor="#a33540" />
        <stop offset=".069" stopColor="#8d2732" />
        <stop offset=".83" stopColor="#861f30" />
        <stop offset=".94" stopColor="#821b2a" />
        <stop offset=".974" stopColor="#6b1522" />
        <stop offset="1" stopColor="#360d14" />
      </linearGradient>
      <linearGradient id="key-white" x2="0" y2="1">
        <stop stopColor="#99948e" />
        <stop offset=".045" stopColor="#ccc8c1" />
        <stop offset=".15" stopColor="#eeeae3" />
        <stop offset=".93" stopColor="#e5e2db" />
        <stop offset=".985" stopColor="#d3d0c9" />
        <stop offset="1" stopColor="#bbb8b0" />
      </linearGradient>
      <linearGradient id="key-black" x2="0" y2="1">
        <stop stopColor="#0c0b0c" />
        <stop offset=".08" stopColor="#3a3736" />
        <stop offset=".92" stopColor="#292625" />
        <stop offset=".94" stopColor="#383533" />
        <stop offset="1" stopColor="#151315" />
      </linearGradient>
    </defs>
  )
}
const mat = (s: string) => 'url(#mat-' + s + ')'
function Ink({
  x,
  y,
  children,
  size = 4.8,
  fill = '#e3e1de',
  bold = true,
}: {
  x: number
  y: number
  children: React.ReactNode
  size?: number
  fill?: string
  bold?: boolean
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontFamily="Arial, sans-serif"
      fontSize={size}
      fontWeight={bold ? 700 : 500}
      fill={fill}
    >
      {children}
    </text>
  )
}
function Lamp({
  x,
  y,
  lit = false,
  green = false,
}: {
  x: number
  y: number
  lit?: boolean
  green?: boolean
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r="1.9"
      stroke="#202427"
      strokeWidth=".5"
      fill={lit ? (green ? '#bbda53' : '#ff6656') : '#635754'}
    />
  )
}
function SliderCap({
  c,
  value,
  range,
}: {
  c: Control
  value: number
  range: number[]
}) {
  const bar = c.kind === 'drawbar',
    reach = c.height - (bar ? 34 : 13),
    offset = reach * ((bar ? -1 : 1) * (0.5 - value / 100))
  return (
    <>
      <rect
        x={-3}
        y={-c.height / 2}
        width={6}
        height={c.height}
        fill="#151719"
        stroke="#555763"
      />
      {bar && (
        <rect
          x="4.2"
          y={-c.height / 2 - 2}
          width="14.5"
          height="63.5"
          rx=".8"
          fill="#a4a3a1"
          stroke="#24262b"
          strokeWidth="1"
        />
      )}
      {Array.from({ length: bar ? 9 : 13 }, (_, i) => (
        <g key={i}>
          <rect
            x={bar ? 10 : 12}
            y={-c.height / 2 + i * (bar ? 6.7 : 5.9)}
            width={bar ? 6 : 4}
            height={bar ? 5.4 : 4.6}
            stroke={
              range.length &&
              (bar ? i : (1 - i / 12) * 100) >= Math.min(...range) &&
              (bar ? i : (1 - i / 12) * 100) <= Math.max(...range)
                ? '#b8e371'
                : undefined
            }
            strokeWidth={1}
            fill={
              (bar ? i < Math.round(value * 0.08) : i >= (1 - value / 100) * 13)
                ? bar
                  ? '#f66a58'
                  : '#b1d94e'
                : bar
                  ? '#78413d'
                  : '#515744'
            }
          />
          {bar && (
            <Ink
              x={7.5}
              y={-c.height / 2 + i * 6.7 + 4.3}
              size={4.9}
              fill="#2f3135"
            >
              {i}
            </Ink>
          )}
        </g>
      ))}
      <g transform={`translate(0 ${offset})`}>
        <rect
          x={-c.width / 2 + 1}
          y={bar ? -14 : -4}
          width={c.width}
          height={bar ? 35 : 14}
          rx="2"
          fill="#131315"
          opacity=".7"
        />
        <rect
          x={-c.width / 2}
          y={bar ? -17 : -7}
          width={c.width}
          height={bar ? 34 : 14}
          rx="1.8"
          fill={mat(bar ? c.finish : 'ivory')}
          stroke="#332c2b"
        />
        <path
          d={`M${-c.width * 0.45} 0h${c.width * 0.9}`}
          stroke={bar ? '#9c9990' : '#555354'}
          strokeOpacity=".65"
        />
      </g>
    </>
  )
}
const Physical = memo(function Physical({
  c,
  value,
  change,
  description,
}: {
  c: Control
  value: number
  description?: string
  change: (id: string, v: number, shift?: boolean) => void
}) {
  const panel = useContext(Performance)
  const range = panel?.range(c.id) ?? []
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    long = useRef(false)
  const drag = useRef<{ y: number; value: number; scale: number } | null>(null)
  const button = c.kind === 'button',
    r = c.width / 2,
    light = c.section === 'synth' && c.y >= 209 && c.x > 1030
  const ink = light ? '#242935' : '#f0e9e4'
  const label = c.legend.toUpperCase()
  const layerButton = /^Layer [ABC] on$/.test(c.name)
  const sectionSwitch = c.name === 'Section on'
  const update = (v: number, shift = false) =>
    change(
      c.id,
      Math.min(
        100,
        Math.max(0, c.id === 'program-program-dial' ? v : Math.round(v)),
      ),
      shift,
    )
  function keyboard(e: KeyboardEvent<SVGGElement>) {
    if (button && [' ', 'Enter'].includes(e.key)) {
      e.preventDefault()
      if (!e.repeat) update(value ? 0 : 100, e.shiftKey)
      return
    }
    if (button) return
    const values: Record<string, number> = {
      ArrowUp: value + 5,
      ArrowRight: value + 5,
      ArrowDown: value - 5,
      ArrowLeft: value - 5,
      Home: 0,
      End: 100,
      PageUp: value + 20,
      PageDown: value - 20,
    }
    if (e.key in values) {
      e.preventDefault()
      const discrete =
        c.id === 'program-program-dial' && panel
          ? description?.endsWith(' BPM')
            ? 1 / 2.7
            : description?.endsWith(' st')
              ? 100 / 12
              : 100 / (panel.bank.slots.length - 1)
          : c.kind === 'drawbar'
            ? 12.5
            : c.id === 'synth-category'
              ? 25
              : c.id === 'synth-arp-range'
                ? 100 / 3
                : 5
      update(
        e.key.startsWith('Arrow')
          ? value + (values[e.key] > value ? discrete : -discrete)
          : values[e.key],
        e.shiftKey,
      )
    }
  }
  return (
    <g
      transform={`translate(${c.x} ${c.y})`}
      id={c.id}
      data-kind={c.kind}
      data-morph={range.length ? true : undefined}
      role={button ? 'button' : 'slider'}
      tabIndex={0}
      aria-label={c.section + ' ' + c.name}
      aria-pressed={button ? !!value : undefined}
      aria-description={description}
      aria-valuetext={button ? undefined : description}
      aria-valuemin={button ? undefined : 0}
      aria-valuemax={button ? undefined : 100}
      aria-valuenow={button ? undefined : value}
      aria-orientation={button ? undefined : 'vertical'}
      className="physical"
      onKeyDown={keyboard}
      onClick={(e) => {
        if (long.current) {
          long.current = false
          return
        }
        if (c.id.startsWith('program-morph-') && e.detail === 2) return
        if (button) update(value ? 0 : 100, e.shiftKey)
      }}
      onPointerDown={(e) => {
        if (button) {
          long.current = false
          if (
            c.id === 'program-split' ||
            c.id === 'program-master-clock' ||
            c.id.startsWith('program-morph-')
          ) {
            hold.current = setTimeout(() => {
              long.current = true
              if (c.id === 'program-split') panel?.open('Splits and zones')
              else panel?.command(c.id)
            }, 350)
          }
          return
        }
        if (e.shiftKey && c.id === 'program-program-dial') {
          panel?.open('Program list')
          return
        }
        e.currentTarget.setPointerCapture(e.pointerId)
        const scale = e.currentTarget.getScreenCTM()?.a || 1
        const local =
          (e.clientY - e.currentTarget.getBoundingClientRect().top) / scale
        const next = ['fader', 'drawbar'].includes(c.kind)
          ? Math.max(
              0,
              Math.min(
                100,
                c.kind === 'drawbar'
                  ? (local / c.height) * 100
                  : 100 - (local / c.height) * 100,
              ),
            )
          : value
        update(next)
        drag.current = { y: e.clientY, value: next, scale }
      }}
      onPointerUp={() => {
        clearTimeout(hold.current)
        if (long.current && c.id.startsWith('program-morph-'))
          panel?.command(c.id)
      }}
      onPointerCancel={() => clearTimeout(hold.current)}
      onPointerMove={(e) => {
        if (drag.current)
          update(
            drag.current.value +
              ((drag.current.y - e.clientY) / drag.current.scale) *
                (c.kind === 'drawbar' ? -1.4 : 1.4),
          )
      }}
      onLostPointerCapture={() => {
        if (drag.current && c.kind === 'pitch') update(50)
        drag.current = null
      }}
    >
      <title>
        {c.name} · {description ?? 'panel preview'}
      </title>
      <rect
        className="hit"
        x={-r - 1}
        y={layerButton ? -22 : -c.height / 2 - 1}
        width={c.width + 2}
        height={layerButton ? c.height / 2 + 23 : c.height + 2}
        fill="transparent"
        rx="2"
      />
      <g pointerEvents="none">
        {range.length > 0 && <Lamp x={-r} y={-r - 3} lit green />}
        {layerButton && (
          <>
            <rect
              x="-14"
              y="-16"
              width="29"
              height="6.5"
              rx="1"
              fill="#b6bdc5"
            />
            <Lamp x={-11} y={-12.6} lit={!!value} green />
            <Ink x={3} y={-11} fill="#30353c" size={4.4}>
              ON/OFF ▾
            </Ink>
            <Ink x={0} y={-19} size={4.8}>
              {c.name.split(' ')[1]} AUX KB •
            </Ink>
          </>
        )}
        {sectionSwitch && (
          <Ink x={-20} y={-1} fill="#242830">
            ON
          </Ink>
        )}
        {c.kind === 'knob' && (
          <>
            {Array.from({ length: 11 }, (_, i) =>
              c.section === 'effects' || (light && c.kind === 'knob') ? (
                <Ink
                  key={i}
                  x={Math.sin(((-134 + 26.8 * i) * Math.PI) / 180) * (r + 4)}
                  y={
                    -Math.cos(((-134 + 26.8 * i) * Math.PI) / 180) * (r + 4) +
                    1.3
                  }
                  size={3.9}
                  fill={ink}
                >
                  {i}
                </Ink>
              ) : (
                <path
                  key={i}
                  d={`M0 ${-r - 2}v-2`}
                  transform={`rotate(${-134 + 26.8 * i})`}
                  stroke={ink}
                  strokeWidth=".9"
                />
              ),
            )}
            <circle cx="1.3" cy="3" r={r + 1} fill="#151415" opacity=".85" />
            <circle
              r={r}
              fill={mat('rubber')}
              stroke="#666361"
              strokeWidth=".8"
            />
            <circle cy="-1" r={r * 0.82} fill="#353230" />
            <path
              d={`M0 ${-r + 1} v${r * 0.52}`}
              stroke="#f2ede8"
              strokeWidth="2.4"
              transform={`rotate(${-135 + value * 2.7})`}
            />
          </>
        )}
        {button && (
          <>
            {/^(Program [1-8]|Morph |Split$|Store$|Live mode|KB hold|Arp run|Ping pong|Layer focus)/i.test(
              c.name,
            ) && (
              <Lamp
                x={-r + 1}
                y={-c.height / 2 - 5}
                lit={!!value}
                green={c.name === 'Morph Wheel'}
              />
            )}

            {c.id === 'program-store' && panel?.bank.pending && (
              <rect
                className="store-pulse"
                x={-r - 2}
                y={-c.height / 2 - 2}
                width={c.width + 4}
                height={c.height + 4}
                fill="#ff8b6d"
              />
            )}
            <rect
              x={-r - 1.1}
              y={-c.height / 2 - 0.8}
              width={c.width + 2.2}
              height={c.height + 2.7}
              fill="#151619"
              stroke="#696568"
              rx="1"
            />
            <rect
              x={-r + 1.1}
              y={-c.height / 2 + (value ? 2 : 0)}
              width={c.width - 2.2}
              height={c.height - (value ? 3 : 1)}
              rx={Math.min(c.height / 3, 4)}
              fill={mat(value ? 'red' : c.finish)}
              stroke="#373233"
              strokeWidth=".85"
            />
            {value > 0 && <Lamp x={r - 3} y={-c.height / 2 + 3} lit />}
          </>
        )}
        {(c.kind === 'drawbar' || c.kind === 'fader') && (
          <SliderCap c={c} value={value} range={range} />
        )}
        {c.kind === 'pitch' && (
          <g transform="rotate(-15)">
            <rect
              x="-27"
              y="-10"
              width="54"
              height="21"
              fill="#230e12"
              rx="2"
            />
            <rect
              x={-21 + value * 0.11}
              y="-7"
              width="33"
              height="15"
              rx="4"
              fill={mat('wood')}
            />
          </g>
        )}
        {c.kind === 'wheel' && (
          <g transform="rotate(-14)">
            <rect x="-8" y="-41" width="16" height="82" rx="8" fill="#241318" />
            <ellipse
              cy={value * 0.08 - 4}
              rx="5.1"
              ry="33"
              fill={mat('wheel')}
            />
          </g>
        )}
        {label && !layerButton && !sectionSwitch && (
          <Ink
            x={0}
            y={
              c.kind === 'drawbar'
                ? c.height / 2 + 10
                : c.kind === 'knob' && c.y !== 88
                  ? r + 6
                  : -c.height / 2 - 3.3
            }
            fill={ink}
          >
            {label}
          </Ink>
        )}
      </g>
    </g>
  )
})
function Oled({ s }: { s: 'program' | 'synth' }) {
  const { settings, sound, feedback } = useContext(Live),
    layer = settings.layers[settings.focus]
  const panel = useContext(Performance),
    bank = panel?.bank
  const program = s === 'program',
    x = program ? 797 : 1086,
    y = program ? 144 : 80,
    w = program ? 101 : 99,
    h = 50
  return (
    <g
      id={s + '-oled'}
      aria-label={s + ' OLED'}
      transform={`translate(${x} ${y})`}
    >
      <rect
        width={w}
        height={h}
        fill="#101619"
        stroke="#6a6260"
        strokeWidth="1.6"
      />
      <rect x="3" y="3" width={w - 6} height="9" fill="#8aaeb8" />
      <text x="6" y="10" fontSize="6.5" fontFamily="monospace" fill="#17242a">
        {program
          ? (bank?.live
              ? 'LIVE ' + (bank.index + 1)
              : address(bank?.index ?? 0)) +
            ' ' +
            (bank?.dirty ? 'E' : '') +
            '  SCENE ' +
            (settings.scene ? 'II' : 'I')
          : 'SYNTH ' +
            'ABC'[settings.synthFocus] +
            ' / ' +
            (panel?.envelope?.replace('Env', ' ENV').toUpperCase() ?? 'ANALOG')}
      </text>
      <text x="5" y="25" fontSize="11" fontFamily="monospace" fill="#aac4c8">
        {program
          ? bank?.pending
            ? 'Store ' + address(bank.index)
            : bank?.slot.name
          : panel?.envelope
            ? 'A      D      R'
            : waves[settings.synth[settings.synthFocus].patch.wave].replace(
                ' (algorithm A)',
                '',
              )}
      </text>
      <path d={'M4 29h' + (w - 8)} stroke="#61838b" strokeWidth=".65" />
      <text x="6" y="39" fontSize="6.7" fill="#81a1ae" fontFamily="monospace">
        {program
          ? sound.startsWith('Sample error')
            ? 'Sample error'
            : panel?.assignSource
              ? 'Assign ' + panel.assignSource
              : feedback || models[layer.type]
          : panel?.envelope
            ? (['attack', 'decay', 'release'] as const)
                .map(
                  (k) =>
                    settings.synth[settings.synthFocus].patch[
                      panel.envelope as 'ampEnv'
                    ][k],
                )
                .join('     ')
            : ['LP12', 'LP24', 'HP', 'BP'][
                settings.synth[settings.synthFocus].patch.filterType
              ] +
              '  ' +
              ['Poly', 'Mono', 'Legato'][
                settings.synth[settings.synthFocus].patch.mode
              ]}
      </text>
      {program && <title>{models[layer.type]}</title>}
      {!program &&
        panel?.envelope &&
        (() => {
          const e =
            settings.synth[settings.synthFocus].patch[
              panel.envelope as 'ampEnv'
            ]
          return (
            <path
              d={`M6 47l${2 + e.attack / 6} -7l${2 + e.decay / 6} ${e.decay === 100 ? 0 : 4}h17l${2 + e.release / 6} ${e.decay === 100 ? 7 : 3}`}
              fill="none"
              stroke="#aac4c8"
            />
          )
        })()}
      {(!panel?.envelope || program) && (
        <path d="M6 44h17m3 0h10m3 0h4" stroke="#597480" />
      )}
    </g>
  )
}
function Backplate({ s }: { s: (typeof sections)[number] }) {
  const { settings, sound } = useContext(Live),
    layer = settings.layers[settings.focus]
  const { x, width, id } = s,
    bg = id !== 'performance' && id !== 'program',
    hdr =
      id === 'effects'
        ? 147
        : id === 'synth'
          ? 180
          : id === 'organ'
            ? 140
            : width - 5
  return (
    <g pointerEvents="none">
      {bg && (
        <>
          <rect
            x={x + 1}
            y="68"
            width={width - 4}
            height="218"
            rx="3"
            fill={mat('plate')}
            stroke="#8e6665"
            strokeWidth="1"
          />
          <path
            d={`M${x + 1} 77V59q0 -3 4 -3h${hdr - 4}v11h${width - hdr - 5}v10z`}
            fill={mat('silver')}
          />
          <text
            x={x + 5}
            y="68"
            fontSize="10.6"
            fontWeight="900"
            letterSpacing=".7"
            fill="#161a20"
          >
            {s.name.toUpperCase()}
          </text>
          <text
            x={x + 5}
            y="74.5"
            fontSize="5"
            fontWeight="bold"
            fill="#232832"
          >
            {id === 'effects' ? 'FX FOCUS' : 'SECTION'}
          </text>
          <Lamp
            x={
              id === 'organ'
                ? 351
                : id === 'piano'
                  ? 674
                  : id === 'synth'
                    ? 1078
                    : 1495
            }
            y={65}
            lit={
              id === 'piano'
                ? settings.section
                : id === 'effects'
                  ? settings.effects
                  : id === 'organ'
                    ? settings.organOn
                    : settings.synthOn
            }
          />
        </>
      )}
      {groups
        .filter((g) => g.section === id)
        .map((g) => (
          <g key={g.title}>
            <rect
              x={g.x}
              y={g.y}
              width={g.width}
              height={g.height}
              rx="2.8"
              fill={g.light ? mat('silver') : 'none'}
              stroke={g.light ? '#818694' : '#c0bfbe'}
              strokeWidth=".82"
            />
            <rect
              x={g.x + g.width / 2 - g.title.length * 1.72 - 2}
              y={g.y - 2}
              width={g.title.length * 3.44 + 4}
              height="7"
              fill={
                g.light
                  ? '#b4bdcb'
                  : id === 'program' || id === 'performance'
                    ? '#86232e'
                    : '#424953'
              }
            />
            <Ink
              x={g.x + g.width / 2}
              y={g.y + 3.3}
              size={5.7}
              fill={g.light ? '#252a33' : '#f1eeee'}
            >
              {g.title}
            </Ink>
          </g>
        ))}
      {legends
        .filter((l) => l.section === id)
        .map((l) => (
          <g key={l.x + '-' + l.y}>
            {l.lines.map((line, i) => (
              <Ink key={line} x={l.x} y={l.y + 6 * i}>
                {line.replaceAll('●', '•')}
              </Ink>
            ))}
          </g>
        ))}
      {id === 'organ' &&
        (() => {
          const p = settings.organ[settings.organFocus].patch
          return (
            <>
              <Lamp x={settings.organFocus ? 296 : 261} y={172} lit green />
              <Lamp
                x={[350, 350, 350, 357, 357, 357][p.model]}
                y={[108, 102, 96, 96, 108, 102][p.model]}
                lit
              />
              <Lamp
                x={[439, 427, 451, 451, 427, 439][p.vibMode]}
                y={
                  p.vibMode === 0 || p.vibMode === 3 || p.vibMode === 4
                    ? 108
                    : 102
                }
                lit
              />
              <Lamp
                x={251}
                y={196}
                lit={settings.organ[settings.organFocus].pedal}
              />
              <Lamp
                x={286}
                y={196}
                lit={settings.organ[settings.organFocus].stick}
              />
              {['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′'].map(
                (label, i) => (
                  <Ink key={i} x={326 + i * 29.1} y={158} size={5}>
                    {p.model === 2
                      ? 'REG ' + (i + 1)
                      : p.model === 1 && i > 6
                        ? ['FLUTE', 'REED'][i - 7]
                        : label}
                  </Ink>
                ),
              )}
            </>
          )
        })()}
      {id === 'synth' && (
        <>
          <Lamp x={975 + 35 * settings.synthFocus} y={172} lit green />
          <Lamp x={1200} y={94} lit />
          <Lamp
            x={965}
            y={196}
            lit={settings.synth[settings.synthFocus].pedal}
          />
          <Lamp
            x={1000}
            y={196}
            lit={settings.synth[settings.synthFocus].stick}
          />
        </>
      )}
      {id === 'piano' && (
        <g className={sound.startsWith('Sample error') ? 'type-failure' : ''}>
          <Lamp
            x={[672, 671, 674, 709, 709, 709][layer.type]}
            y={[200, 194, 188, 188, 194, 200][layer.type]}
            lit
          />
          <Lamp x={settings.focus === 0 ? 606 : 641} y={172} lit green />
          <Lamp
            x={[669, 667, 690][layer.touch]}
            y={[142, 136, 136][layer.touch]}
            lit
          />
          {layer.unison > 0 && (
            <Lamp
              x={layer.unison === 3 ? 723 : 703}
              y={layer.unison === 1 ? 96 : 90}
              lit
            />
          )}
          {layer.dyn > 0 && (
            <Lamp
              x={layer.dyn === 3 ? 722 : 704}
              y={layer.dyn === 1 ? 150 : 142}
              lit
            />
          )}
          {layer.timbre > 0 && (
            <Lamp x={641} y={[0, 228, 222, 216, 216, 222][layer.timbre]} lit />
          )}
          <Lamp x={588} y={196} lit={layer.pedal} />
          <Lamp x={626} y={196} lit={layer.stick} />
          <Lamp x={659} y={90} lit={layer.soft} />
          <Lamp x={659} y={96} lit={layer.res} />
        </g>
      )}
      {id === 'effects' &&
        (() => {
          const fx = fxLayer(settings).fx
          const indicators = [
            {
              id: 'mod1',
              x: 1536,
              y: 100,
              type: fx.mod1.type,
              rows: [2, 1, 0, 0, 1, 2],
            },
            {
              id: 'mod2',
              x: 1536,
              y: 158,
              type: fx.mod2.type,
              rows: [0, 1, 2, 0, 1, 2],
            },
            {
              id: 'amp',
              x: 1537,
              y: 211,
              type: fx.amp.type - 1,
              rows: [2, 1, 0, 1, 2, 0],
            },
            {
              id: 'reverb',
              x: 1692,
              y: 211,
              type: fx.reverb.type,
              rows: [1, 0, 2, 0, 1, 2],
            },
          ]
          return (
            <g>
              {indicators
                .filter((e) => e.type >= 0)
                .map((e) => (
                  <Lamp
                    key={e.id}
                    x={e.x + (e.type < 3 ? -2 : 3)}
                    y={e.y - 10 + e.rows[e.type] * 6 - 1.5}
                    lit
                  />
                ))}
              <Lamp
                x={1385}
                y={182}
                lit={
                  settings.target === 'Synth'
                    ? settings.synthGroup
                    : settings.target === 'Piano' && settings.group
                }
              />
              <Lamp x={1680} y={186} lit={settings.globals.includes('delay')} />
              <Lamp
                x={1588}
                y={277}
                lit={settings.globals.includes('compressor')}
              />
              <Lamp
                x={1679}
                y={278}
                lit={settings.globals.includes('reverb')}
              />
            </g>
          )
        })()}
      {['piano', 'synth', 'organ'].includes(id) &&
        [0, 1, 2, 3].map((i) => (
          <Lamp
            key={i}
            x={x + 23 + i * 6}
            y={281}
            lit={(() => {
              const l =
                id === 'piano'
                  ? settings.layers[settings.focus]
                  : id === 'organ'
                    ? settings.organ[settings.organFocus]
                    : settings.synth[settings.synthFocus]
              return (
                i >= l.zone[0] &&
                i <= l.zone[1] &&
                i <=
                  (settings.split
                    ? settings.points.filter((p) => p.on).length
                    : 0)
              )
            })()}
            green
          />
        ))}
      {id === 'performance' && (
        <>
          <text
            x="47"
            y="278"
            fontSize="29"
            fontWeight="500"
            textLength="142"
            lengthAdjust="spacingAndGlyphs"
            letterSpacing="-1.9"
            fill="#f5e9df"
          >
            nord stage 4
          </text>
          <text
            x="51"
            y="286"
            fontSize="4.3"
            letterSpacing="3.8"
            fill="#ecd9ce"
          >
            HAMMER ACTION
          </text>
        </>
      )}
      {(id === 'synth' || id === 'program') && <Oled s={id} />}
    </g>
  )
}
export function Panel() {
  const [values, setValues] = useState(initialPanel)
  const panel = useContext(Performance)
  const live = useContext(Live)
  const [lastControl, setLastControl] = useState('')
  const feedback =
    panel?.read(lastControl)?.label ??
    binding(lastControl, live.settings)?.label ??
    ''
  const tapped = useRef(0)
  function change(id: string, v: number, shift = false) {
    if (panel?.command(id, v, shift)) {
      setLastControl(id)
      return
    }
    const b = binding(id, live.settings)
    if (b) {
      live.change((n) => {
        b.write(n, v, shift || n.shift)
        setLastControl(id)
      })
    } else {
      if (id === 'effects-delay-tap') {
        const now = performance.now()
        if (tapped.current)
          live.change((n) => tap(n, (now - tapped.current) / 1000))
        tapped.current = now
      }
      setValues((old) => ({ ...old, [id]: v }))
    }
  }
  return (
    <Live.Provider value={{ ...live, feedback }}>
      <g id="control-deck" aria-label="Instrument control deck">
        <rect width="1800" height="311" fill="none" pointerEvents="none" />
        {sections.map((s) => (
          <g
            key={s.id}
            id={'section-' + s.id}
            data-section={s.id}
            role="group"
            aria-label={s.name}
          >
            <rect
              x={s.x}
              y="55"
              width={s.width}
              height="232"
              fill="none"
              pointerEvents="none"
            />
            <Backplate s={s} />
            {controls
              .filter((c) => c.section === s.id)
              .map((c) => (
                <Physical
                  key={c.id}
                  c={c}
                  value={
                    panel?.read(c.id)?.value ??
                    binding(c.id, live.settings)?.value ??
                    values[c.id]
                  }
                  description={
                    panel?.read(c.id)?.label ??
                    binding(c.id, live.settings)?.label ??
                    (exclusions[c.id]
                      ? 'Unsupported · ' + exclusions[c.id]
                      : undefined) ??
                    (c.id === 'piano-piano-model'
                      ? models[live.settings.layers[live.settings.focus].type]
                      : undefined)
                  }
                  change={change}
                />
              ))}
          </g>
        ))}
      </g>
    </Live.Provider>
  )
}
