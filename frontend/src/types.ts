export type Status =
  | 'unknown'
  | 'starting'
  | 'primary'
  | 'standby'
  | 'catching_up'
  | 'waiting'
  | 'demoting'
  | 'down'
  | 'isolated'

export type Mode = 'crash' | 'stop' | 'isolate'

export interface NodeView {
  name: string
  label: string
  status: Status
  role: string | null
  state: string | null
  timeline: number | null
  lag: number | null
  last_seq: number | null
  rows: number | null
  chaos: Mode | null
  chaos_since: number | null
  recovering: boolean
  inside: { role: string | null; state: string | null } | null
}

export interface Phase {
  kind: 'starting' | 'healthy' | 'waiting_lock' | 'electing' | 'switching' | 'degraded' | 'rejoining' | 'recovered'
  node?: string
  leader?: string | null
  ttl?: number | null
  outage?: number | null
  lost?: number | null
  mode?: Mode | null
  demoted?: boolean
}

export interface DemoEvent {
  id: number
  t: number
  kind: string
  node?: string
  previous?: string
  mode?: Mode
  after?: number
  outage?: number | null
  acked?: number
  missing?: number
  automatic?: boolean
  reason?: string
  was?: string
}

export interface Verification {
  t: number
  acked: number
  found: number
  missing: number
  missing_sample: number[]
  unconfirmed_landed: number
}

export interface Snapshot {
  now: number
  run: string
  started: number
  ready: boolean
  setup_error: string | null
  driver: string
  modes: Mode[]
  control_locked: boolean
  auto_recover: number
  writes_per_second: number
  reads_per_second: number
  reads: {
    ok: number
    failed: number
    by_node: Record<string, number>
    failing_since: number | null
    last_outage: number | null
    series: { t: number; nodes: Record<string, number>; failed: number }[]
  }
  lock: { holder: string | null; ttl: number | null; granted: number | null }
  nodes: NodeView[]
  writes: {
    acked: number
    failed: number
    last_seq: number
    last_node: string | null
    failing_since: number | null
    last_outage: number | null
    series: { t: number; nodes: Record<string, number>; failed: number }[]
  }
  phase: Phase
  verification: Verification | null
  events: DemoEvent[]
}
