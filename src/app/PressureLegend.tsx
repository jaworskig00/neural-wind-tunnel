import { PRESSURE_RANGE } from '../scene/pressureMaterial'
import { useAppStore } from '../state/store'

/**
 * The colour scale, with its numbers.
 *
 * The range is fixed rather than auto-scaled: a scale that moves with the data makes two designs
 * impossible to compare by eye, which is most of what this app is for. Values outside the range
 * clamp, and the end labels say so.
 */
export function PressureLegend() {
  const colormap = useAppStore((state) => state.colormap)
  const setColormap = useAppStore((state) => state.setColormap)

  const gradient =
    colormap === 'cividis'
      ? 'linear-gradient(to right, #00225b, #353a74, #6b6b77, #a89a5f, #ffd629)'
      : 'linear-gradient(to right, #3b4cc0, #93b5fe, #dddddd, #f6a385, #b40426)'

  return (
    <div className="flex items-center gap-2">
      <span className="tabular text-[0.65rem] text-faint">
        {PRESSURE_RANGE.min.toFixed(0)}
        {'≤'}
      </span>
      <div
        className="h-2 w-28 rounded-sm border border-line"
        style={{ background: gradient }}
        role="img"
        aria-label="Pressure coefficient colour scale"
      />
      <span className="tabular text-[0.65rem] text-faint">
        {'≥'}
        {PRESSURE_RANGE.max.toFixed(0)}
      </span>
      <span className="text-[0.65rem] text-faint">Cp</span>
      <button
        type="button"
        className="rounded border border-line px-1.5 py-0.5 text-[0.65rem] text-muted hover:border-faint hover:text-text"
        onClick={() => {
          setColormap(colormap === 'coolwarm' ? 'cividis' : 'coolwarm')
        }}
        title="Cividis is perceptually uniform and readable with any common colour vision deficiency"
      >
        {colormap}
      </button>
    </div>
  )
}
