import type { Snapshot } from './types'

const SPAN = 90
const W = 1000
const H = 60
const BASE = 46

type Series = Snapshot['writes']['series']

/** One bar per second, stacked and coloured by the node that answered. */
export function TrafficStrip({ now, series, rate, colorOf }: {
  now: number
  series: Series
  rate: number
  colorOf: (name?: string | null) => string
}) {
  const last = Math.floor(now)
  const bySecond = new Map(series.map((s) => [s.t, s]))
  const bar = W / SPAN
  const scale = (BASE - 4) / (Math.max(rate, 1) * 1.2)

  return (
    <svg className="strip" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={BASE + 0.5} y2={BASE + 0.5} className="strip-base" />
      {Array.from({ length: SPAN }, (_, i) => {
        const s = bySecond.get(last - (SPAN - 1 - i))
        if (!s) return null
        let y = BASE
        const x = i * bar + 1
        return (
          <g key={s.t}>
            {Object.entries(s.nodes).map(([node, n]) => {
              const h = Math.min(n * scale, y)
              y -= h
              return <rect key={node} x={x} y={y} width={bar - 2} height={h} rx="2" fill={colorOf(node)} />
            })}
            {s.failed > 0 && (
              <rect x={x} y={BASE + 3} width={bar - 2} height={Math.min(s.failed * scale * 0.5 + 4, H - BASE - 4)} rx="2" className="strip-fail" />
            )}
          </g>
        )
      })}
    </svg>
  )
}
