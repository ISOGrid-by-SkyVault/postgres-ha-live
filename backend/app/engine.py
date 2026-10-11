"""The live model of the cluster: what every node says, who holds the leader
lock, how the application's writes are faring, and what just happened.

Nothing here is simulated. Roles come from each node's Patroni REST API, the
lock and its countdown from etcd, the node that served each write from
`inet_server_addr()` on that very write, and each node's progress from a query
run on that node.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import socket
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import asyncpg
import httpx

from . import config
from .chaos import ChaosError, DockerChaos
from .links import Links

log = logging.getLogger("demo")

TABLE_SQL = """
CREATE TABLE IF NOT EXISTS demo_writes (
    run  uuid        NOT NULL,
    seq  bigint      NOT NULL,
    at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run, seq)
)
"""

#: How long the "everything is back" banner stays up after an incident.
RECOVERED_BANNER_SECONDS = 25.0


@dataclass
class Node:
    name: str
    label: str
    reachable: bool = False
    role: str | None = None  # primary | replica, as Patroni reports it
    state: str | None = None  # running | starting | stopped | ...
    replication_state: str | None = None
    timeline: int | None = None
    lsn: int | None = None  # primary: its WAL position; replica: what it received
    last_seq: int | None = None  # the newest demo write this node holds
    rows: int | None = None
    status: str = "unknown"
    chaos: str | None = None
    chaos_since: float | None = None
    recovering: bool = False
    inside: dict[str, Any] | None = None  # seen from inside while cut off
    last_seen: float | None = None
    lag: int | None = None


@dataclass
class Second:
    t: int
    nodes: dict[str, int] = field(default_factory=dict)
    failed: int = 0


class Engine:
    def __init__(self) -> None:
        self.chaos = DockerChaos()
        self.links = Links()
        self.nodes: dict[str, Node] = {
            name: Node(name=name, label=config.LABELS[i] if i < len(config.LABELS) else name)
            for i, name in enumerate(config.NODES)
        }
        self.http = httpx.AsyncClient(timeout=0.8)
        self.events: deque[dict[str, Any]] = deque(maxlen=200)
        self._event_id = 0
        self.ip_to_node: dict[str, str] = {}
        self.lock_holder: str | None = None
        self.lock_ttl: int | None = None
        self.lock_granted: int | None = None
        self._lock_seen = False
        self.ready = False
        self.setup_error: str | None = None
        self.tasks: list[asyncio.Task[Any]] = []
        self._verifying = False
        self.reset_run()

    # -- lifecycle ------------------------------------------------------------

    def reset_run(self) -> None:
        self.run_id = uuid.uuid4()
        self.seq = 0
        self.acked: set[int] = set()
        self.failed = 0
        self.last_ok_at: float | None = None
        self.last_node: str | None = None
        self.failing_since: float | None = None
        self.last_outage: float | None = None
        self.seconds: deque[Second] = deque(maxlen=150)
        self.read_seconds: deque[Second] = deque(maxlen=150)
        self.reads_ok = 0
        self.reads_failed = 0
        self.reads_by_node: dict[str, int] = {}
        self.reads_failing_since: float | None = None
        self.last_read_ok_at: float | None = None
        self.last_read_outage: float | None = None
        self.verification: dict[str, Any] | None = None
        self.incident_since: float | None = None
        self.recovered_at: float | None = None
        self.started = time.time()

    async def start(self) -> None:
        loops = [self._bootstrap(), self._writer(), self._reader(), self._links_loop(), self._lock_loop(), self._resolve_loop(), self._watch_loop()]
        for node in self.nodes.values():
            loops += [self._patroni_loop(node), self._rows_loop(node)]
        self.tasks = [asyncio.create_task(loop) for loop in loops]

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.http.aclose()
        await self.links.close()

    def emit(self, kind: str, **data: Any) -> None:
        self._event_id += 1
        event = {"id": self._event_id, "t": time.time(), "kind": kind, **data}
        self.events.append(event)
        log.info("event %s", event)

    # -- setup ----------------------------------------------------------------

    async def _bootstrap(self) -> None:
        """Create the demo role, database and table, retrying until the
        cluster has elected its first leader."""
        while not self.ready:
            try:
                if config.ADMIN_DSN:
                    admin = await asyncpg.connect(config.ADMIN_DSN, timeout=3)
                    try:
                        if not await admin.fetchval("SELECT 1 FROM pg_roles WHERE rolname = $1", config.DEMO_ROLE):
                            password = config.DEMO_PASSWORD.replace("'", "''")
                            await admin.execute(
                                f'CREATE ROLE "{config.DEMO_ROLE}" LOGIN PASSWORD \'{password}\''
                            )
                        if not await admin.fetchval(
                            "SELECT 1 FROM pg_database WHERE datname = $1", config.DEMO_DATABASE
                        ):
                            await admin.execute(
                                f'CREATE DATABASE "{config.DEMO_DATABASE}" OWNER "{config.DEMO_ROLE}"'
                            )
                    finally:
                        await admin.close()
                conn = await asyncpg.connect(config.WRITER_DSN, timeout=3, statement_cache_size=0)
                try:
                    await conn.execute(TABLE_SQL)
                finally:
                    await conn.close()
                self.ready = True
                self.setup_error = None
                self.emit("ready")
            except Exception as exc:  # the cluster may still be electing
                self.setup_error = _short(exc)
                await asyncio.sleep(2)

    # -- the application's writes ----------------------------------------------

    async def _writer(self) -> None:
        interval = 1.0 / max(config.WRITES_PER_SECOND, 0.1)
        conn: asyncpg.Connection | None = None
        while True:
            if not self.ready:
                await asyncio.sleep(0.5)
                continue
            started = time.monotonic()
            self.seq += 1
            seq = self.seq
            run = self.run_id
            try:
                if conn is None or conn.is_closed():
                    conn = await asyncpg.connect(config.WRITER_DSN, timeout=2, statement_cache_size=0)
                address = await conn.fetchval(
                    "INSERT INTO demo_writes (run, seq) VALUES ($1, $2) RETURNING host(inet_server_addr())",
                    run,
                    seq,
                    timeout=2,
                )
                if run == self.run_id:
                    self._write_ok(seq, self.ip_to_node.get(address or "", address or "?"))
            except Exception as exc:
                if run == self.run_id:
                    self._write_failed(_short(exc))
                if conn is not None:
                    conn.terminate()
                conn = None
            await asyncio.sleep(max(0.0, interval - (time.monotonic() - started)))

    # -- the application's reads ------------------------------------------------

    async def _reader(self) -> None:
        """Read through the router's read port, one connection per read.

        HAProxy balances connections, not queries, so each read opens its own -
        which is also what an application's pool does over time. The node that
        answered is asked of the node itself.
        """
        interval = 1.0 / max(config.READS_PER_SECOND, 0.1)
        while True:
            if not self.ready or config.READS_PER_SECOND <= 0:
                await asyncio.sleep(0.5)
                continue
            started = time.monotonic()
            run = self.run_id
            conn: asyncpg.Connection | None = None
            try:
                conn = await asyncpg.connect(config.READER_DSN, timeout=1.5, statement_cache_size=0)
                row = await conn.fetchrow(
                    "SELECT host(inet_server_addr()) AS addr, pg_is_in_recovery() AS standby, "
                    "coalesce(max(seq), 0) AS last FROM demo_writes WHERE run = $1",
                    run,
                    timeout=1.5,
                )
                if run == self.run_id:
                    self._read_ok(self.ip_to_node.get(row["addr"] or "", row["addr"] or "?"))
            except Exception:
                if run == self.run_id:
                    self._read_failed()
            finally:
                if conn is not None:
                    conn.terminate()
            await asyncio.sleep(max(0.0, interval - (time.monotonic() - started)))

    def _read_bucket(self) -> Second:
        now = int(time.time())
        if not self.read_seconds or self.read_seconds[-1].t != now:
            self.read_seconds.append(Second(t=now))
        return self.read_seconds[-1]

    def _read_ok(self, node: str) -> None:
        now = time.time()
        self.reads_ok += 1
        self.reads_by_node[node] = self.reads_by_node.get(node, 0) + 1
        bucket = self._read_bucket()
        bucket.nodes[node] = bucket.nodes.get(node, 0) + 1
        if self.reads_failing_since is not None:
            self.last_read_outage = now - self.reads_failing_since
            self.emit("reads_resumed", node=node, after=round(self.last_read_outage, 1))
            self.reads_failing_since = None
        self.last_read_ok_at = now

    def _read_failed(self) -> None:
        self.reads_failed += 1
        self._read_bucket().failed += 1
        # One refused connection is a standby leaving the rotation; only a run
        # of them means no standby is serving reads.
        recent = list(self.read_seconds)[-2:]
        if self.reads_failing_since is None and not any(s.nodes for s in recent):
            self.reads_failing_since = self.last_read_ok_at or time.time()
            self.emit("reads_failing")

    def _bucket(self) -> Second:
        now = int(time.time())
        if not self.seconds or self.seconds[-1].t != now:
            self.seconds.append(Second(t=now))
        return self.seconds[-1]

    def _write_ok(self, seq: int, node: str) -> None:
        now = time.time()
        self.acked.add(seq)
        bucket = self._bucket()
        bucket.nodes[node] = bucket.nodes.get(node, 0) + 1
        if self.failing_since is not None:
            self.last_outage = now - self.failing_since
            self.emit("writes_resumed", node=node, after=round(self.last_outage, 1))
            self.failing_since = None
        elif self.last_node and node != self.last_node:
            self.emit("writes_moved", node=node, previous=self.last_node)
        self.last_node = node
        self.last_ok_at = now

    def _write_failed(self, reason: str) -> None:
        self.failed += 1
        self._bucket().failed += 1
        if self.failing_since is None:
            # The pause is measured from the last write that was confirmed.
            self.failing_since = self.last_ok_at or time.time()
            self.emit("writes_failing", reason=reason)
            self._incident()

    # -- what the nodes say -------------------------------------------------------

    async def _patroni_loop(self, node: Node) -> None:
        while True:
            if node.chaos == "isolate":
                await self._look_inside(node)
                await asyncio.sleep(1.0)
                continue
            try:
                response = await self.http.get(f"http://{node.name}:{config.PATRONI_PORT}/patroni")
                self._apply_patroni(node, response.json())
                node.reachable = True
                node.last_seen = time.time()
            except Exception:
                node.reachable = False
            await asyncio.sleep(0.5)

    @staticmethod
    def _apply_patroni(node: Node, payload: dict[str, Any]) -> None:
        role = payload.get("role")
        node.role = "primary" if role in ("master", "primary", "standby_leader") else role
        node.state = payload.get("state")
        node.replication_state = payload.get("replication_state")
        node.timeline = payload.get("timeline")
        xlog = payload.get("xlog") or {}
        node.lsn = xlog.get("location") or max(
            xlog.get("received_location") or 0, xlog.get("replayed_location") or 0
        ) or None

    async def _look_inside(self, node: Node) -> None:
        node.reachable = False
        try:
            text = await self.chaos.exec_inside(
                node.name, ["curl", "-s", "-m", "1", f"http://localhost:{config.PATRONI_PORT}/patroni"]
            )
            payload = json.loads(text[text.index("{") :])
            before = node.inside.get("role") if node.inside else None
            probe = Node(name=node.name, label=node.label)
            self._apply_patroni(probe, payload)
            node.inside = {"role": probe.role, "state": probe.state}
            if before == "primary" and probe.role != "primary":
                self.emit("demoted_self", node=node.name)
        except Exception:
            pass

    async def _rows_loop(self, node: Node) -> None:
        conn: asyncpg.Connection | None = None
        while True:
            try:
                if node.chaos == "isolate" or not self.ready:
                    raise ConnectionError("unreachable")
                if conn is None or conn.is_closed():
                    dsn = config.NODE_DSN.format(host=node.name)
                    conn = await asyncpg.connect(dsn, timeout=1, statement_cache_size=0)
                row = await conn.fetchrow(
                    "SELECT coalesce(max(seq), 0) AS last, count(*) AS rows FROM demo_writes WHERE run = $1",
                    self.run_id,
                    timeout=1,
                )
                node.last_seq, node.rows = row["last"], row["rows"]
            except Exception:
                if conn is not None:
                    conn.terminate()
                conn = None
            await asyncio.sleep(0.5)

    async def _lock_loop(self) -> None:
        """Who holds the leader lock in etcd, and how long its lease has left."""
        key = f"{config.PATRONI_NAMESPACE}/{config.PATRONI_SCOPE}/leader"
        encoded = base64.b64encode(key.encode()).decode()
        while True:
            try:
                found = (await self.http.post(f"{config.ETCD_URL}/v3/kv/range", json={"key": encoded})).json()
                kvs = found.get("kvs") or []
                if kvs:
                    holder = base64.b64decode(kvs[0]["value"]).decode()
                    lease = kvs[0].get("lease")
                    ttl = granted = None
                    if lease:
                        alive = (
                            await self.http.post(f"{config.ETCD_URL}/v3/lease/timetolive", json={"ID": lease})
                        ).json()
                        ttl, granted = int(alive.get("TTL", -1)), int(alive.get("grantedTTL", 0))
                    self._lock(holder, ttl, granted)
                else:
                    self._lock(None, None, None)
            except Exception:
                pass
            await asyncio.sleep(0.5)

    def _lock(self, holder: str | None, ttl: int | None, granted: int | None) -> None:
        previous = self.lock_holder
        self.lock_ttl, self.lock_granted = ttl, granted
        if holder == previous and self._lock_seen:
            return
        self.lock_holder = holder
        first = not self._lock_seen
        self._lock_seen = True
        if first:
            if holder:
                self.emit("leader", node=holder)
            return
        if holder is None:
            gone = self.nodes.get(previous or "")
            # Released on a clean stop; expired when its holder died holding it.
            self.emit("lock_released" if gone and gone.chaos == "stop" else "lock_expired", node=previous)
        else:
            self.emit("promoted", node=holder, previous=previous)
            self._incident()

    async def _links_loop(self) -> None:
        while True:
            await self.links.ensure()
            await asyncio.sleep(4)

    async def set_link_rtt(self, rtt_ms: float) -> None:
        self.links.rtt_ms = max(0.0, min(float(rtt_ms), 2000.0))
        await self.links.ensure()
        self.emit("link", rtt=self.links.rtt_ms)

    async def _resolve_loop(self) -> None:
        """Map node addresses to names, to tell which node served each write."""
        loop = asyncio.get_running_loop()
        while True:
            for name in self.nodes:
                # tasks.<name> is Swarm's per-task record; elsewhere it does not
                # exist, and asking for it can hang.
                hosts = (name, f"tasks.{name}") if config.CHAOS_DRIVER == "swarm" else (name,)
                for host in hosts:
                    with contextlib.suppress(Exception):
                        for info in await loop.getaddrinfo(host, None, family=socket.AF_INET):
                            self.ip_to_node[info[4][0]] = name
            await asyncio.sleep(2)

    # -- deriving the picture --------------------------------------------------

    async def _watch_loop(self) -> None:
        while True:
            with contextlib.suppress(Exception):
                await self._watch()
            await asyncio.sleep(0.25)

    async def _watch(self) -> None:
        now = time.time()
        leader = self.nodes.get(self.lock_holder or "")
        leader_lsn = leader.lsn if leader and leader.reachable else None
        for node in self.nodes.values():
            before = node.status
            node.status = self._status(node)
            node.lag = (
                max(0, leader_lsn - node.lsn)
                if node.status in ("standby", "catching_up") and leader_lsn and node.lsn
                else None
            )
            if before == node.status:
                continue
            if node.status == "down" and before in ("primary", "standby", "catching_up") and not node.chaos:
                self.emit("node_down", node=node.name)
                self._incident()
            if node.recovering and before in ("down", "isolated", "unknown") and node.status != "down":
                self.emit("node_back", node=node.name)
            if node.status == "standby" and node.recovering:
                node.recovering = False
                self.emit("rejoined", node=node.name, timeline=node.timeline)
            if node.status == "demoting":
                self.emit("demoting", node=node.name)

        # Bring back a node left down too long, so a public demo heals itself.
        if config.AUTO_RECOVER_SECONDS > 0:
            for node in self.nodes.values():
                if node.chaos and node.chaos_since and now - node.chaos_since > config.AUTO_RECOVER_SECONDS:
                    with contextlib.suppress(ChaosError):
                        await self.recover(node.name, automatic=True)

        # While all is well, keep proving it: every confirmed write is re-read
        # from the primary every few seconds.
        if (
            self.ready
            and self.incident_since is None
            and self.failing_since is None
            and not self._verifying
            and (self.verification is None or now - self.verification["t"] > 8)
        ):
            asyncio.create_task(self._verify_quietly())

        if self.incident_since is not None and self._healthy():
            self.incident_since = None
            self.recovered_at = now
            await self.verify(automatic=True)
            self.emit("healthy", outage=round(self.last_outage, 1) if self.last_outage else None)

    def _status(self, node: Node) -> str:
        if node.chaos == "isolate":
            return "isolated"
        if not node.reachable:
            return "down" if (node.chaos or node.last_seen or self.ready) else "unknown"
        if node.chaos:
            # Answering again before anyone asked it back: still on its way down.
            return "down"
        if node.role == "primary":
            return "primary" if node.name == self.lock_holder else "demoting"
        if node.role == "replica":
            if node.state in ("running", "streaming") and (
                node.replication_state == "streaming" or node.replication_state is None and node.state == "streaming"
            ):
                return "standby"
            leader = self.nodes.get(self.lock_holder or "")
            if leader is None or not leader.reachable or leader.role != "primary":
                # A standby with nobody to follow: it holds its data and waits.
                return "waiting"
            return "catching_up"
        return "starting"

    def _healthy(self) -> bool:
        statuses = [node.status for node in self.nodes.values()]
        return (
            statuses.count("primary") == 1
            and statuses.count("standby") == len(statuses) - 1
            and self.failing_since is None
            and self.last_ok_at is not None
            and time.time() - self.last_ok_at < 3
        )

    def _incident(self) -> None:
        if self.incident_since is None:
            self.incident_since = time.time()
            self.recovered_at = None
            self.verification = None

    def phase(self) -> dict[str, Any]:
        now = time.time()
        if not self.ready:
            return {"kind": "starting"}
        if self.failing_since is not None:
            outage = round(now - self.failing_since, 1)
            holder = self.nodes.get(self.lock_holder or "")
            if holder and holder.status in ("down", "isolated"):
                return {"kind": "waiting_lock", "node": holder.name, "ttl": self.lock_ttl, "outage": outage}
            if self.lock_holder is None:
                return {"kind": "electing", "outage": outage}
            return {"kind": "switching", "node": self.lock_holder, "outage": outage}
        broken = [n for n in self.nodes.values() if n.status not in ("primary", "standby")]
        if broken:
            node = broken[0]
            if node.status in ("down", "isolated"):
                return {
                    "kind": "degraded",
                    "node": node.name,
                    "leader": self.lock_holder,
                    "mode": node.chaos,
                    # Only claimed once the node itself reports it.
                    "demoted": bool(node.inside and node.inside.get("role") not in (None, "primary")),
                }
            return {"kind": "rejoining", "node": node.name, "leader": self.lock_holder}
        if self.recovered_at and now - self.recovered_at < RECOVERED_BANNER_SECONDS:
            return {
                "kind": "recovered",
                "leader": self.lock_holder,
                "outage": round(self.last_outage, 1) if self.last_outage else None,
                "lost": self.verification["missing"] if self.verification else None,
            }
        return {"kind": "healthy", "leader": self.lock_holder}

    # -- actions ----------------------------------------------------------------

    async def fail(self, name: str, mode: str) -> None:
        node = self.nodes.get(name)
        if node is None:
            raise ChaosError(f"unknown node {name}")
        if node.chaos:
            raise ChaosError(f"{node.label} is already down")
        standing = [n for n in self.nodes.values() if not n.chaos and n.name != name]
        if not standing:
            raise ChaosError("at least one node has to stay up")
        was = node.status
        node.chaos, node.chaos_since, node.recovering, node.inside = mode, time.time(), False, None
        self._incident()
        self.emit("failure", node=name, mode=mode, was=was)
        try:
            await self.chaos.fail(name, mode)
        except Exception:
            node.chaos = node.chaos_since = None
            raise

    async def recover(self, name: str, automatic: bool = False) -> None:
        node = self.nodes.get(name)
        if node is None or not node.chaos:
            raise ChaosError(f"{name} is not down")
        await self.chaos.recover(name)
        node.chaos = node.chaos_since = None
        node.inside = None
        node.recovering = True
        node.reachable = False
        self.emit("recover", node=name, automatic=automatic)

    async def _verify_quietly(self) -> None:
        self._verifying = True
        try:
            await self.verify(quiet=True)
        except Exception:
            pass
        finally:
            self._verifying = False

    async def verify(self, automatic: bool = False, quiet: bool = False) -> dict[str, Any]:
        """Read every write back from the current primary and compare it with
        the writes the application was told had been committed."""
        acked = set(self.acked)
        conn = await asyncpg.connect(config.WRITER_DSN, timeout=3, statement_cache_size=0)
        try:
            rows = await conn.fetch("SELECT seq FROM demo_writes WHERE run = $1", self.run_id, timeout=5)
        finally:
            await conn.close()
        found = {row["seq"] for row in rows}
        missing = sorted(acked - found)
        self.verification = {
            "t": time.time(),
            "acked": len(acked),
            "found": len(acked & found),
            "missing": len(missing),
            "missing_sample": missing[:10],
            # Writes the client gave up on (a timeout mid-failover) that had in
            # fact committed: the outcome of an interrupted write is unknown,
            # never "lost".
            "unconfirmed_landed": len(found - acked),
        }
        if not quiet:
            self.emit("verified", automatic=automatic, **{k: self.verification[k] for k in ("acked", "missing")})
        return self.verification

    # -- the view the page draws -------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        return {
            "now": now,
            "run": str(self.run_id),
            "started": self.started,
            "ready": self.ready,
            "setup_error": self.setup_error,
            "driver": self.chaos.driver,
            "modes": self.chaos.modes,
            "control_locked": bool(config.CONTROL_TOKEN),
            "auto_recover": config.AUTO_RECOVER_SECONDS,
            "writes_per_second": config.WRITES_PER_SECOND,
            "lock": {"holder": self.lock_holder, "ttl": self.lock_ttl, "granted": self.lock_granted},
            "nodes": [
                {
                    "name": n.name,
                    "label": n.label,
                    "status": n.status,
                    "role": n.role,
                    "state": n.state,
                    "timeline": n.timeline,
                    "lag": n.lag,
                    "last_seq": n.last_seq,
                    "rows": n.rows,
                    "chaos": n.chaos,
                    "chaos_since": n.chaos_since,
                    "recovering": n.recovering,
                    "inside": n.inside,
                }
                for n in self.nodes.values()
            ],
            "writes": {
                "acked": len(self.acked),
                "failed": self.failed,
                "last_seq": max(self.acked) if self.acked else 0,
                "last_node": self.last_node,
                "failing_since": self.failing_since,
                "last_outage": round(self.last_outage, 1) if self.last_outage else None,
                "series": [{"t": s.t, "nodes": s.nodes, "failed": s.failed} for s in self.seconds],
            },
            "link": self.links.snapshot(),
            "reads_per_second": config.READS_PER_SECOND,
            "reads": {
                "ok": self.reads_ok,
                "failed": self.reads_failed,
                "by_node": self.reads_by_node,
                "failing_since": self.reads_failing_since,
                "last_outage": round(self.last_read_outage, 1) if self.last_read_outage else None,
                "series": [{"t": s.t, "nodes": s.nodes, "failed": s.failed} for s in self.read_seconds],
            },
            "phase": self.phase(),
            "verification": self.verification,
            "events": list(self.events)[-60:],
        }


def _short(exc: BaseException) -> str:
    text = str(exc) or type(exc).__name__
    return text.splitlines()[0][:160]
