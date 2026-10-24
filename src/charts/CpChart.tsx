import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useCallback, useMemo, useRef, useState } from 'react'

import { cpStations } from '../geometry/stations'
import { CP_STATIONS_PER_SURFACE } from '../ml/types'

/**
 * Surface pressure distribution.
 *
 * Drawn with the pressure axis inverted, which is the convention every aerodynamicist reads: suction
 * is up. d3 supplies the scales and the path generator; the axes are rendered as React elements
 * rather than letting d3 mutate the DOM, so React stays the only thing writing to it.
 *
 * The curve is the surrogate's prediction. When a solver result is available for the same design --
 * which is to say, for a stock section at a sampled incidence -- the exact distribution is drawn
 * behind it. That is the honest way to present an approximation: both curves on one axis, rather
 * than a sentence claiming the error is small.
 *
 * Hovering reads off the station under the cursor. The chordwise axis is linear but the stations are
 * cosine-clustered, so the nearest station is found by inverting that spacing rather than by scaling
 * an index.
 */

export interface CpChartProps {
  /** 128 values: upper surface first, each leading edge to trailing edge. */
  readonly cp: Float32Array | null
  /** Optional exact solver result for the same design, for comparison. */
  readonly reference?: readonly number[] | null
  readonly width?: number
  readonly height?: number
}

interface Readout {
  readonly x: number
  readonly upper: number
  readonly lower: number
  readonly referenceUpper: number | null
  readonly referenceLower: number | null
  readonly pixelX: number
}

/** Station index nearest a chordwise position, inverting the cosine clustering. */
function nearestStation(chord: number): number {
  const clamped = Math.min(Math.max(chord, 0), 1)
  const index = Math.round(((CP_STATIONS_PER_SURFACE - 1) * Math.acos(1 - 2 * clamped)) / Math.PI)
  return Math.min(Math.max(index, 0), CP_STATIONS_PER_SURFACE - 1)
}

// Room at the bottom for two lines of hover readout under the axis.
const MARGIN = { top: 12, right: 12, bottom: 42, left: 40 } as const

