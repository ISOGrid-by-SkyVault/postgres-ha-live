"""HTTP and WebSocket front of the demo."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .chaos import ChaosError
from .engine import Engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
engine = Engine()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await engine.start()
    yield
    await engine.stop()


app = FastAPI(title="ISOGrid PostgreSQL HA live demo", lifespan=lifespan)


def _authorise(key: str | None) -> None:
    if config.CONTROL_TOKEN and key != config.CONTROL_TOKEN:
        raise HTTPException(403, "This screen is read-only.")


class Failure(BaseModel):
    mode: str = "crash"


@app.get("/api/state")
async def state() -> dict:
    return engine.snapshot()


@app.post("/api/nodes/{name}/fail")
async def fail(name: str, body: Failure, x_control_key: str | None = Header(default=None)) -> dict:
    _authorise(x_control_key)
    try:
        await engine.fail(name, body.mode)
    except ChaosError as exc:
        raise HTTPException(409, str(exc)) from exc
    return engine.snapshot()


@app.post("/api/nodes/{name}/recover")
async def recover(name: str, x_control_key: str | None = Header(default=None)) -> dict:
    _authorise(x_control_key)
    try:
        await engine.recover(name)
    except ChaosError as exc:
        raise HTTPException(409, str(exc)) from exc
    return engine.snapshot()


@app.post("/api/verify")
async def verify(x_control_key: str | None = Header(default=None)) -> dict:
    _authorise(x_control_key)
    try:
        return await engine.verify()
    except Exception as exc:
        raise HTTPException(503, f"The primary could not be read: {exc}") from exc


@app.post("/api/reset")
async def reset(x_control_key: str | None = Header(default=None)) -> dict:
    _authorise(x_control_key)
    engine.reset_run()
    engine.emit("reset")
    return engine.snapshot()


@app.get("/api/key")
async def check_key(x_control_key: str | None = Header(default=None)) -> dict:
    return {"control": not config.CONTROL_TOKEN or x_control_key == config.CONTROL_TOKEN}


@app.websocket("/api/live")
async def live(socket: WebSocket) -> None:
    await socket.accept()
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            await socket.send_json(engine.snapshot())
            await asyncio.sleep(0.25)


if config.STATIC_DIR and Path(config.STATIC_DIR).is_dir():
    static = Path(config.STATIC_DIR)
    app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

    @app.get("/{path:path}")
    async def page(path: str) -> FileResponse:
        target = static / path
        return FileResponse(target if path and target.is_file() else static / "index.html")
