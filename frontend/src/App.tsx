import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DemoEvent, Mode, NodeView, Snapshot } from './types'
import { DICTS, eventText, fill, numberFormat, phaseText, type Lang } from './i18n'
import { NODE_COLORS, Topology } from './Topology'
import { TrafficStrip } from './WriteStrip'
import { READS } from './i18nReads'

const params = new URLSearchParams(location.search)
const KEY = params.get('key') ?? ''
const CLEAN = params.has('clean')

function initialLang(): Lang {
  const asked = params.get('lang')
  if (asked === 'en' || asked === 'fr' || asked === 'ar') return asked
  try {
    const saved = localStorage.getItem('pg-ha-lang')
    if (saved === 'en' || saved === 'fr' || saved === 'ar') return saved
  } catch {
    /* storage unavailable */
  }
  return navigator.language.startsWith('fr') ? 'fr' : navigator.language.startsWith('ar') ? 'ar' : 'en'
}

function useLive() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let socket: WebSocket | null = null
    let stopped = false
    let retry: number | undefined
    const open = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${scheme}://${location.host}/api/live`)
      socket.onopen = () => setConnected(true)
      socket.onmessage = (m) => setSnap(JSON.parse(m.data))
      socket.onclose = () => {
        setConnected(false)
        if (!stopped) retry = window.setTimeout(open, 1000)
      }
    }
    open()
    return () => {
      stopped = true
      window.clearTimeout(retry)
      socket?.close()
    }
  }, [])
  return { snap, connected }
}

async function post(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(KEY ? { 'X-Control-Key': KEY } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail.detail ?? response.statusText)
  }
  return response.json()
}

