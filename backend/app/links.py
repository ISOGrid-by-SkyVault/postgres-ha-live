"""The network between the nodes' data centers.

Each node is reached by the others through its own link, a TCP proxy that
delays every packet in both directions. The delay is real: replication and
Patroni's node-to-node calls wait for it.
"""

from __future__ import annotations

import httpx

from . import config

STREAMS = ("upstream", "downstream")


class Links:
    def __init__(self) -> None:
        self.names = config.LINKS
        self.rtt_ms = config.LINK_RTT_MS if self.names else 0.0
        #: Links whose latency is known to be in place.
        self.applied: dict[str, float] = {}
        self.http = httpx.AsyncClient(timeout=1.5)

    @property
    def available(self) -> bool:
        return bool(self.names)

    async def close(self) -> None:
        await self.http.aclose()

    async def ensure(self) -> None:
        """Make every link carry the wanted latency. Called on a loop: a link
        that restarted has forgotten it."""
        for name in self.names:
            try:
                await self._ensure(name)
                self.applied[name] = self.rtt_ms
            except Exception:
                self.applied.pop(name, None)

    async def _ensure(self, link: str) -> None:
        base = f"http://{link}:{config.LINK_API_PORT}"
        proxies = (await self.http.get(f"{base}/proxies")).json()
        # One crossing of the link is half the round trip.
        one_way = int(round(self.rtt_ms / 2))
        wanted = {"latency": one_way, "jitter": int(round(one_way / 4))}
        for proxy, detail in proxies.items():
            present = {toxic["name"]: toxic for toxic in detail.get("toxics") or []}
            for stream in STREAMS:
                toxic = f"latency_{stream}"
                url = f"{base}/proxies/{proxy}/toxics"
                if one_way <= 0:
                    if toxic in present:
                        await self.http.delete(f"{url}/{toxic}")
                elif toxic not in present:
                    response = await self.http.post(
                        url, json={"name": toxic, "type": "latency", "stream": stream, "attributes": wanted}
                    )
                    response.raise_for_status()
                elif present[toxic].get("attributes") != wanted:
                    response = await self.http.post(f"{url}/{toxic}", json={"attributes": wanted})
                    response.raise_for_status()

    def snapshot(self) -> dict[str, object]:
        return {
            "available": self.available,
            "rtt_ms": self.rtt_ms,
            "distances_km": config.LINK_DISTANCES_KM,
            "applied": self.available and all(self.applied.get(n) == self.rtt_ms for n in self.names),
        }
