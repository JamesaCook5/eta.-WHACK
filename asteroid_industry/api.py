"""HTTP API for the station planner.

Run from the repo root::

    pip install -r requirements.txt
    uvicorn asteroid_industry.api:app --port 8000

The UI (Next.js) proxies ``/api/planner/*`` to this server (see
``UI Skeleton/next.config.mjs``; set ``PLANNER_URL`` to change where).

Environment
-----------
ETA_ROOT           Repo root holding the DAG files (default: this package's parent).
ETA_ASTEROIDS      Asteroid table shared with the UI, so indices line up
                   (default: ``$ETA_ROOT/UI Skeleton/public/data/asteroids.json``).
"""

from __future__ import annotations

import base64
import os
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .stations import StationPlanner

ROOT = Path(os.environ.get("ETA_ROOT", Path(__file__).resolve().parents[1]))
ASTEROIDS = Path(os.environ.get("ETA_ASTEROIDS", ROOT / "UI Skeleton" / "public" / "data" / "asteroids.json"))
CACHE_SIZE = 64

app = FastAPI(title="eta. station planner", version="1.0")


@lru_cache(maxsize=1)
def planner() -> StationPlanner:
    return StationPlanner.from_files(ASTEROIDS, ROOT)


class PlanRequest(BaseModel):
    product: str
    stations: int = Field(3, ge=1, le=8)
    trip_years: float = Field(2.0, ge=0.1, le=20.0)
    include_outer: bool = False
    draws: int = Field(1000, ge=0, le=5000)
    #: Filter mask over the asteroid table as base64 packed bits (numpy bit order); omit for all.
    mask: str | None = None


_cache: OrderedDict[tuple, dict] = OrderedDict()
_lock = Lock()


@app.get("/health")
def health() -> dict:
    p = planner()
    return {"ok": True, "asteroids": p.asteroids.count, "products": len(p.products)}


@app.post("/plan")
def plan(req: PlanRequest) -> dict:
    """Stations for one product. A plain ``def`` so FastAPI runs it in a worker thread."""
    p = planner()
    if req.product not in p.products:
        raise HTTPException(404, f"Unknown product {req.product!r}")
    mask = None
    if req.mask:
        try:
            bits = np.unpackbits(np.frombuffer(base64.b64decode(req.mask), dtype=np.uint8))
        except Exception as err:  # pragma: no cover - malformed input
            raise HTTPException(400, f"Bad mask: {err}") from err
        if len(bits) < p.asteroids.count:
            raise HTTPException(400, "Mask is shorter than the asteroid table")
        mask = bits[: p.asteroids.count].astype(bool)
    key = (req.product, req.stations, round(req.trip_years, 4), req.include_outer, req.draws, req.mask)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    result = p.plan(req.product, req.stations, req.trip_years, req.include_outer, req.draws, mask)
    with _lock:
        _cache[key] = result
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return result
