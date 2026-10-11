import type { NodeView, Snapshot } from './types'
import { DICTS, fill, type Lang } from './i18n'
import { READS } from './i18nReads'

export const NODE_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fb923c']

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
  // The standby farthest from the primary: its arc is the lowest, so the
  // stream's label goes under it, clear of every other line.
  const deepest = snap.nodes.reduce(
    (best, n, i) =>
      i !== primaryIndex && (n.status === 'standby' || n.status === 'catching_up') &&
      (best < 0 || Math.abs(i - primaryIndex) > Math.abs(best - primaryIndex))
        ? i
        : best,
    -1,
  )
  const lockCountdown = holder && (holder.status === 'down' || holder.status === 'isolated')

  const writePath = `M${APP.x} ${APP.y + 34} V${ROUTER.y + 32} C${ROUTER.x} ${ROUTER.y + 80}, ${px} ${NODE_Y - 130}, ${px} ${NODE_Y - 66}`
  const stuckPath = `M${APP.x} ${APP.y + 34} V${ROUTER.y - 34}`

  return (
    <svg className="topology" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={d.title}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="cyl-shade" x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.35" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#000" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* router to every node: the paths it could take */}
      {snap.nodes.map((n, i) => (
        <path
          key={`r-${n.name}`}
          d={`M${ROUTER.x} ${ROUTER.y + 32} C${ROUTER.x} ${ROUTER.y + 80}, ${nodeX(i, count)} ${NODE_Y - 130}, ${nodeX(i, count)} ${NODE_Y - 66}`}
          className="link-idle"
        />
      ))}

      {/* reads: the router hands each one to a standby in turn */}
      {snap.nodes.map((n, i) => {
        if (!reading.has(n.name)) return null
        const x = nodeX(i, count)
        const path = `M${ROUTER.x} ${ROUTER.y + 32} C${ROUTER.x} ${ROUTER.y + 80}, ${x} ${NODE_Y - 130}, ${x} ${NODE_Y - 66}`
        const serving = [...reading].sort()
        const turn = serving.indexOf(n.name) / serving.length
        return (
          <g key={`read-${n.name}`}>
            <path d={path} className="link-read" stroke={colorOf(n.name)} />
            {[0, 1].map((k) => (
              <circle key={k} r="5.5" className="read-packet" stroke={colorOf(n.name)}>
                <animateMotion dur="1.6s" begin={`${(k * 0.8 + turn * 0.8).toFixed(2)}s`} repeatCount="indefinite" path={path} />
              </circle>
            ))}
          </g>
        )
      })}

      {/* etcd to the lock holder */}
      {holder && (
        <path
          d={`M${ETCD.x} ${ETCD.y + 30} C${ETCD.x} ${NODE_Y - 80}, ${nodeX(holderIndex, count) - 90} ${NODE_Y - 70}, ${nodeX(holderIndex, count) - 58} ${NODE_Y - 52}`}
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
          const path = `M${x1} ${NODE_Y + 64} Q${mid} ${NODE_Y + 64 + depth} ${x2} ${NODE_Y + 64}`
          return (
            <g key={`wal-${n.name}`}>
              <path d={path} className="wal-base" stroke={colorOf(primary.name)} />
              <path
                d={path}
                className={`wal-flow ${n.status === 'catching_up' ? 'fast' : ''}`}
                stroke={colorOf(primary.name)}
              />
              {i === deepest && (
                <text x={mid} y={NODE_Y + 64 + depth / 2 + 22} className="wal-label" textAnchor="middle">
                  {d.wal}
                </text>
              )}
            </g>
          )
        })}

      {/* the application's writes */}
      <path d={failing ? stuckPath : writePath} className={`link-live ${failing ? 'stuck' : ''}`} />
      {!failing &&
        [0, 1, 2, 3, 4].map((k) => (
          <circle key={`${primary?.name}-${k}`} r="6" className="packet" fill={colorOf(primary?.name)}>
            <animateMotion dur="1.5s" begin={`${k * 0.3}s`} repeatCount="indefinite" path={writePath} />
          </circle>
        ))}
      {failing &&
        [0, 1, 2].map((k) => (
          <circle key={`stuck-${k}`} r="6" className="packet stuck">
            <animateMotion dur="0.9s" begin={`${k * 0.3}s`} repeatCount="indefinite" path={stuckPath} />
          </circle>
        ))}

      {/* application */}
      <g transform={`translate(${APP.x - 165} ${APP.y - 34})`}>
        <rect width="330" height="68" rx="16" className="box app" />
        <text x="62" y="30" className="box-title">
          {d.app}
        </text>
        <text x="62" y="51" className="box-sub">
          {fill(r.appSub, { writes: snap.writes_per_second, reads: snap.reads_per_second })}
        </text>
        <g transform="translate(18 18)" className="icon">
          <rect width="32" height="32" rx="7" />
          <path d="M8 12h16M8 18h11M8 24h14" />
        </g>
      </g>

      {/* router */}
      <g transform={`translate(${ROUTER.x - 180} ${ROUTER.y - 33})`}>
        <rect width="360" height="66" rx="16" className={`box router ${failing ? 'alarm' : ''}`} />
        <text x="64" y="29" className="box-title">
          {d.router}
          <tspan className="box-tech"> PgBouncer + HAProxy</tspan>
        </text>
        <text x="64" y="50" className="box-sub">
          {d.routerSub}
        </text>
        <g transform="translate(18 17)" className="icon">
          <circle cx="16" cy="16" r="15" />
          <path d="M6 16h20M19 9l7 7-7 7" />
        </g>
      </g>

      {/* etcd */}
      <g transform={`translate(${ETCD.x - 92} ${ETCD.y - 30})`}>
        <rect width="184" height="60" rx="14" className="box etcd" />
        <text x="56" y="27" className="box-title">
          {d.etcd}
        </text>
        <text x="56" y="46" className="box-sub">
          {d.etcdSub}
        </text>
        <g transform="translate(14 14)">
          <Padlock color={holder ? colorOf(holder.name) : '#64748b'} />
        </g>
      </g>

      {/* legend */}
      <g transform={`translate(${W - 300} 22)`} className="flow-legend">
        <circle cx="8" cy="0" r="6" fill="#e2e8f0" />
        <text x="24" y="5">{r.legendWrite}</text>
        <circle cx="8" cy="26" r="5.5" className="read-packet" stroke="#e2e8f0" />
        <text x="24" y="31">{r.legendRead}</text>
      </g>

      {snap.nodes.map((n, i) => (
        <NodeGlyph
          key={n.name}
          node={n}
          x={nodeX(i, count)}
          color={colorOf(n.name)}
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
      <path d="M8 14 V10 a8 8 0 0 1 16 0 V14" fill="none" stroke={color} strokeWidth="3.2" />
      <rect x="4" y="14" width="24" height="18" rx="4" fill={color} />
      <circle cx="16" cy="22" r="2.6" fill="#0b1222" />
    </g>
  )
}

function NodeGlyph(props: {
  node: NodeView
  x: number
  color: string
  holdsLock: boolean
  ttl: number | null
  granted: number | null
}) {
  const { node, x, color, holdsLock, ttl, granted } = props
  const dead = node.status === 'down' || node.status === 'isolated'
  const fill = dead ? '#334155' : color
  const w = 116
  const h = 118
  const top = NODE_Y - h / 2
  const rx = w / 2
  const ry = 15
  return (
    <g className={`node-glyph status-${node.status}`} transform={`translate(${x} 0)`}>
      {node.status === 'primary' && (
        <circle cx="0" cy={NODE_Y} r="92" className="primary-halo" stroke={color} />
      )}
      {node.status === 'catching_up' && <circle cx="0" cy={NODE_Y} r="84" className="sync-ring" stroke={color} />}
      <g filter={node.status === 'primary' ? 'url(#glow)' : undefined} opacity={dead ? 0.55 : 1}>
        <path
          d={`M${-rx} ${top + ry} V${top + h - ry} A${rx} ${ry} 0 0 0 ${rx} ${top + h - ry} V${top + ry}`}
          fill={fill}
        />
        <path
          d={`M${-rx} ${top + ry} V${top + h - ry} A${rx} ${ry} 0 0 0 ${rx} ${top + h - ry} V${top + ry}`}
          fill="url(#cyl-shade)"
        />
        {[0.36, 0.66].map((f) => (
          <path
            key={f}
            d={`M${-rx} ${top + h * f} A${rx} ${ry} 0 0 0 ${rx} ${top + h * f}`}
            fill="none"
            stroke="#0b1222"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
        ))}
        <ellipse cx="0" cy={top + ry} rx={rx} ry={ry} fill={fill} />
        <ellipse cx="0" cy={top + ry} rx={rx} ry={ry} fill="#fff" fillOpacity="0.22" />
      </g>
      <text x="0" y={NODE_Y + 12} textAnchor="middle" className="node-name">
        {node.label}
      </text>

      {node.status === 'primary' && (
        <g transform={`translate(-22 ${top - 54})`}>
          <g className="crown">
            <path d="M2 34 L0 8 L12 20 L22 2 L32 20 L44 8 L42 34 Z" fill="#fbbf24" />
            <rect x="2" y="36" width="40" height="6" rx="2" fill="#fbbf24" />
          </g>
        </g>
      )}

      {holdsLock && (
        <g transform={`translate(${rx - 8} ${top - 6})`}>
          {ttl != null && granted ? (
            <>
              <circle r="24" cx="16" cy="18" className="ttl-track" />
              <circle
                r="24"
                cx="16"
                cy="18"
                className="ttl-ring"
                strokeDasharray={`${(Math.max(ttl, 0) / granted) * 150.8} 150.8`}
                transform="rotate(-90 16 18)"
              />
            </>
          ) : null}
          <g transform="translate(0 2)">
            <Padlock color={ttl != null ? '#f87171' : '#fbbf24'} />
          </g>
          {ttl != null && (
            <text x="16" y="-14" textAnchor="middle" className="ttl-text">
              {Math.max(ttl, 0)}s
            </text>
          )}
        </g>
      )}

      {node.status === 'down' && node.chaos === 'crash' && (
        <path
          className="bolt"
          transform={`translate(-20 ${NODE_Y - 36})`}
          d="M24 0 L4 40 H20 L14 72 L40 26 H24 Z"
        />
      )}
      {node.status === 'down' && node.chaos !== 'crash' && (
        <g className="power" transform={`translate(0 ${NODE_Y - 4})`}>
          <path d="M-14 -16 A22 22 0 1 0 14 -16" />
          <path d="M0 -28 V-4" />
        </g>
      )}
      {node.status === 'isolated' && (
        <g className="cut" transform={`translate(0 ${NODE_Y - 112})`}>
          <path d="M-30 0 H-8 M8 0 H30" />
          <path d="M-6 -12 L6 12 M6 -12 L-6 12" />
        </g>
      )}
    </g>
  )
}