export default function App() {
  const { snap, connected } = useLive()
  const [lang, setLang] = useState<Lang>(initialLang)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canControl, setCanControl] = useState(true)
  const d = DICTS[lang]
  const fmt = useMemo(() => numberFormat(lang), [lang])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    try {
      localStorage.setItem('pg-ha-lang', lang)
    } catch {
      /* storage unavailable */
    }
  }, [lang])

  useEffect(() => {
    fetch('/api/key', { headers: KEY ? { 'X-Control-Key': KEY } : {} })
      .then((r) => r.json())
      .then((r) => setCanControl(Boolean(r.control)))
      .catch(() => setCanControl(false))
  }, [])

  const colorOf = useCallback(
    (name?: string | null) => {
      const i = snap?.nodes.findIndex((n) => n.name === name) ?? -1
      return i >= 0 ? NODE_COLORS[i % NODE_COLORS.length] : '#64748b'
    },
    [snap?.nodes],
  )
  const label = useCallback(
    (name?: string | null) => snap?.nodes.find((n) => n.name === name)?.label ?? name ?? '—',
    [snap?.nodes],
  )

  const act = useCallback(async (id: string, path: string, body?: unknown) => {
    setBusy(id)
    setError(null)
    try {
      await post(path, body)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [])

  const snapRef = useRef(snap)
  snapRef.current = snap
  // Presenter keys: P power cut, S shut down, N network cut (on the primary),
  // R bring every node back, V check every write.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = snapRef.current
      if (!s || !canControl || e.ctrlKey || e.metaKey || e.altKey) return
      const primary = s.nodes.find((n) => n.status === 'primary')
      const key = e.key.toLowerCase()
      const modes: Record<string, Mode> = { p: 'crash', s: 'stop', n: 'isolate' }
      if (modes[key] && primary && s.modes.includes(modes[key])) {
        act(`fail-${primary.name}`, `/api/nodes/${primary.name}/fail`, { mode: modes[key] })
      } else if (key === 'r') {
        s.nodes.filter((n) => n.chaos).forEach((n) => act(`rec-${n.name}`, `/api/nodes/${n.name}/recover`))
      } else if (key === 'v') {
        act('verify', '/api/verify')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, canControl])

  if (!snap) {
    return (
      <div className="boot">
        <img src="/isogrid-logo.png" alt="" />
        <p>{connected ? '…' : 'Connecting…'}</p>
      </div>
    )
  }

  const r = READS[lang]
  const [headline, phaseSub] = phaseText(d, snap.phase, label, fmt)
  const subline =
    snap.phase.kind === 'healthy' && snap.reads_per_second > 0
      ? fill(r.healthySub, { leader: label(snap.phase.leader) })
      : phaseSub
  // Who answered the reads of the last 30 seconds: the balancing, in numbers.
  const recentReads: Record<string, number> = {}
  for (const s of snap.reads.series) {
    if (s.t < snap.now - 30) continue
    for (const [node, n] of Object.entries(s.nodes)) recentReads[node] = (recentReads[node] ?? 0) + n
  }
  const recentTotal = Object.values(recentReads).reduce((a, b) => a + b, 0)
  const primary = snap.nodes.find((n) => n.status === 'primary')
  const elapsed = Math.max(0, Math.floor(snap.now - snap.started))
  const clock = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const pauseNow = snap.writes.failing_since != null ? snap.now - snap.writes.failing_since : null
  const showControls = canControl && !CLEAN && snap.modes.length > 0
  const tone = toneOf(snap.phase.kind)

  return (
    <div className={`stage lang-${lang}`}>
      <header className="top">
        <div className="brand">
          <img src="/isogrid-logo.png" alt="ISOGrid" />
          <div>
            <h1>{d.title}</h1>
            <p>{d.subtitle}</p>
          </div>
        </div>
        <div className="top-right">
          <span className={`live ${connected ? '' : 'off'}`}>
            <i /> {d.live} <b dir="ltr">{clock}</b>
          </span>
          <div className="langs" role="group">
            {(['en', 'fr', 'ar'] as Lang[]).map((l) => (
              <button key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>
                {l === 'ar' ? 'ع' : l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className={`narrator tone-${tone}`} aria-live="polite">
        <div className="narrator-icon">{iconOf(snap.phase.kind)}</div>
        <div>
          <h2>{headline}</h2>
          <p>{subline}</p>
        </div>
        {pauseNow != null && (
          <div className="pause-timer" dir="ltr">
            {pauseNow.toFixed(1)}
            <small>s</small>
          </div>
        )}
      </section>

      <main className="main">
        <section className="diagram card">
          <Topology snap={snap} lang={lang} colorOf={colorOf} />
          <div className="node-cards" style={{ gridTemplateColumns: `repeat(${snap.nodes.length}, 1fr)` }}>
            {snap.nodes.map((n) => (
              <NodeCard
                key={n.name}
                node={n}
                lang={lang}
                color={colorOf(n.name)}
                fmt={fmt}
                reads={snap.reads.by_node[n.name] ?? 0}
                modes={showControls ? snap.modes : []}
                canRecover={canControl && !CLEAN}
                busy={busy}
                onFail={(mode) => act(`fail-${n.name}`, `/api/nodes/${n.name}/fail`, { mode })}
                onRecover={() => act(`rec-${n.name}`, `/api/nodes/${n.name}/recover`)}
                isLastStanding={snap.nodes.filter((o) => !o.chaos && o.name !== n.name).length === 0}
              />
            ))}
          </div>
        </section>

        <aside className="side">
          <div className="stats">
            <Stat label={d.confirmed} hint={d.confirmedHint} value={fmt(snap.writes.acked)} tone="good" big />
            <Stat
              label={d.lost}
              hint={
                snap.verification
                  ? fill(d.lostDone, { when: ago(snap.now - snap.verification.t, d) })
                  : d.lostPending
              }
              value={snap.verification ? fmt(snap.verification.missing) : '…'}
              tone={snap.verification ? (snap.verification.missing === 0 ? 'good' : 'bad') : 'muted'}
              big
              check={snap.verification?.missing === 0}
            />
            <Stat
              label={d.interrupted}
              hint={d.interruptedHint}
              value={fmt(snap.writes.failed)}
              tone={snap.writes.failed ? 'warn' : 'muted'}
            />
            <Stat
              label={d.pause}
              hint={snap.writes.last_outage == null ? d.pauseNone : ''}
              value={snap.writes.last_outage != null ? fill(d.seconds, { n: fmt(snap.writes.last_outage) }) : '—'}
              tone="muted"
            />
          </div>

          <div className="share card">
            <h3>{r.share}</h3>
            <small>{recentTotal ? r.shareHint : r.none}</small>
            <div className="share-rows">
              {snap.nodes.map((n) => {
                const part = recentTotal ? (recentReads[n.name] ?? 0) / recentTotal : 0
                return (
                  <div className="share-row" key={n.name}>
                    <span style={{ color: colorOf(n.name) }}>{n.label}</span>
                    <div className="share-track">
                      <div className="share-fill" style={{ width: `${part * 100}%`, background: colorOf(n.name) }} />
                    </div>
                    <span>{Math.round(part * 100)}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="primary-now card">
            <span>{d.primaryNow}</span>
            {primary ? (
              <b style={{ color: colorOf(primary.name) }}>
                ♛ {primary.label}
                <small>
                  {d.timeline} {primary.timeline ?? '—'}
                </small>
              </b>
            ) : (
              <b className="none">—</b>
            )}
          </div>

          <div className="events card">
            <h3>{d.events}</h3>
            <ol>
              {snap.events.filter(shown).length === 0 && <li className="empty">{d.noEvents}</li>}
              {[...snap.events]
                .filter(shown)
                .reverse()
                .slice(0, 5)
                .map((e) => (
                  <li key={e.id} className={`ev ev-${e.kind}`}>
                    <time dir="ltr">+{offset(e.t - snap.started)}</time>
                    <span className="dot" style={{ background: dotColor(e, colorOf) }} />
                    <span>
                      {e.kind === 'reads_failing'
                        ? r.failing
                        : e.kind === 'reads_resumed'
                          ? fill(r.resumed, { node: label(e.node), after: e.after != null ? fmt(e.after) : '—' })
                          : eventText(d, e, label, fmt)}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
          <div className="toolbar">
            {!CLEAN && canControl && (
              <>
                <button onClick={() => act('verify', '/api/verify')} disabled={busy === 'verify'}>
                  ✓ {d.verify}
                </button>
                <button className="ghost" onClick={() => act('reset', '/api/reset')}>
                  ↺ {d.reset}
                </button>
              </>
            )}
            {!canControl && <span className="readonly">{d.readOnly}</span>}
            {error && <span className="error">{error}</span>}
            {snap.auto_recover > 0 && !CLEAN && (
              <span className="note">{fill(d.autoRecover, { n: fmt(snap.auto_recover) })}</span>
            )}
          </div>
        </aside>
      </main>

      <footer className="bottom card">
        <div className="strip-head">
          <span>{r.chart}</span>
          <span className="legend">
            {snap.nodes.map((n) => (
              <span key={n.name}>
                <i style={{ background: colorOf(n.name) }} />
                {n.label}
              </span>
            ))}
            <span>
              <i className="fail" />
              {d.failedLegend}
            </span>
          </span>
        </div>
        <div className="strip-row">
          <span>{r.writesShort}</span>
          <TrafficStrip now={snap.now} series={snap.writes.series} rate={snap.writes_per_second} colorOf={colorOf} />
        </div>
        <div className="strip-row">
          <span>{r.readsShort}</span>
          <TrafficStrip now={snap.now} series={snap.reads.series} rate={snap.reads_per_second} colorOf={colorOf} />
        </div>
      </footer>
    </div>
  )
}

function NodeCard(props: {
  node: NodeView
  lang: Lang
  color: string
  fmt: (n: number) => string
  reads: number
  modes: Mode[]
  canRecover: boolean
  busy: string | null
  onFail: (mode: Mode) => void
  onRecover: () => void
  isLastStanding: boolean
}) {
  const { node, lang, color, fmt, reads, modes, canRecover, busy, onFail, onRecover, isLastStanding } = props
  const d = DICTS[lang]
  const dead = node.status === 'down' || node.status === 'isolated'
  const hint = dead && node.chaos ? d.modeDown[node.chaos] : d.roleHint[node.status]
  return (
    <div className={`node-card status-${node.status}`} style={{ ['--node' as string]: color }}>
      <div className="card-head">
        <div className="chip">{d.status[node.status]}</div>
        <div className="hint">{hint}</div>
      </div>
      <dl className="three">
        <div>
          <dt>{d.latestWrite}</dt>
          <dd dir="ltr">{node.last_seq != null && !dead ? `#${fmt(node.last_seq)}` : '—'}</dd>
        </div>
        <div>
          <dt>{node.status === 'primary' ? d.timeline : d.lag}</dt>
          <dd dir="ltr">
            {node.status === 'primary'
              ? (node.timeline ?? '—')
              : node.lag == null
                ? '—'
                : node.lag === 0
                  ? d.inSync
                  : bytes(node.lag)}
          </dd>
        </div>
        <div>
          <dt>{READS[lang].served}</dt>
          <dd dir="ltr">{fmt(reads)}</dd>
        </div>
      </dl>
      {node.status === 'isolated' && node.inside?.role && (
        <div className="inside">
          {fill(d.insideView, { role: d.insideRole[node.inside.role] ?? node.inside.role })}
        </div>
      )}
      <div className="actions">
        {node.chaos
          ? canRecover && (
              <button className="recover" onClick={onRecover} disabled={busy === `rec-${node.name}`}>
                ⟳ {d.bringBack}
              </button>
            )
          : modes.map((m) => (
              <button
                key={m}
                className={`break mode-${m}`}
                title={d.actionHint[m]}
                onClick={() => onFail(m)}
                disabled={isLastStanding || busy === `fail-${node.name}`}
              >
                {m === 'crash' ? '⚡' : m === 'stop' ? '⏻' : '✂'} {d.actions[m]}
              </button>
            ))}
      </div>
    </div>
  )
}

function Stat(props: { label: string; hint: string; value: string; tone: string; big?: boolean; check?: boolean }) {
  return (
    <div className={`stat card tone-${props.tone} ${props.big ? 'big' : ''}`}>
      <span className="stat-label">{props.label}</span>
      <b dir="ltr">
        {props.value}
        {props.check && <em>✓</em>}
      </b>
      <small>{props.hint}</small>
    </div>
  )
}

const HIDDEN = new Set(['writes_moved', 'node_back', 'demoting'])
function shown(e: DemoEvent) {
  return !HIDDEN.has(e.kind)
}

function toneOf(kind: string) {
  if (kind === 'healthy' || kind === 'recovered') return 'good'
  if (kind === 'waiting_lock' || kind === 'electing') return 'bad'
  if (kind === 'rejoining' || kind === 'starting') return 'info'
  return 'warn'
}

function iconOf(kind: string) {
  return (
    {
      healthy: '✓',
      recovered: '✓',
      waiting_lock: '⏳',
      electing: '🗳',
      switching: '⇄',
      degraded: '⚠',
      rejoining: '⟳',
      starting: '…',
    } as Record<string, string>
  )[kind]
}

function dotColor(e: DemoEvent, colorOf: (n?: string | null) => string) {
  if (e.kind === 'failure' || e.kind === 'writes_failing' || e.kind === 'node_down' || e.kind === 'lock_expired')
    return '#f87171'
  if (e.kind === 'verified') return e.missing ? '#f87171' : '#4ade80'
  if (e.kind === 'healthy' || e.kind === 'ready') return '#4ade80'
  return colorOf(e.node)
}

function offset(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function ago(seconds: number, d: (typeof DICTS)['en']) {
  return seconds < 3 ? d.justNow : fill(d.agoS, { n: Math.floor(seconds) })
}

function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
