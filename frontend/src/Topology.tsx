import type { NodeView, Snapshot } from './types'
import { DICTS, fill, type Lang } from './i18n'
import { LINK, READS } from './i18nReads'

/** One colour per node, used wherever that node's traffic is drawn. */
export const NODE_COLORS = ['#5b8def', '#9d86e9', '#d4739f', '#4fb0a5', '#c9954a']

const W = 1400
const H = 540
const NODE_Y = 372
const APP = { x: W / 2, y: 46 }
const ROUTER = { x: W / 2, y: 182 }
const ETCD = { x: 190, y: 182 }

export function nodeX(index: number, count: number) {
  return (W / count) * (index + 0.5)
}

interface Props {
  snap: Snapshot
  lang: Lang
  colorOf: (name?: string | null) => string
}

export function Topology({ snap, lang, colorOf }: Props) {
  const d = DICTS[lang]
  const r = READS[lang]
  const link = LINK[lang]
  // Which nodes answered a read in the last three seconds.
  const reading = new Set<string>()
  for (const s of snap.reads.series.slice(-3)) {
    if (s.t >= snap.now - 3.5) Object.keys(s.nodes).forEach((n) => reading.add(n))
  }
  const count = snap.nodes.length
  const primaryIndex = snap.nodes.findIndex((n) => n.status === 'primary')
  const primary = primaryIndex >= 0 ? snap.nodes[primaryIndex] : null
  const failing = snap.writes.failing_since != null || !primary
  const px = primaryIndex >= 0 ? nodeX(primaryIndex, count) : ROUTER.x
  const holderIndex = snap.nodes.findIndex((n) => n.name === snap.lock.holder)
  const holder = holderIndex >= 0 ? snap.nodes[holderIndex] : null
  // The standby farthest from the primary: its arc is the lowest, so its
  // label goes under it; the others are labelled above their own arc.
  const deepest = snap.nodes.reduce(
    (best, n, i) =>
      i !== primaryIndex && (n.status === 'standby' || n.status === 'catching_up') &&
      (best < 0 || Math.abs(i - primaryIndex) > Math.abs(best - primaryIndex))
        ? i
        : best,
    -1,
  )
  const lockCountdown = holder && (holder.status === 'down' || holder.status === 'isolated')

  const curve = (x: number) => `C${ROUTER.x} ${ROUTER.y + 80}, ${x} ${NODE_Y - 150}, ${x} ${NODE_Y - 66}`
  const toNode = (x: number) => `M${ROUTER.x} ${ROUTER.y + 32} ${curve(x)}`
  const writePath = `M${APP.x} ${APP.y + 34} V${ROUTER.y + 32} ${curve(px)}`
  const stuckPath = `M${APP.x} ${APP.y + 34} V${ROUTER.y - 34}`

  const distance = (a: string, b: string) =>
    snap.link.distances_km[`${a}|${b}`] ?? snap.link.distances_km[`${b}|${a}`] ?? null

  return (
    <svg className="topology" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={d.title}>
      <defs>
        <linearGradient id="cyl-shade" x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
      </defs>

      {/* router to every node: the paths it could take */}
      {snap.nodes.map((n, i) => (
        <path key={`r-${n.name}`} d={toNode(nodeX(i, count))} className="link-idle" />
      ))}

      {/* reads: the router hands each one to a standby in turn */}
      {snap.nodes.map((n, i) => {
        if (!reading.has(n.name)) return null
        const path = toNode(nodeX(i, count))
        const serving = [...reading].sort()
        const turn = serving.indexOf(n.name) / serving.length
        return (
          <g key={`read-${n.name}`}>
            <path d={path} className="link-read" stroke={colorOf(n.name)} />
            {[0, 1].map((k) => (
              <circle key={k} r="4.5" className="read-packet" stroke={colorOf(n.name)}>
                <animateMotion dur="1.6s" begin={`${(k * 0.8 + turn * 0.8).toFixed(2)}s`} repeatCount="indefinite" path={path} />
              </circle>
            ))}
          </g>
        )
      })}

      {/* etcd to the lock holder */}
      {holder && (
        <path
          d={`M${ETCD.x} ${ETCD.y + 30} C${ETCD.x} ${NODE_Y - 80}, ${nodeX(holderIndex, count) - 110} ${NODE_Y - 60}, ${nodeX(holderIndex, count) - 62} ${NODE_Y - 40}`}
          className={`link-lock ${lockCountdown ? 'expiring' : ''}`}
        />
      )}

      {/* the live copy: WAL streaming from the primary to each standby */}
      {primary &&
        snap.nodes.map((n, i) => {
          if (i === primaryIndex || (n.status !== 'standby' && n.status !== 'catching_up')) return null
          const x1 = px
          const x2 = nodeX(i, count)
          const mid = (x1 + x2) / 2
          // Farther standbys get a deeper arc, so two streams never overlap.
          const depth = 40 + Math.abs(x2 - x1) * 0.1
          const path = `M${x1} ${NODE_Y + 62} Q${mid} ${NODE_Y + 62 + depth} ${x2} ${NODE_Y + 62}`
          const km = distance(primary.name, n.name)
          const parts = [
            i === deepest ? d.wal : null,
            km != null ? fill(link.km, { km }) : null,
            snap.link.available && snap.link.rtt_ms > 0 ? fill(link.wal, { rtt: snap.link.rtt_ms }) : null,
          ].filter(Boolean)
          const peak = NODE_Y + 62 + depth / 2
          return (
            <g key={`wal-${n.name}`}>
              <path d={path} className="wal-base" />
              <path d={path} className={`wal-flow ${n.status === 'catching_up' ? 'fast' : ''}`} stroke={colorOf(primary.name)} />
              <text x={mid} y={i === deepest ? peak + 20 : peak - 10} className="wal-label" textAnchor="middle">
                {parts.join('  ·  ')}
              </text>
            </g>
          )
        })}

      {/* the application's writes */}
      <path d={failing ? stuckPath : writePath} className={`link-live ${failing ? 'stuck' : ''}`} />
      {!failing &&
        [0, 1, 2, 3].map((k) => (
          <circle key={`${primary?.name}-${k}`} r="4.5" className="packet" fill={colorOf(primary?.name)}>
            <animateMotion dur="1.6s" begin={`${k * 0.4}s`} repeatCount="indefinite" path={writePath} />
          </circle>
        ))}
      {failing &&
        [0, 1].map((k) => (
          <circle key={`stuck-${k}`} r="4.5" className="packet stuck">
            <animateMotion dur="1.2s" begin={`${k * 0.6}s`} repeatCount="indefinite" path={stuckPath} />
          </circle>
        ))}

      {/* application */}
      <g transform={`translate(${APP.x - 165} ${APP.y - 34})`}>
        <rect width="330" height="68" rx="8" className="box" />
        <text x="20" y="29" className="box-title">
          {d.app}
        </text>
        <text x="20" y="50" className="box-sub">
          {fill(r.appSub, { writes: snap.writes_per_second, reads: snap.reads_per_second })}
        </text>
      </g>

      {/* router */}
      <g transform={`translate(${ROUTER.x - 180} ${ROUTER.y - 33})`}>
        <rect width="360" height="66" rx="8" className={`box ${failing ? 'alarm' : ''}`} />
        <text x="20" y="28" className="box-title">
          {d.router}
          <tspan className="box-tech" dx="8">
            PgBouncer + HAProxy
          </tspan>
        </text>
        <text x="20" y="49" className="box-sub">
          {d.routerSub}
        </text>
      </g>

      {/* etcd */}
      <g transform={`translate(${ETCD.x - 92} ${ETCD.y - 30})`}>
        <rect width="184" height="60" rx="8" className="box" />
        <g transform="translate(16 15) scale(0.9)">
          <Padlock color={holder ? '#c9ced8' : '#5b6474'} />
        </g>
        <text x="58" y="26" className="box-title">
          {d.etcd}
        </text>
        <text x="58" y="45" className="box-sub">
          {d.etcdSub}
        </text>
      </g>

      {/* legend */}
      <g transform={`translate(${W - 300} 24)`} className="flow-legend">
        <circle cx="8" cy="0" r="4.5" fill="#c9ced8" />
        <text x="24" y="4">{r.legendWrite}</text>
        <circle cx="8" cy="24" r="4.5" className="read-packet" stroke="#c9ced8" />
        <text x="24" y="28">{r.legendRead}</text>
      </g>

      {snap.nodes.map((n, i) => (
        <NodeGlyph
          key={n.name}
          node={n}
          x={nodeX(i, count)}
          color={colorOf(n.name)}
          primaryLabel={d.status.primary}
          holdsLock={n.name === snap.lock.holder}
          ttl={lockCountdown && n.name === snap.lock.holder ? snap.lock.ttl : null}
          granted={snap.lock.granted}
        />
      ))}
    </svg>
  )
}