export function CpChart({ cp, reference = null, width = 320, height = 200 }: CpChartProps) {
  const stations = useMemo(() => Array.from(cpStations()), [])
  const svgRef = useRef<SVGSVGElement>(null)
  const [readout, setReadout] = useState<Readout | null>(null)

  const { xScale, yScale, upperPath, lowerPath, referenceUpper, referenceLower, ticks } =
    useMemo(() => {
      const innerWidth = width - MARGIN.left - MARGIN.right
      const innerHeight = height - MARGIN.top - MARGIN.bottom

      const values = cp ? Array.from(cp) : []
      const referenceValues = reference ? Array.from(reference) : []
      const all = [...values, ...referenceValues]
      // A fixed floor keeps the axis from jumping about as the suction peak moves, but a strong peak
      // still gets room.
      const minimum = Math.min(-1.5, ...(all.length ? all : [0]))
      const maximum = Math.max(1.05, ...(all.length ? all : [0]))

      const x = scaleLinear().domain([0, 1]).range([0, innerWidth])
      // Inverted: suction upward.
      const y = scaleLinear().domain([minimum, maximum]).range([0, innerHeight])

      const draw = line<number>()
        .x((_, index) => x(stations[index % CP_STATIONS_PER_SURFACE] ?? 0))
        .y((value) => y(value))

      const slice = (source: number[], surface: 'upper' | 'lower'): number[] =>
        surface === 'upper'
          ? source.slice(0, CP_STATIONS_PER_SURFACE)
          : source.slice(CP_STATIONS_PER_SURFACE)

      return {
        xScale: x,
        yScale: y,
        upperPath: values.length ? draw(slice(values, 'upper')) : null,
        lowerPath: values.length ? draw(slice(values, 'lower')) : null,
        referenceUpper: referenceValues.length ? draw(slice(referenceValues, 'upper')) : null,
        referenceLower: referenceValues.length ? draw(slice(referenceValues, 'lower')) : null,
        ticks: { x: x.ticks(5), y: y.ticks(5) },
      }
    }, [cp, reference, width, height, stations])

  const handleMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current
      if (!svg || !cp) return
      const bounds = svg.getBoundingClientRect()
      const inner = event.clientX - bounds.left - MARGIN.left
      const chord = xScale.invert(inner)
      if (chord < -0.02 || chord > 1.02) {
        setReadout(null)
        return
      }
      const index = nearestStation(chord)
      const station = stations[index] ?? 0
      setReadout({
        x: station,
        upper: cp[index] ?? Number.NaN,
        lower: cp[index + CP_STATIONS_PER_SURFACE] ?? Number.NaN,
        referenceUpper: reference ? (reference[index] ?? null) : null,
        referenceLower: reference ? (reference[index + CP_STATIONS_PER_SURFACE] ?? null) : null,
        pixelX: xScale(station),
      })
    },
    [cp, reference, stations, xScale],
  )

  const clearReadout = useCallback(() => {
    setReadout(null)
  }, [])

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      role="img"
      aria-label="Surface pressure distribution, pressure axis inverted"
      data-testid="cp-chart"
      onPointerMove={handleMove}
      onPointerLeave={clearReadout}
      style={{ touchAction: 'none' }}
    >
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {ticks.y.map((value) => (
          <g key={`y-${value}`} transform={`translate(0,${yScale(value)})`}>
            <line x2={width - MARGIN.left - MARGIN.right} stroke="#22303d" strokeWidth={0.5} />
            <text x={-6} dy="0.32em" textAnchor="end" fontSize={9} fill="#8b9bab">
              {value}
            </text>
          </g>
        ))}
        {ticks.x.map((value) => (
          <g
            key={`x-${value}`}
            transform={`translate(${xScale(value)},${height - MARGIN.top - MARGIN.bottom})`}
          >
            <line y2={4} stroke="#738698" />
            <text y={14} textAnchor="middle" fontSize={9} fill="#8b9bab">
              {value}
            </text>
          </g>
        ))}

        {/* Zero line, where the local pressure equals the freestream. */}
        <line
          x1={0}
          x2={width - MARGIN.left - MARGIN.right}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke="#738698"
          strokeDasharray="2 3"
        />

        {referenceUpper && <path d={referenceUpper} fill="none" stroke="#738698" strokeWidth={2} />}
        {referenceLower && <path d={referenceLower} fill="none" stroke="#738698" strokeWidth={2} />}
        {upperPath && <path d={upperPath} fill="none" stroke="#8ab4f8" strokeWidth={1.5} />}
        {lowerPath && (
          <path
            d={lowerPath}
            fill="none"
            stroke="#8ab4f8"
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
        )}

        {readout && (
          <g data-testid="cp-readout">
            <line
              x1={readout.pixelX}
              x2={readout.pixelX}
              y1={0}
              y2={height - MARGIN.top - MARGIN.bottom}
              stroke="#8b9bab"
              strokeWidth={0.5}
              strokeDasharray="2 2"
            />
            <circle cx={readout.pixelX} cy={yScale(readout.upper)} r={2.5} fill="#8ab4f8" />
            <circle cx={readout.pixelX} cy={yScale(readout.lower)} r={2.5} fill="#8ab4f8" />
          </g>
        )}

        <text x={4} y={10} fontSize={9} fill="#738698">
          −Cp
        </text>
        <text
          x={width - MARGIN.left - MARGIN.right - 4}
          y={height - MARGIN.top - MARGIN.bottom - 6}
          textAnchor="end"
          fontSize={9}
          fill="#738698"
        >
          x/c
        </text>
      </g>

      {readout && (
        <g
          transform={`translate(${MARGIN.left},${height - 16})`}
          fontFamily="var(--font-mono, monospace)"
          fontSize={8.5}
        >
          <text fill="#8b9bab">
            x/c {readout.x.toFixed(3)}
            <tspan fill="#8ab4f8" dx={6}>
              upper {readout.upper.toFixed(3)}
            </tspan>
            {readout.referenceUpper !== null && (
              <tspan fill="#738698" dx={4}>
                / {readout.referenceUpper.toFixed(3)}
              </tspan>
            )}
          </text>
          <text y={10} fill="#8b9bab">
            <tspan dx={28} />
            <tspan fill="#8ab4f8">lower {readout.lower.toFixed(3)}</tspan>
            {readout.referenceLower !== null && (
              <tspan fill="#738698" dx={4}>
                / {readout.referenceLower.toFixed(3)}
              </tspan>
            )}
          </text>
        </g>
      )}
    </svg>
  )
}
