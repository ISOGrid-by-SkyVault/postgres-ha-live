"""Breaking and repairing nodes, through the Docker Engine API.

Three failures, each a different real-world event:

* **crash** - SIGKILL to the container: a power cut or kernel panic. Patroni
  dies with PostgreSQL and cannot hand over, so the leader lock in etcd has to
  expire (its TTL is 30 s on a managed instance) before a standby may promote.
* **stop** - a clean shutdown (SIGTERM): maintenance, a host reboot. Patroni
  stops PostgreSQL and releases the lock itself, so a standby takes over at once.
* **isolate** - the node is cut off the network but keeps running: a switch or
  link failure. It can no longer renew its lock, so it demotes *itself* to
  read-only - which is what prevents two primaries (split brain).

Repairing starts the container again or plugs it back in; Patroni then rejoins
it as a standby, rewinding it first if it had diverged.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from . import config

MODES_BY_DRIVER = {
    "compose": ["crash", "stop", "isolate"],
    "swarm": ["stop"],
    "none": [],
}


class ChaosError(RuntimeError):
    pass


class DockerChaos:
    def __init__(self) -> None:
        self.driver = config.CHAOS_DRIVER if config.CHAOS_DRIVER in MODES_BY_DRIVER else "none"
        self.modes = MODES_BY_DRIVER[self.driver]
        self._client: httpx.AsyncClient | None = None
        #: name -> (network, endpoint config) of a node cut off the network, to
        #: plug it back with the same DNS aliases and address.
        self._unplugged: dict[str, tuple[str, dict[str, Any]]] = {}

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            transport = httpx.AsyncHTTPTransport(uds=config.DOCKER_SOCKET)
            self._client = httpx.AsyncClient(transport=transport, base_url="http://docker", timeout=20)
        return self._client

    async def _call(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        response = await self.client.request(method, path, **kwargs)
        # 304: already in the asked state (starting a running container).
        if response.status_code >= 400:
            raise ChaosError(f"docker {method} {path}: {response.status_code} {response.text[:200]}")
        return response

    # -- compose ------------------------------------------------------------

    async def container(self, node: str) -> dict[str, Any]:
        filters = json.dumps(
            {
                "label": [
                    f"com.docker.compose.project={config.COMPOSE_PROJECT}",
                    f"com.docker.compose.service={node}",
                ]
            }
        )
        found = (await self._call("GET", "/containers/json", params={"all": "1", "filters": filters})).json()
        if not found:
            raise ChaosError(f"no container for {node} in project {config.COMPOSE_PROJECT}")
        return (await self._call("GET", f"/containers/{found[0]['Id']}/json")).json()

    async def fail(self, node: str, mode: str) -> None:
        if mode not in self.modes:
            raise ChaosError(f"{mode} is not available with the {self.driver} driver")
        if self.driver == "swarm":
            await self._scale(node, 0)
            return
        info = await self.container(node)
        cid = info["Id"]
        if mode == "crash":
            await self._call("POST", f"/containers/{cid}/kill", params={"signal": "KILL"})
        elif mode == "stop":
            # SIGTERM by name, not `docker stop`: the postgres base image declares
            # SIGINT as its stop signal, which Patroni ignores. On SIGTERM it
            # stops PostgreSQL and releases the lock itself.
            await self._call("POST", f"/containers/{cid}/kill", params={"signal": "TERM"})
        elif mode == "isolate":
            networks = info["NetworkSettings"]["Networks"]
            name, endpoint = next(iter(networks.items()))
            self._unplugged[node] = (
                name,
                {
                    "Aliases": [alias for alias in (endpoint.get("Aliases") or []) if alias] or [node],
                    "IPAMConfig": {"IPv4Address": endpoint.get("IPAddress")} if endpoint.get("IPAddress") else None,
                },
            )
            await self._call("POST", f"/networks/{name}/disconnect", json={"Container": cid, "Force": True})

    async def recover(self, node: str) -> None:
        if self.driver == "swarm":
            await self._scale(node, 1)
            return
        if self.driver != "compose":
            raise ChaosError("this demo cannot repair nodes")
        info = await self.container(node)
        cid = info["Id"]
        if node in self._unplugged:
            network, endpoint = self._unplugged.pop(node)
            endpoint = {key: value for key, value in endpoint.items() if value}
            await self._call(
                "POST", f"/networks/{network}/connect", json={"Container": cid, "EndpointConfig": endpoint}
            )
        if not info["State"]["Running"]:
            await self._call("POST", f"/containers/{cid}/start")

    async def isolated(self, node: str) -> bool:
        return node in self._unplugged

    async def exec_inside(self, node: str, command: list[str]) -> str:
        """Run a command inside a node's container - the only way to watch a
        node that is cut off the network, since nothing can reach it."""
        info = await self.container(node)
        created = await self._call(
            "POST",
            f"/containers/{info['Id']}/exec",
            json={"Cmd": command, "AttachStdout": True, "AttachStderr": True, "Tty": True},
        )
        started = await self._call(
            "POST", f"/exec/{created.json()['Id']}/start", json={"Detach": False, "Tty": True}, timeout=5
        )
        return started.text

    # -- swarm --------------------------------------------------------------

    async def _scale(self, service: str, replicas: int) -> None:
        current = (await self._call("GET", f"/services/{service}")).json()
        spec = current["Spec"]
        spec.setdefault("Mode", {}).setdefault("Replicated", {})["Replicas"] = replicas
        await self._call(
            "POST", f"/services/{service}/update", params={"version": current["Version"]["Index"]}, json=spec
        )
