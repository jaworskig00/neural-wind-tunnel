import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useMemo } from 'react'

import { cpStations } from '../geometry/stations'
import { CP_STATIONS_PER_SURFACE } from '../ml/types'

/**
 * Surface pressure distribution.
 *
 * Drawn with the pressure axis inverted, which is the convention every aerodynamicist reads: suction
 * is up. d3 supplies the scales and the path generator; the axes are rendered as React elements
 * rather than letting d3 mutate the DOM, so React stays the only thing writing to it.
 *
 * The curve is the surrogate's prediction. When a solver result is available for the same design the
 * exact distribution is overlaid, which is the honest way to show what the approximation costs.
 */

export interface CpChartProps {
  /** 128 values: upper surface first, each leading edge to trailing edge. */
  readonly cp: Float32Array | null
  /** Optional exact solver result for the same design, for comparison. */
  readonly reference?: Float32Array | null
  readonly width?: number
  readonly height?: number
}

const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 } as const

export function CpChart({ cp, reference = null, width = 320, height = 200 }: CpChartProps) {
  const stations = useMemo(() => Array.from(cpStations()), [])

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

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="Surface pressure distribution, pressure axis inverted"
      data-testid="cp-chart"
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
            <line y2={4} stroke="#5a6977" />
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
          stroke="#5a6977"
          strokeDasharray="2 3"
        />

        {referenceUpper && <path d={referenceUpper} fill="none" stroke="#5a6977" strokeWidth={2} />}
        {referenceLower && <path d={referenceLower} fill="none" stroke="#5a6977" strokeWidth={2} />}
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

        <text x={4} y={10} fontSize={9} fill="#5a6977">
          −Cp
        </text>
        <text
          x={width - MARGIN.left - MARGIN.right - 4}
          y={height - MARGIN.top - MARGIN.bottom - 6}
          textAnchor="end"
          fontSize={9}
          fill="#5a6977"
        >
          x/c
        </text>
      </g>
    </svg>
  )
}