function Padlock({ color }: { color: string }) {
  return (
    <g>
      <path d="M8 14 V10 a8 8 0 0 1 16 0 V14" fill="none" stroke={color} strokeWidth="2.6" />
      <rect x="4" y="14" width="24" height="18" rx="3" fill={color} />
    </g>
  )
}

function NodeGlyph(props: {
  node: NodeView
  x: number
  color: string
  primaryLabel: string
  holdsLock: boolean
  ttl: number | null
  granted: number | null
}) {
  const { node, x, color, primaryLabel, holdsLock, ttl, granted } = props
  const dead = node.status === 'down' || node.status === 'isolated'
  const body = dead ? '#2a313d' : color
  const w = 112
  const h = 112
  const top = NODE_Y - h / 2
  const rx = w / 2
  const ry = 13
  const side = `M${-rx} ${top + ry} V${top + h - ry} A${rx} ${ry} 0 0 0 ${rx} ${top + h - ry} V${top + ry}`
  return (
    <g className={`node-glyph status-${node.status}`} transform={`translate(${x} 0)`}>
      {node.status === 'primary' && <circle cx="0" cy={NODE_Y} r="84" className="primary-ring" />}
      {node.status === 'catching_up' && <circle cx="0" cy={NODE_Y} r="80" className="sync-ring" stroke={color} />}
      {dead && (
        <circle cx="0" cy={NODE_Y} r="80" className={`dead-ring ${node.status === 'isolated' ? 'cut' : ''}`} />
      )}

      <g opacity={dead ? 0.7 : 1}>
        <path d={side} fill={body} />
        <path d={side} fill="url(#cyl-shade)" />
        {[0.38, 0.68].map((f) => (
          <path
            key={f}
            d={`M${-rx} ${top + h * f} A${rx} ${ry} 0 0 0 ${rx} ${top + h * f}`}
            fill="none"
            stroke="#0b0f17"
            strokeOpacity="0.3"
            strokeWidth="1.5"
          />
        ))}
        <ellipse cx="0" cy={top + ry} rx={rx} ry={ry} fill={body} />
        <ellipse cx="0" cy={top + ry} rx={rx} ry={ry} fill="#fff" fillOpacity="0.16" />
      </g>
      {!dead && (
        <text x="0" y={NODE_Y + 12} textAnchor="middle" className="node-id">
          {node.name}
        </text>
      )}

      {/* the site this node runs in */}
      <text x="0" y={top - 16} textAnchor="middle" className="node-site">
        {node.label}
      </text>

      {node.status === 'primary' && (
        <g transform={`translate(0 ${top - 62})`}>
          <rect x="-48" y="0" width="96" height="22" rx="4" className="primary-tag" />
          <text x="0" y="15.5" textAnchor="middle" className="primary-tag-text">
            {primaryLabel}
          </text>
        </g>
      )}

      {holdsLock && (
        <g transform={`translate(${rx + 6} ${top + 4})`}>
          {ttl != null && granted ? (
            <>
              <circle r="23" cx="16" cy="17" className="ttl-track" />
              <circle
                r="23"
                cx="16"
                cy="17"
                className="ttl-ring"
                strokeDasharray={`${(Math.max(ttl, 0) / granted) * 144.5} 144.5`}
                transform="rotate(-90 16 17)"
              />
              <text x="16" y="-14" textAnchor="middle" className="ttl-text">
                {Math.max(ttl, 0)} s
              </text>
            </>
          ) : null}
          <Padlock color={ttl != null ? '#e5534b' : '#d6a93f'} />
        </g>
      )}

      {dead && (
        <g transform={`translate(0 ${NODE_Y + 4})`} className="dead-mark">
          <circle r="17" />
          {node.status === 'isolated' ? <path d="M-9 0 H-3 M3 0 H9 M-2 -6 L2 6" /> : <path d="M-6 -6 L6 6 M6 -6 L-6 6" />}
        </g>
      )}
    </g>
  )
}
