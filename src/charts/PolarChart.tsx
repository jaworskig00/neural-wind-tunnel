import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useMemo } from 'react'

import type { PolarPoint } from './usePolarSweep'

/**
 * The polars: lift against incidence, lift against drag, and the quarter-chord moment.
 *
 * Three small plots rather than one busy one. These are the curves an aerodynamicist reads to judge
 * a section, and the one that matters most is the middle one -- the drag polar -- where the useful
 * design is the left edge of the curve.
 *
 * The current operating point is marked on all three, so moving the incidence slider traces it
 * along the curve rather than redrawing everything.
 */

export interface PolarChartProps {
  readonly points: readonly PolarPoint[]
  readonly alphaDeg: number
  readonly width?: number
  readonly height?: number
  /** The exact solver's own sweep, where one exists for this section. */
  readonly reference?: readonly PolarPoint[] | null
}

const MARGIN = { top: 14, right: 10, bottom: 24, left: 36 } as const

interface PanelProps {
  readonly title: string
  readonly xLabel: string
  readonly points: readonly PolarPoint[]
  readonly reference: readonly PolarPoint[] | null
  readonly x: (point: PolarPoint) => number
  readonly y: (point: PolarPoint) => number
  readonly current: PolarPoint | null
  readonly width: number
  readonly height: number
}

function Panel({ title, xLabel, points, reference, x, y, current, width, height }: PanelProps) {
  const inner = {
    width: width - MARGIN.left - MARGIN.right,
    height: height - MARGIN.top - MARGIN.bottom,
  }

  const { xScale, yScale, path, referencePath } = useMemo(() => {
    const all = [...points, ...(reference ?? [])].filter(
      (point) => Number.isFinite(x(point)) && Number.isFinite(y(point)),
    )
    if (all.length === 0) {
      return { xScale: null, yScale: null, path: null, referencePath: null }
    }
    const xs = all.map(x)
    const ys = all.map(y)
    const horizontal = scaleLinear()
      .domain([Math.min(...xs), Math.max(...xs)])
      .nice()
      .range([0, inner.width])
    const vertical = scaleLinear()
      .domain([Math.min(...ys), Math.max(...ys)])
      .nice()
      .range([inner.height, 0])

    const draw = line<PolarPoint>()
      .defined((point) => Number.isFinite(x(point)) && Number.isFinite(y(point)))
      .x((point) => horizontal(x(point)))
      .y((point) => vertical(y(point)))

    return {
      xScale: horizontal,
      yScale: vertical,
      path: points.length > 1 ? draw([...points]) : null,
      referencePath: reference !== null && reference.length > 1 ? draw([...reference]) : null,
    }
  }, [points, reference, x, y, inner.width, inner.height])

  return (
    <svg width={width} height={height} role="img" aria-label={title}>
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {yScale?.ticks(4).map((value) => (
          <g key={`y-${value}`} transform={`translate(0,${yScale(value)})`}>
            <line x2={inner.width} stroke="#22303d" strokeWidth={0.5} />
            <text x={-5} dy="0.32em" textAnchor="end" fontSize={8} fill="#8b9bab">
              {value}
            </text>
          </g>
        ))}
        {xScale?.ticks(4).map((value) => (
          <g key={`x-${value}`} transform={`translate(${xScale(value)},${inner.height})`}>
            <line y2={3} stroke="#738698" />
            <text y={12} textAnchor="middle" fontSize={8} fill="#8b9bab">
              {value}
            </text>
          </g>
        ))}

        {referencePath && <path d={referencePath} fill="none" stroke="#738698" strokeWidth={2} />}
        {path && <path d={path} fill="none" stroke="#8ab4f8" strokeWidth={1.4} />}

        {/* Checking `xScale` narrows the whole memo result, so `yScale` needs no test. */}
        {current !== null && xScale && Number.isFinite(x(current)) && (
          <circle cx={xScale(x(current))} cy={yScale(y(current))} r={3} fill="#e0a458" />
        )}

        <text x={0} y={-4} fontSize={8} fill="#8b9bab">
          {title}
        </text>
        <text x={inner.width} y={inner.height + 12} textAnchor="end" fontSize={8} fill="#738698">
          {xLabel}
        </text>
      </g>
    </svg>
  )
}

export function PolarChart({
  points,
  alphaDeg,
  reference = null,
  width = 320,
  height = 150,
}: PolarChartProps) {
  const current = useMemo(() => {
    let best: PolarPoint | null = null
    let distance = Number.POSITIVE_INFINITY
    for (const point of points) {
      const candidate = Math.abs(point.alphaDeg - alphaDeg)
      if (candidate < distance) {
        distance = candidate
        best = point
      }
    }
    return best
  }, [points, alphaDeg])

  // Drag is only defined where the viscous march converged, so the polar skips the rest rather
  // than drawing a line through a gap.
  const withDrag = useMemo(() => points.filter((point) => Number.isFinite(point.cd)), [points])

  return (
    <div className="flex flex-col gap-1" data-testid="polar-chart">
      <Panel
        title="Cl against α"
        xLabel="α°"
        points={points}
        reference={reference}
        x={(point) => point.alphaDeg}
        y={(point) => point.cl}
        current={current}
        width={width}
        height={height}
      />
      <Panel
        title="Cl against Cd"
        xLabel="Cd"
        points={withDrag}
        reference={reference?.filter((point) => Number.isFinite(point.cd)) ?? null}
        x={(point) => point.cd}
        y={(point) => point.cl}
        current={current}
        width={width}
        height={height}
      />
    </div>
  )
}
