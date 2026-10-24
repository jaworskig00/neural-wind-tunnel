import { CP_STATIONS_PER_SURFACE, cpStations } from '../geometry/stations'

/**
 * Placeholder shell for milestone M0. The real layout -- viewport, parameter panel and
 * chart dock -- lands in T4.1. This renders enough to prove the toolchain works end to end
 * and to give the smoke test something deterministic to assert against.
 */
export function App() {
  const stations = cpStations()

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Neural Wind Tunnel</h1>
        <p className="shell__tagline">
          A neural surrogate for airfoil flow, rendered on the GPU. Under construction.
        </p>
      </header>

      <section className="shell__status" aria-labelledby="status-heading">
        <h2 id="status-heading">Build status</h2>
        <dl>
          <dt>Milestone</dt>
          <dd>M0 — repository, tooling and CI</dd>
          <dt>Surface stations per side</dt>
          <dd data-testid="station-count">{CP_STATIONS_PER_SURFACE}</dd>
          <dt>Leading edge / trailing edge</dt>
          <dd data-testid="station-bounds">
            {stations[0]?.toFixed(3)} / {stations[stations.length - 1]?.toFixed(3)}
          </dd>
        </dl>
        <p>
          The plan, the decision records and the data contracts are in <code>docs/</code>.
        </p>
      </section>
    </main>
  )
}
