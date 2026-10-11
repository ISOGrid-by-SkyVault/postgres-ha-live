"""Everything the demo reads from its environment.

The defaults describe the self-contained stack in docker-compose.yml. Pointed at
a cluster on Docker Swarm, the same names are the Swarm services
(`<instance>-pg1`, ...), the router and the pooler.
"""

from __future__ import annotations

import os


def _list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


#: The Patroni members, in display order. Each one's REST API is reached at
#: http://<name>:8008 and its PostgreSQL at <name>:5432.
NODES: list[str] = _list("NODES", "pg1,pg2,pg3")

#: The site each node is shown in. The defaults are three districts of Algiers,
#: chosen to illustrate a metropolitan deployment: they are simulated sites,
#: not a statement of where anything is hosted.
LABELS: list[str] = _list("NODE_LABELS", "Chéraga,Bab Ezzouar,Rouiba")

PATRONI_PORT = int(os.environ.get("PATRONI_PORT", "8008"))
PATRONI_SCOPE = os.environ.get("PATRONI_SCOPE", "demo-ha")
PATRONI_NAMESPACE = os.environ.get("PATRONI_NAMESPACE", "/service")

#: etcd's v3 HTTP gateway. Read for the leader lock and the seconds its lease
#: has left, which is the countdown shown while a crashed primary still holds it.
ETCD_URL = os.environ.get("ETCD_URL", "http://etcd:2379")

#: Where the application writes: the pooler, exactly as a tenant app would.
WRITER_DSN = os.environ.get("WRITER_DSN", "postgresql://demo:demo-password@pooler:6432/demo")

#: Each node read directly, to show how far its copy of the data has got.
NODE_DSN = os.environ.get("NODE_DSN", "postgresql://demo:demo-password@{host}:5432/demo")

#: Used once at start to create the demo role and database. Empty when they
#: already exist (a managed instance, where the console creates them).
ADMIN_DSN = os.environ.get("ADMIN_DSN", "postgresql://postgres:demo-superuser@router:5432/postgres")
DEMO_ROLE = os.environ.get("DEMO_ROLE", "demo")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo-password")
DEMO_DATABASE = os.environ.get("DEMO_DATABASE", "demo")

WRITES_PER_SECOND = float(os.environ.get("WRITES_PER_SECOND", "5"))

#: How the demo breaks a node:
#:   compose - containers of a Compose project (power cut, clean shutdown, network cut)
#:   swarm   - services on a Swarm manager (clean shutdown only: scale to 0 and back)
#:   none    - watch only
CHAOS_DRIVER = os.environ.get("CHAOS_DRIVER", "compose")
COMPOSE_PROJECT = os.environ.get("COMPOSE_PROJECT", "isogrid-pg-ha-demo")
DOCKER_SOCKET = os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock")

#: When set, breaking and repairing nodes needs this key (`?key=` in the page's
#: URL). Viewers without it watch the same live view, read-only.
CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")

#: A node left down this long is brought back on its own, so a public demo
#: never stays broken. 0 turns it off.
AUTO_RECOVER_SECONDS = float(os.environ.get("AUTO_RECOVER_SECONDS", "180"))

#: The built front-end, served by the API in the production image.
STATIC_DIR = os.environ.get("STATIC_DIR", "")

#: Where the application reads: the router's read port, which spreads
#: connections across the standbys (HAProxy `listen replicas`, round robin).
READER_DSN = os.environ.get("READER_DSN", "postgresql://demo:demo-password@router:5433/demo")
READS_PER_SECOND = float(os.environ.get("READS_PER_SECOND", "8"))

#: The links between data centers: one latency proxy per node, in node order
#: (see docker-compose.yml). Empty when the nodes talk to each other directly.
LINKS: list[str] = _list("LINKS", "dc1,dc2,dc3")
LINK_API_PORT = int(os.environ.get("LINK_API_PORT", "8474"))

#: Round-trip time added between two nodes, in milliseconds. Three data
#: centers in one city are a few milliseconds apart; the page can raise it.
LINK_RTT_MS = float(os.environ.get("LINK_RTT_MS", "2"))

#: Straight-line distance between the sites, in kilometres, shown on the links.
#: Fibre adds about 1 ms of round trip per 100 km, so across one city the delay
#: is dominated by equipment, not distance.
LINK_DISTANCES_KM: dict[str, float] = {
    pair.split("=")[0].replace("-", "|"): float(pair.split("=")[1])
    for pair in _list("LINK_DISTANCES_KM", "pg1-pg2=20,pg2-pg3=9,pg1-pg3=29")
    if "=" in pair
}
