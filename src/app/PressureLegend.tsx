import { PRESSURE_RANGE } from '../scene/pressureScale'
import { useAppStore } from '../state/store'

/**
 * The colour scale, with its numbers.
 *
 * The range is fixed rather than auto-scaled: a scale that moves with the data makes two designs
 * impossible to compare by eye, which is most of what this app is for. Values outside the range
 * clamp, and the end labels say so.
 *
 * The diverging scale is centred on Cp = 0, the freestream pressure, so the gradient here is drawn
 * with white at that point rather than at the midpoint of the range -- otherwise the legend would
 * promise a mapping the shader does not use.
 */
export function PressureLegend() {
  const colormap = useAppStore((state) => state.colormap)
  const setColormap = useAppStore((state) => state.setColormap)

  // Where Cp = 0 falls within the drawn bar, as a percentage.
  const neutral = (100 * (0 - PRESSURE_RANGE.min)) / (PRESSURE_RANGE.max - PRESSURE_RANGE.min)
  const gradient =
    colormap === 'cividis'
      ? 'linear-gradient(to right, #00225b, #353a74, #6b6b77, #a89a5f, #ffd629)'
      : `linear-gradient(to right, #3b4cc0 0%, #93b5fe ${neutral / 2}%, #dddddd ${neutral}%,` +
        ` #f6a385 ${(neutral + 100) / 2}%, #b40426 100%)`

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
      <span
        className="tabular text-[0.65rem] text-faint"
        title="The diverging scale is centred here"
      >
        0 at {neutral.toFixed(0)} %
      </span>
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
