import { isInsideTrainedRange } from '../geometry/shapeOps'
import { useAppStore } from '../state/store'

/**
 * What this app is, stated before anyone draws a conclusion from it.
 *
 * Not a disclaimer tucked into a footer. The whole point of the project is that a fast, pretty flow
 * picture is worthless unless the viewer knows what produced it and how wrong it can be, so the
 * approximation and its measured error are on screen from the first frame, with a link to the
 * numbers. The out-of-range warning appears when the design leaves the region the model was trained
 * on, instead of letting it extrapolate quietly.
 */
export function HonestyBanner() {
  const section = useAppStore((state) => state.section)
  const alphaDeg = useAppStore((state) => state.alphaDeg)
  const insideRange = isInsideTrainedRange(section, alphaDeg)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raised/60 px-4 py-1.5 text-[0.7rem]">
      <span className="text-muted">
        A neural surrogate, not a solver — predictions approximate a panel method, which itself
        approximates reality.
      </span>
      <a
        className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
        href="https://github.com/jaworskig00/neural-wind-tunnel/blob/main/docs/accuracy.md"
        target="_blank"
        rel="noreferrer"
      >
        measured accuracy
      </a>
      {!insideRange && (
        <span className="text-warn" data-testid="out-of-range">
          Outside the trained range — the prediction is extrapolation.
        </span>
      )}
    </div>
  )
}
